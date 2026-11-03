"""Bounded local planning for an uncharacterized metal-particulate case."""

import re

_PARTICLES = r"(?:dust|powder|fines|filings|shavings|particulates?|particles?)"
_GENERIC_METAL = re.compile(rf"\b(?:metal|metallic)\b(?:[\s,\-]+[\w-]+){{0,3}}[\s,\-]+{_PARTICLES}\b", re.I)
_UNKNOWN_PARTICLE = re.compile(rf"\b(?:unknown|unidentified|uncharacteri[sz]ed|unspecified)\b.{{0,60}}\b{_PARTICLES}\b|\b{_PARTICLES}\b.{{0,45}}\b(?:identity|composition|type)\b.{{0,25}}\b(?:unknown|unidentified|unconfirmed|unspecified|not identified)\b", re.I)
_METAL = r"(?:copper|iron|steel|stainless|alumini?um|zinc|brass|bronze|nickel|titanium|magnesium|lead|tin|silver|gold|chromium|cobalt|manganese|tungsten|zamak)"
_IDENTIFIED = re.compile(rf"\b{_METAL}\s+(?:metal\s+)?{_PARTICLES}\b|\b(?:metal|metallic)\s+{_PARTICLES}\s*(?:,\s*)?(?:is|identified as|confirmed as|made of)\s+{_METAL}\b|\b{_PARTICLES}\s+(?:is|are|identified as|confirmed as|made of)\s+{_METAL}\b", re.I)
_METAL_REFERENCE = re.compile(rf"\b(?:metal|metallic|{_METAL})\b", re.I)
_REVERSE_METAL = re.compile(rf"\b{_PARTICLES}\b\s+(?:is|are|contains?|containing|with|mixed\s+with|may\s+contain|could\s+contain)\s+(?:(?:made\s+of|some|unknown|unidentified|unspecified|uncharacteri[sz]ed)\s+)?(?:metal|metallic|{_METAL})\b(?!\s+(?:wires?|cables?|sheets?|plates?|rods?|bars?|bolts?)\b)", re.I)
_FACILITY = re.compile(r"\b(?:i|we)\s+(?:already\s+)?(?:have|use|operate)\s+(?:access\s+to\s+)?(?:an?\s+)?(?:suitable|appropriate|controlled)\s+(?:industrial\s+)?(?:facility|plant|site)\b|\b(?:suitable|appropriate|controlled)\s+(?:industrial\s+)?(?:facility|plant|site)\s+(?:is|are)\s+(?:already\s+)?available\b", re.I)
_NEGATED_FACILITY = re.compile(r"\b(?:no|not|without|unavailable|unconfirmed|unknown|if|whether|might|could|would|need)\b", re.I)
_HOME = re.compile(r"\b(?:home|house|flat|apartment|garage|kitchen|residence)\b", re.I)
_ABSENT = re.compile(r"\b(?:no|without|not using|do not have|don't have)\s+(?:any\s+)?$", re.I)
_COUNTERWEIGHT = re.compile(r"\b(?:counterweight|counterweights|ballast)\b", re.I)


def _user_texts(case):
    """Collect current user-entered case facts; never inspect earlier model proposals."""
    if not isinstance(case, dict):
        return []
    texts = []
    for key in ("message", "question", "note"):
        value = case.get(key)
        if isinstance(value, str):
            texts.append(value)
    brief = case.get("brief")
    if isinstance(brief, dict):
        texts.extend(value for value in brief.values() if isinstance(value, str))
    reviewed = case.get("reviewed_draft")
    if isinstance(reviewed, dict):
        texts.extend(record.get("value") for record in reviewed.values()
                     if isinstance(record, dict) and isinstance(record.get("value"), str))
    history = case.get("history")
    if isinstance(history, list):
        texts.extend(row.get("content") for row in history if isinstance(row, dict)
                     and row.get("role") == "user" and isinstance(row.get("content"), str))
    context = case.get("calculation_context")
    if isinstance(context, dict):
        texts.extend(item.get("name") for item in context.get("components", [])
                     if isinstance(item, dict) and isinstance(item.get("name"), str))
    plan = case.get("plan")
    plan_case = plan.get("case") if isinstance(plan, dict) else None
    if isinstance(plan_case, dict):
        if isinstance(plan_case.get("process"), str):
            texts.append(plan_case["process"])
        texts.extend(item.get("name") for item in plan_case.get("components", [])
                     if isinstance(item, dict) and isinstance(item.get("name"), str))
    project = case.get("project_context")
    setups = project.get("configurations") if isinstance(project, dict) else None
    if isinstance(setups, list):
        current = {}
        for setup in setups:
            if not isinstance(setup, dict):
                continue
            identity, revision = setup.get("id"), setup.get("revision")
            if isinstance(identity, str) and isinstance(revision, int) and not isinstance(revision, bool):
                if identity not in current or revision > current[identity]["revision"]:
                    current[identity] = setup
        for setup in current.values():
            for field in ("process", "geometry"):
                if isinstance(setup.get(field), str):
                    texts.append(setup[field])
            texts.extend(item.get("name") for item in setup.get("materials", [])
                         if isinstance(item, dict) and isinstance(item.get("name"), str))
    return texts


