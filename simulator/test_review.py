import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from fleet_core import Fleet, ReviewConflict
from review_evidence import save_evidence, evidence_path


class HumanReview(unittest.TestCase):
    def setUp(self):
        self.cfg=json.loads((Path(__file__).parent/'orchard_config.json').read_text())
        self.now=100.;self.f=Fleet(self.cfg,clock=lambda:self.now)
        self.pods={'fruit':{'plant_id':'plant','position':[2,3,1.6]}}
        self.frame={'vehicle_id':'drone','frame_id':'one','wall_time':100,'predictions':[{'class_id':1,'confidence':.9,'bbox':[10,10,30,40]}],
                    'review_evidence':{'fruit':{'id':'original-photo','localization':{'version':1}}}}
        self.observe();self.f.control('start')

    def observe(self):self.f.observe(self.frame,[{'pod_id':'fruit','prediction_index':0}],self.pods)
    def decide(self,decision='approve',revision=1,epoch=0):return self.f.review('fruit',decision,revision,'nota',epoch)

    def test_lease_and_repeated_predictions_never_approve(self):
        for _ in range(10):self.now+=100;self.observe();self.f.snapshot()
        self.assertEqual(len(self.f.data['tasks']),1)
        self.assertEqual(self.f.data['tasks']['fruit']['status'],'awaiting_review')
        with self.assertRaises(ValueError):self.f.claim('fruit','ground-1')

    def test_approval_persists_and_allows_exact_target_claim(self):
        task=self.decide();self.assertEqual(task['position'],[2,3,1.6])
        restored=Fleet(self.cfg,self.f.snapshot(),clock=lambda:self.now)
        self.assertEqual(restored.claim('fruit','ground-1')['status'],'claimed')

    def test_reject_is_persistent_and_never_removes(self):
        self.decide('reject');self.observe()
        with self.assertRaises(ValueError):self.f.claim('fruit','ground-1')
        self.assertEqual(self.f.data['removed'],[])
        self.assertEqual(self.f.data['tasks']['fruit']['review']['decision'],'reject')

    def test_retries_are_idempotent_but_concurrent_opposite_decisions_conflict(self):
        first=self.decide();self.assertEqual(self.decide(),first)
        with self.assertRaises(ReviewConflict):self.decide('reject')

    def test_stale_epoch_cannot_approve_new_run_same_fruit_id(self):
        self.f.control('reset');self.observe()
        with self.assertRaises(ReviewConflict):self.decide()
        self.assertEqual(self.decide(epoch=1)['status'],'pending')

    def test_missing_photo_cannot_be_approved_and_new_capture_invalidates_old_form(self):
        self.f.data['tasks']['fruit']['evidence']=None
        with self.assertRaises(ValueError):self.decide()
        self.observe()
        with self.assertRaises(ReviewConflict):self.decide()
        self.assertEqual(self.decide(revision=2)['status'],'pending')

    def test_legacy_automatic_task_requires_review_after_migration(self):
        task=self.f.data['tasks']['fruit'];task.pop('review');task['status']='claimed';task['robot_id']='ground-1'
        restored=Fleet(self.cfg,self.f.data,clock=lambda:self.now)
        self.assertEqual(restored.data['tasks']['fruit']['status'],'awaiting_review')
        self.assertIsNone(restored.data['tasks']['fruit']['robot_id'])

    def test_old_photo_without_visibility_invalidates_an_approval(self):
        self.decide();task=self.f.data['tasks']['fruit'];task['evidence'].pop('localization')
        restored=Fleet(self.cfg,self.f.data,clock=lambda:self.now)
        task=restored.data['tasks']['fruit']
        self.assertEqual(task['status'],'awaiting_evidence');self.assertEqual(task['review']['decision'],'pending')
        self.assertEqual(task['previous_evidence']['id'],'original-photo')
        with self.assertRaises(ValueError):restored.claim('fruit','ground-1')


class Photographs(unittest.TestCase):
    def test_saved_crop_and_context_are_stable_after_new_frames_and_restart(self):
        buf=io.BytesIO();Image.new('RGB',(160,100),(15,70,20)).save(buf,format='JPEG')
        with tempfile.TemporaryDirectory() as folder:
            frame={'frame_id':'rgb-frame','wall_time':123}
            a=save_evidence(folder,buf.getvalue(),{'bbox':[20,10,60,80]},frame)
            b=save_evidence(folder,buf.getvalue(),{'bbox':[20,10,60,80]},frame)
            self.assertEqual(a,b);self.assertEqual(a['frame_id'],'rgb-frame')
            with Image.open(evidence_path(folder,a['id']+'.jpg')) as image:self.assertEqual(image.size,(160,100))
            self.assertIsNotNone(evidence_path(folder,a['id']+'-crop.jpg'))
            self.assertIsNone(evidence_path(folder,'../orchard_config.json'))
            self.assertIsNone(evidence_path(folder,'x.jpg'))


if __name__=='__main__':unittest.main()
