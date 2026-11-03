from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from rematter.meta import Generation, MetaAPIError, MetaConfigurationError, MetaValidationError
from rematter.products import ProductInputError
from rematter.project_intake import (
    DRAFT_FIELDS, SYSTEM_PROMPT, project_intake_schema, read_project_intake, validate_intake_request,
)


def empty_draft():
    return dict.fromkeys(DRAFT_FIELDS)


def record(value, quote=None, source="message"):
    return {"value": value, "source": source, "quote": value if quote is None else quote}


def simple_request():
    return {"message": "I have recycled rubber pieces and want a floor mat for standing comfortably in my workshop."}


def simple_response():
    quote = simple_request()["message"]
    return {
        "reply": "We can explore a mat around the material you have. Comfort and workshop use give us a starting point; grip and cleaning still need discussion.",
        "project_draft": {**empty_draft(), "product": record("floor mat", quote),
                          "input": record("recycled rubber pieces", quote),
                          "use": record("standing comfortably in my workshop", quote)},
        "questions": ["Will this sit on a dry indoor floor, or could the floor get wet?"],
        "first_step": "Describe the pieces' size and condition, and where the mat will sit, so we can compare a loose contained construction with a bonded sheet.",
    }


class FixtureClient:
    def __init__(self, data=None, failure=None, provider=None):
        self.data = simple_response() if data is None else data
        self.failure = failure
        self.provider = provider
        self.calls = []

    def generate(self, prompt, schema, max_candidates, **options):
        self.calls.append((json.loads(prompt), schema, max_candidates, options))
        if self.failure is not None:
            raise self.failure
        values = dict(data=deepcopy(self.data), model="fixture-model", live=False,
                      usage={"total_tokens": 1}, request_id="fixture-intake", elapsed_ms=9)
        return (Generation(**values) if self.provider is None else
                SimpleNamespace(**values, provider=self.provider))


