import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createGroundDriver} from './ui/orchard/ground-driver.mjs';

const spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
const config=JSON.parse(fs.readFileSync(new URL('./orchard_config.json',import.meta.url)));

for(const origin of [[0,0],[15,-9]]){
 test(`safety recovery holds the vehicle without claiming arrival at origin ${origin}`,async()=>{
  const world={
   terrain:{origin:[-20,-20],columns:9,rows:9,spacing:10,heights:Array(81).fill(0)},
   plants:[],
   config:{...config,ground_vehicle:{...config.ground_vehicle,origin_enu:origin,route_local_xz:[[0,0],[4,0]]}}
  };
  const driver=await createGroundDriver(spec,world);
  try{
   assert.equal(driver.recover(),false,'An idle vehicle has no safety stop to clear');
   for(let i=0;i<240;i++)driver.step({enabled:false});
   driver.navigate([[0,0],[4,0]]);
   assert.equal(driver.recover(),false,'A moving route must not be reset by recovery');
   const tilt=spec.dynamics.stop_tilt_rad+.1;
   driver.dynamics.body.setRotation({x:Math.sin(tilt/2),y:0,z:0,w:Math.cos(tilt/2)},true);
   assert.equal(driver.step().status,'stopped');
   assert.equal(driver.recover(),false,'Unsafe tilt must continue to block recovery');
   driver.dynamics.body.setRotation({x:0,y:0,z:0,w:1},true);
   for(let i=0;i<480;i++)driver.step({enabled:false});
   assert.equal(driver.recover(),true,'Stable ground support clears the safety stop');
   let state=driver.state();
   assert.equal(state.status,'paused');
   assert.ok(Math.hypot(state.position[0]-4,state.position[2])>1,'The destination has not been reached');
   assert.equal(driver.recover(),false,'Recovery cannot be repeatedly applied to a paused vehicle');
   for(let i=0;i<120;i++)state=driver.step();
   assert.equal(state.status,'paused','Recovery must hold until explicitly resumed or replanned');
   driver.resume();
   assert.equal(driver.state().status,'running');
   for(let i=0;i<4000;i++){
    state=driver.step();
    if(state.status==='complete'||state.status==='stopped')break;
   }
   assert.equal(state.status,'complete');
   assert.ok(Math.hypot(state.position[0]-4,state.position[2])<.35,'Completion requires actual arrival');
  }finally{
   driver.dispose();
  }
 });
}
