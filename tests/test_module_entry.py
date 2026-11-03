"""The application module command starts the server."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


class ModuleEntryTests(unittest.TestCase):
    def test_module_serves_health(self):
        for module in ("reshivo",):
            with self.subTest(module=module):
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                process = subprocess.Popen(
                    [sys.executable, "-m", module, "serve", "--port", str(port)], cwd=ROOT,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                try:
                    deadline = time.monotonic() + 6
                    while True:
                        try:
                            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                                result = json.load(response)
                            break
                        except (urllib.error.URLError, TimeoutError):
                            if process.poll() is not None or time.monotonic() >= deadline:
                                self.fail(f"{module} server did not start")
                            time.sleep(0.05)
                    from reshivo import __version__
                    self.assertEqual(result["version"], __version__)
                finally:
                    process.terminate()
                    process.wait(timeout=5)



if __name__ == "__main__":
    unittest.main()
