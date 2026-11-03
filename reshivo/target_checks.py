"""Compare targets with reported specimen values at tested source content levels."""
import hashlib
import json
import math
from pathlib import Path
import statistics

from .materials import ROOT
from .products import ProductDataError, ProductInputError


DATA_PATH = "data/research/target-checks/cecon2021_yield_stress.json"
MANIFEST_PATH = "data/research/target-checks/calculation_inputs.json"
WORKBOOK_PATH = "data/research/density/originals/cecon2021_mmc1.xlsx"
ARTICLE_PATH = "data/research/density/originals/cecon2021_article_fresh.xml"
REQUIRED_INPUTS = {DATA_PATH, WORKBOOK_PATH, ARTICLE_PATH}
HOST_COLUMNS = {"LDPE": "AR", "LLDPE": "AS", "MDPE": "AT", "HDPE": "AU"}
LEVELS = [0, 20, 40, 60, 80, 100]
SPECIMEN_UNIT = "individually tested ASTM Type I dogbone specimen"
SOURCE_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8517156/"
LIMITS = [
    "Source measurements: this comparison uses only the reported tensile specimens of the selected published PE series.",
    "A matching level means all ten recorded yield-stress values fall inside this target; it is not a prediction for a product or future batch.",
    "Each content level remains a separate source condition. No values between tested levels are estimated, and different hosts are not pooled.",
    "The 100% recycled PE endpoint is one shared source condition, not a separate experiment for every virgin host.",
    "Ten individually tested dogbones are not ten production batches. Independent run and batch counts and original specimen identifiers are not reported.",
    "Commercial grade identifiers and the complete recycled-stream contaminant composition are not reported.",
    "These readings do not describe My mix, a metal-dust/binder recipe or the user's waste. No missing measurement is filled from this comparison.",
    "Yield stress does not establish mass, sound performance, creep, fatigue or finished-product consistency.",
]


def _json(body):
    return json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def _source_data(root=ROOT):
    root = Path(root).resolve()
    try:
        manifest = _json((root / MANIFEST_PATH).read_bytes())
        entries = manifest["files"]
        if len(entries) != len(REQUIRED_INPUTS) or {entry["path"] for entry in entries} != REQUIRED_INPUTS:
            raise ValueError("The target comparison input manifest is incomplete")
        bodies = {}
        hashes = {}
        for entry in entries:
            path = (root / entry["path"]).resolve()
            if not path.is_relative_to(root):
                raise ValueError("Source path is outside the project")
            body = path.read_bytes()
            digest = hashlib.sha256(body).hexdigest()
            if digest != entry["sha256"]:
                raise ValueError("A checked source file changed")
            bodies[entry["path"]] = body
            hashes[entry["path"]] = digest
        data = _json(bodies[DATA_PATH])
        _validate_data(data, hashes)
        return data
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        raise ProductDataError("The published target-check data could not be loaded or did not match its checked source files") from None


