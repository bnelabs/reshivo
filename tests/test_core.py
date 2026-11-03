"""Numerical contracts and source provenance; no network or dependencies."""
import contextlib
from dataclasses import replace
import io
import json
import math
from pathlib import Path
import tempfile
import unittest

from reshivo.cli import main
from reshivo.materials import ROOT, load_materials, verify_sources
from reshivo.mechanics import Requirements, Section, evaluate, polygon_properties
from reshivo.search import SearchSpace, grid, search


class SourceTests(unittest.TestCase):
    def test_verified_measured_conditions_and_controls(self):
        manifest = verify_sources()
        self.assertEqual(manifest["license"]["id"], "cc-by-4.0")
        cards = load_materials()
        all_cards = load_materials(include_controls=True)
        self.assertEqual(len(cards), 8)
        self.assertEqual(len(all_cards), 18)
        self.assertEqual(sum(c.specimens for c in cards), 40)
        self.assertEqual(len({c.id for c in all_cards}), 18)
        self.assertTrue(all(c.group == "recycled_PP" for c in cards))

    def test_measurements_preserve_one_condition_and_unknowns(self):
        card = load_materials()[0]
        self.assertEqual(card.id, "04441PP-REG(1)-1E1")
        self.assertEqual(card.modulus_MPa, 1400)
        self.assertAlmostEqual(card.yield_stress_MPa, 29.7)
        sensitivity = card.scenario("lower_sensitivity")
        self.assertAlmostEqual(sensitivity["modulus_MPa"], 1366.2)
        self.assertAlmostEqual(sensitivity["yield_stress_MPa"], 28.898)
        self.assertIn("not a confidence", sensitivity["interpretation"])
        self.assertIsNone(card.to_dict()["density_kg_m3"])
        self.assertIsNone(card.to_dict()["named_formulation"])
        with self.assertRaises(ValueError):
            card.scenario("invented")


class MechanicsTests(unittest.TestCase):
    def setUp(self):
        self.section = Section("rectangle", 10, 20)
        self.requirements = Requirements(span_mm=100, width_mm=10, max_height_mm=20, tip_force_N=1)

    def test_known_tip_loaded_rectangle(self):
        self.assertAlmostEqual(self.section.area_mm2, 200)
        self.assertAlmostEqual(self.section.inertia_mm4, 20000/3)
        response = evaluate(self.section, self.requirements, 1000, 20)
        self.assertAlmostEqual(response["tip_deflection_mm"], 0.05)
        self.assertAlmostEqual(response["root_bending_stress_MPa"], 0.15)
        self.assertIsNone(response["mass_g"])

    def test_load_modulus_and_length_scaling(self):
        base = evaluate(self.section, self.requirements, 1000, 20)
        force = evaluate(self.section, replace(self.requirements, tip_force_N=2), 1000, 20)
        modulus = evaluate(self.section, self.requirements, 2000, 20)
        length = evaluate(self.section, replace(self.requirements, span_mm=200), 1000, 20)
        self.assertAlmostEqual(force["tip_deflection_mm"], 2*base["tip_deflection_mm"])
        self.assertAlmostEqual(force["root_bending_stress_MPa"], 2*base["root_bending_stress_MPa"])
        self.assertAlmostEqual(modulus["tip_deflection_mm"], base["tip_deflection_mm"]/2)
        self.assertAlmostEqual(modulus["root_bending_stress_MPa"], base["root_bending_stress_MPa"])
        self.assertAlmostEqual(length["tip_deflection_mm"], 8*base["tip_deflection_mm"])
        self.assertAlmostEqual(length["root_bending_stress_MPa"], 2*base["root_bending_stress_MPa"])

    def test_independent_curvature_and_strain_energy_integration(self):
        r = self.requirements
        e, inertia = 1000, self.section.inertia_mm4
        # Numerically integrate curvature against the unit-tip-load moment.
        intervals = 1000
        dx = r.span_mm/intervals
        summation = energy = 0
        for index in range(intervals+1):
            x = index*dx
            weight = 1 if index in {0, intervals} else 4 if index % 2 else 2
            moment = r.tip_force_N*(r.span_mm-x)
            summation += weight*(r.span_mm-x)*moment/(e*inertia)
            energy += weight*moment**2/(2*e*inertia)
        response = evaluate(self.section, r, e, 20)
        self.assertAlmostEqual(summation*dx/3, response["tip_deflection_mm"], places=11)
        self.assertAlmostEqual(energy*dx/3, response["strain_energy_N_mm"], places=11)

    def test_polygon_integrals_and_solid_limit(self):
        for section in [self.section, Section("i", 30, 30, 3, 2), Section("i", 30, 30, 2, 30)]:
            geometric = polygon_properties(section.outline())
            self.assertAlmostEqual(geometric["area_mm2"], section.area_mm2)
            self.assertAlmostEqual(geometric["inertia_mm4"], section.inertia_mm4)
        solid = Section("i", 30, 30, 2, 30)
        rectangle = Section("rectangle", 30, 30)
        self.assertEqual(solid.area_mm2, rectangle.area_mm2)
        self.assertEqual(solid.inertia_mm4, rectangle.inertia_mm4)

    def test_invalid_inputs_and_omitted_mode_screens(self):
        for args in [("rectangle", 0, 10), ("i", 30, 10, 5, 2), ("i", 30, 10, 2, 31), ("rectangle", math.nan, 10)]:
            with self.assertRaises(ValueError):
                Section(*args)
        with self.assertRaises(ValueError):
            evaluate(self.section, self.requirements, 0, 20)
        too_thin = evaluate(Section("i", 30, 30, 2, 1), Requirements(), 1400, 30)
        self.assertIn("minimum_feature", too_thin["failed_screens"])
        self.assertIn("web_ratio_screen", too_thin["failed_screens"])
        with self.assertRaises(ValueError):
            Requirements(max_bending_strain=0.2)


