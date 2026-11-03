"""Targeted checks for recognizable AI claims about an attached mix calculation."""
from copy import deepcopy
import json
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case
from reshivo.meta import Generation
from test_advisor_project_context import response
from test_mix_calculation_context import prepared


class Client:
    def __init__(self, data):
        self.data = data

    def generate(self, *args, **kwargs):
        return Generation(deepcopy(self.data), 'fixture-model', False, {}, 'fixture', 1)


def wide_case():
    request = prepared()
    request['mix_calculation']['source'] = None
    request['mix_calculation']['inputs'].update(
        input_mass_kg=1.5, input_min_percent=28, input_max_percent=32,
        addition_name='5%-A stock', addition_percent=5,
        target_min_percent=18, target_max_percent=22,
    )
    return request


class MixRangeGuardTests(unittest.TestCase):
    def test_real_follow_up_preserves_other_advice_and_corrects_exactly(self):
        data = response(True)
        bad = 'For 1.5 kg input, about 0.88 to 1.15 kg of 5%-A stock keeps the result inside your 18-22% trial target.'
        data['answer'] = 'Mix evenly. ' + bad + ' Check grip afterward.'
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertIn('Mix evenly.', result['answer'])
        self.assertIn('Check grip afterward.', result['answer'])
        self.assertIn('Use the checked amount in your mix calculation.', result['answer'])
        self.assertEqual(result['mix_calculation']['result']['exact_addition_kg']['min'],
                         {'numerator': '15', 'denominator': '17'})
        self.assertEqual(result['mix_calculation']['result']['exact_addition_kg']['max'],
                         {'numerator': '15', 'denominator': '13'})
        self.assertNotIn('0.88 to 1.15', json.dumps(result))
        self.assertTrue(result['mix_guidance_adjusted'])
        self.assertEqual(result['next_steps'], data['next_steps'])

    def test_help_corrects_nested_routes_without_losing_other_advice(self):
        data = response(False)
        data['material_routes'][0]['steps'][0] = 'Add 0.88–1.15 kg of 5%-A stock. Record what you added.'
        result = help_with_case(wide_case(), client=Client(data))
        step = result['material_routes'][0]['steps'][0]
        self.assertIn('Use the checked amount in your mix calculation.', step)
        self.assertIn('Record what you added.', step)
        self.assertNotIn('0.88–1.15', step)
        self.assertEqual(result['engineering_routes'][0]['title'], data['engineering_routes'][0]['title'])
        self.assertTrue(result['mix_guidance_adjusted'])

    def test_inside_range_and_unrelated_ranges_are_untouched(self):
        data = response(True)
        text = ('Add 0.89 to 1.15 kg of 5%-A stock. '
                'The input has a mass of 1 to 2 kg. Dry for 4 to 5 hours. '
                'Keep 2 to 3 kg of 5%-A stock in storage. Add 200 to 300 g of an additive. '
                'Add 2 to 3 lb of 5%-A stock. Add 2 to 3 kg of a different additive.')
        data['answer'] = text
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertEqual(result['answer'], text)
        self.assertNotIn('mix_guidance_adjusted', result)

    def test_singleton_and_unbounded_corrections(self):
        singleton = prepared(); singleton['mix_calculation']['source'] = None
        data = response(True); data['answer'] = 'Add 0.2 to 0.3 kg of zero-A stock.'
        result = follow_up_with_case(singleton, client=Client(data))
        self.assertIn('Use the checked amount in your mix calculation.', result['answer'])
        self.assertEqual(result['mix_calculation']['result']['exact_addition_kg']['min'],
                         {'numerator': '1', 'denominator': '4'})
        self.assertEqual(result['mix_calculation']['result']['exact_addition_kg']['max'],
                         {'numerator': '1', 'denominator': '4'})
        unbounded = prepared(); unbounded['mix_calculation']['source'] = None
        unbounded['mix_calculation']['inputs'].update(input_min_percent=25, input_max_percent=25,
                                                     addition_percent=20, target_min_percent=20, target_max_percent=25)
        data['answer'] = 'Add -1 to 100 kg of zero-A stock.'
        result = follow_up_with_case(unbounded, client=Client(data))
        self.assertIn('Use the checked amount in your mix calculation.', result['answer'])
        self.assertIsNone(result['mix_calculation']['result']['exact_addition_kg']['max'])

    def test_negative_instructions_and_different_stock_are_untouched(self):
        data = response(True)
        data['answer'] = ("Do not add 0.88 to 1.15 kg of 5%-A stock. "
                          "Don't add 0.88 to 1.15 kg of 5%-A stock. "
                          "Avoid adding 0.88 to 1.15 kg of 5%-A stock. "
                          "It is not true that 0.88 to 1.15 kg of 5%-A stock keeps the target. "
                          "Add 0.88 to 1.15 kg of sugar.")
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertEqual(result['answer'], data['answer'])
        self.assertNotIn('mix_guidance_adjusted', result)

    def test_unattached_calculation_does_not_change_prose(self):
        request = wide_case(); request.pop('mix_calculation')
        data = response(True); data['answer'] = 'Add 0.88 to 1.15 kg of 5%-A stock.'
        result = follow_up_with_case(request, client=Client(data))
        self.assertEqual(result['answer'], data['answer'])
        self.assertNotIn('mix_guidance_adjusted', result)

    def test_hypothetical_and_question_are_not_recast_as_recommendations(self):
        data = response(True)
        data['answer'] = ("If the target changed, add 0.88 to 1.15 kg of 5%-A stock. "
                          "When the target changes, add 0.88 to 1.15 kg of 5%-A stock. "
                          "Would 0.88 to 1.15 kg of 5%-A stock keep the target? "
                          "Should I add 0.88 to 1.15 kg of 5%-A stock. "
                          "Suppose we add 0.88 to 1.15 kg of 5%-A stock.")
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertEqual(result['answer'], data['answer'])
        self.assertNotIn('mix_guidance_adjusted', result)

    def test_earlier_or_other_case_is_not_rewritten(self):
        data = response(True)
        data['answer'] = ('For the earlier batch, add 0.88 to 1.15 kg of 5%-A stock. '
                          'For another plan, add 0.88 to 1.15 kg of 5%-A stock.')
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertEqual(result['answer'], data['answer'])
        self.assertNotIn('mix_guidance_adjusted', result)

    def test_different_stated_input_mass_is_not_rewritten(self):
        data = response(True)
        data['answer'] = 'For 5 kg input, add 0.88 to 1.15 kg of 5%-A stock.'
        result = follow_up_with_case(wide_case(), client=Client(data))
        self.assertEqual(result['answer'], data['answer'])
        self.assertNotIn('mix_guidance_adjusted', result)


if __name__ == '__main__':
    unittest.main()
