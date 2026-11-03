"""Whole-configuration joins, independent property checks and evidence boundaries."""

from copy import deepcopy
from decimal import Decimal
import unittest

from reshivo.trial_records import assess_trial_records


def configuration(identifier, amounts, revision=1):
    return {"id": identifier, "revision": revision, "name": "Configuration " + identifier,
            "materials": [{"id": name, "name": "recycled stock " + name, "amount": amount, "unit": "mass_percent"} for name, amount in amounts],
            "process": "Recorded preparation and process P1", "geometry": "Recorded geometry and mounting G1"}


def record(identifier, configuration_id, check_id, values, revision=1, kind="synthetic"):
    unit, method = ("%", "REC-1") if check_id == "recovery" else ("dB", "INS-1")
    return {"id": identifier, "case_id": "case-1", "configuration_id": configuration_id,
            "configuration_revision": revision, "check_id": check_id, "unit": unit,
            "method": method, "data_kind": kind, "conditions_confirmed": True,
            "readings": [{"value": value} for value in values]}


def example():
    return {"case_id": "case-1", "assessment_kind": "synthetic",
            "configurations": [configuration("AB", [("A", "20"), ("B", "80")]), configuration("ABC", [("A", "20"), ("B", "30"), ("C", "50")])],
            "checks": [{"id": "recovery", "name": "Recovery screen", "unit": "%", "method": "REC-1", "minimum": "80", "maximum": None, "required": True},
                       {"id": "blocking", "name": "Installed insertion screen", "unit": "dB", "method": "INS-1", "minimum": "10", "maximum": None, "required": True}],
            "records": [record("AB-R", "AB", "recovery", ["85"]), record("AB-I", "AB", "blocking", ["8"]),
                        record("ABC-R", "ABC", "recovery", ["75"]), record("ABC-I", "ABC", "blocking", ["12"])]}


def by_configuration(result, identifier):
    return next(item for item in result["configurations"] if item["id"] == identifier)


def by_check(config, identifier):
    return next(item for item in config["checks"] if item["check_id"] == identifier)


def one_check_request(values=("0",), minimum=None, maximum="10"):
    request = example()
    request["configurations"] = request["configurations"][:1]
    request["checks"] = request["checks"][:1]
    request["checks"][0].update(minimum=minimum, maximum=maximum)
    request["records"] = [record("R", "AB", "recovery", list(values))]
    return request


