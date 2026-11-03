"""Recognize a specific unsupported one-delivery comparison claim.

This bounded English phrase check does not assess sample quality or recognize all
ways an unsupported comparison may be expressed.
"""
import re


_ONE = re.compile(r"\b(?:one|a\s+single|only\s+one|just\s+one|the\s+same)\s+(?:delivery|batch|shipment)\b", re.I)
_OTHER = re.compile(
    r"\b(?:another|a\s+second|second|two|different|separate|other|multiple|"
    r"the\s+next|next|successive)\s+(?:delivery|deliveries|batch|batches|shipment|shipments)\b",
    re.I,
)
_CLAIM = re.compile(
    r"\b(?:shows?|showed|reveals?|revealed|establish(?:es|ed)?|determines?|determined|"
    r"demonstrates?|demonstrated|measures?|measured)\b[^.!?\n]{0,100}"
    r"\b(?:changes?|changed|variation|variability|varies|varied|shifts?|shifted|"
    r"different|differences?|differs?)\b[^.!?\n]{0,80}"
    r"\b(?:between|across|among)\s+(?:(?:different|separate|multiple|various|the)\s+){0,2}"
    r"(?:deliveries|batches|shipments)\b",
    re.I,
)
_NEGATED = re.compile(
    r"\b(?:do\s+not|does\s+not|don't|doesn't|cannot|can't|will\s+not|won't|"
    r"would\s+not|wouldn't|never|does\s+not\s+by\s+itself)\s*$", re.I,
)


def has_single_delivery_comparison(text):
    if not isinstance(text, str):
        return False
    for claim in _CLAIM.finditer(text):
        prefix = text[:claim.start()]
        if _NEGATED.search(prefix[-60:]):
            continue
        one = list(_ONE.finditer(prefix))
        if one and not _OTHER.search(prefix[one[-1].end():]):
            return True
    return False
