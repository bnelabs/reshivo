import base64
import io
import json
from pathlib import Path
import socket
import ssl
import stat
import tempfile
import threading
import traceback
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch
import urllib.error

from rematter.meta import MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError
from rematter.providers import (CONFIG_NAME, ProviderConfigurationError, clear_provider_settings,
                                load_provider_profile, provider_catalog, provider_settings,
                                save_provider_settings, select_provider_settings)


KEY = "fixture-private-provider-key"
CAPS = {"vision": True, "tool_calls": True, "structured_output": "json_schema", "reasoning": False}
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["answer"],
          "properties": {"answer": {"type": "number", "minimum": 1, "maximum": 10}}}
TOOLS = [{"type": "function", "function": {"name": "check_mass", "description": "Check entered density readings.",
          "strict": True, "parameters": {"type": "object", "additionalProperties": False,
          "required": ["volume"], "properties": {"volume": {"type": "number", "minimum": 1}}}}}]
MESSAGES = [{"role": "system", "content": "Use the supplied tools."}, {"role": "user", "content": "Check this case."}]


def reply(data=None, reason="stop"):
    return {"id": "response-1", "choices": [{"finish_reason": reason,
            "message": {"role": "assistant", "content": json.dumps({"answer": 2} if data is None else data)}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}}


def native_reply(provider, data=None, **changes):
    text = json.dumps({"answer": 2} if data is None else data)
    if provider == "google":
        result = {"responseId": "native-1", "candidates": [{"finishReason": "STOP", "content": {
            "role": "model", "parts": [{"text": text}]}}],
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2, "totalTokenCount": 5}}
    else:
        result = {"id": "native-1", "role": "assistant", "stop_reason": "end_turn", "content": [{"type": "text", "text": text}],
                  "usage": {"input_tokens": 3, "output_tokens": 2}}
    result.update(changes)
    return result


