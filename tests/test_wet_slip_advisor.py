"""Bounded checks for person-on-surface wet-grip advice and replay."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest

from reshivo.advisor import help_with_case, follow_up_with_case, plan_trial
from reshivo.meta import MetaValidationError
from reshivo.products import ProductInputError


def mat_request():
    return {'brief': {'input':'Recycled rubber granules','variation':'Particle sizes vary',
        'contamination':'Unknown','product':'Floor mat','use_case':'Wet indoor entrance',
        'targets':'Wet grip and easy cleaning','process':'Home with scissors and cool water',
        'available_changes':'Can change layout'}, 'question':'What should I try next?', 'history':[]}


def route():
    return {'id':'material:a', 'title':'Compare sizes', 'change':'Sort the pieces',
        'why':'Compare preparation approaches', 'steps':['Sort into two sizes'],
        'tradeoffs':['Requires separate handling'], 'check':'Choose a suitable grip assessment'}


def follow_data():
    return {'answer':'Compare two sizes in separate trays.', 'next_steps':['Plan a contained comparison.'],
        'questions':['Which containers are available?'], 'source_ids':[]}


def help_data():
    return {'answer':'Compare two sizes in separate trays.',
        'material_routes':[route(),{**route(),'id':'material-b'}],
        'engineering_routes':[{**route(),'id':'engineering-a'},{**route(),'id':'engineering-b'}],
        'next_steps':['Compare sizes.','Choose a grip method.'],
        'questions':['Which trays are available?'],'source_ids':[]}


def trial_data():
    return {'title':'Compare the sizes', 'objective':'Compare two sizes', 'comparison':'Keep one variable different',
        'change':'Use a different size', 'keep_fixed':['Use the same container'], 'materials':['Two containers'],
        'steps':[{'action':'Compare the contained pieces','record':'Record size'}],
        'checks':[{'property':'Grip','target':'Wet grip and easy cleaning','method':'Choose a suitable measurement',
                   'if_outside':'Consider a different surface design'}], 'questions':[], 'source_ids':[]}


class FakeClient:
    def __init__(self, data):
        self.data, self.calls = data, 0
    def generate(self, *args, **kwargs):
        self.calls += 1
        return SimpleNamespace(data=deepcopy(self.data), live=False, provider='fixture', model='fixture',
            usage={}, elapsed_ms=0, request_id='fixture', reasoning_effort=None)


def project_context():
    return {'case_id':'case','configurations':[{'id':'setup','revision':1,'name':'A setup',
        'materials':[{'id':'rubber','name':'rubber','amount':'','unit':'kg'}],
        'process':'','geometry':'','notes':''}], 'checks':[],'records':[], 'assessment_kind':'user_reported'}


def idea():
    return {'title':'A saved idea','change':'Sort the pieces','why':'Explore preparation',
        'steps':['Sort the pieces'], 'tradeoffs':['Needs containers'], 'check':'Choose a grip method',
        'provider':'fixture','model':'fixture'}


class WetSlipAdvisorTests(unittest.TestCase):
    def test_followup_checks_every_user_facing_field(self):
        for field, unsafe in [('answer','Walk across the wet prototype to check grip.'),
                              ('next_steps',['Stand on the wet mat and take several steps.']),
                              ('questions',['Can you walk on it to check grip?'])]:
            data=follow_data(); data[field]=unsafe
            with self.subTest(field=field), self.assertRaisesRegex(MetaValidationError,'another way'):
                follow_up_with_case(mat_request(), FakeClient(data))

    def test_help_checks_routes_and_summary_before_return(self):
        for field in ('title','change','why','steps','tradeoffs','check'):
            data=help_data(); data['material_routes'][0][field]=['Walk across the wet mat.'] if field in ('steps','tradeoffs') else 'Walk across the wet mat.'
            with self.subTest(field=field), self.assertRaises(MetaValidationError):
                help_with_case(mat_request(), FakeClient(data))
        data=help_data(); data['engineering_routes'][0]['steps']=['Stand on the wet mat.']
        with self.assertRaises(MetaValidationError): help_with_case(mat_request(), FakeClient(data))

    def test_trial_checks_step_action_record_and_property_fields(self):
        request={'brief':mat_request()['brief'],'route':route()}
        for path in (('steps',0,'action'),('steps',0,'record'),('checks',0,'method'),('checks',0,'if_outside')):
            data=trial_data(); data[path[0]][path[1]][path[2]]='Walk across the wet prototype.'
            with self.subTest(path=path), self.assertRaises(MetaValidationError):
                plan_trial(request, FakeClient(data))

    def test_user_question_is_not_filtered_but_assistant_history_is_blocked_before_call(self):
        request=mat_request(); request['question']='Should I walk across the wet prototype to test grip?'
        client=FakeClient(follow_data()); self.assertEqual(follow_up_with_case(request,client)['answer'],follow_data()['answer']); self.assertEqual(client.calls,1)
        request['history']=[{'role':'assistant','content':'Walk across the wet mat.'}]
        client=FakeClient(follow_data())
        with self.assertRaisesRegex(ProductInputError,'earlier idea'): follow_up_with_case(request,client)
        self.assertEqual(client.calls,0)

    def test_selected_idea_route_and_copied_setup_content_are_blocked_before_call(self):
        for field in ('name','notes'):
            request=mat_request();request['project_context']=project_context()
            request['project_context']['configurations'][0][field]='Walk across the wet mat.'
            client=FakeClient(follow_data())
            with self.subTest(field=field), self.assertRaises(ProductInputError): follow_up_with_case(request,client)
            self.assertEqual(client.calls,0)
        request=mat_request();request['project_context']=project_context(); saved=idea();saved['steps']=['Stand on the wet mat.'];request['trial_ideas']={'setup@1':saved}
        client=FakeClient(follow_data())
        with self.assertRaises(ProductInputError): follow_up_with_case(request,client)
        self.assertEqual(client.calls,0)
        selected=route();selected['steps']=['Stand on the wet mat.'];client=FakeClient(trial_data())
        with self.assertRaises(ProductInputError): plan_trial({'brief':mat_request()['brief'],'route':selected},client)
        self.assertEqual(client.calls,0)

    def test_safety_instructions_and_non_wet_walking_discussion_remain_available(self):
        data=follow_data();data['answer']='Do not walk on the wet prototype; choose a grip assessment.'
        self.assertEqual(follow_up_with_case(mat_request(),FakeClient(data))['answer'],data['answer'])
        data['answer']='Walk through the steps for comparing the material.'
        self.assertEqual(follow_up_with_case(mat_request(),FakeClient(data))['answer'],data['answer'])
        unrelated=mat_request(); unrelated['brief'].update(product='Desk organizer',use_case='Dry office',targets='Storage space'); unrelated['question']='How do I use my plastic?'
        data['answer']='Walk across the office to compare the lighting.'
        self.assertEqual(follow_up_with_case(unrelated,FakeClient(data))['answer'],data['answer'])

    def test_explicit_wet_walking_is_blocked_even_if_brief_lacks_wet_words(self):
        request=mat_request();request['brief'].update(product='Panel',use_case='Interior',targets='Appearance');request['question']='What should I do?'
        data=follow_data();data['answer']='Walk across the wet prototype.'
        with self.assertRaises(MetaValidationError): follow_up_with_case(request,FakeClient(data))
        data['answer']='Walk across it.'; data['next_steps']=['Wet the sample first.']
        with self.assertRaises(MetaValidationError): follow_up_with_case(request,FakeClient(data))

    def test_dry_comfort_and_loose_material_tests_are_blocked(self):
        request=mat_request();request['brief'].update(use_case='A dry indoor entry',targets='Comfort');request['question']='How can I compare comfort?'
        data=follow_data();data['answer']='Stand on the loose pieces to check comfort.'
        with self.assertRaises(MetaValidationError): follow_up_with_case(request,FakeClient(data))
        request['history']=[{'role':'assistant','content':'Stand on the loose pieces.'}]
        client=FakeClient(follow_data())
        with self.assertRaises(ProductInputError): follow_up_with_case(request,client)
        self.assertEqual(client.calls,0)

    def test_target_assurance_in_help_routes_and_followup_steps_is_held(self):
        assurance = 'You will meet your targets by making this change.'
        for section, field in (('material_routes', 'why'), ('material_routes', 'steps'),
                               ('engineering_routes', 'check')):
            data = help_data()
            data[section][0][field] = [assurance] if field == 'steps' else assurance
            with self.subTest(section=section, field=field), self.assertRaisesRegex(MetaValidationError, 'comparison with checks'):
                help_with_case(mat_request(), FakeClient(data))
        data = follow_data(); data['next_steps'] = [assurance]
        with self.assertRaisesRegex(MetaValidationError, 'comparison with checks'):
            follow_up_with_case(mat_request(), FakeClient(data))

    def test_target_assurance_in_trial_action_or_adjustment_is_held(self):
        request = {'brief': mat_request()['brief'], 'route': route()}
        for group, field in (('steps', 'action'), ('checks', 'if_outside')):
            data = trial_data()
            data[group][0][field] = 'You can meet your targets by using this design.'
            with self.subTest(group=group, field=field), self.assertRaisesRegex(MetaValidationError, 'comparison with checks'):
                plan_trial(request, FakeClient(data))

    def test_conditional_comparison_remains_available(self):
        data = follow_data()
        data['next_steps'] = ['Compare both layouts and measure grip against your target.']
        self.assertEqual(follow_up_with_case(mat_request(), FakeClient(data))['next_steps'], data['next_steps'])

    def test_recognized_surrogate_proxy_is_held_in_advice_and_history(self):
        data = follow_data(); data['next_steps'] = ['Compare containment ideas on paper for grip.']
        with self.assertRaisesRegex(MetaValidationError, 'different check'):
            follow_up_with_case(mat_request(), FakeClient(data))
        request = mat_request()
        request['history'] = [{'role': 'assistant', 'content': 'Compare layouts on paper for grip.'}]
        client = FakeClient(follow_data())
        with self.assertRaisesRegex(ProductInputError, 'different check'):
            follow_up_with_case(request, client)
        self.assertEqual(client.calls, 0)

    def test_single_delivery_comparison_is_held_in_advice_and_history(self):
        invalid = 'Observe one delivery. This shows how the mix shifts between deliveries.'
        data = follow_data(); data['next_steps'] = [invalid]
        with self.assertRaisesRegex(MetaValidationError, 'more than one delivery'):
            follow_up_with_case(mat_request(), FakeClient(data))
        request = mat_request(); request['history'] = [{'role': 'assistant', 'content': invalid}]
        client = FakeClient(follow_data())
        with self.assertRaisesRegex(ProductInputError, 'more than one delivery'):
            follow_up_with_case(request, client)
        self.assertEqual(client.calls, 0)


if __name__ == '__main__': unittest.main()
