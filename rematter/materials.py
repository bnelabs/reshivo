"""Import audited measurements without inventing formulation or batch information."""
from dataclasses import asdict, dataclass
import csv
import hashlib
import json
import math
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://zenodo.org/records/19370161"


@dataclass(frozen=True)
class Material:
    id: str
    group: str
    specimens: int
    modulus_MPa: float
    modulus_sd_MPa: float
    yield_stress_MPa: float
    yield_stress_sd_MPa: float
    yield_strain_percent: float
    break_strain_percent: float
    source_member: str

    def scenario(self, name):
        if name not in {"nominal", "lower_sensitivity"}:
            raise ValueError("Scenario must be nominal or lower_sensitivity")
        multiplier = 0 if name == "nominal" else 2
        e = self.modulus_MPa - multiplier * self.modulus_sd_MPa
        strength = self.yield_stress_MPa - multiplier * self.yield_stress_sd_MPa
        if min(e, strength) <= 0:
            raise ValueError("Sensitivity scenario has nonpositive material inputs")
        return {
            "name": name,
            "modulus_MPa": e,
            "yield_stress_MPa": strength,
            "interpretation": "Measured averages" if not multiplier else "Uses the measured average minus twice the test-piece standard deviation (SD). This explores lower values; it is not a confidence interval or a prediction of variation between batches.",
        }

    def to_dict(self):
        return {
            **asdict(self),
            "source_url": SOURCE_URL,
            "source_license": "CC-BY-4.0",
            "named_formulation": None,
            "formulation_mapping_status": "The additive recipe has not been matched to this test code yet; the original code is used",
            "density_kg_m3": None,
            "independent_batch_variability": None,
            "missing": ["density", "Poisson ratio", "creep", "fatigue", "solid-state damping", "validated multiaxial failure model"],
        }


def verify_sources(root=ROOT):
    manifest = json.loads((root / "data/sources.json").read_text())
    for entry in manifest["files"]:
        path = root / entry["path"]
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != entry["sha256"]:
            raise ValueError(f"Source checksum mismatch: {entry['path']}")
    return manifest


def load_materials(root=ROOT, include_controls=False):
    verify_sources(root)
    path = root / "data/raw/pp_tensile_report_summary.csv"
    with zipfile.ZipFile(root / "data/raw/Tensile_tests.zip") as archive:
        members = set(archive.namelist())
    materials = []
    seen = set()
    with path.open(newline="") as stream:
        for row in csv.DictReader(stream):
            identity = row["condition_code"]
            if identity in seen:
                raise ValueError(f"Duplicate material condition: {identity}")
            seen.add(identity)
            if row["material_group"] not in {"recycled_PP", "virgin_PP_control"}:
                raise ValueError("Unknown material group")
            member = "Tensile_tests/" + Path(row["source_file"]).name
            if member not in members:
                raise ValueError(f"Missing source report: {member}")
            values = {key: float(row[key]) for key in ["modulus_MPa", "modulus_MPa_reported_sd", "yield_stress_MPa", "yield_stress_MPa_reported_sd", "yield_strain_percent", "break_strain_percent"]}
            if not all(math.isfinite(v) and v >= 0 for v in values.values()):
                raise ValueError(f"Invalid measurement: {identity}")
            if min(values["modulus_MPa"], values["yield_stress_MPa"]) <= 0:
                raise ValueError("Modulus and yield stress must be positive")
            n = int(row["specimens"])
            if n < 2:
                raise ValueError("At least two specimens required for reported spread")
            material = Material(identity, row["material_group"], n, values["modulus_MPa"], values["modulus_MPa_reported_sd"], values["yield_stress_MPa"], values["yield_stress_MPa_reported_sd"], values["yield_strain_percent"], values["break_strain_percent"], member)
            if include_controls or material.group == "recycled_PP":
                materials.append(material)
    if not materials:
        raise ValueError("No supported material measurements")
    return materials


def write_catalog(root=ROOT):
    materials = load_materials(root, include_controls=True)
    destination = root / "data/catalog/pp_conditions.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({
        "source": SOURCE_URL,
        "license": "CC-BY-4.0",
        "grain": "One measured condition; specimen counts are not independent formulations or batches",
        "materials": [m.to_dict() for m in materials],
    }, indent=2) + "\n")
    return destination
