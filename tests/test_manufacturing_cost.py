"""Accounting examples and invalid-input boundaries for manufacturing costs."""

from copy import deepcopy
from fractions import Fraction
import unittest

from rematter.manufacturing_cost import calculate_manufacturing_cost, compare_manufacturing_costs


def floor_request(configuration="A"):
    values = {
        "A": (["30", "10", "2"], "18", "1.5", "16", "32"),
        "B": (["34", "6", "2"], "22", "1.25", "14", "28"),
    }
    amounts, energy, hours, count, mass = values[configuration]
    return {
        "case_id": "floor-mat-case", "configuration_id": configuration,
        "configuration_revision": "1", "current_configuration_revision": "1",
        "currency": "CU", "mass_basis": "dry",
        "product_basis": "floor mat", "functional_basis": "same-size mat; shop appearance screen",
        "scope_basis": "charged materials, energy, direct labor and one manufacturing batch charge",
        "materials": [
            {"id": name, "name": name, "quantity": amount, "quantity_unit": "kg", "unit_price": rate, "price_unit": "kg"}
            for name, amount, rate in zip(("flake", "elastomer", "binder"), amounts, (".40", "1.20", "2.50"))
        ],
        "process": {
            "energy": {"status": "known", "kwh": energy, "rate": ".15"},
            "labor": {"status": "known", "person_hours": hours, "rate": "12"},
            "other": {"status": "known", "charges": [{"id": "batch", "name": "batch manufacturing charge", "amount": "4"}]},
        },
        "output": {"mode": "actual", "acceptance_basis": "user shop appearance/size screen only", "usable_count": count, "gross_count": "20", "usable_mass_kg": mass},
    }


def exact(result, field):
    value = result["exact_values"][field]
    return Fraction(int(value["numerator"]), int(value["denominator"]))


