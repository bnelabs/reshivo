from copy import deepcopy
import importlib.util
import itertools
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from rematter.adaptation import adjust_from_measurement, adjust_observed_mass, plan_adaptation, validate_plan
from rematter.products import ProductInputError
from rematter.server import build_server
from rematter.service import WorkbenchService


def adaptation_request():
    return {
        "case": {
            "label": "Synthetic processed-mix fixture, not a measured waste",
            "components": [
                {"name": "Synthetic main material", "role": "main", "amount": 95, "unit": "mass_percent"},
                {"name": "Synthetic binder", "role": "binder", "amount": 5, "unit": "mass_percent"},
            ],
            "amount_basis": "Synthetic dry-mass recipe",
            "process": "Synthetic prepared material for a numerical software check",
            "density_method": "Synthetic external-volume observations, not physical tests",
            "density_volume_basis": "external_volume", "calculation_volume_basis": "external_volume",
            "volume_basis_details": "External specimen volume includes internal pores",
        },
        "data_kind": "synthetic",
        "observations": [
            {"id": "D1", "value_g_cm3": 2, "reading_kind": "unknown", "batch_id": None,
             "run_id": None, "specimen_id": None, "repeat_of": None},
            {"id": "D2", "value_g_cm3": 4, "reading_kind": "unknown", "batch_id": None,
             "run_id": None, "specimen_id": None, "repeat_of": None},
        ],
        "tare_mass_kg": 1, "tare_uncertainty_kg": 0,
        "target_min_kg": 9.9, "target_max_kg": 10.1,
        "max_fill_volume_cm3": 5000, "baseline_fill_volume_cm3": 3000,
        "density_uncertainty_g_cm3": 0, "volume_tolerance_cm3": 0,
    }


def feedback_request():
    request = adaptation_request()
    result = plan_adaptation(request)
    return {
        "plan": request, "plan_fingerprint": result["plan_fingerprint"],
        "observation": {"id": "Weigh-1", "kind": "simulated", "mass_kg": 9.7, "uncertainty_kg": .02},
        "max_add_mass_kg": .5, "max_remove_mass_kg": 0, "adjustment_uncertainty_kg": .01,
    }


def observed_mass_request():
    return {
        "brief": {"input": "Unidentified material retained in a sealed unit", "variation": "Unknown",
                  "contamination": "Unknown", "product": "Stationary enclosed base",
                  "use_case": "Use existing sealed units without opening", "targets": "9.9 to 10.1 kg",
                  "process": "", "available_changes": "Exchange suitable sealed units and reweigh"},
        "calculation_context": {"label": "", "amount_basis": "", "amount_unit": "mass_percent",
                                "components": [{"id": 1, "name": "", "role": "main", "amount": ""}],
                                "mass_target_min_kg": "9.9", "mass_target_max_kg": "10.1"},
        "feedback": {"observation": {"id": "Weigh-1", "kind": "simulated", "mass_kg": 9.7, "uncertainty_kg": .02},
                     "max_add_mass_kg": .5, "max_remove_mass_kg": 0, "adjustment_uncertainty_kg": .01},
    }


