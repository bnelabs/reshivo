"""Locked synthetic engineering comparison; tools-only unless live mode is explicit."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import itertools
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reshivo.adaptation import adjust_from_measurement, plan_adaptation
from reshivo.engineering_agent import (
    ACTIONS, _initial_context, assist_with_adaptation, validate_assist_request,
)
from reshivo.materials import ROOT
from reshivo.meta import MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError


PROTOCOL = "engineering-v1"
MAX_CALLS = 4
TOKENS_PER_CALL = 4096
MAX_SECONDS = 210
TOLERANCE = 1e-9
ARMS = ("plain", "tools", "workflow")
CASE_IDS = (
    "fixed_feasible", "adjustable_volume", "capacity_repair", "wide_density_error",
    "overweight_tare", "feedback_add", "feedback_remove", "feedback_limited", "feedback_keep",
)
NUMERIC_FIELDS = ("fixed_volume_cm3", "proposed_capacity_cm3", "adjustment_kg")
DECISION_FIELDS = {"action", *NUMERIC_FIELDS, "volumes_cm3", "answer", "final"}
MODEL_EQUATIONS = """This is a synthetic numerical task, not a fabrication instruction.
Use the shared target and supplied bounds unchanged. At nonzero nominal fill volume V,
actual volume is V +/- volume_tolerance_cm3 and must be in [0, max_fill_volume_cm3].
Mass in kg = tare_mass_kg +/- tare_uncertainty_kg +
(density_g_cm3 +/- density_uncertainty_g_cm3) * actual_volume_cm3 / 1000.
Every uncertainty corner must fit target_min_kg through target_max_kg inclusive.
At zero fill only tare and its uncertainty remain. The two entered density values are
exactly the supplied minimum and maximum (there are exactly two distinct readings).
A fixed volume must fit both. If fixed cannot fit but per-density volumes can, adjust
volume. If capacity alone prevents feasibility, propose the MINIMUM larger capacity
and feasible per-density volumes. If larger capacity cannot resolve all cases, ask
for changed constraints, keeping current input values intact.
If feedback is supplied it takes priority: use its complete-assembly mass +/- observation
uncertainty and signed adjustment +/- adjustment_uncertainty_kg, without density.
Actual correction must be within [-max_remove_mass_kg, max_add_mass_kg]. Positive adds
mass, negative removes mass. All resulting mass corners must fit the target. If the
existing assembly interval already fits, keep mass with zero correction and no correction
error. A mass correction does not check volume. No measured physical outcome is claimed.
Prefer keep_fixed whenever a common fixed volume is feasible. Otherwise choose the
applicable checked change. A feasible correction need not be the interval midpoint.
Return the requested JSON. Unused numeric fields are null, unused volumes_cm3 is [].
For adjust_volume and increase_capacity provide one volume for each density keyed by
density_g_cm3; keep_fixed uses fixed_volume_cm3 instead. adjustment_kg is SIGNED.
The answer is unverified prose. Set final=false only if you want to review your own
answer in another model call. You have at most four calls; no calculator/grader feedback
will be supplied. Do not invent inputs, physical measurements or other properties.
"""


def digest(value):
    encoded = json.dumps(value, sort_keys=True, allow_nan=False, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def cases():
    """Return fresh complete shared cases; no source densities or inferred ingredients."""
    process = "Synthetic external-volume mass model; no physical processing"
    label = "Predefined synthetic numerical fixture"
    basis = "Hypothetical dry-mass identity only; density supplied independently"
    recipe = [{"name": "Synthetic material", "role": "main", "amount": 100, "unit": "mass_percent"}]
    base = {
        "brief": {"input": "Synthetic numerical material, not a measured waste stream",
                  "variation": "Two independently supplied numerical density observations",
                  "contamination": "No material identity or contaminant response is modelled",
                  "product": "Synthetic contained mass assembly",
                  "use_case": "Software mass and capacity comparison only",
                  "targets": "Complete assembly mass 0.98 to 1.02 kg inclusive",
                  "process": process,
                  "available_changes": "Fill volume, a proposed larger capacity, or bounded mass correction when feedback is supplied; do not change the recipe, target, tare or uncertainty"},
        "calculation_context": {"label": label, "components": [
            {"id": 1, "name": "Synthetic material", "role": "main", "amount": "100"}],
            "amount_unit": "mass_percent", "amount_basis": basis,
            "mass_target_min_kg": "0.98", "mass_target_max_kg": "1.02"},
        "question": "Choose the simplest supported next action for the supplied numerical case. If larger capacity alone is needed, propose and recheck its minimum. If feedback is supplied, decide that assembly's next mass correction instead. Keep the target and all inputs unchanged.",
        "plan": {"case": {"label": label, "components": recipe, "amount_basis": basis,
                          "process": process, "density_method": "Predefined synthetic observations; no physical measurements",
                          "density_volume_basis": "external_volume", "calculation_volume_basis": "external_volume",
                          "volume_basis_details": "Synthetic occupied external volume including any modelled pores"},
                 "data_kind": "synthetic", "observations": [
                     {"id": f"D{index + 1}", "value_g_cm3": value, "reading_kind": "unknown",
                      "batch_id": None, "run_id": None, "specimen_id": None, "repeat_of": None}
                     for index, value in enumerate((2, 4))],
                 "tare_mass_kg": 0, "tare_uncertainty_kg": 0,
                 "target_min_kg": .98, "target_max_kg": 1.02,
                 "max_fill_volume_cm3": 750, "baseline_fill_volume_cm3": 250,
                 "density_uncertainty_g_cm3": 0, "volume_tolerance_cm3": 0},
        "feedback": None,
    }
    result = []
    for identity in CASE_IDS:
        request = deepcopy(base)
        plan = request["plan"]
        if identity == "fixed_feasible":
            plan["observations"][1]["value_g_cm3"] = 2.02
            plan.update(max_fill_volume_cm3=1000, baseline_fill_volume_cm3=500)
        elif identity == "capacity_repair":
            plan["max_fill_volume_cm3"] = 300
        elif identity == "wide_density_error":
            plan["density_uncertainty_g_cm3"] = .2
        elif identity == "overweight_tare":
            plan.update(tare_mass_kg=1.1, tare_uncertainty_kg=.01)
        elif identity.startswith("feedback_"):
            mass = {"feedback_add": .95, "feedback_remove": 1.05,
                    "feedback_limited": .95, "feedback_keep": 1}[identity]
            request["feedback"] = {
                "observation": {"id": "W1", "kind": "simulated", "mass_kg": mass, "uncertainty_kg": .005},
                "max_add_mass_kg": .01 if identity == "feedback_limited" else .1,
                "max_remove_mass_kg": .1, "adjustment_uncertainty_kg": .005,
            }
        result.append({"id": identity, "request": validate_assist_request(request)})
    return result


def finite_number(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def close(left, right):
    return finite_number(left) and finite_number(right) and abs(left - right) <= TOLERANCE


def forward_volume(plan, density, command, capacity=None):
    """Independent evaluation, with no production calculation helper calls."""
    capacity = plan["max_fill_volume_cm3"] if capacity is None else capacity
    if command == 0:
        return (plan["tare_mass_kg"] - plan["tare_uncertainty_kg"],
                plan["tare_mass_kg"] + plan["tare_uncertainty_kg"], True)
    masses, volumes = [], []
    for ts, ds, vs in itertools.product((-1, 1), repeat=3):
        volume = command + vs * plan["volume_tolerance_cm3"]
        volumes.append(volume)
        masses.append(plan["tare_mass_kg"] + ts * plan["tare_uncertainty_kg"] +
                      (density + ds * plan["density_uncertainty_g_cm3"]) * volume / 1000)
    return min(masses), max(masses), min(volumes) >= -TOLERANCE and max(volumes) <= capacity + TOLERANCE


def inside(plan, lower, upper):
    return lower >= plan["target_min_kg"] - TOLERANCE and upper <= plan["target_max_kg"] + TOLERANCE


def monotone_interval(lower, upper, forward, target_lower, target_upper):
    """Bisection on forward bounds, rather than the solver's inverse equations."""
    if lower > upper or forward(upper)[0] < target_lower - TOLERANCE or forward(lower)[1] > target_upper + TOLERANCE:
        return None
    if forward(lower)[0] < target_lower:
        left, right = lower, upper
        for _ in range(90):
            middle = (left + right) / 2
            if forward(middle)[0] < target_lower:
                left = middle
            else:
                right = middle
        lower = right
    if forward(upper)[1] > target_upper:
        left, right = lower, upper
        for _ in range(90):
            middle = (left + right) / 2
            if forward(middle)[1] > target_upper:
                right = middle
            else:
                left = middle
        upper = left
    if lower > upper + TOLERANCE:
        return None
    middle = (lower + upper) / 2
    lo, hi = forward(middle)[:2]
    if lo < target_lower - TOLERANCE or hi > target_upper + TOLERANCE:
        return None
    return [lower, upper]


