from copy import deepcopy
import json
import math
import unittest
from unittest.mock import patch

from reshivo.balance import plan_shared_balance
from reshivo.engineering_intake import (
    FIELD_ORDER, SYSTEM_PROMPT, engineering_schema, normalize_engineering_fields,
    prepare_engineering_draft, prepare_engineering_values, read_engineering_note,
    validate_engineering_request,
)
from reshivo.meta import Generation, MetaAPIError, MetaValidationError
from reshivo.products import ProductInputError


BASIS = "x=0 at the module centre; all trim coordinates are actual mass centres on one shared axis"
NOTE = (
    "Synthetic observation ref intake-1. Complete assembly mass 950 g; weighing uncertainty 5 g. "
    "Total available addition 150 g; total removable trim 80 g. Each active adjustment uncertainty 1 g. "
    + BASIS + ". Assembly centre +1.0 cm; centre uncertainty 0.05 cm. "
    "Location A reference left. A trim mass centre -6 cm; A position uncertainty 0 mm; A add limit 150 g; A removal limit 0 g. "
    "Location B reference right. B trim mass centre +0.06 m; B position uncertainty 0 mm; B add limit 150 g; B removal limit 80 g. "
    "Command increment 1 g. Bounds apply independently at active trim locations."
)


def request(note=NOTE):
    return {
        "brief": {"input": "Contained recovered metal-rich core with an unknown binder", "variation": "Separate observations, not future batches",
                  "contamination": "Unknown", "product": "Contained ballast module", "use_case": "Synthetic software check",
                  "targets": "Mass 980–1020 g; balance -2 to 2 mm.", "process": "No physical processing", "available_changes": "Suitable independent sealed trims"},
        "calculation_context": {"label": "Engineering intake test", "components": [{"id": 1, "name": "", "role": "main", "amount": ""}],
                                "amount_unit": "g", "amount_basis": "", "mass_target_min_kg": ".98", "mass_target_max_kg": "1.02",
                                "balance": {"coordinate_basis": BASIS, "target_min_mm": "-2", "target_max_mm": "2"}},
        "note": note,
    }


def quantity(literal, unit, quote, source="note"):
    return {"source": source, "quote": quote, "number_text": literal, "unit": unit}


def text(value, quote, source="note"):
    return {"source": source, "quote": quote, "text": value}


def fields():
    return {
        "observation_id": text("intake-1", "observation ref intake-1"),
        "observation_kind": {"source": "note", "quote": "Synthetic observation ref intake-1", "kind": "simulated"},
        "mass_kg": quantity("950", "g", "Complete assembly mass 950 g"),
        "weighing_uncertainty_kg": quantity("5", "g", "weighing uncertainty 5 g"),
        "total_max_add_kg": quantity("150", "g", "Total available addition 150 g"),
        "total_max_remove_kg": quantity("80", "g", "total removable trim 80 g"),
        "adjustment_uncertainty_kg": quantity("1", "g", "Each active adjustment uncertainty 1 g"),
        "mass_target_min_kg": quantity("980", "g", "Mass 980–1020 g", "brief.targets"),
        "mass_target_max_kg": quantity("1020", "g", "Mass 980–1020 g", "brief.targets"),
        "balance_target_min_mm": quantity("-2", "mm", "balance -2 to 2 mm", "brief.targets"),
        "balance_target_max_mm": quantity("2", "mm", "balance -2 to 2 mm", "brief.targets"),
        "coordinate_basis": text(BASIS, BASIS),
        "cg_x_mm": quantity("+1.0", "cm", "Assembly centre +1.0 cm"),
        "cg_uncertainty_mm": quantity("0.05", "cm", "centre uncertainty 0.05 cm"),
        "position_a_id": text("left", "Location A reference left"),
        "position_a_x_mm": quantity("-6", "cm", "A trim mass centre -6 cm"),
        "position_a_uncertainty_mm": quantity("0", "mm", "A position uncertainty 0 mm"),
        "position_a_max_add_kg": quantity("150", "g", "A add limit 150 g"),
        "position_a_max_remove_kg": quantity("0", "g", "A removal limit 0 g"),
        "position_b_id": text("right", "Location B reference right"),
        "position_b_x_mm": quantity("+0.06", "m", "B trim mass centre +0.06 m"),
        "position_b_uncertainty_mm": quantity("0", "mm", "B position uncertainty 0 mm"),
        "position_b_max_add_kg": quantity("150", "g", "B add limit 150 g"),
        "position_b_max_remove_kg": quantity("80", "g", "B removal limit 80 g"),
        "command_resolution_kg": quantity("1", "g", "Command increment 1 g"),
    }


