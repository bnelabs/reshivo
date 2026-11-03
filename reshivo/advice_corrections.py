"""Correct a small set of observed wall-comparison and trade-off claims.

This phrase check does not validate acoustic advice or identify every misleading claim.
"""
import re


_MOUNT_CONTROL = re.compile(r"\b(?:mounting[- ]only|wall\s+(?:with|plus)\s+(?:the\s+)?mounting\s+(?:only|alone))\b", re.I)
_PANEL_CONTROL = re.compile(r"\b(?:panel[- ]only|sheet[- ]only|(?:panel|sheet)\s+without\s+(?:the\s+)?mounting)\b", re.I)
_CONTROL_ACTION = re.compile(r"\b(?:include|add|measure|test|compare|use|using|run)\b", re.I)
_UNCERTAIN = re.compile(r"\b(?:no|not|never|without|avoid|unless|if|whether|ask|suggest|consider|maybe|might|could|may|potentially|possible|unavailable|unknown)\b", re.I)
_NEGATED = re.compile(r"\b(?:no|not|never|cannot|can't|don't|doesn't|wouldn't|shouldn't|avoid)\b", re.I)

_CORRECTIONS = (
    (re.compile(r"\b(?:a\s+|the\s+)?sealed\s+decoupled\s+mounting\s+tests\s+how\s+much\s+of\s+the\s+result\s+comes\s+from\s+gaps\s+and\s+rigid\s+contact\s+(?:versus|vs\.?|rather\s+than)\s+the\s+(?:sheet|panel)\s+itself\b", re.I),
     "comparing the bare wall with the mounted panel can assess their combined change", True),
    (re.compile(r"\bthis\s+assembly\s+comparison\s+may\s+help\s+show\s+what\s+the\s+(?:sheet|panel)\s+adds\s+beyond\s+sealing\s+and\s+decoupling\b", re.I),
     "this assembly comparison can assess the combined change from the panel, mounting and sealing", True),
    (re.compile(r"\bre[- ]?measure\s+and\s+compare\s+against\s+(?:the\s+)?bare\s+wall\s+to\s+(?:separate|isolate|distinguish)\s+(?:the\s+)?mounting\s+effects?\s+from\s+(?:the\s+)?(?:sheet|panel)\s+effects?\b", re.I),
     "Re-measure the wall with the mounted panel against the bare wall to compare the combined change; separate mounting and panel effects require additional suitable controlled comparisons", True),
    (re.compile(r"\badd\s+(?:a\s+)?sealed[- ]versus[- ]unsealed[- ]joint\s+comparison\s+to\s+(?:separate|isolate|distinguish)\s+(?:the\s+)?panel\s+effect\s+from\s+(?:the\s+)?sealing\s+effect\b", re.I),
     "add a sealed-versus-unsealed-joint comparison with the same mounted panel to assess the change associated with joint sealing in that assembly", True),
    (re.compile(r"\badd\s+(?:a\s+)?with[- ]seal\s+versus\s+without[- ]seal\s+comparison\s+to\s+(?:separate|isolate|distinguish)\s+(?:the\s+)?panel\s+(?:effect|change)\s+from\s+(?:the\s+)?sealing\s*/\s*mounting\s+(?:effect|change)\b", re.I),
     "add a with-seal versus without-seal comparison with the same mounted panel to estimate the joint-sealing change", True),
    (re.compile(r"\bheated\s+equipment\s+and\s+energy\s+demand\s+are\s+higher\s+than\s+cold\s+pressing\b", re.I),
     "compare the equipment, energy, binder and curing costs for both routes", False),
    (re.compile(r"\bmodular\s+panels\s+can\s+contain\s+batch\s+variation\s+by\s+replacing\s+single\s+panels,\s+but\s+joints\s+must\s+be\s+detailed\s+to\s+avoid\s+leaks\b", re.I),
     "consider individually replaceable panels and detail the joints to address possible gaps", False),
)


def _strings(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in _strings(item)]
    return []


def _has_controls(value):
    # An independent mounting-only mention alone cannot isolate every effect or interaction.
    # Exempt only a direct instruction naming both controls, not a negated or conditional one.
    found = set()
    for text in _strings(value):
        for clause in re.split(r"[.!?;\n]", text):
            if _UNCERTAIN.search(clause) or not _CONTROL_ACTION.search(clause):
                continue
            if _MOUNT_CONTROL.search(clause):
                found.add('mount')
            if _PANEL_CONTROL.search(clause):
                found.add('panel')
    return found == {'mount', 'panel'}


def correct_specific_advice(value):
    """Return a copy with recognized unsupported two-condition claims corrected."""
    def visit(item, has_control=False):
        if isinstance(item, str):
            controlled = has_control or _has_controls(item)
            changed = False
            for pattern, replacement, needs_uncontrolled in _CORRECTIONS:
                if controlled and needs_uncontrolled:
                    continue
                before = item
                def replace(match):
                    prefix = item[max(0, match.start() - 100):match.start()]
                    clause = re.split(r"[.!?;\n]", prefix)[-1]
                    if _NEGATED.search(clause):
                        return match.group(0)
                    return (replacement[0].upper() + replacement[1:]
                            if match.group(0)[0].isupper() else replacement)
                item = pattern.sub(replace, item)
                changed |= item != before
            return item, changed
        if isinstance(item, list):
            # Steps within one plan can jointly describe an independent control.
            routes = any(isinstance(part, dict) and {'title', 'change', 'steps', 'check'}.issubset(part) for part in item)
            controlled = has_control or (not routes and _has_controls(item))
            result = [visit(part, controlled) for part in item]
            return [part for part, _ in result], any(changed for _, changed in result)
        if isinstance(item, dict):
            # Keep controls local to a route; a different route is not its control.
            is_route = {'title', 'change', 'steps', 'check'}.issubset(item)
            controlled = has_control or (is_route and _has_controls(item))
            result = {key: visit(part, controlled) for key, part in item.items()}
            return {key: part for key, (part, _) in result.items()}, any(changed for _, changed in result.values())
        return item, False

    return visit(value)
