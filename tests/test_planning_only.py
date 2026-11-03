"""Regression tests for the explicitly planning-only case in the decision journey."""
from copy import deepcopy
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case, plan_trial
from reshivo.meta import MetaValidationError
from reshivo.planning_only import is_planning_only, planning_version
from reshivo.project_intake import read_project_intake
from test_project_intake import FixtureClient as IntakeClient, simple_request, simple_response
from test_wet_slip_advisor import FakeClient, follow_data, help_data, mat_request, route, trial_data


class PlanningOnlyTests(unittest.TestCase):
    def test_fixture_response_keeps_number_as_a_scenario_and_digital_action(self):
        request = mat_request()
        request['brief']['process'] = ('Home planning only. No physical handling, processing, '
                                       'measuring equipment, or lab access is available during this exercise.')
        data = follow_data()
        data['answer'] = ('Add 0.3 kg of the same zero-paper rubber to that 1-kg portion to reach 4% paper '
                          'by arithmetic (0.052 kg divided by 1.3 kg). This covers only that known portion.')
        digital = 'Add the missing synthetic wet-grip entry for current A with conditions confirmed.'
        data['next_steps'] = [digital]
        original = deepcopy(data)
        result = follow_up_with_case(request, FakeClient(data))
        self.assertIn('For planning, the proposed addition is 0.3 kg', result['answer'])
        self.assertIn('This covers only that known portion.', result['answer'])
        self.assertEqual(result['next_steps'], [digital])
        self.assertTrue(result['guidance_adjusted'])
        self.assertEqual(result['provider'], 'fixture')
        self.assertEqual(data, original)

    def test_physical_actions_are_replaced_in_routes_and_trials(self):
        request = mat_request(); request['brief']['process'] = 'No physical handling this week.'
        data = help_data(); data['material_routes'][0]['steps'] = ['Add material to the setup.']
        data['engineering_routes'][0]['steps'] = ['Mix the rubber and binder.']
        result = help_with_case(request, FakeClient(data))
        self.assertTrue(result['guidance_adjusted'])
        self.assertNotIn('Add material', result['material_routes'][0]['steps'][0])
        self.assertNotIn('Mix the rubber', result['engineering_routes'][0]['steps'][0])
        trial = trial_data(); trial['steps'] = [{'action':'Weigh the rubber sample.', 'record':'Write the mass.'},
                                                {'action':'Compare the recorded results.', 'record':'Note the difference.'}]
        plan = plan_trial({'brief': request['brief'], 'route': route()}, FakeClient(trial))
        self.assertTrue(plan['guidance_adjusted'])
        self.assertEqual(plan['steps'][1]['action'], 'Compare the recorded results.')
        self.assertEqual(plan['checks'][0]['target'], trial['checks'][0]['target'])

    def test_imperative_in_trial_target_or_property_is_rejected_unchanged(self):
        request = mat_request(); request['brief']['process'] = 'No physical handling this week.'
        for field in ('target', 'property'):
            data = trial_data(); data['checks'][0][field] = 'Add rubber to the sample.'
            if field == 'target':
                request['brief']['targets'] = data['checks'][0]['target']
            with self.subTest(field=field), self.assertRaisesRegex(MetaValidationError, 'planning check'):
                plan_trial({'brief': request['brief'], 'route': route()}, FakeClient(data))

    def test_explicit_narrow_limits_are_not_a_blanket_no_handling_rule(self):
        for process in ('I can handle materials but have no processing equipment.',
                        'No physical testing is available, but I can sort the material.',
                        'I can mix by hand but cannot process with heat.'):
            request = mat_request(); request['brief']['process'] = process
            self.assertFalse(is_planning_only(request))
            data = follow_data(); data['answer'] = 'Sort the rubber pieces.'
            result = follow_up_with_case(request, FakeClient(data))
            self.assertEqual(result['answer'], data['answer'])
            self.assertNotIn('guidance_adjusted', result)

    def test_no_handling_does_not_come_from_assistant_history(self):
        request = mat_request(); request['history'] = [{'role':'assistant','content':'No physical handling.'}]
        self.assertFalse(is_planning_only(request))
        request['history'].append({'role':'user','content':'I cannot handle the material this week.'})
        self.assertTrue(is_planning_only(request))

    def test_current_handling_permission_overrides_older_restriction(self):
        old = [{'role': 'user', 'content': 'I cannot handle the material this week.'}]
        for request in (
            {'brief': {'process': 'I can now handle the material safely.'}},
            {'brief': {'process': 'No physical handling this week.'},
             'question': 'I can now handle the material safely.', 'history': old},
            {'message': 'I have no physical handling restrictions.', 'history': old},
            {'history': old + [{'role': 'user', 'content': 'I can now mix the identified material.'}]},
            {'brief': {'process': 'I can now handle the material safely.'}, 'history': old},
        ):
            with self.subTest(request=request):
                self.assertFalse(is_planning_only(request))
        self.assertTrue(is_planning_only({'message': 'No physical handling this week.'}))
        self.assertTrue(is_planning_only({'message': 'I can handle the material later, but no physical work now.'}))
        self.assertTrue(is_planning_only({
            'brief': {'process': 'No physical handling this week.'},
            'question': 'What should I do next?',
            'history': [{'role': 'user', 'content': 'I can handle the material.'}],
        }))
        for text in ('I can handle the material later.', 'I can handle the material next week.',
                     'I can handle the material when equipment arrives.'):
            with self.subTest(future_permission=text):
                self.assertTrue(is_planning_only({'brief': {'process': 'No physical handling this week.'},
                                                  'question': text}))

    def test_conflicting_fields_at_same_priority_remain_restricted(self):
        for brief in (
            {'process': 'I can handle the material.', 'constraints': 'No physical handling this week.'},
            {'constraints': 'No physical handling this week.', 'process': 'I can handle the material.'},
        ):
            with self.subTest(brief=brief):
                self.assertTrue(is_planning_only({'brief': brief}))
        self.assertTrue(is_planning_only({'question': 'I can handle the material.',
                                          'message': 'No physical handling this week.'}))

    def test_questions_negations_and_digital_steps_are_unchanged(self):
        for text in ('Add the missing synthetic wet-grip entry for current A with conditions confirmed.',
                     'Add a reading for the material.',
                     'Do not mix the rubber.',
                     'Can you sort the material later?',
                     'Compare the synthetic grip readings.',
                     'Add 5 kg of rubber to the cost calculator.',
                     'Add 5 kg of rubber to the setup in the app.'):
            with self.subTest(text=text):
                result, changed = planning_version({'answer': text})
                self.assertFalse(changed)
                self.assertEqual(result['answer'], text)

    def test_compound_physical_actions_are_not_rewritten_as_a_simple_amount(self):
        for original in ('Add 0.3 kg of rubber and mix the material.',
                         'Add 0.3 kg of rubber, then use a press.',
                         'Add 0.3 kg of rubber and stir the mixture.',
                         'Add 5 kg of rubber to the cost calculator and mix it.'):
            with self.subTest(original=original):
                result, changed = planning_version({'answer': original})
                self.assertTrue(changed)
                self.assertNotIn(original, result['answer'])
                self.assertIn('plan this step', result['answer'])

    def test_advice_worded_as_a_recommendation_remains_a_planning_quantity(self):
        data = follow_data()
        data['answer'] = 'You should add 0.3 kg of rubber to the sample.'
        request = mat_request(); request['brief']['process'] = 'No physical handling this week.'
        result = follow_up_with_case(request, FakeClient(data))
        self.assertEqual(result['answer'], 'For planning, the proposed addition is 0.3 kg of rubber to the sample.')
        self.assertTrue(result['guidance_adjusted'])

    def test_intake_marks_edited_planning_guidance_and_preserves_draft(self):
        request = simple_request(); request['message'] += ' No physical handling this week.'
        data = simple_response(); data['first_step'] = 'Add 0.3 kg of rubber to the sample.'
        result = read_project_intake(request, client=IntakeClient(data))
        self.assertEqual(result['project_draft'], data['project_draft'])
        self.assertEqual(result['guidance_origin'], 'local')
        self.assertEqual(result['guidance_reason'], 'planning_only')
        self.assertIn('For planning, the proposed addition is 0.3 kg', result['first_step'])
        self.assertEqual(result['provider'], 'meta')


if __name__ == '__main__': unittest.main()