class AdaptationTests(unittest.TestCase):
    def test_fixed_volume_fails_while_observation_specific_volume_fits(self):
        request = adaptation_request()
        original = deepcopy(request)
        result = plan_adaptation(request)
        self.assertEqual(request, original)
        self.assertEqual(result["result_kind"], "simulation")
        self.assertFalse(result["fixed_volume"]["feasible"])
        self.assertIsNone(result["fixed_volume"]["chosen_volume_cm3"])
        self.assertEqual(result["baseline_observations_inside_target"], 0)
        self.assertEqual([row["baseline"]["simulated_mass_min_kg"] for row in result["observations"]], [7, 13])
        self.assertEqual(result["adjustable_observations_feasible"], 2)
        self.assertEqual([row["adjustable"]["chosen_volume_cm3"] for row in result["observations"]], [4500, 2250])
        self.assertEqual([row["adjustable"]["simulated_mass_min_kg"] for row in result["observations"]], [10, 10])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])
        self.assertFalse(result["future_batches_predicted"])
        self.assertNotIn("batch_count", result)

    def test_common_volume_covers_all_entered_observations(self):
        request = adaptation_request()
        request["observations"][1]["value_g_cm3"] = 2.01
        result = plan_adaptation(request)
        fixed = result["fixed_volume"]
        self.assertTrue(fixed["feasible"])
        self.assertGreaterEqual(fixed["simulated_mass_min_kg"], 9.9)
        self.assertLessEqual(fixed["simulated_mass_max_kg"], 10.1)
        for observation in request["observations"]:
            mass = request["tare_mass_kg"] + observation["value_g_cm3"] * fixed["chosen_volume_cm3"] / 1000
            self.assertGreaterEqual(mass, request["target_min_kg"])
            self.assertLessEqual(mass, request["target_max_kg"])

    def test_capacity_failure_leads_to_redesign_options(self):
        request = adaptation_request()
        request["observations"][0]["value_g_cm3"] = 1.5
        result = plan_adaptation(request)
        self.assertEqual(result["adjustable_observations_feasible"], 1)
        self.assertFalse(result["observations"][0]["adjustable"]["feasible"])
        self.assertIsNone(result["observations"][0]["adjustable"]["volume_min_cm3"])
        self.assertIn("larger usable fill volume", " ".join(result["next_options"]))
        self.assertNotIn("discard", " ".join(result["next_options"]).lower())

    def test_capacity_only_diagnostic_gives_a_recomputable_minimum(self):
        request = adaptation_request()
        request["observations"] = [request["observations"][0]]
        request.update(tare_mass_kg=0, target_min_kg=.98, target_max_kg=1.02,
                       max_fill_volume_cm3=300, baseline_fill_volume_cm3=300)
        row = plan_adaptation(request)["observations"][0]
        self.assertFalse(row["adjustable"]["feasible"])
        self.assertEqual(row["diagnostics"]["reason_code"], "capacity_too_small")
        self.assertTrue(row["diagnostics"]["capacity_can_resolve"])
        self.assertEqual(row["diagnostics"]["minimum_usable_capacity_cm3"], 490)
        request["max_fill_volume_cm3"] = row["diagnostics"]["minimum_usable_capacity_cm3"]
        repaired = plan_adaptation(request)["observations"][0]
        self.assertTrue(repaired["adjustable"]["feasible"])
        self.assertEqual(repaired["adjustable"]["simulated_mass_min_kg"], .98)
        self.assertIsNone(repaired["diagnostics"]["minimum_usable_capacity_cm3"])

    def test_minimum_capacity_includes_volume_error_and_rounds_up(self):
        request = adaptation_request()
        request["observations"] = [request["observations"][0]]
        request["observations"][0]["value_g_cm3"] = 3
        request.update(tare_mass_kg=0, target_min_kg=.98, target_max_kg=1.02,
                       max_fill_volume_cm3=300, baseline_fill_volume_cm3=300,
                       volume_tolerance_cm3=2, density_uncertainty_g_cm3=.01)
        diagnostics = plan_adaptation(request)["observations"][0]["diagnostics"]
        self.assertTrue(diagnostics["capacity_can_resolve"])
        capacity = diagnostics["minimum_usable_capacity_cm3"]
        self.assertGreaterEqual(capacity, 4 + 980 / 2.99)
        request["max_fill_volume_cm3"] = capacity
        row = plan_adaptation(request)["observations"][0]["adjustable"]
        self.assertTrue(row["feasible"])
        for density_sign, volume_sign in itertools.product((-1, 1), repeat=2):
            volume = row["chosen_volume_cm3"] + volume_sign * 2
            mass = (3 + density_sign * .01) * volume / 1000
            self.assertGreaterEqual(volume, 0)
            self.assertLessEqual(volume, capacity + 1e-12)
            self.assertGreaterEqual(mass, .98 - 1e-12)
            self.assertLessEqual(mass, 1.02 + 1e-12)

    def test_capacity_is_not_suggested_for_incompatible_uncertainty_or_tare(self):
        for changes, reason in (({"density_uncertainty_g_cm3": .5, "tare_mass_kg": 0}, "mass_bounds_incompatible"),
                                ({"tare_mass_kg": 2}, "tare_above_target")):
            request = adaptation_request()
            request["observations"] = [request["observations"][0]]
            request.update(target_min_kg=.98, target_max_kg=1.02,
                           max_fill_volume_cm3=300, baseline_fill_volume_cm3=300, **changes)
            result = plan_adaptation(request)
            diagnostics = result["observations"][0]["diagnostics"]
            self.assertEqual(diagnostics["reason_code"], reason)
            self.assertFalse(diagnostics["capacity_can_resolve"])
            self.assertIsNone(diagnostics["minimum_usable_capacity_cm3"])
            self.assertNotIn("consider a larger usable fill volume", " ".join(result["next_options"]))

    def test_capacity_outside_numeric_model_limit_is_flagged_not_recommended(self):
        request = adaptation_request()
        request["observations"] = [request["observations"][0]]
        request["observations"][0]["value_g_cm3"] = .000001
        request.update(tare_mass_kg=0, target_min_kg=.98, target_max_kg=1.02,
                       max_fill_volume_cm3=300, baseline_fill_volume_cm3=300)
        result = plan_adaptation(request)
        diagnostics = result["observations"][0]["diagnostics"]
        self.assertEqual(diagnostics["reason_code"], "capacity_exceeds_model_limit")
        self.assertTrue(diagnostics["capacity_requirement_exceeds_supported_limit"])
        self.assertFalse(diagnostics["capacity_can_resolve"])
        self.assertIsNone(diagnostics["minimum_usable_capacity_cm3"])
        self.assertIn("do not enter an unsupported capacity", " ".join(result["next_options"]))

    def test_uncertainty_corners_fit_selected_volume_and_capacity(self):
        request = adaptation_request()
        request.update(tare_uncertainty_kg=.02, density_uncertainty_g_cm3=.005, volume_tolerance_cm3=2)
        result = plan_adaptation(request)
        for row in result["observations"]:
            self.assertTrue(row["adjustable"]["feasible"])
            command = row["adjustable"]["chosen_volume_cm3"]
            for tare_sign, density_sign, volume_sign in itertools.product((-1, 1), repeat=3):
                tare = request["tare_mass_kg"] + tare_sign * request["tare_uncertainty_kg"]
                density = row["observation"]["value_g_cm3"] + density_sign * request["density_uncertainty_g_cm3"]
                volume = command + volume_sign * request["volume_tolerance_cm3"]
                self.assertGreaterEqual(volume, 0)
                self.assertLessEqual(volume, request["max_fill_volume_cm3"])
                mass = tare + density * volume / 1000
                self.assertGreaterEqual(mass, request["target_min_kg"])
                self.assertLessEqual(mass, request["target_max_kg"])

    def test_large_density_or_volume_error_can_prevent_adjustable_fit(self):
        for changes in ({"density_uncertainty_g_cm3": .1}, {"volume_tolerance_cm3": 100}):
            request = adaptation_request()
            request.update(changes)
            result = plan_adaptation(request)
            self.assertLess(result["adjustable_observations_feasible"], result["observation_count"])

    def test_no_fill_has_no_volume_error_and_reports_reuse_boundary(self):
        request = adaptation_request()
        request.update(tare_mass_kg=10, tare_uncertainty_kg=.02,
                       max_fill_volume_cm3=1, baseline_fill_volume_cm3=0, volume_tolerance_cm3=100)
        result = plan_adaptation(request)
        self.assertTrue(result["fixed_volume"]["feasible"])
        self.assertEqual(result["fixed_volume"]["chosen_volume_cm3"], 0)
        self.assertEqual(result["fixed_volume"]["simulated_mass_min_kg"], 9.98)
        self.assertEqual(result["fixed_volume"]["simulated_mass_max_kg"], 10.02)
        self.assertEqual(result["baseline_observations_inside_target"], 2)
        self.assertIn("separate material-reuse objective", result["recommendation"])
        self.assertEqual(result["observations"][0]["diagnostics"]["reason_code"], "no_fill_needed")
        self.assertIsNone(result["observations"][0]["diagnostics"]["minimum_usable_capacity_cm3"])

    def test_empty_baseline_does_not_create_negative_fill_mass(self):
        request = adaptation_request()
        request.update(baseline_fill_volume_cm3=0, volume_tolerance_cm3=100)
        result = plan_adaptation(request)
        self.assertEqual([row["baseline"]["simulated_mass_min_kg"] for row in result["observations"]], [1, 1])
        self.assertEqual(result["baseline_observations_inside_target"], 0)

    def test_nonempty_baseline_with_insufficient_volume_margin_is_not_calculated(self):
        request = adaptation_request()
        request.update(baseline_fill_volume_cm3=4999, volume_tolerance_cm3=2)
        result = plan_adaptation(request)
        self.assertFalse(result["observations"][0]["baseline"]["volume_within_capacity"])
        self.assertIsNone(result["observations"][0]["baseline"]["simulated_mass_min_kg"])

    def test_repeated_readings_retain_grouping_without_narrowing_uncertainty(self):
        request = adaptation_request()
        request["observations"] = [request["observations"][0]]
        request["observations"][0].update(reading_kind="specimen", batch_id="A", run_id="Run1", specimen_id="S1")
        request["density_uncertainty_g_cm3"] = .01
        original = plan_adaptation(request)
        request["observations"].append({**request["observations"][0], "id": "D-repeat", "reading_kind": "repeat", "repeat_of": "D1"})
        repeated = plan_adaptation(request)
        self.assertEqual(original["fixed_volume"], repeated["fixed_volume"])
        self.assertEqual(repeated["observations"][1]["observation"]["reading_kind"], "repeat")
        self.assertEqual(repeated["observations"][1]["observation"]["batch_id"], "A")
        self.assertNotIn("identified_batch_count", repeated)

    def test_source_replay_requires_explicit_scoped_source(self):
        request = adaptation_request()
        request["data_kind"] = "source_replay"
        with self.assertRaises(ProductInputError):
            plan_adaptation(request)
        request["source"] = {"title": "Fixture source", "url": "https://example.org/data", "scope": "Synthetic source-metadata test, not measured values"}
        with self.assertRaises(ProductInputError):
            plan_adaptation(request)
        request["source"]["license"] = "Fixture licence, not a real source grant"
        result = plan_adaptation(request)
        self.assertEqual(result["source"], request["source"])
        self.assertFalse(result["source_independently_verified"])
        self.assertIn("does not fetch or independently verify", " ".join(result["assumptions"]))
        for value in ("", " ", "x" * 301, None):
            invalid = deepcopy(request)
            invalid["source"]["license"] = value
            with self.subTest(license=value), self.assertRaises(ProductInputError):
                plan_adaptation(invalid)
        request["data_kind"] = "synthetic"
        with self.assertRaises(ProductInputError):
            plan_adaptation(request)

    def test_invalid_sources_and_density_volume_bases_are_rejected(self):
        for url in ("file:///tmp/data", "https://user:password@example.org/data", "https://[invalid"):
            request = adaptation_request()
            request.update(data_kind="source_replay", source={"title": "Source", "url": url, "scope": "Scope", "license": "Fixture licence"})
            with self.subTest(url=url), self.assertRaises(ProductInputError):
                plan_adaptation(request)
        for basis in ("solid_volume", "other"):
            request = adaptation_request()
            request["case"].update(density_volume_basis=basis, calculation_volume_basis=basis, volume_basis_details="Stated same basis")
            with self.subTest(basis=basis), self.assertRaises(ProductInputError):
                plan_adaptation(request)

    def test_invalid_values_have_no_plan(self):
        cases = [None, [], {}, {**adaptation_request(), "density_of_metal": 7.8}]
        for field in ("tare_mass_kg", "tare_uncertainty_kg", "target_min_kg", "target_max_kg",
                      "max_fill_volume_cm3", "baseline_fill_volume_cm3", "density_uncertainty_g_cm3", "volume_tolerance_cm3"):
            for value in (True, float("nan"), float("inf"), -1, 10 ** 1000, "1"):
                cases.append({**adaptation_request(), field: value})
        cases.extend([{**adaptation_request(), "target_min_kg": 11},
                      {**adaptation_request(), "tare_uncertainty_kg": 2},
                      {**adaptation_request(), "baseline_fill_volume_cm3": 6000},
                      {**adaptation_request(), "density_uncertainty_g_cm3": 2},
                      {**adaptation_request(), "data_kind": []},
                      {**adaptation_request(), "observations": []}])
        request = adaptation_request()
        request["observations"][0]["value_g_cm3"] = 1e-20
        cases.append(request)
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                plan_adaptation(request)

    def test_fingerprints_bind_case_and_all_plan_inputs(self):
        request = adaptation_request()
        first = plan_adaptation(request)
        request["target_max_kg"] = 10.2
        second = plan_adaptation(request)
        self.assertEqual(first["case_fingerprint"], second["case_fingerprint"])
        self.assertNotEqual(first["plan_fingerprint"], second["plan_fingerprint"])
        request["case"]["process"] = "Another stated process"
        third = plan_adaptation(request)
        self.assertNotEqual(second["case_fingerprint"], third["case_fingerprint"])
        json.dumps(third, allow_nan=False)
        self.assertEqual(validate_plan(third["request"]), third["request"])

    def test_benchmark_counts_every_predefined_case_and_checks_claimed_commands(self):
        path = Path(__file__).resolve().parents[1] / "scripts/benchmark_adaptation.py"
        spec = importlib.util.spec_from_file_location("adaptation_benchmark_fixture", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.benchmark()
        cases = [case for family in report["families"] for case in family["cases"]]
        self.assertEqual(report["summary"]["volume_case_count"], len(module.FAMILIES) * len(module.DENSITIES))
        self.assertEqual(report["summary"]["volume_case_count"], len(cases))
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(report["summary"]["adaptive_cases_feasible"] + report["summary"]["adaptive_infeasible_cases"], len(cases))
        self.assertEqual(report["summary"]["feasibility_disagreements_with_independent_reference"], 0)
        self.assertEqual(report["summary"]["adaptive_claimed_feasible_but_forward_check_failed"], 0)
        self.assertEqual(report["summary"]["mass_feedback_case_count"], len(report["mass_feedback_cases"]))
        self.assertEqual(report["model_calls"], 0)
        self.assertEqual(report["data_kind"], "synthetic")
        self.assertFalse(report["physical_product_tested"])
        self.assertFalse(report["future_batches_predicted"])


class MassFeedbackTests(unittest.TestCase):
    def test_addition_respects_observation_and_adjustment_bounds(self):
        request = feedback_request()
        original = deepcopy(request)
        result = adjust_from_measurement(request)
        self.assertEqual(request, original)
        self.assertEqual(result["action"], "add")
        self.assertAlmostEqual(result["signed_adjustment_min_kg"], .23)
        self.assertAlmostEqual(result["signed_adjustment_max_kg"], .37)
        self.assertAlmostEqual(result["chosen_signed_adjustment_kg"], .3)
        self.assertAlmostEqual(result["simulated_mass_min_kg_after_adjustment"], 9.97)
        self.assertAlmostEqual(result["simulated_mass_max_kg_after_adjustment"], 10.03)
        self.assertTrue(result["mass_only"])
        self.assertEqual(result["observation"]["kind"], "simulated")
        self.assertFalse(result["physical_product_tested"])
        self.assertIn("Not checked", result["volume_status"])

    def test_removal_uses_negative_signed_command(self):
        request = feedback_request()
        request["observation"]["mass_kg"] = 10.3
        request.update(max_add_mass_kg=0, max_remove_mass_kg=.5)
        result = adjust_from_measurement(request)
        self.assertEqual(result["action"], "remove")
        self.assertAlmostEqual(result["chosen_signed_adjustment_kg"], -.3)
        self.assertAlmostEqual(result["simulated_mass_min_kg_after_adjustment"], 9.97)
        self.assertAlmostEqual(result["simulated_mass_max_kg_after_adjustment"], 10.03)

    def test_no_operation_does_not_incur_adjustment_uncertainty(self):
        request = feedback_request()
        request["observation"].update(mass_kg=10, uncertainty_kg=.05)
        request.update(max_add_mass_kg=0, max_remove_mass_kg=0, adjustment_uncertainty_kg=100)
        result = adjust_from_measurement(request)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["action"], "none")
        self.assertEqual(result["chosen_signed_adjustment_kg"], 0)
        self.assertEqual(result["simulated_mass_min_kg_after_adjustment"], 9.95)
        self.assertEqual(result["simulated_mass_max_kg_after_adjustment"], 10.05)

    def test_actual_available_mass_reserves_adjustment_uncertainty(self):
        request = feedback_request()
        request["max_add_mass_kg"] = .3
        result = adjust_from_measurement(request)
        self.assertAlmostEqual(result["signed_adjustment_max_kg"], .29)
        self.assertLessEqual(result["chosen_signed_adjustment_kg"] + request["adjustment_uncertainty_kg"], request["max_add_mass_kg"])
        request["max_add_mass_kg"] = .23
        self.assertFalse(adjust_from_measurement(request)["feasible"])

    def test_uncertainty_or_adjustment_limit_can_prevent_target_fit(self):
        for changes in ({"max_add_mass_kg": .2}, {"adjustment_uncertainty_kg": .2}):
            request = feedback_request()
            request.update(changes)
            result = adjust_from_measurement(request)
            self.assertFalse(result["feasible"])
            self.assertIsNone(result["chosen_signed_adjustment_kg"])
            self.assertIsNone(result["simulated_mass_min_kg_after_adjustment"])
            self.assertEqual(result["action"], "unresolved")
        request = feedback_request()
        request["observation"].update(mass_kg=10, uncertainty_kg=.2)
        self.assertFalse(adjust_from_measurement(request)["feasible"])

    def test_stale_case_target_or_observation_set_rejects_old_fingerprint(self):
        for change in ("case", "target", "observations"):
            request = feedback_request()
            if change == "case":
                request["plan"]["case"]["process"] = "Changed process"
            elif change == "target":
                request["plan"]["target_min_kg"] = 9.8
            else:
                request["plan"]["observations"][0]["value_g_cm3"] = 2.1
            with self.subTest(change=change), self.assertRaises(ProductInputError):
                adjust_from_measurement(request)

    def test_invalid_feedback_does_not_generate_a_correction(self):
        cases = [None, {}, {**feedback_request(), "density": 1}, {**feedback_request(), "plan_fingerprint": "bad"}]
        for key in ("max_add_mass_kg", "max_remove_mass_kg", "adjustment_uncertainty_kg"):
            for value in (True, "1", float("nan"), -1, 10 ** 1000):
                cases.append({**feedback_request(), key: value})
        for changes in ({"id": ""}, {"kind": "physical_test_verified"}, {"kind": []}, {"mass_kg": True}, {"uncertainty_kg": 10}, {"mass_kg": -1}):
            request = feedback_request()
            request["observation"].update(changes)
            cases.append(request)
        request = feedback_request()
        request["max_remove_mass_kg"] = 9.7
        cases.append(request)
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                adjust_from_measurement(request)


