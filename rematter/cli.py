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
    "The model calculates a straight beam under a short, static sideways load at its free end. The designs have not been physically tested.",
    "It assumes a perfect clamp and uniform, linear material behavior. Connections and the effect of 3D-printing direction are not modeled.",
    "It does not include shear deformation, local buckling, lateral torsion, stress concentrations, creep, fatigue or impact.",
    "Thickness, slenderness and strength-factor checks are chosen for this study. They are not tested design limits.",
    "Variation between test pieces does not tell us how separate recycled-material batches vary.",
    "Without density data, results show material volume. Weight and environmental savings cannot be calculated.",
    "This file describes calculated geometry, not a new material recipe or a ready-to-manufacture product.",
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
    scenario_label = "Measured averages" if scenario == "nominal" else "Lower estimate"
    lines = [
        "# ReMatter design results", "",
        "**Calculated with a bending model. The designs have not been physically tested.**", "",
        f"Load at tip: {requirements.tip_force_N:g} N. Length: {requirements.span_mm:g} mm. Width: {requirements.width_mm:g} mm. Maximum height: {requirements.max_height_mm:g} mm. Maximum tip movement: {requirements.max_tip_deflection_mm:g} mm.", "",
        f"Material values: {scenario_label}. The lower estimate uses the measured average minus twice the test-piece standard deviation (SD). This explores lower values; it is not a confidence interval or a prediction of variation between batches.", "",
        "ReMatter searches both beam shapes across the selected size range and step sizes. The rectangular comparison is optimized too. These familiar shapes help check the calculations. This result does not show a new design method or an advantage from AI.", "",
        "| Material | Beam shape | Volume (mm³) | Tip movement (mm) | Stress at fixed end (MPa) | Designs checked |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for result in results:
        for name, family in result["families"].items():
            shape_label = "I-section" if name == "i" else "Rectangle"
            best = family["best"]
            if best:
                e = best["evaluation"]
                lines.append(f"| {result['material_id']} | {shape_label} | {e['volume_mm3']:.1f} | {e['tip_deflection_mm']:.4f} | {e['root_bending_stress_MPa']:.4f} | {family['evaluated']} |")
            else:
                lines.append(f"| {result['material_id']} | {shape_label} | No design met the requirements | — | — | {family['evaluated']} |")
    lines.extend(["", "## What the results mean", ""])
    for result in results:
        reduction = result["i_volume_reduction_vs_optimized_rectangle_percent"]
        if reduction is not None:
            lines.append(f"- `{result['material_id']}`: the selected I-section uses {reduction:.2f}% less calculated material volume than the optimized rectangle, for these two beam shapes and the selected design checks.")
    lines.extend(["", "Open STL files in millimetres; the file format does not store units. Each design includes a JSON file with its material sample, dimensions, calculations and geometry checks. The model does not establish how to manufacture the part or how long it will last.", "", "## What this model covers", ""])
    lines.extend("- " + item for item in LIMITS)
    lines.extend(["", "## Material data and calculations", "", "[Material test data, CC BY 4.0](https://zenodo.org/records/19370161). The original sample codes are used because we do not yet know which named stabilizer recipe each code represents.", "", "[MIT guide to Euler–Bernoulli beam calculations](https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf).", ""])
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="ReMatter: recycled-material data and calculated designs")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("ingest", help="Verify source hashes and rebuild the material catalog")
    catalog = commands.add_parser("catalog", help="List tested material options")
    catalog.add_argument("--include-controls", action="store_true")
    demo = commands.add_parser("demo", help="Run the support-beam comparison")
    demo.add_argument("--config", type=Path, default=ROOT / "examples/support-member.json")
    demo.add_argument("--material", default="04441PP-REG(1)-1E1", help="Material ID or all")
    demo.add_argument("--scenario", choices=["nominal", "lower_sensitivity"], default="lower_sensitivity")
    demo.add_argument("--out", type=Path)
    check = commands.add_parser("evaluate", help="Recompute a previously exported design")
    check.add_argument("design", type=Path)
    serve_parser = commands.add_parser("serve", help="Start the local app")
    serve_parser.add_argument("--port", type=int, default=8797)
    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            from .server import serve
            serve(port=args.port)
            return 0
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
            raise ValueError("This material is not available; run catalog to list material IDs")
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
            "claim_scope": "Static bending simulation; the designs have not been physically tested",
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
        print(f"Design run saved: {folder.resolve()}")
        for result in results:
            value = result["i_volume_reduction_vs_optimized_rectangle_percent"]
            print(result["material_id"] + (f": modeled volume reduction {value:.2f}% vs optimized rectangle" if value is not None else ": no comparable feasible pair"))
        print("Simulation only. No Meta model used. See report.md for the material data and what the model covers.")
        return 0 if exports else 1
    except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as exc:
        print(f"ReMatter: {exc}", file=sys.stderr)
        return 2
