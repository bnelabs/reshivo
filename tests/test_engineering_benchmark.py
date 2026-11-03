from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from reshivo.meta import Generation, MetaAPIError, MetaConfigurationError, ToolTurn


SPEC = importlib.util.spec_from_file_location("benchmark_engineering", Path(__file__).resolve().parents[1] / "scripts/benchmark_engineering.py")
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class FakeClient:
    model = "configured-test-model"
    key = "private-benchmark-test-credential"

    def __init__(self, **kwargs):
        self.turns = 0
        self.limits = []
        self.initial_context = None

    def generate(self, prompt, schema, max_candidates, **kwargs):
        self.limits.append(kwargs["max_completion_tokens"])
        self.initial_context = json.loads(prompt)["case_context"]
        decision = benchmark.blank_decision("keep_fixed", "Synthetic proposal")
        decision["fixed_volume_cm3"] = 500
        return Generation(decision, self.model, True, {"completion_tokens": 20, "prompt_tokens": 30}, "P1")

    def tool_turn(self, messages, tools, **kwargs):
        self.turns += 1
        self.limits.append(kwargs["max_completion_tokens"])
        if self.initial_context is None:
            self.initial_context = json.loads(messages[1]["content"])
        name = "compare_current_design" if self.turns == 1 else "present_recommendation"
        arguments = {} if self.turns == 1 else {"answer": "Synthetic proposal", "action": "keep_fixed", "basis_call_id": "C1"}
        message = {"role": "assistant", "content": None, "tool_calls": [
            {"id": f"C{self.turns}", "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}
        return ToolTurn(message, self.model, True, {"completion_tokens": 10, "prompt_tokens": 25}, f"R{self.turns}")


class EngineeringBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.cases = {case["id"]: case["request"] for case in benchmark.cases()}

    def test_locked_cases_and_independent_reference_do_not_call_production_solvers(self):
        expected = ["keep_fixed", "adjust_volume", "increase_capacity", "request_changes", "request_changes",
                    "add_mass", "remove_mass", "request_changes", "keep_mass"]
        self.assertEqual(list(self.cases), list(benchmark.CASE_IDS))
        with patch.object(benchmark, "plan_adaptation", side_effect=AssertionError("Reference called production solver")), \
                patch.object(benchmark, "adjust_from_measurement", side_effect=AssertionError("Reference called feedback solver")):
            references = [benchmark.independent_reference(request) for request in self.cases.values()]
        self.assertEqual([reference["action"] for reference in references], expected)
        self.assertAlmostEqual(references[2]["minimum_capacity_cm3"], 490)
        self.assertAlmostEqual(references[5]["midpoint_adjustment_kg"], .05)
        self.assertAlmostEqual(references[6]["midpoint_adjustment_kg"], -.05)
        self.assertAlmostEqual(references[5]["signed_adjustment_interval_kg"][0], .04)
        self.assertAlmostEqual(references[5]["signed_adjustment_interval_kg"][1], .06)

    def test_offline_default_never_creates_provider_and_checks_all_nine(self):
        report = benchmark.benchmark(client_factory=lambda **kwargs: self.fail("Offline created provider"))
        self.assertEqual(report["summary"]["tools"]["engineering_correct"], 9)
        self.assertEqual(report["summary"]["tools"]["model_calls_attempted"], 0)
        self.assertEqual(report["summary"]["tools"]["computation_calls"], 10)
        self.assertFalse(report["live_requested"])
        self.assertFalse(report["complete_nine_case_matched_run"])
        self.assertFalse(report["user_steps_measured"])

    def test_wrong_action_is_wrong_even_when_prose_proposes_correct_capacity(self):
        decision = benchmark.blank_decision("request_changes", "A larger capacity of 490 cm3 would work")
        score = benchmark.grade(self.cases["capacity_repair"], decision)
        self.assertFalse(score["action_correct"])
        self.assertFalse(score["engineering_correct"])

    def test_feasible_numeric_answers_need_not_equal_midpoint(self):
        decision = benchmark.blank_decision("add_mass")
        decision["adjustment_kg"] = .04
        self.assertTrue(benchmark.grade(self.cases["feedback_add"], decision)["engineering_correct"])
        decision["adjustment_kg"] = .039
        self.assertFalse(benchmark.grade(self.cases["feedback_add"], decision)["numeric_correct"])

    def test_actual_correction_limit_and_sign_are_checked(self):
        decision = benchmark.blank_decision("add_mass")
        decision["adjustment_kg"] = .05
        self.assertFalse(benchmark.grade(self.cases["feedback_limited"], decision)["engineering_correct"])
        decision["adjustment_kg"] = -.05
        self.assertFalse(benchmark.grade(self.cases["feedback_add"], decision)["numeric_correct"])

    def test_keep_mass_no_operation_does_not_incur_correction_error(self):
        request = deepcopy(self.cases["feedback_keep"])
        request["feedback"]["adjustment_uncertainty_kg"] = .1
        decision = benchmark.blank_decision("keep_mass")
        decision["adjustment_kg"] = 0
        self.assertTrue(benchmark.grade(request, decision)["engineering_correct"])

    def test_capacity_must_be_minimum_and_volumes_must_cover_each_density(self):
        request = self.cases["capacity_repair"]
        decision = benchmark.extract_decision(benchmark.tools_only(request))
        self.assertTrue(benchmark.grade(request, decision)["engineering_correct"])
        decision["proposed_capacity_cm3"] = 491
        self.assertFalse(benchmark.grade(request, decision)["numeric_correct"])
        decision["proposed_capacity_cm3"] = 490
        decision["volumes_cm3"][1]["density_g_cm3"] = 2
        self.assertFalse(benchmark.grade(request, decision)["numeric_correct"])

    def test_grader_rejects_boolean_nonfinite_unknown_fields_and_unfinished_answer(self):
        good = benchmark.blank_decision("keep_fixed")
        good["fixed_volume_cm3"] = 500
        for field, value in [("fixed_volume_cm3", True), ("fixed_volume_cm3", float("nan")),
                             ("fixed_volume_cm3", 10 ** 1000), ("action", []), ("action", {}),
                             ("invented", 1), ("final", False)]:
            with self.subTest(field=field, value=value):
                bad = {**good, field: value}
                self.assertFalse(benchmark.grade(self.cases["fixed_feasible"], bad)["engineering_correct"])

    def test_real_runner_path_and_plain_use_same_budget_and_initial_context(self):
        clients = []

        def factory(**kwargs):
            client = FakeClient()
            clients.append(client)
            return client

        report = benchmark.benchmark("all", ["fixed_feasible"], factory)
        self.assertFalse(report["complete_nine_case_matched_run"])
        self.assertEqual(len(clients), 2)
        self.assertEqual(clients[0].initial_context, clients[1].initial_context)
        self.assertEqual(clients[0].initial_context, report["records"][0]["model_initial_context"])
        self.assertTrue(all(limit == 4096 for client in clients for limit in client.limits))
        self.assertEqual(report["configured_models"], [FakeClient.model])
        for arm in report["records"][0]["arms"]:
            self.assertTrue(arm["grade"]["engineering_correct"], arm)
            if arm["arm"] != "tools":
                self.assertTrue(arm["provider_available"])
        workflow = next(arm for arm in report["records"][0]["arms"] if arm["arm"] == "workflow")
        self.assertEqual(workflow["computation_calls"], 1)
        self.assertEqual(workflow["model_calls_attempted"], 2)
        self.assertEqual(workflow["usage"]["completion_tokens"], 20)
        self.assertFalse(workflow["result"]["answer_verified"])

    def test_provider_failure_is_separate_from_availability_conditioned_denominator(self):
        class Unavailable(FakeClient):
            def generate(self, *args, **kwargs):
                raise MetaAPIError("Unavailable")

            def tool_turn(self, *args, **kwargs):
                raise MetaAPIError("Unavailable")

        report = benchmark.benchmark("all", ["fixed_feasible"], Unavailable)
        for name in ("plain", "workflow"):
            summary = report["summary"][name]
            self.assertEqual(summary["cases_attempted"], 1)
            self.assertEqual(summary["engineering_correct"], 0)
            self.assertEqual(summary["availability_conditioned_denominator"], 0)
            self.assertIsNone(summary["availability_conditioned_correct_rate"])
        self.assertEqual(report["summary"]["tools"]["engineering_correct"], 1)

    def test_unconfigured_error_is_captured_without_saving_exception_text(self):
        class Unconfigured(FakeClient):
            def generate(self, *args, **kwargs):
                raise MetaConfigurationError(self.key)

        report = benchmark.benchmark("plain", ["fixed_feasible"], Unconfigured)
        self.assertNotIn(FakeClient.key, json.dumps(report))
        self.assertEqual(report["records"][0]["arms"][0]["status"], "not_configured")

    def test_malformed_provider_json_is_recorded_without_aborting_other_cases(self):
        class Malformed(FakeClient):
            def generate(self, *args, **kwargs):
                raise ValueError(self.key)

        report = benchmark.benchmark("plain", ["fixed_feasible", "capacity_repair"], Malformed)
        self.assertEqual(report["summary"]["plain"]["cases_attempted"], 2)
        self.assertTrue(all(record["arms"][0]["status"] == "unusable_response" for record in report["records"]))
        self.assertNotIn(FakeClient.key, json.dumps(report))

    def test_progress_checkpoints_are_incomplete_until_final_report(self):
        checkpoints = []

        def progress(report, case_id, arm):
            checkpoints.append((report["execution_complete"], len(report["records"]), case_id, arm["arm"]))

        report = benchmark.benchmark("tools", ["fixed_feasible", "capacity_repair"], on_progress=progress)
        self.assertEqual(checkpoints, [(False, 1, "fixed_feasible", "tools"), (False, 2, "capacity_repair", "tools")])
        self.assertTrue(report["execution_complete"])

    def test_secret_returned_in_plain_prose_is_redacted(self):
        class EchoSecret(FakeClient):
            def generate(self, *args, **kwargs):
                response = super().generate(*args, **kwargs)
                response.data["answer"] = self.key
                return response

        report = benchmark.benchmark("plain", ["fixed_feasible"], EchoSecret)
        self.assertNotIn(FakeClient.key, json.dumps(report))
        self.assertIn("[REDACTED]", report["records"][0]["arms"][0]["result"]["decision"]["answer"])

    def test_model_call_limit_and_token_cap_are_enforced(self):
        meter = benchmark.MeteredClient(FakeClient())
        for _ in range(4):
            meter.generate('{"case_context": {}}', {}, 1, max_completion_tokens=8192)
        with self.assertRaises(benchmark.BudgetExceeded):
            meter.generate('{"case_context": {}}', {}, 1)
        self.assertEqual(meter.client.limits, [4096] * 4)

    def test_remaining_wall_budget_caps_http_timeout(self):
        class Opener:
            def open(self, request, timeout):
                return timeout

        meter = benchmark.MeteredClient(FakeClient())
        meter.started = 100
        opener = benchmark.DeadlineOpener(Opener(), meter)
        with patch.object(benchmark.time, "monotonic", return_value=305):
            self.assertEqual(opener.open("request", timeout=50), 5)
        with patch.object(benchmark.time, "monotonic", return_value=311):
            with self.assertRaises(benchmark.BudgetExceeded):
                opener.open("request")

    def test_diagnostic_case_selection_is_explicit_and_invalid_ids_are_rejected(self):
        for selected in (["missing"], ["fixed_feasible", "fixed_feasible"], []):
            with self.assertRaises(ValueError):
                benchmark.benchmark("tools", selected)
        report = benchmark.benchmark("tools", ["capacity_repair"])
        self.assertEqual(report["selected_case_ids"], ["capacity_repair"])
        self.assertFalse(report["complete_nine_case_matched_run"])


if __name__ == "__main__":
    unittest.main()
