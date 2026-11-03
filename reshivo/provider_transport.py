"""Bounded HTTP adapters and canonical conversation normalization."""
import base64
from collections import OrderedDict
import copy
import json
import math
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid

MAX_REQUEST_BYTES = 3_200_000
MAX_RESPONSE_BYTES = 512_000


class ProviderTransportError(Exception):
    pass


class ProviderResponseError(ValueError):
    pass


class ProviderCapabilityError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _connection_error_message(name, error):
    # Only allowlisted types affect the message; exception text is never included.
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, TimeoutError):
        return f"{name} is taking too long. Your inputs are still here; try again."
    if isinstance(reason, socket.gaierror):
        detail = "The network could not find the server."
    elif isinstance(reason, ssl.SSLError):
        detail = "The secure connection failed."
    elif isinstance(reason, ConnectionResetError):
        detail = "The connection was reset."
    elif isinstance(reason, ConnectionRefusedError):
        detail = "The server refused the connection."
    else:
        detail = ""
    return f"Could not reach {name}. " + (detail + " " if detail else "") + "Check the connection and try again."


def _json(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
        raise ProviderResponseError("The model request contains invalid or oversized JSON.") from None


def _parse(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
    except (TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
        raise ProviderResponseError("The model returned unreadable JSON or invalid numbers.") from None


def _secret(value, key):
    if not key:
        return False
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str) and key in item:
            return True
        if isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, (tuple, list)):
            pending.extend(item)
    return False


def _image(url):
    try:
        header, data = url.split(",", 1)
        mime = {"data:image/png;base64": "image/png", "data:image/jpeg;base64": "image/jpeg"}[header]
        base64.b64decode(data, validate=True)
    except (AttributeError, ValueError, KeyError):
        raise ProviderCapabilityError("Use a valid PNG or JPEG image, encoded as a data URL.") from None
    return mime, data


def _parts(content, protocol):
    if isinstance(content, str):
        return [{"text": content}] if protocol == "google_generate_content" else [{"type": "text", "text": content}]
    if content is None:
        return []
    if not isinstance(content, list):
        raise ProviderCapabilityError("Unsupported model message content.")
    result = []
    for part in content:
        if part.get("type") == "text":
            result.extend(_parts(part["text"], protocol))
        elif part.get("type") == "image_url":
            mime, data = _image(part["image_url"]["url"])
            result.append({"inlineData": {"mimeType": mime, "data": data}} if protocol == "google_generate_content"
                          else {"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}})
        else:
            raise ProviderCapabilityError("This model message contains an unsupported part.")
    return result


def _ints(values):
    return {key: value for key, value in values.items()
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0}


def _usage(native, protocol):
    if not isinstance(native, dict):
        return {}
    if protocol == "google_generate_content":
        names = {"promptTokenCount": "prompt_tokens", "candidatesTokenCount": "completion_tokens",
                 "totalTokenCount": "total_tokens", "thoughtsTokenCount": "reasoning_tokens",
                 "cachedContentTokenCount": "cached_tokens"}
        return _ints({names[key]: value for key, value in native.items() if key in names})
    values = _ints(native)
    if "input_tokens" in values:
        values["prompt_tokens"] = values["input_tokens"]
    if "output_tokens" in values:
        values["completion_tokens"] = values["output_tokens"]
    if "input_tokens" in values and "output_tokens" in values:
        values["total_tokens"] = values["input_tokens"] + values["output_tokens"]
    return values


def _schema_copy(schema):
    """Move API-unsupported bounds into descriptions; enforce the originals locally."""
    if not isinstance(schema, dict):
        raise ProviderCapabilityError("Structured output needs an object JSON schema.")
    removed = {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern", "format"}
    result = {}
    bounds = {}
    for name, value in schema.items():
        if name in removed:
            bounds[name] = value
        elif name in {"properties", "$defs", "definitions"}:
            result[name] = {key: _schema_copy(child) for key, child in value.items()}
        elif name in {"items", "additionalProperties"} and isinstance(value, dict):
            result[name] = _schema_copy(value)
        elif name in {"anyOf", "oneOf", "allOf"}:
            result[name] = [_schema_copy(child) for child in value]
        else:
            result[name] = copy.deepcopy(value)
    if bounds:
        result["description"] = (result.get("description", "") + " Required constraints: " + _json(bounds))[:6000]
    if result.get("type") == "object" or "properties" in result:
        result["additionalProperties"] = False
    return result


def validate_generated_json(value, schema):
    """Validate the bounded schema vocabulary used by this application's reports."""
    def valid(item, rule, depth=0):
        if depth > 32:
            return False
        if isinstance(rule, bool):
            return rule
        if not isinstance(rule, dict):
            return False
        if "$ref" in rule:
            ref = rule["$ref"]
            if not isinstance(ref, str) or not ref.startswith("#/"):
                return False
            resolved = schema
            try:
                for segment in ref[2:].split("/"):
                    resolved = resolved[segment.replace("~1", "/").replace("~0", "~")]
            except (KeyError, TypeError):
                return False
            if not valid(item, resolved, depth + 1):
                return False
        if "anyOf" in rule and not any(valid(item, child, depth + 1) for child in rule["anyOf"]):
            return False
        if "oneOf" in rule and sum(valid(item, child, depth + 1) for child in rule["oneOf"]) != 1:
            return False
        if "allOf" in rule and not all(valid(item, child, depth + 1) for child in rule["allOf"]):
            return False
        if "enum" in rule and not any(type(item) is type(option) and item == option for option in rule["enum"]):
            return False
        if "const" in rule and (type(item) is not type(rule["const"]) or item != rule["const"]):
            return False
        kinds = rule.get("type", [])
        kinds = [kinds] if isinstance(kinds, str) else kinds
        matches = {"null": item is None, "boolean": isinstance(item, bool), "object": isinstance(item, dict),
                   "array": isinstance(item, list), "string": isinstance(item, str),
                   "number": isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item),
                   "integer": isinstance(item, int) and not isinstance(item, bool)}
        if kinds and not any(matches.get(kind, False) for kind in kinds):
            return False
        if isinstance(item, dict):
            if not all(key in item for key in rule.get("required", [])):
                return False
            props = rule.get("properties", {})
            extra = rule.get("additionalProperties", True)
            for key, child in item.items():
                if key in props and not valid(child, props[key], depth + 1):
                    return False
                if key not in props and (extra is False or (isinstance(extra, dict) and not valid(child, extra, depth + 1))):
                    return False
        if isinstance(item, list):
            if len(item) < rule.get("minItems", 0) or len(item) > rule.get("maxItems", MAX_RESPONSE_BYTES):
                return False
            if rule.get("uniqueItems") and len({_json(child) for child in item}) != len(item):
                return False
            if "items" in rule and not all(valid(child, rule["items"], depth + 1) for child in item):
                return False
        if isinstance(item, str):
            if len(item) < rule.get("minLength", 0) or len(item) > rule.get("maxLength", MAX_RESPONSE_BYTES):
                return False
            if "pattern" in rule and re.search(rule["pattern"], item) is None:
                return False
        if isinstance(item, (float, int)) and not isinstance(item, bool):
            if not math.isfinite(item):
                return False
            for name, test in (("minimum", lambda bound: item >= bound), ("maximum", lambda bound: item <= bound),
                               ("exclusiveMinimum", lambda bound: item > bound), ("exclusiveMaximum", lambda bound: item < bound)):
                if name in rule and not test(rule[name]):
                    return False
            if "multipleOf" in rule:
                divisor = rule["multipleOf"]
                if divisor <= 0 or not math.isclose(item / divisor, round(item / divisor), rel_tol=1e-9, abs_tol=1e-9):
                    return False
        return True
    try:
        if not valid(value, schema):
            raise ProviderResponseError("The model's JSON did not match the required report format or bounds.")
    except (TypeError, ValueError, OverflowError, RecursionError, re.error):
        raise ProviderResponseError("The model's JSON did not match the required report format or bounds.") from None


class ProviderTransport:
    def __init__(self, profile, opener=None):
        self.profile = profile
        self.opener = opener or urllib.request.build_opener(NoRedirect)
        self._history = OrderedDict()
        self._call_map = {}

    def _remember(self, message, native, calls=None):
        rows = message.get("tool_calls") or []
        if not rows:
            return
        identity = tuple(row["id"] for row in rows)
        self._history[identity] = (_json(message), copy.deepcopy(native))
        if calls:
            for row, call in zip(rows, calls):
                self._call_map[row["id"]] = copy.deepcopy(call)
        while len(self._history) > 16:
            expired, _ = self._history.popitem(last=False)
            for call_id in expired:
                self._call_map.pop(call_id, None)

    def _cached(self, message):
        identity = tuple(call["id"] for call in message.get("tool_calls", []))
        cached = self._history.get(identity)
        if cached and cached[0] != _json(message):
            raise ProviderCapabilityError("A previous model tool turn was changed. Start a new conversation.")
        return copy.deepcopy(cached[1]) if cached else None

    def _native_messages(self, messages):
        protocol = self.profile.protocol
        system = []
        result = []
        for message in messages:
            role = message["role"]
            if role == "system":
                system.extend(_parts(message["content"], protocol))
                continue
            if role == "tool":
                call_id = message["tool_call_id"]
                if protocol == "anthropic_messages":
                    parts = [{"type": "tool_result", "tool_use_id": call_id, "content": message["content"]}]
                else:
                    call = self._call_map.get(call_id)
                    if not call:
                        raise ProviderCapabilityError("The native context for this tool call is missing. Start a new conversation.")
                    try:
                        answer = _parse(message["content"])
                    except ProviderResponseError:
                        answer = message["content"]
                    response = {"name": call["name"], "response": answer if isinstance(answer, dict) else {"result": answer}}
                    if call.get("id"):
                        response["id"] = call["id"]
                    parts = [{"functionResponse": response}]
                native_role = "user"
            else:
                native_role = "model" if protocol == "google_generate_content" and role == "assistant" else role
                parts = self._cached(message) if role == "assistant" and message.get("tool_calls") else None
                if parts is None:
                    if protocol == "google_generate_content" and message.get("tool_calls"):
                        raise ProviderCapabilityError("The signed native context for this tool call is missing. Start a new conversation.")
                    parts = _parts(message["content"], protocol)
                    for call in message.get("tool_calls", []):
                        parts.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"],
                                      "input": _parse(call["function"]["arguments"])})
            field = "parts" if protocol == "google_generate_content" else "content"
            if result and result[-1]["role"] == native_role:
                result[-1][field].extend(parts)
            else:
                result.append({"role": native_role, field: parts})
        return system, result

    def _prepare(self, payload):
        profile = self.profile
        caps = profile.capabilities
        has_image = any(isinstance(message.get("content"), list) and any(part.get("type") == "image_url" for part in message["content"])
                        for message in payload["messages"])
        if has_image and not caps["vision"]:
            raise ProviderCapabilityError("Image input is off for this model. Enable it only for a model that supports images.")
        if payload.get("tools") and not caps["tool_calls"]:
            raise ProviderCapabilityError("Function calling is off for this model. Choose a supporting model and enable it in connection settings.")
        output = payload.get("response_format")
        if output and caps["structured_output"] == "none":
            raise ProviderCapabilityError("Structured reports are off for this model. Enable its supported JSON mode in connection settings.")
        headers = {"Content-Type": "application/json"}
        if profile.api_key:
            headers["x-goog-api-key" if profile.protocol == "google_generate_content" else "Authorization"] = ("" if profile.protocol == "google_generate_content" else "Bearer ") + profile.api_key
        if profile.protocol == "chat_completions":
            body = copy.deepcopy(payload)
            if not caps["reasoning"]:
                body.pop("reasoning_effort", None)
            if profile.provider == "openrouter":
                body["provider"] = {"require_parameters": True, "allow_fallbacks": False}
                if caps["reasoning"]:
                    body["reasoning"] = {"effort": body.pop("reasoning_effort")}
            if profile.provider not in {"meta", "openai"}:
                body["max_tokens"] = body.pop("max_completion_tokens")
            if profile.provider == "deepseek":
                body["thinking"] = {"type": "disabled"}
                for tool in body.get("tools", []):
                    tool["function"].pop("strict", None)
            for message in body["messages"]:
                if message.get("tool_calls"):
                    cached = self._cached(message)
                    if isinstance(cached, dict):
                        message.update(cached)
            if output and caps["structured_output"] == "json_object":
                body["response_format"] = {"type": "json_object"}
                body["messages"].insert(0, {"role": "system", "content": "Return only a JSON object matching this JSON Schema: " + _json(output["json_schema"]["schema"])})
            return profile.base_url + "/chat/completions", headers, body
        system, messages = self._native_messages(payload["messages"])
        if profile.protocol == "anthropic_messages":
            headers["anthropic-version"] = "2026-10-21"
            if profile.workspace_id:
                headers["anthropic-workspace-id"] = profile.workspace_id
            body = {"model": profile.model, "max_tokens": payload["max_completion_tokens"], "messages": messages}
            if system:
                body["system"] = system
            if output:
                body["output_config"] = {"format": {"type": "json_schema", "schema": _schema_copy(output["json_schema"]["schema"])}}
            if payload.get("tools"):
                body["tools"] = [{"name": tool["function"]["name"], "description": tool["function"].get("description", ""),
                                  "input_schema": _schema_copy(tool["function"]["parameters"])} for tool in payload["tools"]]
                body["tool_choice"] = {"type": "auto"}
            return profile.base_url + "/messages", headers, body
        body = {"contents": messages, "generationConfig": {"maxOutputTokens": payload["max_completion_tokens"]}}
        if system:
            body["systemInstruction"] = {"parts": system}
        if output:
            body["generationConfig"].update({"responseMimeType": "application/json", "responseJsonSchema": output["json_schema"]["schema"]})
        if payload.get("tools"):
            body["tools"] = [{"functionDeclarations": [{"name": tool["function"]["name"], "description": tool["function"].get("description", ""),
                                                         "parametersJsonSchema": tool["function"]["parameters"]} for tool in payload["tools"]]}]
            body["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}
        model = profile.model.removeprefix("models/")
        return profile.base_url + "/models/" + urllib.parse.quote(model, safe="-._") + ":generateContent", headers, body

    def _normalize(self, body):
        protocol = self.profile.protocol
        if not isinstance(body, dict):
            raise ProviderResponseError("The model returned an incomplete response.")
        if protocol == "chat_completions":
            choices = body.get("choices")
            if isinstance(choices, list) and len(choices) == 1 and isinstance(choices[0], dict):
                message = choices[0].get("message")
                if isinstance(message, dict) and isinstance(message.get("tool_calls"), list):
                    extra = {key: copy.deepcopy(message[key]) for key in ("reasoning_content", "reasoning_details") if key in message}
                    canonical = {key: copy.deepcopy(message.get(key)) for key in ("role", "content", "tool_calls")}
                    for call in canonical["tool_calls"]:
                        call["function"]["arguments"] = _json(_parse(call["function"]["arguments"]))
                    self._remember(canonical, extra)
            return body
        calls = []
        text = []
        if protocol == "anthropic_messages":
            parts = body.get("content")
            if body.get("role") != "assistant" or not isinstance(parts, list):
                raise ProviderResponseError("The model returned an incomplete assistant response.")
            reason = {"end_turn": "stop", "stop_sequence": "stop", "tool_use": "tool_calls", "max_tokens": "length"}.get(body.get("stop_reason"), "unsupported")
            for part in parts:
                if not isinstance(part, dict):
                    raise ProviderResponseError("The model returned an invalid content block.")
                if part.get("type") == "text":
                    if not isinstance(part.get("text"), str):
                        raise ProviderResponseError("The model returned invalid text.")
                    text.append(part["text"])
                elif part.get("type") == "tool_use":
                    calls.append({"id": part.get("id"), "type": "function", "function": {"name": part.get("name"), "arguments": _json(part.get("input"))}})
                elif part.get("type") not in {"thinking", "redacted_thinking"}:
                    raise ProviderResponseError("The model returned an unsupported content block.")
            usage = _usage(body.get("usage"), protocol)
            native_calls = None
            request_id = body.get("id")
        else:
            candidates = body.get("candidates")
            if not isinstance(candidates, list) or len(candidates) != 1 or not isinstance(candidates[0], dict):
                raise ProviderResponseError("The model returned no single usable candidate.")
            candidate = candidates[0]
            content = candidate.get("content")
            if not isinstance(content, dict) or content.get("role") not in {None, "model"} or not isinstance(content.get("parts"), list):
                raise ProviderResponseError("The model returned incomplete native content.")
            parts = content["parts"]
            native_calls = []
            for part in parts:
                if not isinstance(part, dict):
                    raise ProviderResponseError("The model returned an invalid content part.")
                if "functionCall" in part:
                    call = part["functionCall"]
                    if not isinstance(call, dict):
                        raise ProviderResponseError("The model returned an invalid function call.")
                    call_id = "call_" + uuid.uuid4().hex
                    calls.append({"id": call_id, "type": "function", "function": {"name": call.get("name"), "arguments": _json(call.get("args", {}))}})
                    native_calls.append(call)
                elif "text" in part and not part.get("thought"):
                    if not isinstance(part["text"], str):
                        raise ProviderResponseError("The model returned invalid text.")
                    text.append(part["text"])
                elif not part.get("thought"):
                    raise ProviderResponseError("The model returned an unsupported content part.")
            reason = "tool_calls" if calls and candidate.get("finishReason") == "STOP" else {"STOP": "stop", "MAX_TOKENS": "length"}.get(candidate.get("finishReason"), "unsupported")
            usage = _usage(body.get("usageMetadata"), protocol)
            request_id = body.get("responseId")
        message = {"role": "assistant", "content": "\n".join(text) or None}
        if calls:
            message["tool_calls"] = calls
            self._remember(message, parts, native_calls)
        return {"id": request_id if isinstance(request_id, str) and len(request_id) <= 200 else None,
                "choices": [{"finish_reason": reason, "message": message}], "usage": usage}

    def request(self, payload, *, timeout=50, max_request_bytes=MAX_REQUEST_BYTES):
        pending = [(payload, 0)]
        while pending:
            value, depth = pending.pop()
            if depth > 48:
                raise ProviderResponseError("The model request exceeded the nesting limit.")
            if isinstance(value, dict):
                pending.extend((child, depth + 1) for child in value.values())
            elif isinstance(value, (list, tuple)):
                pending.extend((child, depth + 1) for child in value)
        if len(_json(payload).encode()) > max_request_bytes:
            raise ProviderResponseError("The model request exceeded the size limit.")
        endpoint, headers, body = self._prepare(payload)
        if _secret(body, self.profile.api_key):
            raise ProviderResponseError("Credentials must not be included in model messages or tool definitions.")
        raw_request = _json(body).encode()
        if len(raw_request) > max_request_bytes:
            raise ProviderResponseError("The model request exceeded the size limit.")
        request = urllib.request.Request(endpoint, data=raw_request, method="POST", headers=headers)
        name = self.profile.name
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            raise ProviderTransportError(f"{name} request failed (HTTP {code}). Check the connection settings and try again.") from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise ProviderTransportError(_connection_error_message(name, error)) from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ProviderResponseError(f"{name} response exceeded the size limit.")
        if self.profile.api_key and self.profile.api_key.encode() in raw:
            raise ProviderResponseError(f"{name} returned an unusable response.")
        parsed = _parse(raw)
        if _secret(parsed, self.profile.api_key):
            raise ProviderResponseError(f"{name} returned an unusable response.")
        try:
            return self._normalize(parsed)
        except (KeyError, IndexError, AttributeError, TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
            raise ProviderResponseError(f"{name} returned an incomplete or unsupported response.") from None
