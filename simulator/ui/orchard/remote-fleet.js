import * as THREE from 'three';
export function createRemoteFleet(world,vehicles,labels){
 let data={enabled:true,returning:false,tasks:{},removed:[],robots:{},events:[],coverage:{}};
 const plants=new Map(world.plants.map(p=>[p.id,p])),contexts=vehicles.map(vehicle=>({vehicle,phase:'idle',task:null,scanTree:null,time:0,error:'',path:[]}));
 function receive(snapshot){if(!snapshot?.robots)return;data=snapshot;for(const c of contexts){const r=data.robots[c.vehicle.id];if(!r)continue;c.phase=r.phase;c.task=data.tasks[r.task_id]||null;c.scanTree=plants.get(r.plant_id)||null;c.time=Math.max(0,Date.now()/1000-(r.phase_started_at||r.updated_at));c.path=r.path||[];c.vehicle.receive(r);const focus=c.task?.position||c.scanTree?.position;if(focus)c.vehicle.aimInspection(new THREE.Vector3(focus[0],focus[2]+(c.task?0:1.25),-focus[1]))}}
 return {contexts,labels,receive,update(){for(const c of contexts){const r=data.robots[c.vehicle.id];if(r)c.time=Math.max(0,Date.now()/1000-(r.phase_started_at||r.updated_at))}},traffic:()=>new Set(),verificationSources:()=>[],payloads(){return Object.assign({},...Object.values(data.robots).map(r=>r.payloads||{}))},get data(){return data},get error(){return ''},sync:async()=>{},control:()=>Promise.reject(Error('Visor en vivo; sólo observación'))};
}
