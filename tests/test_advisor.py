from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from rematter.advisor import SOURCE_REGISTRY, SYSTEM_PROMPT, TRIAL_PROMPT, advisor_status, balance_mix, help_with_case, mass_trim, plan_trial, validate_request, validate_trial_request
from rematter.meta import Generation, MetaAPIError, MetaClient, MetaConfigurationError, MetaValidationError
from rematter.products import ProductInputError
from rematter.server import build_server
from rematter.service import WorkbenchService


def brief_request():
    return {
        "brief": {
            "input": "Identified copper metal dust and known cable-plastic residue",
            "variation": "Plastic fraction changes between received lots",
            "contamination": "Binder identity and moisture unknown",
            "product": "Counterweight",
            "use_case": "A stationary enclosed base, with retained fill",
            "targets": "10 kg within 0.1 kg; fill must remain retained",
            "process": "I have access to a suitable industrial facility.",
            "available_changes": "Can change enclosure and use replaceable fill pockets",
        },
        "question": "How can I use this batch without guessing its density?",
        "history": [],
    }


def route(identity):
    return {
        "id": identity, "title": "A candidate fixture route", "change": "Use an adjustable enclosed fill pocket.",
        "why": "Final weighing can control mass without guessing mixture density.",
        "steps": ["Record the empty assembly mass.", "Fill using suitable existing handling controls and reweigh."],
        "tradeoffs": ["The enclosure must separately retain the material."],
        "check": "Check the final mass and fill retention before using the product.",
    }


def response_data():
    return {
        "answer": "Use a contained adjustable architecture while identifying the binder.",
        "material_routes": [route("material-1"), route("material-2")],
        "engineering_routes": [route("engineering-1"), route("engineering-2")],
        "next_steps": ["Identify the received material.", "Check one contained candidate assembly."],
        "questions": ["What metal and cable polymers are present?"],
        "source_ids": ["nist-weighing-tare"],
    }


def trial_request():
    return {"brief": brief_request()["brief"], "route": route("engineering:adjustable-fill")}


def calculation_context():
    return {
        "label": " Shared case ",
        "components": [{"id": 1, "name": " Named material ", "role": "main", "amount": " 95 "},
                       {"id": 2, "name": "", "role": "binder", "amount": ""}],
        "amount_unit": "mass_percent", "amount_basis": " As received ",
        "mass_target_min_kg": " 9.9 ", "mass_target_max_kg": "10.1",
    }


def trial_data():
    return {
        "title": "Adjustable contained counterweight",
        "objective": "Compare one adjustable assembled counterweight without guessing mix density.",
        "comparison": "Use the same enclosure and material portion; vary only the retained adjustable fill mass.",
        "change": "Adjust the weighed retained fill.",
        "keep_fixed": ["Same enclosure and closure.", "Same identified material and handling controls."],
        "materials": ["Suitable enclosure with an adjustable retained compartment.", "Scale suitable for the stated target tolerance."],
        "steps": [{"action": "Confirm material identity and suitable existing handling controls before filling.",
                   "record": "Material identity and the handling method available."},
                  {"action": "Weigh the complete candidate assembly, adjust retained fill, and reweigh.",
                   "record": "Each assembly mass, the adjustment and scale capability."}],
        "checks": [{"property": "Mass", "target": "10 kg within 0.1 kg",
                    "method": "Weigh the complete assembly with suitable measurement uncertainty.",
                    "if_outside": "Adjust retained fill using the weight-adjustment tool and reweigh."},
                   {"property": "Fill retention", "target": "fill must remain retained",
                    "method": "Propose a check for the stated stationary installation; mass alone does not establish retention.",
                    "if_outside": "Revise the closure or retained compartment before evaluating again."}],
        "questions": ["Which metal and polymers are present?"],
        "source_ids": ["nist-weighing-tare"],
    }


def balance_request(**changes):
    return {
        "component": "Named metal component", "input_mass_kg": 10,
        "input_min_percent": 80, "input_max_percent": 85,
        "addition_name": "Characterized metal stock", "addition_percent": 100,
        "target_min_percent": 90, "target_max_percent": 95, **changes,
    }


UNSET = object()


class FixtureClient:
    def __init__(self, data=UNSET):
        self.data = response_data() if data is UNSET else data
        self.calls = []

    def generate(self, prompt, schema, max_candidates, **kwargs):
        self.calls.append((json.loads(prompt), schema, max_candidates, kwargs))
        return Generation(self.data, "muse-spark-1.3", False, {"total_tokens": 5}, "fixture", 1)


