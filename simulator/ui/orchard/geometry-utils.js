import {mergeGeometries as merge} from '../robotics/vendor/BufferGeometryUtils.js?source';

// Preserve the shared robot library. Normalize the representation at its mesh
// merge boundary so indexed cylinders and nonindexed extrusions can share a
// rigid batch. Other attribute compatibility checks remain in Three.js.
export function mergeGeometries(geometries,useGroups=false){
 const mixed=geometries.some(g=>g.index)&&geometries.some(g=>!g.index),temporary=[];
 const compatible=mixed?geometries.map(g=>{if(!g.index)return g;const converted=g.toNonIndexed();temporary.push(converted);return converted}):geometries;
 try{return merge(compatible,useGroups)}finally{for(const g of temporary)g.dispose()}
}