def volume_reference(plan, capacity=None):
    capacity = plan["max_fill_volume_cm3"] if capacity is None else capacity
    intervals = []
    for row in plan["observations"]:
        density = row["value_g_cm3"]
        zero = forward_volume(plan, density, 0, capacity)
        if inside(plan, *zero[:2]):
            interval = [0, 0]
        else:
            error = plan["volume_tolerance_cm3"]
            interval = monotone_interval(error, capacity - error,
                                         lambda command: forward_volume(plan, density, command, capacity),
                                         plan["target_min_kg"], plan["target_max_kg"])
        intervals.append({"density_g_cm3": density, "interval_cm3": interval})
    fixed = None
    if all(row["interval_cm3"] is not None for row in intervals):
        lower = max(row["interval_cm3"][0] for row in intervals)
        upper = min(row["interval_cm3"][1] for row in intervals)
        if lower <= upper + TOLERANCE:
            fixed = [lower, upper]
    return {"fixed_interval_cm3": fixed, "per_density": intervals,
            "all_adjustable_feasible": all(row["interval_cm3"] is not None for row in intervals)}


def forward_feedback(request, command):
    feedback = request["feedback"]
    observation = feedback["observation"]
    error = 0 if command == 0 else feedback["adjustment_uncertainty_kg"]
    masses = [observation["mass_kg"] + ms * observation["uncertainty_kg"] + command + cs * error
              for ms, cs in itertools.product((-1, 1), repeat=2)]
    bounds_ok = command - error >= -feedback["max_remove_mass_kg"] - TOLERANCE and command + error <= feedback["max_add_mass_kg"] + TOLERANCE
    return min(masses), max(masses), bounds_ok


