import unittest,math
from flight_geometry import vegetation_capsules,ObstacleField,nearest_on_segment,segment_distance,segment_clear,plan_vertical_escape
class FlightGeometry(unittest.TestCase):
 def test_capsules_from_generic_structure_and_depth(self):
  plant={'position':[8,4,1],'height':3,'structure':{'bones':[[0,0,0,0,0,1,.10,.07,0],[0,0,1,1,0,2,.05,.02,1],[1,0,2,1,1,2.2,.01,.005,2]]}}
  caps=list(vegetation_capsules(plant));self.assertEqual(len(caps),2);self.assertEqual(caps[0]['a'],[8,4,1]);self.assertEqual(caps[1]['b'],[9,4,3]);self.assertEqual(len(list(vegetation_capsules(plant,max_depth=0))),1)
  self.assertEqual(len(list(vegetation_capsules({'position':[0,0,0],'height':2}))),1)
 def test_away_braking_and_spatial_independence(self):
  f=ObstacleField([{'a':[0,0,0],'b':[0,0,3],'radius':.1}])
  near,gap=f.safety_acceleration([.65,0,1],[-.8,0,0],.285,1.2)
  self.assertGreater(near[0],0);self.assertAlmostEqual(gap,.265)
  far,gap=f.safety_acceleration([10,10,1],[0,0,0],.285,1.2);self.assertEqual(far,[0]*3)
  self.assertEqual(nearest_on_segment([5,1,2],[2,2,2],[2,2,2]),[2,2,2])
 def test_climb_detours_around_branch_and_rejects_blocked(self):
  f=ObstacleField([{'a':[-1,0,2],'b':[1,0,2],'radius':.08}])
  self.assertAlmostEqual(segment_distance([0,0,0],[0,0,3],[-1,0,2],[1,0,2]),0)
  self.assertAlmostEqual(segment_distance([0,0,0],[0,0,1],[2,0,0],[2,0,1]),2)
  path=plan_vertical_escape([0,0,1],4,f,.285,margin=.18)
  self.assertGreater(len(path),1);last=[0,0,1]
  for p in path:self.assertTrue(segment_clear(f,last,p,.285,.18));last=p
  clear=ObstacleField([]);self.assertEqual(plan_vertical_escape([0,0,1],4,clear,.285),[[0,0,4]])
  with self.assertRaises(ValueError):plan_vertical_escape([0,0,1],4,f,.285,max_lateral_m=.1)
 def test_cage_contains_rotor_discs(self):
  import json
  from pathlib import Path
  f=json.loads((Path(__file__).parent/'orchard_config.json').read_text())['flight']
  tip_radius=math.hypot(f['rotor_arm_m']+f['rotor_radius_m']+.008,.027)
  self.assertLess(tip_radius,f['cage_radius_m'])
if __name__=='__main__':unittest.main()