class TrialRecordsTests(unittest.TestCase):
    def test_current_component_percentage_cannot_exceed_100(self):
        for unit in ("mass_percent", "volume_percent"):
            for invalid in ("101", " 101 ", "100.0000000000000000000000001", "1.01e2", "١٠١"):
                with self.subTest(unit=unit, amount=invalid):
                    request = one_check_request(["5"], maximum="10")
                    request["configurations"][0]["materials"][0].update(amount=invalid, unit=unit)
                    result = assess_trial_records(request)
                    self.assertEqual(result["status"], "needs_clarification")
                    self.assertTrue(any(error["code"] == "percentage_above_100" for error in result["errors"]))
                    config = by_configuration(result, "AB")
                    self.assertEqual(config["state"], "needs_review")
                    self.assertFalse(config["materials"][0]["amount_known"])
            for valid in ("0", "100", "100.000", "1e2", "١٠٠", "unknown"):
                with self.subTest(unit=unit, amount=valid):
                    request = one_check_request(["5"], maximum="10")
                    request["configurations"][0]["materials"][0].update(amount=valid, unit=unit)
                    result = assess_trial_records(request)
                    self.assertFalse(any(error["code"] == "percentage_above_100" for error in result["errors"]))

    def test_corrected_current_recipe_is_not_blocked_by_invalid_historical_percentage(self):
        request = one_check_request(["5"], maximum="10")
        request["configurations"][0]["materials"][0]["amount"] = "150"
        corrected = deepcopy(request["configurations"][0])
        corrected["revision"] = 2
        corrected["materials"][0]["amount"] = "20"
        request["configurations"].append(corrected)
        request["records"][0]["configuration_revision"] = 2
        result = assess_trial_records(request)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(by_configuration(result, "AB")["state"], "all_entered_checks_in_range")
        historical = next(item for item in result["configuration_versions"] if item["revision"] == 1)
        self.assertEqual(historical["materials"][0]["amount"], "150")
        self.assertFalse(historical["materials"][0]["amount_known"])

    def test_same_A_percentage_different_full_mixes_join_separately(self):
        result = assess_trial_records(example())
        self.assertEqual(result["status"], "valid")
        ab, abc = by_configuration(result, "AB"), by_configuration(result, "ABC")
        self.assertEqual(by_check(ab, "recovery")["state"], "entered_readings_in_range")
        self.assertEqual(by_check(ab, "blocking")["state"], "out_of_range")
        self.assertEqual(by_check(abc, "recovery")["state"], "out_of_range")
        self.assertEqual(by_check(abc, "blocking")["state"], "entered_readings_in_range")
        self.assertEqual(ab["state"], "out_of_range")
        self.assertEqual(abc["state"], "out_of_range")
        self.assertEqual(len(abc["materials"]), 3)

    def test_every_required_check_must_have_matching_in_range_entries(self):
        request = example()
        request["records"][2]["readings"] = [{"value": "80"}, {"value": "81"}]
        result = assess_trial_records(request)
        config = by_configuration(result, "ABC")
        self.assertEqual(config["state"], "all_entered_checks_in_range")
        self.assertFalse(config["performance_verified"])
        self.assertFalse(config["physical_product_tested"])
        self.assertFalse(result["quantity_preparation_supported"])

    def test_missing_one_required_property_is_not_filled_by_other_check(self):
        request = example()
        request["records"] = [item for item in request["records"] if item["id"] != "AB-I"]
        result = assess_trial_records(request)
        self.assertEqual(by_configuration(result, "AB")["state"], "missing_records")
        self.assertEqual(by_check(by_configuration(result, "AB"), "blocking")["reading_count"], 0)

    def test_old_revision_records_do_not_apply_to_latest_configuration(self):
        request = example()
        request["configurations"].append(configuration("AB", [("A", "25"), ("B", "75")], revision=2))
        result = assess_trial_records(request)
        current = by_configuration(result, "AB")
        self.assertEqual(current["revision"], 2)
        self.assertEqual(current["state"], "missing_records")
        self.assertTrue(all(item["reading_count"] == 0 for item in current["checks"]))
        self.assertEqual(len(result["configuration_versions"]), 3)
        self.assertEqual(sum(item["reason"] == "stale_configuration_revision" for item in result["ignored_records"]), 2)
        self.assertEqual(request["configurations"][0]["materials"][0]["amount"], "20")

    def test_current_revision_is_numeric_max_not_input_order(self):
        request = one_check_request()
        request["configurations"].insert(0, configuration("AB", [("A", "30"), ("B", "70")], revision=10))
        request["configurations"].append(configuration("AB", [("A", "25"), ("B", "75")], revision=2))
        result = assess_trial_records(request)
        self.assertEqual(result["configurations"][0]["current_revision"], 10)
        self.assertEqual(result["configurations"][0]["state"], "missing_records")

    def test_synthetic_records_never_fill_missing_user_reported_property(self):
        request = example()
        request["assessment_kind"] = "user_reported"
        request["records"].append(record("REAL-R", "AB", "recovery", ["85"], kind="user_reported"))
        result = assess_trial_records(request)
        config = by_configuration(result, "AB")
        self.assertEqual(config["state"], "missing_records")
        self.assertEqual(by_check(config, "recovery")["source_kind"], "user_reported")
        self.assertEqual(by_check(config, "recovery")["reading_count"], 1)
        self.assertEqual(by_check(config, "blocking")["reading_count"], 0)
        self.assertEqual(sum(item["reason"] == "other_data_kind" for item in result["ignored_records"]), 4)

    def test_explicit_source_kind_is_required(self):
        request = example()
        request.pop("assessment_kind")
        result = assess_trial_records(request)
        self.assertEqual(result["status"], "needs_clarification")
        self.assertTrue(all(item["state"] != "all_entered_checks_in_range" for item in result["configurations"]))

    def test_upper_only_target_includes_zero_and_exact_boundary(self):
        result = assess_trial_records(one_check_request(["0", "10"], maximum="10"))
        check = result["configurations"][0]["checks"][0]
        self.assertEqual(check["state"], "entered_readings_in_range")
        self.assertEqual(Decimal(check["minimum_entered"]), 0)
        self.assertEqual(Decimal(check["maximum_entered"]), 10)

    def test_tiny_excess_is_not_rounded_into_range(self):
        value = "10.000000000000000000000000000000000000000000000000001"
        result = assess_trial_records(one_check_request([value], maximum="10"))
        self.assertEqual(result["configurations"][0]["state"], "out_of_range")
        self.assertEqual(Decimal(result["configurations"][0]["checks"][0]["maximum_entered"]), Decimal(value))

    def test_exact_two_sided_zero_and_small_negative_target(self):
        request = one_check_request(["0", "-0.000"], minimum="0", maximum="0")
        self.assertEqual(assess_trial_records(request)["configurations"][0]["state"], "all_entered_checks_in_range")
        request["checks"][0].update(minimum="-1e-40", maximum="1e-40")
        request["records"][0]["readings"] = [{"value": "-1e-40"}, {"value": "1e-40"}]
        self.assertEqual(assess_trial_records(request)["configurations"][0]["state"], "all_entered_checks_in_range")

    def test_no_averaging_to_hide_out_of_range_entry(self):
        result = assess_trial_records(one_check_request(["1", "9"], minimum="5", maximum=None))
        check = result["configurations"][0]["checks"][0]
        self.assertEqual(check["state"], "out_of_range")
        self.assertEqual(check["reading_count"], 2)
        self.assertNotIn("mean", check)
        self.assertNotIn("average", check)

    def test_only_exact_method_and_unit_can_be_pooled(self):
        for key, value in (("unit", "MPa"), ("method", "different test conditions")):
            with self.subTest(field=key):
                request = one_check_request(["5"])
                request["records"][0][key] = value
                result = assess_trial_records(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 0)
                self.assertEqual(result["configurations"][0]["state"], "needs_review")
                self.assertEqual(request["records"][0][key], value)

    def test_unconfirmed_conditions_are_review_not_measurement_completion(self):
        request = one_check_request(["5"])
        request["records"][0]["conditions_confirmed"] = False
        result = assess_trial_records(request)
        check = result["configurations"][0]["checks"][0]
        self.assertEqual(check["state"], "needs_review")
        self.assertEqual(check["record_count"], 0)
        self.assertEqual(check["reading_count"], 0)
        self.assertEqual(check["unconfirmed_record_count"], 1)
        self.assertEqual(check["records"][0]["readings"][0]["value"], "5")

    def test_unconfirmed_extra_record_cannot_be_ignored_to_manufacture_pass(self):
        request = one_check_request(["5"])
        extra = record("unconfirmed", "AB", "recovery", ["99"])
        extra["conditions_confirmed"] = False
        request["records"].append(extra)
        result = assess_trial_records(request)
        self.assertEqual(result["configurations"][0]["state"], "needs_review")
        self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 1)

    def test_matching_records_pool_extrema_and_counts_only(self):
        request = one_check_request(["3", "4"])
        request["records"].append(record("R2", "AB", "recovery", ["1", "8"]))
        check = assess_trial_records(request)["configurations"][0]["checks"][0]
        self.assertEqual(check["record_count"], 2)
        self.assertEqual(check["reading_count"], 4)
        self.assertEqual(Decimal(check["minimum_entered"]), 1)
        self.assertEqual(Decimal(check["maximum_entered"]), 8)
        self.assertEqual(len(check["records"]), 2)

    def test_repeated_readings_preserve_unknown_groups_without_batch_inference(self):
        request = one_check_request()
        request["records"][0]["readings"] = [{"value": "3", "reading_id": "R1", "specimen_id": "S1"}, {"value": "4", "reading_id": "R2", "specimen_id": "S1", "repeat_of": "R1"}]
        check = assess_trial_records(request)["configurations"][0]["checks"][0]
        self.assertEqual(check["reading_count"], 2)
        self.assertEqual(check["record_count"], 1)
        readings = check["records"][0]["readings"]
        self.assertEqual(readings[1]["repeat_of"], "R1")
        self.assertIsNone(readings[0]["batch_id"])
        self.assertIsNone(readings[0]["run_id"])
        self.assertNotIn("batch_count", check)
        self.assertNotIn("specimen_count", check)

    def test_repeat_reference_must_exist_and_cannot_change_known_specimen(self):
        for reading in ({"value": "4", "reading_id": "R2", "repeat_of": "missing"}, {"value": "4", "reading_id": "R2", "specimen_id": "S2", "repeat_of": "R1"}, {"value": "4", "reading_id": "R2", "repeat_of": "R2"}):
            with self.subTest(reading=reading):
                request = one_check_request()
                request["records"][0]["readings"] = [{"value": "3", "reading_id": "R1", "specimen_id": "S1"}, reading]
                result = assess_trial_records(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 0)

    def test_no_required_checks_is_not_a_vacuous_pass(self):
        for check_mode in ("none", "optional"):
            with self.subTest(mode=check_mode):
                request = one_check_request()
                if check_mode == "none":
                    request["checks"] = []
                    request["records"] = []
                else:
                    request["checks"][0]["required"] = False
                result = assess_trial_records(request)
                self.assertEqual(result["configurations"][0]["state"], "no_required_checks")

    def test_unset_target_stays_distinct_from_missing_and_failure(self):
        request = one_check_request(["5"], minimum=None, maximum=None)
        result = assess_trial_records(request)
        self.assertEqual(result["configurations"][0]["state"], "target_not_set")
        self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 1)

    def test_incomplete_amounts_are_captured_without_filler_or_quantity_claim(self):
        request = one_check_request()
        request["configurations"][0]["materials"][1].update(amount="unknown remainder", unit="")
        result = assess_trial_records(request)
        config = result["configurations"][0]
        self.assertEqual(result["status"], "valid")
        self.assertFalse(config["component_amounts_complete"])
        self.assertFalse(config["can_prepare_quantities"])
        self.assertEqual(config["formulation_completeness"], "not_assessed")
        self.assertEqual(config["materials"][1]["amount"], "unknown remainder")
        self.assertFalse(config["materials"][1]["amount_known"])
        self.assertNotEqual(config["materials"][1]["amount"], "80")

    def test_foreign_case_never_enters_counts(self):
        request = one_check_request(["5"])
        request["records"][0]["case_id"] = "foreign-case"
        result = assess_trial_records(request)
        self.assertEqual(result["status"], "needs_clarification")
        self.assertTrue(any(item["code"] == "foreign_case" for item in result["errors"]))
        self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 0)

    def test_unknown_configuration_revision_and_check_are_rejected(self):
        for key, value in (("configuration_id", "not-captured"), ("configuration_revision", 2), ("check_id", "not-captured")):
            with self.subTest(field=key):
                request = one_check_request()
                request["records"][0][key] = value
                self.assertEqual(assess_trial_records(request)["status"], "needs_clarification")

    def test_duplicate_versions_checks_records_and_readings_rejected(self):
        for collection in ("configurations", "checks", "records", "readings"):
            with self.subTest(collection=collection):
                request = one_check_request()
                if collection == "readings":
                    request["records"][0]["readings"] = [{"value": "1", "reading_id": "duplicate"}, {"value": "2", "reading_id": "duplicate"}]
                else:
                    request[collection].append(deepcopy(request[collection][0]))
                result = assess_trial_records(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertNotEqual(result["configurations"][0]["state"], "all_entered_checks_in_range")

    def test_bool_and_numeric_json_values_cannot_masquerade_as_numbers(self):
        for value in (True, False, 0, 1.2, "NaN", "Infinity", "one", "1e999999", "0" * 161):
            with self.subTest(value=value):
                request = one_check_request()
                request["records"][0]["readings"][0]["value"] = value
                self.assertEqual(assess_trial_records(request)["status"], "needs_clarification")

    def test_boolean_fields_and_revision_have_strict_types(self):
        for kind in ("required", "conditions_confirmed", "revision"):
            with self.subTest(kind=kind):
                request = one_check_request()
                if kind == "required":
                    request["checks"][0]["required"] = "true"
                elif kind == "conditions_confirmed":
                    request["records"][0][kind] = "false"
                else:
                    request["configurations"][0][kind] = True
                self.assertEqual(assess_trial_records(request)["status"], "needs_clarification")

    def test_reversed_or_invalid_targets_cannot_pass(self):
        for minimum, maximum in (("11", "10"), (True, "10"), ("NaN", None)):
            with self.subTest(minimum=minimum):
                result = assess_trial_records(one_check_request(minimum=minimum, maximum=maximum))
                self.assertEqual(result["status"], "needs_clarification")

    def test_empty_record_does_not_vacuously_complete_a_check(self):
        request = one_check_request(values=[])
        result = assess_trial_records(request)
        self.assertEqual(result["configurations"][0]["state"], "needs_review")
        self.assertEqual(result["configurations"][0]["checks"][0]["reading_count"], 0)

    def test_bounded_lists_and_text_return_errors_without_processing_excess(self):
        request = one_check_request()
        request["records"][0]["readings"] = [{"value": "1"}] * 1001
        self.assertEqual(assess_trial_records(request)["status"], "needs_clarification")
        request = one_check_request()
        request["configurations"][0]["name"] = "X" * 161
        self.assertEqual(assess_trial_records(request)["status"], "needs_clarification")

    def test_request_is_not_mutated(self):
        request = example()
        original = deepcopy(request)
        assess_trial_records(request)
        self.assertEqual(request, original)

    def test_malformed_container_types_return_structured_errors(self):
        for request in (None, [], {"case_id": "case", "assessment_kind": "synthetic", "configurations": {}, "checks": [], "records": []}):
            with self.subTest(request=request):
                result = assess_trial_records(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertFalse(result["performance_verified"])


if __name__ == "__main__":
    unittest.main()
