import unittest
from test_fleet_core import FleetContract
from fleet_core import Fleet

class AutomaticIntervention(unittest.TestCase):
    frame=FleetContract.frame
    observe=FleetContract.observe
    def setUp(self):
        FleetContract.setUp(self);self.cfg['fleet']['intervention']={'approval':'automatic','confirmation':'initial_detection'};self.f=Fleet(self.cfg,clock=lambda:self.now)
    def test_automatic_cycle_has_no_human_or_repeated_classifier_gate(self):
        self.f.control('start');self.observe(self.frame('pixels'),'one');self.assertEqual(self.f.data['tasks']['one']['status'],'pending')
        self.f.claim('one','ground-1');self.f.transition('one','ground-1','verifying');self.assertEqual(self.f.data['tasks']['one']['status'],'verified')
        for step in ['gripping','cutting','carrying','depositing','completed']:self.f.transition('one','ground-1',step)
        self.assertEqual(self.f.data['removed'],['one'])
    def test_class_threshold_still_drives_selection(self):
        self.observe(self.frame('healthy',kind=0),'one');self.observe(self.frame('low',score=.3),'two');self.assertFalse(self.f.data['tasks'])

if __name__=='__main__':unittest.main()
