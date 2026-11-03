"""Cross-panel decisions must bind costs and checks to the same complete setup."""
from copy import deepcopy
import unittest

from reshivo.decision_comparison import compare_project_decisions
from reshivo.products import ProductInputError
from reshivo.advisor import help_with_case, follow_up_with_case, DECISION_ASSESSMENT_PROMPT, TRIAL_IDEA_PROMPT, SPECIFIC_ADVICE_PROMPT
from test_advisor_project_context import FixtureClient, request as advisor_request, cost_requests


def sample():
    configs = [{"id": key, "revision": 1, "name": "Setup " + key,
                "materials": [{"id": "stock", "name": "stock", "amount": "1", "unit": "kg"}],
                "process": "Recorded process", "geometry": "Recorded geometry", "notes": ""}
               for key in ("A", "B")]
    checks = [{"id": "grip", "name": "Grip", "unit": "points", "method": "Method 1",
               "minimum": "5", "maximum": None, "required": True}]
    records = [{"id": key + "-grip", "case_id": "case", "configuration_id": key,
                "configuration_revision": 1, "check_id": "grip", "unit": "points", "method": "Method 1",
                "data_kind": "synthetic", "conditions_confirmed": True,
                "readings": [{"value": value, "reading_id": key + "-1", "specimen_id": "S1", "batch_id": None}]}
               for key, value in (("A", "6"), ("B", "4"))]
    costs = [{"case_id": "case", "configuration_id": key, "configuration_revision": "1",
              "current_configuration_revision": "1", "currency": "CU", "product_basis": "same mat",
              "functional_basis": "same dimensions and use", "scope_basis": "material only", "mass_basis": "dry",
              "materials": [{"id": "stock", "name": "stock", "quantity": "1", "quantity_unit": "kg",
                             "unit_price": price, "price_unit": "kg"}],
              "process": {k: {"status": "excluded"} for k in ("energy", "labor", "other")},
              "output": {"mode": "actual", "acceptance_basis": "user count", "usable_count": "1"}}
             for key, price in (("A", "2"), ("B", "1"))]
    return {"case_id": "case", "configurations": configs, "checks": checks, "records": records,
            "assessment_kind": "synthetic", "cost_records": costs}


