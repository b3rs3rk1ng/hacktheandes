import * as THREE from '../vendor/three.module.js';

// Static vegetation records share materials/geometry, with independent bounds
// per spatial cell and the same transforms at every geometric detail level.
export function instancedCells(scene,records,material,levels,cellSize=20){
 const cells=new Map();
 for(const record of records){const x=Math.floor(record.position.x/cellSize),z=Math.floor(record.position.z/cellSize),key=`${x},${z}`;if(!cells.has(key))cells.set(key,{origin:new THREE.Vector3((x+.5)*cellSize,0,(z+.5)*cellSize),records:[]});cells.get(key).records.push(record)}
 const result=[],matrix=new THREE.Matrix4(),offset=new THREE.Matrix4();
 for(const cell of cells.values()){
  const lod=new THREE.LOD();lod.position.copy(cell.origin);offset.makeTranslation(-cell.origin.x,0,-cell.origin.z);
  for(const level of levels){const mesh=new THREE.InstancedMesh(level.geometry,material,cell.records.length);mesh.castShadow=false;mesh.receiveShadow=true;
   cell.records.forEach((record,i)=>{matrix.multiplyMatrices(offset,record.matrix);mesh.setMatrixAt(i,matrix);if(record.color)mesh.setColorAt(i,record.color)});
   mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();lod.addLevel(mesh,level.distance,.12);
  }
  scene.add(lod);result.push(lod);
 }
 return result;
}
