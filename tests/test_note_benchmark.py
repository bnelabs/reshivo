import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from reshivo.meta import Generation, MetaAPIError, MetaValidationError


spec = importlib.util.spec_from_file_location("note_benchmark", Path(__file__).parents[1] / "scripts/benchmark_note_intake.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class NoteBenchmarkTests(unittest.TestCase):
    def test_parser_handles_all_independent_visible_references(self):
        for fixture in benchmark.cases():
            with self.subTest(fixture=fixture["id"]):
                extracted = benchmark.parse_note(fixture["request"]["note"])
                self.assertEqual(fixture["expected"], extracted)

    def test_parser_handles_reordering_unknowns_and_explicit_units(self):
        note = ("Synthetic observation reference Z9. Remove limit 20 grams. "
                "Add capacity is unknown. Whole assembly weight 0.900 kilograms. "
                "Scale uncertainty 2 g. Correction uncertainty 1 g.")
        result = benchmark.parse_note(note)
        self.assertEqual(result, benchmark.expected("Z9", .9, .002, None, .020, .001))

    def test_parser_does_not_choose_a_conflicting_equal_priority_reading(self):
        result = benchmark.parse_note("Complete assembly mass 950 g. Complete assembly mass 960 g.")
        self.assertIsNone(result["mass"])

    def test_score_separates_unknown_invention_wrong_value_and_missing(self):
        expected = benchmark.expected("X1", .95, None, .1, .1, .005)
        actual = dict(expected, mass=.96, uncertainty=0, max_add_mass=None)
        grade = benchmark.score(expected, actual)
        self.assertFalse(grade["exact_case"])
        self.assertEqual(grade["unsupported_filled_fields"], ["mass", "uncertainty"])
        self.assertEqual(grade["incorrect_value_fields"], ["mass"])
        self.assertEqual(grade["missing_expected_fields"], ["max_add_mass"])

    def test_failed_arm_stays_in_denominator(self):
        fixture = benchmark.cases()[0]
        class FailedClient:
            model = "muse-spark-1.3"
            def generate(self, *args, **kwargs):
                raise MetaAPIError("test provider failure")
        result = benchmark.run_arm("plain", fixture, client_factory=lambda **kwargs: FailedClient())
        self.assertFalse(result["completed"])
        self.assertFalse(result["provider_available"])
        summary = benchmark.summarize([result])["plain"]
        self.assertEqual((summary["attempted_cases"], summary["exact_cases"], summary["field_total_all_attempts"]), (1, 0, 7))

    def test_parser_arm_never_creates_a_provider_client(self):
        def forbidden(**kwargs):
            raise AssertionError("offline arm read provider configuration")
        result = benchmark.run_arm("parser", benchmark.cases()[0], client_factory=forbidden)
        self.assertTrue(result["score"]["exact_case"])
        self.assertEqual(result["calls"], [])

    def test_plain_normalization_rejects_nonfinite_boolean_and_extra_fields(self):
        base = benchmark.expected("X1", .95, .005, .1, .1, .005)
        for value in (True, float("nan"), float("inf"), -1, 1_000_001):
            with self.subTest(value=str(value)), self.assertRaises(MetaValidationError):
                benchmark.normalize_plain(dict(base, mass=value))
        with self.assertRaises(MetaValidationError):
            benchmark.normalize_plain(dict(base, extra=1))

    def test_one_call_ceiling_and_actual_generation_metadata(self):
        class Client:
            model = "muse-spark-1.3"
            def generate(self, *args, **kwargs):
                return Generation({}, self.model, True, {"total_tokens": 10}, "test-id", 20)
        client = benchmark.OneCallClient(Client())
        client.generate("{}", {}, 1, max_completion_tokens=4096)
        self.assertEqual(client.calls[0]["request_id"], "test-id")
        with self.assertRaises(MetaValidationError):
            client.generate("{}", {}, 1, max_completion_tokens=4096)

    def test_redaction_removes_exact_credentials_and_bearer_tokens(self):
        value = benchmark.redacted({"response": "secret-value and Bearer abc.xyz"}, ("secret-value",))
        self.assertNotIn("secret-value", value["response"])
        self.assertNotIn("abc.xyz", value["response"])

    def test_record_write_preserves_actual_newlines_and_finite_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "record.json"
            benchmark.save_record(path, {"note": "line one\nline two", "secret": "local-secret"}, ("local-secret",))
            record = json.loads(path.read_text())
            self.assertEqual(record["note"], "line one\nline two")
            self.assertEqual(record["secret"], "[REDACTED]")


if __name__ == "__main__":
    unittest.main()
