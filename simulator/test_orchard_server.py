import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import orchard_server as server


class APIContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=tempfile.TemporaryDirectory();cls.original_runtime=server.RUNTIME
        server.RUNTIME=Path(cls.directory.name)
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.base='http://127.0.0.1:'+str(cls.http.server_port)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();server.RUNTIME=cls.original_runtime;cls.directory.cleanup()

    def request(self,path,value=None,headers=None):
        data=json.dumps(value).encode() if value is not None else None
        request=Request(self.base+path,data=data,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urlopen(request) as response:return response.status,json.loads(response.read())
        except HTTPError as error:
            try:return error.code,json.loads(error.read())
            finally:error.close()

    def test_commands_queue_preserves_burst(self):
        actions=['speed','reset','harvest','start','return','hold']
        for action in actions:
            code,_=self.request('/api/command',{'action':action,'soc':.5});self.assertEqual(code,202)
        records=[json.loads(p.read_text()) for p in sorted((server.RUNTIME/'mission-commands').glob('*.json'))]
        self.assertEqual([r['action'] for r in records],actions)
        self.assertEqual(len({r['id'] for r in records}),len(actions))

    def test_invalid_soc_and_action_are_rejected(self):
        self.assertEqual(self.request('/api/command',{'action':'reset','soc':-1})[0],400)
        self.assertEqual(self.request('/api/command',{'action':'unknown'})[0],400)

    def test_cross_origin_command_is_rejected(self):
        self.assertEqual(self.request('/api/command',{'action':'start'},{'Origin':'https://example.invalid'})[0],403)

    def test_invented_frame_cannot_supply_visual_observation(self):
        self.assertEqual(self.request('/api/observe',{'frame_id':'not-inferred','associations':[]})[0],400)

    def test_observation_uses_inferred_scores_not_client_claim(self):
        import time
        server.FRAMES['verified-frame']={'frame_id':'verified-frame','wall_time':time.time(),'phase_id':8,'sim_time':12,'predictions':[{'class_id':1,'confidence':.81}],'localization':{'version':1,'associations':[{'prediction_index':0,'pod_id':'a-plant-pod','version':1}]}}
        code,_=self.request('/api/observe',{'frame_id':'verified-frame','associations':[{'pod_id':'a-plant-pod','prediction_index':0,'class_id':0,'confidence':.01}]})
        self.assertEqual(code,202)
        observation=json.loads((server.RUNTIME/'mission-vision.json').read_text())
        self.assertEqual(observation['proposals'],[{'pod_id':'a-plant-pod','class_id':1,'confidence':.81}])

    def test_invalid_prediction_index_is_rejected(self):
        import time
        server.FRAMES['frame-index']={'frame_id':'frame-index','wall_time':time.time(),'predictions':[]}
        self.assertEqual(self.request('/api/observe',{'frame_id':'frame-index','associations':[{'pod_id':'pod','prediction_index':True}]})[0],400)

    def test_static_path_cannot_escape_asset_root(self):
        self.assertEqual(self.request('/assets/%2e%2e/orchard_config.json')[0],404)

    def test_compact_telemetry_preserves_pose_and_alert_count(self):
        data={'position':[1,2,3],'phase_id':4,'simulation_time':12,'observed':{'one':{'target_score':.9},'two':{'target_score':.2}},'events':[{'phase':'inspect'}]}
        server.atomic(server.RUNTIME/'mission-status.json',data)
        code,reply=self.request('/api/telemetry');self.assertEqual(code,200)
        self.assertEqual(reply['physics']['position'],data['position'])
        self.assertEqual(reply['physics']['counts']['alerts'],1)
        self.assertNotIn('observed',reply['physics']);self.assertNotIn('events',reply['physics'])
        self.assertNotIn('last_inference',reply)
        self.assertEqual(self.request('/api/status')[1]['physics'],data)

    def test_persistent_connection_can_read_two_responses(self):
        import http.client
        client=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        try:
            for _ in range(2):
                client.request('GET','/api/telemetry');response=client.getresponse()
                self.assertEqual(response.status,200);self.assertEqual(response.version,11)
                json.loads(response.read())
                self.assertIsNotNone(client.sock)
        finally:client.close()

    def test_large_scene_is_compressed_only_when_accepted(self):
        import gzip
        data={'geometry':[{'position':[i,i,0]} for i in range(2000)]}
        server.atomic(server.RUNTIME/'orchard.json',data)
        for accept,compressed in [('gzip',True),('gzip;q=0, identity',False),('*;q=1,gzip;q=0',False)]:
            with urlopen(Request(self.base+'/api/world',headers={'Accept-Encoding':accept})) as response:
                content=response.read();self.assertEqual(response.headers.get('Content-Encoding')=='gzip',compressed)
                self.assertEqual(json.loads(gzip.decompress(content) if compressed else content),data)


if __name__=='__main__':unittest.main()
