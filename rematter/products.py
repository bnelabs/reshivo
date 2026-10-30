"""Product calculations restricted to matching, checked source measurements."""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics

from .materials import ROOT


class ProductDataError(ValueError):
    pass


class ProductInputError(ValueError):
    pass


ASSUMPTIONS = [
    "Simulation: no counterweight has been made or tested.",
    "The calculation assumes uniform density equal to the selected source specimens and an exact chosen volume.",
    "The five scenarios use five density readings from one prepared material condition. They are not five waste batches.",
    "The observed source range is not a confidence interval, a future-batch prediction or a finished-product tolerance.",
    "A different plastic, composition, process, void content or dimensional variation needs matching measurements.",
]

REQUIRED_INPUTS = {
    "data/research/density/measurements.json",
    "data/research/density/sources.json",
    "data/research/density/originals/cecon2021_mmc1.xlsx",
    "data/research/density/originals/cecon2021_article_fresh.xml",
    "data/research/source_groups.json",
}


def _checked_data(root=ROOT):
    root = Path(root).resolve()
    try:
        manifest = json.loads((root / "data/research/calculation_inputs.json").read_text())
        if {entry["path"] for entry in manifest["files"]} != REQUIRED_INPUTS or len(manifest["files"]) != len(REQUIRED_INPUTS):
            raise ValueError("Calculation manifest is incomplete")
        for entry in manifest["files"]:
            path = (root / entry["path"]).resolve()
            if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError("Source file changed")
        observations = json.loads((root / "data/research/density/measurements.json").read_text())["observations"]
        overview = json.loads((root / "data/research/source_groups.json").read_text())
        return observations, overview
    except (OSError, ValueError, KeyError, TypeError):
        raise ProductDataError("The product data could not be loaded or did not match the saved source files") from None


def density_cases(root=ROOT):
    observations, _ = _checked_data(root)
    groups = defaultdict(list)
    for row in observations:
        if row["source_id"] == "cecon2021" and row["pcrpe_wt_percent"] > 0:
            groups[row["condition_id"]].append(row)
    if len(groups) != 17:
        raise ProductDataError("The recycled-PE condition list does not match the checked dataset")
    cases = []
    for identity, rows in groups.items():
        rows.sort(key=lambda row: row["replicate_index"])
        values = [row["value"] for row in rows]
        if len(values) != 5 or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in values):
            raise ProductDataError("A source condition does not contain five valid density readings")
        first = rows[0]
        fraction = first["pcrpe_wt_percent"]
        host = first["virgin_host"]
        label = "100% recycled PE — published sample" if fraction == 100 else f"{fraction}% recycled PE + {100-fraction}% virgin {host}"
        cases.append({
            "id": identity,
            "label": label,
            "source_title": "Cecon et al. 2021 — PE/PCRPE density measurements",
            "source_url": first["source_url"],
            "source_id": "cecon2021", "license": first["license"],
            "material": label + "; the source does not specify a commercial recycled grade or complete contaminant composition",
            "process": first["process"], "method": first["method"],
            "test_temperature_C": first["test_temperature_C"],
            "n": 5, "repetition_level": first["repetition_level"],
            "density_values_g_cm3": values,
            "density_mean_g_cm3": statistics.mean(values),
            "density_min_g_cm3": min(values), "density_max_g_cm3": max(values),
            "source_cells": [row["source_locator"] for row in rows],
            "source_measurement_ids": [row["measurement_id"] for row in rows],
            "limitations": [
                "Use only for this study's material and processing route; it is not a generic PE density.",
                "Fragments were cut from moulded specimens. Independent batch count and fragment-to-specimen allocation are not reported.",
                "Counterweight void content, volume error and physical performance have not been measured.",
            ],
        })
    return sorted(cases, key=lambda item: (item["id"] != "CECON21-PCRPE100", item["id"]))


def product_catalog(root=ROOT):
    _, overview = _checked_data(root)
    return {"label": "source_measurements", "density_cases": density_cases(root),
            "source_groups": overview, "limits": ASSUMPTIONS}


def _positive_number(request, name):
    value = request.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 1_000_000:
        raise ProductInputError(f"{name} must be a positive finite number no larger than 1000000")
    return value


def counterweight(request, root=ROOT):
    if not isinstance(request, dict) or set(request) - {"condition_id", "product_name", "volume_cm3", "target_min_kg", "target_max_kg"}:
        raise ProductInputError("Use a source condition, product name, volume and mass target")
    identity = request.get("condition_id")
    if not isinstance(identity, str):
        raise ProductInputError("Choose a published material and process")
    product_name = request.get("product_name", "Counterweight")
    if not isinstance(product_name, str) or not 1 <= len(product_name.strip()) <= 120:
        raise ProductInputError("Give the product a name between 1 and 120 characters")
    selected = next((case for case in density_cases(root) if case["id"] == identity), None)
    if selected is None:
        raise ProductInputError("No measured density is linked to this input. A density measurement after the chosen process is needed.")
    volume = _positive_number(request, "volume_cm3")
    low = _positive_number(request, "target_min_kg")
    high = _positive_number(request, "target_max_kg")
    if low > high:
        raise ProductInputError("The minimum target mass must not exceed the maximum")
    densities = selected["density_values_g_cm3"]
    masses = [density * volume / 1000 for density in densities]
    inside = [value for value in masses if (value >= low or math.isclose(value, low, rel_tol=1e-12, abs_tol=1e-12))
              and (value <= high or math.isclose(value, high, rel_tol=1e-12, abs_tol=1e-12))]
    minimum_volume = low * 1000 / min(densities)
    maximum_volume = high * 1000 / max(densities)
    return {
        "result_kind": "simulation", "product_name": product_name.strip(), "condition": selected,
        "volume_cm3": volume, "target_min_kg": low, "target_max_kg": high,
        "formula": "mass_kg = source_density_g_cm3 * assumed_uniform_volume_cm3 / 1000",
        "mean_density_mass_kg": statistics.mean(densities) * volume / 1000,
        "source_scenarios_kg": masses,
        "observed_source_mass_min_kg": min(masses), "observed_source_mass_max_kg": max(masses),
        "source_scenarios_in_target": len(inside), "source_scenario_count": len(masses),
        "all_source_scenarios_in_target": len(inside) == len(masses),
        "suggested_volume_cm3": ((low + high) / 2) * 1000 / statistics.mean(densities),
        "volume_interval_for_source_range_cm3": {"min": minimum_volume, "max": maximum_volume}
        if minimum_volume <= maximum_volume else None,
        "assumptions": ASSUMPTIONS,
        "physical_product_tested": False, "batch_consistency_established": False,
    }