class SearchTests(unittest.TestCase):
    def test_grid_contains_valid_nonaligned_flange_and_is_bounded(self):
        self.assertIn(3, [f for f in grid(2, 6.1/2, 0.5) if 2*f < 6.1])
        material = load_materials()[0]
        # Bound both the rectangle-only case and a large I-section search
        # before allocating grid lists.
        for space in [SearchSpace(max_web_mm=1), SearchSpace()]:
            with self.assertRaisesRegex(ValueError, "candidate bound"):
                search(material, Requirements(max_height_mm=1e12), space)

    def test_optimized_baseline_and_direct_reevaluation(self):
        material = load_materials()[0]
        r = Requirements()
        result = search(material, r, SearchSpace(step_mm=1), "lower_sensitivity")
        state = result["material_scenario"]
        for family in result["families"].values():
            self.assertIsNotNone(family["best"])
            self.assertGreater(family["evaluated"], family["feasible_count"])
            design = family["best"]
            direct = evaluate(Section(**design["section"]), r, state["modulus_MPa"], state["yield_stress_MPa"])
            self.assertEqual(direct, design["evaluation"])
        # Independently enumerate rectangles rather than trust the cached optimum.
        feasible = [height for height in range(6,31) if evaluate(Section("rectangle",30,height),r,state["modulus_MPa"],state["yield_stress_MPa"])["passes_declared_screens"]]
        self.assertEqual(result["families"]["rectangle"]["best"]["section"]["height_mm"], min(feasible))

    def test_infeasible_request_does_not_invent_a_candidate(self):
        result = search(load_materials()[0], Requirements(tip_force_N=10000), SearchSpace(step_mm=2))
        self.assertTrue(all(v["best"] is None for v in result["families"].values()))
        self.assertIsNone(result["i_volume_reduction_vs_optimized_rectangle_percent"])

    def test_grid_refinement_does_not_worsen_volume(self):
        material, requirements = load_materials()[0], Requirements()
        coarse = search(material, requirements, SearchSpace(step_mm=1))
        refined = search(material, requirements, SearchSpace(step_mm=0.5))
        for name in ["rectangle", "i"]:
            self.assertLessEqual(refined["families"][name]["best"]["evaluation"]["volume_mm3"], coarse["families"][name]["best"]["evaluation"]["volume_mm3"])


class WorkflowTests(unittest.TestCase):
    def test_demo_export_and_recompute(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)/"run"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["demo", "--out", str(folder)]), 0)
            result = json.loads((folder/"results.json").read_text())
            self.assertFalse(result["meta_model_used"])
            self.assertEqual(len(result["exports"]), 2)
            for entry in result["exports"]:
                self.assertTrue((folder/entry["stl"]).exists())
                self.assertTrue(entry["checks"]["watertight"])
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(main(["evaluate", str(folder/entry["design"])]), 0)
                evaluated = json.loads(output.getvalue())
                self.assertTrue(evaluated["evaluation"]["passes_declared_screens"])
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["demo", "--out", str(folder)]), 2)

    def test_unknown_material_and_invalid_file_fail_clearly(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["demo", "--material", "made-up"]), 2)
            self.assertEqual(main(["evaluate", "missing-design.json"]), 2)


if __name__ == "__main__":
    unittest.main()
