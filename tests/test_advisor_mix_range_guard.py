"""Calculation-backed advice never exposes unvalidated generated claims."""
from copy import deepcopy
from fractions import Fraction
import json
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case
from reshivo.meta import Generation, MetaAPIError, MetaValidationError
from test_advisor_project_context import response
from test_mix_calculation_context import prepared


class Client:
    def __init__(self, data):
        self.data = data
        self.calls = []

    def generate(self, prompt, schema, count, **options):
        self.calls.append((json.loads(prompt), schema, count, options))
        return Generation(deepcopy(self.data), 'fixture-model', False, {}, 'fixture', 1)


def case():
    data = prepared()
    data['mix_calculation']['source'] = None
    data['mix_calculation']['inputs'].update(
        input_mass_kg=20, input_min_percent=2, input_max_percent=5,
        addition_percent=0, target_min_percent=0, target_max_percent=2.9,
    )
    return data


def visible(result):
    return json.dumps({key: result.get(key) for key in (
        'answer', 'next_steps', 'questions', 'sources', 'quarantined_answer',
        'material_routes', 'engineering_routes')}, ensure_ascii=False)


class BoundMixAdviceTests(unittest.TestCase):
    def test_calculation_and_selected_actions_are_separate_from_model_prose(self):
        for operation in (follow_up_with_case, help_with_case):
            client = Client({'action_ids': ['work_with_available', 'separate_component', 'compare_specimens']})
            result = operation(case(), client=client)
            minimum = result['mix_calculation']['result']['exact_addition_kg']['min']
            self.assertEqual(Fraction(int(minimum['numerator']), int(minimum['denominator'])), Fraction(420, 29))
            self.assertEqual(len(result['next_steps']), 3)
            self.assertIn('separate labelled portions', visible(result).lower())
            self.assertIn('at least three separate samples per option', visible(result).lower())
            self.assertIn('safe handling is available', visible(result).lower())
            self.assertIn('required equipment and settings', visible(result).lower())
            self.assertEqual(result['sources'], [])
            self.assertEqual(set(client.calls[0][1]['properties']), {'action_ids'})
            self.assertNotIn('14.48', visible(result))

    def test_unrecognized_payloads_never_leak_model_text(self):
        attacks = [
            {'answer': 'Use 14.48 kg; all properties pass', 'next_steps': ['Heat it now'], 'questions': [], 'source_ids': []},
            {'action_ids': ['separate_component', '14.48 kg meets the target']},
            {'action_ids': ['work_with_available'], 'explanation': '14.48 kg is exact'},
            {'action_ids': ['work_with_available', 'work_with_available']},
            {'action_ids': ['on dört kilo yeterli']},
        ]
        for operation in (follow_up_with_case, help_with_case):
            for attack in attacks:
                with self.subTest(operation=operation.__name__, attack=attack):
                    result = operation(case(), client=Client(attack))
                    text = visible(result)
                    for phrase in ('14.48 kg', 'all properties pass', 'Heat it now', 'on dört kilo'):
                        self.assertNotIn(phrase, text)
                    self.assertEqual(result['provider'], 'local')
                    self.assertTrue(result['next_steps'], 'fallback gives a practical plan')
                    self.assertFalse(result['performance_verified'])

    def test_infeasible_singleton_and_unbounded_results_stay_authoritative(self):
        data = case(); inputs = data['mix_calculation']['inputs']
        inputs.update(input_mass_kg=1, input_min_percent=25, input_max_percent=25,
                      addition_percent=0, target_min_percent=20, target_max_percent=20)
        result = follow_up_with_case(data, client=Client({'action_ids': ['check_fraction']}))
        self.assertEqual(result['mix_calculation']['result']['exact_addition_kg']['min'], {'numerator': '1', 'denominator': '4'})
        inputs.update(addition_percent=20, target_min_percent=20, target_max_percent=25)
        result = follow_up_with_case(data, client=Client({'action_ids': ['compare_costs']}))
        self.assertIsNone(result['mix_calculation']['result']['exact_addition_kg']['max'])
        inputs.update(addition_percent=30, target_min_percent=10, target_max_percent=20)
        result = follow_up_with_case(data, client=Client({'action_ids': ['work_with_available']}))
        self.assertFalse(result['mix_calculation']['result']['feasible'])
        self.assertIn('No single addition', result['answer'])
        self.assertIn('Plan with available material', result['next_steps'][0])
        self.assertIn('Check the changing component', result['next_steps'][1])

    def test_infeasible_result_always_keeps_a_within_stock_route(self):
        data = case()
        data['mix_calculation']['inputs'].update(addition_percent=30, target_min_percent=0, target_max_percent=1)
        for operation in (follow_up_with_case, help_with_case):
            result = operation(data, client=Client({'action_ids': ['compare_costs']}))
            self.assertFalse(result['mix_calculation']['result']['feasible'])
            self.assertIn('Plan with available material', result['next_steps'][0])
            self.assertIn('Check the changing component', result['next_steps'][1])
            self.assertIn('Compare making costs', result['next_steps'][2])
            self.assertLessEqual(len(result['next_steps']), 3)
            self.assertIn('if safe handling is available', result['next_steps'][0])
            self.assertIn('Keeping the same entered percentages', result['next_steps'][0])
            if operation is help_with_case:
                self.assertIn('another portion may have a different composition', result['material_routes'][0]['why'])

    def test_invalid_response_falls_back_but_network_errors_still_surface(self):
        class FailedClient:
            def __init__(self, failure): self.failure = failure
            def generate(self, *args, **kwargs): raise self.failure
        result = follow_up_with_case(case(), client=FailedClient(MetaValidationError('invalid JSON')))
        self.assertEqual(result['provider'], 'local')
        self.assertTrue(result['next_steps'])
        with self.assertRaises(MetaAPIError):
            follow_up_with_case(case(), client=FailedClient(MetaAPIError('connection unavailable')))

    def test_fallback_diagnostics_never_log_provider_text(self):
        class FailedClient:
            def generate(self, *args, **kwargs): raise MetaValidationError('cut short PRIVATE_RESPONSE')
        with self.assertLogs('reshivo.advisor', level='WARNING') as logs:
            result = follow_up_with_case(case(), client=FailedClient())
        self.assertIn('truncated', ' '.join(logs.output))
        self.assertNotIn('PRIVATE_RESPONSE', ' '.join(logs.output))
        self.assertEqual(result['provider'], 'local')
        self.assertGreaterEqual(result['elapsed_ms'], 0)

    def test_without_attachment_general_model_answer_is_unchanged(self):
        data = case(); data.pop('mix_calculation')
        generated = response(True)
        result = follow_up_with_case(data, client=Client(generated))
        self.assertEqual(result['answer'], generated['answer'])
        self.assertEqual(result['next_steps'], generated['next_steps'])


if __name__ == '__main__':
    unittest.main()
