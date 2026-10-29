"""Local core workflow; no network calls, service accounts or hidden AI results."""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
import zipfile

from .materials import ROOT, load_materials, verify_sources, write_catalog
from .mechanics import Requirements, Section, evaluate, polygon_properties
from .search import SearchSpace, search

LIMITS = [
    "Simulation of an idealized straight member under a short-duration static transverse tip load.",
    "Perfect clamp and homogeneous linear material are assumptions; joints and print-induced anisotropy are not modeled.",
    "Shear deformation, local buckling, lateral torsion, stress concentrations, creep, fatigue and impact are excluded.",
    "Thickness/slenderness filters and the yield divisor are declared screening assumptions, not validated design allowables.",
    "Reported specimen spread is not an independent-batch uncertainty distribution.",
    "Density is missing: output is material volume, not mass or environmental benefit.",
    "No new formulation, manufacturing-ready product, or Meta-generated candidate has been demonstrated.",
]


def load_config(path):
    config = json.loads(Path(path).read_text())
    unknown = set(config) - {"description", "requirements", "search"}
    if unknown:
        raise ValueError("Unknown config fields: " + ", ".join(sorted(unknown)))
    return config, Requirements(**config["requirements"]), SearchSpace(**config["search"])


def export_design(folder, material, result, requirements):
    from .mesh import extrude_polygon, mesh_metrics, write_ascii_stl

    state = result["material_scenario"]
    families = result["families"]
    exports = []
    for family_name, family in families.items():
        if family["best"] is None:
            continue
        section = Section(**family["best"]["section"])
        response = evaluate(section, requirements, state["modulus_MPa"], state["yield_stress_MPa"])
        geometry = polygon_properties(section.outline())
        if not math.isclose(geometry["area_mm2"], response["area_mm2"], rel_tol=1e-10):
            raise ValueError("Independent polygon-area check failed")
        if not math.isclose(geometry["inertia_mm4"], response["inertia_mm4"], rel_tol=1e-10):
            raise ValueError("Independent polygon-inertia check failed")
        triangles = extrude_polygon(section.outline(), requirements.span_mm)
        metrics = mesh_metrics(triangles)
        if not metrics["watertight"] or not metrics["orientation_consistent"] or not math.isclose(metrics["signed_volume_mm3"], response["volume_mm3"], rel_tol=1e-9):
            raise ValueError("Mesh failed closure, orientation or volume verification")
        prefix = material.id + "_" + family_name
        stl_path = folder / (prefix + ".stl")
        write_ascii_stl(stl_path, triangles, name="rematter_" + family_name)
        design = {
            "schema_version": 1,
            "units": {"length": "mm", "force": "N", "stress": "MPa"},
            "axes": "Cross-section XY; member span +Z; transverse end force in Y",
            "material_id": material.id,
            "material_scenario": state,
            "requirements": asdict(requirements),
            "section": section.to_dict(),
            "evaluation": response,
            "mesh_verification": metrics,
            "polygon_verification": geometry,
            "stl": stl_path.name,
            "limits": LIMITS,
        }
        design_path = folder / (prefix + ".json")
        design_path.write_text(json.dumps(design, indent=2, allow_nan=False) + "\n")
        exports.append({"family": family_name, "design": design_path.name, "stl": stl_path.name, "checks": metrics})
    return exports


