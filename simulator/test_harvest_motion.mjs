import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildHarvestPlan,sampleHarvestStage} from './ui/orchard/harvest-motion.mjs';import {armTip} from './ui/robotics/arm-kinematics.mjs';
import * as THREE from 'three';
import {createFieldRover} from './ui/robotics/field-rover.js';
import {bindFruit,payloadPose} from './ui/orchard/payload-pose.js';
const spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url))),results=[];
// Only the decorative chassis label needs a canvas; all articulated meshes
// and transforms below use the real Three.js model.
globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
const rover=createFieldRover(spec),vehicle={id:'fixture',rover,state:{elapsed:0}};
rover.root.position.set(4,.2,-8);rover.root.rotation.y=.7;
for(const target of [[.8,.65,0],[.75,.9,.2],[-.65,.6,.3],[.5,.85,-.5]]){
 const plan=buildHarvestPlan(spec,target,spec.arm.folded_rad);assert.equal(plan.at(-1).kind,'folding');
 const grip=plan.find(s=>s.kind==='gripping');assert.ok(Math.hypot(...armTip(grip.target.angles,spec.arm).map((v,i)=>v-target[i]))<1e-8);
 let previous=plan[0].from;for(const stage of plan){const begin=sampleHarvestStage(stage,0),end=sampleHarvestStage(stage,stage.duration);assert.ok(begin.angles.every((v,i)=>Math.abs(v-previous.angles[i])<1e-10));assert.ok(end.angles.every((v,i)=>Math.abs(v-stage.target.angles[i])<1e-10));assert.ok(stage.duration>=1.1);previous=stage.target}
 assert.ok(plan.find(s=>s.kind==='gripping').target.opening<.85);assert.equal(plan.find(s=>s.kind==='cutting').target.cut,1);assert.equal(plan.find(s=>s.kind==='releasing').target.opening,1);
 rover.pose(grip.target.angles,{opening:grip.target.opening});
 const expected=rover.root.localToWorld(new THREE.Vector3(...target).add(new THREE.Vector3(...spec.base.mount))),actual=rover.tcp.getWorldPosition(new THREE.Vector3());
 assert.ok(actual.distanceTo(expected)<1e-8,'Rendered gripper reaches the same fruit as the kinematics');
 const pod={id:'test-fruit',position:[expected.x,-expected.z,expected.y],angle:.3},attached=bindFruit(pod,vehicle),initial=payloadPose(attached,vehicle);
 assert.ok(Math.hypot(...initial.position.map((v,i)=>v-pod.position[i]))<1e-8,'Attachment preserves fruit position');
 const carrying=plan.find(s=>s.kind==='carrying');rover.pose(carrying.target.angles,{opening:carrying.target.opening});
 const moved=payloadPose(attached,vehicle),tcp=rover.tcp.getWorldPosition(new THREE.Vector3());
 assert.ok(Math.hypot(moved.position[0]-tcp.x,moved.position[1]+tcp.z,moved.position[2]-tcp.y)<1e-8,'Fruit follows the actual tool');
 assert.ok(Math.hypot(...moved.position.map((v,i)=>v-initial.position[i]))>.2,'Fruit visibly leaves the tree');
 results.push({target,duration:plan.reduce((n,s)=>n+s.duration,0),stages:plan.map(s=>s.kind)});
}
console.log(JSON.stringify(results));
