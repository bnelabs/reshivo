"""HTTP boundary tests for the combined project decision."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from rematter.server import build_server, MAX_PROJECT_BODY_BYTES
from rematter.service import WorkbenchService
from test_decision_comparison import sample


class DecisionComparisonHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name), meta_status_fn=lambda: {"configured": False, "model": "test"})
        cls.server = build_server(port=0, service=cls.service, web_root=cls.temp.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, value, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/project/compare-decisions", body=json.dumps(value),
                           headers={"Content-Type": "application/json", **(headers or {})})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_matching_cost_and_checks_select_expensive_passing_setup(self):
        status, result = self.request(sample())
        self.assertEqual(status, 200)
        self.assertEqual(result["assessment_kind"], "synthetic")
        self.assertEqual(result["decisions"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertEqual(result["configurations"][1]["state"], "out_of_range")
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["future_consistency_predicted"])

    def test_forged_or_mismatched_recipe_is_400(self):
        request = sample()
        request["cost_records"][0]["materials"][0]["quantity"] = "2"
        status, result = self.request(request)
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")
        self.assertNotIn("decisions", result)

    def test_missing_reading_has_no_winner(self):
        request = sample()
        request["records"].pop()
        status, result = self.request(request)
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "needs_more_information")
        self.assertIsNone(result["decisions"]["per_usable_unit"])

    def test_foreign_origin_is_rejected(self):
        status, result = self.request(sample(), {"Origin": "https://untrusted.example"})
        self.assertEqual(status, 403)
        self.assertEqual(result["error"]["code"], "forbidden_origin")

    def test_oversized_request_is_rejected_before_body_is_read(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.putrequest("POST", "/api/project/compare-decisions")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(MAX_PROJECT_BODY_BYTES + 1))
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        self.assertEqual(json.loads(response.read())["error"]["code"], "request_too_large")
        connection.close()


if __name__ == "__main__":
    unittest.main()
