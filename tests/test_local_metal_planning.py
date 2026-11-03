"""Local planning for the user's uncharacterized metal-residue case."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from rematter.advisor import help_with_case, follow_up_with_case, plan_trial
from rematter.project_intake import read_project_intake
from rematter.unknown_metal_planning import needs_local_metal_planning
from test_home_unknown_dust import FakeClient, brief, payload


class NeverCall:
    def generate(self, *args, **kwargs):
        raise AssertionError('A provider must not be called for local planning.')


def advice_request(material='Mostly metal dust and cable-plastic residue.', process=''):
    b = brief(material)
    b['process'] = process
    return {'brief': b, 'question': 'What can I do with this batch?', 'history': []}


def route():
    return {'id': 'material:one', 'title': 'Old proposal', 'change': 'Historical idea only',
            'why': 'Previously suggested', 'steps': ['Prior step'], 'tradeoffs': ['Unknown'], 'check': 'Unknown'}


class LocalMetalPlanningTests(unittest.TestCase):
    def test_all_advisor_entry_points_use_local_response_without_a_model(self):
        request = advice_request()
        for operation in ('help', 'followup', 'trial'):
            with self.subTest(operation=operation):
                if operation == 'help': result = help_with_case(request, client=NeverCall())
                elif operation == 'followup': result = follow_up_with_case(request, client=NeverCall())
                else: result = plan_trial({'brief': request['brief'], 'route': route()}, client=NeverCall())
                self.assertEqual(result['result_kind'], 'local_planning_guidance')
                self.assertEqual(result['origin'], 'local')
                self.assertEqual(result['provider'], 'local')
                self.assertEqual(result['model'], 'Local planning guide')
                self.assertFalse(result['live']); self.assertFalse(result['physical_product_tested']); self.assertFalse(result['performance_verified'])
                for key in ('usage', 'request_id', 'elapsed_ms', 'requested_reasoning_effort', 'quarantined_answer', 'material_routes', 'engineering_routes', 'selected_route'):
                    self.assertNotIn(key, result)
                self.assertIn('Leave the material undisturbed where it is', result['answer'])
                self.assertIn('If it is loose or open, leave it as-is', result['answer'])
                self.assertIn('If relevant to your product and suitable presealed units already exist', result['answer'])
                self.assertIn('without opening them', result['answer'])
                self.assertIn('If mass matters and a suitable scale is available', result['next_steps'][2])
                self.assertTrue(any('facility' in question for question in result['questions']))
                self.assertNotIn('9.8', result['answer'])

    def test_no_key_or_client_construction_for_local_advice(self):
        with patch('rematter.advisor.MetaClient', side_effect=AssertionError('no provider')):
            self.assertEqual(follow_up_with_case(advice_request())['origin'], 'local')

    def test_local_intake_keeps_literal_user_words_and_no_invented_product(self):
        original = 'I have mostly metal dust and cable-plastic residue and want a counterweight.'
        with patch('rematter.project_intake.MetaClient', side_effect=AssertionError('no provider')):
            result = read_project_intake({'message': original})
        self.assertEqual(result['result_kind'], 'project_intake')
        self.assertEqual(result['origin'], 'local'); self.assertFalse(result['live'])
        self.assertEqual(result['project_draft']['input'], {'value': original, 'quote': original, 'source': 'message'})
        self.assertIsNone(result['project_draft']['product'])
        self.assertIsNone(result['project_draft']['use'])
        self.assertFalse(result['interpretation_verified']); self.assertFalse(result['ready_for_calculation'])
        self.assertNotIn('usage', result); self.assertNotIn('request_id', result)
        self.assertLessEqual(len(result['first_step']), 700)
        self.assertIn('no AI request was sent', result['reply'])

    def test_intake_long_message_uses_exact_excerpt_and_explains_partial_copy(self):
        original = 'x' * 1100 + ' I have metal filings. ' + 'y' * 1100
        result = read_project_intake({'message': original}, client=NeverCall())
        record = result['project_draft']['input']
        self.assertEqual(record['value'], 'metal filings'); self.assertIn(record['quote'], original)
        self.assertIn('only a short quoted phrase', result['reply'])

    def test_reviewed_input_is_never_replaced_by_old_user_history(self):
        value = 'Metal dust and polymer scraps, amount unknown.'
        reviewed = {key: None for key in ('product','input','variation','use','priorities','process','constraints')}
        reviewed['input'] = {'value': value, 'source': 'user_review', 'quote': value}
        result = read_project_intake({'message':'Please continue.', 'reviewed_draft':reviewed,
                                      'history':[{'role':'user','content':'Earlier metal powder.'}]}, client=NeverCall())
        self.assertEqual(result['project_draft']['input']['value'], value)

    def test_flat_home_and_no_location_all_get_local_planning(self):
        for text in ('Metal dust in my flat.', 'Unidentified metal fines.', 'Metal filings and plastic residue.',
                     'Metal powder and binder.', 'Unidentified aluminum dust.', 'Powder is metal.'):
            with self.subTest(text=text):
                self.assertTrue(needs_local_metal_planning({'message': text}))
                self.assertEqual(read_project_intake({'message': text}, client=NeverCall())['origin'], 'local')

    def test_plain_plastic_powder_and_flour_do_not_trigger_metal_only_guidance(self):
        for text in ('Unidentified recycled plastic powder for a floor mat.', 'Unknown flour powder for packaging.',
                     'Unidentified plastic powder and copper wire as binder.'):
            with self.subTest(text=text): self.assertFalse(needs_local_metal_planning({'message': text}))

    def test_named_metal_and_facility_must_bind_same_particulate_stream(self):
        context = {'brief': {'input': 'Generic metal dust', 'variation':'Copper metal dust is another stream',
                             'process':'I have access to a suitable industrial facility.'}}
        self.assertTrue(needs_local_metal_planning(context))
        context['brief']['input'] = 'Copper metal dust'
        self.assertFalse(needs_local_metal_planning(context))
        context['brief']['process'] = 'The facility may be available.'
        self.assertTrue(needs_local_metal_planning(context))

    def test_prior_assistant_proposals_and_stale_setup_notes_do_not_trigger(self):
        case = {'message': 'I have recycled fabric and want a sheet.',
                'history': [{'role':'assistant', 'content':'Use unidentified metal dust.'}],
                'trial_ideas': {'x@1': {'change':'Add metal dust'}},
                'project_context': {'configurations': [
                    {'id':'A','revision':1,'materials':[{'name':'Unidentified metal filings'}]},
                    {'id':'A','revision':2,'materials':[{'name':'Fabric offcuts'}], 'notes':'Old idea used metal dust.'}]}}
        self.assertFalse(needs_local_metal_planning(case))

    def test_current_setup_and_user_history_trigger_but_assistant_history_does_not(self):
        case = {'message':'What can I do next?', 'history':[{'role':'user','content':'My metal dust varies.'},
                {'role':'assistant','content':'Old proposal.'}]}
        self.assertTrue(needs_local_metal_planning(case))
        case = {'brief':{'input':'Mixed materials'},'project_context':{'configurations':[{'id':'A','revision':1,
                'materials':[{'name':'Metal fines'}], 'process':'Unknown', 'geometry':'Unknown'}]}}
        self.assertTrue(needs_local_metal_planning(case))

    def test_calculation_component_and_bound_plan_case_trigger(self):
        self.assertTrue(needs_local_metal_planning({'calculation_context': {'components':[{'name':'Metal filings'}]}}))
        self.assertTrue(needs_local_metal_planning({'plan': {'case': {'components':[{'name':'Metal powder'}], 'process':'Unknown'}}}))
        self.assertFalse(needs_local_metal_planning({'plan': {'actions':['Add metal dust'], 'case': {'components':[{'name':'Fabric'}], 'process':'Unknown'}}}))

    def test_other_product_gets_generic_planning_without_assuming_counterweight(self):
        request = advice_request(); request['brief']['product'] = 'A planter sleeve'
        result = help_with_case(request, client=NeverCall())
        self.assertNotIn('counterweight', result['answer'].lower())
        self.assertIn('Where relevant', result['answer'])
        self.assertIn('If mass matters', result['next_steps'][2])

    def test_identified_metal_and_confirmed_facility_can_use_normal_advice(self):
        request = advice_request('Identified copper metal dust.', 'I have access to a suitable industrial facility.')
        client = FakeClient(payload('A prior conditional suggestion.'))
        result = follow_up_with_case(request, client=client)
        self.assertEqual(result['result_kind'], 'engineering_followup')
        self.assertIsNotNone(client.prompt)

    def test_home_overrides_facility_availability_for_identified_metal(self):
        for material in ('Copper dust', 'Identified copper metal dust'):
            for place in ('home', 'flat', 'garage'):
                with self.subTest(material=material, place=place):
                    request = advice_request(material, f'I am working in my {place}. I have access to a suitable industrial facility.')
                    result = follow_up_with_case(request, client=NeverCall())
                    self.assertEqual(result['result_kind'], 'local_planning_guidance')
                    self.assertFalse(result['live'])
        self.assertFalse(needs_local_metal_planning({'brief': {'input': 'Copper dust',
            'process': 'I have access to a suitable industrial facility.'}}))

    def test_local_message_retains_questions_and_no_fake_model_metadata(self):
        request = advice_request(); before = deepcopy(request)
        result = help_with_case(request, client=NeverCall())
        self.assertEqual(request, before)
        self.assertNotIn('source_ids', result)
        self.assertNotIn('model', {k: v for k, v in result.items() if k == 'model' and v != 'Local planning guide'})


if __name__ == '__main__': unittest.main()
