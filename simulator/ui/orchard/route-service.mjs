// One worker per authoritative scene keeps route searches out of rendering and
// wheel integration. The worker uses exactly the same planner as offline tests.
export function createRouteService(world,planner){
 if(typeof Worker==='undefined')return {planVehicle:(...args)=>Promise.resolve(planner.planVehicle(...args))};
 const worker=new Worker(new URL('./navigation-worker.mjs',import.meta.url),{type:'module'}),pending=new Map();let serial=0;
 worker.postMessage({type:'init',world:{terrain:world.terrain,config:{fleet:world.config.fleet},plants:world.plants.map(p=>({position:p.position,crop:p.crop,structure:{radius:p.structure?.radius}}))}});
 worker.onmessage=({data})=>{const call=pending.get(data.id);if(!call)return;pending.delete(data.id);clearTimeout(call.timer);data.error?call.reject(Error(data.error)):call.resolve(data.result)};
 worker.onerror=event=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error(event.message||'Falló la planificación'))}pending.clear()};
 return {planVehicle:(...args)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('La planificación excedió su plazo'))},20000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,args})}),dispose(){worker.terminate();for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('Planificación cerrada'))}pending.clear()}};
}
