"""Compare only the user's explicitly entered readings at stated settings."""
from decimal import Decimal, InvalidOperation
import re

from .advisor import _brief, _calculation_context
from .products import ProductInputError


REQUEST_FIELDS = {"brief", "calculation_context", "property_name", "property_unit", "input_name", "input_unit",
                  "target_min", "target_max", "method", "conditions_confirmed", "data_kind", "settings"}
SETTING_FIELDS = {"id", "level", "readings"}
READING_FIELDS = {"value", "group_label", "group_kind"}
IDENTIFIER_FIELDS = {"reading_id", "specimen_id", "run_id", "batch_id", "repeat_of"}
GROUP_KINDS = {"unknown", "repeat", "specimen", "run", "batch"}
DECIMAL_TEXT = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,5})?\Z")


def _exact(value, fields, label):
    if not isinstance(value, dict) or set(value) != fields:
        raise ProductInputError(f"Include exactly the supported {label} fields")
    return value


def _text(value, label, limit, *, verbatim=False):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ProductInputError(f"Enter {label} as text no longer than {limit} characters")
    return value if verbatim else value.strip()


def _number(value, label):
    if not isinstance(value, str):
        raise ProductInputError(f"Send {label} as decimal text, not a JSON number, so its precision is preserved")
    try:
        text = value.strip()
        if len(text) > 160 or not DECIMAL_TEXT.fullmatch(text):
            raise InvalidOperation()
        number = Decimal(text)
        exponent = int(text.lower().partition('e')[2] or '0')
        if not number.is_finite() or abs(exponent) > 10000 or abs(number.adjusted()) > 10000:
            raise InvalidOperation()
        return number, text
    except (ValueError, InvalidOperation, OverflowError):
        raise ProductInputError(f"Enter {label} as a finite decimal of at most 160 characters and exponent magnitude at most 10000") from None


def compare_readings(request):
    """Compare entries to the target; caller-provided grouping is descriptive only."""
    _exact(request, REQUEST_FIELDS, "reading comparison")
    brief = _brief(request["brief"])
    context = _calculation_context(request["calculation_context"])
    if not brief["input"]:
        raise ProductInputError("Describe the shared material before comparing readings")
    if not brief["process"]:
        raise ProductInputError("Describe the shared process before comparing readings")
    if request["conditions_confirmed"] is not True:
        raise ProductInputError("Confirm the stated material, process, product, property and method apply across settings except the named input")
    if request["data_kind"] not in ("synthetic", "user_reported"):
        raise ProductInputError("Identify the readings as synthetic or user reported")
    meta = {key: _text(request[key], label, limit) for key, label, limit in (
        ("property_name", "measured property", 120), ("property_unit", "property unit", 40),
        ("input_name", "changed input", 120), ("input_unit", "input unit", 40),
        ("method", "measurement method and conditions", 1000))}
    low, low_text = _number(request["target_min"], "minimum target")
    high, high_text = _number(request["target_max"], "maximum target")
    if low > high:
        raise ProductInputError("The minimum target must not exceed the maximum")
    raw = request["settings"]
    if not isinstance(raw, list) or not 2 <= len(raw) <= 20:
        raise ProductInputError("Enter between 2 and 20 settings")
    settings, identities, levels = [], set(), set()
    for setting in raw:
        _exact(setting, SETTING_FIELDS, "setting")
        identity = _text(setting["id"], "setting identifier", 80)
        level, level_text = _number(setting["level"], "setting level")
        if identity in identities or level in levels:
            raise ProductInputError("Use a unique identifier and distinct input level for each setting")
        identities.add(identity)
        levels.add(level)
        readings = setting["readings"]
        if not isinstance(readings, list) or not 1 <= len(readings) <= 20:
            raise ProductInputError("Enter between 1 and 20 readings for each setting")
        output, exact_values = [], []
        for reading in readings:
            if not isinstance(reading, dict) or not READING_FIELDS <= set(reading) or set(reading) - (READING_FIELDS | IDENTIFIER_FIELDS):
                raise ProductInputError("Include the supported reading fields and optional reading/specimen/run/batch/repeat-of identifiers")
            value, value_text = _number(reading["value"], "reading")
            label = _text(reading["group_label"], "group label (or Unknown)", 160, verbatim=True)
            kind = reading["group_kind"]
            if not isinstance(kind, str) or kind not in GROUP_KINDS:
                raise ProductInputError("Choose unknown, repeat, specimen, run or batch for each reading")
            identifiers = {field: None if reading.get(field) is None else _text(reading[field], field.replace('_', ' '), 160, verbatim=True)
                           for field in sorted(IDENTIFIER_FIELDS)}
            output.append({"value": value_text, "group_label": label, "group_kind": kind, **identifiers,
                           "inside_target": bool(low <= value <= high)})
            exact_values.append((value, value_text))
        count = sum(reading["inside_target"] for reading in output)
        settings.append({"id": identity, "level": level_text, "readings": output,
                         "observed_min": min(exact_values, key=lambda row: row[0])[1],
                         "observed_max": max(exact_values, key=lambda row: row[0])[1],
                         "reading_count": len(output), "in_target_count": count,
                         "all_readings_in_target": count == len(output)})
    warnings = [
        "These comparisons describe only the readings and settings entered; they do not predict another setting or future production.",
        "The result compares reported values only. Measurement uncertainty is not modeled and a value inside the target is not product qualification.",
        "The entered target and units are used as stated; they are not converted or checked against other target text in the shared case.",
        "Grouping labels, kinds and separate reading/specimen/run/batch/repeat-of identifiers are user supplied and retained. Their hierarchy, references and statistical independence are not assessed; only readings are counted.",
        "The comparison does not establish causation, physical performance of an untested configuration, or consistency across batches.",
        "No values are interpolated, averaged, pooled from studies, or copied from stored source data.",
    ]
    if request["data_kind"] == "synthetic":
        warnings.insert(0, "Synthetic simulation: these entries are not physical measurements.")
    else:
        warnings.insert(0, "User-reported source measurements: the entries and their test conditions have not been independently verified.")
    return {"result_kind": "entered_readings_comparison", "data_kind": request["data_kind"],
            "brief": brief, "calculation_context": context, **meta,
            "target_min": low_text, "target_max": high_text,
            "conditions_confirmed": True, "settings": settings,
            "matching_setting_ids": [row["id"] for row in settings if row["all_readings_in_target"]],
            "interpolation_used": False, "future_consistency_established": False,
            "physical_product_tested_by_app": False, "warnings": warnings}
