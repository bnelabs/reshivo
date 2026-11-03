import unittest

from rematter.advisor import balance_mix
from rematter.products import ProductInputError


class PrimaryMixAdjustmentTests(unittest.TestCase):
    def test_full_setup_material_name_and_changed_input_give_bound_simulations(self):
        request = {
            'component': 'x' * 160, 'input_mass_kg': 1.4,
            'input_min_percent': 46, 'input_max_percent': 46,
            'addition_name': 'Known stock', 'addition_percent': 0,
            'target_min_percent': 35, 'target_max_percent': 35,
        }
        first = balance_mix(request)
        self.assertEqual(first['component'], 'x' * 160)
        self.assertAlmostEqual(first['example_addition_kg'], 0.44)
        self.assertFalse(first['physical_performance_verified'])
        changed = balance_mix({**request, 'input_min_percent': 43, 'input_max_percent': 47})
        self.assertFalse(changed['feasible'])
        self.assertIsNone(changed['example_addition_kg'])
        with self.assertRaises(ProductInputError):
            balance_mix({**request, 'component': 'x' * 161})


if __name__ == '__main__':
    unittest.main()
