"""Loopback preflight classifies bounded user context without any model request."""
from copy import deepcopy
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from reshivo.materials import ROOT
from reshivo.server import MAX_PLANNING_BODY_BYTES, build_server
from reshivo.service import WorkbenchService


def request_body():
    return {
        "brief": {"input": "fabric offcuts", "variation": "", "contamination": "",
                  "product": "sound sheet", "use_case": "", "targets": "", "process": "", "available_changes": ""},
        "question": "", "project_context": {"configurations": []},
    }


def setup(identity, revision, name):
    return {"id": identity, "revision": revision, "materials": [{"name": name}], "process": "", "geometry": ""}


class PlanningModeHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        (root / "examples").mkdir()
        shutil.copyfile(ROOT / "examples/support-member.json", root / "examples/support-member.json")
        cls.server = build_server(port=0, service=WorkbenchService(root=root), web_root=root)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, body, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=8)
        try:
            connection.request("POST", "/api/project/planning-mode", json.dumps(body).encode(),
                               {"Content-Type": "application/json", **(headers or {})})
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw), dict(response.getheaders())
        finally:
            connection.close()

    def test_user_context_and_live_guard_use_same_recognizer_without_provider(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Unexpected provider call")):
            status, result, headers = self.call(request_body())
            self.assertEqual((status, result), (200, {"planning_only": False}))
            self.assertEqual(headers["Cache-Control"], "no-store")
            body = request_body()
            body["question"] = "Can I use unidentified metal dust at home?"
            self.assertEqual(self.call(body)[:2], (200, {"planning_only": True}))
            body["question"] = ""
            body["history"] = [{"role": "user", "content": "I have metal filings."}]
            self.assertEqual(self.call(body)[:2], (200, {"planning_only": True}))
            body["history"] = [{"role": "assistant", "content": "metal dust"}]
            self.assertEqual(self.call(body)[0], 400)

    def test_latest_setup_context_and_no_model_proposal_input(self):
        body = request_body()
        body["project_context"]["configurations"] = [setup("A", 1, "metal dust"), setup("A", 2, "fabric")]
        self.assertEqual(self.call(body)[:2], (200, {"planning_only": False}))
        body["project_context"]["configurations"].reverse()
        body["project_context"]["configurations"][0]["materials"][0]["name"] = "metal filings"
        self.assertEqual(self.call(body)[:2], (200, {"planning_only": True}))
        body["project_context"]["configurations"][0]["notes"] = "untrusted generated note"
        self.assertEqual(self.call(body)[0], 400)

    def test_local_planning_stays_available_when_model_work_is_busy(self):
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            self.assertEqual(self.call(request_body())[:2], (200, {"planning_only": False}))
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()

    def test_model_work_waits_briefly_for_a_free_slot(self):
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        release = threading.Timer(0.2, self.server.work_slots.release)
        release.start()
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            with patch("reshivo.server.WORK_WAIT_SECONDS", 1), patch.object(
                self.server.application, "project_intake", return_value={"ready": True}
            ):
                connection.request("POST", "/api/project/intake", b'{}', {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual((response.status, json.loads(response.read())), (200, {"ready": True}))
        finally:
            connection.close()
            release.join()
            self.server.work_slots.release()

    def test_model_waiting_queue_is_bounded(self):
        for _ in range(2): self.assertTrue(self.server.work_slots.acquire(timeout=1))
        for _ in range(4): self.assertTrue(self.server.waiting_slots.acquire(timeout=1))
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            with patch.object(self.server.application, "project_intake") as intake:
                connection.request("POST", "/api/project/intake", b'{}', {"Content-Type": "application/json"})
                response = connection.getresponse()
                result = json.loads(response.read())
                self.assertEqual((response.status, result["error"]["code"]), (429, "service_busy"))
                intake.assert_not_called()
        finally:
            connection.close()
            for _ in range(4): self.server.waiting_slots.release()
            for _ in range(2): self.server.work_slots.release()

    def test_rejects_unsupported_fields_and_unbounded_or_malformed_values(self):
        cases = []
        body = request_body(); body["brief"]["extra"] = "value"; cases.append(body)
        body = request_body(); del body["brief"]["input"]; cases.append(body)
        body = request_body(); body["question"] = "x" * 3001; cases.append(body)
        body = request_body(); body["history"] = [{"role": "user", "content": "x" * 6001}]; cases.append(body)
        body = request_body(); body["history"] = [{"role": "user", "content": "x"}] * 7; cases.append(body)
        body = request_body(); body["project_context"]["configurations"] = [setup("A", True, "fabric")]; cases.append(body)
        body = request_body(); body["project_context"]["configurations"] = [setup("A", 1, "fabric")] * 2; cases.append(body)
        body = request_body(); body["project_context"]["configurations"] = [setup("A", 1, "x" * 161)]; cases.append(body)
        body = request_body(); body["project_context"]["configurations"] = [setup("A", 1, "fabric")] * 101; cases.append(body)
        for body in cases:
            with self.subTest(body=str(body)[:80]):
                self.assertEqual(self.call(body)[0], 400)
        self.assertEqual(self.call(request_body(), {"Origin": "https://untrusted.example"})[0], 403)

    def test_large_valid_project_supported_and_oversize_guarded(self):
        body = request_body()
        body["project_context"]["configurations"] = [
            {"id": f"setup-{i}", "revision": 1, "process": "", "geometry": "",
             "materials": [{"name": "x" * 160} for _ in range(50)]} for i in range(100)]
        self.assertGreater(len(json.dumps(body).encode()), 512 * 1024)
        self.assertEqual(self.call(body)[:2], (200, {"planning_only": False}))
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.putrequest("POST", "/api/project/planning-mode")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(MAX_PLANNING_BODY_BYTES + 1))
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 413)
            response.read()
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
