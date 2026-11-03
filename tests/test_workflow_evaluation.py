import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import benchmark_workflow_evaluation as benchmark


class WorkflowEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = benchmark.fixture()
        self.cases = benchmark.prepare(self.fixture)

    def test_oracles_reject_stale_transfer_and_cost_change(self):
        modified = json.loads(json.dumps(self.fixture))
        modified['cases'][0]['request']['project_context']['records'][0]['configuration_revision'] = 2
        with self.assertRaisesRegex(ValueError, 'oracle mismatch'):
            benchmark.prepare(modified)
        modified = json.loads(json.dumps(self.fixture))
        modified['cases'][0]['request']['manufacturing_costs'][0]['output']['usable_count'] = '7'
        with self.assertRaisesRegex(ValueError, 'cost oracle mismatch'):
            benchmark.prepare(modified)
        modified = json.loads(json.dumps(self.fixture))
        modified['cases'][1]['request']['project_context']['records'][1]['readings'][0]['value'] = '72'
        with self.assertRaisesRegex(ValueError, 'decision oracle mismatch'):
            benchmark.prepare(modified)

    def test_baseline_receives_captured_stale_input_and_same_tool_summaries(self):
        case = self.cases['mat']
        payload = benchmark.baseline_payload(case)
        self.assertEqual(payload['project_assessment'], case['project_assessment'])
        model_case = benchmark._model_case(case)
        self.assertEqual(payload['manufacturing_cost_assessment'], model_case['manufacturing_cost_assessment'])
        self.assertEqual(payload['decision_assessment'], model_case['decision_assessment'])
        self.assertEqual(payload['captured_project_context'], case['project_context'])
        self.assertTrue(any(r['id'] == 'A-1-grip' for r in payload['captured_project_context']['records']))
        self.assertFalse(any(r['id'] == 'A-1-grip' for r in payload['project_context']['records']))
        self.assertEqual(payload['captured_manufacturing_costs'], case['manufacturing_costs'])

    def test_live_runner_keeps_failure_and_attempts_every_slot_once(self):
        class FakeClient:
            provider='meta'; model='synthetic-model'; key='sensitive-test-key'
            profile=SimpleNamespace(configured=True,base_url='https://example.invalid/v1',capabilities={'reasoning':True})
            calls=0
            def __init__(self, **kwargs): pass
            def generate(self, prompt, schema, candidates, **kwargs):
                FakeClient.calls+=1
                if FakeClient.calls==1:
                    raise RuntimeError('synthetic failure sensitive-test-key')
                answer='Conditional suggestion.\n\nYou will meet the targets.' if FakeClient.calls==2 else 'Conditional suggestion.'
                return SimpleNamespace(data={'answer':answer, 'next_steps':['Review the inputs.'],
                                             'questions':[], 'source_ids':[]},
                                       provider='meta',model=self.model,live=True,request_id='mock',usage={},elapsed_ms=1,reasoning_effort='high')
        with TemporaryDirectory() as temp:
            lock=Path(temp)/'lock.json'; output=Path(temp)/'result.json'
            lock.write_text(json.dumps({'protocol':benchmark.VERSION,'sha256':benchmark.manifest()}))
            with patch.object(benchmark,'MetaClient',FakeClient):
                result=benchmark.execute(self.fixture,self.cases,lock,output)
                self.assertEqual(FakeClient.calls,7)
                self.assertEqual(result['status'],'complete_with_failures')
                self.assertEqual([(a['case'],a['arm']) for a in result['attempts']],
                                 [('mat','baseline'),('mat','workflow'),('mat_eligible','workflow'),('mat_eligible','baseline'),('acoustic','baseline'),('acoustic','workflow'),('counterweight','workflow'),('counterweight','baseline')])
                self.assertEqual([a['status'] for a in result['attempts']],['failed']+['completed']*7)
                local = result['attempts'][6]
                self.assertEqual(local['response']['result_kind'], 'local_planning_guidance')
                self.assertEqual(local['response']['provider'], 'local')
                self.assertFalse(local['response']['live'])
                self.assertIsNone(local['model_call'])
                self.assertIsNone(local['raw_model_response'])
                self.assertEqual(result['base_url'],'https://example.invalid/v1')
                self.assertEqual(result['declared_capabilities'],{'reasoning':True})
                self.assertEqual(result['attempts'][1]['raw_model_response']['reasoning_effort'],'high')
                self.assertEqual(result['attempts'][1]['raw_model_response']['data']['answer'], 'Conditional suggestion.\n\nYou will meet the targets.')
                self.assertEqual(result['attempts'][1]['response']['answer'], 'Conditional suggestion.')
                self.assertEqual(result['attempts'][1]['response']['quarantined_answer'], ['You will meet the targets.'])
                workflow = result['attempts'][2]['model_call']['prompt']
                baseline = result['attempts'][3]['model_call']['prompt']
                for key in ('brief','question','history','project_context','project_assessment','manufacturing_cost_assessment','decision_assessment','references','task'):
                    self.assertEqual(workflow[key],baseline[key],key)
                self.assertTrue(any(r['id']=='A-1-grip' for r in baseline['captured_project_context']['records']))
                self.assertFalse(any(r['id']=='A-1-grip' for r in workflow['project_context']['records']))
                self.assertNotIn('sensitive-test-key',output.read_text())
                self.assertEqual(json.loads(output.read_text())['attempts'][0]['error'],'synthetic failure [REDACTED]')
                with self.assertRaises(FileExistsError): benchmark.execute(self.fixture,self.cases,lock,output)
                self.assertEqual(FakeClient.calls,7)

    def test_changed_lock_refuses_before_provider_or_output(self):
        with TemporaryDirectory() as temp:
            lock=Path(temp)/'lock.json'; output=Path(temp)/'result.json'
            lock.write_text(json.dumps({'protocol':benchmark.VERSION,'sha256':{'modified':'bad'}}))
            with patch.object(benchmark,'MetaClient',side_effect=AssertionError('Must not configure')):
                with self.assertRaisesRegex(ValueError,'source files changed'):
                    benchmark.execute(self.fixture,self.cases,lock,output)
            self.assertFalse(output.exists())


if __name__=='__main__': unittest.main()
