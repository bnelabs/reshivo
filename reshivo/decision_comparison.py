"""Join current setup checks and entered manufacturing costs without predicting performance."""

from fractions import Fraction

from .advisor import _manufacturing_context, _project_context
from .manufacturing_cost import compare_manufacturing_costs
from .products import ProductInputError
from .trial_records import assess_trial_records

_METRICS = ("per_usable_unit", "per_usable_kg", "per_usable_m2")
_KEYS = {"case_id", "configurations", "checks", "records", "assessment_kind", "cost_records"}
_UNRESOLVED = {"missing_records", "needs_review", "target_not_set", "no_required_checks"}


def compare_project_decisions(request):
    """Recalculate both panels, validate bindings, and select only among checked setups.

    The returned result describes entered readings and costs; it never establishes
    a physical product, a recipe optimum, a causal effect or future consistency.
    See docs/DECISION_COMPARISON.md for exact qualification and blocking rules.
    """
    if not isinstance(request, dict) or set(request) != _KEYS:
        raise ProductInputError("Include the case, setups, checks, records, reading kind and cost records only")
    project = {key: request[key] for key in _KEYS if key != "cost_records"}
    # These shared validators enforce exact source, version, method and recipe bindings
    # before any ranking. Their summaries are freshly derived from the captured inputs.
    parsed = _project_context(project)
    case = {**parsed, "project_context": project}
    binding = _manufacturing_context(request["cost_records"], case)
    assessment = assess_trial_records(project)
    current = assessment["configurations"]
    costs = compare_manufacturing_costs(binding["manufacturing_costs"])
    cost_by_id = {entry["configuration_id"]: entry for entry in costs["results"]}
    reasons = []
    current_ids = {entry["id"] for entry in current}
    if not current:
        reasons.append("Add at least one current trial setup.")
    if set(cost_by_id) != current_ids:
        reasons.append("Add one current cost record for every setup before comparing.")
    reasons.extend(costs.get("reasons", []))
    unresolved = any(row["state"] == "no_required_checks" or any(
        check["required"] and (check["state"] in _UNRESOLVED or check["needs_review"]) for check in row["checks"]
    ) for row in current)
    if unresolved:
        reasons.append("Resolve missing targets, readings or record reviews for every required check before selecting a setup.")
    setups = []
    for row in current:
        captured = next(item for item in project["configurations"] if item["id"] == row["id"] and item["revision"] == row["revision"])
        cost = cost_by_id.get(row["id"])
        setups.append({"id": row["id"], "revision": row["revision"], "name": captured["name"],
                       "state": row["state"], "checks": row["checks"],
                       "entered_readings_fit_required_targets": row["state"] == "all_entered_checks_in_range",
                       "cost": cost})
    eligible = [row for row in setups if row["entered_readings_fit_required_targets"]]
    decisions = {metric: None for metric in _METRICS}
    if not eligible and current and not unresolved:
        reasons.append("No setup has entered readings inside every required target.")
    if not reasons and eligible:
        for metric in _METRICS:
            field = "unit_costs." + metric
            # All setups need a positive denominator on the same metric, even those
            # outside a target: otherwise the comparison universe is incomplete.
            if any(field not in row["cost"]["exact_values"] for row in setups):
                continue
            values = []
            for row in eligible:
                exact = row["cost"]["exact_values"][field]
                values.append((row, Fraction(int(exact["numerator"]), int(exact["denominator"]))))
            lowest = min(value for _, value in values)
            matches = [row for row, value in values if value == lowest]
            decisions[metric] = {"configuration_ids": [row["id"] for row in matches],
                                 "tie": len(matches) > 1,
                                 "cost": matches[0]["cost"]["unit_costs"][metric],
                                 "exact_cost": {"numerator": str(lowest.numerator), "denominator": str(lowest.denominator)}}
    # A cost-only winner is deliberately not returned: it could be outside a required target.
    return {"status": "ready" if any(decisions.values()) else "needs_more_information",
            "case_id": assessment["case_id"], "assessment_kind": assessment["assessment_kind"],
            "configurations": setups,
            "cost_comparison": {"comparable": costs["comparable"], "reasons": costs["reasons"]},
            "decisions": decisions, "reasons": list(dict.fromkeys(reasons)),
            "ignored_records": assessment["ignored_records"],
            "warnings": ["The selection describes only entered readings and costs for these recorded setups. It does not qualify a finished product or predict future batches.",
                         "Cost records are user-entered simulations and are not independent physical-property measurements."],
            "performance_verified": False, "physical_product_tested": False,
            "future_consistency_predicted": False, "causal_effect_established": False}
