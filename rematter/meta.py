"""Bounded model transport and independent geometry calculations."""
from dataclasses import asdict, dataclass
import json
import math
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

from .materials import ROOT
from .mechanics import Requirements, Section, evaluate

ENDPOINT = "https://api.meta.ai/v1/chat/completions"
DEFAULT_MODEL = "muse-spark-1.3"


class MetaConfigurationError(Exception):
    pass


class MetaAPIError(Exception):
    pass


class MetaValidationError(Exception):
    pass


def configuration(root=ROOT, environ=None):
    values = {}
    path = Path(root) / ".env"
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip().removeprefix("export ")
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() in {"MODEL_API_KEY", "META_API_KEY", "META_MODEL"}:
                values[name.strip()] = value.strip().strip("\"'")
    env = os.environ if environ is None else environ
    for name in ("MODEL_API_KEY", "META_API_KEY", "META_MODEL"):
        if name in env:
            values[name] = env[name]
    return values.get("MODEL_API_KEY") or values.get("META_API_KEY") or "", values.get("META_MODEL") or DEFAULT_MODEL


def meta_status():
    key, model = configuration()
    return {"configured": bool(key), "model": model}


@dataclass(frozen=True)
class Generation:
    data: dict
    model: str
    live: bool
    usage: dict
    request_id: str | None
    elapsed_ms: int = 0


@dataclass(frozen=True)
class ToolTurn:
    message: dict
    model: str
    live: bool
    usage: dict
    request_id: str | None
    elapsed_ms: int = 0


MAX_TOOL_ARGUMENT_BYTES = 16_384
MAX_TOOL_REQUEST_BYTES = 192 * 1024
MAX_TOOL_RESPONSE_BYTES = 512_000


def _tool_json(value, label, limit):
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    except (TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
        raise MetaValidationError(f"{label} must contain finite JSON values") from None
    if len(encoded) > limit:
        raise MetaValidationError(f"{label} exceeded the size limit")
    return encoded


def _contains_secret(value, secret):
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str) and secret in item:
            return True
        if isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, (list, tuple)):
            pending.extend(item)
    return False


def _tool_name(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", value) and value.count(".") <= 1


def _tool_definitions(tools):
    if not isinstance(tools, list) or not 1 <= len(tools) <= 12:
        raise MetaValidationError("Supply between one and twelve function tools")
    names = set()
    for tool in tools:
        if not isinstance(tool, dict) or set(tool) != {"type", "function"} or tool["type"] != "function":
            raise MetaValidationError("Use nested function-tool definitions")
        function = tool["function"]
        if not isinstance(function, dict) or set(function) - {"name", "description", "parameters", "strict"} or not {"name", "parameters"} <= set(function):
            raise MetaValidationError("A function tool needs its name and object parameters")
        name = function["name"]
        if not _tool_name(name) or name in names:
            raise MetaValidationError("Function tool names must be valid and unique")
        names.add(name)
        if not isinstance(function["parameters"], dict) or function["parameters"].get("type") != "object":
            raise MetaValidationError("Function parameters must use an object schema")
        if "description" in function and (not isinstance(function["description"], str) or len(function["description"]) > 4000):
            raise MetaValidationError("A function description must be text no longer than 4000 characters")
        if "strict" in function and not isinstance(function["strict"], bool):
            raise MetaValidationError("A function's strict flag must be boolean")
    return names


def _tool_arguments(raw):
    if not isinstance(raw, str):
        raise MetaValidationError("Tool arguments must be a JSON object string")
    try:
        if len(raw.encode()) > MAX_TOOL_ARGUMENT_BYTES:
            raise MetaValidationError("Tool arguments exceeded the size limit")

        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError()
                result[key] = value
            return result

        value = json.loads(raw, object_pairs_hook=unique_object,
                           parse_constant=lambda item: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict):
            raise ValueError()
        pending = [(value, 0)]
        while pending:
            item, depth = pending.pop()
            if depth > 32:
                raise ValueError()
            if isinstance(item, dict):
                pending.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
        return _tool_json(value, "Tool arguments", MAX_TOOL_ARGUMENT_BYTES).decode()
    except (ValueError, TypeError, OverflowError, RecursionError, UnicodeError):
        raise MetaValidationError("Tool arguments must be a bounded finite JSON object") from None


def _tool_calls(rows, names):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 4:
        raise MetaValidationError("Return between one and four function calls per turn")
    result = []
    identities = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"id", "type", "function"} or row["type"] != "function":
            raise MetaValidationError("The tool response contains an unsupported call")
        identity = row["id"]
        if not isinstance(identity, str) or not identity.strip() or len(identity) > 64 or identity in identities:
            raise MetaValidationError("Function calls need unique identifiers of at most 64 characters")
        identities.add(identity)
        function = row["function"]
        if not isinstance(function, dict) or set(function) != {"name", "arguments"}:
            raise MetaValidationError("The tool response contains an incomplete function call")
        if not _tool_name(function["name"]) or function["name"] not in names:
            raise MetaValidationError("The response named a function outside the supplied tool list")
        result.append({"id": identity, "type": "function", "function": {
            "name": function["name"], "arguments": _tool_arguments(function["arguments"]),
        }})
    return result