class ManufacturingCostTests(unittest.TestCase):
    def test_floor_A_full_entered_scope(self):
        result = calculate_manufacturing_cost(floor_request())
        self.assertEqual(result["status"], "complete")
        self.assertEqual(exact(result, "costs.materials"), 29)
        self.assertEqual(exact(result, "costs.entered_scope_total"), Fraction("53.70"))
        self.assertEqual(exact(result, "unit_costs.per_usable_unit"), Fraction("3.35625"))
        self.assertEqual(exact(result, "unit_costs.per_usable_kg"), Fraction("1.678125"))
        self.assertEqual(result["physical_target_status"], "not_assessed")

    def test_cheaper_floor_batch_costs_more_per_usable_mat(self):
        result = compare_manufacturing_costs([floor_request("A"), floor_request("B")])
        self.assertTrue(result["comparable"])
        a, b = result["results"]
        self.assertEqual(exact(b, "costs.entered_scope_total"), Fraction("48.10"))
        self.assertEqual(exact(b, "unit_costs.per_usable_unit"), Fraction(481, 140))
        self.assertEqual(exact(b, "unit_costs.per_usable_unit") - exact(a, "unit_costs.per_usable_unit"), Fraction(89, 1120))
        self.assertEqual(result["winners"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertIn("co-vary", result["attribution"])

    def test_actual_output_is_not_discounted_by_yield_again(self):
        result = calculate_manufacturing_cost(floor_request())
        self.assertEqual(exact(result, "output.acceptance_fraction_count"), Fraction(4, 5))
        self.assertEqual(exact(result, "unit_costs.per_usable_unit"), Fraction(537, 160))
        self.assertNotEqual(exact(result, "unit_costs.per_usable_unit"), Fraction(537, 128))

    def test_planning_uses_its_own_gross_output_once(self):
        request = floor_request()
        request["output"] = {"mode": "planned", "acceptance_basis": "planning screen", "gross_count": "21", "accepted_fraction": ".75"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "output.usable_count"), Fraction(63, 4))
        self.assertEqual(exact(result, "unit_costs.per_usable_unit"), Fraction(358, 105))
        self.assertTrue(any("planning" in value for value in result["warnings"]))

    def test_actual_and_planned_denominators_conflict(self):
        for mode in ("actual", "planned"):
            with self.subTest(mode=mode):
                request = floor_request()
                request["output"].update(mode=mode, accepted_fraction=".8")
                result = calculate_manufacturing_cost(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertIsNone(result["unit_costs"]["per_usable_unit"])
                self.assertEqual(exact(result, "costs.entered_scope_total"), Fraction("53.7"))

    def test_zero_output_retains_batch_cost_but_no_unit_cost(self):
        request = floor_request()
        request["output"].update(usable_count="0", usable_mass_kg="0")
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
        self.assertIsNone(result["unit_costs"]["per_usable_unit"])
        self.assertIsNone(result["unit_costs"]["per_usable_kg"])

    def test_unknown_labor_is_a_partial_subtotal_not_zero(self):
        request = floor_request()
        request["process"]["labor"] = {"status": "unknown"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(exact(result, "costs.known_subtotal"), Fraction("35.7"))
        self.assertIsNone(result["costs"]["entered_scope_total"])
        self.assertEqual(exact(result, "unit_costs.per_usable_unit"), Fraction("2.23125"))
        self.assertEqual(result["unit_costs_scope"], "known_subtotal")
        self.assertTrue(any(value["field"] == "labor" for value in result["questions"]))

    def test_blank_and_explicit_zero_are_different(self):
        request = floor_request()
        request["process"]["labor"]["rate"] = ""
        blank = calculate_manufacturing_cost(request)
        self.assertEqual(blank["status"], "partial")
        request["process"]["labor"]["rate"] = "0"
        zero = calculate_manufacturing_cost(request)
        self.assertEqual(zero["status"], "complete")
        self.assertEqual(zero["costs"]["labor"], "0")

    def test_mixed_currencies_cannot_aggregate(self):
        request = floor_request()
        request["materials"][0]["currency"] = "USD"
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["status"], "needs_clarification")
        self.assertIsNone(result["costs"]["known_subtotal"])
        self.assertIsNone(result["unit_costs"]["per_usable_unit"])

    def test_mass_units_and_price_denominators_convert_exactly(self):
        request = floor_request()
        request["materials"] = [{"name": "stock", "quantity": "5000", "quantity_unit": "g", "unit_price": "400", "price_unit": "t"}]
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "costs.materials"), 2)
        self.assertEqual(exact(result, "materials.0.charged_mass_kg"), 5)

    def test_us_mass_quantities_and_cross_price_denominators_are_exact(self):
        cases = (
            ("16", "oz", "2", "lb", Fraction(2)),
            ("1", "lb", "10", "kg", Fraction("4.5359237")),
            ("1000", "g", "1", "oz", Fraction(1600000000, 45359237)),
        )
        for quantity, quantity_unit, price, price_unit, expected in cases:
            with self.subTest(quantity_unit=quantity_unit, price_unit=price_unit):
                request = floor_request()
                request["materials"] = [{"name": "stock", "quantity": quantity, "quantity_unit": quantity_unit, "unit_price": price, "price_unit": price_unit}]
                original = deepcopy(request)
                result = calculate_manufacturing_cost(request)
                self.assertEqual(exact(result, "costs.materials"), expected)
                self.assertEqual(request, original)

    def test_percent_recipe_can_use_explicit_pound_batch_mass(self):
        request = floor_request()
        request["materials"] = [{"name": "A", "quantity": "75", "quantity_unit": "mass_percent", "unit_price": "1", "price_unit": "lb"}, {"name": "B", "quantity": "25", "quantity_unit": "mass_percent", "unit_price": ".25", "price_unit": "oz"}]
        request["batch_mass"] = {"quantity": "8", "unit": "lb", "basis": "dry"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "costs.materials"), 14)
        self.assertEqual(exact(result, "materials.0.charged_mass_kg"), Fraction("2.72155422"))

    def test_volume_fraction_requests_independent_mass_without_density_guess(self):
        request = floor_request()
        request["materials"] = [{"name": "stock", "quantity": "100", "quantity_unit": "volume_percent", "unit_price": "1", "price_unit": "lb"}]
        request["constituent_density"] = "123"
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["costs"]["materials"])
        self.assertIsNone(result["costs"]["entered_scope_total"])
        self.assertIsNone(result["materials"][0]["charged_mass_kg"])
        self.assertTrue(any(item["field"] == "materials.0.charged_mass" for item in result["questions"]))

    def test_percent_recipe_needs_explicit_matching_batch_mass(self):
        request = floor_request()
        request["materials"] = [{"name": "A", "quantity": "75", "quantity_unit": "mass_percent", "unit_price": ".4", "price_unit": "kg"}, {"name": "B", "quantity": "25", "quantity_unit": "mass_percent", "unit_price": ".8", "price_unit": "kg"}]
        missing = calculate_manufacturing_cost(request)
        self.assertIsNone(missing["costs"]["materials"])
        self.assertEqual(missing["status"], "partial")
        request["batch_mass"] = {"quantity": "20", "unit": "kg", "basis": "dry"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "costs.materials"), 10)
        self.assertEqual(exact(result, "materials.0.charged_mass_kg"), 15)

    def test_incomplete_percent_recipe_is_not_normalized(self):
        request = floor_request()
        request["materials"] = [{"name": "A", "quantity": "90", "quantity_unit": "mass_percent", "unit_price": ".4", "price_unit": "kg"}]
        request["batch_mass"] = {"quantity": "20", "unit": "kg", "basis": "dry"}
        result = calculate_manufacturing_cost(request)
        self.assertIsNone(result["costs"]["entered_scope_total"])
        self.assertTrue(any(error["code"] == "recipe_not_complete" for error in result["errors"]))

    def test_price_and_charged_mass_condition_must_match(self):
        request = floor_request()
        request["materials"][0].update(quantity_basis="as_received", price_basis="dry")
        result = calculate_manufacturing_cost(request)
        self.assertIsNone(result["materials"][0]["known_cost"])
        self.assertIsNone(result["costs"]["known_subtotal"])

    def test_counterweight_has_cost_per_kg_without_density_or_count(self):
        request = floor_request()
        request["product_basis"] = "counterweight insert"
        request["materials"] = [{"name": "steel dust", "quantity": "46", "quantity_unit": "kg", "unit_price": ".18", "price_unit": "kg"}, {"name": "cable plastic", "quantity": "4", "quantity_unit": "kg", "unit_price": ".5", "price_unit": "kg"}]
        request["process"]["energy"]["kwh"] = "12"
        request["process"]["labor"]["person_hours"] = ".5"
        request["process"]["other"]["charges"][0]["amount"] = "2.5"
        request["output"] = {"mode": "actual", "acceptance_basis": "declared usable processed stock", "usable_mass_kg": "46"}
        request["target_part_mass_kg"] = "12"
        request["constituent_density"] = "999"
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "costs.entered_scope_total"), Fraction("20.58"))
        self.assertEqual(exact(result, "unit_costs.per_usable_kg"), Fraction(1029, 2300))
        self.assertIsNone(result["unit_costs"]["per_usable_unit"])
        self.assertIsNone(result["output"]["usable_count"])

    def test_sound_sheet_explicit_area_is_not_inferred_from_geometry(self):
        request = floor_request()
        request["materials"] = [{"name": "PET fibre", "quantity": "17", "quantity_unit": "kg", "unit_price": ".6", "price_unit": "kg"}, {"name": "PE film", "quantity": "3", "quantity_unit": "kg", "unit_price": ".4", "price_unit": "kg"}]
        request["process"]["energy"]["kwh"] = "8"
        request["process"]["labor"]["person_hours"] = ".75"
        request["process"]["other"]["charges"][0]["amount"] = "3"
        request["output"] = {"mode": "actual", "acceptance_basis": "shop size screen", "usable_count": "10", "usable_mass_kg": "18", "usable_area_m2": "5"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(exact(result, "costs.entered_scope_total"), Fraction("24.6"))
        self.assertEqual(exact(result, "unit_costs.per_usable_unit"), Fraction("2.46"))
        self.assertEqual(exact(result, "unit_costs.per_usable_kg"), Fraction(41, 30))
        self.assertEqual(exact(result, "unit_costs.per_usable_m2"), Fraction("4.92"))
        del request["output"]["usable_area_m2"]
        request["sheet_area_m2"] = ".5"
        self.assertIsNone(calculate_manufacturing_cost(request)["unit_costs"]["per_usable_m2"])

    def test_bad_output_counts_block_unit_cost_not_valid_batch_cost(self):
        for count in ("21", "1.5", "-1"):
            with self.subTest(count=count):
                request = floor_request()
                request["output"]["usable_count"] = count
                result = calculate_manufacturing_cost(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
                self.assertIsNone(result["unit_costs"]["per_usable_unit"])

    def test_inclusive_charge_cannot_double_count_energy_labor(self):
        request = floor_request()
        request["process"]["other"]["charges"][0]["includes"] = ["energy", "labor"]
        result = calculate_manufacturing_cost(request)
        self.assertIsNone(result["costs"]["entered_scope_total"])
        request["process"]["energy"] = {"status": "excluded"}
        request["process"]["labor"] = {"status": "excluded"}
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["costs"]["entered_scope_total"], "33")

    def test_no_automatic_reject_credit_and_no_negative_price(self):
        request = floor_request()
        request["reject_mass_kg"] = "8"
        request["possible_salvage_credit"] = "100"
        self.assertEqual(calculate_manufacturing_cost(request)["costs"]["entered_scope_total"], "53.7")
        request["materials"][0]["unit_price"] = "-.1"
        result = calculate_manufacturing_cost(request)
        self.assertIsNone(result["costs"]["entered_scope_total"])
        self.assertTrue(any(error["code"] == "negative_not_supported" for error in result["errors"]))

    def test_duplicate_charge_is_not_silently_counted_twice(self):
        request = floor_request()
        request["process"]["other"]["charges"].append(deepcopy(request["process"]["other"]["charges"][0]))
        result = calculate_manufacturing_cost(request)
        self.assertTrue(any(error["code"] == "duplicate_cost_line" for error in result["errors"]))
        self.assertIsNone(result["costs"]["entered_scope_total"])

    def test_only_decimal_strings_are_accepted(self):
        for value in (0.4, 1, True, "NaN", "Infinity", "1e3"):
            with self.subTest(value=value):
                request = floor_request()
                request["materials"][0]["unit_price"] = value
                self.assertIsNone(calculate_manufacturing_cost(request)["costs"]["entered_scope_total"])

    def test_empty_request_does_not_invent_zero_total(self):
        result = calculate_manufacturing_cost({})
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["costs"]["known_subtotal"])
        self.assertTrue(result["questions"])

    def test_explicit_zero_cost_scope_is_valid(self):
        request = floor_request()
        for material in request["materials"]:
            material["unit_price"] = "0"
        request["process"]["energy"]["rate"] = "0"
        request["process"]["labor"]["rate"] = "0"
        request["process"]["other"]["charges"] = []
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["costs"]["entered_scope_total"], "0")
        self.assertEqual(result["unit_costs"]["per_usable_unit"], "0")

    def test_no_cost_winner_for_incompatible_scopes_or_outputs(self):
        mutations = (
            ("currency", "EUR"), ("product_basis", "sound sheet"),
            ("functional_basis", "different-size mat"), ("scope_basis", "materials only"),
            ("case_id", "other case"), ("current_configuration_revision", "2"),
            ("configuration_id", ""),
        )
        for key, value in mutations:
            with self.subTest(field=key):
                b = floor_request("B")
                b[key] = value
                result = compare_manufacturing_costs([floor_request(), b])
                self.assertFalse(result["comparable"])
                self.assertIsNone(result["winners"]["per_usable_unit"])

    def test_no_winner_for_partial_cost_or_different_acceptance(self):
        for mutation in ("partial", "acceptance", "mode", "categories"):
            with self.subTest(mutation=mutation):
                b = floor_request("B")
                if mutation == "partial":
                    b["process"]["labor"] = {"status": "unknown"}
                elif mutation == "acceptance":
                    b["output"]["acceptance_basis"] = "all product tests"
                elif mutation == "mode":
                    b["output"] = {"mode": "planned", "acceptance_basis": floor_request()["output"]["acceptance_basis"], "gross_count": "20", "accepted_fraction": ".7"}
                else:
                    b["process"]["labor"] = {"status": "excluded"}
                result = compare_manufacturing_costs([floor_request(), b])
                self.assertFalse(result["comparable"])

    def test_exact_tie_and_close_costs_are_not_rounded_into_winners(self):
        a, b = floor_request(), floor_request()
        b["configuration_id"] = "B"
        tied = compare_manufacturing_costs([a, b])
        self.assertTrue(tied["winners"]["per_usable_unit"]["tie"])
        b["materials"][0]["unit_price"] = ".400000000000000000000000000000000000000000000000001"
        result = compare_manufacturing_costs([a, b])
        self.assertFalse(result["winners"]["per_usable_unit"]["tie"])
        self.assertEqual(result["winners"]["per_usable_unit"]["configuration_ids"], ["A"])

    def test_historical_record_stays_visible_without_current_winner(self):
        request = floor_request()
        request["current_configuration_revision"] = "2"
        result = calculate_manufacturing_cost(request)
        self.assertFalse(result["is_current"])
        self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
        self.assertEqual(request["configuration_revision"], "1")

    def test_missing_acceptance_does_not_qualify_unit_cost(self):
        request = floor_request()
        del request["output"]["acceptance_basis"]
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
        self.assertIsNone(result["unit_costs"]["per_usable_unit"])

    def test_unknown_output_does_not_prevent_batch_cost(self):
        request = floor_request()
        request.pop("output")
        result = calculate_manufacturing_cost(request)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["costs"]["entered_scope_total"], "53.7")
        self.assertTrue(any(item["category"] == "output" for item in result["questions"]))

    def test_invalid_top_level_values_are_structured_errors(self):
        self.assertEqual(calculate_manufacturing_cost(None)["status"], "needs_clarification")
        self.assertFalse(compare_manufacturing_costs({})["comparable"])

    def test_malformed_nested_units_and_identities_do_not_raise(self):
        for key, value in (("quantity_unit", []), ("price_unit", {}), ("id", ["bad"]), ("name", {"bad": "label"})):
            with self.subTest(field=key):
                request = floor_request()
                request["materials"][0][key] = value
                result = calculate_manufacturing_cost(request)
                self.assertEqual(result["status"], "needs_clarification")
                self.assertIsNone(result["costs"]["entered_scope_total"])
        a, b = floor_request(), floor_request("B")
        b["case_id"] = ["bad identity"]
        self.assertFalse(compare_manufacturing_costs([a, b])["comparable"])

    def test_duplicate_configuration_identity_cannot_name_a_winner(self):
        result = compare_manufacturing_costs([floor_request(), floor_request()])
        self.assertFalse(result["comparable"])
        self.assertIsNone(result["winners"]["per_usable_unit"])


if __name__ == "__main__":
    unittest.main()