class Client:
    def __init__(self, response=None, error=None):
        self.response = fields() if response is None else response
        self.error = error
        self.calls = []

    def generate(self, prompt, schema, max_candidates, **options):
        self.calls.append((json.loads(prompt), schema, max_candidates, options))
        if self.error: raise self.error
        return Generation(self.response, "muse-spark-1.3", False, {"total_tokens": 20}, "engineering-fixture", 14)


class EngineeringIntakeTests(unittest.TestCase):
    def test_one_call_normalizes_25_fields_without_applying_or_calculating(self):
        case = request(); original = deepcopy(case); client = Client()
        with patch("reshivo.balance.plan_balance", side_effect=AssertionError("Read must not calculate")):
            result = read_engineering_note(case, client=client)
        self.assertEqual(case, original)
        self.assertEqual(len(result["fields"]), 25)
        self.assertEqual(result["values"]["mass_kg"], .95)
        self.assertEqual(result["values"]["cg_x_mm"], 10)
        self.assertEqual(result["values"]["cg_uncertainty_mm"], .5)
        self.assertEqual(result["values"]["position_a_x_mm"], -60)
        self.assertEqual(result["values"]["position_b_x_mm"], 60)
        self.assertEqual(result["values"]["position_a_max_remove_kg"], 0)
        self.assertEqual(result["missing_fields"], [])
        self.assertEqual(result["conflicts"], [])
        self.assertTrue(result["review_required"])
        self.assertFalse(result["ready"])
        self.assertFalse(result["interpretation_verified"])
        self.assertFalse(result["physical_product_tested"])
        self.assertNotIn("bound_request", result)
        self.assertEqual((result["provider"], result["model"], result["request_id"], result["elapsed_ms"]), ("meta", "muse-spark-1.3", "engineering-fixture", 14))
        self.assertEqual(result["usage"], {"total_tokens": 20})
        self.assertEqual(len(client.calls), 1)
        prompt, schema, count, options = client.calls[0]
        self.assertEqual(prompt["brief"], case["brief"])
        self.assertEqual(schema, engineering_schema())
        self.assertEqual(count, 1)
        self.assertEqual(options["max_completion_tokens"], 4096)
        self.assertEqual(options["system_prompt"], SYSTEM_PROMPT)

    def test_canonical_targets_can_be_reused_without_model_copying_them(self):
        data = fields()
        for key in ("mass_target_min_kg", "mass_target_max_kg", "balance_target_min_mm", "balance_target_max_mm", "coordinate_basis"):
            data[key] = None
        result = normalize_engineering_fields(request(), data)
        self.assertEqual(result["missing_fields"], [])
        self.assertEqual(result["target_resolution"]["mass_target_min_kg"]["selected"], .98)
        self.assertEqual(result["target_resolution"]["coordinate_basis"]["origin"], "current_case")

    def test_reviews_and_independence_are_required_even_when_note_mentions_them(self):
        case = request(); draft = read_engineering_note(case, client=Client())
        for flags in ({}, {"review_confirmed": True}, {"independent_adjustments": True}, {"review_confirmed": 1, "independent_adjustments": True}):
            with self.subTest(flags=flags):
                result = prepare_engineering_draft(case, draft, **flags)
                self.assertFalse(result["ready"])
                self.assertNotIn("bound_request", result)
                self.assertTrue(result["questions"])

    def test_reviewed_draft_prepares_a_single_bound_payload_for_existing_checker(self):
        case = request(); draft = read_engineering_note(case, client=Client())
        before = deepcopy(draft)
        prepared = prepare_engineering_draft(case, draft, review_confirmed=True, independent_adjustments=True)
        self.assertEqual(draft, before)
        self.assertTrue(prepared["ready"])
        self.assertEqual(prepared["source_path"], "quoted_engineering_note")
        bound = prepared["bound_request"]
        self.assertEqual(bound["brief"], case["brief"])
        self.assertEqual(bound["calculation_context"]["components"], case["calculation_context"]["components"])
        self.assertEqual(bound["balance"]["baseline"], {"position_id": "left", "command_kg": 0})
        checked = plan_shared_balance(bound)
        self.assertTrue(checked["feasible"])
        self.assertEqual([p["command_kg"] for p in checked["commands"]], [.104, -.054])

    def test_ordinary_normalized_values_use_the_same_compiler_without_fabricated_quotes(self):
        case = request(); draft = read_engineering_note(case, client=Client())
        flags = {"review_confirmed": True, "independent_adjustments": True}
        quoted = prepare_engineering_draft(case, draft, **flags)
        plain = prepare_engineering_values(case, draft["values"], **flags)
        self.assertEqual(plain["bound_request"], quoted["bound_request"])
        self.assertEqual(plain["source_path"], "unverified_normalized_values")
        self.assertFalse(plain["interpretation_verified"])

    def test_target_conflicts_preserve_current_until_explicit_proposed_choice(self):
        case = request(); case["calculation_context"]["mass_target_min_kg"] = ".97"
        draft = read_engineering_note(case, client=Client())
        self.assertEqual(draft["conflicts"][0]["field"], "mass_target_min_kg")
        self.assertEqual(draft["target_resolution"]["mass_target_min_kg"]["selected"], .97)
        flags = {"review_confirmed": True, "independent_adjustments": True}
        current = prepare_engineering_draft(case, draft, **flags)
        proposed = prepare_engineering_draft(case, draft, target_choice="proposed", **flags)
        self.assertEqual(current["bound_request"]["calculation_context"]["mass_target_min_kg"], "0.97")
        self.assertEqual(proposed["bound_request"]["calculation_context"]["mass_target_min_kg"], "0.98")
        self.assertEqual(case["calculation_context"]["mass_target_min_kg"], ".97")

    def test_missing_canonical_targets_can_be_filled_only_as_reviewed_proposals(self):
        case = request(); case["calculation_context"].update(mass_target_min_kg="", mass_target_max_kg="")
        case["calculation_context"].pop("balance")
        draft = read_engineering_note(case, client=Client())
        self.assertEqual(draft["target_resolution"]["coordinate_basis"]["origin"], "proposed_source")
        self.assertFalse(prepare_engineering_draft(case, draft)["ready"])
        prepared = prepare_engineering_draft(case, draft, review_confirmed=True, independent_adjustments=True)
        self.assertTrue(prepared["ready"])
        self.assertEqual(prepared["bound_request"]["calculation_context"]["balance"]["coordinate_basis"], BASIS)
        self.assertNotIn("balance", case["calculation_context"])

    def test_missing_new_centre_uncertainty_is_not_inherited_or_set_to_zero(self):
        data = fields(); data["cg_uncertainty_mm"] = None
        draft = normalize_engineering_fields(request(), data)
        self.assertEqual(draft["missing_fields"], ["cg_uncertainty_mm"])
        prepared = prepare_engineering_draft(request(), draft, review_confirmed=True, independent_adjustments=True)
        self.assertFalse(prepared["ready"])
        self.assertEqual(prepared["missing_fields"], ["cg_uncertainty_mm"])
        self.assertIn("centre-of-mass", prepared["questions"][0])
        self.assertNotIn("bound_request", prepared)

    def test_invalid_current_target_is_reported_without_proposed_fallback(self):
        case = request(); case["calculation_context"]["mass_target_min_kg"] = "NaN"
        draft = normalize_engineering_fields(case, fields())
        self.assertEqual(draft["invalid_current_fields"], ["mass_target_min_kg"])
        prepared = prepare_engineering_draft(case, draft, review_confirmed=True, independent_adjustments=True, target_choice="proposed")
        self.assertFalse(prepared["ready"])
        self.assertTrue(prepared["validation_errors"])
        self.assertNotIn("bound_request", prepared)

    def test_syntactic_grounding_rejects_made_up_quotes_wrong_sources_and_units(self):
        for key, update in (("cg_x_mm", {"quote": "Assembly centre 10 mm"}),
                            ("mass_kg", {"source": "brief.targets"}),
                            ("mass_kg", {"unit": "cm"}),
                            ("mass_kg", {"unit": []}),
                            ("position_a_id", {"text": "invented-left"}),
                            ("mass_target_min_kg", {"number_text": "1020"}),
                            ("mass_target_max_kg", {"number_text": "980"})):
            data = fields(); data[key].update(update)
            with self.subTest(key=key, update=update), self.assertRaises(MetaValidationError):
                normalize_engineering_fields(request(), data)

    def test_clipped_range_cannot_become_a_single_measured_mass(self):
        case = request(NOTE.replace("Complete assembly mass 950 g", "Complete assembly mass 940 g to 950 g"))
        data = fields(); data["mass_kg"]["quote"] = "950 g"
        with self.assertRaises(MetaValidationError): normalize_engineering_fields(case, data)

    def test_suffix_unit_intervals_can_have_clipped_invalid_or_mixed_endpoints(self):
        data = fields(); data["mass_target_min_kg"]["quote"] = "980–1020 g"
        self.assertEqual(normalize_engineering_fields(request(), data)["values"]["mass_target_min_kg"], .98)
        data["mass_target_min_kg"]["quote"] = "980"
        with self.assertRaises(MetaValidationError): normalize_engineering_fields(request(), data)
        case = request(); case["brief"]["targets"] = "Mass 980 g to 1.02 kg; balance -2 to 2 mm."
        data = fields();data["mass_target_min_kg"] = quantity("980", "g", "Mass 980 g to 1.02 kg", "brief.targets")
        data["mass_target_max_kg"] = quantity("1.02", "kg", "Mass 980 g to 1.02 kg", "brief.targets")
        self.assertEqual(normalize_engineering_fields(case, data)["values"]["mass_target_max_kg"], 1.02)

    def test_signed_unicode_coordinate_and_written_units_convert_exactly(self):
        case = request(NOTE.replace("A trim mass centre -6 cm", "A trim mass centre −6 centimetres"))
        data = fields();data["position_a_x_mm"] = quantity("−6", "cm", "A trim mass centre −6 centimetres")
        self.assertEqual(normalize_engineering_fields(case, data)["values"]["position_a_x_mm"], -60)

    def test_provenance_cannot_be_faked_by_clipping_negation_or_conditional(self):
        for prefix in ("Not ", "If this were a "):
            case = request(prefix + NOTE)
            with self.subTest(prefix=prefix), self.assertRaises(MetaValidationError):
                normalize_engineering_fields(case, fields())

    def test_synthetic_scope_can_explicitly_say_it_is_not_a_physical_test(self):
        case = request(NOTE.replace("Synthetic observation ref intake-1.", "Synthetic observation ref intake-1, not a physical test."))
        self.assertEqual(normalize_engineering_fields(case, fields())["values"]["observation_kind"], "simulated")
        for sentence in ("Not a synthetic observation ref intake-1, not a physical test.",
                         "Reported as synthetic observation ref intake-1?", "If this is a synthetic observation ref intake-1, not a physical test."):
            altered = request(NOTE.replace("Synthetic observation ref intake-1.", sentence))
            data = fields();data["observation_kind"]["quote"] = sentence
            with self.subTest(sentence=sentence), self.assertRaises(MetaValidationError):
                normalize_engineering_fields(altered, data)

    def test_between_and_target_interval_uses_its_two_stated_endpoints(self):
        case = request();case["brief"]["targets"] = "Mass 980–1020 g; centre of mass x between -2 and 2 mm."
        data = fields()
        for field in ("balance_target_min_mm", "balance_target_max_mm"):
            data[field]["quote"] = "centre of mass x between -2 and 2 mm"
        draft = normalize_engineering_fields(case, data)
        self.assertEqual(draft["values"]["balance_target_min_mm"], -2)
        self.assertEqual(draft["values"]["balance_target_max_mm"], 2)

    def test_new_product_or_note_invalidates_draft_fingerprint(self):
        case = request(); draft = normalize_engineering_fields(case, fields())
        for changed in ("note", "product"):
            altered = deepcopy(case)
            if changed == "note": altered["note"] += " Corrected observation."
            else: altered["brief"]["product"] = "Another product"
            with self.subTest(changed=changed), self.assertRaises(ProductInputError):
                prepare_engineering_draft(altered, draft, review_confirmed=True, independent_adjustments=True)

    def test_mutated_normalized_fields_or_source_data_cannot_bypass_recheck(self):
        draft = normalize_engineering_fields(request(), fields())
        for key in ("values", "fields", "source_fields", "target_resolution", "draft_fingerprint"):
            altered = deepcopy(draft)
            if key == "values": altered[key]["mass_kg"] = 1
            elif key == "fields": altered[key]["mass_kg"]["normalized_value"] = 1
            elif key == "source_fields": altered[key]["mass_kg"]["number_text"] = "1"
            elif key == "target_resolution": altered[key]["mass_target_min_kg"]["selected"] = .5
            else: altered[key] = "changed"
            with self.subTest(key=key), self.assertRaises(ProductInputError):
                prepare_engineering_draft(request(), altered, review_confirmed=True, independent_adjustments=True)

    def test_compiler_reports_incompatible_final_stock_or_geometry_without_a_calculation(self):
        values = normalize_engineering_fields(request(), fields())["values"]
        for updates in ({"position_a_id": "right"}, {"total_max_remove_kg": 2}, {"command_resolution_kg": 0}, {"mass_kg": 0}):
            changed = {**values, **updates}
            with self.subTest(updates=updates):
                prepared = prepare_engineering_values(request(), changed, review_confirmed=True, independent_adjustments=True)
                self.assertFalse(prepared["ready"])
                self.assertTrue(prepared["validation_errors"])
                self.assertNotIn("bound_request", prepared)

    def test_ordinary_values_reject_nonfinite_boolean_unknown_and_string_numbers(self):
        values = normalize_engineering_fields(request(), fields())["values"]
        for bad in (math.nan, math.inf, True, "0.95", -1):
            with self.subTest(bad=bad), self.assertRaises(ProductInputError):
                prepare_engineering_values(request(), {**values, "mass_kg": bad})
        with self.assertRaises(ProductInputError): prepare_engineering_values(request(), {**values, "density": 7})

    def test_provider_failures_and_model_schema_violations_remain_visible(self):
        with self.assertRaises(MetaAPIError): read_engineering_note(request(), client=Client(error=MetaAPIError("unavailable")))
        for data in ({}, {**fields(), "independent_adjustments": True}, {**fields(), "observation_id": "intake-1"}):
            with self.subTest(data_type=type(data)), self.assertRaises(MetaValidationError):
                read_engineering_note(request(), client=Client(response=data))

    def test_empty_note_and_extra_request_fields_are_typed_input_errors(self):
        for case in (request(""), request("x" * 6001), {**request(), "new_product": "other"}):
            with self.assertRaises(ProductInputError): validate_engineering_request(case)


if __name__ == "__main__": unittest.main()
