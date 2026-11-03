from copy import deepcopy
import json
import http.client
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from rematter.advisor import FOLLOWUP_PROMPT, follow_up_with_case, followup_schema
from rematter.meta import Generation, MetaAPIError, MetaConfigurationError, MetaValidationError
from rematter.products import ProductInputError
from rematter.server import build_server
from rematter.service import WorkbenchService


def request_data():
    return {
        "brief": {
            "input": "Named recycled resin and host resin; no density supplied",
            "variation": "Component fraction changes between portions",
            "contamination": "No contaminant-response measurement supplied",
            "product": "Non-load-bearing cover",
            "use_case": "A cover over a separately supported object",
            "targets": "Yield stress at least 25 MPa; fit target not set",
            "process": "Home planning only; processing capability unconfirmed",
            "available_changes": "Known composition additions or separate geometry trials",
        },
        "question": "The current input fraction is a range. What do I need before choosing a dose?",
        "history": [{"role": "assistant", "content": "Earlier trial proposal, not a physical test."}],
        "calculation_context": {
            "label": "Shared case", "components": [
                {"id": 1, "name": "Recycled resin", "role": "main", "amount": "400"},
                {"id": 2, "name": "Host resin", "role": "other", "amount": "600"},
            ],
            "amount_unit": "g", "amount_basis": "User-entered mass recipe, not a physical test",
            "mass_target_min_kg": "", "mass_target_max_kg": "",
        },
    }


def response_data():
    return {
        "answer": "Determine the actual portion's component fraction before choosing its addition. A total reweigh does not establish that fraction.",
        "next_steps": ["Check constituent-feed records or a suitable composition method.", "Recalculate only when the actual fraction is known."],
        "questions": ["What reliable fraction information exists for this portion?"],
        "source_ids": [],
    }


class FixtureClient:
    def __init__(self, data=None, failure=None):
        self.data = response_data() if data is None else data
        self.failure = failure
        self.calls = []

    def generate(self, prompt, schema, max_candidates, **options):
        self.calls.append((json.loads(prompt), schema, max_candidates, options))
        if self.failure is not None:
            raise self.failure
        return Generation(deepcopy(self.data), "muse-spark-1.3", False, {"total_tokens": 1}, "fixture-followup", 17)


