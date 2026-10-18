import unittest
from coverage_plan import build_coverage, CoverageLedger, scout_can_advance, next_scout_index


class CoverageContract(unittest.TestCase):
    def setUp(self):
        self.cfg={'inspection':{'crop':'crop'},'fleet':{'robots':[{'id':str(i),'station_enu':[i*4,-4]} for i in range(3)],'coverage':{'enabled':True,'lane_spacing_m':4,'minimum_survey_frames':2}}}
        self.plants=[{'id':f'{x}:{y}','crop':'crop','position':[x*4+.05,y*4,0]} for x in range(7) for y in range(5)]
        self.plan=build_coverage(self.plants,self.cfg)

    def test_all_trees_once_and_neighboring_lanes(self):
        ids=[pid for batch in self.plan['batches'] for lane in batch['lanes'] for pid in lane['tree_ids']]
        self.assertEqual(set(ids),{p['id'] for p in self.plants});self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual(set(self.plan['drone_route']),set(ids))
        for batch in self.plan['batches']:
            lanes=[l['lane'] for l in batch['lanes']];self.assertLessEqual(max(lanes)-min(lanes),2)

    def test_cannot_skip_tree_or_use_other_robot_camera(self):
        state={};ledger=CoverageLedger(self.plan,self.cfg,state);tree=ledger.target('0')
        with self.assertRaises(ValueError):ledger.complete('0',tree)
        def frame(i,role,actor,plant):return {'frame_id':i,'camera_role':role,'vehicle_id':actor,'plant_id':plant,'predictions':[]}
        for i in range(2):ledger.observe(frame('d'+str(i),'scout','drone',tree))
        ledger.observe(frame('wrong','survey','1',tree))
        with self.assertRaises(ValueError):ledger.complete('0',tree)
        for i in range(2):ledger.observe(frame('g'+str(i),'survey','0',tree))
        ledger.complete('0',tree);self.assertEqual(state['indices']['0'],1)
        with self.assertRaises(ValueError):ledger.complete('0',tree)

    def test_drone_lead_bound_and_rotated_axis(self):
        batch=self.plan['batches'][0];lane=batch['lanes'][0]
        self.assertTrue(scout_can_advance(self.plan,lane['tree_ids'][1],{},1))
        self.assertFalse(scout_can_advance(self.plan,lane['tree_ids'][2],{},1))
        self.cfg['fleet']['coverage']['axis_enu']=[1,0]
        rotated=build_coverage(self.plants,self.cfg);self.assertEqual(rotated['axis_enu'],[1.,0.])
        self.assertEqual(len(set(rotated['drone_route'])),len(self.plants))


    def test_local_inspection_requires_own_frames_and_declared_scout_unavailability(self):
        self.cfg['fleet']['coverage']['continue_without_scout']=True
        state={};ledger=CoverageLedger(self.plan,self.cfg,state);tree=ledger.target('0')
        ledger.set_scout({'phase':'charging','updated_at':100},now=101)
        with self.assertRaises(ValueError):ledger.complete('0',tree)
        for i in range(2):ledger.observe({'frame_id':f'local{i}','camera_role':'survey','vehicle_id':'0','plant_id':tree,'predictions':[]})
        ledger.set_scout({'phase':'inspect','updated_at':101},now=102)
        with self.assertRaises(ValueError):ledger.complete('0',tree)
        ledger.set_scout({'phase':'charging','updated_at':102},now=103)
        ledger.complete('0',tree)
        self.assertEqual(state['completed'][tree]['method'],'ground_local')
        self.assertNotIn(tree,state['scouted'])
        self.assertGreater(next_scout_index(self.plan,0,state),0)
        ledger.set_scout({'phase':'inspect','updated_at':103},now=104)
        self.assertFalse(state['local_inspection_allowed'])

    def test_scout_rejoins_frontier_after_batch_and_handles_complete_field(self):
        first=self.plan['batches'][0]
        state={'batch':1,'indices':{}}
        index=next_scout_index(self.plan,0,state)
        self.assertEqual(index,len(first['scout_tree_ids']))
        state['batch']=len(self.plan['batches'])
        self.assertEqual(next_scout_index(self.plan,0,state),len(self.plan['drone_route']))


if __name__=='__main__':unittest.main()
