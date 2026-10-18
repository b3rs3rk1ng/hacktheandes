import copy
import json
from pathlib import Path
import unittest
from fleet_core import Fleet


class FleetContract(unittest.TestCase):
    def setUp(self):
        self.cfg=json.loads((Path(__file__).parent/'orchard_config.json').read_text())
        self.now=100.;self.f=Fleet(self.cfg,clock=lambda:self.now)
        self.pods={name:{'id':name,'plant_id':'tree-'+str(i),'position':[i,2,1.4]} for i,name in enumerate(['one','two','three','four'])}

    def frame(self, name, actor='drone',score=.9,kind=1,task=None):
        return {'frame_id':name,'vehicle_id':actor,'task_id':task,'wall_time':self.now,'predictions':[{'class_id':kind,'confidence':score}],
                'review_evidence':{pid:{'id':'photo-'+name,'localization':{'version':1}} for pid in self.pods}}

    def observe(self, frame,pid):self.f.observe(frame,[{'prediction_index':0,'pod_id':pid}],self.pods)

    def approve(self,pid):self.f.review(pid,'approve',self.f.data['tasks'][pid]['review']['revision'],epoch=self.f.data['epoch'])

    def test_dedup_threshold_unknown_and_no_scene_disease_dependency(self):
        self.observe(self.frame('low',score=.73),'one');self.observe(self.frame('healthy',kind=0),'two');self.observe(self.frame('unknown'),'missing')
        self.assertFalse(self.f.data['tasks'])
        self.observe(self.frame('first'),'one');self.observe(self.frame('repeat'),'one')
        self.assertEqual(len(self.f.data['tasks']),1)
        self.assertEqual(self.f.data['tasks']['one']['drone_frame'],'first')

    def test_three_distinct_assignments_and_no_double_claim(self):
        self.f.control('start')
        for i,(rid,pid) in enumerate(zip(self.f.robots,['one','two','three'])):
            self.observe(self.frame('f'+str(i)),pid);self.approve(pid);self.f.claim(pid,rid)
        self.assertEqual(len({t['robot_id'] for t in self.f.data['tasks'].values()}),3)
        with self.assertRaises(ValueError):self.f.claim('one','ground-2')
        self.observe(self.frame('four'),'four')
        self.approve('four')
        with self.assertRaises(ValueError):self.f.claim('four','ground-1')

    def prepare(self):
        self.f.control('start');self.observe(self.frame('drone'),'one');self.approve('one');self.f.claim('one','ground-1');self.f.transition('one','ground-1','verifying')

    def test_fresh_same_target_assigned_camera_two_frames_required(self):
        self.prepare()
        for actor,task,when in [('ground-2','one',100),('ground-1','two',100),('ground-1','one',99)]:
            frame=self.frame('bad',actor,task=task);frame['wall_time']=when;self.observe(frame,'one')
        self.assertEqual(self.f.data['tasks']['one']['verification'],[])
        with self.assertRaises(ValueError):self.f.transition('one','ground-1','gripping')
        frame=self.frame('g1','ground-1',task='one');self.observe(frame,'one');self.observe(frame,'one')
        self.assertEqual(self.f.data['tasks']['one']['status'],'verifying')
        self.observe(self.frame('g2','ground-1',task='one'),'one')
        self.assertEqual(self.f.data['tasks']['one']['status'],'verified')
        for status in ['gripping','cutting','carrying','depositing','completed']:self.f.transition('one','ground-1',status)
        self.assertEqual(self.f.data['removed'],['one'])
        self.observe(self.frame('again'),'one');self.assertEqual(self.f.data['tasks']['one']['status'],'completed')

    def test_rejection_never_removes_fruit_and_lease_requeues(self):
        self.prepare();self.f.transition('one','ground-1','rejected','No visual confirmation');self.assertEqual(self.f.data['removed'],[])
        self.observe(self.frame('d2'),'two');self.approve('two');self.f.claim('two','ground-2');self.now+=91
        self.assertEqual(self.f.snapshot()['tasks']['two']['status'],'pending')

    def test_tree_is_an_exclusive_manipulation_resource(self):
        self.prepare();self.pods['two']['plant_id']=self.pods['one']['plant_id'];self.observe(self.frame('d2'),'two');self.approve('two')
        with self.assertRaises(ValueError):self.f.claim('two','ground-2')
        self.f.transition('one','ground-1','rejected');self.f.claim('two','ground-2')

    def test_persistence_return_and_explicit_reset(self):
        self.prepare();saved=copy.deepcopy(self.f.data);restored=Fleet(self.cfg,saved,clock=lambda:self.now)
        self.assertEqual(restored.snapshot(),saved);restored.control('return');self.assertTrue(restored.data['returning']);self.assertFalse(restored.data['enabled'])
        restored.control('reset');self.assertEqual(restored.data['tasks'],{});self.assertEqual(restored.data['epoch'],1)


if __name__=='__main__':unittest.main()
