"""Bounded handling of direct material actions in explicitly planning-only cases.

The phrase checks cover common English instructions, not every paraphrase or context.
"""
from copy import deepcopy
import re
from .meta import MetaValidationError


_NO_WORK = re.compile(
    r"\b(?:no|without)\s+(?:any\s+)?(?:(?:physical\s+)?handling|physical\s+work)\b"
    r"(?!\s+(?:restrictions?|limits?|limitations?|prohibitions?)\b)|"
    r"\b(?:cannot|can't|do\s+not|don't|will\s+not|won't)\s+(?:physically\s+)?"
    r"(?:handle|work\s+with)\b|(?<!not\s)\b(?:home\s+)?planning\s+only\b",
    re.I,
)
_ALLOW_WORK = re.compile(
    r"\bno\s+(?:physical\s+)?handling\s+(?:restrictions?|limits?|limitations?|prohibitions?)\b|"
    r"(?:^|[.!?]\s*|\bnow\s+)(?:i|we)\s+(?:can|may|am\s+able\s+to|are\s+able\s+to|"
    r"am\s+allowed\s+to|are\s+allowed\s+to)\s+(?:now\s+)?(?:physically\s+)?"
    r"(?:handle|mix|weigh|sort|process|work\s+with)\b",
    re.I,
)
_FUTURE_PERMISSION = re.compile(
    r"\b(?:later|tomorrow|eventually|soon|next\s+(?:week|month|year)|"
    r"when|once|after|if)\b", re.I,
)
_ACTION = re.compile(
    r"(?:^|(?<=[.!?;])\s+|,\s*(?:then\s+)?)"
    r"(?:(?:you|we)\s+(?:should|can|could|must|need\s+to)\s+)?"
    r"(?:please\s+|now\s+|first\s+|next\s+|then\s+|physically\s+){0,2}"
    r"(?P<verb>add|pour|transfer|weigh|mix|blend|sort|wash|rinse|melt|heat|press|cut|"
    r"mould|mold|process|handle|pack|fill|measure|make|use)\b",
    re.I,
)
_MATERIAL = re.compile(
    r"\b(?:kg|kilograms?|g|grams?|pounds?|lbs?|rubber|plastic|polymer|resin|flakes?|granules?|"
    r"binder|powder|dust|stock|mixture|mix|sample|specimen|portion|material|mat|sheet|"
    r"prototype|patch(?:es)?|press|scale|extruder|oven|machine|equipment)\b", re.I,
)
_MEASUREMENT = re.compile(r"\b(?:grip|thickness|mass|density|weight|strength|dimensions?)\b", re.I)
_DIGITAL = re.compile(
    r"\b(?:record|reading|entry|entries|check|note|value|cost|calculation|scenario|"
    r"setup|target|data|question|field|information|observation|details)\b", re.I,
)
_NUMERIC_ADD = re.compile(
    r"^\s*(?:(?:you|we)\s+(?:should|can|could|must|need\s+to)\s+)?"
    r"(?:please\s+|now\s+|first\s+)?add\s+"
    r"(?=(?:approximately\s+|about\s+|roughly\s+)?\d+(?:[.,]\d+)?\s*"
    r"(?:kg|kilograms?|g|grams?|lb|lbs|pounds?)\b)", re.I,
)
_COMPOUND = re.compile(r"\b(?:and|then|next)\b", re.I)
_DIGITAL_DESTINATION = re.compile(
    r"\b(?:to|into|in)\s+(?:(?:the|your|a)\s+)?(?:"
    r"(?:(?:cost|mix|material|composition|price)\s+)?calculator|"
    r"(?:app|application|spreadsheet|form)|"
    r"setup\s+(?:in|within)\s+(?:the|your)\s+(?:app|application))\b", re.I,
)
_SENTENCES = re.compile(r"(?<=[.!?])(?=\s+[A-Z])")
_LOCAL_STEP = "Use the recorded inputs to plan this step for later."


def is_planning_only(case):
    """Read explicit user restrictions, not assistant-created history."""
    brief = case.get('brief', {})
    # A current explicit user instruction supersedes the reviewed case. Without
    # one, the reviewed case outranks unversioned conversation history.
    tiers = [[case[key] for key in ('question', 'message') if isinstance(case.get(key), str)]]
    if isinstance(brief, dict):
        tiers.append([value for value in brief.values() if isinstance(value, str)])
    history = case.get('history', [])
    if isinstance(history, list):
        tiers.extend([[item.get('content', '')] for item in reversed(history)
                      if isinstance(item, dict) and item.get('role') == 'user'
                      and isinstance(item.get('content'), str)])
    for texts in tiers:
        # Contradictory statements at the same authority level remain restricted.
        if any(_NO_WORK.search(text) for text in texts):
            return True
        for text in texts:
            for match in _ALLOW_WORK.finditer(text):
                # Future permission is not permission to work now.
                sentence_start = max(text.rfind(mark, 0, match.start()) for mark in '.!?') + 1
                end = re.search(r'[.!?]', text[match.end():])
                sentence_end = match.end() + end.start() if end else len(text)
                if not _FUTURE_PERMISSION.search(text[sentence_start:sentence_end]):
                    return False
    return False


def _physical_action(text):
    for match in _ACTION.finditer(text):
        rest = re.split(r"(?<!\d)\.(?!\d)|;|[!?]", text[match.end():], maxsplit=1)[0]
        # Keep digital actions such as "add the missing synthetic wet-grip entry".
        digital = _DIGITAL.search(rest)
        material = _MATERIAL.search(rest)
        if match.group('verb').lower() == 'measure':
            measurement = _MEASUREMENT.search(rest)
            if measurement and (not material or measurement.start() < material.start()):
                material = measurement
        if (match.group('verb').lower() == 'add' and _DIGITAL_DESTINATION.search(rest)
                and not _COMPOUND.search(rest)):
            continue
        if material and (not digital or material.start() < digital.start()):
            return True
    return False


def _clean_text(text):
    changed = False
    result = []
    for sentence in _SENTENCES.split(text):
        if not _physical_action(sentence):
            result.append(sentence)
            continue
        changed = True
        leading = re.match(r"\s*", sentence).group()
        # A simple numeric addition can remain useful as an explicitly proposed
        # planning quantity. Never turn a compound handling instruction into one.
        if _NUMERIC_ADD.match(sentence) and not _COMPOUND.search(sentence):
            result.append(leading + _NUMERIC_ADD.sub('For planning, the proposed addition is ', sentence, count=1))
        else:
            result.append(leading + _LOCAL_STEP)
    return ''.join(result), changed


def planning_version(data):
    """Return an edited copy and whether any recognized instruction was changed."""
    result = deepcopy(data)
    changed = False

    def visit(value, key=''):
        nonlocal changed
        if key in {'target', 'property'}:
            if isinstance(value, str) and _physical_action(value):
                raise MetaValidationError('The check contains a physical action. Change it to a planning check before continuing.')
            return value
        if key in {'id', 'source_ids'}:
            return value
        if isinstance(value, str):
            value, modified = _clean_text(value)
            changed = changed or modified
            return value
        if isinstance(value, list):
            return [visit(item) for item in value]
        if isinstance(value, dict):
            return {field: visit(item, field) for field, item in value.items()}
        return value

    return visit(result), changed