def report_text(results, requirements, scenario):
    lines = [
        "# ReMatter core experiment", "",
        "**Computational verification exercise. Physical product performance is untested.**", "",
        f"Static transverse end load: {requirements.tip_force_N:g} N. Span: {requirements.span_mm:g} mm. Fixed interface width: {requirements.width_mm:g} mm. Height limit: {requirements.max_height_mm:g} mm. Tip-deflection limit: {requirements.max_tip_deflection_mm:g} mm.", "",
        f"Material scenario: `{scenario}`. A lower sensitivity case uses mean minus twice the reported within-condition specimen SD; this is not a confidence interval or a batch reliability bound.", "",
        "Both section families are searched on the stated finite dimensional grid. The rectangle baseline is optimized too. These are familiar beam shapes used to check the pipeline; this result is not a scientific novelty or AI advantage claim.", "",
        "| Source material condition | Section | Volume (mm³) | Tip deflection (mm) | Root bending stress (MPa) | Evaluations |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for result in results:
        for name, family in result["families"].items():
            best = family["best"]
            if best:
                e = best["evaluation"]
                lines.append(f"| {result['material_id']} | {name} | {e['volume_mm3']:.1f} | {e['tip_deflection_mm']:.4f} | {e['root_bending_stress_MPa']:.4f} | {family['evaluated']} |")
            else:
                lines.append(f"| {result['material_id']} | {name} | No candidate passed | — | — | {family['evaluated']} |")
    lines.extend(["", "## Interpreting the output", ""])
    for result in results:
        reduction = result["i_volume_reduction_vs_optimized_rectangle_percent"]
        if reduction is not None:
            lines.append(f"- `{result['material_id']}`: the selected I-section uses {reduction:.2f}% less modeled volume than the optimized rectangle within these restricted section families and declared screens.")
    lines.extend(["", "STL files are unitless; coordinates must be interpreted as millimetres. Each has companion JSON with material condition, dimensions, calculation and geometric checks. No manufacturing or service-life qualification is implied.", "", "## Limits", ""])
    lines.extend("- " + item for item in LIMITS)
    lines.extend(["", "## Evidence", "", "[Measured source data, CC BY 4.0](https://zenodo.org/records/19370161). Source condition codes are retained because mapping to named stabilizer formulations has not yet been verified.", "", "[MIT Euler–Bernoulli beam reference](https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf).", ""])
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="ReMatter: documented materials and computational geometry")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("ingest", help="Verify source hashes and rebuild the material catalog")
    catalog = commands.add_parser("catalog", help="List measured material conditions")
    catalog.add_argument("--include-controls", action="store_true")
    demo = commands.add_parser("demo", help="Run the idealized support-member experiment")
    demo.add_argument("--config", type=Path, default=ROOT / "examples/support-member.json")
    demo.add_argument("--material", default="04441PP-REG(1)-1E1", help="Source condition code or all")
    demo.add_argument("--scenario", choices=["nominal", "lower_sensitivity"], default="lower_sensitivity")
    demo.add_argument("--out", type=Path)
    check = commands.add_parser("evaluate", help="Recompute a previously exported design")
    check.add_argument("design", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "ingest":
            path = write_catalog()
            materials = load_materials(include_controls=True)
            print(f"Verified {len(materials)} measured conditions; wrote {path}")
            return 0
        materials = load_materials(include_controls=getattr(args, "include_controls", False))
        if args.command == "catalog":
            print("Source: https://zenodo.org/records/19370161 | CC-BY-4.0")
            print("Condition                     Group                 n    E(MPa)   Yield(MPa)")
            for m in materials:
                print(f"{m.id:29} {m.group:21} {m.specimens:2} {m.modulus_MPa:9.1f} {m.yield_stress_MPa:12.2f}")
            print("Named formulation mapping, density and independent batch variability: unavailable")
            return 0
        by_id = {m.id: m for m in materials}
        if args.command == "evaluate":
            design = json.loads(args.design.read_text())
            material = by_id.get(design["material_id"])
            if material is None:
                raise ValueError("Design refers to an unsupported material condition")
            if design["units"] != {"length": "mm", "force": "N", "stress": "MPa"}:
                raise ValueError("Unsupported design units")
            state = material.scenario(design["material_scenario"]["name"])
            response = evaluate(Section(**design["section"]), Requirements(**design["requirements"]), state["modulus_MPa"], state["yield_stress_MPa"])
            print(json.dumps({"recomputed_from": str(args.design), "material_scenario": state, "evaluation": response, "limits": LIMITS}, indent=2, allow_nan=False))
            return 0 if response["passes_declared_screens"] else 1
        config, requirements, space = load_config(args.config)
        chosen = materials if args.material == "all" else [by_id[args.material]] if args.material in by_id else []
        if not chosen:
            raise ValueError("Unknown material condition; run catalog to list supported IDs")
        results = [search(m, requirements, space, args.scenario) for m in chosen]
        folder = args.out or ROOT / "outputs" / ("core-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        if folder.exists():
            raise ValueError(f"Output directory already exists; choose a new path: {folder}")
        folder.mkdir(parents=True)
        exports = []
        for material, result in zip(chosen, results):
            exports.extend(export_design(folder, material, result, requirements))
        output = {
            "schema_version": 1,
            "claim_scope": "Idealized static bending simulation, not physically validated product design",
            "meta_model_used": False,
            "requirements": asdict(requirements),
            "search_space": asdict(space),
            "config_description": config.get("description"),
            "materials": [m.to_dict() for m in chosen],
            "results": results,
            "exports": exports,
            "source_manifest": verify_sources(),
            "limits": LIMITS,
        }
        (folder / "results.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
        (folder / "report.md").write_text(report_text(results, requirements, args.scenario))
        print(f"Experiment saved: {folder.resolve()}")
        for result in results:
            value = result["i_volume_reduction_vs_optimized_rectangle_percent"]
            print(result["material_id"] + (f": modeled volume reduction {value:.2f}% vs optimized rectangle" if value is not None else ": no comparable feasible pair"))
        print("Simulation only. No Meta model used. See report.md for omitted physics and evidence.")
        return 0 if exports else 1
    except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as exc:
        print(f"ReMatter: {exc}", file=sys.stderr)
        return 2
