from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

from reshivo.meta import MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError, ToolTurn


KEY = "fixture-private-key"


def tools():
    return [{"type": "function", "function": {
        "name": "check_mass", "description": "Check a stated mass calculation.", "strict": True,
        "parameters": {"type": "object", "properties": {"density": {"type": "number"}},
                       "required": ["density"], "additionalProperties": False},
    }}]


def call(identity="call-1", name="check_mass", arguments=' { "density" : 4.2 } '):
    return {"id": identity, "type": "function", "function": {"name": name, "arguments": arguments}}


def reply(calls=None, content=None, finish_reason="tool_calls"):
    message = {"role": "assistant", "content": content}
    if calls is not None:
        message["tool_calls"] = calls
    return {"id": "fixture-request", "choices": [{"finish_reason": finish_reason, "message": message}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20,
                      "invalid_boolean": True, "invalid_negative": -1, "invalid_float": 1.5}}


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class Transport:
    def __init__(self, data=None, raw=None, error=None):
        self.raw = raw if raw is not None else json.dumps(data).encode()
        self.error = error
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        self.timeout = timeout
        if self.error is not None:
            raise self.error
        return Reply(self.raw)


class MetaToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def client(self, transport, key=KEY, model="muse-spark-1.3"):
        return MetaClient(self.root, {"MODEL_API_KEY": key, "META_MODEL": model}, transport)

    def test_function_turn_preserves_transport_contract_without_executing_a_tool(self):
        transport = Transport(reply([call()], content="I will check the entered density."))
        messages = [{"role": "system", "content": "Use only the stated values."},
                    {"role": "user", "content": "Check this case."}]
        original = deepcopy(messages)
        result = self.client(transport).tool_turn(messages, tools())
        self.assertIsInstance(result, ToolTurn)
        self.assertTrue(result.live)
        self.assertEqual(result.model, "muse-spark-1.3")
        self.assertEqual(result.request_id, "fixture-request")
        self.assertGreaterEqual(result.elapsed_ms, 0)
        self.assertEqual(result.usage, {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20})
        self.assertEqual(result.message, {"role": "assistant", "content": "I will check the entered density.",
                                         "tool_calls": [call(arguments='{"density":4.2}')]})
        self.assertEqual(messages, original)
        self.assertEqual(len(transport.requests), 1)
        request = transport.requests[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["messages"], messages)
        self.assertEqual(payload["tools"], tools())
        self.assertEqual(payload["tool_choice"], "auto")
        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertEqual(payload["max_completion_tokens"], 6144)
        self.assertNotIn("response_format", payload)
        self.assertNotIn(KEY, request.data.decode())
        self.assertEqual(request.get_header("Authorization"), "Bearer " + KEY)
        self.assertEqual(transport.timeout, 50)

    def test_plain_final_content_is_supported_without_fabricated_calls(self):
        transport = Transport(reply(content="The checked result is ready.", finish_reason="stop"))
        result = self.client(transport).tool_turn([{"role": "user", "content": "Explain the result."}], tools())
        self.assertEqual(result.message, {"role": "assistant", "content": "The checked result is ready."})
        self.assertNotIn("tool_calls", result.message)

    def test_contributor_models_can_request_a_tool_turn(self):
        for model in ("muse-spark-1.3-contributor", "muse-spark-1.2-contributor"):
            with self.subTest(model=model):
                transport = Transport(reply([call()]))
                result = self.client(transport, model=model).tool_turn([{"role": "user", "content": "Check this case."}], tools())
                payload = json.loads(transport.requests[0].data)
                self.assertEqual(payload["model"], model)
                self.assertEqual(payload["reasoning_effort"], "low")
                self.assertEqual(result.model, model)
                self.assertEqual(result.message["tool_calls"][0]["function"]["name"], "check_mass")

    def test_complete_tool_history_is_sent_with_matching_results(self):
        messages = [{"role": "user", "content": "Check the case."},
                    {"role": "assistant", "content": None, "tool_calls": [call()]},
                    {"role": "tool", "tool_call_id": "call-1", "content": '{"mass":1.05}'}]
        transport = Transport(reply(content="Use the checked mass.", finish_reason="stop"))
        self.client(transport).tool_turn(messages, tools())
        sent = json.loads(transport.requests[0].data)["messages"]
        self.assertEqual(sent[1]["tool_calls"], [call(arguments='{"density":4.2}')])
        self.assertIsNone(sent[1]["content"])
        self.assertEqual(sent[2], messages[2])

    def test_unknown_duplicate_or_malformed_calls_fail_before_dispatch(self):
        cases = [[call(name="unlisted_function")], [call(), call()],
                 [call(identity=f"call-{index}") for index in range(5)],
                 [call(identity="")], [call(identity=" ")], [call(identity="x" * 65)],
                 [call(name="")], [call(name="check mass")],
                 [{**call(), "type": "custom"}], [{**call(), "extra": "unsupported"}],
                 [{"id": "call-1", "type": "function", "function": {"name": "check_mass"}}]]
        for rows in cases:
            with self.subTest(calls=rows), self.assertRaises(MetaValidationError):
                self.client(Transport(reply(rows))).tool_turn([{"role": "user", "content": "Check."}], tools())

    def test_arguments_must_be_bounded_finite_unambiguous_json_objects(self):
        cases = [None, {}, "not json", "[]", "null", "true", '{"density":NaN}',
                 '{"density":Infinity}', '{"nested":{"density":1e309}}',
                 '{"density":4,"density":5}', '{"nested":{"x":1,"x":2}}',
                 json.dumps({"text": "x" * 16384}), json.dumps({"text": "😀" * 5000}, ensure_ascii=False),
                 '{"nested":' + '[' * 34 + '0' + ']' * 34 + '}']
        for arguments in cases:
            with self.subTest(arguments=str(arguments)[:100]), self.assertRaises(MetaValidationError):
                self.client(Transport(reply([call(arguments=arguments)]))).tool_turn(
                    [{"role": "user", "content": "Check."}], tools())

    def test_refusal_cutoff_and_incomplete_responses_have_no_substitute(self):
        cases = [reply([call()], finish_reason="length"), reply(content="Blocked", finish_reason="content_filter"),
                 reply([], finish_reason="tool_calls"), reply(content=None, finish_reason="stop"),
                 reply(content=" ", finish_reason="stop"), reply([call()], finish_reason="stop"),
                 reply(content=["not plain text"], finish_reason="stop"), reply(content="x" * 16001, finish_reason="stop"),
                 {"choices": []}, {"choices": [{"message": {"role": "assistant", "content": "Missing reason"}}]},
                 {"choices": [reply(content="One", finish_reason="stop")["choices"][0]] * 2}]
        refused = reply([call()])
        refused["choices"][0]["message"]["refusal"] = "Cannot provide that response."
        cases.append(refused)
        wrong_role = reply([call()])
        wrong_role["choices"][0]["message"]["role"] = "tool"
        cases.append(wrong_role)
        for data in cases:
            with self.subTest(data=str(data)[:150]), self.assertRaises(MetaValidationError):
                self.client(Transport(data)).tool_turn([{"role": "user", "content": "Check."}], tools())
        for raw in (b"not json", b"\xff", b"[]", b'{"nested":' + b'[' * 1100 + b'0' + b']' * 1100 + b'}'):
            with self.subTest(raw=raw[:50]), self.assertRaises(MetaValidationError):
                self.client(Transport(raw=raw)).tool_turn([{"role": "user", "content": "Check."}], tools())

    def test_invalid_history_is_rejected_before_network_access(self):
        original = {"role": "assistant", "content": None, "tool_calls": [call()]}
        result = {"role": "tool", "tool_call_id": "call-1", "content": "{}"}
        cases = [None, [], [{"role": "user", "content": "Check."}] * 33,
                 [{"role": "user", "content": "x" * 40001}],
                 [{"role": "user", "content": ""}], [{"role": "user", "content": None}],
                 [{"role": "unknown", "content": "Check."}], [{"role": "user", "content": "Check.", "extra": True}],
                 [result], [original], [original, {"role": "user", "content": "Continue."}],
                 [original, {**result, "tool_call_id": "other"}], [original, result, result],
                 [original, result, original, result],
                 [{"role": "assistant", "content": "Text", "tool_calls": "invalid"}]]
        for messages in cases:
            transport = Transport(reply(content="Unused", finish_reason="stop"))
            with self.subTest(messages=str(messages)[:100]), self.assertRaises(MetaValidationError):
                self.client(transport).tool_turn(messages, tools())
            self.assertEqual(transport.requests, [])

    def test_response_cannot_reuse_a_completed_historical_call_id(self):
        messages = [{"role": "user", "content": "Check."},
                    {"role": "assistant", "content": None, "tool_calls": [call()]},
                    {"role": "tool", "tool_call_id": "call-1", "content": "{}"}]
        with self.assertRaises(MetaValidationError):
            self.client(Transport(reply([call()]))).tool_turn(messages, tools())

    def test_tool_definitions_request_bounds_and_token_limits_fail_locally(self):
        definitions = [None, [], tools() * 13, tools() * 2,
                       [{"type": "web_search"}],
                       [{"type": "function", "function": {"name": "a.b.c", "parameters": {"type": "object"}}}],
                       [{"type": "function", "function": {"name": "test", "parameters": {"type": "array"}}}],
                       [{"type": "function", "function": {"name": "test", "parameters": {"type": "object"}, "strict": 1}}]]
        for value in definitions:
            transport = Transport(reply([call()]))
            with self.subTest(tools=value), self.assertRaises(MetaValidationError):
                self.client(transport).tool_turn([{"role": "user", "content": "Check."}], value)
            self.assertEqual(transport.requests, [])
        for limit in (True, 0, -1, 8193, "6144"):
            transport = Transport(reply([call()]))
            with self.subTest(limit=limit), self.assertRaises(MetaValidationError):
                self.client(transport).tool_turn([{"role": "user", "content": "Check."}], tools(), max_completion_tokens=limit)
            self.assertEqual(transport.requests, [])
        transport = Transport(reply([call()]))
        with self.assertRaises(MetaValidationError):
            self.client(transport).tool_turn([{"role": "user", "content": "x" * 40000}] * 5, tools())
        self.assertEqual(transport.requests, [])
        with self.assertRaises(MetaValidationError):
            self.client(Transport(raw=b"x" * 512001)).tool_turn([{"role": "user", "content": "Check."}], tools())

    def test_four_calls_and_exact_argument_size_boundary_are_supported(self):
        arguments = json.dumps({"text": "x" * (16384 - len('{"text":""}'))}, separators=(",", ":"))
        self.assertEqual(len(arguments.encode()), 16384)
        rows = [call(identity=f"call-{index}", arguments=arguments) for index in range(4)]
        result = self.client(Transport(reply(rows))).tool_turn([{"role": "user", "content": "Check."}], tools())
        self.assertEqual(len(result.message["tool_calls"]), 4)
        self.assertEqual(result.message["tool_calls"][0]["function"]["arguments"], arguments)

    def test_credentials_never_enter_messages_outputs_or_error_details(self):
        for key in (KEY, 'fixture-"private"-key'):
            transport = Transport(reply([call()]))
            with self.assertRaises(MetaValidationError) as caught:
                self.client(transport, key=key).tool_turn([{"role": "user", "content": "Contains " + key}], tools())
            self.assertNotIn(key, str(caught.exception))
            self.assertEqual(transport.requests, [])
            with self.assertRaises(MetaValidationError) as caught:
                self.client(Transport(reply(content=key, finish_reason="stop")), key=key).tool_turn(
                    [{"role": "user", "content": "Check."}], tools())
            self.assertNotIn(key, str(caught.exception))

    def test_provider_errors_are_typed_without_remote_body_or_key(self):
        failures = [urllib.error.HTTPError("https://api.meta.ai/v1/chat/completions", 401, KEY, {}, io.BytesIO(KEY.encode())),
                    urllib.error.URLError(KEY), TimeoutError(KEY), OSError(KEY), ValueError(KEY)]
        for error in failures:
            with self.subTest(error=type(error).__name__), self.assertRaises(MetaAPIError) as caught:
                self.client(Transport(error=error)).tool_turn([{"role": "user", "content": "Check."}], tools())
            self.assertNotIn(KEY, str(caught.exception))
        for key, model in (("", "muse-spark-1.3"), (KEY, "unsupported-model")):
            transport = Transport(reply([call()]))
            with self.assertRaises(MetaConfigurationError):
                self.client(transport, key=key, model=model).tool_turn([{"role": "user", "content": "Check."}], tools())
            self.assertEqual(transport.requests, [])


if __name__ == "__main__":
    unittest.main()
