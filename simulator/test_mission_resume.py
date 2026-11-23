import unittest
from mission_resume import parked_checkpoint,restore_parked


class MissionResumeContract(unittest.TestCase):
    def setUp(self):
        self.world={'config':{'field':{'home':[0,0,.4]}},'terrain':{'heights':[0]},'plants':[],'pods':[],'route':['tree']}
        self.state={'phase':'charging','position':[0,0,.39],'battery':{'soc':.23},'route_index':0}

    def test_parked_restart_preserves_energy_and_rejects_geometry_change(self):
        checkpoint=parked_checkpoint(self.state,self.world)
        self.assertEqual(restore_parked(checkpoint,self.world)['battery']['soc'],.23)
        self.world['terrain']['heights']=[1]
        self.assertIsNone(restore_parked(checkpoint,self.world))

    def test_never_restore_airborne_or_attached_payload(self):
        self.state['phase']='transit';self.assertIsNone(parked_checkpoint(self.state,self.world))
        self.state['phase']='charging';self.state['payload_attached']=True
        self.assertIsNone(parked_checkpoint(self.state,self.world))

    def test_parked_phase_requires_station_proximity(self):
        self.state['position']=[20,20,.4];self.assertIsNone(parked_checkpoint(self.state,self.world))


if __name__=='__main__':unittest.main()