class SharedCalculationContextTests(unittest.TestCase):
    def test_shared_details_reach_both_prompts_and_results_without_becoming_measurements(self):
        for factory, operation, generated in ((brief_request, help_with_case, response_data()),
                                              (trial_request, plan_trial, trial_data())):
            request = factory()
            request["calculation_context"] = calculation_context()
            original = deepcopy(request)
            client = FixtureClient(generated)
            result = operation(request, client)
            expected = calculation_context()
            expected.update(label="Shared case", amount_basis="As received", mass_target_min_kg="9.9")
            expected["components"][0].update(name="Named material", amount="95")
            self.assertEqual(request, original)
            self.assertEqual(client.calls[0][0]["calculation_context"], expected)
            self.assertEqual(result["calculation_context"], expected)
            self.assertEqual(result["calculation_context"]["components"][1]["name"], "")
            self.assertEqual(result["calculation_context"]["components"][1]["amount"], "")
            self.assertFalse(result["performance_verified"])
            self.assertFalse(result["physical_product_tested"])

    def test_incomplete_quantities_remain_text_and_do_not_relax_original_trial_targets(self):
        request = trial_request()
        request["calculation_context"] = calculation_context()
        request["calculation_context"]["components"][0]["amount"] = "not measured"
        request["calculation_context"]["mass_target_min_kg"] = ""
        request["calculation_context"]["mass_target_max_kg"] = ""
        result = plan_trial(request, FixtureClient(trial_data()))
        self.assertEqual(result["calculation_context"]["components"][0]["amount"], "not measured")
        self.assertEqual(result["calculation_context"]["mass_target_min_kg"], "")
        self.assertEqual(result["targets"], request["brief"]["targets"])
        request["calculation_context"].update(mass_target_min_kg="9.9", mass_target_max_kg="10.1")
        data = trial_data()
        data["checks"][0]["target"] = "9.9–10.1 kg"
        with self.assertRaises(MetaValidationError):
            plan_trial(request, FixtureClient(data))

    def test_invalid_context_is_rejected_before_either_model_request(self):
        cases = [None, {}, [], {**calculation_context(), "density": 4.2},
                 {**calculation_context(), "components": []},
                 {**calculation_context(), "components": calculation_context()["components"] * 11},
                 {**calculation_context(), "amount_unit": "unknown"}]
        for field, limit in (("label", 120), ("amount_basis", 300),
                             ("mass_target_min_kg", 80), ("mass_target_max_kg", 80)):
            cases.extend(({**calculation_context(), field: "x" * (limit + 1)},
                          {**calculation_context(), field: 0}))
        for changes in ({"id": True}, {"id": 0}, {"id": -1}, {"id": 1.5}, {"id": "1"},
                        {"role": "density"}, {"amount": 95}, {"amount": "x" * 81},
                        {"name": "x" * 121}, {"density": 1}):
            value = calculation_context()
            value["components"][0].update(changes)
            cases.append(value)
        value = calculation_context()
        value["components"][1]["id"] = 1
        cases.append(value)
        value = calculation_context()
        del value["components"][0]["name"]
        cases.append(value)
        value = calculation_context()
        del value["amount_basis"]
        cases.append(value)
        for value in cases:
            for factory, operation in ((brief_request, help_with_case), (trial_request, plan_trial)):
                client = FixtureClient()
                request = {**factory(), "calculation_context": value}
                with self.subTest(context=value, operation=operation.__name__), self.assertRaises(ProductInputError):
                    operation(request, client)
                self.assertEqual(client.calls, [])

    def test_context_boundaries_preserve_values_without_a_complete_recipe_claim(self):
        context = {
            "label": "x" * 120,
            "components": [{"id": index + 1, "name": "x" * 120, "role": "other", "amount": "x" * 80}
                           for index in range(20)],
            "amount_unit": "volume_percent", "amount_basis": "x" * 300,
            "mass_target_min_kg": "x" * 80, "mass_target_max_kg": "x" * 80,
        }
        self.assertEqual(validate_request({**brief_request(), "calculation_context": context})["calculation_context"], context)
        self.assertEqual(validate_trial_request({**trial_request(), "calculation_context": context})["calculation_context"], context)
        for factory, operation, data in ((brief_request, help_with_case, response_data()),
                                          (trial_request, plan_trial, trial_data())):
            self.assertNotIn("calculation_context", operation(factory(), FixtureClient(data)))


