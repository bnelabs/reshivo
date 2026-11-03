from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DeploymentContractTests(unittest.TestCase):
    def test_service_keeps_the_application_on_its_existing_loopback_port(self):
        unit = (ROOT / "deploy/reshivo.service").read_text()
        self.assertIn("User=reshivo\n", unit)
        self.assertIn("WorkingDirectory=/opt/reshivo\n", unit)
        self.assertIn("-m rematter serve --port 8797", unit)
        self.assertNotIn("0.0.0.0", unit)
        self.assertIn("UMask=0077\n", unit)

    def test_proxy_does_not_convert_untrusted_origins_to_trusted_origins(self):
        config = (ROOT / "deploy/nginx/reshivo.conf.example").read_text()
        block = re.search(r"map\s+\$http_origin\s+\$reshivo_origin\s*\{([^}]*)\}", config)
        self.assertIsNotNone(block)
        rules = re.findall(r'^\s*(\S+)\s+("[^"]*")\s*;', block.group(1), re.M)
        self.assertEqual(dict(rules), {
            "default": '"https://invalid-origin.invalid"',
            '""': '""',
            '"https://RESHIVO_DOMAIN"': '"http://127.0.0.1:8797"',
        })
        self.assertIn('proxy_set_header Origin $reshivo_origin;', config)
        self.assertIn('proxy_set_header Host "127.0.0.1:8797";', config)
        self.assertIn('proxy_set_header Authorization "";', config)
        self.assertIn('auth_basic_user_file /etc/reshivo/htpasswd;', config)
        self.assertIn('listen 443 ssl;', config)
        self.assertNotRegex(config, r'listen\s+80\s*;')


if __name__ == "__main__":
    unittest.main()
