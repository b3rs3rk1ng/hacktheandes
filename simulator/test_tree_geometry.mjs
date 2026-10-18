import assert from 'node:assert/strict';
import * as THREE from './ui/vendor/three.module.js';
import {appendTube} from './ui/orchard/tree-geometry.mjs';

// Inspect the actual generated surface, including combined-buffer offsets.
// A front-face ray must hit the exterior before it can reach a branch interior.
const vertices=[],colors=[],uvs=[],faces=[];
for(const direction of [[0,0,2],[1,.5,2],[2,0,0],[-1,2,-.5]]){
 for(const level of [0,1,2,3])for(const detailed of [true,false]){
  const base=new THREE.Vector3(level*5,0,0),firstFace=faces.length;
  const bone=[0,0,0,...direction,.15,.08,level];
  appendTube(vertices,colors,uvs,faces,base,bone,1,detailed);
  const axis=new THREE.Vector3(direction[0],direction[2],-direction[1]).normalize();
  const middle=base.clone().addScaledVector(axis,new THREE.Vector3(...direction).length()/2);
  for(let i=firstFace;i<faces.length;i+=3){
   const [a,b,c]=faces.slice(i,i+3).map(index=>new THREE.Vector3().fromArray(vertices,index*3));
   const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
   const outward=a.clone().add(b).add(c).multiplyScalar(1/3).sub(middle);
   assert.ok(normal.dot(outward)>0,'Branch surface or end cap faces its own interior');
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(faces.slice(firstFace));geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
  const radial=new THREE.Vector3().crossVectors(axis,Math.abs(axis.y)>.95?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)).normalize();
  const ray=new THREE.Raycaster(middle.clone().addScaledVector(radial,1),radial.clone().negate());
  const hits=ray.intersectObject(mesh);
  assert.ok(hits.length>0,'Exterior bark must be visible with normal back-face culling');
  assert.ok(hits[0].distance<1,'Camera sees the outside before reaching the branch axis');
  for(const sign of [-1,1]){
   const endpoint=sign<0?base:base.clone().addScaledVector(axis,new THREE.Vector3(...direction).length());
   const capRay=new THREE.Raycaster(endpoint.clone().addScaledVector(axis,sign),axis.clone().multiplyScalar(-sign));
   const capHits=capRay.intersectObject(mesh);
   assert.ok(capHits.length>0&&capHits[0].distance<=1.00001,'Every branch end must be closed');
  }
  geometry.dispose();mesh.material.dispose();
 }
}
console.log('Branch geometry: outward normals and exterior ray hits passed for 32 branch direction/detail/LOD combinations.');