def independent_reference(request):
    plan, feedback = request["plan"], request["feedback"]
    if feedback is not None:
        zero = forward_feedback(request, 0)
        if inside(plan, *zero[:2]):
            return {"action": "keep_mass", "signed_adjustment_interval_kg": [0, 0], "midpoint_adjustment_kg": 0}
        error = feedback["adjustment_uncertainty_kg"]
        # The observation is outside target here; the feasible interval excludes zero.
        interval = monotone_interval(-feedback["max_remove_mass_kg"] + error,
                                     feedback["max_add_mass_kg"] - error,
                                     lambda command: forward_feedback(request, command),
                                     plan["target_min_kg"], plan["target_max_kg"])
        if interval is None:
            return {"action": "request_changes", "signed_adjustment_interval_kg": None}
        midpoint = sum(interval) / 2
        return {"action": "add_mass" if midpoint > 0 else "remove_mass",
                "signed_adjustment_interval_kg": interval, "midpoint_adjustment_kg": midpoint}
    result = volume_reference(plan)
    if result["fixed_interval_cm3"] is not None:
        return {"action": "keep_fixed", **result}
    if result["all_adjustable_feasible"]:
        return {"action": "adjust_volume", **result}
    unlimited = volume_reference(plan, 1_000_000)
    if unlimited["all_adjustable_feasible"]:
        minimum = max(row["interval_cm3"][0] + plan["volume_tolerance_cm3"] for row in unlimited["per_density"])
        return {"action": "increase_capacity", "minimum_capacity_cm3": minimum,
                "repaired_reference": volume_reference(plan, minimum), **result}
    return {"action": "request_changes", **result}


