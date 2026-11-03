"""Targeted regression checks for unknown loose dust in a home-only case."""
from copy import deepcopy
import unittest

from reshivo.advisor import follow_up_with_case, help_with_case, plan_trial, SYSTEM_PROMPT, _guard_home_unknown_dust
from reshivo.meta import Generation, MetaValidationError


def brief(material='Mostly metal dust with cable-plastic residue.'):
    return {'input': material, 'variation': 'Amounts and sources change.', 'contamination': 'Unknown.',
            'product': 'Contained counterweight', 'use_case': 'Fixed ballast, no lifting.',
            'targets': 'Mass between 9.8 and 10.2 kg.',
            'process': 'Planning at home only; no suitable facility confirmed.',
            'available_changes': 'Consider enclosure and design.'}


def payload(text='Plan an enclosure and weigh a complete existing assembly.', *, kind='followup'):
    data = {'answer': text, 'next_steps': ['Plan the enclosure without handling dust.', 'Identify the metal and plastic.'],
            'questions': ['What is the metal type?'], 'source_ids': []}
    if kind == 'help':
        def route(id):
            return {'id': id, 'title': 'Plan a contained design', 'change': 'Consider an enclosure.',
                    'why': 'Its form can be explored without handling the dust.',
                    'steps': ['Sketch the interface.'], 'tradeoffs': ['Suitability remains unknown.'],
                    'check': 'Check the proposed dimensions.'}
        data.update(material_routes=[route('m1'), route('m2')], engineering_routes=[route('e1'), route('e2')])
    if kind == 'trial':
        data = {'title': 'Plan an interface', 'objective': text, 'comparison': 'Compare two drawings.',
                'change': 'Adjust the shape.', 'keep_fixed': ['Retain the mass target.'],
                'materials': ['Paper for planning.'],
                'steps': [{'action': 'Sketch one interface.', 'record': 'Record dimensions.'},
                          {'action': 'Sketch another.', 'record': 'Record differences.'}],
                'checks': [{'property': 'mass', 'target': 'Mass between 9.8 and 10.2 kg.',
                            'method': 'Weigh only a complete suitable assembly.', 'if_outside': 'Review the design.'}],
                'questions': ['What is the metal identity?'], 'source_ids': []}
    return data


class FakeClient:
    def __init__(self, value): self.value = value; self.prompt = None
    def generate(self, prompt, schema, candidates, **options):
        self.prompt = options['system_prompt']
        return Generation(deepcopy(self.value), 'fixture', False, {}, 'test', 1)


def ask(value, *, material=None, process=None, kind='followup'):
    b = brief() if material is None else brief(material)
    if process is not None: b['process'] = process
    client = FakeClient(value)
    if kind == 'trial':
        route = {'id': 'material:x', 'title': 'Plan', 'change': 'Plan enclosure', 'why': 'Explore shape',
                 'steps': ['Sketch'], 'tradeoffs': ['Unverified'], 'check': 'Check fit'}
        return plan_trial({'brief': b, 'route': route}, client=client)
    request = {'brief': b, 'question': 'What should I do next?', 'history': []}
    return (help_with_case if kind == 'help' else follow_up_with_case)(request, client=client)


