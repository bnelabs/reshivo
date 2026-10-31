"""Bounded fill-volume planning from stated processed-mix density observations."""
from decimal import Decimal, localcontext
import hashlib
import json
import math
from urllib.parse import urlsplit

from .mix_mass import _case, _readings
from .products import ProductInputError


PLAN_FIELDS = {
    "case", "data_kind", "observations", "tare_mass_kg", "tare_uncertainty_kg",
    "target_min_kg", "target_max_kg", "max_fill_volume_cm3", "baseline_fill_volume_cm3",
    "density_uncertainty_g_cm3", "volume_tolerance_cm3",
}
DATA_KINDS = {"user_measurements", "synthetic", "source_replay"}
ASSUMPTIONS = [
    "Simulation only: assembled mass equals tare plus processed-mix density times external fill volume / 1000.",
    "Density belongs to the stated processed mix, not its separate ingredients. No constituent-density mixing rule is used.",
    "Scaling assumes the measured density remains applicable at the chosen fill volume; changed packing, voids, composition or process remain unmeasured.",
    "Entered uncertainty bounds are user-supplied deterministic bounds, not confidence intervals or inferred statistical tolerances.",
    "Source metadata and readings are supplied by the caller; this calculation does not fetch or independently verify their source, licence or values.",
    "A common volume is compared only against the entered density observations and bounds. Their spread is not future-batch variation.",
    "Each adjustable-volume row is a separate conditional calculation after that observation, not one volume that fits every input.",
    "Capacity checks occupied external fill volume only; enclosure retention, strength, durability and other product properties are not verified.",
    "A numerical fit does not prescribe filling, opening or processing unknown materials at home. Suitable material-specific handling remains necessary.",
]


def _object(value, required, optional=(), label="request"):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ProductInputError(f"Include only the supported {label} fields, with every required field")
    return value


