"""Mass scenarios from user-entered density readings of one processed mix."""
from collections import defaultdict
import hashlib
import json
import math
import statistics

from .products import ProductInputError


ASSUMPTIONS = [
    "Simulation of the density readings you entered for this processed mix; these readings and their grouping are user reported.",
    "Each mass scenario equals one entered density reading multiplied by the exact volume you entered, using the same volume basis.",
    "The mean is weighted by readings, including repeated readings. It does not count independent specimens, runs or batches.",
    "Groups describe only the identifiers you supplied. Unknown grouping stays unknown; repeated readings do not create extra batches.",
    "The observed ranges are not confidence intervals, future-batch predictions or finished-product tolerances.",
    "A reading can include the voids and packing of its tested specimen. Their response to a change is not calculated.",
    "Changed amounts, materials or processing need a new case with matching processed-mix readings. No component densities or stored study readings are substituted.",
    "No physical test of the proposed product is recorded by this mass calculation, and finished-product consistency is not established.",
]


def _object(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ProductInputError(f"Use only the supported {label} fields")
    return value


def _text(value, label, limit=120, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ProductInputError(f"{label} must be text no longer than {limit} characters")
    value = value.strip()
    if optional and not value:
        return None
    if not value:
        raise ProductInputError(f"Enter {label}")
    return value


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1_000_000 or not math.isfinite(value):
        raise ProductInputError(f"{label} must be a positive finite number no larger than 1000000")
    return float(value)


def _case(raw):
    _object(raw, {"label", "components", "amount_basis", "process", "density_method", "density_volume_basis",
                  "calculation_volume_basis", "volume_basis_details"}, "mix case")
    components = raw.get("components")
    if not isinstance(components, list) or not 1 <= len(components) <= 20:
        raise ProductInputError("Enter between 1 and 20 components for this complete recipe")
    normalized = []
    for item in components:
        _object(item, {"name", "role", "amount", "unit"}, "component")
        role = item.get("role")
        unit = item.get("unit")
        if role not in ("main", "binder", "other"):
            raise ProductInputError("A component role must be main, binder or other")
        if unit not in ("g", "mass_percent", "volume_percent"):
            raise ProductInputError("Use grams, mass percent or volume percent for each component")
        normalized.append({"name": _text(item.get("name"), "component name"), "role": role,
                           "amount": _number(item.get("amount"), "Component amount"), "unit": unit})
    if sum(item["role"] == "main" for item in normalized) != 1:
        raise ProductInputError("Identify exactly one main material in this case")
    if len({item["unit"] for item in normalized}) != 1:
        raise ProductInputError("Use one common amount unit for this complete recipe; no density-based conversion is available")
    if normalized[0]["unit"] != "g" and not math.isclose(math.fsum(item["amount"] for item in normalized), 100, rel_tol=0, abs_tol=1e-6):
        raise ProductInputError("The complete recipe percentages must add up to 100")
    density_basis = raw.get("density_volume_basis")
    calculation_basis = raw.get("calculation_volume_basis")
    allowed_bases = ("external_volume", "solid_volume", "other")
    if density_basis not in allowed_bases or calculation_basis not in allowed_bases:
        raise ProductInputError("State a known volume basis for both the density readings and the mass calculation")
    if density_basis != calculation_basis:
        raise ProductInputError("The density readings and mass calculation must use the same volume basis")
    details = _text(raw.get("volume_basis_details", ""), "volume basis details", 1000, optional=True) or ""
    if density_basis == "other" and not details:
        raise ProductInputError("Describe the matching volume basis used by both the density method and calculation")
    return {
        "label": _text(raw.get("label"), "case name"),
        "components": normalized,
        "amount_basis": _text(raw.get("amount_basis"), "amount basis, such as dry mass or as-received mass", 300),
        "process": _text(raw.get("process"), "process used for the measured mix", 2000),
        "density_method": _text(raw.get("density_method"), "density measurement method", 1000),
        "density_volume_basis": density_basis,
        "calculation_volume_basis": calculation_basis,
        "volume_basis_details": details,
    }


def _readings(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 200:
        raise ProductInputError("Enter between 1 and 200 density readings of this processed mix")
    normalized = []
    previous = {}
    for item in raw:
        _object(item, {"id", "value_g_cm3", "reading_kind", "batch_id", "run_id", "specimen_id", "repeat_of"}, "density reading")
        identity = _text(item.get("id"), "reading identifier", 80)
        if identity in previous:
            raise ProductInputError("Give every density reading a unique identifier")
        kind = item.get("reading_kind")
        if kind not in ("unknown", "specimen", "repeat"):
            raise ProductInputError("Mark the reading type as unknown, specimen or repeat")
        row = {"id": identity, "value_g_cm3": _number(item.get("value_g_cm3"), "Processed-mix density (g/cm3)"),
               "reading_kind": kind}
        for field in ("batch_id", "run_id", "specimen_id", "repeat_of"):
            row[field] = _text(item.get(field), field.replace("_", " "), 80, optional=True)
        if kind == "specimen" and row["specimen_id"] is None:
            raise ProductInputError("A specimen reading needs a specimen identifier; otherwise leave its type unknown")
        if kind == "repeat":
            reference = previous.get(row["repeat_of"])
            if reference is None or reference["reading_kind"] == "repeat":
                raise ProductInputError("Link a repeated reading to an earlier original reading, not to another repeat")
            if any(row[field] != reference[field] for field in ("batch_id", "run_id", "specimen_id")):
                raise ProductInputError("A repeated reading must have the same batch, run and specimen identifiers as its original reading")
        elif row["repeat_of"] is not None:
            raise ProductInputError("Only a repeated reading can name an original reading")
        normalized.append(row)
        previous[identity] = row
    return normalized


def _groups(readings, fields):
    groups = defaultdict(list)
    for row in readings:
        if row[fields[-1]] is not None:
            groups[tuple(row[field] for field in fields)].append(row["mass_kg"])
    result = []
    for identity, values in groups.items():
        result.append({**dict(zip(fields, identity)), "reading_count": len(values),
                       "mass_min_kg": min(values), "mass_max_kg": max(values)})
    return result


def my_mix_mass(request):
    """Scale only the submitted processed-mix readings, without loading a study."""
    _object(request, {"product_name", "property", "case", "readings", "volume_cm3", "target_min_kg", "target_max_kg"}, "mass simulation")
    if request.get("property") != "mass":
        raise ProductInputError("Only mass has a calculation here; other properties need matching measurements and a suitable calculation")
    product_name = _text(request.get("product_name"), "product name")
    case = _case(request.get("case"))
    readings = _readings(request.get("readings"))
    volume = _number(request.get("volume_cm3"), "Volume (cm3)")
    low = _number(request.get("target_min_kg"), "Minimum mass target (kg)")
    high = _number(request.get("target_max_kg"), "Maximum mass target (kg)")
    if low > high:
        raise ProductInputError("The minimum mass target must not exceed the maximum")
    scenarios = []
    for row in readings:
        mass = row["value_g_cm3"] * volume / 1000
        inside = (mass >= low or math.isclose(mass, low, rel_tol=1e-12, abs_tol=0)) and (mass <= high or math.isclose(mass, high, rel_tol=1e-12, abs_tol=0))
        scenarios.append({**row, "mass_kg": mass, "inside_target": inside})
    masses = [row["mass_kg"] for row in scenarios]
    batch_groups = _groups(scenarios, ("batch_id",))
    return {
        "result_kind": "simulation", "input_kind": "my_mix", "product_name": product_name, "property": "mass",
        "case": case,
        "case_fingerprint": hashlib.sha256(json.dumps(case, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest(),
        "volume_cm3": volume, "target_min_kg": low, "target_max_kg": high,
        "reading_scenarios": scenarios,
        "density_mean_g_cm3": statistics.mean(row["value_g_cm3"] for row in readings),
        "mean_density_mass_kg": statistics.mean(masses),
        "observed_mass_min_kg": min(masses), "observed_mass_max_kg": max(masses),
        "readings_in_target": sum(row["inside_target"] for row in scenarios), "reading_count": len(readings),
        "grouping": {
            "identified_batch_count": len(batch_groups),
            "unknown_batch_reading_count": sum(row["batch_id"] is None for row in scenarios),
            "repeat_reading_count": sum(row["reading_kind"] == "repeat" for row in scenarios),
            "batch_groups": batch_groups,
            "run_groups": _groups(scenarios, ("batch_id", "run_id")),
            "specimen_groups": _groups(scenarios, ("batch_id", "run_id", "specimen_id")),
        },
        "assumptions": list(ASSUMPTIONS), "physical_product_tested": False, "batch_consistency_established": False,
    }
