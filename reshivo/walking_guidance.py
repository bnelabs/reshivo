"""Bounded recognition of instructions to put a person on a surface.

This English phrase check catches a specific observed failure; it cannot assess a
surface, understand every paraphrase or establish whether a proposed action is safe.
"""

import re


_ACTION = re.compile(
    r"\b(?:step(?:ping)?|walk(?:ing)?|stand(?:ing)?|tread(?:ding)?|stomp(?:ing)?|jump(?:ing)?|run(?:ning)?|hop(?:ping)?|climb(?:ing)?)"
    r"(?:\s+(?:carefully|gently|slowly|directly|briefly|lightly|barefoot|first|then|back|forward|right|firmly|fully|yourself|down|up|out|around|very|and)){0,5}"
    r"\s+(?:on|onto|upon|across|over|atop)\b",
    re.I,
)
_FOOT = re.compile(
    r"\b(?:put|place|plant|press|set|rest|shift)\s+(?:(?:your|a|one|both|the|their)\s+)?"
    r"(?:(?:full|whole|entire|body)\s+)?(?:foot|feet|shoe|shoes|body\s+weight|weight)(?:\s+down)?\s+(?:on|onto|over|across)\b",
    re.I,
)
_FEET = re.compile(
    r"\b(?:stand|standing|balance|balancing|hop|hopping|walk|walking|step|stepping)\s+(?:with|using)\s+"
    r"(?:(?:your|both|one|the)\s+){0,2}(?:foot|feet|shoe|shoes)\s+(?:on|onto|over|across)\b",
    re.I,
)
_WEIGHT = re.compile(
    r"\b(?:stand|standing|step|stepping|balance|balancing)\s+with\s+"
    r"(?:(?:your|one's|the|full|entire|body)\s+){0,3}(?:body\s+)?weight\s+(?:on|onto|upon|over)\b",
    re.I,
)
_TAKE_STEPS = re.compile(
    r"\b(?:take|taking)\s+(?:(?:a|some|few|several|small|slow|careful)\s+){0,4}steps?\s+(?:on|onto|across|over)\b",
    re.I,
)
_WALK_STEPS = re.compile(
    r"\b(?:walk|walking|take|taking)\s+(?:(?:a|some|few|several|small|slow|careful)\s+){1,4}steps?\s+(?:on|onto|across|over)\b",
    re.I,
)
_UNDERFOOT = re.compile(
    r"\b(?:test|try|feel|assess|inspect|check|evaluate)\b[^.!?\n]{0,60}"
    r"\b(?:underfoot|under\s+(?:your|the)\s+feet)\b",
    re.I,
)
_NEGATED = re.compile(
    r"\b(?:do\s+not|don't|never|avoid|refrain\s+from|without|must\s+not|should\s+not|shouldn't)"
    r"(?:\s+(?:ever|actually|directly|physically|intentionally|safely)){0,3}\s*$",
    re.I,
)
_ABSTRACT_STEP = re.compile(r"\b(?:choose|plan|write|identify|discuss|define)\s+(?:the\s+)?(?:next|first|following)\s*$", re.I)


def has_unsafe_walking_guidance(text):
    """Return true for recognized direct or suggested person-on-surface actions."""
    if not isinstance(text, str):
        return False
    for pattern in (_ACTION, _FOOT, _FEET, _WEIGHT, _TAKE_STEPS, _WALK_STEPS, _UNDERFOOT):
        for match in pattern.finditer(text):
            prefix = text[max(0, match.start() - 60):match.start()]
            if pattern is _ACTION and _ABSTRACT_STEP.search(prefix) and re.match(r"\s+paper\b", text[match.end():], re.I):
                continue
            if not _NEGATED.search(prefix):
                return True
    return False
