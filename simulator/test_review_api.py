import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image
import orchard_server as server


class ReviewRoundTrip(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.old_runtime=server.RUNTIME
        server.RUNTIME=Path(self.directory.name)
        server.atomic(server.RUNTIME/'orchard.json',{'pods':[{'id':'fruit','plant_id':'plant','position':[2,3,1.6]}]})
        image=io.BytesIO();Image.new('RGB',(200,150),(20,80,10)).save(image,format='JPEG')
        self.jpeg=image.getvalue()
        server.FRAMES['photo-frame']={'frame_id':'photo-frame','wall_time':time.time(),'phase_id':1,'sim_time':3,'vehicle_id':'drone',
            'predictions':[{'class_id':1,'confidence':.9,'bbox':[10,10,80,100]}],
            'localization':{'version':1,'associations':[{'prediction_index':0,'pod_id':'fruit','version':1,'visible_samples':5,'box_iou':.9}]}}
        server.FRAME_IMAGES['photo-frame']=self.jpeg
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.base='http://127.0.0.1:'+str(self.http.server_port)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.http.shutdown();self.http.server_close();server.RUNTIME=self.old_runtime
        server.FRAMES.pop('photo-frame',None);server.FRAME_IMAGES.pop('photo-frame',None);self.directory.cleanup()

    def request(self,path,body=None):
        try:
            with urlopen(Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=5) as r:
                return r.status,json.loads(r.read())
        except HTTPError as e:
            with e:return e.code,json.loads(e.read())

    def test_inference_photo_approval_claim_and_conflicting_second_reviewer(self):
        body={'frame_id':'photo-frame','associations':[{'pod_id':'fruit','prediction_index':0,'class_id':0,'confidence':0}]}
        self.assertEqual(self.request('/api/observe',body)[0],202)
        state=self.request('/api/fleet')[1];task=state['tasks']['fruit']
        self.assertEqual(task['confidence'],.9);self.assertEqual(task['status'],'awaiting_review')
        self.request('/api/fleet/control',{'action':'start'})
        self.assertEqual(self.request('/api/fleet/claim',{'task_id':'fruit','robot_id':'ground-1'})[0],400)
        # Evidence outlives the ring buffer; it cannot silently become a later frame.
        server.FRAMES.pop('photo-frame');server.FRAME_IMAGES.pop('photo-frame')
        with urlopen(self.base+task['evidence']['original_url']) as r:self.assertEqual(r.read(),self.jpeg)
        decision={'task_id':'fruit','decision':'approve','revision':1,'epoch':state['epoch']}
        self.assertEqual(self.request('/api/review/decision',decision)[0],200)
        self.assertEqual(self.request('/api/review/decision',decision)[0],200)
        self.assertEqual(self.request('/api/review/decision',{**decision,'decision':'reject'})[0],409)
        self.assertEqual(self.request('/api/fleet/claim',{'task_id':'fruit','robot_id':'ground-1'})[0],200)
        saved=json.loads((server.RUNTIME/'fleet-state.json').read_text())
        self.assertEqual(saved['tasks']['fruit']['review']['decision'],'approve')
        self.assertEqual(saved['removed'],[])

    def test_rejected_target_is_not_recreated_or_assigned(self):
        body={'frame_id':'photo-frame','associations':[{'pod_id':'fruit','prediction_index':0}]}
        self.request('/api/observe',body)
        self.assertEqual(self.request('/api/review/decision',{'task_id':'fruit','decision':'reject','revision':1,'epoch':0})[0],200)
        self.request('/api/observe',body);self.request('/api/fleet/control',{'action':'start'})
        self.assertEqual(self.request('/api/fleet/claim',{'task_id':'fruit','robot_id':'ground-1'})[0],400)
        self.assertEqual(len(self.request('/api/fleet')[1]['tasks']),1)

    def test_caller_cannot_associate_a_trunk_prediction_with_a_hidden_fruit(self):
        server.FRAMES['photo-frame']['localization']={'version':1,'associations':[],'rejected':[{'prediction_index':0,'reason':'object_occluded_or_insufficient_view'}]}
        self.assertEqual(self.request('/api/observe',{'frame_id':'photo-frame','associations':[{'pod_id':'fruit','prediction_index':0}]})[0],202)
        self.assertEqual(self.request('/api/fleet')[1]['tasks'],{})

    def test_caller_cannot_replace_the_server_localized_object_id(self):
        self.request('/api/observe',{'frame_id':'photo-frame','associations':[{'pod_id':'invented-object','prediction_index':0}]})
        tasks=self.request('/api/fleet')[1]['tasks']
        self.assertEqual(list(tasks),['fruit'])


if __name__=='__main__':unittest.main()