class HomeDustGuardTests(unittest.TestCase):
    def assert_guard(self, value, **kwargs):
        material = kwargs.get('material')
        b = brief() if material is None else brief(material)
        if kwargs.get('process') is not None: b['process'] = kwargs['process']
        with self.assertRaises(MetaValidationError) as caught: _guard_home_unknown_dust({'brief': b, 'question': 'What should I do next?'}, value)
        message = str(caught.exception)
        self.assertIn('not shown', message)
        self.assertIn('If suitable existing presealed units are available', message)
        self.assertIn('otherwise plan the enclosure', message)
        self.assertIn('Identify the metal and plastic', message)

    def assert_guard_accepts(self, value, *, material=None, process=None):
        b = brief() if material is None else brief(material)
        if process is not None: b['process'] = process
        self.assertIsNone(_guard_home_unknown_dust({'brief': b, 'question': 'What should I do next?'}, value))

    def test_benchmark_ambiguous_fill_is_not_returned(self):
        self.assert_guard(payload('Plan a sealed enclosure. That lets final weight handle the range by adding or removing fill and reweighing.'))

    def test_generic_metal_dust_without_an_identified_metal_is_guarded(self):
        self.assert_guard(payload('Adjust the fill in the compartment.'), material='Mostly metal dust with cable-plastic residue.')
        self.assert_guard(payload('Use the dust inside the compartment.'), material='Mostly metal dust with copper cable-plastic residue.')

    def test_unidentified_and_explicit_unknown_metal_are_guarded(self):
        for material in ('Unidentified metal dust with unknown plastic binder.', 'Dust whose metal identity is unknown with cable residue.'):
            with self.subTest(material=material): self.assert_guard(payload('Pour the dust into the container.'), material=material)

    def test_imperatives_in_steps_and_questions_are_not_returned(self):
        for key in ('next_steps', 'questions'):
            value = payload()
            value[key][0] = 'Can you add or remove the fill?'
            with self.subTest(key=key): self.assert_guard(value)

    def test_any_unsafe_route_content_blocks_the_whole_help_result(self):
        for field in ('title', 'change', 'why', 'steps', 'tradeoffs', 'check'):
            value = payload(kind='help')
            value['engineering_routes'][0][field] = ['Load the dust into the container.'] if field in ('steps', 'tradeoffs') else 'Load the dust into the container.'
            with self.subTest(field=field): self.assert_guard(value, kind='help')

    def test_trial_generated_steps_are_also_checked(self):
        value = payload(kind='trial'); value['steps'][0]['action'] = 'Open the container and pour the dust.'
        self.assert_guard(value, kind='trial')

    def test_normal_prefixed_negation_and_conditional_presealed_units_pass(self):
        value = payload('At home, do not open or pour the dust. If suitable presealed units are available, exchange whole presealed units without opening them. Otherwise plan the enclosure without handling material.')
        self.assert_guard_accepts(value)
        value = payload('No home handling of dust. At home, avoid directly handling dust. Plan the enclosure instead.')
        self.assert_guard_accepts(value)
        value = payload('Add the material identities to the project notes. Record metal names for future planning.')
        self.assert_guard_accepts(value)
        self.assert_guard(payload('Add the material identities to the notes and then pour the dust into the container.'))

    def test_negation_cannot_hide_following_positive_instruction(self):
        for text in ('Do not open the dust, but add fill.', 'Do not handle dust; then add or remove fill.',
                     'Do not heat the dust and you can pour it into the enclosure.',
                     'At home, do not grind the dust and, if needed, transfer it into the container.',
                     'Avoid heating the dust while you can load it into the compartment.'):
            with self.subTest(text=text): self.assert_guard(payload(text))

    def test_more_phrases_for_handling_unidentified_dust(self):
        for text in ('Tip the powder into the mould.', 'Dispense the powder into the container.',
                     'Shovel the dust into the enclosure.', 'The dust is dispensed into the mould.',
                     'Without a protective mask, pour the dust into the container.',
                     'With no laboratory equipment, pour the dust into the container.',
                     'The mould can be topped up with powder.', 'Empty the batch into the bin.',
                     'Weigh the loose dust.', 'Dump the fines in a bucket.'):
            with self.subTest(text=text): self.assert_guard(payload(text))

    def test_unidentified_metal_fines_count_as_unknown_particles(self):
        self.assert_guard(payload('Shovel the fines into the container.'), material='Unidentified metal fines with cable plastic.')

    def test_home_mentioned_in_input_is_not_ignored(self):
        material = 'At home I have mostly metal dust and cable-plastic residue.'
        self.assert_guard(payload('Pour the dust into the container.'), material=material, process='')

    def test_do_not_assume_presealed_units_exist(self):
        self.assert_guard(payload('Exchange whole presealed units and weigh the assembly.'))
        value = payload('If suitable presealed units are available, exchange whole presealed units and weigh the assembly.')
        self.assert_guard_accepts(value)
        known = 'We have presealed units. Mostly metal dust with cable-plastic residue.'
        self.assert_guard_accepts(payload('Exchange whole presealed units and weigh the assembly.'), material=known)
        with_no_lab = 'At home, we have sealed units and no laboratory equipment.'
        self.assert_guard_accepts(payload('Exchange whole presealed units and weigh the assembly.'), material='Mostly metal dust and cable plastic.', process=with_no_lab)

    def test_sealed_unit_mention_does_not_authorize_opening_the_unit(self):
        self.assert_guard(payload('If suitable presealed units are available, exchange whole presealed units and open them to pour the dust.'))
        self.assert_guard(payload('If suitable presealed units are available, remove whole presealed units and then open them.'))

    def test_known_identified_input_and_non_home_case_are_unchanged(self):
        text = 'Adjust the fill in the compartment.'
        self.assert_guard_accepts(payload(text), material='Identified copper metal dust, known grade.')
        self.assert_guard_accepts(payload(text), process='An appropriate industrial site is available.')

    def test_future_identified_material_at_suitable_facility_is_conditional(self):
        text = 'Once the metal and plastic are identified at a suitable facility, handle the dust there.'
        self.assert_guard_accepts(payload(text))

    def test_sound_prompt_names_relevant_measurements_without_claiming_values(self):
        for required in ('reducing echo by absorption', 'blocking transmission', 'frequencies or bands',
                         'installed configuration', 'frequency-dependent sound absorption coefficient',
                         'transmission loss', 'measurement still needed'):
            with self.subTest(required=required): self.assertIn(required, SYSTEM_PROMPT)
        self.assertIn('Do not claim a result, a numeric target, a test standard or access to a laboratory', SYSTEM_PROMPT)
        client = FakeClient(payload())
        b = brief('Fabric offcuts'); b.update(product='Sound sheet', use_case='Room', targets='Reduce echo')
        follow_up_with_case({'brief': b, 'question': 'What needs measuring?', 'history': []}, client=client)
        self.assertIn('frequency-dependent sound absorption coefficient', client.prompt)


if __name__ == '__main__': unittest.main()
