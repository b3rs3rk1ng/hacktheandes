import * as THREE from 'three';
const point=p=>new THREE.Vector3(p[0],p[2],-p[1]);
export function bindFruit(pod,vehicle){
 const position=vehicle.rover.tool.worldToLocal(point(pod.position));
 const q=vehicle.rover.tool.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,pod.angle||0,0)));
 return {pod_id:pod.id,robot_id:vehicle.id,mode:'tool',local_position:position.toArray(),local_quaternion:q.toArray()};
}
export function payloadPose(payload,vehicle){
 const root=payload.mode==='tool'?vehicle.rover.tool:vehicle.rover.root,p=new THREE.Vector3().fromArray(payload.local_position),q=new THREE.Quaternion().fromArray(payload.local_quaternion||[0,0,0,1]);
 if(payload.mode==='dropping'){
  const t=THREE.MathUtils.clamp((vehicle.state.elapsed-payload.start_elapsed)/payload.duration,0,1);
  p.lerp(new THREE.Vector3().fromArray(payload.destination),t*t);q.slerp(new THREE.Quaternion(),t);
 }
 root.localToWorld(p);q.premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
 return {...payload,position:[p.x,-p.z,p.y],quaternion:q.toArray()};
}
