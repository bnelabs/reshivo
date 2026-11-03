from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

from reshivo.adaptation import plan_adaptation
from reshivo.engineering_agent import (
    MAX_COMPUTATION_CALLS, MAX_MODEL_TURNS, MAX_MODEL_TRACE_BYTES, MAX_SUMMARY_BYTES,
    assist_with_adaptation, validate_assist_request,
)
from reshivo.meta import MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError
from reshivo.products import ProductInputError
from reshivo.server import build_server
from reshivo.service import WorkbenchService


def assist_request():
    process = "Synthetic contained fill, no physical processing or test"
    return {
        "brief": {
            "input": "Synthetic prepared mixture", "variation": "Entered density scenarios differ",
            "contamination": "Identity remains to be checked", "product": "Contained counterweight",
            "use_case": "A stationary retained assembly", "targets": "9.9 to 10.1 kg; retain fill",
            "process": process, "available_changes": "Can change enclosure capacity and sealed units",
        },
        "calculation_context": {
            "label": "Synthetic shared case", "amount_basis": "Synthetic dry-mass recipe",
            "components": [{"id": 1, "name": "Synthetic main", "role": "main", "amount": "95"},
                           {"id": 2, "name": "Synthetic binder", "role": "binder", "amount": "5"}],
            "amount_unit": "mass_percent", "mass_target_min_kg": "9.9", "mass_target_max_kg": "10.1",
        },
        "question": "What can change while keeping this recipe and target?",
        "plan": {
            "case": {"label": "Synthetic shared case", "amount_basis": "Synthetic dry-mass recipe",
                     "components": [{"name": "Synthetic main", "role": "main", "amount": 95, "unit": "mass_percent"},
                                    {"name": "Synthetic binder", "role": "binder", "amount": 5, "unit": "mass_percent"}],
                     "process": process, "density_method": "Synthetic external-volume scenarios",
                     "density_volume_basis": "external_volume", "calculation_volume_basis": "external_volume",
                     "volume_basis_details": "External volume includes internal pores"},
            "data_kind": "synthetic",
            "observations": [{"id": "D1", "value_g_cm3": 2, "reading_kind": "unknown", "batch_id": None,
                              "run_id": None, "specimen_id": None, "repeat_of": None},
                             {"id": "D2", "value_g_cm3": 4, "reading_kind": "unknown", "batch_id": None,
                              "run_id": None, "specimen_id": None, "repeat_of": None}],
            "tare_mass_kg": 1, "tare_uncertainty_kg": 0,
            "target_min_kg": 9.9, "target_max_kg": 10.1,
            "max_fill_volume_cm3": 5000, "baseline_fill_volume_cm3": 3000,
            "density_uncertainty_g_cm3": 0, "volume_tolerance_cm3": 0,
        },
        "feedback": None,
    }


def feedback():
    return {"observation": {"id": "Assembly-1", "kind": "simulated", "mass_kg": 9.7, "uncertainty_kg": .02},
            "max_add_mass_kg": .5, "max_remove_mass_kg": 0, "adjustment_uncertainty_kg": .01}


def mass_only_request():
    request = assist_request()
    request["plan"] = None
    request["feedback"] = feedback()
    request["calculation_context"].update(label="", amount_basis="",
        components=[{"id": 1, "name": "", "role": "main", "amount": ""}])
    request["brief"]["process"] = ""
    return request


def call(identity, name, arguments=None):
    return {"id": identity, "type": "function", "function": {
        "name": name, "arguments": json.dumps(arguments if arguments is not None else {})}}


def present(identity, basis, action, answer="Use the executed mass result as a proposed next check."):
    return call(identity, "present_recommendation", {"answer": answer, "action": action, "basis_call_id": basis})


def reply(*calls, content=None):
    message = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = list(calls)
    return {"id": "fixture-request", "choices": [{"finish_reason": "tool_calls" if calls else "stop", "message": message}],
            "usage": {"total_tokens": 7}}


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class ScriptedTransport:
    """Offline HTTP replacement; the production client and dispatcher still run."""
    def __init__(self, responses, callback=None):
        self.responses = iter(responses)
        self.requests = []
        self.callback = callback

    def open(self, request, timeout):
        self.requests.append(json.loads(request.data))
        if self.callback:
            self.callback()
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        return Reply(json.dumps(result).encode())


