"""Recognize two specific unsuitable grip proxies observed in intake.

This bounded English phrase check does not evaluate test suitability in general.
"""
import re


_PAPER = re.compile(
    r"\b(?:compare|assess|test|check|evaluate|measure)\b[^.!?\n]{0,120}"
    r"\b(?:on\s+paper|paper\s+(?:sketch(?:es)?|drawings?))\b[^.!?\n]{0,40}"
    r"\b(?:for|to\s+(?:assess|test|check|evaluate|measure))\s+"
    r"(?:the\s+)?(?:grip|slip|traction|cleaning)\b",
    re.I,
)
_TILT = re.compile(
    r"\b(?:bench|tabletop)\s+tilt\b[^.!?\n]{0,120}"
    r"\b(?:contained\s+(?:samples?|flakes?|granules?|particles?)|"
    r"loose\s+(?:samples?|flakes?|granules?|particles?))\b[^.!?\n]{0,100}"
    r"\b(?:shoe|sole|footwear)\b",
    re.I,
)
_NEGATED = re.compile(
    r"\b(?:do\s+not|don't|never|avoid|refrain\s+from)\s+"
    r"(?:(?:use|rely\s+on|perform|conduct|run)\s+)?$", re.I,
)


def has_misleading_grip_proxy(text):
    if not isinstance(text, str):
        return False
    for pattern in (_PAPER, _TILT):
        for match in pattern.finditer(text):
            if not _NEGATED.search(text[max(0, match.start() - 50):match.start()]):
                return True
    return False
