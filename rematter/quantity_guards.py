"""Reject source expressions that cannot safely be read as one scalar."""
import re


_NUMBER = r"[+\-−]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)"
_COMPOSITE = re.compile(
    rf"(?<![\w.]){_NUMBER}\s*(?:lbs?|pounds?)\b\s*(?:,\s*|and\s+)?"
    rf"{_NUMBER}\s*(?:oz|ounces?)\b"
    rf"|(?<![\w.]){_NUMBER}\s*(?:ft|feet|foot)\b\s*(?:,\s*|and\s+)?"
    rf"{_NUMBER}\s*(?:in(?:ches|ch)?|\")(?=\W|$)", re.IGNORECASE)
_FORCE = re.compile(
    rf"(?<![\w.]){_NUMBER}\s*(?:lbs?|pounds?)\s*(?:[-–]?\s*(?:of\s+)?force)\b"
    rf"|(?<![\w.]){_NUMBER}\s*(?:lbf|pound[- ]force)\b", re.IGNORECASE)


def unsafe_scalar(source, start, end):
    """Check the full original source so a clipped model quote cannot hide context."""
    return any(match.start() < end and start < match.end()
               for pattern in (_COMPOSITE, _FORCE) for match in pattern.finditer(source))