def blank_decision(action, answer="Deterministic bounded calculation"):
    return {"action": action, "fixed_volume_cm3": None, "volumes_cm3": [],
            "proposed_capacity_cm3": None, "adjustment_kg": None, "answer": answer, "final": True}


def extract_decision(result):
    presentation = result.get("decision")
    if not isinstance(presentation, dict):
        return None
    basis = next((row for row in result.get("tool_trace", []) if row.get("id") == presentation.get("basis_call_id")), None)
    if basis is None:
        return None
    action, calculation = presentation["action"], basis["result"]
    decision = blank_decision(action, result.get("answer") or "Executed bounded result")
    if action == "keep_fixed":
        decision["fixed_volume_cm3"] = calculation["fixed_volume"]["chosen_volume_cm3"]
    elif action in {"adjust_volume", "increase_capacity"}:
        if action == "increase_capacity":
            decision["proposed_capacity_cm3"] = calculation["proposed_max_fill_volume_cm3"]
            calculation = calculation["checked_plan"]
        decision["volumes_cm3"] = [
            {"density_g_cm3": row["observation"]["value_g_cm3"], "volume_cm3": row["adjustable"]["chosen_volume_cm3"]}
            for row in calculation["observations"]]
    elif action in {"add_mass", "remove_mass", "keep_mass"}:
        decision["adjustment_kg"] = calculation["chosen_signed_adjustment_kg"]
    return decision


def decision_valid(decision):
    if not isinstance(decision, dict) or set(decision) != DECISION_FIELDS:
        return False
    if not isinstance(decision["action"], str) or decision["action"] not in ACTIONS or type(decision["final"]) is not bool:
        return False
    if not isinstance(decision["answer"], str) or not decision["answer"].strip() or len(decision["answer"]) > 3000:
        return False
    if any(decision[key] is not None and not finite_number(decision[key]) for key in NUMERIC_FIELDS):
        return False
    rows = decision["volumes_cm3"]
    if not isinstance(rows, list) or len(rows) > 2:
        return False
    return all(isinstance(row, dict) and set(row) == {"density_g_cm3", "volume_cm3"}
               and finite_number(row["density_g_cm3"]) and finite_number(row["volume_cm3"]) for row in rows)