class FollowupTests(unittest.TestCase):
    def test_compact_result_keeps_shared_unknowns_and_does_not_regenerate_routes(self):
        request = request_data()
        before = deepcopy(request)
        result = follow_up_with_case(request, client=FixtureClient())
        self.assertEqual(request, before)
        self.assertEqual(result["result_kind"], "engineering_followup")
        self.assertEqual(result["calculation_context"], request["calculation_context"])
        self.assertEqual(result["calculation_context"]["mass_target_min_kg"], "")
        self.assertFalse(result["live"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["performance_verified"])
        self.assertNotIn("material_routes", result)
        self.assertNotIn("engineering_routes", result)
        self.assertEqual(result["request_id"], "fixture-followup")

    def test_request_uses_same_high_reasoning_budget_with_compact_schema(self):
        client = FixtureClient()
        follow_up_with_case(request_data(), client=client)
        prompt, schema, candidates, options = client.calls[0]
        self.assertEqual(schema, followup_schema())
        self.assertEqual(set(schema["properties"]), {"answer", "next_steps", "questions", "source_ids"})
        self.assertEqual(candidates, 1)
        self.assertEqual(options["max_completion_tokens"], 8192)
        self.assertEqual(options["reasoning_effort"], "high")
        self.assertEqual(options["system_prompt"], FOLLOWUP_PROMPT)
        self.assertEqual(prompt["brief"], request_data()["brief"])
        self.assertEqual(prompt["history"], request_data()["history"])

    def test_plain_case_without_optional_calculation_details_is_supported(self):
        request = request_data()
        del request["calculation_context"]
        result = follow_up_with_case(request, client=FixtureClient())
        self.assertNotIn("calculation_context", result)

    def test_invalid_input_is_rejected_before_generation(self):
        cases = [{}, {**request_data(), "unsupported": True},
                 {**request_data(), "question": "x" * 3001},
                 {**request_data(), "history": request_data()["history"] * 7}]
        for request in cases:
            client = FixtureClient()
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                follow_up_with_case(request, client=client)
            self.assertEqual(client.calls, [])

    def test_oversized_missing_or_invented_response_fields_are_not_surfaced(self):
        malformed = [
            {**response_data(), "material_routes": []},
            {**response_data(), "performance_verified": True},
            {**response_data(), "answer": " "},
            {**response_data(), "answer": "x" * 3001},
            {**response_data(), "next_steps": []},
            {**response_data(), "next_steps": ["Step"] * 4},
            {**response_data(), "questions": ["Question"] * 4},
            {**response_data(), "source_ids": ["unknown-source"]},
            {**response_data(), "source_ids": ["cecon2021", "cecon2021"]},
            {key: value for key, value in response_data().items() if key != "answer"},
        ]
        for data in malformed:
            with self.subTest(data=data), self.assertRaises(MetaValidationError):
                follow_up_with_case(request_data(), client=FixtureClient(data))

    def test_removed_assurance_is_reported_and_an_empty_remaining_answer_fails(self):
        assured = "You will meet your targets."
        data = {**response_data(), "answer": assured + "\n\n" + response_data()["answer"]}
        result = follow_up_with_case(request_data(), client=FixtureClient(data))
        self.assertEqual(result["quarantined_answer"], [assured])
        self.assertNotIn(assured, result["answer"])
        with self.assertRaises(MetaValidationError):
            follow_up_with_case(request_data(), client=FixtureClient({**response_data(), "answer": assured}))

    def test_transport_failures_do_not_create_substitute_advice(self):
        for error in (MetaAPIError("Unavailable"), MetaConfigurationError("Not configured"), MetaValidationError("Truncated")):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)):
                follow_up_with_case(request_data(), client=FixtureClient(failure=error))


class FollowupAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name),
                                       followup_fn=lambda request: follow_up_with_case(request, client=FixtureClient()))
        cls.server = build_server(port=0, service=cls.service, web_root=Path(cls.temp.name) / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/api/advisor/follow-up"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, data=None, headers=None):
        request = urllib.request.Request(self.url, data=json.dumps(request_data() if data is None else data).encode(),
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def test_compact_endpoint_requires_no_stored_material_study(self):
        with patch.object(self.service, "_materials", side_effect=AssertionError("No source substitution")):
            status, result = self.call()
        self.assertEqual(status, 200)
        self.assertEqual(result["result_kind"], "engineering_followup")
        self.assertEqual(result["calculation_context"], request_data()["calculation_context"])
        self.assertFalse(result["performance_verified"])

    def test_validation_loopback_origin_body_and_work_slot_guards_remain(self):
        self.assertEqual(self.call({"brief": {}})[0], 400)
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call(headers=headers)[0], 403)
        self.assertEqual(self.call({"payload": "x" * 65536})[0], 400)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.putrequest("POST", "/api/advisor/follow-up")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(512 * 1024 + 1))
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        connection.close()
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            status, result = self.call()
            self.assertEqual(status, 429)
            self.assertEqual(result["error"]["code"], "service_busy")
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()
        self.assertEqual(self.call()[0], 200)

    def test_configuration_provider_and_invalid_response_errors_stay_distinct(self):
        cases = [(MetaConfigurationError("Not configured"), 503, "meta_not_configured"),
                 (MetaAPIError("Unavailable"), 502, "meta_request_failed"),
                 (MetaValidationError("Truncated"), 502, "meta_invalid_response")]
        for error, expected_status, code in cases:
            def fail(request): raise error
            with self.subTest(error=type(error).__name__), patch.object(self.service, "followup_fn", fail):
                status, result = self.call()
                self.assertEqual(status, expected_status)
                self.assertEqual(result["error"]["code"], code)
                self.assertNotIn("answer", result)
