from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from reshivo.engineering_intake import normalize_engineering_fields, read_engineering_note
from reshivo.meta import Generation, MetaAPIError, MetaConfigurationError, MetaValidationError
from reshivo.server import build_server
from reshivo.service import WorkbenchService
from test_engineering_intake import Client, fields, request


READ = "/api/advisor/read-engineering-note"
APPLY = "/api/adaptation/apply-engineering-note"


def apply_request(case=None, data=None, **choices):
    case = request() if case is None else case
    draft = normalize_engineering_fields(case, fields() if data is None else data)
    return {**deepcopy(case), "source_fields": draft["source_fields"],
            "request_fingerprint": draft["request_fingerprint"], "draft_fingerprint": draft["draft_fingerprint"],
            "review_confirmed": True, "independent_adjustments": True, "target_choice": "current", **choices}


class EngineeringIntakeAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name) / "outputs",
                                       engineering_note_fn=lambda body: read_engineering_note(body, client=Client()))
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
        outgoing = urllib.request.Request(self.url + path, data=json.dumps(body).encode(),
                                          headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(outgoing, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def test_read_validates_before_generation_and_returns_source_bound_metadata(self):
        with patch.object(self.service, "engineering_note_fn", wraps=self.service.engineering_note_fn) as reader:
            body = request()
            status, result = self.call(READ, body)
            self.assertEqual(status, 200)
            self.assertEqual(result["result_kind"], "engineering_draft")
            self.assertTrue(result["review_required"])
            self.assertFalse(result["ready"])
            self.assertEqual(result["brief"], body["brief"])
            self.assertEqual(result["calculation_context"], body["calculation_context"])
            self.assertEqual(result["note"], body["note"])
            self.assertEqual(result["request_id"], "engineering-fixture")
            self.assertEqual(result["values"]["mass_kg"], .95)
            self.assertNotIn("check", result)
            self.assertNotIn("bound_request", result)
            for invalid in ({**body, "note": ""}, {**body, "property": "density"}):
                status, result = self.call(READ, invalid)
                self.assertEqual((status, result["error"]["code"]), (400, "invalid_request"))
            self.assertEqual(reader.call_count, 1)

    def test_default_reader_uses_one_generation_but_apply_uses_no_model(self):
        generation = Generation(fields(), "muse-spark-1.3", False, {"total_tokens": 20}, "api-fixture", 10)
        with patch.object(self.service, "engineering_note_fn", None), \
             patch("reshivo.meta.MetaClient.generate", return_value=generation) as generate:
            status, draft = self.call(READ, request())
            self.assertEqual(status, 200)
            self.assertEqual(generate.call_count, 1)
            body = {**request(), "source_fields": draft["source_fields"], "request_fingerprint": draft["request_fingerprint"],
                    "draft_fingerprint": draft["draft_fingerprint"], "review_confirmed": True,
                    "independent_adjustments": True, "target_choice": "current"}
            status, applied = self.call(APPLY, body)
            self.assertEqual(status, 200)
            self.assertTrue(applied["ready"])
            self.assertTrue(applied["check"]["feasible"])
            self.assertEqual(generate.call_count, 1)

    def test_reviewed_application_returns_one_atomic_request_and_actual_joint_check(self):
        body = apply_request(); before = deepcopy(body)
        with patch.object(self.service, "_materials", side_effect=AssertionError("No study supplies this case")), \
             patch("reshivo.meta.MetaClient.generate", side_effect=AssertionError("Apply must not call a provider")):
            status, result = self.call(APPLY, body)
        self.assertEqual(status, 200)
        self.assertEqual(body, before)
        self.assertEqual(result["source_path"], "quoted_engineering_note")
        self.assertEqual(result["bound_request"]["brief"], body["brief"])
        self.assertEqual(result["bound_request"]["feedback"]["observation"]["id"], "intake-1")
        self.assertEqual(result["bound_request"]["balance"]["cg_x_mm"], 10)
        self.assertEqual(result["check"]["result_kind"], "simulation")
        self.assertEqual([row["command_kg"] for row in result["check"]["commands"]], [.104, -.054])
        self.assertFalse(result["check"]["physical_product_tested"])
        self.assertFalse(result["check"]["batch_consistency_established"])
        self.assertEqual(result["check"]["case_context"], result["bound_request"])
        self.assertEqual(result["reviewed_values"]["mass_kg"], .95)
        self.assertFalse(self.service.output_root.exists())

    def test_existing_targets_stay_current_unless_proposed_choice_is_explicit(self):
        case = request();case["calculation_context"]["mass_target_min_kg"] = ".97"
        for choice, minimum in (("current", .97), ("proposed", .98)):
            with self.subTest(choice=choice):
                status, result = self.call(APPLY, apply_request(case, target_choice=choice))
                self.assertEqual(status, 200)
                self.assertTrue(result["ready"])
                self.assertTrue(result["conflicts"])
                self.assertEqual(result["check"]["request"]["targets"]["mass_min_kg"], minimum)
                self.assertEqual(result["target_resolution"]["mass_target_min_kg"]["selected"], minimum)
                self.assertEqual(result["bound_request"]["calculation_context"]["components"], case["calculation_context"]["components"])
        self.assertEqual(case["calculation_context"]["mass_target_min_kg"], ".97")

    def test_missing_target_details_can_be_reviewed_without_changing_recipe_or_product(self):
        case = request();case["calculation_context"].update(mass_target_min_kg="", mass_target_max_kg="")
        case["calculation_context"].pop("balance")
        status, result = self.call(APPLY, apply_request(case))
        self.assertEqual(status, 200)
        self.assertTrue(result["ready"])
        self.assertEqual(result["bound_request"]["brief"], case["brief"])
        self.assertEqual(result["check"]["request"]["targets"]["mass_min_kg"], .98)
        self.assertEqual(result["bound_request"]["calculation_context"]["components"], case["calculation_context"]["components"])
        self.assertNotIn("balance", case["calculation_context"])

    def test_missing_new_cg_error_returns_questions_without_calculating(self):
        data = fields();data["cg_uncertainty_mm"] = None
        with patch("reshivo.balance.plan_shared_balance", side_effect=AssertionError("No complete observation")) as calculate, \
             patch("reshivo.meta.MetaClient.generate", side_effect=AssertionError("Apply does not generate")):
            status, result = self.call(APPLY, apply_request(data=data))
        self.assertEqual(status, 200)
        self.assertFalse(result["ready"])
        self.assertEqual(result["missing_fields"], ["cg_uncertainty_mm"])
        self.assertIn("centre-of-mass", result["questions"][0])
        self.assertIsNone(result["reviewed_values"]["cg_uncertainty_mm"])
        self.assertEqual(result["reviewed_values"]["mass_kg"], .95)
        self.assertIsNone(result["check"])
        self.assertNotIn("bound_request", result)
        calculate.assert_not_called()

    def test_review_and_independent_acknowledgement_gate_the_calculation(self):
        for choices in ({"review_confirmed": False}, {"independent_adjustments": False}, {"review_confirmed": False, "independent_adjustments": False}):
            with self.subTest(choices=choices), \
                 patch("reshivo.balance.plan_shared_balance", side_effect=AssertionError("Review gates not met")) as calculate:
                status, result = self.call(APPLY, apply_request(**choices))
                self.assertEqual(status, 200)
                self.assertFalse(result["ready"])
                self.assertTrue(result["questions"])
                self.assertIsNone(result["check"])
                self.assertIsNone(result["reviewed_values"])
                self.assertNotIn("bound_request", result)
                calculate.assert_not_called()

    def test_stale_or_mutated_source_bound_inputs_are_invalid_not_provider_errors(self):
        valid = apply_request()
        mutations = []
        for key in ("request_fingerprint", "draft_fingerprint"):
            body = deepcopy(valid);body[key] = "stale";mutations.append(body)
        body = deepcopy(valid);body["brief"]["product"] = "Another assembly";mutations.append(body)
        body = deepcopy(valid);body["note"] += " Changed note.";mutations.append(body)
        body = deepcopy(valid);body["source_fields"]["mass_kg"]["number_text"] = "1";mutations.append(body)
        body = deepcopy(valid);body["source_fields"]["cg_uncertainty_mm"] = None;mutations.append(body)
        body = deepcopy(valid);body["source_fields"]["mass_kg"]["source"] = "brief.targets";mutations.append(body)
        with patch("reshivo.balance.plan_shared_balance", side_effect=AssertionError("Invalid draft must not calculate")) as calculate:
            for body in mutations:
                with self.subTest(body_keys=list(body)):
                    status, result = self.call(APPLY, body)
                    self.assertEqual((status, result["error"]["code"]), (400, "invalid_request"))
            calculate.assert_not_called()

    def test_extra_or_unquoted_payloads_and_nonboolean_flags_are_rejected(self):
        valid = apply_request()
        invalid = [{**valid, "values": {}}, {key: value for key, value in valid.items() if key != "source_fields"},
                   {**valid, "target_choice": "automatic"}, {**valid, "review_confirmed": "true"},
                   {**valid, "independent_adjustments": 1}, {**valid, "source_fields": {"mass_kg": 1}}]
        for body in invalid:
            with self.subTest(body_keys=list(body)):
                status, result = self.call(APPLY, body)
                self.assertEqual((status, result["error"]["code"]), (400, "invalid_request"))
        status, result = self.call("/api/adaptation/apply-engineering-values", valid)
        self.assertEqual((status, result["error"]["code"]), (404, "not_found"))

    def test_read_keeps_configuration_provider_and_model_validation_errors_typed(self):
        for error, status, code in ((MetaConfigurationError("Not connected"), 503, "meta_not_configured"),
                                    (MetaAPIError("Unavailable"), 502, "meta_request_failed"),
                                    (MetaValidationError("Invalid response"), 502, "meta_invalid_response")):
            with self.subTest(code=code), patch.object(self.service, "engineering_note_fn", side_effect=error):
                actual_status, result = self.call(READ, request())
                self.assertEqual((actual_status, result["error"]["code"]), (status, code))

    def test_both_routes_keep_host_origin_body_and_work_slot_guards(self):
        for path, body in ((READ, request()), (APPLY, apply_request())):
            with self.subTest(path=path):
                for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
                    self.assertEqual(self.call(path, body, headers)[0], 403)
                self.assertEqual(self.call(path, {"oversized": "x" * 65536})[0], 413)
                self.assertTrue(self.server.work_slots.acquire(blocking=False))
                self.assertTrue(self.server.work_slots.acquire(blocking=False))
                try:
                    status, result = self.call(path, body)
                    self.assertEqual((status, result["error"]["code"]), (429, "service_busy"))
                finally:
                    self.server.work_slots.release()
                    self.server.work_slots.release()
                self.assertEqual(self.call(path, body)[0], 200)


if __name__ == "__main__": unittest.main()