def _number(value, label, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProductInputError(f"{label} must be a finite number")
    if not 0 <= value <= 1_000_000 or not math.isfinite(value):
        raise ProductInputError(f"{label} must be finite, non-negative and at most 1000000")
    if positive and value < 1e-9:
        raise ProductInputError(f"{label} must be at least 0.000000001 for this calculation")
    return float(value)


def _text(value, label, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ProductInputError(f"Enter {label} as text no longer than {maximum} characters")
    return value.strip()


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _d(value):
    return Decimal(str(value))


def _float(value):
    number = float(value)
    if not math.isfinite(number) or (value != 0 and number == 0):
        raise ProductInputError("These inputs exceed the supported numerical range")
    return number


def validate_plan(request):
    _object(request, PLAN_FIELDS, {"source"}, "adaptation request")
    case = _case(request["case"])
    if case["density_volume_basis"] != "external_volume":
        raise ProductInputError("This capacity model needs density measured using external volume, including the specimen's pores")
    if not isinstance(request["data_kind"], str) or request["data_kind"] not in DATA_KINDS:
        raise ProductInputError("Identify user_measurements, synthetic or source_replay data")
    observations = _readings(request["observations"])
    numbers = {}
    for key in PLAN_FIELDS - {"case", "data_kind", "observations"}:
        numbers[key] = _number(request[key], key, key in {"target_max_kg", "max_fill_volume_cm3"})
    if numbers["target_min_kg"] > numbers["target_max_kg"]:
        raise ProductInputError("The minimum mass target must not exceed the maximum")
    if numbers["tare_uncertainty_kg"] > numbers["tare_mass_kg"]:
        raise ProductInputError("Tare uncertainty must not extend below zero mass")
    if numbers["baseline_fill_volume_cm3"] > numbers["max_fill_volume_cm3"]:
        raise ProductInputError("The baseline nominal fill volume must not exceed usable capacity")
    for row in observations:
        _number(row["value_g_cm3"], "Processed-mix density", positive=True)
        if row["value_g_cm3"] <= numbers["density_uncertainty_g_cm3"]:
            raise ProductInputError("Every density uncertainty interval must remain above zero")
    normalized = {"case": case, "data_kind": request["data_kind"], "observations": observations, **numbers}
    if request["data_kind"] == "source_replay":
        source = _object(request.get("source"), {"title", "url", "scope", "license"}, label="source")
        source = {key: _text(source[key], f"source {key}", 300 if key in {"title", "license"} else 1000) for key in source}
        try:
            url = urlsplit(source["url"])
        except ValueError:
            raise ProductInputError("Use a valid public HTTP(S) source URL") from None
        if url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password:
            raise ProductInputError("Use a public HTTP(S) source URL without credentials")
        normalized["source"] = source
    elif "source" in request:
        raise ProductInputError("Source metadata is used only for source_replay data")
    return normalized


def _mass_range(case, density, volume):
    tare = _d(case["tare_mass_kg"])
    tare_error = _d(case["tare_uncertainty_kg"])
    density_error = _d(case["density_uncertainty_g_cm3"])
    volume_error = _d(case["volume_tolerance_cm3"])
    if volume == 0:
        return tare - tare_error, tare + tare_error
    return (
        tare - tare_error + (density - density_error) * (volume - volume_error) / 1000,
        tare + tare_error + (density + density_error) * (volume + volume_error) / 1000,
    )


def _unconstrained_volume_interval(case, density):
    tare = _d(case["tare_mass_kg"])
    tare_error = _d(case["tare_uncertainty_kg"])
    density_error = _d(case["density_uncertainty_g_cm3"])
    volume_error = _d(case["volume_tolerance_cm3"])
    if tare - tare_error >= _d(case["target_min_kg"]) and tare + tare_error <= _d(case["target_max_kg"]):
        return Decimal(0), Decimal(0)
    low = max(volume_error, volume_error + 1000 * (_d(case["target_min_kg"]) - tare + tare_error) / (density - density_error))
    high = -volume_error + 1000 * (_d(case["target_max_kg"]) - tare - tare_error) / (density + density_error)
    return low, high


def _volume_interval(case, density):
    low, high = _unconstrained_volume_interval(case, density)
    if low == high == 0:
        return low, high
    return low, min(_d(case["max_fill_volume_cm3"]) - _d(case["volume_tolerance_cm3"]), high)


def _capacity_diagnostics(case, density, low, high):
    raw_low, raw_high = _unconstrained_volume_interval(case, density)
    result = {"reason_code": "fits_current_capacity", "reason": "A fill volume fits the stated mass and capacity bounds in this model.",
              "capacity_can_resolve": False, "minimum_usable_capacity_cm3": None,
              "capacity_requirement_exceeds_supported_limit": False}
    if raw_low == raw_high == 0:
        result.update(reason_code="no_fill_needed", reason="The tare already fits the mass target; no fill-volume or capacity change is needed for mass.")
    elif low <= high:
        pass
    elif _d(case["tare_mass_kg"]) + _d(case["tare_uncertainty_kg"]) > _d(case["target_max_kg"]):
        result.update(reason_code="tare_above_target", reason="The tare's upper mass bound already exceeds the target; more fill capacity cannot resolve that.")
    elif raw_low > raw_high:
        result.update(reason_code="mass_bounds_incompatible", reason="The stated mass and measurement bounds leave no fill-volume interval inside the target, even without a capacity limit.")
    else:
        required = raw_low + _d(case["volume_tolerance_cm3"])
        if required > 1_000_000:
            result.update(reason_code="capacity_exceeds_model_limit",
                          reason="Capacity alone limits this observation, but its required usable capacity exceeds this model's supported 1000000 cm3 input limit.",
                          capacity_requirement_exceeds_supported_limit=True)
        else:
            minimum = _float(required)
            if _d(minimum) < required:
                minimum = math.nextafter(minimum, math.inf)
            result.update(reason_code="capacity_too_small",
                          reason="The mass and measurement bounds allow a fill volume; usable capacity alone is too small. The minimum includes the fill-volume error margin.",
                          capacity_can_resolve=True, minimum_usable_capacity_cm3=minimum)
    return result


def _interval_result(case, low, high, density=None):
    if low > high:
        return {"feasible": False, "volume_min_cm3": None, "volume_max_cm3": None,
                "chosen_volume_cm3": None, "simulated_mass_min_kg": None, "simulated_mass_max_kg": None}
    chosen = (low + high) / 2
    minimum = maximum = None
    if density is not None:
        minimum, maximum = _mass_range(case, density, chosen)
    return {"feasible": True, "volume_min_cm3": _float(low), "volume_max_cm3": _float(high),
            "chosen_volume_cm3": _float(chosen),
            "simulated_mass_min_kg": _float(minimum) if minimum is not None else None,
            "simulated_mass_max_kg": _float(maximum) if maximum is not None else None}


def plan_adaptation(request):
    """Compare one fixed volume with individually adjusted volumes for supplied readings."""
    case = validate_plan(request)
    with localcontext() as context:
        context.prec = 60
        low_target, high_target = _d(case["target_min_kg"]), _d(case["target_max_kg"])
        error = _d(case["volume_tolerance_cm3"])
        capacity = _d(case["max_fill_volume_cm3"])
        baseline = _d(case["baseline_fill_volume_cm3"])
        baseline_fits = baseline == 0 or error <= baseline <= capacity - error
        no_fill = _d(case["tare_mass_kg"]) - _d(case["tare_uncertainty_kg"]) >= low_target and _d(case["tare_mass_kg"]) + _d(case["tare_uncertainty_kg"]) <= high_target
        fixed_low, fixed_high = (Decimal(0), Decimal(0)) if no_fill else (error, capacity - error)
        rows = []
        for observation in case["observations"]:
            density = _d(observation["value_g_cm3"])
            low, high = _volume_interval(case, density)
            fixed_low, fixed_high = max(fixed_low, low), min(fixed_high, high)
            baseline_min, baseline_max = _mass_range(case, density, baseline) if baseline_fits else (None, None)
            rows.append({
                "observation": dict(observation),
                "baseline": {"volume_cm3": case["baseline_fill_volume_cm3"], "volume_within_capacity": baseline_fits,
                             "simulated_mass_min_kg": _float(baseline_min) if baseline_min is not None else None,
                             "simulated_mass_max_kg": _float(baseline_max) if baseline_max is not None else None,
                             "inside_mass_target": bool(baseline_fits and baseline_min >= low_target and baseline_max <= high_target)},
                "adjustable": _interval_result(case, low, high, density),
                "diagnostics": _capacity_diagnostics(case, density, low, high),
            })
        fixed = _interval_result(case, fixed_low, fixed_high)
        if fixed["feasible"]:
            chosen = (fixed_low + fixed_high) / 2
            mass_ranges = [_mass_range(case, _d(row["value_g_cm3"]), chosen) for row in case["observations"]]
            fixed["simulated_mass_min_kg"] = _float(min(pair[0] for pair in mass_ranges))
            fixed["simulated_mass_max_kg"] = _float(max(pair[1] for pair in mass_ranges))
        adaptive_count = sum(row["adjustable"]["feasible"] for row in rows)
        if no_fill:
            recommendation = "The entered tare interval already fits the mass target. No fill is needed for mass; this does not meet a separate material-reuse objective."
            options = ["If using recycled fill is required, choose a lighter enclosure or reconsider the mass target and recompute."]
        elif fixed["feasible"]:
            recommendation = "One fixed fill volume fits the entered observations and bounds in this model."
            options = ["Compare that volume against an appropriate check of the actual processed mix and enclosure."]
        elif adaptive_count == len(rows):
            recommendation = "One fixed volume does not fit these observations, but individually adjusting fill volume fits each entered observation in this model."
            options = ["Use the applicable density observation to choose a separate volume for that case; do not average observations into a new material.",
                       "Alternatively revise usable capacity, tare or the chosen target and recompute the same observations."]
        else:
            recommendation = "The current capacity, tare, target or uncertainty bounds prevent some entered observations from fitting this model."
            options = []
            if any(row["diagnostics"]["capacity_can_resolve"] for row in rows):
                options.append("For capacity-limited observations, consider a larger usable fill volume at least as large as the reported minimum, then recompute every observation.")
            if any(row["diagnostics"]["capacity_requirement_exceeds_supported_limit"] for row in rows):
                options.append("A required capacity exceeds this model's supported range. Review the stated material, tare and target or use an appropriate wider-range model; do not enter an unsupported capacity here.")
            if any(row["diagnostics"]["reason_code"] == "tare_above_target" for row in rows):
                options.append("For an overweight tare, consider a lighter enclosure or a revised mass target; larger capacity alone cannot resolve it.")
            if any(row["diagnostics"]["reason_code"] == "mass_bounds_incompatible" for row in rows):
                options.append("Some mass and measurement bounds are incompatible even without a capacity limit. Improve those bounds only with a better measurement, or reconsider the tare or target.")
            options.append("Use a separate measured-mass feedback check when a complete assembly has actually been weighed; volume still needs its own check.")
        return {
            "result_kind": "simulation", "model": "processed_mix_external_volume_v1",
            "case": case["case"], "case_fingerprint": _fingerprint(case["case"]),
            "plan_fingerprint": _fingerprint(case), "request": case,
            "data_kind": case["data_kind"], "source": case.get("source"),
            "source_independently_verified": False,
            "fixed_volume": fixed, "observations": rows,
            "observation_count": len(rows),
            "baseline_observations_inside_target": sum(row["baseline"]["inside_mass_target"] for row in rows),
            "adjustable_observations_feasible": adaptive_count,
            "recommendation": recommendation, "next_options": options,
            "assumptions": list(ASSUMPTIONS), "physical_product_tested": False,
            "batch_consistency_established": False, "future_batches_predicted": False,
        }


def adjust_from_measurement(request):
    """Calculate a bounded mass-only correction, tied to the unchanged original plan."""
    _object(request, {"plan", "plan_fingerprint", "observation", "max_add_mass_kg", "max_remove_mass_kg", "adjustment_uncertainty_kg"}, label="feedback request")
    plan = validate_plan(request["plan"])
    fingerprint = _text(request["plan_fingerprint"], "plan fingerprint", 64)
    if fingerprint != _fingerprint(plan):
        raise ProductInputError("The case or plan changed. Recalculate before applying this observation.")
    observation = _object(request["observation"], {"id", "kind", "mass_kg", "uncertainty_kg"}, label="mass observation")
    if observation["kind"] not in ("user_reported", "simulated"):
        raise ProductInputError("Identify the mass observation as user_reported or simulated")
    observation = {"id": _text(observation["id"], "mass observation identifier", 80),
                   "kind": observation["kind"],
                   "mass_kg": _number(observation["mass_kg"], "Observed assembly mass"),
                   "uncertainty_kg": _number(observation["uncertainty_kg"], "Mass observation uncertainty")}
    add = _number(request["max_add_mass_kg"], "Maximum available mass addition")
    remove = _number(request["max_remove_mass_kg"], "Maximum removable adjustable mass")
    adjustment_error = _number(request["adjustment_uncertainty_kg"], "Adjustment uncertainty")
    if observation["uncertainty_kg"] > observation["mass_kg"]:
        raise ProductInputError("Mass observation uncertainty must not extend below zero")
    if _d(remove) > _d(observation["mass_kg"]) - _d(observation["uncertainty_kg"]):
        raise ProductInputError("Removable mass must not exceed the assembly's lower mass bound")
    with localcontext() as context:
        context.prec = 60
        measured = _d(observation["mass_kg"])
        uncertainty = _d(observation["uncertainty_kg"])
        low_target, high_target = _d(plan["target_min_kg"]), _d(plan["target_max_kg"])
        low_mass, high_mass = measured - uncertainty, measured + uncertainty
        if low_mass >= low_target and high_mass <= high_target:
            feasible, low, high, correction, adjusted_low, adjusted_high, action = True, Decimal(0), Decimal(0), Decimal(0), low_mass, high_mass, "none"
        else:
            error = _d(adjustment_error)
            low = max(-_d(remove) + error, low_target - measured + uncertainty + error)
            high = min(_d(add) - error, high_target - measured - uncertainty - error)
            feasible = low <= high
            correction = (low + high) / 2 if feasible else None
            adjusted_low = low_mass + correction - error if feasible else None
            adjusted_high = high_mass + correction + error if feasible else None
            action = "add" if feasible and correction > 0 else "remove" if feasible and correction < 0 else "unresolved"
        return {
            "result_kind": "simulation", "model": "bounded_mass_feedback_v1", "mass_only": True,
            "plan_fingerprint": fingerprint, "case_fingerprint": _fingerprint(plan["case"]),
            "density_data_kind": plan["data_kind"], "observation": observation,
            "observed_mass_min_kg": _float(low_mass), "observed_mass_max_kg": _float(high_mass),
            "feasible": feasible, "action": action,
            "signed_adjustment_min_kg": _float(low) if feasible else None,
            "signed_adjustment_max_kg": _float(high) if feasible else None,
            "chosen_signed_adjustment_kg": _float(correction) if correction is not None else None,
            "simulated_mass_min_kg_after_adjustment": _float(adjusted_low) if adjusted_low is not None else None,
            "simulated_mass_max_kg_after_adjustment": _float(adjusted_high) if adjusted_high is not None else None,
            "volume_status": "Not checked from a mass observation; confirm occupied volume and adjustment space separately.",
            "next_options": (["Apply only a suitable available adjustment, reweigh the closed complete assembly and check volume separately."] if feasible else
                             ["Use a more precise mass observation or adjustment if available, increase permitted adjustment capacity, or reconsider the target."]),
            "assumptions": ["The mass observation and adjustment-error bounds are supplied, not independently verified.",
                            "A signed positive correction adds mass and a negative correction removes mass; no density estimate is used.",
                            "Available addition/removal limits apply to actual adjusted mass; the command reserves room for adjustment uncertainty.",
                            "No-operation results do not incur adjustment error. Any actual adjustment needs a fresh complete-assembly measurement.",
                            "This mass-only result does not establish volume fit, retention, durability or future-batch performance."],
            "physical_product_tested": False, "batch_consistency_established": False,
        }
