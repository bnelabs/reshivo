"""Bounded checks for one observed two-condition acoustic-comparison error."""
from copy import deepcopy
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case, plan_trial
from reshivo.advice_corrections import correct_specific_advice
from test_advisor import FixtureClient, brief_request, response_data, route, trial_data, trial_request
from test_advisor_followup import FixtureClient as FollowupClient, request_data as followup_request, response_data as followup_response


BAD_ANSWER = ('A sealed decoupled mounting tests how much of the result comes from gaps and rigid contact '
              'versus the sheet itself.')
BAD_WHY = ('Gaps and rigid connections can dominate voice transfer; this assembly comparison may help '
           'show what the sheet adds beyond sealing and decoupling.')
BAD_STEP = 'Re-measure and compare against the bare wall to separate mounting effects from sheet effects.'
CHECK = ('Compare frequency-dependent transmission loss of the same wall build-up with and without '
         'the sealed decoupled panel, at the voice range and installation you define.')
JOINT_CHECK = ('Compare transmission change for the same wall: bare wall versus wall with panel '
               'mounted and perimeter-sealed, using the same voice-range excitation and room setup; '
               'add a sealed-versus-unsealed-joint comparison to separate panel effect from sealing effect.')
JOINT_CHECK_VARIANT = ('Compare frequency-dependent transmission loss for the same wall bare versus wall with '
                       'mounted sealed panel; add a with-seal versus without-seal comparison to separate panel '
                       'change from sealing/mounting change for that installation.')
ENERGY = 'Heated equipment and energy demand are higher than cold pressing.'
MODULAR = 'Modular panels can contain batch variation by replacing single panels, but joints must be detailed to avoid leaks.'


