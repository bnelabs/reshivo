"""Local HTTP integration for project records, costs and masked provider settings."""

from copy import deepcopy
import http.client
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from reshivo.materials import ROOT
from reshivo.providers import CONFIG_NAME
from reshivo.server import MAX_BODY_BYTES, MAX_PROJECT_BODY_BYTES, build_server
from reshivo.service import WorkbenchService


_KEY = "http-fixture-private-key"


def cost_request(identifier="A"):
    quantities, energy, hours, count, mass = (
        (["30", "10", "2"], "18", "1.5", "16", "32") if identifier == "A"
        else (["34", "6", "2"], "22", "1.25", "14", "28")
    )
    return {
        "case_id": "floor-case", "configuration_id": identifier,
        "configuration_revision": "1", "current_configuration_revision": "1",
        "currency": "CU", "mass_basis": "dry", "product_basis": "floor mat",
        "functional_basis": "same-size mat under the same shop screen",
        "scope_basis": "materials, energy, direct labor, batch manufacturing charge",
        "materials": [{"id": name, "name": name, "quantity": quantity, "quantity_unit": "kg", "unit_price": price, "price_unit": "kg"}
                      for name, quantity, price in zip(("flake", "elastomer", "binder"), quantities, (".40", "1.20", "2.50"))],
        "process": {
            "energy": {"status": "known", "kwh": energy, "rate": ".15"},
            "labor": {"status": "known", "person_hours": hours, "rate": "12"},
            "other": {"status": "known", "charges": [{"id": "batch", "name": "manufacturing batch charge", "amount": "4"}]},
        },
        "output": {"mode": "actual", "acceptance_basis": "shop size/appearance only", "usable_count": count, "usable_mass_kg": mass},
    }


def trial_request():
    return {
        "case_id": "floor-case", "assessment_kind": "synthetic",
        "configurations": [{"id": "A", "revision": 1, "name": "Trial A",
                            "materials": [{"id": "flake", "name": "flake", "amount": "75", "unit": "mass_percent"}, {"id": "binder", "name": "binder", "amount": "25", "unit": "mass_percent"}],
                            "process": "Fixed documented P1", "geometry": "Fixed documented G1"}],
        "checks": [{"id": "recovery", "name": "Recovery", "unit": "%", "method": "REC-1", "minimum": "80", "maximum": None, "required": True},
                   {"id": "compression", "name": "Compression set", "unit": "%", "method": "SET-1", "minimum": None, "maximum": "15", "required": True}],
        "records": [{"id": "recovery-record", "case_id": "floor-case", "configuration_id": "A", "configuration_revision": 1,
                     "check_id": "recovery", "unit": "%", "method": "REC-1", "data_kind": "synthetic",
                     "conditions_confirmed": True, "readings": [{"value": "85", "reading_id": "R1"}]}],
    }


class ProjectWorkspaceAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "examples").mkdir()
        shutil.copyfile(ROOT / "examples/support-member.json", self.root / "examples/support-member.json")
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.outbound_patch = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Unexpected outbound provider request"))
        self.outbound = self.outbound_patch.start()
        self.intake = Mock(return_value={"result_kind": "project_intake", "reply": "Which mat use matters first?", "questions": ["Is the mat for cushioning or slip resistance?"], "live": False})
        self.service = WorkbenchService(root=self.root, intake_fn=self.intake,
                                        meta_status_fn=lambda: {"configured": False, "model": "fixture"})
        # These tests exercise the legacy local file-store adapter explicitly.
        self.server = build_server(port=0, service=self.service, web_root=self.root / "web", session_mode=False)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.outbound_patch.stop()
        self.environment.stop()
        self.temp.cleanup()

    def request(self, path, body=None, *, method=None, raw=None, headers=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method or ("POST" if data is not None else "GET"), path, body=data, headers=request_headers)
            response = connection.getresponse()
            payload = response.read()
            return response.status, json.loads(payload), dict(response.getheaders()), payload
        finally:
            connection.close()

    def save(self, provider="custom", **changes):
        body = {"provider": provider, "model": "fixture-model", "api_key": _KEY}
        if provider == "custom":
            body["base_url"] = "http://127.0.0.1:12345/v1"
        body.update(changes)
        return self.request("/api/inference/providers/save", body)

    def assert_masked(self, payload):
        self.assertNotIn(_KEY.encode(), payload)
        self.assertNotIn(b'"api_key"', payload)

    def test_provider_catalog_is_local_and_does_not_create_settings(self):
        status, result, headers, raw = self.request("/api/inference/providers")
        self.assertEqual(status, 200)
        self.assertEqual({row["id"] for row in result["catalog"]}, {"meta", "openrouter", "openai", "google", "anthropic", "nvidia", "deepseek", "custom"})
        self.assertEqual(result["settings"]["active_provider"], "meta")
        self.assertFalse(result["settings"]["configured"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertFalse((self.root / CONFIG_NAME).exists())
        self.assert_masked(raw)
        self.outbound.assert_not_called()

    def test_settings_save_masked_mode600_retains_key_without_remote_call(self):
        status, result, _, raw = self.save()
        self.assertEqual(status, 200)
        self.assertTrue(result["configured"])
        self.assertTrue(result["key_configured"])
        self.assertEqual(result["key_hint"], "••••••••")
        self.assert_masked(raw)
        self.assertEqual(stat.S_IMODE((self.root / CONFIG_NAME).stat().st_mode), 0o600)
        status, result, _, raw = self.save(api_key="", model="fixture-model-updated")
        self.assertEqual(status, 200)
        self.assertTrue(result["key_configured"])
        self.assertEqual(result["model"], "fixture-model-updated")
        self.assert_masked(raw)
        status, result, _, raw = self.request("/api/inference/providers")
        self.assertEqual(status, 200)
        self.assertEqual(result["settings"]["active_provider"], "custom")
        self.assert_masked(raw)
        self.outbound.assert_not_called()

    def test_saved_profiles_select_and_clear_without_exposing_secrets(self):
        self.assertEqual(self.save()[0], 200)
        self.assertEqual(self.save("anthropic")[0], 200)
        status, result, _, raw = self.request("/api/inference/providers/select", {"provider": "custom"})
        self.assertEqual(status, 200)
        self.assertEqual(result["active_provider"], "custom")
        self.assert_masked(raw)
        status, result, _, raw = self.request("/api/inference/providers/clear", {"provider": "anthropic"})
        self.assertEqual(status, 200)
        self.assertEqual(result["active_provider"], "custom")
        self.assertNotIn("anthropic", {profile["provider"] for profile in result["profiles"]})
        self.assert_masked(raw)
        status, result, _, raw = self.request("/api/inference/providers/clear", {})
        self.assertEqual(status, 200)
        self.assertEqual(result["active_provider"], "meta")
        self.assertFalse(result["configured"])
        self.assertFalse((self.root / CONFIG_NAME).exists())
        self.assert_masked(raw)
        self.outbound.assert_not_called()

    def test_invalid_settings_never_write_or_echo_the_supplied_key(self):
        for changes in ({"base_url": "http://example.invalid/v1"}, {"provider": "missing"}, {"api_key": _KEY + "\nheader"}):
            with self.subTest(changes=tuple(changes)):
                status, result, _, raw = self.save(**changes)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"]["code"], "provider_configuration")
                self.assert_masked(raw)
                self.assertFalse((self.root / CONFIG_NAME).exists())
        self.outbound.assert_not_called()

    def test_insecure_saved_file_fails_closed_over_http(self):
        self.assertEqual(self.save()[0], 200)
        (self.root / CONFIG_NAME).chmod(0o644)
        status, result, _, raw = self.request("/api/inference/providers")
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "provider_configuration")
        self.assert_masked(raw)
        self.outbound.assert_not_called()

    def test_valid_intake_reaches_only_injected_function(self):
        body = {"message": "I have mixed recycled flake and want a floor mat."}
        status, result, _, _ = self.request("/api/project/intake", body)
        self.assertEqual(status, 200)
        self.assertEqual(result["reply"], "Which mat use matters first?")
        self.intake.assert_called_once_with(body)
        self.outbound.assert_not_called()

    def test_invalid_intake_is_rejected_before_injected_function(self):
        for body in ({"message": True}, {"message": ""}, {"message": "Help", "unexpected": True},
                     {"message": "Help", "history": [{"role": "system", "content": "unsupported role"}]}):
            with self.subTest(body=body):
                status, result, _, _ = self.request("/api/project/intake", body)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"]["code"], "invalid_request")
        self.intake.assert_not_called()
        self.outbound.assert_not_called()

    def test_cost_http_preserves_exact_entered_scope_and_usable_output(self):
        status, result, _, _ = self.request("/api/project/manufacturing-cost", cost_request())
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
        self.assertEqual(result["unit_costs"]["per_usable_unit"], "3.35625")
        self.assertEqual(result["unit_costs"]["per_usable_kg"], "1.678125")
        self.assertEqual(result["physical_target_status"], "not_assessed")
        self.outbound.assert_not_called()

    def test_cost_comparison_http_can_reverse_the_batch_price_order(self):
        status, result, _, _ = self.request("/api/project/compare-costs", {"records": [cost_request("A"), cost_request("B")]})
        self.assertEqual(status, 200)
        self.assertTrue(result["comparable"])
        self.assertEqual(result["winners"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertEqual(result["results"][1]["costs"]["entered_scope_total"], "48.1")
        status, result, _, _ = self.request("/api/project/compare-costs", {"records": [], "unexpected": True})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")
        self.outbound.assert_not_called()

    def test_missing_required_property_prevents_all_entered_success_over_http(self):
        status, result, _, _ = self.request("/api/project/trial-records", trial_request())
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "valid")
        configuration = result["configurations"][0]
        self.assertEqual(configuration["state"], "missing_records")
        self.assertEqual({check["check_id"]: check["state"] for check in configuration["checks"]}, {"recovery": "entered_readings_in_range", "compression": "missing_records"})
        self.assertFalse(result["performance_verified"])
        self.assertFalse(configuration["physical_product_tested"])
        self.outbound.assert_not_called()

    def test_http_real_assessment_cannot_borrow_synthetic_check(self):
        request = trial_request()
        request["assessment_kind"] = "user_reported"
        status, result, _, _ = self.request("/api/project/trial-records", request)
        self.assertEqual(status, 200)
        self.assertEqual(result["configurations"][0]["state"], "missing_records")
        self.assertTrue(all(check["reading_count"] == 0 for check in result["configurations"][0]["checks"]))
        self.assertEqual(result["ignored_records"][0]["reason"], "other_data_kind")

    def test_larger_project_limit_is_scoped_to_record_endpoints(self):
        request = trial_request()
        request["records"][0]["readings"] = [{"value": "85", "reading_id": "reading-" + str(index) + "-" + "r" * 60} for index in range(1000)]
        raw = json.dumps(request).encode()
        self.assertGreater(len(raw), MAX_BODY_BYTES)
        self.assertLess(len(raw), MAX_PROJECT_BODY_BYTES)
        status, result, _, _ = self.request("/api/project/trial-records", raw=raw)
        self.assertEqual(status, 200)
        self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 1000)
        status, result, _, _ = self.request("/api/project/intake", raw=raw)
        self.assertEqual(status, 413)
        self.assertEqual(result["error"]["code"], "request_too_large")
        self.intake.assert_not_called()

    def test_project_record_endpoints_still_enforce_their_larger_limit(self):
        for path in ("/api/project/trial-records", "/api/project/compare-costs"):
            with self.subTest(path=path):
                status, result, _, _ = self.request(path, raw=b"{}", headers={"Content-Length": str(MAX_PROJECT_BODY_BYTES + 1)})
                self.assertEqual(status, 413)
                self.assertEqual(result["error"]["code"], "request_too_large")

    def test_new_mutation_endpoints_retain_loopback_origin_guards(self):
        status, result, _, _ = self.request("/api/inference/providers/save", {"provider": "custom"}, headers={"Origin": "https://example.invalid"})
        self.assertEqual(status, 403)
        self.assertEqual(result["error"]["code"], "forbidden_origin")
        self.assertFalse((self.root / CONFIG_NAME).exists())
        self.outbound.assert_not_called()


if __name__ == "__main__":
    unittest.main()