class EngineeringAgentTests(unittest.TestCase):
    def run_script(self, request, *responses, callback=None):
        transport = ScriptedTransport(responses, callback)
        client = MetaClient(environ={"MODEL_API_KEY": "fixture-private-key", "META_MODEL": "muse-spark-1.3"}, opener=transport)
        return assist_with_adaptation(request, client=client), transport

    def test_real_dispatcher_compares_then_rechecks_capacity_and_preserves_proposal(self):
        request = assist_request()
        request["plan"]["observations"][0]["value_g_cm3"] = 1.5
        original = deepcopy(request)
        answer = "A larger usable enclosure is proposed; keep the recipe and target fixed, then check retention separately."
        with patch("reshivo.engineering_agent.plan_adaptation", wraps=plan_adaptation) as executed:
            result, transport = self.run_script(request,
                reply(call("compare", "compare_current_design")),
                reply(call("capacity", "check_capacity_repair")),
                reply(present("answer", "capacity", "increase_capacity", answer)))
        self.assertEqual(request, original)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(executed.call_count, 2)
        self.assertEqual([row["name"] for row in result["tool_trace"]], ["compare_current_design", "check_capacity_repair"])
        before, after = result["tool_trace"]
        self.assertFalse(before["result"]["fixed_volume"]["feasible"])
        self.assertEqual(before["result"]["adjustable_observations_feasible"], 1)
        self.assertTrue(after["result"]["all_observations_fit"])
        self.assertTrue(after["result"]["proposal_not_applied"])
        changed = deepcopy(before["inputs"])
        changed["max_fill_volume_cm3"] = after["result"]["proposed_max_fill_volume_cm3"]
        self.assertEqual(after["inputs"]["plan"], changed)
        self.assertEqual(result["plan_request"], validate_assist_request(request)["plan"])
        self.assertEqual(result["answer"], answer)
        self.assertEqual(result["answer_kind"], "model_proposal")
        self.assertFalse(result["answer_verified"])
        self.assertEqual(result["decision"], {"action": "increase_capacity", "basis_call_id": "capacity"})
        self.assertEqual(result["verified_summary"]["proposed_max_fill_volume_cm3"], changed["max_fill_volume_cm3"])
        self.assertNotIn(answer, json.dumps(result["verified_summary"]))
        sent_result = json.loads(transport.requests[1]["messages"][-1]["content"])
        self.assertEqual(sent_result["diagnostic_counts"]["capacity_too_small"], 1)
        self.assertEqual(sent_result["execution_call_id"], "compare")
        self.assertEqual(sent_result["tool_name"], "compare_current_design")
        capacity_summary = json.loads(transport.requests[2]["messages"][-1]["content"])
        self.assertEqual(capacity_summary["execution_call_id"], "capacity")
        self.assertEqual(capacity_summary["source_call_id"], "compare")
        self.assertEqual(capacity_summary["tool_name"], "check_capacity_repair")
        self.assertEqual(result["model_turns"], 3)
        self.assertEqual(result["usage"], {"total_tokens": 21})
        self.assertEqual([turn["usage"] for turn in result["model_trace"]], [{"total_tokens": 7}] * 3)
        self.assertEqual([turn["turn"] for turn in result["model_trace"]], [1, 2, 3])
        self.assertEqual(result["model_trace"][1]["tool_results"][0]["result"], capacity_summary)
        assistant_call = result["model_trace"][2]["assistant_message"]["tool_calls"][0]
        self.assertEqual(assistant_call["id"], "answer")
        self.assertEqual(json.loads(assistant_call["function"]["arguments"]),
                         {"answer": answer, "action": "increase_capacity", "basis_call_id": "capacity"})
        self.assertEqual(len(result["request_ids"]), 3)
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["performance_verified"])
        self.assertFalse(result["batch_consistency_established"])

    def test_measured_mass_actions_follow_actual_adjustment_bounds(self):
        scenarios = [(9.7, .5, 0, "add_mass"), (10.3, 0, .5, "remove_mass"),
                     (10, 0, 0, "keep_mass"), (9.7, .1, 0, "request_changes")]
        for mass, add, remove, action in scenarios:
            request = assist_request()
            request["feedback"] = feedback()
            request["feedback"].update(max_add_mass_kg=add, max_remove_mass_kg=remove)
            request["feedback"]["observation"].update(mass_kg=mass, kind="user_reported")
            with self.subTest(action=action):
                result, _ = self.run_script(request, reply(call("mass", "check_mass_feedback")),
                                            reply(present("answer", "mass", action)))
                self.assertEqual(result["status"], "completed")
                checked = result["tool_trace"][0]
                self.assertEqual(checked["inputs"]["observation"], request["feedback"]["observation"])
                self.assertEqual(checked["result"]["observation"]["kind"], "user_reported")
                self.assertEqual(result["verified_summary"]["observation_id"], "Assembly-1")
                self.assertEqual(result["decision"]["action"], action)
                self.assertTrue(checked["result"]["mass_only"])
                correction = checked["result"]["chosen_signed_adjustment_kg"]
                if action == "add_mass": self.assertGreater(correction, 0)
                if action == "remove_mass": self.assertLess(correction, 0)
                if action == "keep_mass": self.assertEqual(correction, 0)
                if action == "request_changes": self.assertIsNone(correction)

    def test_mass_only_two_turn_workflow_executes_without_recipe_density_or_dataset(self):
        request = mass_only_request()
        original = deepcopy(request)
        answer = "Use the bounded mass correction with suitable sealed units and reweigh the complete assembly."
        with patch("reshivo.engineering_agent.validate_plan", side_effect=AssertionError("No plan needed")), \
             patch("reshivo.adaptation.validate_plan", side_effect=AssertionError("No density needed")), \
             patch("reshivo.service.WorkbenchService._materials", side_effect=AssertionError("No study needed")):
            result, transport = self.run_script(request, reply(call("mass", "check_mass_feedback")),
                                                reply(present("answer", "mass", "add_mass", answer)))
        self.assertEqual(request, original)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["model_turns"], 2)
        self.assertEqual(result["answer"], answer)
        self.assertFalse(result["answer_verified"])
        self.assertIsNone(result["plan_request"])
        self.assertEqual(len(result["tool_trace"]), 1)
        execution = result["tool_trace"][0]
        self.assertEqual(execution["inputs"], {key: request[key] for key in ("brief", "calculation_context", "feedback")})
        self.assertEqual(execution["result"]["input_mode"], "observed_mass_only")
        self.assertIsNone(execution["result"]["density_data_kind"])
        self.assertAlmostEqual(result["verified_summary"]["chosen_signed_adjustment_kg"], .3)
        self.assertEqual(result["verified_summary"]["observation_id"], "Assembly-1")
        context = json.loads(transport.requests[0]["messages"][1]["content"])
        self.assertIsNone(context["bound_plan"])
        self.assertEqual(context["input_mode"], "observed_mass_only")
        self.assertEqual(context["bound_mass_target"], {"target_min_kg": 9.9, "target_max_kg": 10.1})
        self.assertNotIn("density_min_g_cm3", json.dumps(context))
        sent_summary = json.loads(transport.requests[1]["messages"][-1]["content"])
        self.assertEqual(sent_summary["execution_call_id"], "mass")
        self.assertNotIn("brief", sent_summary)
        self.assertEqual(result["model_trace"][0]["tool_results"][0]["result"], sent_summary)

    def test_mass_only_capacity_tools_need_a_density_plan_and_never_fake_execution(self):
        with patch("reshivo.engineering_agent.plan_adaptation", side_effect=AssertionError("No density plan")):
            result, transport = self.run_script(mass_only_request(),
                reply(call("compare", "compare_current_design"), call("capacity", "check_capacity_repair"),
                      call("mass", "check_mass_feedback")),
                reply(present("answer", "mass", "add_mass")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual([row["id"] for row in result["tool_trace"]], ["mass"])
        tool_results = result["model_trace"][0]["tool_results"]
        for tool in tool_results[:2]:
            self.assertEqual(tool["result"]["status"], "need_density_plan")
            self.assertIsNone(tool["result"]["execution_call_id"])
        self.assertEqual(len(transport.requests), 2)

    def test_mass_only_requires_complete_feedback_and_canonical_valid_shared_targets(self):
        requests = []
        for feedback_value in (None, {}, {"observation": {}}):
            request = mass_only_request()
            request["feedback"] = feedback_value
            requests.append(request)
        for field in ("mass_target_min_kg", "mass_target_max_kg"):
            for value in ("", "NaN", "Infinity", "-1", "1000001"):
                request = mass_only_request()
                request["calculation_context"][field] = value
                requests.append(request)
        request = mass_only_request()
        request["calculation_context"].update(mass_target_min_kg="11", mass_target_max_kg="10")
        requests.append(request)
        request = mass_only_request()
        request["calculation_context"]["density"] = "4"
        requests.append(request)
        client = Mock()
        for request in requests:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                assist_with_adaptation(request, client=client)
        client.tool_turn.assert_not_called()

    def test_mass_only_fingerprint_changes_with_case_target_or_feedback(self):
        fingerprints = []
        for change in ("original", "case", "target", "feedback"):
            request = mass_only_request()
            if change == "case": request["brief"]["use_case"] = "Another stationary configuration"
            if change == "target": request["calculation_context"]["mass_target_max_kg"] = "10.2"
            if change == "feedback": request["feedback"]["observation"]["mass_kg"] = 9.8
            result, _ = self.run_script(request, reply(call("mass", "check_mass_feedback")),
                                        reply(present("answer", "mass", "add_mass")))
            fingerprints.append(result["tool_trace"][0]["result"]["request_fingerprint"])
        self.assertEqual(len(set(fingerprints)), len(fingerprints))

    def test_large_shared_brief_stays_in_local_mass_trace_without_oversized_tool_summary(self):
        request = mass_only_request()
        request["brief"] = {key: "x" * 3000 for key in request["brief"]}
        result, transport = self.run_script(request, reply(call("mass", "check_mass_feedback")),
                                            reply(present("answer", "mass", "add_mass")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["tool_trace"][0]["result"]["brief"], request["brief"])
        self.assertLessEqual(len(transport.requests[1]["messages"][-1]["content"].encode()), MAX_SUMMARY_BYTES)

    def test_valid_fixed_and_adjustable_actions_use_actual_result(self):
        for action in ("adjust_volume", "keep_fixed"):
            request = assist_request()
            if action == "keep_fixed": request["plan"]["observations"][1]["value_g_cm3"] = 2.01
            with self.subTest(action=action):
                result, _ = self.run_script(request, reply(call("compare", "compare_current_design")),
                                            reply(present("answer", "compare", action)))
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["verified_summary"]["action"], action)

    def test_unsupported_action_is_rejected_and_can_be_corrected_next_turn(self):
        result, transport = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
            reply(present("wrong", "compare", "keep_fixed")),
            reply(present("right", "compare", "adjust_volume")))
        self.assertEqual(result["status"], "completed")
        rejected = json.loads(transport.requests[2]["messages"][-1]["content"])
        self.assertEqual(rejected["status"], "rejected")
        self.assertIn("not supported", rejected["reason"])
        self.assertEqual(result["decision"]["action"], "adjust_volume")

    def test_basis_must_be_successful_and_inspected_in_a_previous_turn(self):
        result, transport = self.run_script(assist_request(),
            reply(call("compare", "compare_current_design"), present("too-soon", "compare", "adjust_volume")),
            reply(present("missing", "never-ran", "adjust_volume")),
            reply(present("ready", "compare", "adjust_volume")))
        self.assertEqual(result["status"], "completed")
        for request_index in (1, 2):
            rejected = json.loads(transport.requests[request_index]["messages"][-1]["content"])
            self.assertEqual(rejected["status"], "rejected")
            self.assertIn("previous model turn", rejected["reason"])
        self.assertEqual(len(result["tool_trace"]), 1)

    def test_successful_capacity_repair_supersedes_the_earlier_failed_comparison(self):
        request = assist_request()
        request["plan"]["observations"][0]["value_g_cm3"] = 1.5
        answer = "Propose the checked larger capacity, keeping the recipe and target fixed."
        result, transport = self.run_script(request,
            reply(call("compare", "compare_current_design")),
            reply(call("capacity", "check_capacity_repair")),
            reply(present("stale", "compare", "request_changes", answer)),
            reply(present("current", "capacity", "increase_capacity", answer)))
        rejected = json.loads(transport.requests[3]["messages"][-1]["content"])
        self.assertEqual(rejected["status"], "rejected")
        self.assertIn("stale", rejected["reason"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["decision"], {"action": "increase_capacity", "basis_call_id": "capacity"})
        self.assertTrue(result["verified_summary"]["all_observations_fit"])
        self.assertEqual(result["answer"], answer)
        self.assertEqual(result["model_turns"], 4)
        assistant_call = result["model_trace"][2]["assistant_message"]["tool_calls"][0]
        self.assertEqual(assistant_call["id"], "stale")
        self.assertEqual(json.loads(assistant_call["function"]["arguments"]),
                         {"answer": answer, "action": "request_changes", "basis_call_id": "compare"})
        retained_rejection = result["model_trace"][2]["tool_results"][0]["result"]
        self.assertEqual(retained_rejection, rejected)
        self.assertIsNone(retained_rejection["execution_call_id"])

    def test_new_computation_in_the_presentation_turn_also_makes_the_old_basis_stale(self):
        request = assist_request()
        request["plan"]["observations"][0]["value_g_cm3"] = 1.5
        repair = call("capacity", "check_capacity_repair")
        stale = present("stale", "compare", "request_changes")
        for calls in ((repair, stale), (stale, repair)):
            with self.subTest(order=[row["id"] for row in calls]):
                result, transport = self.run_script(request,
                    reply(call("compare", "compare_current_design")), reply(*calls),
                    reply(present("current", "capacity", "increase_capacity")))
                messages = transport.requests[2]["messages"]
                rejected = next(row for row in messages if row.get("tool_call_id") == "stale")
                self.assertEqual(json.loads(rejected["content"])["status"], "rejected")
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["decision"]["basis_call_id"], "capacity")
                self.assertEqual(result["model_turns"], 3)

    def test_capacity_prerequisite_and_non_capacity_failures_do_not_fabricate_execution(self):
        request = assist_request()
        request["plan"]["tare_mass_kg"] = 11
        result, transport = self.run_script(request,
            reply(call("early", "check_capacity_repair")),
            reply(call("compare", "compare_current_design")),
            reply(call("cannot-fix", "check_capacity_repair")),
            reply(present("answer", "compare", "request_changes")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual([row["id"] for row in result["tool_trace"]], ["compare"])
        self.assertEqual(json.loads(transport.requests[1]["messages"][-1]["content"])["status"], "prerequisite")
        self.assertEqual(json.loads(transport.requests[3]["messages"][-1]["content"])["status"], "not_applicable")

    def test_missing_feedback_becomes_a_question_without_a_made_up_observation(self):
        result, transport = self.run_script(assist_request(),
            reply(call("missing", "check_mass_feedback"), call("compare", "compare_current_design")),
            reply(present("answer", "compare", "request_changes", "What is the complete assembly mass and its uncertainty?")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual([row["id"] for row in result["tool_trace"]], ["compare"])
        messages = transport.requests[1]["messages"]
        missing = next(message for message in messages if message.get("tool_call_id") == "missing")
        self.assertEqual(json.loads(missing["content"])["status"], "need_feedback")
        self.assertIsNone(result["feedback_request"])

    def test_unexplained_request_changes_cannot_replace_a_feasible_plan(self):
        result, transport = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
            reply(present("wrong", "compare", "request_changes")),
            reply(present("right", "compare", "adjust_volume")))
        self.assertEqual(json.loads(transport.requests[2]["messages"][-1]["content"])["status"], "rejected")
        self.assertEqual(result["status"], "completed")

    def test_divergent_shared_cases_fail_before_any_provider_call(self):
        mutations = [
            lambda r: r["calculation_context"].update(label="Other case"),
            lambda r: r["calculation_context"].update(amount_basis="Wet basis"),
            lambda r: r["brief"].update(process="Changed process"),
            lambda r: r["calculation_context"]["components"][0].update(name="Other material"),
            lambda r: r["calculation_context"]["components"][0].update(role="other"),
            lambda r: r["calculation_context"]["components"][0].update(amount="94"),
            lambda r: r["calculation_context"].update(amount_unit="volume_percent"),
            lambda r: r["calculation_context"]["components"].reverse(),
            lambda r: r["calculation_context"].update(mass_target_min_kg="9.8"),
            lambda r: r["calculation_context"].update(mass_target_max_kg="10.2"),
        ]
        client = Mock()
        for mutate in mutations:
            request = assist_request()
            mutate(request)
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                assist_with_adaptation(request, client=client)
        client.tool_turn.assert_not_called()

    def test_request_validation_requires_complete_explicit_finite_inputs(self):
        requests = [None, {}, {**assist_request(), "extra": "unsupported"},
                    {**assist_request(), "question": "x" * 3001}]
        for value in ("", "NaN", "Infinity", "-1", "1e1000"):
            request = assist_request()
            request["calculation_context"]["components"][0]["amount"] = value
            requests.append(request)
        for change in ({"kind": "verified"}, {"kind": []}, {"mass_kg": True}, {"uncertainty_kg": 10}):
            request = assist_request()
            request["feedback"] = feedback()
            request["feedback"]["observation"].update(change)
            requests.append(request)
        for field in ("max_add_mass_kg", "max_remove_mass_kg", "adjustment_uncertainty_kg"):
            request = assist_request()
            request["feedback"] = feedback()
            request["feedback"][field] = -1
            requests.append(request)
        request = assist_request()
        request["feedback"] = feedback()
        request["feedback"]["max_remove_mass_kg"] = 9.7
        requests.append(request)
        for request in requests:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                validate_assist_request(request)

    def test_arguments_cannot_override_bound_numbers_and_invalid_batches_execute_nothing(self):
        for name, arguments in (("compare_current_design", {"target_max_kg": 20}),
                                ("check_capacity_repair", {"capacity": 9000}),
                                ("check_mass_feedback", {"mass_kg": 10})):
            with self.subTest(name=name), patch("reshivo.engineering_agent.plan_adaptation") as execute:
                with self.assertRaises(MetaValidationError):
                    self.run_script(assist_request(), reply(call("valid", "compare_current_design"), call("invalid", name, arguments)))
                execute.assert_not_called()

    def test_bad_presentation_shape_and_unlisted_tools_fail_without_completion(self):
        invalid = [call("bad", "not_allowlisted"),
                   call("bad", "present_recommendation", {"answer": "Text", "action": "adjust_volume"}),
                   present("bad", "compare", "invent_property"),
                   present("bad", "compare", "adjust_volume", "x" * 3001)]
        for function_call in invalid:
            with self.subTest(call=function_call), self.assertRaises(MetaValidationError):
                self.run_script(assist_request(), reply(function_call))

    def test_provider_error_after_computation_preserves_trace_without_a_success_answer(self):
        result, _ = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
                                    urllib.error.URLError("fixture network failure"))
        self.assertEqual(result["status"], "provider_error")
        self.assertEqual(result["error"]["code"], "meta_request_failed")
        self.assertEqual(len(result["tool_trace"]), 1)
        self.assertIsNone(result["answer"])
        self.assertIsNone(result["decision"])
        self.assertNotIn("verified_summary", result)

    def test_provider_failure_before_computation_is_typed(self):
        with self.assertRaises(MetaAPIError):
            self.run_script(assist_request(), urllib.error.URLError("fixture network failure"))
        client = MetaClient(environ={"MODEL_API_KEY": "", "META_API_KEY": ""})
        with self.assertRaises(MetaConfigurationError):
            assist_with_adaptation(assist_request(), client=client)

    def test_duplicate_call_id_is_rejected_without_reexecution(self):
        result, _ = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
                                    reply(call("compare", "compare_current_design")))
        self.assertEqual(result["status"], "provider_error")
        self.assertEqual(result["error"]["code"], "meta_invalid_response")
        self.assertEqual(len(result["tool_trace"]), 1)

    def test_plain_text_never_counts_as_completed_tool_execution(self):
        result, transport = self.run_script(assist_request(), *[reply(content="I ran everything successfully.")] * MAX_MODEL_TURNS)
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(result["tool_trace"], [])
        self.assertEqual(result["model_turns"], MAX_MODEL_TURNS)
        self.assertEqual(len(transport.requests), MAX_MODEL_TURNS)
        self.assertIsNone(result["answer"])
        self.assertEqual(result["error"]["code"], "model_turn_limit")
        self.assertEqual(result["model_trace"][0]["assistant_message"]["content"], "I ran everything successfully.")

    def test_limit_retains_actual_last_rejection_and_bounded_message_excerpts(self):
        result, _ = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
            reply(present("wrong-1", "compare", "keep_fixed")),
            reply(present("wrong-2", "compare", "keep_fixed")),
            reply(present("wrong-3", "compare", "keep_fixed")))
        self.assertEqual(result["status"], "limit_reached")
        reason = result["model_trace"][-1]["tool_results"][0]["result"]["reason"]
        self.assertEqual(result["error"]["last_rejection"], reason)
        self.assertIn(reason, result["error"]["message"])
        content = "測" * 16000
        result, _ = self.run_script(assist_request(), *[reply(content=content)] * MAX_MODEL_TURNS)
        self.assertLessEqual(len(json.dumps(result["model_trace"], ensure_ascii=True).encode()), MAX_MODEL_TRACE_BYTES)
        self.assertTrue(all(turn["assistant_message_truncated"] for turn in result["model_trace"]))
        raw_message = json.dumps({"role": "assistant", "content": content}, ensure_ascii=True)
        for turn in result["model_trace"]:
            self.assertTrue(raw_message.startswith(turn["assistant_message_excerpt"]))
            self.assertEqual(turn["assistant_message_original_bytes"], len(raw_message.encode()))

    def test_computation_limit_counts_only_executed_calculations(self):
        first = [call(f"compare-{index}", "compare_current_design") for index in range(4)]
        second = [call(f"compare-{index}", "compare_current_design") for index in range(4, 8)]
        with patch("reshivo.engineering_agent.plan_adaptation", wraps=plan_adaptation) as execute:
            result, transport = self.run_script(assist_request(), reply(*first), reply(*second),
                reply(present("answer", "compare-5", "adjust_volume")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(execute.call_count, MAX_COMPUTATION_CALLS)
        self.assertEqual(len(result["tool_trace"]), MAX_COMPUTATION_CALLS)
        latest_results = transport.requests[2]["messages"][-4:]
        self.assertEqual([json.loads(row["content"]).get("status") for row in latest_results], [None, None, "limit_reached", "limit_reached"])

    def test_elapsed_limit_prevents_more_model_calls_and_calculations(self):
        client = Mock()
        with patch("reshivo.engineering_agent.time.monotonic", side_effect=[0, 211, 211]):
            result = assist_with_adaptation(assist_request(), client=client)
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(result["model_turns"], 0)
        client.tool_turn.assert_not_called()
        with patch("reshivo.engineering_agent.time.monotonic", return_value=0) as clock:
            result, transport = self.run_script(assist_request(), reply(call("late", "compare_current_design")),
                                                callback=lambda: setattr(clock, "return_value", 211))
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(result["tool_trace"], [])
        self.assertEqual(len(transport.requests), 1)

    def test_presentation_returned_after_elapsed_limit_is_not_completed(self):
        with patch("reshivo.engineering_agent.time.monotonic", return_value=0) as clock:
            requests = [0]

            def advance_after_second_request():
                requests[0] += 1
                if requests[0] == 2:
                    clock.return_value = 211

            result, _ = self.run_script(assist_request(), reply(call("compare", "compare_current_design")),
                reply(present("late", "compare", "adjust_volume")), callback=advance_after_second_request)
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(len(result["tool_trace"]), 1)
        self.assertIsNone(result["answer"])

    def test_large_observation_set_is_summarized_but_full_trace_is_retained(self):
        request = assist_request()
        template = request["plan"]["observations"][0]
        request["plan"]["observations"] = [{**template, "id": f"D-{index}-" + "測" * 60,
                                             "batch_id": "測" * 80, "run_id": "測" * 80,
                                             "specimen_id": "測" * 80} for index in range(200)]
        result, transport = self.run_script(request, reply(call("compare", "compare_current_design")),
                                            reply(present("answer", "compare", "keep_fixed")))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["tool_trace"][0]["result"]["observations"]), 200)
        summary = transport.requests[1]["messages"][-1]["content"]
        self.assertLessEqual(len(summary.encode()), MAX_SUMMARY_BYTES)
        value = json.loads(summary)
        self.assertEqual(value["observation_count"], 200)
        self.assertTrue(value["sample_omits_observations"])
        self.assertNotIn("observation_sample", value)
        json.dumps(result, allow_nan=False)


class EngineeringAssistAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name), assist_fn=lambda request: {"status": "fixture", "question": request["question"]},
                                       note_fn=lambda request: {"status": "fixture", "note": request["note"]})
        cls.server = build_server(port=0, service=cls.service, web_root=Path(cls.temp.name) / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/api/adaptation/assist"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, body, headers=None, path=None):
        url = self.url.rsplit("/api/", 1)[0] + path if path else self.url
        request = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def test_route_validates_bound_case_before_calling_assistance(self):
        request = assist_request()
        with patch.object(self.service, "assist_fn", wraps=self.service.assist_fn) as assist:
            status, result = self.call(request)
            self.assertEqual(status, 200)
            self.assertEqual(result["question"], request["question"])
            request["brief"]["process"] = "Changed process"
            status, result = self.call(request)
            self.assertEqual(status, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")
            self.assertEqual(assist.call_count, 1)

    def test_route_accepts_mass_only_case_without_a_complete_recipe(self):
        status, result = self.call(mass_only_request())
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "fixture")

    def test_service_executes_runner_when_no_injected_assistance_is_set(self):
        with patch.object(self.service, "assist_fn", None), \
             patch("reshivo.engineering_agent.assist_with_adaptation", return_value={"status": "completed"}) as run:
            self.assertEqual(self.call(assist_request()), (200, {"status": "completed"}))
        run.assert_called_once_with(assist_request(), root=self.service.root)

    def test_provider_errors_before_execution_keep_typed_http_status(self):
        for error, status, code in ((MetaConfigurationError("Not connected"), 503, "meta_not_configured"),
                                    (MetaAPIError("Unavailable"), 502, "meta_request_failed"),
                                    (MetaValidationError("Invalid response"), 502, "meta_invalid_response")):
            with self.subTest(code=code), patch.object(self.service, "assist_fn", side_effect=error):
                actual_status, result = self.call(assist_request())
                self.assertEqual(actual_status, status)
                self.assertEqual(result["error"]["code"], code)

    def test_route_keeps_host_origin_body_size_and_concurrency_guards(self):
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call(assist_request(), headers)[0], 403)
        self.assertEqual(self.call({"oversized": "x" * 65536})[0], 413)
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            status, result = self.call(assist_request())
            self.assertEqual(status, 429)
            self.assertEqual(result["error"]["code"], "service_busy")
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()
        self.assertEqual(self.call(assist_request())[0], 200)

    def note_request(self):
        request = mass_only_request()
        return {key: request[key] for key in ("brief", "calculation_context")} | {"note": "Simulated assembly A weighs 9.7 kg."}

    def test_note_route_validates_before_generation_and_uses_the_shared_case(self):
        path = "/api/advisor/read-observation"
        with patch.object(self.service, "note_fn", wraps=self.service.note_fn) as read_note:
            request = self.note_request()
            status, result = self.call(request, path=path)
            self.assertEqual(status, 200)
            self.assertEqual(result["note"], request["note"])
            request["note"] = ""
            status, result = self.call(request, path=path)
            self.assertEqual(status, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")
            self.assertEqual(read_note.call_count, 1)
        with patch.object(self.service, "note_fn", None), \
             patch("reshivo.observation_intake.read_observation_note", return_value={"status": "review_required"}) as read_note:
            self.assertEqual(self.call(self.note_request(), path=path), (200, {"status": "review_required"}))
            read_note.assert_called_once_with(self.note_request(), root=self.service.root)

    def test_note_route_retains_typed_provider_errors(self):
        for error, status, code in ((MetaConfigurationError("Not connected"), 503, "meta_not_configured"),
                                    (MetaAPIError("Unavailable"), 502, "meta_request_failed"),
                                    (MetaValidationError("Invalid response"), 502, "meta_invalid_response")):
            with self.subTest(code=code), patch.object(self.service, "note_fn", side_effect=error):
                actual_status, result = self.call(self.note_request(), path="/api/advisor/read-observation")
                self.assertEqual(actual_status, status)
                self.assertEqual(result["error"]["code"], code)

    def test_note_route_keeps_host_origin_size_and_work_slot_guards(self):
        path = "/api/advisor/read-observation"
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call(self.note_request(), headers, path)[0], 403)
        self.assertEqual(self.call({"oversized": "x" * 65536}, path=path)[0], 413)
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            status, result = self.call(self.note_request(), path=path)
            self.assertEqual(status, 429)
            self.assertEqual(result["error"]["code"], "service_busy")
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()
        self.assertEqual(self.call(self.note_request(), path=path)[0], 200)


if __name__ == "__main__":
    unittest.main()