def grade(request, decision, reference=None):
    reference = reference or independent_reference(request)
    structural = decision_valid(decision) and decision["final"]
    if not structural:
        return {"structurally_valid": False, "action_correct": False, "numeric_correct": False,
                "engineering_correct": False, "expected_action": reference["action"]}
    action, plan = decision["action"], request["plan"]
    action_ok = action == reference["action"]
    unused = {
        "keep_fixed": {"fixed_volume_cm3"}, "adjust_volume": set(),
        "increase_capacity": {"proposed_capacity_cm3"},
        "add_mass": {"adjustment_kg"}, "remove_mass": {"adjustment_kg"},
        "keep_mass": {"adjustment_kg"}, "request_changes": set(),
    }[action]
    numeric = all(decision[key] is None for key in NUMERIC_FIELDS if key not in unused)
    if action not in {"adjust_volume", "increase_capacity"}:
        numeric &= decision["volumes_cm3"] == []
    if action == "request_changes":
        numeric &= reference["action"] == "request_changes"
    elif action == "keep_fixed":
        command = decision["fixed_volume_cm3"]
        numeric &= finite_number(command) and command >= 0
        if numeric:
            numeric &= all(inside(plan, *forward_volume(plan, row["value_g_cm3"], command)[:2])
                           and forward_volume(plan, row["value_g_cm3"], command)[2] for row in plan["observations"])
    elif action in {"adjust_volume", "increase_capacity"}:
        capacity = plan["max_fill_volume_cm3"]
        if action == "increase_capacity":
            capacity = decision["proposed_capacity_cm3"]
            numeric &= (finite_number(capacity) and capacity > plan["max_fill_volume_cm3"]
                        and capacity <= 1_000_000 and close(capacity, reference.get("minimum_capacity_cm3")))
        rows = decision["volumes_cm3"]
        densities = [row["value_g_cm3"] for row in plan["observations"]]
        numeric &= len(rows) == len(densities) and sorted(row["density_g_cm3"] for row in rows) == sorted(densities)
        if numeric:
            numeric &= all(row["volume_cm3"] >= 0 and inside(plan, *forward_volume(plan, row["density_g_cm3"], row["volume_cm3"], capacity)[:2])
                           and forward_volume(plan, row["density_g_cm3"], row["volume_cm3"], capacity)[2] for row in rows)
    elif request["feedback"] is None:
        numeric = False
    else:
        command = decision["adjustment_kg"]
        numeric &= finite_number(command)
        if numeric:
            numeric &= ((action == "add_mass" and command > 0) or (action == "remove_mass" and command < 0)
                        or (action == "keep_mass" and command == 0))
            lower, upper, bounds = forward_feedback(request, command)
            numeric &= bounds and inside(plan, lower, upper)
    return {"structurally_valid": True, "action_correct": action_ok, "numeric_correct": bool(numeric),
            "engineering_correct": bool(action_ok and numeric), "expected_action": reference["action"]}


def tools_only(request):
    """Strong deterministic policy; references are never consulted to choose actions."""
    trace = []

    def execute(name, inputs, function):
        started = time.monotonic()
        result = function(inputs)
        trace.append({"id": f"T{len(trace) + 1}", "name": name, "arguments": {}, "inputs": deepcopy(inputs),
                      "result": result, "elapsed_ms": round((time.monotonic() - started) * 1000)})
        return result

    plan = request["plan"]
    if request["feedback"] is not None:
        result = execute("check_mass_feedback", {"plan": deepcopy(plan), "plan_fingerprint": digest(plan),
                                                **deepcopy(request["feedback"])}, adjust_from_measurement)
        action = {"add": "add_mass", "remove": "remove_mass", "none": "keep_mass", "unresolved": "request_changes"}[result["action"]]
    else:
        result = execute("compare_current_design", plan, plan_adaptation)
        if result["fixed_volume"]["feasible"]:
            action = "keep_fixed"
        elif result["adjustable_observations_feasible"] == result["observation_count"]:
            action = "adjust_volume"
        else:
            failed = [row for row in result["observations"] if not row["adjustable"]["feasible"]]
            action = "request_changes"
            if failed and all(row["diagnostics"]["capacity_can_resolve"] for row in failed):
                proposed = deepcopy(plan)
                proposed["max_fill_volume_cm3"] = max(row["diagnostics"]["minimum_usable_capacity_cm3"] for row in failed)
                source_id = trace[-1]["id"]

                def repair(inputs):
                    checked = plan_adaptation(inputs["plan"])
                    return {"status": "checked_proposal", "proposal_not_applied": True, "source_call_id": source_id,
                            "original_max_fill_volume_cm3": plan["max_fill_volume_cm3"],
                            "proposed_max_fill_volume_cm3": inputs["plan"]["max_fill_volume_cm3"],
                            "all_observations_fit": checked["adjustable_observations_feasible"] == checked["observation_count"],
                            "checked_plan": checked}

                result = execute("check_capacity_repair", {"source_call_id": source_id, "plan": proposed}, repair)
                action = "increase_capacity" if result["all_observations_fit"] else "request_changes"
    return {"status": "completed", "live": False, "answer": "Deterministic bounded calculation; no physical test",
            "decision": {"action": action, "basis_call_id": trace[-1]["id"]}, "tool_trace": trace,
            "answer_verified": False, "physical_product_tested": False}


