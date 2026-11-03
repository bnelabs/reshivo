"""Loopback-only screening of saved guidance without a model call."""
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from rematter.materials import ROOT
from rematter.server import MAX_PLANNING_BODY_BYTES, build_server
from rematter.service import WorkbenchService


class ReviewSavedGuidanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); root=Path(cls.temp.name); (root/'examples').mkdir()
        shutil.copyfile(ROOT/'examples/support-member.json',root/'examples/support-member.json')
        cls.server=build_server(port=0,service=WorkbenchService(root=root),web_root=root)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.temp.cleanup()

    def call(self, body, headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=8)
        try:
            conn.request('POST','/api/project/review-saved-guidance',json.dumps(body).encode(),
                         {'Content-Type':'application/json',**(headers or {})})
            response=conn.getresponse(); raw=response.read()
            return response.status,json.loads(raw),dict(response.getheaders())
        finally: conn.close()

    def test_detects_and_returns_only_review_status_without_a_model_call(self):
        with patch('urllib.request.OpenerDirector.open',side_effect=AssertionError('Unexpected provider call')):
            self.assertEqual(self.call({'texts':[]})[:2],(200,{'needs_review':False}))
            status,result,headers=self.call({'texts':['Plan the enclosure.','Stand on the wet mat.']})
            self.assertEqual((status,result),(200,{'needs_review':True}))
            self.assertEqual(headers['Cache-Control'],'no-store')
            self.assertEqual(self.call({'texts':['Do not walk on the wet mat.']})[:2],(200,{'needs_review':False}))
            self.assertEqual(self.call({'texts':['Compare containment ideas on paper for grip.']})[:2],(200,{'needs_review':True}))
            self.assertEqual(self.call({'texts':['Sketch the mat on paper for fit, then select a grip test.']})[:2],(200,{'needs_review':False}))
            self.assertEqual(self.call({'texts':['Sample one delivery. This shows how much the mix shifts between deliveries.']})[:2],(200,{'needs_review':True}))
            self.assertEqual(self.call({'texts':['One delivery does not show how the mix shifts between deliveries.']})[:2],(200,{'needs_review':False}))

    def test_rejects_bad_shapes_fields_lengths_and_origin(self):
        for value in ({}, {'texts':'a'}, {'texts':[None]}, {'texts':['x'*100001]},
                      {'texts':['a']*231}, {'texts':[],'extra':True}):
            with self.subTest(value=str(value)[:60]): self.assertEqual(self.call(value)[0],400)
        self.assertEqual(self.call({'texts':[]},{'Origin':'https://untrusted.example'})[0],403)

    def test_oversize_guard_and_large_valid_texts(self):
        self.assertEqual(self.call({'texts':['safe']*230})[:2],(200,{'needs_review':False}))
        self.assertEqual(self.call({'texts':['x'*100000]*40})[:2],(200,{'needs_review':False}))
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=8)
        try:
            conn.putrequest('POST','/api/project/review-saved-guidance')
            conn.putheader('Content-Type','application/json');conn.putheader('Content-Length',str(MAX_PLANNING_BODY_BYTES+1));conn.endheaders()
            response=conn.getresponse();self.assertEqual(response.status,413);response.read()
        finally: conn.close()


if __name__=='__main__': unittest.main()
