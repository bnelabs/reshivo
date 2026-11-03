"""A bounded regression for an observed single-delivery inference."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

from reshivo.delivery_comparison import has_single_delivery_comparison
from reshivo.project_intake import read_project_intake
from test_project_intake import simple_request, simple_response


class FixtureClient:
    def __init__(self, response):
        self.response = response
        self.prompt = None

    def generate(self, prompt, *args, **kwargs):
        self.prompt = json.loads(prompt)
        return SimpleNamespace(data=deepcopy(self.response), provider='meta', model='fixture',
                               live=True, usage={}, request_id='fixture', elapsed_ms=1)


class SingleDeliveryComparisonTests(unittest.TestCase):
    def test_observed_live_response_is_replaced_and_user_facts_preserved(self):
        capture = json.loads((Path(__file__).resolve().parent.parent / 'examples/frontier-intake-final-prompt-20261103.json').read_text())
        recorded = capture['response']
        self.assertTrue(has_single_delivery_comparison(recorded['first_step']))
        generated = {field: recorded[field] for field in ('reply', 'project_draft', 'questions', 'first_step')}
        result = read_project_intake(capture['request'], client=FixtureClient(generated))
        self.assertEqual(result['project_draft'], recorded['project_draft'])
        self.assertEqual(result['guidance_origin'], 'local')
        self.assertEqual(result['guidance_reason'], 'delivery_variation')
        self.assertEqual(result['provider'], 'meta')
        self.assertTrue(result['live'])
        self.assertIn('When another delivery is available', result['first_step'])
        self.assertNotIn('This shows how much', json.dumps(result))

    def test_recognized_assistant_history_is_not_replayed(self):
        request = simple_request()
        unsafe = 'Sample one delivery. This shows how the mix shifts between deliveries.'
        request['history'] = [{'role': 'assistant', 'content': unsafe},
                              {'role': 'user', 'content': 'Can one delivery tell me about variation?'}]
        client = FixtureClient(simple_response())
        read_project_intake(request, client=client)
        self.assertNotIn(unsafe, json.dumps(client.prompt))
        self.assertEqual(client.prompt['history'][1], request['history'][1])

    def test_negations_and_comparisons_with_other_deliveries_remain_available(self):
        safe = (
            'One delivery does not show how the mix shifts between deliveries.',
            'One delivery cannot show the variation across batches.',
            'Compare one delivery with another delivery. This shows how the mix shifts between deliveries.',
            'Sample one delivery and the next delivery. This shows differences across deliveries.',
            'For one delivery record what you observe. When another is available, compare the records.',
        )
        for text in safe:
            with self.subTest(text=text): self.assertFalse(has_single_delivery_comparison(text))

    def test_different_phrasings_of_the_bounded_failure(self):
        for text in ('Sample one delivery. This shows how the mix shifts between deliveries.',
                     'Check only one batch. This reveals changes across batches.',
                     'Observe a single shipment; this establishes differences among shipments.'):
            with self.subTest(text=text): self.assertTrue(has_single_delivery_comparison(text))


if __name__ == '__main__': unittest.main()
