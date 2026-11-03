import importlib.util
import json
from pathlib import Path
import unittest

from reshivo.balance import plan_shared_balance
from reshivo.engineering_intake import prepare_engineering_values

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('engineering_intake_benchmark', ROOT/'scripts/benchmark_engineering_intake.py')
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class EngineeringIntakeBenchmarkTests(unittest.TestCase):
    def fixture(self):
        return json.loads((ROOT/'examples/engineering-intake-task-v1.json').read_text())['fixtures'][0]

    def test_reference_rejects_mass_only_action_that_misses_balance(self):
        fixture = self.fixture()
        prepared = prepare_engineering_values(fixture['request'],fixture['expected'],review_confirmed=True,independent_adjustments=True)
        result = plan_shared_balance(prepared['bound_request'])
        self.assertTrue(bench.independent_check(fixture['expected'],result))
        result['commands'][0]['command_kg'] = .05
        result['commands'][1]['command_kg'] = 0
        self.assertFalse(bench.independent_check(fixture['expected'],result))

    def test_missing_bound_in_new_observation_cannot_borrow_old_value(self):
        fixture = self.fixture(); values = dict(fixture['expected'])
        values['cg_uncertainty_mm'] = None
        score = bench.score(fixture['expected'],values)
        self.assertFalse(score['exact'])
        self.assertIn('cg_uncertainty_mm',score['missing_expected'])

    def test_wrong_error_is_a_semantic_failure_even_if_commands_stay_equal(self):
        fixture = self.fixture(); values = dict(fixture['expected'])
        values['weighing_uncertainty_kg'] = .004
        self.assertFalse(bench.score(fixture['expected'],values)['exact'])
        schema = bench.plain_schema()
        self.assertEqual(set(schema['required']),set(fixture['expected']))


if __name__=='__main__': unittest.main()
