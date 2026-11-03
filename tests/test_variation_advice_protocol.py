"""Comparison guidance is provided to every model-backed planning operation."""
from copy import deepcopy
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case, plan_trial
from test_advisor import FixtureClient, brief_request, response_data, trial_data, trial_request


class VariationAdviceProtocolTests(unittest.TestCase):
    def test_each_planning_call_receives_the_comparison_and_cost_protocol(self):
        followup = {
            "answer": "Compare a pilot under the same stated conditions.",
            "next_steps": ["Record each specimen's measured mass."],
            "questions": [], "source_ids": [],
        }
        cases = [
            (help_with_case, brief_request(), response_data()),
            (follow_up_with_case, brief_request(), followup),
            (plan_trial, trial_request(), trial_data()),
        ]
        for operation, request, response in cases:
            request["brief"]["variation"] = "Material composition changes between batches."
            if "question" in request:
                request["question"] = "How can I compare product weight consistency and costs?"
            before = deepcopy(request)
            client = FixtureClient(response)
            with self.subTest(operation=operation.__name__):
                operation(request, client=client)
                instructions = " ".join(client.calls[0][3]["system_prompt"].split())
                for expected in (
                    "at least three separately made specimens per option",
                    "Repeating a reading on one specimen is not making",
                    "multiple separately produced batches",
                    "not a statistically validated",
                    "Compare monetary costs only from supplied costs or clearly labelled assumptions",
                    "If preparation is the difference being compared, describe that difference",
                    "reserve and label a portion for each option before a preparation",
                    "Do not invent portion amounts, claim separate portions have the same composition",
                    "recalculate using its actual mass and its own measured or explicitly stated composition range",
                    "Do not claim a route preserves or improves production yield without a matching measurement",
                    "do not silently relax it or make purchasing more stock the only default action",
                    "Recording material removed does not by itself establish how much",
                    "place that specific prerequisite in the operation itself",
                ):
                    self.assertIn(expected, instructions)
                self.assertEqual(request, before)


if __name__ == "__main__":
    unittest.main()
