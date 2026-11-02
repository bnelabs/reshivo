import base64
import io
import json
from pathlib import Path
import struct
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import zlib

from rematter.advisor import BRIEF_FIELDS
from rematter.image_intake import MAX_IMAGE_BYTES, inspect_image, validate_image_request
from rematter.meta import Generation, MetaClient, MetaValidationError
from rematter.products import ProductInputError
from rematter.server import MAX_IMAGE_BODY_BYTES, build_server
from rematter.service import WorkbenchService


def png(width=2, height=2, extra=b"", bad_data=False):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    raw = b"\x00" + b"\xff\x00\x00" * 2
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + (chunk(b"tEXt", extra) if extra else b"") + chunk(b"IDAT", b'bad compression' if bad_data else zlib.compress(raw * 2)) + chunk(b"IEND", b""))


def request(data=None, media="image/png"):
    return {"brief": {key: "" for key in BRIEF_FIELDS},
            "image": {"media_type": media, "data_base64": base64.b64encode(data if data is not None else png()).decode()}}


class FixtureClient:
    def __init__(self, data=None):
        self.data = data or {"observations": ["Small red pieces are visible."], "questions": ["Are the pieces all from one input?"]}
        self.calls = []

    def generate(self, prompt, schema, max_candidates, **kwargs):
        self.calls.append((json.loads(prompt), kwargs))
        return Generation(self.data, "muse-spark-1.3", False, {}, "fixture", 1)


class ImageIntakeTests(unittest.TestCase):
    def test_blank_case_is_valid_and_image_never_echoed(self):
        client = FixtureClient()
        payload = request()
        result = inspect_image(payload, client)
        self.assertEqual(result["observations"], ["Small red pieces are visible."])
        self.assertFalse(result["physical_product_tested"])
        self.assertFalse(result["live"])
        self.assertNotIn(payload["image"]["data_base64"], json.dumps(result))
        self.assertEqual(client.calls[0][0]["case"], payload["brief"])
        self.assertTrue(client.calls[0][1]["image_data_url"].startswith("data:image/png;base64,"))

    def test_bad_image_and_excess_dimensions_are_rejected_before_call(self):
        examples = [request(b"not an image"), request(png()[:-4]), request(png(bad_data=True)), request(png(), "image/jpeg"),
                    request(png(4097, 1)), request(png(4000, 4001)),
                    {**request(), "image": {"media_type": "image/png", "data_base64": "@@@@"}},
                    {**request(), "image": {"media_type": "image/gif", "data_base64": "AA=="}},
                    {**request(), "image": {"media_type": "image/png", "data_base64": "A" * (4*((MAX_IMAGE_BYTES+2)//3)+1)}}]
        for example in examples:
            client = FixtureClient()
            with self.subTest(example_type=example['image']['media_type']), self.assertRaises(ProductInputError):
                inspect_image(example, client)
            self.assertEqual(client.calls, [])

    def test_browser_style_jpeg_is_accepted_and_truncation_is_rejected(self):
        jpeg = (Path(__file__).parent / 'fixtures/synthetic-color-shapes.jpg').read_bytes()
        value = request(jpeg, 'image/jpeg')
        self.assertEqual(validate_image_request(value)['media_type'], 'image/jpeg')
        with self.assertRaises(ProductInputError):
            validate_image_request(request(jpeg[:-8], 'image/jpeg'))

    def test_malformed_output_is_not_presented_as_observation(self):
        for data in ({"observations": [], "questions": []}, {"observations": ["ok"], "questions": [], "extra": 1},
                     {"observations": [1], "questions": []}):
            with self.subTest(data=data), self.assertRaises(MetaValidationError):
                inspect_image(request(), FixtureClient(data))

    def test_actual_transport_sends_image_part_and_keeps_credentials_out_of_body(self):
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Transport:
            def open(self, req, timeout):
                self.request, self.timeout = req, timeout
                return Reply(json.dumps({"choices": [{"message": {"content": json.dumps({"observations": ["Red pieces"], "questions": []})}}]}).encode())
        transport = Transport()
        client = MetaClient(environ={"MODEL_API_KEY": "fixture-private-key"}, opener=transport)
        payload = request()
        result = inspect_image(payload, client)
        body = json.loads(transport.request.data)
        self.assertEqual(body['messages'][1]['content'][1]['type'], 'image_url')
        self.assertEqual(body['messages'][1]['content'][1]['image_url']['url'], 'data:image/png;base64,' + payload['image']['data_base64'])
        self.assertEqual(transport.timeout, 50)
        self.assertNotIn('fixture-private-key', transport.request.data.decode())
        self.assertNotIn(payload['image']['data_base64'], json.dumps(result))


class ImageHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = build_server(port=0, service=WorkbenchService())
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def call(self, path, payload, headers=None):
        req = urllib.request.Request(self.url + path, data=json.dumps(payload).encode(),
                                     headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_large_image_has_route_specific_limit_and_origin_guard(self):
        payload = request(png(extra=b'a' * 70_000))
        def stub(value, root):
            validate_image_request(value)
            return {'result_kind': 'visual_observations'}
        with patch('rematter.image_intake.inspect_image', side_effect=stub):
            self.assertEqual(self.call('/api/advisor/inspect-image', payload)[0], 200)
            self.assertEqual(self.call('/api/advisor/help', payload)[0], 413)
            self.assertEqual(self.call('/api/advisor/inspect-image', payload, {'Origin': 'https://untrusted.example'})[0], 403)
            self.assertEqual(self.call('/api/advisor/inspect-image', payload, {'Host': 'untrusted.example'})[0], 403)
            self.assertEqual(self.call('/api/advisor/inspect-image', request(), {'Content-Length': str(MAX_IMAGE_BODY_BYTES + 1)})[0], 413)

    def test_saturated_work_slots_reject_before_generation(self):
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        self.assertTrue(self.server.work_slots.acquire(blocking=False))
        try:
            status, result = self.call('/api/advisor/inspect-image', request())
            self.assertEqual(status, 429)
            self.assertEqual(result['error']['code'], 'service_busy')
        finally:
            self.server.work_slots.release()
            self.server.work_slots.release()


if __name__ == '__main__':
    unittest.main()
