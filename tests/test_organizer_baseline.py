import contextlib
from copy import deepcopy
from dataclasses import replace
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from reshivo.providers import ProviderProfile
from scripts import organizer_baseline as baseline


class FakeTransport:
    def __init__(self, *, fail_at=None, wrong_model_at=None, truncated_at=None):
        self.calls = []
        self.fail_at = fail_at
        self.wrong_model_at = wrong_model_at
        self.truncated_at = truncated_at

    def request(self, payload, timeout):
        self.calls.append(deepcopy(payload))
        number = len(self.calls)
        if number == self.fail_at:
            raise RuntimeError('synthetic error')
        return {'id': f'test-{number}', 'model': 'other-model' if number == self.wrong_model_at else baseline.MODEL,
                'usage': {'total_tokens': 17}, 'choices': [{'finish_reason': 'length' if number == self.truncated_at else 'stop',
                'message': {'role': 'assistant', 'content': f'answer-{number}'}}]}


class OrganizerBaselineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = baseline.verify_fixture()
        self.profile = ProviderProfile('meta', baseline.MODEL, 'https://api.meta.ai/v1', 'fixture-private-key',
                                       {'reasoning': True, 'vision': False, 'tool_calls': False,
                                        'structured_output': 'json_schema'})

    def run_with(self, transport, answers=('', '', ''), profile=None, ask=None):
        values = iter(answers)
        with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream, contextlib.redirect_stdout(io.StringIO()):
            result = baseline.run(self.fixture, profile or self.profile, transport, stream,
                                  ask=ask or (lambda _: next(values)))
            stream.seek(0)
            return result, [json.loads(line) for line in stream]

    def test_independent_fraction_worksheet_and_fixture_digests(self):
        calculations = baseline.worksheet(self.fixture)
        self.assertEqual(calculations['costs']['A']['total_EUR_exact'], '41/4')
        self.assertEqual(calculations['costs']['A']['EUR_per_item_exact'], '41/40')
        self.assertEqual(calculations['costs']['B']['EUR_per_item_exact'], '11/10')
        self.assertEqual(calculations['reference']['whole_recipe_percent'], '20')
        self.assertEqual(calculations['exact_point_endpoints']['input_28_percent_addition_kg'], '4/5')
        self.assertEqual(calculations['exact_point_endpoints']['input_32_percent_addition_kg'], '6/5')
        self.assertEqual(calculations['exploratory_range']['lower_addition_kg_exact'], '15/17')
        self.assertEqual(calculations['exploratory_range']['upper_addition_kg_exact'], '15/13')
        changed = deepcopy(self.fixture)
        changed['oracle']['initial']['B_per_item_EUR'] = '999'
        with self.assertRaises(ValueError):
            baseline.worksheet(changed)

    def test_four_turn_history_capture_and_no_future_oracle_leak(self):
        transport = FakeTransport()
        result, events = self.run_with(transport)
        self.assertTrue(result)
        self.assertEqual(len(transport.calls), 4)
        self.assertEqual([len(call['messages']) for call in transport.calls], [2, 4, 6, 8])
        self.assertEqual(transport.calls[1]['messages'][2]['content'], 'answer-1')
        self.assertEqual(transport.calls[3]['messages'][6]['content'], 'answer-3')
        for call in transport.calls:
            self.assertEqual(call['model'], baseline.MODEL)
            self.assertNotIn('oracle', json.dumps(call))
            self.assertNotIn('fixture-private-key', json.dumps(call))
        self.assertNotIn('18–22', transport.calls[0]['messages'][1]['content'])
        self.assertNotIn('3.2', transport.calls[0]['messages'][1]['content'])
        self.assertNotIn('3.2', transport.calls[1]['messages'][-1]['content'])
        self.assertEqual([event['event'] for event in events],
                         ['start', 'request', 'response', 'request', 'response', 'request', 'response',
                          'request', 'response', 'complete'])
        self.assertEqual(events[2]['body']['usage']['total_tokens'], 17)
        self.assertNotIn('fixture-private-key', json.dumps(events))

    def test_provider_failure_stops_without_retry(self):
        transport = FakeTransport(fail_at=2)
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(events[-1]['event'], 'failed')
        self.assertEqual(events[-1]['later_turns'], 'not attempted; no retry')
        self.assertEqual(events[-1]['phase'], 'provider_request')

    def test_mismatched_model_response_is_preserved_and_stops(self):
        transport = FakeTransport(wrong_model_at=1)
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(events[-2]['body']['model'], 'other-model')
        self.assertEqual(events[-1]['event'], 'failed')
        self.assertEqual(events[-1]['error_type'], 'ValueError')

    def test_configured_standard_model_is_rejected_before_call(self):
        profile = replace(self.profile, model='muse-spark-1.3')
        transport = FakeTransport()
        with self.assertRaisesRegex(ValueError, 'Contributor'):
            self.run_with(transport, profile=profile)
        self.assertEqual(transport.calls, [])

    def test_truncated_response_is_preserved_and_stops(self):
        transport = FakeTransport(truncated_at=1)
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(events[-2]['body']['choices'][0]['finish_reason'], 'length')
        self.assertEqual(events[-1]['event'], 'failed')

    def test_response_with_credential_is_redacted_and_never_replayed(self):
        class Leaky(FakeTransport):
            def request(self, payload, timeout):
                response = super().request(payload, timeout)
                response['choices'][0]['message']['content'] = 'fixture-private-key'
                return response
        transport = Leaky()
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertNotIn('fixture-private-key', json.dumps(events))
        self.assertEqual(events[-2]['body']['choices'][0]['message']['content'], '[redacted]')
        self.assertEqual(events[-1]['event'], 'failed')

    def test_operator_clarification_is_exactly_from_already_available_fixture(self):
        transport = FakeTransport()
        result, events = self.run_with(transport, ('I invented a detail',))
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(events[-1]['phase'], 'operator_clarification')
        transport = FakeTransport()
        result, _ = self.run_with(transport, ('as-received mass basis', '', ''))
        self.assertTrue(result)
        self.assertIn('as-received mass basis', transport.calls[1]['messages'][-1]['content'])

    def test_operator_eof_and_interrupt_are_logged_without_another_call(self):
        for exception in (EOFError, KeyboardInterrupt):
            with self.subTest(exception=exception):
                transport = FakeTransport()
                def interrupted(_):
                    raise exception()
                result, events = self.run_with(transport, ask=interrupted)
                self.assertFalse(result)
                self.assertEqual(len(transport.calls), 1)
                self.assertEqual([event['event'] for event in events], ['start', 'request', 'response', 'failed'])
                self.assertEqual(events[-1]['turn'], 2)
                self.assertEqual(events[-1]['error_type'], exception.__name__)

    def test_private_output_is_exclusive_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(baseline, 'ROOT', Path(directory)):
            with baseline.create_private('outputs/private/run.jsonl') as stream:
                baseline.append(stream, {'text': 'fixture-private-key'}, 'fixture-private-key')
            path = Path(directory) / 'outputs/private/run.jsonl'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())['text'], '[redacted]')
            with self.assertRaises(FileExistsError):
                baseline.create_private('outputs/private/run.jsonl')
            with self.assertRaises(ValueError):
                baseline.create_private('../outside.jsonl')


if __name__ == '__main__':
    unittest.main()
