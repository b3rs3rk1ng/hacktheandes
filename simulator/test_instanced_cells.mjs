import assert from 'node:assert/strict';
import * as THREE from './ui/vendor/three.module.js';
import {instancedCells} from './ui/orchard/instanced-cells.mjs';

const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),records=[];
for(const x of [-25,-24,0,31]){
 const object=new THREE.Object3D();object.position.set(x,.7,3);object.rotation.set(.2,.4,.1);object.scale.set(.5,1.3,.7);object.updateMatrix();
 records.push({position:object.position.clone(),matrix:object.matrix.clone(),color:new THREE.Color(0x568441)});
}
const cells=instancedCells(scene,records,material,[{geometry:new THREE.PlaneGeometry(),distance:0},{geometry:new THREE.PlaneGeometry(),distance:30}],20);
assert.equal(cells.length,3);scene.updateMatrixWorld(true);
const expected=records.map(r=>r.matrix.elements),actual=[];
for(const cell of cells){
 const [near,far]=cell.levels.map(l=>l.object);
 assert.deepEqual(near.instanceColor.array,far.instanceColor.array);
 for(let i=0;i<near.count;i++){
  const a=new THREE.Matrix4(),b=new THREE.Matrix4();near.getMatrixAt(i,a);far.getMatrixAt(i,b);assert.deepEqual(a.elements,b.elements);
  a.premultiply(near.matrixWorld);actual.push(a.elements);
 }
 const camera=new THREE.PerspectiveCamera();camera.position.copy(cell.position);camera.updateMatrixWorld();cell.update(camera);assert.equal(near.visible,true);assert.equal(far.visible,false);
 camera.position.x+=100;camera.updateMatrixWorld();cell.update(camera);assert.equal(near.visible,false);assert.equal(far.visible,true);
 camera.position.copy(cell.position);camera.updateMatrixWorld();cell.update(camera);assert.equal(near.visible,true);assert.equal(far.visible,false);
}
for(const matrix of expected)assert.ok(actual.some(a=>a.every((v,i)=>Math.abs(v-matrix[i])<1e-5)),'Cell batching must preserve each world transform');
console.log('Vegetation cells: world transforms, shared LOD placement and near/far/near transitions passed.');
