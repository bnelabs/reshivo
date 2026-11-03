"""Reproducible numerical policy checks; no model calls or physical test claims."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import itertools
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rematter.adaptation import adjust_from_measurement, plan_adaptation


DENSITIES = [round(1.5 + .15 * index, 2) for index in range(21)]
FAMILIES = [
    {"id": "roomy_exact", "capacity": 5000, "tare_error": 0, "density_error": 0, "volume_error": 0},
    {"id": "tight_capacity", "capacity": 2500, "tare_error": 0, "density_error": 0, "volume_error": 0},
    {"id": "density_uncertainty", "capacity": 5000, "tare_error": 0, "density_error": .1, "volume_error": 0},
    {"id": "combined_uncertainty", "capacity": 5000, "tare_error": .02, "density_error": .005, "volume_error": 2},
]
TOLERANCE = 1e-9


def request_for(family):
    return {
        "case": {
            "label": "Predefined synthetic evaluation material, not measured waste",
            "components": [
                {"name": "Simulated main constituent", "role": "main", "amount": 95, "unit": "mass_percent"},
                {"name": "Simulated binder", "role": "binder", "amount": 5, "unit": "mass_percent"},
            ],
            "amount_basis": "Hypothetical dry-mass percentages; no recipe-to-density model",
            "process": "Synthetic external-volume mass model, not a fabrication process",
            "density_method": "Predefined numerical density cases, not measurements",
            "density_volume_basis": "external_volume", "calculation_volume_basis": "external_volume",
            "volume_basis_details": "Synthetic occupied external volume, including any assumed pores",
        },
        "data_kind": "synthetic",
        "observations": [
            {"id": f"D{index + 1:02d}", "value_g_cm3": density, "reading_kind": "unknown",
             "batch_id": None, "run_id": None, "specimen_id": None, "repeat_of": None}
            for index, density in enumerate(DENSITIES)
        ],
        "tare_mass_kg": 1, "tare_uncertainty_kg": family["tare_error"],
        "target_min_kg": 9.9, "target_max_kg": 10.1,
        "max_fill_volume_cm3": family["capacity"], "baseline_fill_volume_cm3": min(3000, family["capacity"]),
        "density_uncertainty_g_cm3": family["density_error"], "volume_tolerance_cm3": family["volume_error"],
    }


def forward_corners(request, density, command):
    """Independent forward evaluation of all bounding corners, not planner helpers."""
    tare = request["tare_mass_kg"]
    tare_error = request["tare_uncertainty_kg"]
    if command == 0:
        return tare - tare_error, tare + tare_error, True
    values = []
    capacity_ok = True
    for tare_sign, density_sign, volume_sign in itertools.product((-1, 1), repeat=3):
        actual_volume = command + volume_sign * request["volume_tolerance_cm3"]
        capacity_ok &= -TOLERANCE <= actual_volume <= request["max_fill_volume_cm3"] + TOLERANCE
        values.append(tare + tare_sign * tare_error +
                      (density + density_sign * request["density_uncertainty_g_cm3"]) * actual_volume * .001)
    return min(values), max(values), bool(capacity_ok)


def inside_target(request, mass_min, mass_max):
    return mass_min >= request["target_min_kg"] - TOLERANCE and mass_max <= request["target_max_kg"] + TOLERANCE


def reference_feasible(request, density):
    """Find feasibility by monotone forward bisection rather than inverse formulas."""
    no_fill_min, no_fill_max, _ = forward_corners(request, density, 0)
    if inside_target(request, no_fill_min, no_fill_max):
        return True
    lower = request["volume_tolerance_cm3"]
    upper = request["max_fill_volume_cm3"] - lower
    if lower > upper:
        return False
    at_low = forward_corners(request, density, lower)
    at_high = forward_corners(request, density, upper)
    if at_low[1] > request["target_max_kg"] + TOLERANCE or at_high[0] < request["target_min_kg"] - TOLERANCE:
        return False
    left, right = lower, upper
    for _ in range(80):
        middle = (left + right) / 2
        if forward_corners(request, density, middle)[0] < request["target_min_kg"]:
            left = middle
        else:
            right = middle
    candidate = right
    minimum, maximum, capacity_ok = forward_corners(request, density, candidate)
    return capacity_ok and inside_target(request, minimum, maximum)


def benchmark():
    families = []
    all_cases = []
    for family in FAMILIES:
        request = request_for(family)
        plan = plan_adaptation(request)
        cases = []
        for density, row in zip(DENSITIES, plan["observations"]):
            baseline_min, baseline_max, baseline_capacity = forward_corners(request, density, request["baseline_fill_volume_cm3"])
            baseline_inside = baseline_capacity and inside_target(request, baseline_min, baseline_max)
            adaptive = row["adjustable"]
            oracle_feasible = reference_feasible(request, density)
            adaptive_valid = None
            actual_min = actual_max = None
            if adaptive["feasible"]:
                actual_min, actual_max, actual_capacity = forward_corners(request, density, adaptive["chosen_volume_cm3"])
                adaptive_valid = actual_capacity and inside_target(request, actual_min, actual_max)
            case = {"id": f"{family['id']}:{row['observation']['id']}", "density_g_cm3": density,
                    "baseline_inside_mass_and_capacity": baseline_inside,
                    "baseline_mass_interval_kg": [baseline_min, baseline_max],
                    "adaptive_claimed_feasible": adaptive["feasible"],
                    "independent_reference_feasible": oracle_feasible,
                    "adaptive_forward_check_passed": adaptive_valid,
                    "adaptive_volume_cm3": adaptive["chosen_volume_cm3"],
                    "adaptive_mass_interval_kg": [actual_min, actual_max] if adaptive_valid is not None else None}
            cases.append(case)
            all_cases.append(case)
        families.append({"definition": family, "baseline_command_cm3": request["baseline_fill_volume_cm3"],
                         "fixed_common_volume_feasible": plan["fixed_volume"]["feasible"], "cases": cases})

    plan_request = request_for(FAMILIES[0])
    plan = plan_adaptation(plan_request)
    feedback_cases = []
    for index, density in enumerate(DENSITIES):
        observed_mass = round(1 + density * 3000 * .001, 12)
        request = {"plan": deepcopy(plan_request), "plan_fingerprint": plan["plan_fingerprint"],
                   "observation": {"id": f"W{index + 1:02d}", "kind": "simulated", "mass_kg": observed_mass, "uncertainty_kg": .02},
                   "max_add_mass_kg": 2, "max_remove_mass_kg": 2, "adjustment_uncertainty_kg": .01}
        result = adjust_from_measurement(request)
        valid = None
        if result["feasible"]:
            command = result["chosen_signed_adjustment_kg"]
            error = request["adjustment_uncertainty_kg"] if result["action"] != "none" else 0
            minimum = observed_mass - .02 + command - error
            maximum = observed_mass + .02 + command + error
            valid = inside_target(plan_request, minimum, maximum) and command - error >= -2 - TOLERANCE and command + error <= 2 + TOLERANCE
        feedback_cases.append({"id": request["observation"]["id"], "simulated_observed_mass_kg": observed_mass,
                               "feasible": result["feasible"], "action": result["action"],
                               "signed_adjustment_kg": result["chosen_signed_adjustment_kg"], "independent_mass_check_passed": valid})

    summary = {
        "volume_case_count": len(all_cases),
        "fixed_baseline_cases_inside_mass_and_capacity": sum(case["baseline_inside_mass_and_capacity"] for case in all_cases),
        "adaptive_cases_feasible": sum(case["adaptive_claimed_feasible"] for case in all_cases),
        "adaptive_infeasible_cases": sum(not case["adaptive_claimed_feasible"] for case in all_cases),
        "feasibility_disagreements_with_independent_reference": sum(case["adaptive_claimed_feasible"] != case["independent_reference_feasible"] for case in all_cases),
        "adaptive_claimed_feasible_but_forward_check_failed": sum(case["adaptive_forward_check_passed"] is False for case in all_cases),
        "mass_feedback_case_count": len(feedback_cases),
        "mass_feedback_cases_feasible": sum(case["feasible"] for case in feedback_cases),
        "mass_feedback_claimed_feasible_but_forward_check_failed": sum(case["independent_mass_check_passed"] is False for case in feedback_cases),
    }
    assert summary["feasibility_disagreements_with_independent_reference"] == 0
    assert summary["adaptive_claimed_feasible_but_forward_check_failed"] == 0
    assert summary["mass_feedback_claimed_feasible_but_forward_check_failed"] == 0
    return {
        "schema_version": 1, "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "result_kind": "simulation", "data_kind": "synthetic", "model_calls": 0,
        "purpose": "Validate a fixed policy versus observation-specific adaptation within a bounded numerical model, not AI advantage.",
        "provenance": "All densities and uncertainty settings are predefined synthetic evaluation cases. They are not derived from recipe or contaminant levels and are not physical measurements or production batches.",
        "evaluation_grid": DENSITIES,
        "baseline_definition": "Commit one nominal fill volume (3000 cm3, reduced only to nominal capacity when smaller). It is not re-optimized after seeing a density observation.",
        "adaptive_definition": "Choose a separate feasible volume after each supplied observation, subject to the same mass, capacity and uncertainty constraints.",
        "fairness_limit": "These are different fixed/adaptive policies. There is no language-model baseline, no model training, no experimental sample-efficiency claim and no demonstrated AI advantage.",
        "feedback_limit": "The separate feedback cases check mass only. Available adjustment limits are assumptions; occupied volume, retention and durability are not verified.",
        "numerical_validation": "Independent forward-corner evaluation plus monotone forward bisection; absolute comparison tolerance 1e-9.",
        "summary": summary, "families": families, "mass_feedback_cases": feedback_cases,
        "physical_product_tested": False, "future_batches_predicted": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Explicit JSON artifact path")
    args = parser.parse_args()
    report = benchmark()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(json.dumps({"artifact": str(args.output.resolve()), **report["summary"]}, indent=2))


if __name__ == "__main__":
    main()