class TrialTests(unittest.TestCase):
    def test_plan_is_bound_to_selected_route_and_unchanged_targets(self):
        request = trial_request()
        original = deepcopy(request)
        client = FixtureClient(trial_data())
        result = plan_trial(request, client)
        self.assertEqual(request, original)
        self.assertEqual(result["result_kind"], "trial_proposal")
        self.assertEqual(result["route_id"], request["route"]["id"])
        self.assertEqual(result["selected_route"], request["route"])
        self.assertEqual(result["brief"], request["brief"])
        self.assertEqual(result["targets"], request["brief"]["targets"])
        self.assertFalse(result["live"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["performance_verified"])
        self.assertEqual(result["sources"], [SOURCE_REGISTRY["nist-weighing-tare"]])
        self.assertNotIn("material_routes", result)
        self.assertNotIn("engineering_routes", result)
        sent, schema, count, options = client.calls[0]
        self.assertEqual(sent["route"], request["route"])
        self.assertEqual(sent["brief"], request["brief"])
        self.assertEqual(options["system_prompt"], TRIAL_PROMPT)
        self.assertEqual(options["schema_name"], "selected_route_trial")
        self.assertEqual(options["max_completion_tokens"], 8192)
        self.assertEqual(options["reasoning_effort"], "medium")
        self.assertEqual(result["requested_reasoning_effort"], "medium")
        self.assertEqual(count, 1)
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["steps"]["minItems"], 2)

    def test_generic_property_can_need_a_specialist_check_without_mass_inputs(self):
        request = trial_request()
        request["brief"].update(input="PET felt offcuts", variation="Thickness changes", contamination="Paper labels",
                                product="Sound-absorbing wall panel", use_case="Speech reflections; fixed wall mounting",
                                targets="Absorption over 1000–4000 Hz; total thickness below 30 mm",
                                process="Sewing and clamps at home", available_changes="Layering and mounting")
        request["route"] = route("material:layered-pet")
        data = trial_data()
        data["checks"] = [{"property": "Absorption", "target": "Absorption over 1000–4000 Hz",
                           "method": "Keep mounting fixed for a local comparison. A matching acoustic test is still needed for an absorption result.",
                           "if_outside": "Compare layering with the same frame; do not infer an absorption coefficient."},
                          {"property": "Durability", "target": "Not set", "method": "Define the required handling exposure first.",
                           "if_outside": "Choose the intended exposure before specifying a durability check."}]
        data["source_ids"] = []
        client = FixtureClient(data)
        result = plan_trial(request, client)
        self.assertEqual(result["brief"]["process"], "Sewing and clamps at home")
        self.assertEqual(result["checks"], data["checks"])
        self.assertEqual(result["sources"], [])
        self.assertNotIn("density", client.calls[0][0]["brief"])

    def test_targets_cannot_be_invented_or_silently_converted(self):
        for target in ("9.9–10.1 kg", "10 kg within 0.01 kg", "Retention proved", "As in the brief"):
            data = trial_data()
            data["checks"][0]["target"] = target
            with self.subTest(target=target), self.assertRaises(MetaValidationError):
                plan_trial(trial_request(), FixtureClient(data))

    def test_invalid_trial_requests_fail_before_generation(self):
        cases = [None, [], {}, {"brief": trial_request()["brief"]}, {**trial_request(), "history": []},
                 {**trial_request(), "route": []}]
        for identity in ("raw-route", "material:", "engineering: ", "unknown:route", "material:" + "x" * 81):
            request = trial_request()
            request["route"]["id"] = identity
            cases.append(request)
        for field, value in (("title", "x" * 121), ("change", "x" * 1501), ("why", ""),
                             ("check", None), ("steps", []), ("steps", ["x"] * 6),
                             ("steps", ["x" * 901]), ("tradeoffs", ["x"] * 4)):
            request = trial_request()
            request["route"][field] = value
            cases.append(request)
        request = trial_request()
        request["route"]["performance_verified"] = True
        cases.append(request)
        request = trial_request()
        del request["route"]["check"]
        cases.append(request)
        request = trial_request()
        request["brief"]["targets"] = ""
        cases.append(request)
        request = trial_request()
        request["brief"]["input"] = "x" * 3001
        cases.append(request)
        for request in cases:
            client = FixtureClient(trial_data())
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                plan_trial(request, client)
            self.assertEqual(client.calls, [])

    def test_valid_request_limits_and_whitespace_are_normalized(self):
        request = trial_request()
        request["route"].update(id=" engineering:" + "x" * 80 + " ", title="x" * 120,
                                change="x" * 1500, why="x" * 1500, check="x" * 1500,
                                steps=["x" * 900] * 5, tradeoffs=["x" * 900] * 3)
        with self.assertRaises(ProductInputError):
            validate_trial_request(request)
        request["route"]["id"] = "engineering:" + "x" * 80
        request["brief"]["input"] = "x" * 3000
        request["brief"]["product"] = " Counterweight "
        self.assertEqual(validate_trial_request(request)["brief"]["product"], "Counterweight")
        self.assertEqual(validate_trial_request(request)["route"]["steps"], request["route"]["steps"])

    def test_malformed_trial_output_has_no_fabricated_fallback(self):
        cases = [None, {**trial_data(), "performance_verified": True},
                 {**trial_data(), "source_ids": ["invented-paper"]},
                 {**trial_data(), "source_ids": ["nist-weighing-tare"] * 2}]
        for field, value in (("title", "x" * 121), ("objective", ""), ("comparison", "x" * 1501),
                             ("change", 1), ("keep_fixed", []), ("materials", ["x"] * 7),
                             ("steps", []), ("steps", [{"action": "Only action"}] * 2),
                             ("checks", []), ("checks", [{"property": "Mass"}]),
                             ("questions", ["x"] * 4)):
            data = trial_data()
            data[field] = value
            cases.append(data)
        data = trial_data()
        data["steps"][0]["verified"] = True
        cases.append(data)
        data = trial_data()
        data["checks"][0]["if_outside"] = "x" * 1501
        cases.append(data)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(MetaValidationError):
                plan_trial(trial_request(), FixtureClient(data))

    def test_trial_transport_uses_its_own_schema_and_keeps_credentials_out_of_plan(self):
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Transport:
            def open(self, request, timeout):
                self.request = request
                return Reply(json.dumps({"choices": [{"message": {"content": json.dumps(trial_data())}}]}).encode())
        transport = Transport()
        with tempfile.TemporaryDirectory() as folder:
            result = plan_trial(trial_request(), MetaClient(Path(folder), {"MODEL_API_KEY": "fixture-private-key"}, transport))
        body = json.loads(transport.request.data)
        self.assertEqual(body["messages"][0]["content"], TRIAL_PROMPT)
        sent_rules = body["messages"][0]["content"]
        self.assertIn("existing suitable presealed cartridges", sent_rules)
        self.assertIn("await identified material and a suitable controlled facility in that step itself", sent_rules)
        self.assertIn("Minimal open time, prompt closing or a generic mask is not an adequate handling control", sent_rules)
        self.assertEqual(body["response_format"]["json_schema"]["name"], "selected_route_trial")
        self.assertEqual(body["reasoning_effort"], "medium")
        self.assertEqual(body["max_completion_tokens"], 8192)
        self.assertTrue(result["live"])
        self.assertNotIn("fixture-private-key", json.dumps(result))
        self.assertNotIn("fixture-private-key", transport.request.data.decode())


