from copy import deepcopy
import json
import unittest

from reshivo.advisor import follow_up_with_case, validate_request
from reshivo.products import ProductInputError
from test_advisor_project_context import FixtureClient, request


def prepared():
    data = request()
    data["question"] = "Help me interpret the recorded recipe and mix calculation."
    data["mix_calculation"] = {
        "case_id": "case-sound", "configuration_id": "AB", "configuration_revision": 2,
        "component_id": "A", "inputs": {
            "component": "stock A", "input_mass_kg": 1,
            "input_min_percent": 25, "input_max_percent": 25,
            "addition_name": "zero-A stock", "addition_percent": 0,
            "target_min_percent": 20, "target_max_percent": 20,
        },
        "source": {"configuration_id": "AB", "configuration_revision": 1,
                   "component_id": "A", "latest_revision_at_review": 2, "basis": "whole_recipe"},
    }
    return data


class MixCalculationContextTests(unittest.TestCase):
    def test_historical_source_is_bound_without_old_readings_or_notes(self):
        data = prepared()
        data["project_context"]["configurations"][0]["notes"] = "old private idea is not source context"
        client = FixtureClient(followup=True)
        follow_up_with_case(data, client=client)
        prompt = client.calls[0][0]
        self.assertEqual([(s["id"], s["revision"]) for s in prompt["project_context"]["configurations"]], [("ABC", 1), ("AB", 2)])
        mix = prompt["mix_calculation"]
        self.assertEqual(mix["destination"], {"id": "AB", "revision": 2, "component_id": "A", "component_name": "stock A"})
        source = mix["source_recipe"]
        self.assertEqual((source["id"], source["revision"], source["component_id"]), ("AB", 1, "A"))
        self.assertEqual(source["fraction"], {"numerator": "1", "denominator": "5"})
        self.assertEqual(source["process"], "Recorded process P1")
        self.assertFalse(source["readings_included"])
        self.assertNotIn("notes", source)
        self.assertNotIn("111.123456789", json.dumps(prompt))
        self.assertTrue(mix["result"]["feasible"])
        self.assertIn("earlier version", client.calls[0][3]["system_prompt"])

    def test_wide_target_attaches_one_fixed_solution_for_both_input_endpoints(self):
        data = prepared()
        data["mix_calculation"]["source"] = None
        data["mix_calculation"]["inputs"].update(
            input_mass_kg=1.5, input_min_percent=28, input_max_percent=32,
            addition_percent=5, target_min_percent=18, target_max_percent=22,
        )
        client = FixtureClient(followup=True)
        follow_up_with_case(data, client=client)
        result = client.calls[0][0]["mix_calculation"]["result"]
        self.assertTrue(result["feasible"])
        self.assertLessEqual(result["resulting_min_percent"], result["resulting_max_percent"])
        self.assertGreaterEqual(result["resulting_min_percent"], 18)
        self.assertLessEqual(result["resulting_max_percent"], 22)
        self.assertIn("BOTH endpoints", client.calls[0][3]["system_prompt"])

    def test_duplicate_names_use_source_id_and_version(self):
        data = prepared()
        for setup in data["project_context"]["configurations"]:
            setup["name"] = "Same name"
        data["mix_calculation"]["source"].update(configuration_id="ABC", configuration_revision=1, latest_revision_at_review=1)
        bound = validate_request(data)["mix_calculation"]
        self.assertEqual((bound["source_recipe"]["id"], bound["source_recipe"]["revision"]), ("ABC", 1))
        self.assertEqual(len(bound["source_recipe"]["materials"]), 3)

    def test_stale_or_mismatched_bindings_are_rejected(self):
        mutations = [
            lambda x: x["mix_calculation"].update(case_id="other"),
            lambda x: x["mix_calculation"].update(configuration_revision=1),
            lambda x: x["mix_calculation"].update(component_id="missing"),
            lambda x: x["mix_calculation"]["inputs"].update(component="stock B"),
            lambda x: x["mix_calculation"]["inputs"].update(target_min_percent=19, target_max_percent=19),
            lambda x: x["mix_calculation"]["source"].update(latest_revision_at_review=1),
            lambda x: x["mix_calculation"]["source"].update(component_id="missing"),
            lambda x: x["mix_calculation"]["source"].update(basis="feed_only"),
            lambda x: x["project_context"]["configurations"][0]["materials"][0].update(amount="unknown"),
            lambda x: x.pop("project_context"),
        ]
        for mutate in mutations:
            data = prepared(); mutate(data)
            with self.subTest(data=data), self.assertRaises(ProductInputError): validate_request(data)

    def test_manual_calculation_has_no_invented_source(self):
        data = prepared(); data["mix_calculation"]["source"] = None
        self.assertNotIn("source_recipe", validate_request(data)["mix_calculation"])
        without = deepcopy(data); without.pop("mix_calculation")
        self.assertNotIn("mix_calculation", validate_request(without))


if __name__ == "__main__":
    unittest.main()
