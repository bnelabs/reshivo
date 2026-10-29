"""Bounded geometry proposals with independent local calculation."""
from dataclasses import asdict, dataclass
import json
import math
import os
from pathlib import Path
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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def finite_json(text):
    try:
        return json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise MetaValidationError("Meta returned invalid or non-finite JSON") from None


class MetaClient:
    def __init__(self, root=ROOT, environ=None, opener=None):
        self.key, self.model = configuration(root, environ)
        self.opener = opener or urllib.request.build_opener(NoRedirect)

    def generate(self, prompt, schema, max_candidates):
        if not self.key:
            raise MetaConfigurationError("Meta is not connected. Set MODEL_API_KEY in the local .env file.")
        if self.model not in {"muse-spark-1.3", "muse-spark-1.2", "muse-wonder-1.0"}:
            raise MetaConfigurationError("Choose a supported standard-mode Meta reasoning model.")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You propose bounded mechanical geometry candidates. Numerical code determines their performance. Never invent measured material properties, chemical recipes, experimental validation or scientific novelty. Do not claim design-code compliance, certification, service qualification or manufacturing readiness. These are declared numerical screens only."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_schema", "json_schema": {"name": "geometry_candidates", "strict": True, "schema": schema}},
            "max_completion_tokens": 4096,
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
            raise MetaAPIError(f"Meta request failed with HTTP {code}. No substitute response was generated.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise MetaAPIError("Meta could not be reached within the request limit. No substitute response was generated.") from None
        if len(raw) > 512_000:
            raise MetaValidationError("Meta response exceeded the size limit")
        body = finite_json(raw)
        if not isinstance(body, dict):
            raise MetaValidationError("Meta returned an invalid response envelope")
        try:
            choice = body["choices"][0]
            if choice.get("finish_reason") == "length":
                raise MetaValidationError("Meta reached its output limit; request fewer candidates")
            message = choice["message"]
            if message.get("refusal"):
                raise MetaValidationError("Meta did not provide geometry candidates")
            content = message["content"]
            if not isinstance(content, str) or not content.strip():
                raise MetaValidationError("Meta returned no candidate content")
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
        raise MetaValidationError("Request one to six candidates")
    state = material.scenario(scenario_name)
    prompt = json.dumps({
        "task": f"Propose up to {max_candidates} distinct support-member cross sections. Seek small material volume while meeting the declared bending screens. Include a conservative option and lighter alternatives. Use the same fixed interface width. Rectangles need null flange/web; I-sections need positive flange/web, twice flange < height, web <= width. Geometry will be evaluated; do not put predicted performance into the response.",
        "material_condition": material.id,
        "material_inputs": state,
        "requirements": asdict(requirements),
        "physics": "Cross-section XY, span +Z, transverse tip load Y. A rectangle has I=width*height^3/12. Symmetric I-section has I=(width*height^3-(width-web)*(height-2*flange)^3)/12. Tip deflection=force*span^3/(3*E*I), root stress=force*span*height/(2*I). Dimensions in mm, force N, E and stress MPa.",
        "scope": "Homogeneous linear bending only. Local buckling, creep, fatigue, joints and manufacture are unverified. Report geometric rationale only, no physical validation claim.",
    })
    generated = (client or MetaClient()).generate(prompt, proposal_schema(max_candidates), max_candidates)
    data = generated.data
    if not isinstance(data, dict) or set(data) != {"candidates"}:
        raise MetaValidationError("Meta response does not match the candidate schema")
    rows = data["candidates"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= max_candidates:
        raise MetaValidationError("Meta returned an invalid candidate count")
    candidates = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {"name", "rationale", "section"}:
            raise MetaValidationError("Meta returned unsupported candidate fields")
        if not isinstance(row["name"], str) or not 1 <= len(row["name"]) <= 100 or not isinstance(row["rationale"], str) or len(row["rationale"]) > 2000:
            raise MetaValidationError("Meta returned invalid candidate text")
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
        "limits": ["Generated proposals are evaluated by a bending-only model, not physically tested.", "Generated explanations are unverified and cannot establish code compliance or certification.", "Comparison with exhaustive search is a reference, not a matched-budget AI-advantage claim.", "Material composition and independent batch reliability are not inferred."],
    }
