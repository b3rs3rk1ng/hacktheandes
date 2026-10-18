import * as THREE from 'three';
import {createGroundPlanner} from './ground-planner.mjs';
import {solveArm} from '../robotics/arm-kinematics.mjs';
import {heightAt} from './terrain.mjs';
import {createCoveragePatrol} from './coverage-session.js';

const to3=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const enu=v=>[v.x,-v.z];
export const labels={idle:'Preparando siguiente árbol',patrolling:'Avanzando por su fila',surveying:'Evaluando árbol con YOLO11s',waiting_scout:'Esperando mapa del dron',waiting_team:'Esperando a sus vecinos',awaiting_review:'Esperando revisión del agricultor',navigating:'Hacia la alerta',verifying:'Verificando con YOLO11s',gripping:'Sujetando la mazorca',cutting:'Cortando el tallo',carrying:'Retirando el fruto',depositing:'Depositando en el recipiente',folding:'Plegando el brazo',returning:'Regresando a cargar',charging:'Cargando en estación',blocked:'Ruta detenida',paused:'Flota en pausa'};

export function createFleetSession({world,vehicles,post,hostId}){
 const planner=createGroundPlanner(world),pods=new Map(world.pods.map(p=>[p.id,p])),plants=new Map(world.plants.map(p=>[p.id,p])),cfg=world.config.fleet;
 const contexts=vehicles.map(vehicle=>({vehicle,phase:'idle',task:null,scanTree:null,surveyDone:false,time:0,busy:false,payload:null,stored:[],path:[],declined:new Set(),lastMotion:0,lastPosition:vehicle.position.clone(),error:''}));
 let data={enabled:false,returning:false,tasks:{},removed:[],robots:{},events:[],epoch:0},syncing=false,dispatching=false,lastSync=-Infinity,epoch=null,error='',lastDataAt=0;
 const terminal=new Set(['completed','rejected','unreachable','interrupted']);
 const patrol=createCoveragePatrol({world,planner,post,getData:()=>data,setData:next=>data=next,phase,guarded,assign,home});
 function phase(c,next){if(c.phase===next)return;c.phase=next;c.time=0;c.lastMotion=0;c.lastPosition.copy(c.vehicle.position)}
 async function transition(c,status,reason){await post('/api/fleet/transition',{task_id:c.task.id,robot_id:c.vehicle.id,status,reason});if(c.task)c.task.status=status}
 async function guarded(c,fn){if(c.busy)return;c.busy=true;try{await fn();c.error=''}catch(e){c.error=e.message}finally{c.busy=false}}
 function route(c,target,home=false){const path=planner.plan(enu(c.vehicle.position),target);if(!path)return false;c.path=path;c.vehicle.navigate(path,{home});phase(c,home?'returning':'navigating');return true}
 async function home(c){c.vehicle.setArm(c.vehicle.spec.arm.folded_rad,{opening:1,cut:0});if(c.task&&!terminal.has(c.task.status)){await transition(c,'interrupted','Regreso a estación');c.task=null}if(c.breadcrumbs?.length>1){c.path=[enu(c.vehicle.position),...c.breadcrumbs.slice().reverse()];c.vehicle.navigate(c.path,{home:true});phase(c,'returning')}else if(c.path.length&&Math.hypot(c.path[0][0]-c.vehicle.station[0],c.path[0][1]-c.vehicle.station[1])<.4){c.path=[enu(c.vehicle.position),...c.path.slice(0,c.vehicle.state.index).reverse()];c.vehicle.navigate(c.path,{home:true});phase(c,'returning')}else if(!route(c,c.vehicle.station,true))phase(c,'blocked')}
 function estimateReach(v,pod,point){ // Reach test uses geometry, never the scene disease label.
  const localY=pod.position[2]-heightAt(world.terrain,...point)-v.spec.base.mount[1];
  return [0,.35,-.35,.7,-.7].some(pitch=>solveArm([Math.hypot(pod.position[0]-point[0],pod.position[1]-point[1]),localY,0],pitch,v.spec.arm).reachable);
 }
 async function assign(c){
  if(dispatching)return;dispatching=true;try{
  const busyPlants=new Set(Object.values(data.tasks).filter(t=>t.robot_id&&!terminal.has(t.status)).map(t=>t.plant_id));
  const candidates=Object.values(data.tasks).filter(t=>t.status==='pending'&&!c.declined.has(t.id)&&!busyPlants.has(t.plant_id)&&(!patrol.enabled||t.plant_id===c.scanTree?.id)).sort((a,b)=>to3(a.position).distanceToSquared(c.vehicle.position)-to3(b.position).distanceToSquared(c.vehicle.position));
  for(const task of candidates){const pod=pods.get(task.pod_id);if(!pod)continue;if(to3(pod.position).distanceTo(c.vehicle.position)>(cfg.maximum_task_distance_m||90)){c.declined.add(task.id);continue}
   let path=null;for(const point of planner.approaches(pod,plants.get(pod.plant_id))){if(!estimateReach(c.vehicle,pod,point))continue;path=planner.approachPath(enu(c.vehicle.position),point,pod);if(path)break}
   if(!path){const claimed=await post('/api/fleet/claim',{task_id:task.id,robot_id:c.vehicle.id});await post('/api/fleet/transition',{task_id:claimed.id,robot_id:c.vehicle.id,status:'unreachable',reason:'No hay una aproximación navegable dentro del alcance del brazo'});data.tasks[task.id]={...claimed,status:'unreachable'};c.declined.add(task.id);continue}
   const claimed=await post('/api/fleet/claim',{task_id:task.id,robot_id:c.vehicle.id});data.tasks[task.id]=claimed;c.task=claimed;c.path=path;c.vehicle.navigate(path);phase(c,'navigating');return;
  }
  }finally{dispatching=false}
 }
 async function sync(){if(syncing)return;syncing=true;try{
  data=await post('/api/fleet/heartbeat',{host_id:hostId,robots:contexts.map(c=>({id:c.vehicle.id,position:[c.vehicle.position.x,-c.vehicle.position.z,c.vehicle.position.y],soc:c.vehicle.state.soc,phase:c.phase,plant_id:c.scanTree?.id||null,task_id:c.task?.id||null,path:c.path,dynamics:{...c.vehicle.state,route:undefined},...c.vehicle.poseState,payloads:payloads()}))});lastDataAt=performance.now();error='';
  if(epoch!==null&&data.epoch!==epoch){for(const c of contexts){await c.vehicle.command('reset');c.task=null;c.scanTree=null;c.surveyDone=false;c.payload=null;c.stored=[];c.breadcrumbs=[c.vehicle.station];c.declined.clear();phase(c,'idle')}}epoch=data.epoch;
  for(const c of contexts){if(c.task&&data.tasks[c.task.id])c.task=data.tasks[c.task.id];
   if(c.task&&(c.task.review?.decision!=='approve'||c.task.robot_id!==c.vehicle.id)){
    c.vehicle.driver.pause();guarded(c,async()=>{c.task=null;await home(c)});continue;
   }
   // A browser reload cannot safely resume an arm halfway through a cut.
   if(!c.task&&!c.busy){const abandoned=Object.values(data.tasks).find(t=>t.robot_id===c.vehicle.id&&!terminal.has(t.status));if(abandoned)await post('/api/fleet/transition',{task_id:abandoned.id,robot_id:c.vehicle.id,status:'interrupted',reason:'Visor reiniciado; tarea detenida sin reconstruir el agarre'})}
  }
 }catch(e){error=e.message}finally{syncing=false}}
 function update(dt){if(performance.now()-lastSync>100){lastSync=performance.now();sync()}
  for(const c of contexts){const v=c.vehicle;c.time+=dt;const homeDistance=Math.hypot(v.position.x-v.station[0],-v.position.z-v.station[1]);
   if(c.vehicle.state.status==='stopped'){
    if(c.phase!=='blocked')guarded(c,async()=>{if(c.task)await transition(c,'unreachable','Límite físico de inclinación');c.task=null;c.error='Esperando apoyo estable para replanificar';phase(c,'blocked')});
    else if(c.time>2&&(c.recoveries||0)<(cfg.maximum_recovery_attempts||3)&&v.driver.recover()){c.recoveries=(c.recoveries||0)+1;c.error='';phase(c,'idle')}
    continue;
   }
   if(c.busy)continue;
   if((data.returning||v.state.soc<(cfg.return_soc||.25))&&!['returning','charging','blocked'].includes(c.phase)&&homeDistance>.35){guarded(c,()=>home(c));continue}
   const running=data.enabled&&performance.now()-lastDataAt<5000;
   if(!running&&!data.returning&&c.phase!=='returning'){v.driver.pause();continue}else v.driver.resume();
   if(running&&v.state.soc>=(c.phase==='charging'?(cfg.resume_soc||.9):cfg.return_soc||.25)&&patrol.update(c))continue;
   if(c.phase==='idle'||c.phase==='charging'){
    if(homeDistance<.35&&v.state.soc<.999)phase(c,'charging');
    if(running&&v.state.soc>=(c.phase==='charging'?(cfg.resume_soc||.9):cfg.return_soc||.25))guarded(c,()=>assign(c));
   }else if(c.phase==='returning'){
    if(v.state.status==='idle'&&Math.abs(v.state.speed)<.04){c.task=null;c.stored=[];c.payload=null;c.breadcrumbs=[v.station];phase(c,'charging')}
   }else if(c.phase==='navigating'){
    if(v.state.status==='complete'&&Math.abs(v.state.speed)<.04)guarded(c,async()=>{
     const solution=v.solve(to3(c.task.position));if(!solution){await transition(c,'unreachable','Fuera del alcance real del brazo en esta pose');c.task=null;await home(c);return}
     // First stop short of the fruit: the wrist camera sees it before grasping.
     const mount=v.rover.arm.getWorldPosition(new THREE.Vector3()),point=to3(c.task.position),direction=point.clone().sub(mount).normalize();
     const pre=point.clone().addScaledVector(direction,-.25),preSolution=v.solve(pre)||solution;
     c.grasp=solution.angles;c.pregrasp=preSolution.angles;v.setArm(c.pregrasp,{opening:1,cut:0});await transition(c,'verifying');phase(c,'verifying');
    });
    else if(c.time-c.lastMotion>12){if(v.position.distanceTo(c.lastPosition)<.15)guarded(c,async()=>{await transition(c,'unreachable','Ruta bloqueada; sin avance físico');c.task=null;await home(c)});else{c.lastMotion=c.time;c.lastPosition.copy(v.position)}}
   }else if(c.phase==='verifying'){
    v.aimInspection(to3(c.task.position));
    const point=to3(c.task.position),mount=v.rover.arm.getWorldPosition(new THREE.Vector3()),direction=point.clone().sub(mount).normalize(),grasp=v.solve(point),pre=v.solve(point.clone().addScaledVector(direction,-.25));if(grasp)c.grasp=grasp.angles;if(pre)v.setArm(pre.angles,{opening:1,cut:0});
    if(c.task.status==='verified'){v.setArm(c.grasp,{opening:1,cut:0});guarded(c,async()=>{await transition(c,'gripping');phase(c,'gripping')})}
    else if(c.time>(cfg.verification_timeout_s||18))guarded(c,async()=>{await transition(c,'rejected','La cámara terrestre no confirmó la alerta en dos fotogramas');c.task=null;if(patrol.enabled&&c.scanTree)phase(c,'surveying');else await home(c)});
   }else if(c.phase==='gripping'&&v.armReady&&c.time>2){v.setArm(c.grasp,{opening:0,cut:0});if(c.time>3.2)guarded(c,async()=>{await transition(c,'cutting');v.setArm(c.grasp,{opening:0,cut:1});phase(c,'cutting')})
   }else if(c.phase==='cutting'&&c.time>1){guarded(c,async()=>{await transition(c,'carrying');c.payload={pod_id:c.task.pod_id,mode:'tool'};const retreat=to3(c.task.position).lerp(v.rover.arm.getWorldPosition(new THREE.Vector3()),.15);const s=v.solve(retreat);v.setArm(s?.angles||c.grasp,{opening:0,cut:0});phase(c,'carrying')})
   }else if(c.phase==='carrying'&&c.time>2&&v.armReady){
    const bin=v.rover.root.localToWorld(new THREE.Vector3(...v.spec.base.bin_center).add(new THREE.Vector3(0,.35,0))),solution=v.solve(bin);
    if(solution)guarded(c,async()=>{await transition(c,'depositing');v.setArm(solution.angles,{opening:0,cut:0});phase(c,'depositing')});else{c.error='El recipiente está fuera del alcance';phase(c,'blocked')}
   }else if(c.phase==='depositing'&&c.time>3&&v.armReady){v.setArm(v.spec.arm.folded_rad,{opening:1,cut:0});c.payload.mode='bin';c.stored.push(c.payload);c.payload=null;guarded(c,async()=>{await transition(c,'completed');c.task=null;phase(c,'folding')})
   }else if(c.phase==='folding'&&v.armReady){guarded(c,async()=>{if(patrol.enabled&&c.scanTree){if(c.stored.length>=(cfg.bin_capacity_pods||2))await home(c);else phase(c,'surveying')}else await home(c)})}
  }
 }
 function traffic(){const held=new Set();for(let i=0;i<contexts.length;i++)for(let j=i+1;j<contexts.length;j++){const a=contexts[i],b=contexts[j],delta=b.vehicle.position.clone().sub(a.vehicle.position);if(delta.length()>1.65)continue;
   const moving=c=>['navigating','returning','patrolling'].includes(c.phase),forward=c=>new THREE.Vector3(1,0,0).applyQuaternion(c.vehicle.rover.root.quaternion).multiplyScalar(c.vehicle.state.returning?-1:1);
   const towardA=forward(a).dot(delta)>0,towardB=forward(b).dot(delta)<0;
   if(moving(a)&&moving(b)){if(towardA&&towardB){held.add(b.vehicle.id)}else if(towardA)held.add(a.vehicle.id);else if(towardB)held.add(b.vehicle.id)}else if(moving(a)&&towardA)held.add(a.vehicle.id);else if(moving(b)&&towardB)held.add(b.vehicle.id);
  }return held}
 function verificationSources(){return contexts.filter(c=>['verifying','surveying'].includes(c.phase)&&!c.busy&&(c.phase==='surveying'||c.vehicle.armReady)).map(c=>({id:c.vehicle.id,camera:c.vehicle.inspection,follow:c.vehicle.follow,position:c.vehicle.position,simulation_time:c.vehicle.state.elapsed,phase_id:-1,task_id:c.task?.id||null,visionEnabled:true}))}
 function payloads(){const out={};for(const c of contexts){for(const [i,payload] of [...c.stored,...(c.payload?[c.payload]:[])].entries()){const p=payload.mode==='tool'?c.vehicle.rover.tcp.getWorldPosition(new THREE.Vector3()):c.vehicle.rover.root.localToWorld(new THREE.Vector3(...c.vehicle.spec.base.bin_center).add(new THREE.Vector3((i%2-.5)*.12,-.03,0)));out[payload.pod_id]={position:[p.x,-p.z,p.y]}}}return out}

 async function control(action){data=await post('/api/fleet/control',{action});if(action==='reset'){epoch=data.epoch;for(const c of contexts){c.task=null;c.scanTree=null;c.surveyDone=false;c.payload=null;c.stored=[];c.breadcrumbs=[c.vehicle.station];c.declined.clear();phase(c,'idle')}}return data}
 return {contexts,update,traffic,verificationSources,payloads,labels,planner,get data(){return data},get error(){return error},control,sync};
}
