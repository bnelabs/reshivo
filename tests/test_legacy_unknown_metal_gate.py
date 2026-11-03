"""Legacy model paths must stop before a provider call for recognized cases."""
import unittest
from unittest.mock import patch

from rematter.engineering_agent import assist_with_adaptation
from rematter.engineering_intake import read_engineering_note
from rematter.image_intake import inspect_image
from rematter.observation_intake import read_observation_note
from rematter.products import ProductInputError
from rematter.service import ServiceError, WorkbenchService
from test_engineering_agent import mass_only_request
from test_engineering_intake import Client as EngineeringClient, request as engineering_request
from test_image_intake import FixtureClient as ImageClient, request as image_request
from test_observation_intake import Client as NoteClient, request as observation_request


class ProviderReached(Exception):
    pass


class NoGeneration:
    def generate(self, *args, **kwargs):
        raise AssertionError('The local planning gate must run before generation')
    def tool_turn(self, *args, **kwargs):
        raise AssertionError('The local planning gate must run before a model tool turn')


class ReachedGeneration:
    def generate(self, *args, **kwargs):
        raise ProviderReached()
    def tool_turn(self, *args, **kwargs):
        raise ProviderReached()


class UnknownMetalLegacyGateTests(unittest.TestCase):
    def cases(self):
        return [
            ('image', inspect_image, image_request()),
            ('observation', read_observation_note, observation_request()),
            ('engineering', read_engineering_note, engineering_request()),
            ('tool agent', assist_with_adaptation, mass_only_request()),
        ]

    def assert_local_fallback(self, fn, request):
        with self.assertRaises(ProductInputError) as caught:
            fn(request, client=NoGeneration())
        text = str(caught.exception)
        self.assertIn('No AI request was sent.', text)
        self.assertIn('Leave the material undisturbed', text)
        self.assertIn('suitable presealed units already exist', text)
        self.assertIn('If relevant to your product', text)
        self.assertIn('without opening them', text)
        self.assertIn('Identify the metal', text)
        self.assertNotIn('Pour the dust into the enclosure.', text)

    def test_unknown_metal_case_blocks_all_four_model_paths_before_call(self):
        for name, fn, request in self.cases():
            with self.subTest(path=name):
                request['brief']['input'] = 'Mostly unidentified metal dust with cable-plastic residue.'
                request['brief']['process'] = 'Planning at home; no suitable facility confirmed.'
                self.assert_local_fallback(fn, request)

    def test_user_note_and_calculation_material_names_are_used_as_case_context(self):
        for fn, request in ((read_observation_note, observation_request()),
                            (read_engineering_note, engineering_request())):
            with self.subTest(path=fn.__name__, source='note'):
                request['note'] += ' The counterweight contains unidentified metal powder.'
                self.assert_local_fallback(fn, request)
            request['note'] = observation_request()['note'] if fn == read_observation_note else engineering_request()['note']
            request['calculation_context']['components'][0]['name'] = 'Unknown metal dust'
            with self.subTest(path=fn.__name__, source='component'):
                self.assert_local_fallback(fn, request)
        request = mass_only_request()
        request['question'] = 'I have unidentified metal fines; what should I do?'
        self.assert_local_fallback(assist_with_adaptation, request)

    def test_default_client_is_not_created_for_local_planning(self):
        for module, fn, request in (
            ('rematter.image_intake', inspect_image, image_request()),
            ('rematter.observation_intake', read_observation_note, observation_request()),
            ('rematter.engineering_intake', read_engineering_note, engineering_request()),
            ('rematter.engineering_agent', assist_with_adaptation, mass_only_request()),
        ):
            with self.subTest(path=module), patch(module + '.MetaClient', side_effect=AssertionError('Do not construct a provider')):
                request['brief']['input'] = 'Unidentified metal powder'
                request['brief']['process'] = 'Home only'
                with self.assertRaises(ProductInputError):
                    fn(request)

    def test_service_maps_local_fallback_to_structured_client_error_without_provider(self):
        service = WorkbenchService()
        for name, fn, request in (
            ('rematter.image_intake', service.advisor_inspect_image, image_request()),
            ('rematter.observation_intake', service.advisor_read_observation, observation_request()),
            ('rematter.engineering_intake', service.advisor_read_engineering_note, engineering_request()),
            ('rematter.engineering_agent', service.adaptation_assist, mass_only_request()),
        ):
            with self.subTest(path=name), patch(name + '.MetaClient', side_effect=AssertionError('Do not construct a provider')):
                request['brief']['input'] = 'Unidentified metal powder'
                request['brief']['process'] = 'Home only'
                with self.assertRaises(ServiceError) as caught:
                    fn(request)
                self.assertEqual((caught.exception.status, caught.exception.code), (400, 'invalid_request'))
                self.assertIn('No AI request was sent.', caught.exception.message)

    def test_unrelated_inputs_retain_reading_and_tool_paths(self):
        image_client = ImageClient()
        self.assertEqual(inspect_image(image_request(), client=image_client)['result_kind'], 'visual_observations')
        self.assertEqual(len(image_client.calls), 1)
        note_client = NoteClient()
        self.assertEqual(read_observation_note(observation_request(), client=note_client)['result_kind'], 'observation_draft')
        self.assertEqual(len(note_client.calls), 1)
        engineering_client = EngineeringClient()
        self.assertEqual(read_engineering_note(engineering_request(), client=engineering_client)['result_kind'], 'engineering_draft')
        self.assertEqual(len(engineering_client.calls), 1)
        with self.assertRaises(ProviderReached):
            assist_with_adaptation(mass_only_request(), client=ReachedGeneration())

    def test_explicitly_identified_metal_and_existing_facility_reach_provider(self):
        for name, fn, request in self.cases():
            with self.subTest(path=name):
                request['brief']['input'] = 'Metal dust is copper.'
                request['brief']['process'] = 'We have a suitable facility.'
                with self.assertRaises(ProviderReached):
                    fn(request, client=ReachedGeneration())


if __name__ == '__main__':
    unittest.main()
