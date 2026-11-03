"""Regression checks for recognized person-on-surface advice in intake."""

from copy import deepcopy
import json
from types import SimpleNamespace
import unittest

from reshivo.project_intake import read_project_intake
from reshivo.walking_guidance import has_unsafe_walking_guidance
from reshivo.intake_grip_proxy import has_misleading_grip_proxy
from test_project_intake import empty_draft, record, simple_request, simple_response


class FixtureClient:
    def __init__(self, response):
        self.response = response
        self.prompt = None

    def generate(self, prompt, *args, **kwargs):
        self.prompt = json.loads(prompt)
        return SimpleNamespace(data=deepcopy(self.response), provider="meta", model="fixture",
                               live=True, usage={}, request_id="fixture", elapsed_ms=1)


class WalkingGuidanceTests(unittest.TestCase):
    def test_observed_live_first_step_is_replaced_without_losing_case_details(self):
        message = ("I have recycled polypropylene packaging flakes. Each delivery has a different mix "
                   "and sometimes paper label scraps in unknown amounts. I want to make a low-cost indoor "
                   "entrance mat with good grip. I only have hand tools at home, no lab or heated press. "
                   "What can I do when the input changes?")
        product_quote = "I want to make a low-cost indoor entrance mat with good grip."
        input_quote = "I have recycled polypropylene packaging flakes."
        variation_quote = "Each delivery has a different mix and sometimes paper label scraps in unknown amounts."
        process_quote = "I only have hand tools at home, no lab or heated press."
        draft = {**empty_draft(),
                 "product": record("indoor entrance mat", product_quote),
                 "input": record("recycled polypropylene packaging flakes", input_quote),
                 "variation": record("different mix and sometimes paper label scraps in unknown amounts", variation_quote),
                 "use": record("indoor", product_quote),
                 "priorities": record("low-cost indoor entrance mat with good grip", product_quote),
                 "process": record("hand tools at home", process_quote),
                 "constraints": record("no lab or heated press", process_quote)}
        observed_step = ("From your current delivery, take one small handful and by hand separate paper scraps "
                         "from flakes, note flake sizes, sharp edges and slip feel, then contain the handful in "
                         "a spare cloth bag or pillowcase and step on it indoors to observe grip, shedding and "
                         "comfort; label and keep that sample to compare when the next delivery mix changes.")
        response = {"reply": "Plan an indoor mat around the material and tools available.",
                    "project_draft": draft, "questions": ["Where will the mat be used?"],
                    "first_step": observed_step}
        result = read_project_intake({"message": message}, client=FixtureClient(response))
        self.assertEqual(result["project_draft"], draft)
        self.assertEqual(result["guidance_origin"], "local")
        self.assertEqual(result["questions"], ["Which material or design change would you like to compare first?"])
        self.assertNotIn("pillowcase", json.dumps(result))
        self.assertNotIn("step on", json.dumps(result))

    def test_sparse_draft_gets_only_questions_for_missing_details(self):
        response = {"reply": "Let's explore the possibilities.", "project_draft": empty_draft(),
                    "questions": ["What do you want to make?"],
                    "first_step": "Walk on the sample to see how it feels."}
        result = read_project_intake({"message": "What can I do with these scraps?"},
                                     client=FixtureClient(response))
        self.assertEqual(result["project_draft"], empty_draft())
        self.assertEqual(result["questions"], ["What would you like to make?",
                                               "What materials do you have?",
                                               "Where and how will you use the product?"])
        self.assertEqual(result["guidance_origin"], "local")
        self.assertEqual(result["provider"], "meta")
        self.assertTrue(result["live"])
        self.assertIn("Sketch", result["first_step"])
        self.assertLessEqual(len(result["questions"]), 3)

    def test_partial_draft_prioritizes_unfilled_fields(self):
        response = simple_response()
        response["first_step"] = "Stand on the mat to test grip."
        result = read_project_intake(simple_request(), client=FixtureClient(response))
        self.assertEqual(result["questions"], ["What should the product do well?",
                                               "What changes in your material?",
                                               "Which tools or processes can you use?"])
        self.assertEqual(result["project_draft"], response["project_draft"])
        self.assertEqual(result["guidance_reason"], "floor_slip")

    def test_recognized_direct_actions_and_paraphrases(self):
        examples = (
            "Contain the handful in a cloth bag or pillowcase and step on it indoors to observe grip.",
            "Walk across the wet prototype to see how it feels.",
            "Stand on the wet mat and check whether it moves.",
            "Try standing with both feet on the tile.",
            "Step with both feet onto the sample.",
            "Take a few steps across the sample.",
            "Walk a few steps on the wet mat.",
            "Stand with one foot on the sample.",
            "Walk slowly and carefully over the prototype.",
            "Stand with your full weight on the sample.",
            "Step down onto the prototype.",
            "Put one foot down on the sample.",
            "Put your foot onto the sample and check it.",
            "Place your full body weight on the mat.",
            "Try it underfoot to assess grip.",
            "Don't step on it; instead walk across it.",
        )
        for text in examples:
            with self.subTest(text=text):
                self.assertTrue(has_unsafe_walking_guidance(text))

    def test_clear_negations_and_unrelated_language_are_not_flagged(self):
        examples = ("Do not walk on the wet mat.", "Do not walk a few steps on the wet mat.", "Avoid stepping on it.",
                    "Never place your foot on the sample.", "Let's walk through the options.",
                    "Choose the next step on paper.", "Compare the materials on a table.")
        for text in examples:
            with self.subTest(text=text):
                self.assertFalse(has_unsafe_walking_guidance(text))

    def test_unsafe_guidance_in_any_field_gets_local_replacement(self):
        for field in ("reply", "first_step", "questions"):
            with self.subTest(field=field):
                response = simple_response()
                unsafe = "Step on the loose sample to check its grip."
                response[field] = [unsafe] if field == "questions" else unsafe
                original_draft = deepcopy(response["project_draft"])
                client = FixtureClient(response)
                result = read_project_intake(simple_request(), client=client)
                self.assertEqual(result["guidance_origin"], "local")
                self.assertEqual(result["guidance_reason"], "floor_slip")
                self.assertEqual(result["project_draft"], original_draft)
                self.assertEqual(result["provider"], "meta")
                self.assertEqual(result["model"], "fixture")
                self.assertTrue(result["live"])
                self.assertEqual(result["request_id"], "fixture")
                self.assertIn("Sketch", result["first_step"])
                self.assertTrue(result["questions"])
                self.assertNotIn(unsafe, json.dumps(result))
                self.assertFalse(any(has_unsafe_walking_guidance(value)
                                     for value in [result["reply"], result["first_step"], *result["questions"]]))

    def test_prior_unsafe_assistant_text_is_not_replayed_but_user_text_is_preserved(self):
        request = simple_request()
        request["history"] = [
            {"role": "assistant", "content": "Walk on the sample and report how it feels."},
            {"role": "user", "content": "I was previously told to walk on it, but have not tried it."},
        ]
        client = FixtureClient(simple_response())
        result = read_project_intake(request, client=client)
        self.assertNotIn("Walk on the sample", json.dumps(client.prompt))
        self.assertEqual(client.prompt["history"][1], request["history"][1])
        self.assertEqual(result["project_draft"], simple_response()["project_draft"])
        self.assertNotIn("guidance_origin", result)

    def test_normal_safe_guidance_is_unchanged(self):
        response = simple_response()
        result = read_project_intake(simple_request(), client=FixtureClient(response))
        self.assertEqual(result["reply"], response["reply"])
        self.assertEqual(result["first_step"], response["first_step"])
        self.assertEqual(result["questions"], response["questions"])
        self.assertNotIn("guidance_origin", result)

    def test_observed_paper_and_loose_sample_proxies_are_held(self):
        observed = (
            'Use that to compare no-heat containment ideas on paper for grip and cleaning.',
            'Line up a bench tilt comparison of tiny contained samples against a shoe sole.',
        )
        for text in observed:
            with self.subTest(text=text):
                self.assertTrue(has_misleading_grip_proxy(text))
                response = simple_response(); response['first_step'] = text
                result = read_project_intake(simple_request(), client=FixtureClient(response))
                self.assertEqual(result['guidance_origin'], 'local')
                self.assertEqual(result['project_draft'], response['project_draft'])
                self.assertNotIn(text, json.dumps(result))

    def test_paper_design_and_unrelated_tilt_are_not_rejected(self):
        for text in ('Sketch the mat on paper to compare shape and fit.',
                     'Compare the costs of two designs on paper.',
                     'Sketch the mat to compare fit, then choose a grip assessment.',
                     'Compare materials on paper; select a grip test for the finished mat.',
                     'Ask what shoe sole and flooring will be used.',
                     'Compare the assembly tilt with its finished product sample.',
                     'Do not compare designs on paper for grip.'):
            with self.subTest(text=text):
                self.assertFalse(has_misleading_grip_proxy(text))

    def test_prior_recognized_proxy_is_not_replayed_as_assistant_advice(self):
        request = simple_request()
        request['history'] = [
            {'role': 'assistant', 'content': 'Compare your layouts on paper for grip.'},
            {'role': 'user', 'content': 'Can paper tell me about grip?'},
        ]
        client = FixtureClient(simple_response())
        read_project_intake(request, client=client)
        self.assertNotIn('Compare your layouts on paper for grip.', json.dumps(client.prompt))
        self.assertEqual(client.prompt['history'][1], request['history'][1])


if __name__ == "__main__":
    unittest.main()
