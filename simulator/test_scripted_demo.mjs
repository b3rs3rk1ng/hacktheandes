import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScriptedDemo} from './ui/orchard/scripted-demo.mjs';
const spec=JSON.parse(readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
function fixture(count){
 const robots=Array.from({length:count},(_,i)=>({id:`actor-${i}`,station:[i*4,-4],spec}));
 const plants=robots.flatMap((r,i)=>Array.from({length:4},(_,j)=>({id:`tree-${i}-${j}`,crop:'fruit',position:[i*4,j*4,0]})));
 const pods=plants.flatMap(p=>[0,1].map(i=>({id:`${p.id}-fruit-${i}`,plant_id:p.id,position:[p.position[0]+.15,p.position[1],1+i*.2],radii_m:[.05,.05,.14]})));
 return {robots,world:{plants,pods,config:{inspection:{crop:'fruit'}},coverage:{batches:[{lanes:robots.map((r,i)=>({robot_id:r.id,tree_ids:plants.filter(p=>p.position[0]===i*4).map(p=>p.id)}))}]}}};
}
for(const count of [1,3])test(`scripted telemetry: ${count} actors keep moving across repeated cycles`,()=>{
 const {robots,world}=fixture(count),demo=createScriptedDemo(world,robots),phases=new Set();let previous;
 assert.deepEqual(demo.sample(-.5),demo.sample(0),'first animation timestamp can precede construction');
 for(let frame=0;frame<6000;frame++){
  const value=demo.sample(frame*.05);assert.equal(value.model.actual_inference,false);assert.equal(value.fleet.simulated,true);
  assert.ok(value.preview.progress===null||(value.preview.progress>=0&&value.preview.progress<=1));
  for(const task of Object.values(value.fleet.tasks))assert.ok(task.position.every(Number.isFinite));
  for(const robot of Object.values(value.fleet.robots)){
   phases.add(robot.phase);assert.ok(robot.arm_angles.every(Number.isFinite));assert.ok(robot.dynamics.rotation.every(Number.isFinite));
   if(previous)assert.ok(Math.hypot(...robot.position.map((n,i)=>n-previous.fleet.robots[robot.id].position[i]))<1,'continuous ground motion');
  }
  if(previous)assert.ok(Math.hypot(...value.physics.position.map((n,i)=>n-previous.physics.position[i]))<1,'continuous flight');
  previous=value;
 }
 for(const phase of ['navigating','gripping','cutting','carrying','depositing','folding'])assert.ok(phases.has(phase));
});
test('every fruit is scheduled before its tree order and robots await release',()=>{
 const {robots,world}=fixture(3),demo=createScriptedDemo(world,robots),seen=new Map();
 for(const row of demo.droneTrack.rows){
  const stop=row.stop;if(stop.kind==='scan'){
   if(!seen.has(stop.tree.id))seen.set(stop.tree.id,new Set());seen.get(stop.tree.id).add(stop.pod.id);
   assert.ok(demo.clearance.visible(stop.flight,stop.pod));
   for(let i=1;i<row.path.length;i++)assert.ok(demo.clearance.clear(row.path[i-1],row.path[i],.46,{groundMargin:.4,includeFoliage:true}));
  }else{
   assert.equal(seen.get(stop.tree.id).size,world.pods.filter(p=>p.plant_id===stop.tree.id).length);
   assert.ok(demo.releaseTimes.get(stop.tree.id)>row.start+row.travel+row.hold);
  }
 }
 const first=demo.sample(0);for(const robot of Object.values(first.fleet.robots))assert.equal(robot.phase,'waiting_scout');
 for(let i=1;i<8000;i++){
  const t=i*.05,value=demo.sample(t);for(const robot of Object.values(value.fleet.robots))if(robot.phase!=='waiting_scout')assert.ok(t>=demo.releaseTimes.get(robot.plant_id));
 }
 assert.equal([...seen.values()].reduce((n,s)=>n+s.size,0),world.pods.length);
});
