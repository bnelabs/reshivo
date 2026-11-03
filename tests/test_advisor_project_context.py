"""Current full-configuration evidence reaches advice without crossing record boundaries."""
from copy import deepcopy
import json
import unittest

from reshivo.advisor import (
    FOLLOWUP_PROMPT, MANUFACTURING_COST_PROMPT, PROJECT_CONTEXT_PROMPT, SYSTEM_PROMPT,
    follow_up_with_case, help_with_case, validate_request,
)
from reshivo.meta import Generation, MetaAPIError, MetaValidationError
from reshivo.products import ProductInputError


def context():
    def setup(identifier, revision, third=False):
        return {"id": identifier, "revision": revision, "name": "Setup " + identifier,
                "materials": [{"id": "A", "name": "stock A", "amount": "20", "unit": "mass_percent"},
                              {"id": "B", "name": "stock B", "amount": "30" if third else "80", "unit": "mass_percent"}]
                + ([{"id": "C", "name": "stock C", "amount": "50", "unit": "mass_percent"}] if third else []),
                "process": "Recorded process P" + str(revision), "geometry": "Recorded mounting G1", "notes": "Synthetic fixture only"}

    def row(identity, config, revision, check, value, kind="synthetic"):
        unit, method = ("%", "REC-1") if check == "recovery" else ("dB", "INS-1")
        return {"id": identity, "case_id": "case-sound", "configuration_id": config,
                "configuration_revision": revision, "check_id": check, "unit": unit,
                "method": method, "data_kind": kind, "conditions_confirmed": True,
                "readings": [{"value": value, "reading_id": identity + "-reading", "batch_id": None}]}

    return {"case_id": "case-sound", "assessment_kind": "synthetic",
            "configurations": [setup("AB", 1), setup("ABC", 1, True), setup("AB", 2)],
            "checks": [{"id": "recovery", "name": "Recovery", "unit": "%", "method": "REC-1", "minimum": "80", "maximum": None, "required": True},
                       {"id": "sound", "name": "Installed sound check", "unit": "dB", "method": "INS-1", "minimum": "10", "maximum": None, "required": True}],
            "records": [row("old-AB", "AB", 1, "recovery", "111.123456789"),
                        row("AB-recovery", "AB", 2, "recovery", "85"), row("AB-sound", "AB", 2, "sound", "8"),
                        row("ABC-recovery", "ABC", 1, "recovery", "75"), row("ABC-sound", "ABC", 1, "sound", "12"),
                        row("other-kind", "ABC", 1, "sound", "777.987654321", "user_reported")]}


def request():
    return {"brief": {"input": "Named stocks A, B and C", "variation": "B/C and process can change",
                      "contamination": "Not characterized", "product": "Sound sheet",
                      "use_case": "Recorded mounting G1", "targets": "Recovery and installed sound check both matter",
                      "process": "Compare recorded setups", "available_changes": "Next recorded setup"},
            "question": "What should I compare next, using the setups and both checks I already entered?",
            "history": [], "project_context": context()}


def cost_requests():
    captured = context()["configurations"]
    result = []
    for identity, revision, count in (("AB", 2, "1"), ("ABC", 1, "2")):
        setup = next(row for row in captured if row["id"] == identity and row["revision"] == revision)
        result.append({"case_id": "case-sound", "configuration_id": identity,
                       "configuration_revision": str(revision), "current_configuration_revision": str(revision),
                       "currency": "CU", "product_basis": "sound sheet", "functional_basis": "one same-sized sound sheet",
                       "scope_basis": "charged materials only; processing explicitly excluded", "mass_basis": "dry",
                       "batch_mass": {"quantity": "1", "unit": "kg", "basis": "dry"},
                       "materials": [{"id": material["id"], "name": material["name"], "quantity": material["amount"],
                                      "quantity_unit": material["unit"], "unit_price": str(index + 1), "price_unit": "kg"}
                                     for index, material in enumerate(setup["materials"])],
                       "process": {name: {"status": "excluded"} for name in ("energy", "labor", "other")},
                       "output": {"mode": "actual", "acceptance_basis": "entered appearance screen only", "usable_count": count}})
    return result


