from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from reshivo.products import ProductInputError
from reshivo.reading_comparison import compare_readings
from reshivo.server import build_server
from reshivo.service import WorkbenchService
from tests.test_advisor import brief_request, calculation_context


def request():
    return {
        "brief": brief_request()["brief"], "calculation_context": calculation_context(),
        "property_name": "Finished mass", "property_unit": "g", "input_name": "Binder portion",
        "input_unit": "mass percent", "target_min": "980", "target_max": "1020",
        "method": "Synthetic complete-assembly weighing, same case and scale setup",
        "conditions_confirmed": True, "data_kind": "synthetic",
        "settings": [
            {"id": "low", "level": "5", "readings": [
                {"value": "979", "group_label": "Unknown", "group_kind": "unknown"},
                {"value": "980", "group_label": "  reading A  ", "group_kind": "repeat"}]},
            {"id": "high", "level": "10", "readings": [
                {"value": "1000", "group_label": "A", "group_kind": "specimen"},
                {"value": "1020", "group_label": "A", "group_kind": "run"},
                {"value": "1005", "group_label": "B", "group_kind": "batch"}]},
        ],
    }


class ReadingComparisonTests(unittest.TestCase):
    def test_observed_readings_and_boundaries_are_preserved(self):
        body = request()
        result = compare_readings(body)
        self.assertEqual(result["matching_setting_ids"], ["high"])
        low, high = result["settings"]
        self.assertEqual((low["observed_min"], low["observed_max"], low["reading_count"], low["in_target_count"]), ("979", "980", 2, 1))
        self.assertFalse(low["all_readings_in_target"])
        self.assertEqual((high["observed_min"], high["observed_max"], high["reading_count"], high["in_target_count"]), ("1000", "1020", 3, 3))
        self.assertTrue(high["all_readings_in_target"])
        self.assertEqual(low["readings"][1]["group_label"], "  reading A  ")
        self.assertEqual([row["group_kind"] for row in high["readings"]], ["specimen", "run", "batch"])
        self.assertFalse(result["interpolation_used"])
        self.assertFalse(result["future_consistency_established"])
        self.assertFalse(result["physical_product_tested_by_app"])
        self.assertNotIn("identified_batch_count", json.dumps(result))
        self.assertNotIn("mean", json.dumps(result))
        self.assertIn("not assessed", " ".join(result["warnings"]))
        self.assertIn("uncertainty is not modeled", " ".join(result["warnings"]))

    def test_user_reported_measurements_are_not_called_verified(self):
        body = request()
        body["data_kind"] = "user_reported"
        result = compare_readings(body)
        self.assertEqual(result["data_kind"], "user_reported")
        self.assertIn("not been independently verified", result["warnings"][0])
        self.assertFalse(result["physical_product_tested_by_app"])

    def test_negative_and_decimal_properties_use_inclusive_explicit_targets(self):
        body = request()
        body.update(target_min="-0.1", target_max="0.1", property_name="Position", property_unit="mm")
        body["settings"][0]["readings"][0]["value"] = "-0.1"
        body["settings"][0]["readings"][1]["value"] = "0.1"
        body["settings"][1]["readings"] = [{"value": "0.10000000000001", "group_label": "Unknown", "group_kind": "unknown"}]
        result = compare_readings(body)
        self.assertEqual(result["matching_setting_ids"], ["low"])

    def test_null_maximum_removes_only_upper_bound_and_preserves_metadata(self):
        body = request()
        body["settings"][1]["readings"][1].update(value="1020.0000000000000001", specimen_id="specimen-2", batch_id="batch-A")
        bounded = compare_readings(body)
        self.assertFalse(bounded["settings"][1]["readings"][1]["inside_target"])
        body["target_max"] = None
        result = compare_readings(body)
        self.assertIsNone(result["target_max"])
        self.assertEqual(result["target_min"], "980")
        self.assertEqual(result["matching_setting_ids"], ["high"])
        self.assertEqual([row["inside_target"] for row in result["settings"][0]["readings"]], [False, True])
        row = result["settings"][1]["readings"][1]
        self.assertTrue(row["inside_target"])
        self.assertEqual(row["value"], "1020.0000000000000001")
        self.assertEqual((row["specimen_id"], row["batch_id"], row["group_kind"]), ("specimen-2", "batch-A", "run"))
        self.assertEqual(result["brief"], bounded["brief"])
        self.assertEqual(result["calculation_context"], bounded["calculation_context"])
        self.assertFalse(result["interpolation_used"])
        self.assertFalse(result["future_consistency_established"])
        self.assertFalse(result["physical_product_tested_by_app"])
        self.assertIsNone(json.loads(json.dumps(result))["target_max"])

    def test_minimum_only_check_preserves_exact_decimal_boundary_and_has_no_numeric_ceiling(self):
        body = request()
        body.update(target_min=" 0.100000000000000005 ", target_max=None)
        body["settings"][0]["readings"][0]["value"] = "0.1"
        body["settings"][0]["readings"][1]["value"] = "0.100000000000000005"
        body["settings"][1]["readings"] = [
            {"value": "0.100000000000000006", "group_label": "Unknown", "group_kind": "unknown"},
            {"value": "1e9999", "group_label": "Unknown", "group_kind": "unknown"}]
        result = compare_readings(body)
        self.assertEqual(result["target_min"], "0.100000000000000005")
        self.assertEqual([row["inside_target"] for row in result["settings"][0]["readings"]], [False, True])
        self.assertEqual([row["inside_target"] for row in result["settings"][1]["readings"]], [True, True])
        self.assertEqual(result["settings"][1]["observed_max"], "1e9999")
        self.assertEqual(result["matching_setting_ids"], ["high"])

    def test_minimum_only_check_still_requires_explicit_maximum_key(self):
        body = request()
        del body["target_max"]
        with self.assertRaises(ProductInputError):
            compare_readings(body)

    def test_case_method_confirmation_and_provenance_are_required(self):
        for change in ("material", "process", "method", "confirmation", "kind", "unit"):
            body = request()
            if change == "material": body["brief"]["input"] = ""
            if change == "process": body["brief"]["process"] = ""
            if change == "method": body["method"] = " "
            if change == "confirmation": body["conditions_confirmed"] = False
            if change == "kind": body["data_kind"] = "verified"
            if change == "unit": body["property_unit"] = " "
            with self.subTest(change=change), self.assertRaises(ProductInputError): compare_readings(body)

    def test_duplicate_levels_ids_missing_readings_and_unknown_fields_rejected(self):
        for change in ("same_id", "same_level", "too_few", "empty", "extra", "bad_group", "empty_group"):
            body = request()
            if change == "same_id": body["settings"][1]["id"] = "low"
            if change == "same_level": body["settings"][1]["level"] = "5.0"
            if change == "too_few": body["settings"] = body["settings"][:1]
            if change == "empty": body["settings"][0]["readings"] = []
            if change == "extra": body["settings"][0]["readings"][0]["source"] = "stored study"
            if change == "bad_group": body["settings"][0]["readings"][0]["group_kind"] = "independent"
            if change == "empty_group": body["settings"][0]["readings"][0]["group_label"] = " "
            with self.subTest(change=change), self.assertRaises(ProductInputError): compare_readings(body)

    def test_nonfinite_boolean_and_unordered_numbers_rejected(self):
        for bad in (True, False, 0, 1, .1, "", " ", "1_000", "0x10", "NaN", "Infinity", "1e10001", "1e-10001", "9" * 161, None, float("inf"), float("nan"), 10**5000):
            for field in ("target_min", "target_max", "level", "value"):
                if field == "target_max" and bad is None:
                    continue
                body = request()
                if field in ("target_min", "target_max"): body[field] = bad
                if field == "level": body["settings"][0][field] = bad
                if field == "value": body["settings"][0]["readings"][0][field] = bad
                with self.subTest(field=field, value_type=type(bad)), self.assertRaises(ProductInputError): compare_readings(body)
        body = request(); body["target_min"] = "1021"
        with self.assertRaises(ProductInputError): compare_readings(body)

    def test_exact_decimal_literals_survive_tiny_and_high_precision_boundaries(self):
        body = request()
        body.update(target_min="0", target_max="0.1")
        body["settings"][0]["level"] = "9007199254740992"
        body["settings"][1]["level"] = "9007199254740993"
        body["settings"][0]["readings"] = [
            {"value": "1e-400", "group_label": "Unknown", "group_kind": "unknown"},
            {"value": "0.100000000000000005", "group_label": "Unknown", "group_kind": "unknown"},
            {"value": ".1000", "group_label": "Unknown", "group_kind": "unknown"}]
        body["settings"][1]["readings"] = [{"value": "1e-401", "group_label": "Unknown", "group_kind": "unknown"}]
        result = compare_readings(body)
        low = result["settings"][0]
        self.assertEqual(result["target_max"], "0.1")
        self.assertEqual([row["inside_target"] for row in low["readings"]], [True, False, True])
        self.assertEqual(low["observed_min"], "1e-400")
        self.assertEqual(low["observed_max"], "0.100000000000000005")
        self.assertEqual(result["settings"][1]["level"], "9007199254740993")
        self.assertEqual(json.loads(json.dumps(result))["settings"][0]["readings"][0]["value"], "1e-400")
        body.update(target_min="0", target_max="0")
        self.assertEqual(compare_readings(body)["matching_setting_ids"], [])

    def test_decimal_level_uniqueness_and_extrema_use_numeric_order(self):
        body = request()
        body["settings"][0]["level"] = "1.00"
        body["settings"][1]["level"] = "1e0"
        with self.assertRaises(ProductInputError): compare_readings(body)
        body["settings"][1]["level"] = "2"
        body["settings"][0]["readings"][0]["value"] = "10"
        body["settings"][0]["readings"][1]["value"] = "2"
        result = compare_readings(body)
        self.assertEqual((result["settings"][0]["observed_min"], result["settings"][0]["observed_max"]), ("2", "10"))

    def test_separate_identifiers_preserved_without_inferred_hierarchy(self):
        body = request()
        identifiers = {"reading_id": " reading-2 ", "specimen_id": "specimen-A", "run_id": "run-4", "batch_id": "batch-2", "repeat_of": "reading-1"}
        body["settings"][0]["readings"][0].update(identifiers)
        result = compare_readings(body)
        row = result["settings"][0]["readings"][0]
        self.assertEqual({key: row[key] for key in identifiers}, identifiers)
        self.assertTrue(all(result["settings"][0]["readings"][1][key] is None for key in identifiers))
        self.assertNotIn("batch_count", result)
        self.assertIn("hierarchy", " ".join(result["warnings"]))
        for invalid in ("", " ", 1, [], "a" * 161):
            body["settings"][0]["readings"][0]["specimen_id"] = invalid
            with self.subTest(invalid_type=type(invalid)), self.assertRaises(ProductInputError): compare_readings(body)

    def test_exact_setting_and_reading_size_limits(self):
        body = request()
        body["settings"] = [{"id": str(i), "level": str(i), "readings": [{"value": "1000", "group_label": "Unknown", "group_kind": "unknown"} for _ in range(20)]} for i in range(20)]
        self.assertEqual(len(compare_readings(body)["settings"]), 20)
        too_many = deepcopy(body); too_many["settings"].append(deepcopy(too_many["settings"][0]))
        with self.assertRaises(ProductInputError): compare_readings(too_many)
        too_many = deepcopy(body); too_many["settings"][0]["readings"].append(deepcopy(too_many["settings"][0]["readings"][0]))
        with self.assertRaises(ProductInputError): compare_readings(too_many)


