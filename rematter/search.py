"""Exhaustive, deterministic numerical baselines. No LLM is used here."""
from dataclasses import asdict, dataclass
import math
from .mechanics import Section, evaluate, positive


@dataclass(frozen=True)
class SearchSpace:
    min_height_mm: float = 6
    step_mm: float = 0.5
    max_web_mm: float = 10

    def __post_init__(self):
        positive(**asdict(self))
        if self.step_mm < 0.1:
            raise ValueError("Minimum grid step is 0.1 mm for this bounded prototype")


def grid_count(start, stop, step):
    if stop < start:
        return 0
    extent = (stop - start) / step
    if not math.isfinite(extent):
        raise ValueError("Search grid exceeds numerical bounds")
    return math.floor(extent + 1e-9) + 1


def grid(start, stop, step):
    count = grid_count(start, stop, step)
    if count > 250_000:
        raise ValueError("Search exceeds 250,000 candidate bound; increase grid step")
    return [round(start + i*step, 10) for i in range(count)]


def search(material, requirements, space, scenario_name="nominal"):
    state = material.scenario(scenario_name)
    height_count = grid_count(space.min_height_mm, requirements.max_height_mm, space.step_mm)
    web_stop = min(space.max_web_mm, requirements.width_mm)
    web_count = grid_count(requirements.min_feature_mm, web_stop, space.step_mm)
    flange_count = grid_count(requirements.min_feature_mm, requirements.max_height_mm/2, space.step_mm)
    upper = height_count + height_count * web_count * flange_count
    if upper > 250_000:
        raise ValueError("Search exceeds 250,000 candidate bound; increase grid step")
    heights = grid(space.min_height_mm, requirements.max_height_mm, space.step_mm)
    webs = grid(requirements.min_feature_mm, web_stop, space.step_mm)
    families = {name: {"evaluated": 0, "feasible_count": 0, "best": None} for name in ["rectangle", "i"]}

    def consider(section):
        family = families[section.shape]
        family["evaluated"] += 1
        response = evaluate(section, requirements, state["modulus_MPa"], state["yield_stress_MPa"])
        if not response["passes_declared_screens"]:
            return
        family["feasible_count"] += 1
        best = family["best"]
        key = (response["volume_mm3"], response["tip_deflection_mm"])
        if best is None or key < (best["evaluation"]["volume_mm3"], best["evaluation"]["tip_deflection_mm"]):
            family["best"] = {"section": section.to_dict(), "evaluation": response}

    for height in heights:
        consider(Section("rectangle", requirements.width_mm, height))
        for flange in grid(requirements.min_feature_mm, height/2, space.step_mm):
            if 2 * flange >= height:
                continue
            for web in webs:
                consider(Section("i", requirements.width_mm, height, flange, web))
    rectangle, shaped = families["rectangle"]["best"], families["i"]["best"]
    reduction = None
    if rectangle and shaped:
        reduction = 100 * (1 - shaped["evaluation"]["volume_mm3"] / rectangle["evaluation"]["volume_mm3"])
    return {
        "material_id": material.id,
        "material_scenario": state,
        "families": families,
        "i_volume_reduction_vs_optimized_rectangle_percent": reduction,
        "scope": "Optima on the stated finite grid and restricted section families only; no Meta model used",
    }
