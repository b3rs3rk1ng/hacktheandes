import * as THREE from 'three';
import {SnapshotTimeline} from './motion.mjs';
import {heightAt} from './terrain.mjs';

export function createRemoteDriver(spec,world,robot){
 const [east,north]=robot.station_enu,timeline=new SnapshotTimeline({delayMs:220,adaptive:true}),base=spec.base;
 let value={position:[0,.05,0],rotation:[0,0,0,1],origin:[east,heightAt(world.terrain,east,north),-north],speed:0,pitch:0,roll:0,elapsed:0,status:'idle',soc:1,power:0,charging:false,estimated_hours:0,fast:false,progress:0,arm_angles:spec.arm.folded_rad,opening:1,cut:0,wheels:Array.from({length:4},()=>({y:base.wheel_radius_m,rotation:0,steering:0,compression:0,contact:true}))};
 function state(){return value}
 function step(){const sample=timeline.sample(performance.now());if(!sample)return value;const {from,to,alpha}=sample,a=from.dynamics,b=to.dynamics;if(!a||!b)return value;
  const mix=(x,y)=>x+(y-x)*alpha,rotation=new THREE.Quaternion().fromArray(a.rotation).slerp(new THREE.Quaternion().fromArray(b.rotation),alpha).toArray();
  const cameraA=from.inspection_pose,cameraB=to.inspection_pose,inspection_pose=cameraA&&cameraB?{position:cameraA.position.map((v,i)=>mix(v,cameraB.position[i])),rotation:new THREE.Quaternion().fromArray(cameraA.rotation).slerp(new THREE.Quaternion().fromArray(cameraB.rotation),alpha).toArray()}:null;
  value={...b,inspection_pose,position:a.position.map((v,i)=>mix(v,b.position[i])),rotation,arm_angles:from.arm_angles.map((v,i)=>mix(v,to.arm_angles[i])),opening:mix(from.opening,to.opening),cut:mix(from.cut,to.cut),wheels:a.wheels.map((w,i)=>({...w,y:mix(w.y,b.wheels[i].y),rotation:mix(w.rotation,b.wheels[i].rotation),steering:mix(w.steering,b.wheels[i].steering)}))};return value;
 }
 return {remote:true,state,step,receive(snapshot){if(snapshot.dynamics&&snapshot.arm_angles)timeline.push({...snapshot,simulation_time:snapshot.dynamics.elapsed,mission_time:snapshot.dynamics.elapsed},performance.now())},setAuxiliaryPower(){},pause(){},resume(){},setFast(){},reset:state};
}
