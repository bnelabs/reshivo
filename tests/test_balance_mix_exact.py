from fractions import Fraction
import json
import unittest

from rematter.advisor import balance_mix
from rematter.products import ProductInputError


def case(**changes):
    return {
        "component": "paper", "input_mass_kg": 1,
        "input_min_percent": 50, "input_max_percent": 50,
        "addition_name": "zero-paper stock", "addition_percent": 0,
        "target_min_percent": 30, "target_max_percent": 30,
        **changes,
    }


def fraction(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


class ExactMixTests(unittest.TestCase):
    def test_nonterminating_singleton_retains_exact_two_thirds(self):
        result = balance_mix(case())
        self.assertTrue(result["feasible"])
        exact = result["exact_addition_kg"]
        self.assertEqual(fraction(exact["min"]), Fraction(2, 3))
        self.assertEqual(exact["min"], exact["max"])
        self.assertEqual(exact["min"], exact["example"])
        self.assertEqual(result["addition_min_kg"], float(Fraction(2, 3)))
        json.dumps(result, allow_nan=False)

    def test_fraction_feasibility_detects_tiny_input_spread(self):
        cases = (
            case(input_min_percent=0, input_max_percent=1e-100,
                 addition_percent=100, target_min_percent=50, target_max_percent=50),
            case(input_min_percent=1e-300, input_max_percent=1e-60,
                 addition_percent=50, target_min_percent=1, target_max_percent=1),
            case(input_mass_kg=1e-200, input_min_percent=1e-300, input_max_percent=1e-60,
                 addition_percent=75, target_min_percent=25, target_max_percent=25),
            case(input_mass_kg=999999, input_min_percent=0, input_max_percent=1e-100,
                 addition_percent=1.15, target_min_percent=1e-30, target_max_percent=1e-30),
        )
        for request in cases:
            with self.subTest(request=request):
                result = balance_mix(request)
                self.assertFalse(result["feasible"])
                self.assertIsNone(result["exact_addition_kg"])

    def test_narrow_bounds_and_example_are_exact(self):
        request = case(input_min_percent=40, input_max_percent=40,
                       target_min_percent=33.3333, target_max_percent=33.3334)
        result = balance_mix(request)
        self.assertTrue(result["feasible"])
        exact = result["exact_addition_kg"]
        lower, upper, example = map(fraction, (exact["min"], exact["max"], exact["example"]))
        self.assertLess(lower, upper)
        self.assertLessEqual(lower, Fraction(1, 5))
        self.assertLessEqual(Fraction(1, 5), upper)
        self.assertEqual(example, (lower + upper) / 2)
        for addition in (lower, upper, example):
            resulting = Fraction(40, 1) / (1 + addition)
            self.assertLessEqual(Fraction("33.3333"), resulting)
            self.assertLessEqual(resulting, Fraction("33.3334"))

    def test_unbounded_and_zero_only_bounds_are_distinct(self):
        unlimited = balance_mix(case(input_min_percent=30, input_max_percent=30,
                                     addition_percent=30, target_min_percent=30,
                                     target_max_percent=30))
        self.assertEqual(fraction(unlimited["exact_addition_kg"]["min"]), 0)
        self.assertIsNone(unlimited["exact_addition_kg"]["max"])
        zero = balance_mix(case(input_min_percent=100, input_max_percent=100,
                                addition_percent=0, target_min_percent=100,
                                target_max_percent=100))
        self.assertEqual(fraction(zero["exact_addition_kg"]["max"]), 0)

    def test_distinct_bounds_can_collapse_to_the_same_legacy_float(self):
        result = balance_mix(case(input_mass_kg=0.1, input_min_percent=0.0988494641794612,
                                  input_max_percent=0.0988494641794612, addition_percent=100,
                                  target_min_percent=5.69830898591889,
                                  target_max_percent=5.6983089859188905))
        self.assertTrue(result["feasible"])
        self.assertEqual(result["addition_min_kg"], result["addition_max_kg"])
        self.assertLess(fraction(result["exact_addition_kg"]["min"]),
                        fraction(result["exact_addition_kg"]["max"]))

    def test_tiny_nonzero_addition_is_not_rounded_to_zero(self):
        result = balance_mix(case(input_mass_kg=1e-100, input_min_percent=2,
                                  input_max_percent=2, target_min_percent=1,
                                  target_max_percent=1))
        self.assertEqual(fraction(result["exact_addition_kg"]["min"]), Fraction("1e-100"))
        self.assertEqual(result["addition_min_kg"], 1e-100)

    def test_input_scope_is_canonical_decoded_numeric_values(self):
        decoded = json.loads('{"value":0.1000000000000000001}')["value"]
        self.assertEqual(decoded, 0.1)
        result = balance_mix(case(input_min_percent=decoded, input_max_percent=decoded,
                                  target_min_percent=0.05, target_max_percent=0.05))
        self.assertEqual(fraction(result["exact_addition_kg"]["min"]), 1)

    def test_unrepresentable_output_fails_cleanly(self):
        with self.assertRaises(ProductInputError):
            balance_mix(case(input_mass_kg=1e6, input_min_percent=100,
                             input_max_percent=100, target_min_percent=1e-323,
                             target_max_percent=1e-323))


if __name__ == "__main__":
    unittest.main()
