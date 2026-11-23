import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficCoordinator,sweptGap} from './ui/orchard/traffic-coordinator.mjs';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function run(definitions,seconds=25){
 const coordinator=createTrafficCoordinator(),actors=definitions.map(d=>({...d,progress:0,waits:0})),dt=.05;
 for(let time=0;time<seconds;time+=dt){
  const pose=(actor,offset)=>{const progress=Math.min(actor.length,actor.progress+actor.speed*offset);return {position:actor.start.map((v,i)=>v+actor.direction[i]*progress),radius:actor.radius||.55}};
  const decisions=coordinator.resolve(actors.map(a=>({id:a.id,requestedAt:0,sample:t=>pose(a,t)})),time,dt),before=actors.map(a=>pose(a,0));
  actors.forEach(a=>{if(decisions.get(a.id).allowed)a.progress=Math.min(a.length,a.progress+a.speed*dt);else a.waits++});
  const after=actors.map(a=>pose(a,0));for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++)assert.ok(sweptGap(before[i],after[i],before[j],after[j],.12)>=-1e-7,'continuous swept footprints must never touch');
 }
 return actors;
}
for(const count of [2,3])test(`${count} crossing routes yield and all finish regardless of input order`,()=>{
 for(const reverse of [false,true]){
  const defs=Array.from({length:count},(_,i)=>{const a=i*Math.PI/count;return {id:`vehicle-${count-i}`,start:[Math.cos(a)*-4,Math.sin(a)*-4],direction:[Math.cos(a),Math.sin(a)],length:8,speed:1}});
  const result=run(reverse?defs.reverse():defs);assert.ok(result.every(a=>a.progress===a.length),'no intersection deadlock');assert.ok(result.some(a=>a.waits>0));
 }
});
test('a fast follower brakes behind a slower vehicle and resumes',()=>{
 const result=run([{id:'fast',start:[-4,0],direction:[1,0],length:10,speed:1.5},{id:'slow',start:[-1.8,0],direction:[1,0],length:14,speed:.7}],35);
 assert.ok(result[0].waits>0);assert.equal(result[0].progress,10);assert.equal(result[1].progress,14);
});
test('opposing vehicles stop safely when neither can pass a held vehicle',()=>{
 const result=run([{id:'left',start:[-3,0],direction:[1,0],length:6,speed:1},{id:'right',start:[3,0],direction:[-1,0],length:6,speed:1}],12);
 assert.ok(result.every(a=>a.waits>0));assert.ok(result.every(a=>a.progress<6));
});
test('swept checking catches an exchange of positions between snapshots',()=>{
 const a={position:[-2,0],radius:.4},b={position:[2,0],radius:.4};assert.ok(sweptGap(a,b,b,a,.1)<0);
});
test('arm expansion waits for a nearby moving vehicle to clear',()=>{
 const control=createTrafficCoordinator(),dt=.05;let arm=0,vehicle=0,held=0;
 for(let now=0;now<8;now+=dt){
  const sampleArm=t=>({position:[0,0],radius:.4+.8*Math.min(1,arm+t*2)}),sampleVehicle=t=>({position:[1.4+Math.min(3,vehicle+t*.5),0],radius:.4}),before=[sampleArm(0),sampleVehicle(0)],decisions=control.resolve([{id:'arm',sample:sampleArm},{id:'passing',sample:sampleVehicle}],now,dt);
  if(decisions.get('arm').allowed)arm=Math.min(1,arm+dt*2);else held++;
  if(decisions.get('passing').allowed)vehicle=Math.min(3,vehicle+dt*.5);
  assert.ok(sweptGap(before[0],sampleArm(0),before[1],sampleVehicle(0),.12)>=-1e-8);
 }
 assert.ok(held>0);assert.equal(arm,1);assert.equal(vehicle,3);
});