class Transport:
    def __init__(self, *bodies):
        self.bodies = list(bodies)
        self.requests = []
        self.timeouts = []
        self.read_limits = []

    def open(self, request, timeout):
        self.requests.append(request)
        self.timeouts.append(timeout)
        body = self.bodies.pop(0)
        if isinstance(body, Exception):
            raise body
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        owner = self

        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def read(self, size=-1):
                owner.read_limits.append(size)
                return super().read(size)
        return Response(raw)


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def settings(self, provider_id, **changes):
        data = {"provider": provider_id, "model": "fixture-model", "api_key": KEY, "capabilities": dict(CAPS)}
        if provider_id == "deepseek":
            data["capabilities"]["structured_output"] = "json_object"
        if provider_id == "custom":
            data["base_url"] = "http://127.0.0.1:1234/v1"
        data.update(changes)
        return save_provider_settings(data, self.root, {})

    def client(self, provider, *bodies, **changes):
        self.settings(provider, **changes)
        transport = Transport(*bodies)
        return MetaClient(self.root, {}, transport), transport

    def test_catalog_has_every_requested_provider_with_conservative_model_flags(self):
        rows = {row["id"]: row for row in provider_catalog()}
        self.assertEqual(set(rows), {"meta", "openrouter", "openai", "google", "anthropic", "nvidia", "deepseek", "custom"})
        for identity, row in rows.items():
            if identity != "meta":
                self.assertEqual(row["default_model"], "")
                self.assertFalse(row["defaults"]["vision"])
                self.assertFalse(row["defaults"]["tool_calls"])
                self.assertEqual(row["defaults"]["structured_output"], "none")

    def test_legacy_meta_stays_default_without_changing_the_env_file(self):
        original = "MODEL_API_KEY=fixture-legacy-key\nMETA_MODEL=muse-spark-1.2\n"
        (self.root / ".env").write_text(original)
        with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("No network on settings")):
            status = provider_settings(self.root, {})
        self.assertEqual(status["provider"], "meta")
        self.assertTrue(status["configured"])
        self.assertEqual(status["source"], "local_env")
        self.assertNotIn("fixture-legacy-key", json.dumps(status))
        self.assertEqual((self.root / ".env").read_text(), original)
        self.assertFalse((self.root / CONFIG_NAME).exists())

    def test_save_select_and_clear_keep_profiles_and_mask_all_keys(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("No network on settings")):
            self.settings("google")
            self.settings("anthropic", api_key="fixture-other-private-key")
            status = select_provider_settings("google", self.root, {})
        self.assertEqual(status["provider"], "google")
        self.assertEqual({p["provider"] for p in status["profiles"]}, {"meta", "google", "anthropic"})
        self.assertNotIn(KEY, json.dumps(status))
        self.assertNotIn("fixture-other-private-key", json.dumps(status))
        self.assertEqual(stat.S_IMODE((self.root / CONFIG_NAME).stat().st_mode), 0o600)
        self.assertNotIn(KEY, repr(load_provider_profile(self.root, {})))
        self.settings("google", api_key="")
        self.assertEqual(load_provider_profile(self.root, {}).api_key, KEY)
        status = clear_provider_settings("anthropic", self.root, {})
        self.assertEqual(status["provider"], "google")
        self.assertNotIn("anthropic", {p["provider"] for p in status["profiles"]})
        clear_provider_settings(root=self.root, environ={})
        self.assertFalse((self.root / CONFIG_NAME).exists())
        self.assertEqual(provider_settings(self.root, {})["source"], "local_env")

    def test_key_retention_requires_same_provider_and_same_endpoint(self):
        self.settings("google")
        self.settings("google", api_key="", base_url="https://generativelanguage.googleapis.com/v1")
        self.assertFalse(load_provider_profile(self.root, {}).api_key)
        self.settings("anthropic", api_key="")
        self.assertFalse(load_provider_profile(self.root, {}).api_key)
        self.settings("google")
        self.settings("google", api_key="", clear_api_key=True)
        self.assertFalse(load_provider_profile(self.root, {}).api_key)

    def test_first_explicit_meta_profile_can_retain_legacy_key(self):
        (self.root / ".env").write_text("MODEL_API_KEY=fixture-legacy-key\n")
        save_provider_settings({"provider": "meta", "model": "muse-spark-1.3"}, self.root, {})
        self.assertEqual(load_provider_profile(self.root, {}).api_key, "fixture-legacy-key")

    def test_unsafe_endpoints_and_invalid_settings_are_rejected(self):
        for endpoint in ("http://api.anthropic.com/v1", "https://user:pass@api.anthropic.com/v1", "https://api.anthropic.com/v1?api_key=bad",
                         "https://other.example/v1", "https://api.anthropic.com/v1#key", "https://api.anthropic.com/v1/../x",
                         "https://api.anthropic.com/%76%31", "https://api.anthropic.com:99999/v1", "https://api.anthropic.com/\nx"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ProviderConfigurationError):
                self.settings("anthropic", base_url=endpoint)
        for changes in ({"api_key": "key\nheader"}, {"provider": []}, {"model": "invalid model"},
                        {"capabilities": {"structured_output": []}}, {"capabilities": {"reasoning": True}},
                        {"protocol": "chat_completions"}, {"unknown": True}):
            with self.subTest(changes=changes), self.assertRaises(ProviderConfigurationError):
                self.settings("anthropic", **changes)
        with self.assertRaises(ProviderConfigurationError):
            self.settings("custom", base_url="http://192.168.1.2:1234/v1")

    def test_insecure_or_corrupt_saved_file_does_not_fall_back_silently(self):
        self.settings("google")
        path = self.root / CONFIG_NAME
        path.chmod(0o644)
        with self.assertRaises(ProviderConfigurationError):
            provider_settings(self.root, {})
        path.chmod(0o600)
        path.write_text('{"active_provider":"google","profiles":{}}')
        with self.assertRaises(MetaConfigurationError):
            MetaClient(self.root, {"MODEL_API_KEY": "fixture-valid-meta"})
        clear_provider_settings(root=self.root, environ={})
        self.assertFalse(path.exists())

    def test_profile_symlink_is_never_followed_for_read_save_or_clear(self):
        target = self.root / "keep.json"
        target.write_text("untouched")
        (self.root / CONFIG_NAME).symlink_to(target)
        for action in (lambda: provider_settings(self.root, {}), lambda: self.settings("google"),
                       lambda: clear_provider_settings(root=self.root, environ={})):
            with self.assertRaises(ProviderConfigurationError):
                action()
        self.assertEqual(target.read_text(), "untouched")

    def test_each_chat_provider_uses_its_endpoint_and_token_contract(self):
        endpoints = {"openrouter": "https://openrouter.ai/api/v1/chat/completions", "openai": "https://api.openai.com/v1/chat/completions",
                     "nvidia": "https://integrate.api.nvidia.com/v1/chat/completions", "deepseek": "https://api.deepseek.com/chat/completions",
                     "custom": "http://127.0.0.1:1234/v1/chat/completions"}
        for provider, endpoint in endpoints.items():
            with self.subTest(provider=provider):
                client, transport = self.client(provider, reply())
                result = client.generate("Check this case", SCHEMA, 1, reasoning_effort="high")
                request = transport.requests[0]
                body = json.loads(request.data)
                self.assertEqual(request.full_url, endpoint)
                self.assertEqual(request.get_header("Authorization"), "Bearer " + KEY)
                self.assertNotIn(KEY, request.data.decode())
                self.assertEqual(body["max_completion_tokens" if provider == "openai" else "max_tokens"], 4096)
                self.assertNotIn("reasoning_effort", body)
                self.assertEqual(result.provider, provider)
                self.assertIsNone(result.reasoning_effort)
                self.assertEqual(result.data, {"answer": 2})
                self.assertEqual(transport.read_limits, [512_001])
                if provider == "openrouter":
                    self.assertEqual(body["provider"], {"require_parameters": True, "allow_fallbacks": False})
                if provider == "deepseek":
                    self.assertEqual(body["thinking"], {"type": "disabled"})
                    self.assertEqual(body["response_format"], {"type": "json_object"})
                    self.assertIn("JSON Schema", body["messages"][0]["content"])

    def test_explicit_compatible_reasoning_controls_are_attributed(self):
        for provider in ("openai", "openrouter"):
            caps = {**CAPS, "reasoning": True}
            client, transport = self.client(provider, reply(), capabilities=caps)
            result = client.generate("Check this case", SCHEMA, 1, reasoning_effort="medium")
            body = json.loads(transport.requests[0].data)
            self.assertEqual(result.reasoning_effort, "medium")
            self.assertEqual(body["reasoning"] if provider == "openrouter" else body["reasoning_effort"],
                             {"effort": "medium"} if provider == "openrouter" else "medium")

    def test_native_structured_requests_and_images_use_native_fields(self):
        image = "data:image/png;base64," + base64.b64encode(b"fixture-image").decode()
        for provider in ("google", "anthropic"):
            with self.subTest(provider=provider):
                client, transport = self.client(provider, native_reply(provider))
                result = client.generate("Check this case", SCHEMA, 1, system_prompt="Bounded reports only.", image_data_url=image)
                request = transport.requests[0]
                body = json.loads(request.data)
                self.assertNotIn("response_format", body)
                self.assertNotIn("reasoning_effort", body)
                self.assertEqual(result.provider, provider)
                self.assertEqual(result.usage["total_tokens"], 5)
                self.assertEqual(result.data, {"answer": 2})
                if provider == "google":
                    self.assertTrue(request.full_url.endswith("/models/fixture-model:generateContent"))
                    self.assertEqual(request.get_header("X-goog-api-key"), KEY)
                    self.assertIsNone(request.get_header("Authorization"))
                    self.assertEqual(body["systemInstruction"], {"parts": [{"text": "Bounded reports only."}]})
                    self.assertEqual(body["generationConfig"]["responseJsonSchema"], SCHEMA)
                    self.assertEqual(body["contents"][0]["parts"][1]["inlineData"]["mimeType"], "image/png")
                else:
                    self.assertTrue(request.full_url.endswith("/messages"))
                    self.assertEqual(request.get_header("Anthropic-version"), "2026-10-21")
                    self.assertEqual(request.get_header("Authorization"), "Bearer " + KEY)
                    self.assertEqual(body["output_config"]["format"]["type"], "json_schema")
                    transformed = body["output_config"]["format"]["schema"]["properties"]["answer"]
                    self.assertNotIn("minimum", transformed)
                    self.assertIn('"minimum":1', transformed["description"])
                    self.assertEqual(body["messages"][0]["content"][1]["source"]["media_type"], "image/png")

    def test_native_workspace_header_is_optional_and_validated(self):
        client, transport = self.client("anthropic", native_reply("anthropic"), workspace_id="wrkspc_fixture")
        self.assertEqual(provider_settings(self.root, {})["workspace_id"], "wrkspc_fixture")
        client.generate("Check", SCHEMA, 1)
        self.assertEqual(transport.requests[0].get_header("Anthropic-workspace-id"), "wrkspc_fixture")
        for workspace in ("wrkspc_bad\nheader", "wrong-prefix", []):
            with self.subTest(workspace=workspace), self.assertRaises(ProviderConfigurationError):
                self.settings("anthropic", workspace_id=workspace)

    def test_request_size_and_nesting_are_bounded_before_network(self):
        client, transport = self.client("google")
        with self.assertRaises(MetaValidationError):
            client.generate("x" * 3_200_001, SCHEMA, 1)
        rule = {}
        for _ in range(55):
            rule = {"type": "array", "items": rule}
        with self.assertRaises(MetaValidationError):
            client.generate("Check", rule, 1)
        self.assertFalse(transport.requests)

    def test_native_tool_loop_keeps_ids_signatures_and_context_private(self):
        for provider in ("google", "anthropic"):
            if provider == "google":
                blocks = [{"thought": True, "text": "private native context"},
                          {"functionCall": {"id": "native-call", "name": "check_mass", "args": {"volume": 2}}, "thoughtSignature": "opaque-signature"}]
                first = native_reply(provider, candidates=[{"finishReason": "STOP", "content": {"role": "model", "parts": blocks}}])
            else:
                blocks = [{"type": "thinking", "thinking": "private native context", "signature": "opaque-signature"},
                          {"type": "tool_use", "id": "native-call", "name": "check_mass", "input": {"volume": 2}}]
                first = native_reply(provider, content=blocks, stop_reason="tool_use")
            client, transport = self.client(provider, first, native_reply(provider))
            first_turn = client.tool_turn(MESSAGES, TOOLS)
            self.assertEqual(set(first_turn.message), {"role", "content", "tool_calls"})
            self.assertNotIn("opaque-signature", json.dumps(first_turn.message))
            self.assertNotIn("private native context", json.dumps(first_turn.message))
            call_id = first_turn.message["tool_calls"][0]["id"]
            history = MESSAGES + [first_turn.message, {"role": "tool", "tool_call_id": call_id, "content": '{"mass":4}'}]
            client.tool_turn(history, TOOLS)
            first_body = json.loads(transport.requests[0].data)
            second_body = json.loads(transport.requests[1].data)
            if provider == "google":
                self.assertEqual(second_body["contents"][1]["parts"], blocks)
                self.assertEqual(second_body["contents"][2]["parts"][0]["functionResponse"], {"id": "native-call", "name": "check_mass", "response": {"mass": 4}})
                self.assertEqual(first_body["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"], TOOLS[0]["function"]["parameters"])
            else:
                self.assertEqual(call_id, "native-call")
                self.assertEqual(second_body["messages"][1]["content"], blocks)
                self.assertEqual(second_body["messages"][2]["content"][0]["tool_use_id"], call_id)
                self.assertEqual(first_body["tools"][0]["name"], "check_mass")

    def test_compatible_tool_reasoning_context_survives_normalized_arguments(self):
        call = {"id": "call-one", "type": "function", "function": {"name": "check_mass", "arguments": '{ "volume": 2 }'}}
        first = {"choices": [{"finish_reason": "tool_calls", "message": {"role": "assistant", "content": None,
                 "tool_calls": [call], "reasoning_details": [{"type": "reasoning.encrypted", "data": "opaque"}]}}]}
        client, transport = self.client("openrouter", first, reply())
        turn = client.tool_turn(MESSAGES, TOOLS)
        history = MESSAGES + [turn.message, {"role": "tool", "tool_call_id": "call-one", "content": "{}"}]
        client.tool_turn(history, TOOLS)
        self.assertNotIn("reasoning_details", turn.message)
        self.assertEqual(json.loads(transport.requests[1].data)["messages"][2]["reasoning_details"], [{"type": "reasoning.encrypted", "data": "opaque"}])

    def test_unknown_or_changed_native_history_stops_before_network(self):
        call = {"id": "missing", "type": "function", "function": {"name": "check_mass", "arguments": '{"volume":2}'}}
        history = MESSAGES + [{"role": "assistant", "content": None, "tool_calls": [call]},
                              {"role": "tool", "tool_call_id": "missing", "content": "{}"}]
        client, transport = self.client("google")
        with self.assertRaises(MetaConfigurationError):
            client.tool_turn(history, TOOLS)
        self.assertFalse(transport.requests)

    def test_missing_capabilities_stop_before_network(self):
        for operation in ("structured", "image", "tool"):
            client, transport = self.client("google", capabilities={})
            with self.subTest(operation=operation), self.assertRaises(MetaConfigurationError):
                if operation == "tool":
                    client.tool_turn(MESSAGES, TOOLS)
                else:
                    client.generate("Check", SCHEMA, 1, image_data_url="data:image/png;base64,eA==" if operation == "image" else None)
            self.assertFalse(transport.requests)

    def test_new_provider_responses_must_meet_original_schema_bounds(self):
        for provider in ("deepseek", "google", "anthropic"):
            body = reply({"answer": 99}) if provider == "deepseek" else native_reply(provider, {"answer": 99})
            client, transport = self.client(provider, body)
            with self.subTest(provider=provider), self.assertRaises(MetaValidationError):
                client.generate("Check", SCHEMA, 1)
            self.assertEqual(len(transport.requests), 1)

    def test_invalid_remote_output_is_rejected_without_private_details(self):
        cases = [b'{"choices":[],"private":"' + KEY.encode() + b'"}', b"x" * 512_001,
                 b'{"choices":NaN}', b'{"choices":[],"choices":[]}',
                 reply(reason="length"), reply(reason="content_filter")]
        for body in cases:
            client, transport = self.client("openai", body)
            with self.subTest(body_type=type(body).__name__), self.assertRaises(MetaValidationError) as caught:
                client.generate("Check", SCHEMA, 1)
            self.assertNotIn(KEY, str(caught.exception))
            self.assertEqual(len(transport.requests), 1)

    def test_credential_in_request_is_refused_before_network(self):
        client, transport = self.client("openai")
        with self.assertRaises(MetaValidationError):
            client.generate("Do not send " + KEY, SCHEMA, 1)
        self.assertFalse(transport.requests)

    def test_remote_http_body_and_connection_detail_do_not_leak_and_never_fall_back(self):
        (self.root / ".env").write_text("MODEL_API_KEY=fixture-valid-meta\n")
        failures = [urllib.error.HTTPError("https://remote/" + KEY, 401, KEY, {}, io.BytesIO(KEY.encode())),
                    urllib.error.URLError("private socket " + KEY), TimeoutError(KEY)]
        for failure in failures:
            client, transport = self.client("google", failure)
            with self.assertRaises(MetaAPIError) as caught:
                client.generate("Check", SCHEMA, 1)
            self.assertNotIn(KEY, str(caught.exception))
            self.assertEqual(len(transport.requests), 1)
            self.assertTrue(transport.requests[0].full_url.startswith("https://generativelanguage.googleapis.com/"))

    def test_connection_categories_are_safe_for_open_and_read_failures(self):
        failures = [
            (TimeoutError(KEY), "taking too long"),
            (socket.gaierror(-2, KEY), "could not find the server"),
            (ssl.SSLError(KEY), "secure connection failed"),
            (ConnectionResetError(KEY), "connection was reset"),
            (ConnectionRefusedError(KEY), "server refused the connection"),
            (OSError(KEY), "Could not reach"),
            (ValueError(KEY), "Could not reach"),
            (urllib.error.URLError("private " + KEY), "Could not reach"),
        ]

        class ReadFailure:
            def __init__(self, failure): self.failure = failure
            def open(self, request, timeout): return self
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): raise self.failure

        for failure, text in failures:
            for wrapped in (False, True):
                if wrapped and isinstance(failure, urllib.error.URLError):
                    continue
                error = urllib.error.URLError(failure) if wrapped else failure
                for phase in ("open", "read"):
                    with self.subTest(category=text, wrapped=wrapped, phase=phase):
                        client, transport = self.client("google", error)
                        if phase == "read":
                            client.transport.opener = ReadFailure(error)
                        with self.assertRaises(MetaAPIError) as caught:
                            client.generate("Check", SCHEMA, 1)
                        self.assertIn(text, str(caught.exception))
                        rendered = "".join(traceback.format_exception(caught.exception))
                        self.assertNotIn(KEY, rendered)
                        self.assertNotIn("private", rendered)

    def test_custom_local_service_can_run_without_a_key(self):
        client, transport = self.client("custom", reply(), api_key="")
        self.assertTrue(provider_settings(self.root, {})["configured"])
        self.assertFalse(provider_settings(self.root, {})["key_configured"])
        client.generate("Check", SCHEMA, 1)
        self.assertIsNone(transport.requests[0].get_header("Authorization"))

    def test_redirect_does_not_forward_key_or_retry(self):
        received = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(307)
                self.send_header("Location", "/credential-destination")
                self.end_headers()
            def log_message(self, *args):
                pass
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.settings("custom", base_url=f"http://127.0.0.1:{server.server_port}/v1")
            client = MetaClient(self.root, {})
            with self.assertRaises(MetaAPIError):
                client.generate("Check", SCHEMA, 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(received, [("/v1/chat/completions", "Bearer " + KEY)])


if __name__ == "__main__":
    unittest.main()
