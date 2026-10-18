import * as THREE from 'three';

// A small articulated silhouette for distant actors, sharing the same chassis,
// wheel and joint transforms. The detailed asset remains untouched.
export function createVehicleLod(scene,rover,spec,{detailDistance=4.5}={}){
 const root=new THREE.Group();scene.add(root);
 const shell=new THREE.MeshStandardMaterial({color:0xe9eee7,roughness:.7}),rubber=new THREE.MeshStandardMaterial({color:0x202628,roughness:1}),blue=new THREE.MeshStandardMaterial({color:0x263f59,roughness:.7});
 const body=new THREE.Mesh(new THREE.BoxGeometry(spec.base.body_length_m,.38,spec.base.body_width_m),shell);body.position.y=.43+(spec.base.chassis_lift_m||0);body.castShadow=true;root.add(body);
 const wheelGeometry=new THREE.CylinderGeometry(spec.base.wheel_radius_m,spec.base.wheel_radius_m,spec.base.wheel_width_m,8);wheelGeometry.rotateX(Math.PI/2);
 const wheels=new THREE.InstancedMesh(wheelGeometry,rubber,rover.wheels.length),arm=new THREE.InstancedMesh(new THREE.CylinderGeometry(.045,.045,1,6),blue,rover.joints.length+1);root.add(wheels,arm);wheels.castShadow=arm.castShadow=true;
 const temp=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),a=new THREE.Vector3(),b=new THREE.Vector3();let detailed=true;
 function prepare(camera){detailed=camera.position.distanceTo(rover.root.position)<=detailDistance;rover.root.visible=detailed;root.visible=!detailed;if(detailed)return;root.position.copy(rover.root.position);root.quaternion.copy(rover.root.quaternion);
  rover.wheels.forEach((wheel,i)=>{temp.position.copy(wheel.steering.position);temp.quaternion.copy(wheel.steering.quaternion);temp.scale.set(1,1,1);temp.updateMatrix();wheels.setMatrixAt(i,temp.matrix)});wheels.instanceMatrix.needsUpdate=true;
  const frames=[...rover.joints,rover.tcp];for(let i=1;i<frames.length;i++){rover.root.worldToLocal(frames[i-1].getWorldPosition(a));rover.root.worldToLocal(frames[i].getWorldPosition(b));const direction=b.clone().sub(a);temp.position.copy(a).add(b).multiplyScalar(.5);temp.quaternion.setFromUnitVectors(up,direction.clone().normalize());temp.scale.set(1,Math.max(.001,direction.length()),1);temp.updateMatrix();arm.setMatrixAt(i-1,temp.matrix)}arm.count=frames.length-1;arm.instanceMatrix.needsUpdate=true;wheels.computeBoundingSphere();arm.computeBoundingSphere();
 }
 return {prepare,get detailed(){return detailed}};
}
