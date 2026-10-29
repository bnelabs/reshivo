"""Small-strain Euler-Bernoulli bending, in N, mm, and MPa = N/mm².

Cross section lies in XY; span is +Z; end load is transverse in Y.
No density is assumed. No mass, creep, joint or buckling qualification is made.
"""
from dataclasses import asdict, dataclass
import math


def positive(**values):
    if any(not math.isfinite(v) or v <= 0 for v in values.values()):
        raise ValueError("Inputs must be positive finite numbers: " + ", ".join(values))


@dataclass(frozen=True)
class Section:
    shape: str
    width_mm: float
    height_mm: float
    flange_mm: float | None = None
    web_mm: float | None = None

    def __post_init__(self):
        positive(width=self.width_mm, height=self.height_mm)
        if self.shape == "rectangle":
            if self.flange_mm is not None or self.web_mm is not None:
                raise ValueError("Rectangle does not have flange/web parameters")
        elif self.shape == "i":
            if self.flange_mm is None or self.web_mm is None:
                raise ValueError("I-section requires flange and web thickness")
            positive(flange=self.flange_mm, web=self.web_mm)
            if 2 * self.flange_mm >= self.height_mm or self.web_mm > self.width_mm:
                raise ValueError("Invalid I-section dimensions")
        else:
            raise ValueError("Unsupported cross section")

    @property
    def area_mm2(self):
        b, h = self.width_mm, self.height_mm
        if self.shape == "rectangle":
            return b * h
        return 2 * b * self.flange_mm + (h - 2 * self.flange_mm) * self.web_mm

    @property
    def inertia_mm4(self):
        b, h = self.width_mm, self.height_mm
        if self.shape == "rectangle":
            return b * h**3 / 12
        return (b * h**3 - (b - self.web_mm) * (h - 2 * self.flange_mm)**3) / 12

    def outline(self):
        b, h = self.width_mm / 2, self.height_mm / 2
        if self.shape == "rectangle" or self.web_mm == self.width_mm:
            return [(-b, -h), (b, -h), (b, h), (-b, h)]
        w, f = self.web_mm / 2, self.flange_mm
        return [(-b, -h), (b, -h), (b, -h+f), (w, -h+f), (w, h-f), (b, h-f), (b, h), (-b, h), (-b, h-f), (-w, h-f), (-w, -h+f), (-b, -h+f)]

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class Requirements:
    span_mm: float = 300
    width_mm: float = 30
    max_height_mm: float = 30
    tip_force_N: float = 10
    max_tip_deflection_mm: float = 2
    yield_divisor: float = 3
    max_bending_strain: float = 0.005
    max_deflection_span_ratio: float = 0.01
    min_span_height_ratio: float = 10
    min_feature_mm: float = 2
    max_web_ratio: float = 12
    max_flange_outstand_ratio: float = 6

    def __post_init__(self):
        positive(**asdict(self))
        if self.yield_divisor < 1:
            raise ValueError("Yield divisor must be at least one")
        if self.max_bending_strain > 0.01 or self.max_deflection_span_ratio > 0.02:
            raise ValueError("Requested regime exceeds this small-strain/deflection model")


def evaluate(section, requirements, modulus_MPa, yield_stress_MPa):
    positive(modulus=modulus_MPa, yield_stress=yield_stress_MPa)
    r = requirements
    inertia = section.inertia_mm4
    displacement = r.tip_force_N * r.span_mm**3 / (3 * modulus_MPa * inertia)
    stress = r.tip_force_N * r.span_mm * section.height_mm / (2 * inertia)
    strain = stress / modulus_MPa
    failures = []
    checks = {
        "fixed_width": math.isclose(section.width_mm, r.width_mm, abs_tol=1e-9),
        "height_envelope": section.height_mm <= r.max_height_mm + 1e-9,
        "deflection_target": displacement <= r.max_tip_deflection_mm + 1e-9,
        "stress_screen": stress <= yield_stress_MPa / r.yield_divisor + 1e-9,
        "small_bending_strain": strain <= r.max_bending_strain + 1e-12,
        "small_deflection": displacement / r.span_mm <= r.max_deflection_span_ratio + 1e-12,
        "beam_slenderness_screen": r.span_mm / section.height_mm >= r.min_span_height_ratio - 1e-9,
        "minimum_feature": min(section.width_mm, section.height_mm) >= r.min_feature_mm - 1e-9,
    }
    if section.shape == "i":
        checks["minimum_feature"] = min(section.web_mm, section.flange_mm) >= r.min_feature_mm - 1e-9
        checks["web_ratio_screen"] = (section.height_mm - 2 * section.flange_mm) / section.web_mm <= r.max_web_ratio + 1e-9
        checks["flange_ratio_screen"] = (section.width_mm - section.web_mm) / (2 * section.flange_mm) <= r.max_flange_outstand_ratio + 1e-9
    failures = [name for name, passed in checks.items() if not passed]
    return {
        "passes_declared_screens": not failures,
        "failed_screens": failures,
        "area_mm2": section.area_mm2,
        "inertia_mm4": inertia,
        "volume_mm3": section.area_mm2 * r.span_mm,
        "tip_deflection_mm": displacement,
        "root_bending_stress_MPa": stress,
        "root_bending_strain": strain,
        "stress_screen_limit_MPa": yield_stress_MPa / r.yield_divisor,
        "strain_energy_N_mm": r.tip_force_N * displacement / 2,
        "mass_g": None,
    }


def polygon_properties(points):
    """Independent Green-theorem check of a CCW section's area and Ix."""
    twice_area = ix_sum = 0.0
    for (x, y), (u, v) in zip(points, points[1:] + points[:1]):
        cross = x*v - u*y
        twice_area += cross
        ix_sum += cross * (y*y + y*v + v*v)
    return {"area_mm2": twice_area / 2, "inertia_mm4": ix_sum / 12}
