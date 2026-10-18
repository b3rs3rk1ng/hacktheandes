import * as THREE from 'three';
import {createFieldRover} from '../robotics/field-rover.js';
import {createGroundDriver} from './ground-driver.mjs';
import {solveArm} from '../robotics/arm-kinematics.mjs';
import {createVehicleLod} from './vehicle-lod.js';
import {createMountedCameraRig} from '/ui/drone/camera-rig.js';
import {createRemoteDriver} from './remote-driver.mjs';

export async function createGroundVehicle(scene,world,robot={id:'ground',label:'Robot terrestre'}){
 const spec=await fetch('/robotics/rover-spec.json').then(r=>{if(!r.ok)throw Error('No se pudo cargar el robot terrestre');return r.json()});
 const config=robot.station_enu?{...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:robot.station_enu}}}:world;
 const driver=robot.remote?createRemoteDriver(spec,world,robot):await createGroundDriver(spec,config),rover=createFieldRover(spec);rover.root.name=robot.label;scene.add(rover.root);
 if(robot.snapshot?.dynamics&&!driver.remote)driver.restore(robot.snapshot.dynamics);
 const lod=createVehicleLod(scene,rover,spec,{detailDistance:world.config.rendering?.rover_detail_distance_m||24});
 const camera=new THREE.PerspectiveCamera(spec.cameras.navigation.fov_deg,1,.03,600),follow=new THREE.PerspectiveCamera(58,1,.05,600),frame=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),optical=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2);
 let current=driver.state(),previous=current,accumulator=0,initialized=false;
 let arm=[...spec.arm.folded_rad],goal=[...arm],opening=1,cut=0,openingGoal=1,cutGoal=0,soundState={armSpeed:0,toolSpeed:0};
 const wrist=new THREE.PerspectiveCamera(spec.cameras.wrist.fov_deg,1,.03,600);
 const inspection=new THREE.PerspectiveCamera(58,1,.03,600),sensorOffset=new THREE.Vector3(.33,1.12,0),rig=createMountedCameraRig(inspection,rover.root,sensorOffset,{yawLimit:Math.PI,pitchMin:-1,pitchMax:1,response:.12,maxRate:1.5});let inspectionTarget=null;
 const mast=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.47,8),rover.materials.metal);mast.position.set(.33,.885,0);rover.root.add(mast);
 const sensorHead=new THREE.Group();sensorHead.position.copy(sensorOffset);rover.root.add(sensorHead);const casing=new THREE.Mesh(new THREE.BoxGeometry(.085,.065,.10),rover.materials.dark);casing.position.x=-.045;sensorHead.add(casing);const lens=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,.008,12),rover.materials.lens);lens.rotation.z=Math.PI/2;lens.position.x=-.006;sensorHead.add(lens);
 const origin=new THREE.Vector3(...current.origin),q=new THREE.Quaternion(),position=new THREE.Vector3();
 function update(dt,enabled=true){
  accumulator+=Math.min(dt,.05)*(current.fast?2:1);
  while(accumulator>=spec.dynamics.timestep_s){previous=current;current=driver.step({enabled});accumulator-=spec.dynamics.timestep_s}
  const alpha=accumulator/spec.dynamics.timestep_s;
  if(driver.remote){goal=current.arm_angles||spec.arm.folded_rad;openingGoal=current.opening??1;cutGoal=current.cut??0}
  position.fromArray(previous.position).lerp(new THREE.Vector3().fromArray(current.position),alpha).applyQuaternion(frame).add(origin);rover.root.position.copy(position);
  q.fromArray(previous.rotation).slerp(new THREE.Quaternion().fromArray(current.rotation),alpha);rover.root.quaternion.copy(frame).multiply(q);
  const oldArm=arm,oldOpening=opening,oldCut=cut;arm=arm.map((a,i)=>a+THREE.MathUtils.clamp(goal[i]-a,-dt*1.2,dt*1.2));opening=THREE.MathUtils.lerp(opening,openingGoal,1-Math.exp(-10*dt));cut=THREE.MathUtils.lerp(cut,cutGoal,1-Math.exp(-12*dt));soundState={armSpeed:arm.reduce((n,a,i)=>n+Math.abs(a-oldArm[i]),0)/Math.max(.001,dt),toolSpeed:(Math.abs(opening-oldOpening)+Math.abs(cut-oldCut))/Math.max(.001,dt)};driver.setAuxiliaryPower(Math.min(180,soundState.armSpeed*45+soundState.toolSpeed*12));
  const wheels=current.wheels.map((w,i)=>({...w,y:THREE.MathUtils.lerp(previous.wheels[i].y,w.y,alpha),rotation:THREE.MathUtils.lerp(previous.wheels[i].rotation,w.rotation,alpha),steering:THREE.MathUtils.lerp(previous.wheels[i].steering,w.steering,alpha)}));rover.pose(arm,{wheelStates:wheels,opening,cut});
  rover.cameraMounts.navigation.getWorldPosition(camera.position);rover.cameraMounts.navigation.getWorldQuaternion(camera.quaternion).multiply(optical);camera.updateMatrixWorld(true);
  rover.cameraMounts.wrist.getWorldPosition(wrist.position);rover.cameraMounts.wrist.getWorldQuaternion(wrist.quaternion).multiply(optical);wrist.updateMatrixWorld(true);
  const focus=inspectionTarget||new THREE.Vector3(3,1.12,0).applyQuaternion(rover.root.quaternion).add(position);if(driver.remote&&current.inspection_pose){inspection.position.fromArray(current.inspection_pose.position);inspection.quaternion.fromArray(current.inspection_pose.rotation);inspection.updateMatrixWorld(true)}else rig.update(dt,focus);sensorHead.quaternion.copy(rover.root.quaternion).invert().multiply(inspection.quaternion).multiply(optical.clone().invert());
  const target=position.clone().add(new THREE.Vector3(0,.72,0)),offset=new THREE.Vector3(-2.2,1.45,2.3).applyQuaternion(rover.root.quaternion),followGoal=target.clone().add(offset);
  if(!initialized){follow.position.copy(followGoal);initialized=true}else follow.position.lerp(followGoal,1-Math.exp(-4*dt));follow.lookAt(target);follow.updateMatrixWorld(true);
 }
 function command(action,extra={}){if(!['start','return','reset','speed','hold','resume'].includes(action))return Promise.reject(Error('Orden no disponible para el robot terrestre'));if(action==='start')driver.start();else if(action==='return')driver.home();else if(action==='reset'){current=previous=driver.reset(extra.soc??1);accumulator=0;initialized=false}else if(action==='speed')driver.setFast(extra.fast);else if(action==='hold')driver.pause();else if(action==='resume')driver.resume();current=driver.state();return Promise.resolve({action,vehicle:'ground'})}
 function solve(target){const local=rover.root.worldToLocal(target.clone()).sub(new THREE.Vector3(...spec.base.mount));for(const pitch of [0,.35,-.35,.7,-.7]){const result=solveArm(local.toArray(),pitch,spec.arm);if(result.reachable)return result}return null}
 function setArm(angles,tool={}){goal=[...angles];openingGoal=tool.opening??openingGoal;cutGoal=tool.cut??cutGoal}
 function navigate(enu,options){driver.navigate(enu.map(([x,y])=>[y-config.config.ground_vehicle.origin_enu[1],x-config.config.ground_vehicle.origin_enu[0]]),options);current=driver.state()}
 update(0);return {id:robot.id,label:robot.label,station:config.config.ground_vehicle.origin_enu,spec,driver,rover,camera,wrist,inspection,follow,lod,prepareView:lod.prepare,receive:driver.receive,aimInspection(target){inspectionTarget=target?.clone()||null},position:rover.root.position,update,command,navigate,solve,setArm,get poseState(){return {arm_angles:[...arm],opening,cut,inspection_pose:{position:inspection.position.toArray(),rotation:inspection.quaternion.toArray()}}},get soundState(){return soundState},get armReady(){return arm.every((v,i)=>Math.abs(v-goal[i])<.015)},get state(){return current}};
}
