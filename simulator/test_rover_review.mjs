import assert from 'node:assert/strict';
import fs from 'node:fs';
import {solveArm,armTip} from './ui/robotics/arm-kinematics.mjs';
import {buildReview,sampleReview} from './ui/robotics/review-motion.mjs';
const spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const plan=buildReview(spec);
assert.equal(plan.duration,spec.review.duration_s);
// Reachability is checked before the review can start, including the downward
// wrist orientation used over the bin, rather than clamping a missed target.
for(const frame of spec.review.keyframes.filter(f=>f.target)){
  const p=sampleReview(frame.time,plan),tip=armTip(p.angles,spec.arm).map((v,i)=>v+p.base[i]+spec.base.mount[i]);
  assert.ok(distance(tip,spec.review.targets[frame.target])<1e-9,frame.target);
}
assert.equal(solveArm([9,9,0],0,spec.arm).reachable,false);
// All intermediate poses stay within the specified joint limits. This does
// not claim self-collision, tipping or force validation.
let previous=sampleReview(0,plan);
for(let t=.01;t<=plan.duration;t+=.01){
  const p=sampleReview(t,plan);
  p.angles.forEach((v,i)=>{assert.ok(Number.isFinite(v));assert.ok(v>=spec.arm.limits_rad[i][0]&&v<=spec.arm.limits_rad[i][1]);assert.ok(Math.abs(v-previous.angles[i])<.04)});
  previous=p;
}
assert.deepEqual(sampleReview(-10,plan),sampleReview(0,plan));
assert.deepEqual(sampleReview(999,plan),sampleReview(plan.duration,plan));
const atGrasp=sampleReview(spec.review.payload.grasp_s,plan);
assert.equal(atGrasp.opening,0);
assert.equal(sampleReview(12.2,plan).cut,1);
assert.equal(sampleReview(21.2,plan).opening,1);
// A manual tool-tilt must actually change the end point, whereas rolling a
// straight tool about its own axis must not translate it.
const q=spec.arm.folded_rad.slice(),p=armTip(q,spec.arm);
q[4]=.5;assert.ok(distance(p,armTip(q,spec.arm))<1e-12);
q[5]=.3;assert.ok(distance(p,armTip(q,spec.arm))>.02);
console.log('Rover review: target reach, joint limits, continuity, endpoints and gripper sequence passed.');
