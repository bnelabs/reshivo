import base64
import io
import json
import struct
import unittest
from unittest.mock import patch
import zlib

from reshivo.concept_sketch import concept_sketch
from reshivo.providers import ProviderProfile, ProviderSession, reset_request_session, set_request_session
from reshivo.service import ServiceError


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b""))


class ConceptSketchTests(unittest.TestCase):
    def setUp(self):
        self.session = ProviderSession()
        self.session.profiles['meta'] = ProviderProfile('meta', 'text-model', 'https://api.meta.ai', 'secret-test-key')
        self.token = set_request_session(self.session)

    def tearDown(self):
        reset_request_session(self.token)

    def test_success_uses_fixed_endpoint_and_session_key(self):
        encoded = base64.b64encode(png()).decode()
        response = io.BytesIO(json.dumps({'data': [{'b64_json': encoded}]}).encode())
        with patch('reshivo.concept_sketch.urllib.request.build_opener') as factory:
            factory.return_value.open.return_value = response
            result = concept_sketch({'prompt': 'A recycled floor mat'}, '.')
        request = factory.return_value.open.call_args.args[0]
        sent = json.loads(request.data)
        self.assertEqual(request.full_url, 'https://api.meta.ai/v1/images/generations')
        self.assertEqual(request.get_header('Authorization'), 'Bearer secret-test-key')
        self.assertEqual(sent['model'], 'muse-image-1.0')
        self.assertEqual(sent['n'], 1)
        self.assertEqual(sent['output_format'], 'png')
        self.assertEqual(sent['response_format'], 'b64_json')
        self.assertTrue(result['image_data_url'].endswith(encoded))
        self.assertNotIn('secret-test-key', str(result))

    def test_needs_own_meta_session(self):
        self.session.profiles['meta'] = ProviderProfile('meta', 'm', 'https://api.meta.ai', '')
        with self.assertRaises(ServiceError) as error:
            concept_sketch({'prompt': 'mat'}, '.')
        self.assertEqual(error.exception.code, 'provider_not_configured')
        token = set_request_session(None)
        try:
            with self.assertRaises(ServiceError) as error:
                concept_sketch({'prompt': 'mat'}, '.')
            self.assertEqual(error.exception.code, 'provider_not_configured')
        finally:
            reset_request_session(token)

    def test_rejects_bad_input_and_images(self):
        for request in ({}, {'prompt': ''}, {'prompt': 'x' * 1201}, {'prompt': 'mat', 'url': 'https://example.test'}):
            with self.subTest(request=request), self.assertRaises(ServiceError):
                concept_sketch(request, '.')
        for data in ({'data': [{'url': 'https://example.test/file.png'}]}, {'data': [{'b64_json': base64.b64encode(b'not png').decode()}]}):
            with self.subTest(data=data), patch('reshivo.concept_sketch.urllib.request.build_opener') as factory:
                factory.return_value.open.return_value = io.BytesIO(json.dumps(data).encode())
                with self.assertRaises(ServiceError) as error:
                    concept_sketch({'prompt': 'mat'}, '.')
                self.assertEqual(error.exception.code, 'sketch_unavailable')

    def test_upstream_error_does_not_leak_key(self):
        with patch('reshivo.concept_sketch.urllib.request.build_opener') as factory:
            factory.return_value.open.side_effect = OSError('secret-test-key')
            with self.assertRaises(ServiceError) as error:
                concept_sketch({'prompt': 'mat'}, '.')
        self.assertNotIn('secret-test-key', str(error.exception))


if __name__ == '__main__':
    unittest.main()
