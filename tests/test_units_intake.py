import unittest

from rematter.engineering_intake import _quantity as engineering_quantity
from rematter.observation_intake import _quantity as observation_quantity
from rematter.meta import MetaValidationError


class UnitIntakeTests(unittest.TestCase):
    def test_mass_note_normalizes_pounds_and_ounces_from_actual_words(self):
        for literal, spelling, unit, expected in (("2", "pounds", "lb", "0.90718474"),
                                                   ("16", "oz", "oz", "0.45359237")):
            note = f"Complete assembly mass {literal} {spelling}."
            row, text = observation_quantity({"number_text": literal, "unit": unit, "quote": note}, note, "mass")
            self.assertEqual(text, expected)
            self.assertAlmostEqual(row['normalized_kg'], float(expected))

    def test_engineering_lengths_and_mass_targets_convert_without_cross_property_substitution(self):
        case = {'brief': {'targets': 'Target is 2 to 3 lbs and −2 to 2 inches.'},
                'note': 'Measured centre x −2 inches. Max added mass 4 ounces.'}
        def record(literal, unit, quote, source='note'):
            return {'number_text': literal, 'unit': unit, 'quote': quote, 'source': source}
        _, centre = engineering_quantity(record('−2', 'in', case['note']), 'cg_x_mm', case)
        _, added = engineering_quantity(record('4', 'oz', case['note']), 'total_max_add_kg', case)
        _, minimum = engineering_quantity(record('2', 'lb', case['brief']['targets'], 'brief.targets'), 'mass_target_min_kg', case)
        _, maximum = engineering_quantity(record('3', 'lb', case['brief']['targets'], 'brief.targets'), 'mass_target_max_kg', case)
        self.assertEqual(centre, -50.8)
        self.assertAlmostEqual(added, .1133980925)
        self.assertAlmostEqual(minimum, .90718474)
        self.assertAlmostEqual(maximum, 1.36077711)
        with self.assertRaises(MetaValidationError):
            engineering_quantity(record('−2', 'in', case['note']), 'mass_kg', case)

    def test_in_as_a_preposition_is_not_silently_converted_to_inches(self):
        case = {'brief': {'targets': ''}, 'note': 'There are 2 in the box.'}
        row = {'number_text': '2', 'unit': 'in', 'quote': case['note'], 'source': 'note'}
        with self.assertRaises(MetaValidationError):
            engineering_quantity(row, 'cg_x_mm', case)

    def test_inch_abbreviation_in_measurement_context(self):
        for suffix in ('from the centre', 'above the datum', 'left of datum', 'uncertainty', 'offset'):
            note = f'Centre reading 1 in {suffix}.'
            case = {'brief': {'targets': ''}, 'note': note}
            row = {'number_text': '1', 'unit': 'in', 'quote': note, 'source': 'note'}
            with self.subTest(suffix=suffix):
                _, value = engineering_quantity(row, 'cg_x_mm', case)
                self.assertEqual(value, 25.4)

    def test_ambiguous_ranges_are_not_individual_mass_readings(self):
        note = 'Complete assembly mass 2 to 3 lbs.'
        with self.assertRaises(MetaValidationError):
            observation_quantity({'number_text': '2', 'unit': 'lb', 'quote': note}, note, 'mass')

    def test_force_and_clipped_composite_values_are_not_mass(self):
        for note, literal, unit, quote in (
            ('Load 5 lb force.', '5', 'lb', '5 lb'),
            ('Load 5 pounds of force.', '5', 'lb', '5 pounds'),
            ('Assembly mass 1 lb 5 oz.', '1', 'lb', '1 lb'),
            ('Assembly mass 1 lb and 5 oz.', '5', 'oz', '5 oz'),
        ):
            with self.subTest(note=note, literal=literal):
                with self.assertRaises(MetaValidationError):
                    observation_quantity({'number_text': literal, 'unit': unit, 'quote': quote}, note, 'mass')
                with self.assertRaises(MetaValidationError):
                    engineering_quantity({'source': 'note', 'number_text': literal, 'unit': unit, 'quote': quote},
                                         'mass_kg', {'note': note, 'brief': {'targets': ''}})

    def test_clipped_feet_and_inches_are_not_individual_lengths(self):
        for literal, unit, quote in (('1', 'ft', '1 ft'), ('6', 'in', '6 in')):
            note = 'Centre 1 ft and 6 inches.' if unit == 'ft' else 'Centre 1 ft and 6 in.'
            with self.subTest(unit=unit), self.assertRaises(MetaValidationError):
                engineering_quantity({'source': 'note', 'number_text': literal, 'unit': unit, 'quote': quote},
                                     'cg_x_mm', {'note': note, 'brief': {'targets': ''}})


if __name__ == '__main__':
    unittest.main()
