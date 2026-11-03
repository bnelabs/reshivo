import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("release_package", Path(__file__).parents[1] / "scripts/prepare_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleasePackageTests(unittest.TestCase):
    def test_selection_excludes_history_secrets_builds_and_acoustic_derivatives(self):
        for name in (".git/config", ".env", ".env.local", "AGENTS.md", "outputs/demo.json", "web/node_modules/react/index.js",
                     "web/dist/index.html", "data/research/acoustics/footwear_measurements.json",
                     "../rematter/a.py", "/tmp/a.py", "rematter/__pycache__/a.pyc",
                     "data/research/density/access_attempts/cecon-mmc1-challenge.html",
                     "docs/demo/old-review.mp4", "examples/old-recording.mp4",
                     "docs/SUBMISSION_FORM.md", "docs/brand/gather.svg", "docs/release-qa-old.json",
                     "docs/BUILD_PLAN.md", "docs/DEMO_STORY_V2_20261103.md"):
            with self.subTest(name=name):
                self.assertFalse(release.selected(name))
        for name in ("rematter/balance.py", "web/src/App.tsx", ".env.example",
                     "data/research/density/measurements.json", "docs/API.md",
                     "docs/ORGANIZER_EVALUATION_RESULTS_20261103.md", "web/public/reshivo-mark.svg",
                     "deploy/reshivo.service", "deploy/nginx/reshivo.conf.example"):
            self.assertTrue(release.selected(name))

    def test_exact_secret_check_withholds_value_in_error(self):
        secret = b"private-test-value"
        with self.assertRaises(ValueError) as caught:
            release.check_files({"README.md": b"text " + secret}, (secret,))
        self.assertNotIn(secret.decode(), str(caught.exception))
        self.assertIn("README.md", str(caught.exception))

    def test_secret_sources_include_voice_and_saved_provider_profiles(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".env").write_text("MODEL_API_KEY=synthetic-meta-key\n")
            (root / ".env.elevenlabs").write_text("ELEVENLABS_API_KEY=synthetic-voice-key\n")
            (root / ".env.providers.json").write_text(json.dumps({
                "active_provider": "example",
                "profiles": {"example": {"api_key": "synthetic-provider-key"}},
            }))
            secrets = release.local_secrets(root)
            for value in (b"synthetic-meta-key", b"synthetic-voice-key", b"synthetic-provider-key"):
                self.assertIn(value, secrets)
                with self.assertRaises(ValueError):
                    release.check_files({"README.md": value}, secrets)

    def test_only_known_omitted_links_are_annotated(self):
        name = "docs/BALANCE_SPIKE.md"
        files = {name: b"[Old demo](demo/rematter-demo.mp4) and [unexpected](missing.md)"}
        release.annotate_omitted_links(files)
        self.assertEqual(files[name], b"Old demo (not included in this export) and [unexpected](missing.md)")
        with self.assertRaisesRegex(ValueError, "omitted-asset link changed"):
            release.annotate_omitted_links({name: b"[Different](another.mp4)"})

    def test_historical_notice_preserves_frozen_digest_and_detects_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = b"# Original frozen protocol\n"
            old_digest = b"def digest(path):\n    return hashlib.sha256(path.read_bytes()).hexdigest()\n"
            files = {}
            for protocol, script in release.HISTORICAL_PROTOCOLS.items():
                files[protocol] = original
                files[script] = old_digest
            release.mark_historical_protocols(files)
            for protocol, script in release.HISTORICAL_PROTOCOLS.items():
                path = root / protocol
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(files[protocol])
                scope = {"hashlib": hashlib, "ROOT": root, "PROTOCOL": protocol}
                exec(files[script].decode(), scope)
                self.assertEqual(scope["digest"](path), hashlib.sha256(original).hexdigest())
                path.write_bytes(files[protocol] + b"changed")
                self.assertNotEqual(scope["digest"](path), hashlib.sha256(original).hexdigest())
                path.write_bytes(original)
                with self.assertRaisesRegex(ValueError, "notice is missing or changed"):
                    scope["digest"](path)

    def test_export_refuses_an_existing_destination_before_reading_git(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "never overwrites"):
                release.prepare(Path(folder), root=Path(folder))

    def test_unknown_verifier_shape_fails_before_writing(self):
        files = {"data/research/source_groups.json": b"[]", "scripts/verify_research.py": b"changed verifier"}
        with self.assertRaisesRegex(ValueError, "layout changed"):
            release.transform(files)


if __name__ == "__main__":
    unittest.main()
