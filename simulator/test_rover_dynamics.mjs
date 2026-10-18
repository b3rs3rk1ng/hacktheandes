import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initPhysics,createRoverDynamics} from './ui/robotics/rover-dynamics.mjs';
import {courseConfig,buildCourse,terrainHeight} from './ui/robotics/terrain-course.mjs';
await initPhysics();
const spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
const radiansToDegrees=v=>v*180/Math.PI;
function run(config,{radius=spec.base.wheel_radius_m,drive=true}={}){
 const s=structuredClone(spec);s.base.wheel_radius_m=radius;const d=createRoverDynamics(s,{course:buildCourse(config)}),trace=[];let peakPitch=0,peakRoll=0,maxCompression=0,maxWheelDifference=0,minContacts=4,last;
 for(let i=0;i<6000;i++){
  last=d.step({drive});assert.ok(last.position.every(Number.isFinite));
  if(i>120){peakPitch=Math.max(peakPitch,Math.abs(last.pitch));peakRoll=Math.max(peakRoll,Math.abs(last.roll));minContacts=Math.min(minContacts,last.wheels.filter(w=>w.contact).length);maxCompression=Math.max(maxCompression,...last.wheels.map(w=>w.compression));maxWheelDifference=Math.max(maxWheelDifference,Math.max(...last.wheels.map(w=>w.y))-Math.min(...last.wheels.map(w=>w.y)));}
  if(i%120===0)trace.push({time_s:+last.elapsed.toFixed(2),x_m:+last.position[0].toFixed(3),speed_mps:+last.speed.toFixed(3),pitch_deg:+radiansToDegrees(last.pitch).toFixed(2),roll_deg:+radiansToDegrees(last.roll).toFixed(2),contacts:last.wheels.map(w=>w.contact)});
  if(last.status!=='running'&&Math.abs(last.speed)<.025)break;
  if(!drive&&last.elapsed>4)break;
 }
 const result={status:last.status,time_s:last.elapsed,x_m:last.position[0],z_m:last.position[2],speed_mps:last.speed,mass_kg:last.mass,peak_pitch_deg:radiansToDegrees(peakPitch),peak_roll_deg:radiansToDegrees(peakRoll),max_compression_m:maxCompression,max_wheel_height_difference_m:maxWheelDifference,min_contacts:minContacts,trace};d.dispose();return result;
}
const flat=structuredClone(courseConfig);flat.incline.grade=flat.crossSlope.grade=flat.ruts.depth=0;flat.rocks=[];flat.roots=[];
const flatResult=run(flat);assert.equal(flatResult.status,'complete');assert.ok(flatResult.peak_pitch_deg<3);assert.ok(Math.abs(flatResult.z_m)<.05);
const rough=run(courseConfig);assert.equal(rough.status,'complete');assert.ok(rough.peak_pitch_deg>7);assert.ok(rough.peak_roll_deg>4);assert.ok(rough.max_wheel_height_difference_m>.025);assert.ok(Math.abs(rough.z_m)<.15);assert.ok(rough.time_s<40);assert.ok(Math.abs(rough.speed_mps)<.025);
const stationary=run(flat,{drive:false});assert.ok(Math.abs(stationary.x_m-flat.startX)<.005,'Gravity and suspension cannot advance a level vehicle without drive force');
const resized=run(flat,{radius:.26});assert.equal(resized.status,'complete','Wheel radius is a shared model parameter');
const safety=createRoverDynamics(spec);for(let i=0;i<240;i++)safety.step({drive:false});safety.body.setRotation({x:Math.sin(.8/2),y:0,z:0,w:Math.cos(.8/2)},true);const stopped=safety.step();assert.equal(stopped.status,'stopped');for(let i=0;i<4;i++)assert.equal(safety.vehicle.wheelEngineForce(i),0);const reset=safety.reset();assert.equal(reset.status,'running');assert.ok(Math.abs(reset.position[0]-courseConfig.startX)<1e-5);assert.equal(reset.elapsed,0);safety.dispose();
assert.ok(Math.abs(terrainHeight(5,0)-.42)<.01);
const report={engine:'Rapier 0.21.0',step_s:spec.dynamics.timestep_s,limits:'Estimated rigid chassis and raycast wheel dynamics; no hardware, deformable soil, arm-contact or crop-vision validation.',cases:{rough,flat:flatResult,stationary,resized},safety:'Tilt stop, zero engine force, reset passed'};
fs.mkdirSync(new URL('./ui/robot-preview/evidence/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('./ui/robot-preview/evidence/terrain-physics.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rough:{...rough,trace:undefined},flat:{...flatResult,trace:undefined},stationary_x_m:stationary.x_m,resized_status:resized.status,safety:report.safety},null,2));
