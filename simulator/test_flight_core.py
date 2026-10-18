import copy
import json
import math
from pathlib import Path
import unittest
from flight_core import Battery, flight_control, motor_power, return_budget, plan_horizontal_path
from generate_orchard import scene

CONFIG=json.loads((Path(__file__).parent/'orchard_config.json').read_text())


class EnergyAndScene(unittest.TestCase):
    def test_payload_increases_motor_power(self):
        self.assertGreater(motor_power(2.85*9.81,CONFIG['flight']),motor_power(2.4*9.81,CONFIG['flight']))

    def test_discharge_is_physical_time_based(self):
        a=Battery(CONFIG['battery']);b=Battery(CONFIG['battery'])
        a.consume(250,10);b.consume(250,20)
        self.assertAlmostEqual(1-b.soc,2*(1-a.soc),places=7)

    def test_empty_full_and_invalid_input(self):
        a=Battery(CONFIG['battery'],.001);a.consume(300,10000);self.assertEqual(a.soc,0)
        a=Battery(CONFIG['battery'],1);a.charge(100);self.assertEqual(a.soc,1)
        for value in [float('nan'),-1]:
            with self.assertRaises(ValueError):a.consume(1,value)

    def test_voltage_sag_and_cc_cv_taper(self):
        a=Battery(CONFIG['battery']);v=a.open_voltage;a.consume(300,1);self.assertLess(a.voltage_v,v)
        a=Battery(CONFIG['battery'],.4);b=Battery(CONFIG['battery'],.95);a.charge(1);b.charge(1)
        self.assertGreater(abs(a.current_a),abs(b.current_a));self.assertGreater(b.soc,.95)

    def test_return_budget_includes_distance_payload_and_reserve(self):
        battery=Battery(CONFIG['battery']);args=[CONFIG['field']['home'],CONFIG['flight'],battery]
        near=return_budget([0,6,1.5],*args);far=return_budget([100,100,1.5],*args)
        loaded=return_budget([100,100,1.5],*args,payload_kg=.45)
        self.assertGreater(far['required_wh'],near['required_wh']);self.assertGreater(loaded['required_wh'],far['required_wh'])
        self.assertGreater(near['required_wh'],near['travel_wh'])
        low=Battery(CONFIG['battery'],.1)
        self.assertLess(return_budget([0,6,1.5],CONFIG['field']['home'],CONFIG['flight'],low)['margin_wh'],0)

    def test_stationary_controller_and_wind_drag(self):
        thrust,torque,drag,stable=flight_control([0,0,1],[0]*6,[1,0,0,0,1,0,0,0,1],[0,0,1],0,CONFIG['flight'])
        self.assertAlmostEqual(thrust,CONFIG['flight']['mass_kg']*9.81);self.assertTrue(stable);self.assertGreater(drag[0],0)

    def test_force_saturation_yaw_and_movement(self):
        thrust,torque,drag,stable=flight_control([0,0,1],[0]*6,[1,0,0,0,1,0,0,0,1],[100,0,4],math.pi/2,CONFIG['flight'])
        self.assertLessEqual(thrust,CONFIG['flight']['max_thrust_n']);self.assertGreater(torque[2],0);self.assertFalse(stable)

    def test_scene_is_deterministic_and_route_is_configured_crop(self):
        c=copy.deepcopy(CONFIG)
        c['parcels']=[{'id':'plot-a','crop':'cacao','origin':[0,4],'rows':2,'columns':3,'spacing':[4,4]}, {'id':'plot-b','crop':'coffee','origin':[20,4],'rows':1,'columns':2,'spacing':[2,2]}]
        first=scene(c);second=scene(c);self.assertEqual(first,second)
        low,high=c['vegetation']['profiles']['cacao']['pods']
        self.assertGreaterEqual(len(first['pods']),6*low);self.assertLessEqual(len(first['pods']),6*high)
        self.assertEqual(len(first['plants']),8)
        ids={p['id']:p for p in first['plants']}
        self.assertTrue(all(ids[identifier]['crop']==c['inspection']['crop'] for identifier in first['route']))
        c['inspection']['crop']='coffee';alternate=scene(c)
        self.assertEqual(len(alternate['pods']),10)
        self.assertTrue(all(ids[identifier]['crop']=='coffee' for identifier in alternate['route']))

    def test_navigation_uses_clear_segments_around_obstacle(self):
        path=plan_horizontal_path([-2,0],[2,0],[[0,0]],clearance=.6)
        self.assertGreater(len(path),1);last=[-2,0]
        for point in path:
            dx,dy=point[0]-last[0],point[1]-last[1];t=max(0,min(1,-(last[0]*dx+last[1]*dy)/(dx*dx+dy*dy)))
            self.assertGreaterEqual(math.hypot(last[0]+t*dx,last[1]+t*dy),.6);last=point
        self.assertEqual(path[-1],[2,0])

    def test_navigation_direct_and_impossible_paths(self):
        self.assertEqual(plan_horizontal_path([0,0],[2,2],[]),[[2,2]])
        with self.assertRaises(ValueError):plan_horizontal_path([0,0],[2,2],[[0,0]],clearance=.6)


if __name__=='__main__':unittest.main()
