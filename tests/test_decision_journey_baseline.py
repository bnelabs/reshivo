import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from reshivo.providers import ProviderProfile
from scripts import decision_journey_baseline as baseline


class FakeTransport:
    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def request(self, payload, timeout):
        self.calls.append(deepcopy(payload))
        if len(self.calls) == self.fail_at:
            raise RuntimeError('synthetic failure')
        return {'id': f'request-{len(self.calls)}', 'model': payload['model'], 'usage': {'total_tokens': 23}, 'choices': [
            {'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': f'answer-{len(self.calls)}'}}]}


class BaselineHarnessTest(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((baseline.ROOT / baseline.FIXTURE).read_text())
        self.profile = ProviderProfile('meta', 'muse-spark-1.3', 'https://api.meta.ai/v1', 'secret-for-test',
                                       {'reasoning': True, 'vision': False, 'tool_calls': False,
                                        'structured_output': 'json_schema'})

    def run_with(self, transport, clarifications=('', '', '')):
        answers = iter(clarifications)
        with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream, contextlib.redirect_stdout(io.StringIO()):
            result = baseline.run_baseline(self.fixture, self.profile, transport, stream, ask=lambda _: next(answers))
            stream.seek(0)
            return result, [json.loads(line) for line in stream]

    def test_worksheet_is_independent_and_matches_oracle(self):
        baseline.verify_frozen_inputs()
        calc = baseline.calculate(self.fixture)
        self.assertEqual(calc['costs']['A version 2']['CU_per_usable_mat'], '3.25')
        self.assertEqual(calc['costs']['B version 1']['CU_per_usable_mat'], '3.0')
        self.assertEqual([row['addition_kg'] for row in calc['range_endpoints']], ['0.2', '0.3'])

    def test_full_multiturn_history_and_raw_capture(self):
        transport = FakeTransport()
        result, events = self.run_with(transport)
        self.assertTrue(result)
        self.assertEqual(len(transport.calls), 4)
        self.assertEqual([len(call['messages']) for call in transport.calls], [2, 4, 6, 8])
        self.assertEqual(transport.calls[1]['messages'][2]['content'], 'answer-1')
        self.assertEqual(transport.calls[3]['messages'][6]['content'], 'answer-3')
        self.assertTrue(all('oracle' not in json.dumps(call) for call in transport.calls))
        self.assertEqual([event['event'] for event in events],
                         ['start', 'request', 'response', 'request', 'response', 'request', 'response',
                          'request', 'response', 'complete'])
        self.assertEqual(events[2]['body']['usage']['total_tokens'], 23)
        self.assertNotIn('secret-for-test', json.dumps(events))

    def test_failed_call_is_recorded_and_never_retried(self):
        transport = FakeTransport(fail_at=2)
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(events[-1]['event'], 'failed')
        self.assertEqual(events[-1]['later_turns'], 'not attempted; no retry')

    def test_truncated_response_is_retained_and_stops(self):
        class Truncated(FakeTransport):
            def request(self, payload, timeout):
                response = super().request(payload, timeout)
                response['choices'][0]['finish_reason'] = 'length'
                return response
        transport = Truncated()
        result, events = self.run_with(transport)
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(events[-2]['body']['choices'][0]['finish_reason'], 'length')
        self.assertEqual(events[-1]['event'], 'failed')

    def test_interrupted_clarification_is_recorded_without_another_request(self):
        for exception in (EOFError, KeyboardInterrupt):
            with self.subTest(exception=exception):
                transport = FakeTransport()
                def interrupted(_):
                    raise exception()
                with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream, contextlib.redirect_stdout(io.StringIO()):
                    result = baseline.run_baseline(self.fixture, self.profile, transport, stream, ask=interrupted)
                    stream.seek(0)
                    events = [json.loads(line) for line in stream]
                self.assertFalse(result)
                self.assertEqual(len(transport.calls), 1)
                self.assertEqual([event['event'] for event in events], ['start', 'request', 'response', 'failed'])
                self.assertEqual(events[-1]['turn'], 2)
                self.assertEqual(events[-1]['phase'], 'operator_clarification')
                self.assertEqual(events[-1]['error_type'], exception.__name__)
                self.assertEqual(events[-1]['later_turns'], 'not attempted; no retry')

    def test_expected_model_mismatch_stops_before_output_or_request(self):
        expected = 'muse-spark-1.3-contributor'
        transport = FakeTransport()
        with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream:
            with self.assertRaisesRegex(ValueError, 'configured model'):
                baseline.run_baseline(self.fixture, self.profile, transport, stream, expected_model=expected)
            stream.seek(0)
            self.assertEqual(stream.read(), '')
        self.assertEqual(transport.calls, [])

        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / 'lock.json'
            state = {'expected_model': expected}
            lock.write_text(json.dumps(state))
            arguments = ['runner', '--live', '--lock', str(lock), '--output', 'outputs/result.jsonl']
            with patch.object(baseline.sys, 'argv', arguments), \
                 patch.object(baseline, 'private_path', return_value=lock), \
                 patch.object(baseline, 'source_state', return_value=state), \
                 patch.object(baseline, 'load_provider_profile', return_value=self.profile), \
                 patch.object(baseline, 'create_private') as create_output, \
                 patch.object(baseline, 'ProviderTransport') as create_transport:
                with self.assertRaisesRegex(ValueError, 'configured model'):
                    baseline.main()
                create_output.assert_not_called()
                create_transport.assert_not_called()

            arguments.extend(['--expected-model', 'muse-spark-1.2-contributor'])
            with patch.object(baseline.sys, 'argv', arguments), \
                 patch.object(baseline, 'private_path', return_value=lock), \
                 patch.object(baseline, 'source_state') as source_state, \
                 patch.object(baseline, 'create_private') as create_output, \
                 patch.object(baseline, 'ProviderTransport') as create_transport:
                with self.assertRaisesRegex(ValueError, 'frozen model setting'):
                    baseline.main()
                source_state.assert_not_called()
                create_output.assert_not_called()
                create_transport.assert_not_called()

    def test_expected_model_is_part_of_frozen_state(self):
        with patch.object(baseline, 'clean_commit', return_value='fixture-commit'), \
             patch.object(baseline, 'digest', return_value='fixture-digest'):
            state = baseline.source_state('muse-spark-1.3-contributor')
        self.assertEqual(state['expected_model'], 'muse-spark-1.3-contributor')
        self.assertEqual(state['git_commit'], 'fixture-commit')

    def test_expected_model_is_recorded_and_checked_on_return(self):
        contributor = ProviderProfile('meta', 'muse-spark-1.3-contributor', 'https://api.meta.ai/v1',
                                      'secret-for-test', self.profile.capabilities)
        transport = FakeTransport()
        with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream, contextlib.redirect_stdout(io.StringIO()):
            result = baseline.run_baseline(self.fixture, contributor, transport, stream,
                                           ask=lambda _: '', expected_model=contributor.model)
            stream.seek(0)
            events = [json.loads(line) for line in stream]
        self.assertTrue(result)
        self.assertEqual(len(transport.calls), 4)
        self.assertEqual(events[0]['expected_model'], contributor.model)
        self.assertEqual(events[-1]['event'], 'complete')

        for returned in ('muse-spark-1.3', None):
            with self.subTest(returned=returned):
                class WrongModel(FakeTransport):
                    def request(self, payload, timeout):
                        response = super().request(payload, timeout)
                        response['model'] = returned
                        return response
                transport = WrongModel()
                with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stream, contextlib.redirect_stdout(io.StringIO()):
                    result = baseline.run_baseline(self.fixture, contributor, transport, stream,
                                                   ask=lambda _: '', expected_model=contributor.model)
                    stream.seek(0)
                    events = [json.loads(line) for line in stream]
                self.assertFalse(result)
                self.assertEqual(len(transport.calls), 1)
                self.assertEqual(events[0]['expected_model'], contributor.model)
                self.assertEqual(events[-2]['body']['model'], returned)
                self.assertEqual(events[-1]['event'], 'failed')
                self.assertIn('returned model', events[-1]['error'])

    def test_clarification_must_be_exact_available_fact(self):
        transport = FakeTransport()
        result, events = self.run_with(transport, ('I made this up',))
        self.assertFalse(result)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(events[-1]['event'], 'stopped')
        transport = FakeTransport()
        result, _ = self.run_with(transport, ('characterized clean rubber', '', ''))
        self.assertTrue(result)
        self.assertIn('characterized clean rubber', transport.calls[1]['messages'][-1]['content'])

    def test_private_output_is_exclusive(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(baseline, 'ROOT', Path(directory)):
            with baseline.create_private('outputs/private/result.jsonl') as stream:
                baseline.append(stream, {'body': 'secret-for-test'}, 'secret-for-test')
            path = Path(directory) / 'outputs/private/result.jsonl'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())['body'], '[redacted]')
            with self.assertRaises(FileExistsError):
                baseline.create_private('outputs/private/result.jsonl')
            with self.assertRaises(ValueError):
                baseline.create_private('../outside.jsonl')


if __name__ == '__main__':
    unittest.main()
