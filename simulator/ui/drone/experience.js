import * as THREE from 'three';
import {createInspectionDrone} from './airframe.js';
import {createGuardedDrone} from './guarded-airframe.js';
import {RotorState} from './rotor-core.mjs';
import {createRotorWash} from './rotor-wash.js';
import {RotorAudio,mountSoundControl} from './rotor-audio.js';
export function createDroneExperience({scene,cfg,heightAt,home,mountAudio=true}){
 const model=(cfg.flight.cage_radius_m?createGuardedDrone:createInspectionDrone)(cfg),rotorState=new RotorState(cfg.flight);scene.add(model.root);
 const wash=createRotorWash(scene,{heightAt,rotorRadius:cfg.flight.rotor_radius_m,home,dustiness:cfg.flight.visual_dustiness??.30});
 const audio=new RotorAudio(cfg.flight.rotors);if(mountAudio)mountSoundControl(audio);
 const axis=new THREE.Vector3(),origin=new THREE.Vector3(),angular=new THREE.Vector3();
 let active=true,time=0,lastMaterialScan=-1;
 const api={drone:model.root,fingers:model.fingers,model,rotorState,wash,audio,bindVegetation:wash.bindVegetation,
  setActive(value){active=Boolean(value);model.root.visible=active;if(!active){audio.active=false;if(audio.context)audio.master.gain.setTargetAtTime(0,audio.context.currentTime,.06);}},
  get active(){return active;},
  update(dt,state,camera,{latestTelemetryAt=state?.updated_at}={}){
   time+=dt;if(time-lastMaterialScan>1){wash.bindVegetation(scene);lastMaterialScan=time;}const stale=!state||Date.now()/1000-latestTelemetryAt>4,thrust=active&&!stale?state.thrust_n||0:0;
   const v=state?.velocity??[0,0,0,0,0,0];angular.set(v[3]||0,v[5]||0,-(v[4]||0)).applyQuaternion(model.root.quaternion.clone().invert());
   rotorState.update(dt,thrust,angular.toArray());model.update(rotorState,camera.quaternion);
   origin.set(0,.045,0).applyQuaternion(model.root.quaternion).add(model.root.position);axis.set(0,-1,0).applyQuaternion(model.root.quaternion);
   const wind=state?.wind_mps??cfg.flight.wind_mps??[0,0,0];
   wash.update(dt,{origin,axis,induced:rotorState.induced,wind:[wind[0],wind[2],-wind[1]],time,active,camera});
   const positions=rotorState.layout.map(r=>new THREE.Vector3(...r.position).applyQuaternion(model.root.quaternion).add(model.root.position));
   audio.update(rotorState.rotors,positions,camera,dt,active&&!stale);
  }
 };return api;
}