def plain_schema():
    nullable = {"type": ["number", "null"]}
    return {"type": "object", "additionalProperties": False, "required": sorted(DECISION_FIELDS),
            "properties": {"action": {"type": "string", "enum": sorted(ACTIONS)},
                           **{key: nullable for key in NUMERIC_FIELDS},
                           "answer": {"type": "string", "minLength": 1, "maxLength": 3000}, "final": {"type": "boolean"},
                           "volumes_cm3": {"type": "array", "maxItems": 2, "items": {
                               "type": "object", "additionalProperties": False,
                               "required": ["density_g_cm3", "volume_cm3"],
                               "properties": {"density_g_cm3": {"type": "number"}, "volume_cm3": {"type": "number"}}}}}}


class BudgetExceeded(RuntimeError):
    pass


class DeadlineOpener:
    def __init__(self, opener, meter):
        self.opener, self.meter = opener, meter

    def open(self, request, timeout=50):
        remaining = MAX_SECONDS - (time.monotonic() - self.meter.started)
        if remaining <= 0:
            raise BudgetExceeded("Wall budget exhausted")
        return self.opener.open(request, timeout=min(timeout, remaining))


class MeteredClient:
    """Common ceilings and actual call accounting for both model arms."""
    def __init__(self, client):
        self.client = client
        self.model = client.model
        self.started = time.monotonic()
        self.calls = []
        if hasattr(client, "opener"):
            client.opener = DeadlineOpener(client.opener, self)

    def invoke(self, method, *args, **kwargs):
        if len(self.calls) >= MAX_CALLS or time.monotonic() - self.started >= MAX_SECONDS:
            raise BudgetExceeded("Common model budget exhausted")
        kwargs["max_completion_tokens"] = TOKENS_PER_CALL
        row = {"method": method, "max_completion_tokens": TOKENS_PER_CALL,
               "configured_model": self.model, "status": "attempted"}
        self.calls.append(row)
        started = time.monotonic()
        try:
            result = getattr(self.client, method)(*args, **kwargs)
            row.update(status="responded", returned_model=result.model, live=result.live,
                       usage=result.usage, request_id=result.request_id,
                       model_matches_configuration=result.model == self.model)
            if result.model != self.model:
                raise MetaValidationError("Returned model did not match the configured benchmark model")
            return result
        except (MetaAPIError, MetaConfigurationError, MetaValidationError, BudgetExceeded) as error:
            row.update(status=error_category(error), error_type=type(error).__name__)
            raise
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            row.update(status="unusable_response", error_type=type(error).__name__)
            raise MetaValidationError("Meta returned an unusable benchmark response") from None
        finally:
            row["elapsed_ms"] = round((time.monotonic() - started) * 1000)

    def generate(self, *args, **kwargs):
        return self.invoke("generate", *args, **kwargs)

    def tool_turn(self, *args, **kwargs):
        return self.invoke("tool_turn", *args, **kwargs)


def error_category(error):
    if isinstance(error, MetaConfigurationError):
        return "not_configured"
    if isinstance(error, MetaAPIError):
        return "request_failed"
    if isinstance(error, BudgetExceeded):
        return "budget_exhausted"
    return "unusable_response"


def plain_model(request, client):
    context = _initial_context(request)
    attempts = []
    for _ in range(MAX_CALLS):
        prompt = {"case_context": context, "prior_self_answers": attempts,
                  "instruction": "Answer the case" if not attempts else "Review your own prior answers and return your final decision or another self-revision. No grading feedback is supplied."}
        generation = client.generate(json.dumps(prompt, allow_nan=False), plain_schema(), 1,
                                     system_prompt=MODEL_EQUATIONS, schema_name="engineering_decision",
                                     max_completion_tokens=TOKENS_PER_CALL)
        decision = generation.data
        attempts.append(decision)
        if not decision_valid(decision):
            return {"status": "invalid_decision", "decision": decision, "self_answers": attempts}
        if decision["final"]:
            return {"status": "completed", "decision": decision, "self_answers": attempts, "answer_verified": False}
    return {"status": "limit_reached", "decision": attempts[-1], "self_answers": attempts, "answer_verified": False}


