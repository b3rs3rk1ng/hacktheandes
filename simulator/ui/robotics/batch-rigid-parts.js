import {Mesh} from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
// Merge only rigid siblings within their articulation frame. The caller leaves
// independently animated meshes (suspension, wheels, joints) outside each batch.
export function batchRigidParts(parents){
 const cache=new Map();let before=0,after=0;
 for(const parent of parents){
  const groups=new Map();for(const mesh of [...parent.children])if(mesh.isMesh&&!mesh.isInstancedMesh&&!Array.isArray(mesh.material)){const list=groups.get(mesh.material)??[];list.push(mesh);groups.set(mesh.material,list);}
  for(const [material,meshes] of groups){before+=meshes.length;if(meshes.length<3){after+=meshes.length;continue;}
   meshes.forEach(m=>m.updateMatrix());const key=meshes.map(m=>m.geometry.uuid+':'+m.matrix.elements.join(',')).join('|');let geometry=cache.get(key);
   if(!geometry){let parts=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrix));
    // Rounded boxes and ordinary cylinders/spheres can differ in indexing.
    // Normalize only mixed batches so compatible rigid parts still share one draw.
    if(parts.some(g=>g.index)&&parts.some(g=>!g.index))parts=parts.map(g=>{if(!g.index)return g;const expanded=g.toNonIndexed();g.dispose();return expanded;});
    geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(geometry)cache.set(key,geometry);}
   if(!geometry){after+=meshes.length;continue;}
   const batch=new Mesh(geometry,material);batch.name='Piezas rígidas · '+parent.name;batch.castShadow=batch.receiveShadow=true;parent.add(batch);meshes.forEach(m=>parent.remove(m));after++;
  }
 }
 return {before,after};
}
