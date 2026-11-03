from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest

from rematter.advisor import advisor_status, follow_up_with_case, help_with_case, plan_trial
from rematter.engineering_agent import assist_with_adaptation
from rematter.engineering_intake import read_engineering_note
from rematter.image_intake import inspect_image
from rematter.observation_intake import read_observation_note
from rematter.providers import save_provider_settings
from rematter.meta import MetaClient
from tests import test_advisor, test_advisor_followup, test_engineering_agent, test_engineering_intake, test_image_intake, test_observation_intake


class ProviderClient:
    def __init__(self, fixture, provider="google", effort=None):
        self.fixture = fixture
        self.provider = provider
        self.effort = effort

    def generate(self, *args, **kwargs):
        return replace(self.fixture.generate(*args, **kwargs), provider=self.provider,
                       model="fixture-native-model", reasoning_effort=self.effort)


class ProviderMetadataTests(unittest.TestCase):
    def test_all_guidance_results_report_actual_provider_without_inventing_applied_effort(self):
        operations = (
            (help_with_case, test_advisor.brief_request(), test_advisor.FixtureClient(), "high"),
            (follow_up_with_case, test_advisor_followup.request_data(), test_advisor_followup.FixtureClient(), "high"),
            (plan_trial, test_advisor.trial_request(), test_advisor.FixtureClient(test_advisor.trial_data()), "medium"),
            (inspect_image, test_image_intake.request(), test_image_intake.FixtureClient(), "low"),
            (read_observation_note, test_observation_intake.request(), test_observation_intake.Client(), "low"),
            (read_engineering_note, test_engineering_intake.request(), test_engineering_intake.Client(), "low"),
        )
        for operation, request, fixture, requested in operations:
            with self.subTest(operation=operation.__name__):
                result = operation(request, client=ProviderClient(fixture))
                self.assertEqual(result["provider"], "google")
                self.assertEqual(result["model"], "fixture-native-model")
                self.assertEqual(result["requested_reasoning_effort"], requested)
                self.assertIsNone(result["reasoning_effort"])
                self.assertFalse(result["live"])
                self.assertFalse(result["physical_product_tested"])

    def test_actual_reasoning_effort_is_retained_separately(self):
        result = help_with_case(test_advisor.brief_request(),
                                client=ProviderClient(test_advisor.FixtureClient(), "openrouter", "medium"))
        self.assertEqual(result["provider"], "openrouter")
        self.assertEqual(result["requested_reasoning_effort"], "high")
        self.assertEqual(result["reasoning_effort"], "medium")

    def test_advisor_status_uses_saved_active_provider_and_never_returns_a_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".env").write_text("MODEL_API_KEY=fixture-meta-key\n")
            save_provider_settings({"provider": "google", "model": "fixture-native-model",
                                    "api_key": "fixture-provider-secret"}, root, {})
            status = advisor_status(root, {})
        self.assertEqual(status["provider"], "google")
        self.assertEqual(status["provider_name"], "Google")
        self.assertEqual(status["model"], "fixture-native-model")
        self.assertTrue(status["configured"])
        self.assertFalse(status["capabilities"]["reasoning"])
        self.assertNotIn("fixture-provider-secret", json.dumps(status))
        self.assertNotIn("fixture-meta-key", json.dumps(status))

    def test_real_engineering_loop_reports_the_selected_provider_per_turn_and_in_total(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            save_provider_settings({"provider": "openrouter", "model": "fixture-tool-model",
                                    "api_key": "fixture-provider-secret", "capabilities": {"tool_calls": True}}, root, {})
            transport = test_engineering_agent.ScriptedTransport([
                test_engineering_agent.reply(test_engineering_agent.call("compare", "compare_current_design")),
                test_engineering_agent.reply(test_engineering_agent.present("answer", "compare", "adjust_volume")),
            ])
            result = assist_with_adaptation(test_engineering_agent.assist_request(), client=MetaClient(root, {}, transport))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["provider"], "openrouter")
        self.assertEqual(result["model"], "fixture-tool-model")
        self.assertEqual(result["requested_reasoning_effort"], "low")
        self.assertIsNone(result["reasoning_effort"])
        self.assertEqual([turn["provider"] for turn in result["model_trace"]], ["openrouter", "openrouter"])
        self.assertTrue(all(turn["reasoning_effort"] is None for turn in result["model_trace"]))
        self.assertEqual(result["usage"], {"total_tokens": 14})
        self.assertFalse(result["performance_verified"])


if __name__ == "__main__":
    unittest.main()
