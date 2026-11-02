from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from rematter.materials import ROOT
from rematter.products import ProductDataError, ProductInputError
from rematter.server import build_server
from rematter.service import WorkbenchService
from rematter.target_checks import DATA_PATH, MANIFEST_PATH, REQUIRED_INPUTS, WORKBOOK_PATH, target_check, target_series


def request(**changes):
    return {"series_id": "CECON21-YIELD-MDPE", "target_min_MPa": 25, "target_max_MPa": 28, **changes}


def copied_inputs(folder):
    root = Path(folder)
    for name in REQUIRED_INPUTS | {MANIFEST_PATH}:
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)
    return root


class TargetCheckTests(unittest.TestCase):
    def test_only_four_recorded_host_series_are_available(self):
        result = target_series()
        self.assertEqual(result["result_kind"], "source_measurements")
        self.assertEqual(result["property"], {"name": "yield_stress", "label": "Yield stress", "unit": "MPa"})
        self.assertEqual(result["source"]["doi"], "10.1016/j.dib.2021.107452")
        self.assertEqual(result["source"]["license"], "CC-BY-4.0")
        self.assertEqual(len(result["series"]), 4)
        for series in result["series"]:
            self.assertEqual(series["input_levels"], [0, 20, 40, 60, 80, 100])
            self.assertEqual(series["condition_ids"][-1], "CECON21-PCRPE100")
            self.assertEqual(len(series["condition_ids"]), 6)

    def test_mdpe_target_uses_each_recorded_specimen_without_interpolation(self):
        result = target_check(request())
        self.assertEqual([level["values_in_target"] for level in result["levels"]], [1, 10, 0, 0, 0, 0])
        self.assertEqual(result["matching_tested_levels_wt_percent"], [20])
        level = result["levels"][1]
        self.assertEqual(level["source_min_MPa"], 25.7195)
        self.assertEqual(level["source_max_MPa"], 27.0553)
        self.assertAlmostEqual(level["source_mean_MPa"], 26.57993)
        self.assertEqual(level["n"], 10)
        self.assertEqual(result["comparison_scope"], "recorded_specimens_only")
        self.assertFalse(result["interpolation_used"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])

    def test_none_all_and_inclusive_boundary_targets(self):
        self.assertEqual(target_check(request(target_min_MPa=250, target_max_MPa=260))["matching_tested_levels_wt_percent"], [])
        self.assertEqual(target_check(request(target_min_MPa=0, target_max_MPa=1_000_000))["matching_tested_levels_wt_percent"], [0, 20, 40, 60, 80, 100])
        result = target_check(request(target_min_MPa=25.7195, target_max_MPa=27.0553))
        self.assertEqual(result["levels"][1]["values_in_target"], 10)
        result = target_check(request(target_min_MPa=25.7195, target_max_MPa=25.7195))
        self.assertEqual(result["levels"][1]["values_in_target"], 1)

    def test_null_maximum_means_no_upper_bound_without_an_invented_limit(self):
        result = target_check(request(target_max_MPa=None))
        self.assertEqual(result["target_min_MPa"], 25)
        self.assertIsNone(result["target_max_MPa"])
        self.assertEqual([level["values_in_target"] for level in result["levels"]], [10, 10, 0, 0, 0, 0])
        self.assertEqual(result["matching_tested_levels_wt_percent"], [0, 20])
        self.assertFalse(result["interpolation_used"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["batch_consistency_established"])

    def test_minimum_only_check_includes_boundary_and_handles_all_or_no_matches(self):
        result = target_check(request(target_min_MPa=25.7195, target_max_MPa=None))
        self.assertEqual(result["levels"][1]["values_in_target"], 10)
        self.assertEqual(result["matching_tested_levels_wt_percent"], [0, 20])
        result = target_check(request(target_min_MPa=0, target_max_MPa=None))
        self.assertEqual(result["matching_tested_levels_wt_percent"], [0, 20, 40, 60, 80, 100])
        result = target_check(request(target_min_MPa=1_000_000, target_max_MPa=None))
        self.assertEqual(result["matching_tested_levels_wt_percent"], [])

    def test_optional_bound_still_requires_the_explicit_maximum_key(self):
        body = request()
        del body["target_max_MPa"]
        with self.assertRaises(ProductInputError):
            target_check(body)

    def test_raw_values_and_input_levels_match_the_original_workbook(self):
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        with ZipFile(ROOT / WORKBOOK_PATH) as workbook:
            tree = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        cells = {cell.get("r"): cell.find("m:v", ns).text for cell in tree.findall(".//m:c", ns) if cell.find("m:v", ns) is not None}
        identities = set()
        for host in ("LDPE", "LLDPE", "MDPE", "HDPE"):
            result = target_check(request(series_id=f"CECON21-YIELD-{host}"))
            self.assertEqual(len(result["levels"]), 6)
            for level in result["levels"]:
                self.assertEqual(len(level["observations"]), 10)
                for row in level["observations"]:
                    cell = row["source_cell"].split("!")[-1]
                    content_cell = row["input_level_cell"].split("!")[-1]
                    self.assertEqual(cells[cell], row["raw_numeric_string"])
                    self.assertEqual(float(cells[cell]), row["value"])
                    self.assertEqual(float(cells[content_cell]), level["pcrpe_wt_percent"])
                    self.assertEqual(row["sample_count"], 10)
                    self.assertEqual(row["unit"], "MPa")
                    self.assertIsNone(row["independent_batch_count"])
                    self.assertIsNone(row["specimen_identifier"])
                    identities.add(row["measurement_id"])
        self.assertEqual(len(identities), 210)

    def test_hosts_stay_separate_and_share_only_the_pure_pcrpe_endpoint(self):
        ldpe = target_check(request(series_id="CECON21-YIELD-LDPE"))
        mdpe = target_check(request())
        self.assertNotEqual(ldpe["levels"][0]["observations"], mdpe["levels"][0]["observations"])
        self.assertEqual(ldpe["levels"][-1]["observations"], mdpe["levels"][-1]["observations"])
        self.assertEqual(mdpe["levels"][-1]["condition_id"], "CECON21-PCRPE100")
        self.assertIsNone(mdpe["levels"][-1]["observations"][0]["virgin_host"])

    def test_unknown_material_property_or_untested_level_cannot_be_supplied(self):
        for body in [None, [], {}, request(series_id="my_mix"), request(series_id="CECON21-MDPE-PCR30"),
                     request(property="mass"), request(pcrpe_wt_percent=30), request(density=1),
                     request(condition_id="CECON21-PCRPE100")]:
            with self.subTest(body=body), self.assertRaises(ProductInputError):
                target_check(body)

    def test_invalid_numeric_targets_are_rejected(self):
        for field in ("target_min_MPa", "target_max_MPa"):
            for value in (True, "25", -1, float("nan"), float("inf"), 10 ** 1000):
                with self.subTest(field=field, value=type(value)), self.assertRaises(ProductInputError):
                    target_check(request(**{field: value}))
        with self.assertRaises(ProductInputError):
            target_check(request(target_min_MPa=None))
        with self.assertRaises(ProductInputError):
            target_check(request(target_min_MPa=29, target_max_MPa=28))

    def test_modified_inputs_or_incomplete_manifest_block_the_check(self):
        for name in REQUIRED_INPUTS:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = copied_inputs(folder)
                path = root / name
                path.write_bytes(path.read_bytes() + b" ")
                with self.assertRaises(ProductDataError):
                    target_check(request(), root)
                with self.assertRaises(ProductDataError):
                    target_series(root)
        with tempfile.TemporaryDirectory() as folder:
            root = copied_inputs(folder)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest["files"].pop()
            (root / MANIFEST_PATH).write_text(json.dumps(manifest))
            with self.assertRaises(ProductDataError):
                target_series(root)

    def test_checked_hashes_do_not_allow_wrong_units_or_measurement_grain(self):
        for change in ("unit", "count", "level", "shared_endpoint"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                root = copied_inputs(folder)
                data_path = root / DATA_PATH
                data = json.loads(data_path.read_text())
                if change == "unit":
                    data["conditions"][0]["observations"][0]["unit"] = "g/cm3"
                elif change == "count":
                    data["conditions"][0]["observations"].pop()
                elif change == "level":
                    data["series"][0]["input_levels"][1] = 30
                else:
                    data["conditions"].append(deepcopy(data["conditions"][-1]))
                data_path.write_text(json.dumps(data))
                manifest = json.loads((root / MANIFEST_PATH).read_text())
                next(entry for entry in manifest["files"] if entry["path"] == DATA_PATH)["sha256"] = hashlib.sha256(data_path.read_bytes()).hexdigest()
                (root / MANIFEST_PATH).write_text(json.dumps(manifest))
                with self.assertRaises(ProductDataError):
                    target_check(request(), root)


class TargetCheckAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name), meta_status_fn=lambda: {"configured": False})
        cls.server = build_server(port=0, service=cls.service, web_root=Path(cls.temp.name) / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, path, body=None, headers=None):
        query = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None,
                                       headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(query, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_get_series_and_post_target_return_recorded_specimens(self):
        status, catalog = self.call("/api/products/target-series")
        self.assertEqual(status, 200)
        self.assertEqual(len(catalog["series"]), 4)
        status, result = self.call("/api/products/target-check", request())
        self.assertEqual(status, 200)
        self.assertEqual(result["matching_tested_levels_wt_percent"], [20])
        self.assertEqual(sum(len(level["observations"]) for level in result["levels"]), 60)
        self.assertFalse(result["batch_consistency_established"])

    def test_post_target_accepts_explicit_null_upper_bound(self):
        status, result = self.call("/api/products/target-check", request(target_max_MPa=None))
        self.assertEqual(status, 200)
        self.assertEqual(result["target_min_MPa"], 25)
        self.assertIsNone(result["target_max_MPa"])
        self.assertEqual(result["matching_tested_levels_wt_percent"], [0, 20])
        self.assertEqual([level["values_in_target"] for level in result["levels"]], [10, 10, 0, 0, 0, 0])
        self.assertEqual(sum(len(level["observations"]) for level in result["levels"]), 60)

    def test_post_target_rejects_missing_bound_key_and_invalid_null_minimum(self):
        missing_maximum = request()
        del missing_maximum["target_max_MPa"]
        for body in (missing_maximum, request(target_min_MPa=None, target_max_MPa=None),
                     request(target_max_MPa=""), request(target_max_MPa=False),
                     request(target_max_MPa=-1), request(target_max_MPa=24)):
            with self.subTest(body=body):
                status, result = self.call("/api/products/target-check", body)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"]["code"], "invalid_request")
                self.assertNotIn("levels", result)

    def test_invalid_inputs_and_existing_host_origin_guards(self):
        for body in (request(property="mass"), request(target_min_MPa=True), request(target_max_MPa=10 ** 1000)):
            status, result = self.call("/api/products/target-check", body)
            self.assertEqual(status, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")
            self.assertNotIn("levels", result)
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call("/api/products/target-check", request(), headers)[0], 403)
            self.assertEqual(self.call("/api/products/target-series", headers=headers)[0], 403)

    def test_modified_source_returns_503_without_substitution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = copied_inputs(folder)
            path = root / DATA_PATH
            path.write_bytes(path.read_bytes() + b" ")
            original_root = self.service.root
            try:
                self.service.root = root
                for route, body in (("/api/products/target-series", None), ("/api/products/target-check", request())):
                    status, result = self.call(route, body)
                    self.assertEqual(status, 503)
                    self.assertEqual(result["error"]["code"], "source_unavailable")
                    self.assertNotIn("levels", result)
            finally:
                self.service.root = original_root


if __name__ == "__main__":
    unittest.main()
