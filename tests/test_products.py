import json
from pathlib import Path
import shutil
import tempfile
import unittest

from rematter.materials import ROOT
from rematter.products import (
    ProductDataError, ProductInputError, REQUIRED_INPUTS, counterweight, product_catalog,
)


class ProductTests(unittest.TestCase):
    def request(self, **changes):
        return {"condition_id": "CECON21-PCRPE100", "product_name": "Counterweight",
                "volume_cm3": 1000, "target_min_kg": 0.98, "target_max_kg": 1.02, **changes}

    def test_only_recycled_matched_density_conditions_are_offered(self):
        catalog = product_catalog()
        self.assertEqual(catalog["label"], "source_measurements")
        self.assertEqual(len(catalog["density_cases"]), 17)
        for case in catalog["density_cases"]:
            self.assertEqual(case["n"], 5)
            self.assertEqual(len(case["source_cells"]), 5)
            self.assertEqual(case["source_id"], "cecon2021")
            self.assertNotIn("PCR0", case["id"])

    def test_density_unit_conversion_and_source_scenarios(self):
        result = counterweight(self.request())
        self.assertEqual(result["source_scenarios_kg"], [0.9631, 0.9678, 0.9631, 0.9647, 0.9626])
        self.assertAlmostEqual(result["mean_density_mass_kg"], 0.96426)
        self.assertEqual(result["observed_source_mass_min_kg"], 0.9626)
        self.assertEqual(result["observed_source_mass_max_kg"], 0.9678)
        self.assertEqual(result["source_scenarios_in_target"], 0)
        self.assertEqual(result["result_kind"], "simulation")
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])

    def test_source_range_volume_interval_and_midpoint_suggestion(self):
        first = counterweight(self.request())
        interval = first["volume_interval_for_source_range_cm3"]
        self.assertAlmostEqual(interval["min"], 980 / 0.9626)
        self.assertAlmostEqual(interval["max"], 1020 / 0.9678)
        for volume in [interval["min"], interval["max"], first["suggested_volume_cm3"]]:
            result = counterweight(self.request(volume_cm3=volume))
            self.assertEqual(result["source_scenarios_in_target"], 5)
        result = counterweight(self.request(volume_cm3=first["suggested_volume_cm3"]))
        self.assertAlmostEqual(result["mean_density_mass_kg"], 1)

    def test_tight_target_can_have_no_single_volume_for_observed_source_range(self):
        first = counterweight(self.request(target_min_kg=0.999, target_max_kg=1.001))
        self.assertIsNone(first["volume_interval_for_source_range_cm3"])
        at_mean = counterweight(self.request(volume_cm3=first["suggested_volume_cm3"], target_min_kg=0.999, target_max_kg=1.001))
        self.assertAlmostEqual(at_mean["mean_density_mass_kg"], 1)
        self.assertFalse(at_mean["all_source_scenarios_in_target"])

    def test_unmatched_inputs_and_invalid_numbers_have_no_mass_result(self):
        cases = [self.request(condition_id="04441PP-REG(1)-1E1"), self.request(condition_id="PP+unknown dirt"),
                 self.request(volume_cm3=True), self.request(volume_cm3=float("nan")),
                 self.request(target_min_kg=2, target_max_kg=1), self.request(density=1),
                 self.request(product_name="")]
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                counterweight(request)

    def test_modified_measurement_file_is_not_used(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in REQUIRED_INPUTS | {"data/research/calculation_inputs.json"}:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, target)
            path = root / "data/research/density/measurements.json"
            data = json.loads(path.read_text())
            data["observations"][0]["value"] = 999
            path.write_text(json.dumps(data))
            with self.assertRaises(ProductDataError):
                counterweight(self.request(), root)


if __name__ == "__main__":
    unittest.main()