class ObservedMassTests(unittest.TestCase):
    def test_blank_recipe_and_density_are_not_needed_for_a_weighed_mass_correction(self):
        request = observed_mass_request()
        original = deepcopy(request)
        with patch("rematter.adaptation.validate_plan", side_effect=AssertionError("No density plan needed")), \
             patch("rematter.meta.MetaClient", side_effect=AssertionError("No provider needed")):
            result = adjust_observed_mass(request)
        self.assertEqual(request, original)
        self.assertEqual(result["input_mode"], "observed_mass_only")
        self.assertIsNone(result["plan_fingerprint"])
        self.assertIsNone(result["density_data_kind"])
        self.assertEqual(result["action"], "add")
        self.assertAlmostEqual(result["chosen_signed_adjustment_kg"], .3)
        self.assertAlmostEqual(result["simulated_mass_min_kg_after_adjustment"], 9.97)
        self.assertAlmostEqual(result["simulated_mass_max_kg_after_adjustment"], 10.03)
        self.assertEqual(result["brief"], request["brief"])
        self.assertEqual(result["calculation_context"], request["calculation_context"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])
        self.assertIn("Not checked", result["volume_status"])

    def test_same_math_covers_add_remove_none_and_infeasible_with_uncertainty(self):
        for mass, add, remove, expected in ((9.7, .5, 0, "add"), (10.3, 0, .5, "remove"),
                                             (10, 0, 0, "none"), (9.7, .1, 0, "unresolved")):
            request = observed_mass_request()
            request["feedback"]["observation"]["mass_kg"] = mass
            request["feedback"].update(max_add_mass_kg=add, max_remove_mass_kg=remove)
            with self.subTest(action=expected):
                result = adjust_observed_mass(request)
                self.assertEqual(result["action"], expected)
                if expected == "unresolved":
                    self.assertFalse(result["feasible"])
                    self.assertIsNone(result["chosen_signed_adjustment_kg"])
                    continue
                command = result["chosen_signed_adjustment_kg"]
                observation_error = request["feedback"]["observation"]["uncertainty_kg"]
                adjustment_error = request["feedback"]["adjustment_uncertainty_kg"] if command else 0
                for observation_sign, adjustment_sign in itertools.product((-1, 1), repeat=2):
                    corrected = mass + observation_sign * observation_error + command + adjustment_sign * adjustment_error
                    self.assertGreaterEqual(corrected, 9.9)
                    self.assertLessEqual(corrected, 10.1)
                if command:
                    self.assertGreaterEqual(command - adjustment_error, -remove)
                    self.assertLessEqual(command + adjustment_error, add)

    def test_fingerprint_rejects_changed_brief_details_target_observation_or_limits(self):
        original = observed_mass_request()
        original["request_fingerprint"] = adjust_observed_mass(original)["request_fingerprint"]
        self.assertEqual(adjust_observed_mass(original)["request_fingerprint"], original["request_fingerprint"])
        mutations = [lambda r: r["brief"].update(product="Different product"),
                     lambda r: r["brief"].update(process="Changed process"),
                     lambda r: r["calculation_context"].update(label="Another case"),
                     lambda r: r["calculation_context"]["components"][0].update(name="Named material"),
                     lambda r: r["calculation_context"].update(mass_target_max_kg="10.2"),
                     lambda r: r["feedback"]["observation"].update(id="Another observation"),
                     lambda r: r["feedback"]["observation"].update(mass_kg=9.8),
                     lambda r: r["feedback"].update(max_add_mass_kg=.4)]
        for mutate in mutations:
            request = deepcopy(original)
            mutate(request)
            with self.subTest(request=request):
                with self.assertRaises(ProductInputError): adjust_observed_mass(request)
                request.pop("request_fingerprint")
                self.assertNotEqual(adjust_observed_mass(request)["request_fingerprint"], original["request_fingerprint"])

    def test_missing_invalid_or_unsupported_inputs_never_get_a_correction(self):
        requests = [None, {}, {**observed_mass_request(), "density": 4},
                    {**observed_mass_request(), "feedback": None},
                    {**observed_mass_request(), "target_max_kg": 20},
                    {**observed_mass_request(), "request_fingerprint": "stale"}]
        for value in ("", "NaN", "Infinity", "-1", "1000001"):
            request = observed_mass_request()
            request["calculation_context"]["mass_target_min_kg"] = value
            requests.append(request)
        request = observed_mass_request()
        request["calculation_context"].update(mass_target_min_kg="11", mass_target_max_kg="10")
        requests.append(request)
        for changes in ({"id": ""}, {"kind": "verified"}, {"mass_kg": -1}, {"uncertainty_kg": 10}):
            request = observed_mass_request()
            request["feedback"]["observation"].update(changes)
            requests.append(request)
        for key in ("max_add_mass_kg", "max_remove_mass_kg", "adjustment_uncertainty_kg"):
            request = observed_mass_request()
            request["feedback"].pop(key)
            requests.append(request)
        request = observed_mass_request()
        request["feedback"]["max_remove_mass_kg"] = 9.7
        requests.append(request)
        for request in requests:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                adjust_observed_mass(request)


class AdaptationAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name))
        cls.server = build_server(port=0, service=cls.service, web_root=Path(cls.temp.name) / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, path, body, headers=None):
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def test_plan_and_feedback_execute_without_models_or_source_datasets(self):
        with patch.object(self.service, "_materials", side_effect=AssertionError("No study needed")), \
             patch("rematter.meta.MetaClient.generate", side_effect=AssertionError("No model request needed")):
            status, result = self.call("/api/adaptation/plan", adaptation_request())
            self.assertEqual(status, 200)
            self.assertEqual(result["result_kind"], "simulation")
            self.assertFalse(result["fixed_volume"]["feasible"])
            self.assertEqual(result["adjustable_observations_feasible"], 2)
            request = feedback_request()
            request["plan_fingerprint"] = result["plan_fingerprint"]
            status, feedback = self.call("/api/adaptation/feedback", request)
            self.assertEqual(status, 200)
            self.assertEqual(feedback["action"], "add")
            self.assertEqual(feedback["observation"]["kind"], "simulated")
            self.assertFalse(feedback["physical_product_tested"])

    def test_invalid_and_stale_inputs_return_400_without_results(self):
        for path, request in (("/api/adaptation/plan", {**adaptation_request(), "density_of_metal": 8}),
                              ("/api/adaptation/feedback", {**feedback_request(), "plan_fingerprint": "old"})):
            status, result = self.call(path, request)
            self.assertEqual(status, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")
            self.assertNotIn("result_kind", result)
            self.assertNotIn("chosen_signed_adjustment_kg", result)

    def test_both_routes_keep_origin_host_size_and_work_slot_guards(self):
        for path, request in (("/api/adaptation/plan", adaptation_request()),
                              ("/api/adaptation/feedback", feedback_request()),
                              ("/api/adaptation/observed-mass", observed_mass_request())):
            for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
                with self.subTest(path=path, headers=headers):
                    self.assertEqual(self.call(path, request, headers)[0], 403)
            self.assertEqual(self.call(path, {"oversized": "x" * 65536})[0], 413)
            self.assertTrue(self.server.work_slots.acquire(blocking=False))
            self.assertTrue(self.server.work_slots.acquire(blocking=False))
            try:
                status, result = self.call(path, request)
                self.assertEqual(status, 429)
                self.assertEqual(result["error"]["code"], "service_busy")
            finally:
                self.server.work_slots.release()
                self.server.work_slots.release()
            self.assertEqual(self.call(path, request)[0], 200)

    def test_direct_observed_mass_route_has_no_density_or_dataset_dependency(self):
        with patch.object(self.service, "_materials", side_effect=AssertionError("No study needed")), \
             patch("rematter.adaptation.validate_plan", side_effect=AssertionError("No density needed")), \
             patch("rematter.meta.MetaClient", side_effect=AssertionError("No provider needed")):
            status, result = self.call("/api/adaptation/observed-mass", observed_mass_request())
        self.assertEqual(status, 200)
        self.assertEqual(result["action"], "add")
        self.assertEqual(result["input_mode"], "observed_mass_only")
        request = observed_mass_request()
        request["request_fingerprint"] = result["request_fingerprint"]
        request["feedback"]["observation"]["mass_kg"] = 9.8
        status, result = self.call("/api/adaptation/observed-mass", request)
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
