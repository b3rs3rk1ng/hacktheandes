import json,math,unittest
from pathlib import Path
from flight_core import FlightDynamics,wrap
F=json.loads((Path(__file__).parent/'orchard_config.json').read_text())['flight']
I=[1,0,0,0,1,0,0,0,1]
class DroneDynamics(unittest.TestCase):
 def test_limits_across_reversal_yaw_wrap_and_ground(self):
  d=FlightDynamics(F);last=[0]*3;last_yaw=0;dt=.016
  for n in range(900):
   goal=[12 if n<400 else -12,8,3];yaw=3.13 if n<500 else -3.13
   thrust,torque,drag,stable=d.step([0,0,1],[0]*6,I,goal,yaw,dt,time_s=n*dt)
   self.assertLessEqual(math.dist(last,d.acceleration),F.get('max_jerk_mps3',3)*dt+1e-10)
   self.assertLessEqual(abs(wrap(d.yaw-last_yaw)),.85*dt+1e-10)
   self.assertTrue(0<=thrust<=F['max_thrust_n']);self.assertLessEqual(abs(torque[2]),.35)
   last=list(d.acceleration);last_yaw=d.yaw
  thrust,torque,drag,stable=d.step([0,0,1],[0]*6,I,[0,0,1],0,dt,armed=False)
  self.assertEqual(thrust,0);self.assertEqual(torque,[0]*3);self.assertEqual(d.acceleration,[0]*3)
 def test_hover_settles_and_payload_and_gust(self):
  for payload in [0,.5]:
   d=FlightDynamics(F)
   for n in range(600):result=d.step([0,0,1],[0]*6,I,[0,0,1],0,.016,time_s=n*.016,payload_kg=payload)
   self.assertAlmostEqual(result[0],(F['mass_kg']+payload)*9.81,places=6)
   self.assertNotEqual(d.wind,F['wind_mps']);self.assertTrue(result[3])
 def test_configuration_and_invalid_timestep(self):
  d=FlightDynamics({**F,'max_jerk_mps3':1,'gust_amplitude_mps':0})
  d.step([0,0,1],[0]*6,I,[9,0,2],0,.02)
  self.assertLessEqual(math.dist(d.acceleration,[0]*3),.020000001)
  self.assertEqual(d.wind,F['wind_mps'])
  for dt in [0,-1,float('nan')]:
   with self.assertRaises(ValueError):d.step([0,0,1],[0]*6,I,[0,0,1],0,dt)
if __name__=='__main__':unittest.main()