def run_arm(arm, request, client_factory=MetaClient):
    started = time.monotonic()
    meter, result, decision = None, None, None
    status, error = "failed", None
    try:
        if arm == "tools":
            result = tools_only(request)
        else:
            meter = MeteredClient(client_factory(root=ROOT))
            result = plain_model(request, meter) if arm == "plain" else assist_with_adaptation(request, client=meter)
        status = result["status"]
        if status == "completed":
            try:
                decision = result["decision"] if arm == "plain" else extract_decision(result)
            except (KeyError, TypeError, ValueError, OverflowError):
                status = "invalid_decision"
    except (MetaAPIError, MetaConfigurationError, MetaValidationError, BudgetExceeded) as caught:
        status = error_category(caught)
        error = {"category": status, "type": type(caught).__name__}
    calls = meter.calls if meter else []
    responded = any(row.get("live") is True for row in calls)
    scoring = grade(request, decision)
    usage = {}
    for call in calls:
        for name, amount in call.get("usage", {}).items():
            if isinstance(amount, int) and not isinstance(amount, bool) and amount >= 0:
                usage[name] = usage.get(name, 0) + amount
    return {"arm": arm, "status": status, "completed": status == "completed" and scoring["structurally_valid"],
            "provider_available": responded if arm != "tools" else None,
            "availability_categories": sorted({row["status"] for row in calls}),
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "model_calls_attempted": len(calls), "model_responses_received": sum("live" in row for row in calls),
            "computation_calls": len(result.get("tool_trace", [])) if result else 0,
            "usage": usage, "calls": calls, "decision": decision, "grade": scoring,
            "result": result, "error": error, "user_steps_measured": False}


def summarize(records):
    summary = {}
    for arm in ARMS:
        rows = [row for record in records for row in record["arms"] if row["arm"] == arm]
        if not rows:
            continue
        available = [row for row in rows if row["provider_available"] is True] if arm != "tools" else rows
        correct = sum(row["grade"]["engineering_correct"] for row in rows)
        available_correct = sum(row["grade"]["engineering_correct"] for row in available)
        summary[arm] = {"cases_attempted": len(rows), "completed": sum(row["completed"] for row in rows),
                        "engineering_correct": correct, "correct_per_attempt": correct / len(rows),
                        "provider_available_cases": len(available) if arm != "tools" else None,
                        "availability_conditioned_denominator": len(available),
                        "availability_conditioned_correct": available_correct,
                        "availability_conditioned_correct_rate": available_correct / len(available) if available else None,
                        "total_elapsed_ms": sum(row["elapsed_ms"] for row in rows),
                        "model_calls_attempted": sum(row["model_calls_attempted"] for row in rows),
                        "computation_calls": sum(row["computation_calls"] for row in rows)}
    return summary


def redact(value, secrets):
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(child, secrets) for child in value]
    if isinstance(value, dict):
        return {redact(key, secrets): redact(child, secrets) for key, child in value.items()}
    return value


