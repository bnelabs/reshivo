import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from rematter.server import build_server
from rematter.service import WorkbenchService
from rematter.meta import Generation, propose_and_evaluate


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name), meta_status_fn=lambda: {"configured": False, "model": "muse-spark-1.3"})
        cls.server = build_server(port=0, service=cls.service, web_root=Path(cls.temp.name)/"web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, body=None, headers=None, raw=None):
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url+path, data=data, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            result = error.code, error.read(), error.headers
            error.close()
            return result

    def test_bootstrap_and_health(self):
        status, raw, _ = self.request("/api/bootstrap")
        data = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["materials"]), 8)
        self.assertEqual(data["meta"], {"configured": False, "model": "muse-spark-1.3"})
        self.assertNotIn(b"MODEL_API_KEY", raw)
        self.assertTrue(json.loads(self.request("/api/health")[1])["source_available"])

    def test_search_download_and_saved_run(self):
        status, raw, _ = self.request("/api/experiments", {})
        data = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["exports"]), 2)
        self.assertFalse(data["meta_model_used"])
        status, stl, headers = self.request(data["exports"][1]["stl_url"])
        self.assertEqual(status, 200)
        self.assertTrue(stl.startswith(b"solid"))
        self.assertIn("attachment", headers["Content-Disposition"])
        saved = json.loads(self.request("/api/experiments/"+data["id"])[1])
        self.assertEqual(saved["id"], data["id"])

    def test_infeasible_input_and_direct_evaluation(self):
        status, raw, _ = self.request("/api/experiments", {"requirements": {"tip_force_N": 10000}})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["exports"], [])
        status, raw, _ = self.request("/api/evaluate", {"section": {"shape": "rectangle", "width_mm": 30, "height_mm": 30}})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["evaluation"]["passes_declared_screens"])

    def test_invalid_requests_are_not_successful(self):
        cases = [{"material_id": "missing"}, {"requirements": {"tip_force_N": True}}, {"requirements": {"extra": 1}}, {"search": {"step_mm": 0.001}}]
        for body in cases:
            self.assertEqual(self.request("/api/experiments", body)[0], 400)
        self.assertEqual(self.request("/api/experiments", raw=b'{"requirements":{"tip_force_N":NaN}}')[0], 400)
        self.assertEqual(self.request("/api/experiments", raw=b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/experiments", raw=b"x"*66000)[0], 413)

    def test_origin_host_and_path_guards(self):
        self.assertEqual(self.request("/api/bootstrap", headers={"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.request("/api/bootstrap", headers={"Host": "example.com"})[0], 403)
        for path in ["/.env", "/%2e%2e/.env", "/api/experiments/invalid/artifacts/.env", "/api/experiments/00000000-0000-0000-0000-000000000000"]:
            self.assertEqual(self.request(path)[0], 404)

    def test_proposal_validation_without_paid_calls(self):
        self.assertEqual(self.request("/api/proposals", {"max_candidates": 99})[0], 400)

    def test_generated_candidates_persist_as_downloadable_verified_geometry(self):
        class Fixture:
            def generate(self, prompt, schema, max_candidates):
                data = {"candidates": [{"name": "Fixture", "rationale": "Numerical fixture", "section": {"shape": "i", "width_mm": 30, "height_mm": 29.5, "flange_mm": 3, "web_mm": 2}}]}
                return Generation(data, "muse-spark-1.3", False, {}, "fixture")
        service = WorkbenchService(output_root=Path(self.temp.name)/"proposals", proposal_fn=lambda material, requirements, scenario, max_candidates: propose_and_evaluate(material, requirements, scenario, max_candidates, Fixture()))
        response = service.propose({})
        self.assertFalse(response["live"])
        self.assertFalse(response["meta_model_used"])
        name = response["candidates"][0]["stl_url"].split("/")[-1]
        from urllib.parse import unquote
        artifact = service.get_artifact(response["id"], unquote(name))
        self.assertTrue(artifact.read_text().startswith("solid"))
        saved = service.get_experiment(response["id"])
        self.assertEqual(saved["candidates"][0]["evaluation"]["volume_mm3"], 68100)