class ReadingComparisonHTTPTests(unittest.TestCase):
    def test_endpoint_and_standard_body_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            service = WorkbenchService(output_root=Path(temp), meta_status_fn=lambda: {"configured": False})
            server = build_server(port=0, service=service, web_root=Path(temp)/"web")
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/api/products/compare-readings"
                def post(data):
                    req = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json"})
                    try:
                        with urllib.request.urlopen(req, timeout=5) as response: return response.status, json.loads(response.read())
                    except urllib.error.HTTPError as error:
                        with error: return error.code, json.loads(error.read())
                status, result = post(json.dumps(request()).encode())
                self.assertEqual(status, 200)
                self.assertEqual(result["matching_setting_ids"], ["high"])
                body = request()
                body.update(target_min="0.100000000000000005", target_max=None)
                body["settings"][0]["readings"][0]["value"] = "0.1"
                body["settings"][0]["readings"][1]["value"] = "0.100000000000000005"
                body["settings"][1]["readings"][0]["value"] = "1e9999"
                status, minimum_only = post(json.dumps(body).encode())
                self.assertEqual(status, 200)
                self.assertIsNone(minimum_only["target_max"])
                self.assertEqual(minimum_only["target_min"], "0.100000000000000005")
                self.assertEqual([row["inside_target"] for row in minimum_only["settings"][0]["readings"]], [False, True])
                self.assertTrue(minimum_only["settings"][1]["readings"][0]["inside_target"])
                self.assertEqual(minimum_only["settings"][1]["readings"][0]["value"], "1e9999")
                for bad_maximum in (False, "", 1020):
                    body["target_max"] = bad_maximum
                    self.assertEqual(post(json.dumps(body).encode())[0], 400)
                del body["target_max"]
                self.assertEqual(post(json.dumps(body).encode())[0], 400)
                body = request()
                body.update(target_min="0", target_max="0")
                body["settings"][0]["readings"][0]["value"] = "1e-400"
                status, exact = post(json.dumps(body).encode())
                self.assertEqual(status, 200)
                self.assertEqual(exact["settings"][0]["readings"][0]["value"], "1e-400")
                self.assertFalse(exact["settings"][0]["readings"][0]["inside_target"])
                raw_numeric = json.dumps(body).replace('"value": "1e-400"', '"value": 1e-400', 1).encode()
                status, error = post(raw_numeric)
                self.assertEqual(status, 400)
                self.assertIn("decimal text", error["error"]["message"])
                body = request(); body["brief"]["process"] = ""
                self.assertEqual(post(json.dumps(body).encode())[0], 400)
                self.assertEqual(post(b" " * (64 * 1024 + 1))[0], 413)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__": unittest.main()