def response(followup=False):
    result = {"answer": "Keep both checks visible. The entered setups trade recovery against the sound check; neither completes both entered targets.",
              "next_steps": ["Review the recorded process difference.", "Plan one controlled comparison and repeat both checks."],
              "questions": ["Can the next comparison keep the mounting and process fixed?"], "source_ids": []}
    if not followup:
        def route(identity):
            return {"id": identity, "title": "Controlled comparison", "change": "Vary one identified factor.",
                    "why": "The current setups change several things.", "steps": ["Retain the full setup and both checks."],
                    "tradeoffs": ["No isolated cause is established yet."], "check": "Repeat both checks under matching conditions."}
        result.update(material_routes=[route("M1"), route("M2")], engineering_routes=[route("E1"), route("E2")])
    return result


class FixtureClient:
    def __init__(self, followup=False, failure=None):
        self.followup = followup
        self.failure = failure
        self.calls = []

    def generate(self, prompt, schema, candidates, **options):
        self.calls.append((json.loads(prompt), schema, candidates, options))
        if self.failure:
            raise self.failure
        return Generation(response(self.followup), "fixture-model", False, {}, "fixture-project-context", 2)


def config(result, identity):
    return next(row for row in result["configurations"] if row["id"] == identity)


class AdvisorProjectContextTests(unittest.TestCase):
    def test_help_receives_current_full_setups_and_both_independent_checks(self):
        data = request()
        before = deepcopy(data)
        client = FixtureClient()
        result = help_with_case(data, client=client)
        prompt, _, _, options = client.calls[0]
        self.assertEqual(data, before)
        self.assertEqual(result["project_context"], data["project_context"], "raw capture remains available only for response binding")
        self.assertEqual([(row["id"], row["revision"]) for row in prompt["project_context"]["configurations"]], [("ABC", 1), ("AB", 2)])
        self.assertEqual(prompt["project_context"]["checks"], data["project_context"]["checks"])
        abc = next(row for row in prompt["project_context"]["configurations"] if row["id"] == "ABC")
        self.assertEqual([row["id"] for row in abc["materials"]], ["A", "B", "C"])
        summary = prompt["project_assessment"]
        self.assertEqual(config(summary, "AB")["revision"], 2)
        self.assertEqual(config(summary, "AB")["state"], "out_of_range")
        self.assertEqual(config(summary, "ABC")["state"], "out_of_range")
        self.assertEqual([row["state"] for row in config(summary, "AB")["checks"]], ["entered_readings_in_range", "out_of_range"])
        self.assertEqual([row["state"] for row in config(summary, "ABC")["checks"]], ["out_of_range", "entered_readings_in_range"])
        self.assertFalse(summary["performance_verified"])
        self.assertFalse(summary["physical_product_tested"])
        self.assertNotIn("configuration_versions", summary)
        self.assertTrue(options["system_prompt"].startswith(SYSTEM_PROMPT))
        self.assertTrue(options["system_prompt"].endswith(PROJECT_CONTEXT_PROMPT))

    def test_old_and_other_kind_numbers_never_reach_either_model_prompt(self):
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(request(), client=client)
            prompt = client.calls[0][0]
            encoded = json.dumps(prompt)
            with self.subTest(function=function.__name__):
                self.assertNotIn("111.123456789", encoded)
                self.assertNotIn("777.987654321", encoded)
                self.assertEqual(len(prompt["project_context"]["records"]), 4)
                self.assertEqual({row["data_kind"] for row in prompt["project_context"]["records"]}, {"synthetic"})
                self.assertEqual({row["reason"] for row in prompt["project_assessment"]["ignored_records"]}, {"stale_configuration_revision", "other_data_kind"})
                self.assertIn("111.123456789", json.dumps(result["project_context"]))
                self.assertFalse(result["physical_product_tested"])
                if followup:
                    self.assertNotIn("material_routes", result)
                    self.assertTrue(client.calls[0][3]["system_prompt"].startswith(FOLLOWUP_PROMPT))

    def test_source_selection_is_explicit_and_never_pools_synthetic_with_reported(self):
        data = request()
        data["project_context"]["assessment_kind"] = "user_reported"
        client = FixtureClient()
        help_with_case(data, client=client)
        prompt = client.calls[0][0]
        self.assertEqual([row["id"] for row in prompt["project_context"]["records"]], ["other-kind"])
        self.assertEqual(config(prompt["project_assessment"], "AB")["state"], "missing_records")
        abc_checks = config(prompt["project_assessment"], "ABC")["checks"]
        self.assertEqual(abc_checks[0]["state"], "missing_records")
        self.assertEqual(abc_checks[1]["source_kind"], "user_reported")
        self.assertEqual(abc_checks[1]["reading_count"], 1)
        self.assertNotIn('"85"', json.dumps(prompt))

    def test_missing_amounts_checks_and_unconfirmed_conditions_remain_constructive_unknowns(self):
        data = request()
        data["project_context"]["configurations"][2]["materials"][1]["amount"] = None
        data["project_context"]["records"][1]["conditions_confirmed"] = False
        data["project_context"]["records"] = data["project_context"]["records"][:2]
        result = help_with_case(data, client=FixtureClient())
        summary = result["project_assessment"]
        ab = config(summary, "AB")
        self.assertFalse(ab["component_amounts_complete"])
        self.assertFalse(ab["can_prepare_quantities"])
        self.assertEqual(ab["checks"][0]["state"], "needs_review")
        self.assertEqual(ab["checks"][0]["reading_count"], 0)
        self.assertEqual(ab["checks"][1]["state"], "missing_records")
        self.assertTrue(summary["questions"])
        self.assertTrue(result["next_steps"])
        self.assertIsNone(result["project_context"]["configurations"][2]["materials"][1]["amount"])
        data["project_context"].update(configurations=[], checks=[], records=[])
        self.assertTrue(validate_request(data)["project_assessment"]["questions"])

    def test_invalid_bindings_and_hidden_results_fail_before_generation_even_when_ignored(self):
        def mutate(path, value):
            def change(data):
                at = data["project_context"]
                for key in path[:-1]:
                    at = at[key]
                at[path[-1]] = value
            return change
        changes = [
            mutate(["assessment_kind"], None), mutate(["records", 0, "case_id"], "foreign"),
            mutate(["records", 0, "configuration_revision"], 99), mutate(["records", 0, "check_id"], "missing"),
            mutate(["records", 0, "unit"], "other"), mutate(["records", 0, "method"], "other"),
            mutate(["records", 0, "conditions_confirmed"], "true"),
            mutate(["records", 5, "readings", 0, "value"], "NaN"),
            mutate(["records", 0, "performance_verified"], True), mutate(["passed"], True),
            mutate(["configurations", 0, "revision"], True),
        ]
        for change in changes:
            data = request()
            change(data)
            client = FixtureClient()
            with self.subTest(data=str(data)[-120:]), self.assertRaises(ProductInputError):
                help_with_case(data, client=client)
            self.assertEqual(client.calls, [])
        data = request()
        data["project_context"]["configurations"].append(deepcopy(data["project_context"]["configurations"][0]))
        with self.assertRaises(ProductInputError):
            validate_request(data)

    def test_exact_decimal_text_and_unknown_identifiers_survive_without_conversion(self):
        data = request()
        exact = "26.000000000000000005"
        data["project_context"]["records"][2]["readings"][0]["value"] = exact
        client = FixtureClient()
        help_with_case(data, client=client)
        prompt = client.calls[0][0]
        row = next(row for row in prompt["project_context"]["records"] if row["id"] == "AB-sound")
        self.assertEqual(row["readings"][0]["value"], exact)
        self.assertIsNone(row["readings"][0]["batch_id"])
        self.assertNotIn("specimen_id", row["readings"][0])
        self.assertEqual(config(prompt["project_assessment"], "AB")["checks"][1]["maximum_entered"], exact)

    def test_larger_valid_context_is_supported_but_total_request_stays_bounded(self):
        data = request()
        data["project_context"]["records"] = []
        base = data["project_context"]["configurations"][0]
        data["project_context"]["configurations"] = [{**deepcopy(base), "id": f"setup-{index}", "process": "p" * 2000, "geometry": "g" * 2000} for index in range(20)]
        self.assertGreater(len(json.dumps(data).encode()), 65536)
        self.assertEqual(len(validate_request(data)["project_assessment"]["configurations"]), 20)
        data["project_context"]["configurations"][0]["notes"] = "x" * (512 * 1024)
        with self.assertRaisesRegex(ProductInputError, "512 KiB"):
            validate_request(data)

    def test_absent_context_preserves_the_original_request_prompt_and_response_shape(self):
        data = request()
        del data["project_context"]
        normalized = validate_request(data)
        self.assertEqual(set(normalized), {"brief", "question", "history"})
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(data, client=client)
            self.assertNotIn("project_context", client.calls[0][0])
            self.assertNotIn("project_assessment", result)
            self.assertEqual(client.calls[0][3]["system_prompt"], FOLLOWUP_PROMPT if followup else SYSTEM_PROMPT)

    def test_transport_failure_never_becomes_advice_or_a_fake_assessment_result(self):
        for error in (MetaAPIError("Unavailable"), MetaValidationError("Truncated")):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)) as caught:
                help_with_case(request(), client=FixtureClient(failure=error))
            self.assertIs(caught.exception, error)

    def test_saved_costs_are_reused_as_scoped_economics_without_physical_qualification(self):
        data = {**request(), "manufacturing_costs": cost_requests()}
        before = deepcopy(data)
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(data, client=client)
            prompt = client.calls[0][0]
            summary = prompt["manufacturing_cost_assessment"]
            with self.subTest(function=function.__name__):
                self.assertEqual(data, before)
                self.assertEqual(result["manufacturing_costs"], data["manufacturing_costs"])
                self.assertNotIn("manufacturing_costs", prompt, "the model uses deterministic summaries, not unvalidated price arithmetic")
                self.assertTrue(summary["comparable"])
                self.assertNotIn("winners", summary, "cost-only winners cannot be mistaken for target-qualified decisions")
                self.assertEqual(result["manufacturing_cost_assessment"]["winners"]["per_usable_unit"]["configuration_ids"], ["ABC"])
                self.assertIsNone(prompt["decision_assessment"]["decisions"]["per_usable_unit"])
                self.assertEqual(summary["results"][0]["costs"]["entered_scope_total"], "1.8")
                self.assertEqual(summary["results"][1]["costs"]["entered_scope_total"], "2.3")
                self.assertEqual(summary["results"][1]["unit_costs"]["per_usable_unit"], "1.15")
                self.assertEqual(summary["results"][1]["unit_costs_scope"], "entered_scope_total")
                self.assertEqual(summary["physical_target_status"], "not_assessed")
                self.assertTrue(all(row["physical_target_status"] == "not_assessed" for row in summary["results"]))
                self.assertEqual(config(prompt["project_assessment"], "ABC")["state"], "out_of_range", "cheapest entered-scope output does not pass the missing physical check")
                self.assertIn(MANUFACTURING_COST_PROMPT, client.calls[0][3]["system_prompt"])

    def test_missing_prices_and_invalid_numeric_drafts_stay_explicit_without_a_winner(self):
        for price, expected in (("", "partial"), ("not known yet", "needs_clarification")):
            data = {**request(), "manufacturing_costs": cost_requests()}
            data["manufacturing_costs"][1]["materials"][2]["unit_price"] = price
            client = FixtureClient()
            help_with_case(data, client=client)
            summary = client.calls[0][0]["manufacturing_cost_assessment"]
            abc = summary["results"][1]
            with self.subTest(price=price):
                self.assertEqual(abc["status"], expected)
                self.assertFalse(summary["comparable"])
                self.assertNotIn("winners", summary)
                self.assertIsNone(client.calls[0][0]["decision_assessment"]["decisions"]["per_usable_unit"])
                self.assertIsNone(abc["costs"]["entered_scope_total"])
                self.assertTrue(abc["questions"] or abc["errors"])
                if price == "":
                    self.assertEqual(abc["costs"]["known_subtotal"], "0.8")
                    self.assertEqual(abc["unit_costs"]["per_usable_unit"], "0.4")
                    self.assertEqual(abc["unit_costs_scope"], "known_subtotal")
                else:
                    self.assertIsNone(abc["costs"]["known_subtotal"])

    def test_cost_scope_currency_and_output_mode_conflicts_prevent_ranking(self):
        for change in (lambda cost: cost.update(currency="other currency"),
                       lambda cost: cost.update(functional_basis="a different-sized product"),
                       lambda cost: cost.update(output={"mode": "planned", "acceptance_basis": "entered appearance screen only", "gross_count": "2", "accepted_fraction": "1"})):
            data = {**request(), "manufacturing_costs": cost_requests()}
            change(data["manufacturing_costs"][1])
            summary = validate_request(data)["manufacturing_cost_assessment"]
            self.assertFalse(summary["comparable"])
            self.assertTrue(summary["reasons"])
            self.assertTrue(all(value is None for value in summary["winners"].values()))

    def test_foreign_stale_changed_recipe_and_secret_cost_fields_fail_before_generation(self):
        def set_value(path, value):
            def change(costs):
                at = costs
                for key in path[:-1]:
                    at = at[key]
                at[path[-1]] = value
            return change
        changes = [
            set_value([0, "case_id"], "foreign"), set_value([0, "configuration_id"], "not-captured"),
            set_value([0, "configuration_revision"], "1"), set_value([0, "current_configuration_revision"], "1"),
            set_value([0, "configuration_revision"], True), set_value([0, "configuration_revision"], "2.0"),
            set_value([0, "api_key"], "not-a-key"), set_value([0, "materials", 0, "api_key"], "not-a-key"),
            set_value([0, "materials", 0, "quantity"], "21"), set_value([0, "materials", 0, "quantity_unit"], "kg"),
            set_value([0, "materials", 0, "id"], "unlisted"), set_value([0, "materials", 0, "name"], "changed stock"),
            set_value([0, "process", "energy", "token"], "not-a-key"),
            set_value([0, "process", "other"], {"status": "known", "charges": [{"name": "charge", "amount": "1", "secret": "no"}]}),
            set_value([0, "output", "physical_targets_passed"], True),
            lambda costs: costs.append(deepcopy(costs[0])), lambda costs: costs[0]["materials"].pop(),
        ]
        for change in changes:
            data = {**request(), "manufacturing_costs": cost_requests()}
            change(data["manufacturing_costs"])
            client = FixtureClient()
            with self.subTest(cost=str(data["manufacturing_costs"])[-100:]), self.assertRaises(ProductInputError):
                help_with_case(data, client=client)
            self.assertEqual(client.calls, [])
        for costs in ({}, [cost_requests()[0]] * 101):
            with self.assertRaises(ProductInputError):
                validate_request({**request(), "manufacturing_costs": costs})
        data = request()
        del data["project_context"]
        with self.assertRaisesRegex(ProductInputError, "project context"):
            validate_request({**data, "manufacturing_costs": cost_requests()})

    def test_single_or_empty_cost_capture_does_not_invent_a_comparison(self):
        for costs in ([], cost_requests()[:1]):
            result = validate_request({**request(), "manufacturing_costs": costs})
            self.assertEqual(len(result["manufacturing_cost_assessment"]["results"]), len(costs))
            self.assertFalse(result["manufacturing_cost_assessment"]["comparable"])
            self.assertEqual(result["manufacturing_cost_assessment"]["winners"], {})
            self.assertEqual(result["manufacturing_costs"], costs)
        data = request()
        client = FixtureClient()
        result = help_with_case(data, client=client)
        self.assertNotIn("manufacturing_costs", result)
        self.assertNotIn("manufacturing_cost_assessment", result)
        self.assertNotIn("manufacturing_cost_assessment", client.calls[0][0])
        self.assertTrue(client.calls[0][3]["system_prompt"].endswith(PROJECT_CONTEXT_PROMPT))


if __name__ == "__main__":
    unittest.main()