def _positive_matches(pattern, text):
    return [match for match in pattern.finditer(text) if not _ABSENT.search(text[max(0, match.start()-30):match.start()])]


def needs_local_metal_planning(case):
    """Recognize a bounded set of uncharacterized metal-particle descriptions.

    This English-text recognizer cannot identify a material, guarantee safety or cover
    all wordings/languages. It defaults to planning only when location is absent.
    """
    texts = _user_texts(case)
    generic_matches = [(text, match) for text in texts for match in _positive_matches(_GENERIC_METAL, text)]
    identified_matches = [(text, match) for text in texts for match in _positive_matches(_IDENTIFIED, text)]
    unknown = any(_METAL_REFERENCE.search(match.group()) for text in texts for match in _positive_matches(_UNKNOWN_PARTICLE, text))
    reverse_matches = [(text, match) for text in texts for match in _positive_matches(_REVERSE_METAL, text)]
    if not (generic_matches or identified_matches or unknown or reverse_matches):
        return False
    # Identification must bind the specific mention, not a different named waste stream.
    unidentified = any(not any(item.start() <= match.start() and item.end() >= match.end()
                               for item in _IDENTIFIED.finditer(text)) for text, match in generic_matches + reverse_matches)
    facility = any(_FACILITY.search(text) and not _NEGATED_FACILITY.search(text) for text in texts)
    home = any(_HOME.search(text) for text in texts)
    return bool(unknown or unidentified or home or not facility)


def literal_particle_excerpt(text):
    """Return a literal, bounded particle phrase without manufacturing an identity."""
    if not isinstance(text, str):
        return None
    match = _GENERIC_METAL.search(text) or _REVERSE_METAL.search(text)
    if match is None:
        match = next((item for item in _UNKNOWN_PARTICLE.finditer(text) if _METAL_REFERENCE.search(item.group())), None)
    return match.group() if match else None


def local_metal_planning_guidance(case):
    """Return a local, useful planning response with no generated or fabricated facts."""
    brief = case.get("brief") if isinstance(case, dict) else None
    reviewed = case.get("reviewed_draft") if isinstance(case, dict) else None
    product_record = reviewed.get("product") if isinstance(reviewed, dict) else None
    product = (brief.get("product") if isinstance(brief, dict) else None) or (
        product_record.get("value") if isinstance(product_record, dict) else None) or (
        case.get("message", "") if isinstance(case, dict) else "")
    counterweight = bool(isinstance(product, str) and _COUNTERWEIGHT.search(product))
    if counterweight:
        first = ("On paper, outline the counterweight's shape and a possible containment interface. "
                 "Plan how the complete object could be supported for weighing; do not assume a scale is available.")
    else:
        first = ("On paper, outline the product's intended shape and how it would be installed or supported. "
                 "Where relevant, sketch how a separate containment interface could fit; do not handle the material.")
    answer = ("This is a local planning guide, not a tested recipe or a model-generated answer. "
              "Leave the material undisturbed where it is. If it is loose or open, leave it as-is; "
              "do not open, fill, pour, sweep, stir, blend, transfer or remove it at home.\n\n"
              + first + " If relevant to your product and suitable presealed units already exist, "
              "consider exchanging whole units without opening them. Otherwise plan without handling the material. "
              "Identify the metal and any plastic, and confirm a suitable facility before loose-material work.")
    steps = [first,
             "If relevant to your product and suitable presealed units already exist, compare whole-unit interfaces without opening them; otherwise leave the material undisturbed.",
             "If mass matters and a suitable scale is available, check its capacity and uncertainty; otherwise record the equipment and measurements still needed."]
    questions = ["What is the identity and form of the metal?",
                 "What are the identities of any plastic, binder or other components?",
                 "Are suitable presealed units and a facility for identification or handling already available?"]
    return {"result_kind": "local_planning_guidance", "origin": "local", "provider": "local",
            "model": "Local planning guide", "live": False, "answer": answer, "next_steps": steps,
            "questions": questions, "physical_product_tested": False, "performance_verified": False}


def local_metal_planning_message(case):
    """Explain a local-only route when an endpoint cannot return guidance directly."""
    guidance = local_metal_planning_guidance(case)
    return "No AI request was sent. " + guidance["answer"] + "\n\nQuestions to resolve: " + " ".join(guidance["questions"])