class DecisionComparisonTests(unittest.TestCase):
    def test_invalid_current_percentage_is_reported_before_selecting_a_winner(self):
        request = sample()
        request["configurations"][0]["materials"][0].update(amount="150", unit="mass_percent")
        with self.assertRaisesRegex(ProductInputError, r"percentage cannot be more than 100%"):
            compare_project_decisions(request)

    def test_cheaper_outside_target_is_not_recommended(self):
        result = compare_project_decisions(sample())
        self.assertEqual(result["decisions"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertEqual(result["decisions"]["per_usable_unit"]["cost"], "2")
        self.assertEqual(result["configurations"][1]["state"], "out_of_range")
        self.assertNotIn("winners", result["cost_comparison"])
        self.assertFalse(result["performance_verified"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["future_consistency_predicted"])

    def test_missing_check_anywhere_prevents_winner_even_when_other_check_fails(self):
        request = sample()
        request["checks"].append({"id": "recovery", "name": "Recovery", "unit": "%", "method": "Method 2", "minimum": "80", "maximum": None, "required": True})
        self.assertIsNone(compare_project_decisions(request)["decisions"]["per_usable_unit"])

    def test_outside_check_with_an_unconfirmed_extra_record_still_blocks_selection(self):
        request = sample()
        extra = deepcopy(request["records"][1]); extra["id"] = "B-unconfirmed"; extra["conditions_confirmed"] = False
        request["records"].append(extra)
        result = compare_project_decisions(request)
        self.assertEqual(result["configurations"][1]["checks"][0]["state"], "out_of_range")
        self.assertTrue(result["configurations"][1]["checks"][0]["needs_review"])
        self.assertIsNone(result["decisions"]["per_usable_unit"])

    def test_optional_failure_is_visible_and_does_not_block_required_result(self):
        request = sample()
        request["checks"].append({"id": "optional", "name": "Optional", "unit": "%", "method": "Method 2", "minimum": "80", "maximum": None, "required": False})
        record = deepcopy(request["records"][0]); record.update(id="A-optional", check_id="optional", unit="%", method="Method 2")
        record["readings"][0]["value"] = "70"; request["records"].append(record)
        result = compare_project_decisions(request)
        self.assertEqual(result["decisions"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertEqual(result["configurations"][0]["checks"][1]["state"], "out_of_range")

    def test_synthetic_never_completes_user_reported(self):
        request = sample(); request["assessment_kind"] = "user_reported"
        result = compare_project_decisions(request)
        self.assertIsNone(result["decisions"]["per_usable_unit"])
        self.assertTrue(all(row["reason"] == "other_data_kind" for row in result["ignored_records"]))

    def test_new_version_cannot_reuse_old_readings_or_cost(self):
        request = sample(); newer = deepcopy(request["configurations"][0]); newer["revision"] = 2; request["configurations"].append(newer)
        with self.assertRaises(ProductInputError): compare_project_decisions(request)
        request["cost_records"][0].update(configuration_revision="2", current_configuration_revision="2")
        result = compare_project_decisions(request)
        self.assertIsNone(result["decisions"]["per_usable_unit"])
        self.assertTrue(any(row["reason"] == "stale_configuration_revision" for row in result["ignored_records"]))

    def test_exact_tie_among_eligible_setups(self):
        request = sample(); request["records"][1]["readings"][0]["value"] = "5"; request["cost_records"][1]["materials"][0]["unit_price"] = "2"
        result = compare_project_decisions(request)["decisions"]["per_usable_unit"]
        self.assertEqual(result["configuration_ids"], ["A", "B"]); self.assertTrue(result["tie"])
        self.assertEqual(result["exact_cost"], {"numerator": "2", "denominator": "1"})

    def test_close_costs_use_exact_rationals_even_if_displayed_values_match(self):
        request = sample(); request["records"][1]["readings"][0]["value"] = "5"
        request["cost_records"][0]["materials"][0]["unit_price"] = "2.0000000000000000000000000000000000000001"
        request["cost_records"][1]["materials"][0]["unit_price"] = "2.0000000000000000000000000000000000000002"
        result = compare_project_decisions(request)
        self.assertEqual(result["configurations"][0]["cost"]["unit_costs"]["per_usable_unit"], result["configurations"][1]["cost"]["unit_costs"]["per_usable_unit"])
        self.assertEqual(result["decisions"]["per_usable_unit"]["configuration_ids"], ["A"])
        self.assertFalse(result["decisions"]["per_usable_unit"]["tie"])

    def test_no_required_check_or_no_passing_setup_never_selects(self):
        request = sample(); request["checks"][0]["required"] = False
        self.assertIsNone(compare_project_decisions(request)["decisions"]["per_usable_unit"])
        request = sample(); request["records"][0]["readings"][0]["value"] = "4"
        self.assertIsNone(compare_project_decisions(request)["decisions"]["per_usable_unit"])

    def test_no_winner_for_incomparable_cost_or_unknown_output(self):
        request = sample(); request["cost_records"][1]["currency"] = "USD"
        self.assertIsNone(compare_project_decisions(request)["decisions"]["per_usable_unit"])
        request = sample(); request["cost_records"][1]["output"]["usable_count"] = "0"
        self.assertIsNone(compare_project_decisions(request)["decisions"]["per_usable_unit"])

    def test_different_other_cost_categories_block_target_qualified_winner(self):
        request = sample()
        request["records"][1]["readings"][0]["value"] = "5"
        for cost, category in zip(request["cost_records"], ("Rent", "Transport")):
            cost["process"]["other"] = {"status": "known", "charges": [{"name": category, "amount": "1"}]}
        result = compare_project_decisions(request)
        self.assertIsNone(result["decisions"]["per_usable_unit"])
        self.assertIn("Use the same named other-cost categories in each setup before comparing.", result["reasons"])

    def test_changed_recipe_or_foreign_case_cannot_bind_to_cost(self):
        request = sample(); request["cost_records"][0]["materials"][0]["quantity"] = "2"
        with self.assertRaises(ProductInputError): compare_project_decisions(request)
        request = sample(); request["cost_records"][0]["case_id"] = "another-case"
        with self.assertRaises(ProductInputError): compare_project_decisions(request)

    def test_raw_grouping_retained_without_inferred_batches(self):
        result = compare_project_decisions(sample())
        readings = result["configurations"][0]["checks"][0]["records"][0]["readings"]
        self.assertEqual(readings[0]["specimen_id"], "S1")
        self.assertIsNone(readings[0]["batch_id"])
        self.assertNotIn("batch_count", result["configurations"][0])

    def test_missing_cost_record_blocks_comparison(self):
        request = sample(); request["cost_records"].pop()
        result = compare_project_decisions(request)
        self.assertIsNone(result["decisions"]["per_usable_unit"])
        self.assertTrue(any("every setup" in reason for reason in result["reasons"]))

    def test_cannot_supply_forged_precomputed_result(self):
        request = sample(); request["assessment"] = {"state": "all_entered_checks_in_range"}
        with self.assertRaises(ProductInputError): compare_project_decisions(request)

    def test_both_advisors_receive_eligible_decision_not_cheapest_failing_setup(self):
        data = advisor_request()
        data["manufacturing_costs"] = cost_requests()
        # The more expensive AB clears both checks; cheaper ABC still misses recovery.
        next(record for record in data["project_context"]["records"] if record["id"] == "AB-sound")["readings"][0]["value"] = "11"
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(data, client=client)
            prompt = client.calls[0][0]
            with self.subTest(function=function.__name__):
                self.assertEqual(prompt["decision_assessment"]["decisions"]["per_usable_unit"]["configuration_ids"], ["AB"])
                self.assertEqual(result["decision_assessment"]["decisions"]["per_usable_unit"]["configuration_ids"], ["AB"])
                self.assertEqual(result["manufacturing_cost_assessment"]["winners"]["per_usable_unit"]["configuration_ids"], ["ABC"])
                self.assertNotIn("winners", prompt["manufacturing_cost_assessment"])
                self.assertNotIn("111.123456789", str(prompt))
                self.assertNotIn("777.987654321", str(prompt))
                self.assertIn(DECISION_ASSESSMENT_PROMPT, client.calls[0][3]["system_prompt"])
                self.assertTrue(client.calls[0][3]["system_prompt"].endswith(SPECIFIC_ADVICE_PROMPT))

    def test_missing_check_blocks_advisors_from_getting_a_winner(self):
        data = advisor_request()
        data["manufacturing_costs"] = cost_requests()
        data["project_context"]["records"] = [row for row in data["project_context"]["records"] if row["id"] != "AB-sound"]
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(data, client=client)
            with self.subTest(function=function.__name__):
                self.assertIsNone(result["decision_assessment"]["decisions"]["per_usable_unit"])
                self.assertIsNone(client.calls[0][0]["decision_assessment"]["decisions"]["per_usable_unit"])
                self.assertNotIn("winners", client.calls[0][0]["manufacturing_cost_assessment"])

    def test_advisor_without_costs_keeps_previous_response_contract(self):
        result = help_with_case(advisor_request(), client=FixtureClient())
        self.assertNotIn("decision_assessment", result)

    def test_current_proposal_stays_unverified_and_excludes_local_note_id(self):
        data = advisor_request(); data["manufacturing_costs"] = cost_requests()
        data["trial_ideas"] = {"AB@2": {"title": "Try a known binder", "change": "Consider an identified binder", "why": "May hold pieces together", "steps": ["Identify a suitable binder"], "tradeoffs": ["Needs a separate check"], "check": "Check holding together", "provider": "meta", "model": "example", "note_id": "local-private-note-id"}}
        for function, followup in ((help_with_case, False), (follow_up_with_case, True)):
            client = FixtureClient(followup)
            result = function(data, client=client)
            prompt = client.calls[0][0]
            with self.subTest(function=function.__name__):
                self.assertEqual(prompt["trial_ideas"]["AB@2"]["change"], "Consider an identified binder")
                self.assertNotIn("note_id", prompt["trial_ideas"]["AB@2"])
                self.assertNotIn("local-private-note-id", str(prompt))
                self.assertEqual(result["trial_ideas"], prompt["trial_ideas"])
                self.assertIn(TRIAL_IDEA_PROMPT, client.calls[0][3]["system_prompt"])
                self.assertTrue(client.calls[0][3]["system_prompt"].endswith(SPECIFIC_ADVICE_PROMPT))
                self.assertEqual(prompt["project_context"]["configurations"][-1]["materials"][0]["name"], "stock A")

    def test_trial_ideas_reject_old_version_unbound_context_and_extra_secret_field(self):
        idea = {"title": "Idea", "change": "Change", "why": "Why", "steps": ["Step"], "tradeoffs": ["Tradeoff"], "check": "Check", "provider": "meta", "model": "example"}
        for bad in ({"AB@1": idea}, {"unknown@2": idea}, {"AB@2": {**idea, "api_key": "not-a-real-key"}}, {"AB@2": {**idea, "steps": []}}, {"AB@2": {**idea, "change": "x" * 1501}}):
            data = advisor_request(); data["trial_ideas"] = bad
            client = FixtureClient()
            with self.subTest(bad=bad), self.assertRaises(ProductInputError):
                help_with_case(data, client=client)
            self.assertEqual(client.calls, [])
        data = advisor_request(); del data["project_context"]; data["trial_ideas"] = {}
        with self.assertRaises(ProductInputError): help_with_case(data, client=FixtureClient())


if __name__ == "__main__":
    unittest.main()
