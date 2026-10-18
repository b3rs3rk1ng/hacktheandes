// Spatial residency is independent of crop, renderer, camera and sector IDs.
export function sectorStream(sectors,{load,unload,loadRadius=34,releaseRadius=44}){
 if(loadRadius<0||releaseRadius<loadRadius)throw Error('Invalid sector residency radii');
 const resident=new Map();
 function distance(point,b){return Math.hypot(Math.max(b.minX-point.x,0,point.x-b.maxX),Math.max(b.minZ-point.z,0,point.z-b.maxZ))}
 function update(points){
  for(const [key,value] of resident){const sector=sectors.get(key);if(points.every(p=>distance(p,sector.bounds)>releaseRadius)){unload(value,sector);resident.delete(key)}}
  for(const [key,sector] of sectors)if(!resident.has(key)&&points.some(p=>distance(p,sector.bounds)<=loadRadius))resident.set(key,load(sector));
  return resident;
 }
 return {update,resident,dispose(){for(const [key,value] of resident)unload(value,sectors.get(key));resident.clear()}};
}