def _validate_data(data, hashes):
    if data["schema_version"] != 1 or data["label"] != "source_measurements":
        raise ValueError("Unexpected measurement data schema")
    if data["property"] != {"name": "yield_stress", "label": "Yield stress", "unit": "MPa"}:
        raise ValueError("The retained property or units changed")
    source = data["source"]
    if source["id"] != "cecon2021" or source["doi"] != "10.1016/j.dib.2021.107452" or source["url"] != SOURCE_URL or source["license"] != "CC-BY-4.0":
        raise ValueError("Unexpected source identity")
    original_files = source["files"]
    if len(original_files) != 2 or {entry["path"] for entry in original_files} != {WORKBOOK_PATH, ARTICLE_PATH}:
        raise ValueError("The original source-file list changed")
    if any(entry["sha256"] != hashes[entry["path"]] for entry in original_files):
        raise ValueError("The data references different original files")
    conditions = data["conditions"]
    series = data["series"]
    expected_conditions = {f"CECON21-{host}-PCR{level}" for host in HOST_COLUMNS for level in LEVELS[:-1]} | {"CECON21-PCRPE100"}
    if data["condition_count"] != 21 or data["observation_count"] != 210 or len(conditions) != 21:
        raise ValueError("Unexpected measurement grain")
    if {condition["id"] for condition in conditions} != expected_conditions:
        raise ValueError("A source condition is missing or duplicated")
    if len(series) != 4 or {item["id"] for item in series} != {f"CECON21-YIELD-{host}" for host in HOST_COLUMNS}:
        raise ValueError("The source host series changed")
    for item in series:
        host = item["virgin_host"]
        expected = [f"CECON21-{host}-PCR{level}" for level in LEVELS[:-1]] + ["CECON21-PCRPE100"]
        if host not in HOST_COLUMNS or item["id"] != f"CECON21-YIELD-{host}" or item["input_levels"] != LEVELS or item["condition_ids"] != expected or item["input_unit"] != "wt%":
            raise ValueError("A source series mixes hosts or untested content levels")
    identities = set()
    total = 0
    for condition in conditions:
        host = condition["virgin_host"]
        level = condition["pcrpe_wt_percent"]
        if host is None:
            if condition["id"] != "CECON21-PCRPE100" or level != 100:
                raise ValueError("The shared endpoint changed")
            column, first_row = "AR", 54
        else:
            if host not in HOST_COLUMNS or level not in LEVELS[:-1] or condition["id"] != f"CECON21-{host}-PCR{level}":
                raise ValueError("The recorded formulation changed")
            column, first_row = HOST_COLUMNS[host], 4 + LEVELS.index(level) * 10
        rows = condition["observations"]
        if condition["sample_count"] != 10 or condition["repetition_unit"] != SPECIMEN_UNIT or condition["independent_batch_count"] is not None or len(rows) != 10:
            raise ValueError("The source specimen count or grouping changed")
        if condition["source_cell_range"] != f"Data!{column}{first_row}:{column}{first_row + 9}":
            raise ValueError("The source cell range changed")
        for index, row in enumerate(rows, 1):
            source_row = first_row + index - 1
            value = row["value"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1_000_000 or not math.isfinite(value):
                raise ValueError("A source value is not positive and finite")
            if row["measurement_id"] != f"{condition['id']}-YIELD-{index}" or row["measurement_id"] in identities:
                raise ValueError("A source observation is missing or duplicated")
            identities.add(row["measurement_id"])
            if any(row[key] != expected for key, expected in {
                "condition_id": condition["id"], "virgin_host": host, "pcrpe_wt_percent": level,
                "source_id": "cecon2021", "source_url": SOURCE_URL, "license": "CC-BY-4.0",
                "property": "yield_stress", "unit": "MPa", "data_kind": "source_measurement",
                "sample_count": 10, "repetition_unit": SPECIMEN_UNIT, "independent_run_count": None,
                "independent_batch_count": None, "specimen_identifier": None, "specimen_index": index,
                "source_row": source_row, "source_cell": f"Data!{column}{source_row}",
                "input_level_cell": f"Data!AQ{source_row}", "source_workbook": WORKBOOK_PATH,
                "source_sheet": "Data", "process": source["process"], "test_method": source["test_method"],
            }.items()):
                raise ValueError("Source observation metadata changed")
            if not isinstance(row["raw_numeric_string"], str) or float(row["raw_numeric_string"]) != value:
                raise ValueError("A numeric value differs from its recorded source string")
            total += 1
    if total != 210:
        raise ValueError("Unexpected number of source observations")


def target_series(root=ROOT):
    data = _source_data(root)
    return {"result_kind": "source_measurements", "source": data["source"], "property": data["property"],
            "series": data["series"], "limits": list(LIMITS)}


def _target_number(request, name):
    value = request.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1_000_000 or not math.isfinite(value):
        raise ProductInputError(f"{name} must be a non-negative finite number no larger than 1000000")
    return value


def target_check(request, root=ROOT):
    if not isinstance(request, dict) or set(request) != {"series_id", "target_min_MPa", "target_max_MPa"}:
        raise ProductInputError("Use one published series, a minimum yield-stress target and a maximum target or null for no upper limit")
    identity = request.get("series_id")
    if not isinstance(identity, str) or identity not in {f"CECON21-YIELD-{host}" for host in HOST_COLUMNS}:
        raise ProductInputError("Choose one of the four published PE host series; no other material or input level is available")
    low = _target_number(request, "target_min_MPa")
    high = None if request["target_max_MPa"] is None else _target_number(request, "target_max_MPa")
    if high is not None and low > high:
        raise ProductInputError("The minimum yield-stress target must not exceed the maximum")
    data = _source_data(root)
    selected = next(item for item in data["series"] if item["id"] == identity)
    conditions = {item["id"]: item for item in data["conditions"]}
    levels = []
    for condition_id in selected["condition_ids"]:
        condition = conditions[condition_id]
        values = [row["value"] for row in condition["observations"]]
        count = sum(value >= low and (high is None or value <= high) for value in values)
        levels.append({
            "condition_id": condition_id, "pcrpe_wt_percent": condition["pcrpe_wt_percent"], "n": 10,
            "source_min_MPa": min(values), "source_max_MPa": max(values), "source_mean_MPa": statistics.mean(values),
            "values_in_target": count, "all_values_in_target": count == len(values),
            "observations": condition["observations"],
        })
    return {
        "result_kind": "source_measurements", "comparison_scope": "recorded_specimens_only",
        "source": data["source"], "property": data["property"], "series": selected,
        "target_min_MPa": low, "target_max_MPa": high, "levels": levels,
        "matching_tested_levels_wt_percent": [level["pcrpe_wt_percent"] for level in levels if level["all_values_in_target"]],
        "limits": list(LIMITS), "physical_product_tested": False,
        "batch_consistency_established": False, "interpolation_used": False,
    }