def benchmark(mode="tools", selected=None, client_factory=MetaClient, on_progress=None):
    definitions = cases()
    chosen = definitions if selected is None else [case for case in definitions if case["id"] in selected]
    if selected is not None and (not selected or set(selected) - set(CASE_IDS) or len(selected) != len(set(selected))):
        raise ValueError("Choose distinct predefined case IDs")
    if mode not in {"tools", "all", "plain", "workflow"}:
        raise ValueError("Unknown benchmark mode")
    records, secrets, configured_models = [], [], []
    started_at = datetime.now(timezone.utc).isoformat()
    protocol_path = Path(ROOT) / "docs/ADAPTATION_EVALUATION.md"
    protocol_hash = hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    implementation_hashes = {name: hashlib.sha256((Path(ROOT) / name).read_bytes()).hexdigest()
                             for name in ("reshivo/engineering_agent.py", "reshivo/adaptation.py", "reshivo/meta.py")}

    def capture_factory(**kwargs):
        client = client_factory(**kwargs)
        secrets.append(getattr(client, "key", ""))
        configured_models.append(client.model)
        return client

    def make_report(complete):
        report = {
        "schema_version": 1, "protocol": PROTOCOL, "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "execution_started_at_utc": started_at, "execution_complete": complete,
        "mode": mode, "live_requested": mode != "tools", "result_kind": "synthetic_simulation_comparison",
        "complete_nine_case_matched_run": complete and mode == "all" and len(chosen) == len(CASE_IDS),
        "selected_case_ids": [case["id"] for case in chosen], "full_case_ids": list(CASE_IDS),
        "case_definitions_sha256": digest(definitions),
        "protocol_sha256": protocol_hash, "script_sha256": script_hash,
        "implementation_sha256": implementation_hashes,
        "configured_models": sorted(set(configured_models)),
        "same_configured_model": len(set(configured_models)) <= 1,
        "budgets": {"model_calls_per_arm_max": MAX_CALLS, "completion_tokens_per_call_max": TOKENS_PER_CALL,
                    "completion_tokens_per_arm_max": MAX_CALLS * TOKENS_PER_CALL,
                    "elapsed_seconds_per_arm_max": MAX_SECONDS, "reasoning_effort": "low", "provider_retries": 0},
        "summary": summarize(records), "records": records,
        "interpretation": "Visible synthetic diagnostics only. No physical test, unseen-case generalization, user-step reduction or advantage over the deterministic optimizer is established by this report.",
        "answer_prose_verified": False, "physical_product_tested": False, "user_steps_measured": False,
        }
        return redact(report, secrets)

    for index, case in enumerate(chosen):
        order = ARMS[index % len(ARMS):] + ARMS[:index % len(ARMS)]
        if mode != "all":
            order = (mode,)
        request = case["request"]
        record = {"id": case["id"], "request": request, "request_sha256": digest(request),
                  "model_initial_context": _initial_context(request),
                  "reference": independent_reference(request), "arm_order": list(order), "arms": []}
        records.append(record)
        for arm in order:
            completed_arm = run_arm(arm, deepcopy(request), capture_factory)
            record["arms"].append(completed_arm)
            if on_progress is not None:
                on_progress(make_report(False), case["id"], redact(completed_arm, secrets))
    return make_report(True)


def save_report(output, report):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("tools", "all", "plain", "workflow"), default="tools")
    parser.add_argument("--offline", action="store_true", help="Force tools only; never create a provider client")
    parser.add_argument("--cases", help="Comma-separated predefined IDs for an explicitly partial diagnostic")
    parser.add_argument("--output", type=Path, help="Ignored outputs/ JSON path; default is timestamped there")
    args = parser.parse_args(argv)
    if args.offline and args.mode != "tools":
        parser.error("--offline cannot be combined with a live mode")
    selected = args.cases.split(",") if args.cases is not None else None
    output = args.output or Path(ROOT) / "outputs" / ("engineering-benchmark-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
    output = output.expanduser().resolve()
    if not output.is_relative_to((Path(ROOT) / "outputs").resolve()) or output.suffix != ".json":
        parser.error("Store actual benchmark records as JSON under ignored outputs/")
    def progress(partial, identity, arm):
        save_report(output, partial)
        print(json.dumps({"case": identity, "arm": arm["arm"], "status": arm["status"],
                          "correct": arm["grade"]["engineering_correct"], "elapsed_ms": arm["elapsed_ms"]}),
              file=sys.stderr, flush=True)

    try:
        report = benchmark(args.mode, selected, on_progress=progress)
    except ValueError as error:
        parser.error(str(error))
    save_report(output, report)
    print(json.dumps({"artifact": str(output), "protocol": report["protocol"],
                      "complete_nine_case_matched_run": report["complete_nine_case_matched_run"],
                      "summary": report["summary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
