import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroundMotionRows,sampleGroundMotion,advanceWheelOdometry} from './ui/orchard/scripted-ground-motion.mjs';
const spec={base:{track_m:.8,wheel_radius_m:.225}};
for(const yaw of [0,Math.PI/2,Math.PI])test(`harvest, reverse and stationary wait preserve wheel motion at heading ${yaw}`,()=>{
 const direction=[Math.cos(yaw),Math.sin(yaw)],stop=[4,5],park=stop.map((n,i)=>n-direction[i]*.8),tree=stop.map((n,i)=>n+direction[i]);
 const rows=createGroundMotionRows([{stop,park,yaw},{stop:[9,10],park:[8.2,10],yaw:0}],null),row=rows.rows[0];let wheels=[0,0,0,0],previous=null,harvestWheels=null,previousDistance=0;
 for(let t=0;t<row.travel+row.harvest+row.retreat;t+=.025){
  const motion=sampleGroundMotion(row,t);wheels=advanceWheelOdometry(previous,motion,wheels,spec);
  if(motion.phase==='harvesting'){
   assert.deepEqual(motion.position,stop);if(harvestWheels)assert.deepEqual(wheels,harvestWheels);harvestWheels=wheels.slice();
  }
  if(motion.phase==='retreating'){
   const d=Math.hypot(...motion.position.map((v,i)=>v-tree[i]));assert.ok(d>=previousDistance);previousDistance=d;
   assert.ok(motion.speed<=0);if(previous?.phase==='retreating')for(let i=0;i<4;i++)assert.ok(wheels[i]<=previous.wheels[i]+1e-9);
  }
  previous={...motion,wheels:wheels.slice()};
 }
 const waiting=sampleGroundMotion(rows.rows[1],0,false),frozen=wheels.slice();
 for(let i=0;i<100;i++){wheels=advanceWheelOdometry(waiting,waiting,wheels,spec);assert.deepEqual(wheels,frozen);assert.deepEqual(waiting.position,park);assert.equal(waiting.speed,0);}
});
test('a mission starts and finishes at its declared station',()=>{
 const station={position:[-5,-5],yaw:Math.PI/2},stops=[{stop:[3,2],park:[2.2,2],yaw:0}],schedule=createGroundMotionRows(stops,null,{initialPose:station,returnPose:station});
 assert.deepEqual(sampleGroundMotion(schedule.rows[0],0,false).position,station.position);
 const home=schedule.rows.at(-1);assert.equal(home.returning,true);const final=sampleGroundMotion(home,home.travel);
 assert.deepEqual(final.position,station.position);assert.equal(final.speed,0);
});
