import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

from rematter.materials import load_materials
from rematter.mechanics import Requirements
from rematter.meta import Generation, MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError, configuration, propose_and_evaluate


class FixedClient:
    def __init__(self, rows):
        self.rows = rows

    def generate(self, prompt, schema, max_candidates):
        return Generation({"candidates": self.rows}, "muse-spark-1.3", False, {}, "test-fixture")


def candidate(**changes):
    section = {"shape": "i", "width_mm": 30, "height_mm": 29.5, "flange_mm": 3, "web_mm": 2}
    section.update(changes)
    return {"name": "Test geometry", "rationale": "A numerical fixture", "section": section}


class GenerationTransport:
    def __init__(self):
        self.requests = []
        self.timeout = None
        self.read_limit = None

    def open(self, request, timeout):
        self.requests.append(request)
        self.timeout = timeout
        transport = self

        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def read(self, size=-1):
                transport.read_limit = size
                return super().read(size)

        return Reply(json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]}).encode())


class MetaTests(unittest.TestCase):
    def test_default_reasoning_keeps_the_bounded_transport_contract(self):
        transport = GenerationTransport()
        key = "fixture-generation-key"
        with tempfile.TemporaryDirectory() as temp:
            result = MetaClient(Path(temp), {"MODEL_API_KEY": key}, transport).generate("Check this case", {}, 1)
        self.assertTrue(result.live)
        self.assertEqual(result.data, {})
        self.assertEqual(len(transport.requests), 1)
        request = transport.requests[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertEqual(payload["max_completion_tokens"], 4096)
        self.assertEqual(transport.timeout, 50)
        self.assertEqual(transport.read_limit, 512_001)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + key)
        self.assertNotIn(key, request.data.decode())

    def test_explicit_supported_reasoning_reaches_the_request_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            for effort in ("low", "medium", "high"):
                transport = GenerationTransport()
                with self.subTest(reasoning_effort=effort):
                    MetaClient(Path(temp), {"MODEL_API_KEY": "fixture-generation-key"}, transport).generate(
                        "Check this case", {}, 1, reasoning_effort=effort)
                    self.assertEqual(len(transport.requests), 1)
                    self.assertEqual(json.loads(transport.requests[0].data)["reasoning_effort"], effort)

    def test_invalid_reasoning_is_rejected_before_http(self):
        invalid = (None, True, False, 0, 1.0, [], {}, (), b"high", "", "LOW", " high", "high ", "maximum")
        with tempfile.TemporaryDirectory() as temp:
            for effort in invalid:
                transport = GenerationTransport()
                client = MetaClient(Path(temp), {"MODEL_API_KEY": "fixture-generation-key"}, transport)
                with self.subTest(reasoning_effort=effort), self.assertRaises(MetaValidationError):
                    client.generate("Check this case", {}, 1, reasoning_effort=effort)
                self.assertEqual(transport.requests, [])

    def test_local_configuration_and_environment_precedence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/".env").write_text('MODEL_API_KEY="local-test-value"\nMETA_MODEL=muse-spark-1.3\nOTHER=unused\n')
            self.assertEqual(configuration(root, {}), ("local-test-value", "muse-spark-1.3"))
            self.assertEqual(configuration(root, {"MODEL_API_KEY": "environment-test"})[0], "environment-test")
            with self.assertRaises(MetaConfigurationError):
                MetaClient(root, {"MODEL_API_KEY": ""}).generate("", {}, 1)

    def test_proposals_are_calculated_and_fixture_is_not_live(self):
        response = propose_and_evaluate(load_materials()[0], Requirements(), client=FixedClient([candidate(), candidate(height_mm=10, flange_mm=2)]))
        self.assertFalse(response["live"])
        self.assertTrue(response["candidates"][0]["evaluation"]["passes_declared_screens"])
        self.assertFalse(response["candidates"][1]["evaluation"]["passes_declared_screens"])
        self.assertIn("deflection_target", response["candidates"][1]["evaluation"]["failed_screens"])

    def test_invalid_geometry_is_retained_as_rejected(self):
        result = propose_and_evaluate(load_materials()[0], Requirements(), client=FixedClient([candidate(flange_mm=20)]))
        row = result["candidates"][0]
        self.assertEqual(row["outline"], [])
        self.assertEqual(row["evaluation"]["failed_screens"], ["invalid_geometry"])

    def test_unknown_schema_nonfinite_and_excess_count_rejected(self):
        material = load_materials()[0]
        for row in [candidate(width_mm=float("nan")), {**candidate(), "chemistry": "unsupported"}, candidate(width_mm=True)]:
            with self.assertRaises(MetaValidationError):
                propose_and_evaluate(material, Requirements(), client=FixedClient([row]))
        with self.assertRaises(MetaValidationError):
            propose_and_evaluate(material, Requirements(), max_candidates=1, client=FixedClient([candidate(), candidate()]))

    def test_http_failure_does_not_echo_remote_credentials(self):
        class Broken:
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 401, "test", {}, io.BytesIO(b"private remote content"))
        with tempfile.TemporaryDirectory() as temp:
            client = MetaClient(Path(temp), {"MODEL_API_KEY": "private-test-value"}, Broken())
            with self.assertRaises(MetaAPIError) as caught:
                client.generate("", {}, 1)
            self.assertNotIn("private", str(caught.exception))
            self.assertIn("401", str(caught.exception))

    def test_empty_and_truncated_responses_are_rejected(self):
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Transport:
            def __init__(self, data): self.data = data
            def open(self, req, timeout): return Reply(json.dumps(self.data).encode())
        replies = [{"choices": []}, {"choices": [{"message": {"content": ""}}]}, {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}]
        with tempfile.TemporaryDirectory() as temp:
            for reply in replies:
                with self.assertRaises(MetaValidationError):
                    MetaClient(Path(temp), {"MODEL_API_KEY": "test-value"}, Transport(reply)).generate("", {}, 1)
