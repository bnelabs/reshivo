import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from rematter.providers import load_provider_profile
from rematter.server import SessionStore, build_server
from rematter.service import ServiceError, WorkbenchService


class SessionServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        (cls.root / ".env").write_text("MODEL_API_KEY=shared-environment-test-key\n")
        cls.env = patch.dict(os.environ, {"MODEL_API_KEY": "shared-process-test-key"})
        cls.env.start()
        cls.service = WorkbenchService(output_root=cls.root / "outputs")
        cls.service.root = cls.root
        cls.captured = {}
        cls.capture_lock = threading.Lock()

        def probe(body):
            profile = load_provider_profile(cls.root)
            with cls.capture_lock:
                cls.captured[body["request_id"]] = (profile.provider, profile.api_key)
            return {"ok": True}

        cls.service.project_planning_mode = probe
        cls.server = build_server(port=0, service=cls.service, web_root=cls.root / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.env.stop()
        cls.temp.cleanup()

    def request(self, path, body=None, cookie=None):
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def new_session(self, key="browser-session-fixture-key"):
        status, result, headers = self.request("/api/inference/providers")
        self.assertEqual(status, 200)
        self.assertTrue(result["session_only"])
        self.assertFalse(result["settings"]["configured"])
        self.assertIsNone(headers.get("Set-Cookie"))
        status, result, headers = self.request("/api/inference/providers/save", {
            "provider": "meta", "model": "muse-spark-1.3-contributor", "api_key": key,
        })
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"]
        for field in ("Secure", "HttpOnly", "SameSite=Strict", "Path=/"):
            self.assertIn(field, cookie)
        self.assertTrue(result["configured"])
        return cookie.split(";", 1)[0]

    def test_two_browsers_are_isolated_without_environment_fallback(self):
        browser_a, browser_b = self.new_session("first-browser-test-key"), self.new_session("second-browser-test-key")
        self.assertNotEqual(browser_a, browser_b)
        for cookie, key in ((browser_a, "first-browser-test-key"), (browser_b, "second-browser-test-key")):
            status, result, _ = self.request("/api/inference/providers/save", {
                "provider": "meta", "model": "muse-spark-1.3-contributor", "api_key": key,
            }, cookie)
            self.assertEqual(status, 200)
            self.assertTrue(result["configured"])
            self.assertNotIn(key, json.dumps(result))
        self.assertFalse((self.root / ".env.providers.json").exists())
        self.assertFalse(self.request("/api/advisor/status")[1]["configured"])
        self.assertFalse(self.request("/api/health")[1]["meta"]["configured"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda pair: self.request("/api/project/planning-mode", {"request_id": pair[0]}, pair[1]),
                                     (("one", browser_a), ("two", browser_b))))
        self.assertTrue(all(item[0] == 200 for item in outcomes))
        self.assertEqual(self.captured["one"], ("meta", "first-browser-test-key"))
        self.assertEqual(self.captured["two"], ("meta", "second-browser-test-key"))
        self.request("/api/inference/providers/clear", {}, browser_a)
        self.assertFalse(self.request("/api/inference/providers", cookie=browser_a)[1]["settings"]["configured"])
        self.assertTrue(self.request("/api/inference/providers", cookie=browser_b)[1]["settings"]["configured"])

    def test_session_rejects_custom_endpoints_on_the_server(self):
        cookie = self.new_session()
        status, _, _ = self.request("/api/inference/providers/save", {
            "provider": "custom", "model": "test", "api_key": "test-key", "base_url": "http://127.0.0.1:8080",
        }, cookie)
        self.assertEqual(status, 400)
        self.assertFalse((self.root / ".env.providers.json").exists())

    def test_duplicate_cookie_cannot_select_an_existing_session(self):
        cookie = self.new_session()
        _, result, headers = self.request("/api/inference/providers", cookie=f"{cookie}; {cookie}")
        self.assertTrue(result["session_only"])
        self.assertIsNone(headers.get("Set-Cookie"))
        self.assertFalse(result["settings"]["configured"])

    def test_provider_read_without_cookie_does_not_allocate_a_session(self):
        before = len(self.server.sessions.entries)
        for _ in range(3):
            status, result, headers = self.request("/api/inference/providers")
            self.assertEqual(status, 200)
            self.assertTrue(result["session_only"])
            self.assertIsNone(headers.get("Set-Cookie"))
        self.assertEqual(len(self.server.sessions.entries), before)

    def test_invalid_or_empty_connection_does_not_allocate_a_session(self):
        before = len(self.server.sessions.entries)
        attempts = (
            {"provider": "meta", "model": "muse-spark-1.3-contributor", "api_key": ""},
            {"provider": "meta", "model": "invalid model", "api_key": "synthetic-key"},
            {"provider": "custom", "model": "test", "api_key": "synthetic-key", "base_url": "http://127.0.0.1:9000"},
            {"provider": "missing", "api_key": "synthetic-key"},
        )
        for body in attempts:
            _, _, headers = self.request("/api/inference/providers/save", body)
            self.assertIsNone(headers.get("Set-Cookie"))
        for raw, expected in ((b"{", 400), (b"x" * 65537, 413)):
            request = urllib.request.Request(self.url + "/api/inference/providers/save", data=raw,
                                             headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=10)
            self.assertEqual(caught.exception.code, expected)
            self.assertIsNone(caught.exception.headers.get("Set-Cookie"))
            caught.exception.close()
        self.assertEqual(len(self.server.sessions.entries), before)

    def test_health_without_cookie_does_not_allocate_a_session(self):
        before = len(self.server.sessions.entries)
        status, result, headers = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertFalse(result["meta"]["configured"])
        self.assertIsNone(headers.get("Set-Cookie"))
        self.assertEqual(len(self.server.sessions.entries), before)


class SessionStoreTests(unittest.TestCase):
    def test_expiry_and_capacity_forget_old_session_state(self):
        now = [0]
        store = SessionStore(ttl=5, maximum=2, clock=lambda: now[0])
        a, first = store.open([])
        _, second = store.open([])
        with self.assertRaises(ServiceError):
            store.open([])
        same_a, same_session = store.open([f"reshivo_session={a}"])
        self.assertEqual(a, same_a)
        self.assertIs(first, same_session)
        now[0] = 6
        _, after_expiry = store.open([f"reshivo_session={same_a}"])
        self.assertIsNot(first, after_expiry)
        self.assertLessEqual(len(store.entries), 2)

    def test_expired_session_is_removed_without_another_request(self):
        now = [0]
        store = SessionStore(ttl=5, maximum=2, clock=lambda: now[0])
        store.open([])
        store.start_cleanup(interval=0.01)
        self.addCleanup(store.close)
        now[0] = 6
        deadline = time.monotonic() + 1
        while store.entries and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(store.entries), 0)


if __name__ == "__main__":
    unittest.main()