def _tool_messages(messages, names):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 32:
        raise MetaValidationError("Include between one and thirty-two tool-conversation messages")
    result = []
    pending = set()
    identities = set()
    for message in messages:
        if not isinstance(message, dict):
            raise MetaValidationError("Tool-conversation messages must be objects")
        role = message.get("role")
        allowed = {"role", "content"}
        if role == "assistant":
            allowed.add("tool_calls")
        elif role == "tool":
            allowed.add("tool_call_id")
        elif role not in ("system", "user"):
            raise MetaValidationError("Use system, user, assistant or tool conversation roles")
        if set(message) - allowed or not {"role", "content"} <= set(message):
            raise MetaValidationError("A tool-conversation message has unsupported fields")
        if pending and role != "tool":
            raise MetaValidationError("Return all pending tool results before continuing the conversation")
        content = message["content"]
        calls = message.get("tool_calls") if role == "assistant" else None
        if content is None:
            if not calls:
                raise MetaValidationError("Only an assistant tool call may have empty content")
        elif not isinstance(content, str) or len(content) > 40_000:
            raise MetaValidationError("Message content must be text no longer than 40000 characters")
        elif not content.strip() and role != "tool" and not calls:
            raise MetaValidationError("Conversation messages need content or an assistant function call")
        normalized = {"role": role, "content": content}
        if calls:
            normalized["tool_calls"] = _tool_calls(calls, names)
            for call in normalized["tool_calls"]:
                if call["id"] in identities:
                    raise MetaValidationError("A conversation cannot reuse a function-call identifier")
                identities.add(call["id"])
                pending.add(call["id"])
        elif role == "assistant" and calls is not None and calls != []:
            raise MetaValidationError("Assistant tool calls must be a list")
        if role == "tool":
            identity = message.get("tool_call_id")
            if not isinstance(identity, str) or identity not in pending:
                raise MetaValidationError("A tool result must answer a pending function call")
            pending.remove(identity)
            normalized["tool_call_id"] = identity
        result.append(normalized)
    if pending:
        raise MetaValidationError("Include a result for every pending function call")
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def finite_json(text):
    try:
        return json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise MetaValidationError("Meta's response could not be read or contains invalid numbers") from None


