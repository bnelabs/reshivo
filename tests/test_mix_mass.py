from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from rematter.mix_mass import my_mix_mass
from rematter.products import ProductInputError
from rematter.server import build_server
from rematter.service import WorkbenchService


def mix_request():
    return {
        "product_name": "Test counterweight", "property": "mass",
        "case": {
            "label": "Synthetic fixture, not a measured material",
            "components": [
                {"name": "Fixture metal dust", "role": "main", "amount": 95, "unit": "mass_percent"},
                {"name": "Fixture cable residue", "role": "binder", "amount": 5, "unit": "mass_percent"},
            ],
            "amount_basis": "Dry mass percentages",
            "process": "Synthetic pressed-mix fixture for software tests only",
            "density_method": "Synthetic external-volume density test fixture",
            "density_volume_basis": "external_volume", "calculation_volume_basis": "external_volume",
            "volume_basis_details": "External specimen volume includes internal pores",
        },
        "readings": [{"id": "R1", "value_g_cm3": 4.2, "reading_kind": "unknown",
                      "batch_id": None, "run_id": None, "specimen_id": None, "repeat_of": None}],
        "volume_cm3": 250, "target_min_kg": 1, "target_max_kg": 1.1,
    }


class MixMassTests(unittest.TestCase):
    def test_entered_processed_density_is_scaled_without_study_substitution(self):
        request = mix_request()
        original = deepcopy(request)
        with patch("rematter.products._checked_data", side_effect=AssertionError("A study must not be loaded")):
            result = my_mix_mass(request)
        self.assertEqual(request, original)
        self.assertEqual(result["result_kind"], "simulation")
        self.assertEqual(result["input_kind"], "my_mix")
        self.assertEqual(result["reading_count"], 1)
        self.assertAlmostEqual(result["reading_scenarios"][0]["mass_kg"], 1.05)
        self.assertAlmostEqual(result["mean_density_mass_kg"], 1.05)
        self.assertEqual(result["readings_in_target"], 1)
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])
        self.assertNotIn("suggested_recipe", result)

    def test_unknown_repetition_and_grouping_remain_unknown(self):
        request = mix_request()
        request["readings"][0].update({"batch_id": "  ", "run_id": "", "specimen_id": None})
        result = my_mix_mass(request)
        self.assertIsNone(result["reading_scenarios"][0]["batch_id"])
        self.assertEqual(result["grouping"], {"identified_batch_count": 0, "unknown_batch_reading_count": 1,
                         "repeat_reading_count": 0, "batch_groups": [], "run_groups": [], "specimen_groups": []})

    def test_repeats_and_scoped_specimens_do_not_become_extra_batches(self):
        request = mix_request()
        request.update(volume_cm3=1000, target_min_kg=4.05, target_max_kg=4.35)
        request["readings"] = [
            {"id": "R1", "value_g_cm3": 4.1, "reading_kind": "specimen", "batch_id": "A", "run_id": "Run1", "specimen_id": "S1", "repeat_of": None},
            {"id": "R2", "value_g_cm3": 4.2, "reading_kind": "repeat", "batch_id": "A", "run_id": "Run1", "specimen_id": "S1", "repeat_of": "R1"},
            {"id": "R3", "value_g_cm3": 4.3, "reading_kind": "specimen", "batch_id": "A", "run_id": "Run1", "specimen_id": "S2", "repeat_of": None},
            {"id": "R4", "value_g_cm3": 4.4, "reading_kind": "specimen", "batch_id": "B", "run_id": "Run1", "specimen_id": "S1", "repeat_of": None},
            {"id": "R5", "value_g_cm3": 4, "reading_kind": "unknown", "batch_id": None, "run_id": None, "specimen_id": None, "repeat_of": None},
        ]
        result = my_mix_mass(request)
        self.assertEqual([row["mass_kg"] for row in result["reading_scenarios"]], [4.1, 4.2, 4.3, 4.4, 4])
        self.assertEqual(result["readings_in_target"], 3)
        self.assertAlmostEqual(result["mean_density_mass_kg"], 4.2)
        groups = result["grouping"]
        self.assertEqual(groups["identified_batch_count"], 2)
        self.assertEqual(groups["unknown_batch_reading_count"], 1)
        self.assertEqual(groups["repeat_reading_count"], 1)
        self.assertEqual(len(groups["specimen_groups"]), 3)
        self.assertEqual(len(groups["run_groups"]), 2)
        self.assertEqual(groups["batch_groups"][0], {"batch_id": "A", "reading_count": 3, "mass_min_kg": 4.1, "mass_max_kg": 4.3})

    def test_repeat_links_require_same_explicit_context(self):
        original = mix_request()["readings"][0]
        repeated = {**original, "id": "R2", "reading_kind": "repeat", "repeat_of": "R1"}
        request = mix_request()
        request["readings"] = [original, repeated]
        self.assertEqual(my_mix_mass(request)["grouping"]["identified_batch_count"], 0)
        for changes in [{"repeat_of": "missing"}, {"batch_id": "New batch"}, {"specimen_id": "S1"}, {"repeat_of": "R2"}]:
            request["readings"] = [deepcopy(original), {**repeated, **changes}]
            with self.subTest(changes=changes), self.assertRaises(ProductInputError):
                my_mix_mass(request)
        request["readings"] = [original, repeated, {**repeated, "id": "R3", "repeat_of": "R2"}]
        with self.assertRaises(ProductInputError):
            my_mix_mass(request)

    def test_case_fingerprint_changes_with_recipe_or_process_not_volume_or_readings(self):
        request = mix_request()
        initial = my_mix_mass(request)["case_fingerprint"]
        request["volume_cm3"] = 240
        request["readings"][0]["value_g_cm3"] = 4.1
        self.assertEqual(my_mix_mass(request)["case_fingerprint"], initial)
        request["case"]["process"] = "Another process"
        self.assertNotEqual(my_mix_mass(request)["case_fingerprint"], initial)
        request = mix_request()
        request["case"]["components"][0]["amount"] = 94
        request["case"]["components"][1]["amount"] = 6
        self.assertNotEqual(my_mix_mass(request)["case_fingerprint"], initial)

    def test_complete_recipe_has_one_amount_basis_without_density_conversion(self):
        for unit in ("g", "mass_percent", "volume_percent"):
            request = mix_request()
            for component in request["case"]["components"]:
                component["unit"] = unit
            if unit == "g":
                request["case"]["components"][0]["amount"] = 950
            self.assertEqual(my_mix_mass(request)["reading_count"], 1)
        invalid = []
        request = mix_request()
        request["case"]["components"][1]["unit"] = "g"
        invalid.append(request)
        request = mix_request()
        request["case"]["components"][1]["amount"] = 7
        invalid.append(request)
        request = mix_request()
        request["case"]["amount_basis"] = ""
        invalid.append(request)
        request = mix_request()
        request["case"]["components"][0]["role"] = "other"
        invalid.append(request)
        for request in invalid:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                my_mix_mass(request)

    def test_unknown_or_mismatched_volume_basis_blocks_calculation(self):
        for density, volume, details in [("unknown", "unknown", ""), ("external_volume", "solid_volume", ""), ("other", "other", "")]:
            request = mix_request()
            request["case"].update(density_volume_basis=density, calculation_volume_basis=volume, volume_basis_details=details)
            with self.subTest(density=density, volume=volume), self.assertRaises(ProductInputError):
                my_mix_mass(request)
        for basis, details in [("external_volume", ""), ("solid_volume", ""), ("other", "The same explicitly described volume definition")]:
            request = mix_request()
            request["case"].update(density_volume_basis=basis, calculation_volume_basis=basis, volume_basis_details=details)
            self.assertAlmostEqual(my_mix_mass(request)["observed_mass_min_kg"], 1.05)

    def test_missing_readings_cannot_fall_back_to_published_values(self):
        request = mix_request()
        for readings in ([], None, "CECON21-PCRPE100", [{}], [mix_request()["readings"][0]] * 201):
            request["readings"] = readings
            with self.subTest(readings=readings), self.assertRaises(ProductInputError):
                my_mix_mass(request)

    def test_invalid_numbers_fields_or_other_properties_have_no_result(self):
        invalid = [None, [], {**mix_request(), "property": "sound_absorption"}, {**mix_request(), "condition_id": "CECON21-PCRPE100"}]
        for value in (True, 0, -1, float("nan"), float("inf"), "4.2"):
            request = mix_request()
            request["readings"][0]["value_g_cm3"] = value
            invalid.append(request)
        for field in ("volume_cm3", "target_min_kg", "target_max_kg"):
            invalid.append({**mix_request(), field: True})
        request = mix_request()
        request["case"]["components"][0]["density_g_cm3"] = 8
        invalid.append(request)
        request = mix_request()
        request["readings"][0]["density_override"] = 1
        invalid.append(request)
        invalid.extend([{**mix_request(), "target_min_kg": 3}, {**mix_request(), "product_name": " "}])
        for request in invalid:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                my_mix_mass(request)

    def test_reading_identity_and_explicit_specimens_are_validated(self):
        for changes in [{"id": ""}, {"reading_kind": "specimen"}, {"reading_kind": "batch"}, {"repeat_of": "R1"}, {"batch_id": 1}]:
            request = mix_request()
            request["readings"][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ProductInputError):
                my_mix_mass(request)
        request = mix_request()
        request["readings"] *= 2
        with self.assertRaises(ProductInputError):
            my_mix_mass(request)

    def test_huge_integer_is_rejected_before_float_conversion(self):
        for field in ("volume_cm3", "target_min_kg", "target_max_kg"):
            with self.subTest(field=field), self.assertRaises(ProductInputError):
                my_mix_mass({**mix_request(), field: 10 ** 1000})
        request = mix_request()
        request["readings"][0]["value_g_cm3"] = 10 ** 1000
        with self.assertRaises(ProductInputError):
            my_mix_mass(request)


class MixMassAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        service = WorkbenchService(output_root=Path(cls.temp.name), meta_status_fn=lambda: {"configured": False})
        cls.server = build_server(port=0, service=service, web_root=Path(cls.temp.name) / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/api/products/my-mix"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, body, headers=None):
        request = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_route_works_when_public_measurements_are_unavailable(self):
        with patch("rematter.products._checked_data", side_effect=AssertionError("Published data is unavailable")):
            status, result = self.request(mix_request())
        self.assertEqual(status, 200)
        self.assertAlmostEqual(result["reading_scenarios"][0]["mass_kg"], 1.05)
        self.assertEqual(result["input_kind"], "my_mix")
        self.assertFalse(result["batch_consistency_established"])

    def test_invalid_case_returns_400_without_a_simulation(self):
        request = mix_request()
        request["case"]["density_volume_basis"] = "unknown"
        status, result = self.request(request)
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")
        self.assertNotIn("reading_scenarios", result)
        status, result = self.request({**mix_request(), "volume_cm3": 10 ** 1000})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")

    def test_existing_host_and_origin_guards_cover_new_route(self):
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.request(mix_request(), headers)[0], 403)


if __name__ == "__main__":
    unittest.main()
