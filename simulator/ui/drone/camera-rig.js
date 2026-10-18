import * as THREE from 'three';
const Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1),optical=new THREE.Quaternion().setFromAxisAngle(Y,-Math.PI/2);
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));
// Rigid optical origin + bounded two-axis gimbal. Body attitude always reaches
// the image; stabilization only rotates within the actual mechanical support.
export function createMountedCameraRig(camera,body,offset,{yawLimit=.65,pitchMin=-1.05,pitchMax=.45,response=.11,maxRate=1.5}={}){
 let yaw=0,pitch=0,ready=false;const local=new THREE.Vector3(),inverse=new THREE.Quaternion(),qYaw=new THREE.Quaternion(),qPitch=new THREE.Quaternion();
 return {reset(){ready=false;yaw=pitch=0;},update(dt,target){
  camera.position.copy(offset).applyQuaternion(body.quaternion).add(body.position);
  inverse.copy(body.quaternion).invert();local.copy(target).sub(camera.position).applyQuaternion(inverse);
  const yawGoal=THREE.MathUtils.clamp(Math.atan2(-local.z,local.x),-yawLimit,yawLimit),pitchGoal=THREE.MathUtils.clamp(Math.atan2(local.y,Math.hypot(local.x,local.z)),pitchMin,pitchMax);
  if(!ready){yaw=yawGoal;pitch=pitchGoal;ready=true;}else{const f=1-Math.exp(-dt/response),limit=maxRate*dt;yaw+=THREE.MathUtils.clamp(wrap(yawGoal-yaw)*f,-limit,limit);pitch+=THREE.MathUtils.clamp((pitchGoal-pitch)*f,-limit,limit);}
  qYaw.setFromAxisAngle(Y,yaw);qPitch.setFromAxisAngle(Z,pitch);camera.quaternion.copy(body.quaternion).multiply(qYaw).multiply(qPitch).multiply(optical);camera.updateMatrixWorld();
 },get angles(){return {yaw,pitch}},get offset(){return offset.clone()}};
}
