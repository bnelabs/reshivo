"""One-axis mass and moment adjustment from stated assembly observations."""
from fractions import Fraction as F
from itertools import product, combinations
import math
import json
from html import escape
from decimal import Decimal

from .products import ProductInputError
from .adaptation import _fingerprint, _object, _text


def _n(value, name, *, signed=False, positive=False, limit=10000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ProductInputError(f"Enter {name} as a finite number")
    if not (-limit if signed else 0) <= value <= limit or (positive and value < 1e-9):
        raise ProductInputError(f"{name} is outside this model's supported range")
    return float(value)


def validate_balance(request):
    _object(request, {"case_label", "coordinate_basis", "observation", "targets", "positions", "baseline", "command_resolution_kg", "total_max_add_kg", "total_max_remove_kg"}, label="balance request")
    observation = _object(request["observation"], {"id", "kind", "mass_kg", "mass_uncertainty_kg", "cg_x_mm", "cg_uncertainty_mm"}, label="mass and balance observation")
    if observation["kind"] not in ("simulated", "user_reported"):
        raise ProductInputError("Identify the assembly observation as simulated or user_reported")
    observation = {"id": _text(observation["id"], "assembly observation reference", 80), "kind": observation["kind"],
                   **{key: _n(observation[key], key, signed=key == "cg_x_mm", positive=key == "mass_kg")
                      for key in ("mass_kg", "mass_uncertainty_kg", "cg_x_mm", "cg_uncertainty_mm")}}
    if observation["mass_uncertainty_kg"] >= observation["mass_kg"]:
        raise ProductInputError("The assembly mass interval must stay above zero")
    targets = _object(request["targets"], {"mass_min_kg", "mass_max_kg", "cg_min_mm", "cg_max_mm"}, label="mass and balance targets")
    targets = {key: _n(value, key, signed=key.startswith("cg"), positive=key.startswith("mass")) for key, value in targets.items()}
    if targets["mass_min_kg"] > targets["mass_max_kg"] or targets["cg_min_mm"] > targets["cg_max_mm"]:
        raise ProductInputError("Order each target's minimum and maximum")
    if not isinstance(request["positions"], list) or len(request["positions"]) != 2:
        raise ProductInputError("This model needs two stated adjustment mass-centre locations")
    positions = []
    for item in request["positions"]:
        _object(item, {"id", "x_mm", "position_uncertainty_mm", "max_add_kg", "max_remove_kg", "adjustment_uncertainty_kg"}, label="adjustment location")
        positions.append({"id": _text(item["id"], "adjustment location name", 80),
                          **{key: _n(value, key, signed=key == "x_mm") for key, value in item.items() if key != "id"}})
    if positions[0]["id"] == positions[1]["id"]:
        raise ProductInputError("Use distinct adjustment location references")
    if sum(F(str(p["max_remove_kg"])) for p in positions) > F(str(observation["mass_kg"])) - F(str(observation["mass_uncertainty_kg"])):
        raise ProductInputError("Total independently removable trim mass exceeds the assembly's lower mass bound")
    total_add = _n(request["total_max_add_kg"], "total available addition")
    total_remove = _n(request["total_max_remove_kg"], "total removable trim mass")
    if _f(total_remove) > _f(observation["mass_kg"]) - _f(observation["mass_uncertainty_kg"]):
        raise ProductInputError("Total removable mass exceeds the assembly's lower mass bound")
    baseline = _object(request["baseline"], {"position_id", "command_kg"}, label="single-location baseline")
    if baseline["position_id"] not in [p["id"] for p in positions]:
        raise ProductInputError("The baseline must name one entered adjustment location")
    baseline = {"position_id": baseline["position_id"], "command_kg": _n(baseline["command_kg"], "baseline correction", signed=True)}
    return {"case_label": _text(request["case_label"], "case label", 120),
            "coordinate_basis": _text(request["coordinate_basis"], "common axis/datum and trim mass-centre meaning", 1000),
            "command_resolution_kg": _n(request["command_resolution_kg"], "command increment", positive=True),
            "total_max_add_kg": total_add, "total_max_remove_kg": total_remove,
            "observation": observation, "targets": targets, "positions": positions, "baseline": baseline}


def _f(value):
    return F(str(value))


def _corners(request, active):
    observation, positions = request["observation"], request["positions"]
    for signs in product((-1, 1), repeat=6):
        mass = _f(observation["mass_kg"]) + signs[0] * _f(observation["mass_uncertainty_kg"])
        cg = _f(observation["cg_x_mm"]) + signs[1] * _f(observation["cg_uncertainty_mm"])
        errors = tuple(signs[2 + i] * _f(positions[i]["adjustment_uncertainty_kg"]) if active[i] else F(0) for i in range(2))
        xs = tuple(_f(positions[i]["x_mm"]) + signs[4 + i] * _f(positions[i]["position_uncertainty_mm"]) for i in range(2))
        yield mass, cg, errors, xs


def forward_balance(request, commands):
    """Evaluate the entered finite uncertainty corners for actual finite commands."""
    if len(commands) != 2:
        raise ProductInputError("Supply one command for each adjustment location")
    commands = tuple(_f(value) for value in commands)
    active = tuple(command != 0 for command in commands)
    values = []
    actual_limits = True
    for mass, cg, errors, xs in _corners(request, active):
        delta = tuple(commands[i] + errors[i] for i in range(2))
        if any(not -_f(p["max_remove_kg"]) <= d <= _f(p["max_add_kg"]) for p, d in zip(request["positions"], delta)):
            actual_limits = False
        if any(active[i] and commands[i] * delta[i] < 0 for i in range(2)):
            actual_limits = False
        if sum(max(F(0), d) for d in delta) > _f(request["total_max_add_kg"]) or sum(max(F(0), -d) for d in delta) > _f(request["total_max_remove_kg"]):
            actual_limits = False
        final_mass = mass + sum(delta)
        if final_mass <= 0:
            return {"feasible": False, "mass_inside_target": False, "balance_inside_target": False, "adjustment_limits_fit": actual_limits,
                    "mass_min_kg": None, "mass_max_kg": None, "cg_min_mm": None, "cg_max_mm": None}
        final_cg = (mass * cg + sum(delta[i] * xs[i] for i in range(2))) / final_mass
        values.append((final_mass, final_cg))
    low_mass, high_mass = min(v[0] for v in values), max(v[0] for v in values)
    low_cg, high_cg = min(v[1] for v in values), max(v[1] for v in values)
    targets = request["targets"]
    mass_fit = _f(targets["mass_min_kg"]) <= low_mass <= high_mass <= _f(targets["mass_max_kg"])
    cg_fit = _f(targets["cg_min_mm"]) <= low_cg <= high_cg <= _f(targets["cg_max_mm"])
    return {"feasible": bool(mass_fit and cg_fit and actual_limits), "mass_inside_target": bool(mass_fit),
            "balance_inside_target": bool(cg_fit), "adjustment_limits_fit": actual_limits,
            "mass_min_kg": float(low_mass), "mass_max_kg": float(high_mass),
            "cg_min_mm": float(low_cg), "cg_max_mm": float(high_cg)}


def _constraints(request, states):
    tight = {}
    def add(a, b, c):
        key = (F(a), F(b))
        tight[key] = min(tight.get(key, F(c)), F(c))
    for index, (state, position) in enumerate(zip(states, request["positions"])):
        error = _f(position["adjustment_uncertainty_kg"])
        low, high = ((F(0), F(0)) if state == 0 else
                     (error, _f(position["max_add_kg"]) - error) if state > 0 else
                     (-_f(position["max_remove_kg"]) + error, -error))
        if low > high:
            return None
        add(index == 0, index == 1, high)
        add(-(index == 0), -(index == 1), -low)
    add(*(int(state > 0) for state in states), _f(request["total_max_add_kg"]) - sum(_f(p["adjustment_uncertainty_kg"]) for p, state in zip(request["positions"], states) if state > 0))
    add(*(-int(state < 0) for state in states), _f(request["total_max_remove_kg"]) - sum(_f(p["adjustment_uncertainty_kg"]) for p, state in zip(request["positions"], states) if state < 0))
    targets = {key: _f(value) for key, value in request["targets"].items()}
    for mass, cg, errors, xs in _corners(request, tuple(state != 0 for state in states)):
        add(1, 1, targets["mass_max_kg"] - mass - sum(errors))
        add(-1, -1, mass + sum(errors) - targets["mass_min_kg"])
        upper = targets["cg_max_mm"]
        add(xs[0] - upper, xs[1] - upper, mass * (upper - cg) - sum(errors[i] * (xs[i] - upper) for i in range(2)))
        lower = targets["cg_min_mm"]
        add(lower - xs[0], lower - xs[1], mass * (cg - lower) + sum(errors[i] * (xs[i] - lower) for i in range(2)))
    return [(a, b, c) for (a, b), c in tight.items()]


def _inside(point, constraints):
    return all(a * point[0] + b * point[1] <= c for a, b, c in constraints)


def _vertices(constraints):
    points = set()
    for first, second in combinations(constraints, 2):
        a, b, c = first
        d, e, f = second
        determinant = a * e - b * d
        if determinant:
            point = ((c * e - b * f) / determinant, (a * f - c * d) / determinant)
            if _inside(point, constraints):
                points.add(point)
    return points


def plan_balance(raw):
    request = validate_balance(raw)
    base_commands = [F(0), F(0)]
    base_commands[[p["id"] for p in request["positions"]].index(request["baseline"]["position_id"])] = _f(request["baseline"]["command_kg"])
    baseline = forward_balance(request, base_commands)
    observation, targets = request["observation"], request["targets"]
    mass_change = (_f(targets["mass_min_kg"]) + _f(targets["mass_max_kg"])) / 2 - _f(observation["mass_kg"])
    moment_change = ((_f(targets["cg_min_mm"]) + _f(targets["cg_max_mm"])) / 2
                     * (_f(observation["mass_kg"]) + mass_change) - _f(observation["mass_kg"]) * _f(observation["cg_x_mm"]))
    xs = [_f(position["x_mm"]) for position in request["positions"]]
    midpoint = None if xs[0] == xs[1] else ((moment_change - xs[1] * mass_change) / (xs[0] - xs[1]),
                                          (xs[0] * mass_change - moment_change) / (xs[0] - xs[1]))
    candidates = []
    resolution = _f(request["command_resolution_kg"])
    exact_feasible = False
    # Preserve a simpler checked action when it already meets both targets.
    for priority, command in enumerate(((F(0), F(0)), tuple(base_commands))):
        if all(value % resolution == 0 for value in command):
            result = forward_balance(request, command)
            if result["feasible"]:
                candidates.append(((priority, sum(abs(v) for v in command), command), command, result))
                exact_feasible = True
    for states in product((-1, 0, 1), repeat=2):
        constraints = _constraints(request, states)
        if constraints is None:
            continue
        vertices = _vertices(constraints)
        exact_feasible = exact_feasible or bool(vertices)
        points = list(vertices)
        if midpoint is not None and _inside(midpoint, constraints):
            points.insert(0, midpoint)
        for point in points:
            # A displayed command must itself pass, including its finite decimal rounding.
            rounded = tuple(round(value / resolution) * resolution for value in point)
            for dx, dy in product((0, -1, 1, -2, 2), repeat=2):
                command = (rounded[0] + dx * resolution, rounded[1] + dy * resolution)
                if _inside(command, constraints):
                    result = forward_balance(request, command)
                    if result["feasible"]:
                        is_midpoint = midpoint is not None and point == midpoint
                        candidates.append(((2 if is_midpoint else 3, sum(abs(v) for v in command), command), command, result))
                        break
    candidates.sort(key=lambda item: item[0])
    chosen = candidates[0] if candidates else None
    commands = [{"position_id": p["id"], "x_mm": p["x_mm"], "command_kg": float(command),
                 "action": "add" if command > 0 else "remove" if command < 0 else "none"}
                for p, command in zip(request["positions"], chosen[1])] if chosen else None
    return {"result_kind": "simulation", "model": "two_position_mass_moment_v1", "request": request,
            "request_fingerprint": _fingerprint(request), "baseline": {"commands_kg": [float(v) for v in base_commands], **baseline},
            "feasible": chosen is not None, "exact_model_feasible": exact_feasible,
            "status": "checked_commands" if chosen else "precision_limited" if exact_feasible else "infeasible",
            "commands": commands, "result": chosen[2] if chosen else None,
            "selection": ("no_adjustment", "entered_baseline", "nominal_midpoint_candidate", "feasible_vertex_candidate")[chosen[0][0]] if chosen else None,
            "command_resolution_kg": request["command_resolution_kg"],
            "precision_note": "The bounded nearby-grid search did not find a checked command at the entered increment; this is not proof that every grid point is infeasible." if exact_feasible and not chosen else None,
            "assumptions": ["Mass and one-axis centre-of-mass observations and bounds are supplied, not independently verified.",
                            "Coordinates share the stated datum. Each adjustment location is the mass centre of the added or removed portion, not an assumed hole centre.",
                            "Independent trim stocks and actual addition/removal limits are declared at each location. A no-operation location incurs no adjustment error.",
                            "Rigid static mass/moment balance is evaluated over every entered uncertainty corner. Changed geometry or a physical adjustment needs a new observation.",
                            "This does not establish tipping safety, sliding, load capacity, containment, material response, durability or future-batch consistency."],
            "physical_product_tested": False, "batch_consistency_established": False}


def validate_bound_balance(raw):
    from .advisor import _brief, _calculation_context
    from .adaptation import _validated_mass_feedback, _shared_number
    _object(raw, {"brief", "calculation_context", "feedback", "balance"}, {"request_fingerprint"}, "shared mass and balance request")
    brief = _brief(raw["brief"])
    details = _calculation_context(raw["calculation_context"])
    feedback = _validated_mass_feedback(raw["feedback"])
    target = details.get("balance")
    if target is None:
        raise ProductInputError("Set the balance target and common coordinate meaning in your shared case first")
    config = _object(raw["balance"], {"cg_x_mm", "cg_uncertainty_mm", "positions", "baseline", "command_resolution_kg", "independent_adjustments"}, label="balance measurements and controls")
    if config["independent_adjustments"] is not True:
        raise ProductInputError("Confirm that the entered adjustment bound applies independently at each active location")
    if not isinstance(config["positions"], list) or len(config["positions"]) != 2:
        raise ProductInputError("Enter two adjustment locations")
    positions = []
    for position in config["positions"]:
        _object(position, {"id", "x_mm", "position_uncertainty_mm", "max_add_kg", "max_remove_kg"}, label="shared adjustment location")
        positions.append({**position, "adjustment_uncertainty_kg": feedback["adjustment_uncertainty_kg"]})
    def signed_text(value, label):
        try:
            parsed = float(value)
        except (TypeError, ValueError, OverflowError):
            raise ProductInputError(f"Enter {label} as a finite shared number") from None
        return _n(parsed, label, signed=True)
    observation = feedback["observation"]
    model_request = validate_balance({
        "case_label": details["label"] or brief["product"], "coordinate_basis": target["coordinate_basis"],
        "command_resolution_kg": config["command_resolution_kg"],
        "total_max_add_kg": feedback["max_add_mass_kg"], "total_max_remove_kg": feedback["max_remove_mass_kg"],
        "observation": {"id": observation["id"], "kind": observation["kind"], "mass_kg": observation["mass_kg"],
                        "mass_uncertainty_kg": observation["uncertainty_kg"], "cg_x_mm": config["cg_x_mm"], "cg_uncertainty_mm": config["cg_uncertainty_mm"]},
        "targets": {"mass_min_kg": _shared_number(details["mass_target_min_kg"], "shared minimum mass target", True),
                    "mass_max_kg": _shared_number(details["mass_target_max_kg"], "shared maximum mass target", True),
                    "cg_min_mm": signed_text(target["target_min_mm"], "shared minimum balance point"),
                    "cg_max_mm": signed_text(target["target_max_mm"], "shared maximum balance point")},
        "positions": positions, "baseline": config["baseline"],
    })
    normalized_config = {"cg_x_mm": model_request["observation"]["cg_x_mm"], "cg_uncertainty_mm": model_request["observation"]["cg_uncertainty_mm"],
                         "command_resolution_kg": model_request["command_resolution_kg"], "baseline": model_request["baseline"],
                         "independent_adjustments": True,
                         "positions": [{key: value for key, value in p.items() if key != "adjustment_uncertainty_kg"} for p in model_request["positions"]]}
    normalized = {"brief": brief, "calculation_context": details, "feedback": feedback, "balance": normalized_config}
    if "request_fingerprint" in raw and raw["request_fingerprint"] != _fingerprint(normalized):
        raise ProductInputError("The case, observation, target or adjustment locations changed; recalculate")
    return normalized, model_request


def plan_shared_balance(raw):
    normalized, model_request = validate_bound_balance(raw)
    result = plan_balance(model_request)
    result["case_context"] = normalized
    result["request_fingerprint"] = _fingerprint(normalized)
    result["layout_svg"] = balance_layout_svg(result)
    return result


def balance_layout_svg(result):
    """Export a placement diagram, not a qualified enclosure or manufacturing drawing."""
    request = result["request"]
    positions = request["positions"]
    numbers = [p["x_mm"] for p in positions] + [request["observation"]["cg_x_mm"], request["targets"]["cg_min_mm"], request["targets"]["cg_max_mm"]]
    low, high = min(numbers) - 15, max(numbers) + 15
    def x(value): return 90 + (value - low) / (high - low) * 820
    def text(cx, cy, value, size=18, anchor="middle", color="#183e36"):
        return f'<text x="{cx:.2f}" y="{cy}" text-anchor="{anchor}" fill="{color}" font-size="{size}">{escape(str(value))}</text>'
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 490" role="img" aria-label="Simulated trim placement diagram">',
             '<metadata>' + escape(json.dumps({"request_fingerprint": result["request_fingerprint"], "model": result["model"], "request": request}, ensure_ascii=True)) + '</metadata>',
             '<rect width="1000" height="490" rx="16" fill="#f5faf7"/>', '<g font-family="Arial,sans-serif">',
             text(500, 36, request["case_label"], 23), text(500, 64, "SIMULATION · two stated mass-centre locations", 14),
             f'<rect x="{x(request["targets"]["cg_min_mm"]):.2f}" y="90" width="{max(1,x(request["targets"]["cg_max_mm"])-x(request["targets"]["cg_min_mm"])):.2f}" height="265" fill="#d7f1df"/>',
             '<line x1="90" y1="150" x2="910" y2="150" stroke="#9ab7aa" stroke-width="3"/>']
    for index, position in enumerate(positions):
        px = x(position["x_mm"])
        command = result["commands"][index] if result["commands"] else None
        grams = format((abs(Decimal(str(command["command_kg"]))) * 1000).normalize(), 'f') if command else None
        label = (f'{command["action"].upper()} {grams} g' if command else "No checked command")
        parts.extend([f'<circle cx="{px:.2f}" cy="150" r="17" fill="#22765e"/>',
                      text(px, 112, f'{position["id"]} · x={position["x_mm"]} mm', 18), text(px, 200, label, 21)])
    baseline_label = "Mass-only baseline" if any(result["baseline"]["commands_kg"]) else "No-adjustment comparison"
    for name, item, y, color in ((baseline_label, result["baseline"], 260, "#b76332"),
                                ("Both-target adjustment", result["result"], 330, "#22765e")):
        parts.append(text(90, y-12, name, 16, "start", color))
        if item and item["cg_min_mm"] is not None:
            parts.append(f'<line x1="{x(item["cg_min_mm"]):.2f}" x2="{x(item["cg_max_mm"]):.2f}" y1="{y}" y2="{y}" stroke="{color}" stroke-width="9" stroke-linecap="round"/>')
            parts.append(text(910, y-12, f'CG ≈ {item["cg_min_mm"]:.3f}…{item["cg_max_mm"]:.3f} mm', 16, "end", color))
    parts.extend([text(500, 390, f'Mass target {request["targets"]["mass_min_kg"]}…{request["targets"]["mass_max_kg"]} kg · balance target {request["targets"]["cg_min_mm"]}…{request["targets"]["cg_max_mm"]} mm', 17),
                  text(500, 425, "Green band: entered balance target. Confirm coordinates and remeasure after adjustment.", 14),
                  text(500, 457, "Placement diagram only · no enclosure strength, retention or tipping-safety check", 14),
                  '</g></svg>'])
    return ''.join(parts)