class ProjectIntakeTests(unittest.TestCase):
    def test_simple_message_can_explore_without_engineering_brief_or_numbers(self):
        request = simple_request()
        before = deepcopy(request)
        client = FixtureClient()
        result = read_project_intake(request, client=client)
        self.assertEqual(request, before)
        self.assertEqual(result["readiness"], "can_explore")
        self.assertIsNone(result["project_draft"]["variation"])
        self.assertIn("process", result["unknown_fields"])
        self.assertTrue(result["review_required"])
        for flag in ("interpretation_verified", "ready_for_calculation", "physical_product_tested", "performance_verified", "live"):
            self.assertIs(result[flag], False)
        self.assertEqual(result["provider"], "meta")
        self.assertEqual(result["request_id"], "fixture-intake")
        self.assertEqual(len(result["request_fingerprint"]), 64)
        self.assertEqual(len(client.calls), 1)

    def test_explicit_call_is_bounded_and_prompt_starts_with_the_job(self):
        client = FixtureClient()
        read_project_intake(simple_request(), client=client)
        prompt, schema, candidates, options = client.calls[0]
        self.assertEqual(prompt["message"], simple_request()["message"])
        self.assertEqual(prompt["history"], [])
        self.assertEqual(schema, project_intake_schema())
        self.assertEqual(candidates, 1)
        self.assertEqual(options["max_completion_tokens"], 8192)
        self.assertEqual(options["timeout_seconds"], 90)
        self.assertEqual(options["reasoning_effort"], "medium")
        self.assertEqual(options["system_prompt"], SYSTEM_PROMPT)
        self.assertIn("comfort, grip, wear", SYSTEM_PROMPT)
        self.assertIn("blocking sound, reducing room echo or reducing impact noise", SYSTEM_PROMPT)
        self.assertIn("Other products remain open", SYSTEM_PROMPT)
        self.assertNotIn("material_routes", schema["properties"])

    def test_validation_itself_never_creates_a_client(self):
        with patch("rematter.project_intake.MetaClient", side_effect=AssertionError("No call on validation")):
            self.assertEqual(validate_intake_request({"message": "Help me use these scraps."})["history"], [])

    def test_partial_idea_requests_context_but_keeps_unknowns_null(self):
        request = {"message": "Could these scraps become something useful?"}
        response = {"reply": "Let's start with what the scraps are and the job you want them to do.",
                    "project_draft": empty_draft(),
                    "questions": ["What do you know about the scraps' material and previous use?",
                                  "What useful object or everyday job do you have in mind?"],
                    "first_step": "Check any labels or source records for the scraps; keep unidentified pieces separate while choosing a possible job."}
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["readiness"], "needs_context")
        self.assertEqual(result["unknown_fields"], list(DRAFT_FIELDS))
        self.assertEqual(result["project_draft"], empty_draft())
        response["questions"] = []
        with self.assertRaises(MetaValidationError):
            read_project_intake(request, client=FixtureClient(response))
        request["history"] = [{"role": "user", "content": "I do not know the material."},
                              {"role": "assistant", "content": "What job matters?"},
                              {"role": "user", "content": "I am still exploring possible jobs."}]
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["questions"], [])
        self.assertEqual(result["readiness"], "needs_context")
        self.assertIsNone(result["project_draft"]["use"])

    def test_other_product_and_multiple_literal_priorities_are_preserved(self):
        text = "I have identified recycled HDPE for a plant tray on my balcony. It must catch water and be easy to clean. I have 1.250 kg, and prices are unknown."
        response = {"reply": "We can compare tray constructions around water collection and cleaning.",
                    "project_draft": {**empty_draft(), "product": record("plant tray", text),
                                      "input": record("identified recycled HDPE", text),
                                      "use": record("on my balcony", text),
                                      "priorities": record("catch water and be easy to clean", text),
                                      "constraints": record("I have 1.250 kg", text)},
                    "questions": [], "first_step": "Measure the space under the pots and compare a removable liner with a one-piece tray, keeping water collection and cleaning as separate checks."}
        result = read_project_intake({"message": text}, client=FixtureClient(response))
        self.assertEqual(result["project_draft"]["constraints"]["value"], "I have 1.250 kg")
        self.assertEqual(result["project_draft"]["priorities"]["value"], "catch water and be easy to clean")
        self.assertEqual(result["readiness"], "can_explore")
        self.assertNotIn("cost", result["project_draft"])

    def test_history_is_literal_user_evidence_not_assistant_evidence(self):
        request = {"message": "Can we start with the sheet?", "history": [
            {"role": "user", "content": "I have cotton offcuts for a sound sheet."},
            {"role": "assistant", "content": "A density of 100 kg/m3 might be useful."}]}
        response = {"reply": "First distinguish the sound problem and where the sheet will go.",
                    "project_draft": {**empty_draft(), "product": record("sound sheet", request["history"][0]["content"], "history.0"),
                                      "input": record("cotton offcuts", request["history"][0]["content"], "history.0")},
                    "questions": ["Are you trying to block a sound, reduce echo in the room, or soften impact noise?"],
                    "first_step": "Identify the sound source and intended installation before choosing a sheet construction."}
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["project_draft"]["input"]["source"], "history.0")
        response["project_draft"]["constraints"] = record("100 kg/m3", request["history"][1]["content"], "history.1")
        with self.assertRaises(MetaValidationError):
            read_project_intake(request, client=FixtureClient(response))

    def test_reviewed_values_survive_evicted_history_and_manual_edits(self):
        reviewed = {**empty_draft(), "product": record("floor mat", source="user_review"),
                    "input": record("rubber offcuts", source="user_review"),
                    "use": record("standing at the sink", source="user_review"),
                    "constraints": record("2.000 kg available", source="user_review")}
        request = {"message": "I have now reviewed those details; what should I compare first?",
                   "reviewed_draft": reviewed}
        response = {**simple_response(), "project_draft": deepcopy(reviewed), "questions": []}
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["project_draft"], reviewed)
        self.assertEqual(result["readiness"], "can_explore")
        self.assertTrue(result["review_required"])
        for field, bad in (("constraints", "3.000 kg available"), ("product", "rubber offcuts")):
            changed = deepcopy(response)
            changed["project_draft"][field] = record(bad, source="user_review")
            with self.subTest(field=field), self.assertRaises(MetaValidationError):
                read_project_intake(request, client=FixtureClient(changed))
        with self.assertRaises(MetaValidationError):
            read_project_intake({"message": request["message"]}, client=FixtureClient(response))

    def test_confirmed_quoted_draft_can_be_promoted_without_original_history(self):
        reviewed = simple_response()["project_draft"]
        request = {"message": "Please retain my reviewed project.", "reviewed_draft": reviewed}
        before = deepcopy(request)
        normalized = validate_intake_request(request)
        self.assertEqual(request, before)
        for field, value in reviewed.items():
            expected = None if value is None else record(value["value"], source="user_review")
            self.assertEqual(normalized["reviewed_draft"][field], expected)

    def test_current_correction_is_proposed_without_overwriting_reviewed_material(self):
        reviewed = {**empty_draft(), "product": record("sound sheet", source="user_review"),
                    "input": record("fabric offcuts", source="user_review"),
                    "use": record("between apartments", source="user_review")}
        text = "I only have mixed plastic bottles, thirty tonnes; no fabric."
        request = {"message": text, "reviewed_draft": reviewed, "history": [
            {"role": "user", "content": "I want a sound sheet."},
            {"role": "assistant", "content": "What material do you have?"}]}
        response = {"reply": "Let's compare sheet ideas.",
                    "project_draft": {**reviewed, "input": record("mixed plastic bottles", text)},
                    "questions": ["Can you tell me more?"],
                    "first_step": "Compare possible sheet designs and what needs checking."}
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["project_draft"], reviewed)
        self.assertEqual(result["suggested_changes"], {"input": record("mixed plastic bottles", text)})
        self.assertEqual(result["questions"], [])

    def test_history_and_null_do_not_overwrite_reviewed_values(self):
        reviewed = {**empty_draft(), "product": record("sound sheet", source="user_review"),
                    "input": record("mixed plastic", source="user_review"),
                    "use": record("between apartments", source="user_review")}
        request = {"message": "I don't know yet.", "reviewed_draft": reviewed,
                   "history": [{"role": "user", "content": "I have fabric offcuts."}]}
        response = {"reply": "Let's compare options.",
                    "project_draft": {**reviewed, "input": record("fabric offcuts", source="history.0"), "use": None},
                    "questions": ["What is your use?"], "first_step": "Compare designs."}
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["project_draft"], reviewed)
        self.assertEqual(result["suggested_changes"], {})
        self.assertEqual(result["questions"], [])

    def test_unquoted_correction_is_not_accepted_as_a_suggestion(self):
        reviewed = {**empty_draft(), "input": record("fabric", source="user_review")}
        request = {"message": "I have mixed plastic.", "reviewed_draft": reviewed}
        response = {**simple_response(), "project_draft": {**empty_draft(),
                    "input": record("HDPE", "mixed plastic")}}
        with self.assertRaises(MetaValidationError):
            read_project_intake(request, client=FixtureClient(response))

    def test_invented_converted_or_clipped_quantities_are_rejected(self):
        request = {"message": "I have 1.250 kg and a very thin sheet; my recorded setting is 26.000000000000000005%."}
        for value in ("1250 g", "1.25 kg", "2 mm", "26%", "26.00000000000000000"):
            response = {**simple_response(), "project_draft": {**empty_draft(),
                         "constraints": record(value, request["message"])}}
            with self.subTest(value=value), self.assertRaises(MetaValidationError):
                read_project_intake(request, client=FixtureClient(response))
        response["project_draft"]["constraints"] = record("26.000000000000000005%", request["message"])
        result = read_project_intake(request, client=FixtureClient(response))
        self.assertEqual(result["project_draft"]["constraints"]["value"], "26.000000000000000005%")
        for clipped in ("1.25", "26", "26.00000000000000000"):
            response["project_draft"]["constraints"] = record(clipped)
            with self.subTest(clipped_quote=clipped), self.assertRaises(MetaValidationError):
                read_project_intake(request, client=FixtureClient(response))

    def test_invalid_and_oversized_requests_fail_before_generation(self):
        invalid = [None, {}, {"message": " "}, {"message": "x" * 4001},
                   {"message": "Help", "brief": {}},
                   {"message": "Help", "history": [{"role": "user", "content": "a"}] * 7},
                   {"message": "Help", "history": [{"role": "system", "content": "a"}]},
                   {"message": "Help", "history": [{"role": "user", "content": "a", "hidden": True}]},
                   {"message": "Help", "history": [{"role": "user", "content": "x" * 3001}]},
                   {"message": "x" * 4000, "history": [{"role": "user", "content": "x" * 3000}] * 5},
                   {"message": "Help", "reviewed_draft": {}},
                   {"message": "Help", "reviewed_draft": {**empty_draft(), "product": record("mat", "a tray", "user_review")}}]
        for request in invalid:
            client = FixtureClient()
            with self.subTest(request=str(request)[:80]), self.assertRaises(ProductInputError):
                read_project_intake(request, client=client)
            self.assertEqual(client.calls, [])

    def test_substantively_invalid_responses_are_not_surfaced(self):
        response = simple_response()
        invalid = [None, {}, {**response, "reply": " "}, {**response, "first_step": ""},
                   {**response, "reply": "x" * 1201}, {**response, "first_step": "x" * 701},
                   {**response, "questions": ["What matters?"] * 4},
                   {**response, "questions": ["What matters?", " WHAT MATTERS? "]},
                   {**response, "questions": ["x" * 351]},
                   {**response, "material_routes": []}, {**response, "trial": {}},
                   {**response, "performance_verified": True},
                   {**response, "project_draft": {**empty_draft(), "density": None}},
                   {**response, "project_draft": {**empty_draft(), "input": record("EPDM", simple_request()["message"])}},
                   {**response, "project_draft": {**empty_draft(), "product": record("floor mat", source="history.5")}}]
        for data in invalid:
            with self.subTest(data=str(data)[:80]), self.assertRaises(MetaValidationError):
                read_project_intake(simple_request(), client=FixtureClient(data if data is not None else []))

    def test_transport_metadata_is_honest_and_errors_propagate_without_fallback(self):
        result = read_project_intake(simple_request(), client=FixtureClient(provider="openai"))
        self.assertEqual(result["provider"], "openai")
        self.assertFalse(result["live"])
        for error in (MetaConfigurationError("Not configured"), MetaAPIError("Unavailable"),
                      MetaValidationError("Response cut short")):
            client = FixtureClient(failure=error)
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)) as caught:
                read_project_intake(simple_request(), client=client)
            self.assertIs(caught.exception, error)
            self.assertEqual(len(client.calls), 1)


if __name__ == "__main__":
    unittest.main()