class WallComparisonTests(unittest.TestCase):
    def test_observed_claims_are_corrected_without_discarding_the_path(self):
        data = response_data()
        data['answer'] = BAD_ANSWER
        data['material_routes'] = [{**route('wall'), 'why': BAD_WHY, 'steps': [BAD_STEP], 'check': CHECK}]
        data['engineering_routes'] = []
        original = deepcopy(data)
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertEqual(data, original, 'the supplied model output is not mutated')
        self.assertTrue(result['comparison_adjusted'])
        self.assertIn('combined change', result['answer'])
        candidate = result['material_routes'][0]
        self.assertIn('combined change', candidate['why'])
        self.assertIn('additional suitable controlled comparisons', candidate['steps'][0])
        self.assertEqual(candidate['check'], CHECK)
        self.assertEqual(candidate['change'], data['material_routes'][0]['change'])

    def test_followup_and_trial_record_the_correction(self):
        response = followup_response()
        response['answer'] = BAD_ANSWER
        followup = follow_up_with_case(followup_request(), FollowupClient(response))
        self.assertTrue(followup['comparison_adjusted'])
        self.assertIn('combined change', followup['answer'])
        trial = trial_data()
        trial['steps'][0]['action'] = BAD_STEP
        result = plan_trial(trial_request(), FixtureClient(trial))
        self.assertTrue(result['comparison_adjusted'])
        self.assertIn('combined change', result['steps'][0]['action'])

    def test_observed_tradeoffs_and_joint_comparison_are_precisely_corrected(self):
        data = response_data()
        data['material_routes'] = [{**route('wall'), 'tradeoffs': [ENERGY, MODULAR], 'check': JOINT_CHECK}]
        data['engineering_routes'] = []
        result = help_with_case(brief_request(), FixtureClient(data))
        candidate = result['material_routes'][0]
        self.assertTrue(result['comparison_adjusted'])
        self.assertEqual(candidate['tradeoffs'], [
            'Compare the equipment, energy, binder and curing costs for both routes.',
            'Consider individually replaceable panels and detail the joints to address possible gaps.',
        ])
        self.assertTrue(candidate['check'].startswith('Compare transmission change for the same wall: bare wall versus wall with panel mounted and perimeter-sealed, using the same voice-range excitation and room setup;'))
        self.assertIn('same mounted panel to assess the change associated with joint sealing in that assembly', candidate['check'])
        self.assertNotIn('separate panel effect from sealing effect', candidate['check'])

    def test_second_observed_joint_comparison_keeps_wall_measurement_and_scope(self):
        data = response_data()
        data['material_routes'] = [{**route('wall'), 'check': JOINT_CHECK_VARIANT}]
        data['engineering_routes'] = []
        result = help_with_case(brief_request(), FixtureClient(data))
        self.assertTrue(result['comparison_adjusted'])
        check = result['material_routes'][0]['check']
        self.assertTrue(check.startswith('Compare frequency-dependent transmission loss for the same wall bare versus wall with mounted sealed panel;'))
        self.assertIn('same mounted panel to estimate the joint-sealing change for that installation', check)
        self.assertNotIn('separate panel change from sealing/mounting change', check)
        self.assertEqual(data['material_routes'][0]['check'], JOINT_CHECK_VARIANT)

    def test_valid_and_unrelated_wording_is_left_alone(self):
        for text in (
            'Compare the bare wall with the mounted panel to measure the combined change.',
            'Keep the mounting fixed and compare two panels to study their difference.',
            'A bare wall and mounted sheet cannot separate the mounting and sheet effects.',
            'Compare the weight of the wall brackets and sheet for shipping.',
            'Do not re-measure and compare against the bare wall to separate mounting effects from sheet effects.',
            'Never assume a sealed decoupled mounting tests how much of the result comes from gaps and rigid contact versus the sheet itself.',
            'Do not assume heated equipment and energy demand are higher than cold pressing.',
            'Never assume modular panels can contain batch variation by replacing single panels, but joints must be detailed to avoid leaks.',
            'Do not add a sealed-versus-unsealed-joint comparison to separate panel effect from sealing effect.',
            'Do not add a with-seal versus without-seal comparison to separate panel change from sealing/mounting change.',
        ):
            with self.subTest(text=text):
                self.assertEqual(correct_specific_advice(text), (text, False))

    def test_only_explicit_independent_controls_exempt_a_route(self):
        basic = {**route('wall'), 'why': BAD_WHY, 'steps': [BAD_STEP], 'check': CHECK}
        both = {**basic, 'steps': [BAD_STEP, 'Test a mounting-only control and a panel-only control.']}
        self.assertEqual(correct_specific_advice(both), (both, False))
        joint_with_controls = {**both, 'check': JOINT_CHECK_VARIANT}
        self.assertEqual(correct_specific_advice(joint_with_controls), (joint_with_controls, False))
        for unproven in (
            'Test a mounting-only control.',
            'Do not test a mounting-only control or a panel-only control.',
            'Ask whether to test a mounting-only control and a panel-only control.',
            'If possible, test a mounting-only control and a panel-only control.',
        ):
            with self.subTest(control=unproven):
                corrected, changed = correct_specific_advice({**basic, 'steps': [BAD_STEP, unproven]})
                self.assertTrue(changed)
                self.assertIn('combined change', corrected['steps'][0])
                self.assertEqual(corrected['steps'][1], unproven)

    def test_a_different_route_is_not_a_control_for_this_one(self):
        first = {**route('wall'), 'steps': [BAD_STEP]}
        second = {**route('other'), 'steps': ['Test a mounting-only control and a panel-only control.']}
        corrected, changed = correct_specific_advice([first, second])
        self.assertTrue(changed)
        self.assertIn('combined change', corrected[0]['steps'][0])
        self.assertEqual(corrected[1], second)

    def test_valid_controls_do_not_exempt_unsubstantiated_cost_or_variation_claims(self):
        candidate = {**route('wall'), 'steps': ['Test a mounting-only control and a panel-only control.'],
                     'tradeoffs': [ENERGY, MODULAR]}
        corrected, changed = correct_specific_advice(candidate)
        self.assertTrue(changed)
        self.assertEqual(corrected['steps'], candidate['steps'])
        self.assertIn('Compare the equipment', corrected['tradeoffs'][0])
        self.assertIn('individually replaceable panels', corrected['tradeoffs'][1])


if __name__ == '__main__':
    unittest.main()