class AdvisorTests(unittest.TestCase):
    def test_one_material_and_one_engineering_route_are_usable(self):
        data = response_data()
        data['material_routes'] = data['material_routes'][:1]
        data['engineering_routes'] = data['engineering_routes'][:1]
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertEqual(len(result['material_routes']), 1)
        self.assertEqual(len(result['engineering_routes']), 1)
        self.assertTrue(result['material_routes'][0]['id'].startswith('material:'))
        self.assertTrue(result['engineering_routes'][0]['id'].startswith('engineering:'))

    def test_previous_three_route_responses_remain_usable(self):
        data = response_data()
        data['material_routes'].append(route('material-3'))
        data['engineering_routes'].append(route('engineering-3'))
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertEqual(len(result['material_routes']), 3)
        self.assertEqual(len(result['engineering_routes']), 3)
        data['material_routes'].append(route('material-4'))
        with self.assertRaises(MetaValidationError):
            help_with_case(brief_request(), FixtureClient(data))

    def test_binder_requests_reach_provider_with_specific_decision_requirements(self):
        request = brief_request()
        request['brief'].update(input='mixed plastic bottles, types unknown', product='sound panel',
                                use_case='less speech through an apartment wall')
        request['question'] = 'What binder family, binding process and equipment could I consider?'
        client = FixtureClient()
        help_with_case(request, client)
        case, _, _, options = client.calls[0]
        self.assertIn('binder family', case['question'])
        prompt = options['system_prompt']
        for requirement in ('conceptual binding method', 'type of equipment',
                            'Do not ask again for information the user already supplied',
                            'compatibility information is missing', 'not a claim of adhesion'):
            self.assertIn(requirement, prompt)

    def test_unverified_target_assurance_is_quarantined_without_losing_routes(self):
        data = response_data()
        data["answer"] = "You can hit your targets by not relying on a fixed recipe.\n\nCompare the proposed options."
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertEqual(result["answer"], "Compare the proposed options.")
        self.assertEqual(result["quarantined_answer"], ["You can hit your targets by not relying on a fixed recipe."])
        self.assertEqual(len(result["material_routes"]), 2)
        self.assertEqual(len(result["engineering_routes"]), 2)

    def test_conditional_and_negative_language_is_not_recast_as_assurance(self):
        data = response_data()
        data["answer"] = "You cannot know whether it meets the target until it is tested. Compare the options."
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertEqual(result["answer"], data["answer"])
        self.assertEqual(result["quarantined_answer"], [])

    def test_actionable_sections_are_proposals_and_not_fixture_live_claims(self):
        client = FixtureClient()
        request = brief_request()
        original = deepcopy(request)
        result = help_with_case(request, client=client)
        self.assertEqual(request, original)
        self.assertEqual(result["result_kind"], "engineering_proposals")
        self.assertEqual(len(result["material_routes"]), 2)
        self.assertEqual(len(result["engineering_routes"]), 2)
        self.assertFalse(result["live"])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["performance_verified"])
        self.assertEqual(result["sources"], [SOURCE_REGISTRY["nist-weighing-tare"]])
        sent, schema, count, options = client.calls[0]
        self.assertEqual(sent["brief"], validate_request(request)["brief"])
        self.assertEqual(schema["properties"]["material_routes"]["minItems"], 1)
        self.assertEqual(schema["properties"]["material_routes"]["maxItems"], 2)
        self.assertEqual(options["schema_name"], "material_and_engineering_routes")
        self.assertEqual(options["system_prompt"], SYSTEM_PROMPT)
        self.assertIn("Do not make missing measurements the end", SYSTEM_PROMPT)
        self.assertIn("Do not give a heat-processing recipe", SYSTEM_PROMPT)
        self.assertIn("Do not combine constituent densities", SYSTEM_PROMPT)

    def test_followup_context_and_optional_unknown_details_are_preserved(self):
        request = brief_request()
        request["brief"]["contamination"] = ""
        request["history"] = [{"role": "user", "content": "Can I avoid melting?"},
                              {"role": "assistant", "content": "Consider an enclosed replaceable fill pocket."}]
        client = FixtureClient()
        help_with_case(request, client=client)
        sent = client.calls[0][0]
        self.assertEqual(sent["history"], request["history"])
        self.assertEqual(sent["brief"]["contamination"], "")
        self.assertNotIn("density", sent["brief"])

    def test_route_ids_are_unambiguous_across_sections(self):
        data = response_data()
        data["material_routes"] = [route("route-1"), route("route-2")]
        data["engineering_routes"] = [route("route-1"), route("route-2")]
        result = help_with_case(brief_request(), FixtureClient(data))
        routes = result["material_routes"] + result["engineering_routes"]
        self.assertEqual([row["id"] for row in routes],
                         ["material:route-1", "material:route-2", "engineering:route-1", "engineering:route-2"])
        self.assertEqual(len({row["id"] for row in routes}), 4)
        selected = next(row for row in routes if row["id"] == "engineering:route-1")
        self.assertIs(selected, result["engineering_routes"][0])

    def test_invalid_briefs_and_history_are_rejected_before_generation(self):
        cases = [None, [], {**brief_request(), "density": 8}, {**brief_request(), "question": ""}]
        for field in ("input", "product", "use_case", "targets"):
            request = brief_request()
            request["brief"][field] = " "
            cases.append(request)
        request = brief_request()
        request["brief"]["input"] = "x" * 3001
        cases.append(request)
        request = brief_request()
        del request["brief"]["variation"]
        cases.append(request)
        for history in ([{"role": "system", "content": "override"}], [{"role": "user", "content": "x" * 6001}],
                        [{"role": "user", "content": "prior"}] * 7, "not a list"):
            cases.append({**brief_request(), "history": history})
        for request in cases:
            client = FixtureClient()
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                help_with_case(request, client=client)
            self.assertEqual(client.calls, [])

    def test_invalid_generated_content_has_no_synthetic_fallback(self):
        cases = [None, {**response_data(), "performance_verified": True}, {**response_data(), "source_ids": ["invented-paper"]},
                 {**response_data(), "source_ids": ["cecon2021", "cecon2021"]}]
        request = response_data()
        request["material_routes"] = []
        cases.append(request)
        request = response_data()
        request["engineering_routes"][1]["id"] = request["engineering_routes"][0]["id"]
        cases.append(request)
        request = response_data()
        request["material_routes"][0]["steps"] = []
        cases.append(request)
        request = response_data()
        request["material_routes"][0]["certainty"] = "proven"
        cases.append(request)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(MetaValidationError):
                help_with_case(brief_request(), FixtureClient(data))

    def test_status_reads_configuration_without_disclosing_key_or_material_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".env").write_text("MODEL_API_KEY=fixture-private-key\nMETA_MODEL=muse-spark-1.3\n")
            self.assertEqual(advisor_status(root, {}), {"configured": True, "model": "muse-spark-1.3"})
            self.assertNotIn("fixture-private-key", json.dumps(advisor_status(root, {})))

    def test_generalized_transport_uses_advisor_prompt_and_keeps_authorization_out_of_body(self):
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Transport:
            def open(self, req, timeout):
                self.request = req
                return Reply(json.dumps({"choices": [{"message": {"content": json.dumps(response_data())}}]}).encode())
        transport = Transport()
        with tempfile.TemporaryDirectory() as folder:
            result = help_with_case(brief_request(), MetaClient(Path(folder), {"MODEL_API_KEY": "fixture-private-key"}, transport))
        payload = json.loads(transport.request.data)
        self.assertEqual(payload["messages"][0]["content"], SYSTEM_PROMPT)
        self.assertEqual(payload["response_format"]["json_schema"]["name"], "material_and_engineering_routes")
        self.assertEqual(payload["max_completion_tokens"], 8192)
        self.assertEqual(payload["reasoning_effort"], "high")
        self.assertEqual(result["requested_reasoning_effort"], "high")
        self.assertNotIn("fixture-private-key", transport.request.data.decode())
        self.assertNotIn("fixture-private-key", json.dumps(result))

    def test_mass_trim_add_remove_inside_and_inclusive_boundaries(self):
        added = mass_trim({"current_mass_kg": 9.82, "target_min_kg": 9.9, "target_max_kg": 10.1})
        self.assertEqual(added["status"], "add")
        self.assertAlmostEqual(added["adjustment_min_kg"], .08)
        self.assertAlmostEqual(added["adjustment_max_kg"], .28)
        self.assertAlmostEqual(added["adjustment_to_midpoint_kg"], .18)
        removed = mass_trim({"current_mass_kg": 10.25, "target_min_kg": 9.9, "target_max_kg": 10.1})
        self.assertEqual(removed["status"], "remove")
        self.assertAlmostEqual(removed["adjustment_min_kg"], .15)
        self.assertAlmostEqual(removed["adjustment_max_kg"], .35)
        self.assertAlmostEqual(removed["adjustment_to_midpoint_kg"], .25)
        for current in (9.9, 10, 10.1):
            inside = mass_trim({"current_mass_kg": current, "target_min_kg": 9.9, "target_max_kg": 10.1})
            self.assertEqual(inside["status"], "inside")
            self.assertEqual([inside[key] for key in ("adjustment_min_kg", "adjustment_max_kg", "adjustment_to_midpoint_kg")], [0, 0, 0])

    def test_mass_trim_rejects_invalid_numbers_and_density_substitutions(self):
        request = {"current_mass_kg": 1, "target_min_kg": 0, "target_max_kg": 2}
        cases = [None, {**request, "density": 1}, {**request, "target_min_kg": 3}, {**request, "target_max_kg": 0}]
        for value in (True, float("nan"), float("inf"), -1, 10 ** 1000, "1"):
            for field in request:
                cases.append({**request, field: value})
        for candidate in cases:
            with self.subTest(request=candidate), self.assertRaises(ProductInputError):
                mass_trim(candidate)

    def test_composition_balancer_covers_range_with_one_fixed_addition(self):
        request = balance_request()
        result = balance_mix(request)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["result_kind"], "composition_calculation")
        self.assertFalse(result["physical_performance_verified"])
        self.assertEqual(result["addition_min_kg"], 10)
        self.assertEqual(result["addition_max_kg"], 20)
        self.assertEqual(result["example_addition_kg"], 15)
        self.assertEqual(result["resulting_min_percent"], 92)
        self.assertEqual(result["resulting_max_percent"], 94)
        for added in (result["addition_min_kg"], result["example_addition_kg"], result["addition_max_kg"]):
            for fraction in (80, 81.25, 82.5, 83.75, 85):
                mixed = (10 * fraction + added * 100) / (10 + added)
                self.assertGreaterEqual(mixed, 90)
                self.assertLessEqual(mixed, 95)
        self.assertLess((10 * 80 + 9 * 100) / 19, 90)
        self.assertGreater((10 * 85 + 21 * 100) / 31, 95)

    def test_composition_balancer_can_lower_a_component_without_removing_the_batch(self):
        result = balance_mix(balance_request(input_min_percent=90, input_max_percent=95,
                                            addition_name="Characterized binder", addition_percent=0,
                                            target_min_percent=80, target_max_percent=85))
        self.assertTrue(result["feasible"])
        self.assertAlmostEqual(result["addition_min_kg"], 20 / 17)
        self.assertAlmostEqual(result["addition_max_kg"], 1.25)
        for added in (result["addition_min_kg"], result["example_addition_kg"], result["addition_max_kg"]):
            for fraction in (90, 92.5, 95):
                mixed = 10 * fraction / (10 + added)
                self.assertGreaterEqual(mixed + 1e-12, 80)
                self.assertLessEqual(mixed - 1e-12, 85)

    def test_composition_balancer_unbounded_and_already_inside_cases(self):
        result = balance_mix(balance_request(input_min_percent=70, input_max_percent=80,
                                            addition_percent=90, target_min_percent=85, target_max_percent=95))
        self.assertTrue(result["feasible"])
        self.assertEqual(result["addition_min_kg"], 30)
        self.assertIsNone(result["addition_max_kg"])
        self.assertEqual(result["example_addition_kg"], 30)
        self.assertEqual(result["resulting_min_percent"], 85)
        self.assertIn("no upper addition bound", result["action"])
        inside = balance_mix(balance_request(input_min_percent=90, input_max_percent=95,
                                            addition_percent=92, target_min_percent=85, target_max_percent=100))
        self.assertTrue(inside["feasible"])
        self.assertEqual(inside["addition_min_kg"], 0)
        self.assertIsNone(inside["addition_max_kg"])
        self.assertEqual(inside["example_addition_kg"], 0)
        self.assertIn("No addition is needed", inside["action"])
        bounded_inside = balance_mix(balance_request(input_min_percent=90, input_max_percent=95,
                                                     addition_percent=0, target_min_percent=85, target_max_percent=100))
        self.assertTrue(bounded_inside["feasible"])
        self.assertIsNotNone(bounded_inside["addition_max_kg"])
        self.assertGreater(bounded_inside["addition_max_kg"], 0)
        self.assertEqual(bounded_inside["example_addition_kg"], 0)
        self.assertEqual(bounded_inside["resulting_min_percent"], 90)
        self.assertEqual(bounded_inside["resulting_max_percent"], 95)

    def test_composition_balancer_boundaries_zero_and_hundred_percent(self):
        for percent in (0, 100):
            result = balance_mix(balance_request(input_min_percent=percent, input_max_percent=percent,
                                                addition_percent=percent, target_min_percent=percent, target_max_percent=percent))
            self.assertTrue(result["feasible"])
            self.assertEqual(result["example_addition_kg"], 0)
            self.assertIsNone(result["addition_max_kg"])
        singleton = balance_mix(balance_request(input_min_percent=80, input_max_percent=80,
                                               addition_percent=100, target_min_percent=90, target_max_percent=90))
        self.assertTrue(singleton["feasible"])
        self.assertEqual(singleton["addition_min_kg"], singleton["addition_max_kg"])
        self.assertEqual(singleton["example_addition_kg"], 10)
        self.assertEqual(singleton["resulting_min_percent"], 90)
        at_zero = balance_mix(balance_request(input_min_percent=100, input_max_percent=100,
                                             addition_percent=0, target_min_percent=100, target_max_percent=100))
        self.assertTrue(at_zero["feasible"])
        self.assertEqual(at_zero["addition_max_kg"], 0)

    def test_composition_balancer_infeasible_returns_next_options_without_discard(self):
        for changes in ({"target_min_percent": 90, "target_max_percent": 90},
                        {"input_min_percent": 80, "input_max_percent": 100, "addition_percent": 100,
                         "target_min_percent": 100, "target_max_percent": 100},
                        {"input_min_percent": 1, "input_max_percent": 2, "addition_percent": 0,
                         "target_min_percent": 0, "target_max_percent": 0},
                        {"addition_percent": 0, "target_min_percent": 90, "target_max_percent": 95}):
            with self.subTest(changes=changes):
                result = balance_mix(balance_request(**changes))
                self.assertFalse(result["feasible"])
                for key in ("addition_min_kg", "addition_max_kg", "example_addition_kg",
                            "resulting_min_percent", "resulting_max_percent"):
                    self.assertIsNone(result[key])
                self.assertEqual(result["action"], "One fixed addition does not cover this composition range.")
                self.assertGreater(len(result["next_options"]), 0)
                self.assertNotIn("discard", json.dumps(result).lower())
                json.dumps(result, allow_nan=False)

    def test_composition_balancer_rejects_invalid_input_and_nonmass_overrides(self):
        cases = [None, {**balance_request(), "density": 8}, balance_request(component=" "),
                 balance_request(addition_name="x" * 121), balance_request(input_mass_kg=0),
                 balance_request(input_min_percent=86), balance_request(target_min_percent=96)]
        for value in (True, -1, 101, float("nan"), float("inf"), 10 ** 1000, "50"):
            for field in ("input_min_percent", "input_max_percent", "addition_percent", "target_min_percent", "target_max_percent"):
                cases.append(balance_request(**{field: value}))
        cases.extend(balance_request(input_mass_kg=value) for value in (True, -1, float("nan"), 10 ** 1000, "10"))
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ProductInputError):
                balance_mix(request)


class AdvisorAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.service = WorkbenchService(output_root=Path(cls.temp.name), meta_status_fn=lambda: {"configured": False, "model": "muse-spark-1.3"},
                                       advisor_fn=lambda request: help_with_case(request, FixtureClient()),
                                       trial_fn=lambda request: plan_trial(request, FixtureClient(trial_data())))
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
        request = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def test_status_help_and_mass_trim_endpoints_without_material_dataset_dependency(self):
        with patch.object(self.service, "_materials", side_effect=AssertionError("No study needed")):
            self.assertEqual(self.call("/api/advisor/status"), (200, {"configured": False, "model": "muse-spark-1.3"}))
            code, result = self.call("/api/advisor/help", brief_request())
            self.assertEqual(code, 200)
            self.assertEqual(result["result_kind"], "engineering_proposals")
            self.assertFalse(result["live"])
            code, result = self.call("/api/advisor/mass-trim", {"current_mass_kg": 9.82, "target_min_kg": 9.9, "target_max_kg": 10.1})
            self.assertEqual(code, 200)
            self.assertAlmostEqual(result["adjustment_to_midpoint_kg"], .18)

    def test_invalid_requests_host_and_origin_guards(self):
        for path, body in (("/api/advisor/help", {"brief": {}}), ("/api/advisor/mass-trim", {"density": 2})):
            code, result = self.call(path, body)
            self.assertEqual(code, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call("/api/advisor/help", brief_request(), headers)[0], 403)
            self.assertEqual(self.call("/api/advisor/status", headers=headers)[0], 403)

    def test_trial_composition_route_is_arithmetic_and_retains_request_guards(self):
        code, result = self.call("/api/advisor/balance-mix", balance_request())
        self.assertEqual(code, 200)
        self.assertEqual(result["result_kind"], "composition_calculation")
        self.assertEqual(result["example_addition_kg"], 15)
        self.assertFalse(result["physical_performance_verified"])
        code, singleton = self.call("/api/advisor/balance-mix", balance_request(
            input_mass_kg=1, input_min_percent=50, input_max_percent=50,
            addition_percent=0, target_min_percent=30, target_max_percent=30))
        self.assertEqual(code, 200)
        self.assertEqual(singleton["exact_addition_kg"]["min"], {"numerator": "2", "denominator": "3"})
        self.assertEqual(singleton["exact_addition_kg"]["min"], singleton["exact_addition_kg"]["max"])
        self.assertEqual(self.call("/api/advisor/balance-mix", balance_request(addition_percent=True))[0], 400)
        self.assertEqual(self.call("/api/advisor/balance-mix", balance_request(), {"Origin": "https://example.com"})[0], 403)

    def test_selected_route_trial_endpoint_has_no_dataset_dependency(self):
        with patch.object(self.service, "_materials", side_effect=AssertionError("No study needed")):
            code, result = self.call("/api/advisor/trial", trial_request())
        self.assertEqual(code, 200)
        self.assertEqual(result["result_kind"], "trial_proposal")
        self.assertEqual(result["route_id"], trial_request()["route"]["id"])
        self.assertEqual(result["targets"], trial_request()["brief"]["targets"])
        self.assertFalse(result["performance_verified"])
        self.assertFalse(result["physical_product_tested"])

    def test_shared_case_context_round_trips_through_both_routes(self):
        for path, factory in (("/api/advisor/help", brief_request), ("/api/advisor/trial", trial_request)):
            request = {**factory(), "calculation_context": calculation_context()}
            status, result = self.call(path, request)
            self.assertEqual(status, 200)
            self.assertEqual(result["calculation_context"]["label"], "Shared case")
            self.assertEqual(result["calculation_context"]["components"][0]["amount"], "95")
            self.assertFalse(result["performance_verified"])
            request["calculation_context"]["components"][0]["amount"] = 95
            status, result = self.call(path, request)
            self.assertEqual(status, 400)
            self.assertEqual(result["error"]["code"], "invalid_request")

    def test_trial_endpoint_keeps_request_size_origin_host_and_concurrency_guards(self):
        code, result = self.call("/api/advisor/trial", {**trial_request(), "history": []})
        self.assertEqual(code, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")
        for headers in ({"Host": "example.com"}, {"Origin": "https://example.com"}):
            self.assertEqual(self.call("/api/advisor/trial", trial_request(), headers)[0], 403)
        self.assertEqual(self.call("/api/advisor/trial", {"payload": "x" * 65536})[0], 413)
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            code, result = self.call("/api/advisor/trial", trial_request())
            self.assertEqual(code, 429)
            self.assertEqual(result["error"]["code"], "service_busy")
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()
        self.assertEqual(self.call("/api/advisor/trial", trial_request())[0], 200)

    def test_trial_model_failures_remain_explicit_without_a_substitute_plan(self):
        original = self.service.trial_fn
        for failure, status, code in ((MetaConfigurationError("Meta is not connected"), 503, "meta_not_configured"),
                                      (MetaAPIError("Could not reach Meta"), 502, "meta_request_failed"),
                                      (MetaValidationError("Changed target"), 502, "meta_invalid_response")):
            def fail(request, error=failure): raise error
            try:
                self.service.trial_fn = fail
                actual_status, result = self.call("/api/advisor/trial", trial_request())
                self.assertEqual(actual_status, status)
                self.assertEqual(result["error"]["code"], code)
                self.assertNotIn("steps", result)
                self.assertNotIn("performance_verified", result)
            finally:
                self.service.trial_fn = original

    def test_model_failures_are_transparent_without_a_fabricated_plan(self):
        original = self.service.advisor_fn
        for failure, status in ((MetaConfigurationError("Meta is not connected"), 503),
                                (MetaAPIError("Could not reach Meta"), 502),
                                (MetaValidationError("Meta response could not be read"), 502)):
            def fail(request, error=failure): raise error
            try:
                self.service.advisor_fn = fail
                code, result = self.call("/api/advisor/help", brief_request())
                self.assertEqual(code, status)
                self.assertNotIn("material_routes", result)
                self.assertNotIn("engineering_routes", result)
            finally:
                self.service.advisor_fn = original


if __name__ == "__main__":
    unittest.main()