class MetaClient:
    def __init__(self, root=ROOT, environ=None, opener=None):
        self.key, self.model = configuration(root, environ)
        self.opener = opener or urllib.request.build_opener(NoRedirect)

    def tool_turn(self, messages, tools, *, max_completion_tokens=6144):
        if not self.key:
            raise MetaConfigurationError("Meta is not connected. Set MODEL_API_KEY in the local .env file.")
        if self.model not in {"muse-spark-1.3", "muse-spark-1.2", "muse-wonder-1.0"}:
            raise MetaConfigurationError("Choose a supported standard-mode Meta reasoning model.")
        if isinstance(max_completion_tokens, bool) or not isinstance(max_completion_tokens, int) or not 1 <= max_completion_tokens <= 8192:
            raise MetaValidationError("Set a completion limit between one and 8192 tokens")
        names = _tool_definitions(tools)
        payload = {"model": self.model, "messages": _tool_messages(messages, names), "tools": tools,
                   "tool_choice": "auto", "reasoning_effort": "low", "max_completion_tokens": max_completion_tokens}
        encoded = _tool_json(payload, "Tool request", MAX_TOOL_REQUEST_BYTES)
        if _contains_secret(payload, self.key):
            raise MetaValidationError("Credentials must not be included in conversation messages or tool definitions")
        request = urllib.request.Request(ENDPOINT, data=encoded, method="POST",
                                         headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        started = time.monotonic()
        try:
            with self.opener.open(request, timeout=50) as response:
                raw = response.read(MAX_TOOL_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            raise MetaAPIError(f"Meta request failed (HTTP {code}). Try again.") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise MetaAPIError("Could not reach Meta. Check the connection and try again.") from None
        if len(raw) > MAX_TOOL_RESPONSE_BYTES:
            raise MetaValidationError("Meta response exceeded the size limit")
        if self.key.encode() in raw:
            raise MetaValidationError("Meta returned an unusable response")
        try:
            body = finite_json(raw)
            if not isinstance(body, dict):
                raise MetaValidationError("Meta returned an incomplete tool response")
            if _contains_secret(body, self.key):
                raise MetaValidationError("Meta returned an unusable response")
            choices = body.get("choices")
            if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
                raise MetaValidationError("Meta returned an incomplete tool response")
            choice = choices[0]
            reason = choice.get("finish_reason")
            if reason == "length":
                raise MetaValidationError("Meta's response was cut short. Try a shorter brief or question.")
            if reason not in ("stop", "tool_calls"):
                raise MetaValidationError("Meta did not complete a usable tool response")
            message = choice.get("message")
            if not isinstance(message, dict) or message.get("role") != "assistant" or message.get("refusal"):
                raise MetaValidationError("Meta did not return a usable assistant response")
            content = message.get("content")
            if content is not None and (not isinstance(content, str) or len(content) > 16_000):
                raise MetaValidationError("Meta returned invalid or oversized assistant content")
            calls = message.get("tool_calls")
            normalized = {"role": "assistant", "content": content}
            if calls:
                if reason != "tool_calls":
                    raise MetaValidationError("Meta's completion reason did not match its function calls")
                normalized["tool_calls"] = _tool_calls(calls, names)
                historical_ids = {call["id"] for prior in payload["messages"]
                                  for call in prior.get("tool_calls", [])}
                if any(call["id"] in historical_ids for call in normalized["tool_calls"]):
                    raise MetaValidationError("Meta reused an earlier function-call identifier")
            elif reason != "stop" or not isinstance(content, str) or not content.strip() or calls not in (None, []):
                raise MetaValidationError("Meta returned an empty or incomplete assistant response")
        except (KeyError, TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
            raise MetaValidationError("Meta returned an incomplete tool response") from None
        source_usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        usage = {name: value for name, value in source_usage.items()
                 if isinstance(value, int) and not isinstance(value, bool) and value >= 0}
        identity = body.get("id")
        return ToolTurn(normalized, self.model, True, usage, identity if isinstance(identity, str) else None,
                        round((time.monotonic() - started) * 1000))

    def generate(self, prompt, schema, max_candidates, *, system_prompt=None, schema_name="geometry_candidates", max_completion_tokens=4096):
        if not self.key:
            raise MetaConfigurationError("Meta is not connected. Set MODEL_API_KEY in the local .env file.")
        if self.model not in {"muse-spark-1.3", "muse-spark-1.2", "muse-wonder-1.0"}:
            raise MetaConfigurationError("Choose a supported standard-mode Meta reasoning model.")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt or "You propose bounded mechanical geometry candidates. Numerical code determines their performance. Never invent measured material properties, chemical recipes, experimental validation or scientific novelty. Do not claim design-code compliance, certification, service qualification or manufacturing readiness. These checks cover only the specified bending model. Write short, plain design names and explain the geometry in everyday language. Avoid compliance jargon in user-facing explanations."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
            "max_completion_tokens": max_completion_tokens,
            "reasoning_effort": "low",
        }
        request = urllib.request.Request(ENDPOINT, data=json.dumps(payload, allow_nan=False).encode(), method="POST", headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        started = time.monotonic()
        try:
            with self.opener.open(request, timeout=50) as response:
                raw = response.read(512_001)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            raise MetaAPIError(f"Meta request failed (HTTP {code}). Try again.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise MetaAPIError("Could not reach Meta. Check the connection and try again.") from None
        if len(raw) > 512_000:
            raise MetaValidationError("Meta response exceeded the size limit")
        body = finite_json(raw)
        if not isinstance(body, dict):
            raise MetaValidationError("Meta's response could not be read")
        try:
            choice = body["choices"][0]
            if choice.get("finish_reason") == "length":
                raise MetaValidationError("Meta's response was cut short. Try a shorter brief or question.")
            message = choice["message"]
            if message.get("refusal"):
                raise MetaValidationError("Meta did not return a usable response")
            content = message["content"]
            if not isinstance(content, str) or not content.strip():
                raise MetaValidationError("Meta returned an empty response")
        except (KeyError, IndexError, TypeError):
            raise MetaValidationError("Meta returned an incomplete response") from None
        source_usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        usage = {name: value for name, value in source_usage.items() if isinstance(value, int) and not isinstance(value, bool) and value >= 0}
        identity = body.get("id")
        return Generation(finite_json(content), self.model, True, usage, identity if isinstance(identity, str) else None, round((time.monotonic()-started)*1000))


def proposal_schema(max_candidates):
    return {
        "type": "object", "additionalProperties": False, "required": ["candidates"],
        "properties": {"candidates": {"type": "array", "minItems": 1, "maxItems": max_candidates, "items": {
            "type": "object", "additionalProperties": False, "required": ["name", "rationale", "section"],
            "properties": {
                "name": {"type": "string"}, "rationale": {"type": "string"},
                "section": {"type": "object", "additionalProperties": False, "required": ["shape", "width_mm", "height_mm", "flange_mm", "web_mm"], "properties": {
                    "shape": {"type": "string", "enum": ["rectangle", "i"]},
                    "width_mm": {"type": "number"}, "height_mm": {"type": "number"},
                    "flange_mm": {"type": ["number", "null"]}, "web_mm": {"type": ["number", "null"]},
                }},
            },
        }}},
    }


def propose_and_evaluate(material, requirements, scenario_name="lower_sensitivity", max_candidates=4, client=None):
    if isinstance(max_candidates, bool) or not isinstance(max_candidates, int) or not 1 <= max_candidates <= 6:
        raise MetaValidationError("Request between 1 and 6 design ideas")
    state = material.scenario(scenario_name)
    prompt = json.dumps({
        "task": f"Propose up to {max_candidates} distinct support-member cross sections. Seek small material volume while meeting the selected bending checks. Include a conservative option and lighter alternatives. Use the same fixed interface width. Rectangles need null flange/web; I-sections need positive flange/web, twice flange < height, web <= width. Geometry will be evaluated; do not put predicted performance into the response.",
        "material_condition": material.id,
        "material_inputs": state,
        "requirements": asdict(requirements),
        "physics": "Cross-section XY, span +Z, transverse tip load Y. A rectangle has I=width*height^3/12. Symmetric I-section has I=(width*height^3-(width-web)*(height-2*flange)^3)/12. Tip deflection=force*span^3/(3*E*I), root stress=force*span*height/(2*I). Dimensions in mm, force N, E and stress MPa.",
        "scope": "Homogeneous linear bending only. Local buckling, creep, fatigue, joints and manufacture are unverified. Report geometric rationale only, no physical validation claim.",
    })
    generated = (client or MetaClient()).generate(prompt, proposal_schema(max_candidates), max_candidates)
    data = generated.data
    if not isinstance(data, dict) or set(data) != {"candidates"}:
        raise MetaValidationError("Meta's design response has an unexpected format")
    rows = data["candidates"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= max_candidates:
        raise MetaValidationError("Meta returned an unexpected number of design ideas")
    candidates = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {"name", "rationale", "section"}:
            raise MetaValidationError("Meta's design idea has unexpected fields")
        if not isinstance(row["name"], str) or not 1 <= len(row["name"]) <= 100 or not isinstance(row["rationale"], str) or len(row["rationale"]) > 2000:
            raise MetaValidationError("Meta's design name or explanation could not be used")
        dimensions = row["section"]
        keys = {"shape", "width_mm", "height_mm", "flange_mm", "web_mm"}
        if not isinstance(dimensions, dict) or set(dimensions) != keys or dimensions["shape"] not in {"rectangle", "i"}:
            raise MetaValidationError("Meta returned unsupported geometry")
        for key in keys - {"shape"}:
            value = dimensions[key]
            if value is None and key in {"flange_mm", "web_mm"}:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 1_000_000:
                raise MetaValidationError("Meta returned invalid geometry dimensions")
        try:
            section = Section(**dimensions)
            assessment = evaluate(section, requirements, state["modulus_MPa"], state["yield_stress_MPa"])
            outline = section.outline()
        except (ValueError, TypeError):
            assessment = {"passes_declared_screens": False, "failed_screens": ["invalid_geometry"]}
            outline = []
        candidates.append({"id": f"candidate-{index+1}", "name": row["name"], "rationale": row["rationale"], "section": dimensions, "outline": outline, "evaluation": assessment})
    return {
        "provider": "meta", "model": generated.model, "live": bool(generated.live),
        "usage": generated.usage, "request_id": generated.request_id, "elapsed_ms": generated.elapsed_ms,
        "material_id": material.id, "material_scenario": state, "requirements": asdict(requirements),
        "candidates": candidates,
        "limits": ["Each idea is checked with a bending model. No physical test has been performed.", "Model explanations are suggestions, not test results. A passing design still needs further engineering and physical testing.", "The comparison shows the full-grid search result. It does not show whether AI performs better with the same time or number of calculations.", "The model does not determine a material recipe or predict differences between recycled-material batches."],
    }
