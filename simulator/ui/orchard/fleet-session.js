import {buildHarvestPlan,sampleHarvestStage} from './harvest-motion.mjs';
import {bindFruit,payloadPose} from './payload-pose.js';
import * as THREE from 'three';
import {createGroundPlanner} from './ground-planner.mjs';
import {createRouteService} from './route-service.mjs';
import {solveArm} from '../robotics/arm-kinematics.mjs';
import {heightAt} from './terrain.mjs';
import {pathProjection} from './ground-driver.mjs';
import {createCoveragePatrol} from './coverage-session.js';
import {canAssistTask} from './team-assistance.mjs';

const to3=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const enu=v=>[v.x,-v.z];
export const labels={waiting_traffic:'Cediendo el paso',complete:'Recorrido completado',positioning:'Girando en espacio libre',approaching:'Acercándose al árbol',retreating:'Retrocediendo del árbol',planning:'Calculando recorrido',idle:'Preparando siguiente árbol',patrolling:'Avanzando por su fila',surveying:'Evaluando árbol con YOLO11s',waiting_scout:'Esperando mapa del dron',waiting_team:'Esperando a sus vecinos',awaiting_review:'Esperando revisión del agricultor',navigating:'Hacia la alerta',verifying:'Verificando con YOLO11s',reaching:'Acercando la pinza',aligning:'Rodeando la mazorca',withdrawing:'Separando del árbol',lifting:'Elevando el cacao',releasing:'Soltando en el recipiente',clearing:'Retirando la pinza',gripping:'Cerrando la pinza',cutting:'Cortando el tallo',carrying:'Retirando el fruto',depositing:'Depositando en el recipiente',folding:'Plegando el brazo',returning:'Regresando a cargar',charging:'Cargando en estación',blocked:'Ruta detenida',paused:'Flota en pausa'};

export function createFleetSession({world,vehicles,post,hostId}){
 const geometryPlanner=createGroundPlanner(world),routes=createRouteService(world,geometryPlanner),planner={...geometryPlanner,planVehicle:routes.planVehicle},pods=new Map(world.pods.map(p=>[p.id,p])),plants=new Map(world.plants.map(p=>[p.id,p])),cfg=world.config.fleet;
 const contexts=vehicles.map(vehicle=>{const stored=Object.values(vehicle.initialPayloads).filter(p=>p.mode==='bin'&&p.robot_id===vehicle.id);return {vehicle,phase:'idle',task:null,scanTree:null,surveyDone:false,time:0,busy:false,payload:null,stored,homePending:stored.length>=(cfg.bin_capacity_pods||2),path:[],declined:new Set(),lastMotion:0,lastPosition:vehicle.position.clone(),error:''}});
 let data={enabled:false,returning:false,tasks:{},removed:[],robots:{},events:[],epoch:0},syncing=false,dispatching=false,lastSync=-Infinity,epoch=null,error='',lastDataAt=0;
 const terminal=new Set(['completed','rejected','unreachable','interrupted']);
 const patrol=createCoveragePatrol({world,planner,post,getData:()=>data,setData:next=>data=next,phase,guarded,assign,home,hasTasks:c=>Object.values(data.tasks).some(t=>eligible(c,t))});
 function phase(c,next){if(c.phase===next)return;if(!['patrolling','navigating','returning'].includes(next)&&c.vehicle.state.status!=='stopped')c.vehicle.driver.stop();c.phase=next;c.time=0;c.lastMotion=0;c.lastPosition.copy(c.vehicle.position)}
 async function transition(c,status,reason){const result=await post('/api/fleet/transition',{task_id:c.task.id,robot_id:c.vehicle.id,status,reason});if(c.task)c.task=result}
 async function guarded(c,fn){if(c.busy)return;c.busy=true;try{await fn();c.error=''}catch(e){c.error=e.message}finally{c.busy=false}}
 async function route(c,target,home=false){const start=enu(c.vehicle.position),dx=target[0]-start[0],dy=target[1]-start[1],route=await planner.planVehicle(start,target,c.vehicle.state.yaw,null);if(!route)return false;c.path=route.points;c.vehicle.navigate(c.path,{home,directions:route.directions});phase(c,home?'returning':'navigating');return true}
 async function home(c){c.cycle=null;c.homePending=true;c.vehicle.driver.stop();c.vehicle.aimInspection(null);c.vehicle.setArm(c.vehicle.spec.arm.folded_rad,{opening:1,cut:0});try{if(c.task&&!terminal.has(c.task.status)){await transition(c,'interrupted','Regreso a estación');c.task=null}if(await route(c,c.vehicle.station,true)){c.homePending=false;return}}catch(e){c.error=e.message}c.retryAfter=performance.now()+2000;phase(c,'blocked')}
 function estimateReach(v,pod,point){ // Reach test uses geometry, never the scene disease label.
  const localY=pod.position[2]-heightAt(world.terrain,...point)-v.spec.base.mount[1];
  return [0,.35,-.35,.7,-.7].some(pitch=>solveArm([Math.hypot(pod.position[0]-point[0],pod.position[1]-point[1]),localY,0],pitch,v.spec.arm).reachable);
 }
 function eligible(c,t){
  if(t.status!=='pending'||c.declined.has(t.id))return false;
  if(!patrol.enabled)return true;if(!c.scanTree)return false;
  if(t.plant_id===c.scanTree.id)return true;
  const lane=world.coverage.batches[data.coverage?.batch||0]?.lanes.find(l=>l.robot_id===c.vehicle.id);
  const index=lane?.tree_ids.indexOf(t.plant_id)??-1;
  if(index>=0&&index<=(data.coverage?.indices?.[c.vehicle.id]||0)&&to3(t.position).distanceTo(c.vehicle.position)<(cfg.coverage?.alert_revisit_radius_m||8))return true;
  return c.surveyDone&&['surveying','waiting_team'].includes(c.phase)&&canAssistTask(t,{robotId:c.vehicle.id,position:enu(c.vehicle.position),plan:world.coverage,coverage:data.coverage,radius:cfg.coverage?.assistance_radius_m??cfg.coverage?.alert_revisit_radius_m??8,minimumFrames:cfg.coverage?.minimum_survey_frames||2});
 }
 async function taskRoute(c,pod){
  c.approachTrials??=new Set();
  for(const point of planner.approaches(pod,plants.get(pod.plant_id))){const key=point.map(v=>v.toFixed(3)).join(',');if(c.approachTrials.has(key)||!estimateReach(c.vehicle,pod,point))continue;
   const dx=pod.position[0]-point[0],dy=pod.position[1]-point[1],drive=await planner.planVehicle(enu(c.vehicle.position),point,c.vehicle.state.yaw,null);if(drive){c.approachTrials.add(key);return drive}
  }return null;
 }
 async function reapproach(c,reason){
  c.vehicle.driver.stop();const drive=c.approachTrials?.size<(cfg.maximum_approach_attempts||3)?await taskRoute(c,pods.get(c.task.pod_id)):null;
  if(drive){c.path=drive.points;c.vehicle.navigate(c.path,{directions:drive.directions});phase(c,'navigating');return}
  await transition(c,'unreachable',reason);c.task=null;c.cycle=null;c.vehicle.setArm(c.vehicle.spec.arm.folded_rad,{opening:1,cut:0});phase(c,c.scanTree?'surveying':'idle');
 }
 async function assign(c){
  if(dispatching)return;dispatching=true;try{
  const busyPlants=new Set(Object.values(data.tasks).filter(t=>t.robot_id&&!terminal.has(t.status)).map(t=>t.plant_id));
  const candidates=Object.values(data.tasks).filter(t=>eligible(c,t)&&!busyPlants.has(t.plant_id)).sort((a,b)=>to3(a.position).distanceToSquared(c.vehicle.position)-to3(b.position).distanceToSquared(c.vehicle.position));
  for(const task of candidates){const pod=pods.get(task.pod_id);if(!pod)continue;if(to3(pod.position).distanceTo(c.vehicle.position)>(cfg.maximum_task_distance_m||90)){c.declined.add(task.id);continue}
   c.approachTrials=new Set();const drive=await taskRoute(c,pod),path=drive?.points;
   if(!path){const lane=world.coverage?.batches[data.coverage?.batch||0]?.lanes.find(l=>l.robot_id===c.vehicle.id);if(lane&&!lane.tree_ids.includes(task.plant_id)){c.declined.add(task.id);continue}const claimed=await post('/api/fleet/claim',{task_id:task.id,robot_id:c.vehicle.id});await post('/api/fleet/transition',{task_id:claimed.id,robot_id:c.vehicle.id,status:'unreachable',reason:'No hay una aproximación navegable dentro del alcance del brazo'});data.tasks[task.id]={...claimed,status:'unreachable'};c.declined.add(task.id);continue}
   const claimed=await post('/api/fleet/claim',{task_id:task.id,robot_id:c.vehicle.id});data.tasks[task.id]=claimed;c.task=claimed;c.path=path;c.vehicle.navigate(path,{directions:drive.directions});phase(c,'navigating');return;
  }
  }finally{dispatching=false}
 }
 async function sync(){if(syncing)return;syncing=true;try{
  data=await post('/api/fleet/heartbeat',{host_id:hostId,robots:contexts.map(c=>({id:c.vehicle.id,position:[c.vehicle.position.x,-c.vehicle.position.z,c.vehicle.position.y],soc:c.vehicle.state.soc,phase:c.phase,plant_id:c.scanTree?.id||null,task_id:c.task?.id||null,path:c.path,removed:data.removed,dynamics:{...c.vehicle.state,route:undefined},...c.vehicle.poseState,payloads:payloads(c.vehicle.id)}))});lastDataAt=performance.now();error='';
  if(epoch!==null&&data.epoch!==epoch){for(const c of contexts){await c.vehicle.command('reset');c.task=null;c.cycle=null;c.scanTree=null;c.surveyDone=false;c.payload=null;c.stored=[];c.breadcrumbs=[c.vehicle.station];c.declined.clear();phase(c,'idle')}}epoch=data.epoch;
  for(const c of contexts){if(c.task&&data.tasks[c.task.id])c.task=data.tasks[c.task.id];
   if(c.task&&((data.intervention_policy?.approval!=='automatic'&&c.task.review?.decision!=='approve')||c.task.robot_id!==c.vehicle.id)){
    c.vehicle.driver.pause();guarded(c,async()=>{c.cycle=null;c.task=null;await home(c)});continue;
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
   if(c.homePending&&['blocked','idle'].includes(c.phase)){if(performance.now()>=(c.retryAfter||0))guarded(c,()=>home(c));continue}
      if((data.returning||v.state.soc<(cfg.return_soc||.25))&&!['returning','charging','blocked'].includes(c.phase)&&homeDistance>(cfg.station_arrival_m||.35)){guarded(c,()=>home(c));continue}
   const running=data.enabled&&performance.now()-lastDataAt<5000;
   if(!running&&!data.returning&&c.phase!=='returning'){v.driver.pause();continue}else v.driver.resume();
   if(c.cycle){updateHarvest(c,dt);continue;}
   if(['navigating','returning'].includes(c.phase)){const next=c.path[Math.min(c.path.length-1,Math.max(1,v.state.index))];if(next)v.aimInspection(to3([next[0],next[1],v.position.y+1.12]))}
   if(running&&v.state.soc>=(c.phase==='charging'?(cfg.resume_soc||.9):cfg.return_soc||.25)&&patrol.update(c))continue;
   if(c.phase==='idle'||c.phase==='charging'){
    if(homeDistance<(cfg.station_arrival_m||.35)&&v.state.soc<.999)phase(c,'charging');
    if(running&&v.state.soc>=(c.phase==='charging'?(cfg.resume_soc||.9):cfg.return_soc||.25))guarded(c,()=>assign(c));
   }else if(c.phase==='returning'){
    if(v.state.status==='idle'&&Math.abs(v.state.speed)<.04){c.task=null;c.stored=[];c.payload=null;c.breadcrumbs=[v.station];phase(c,'charging')}
   }else if(c.phase==='navigating'){
    if(pathProjection(enu(v.position),c.path).distance>1){guarded(c,()=>reapproach(c,'Desviación del corredor de aproximación'));continue}
    if(v.state.status==='complete'&&Math.abs(v.state.speed)<.04)guarded(c,async()=>{
     const solution=v.solve(to3(c.task.position));if(!solution){await reapproach(c,'Fuera del alcance real del brazo en esta pose');return}
     // First stop short of the fruit: the wrist camera sees it before grasping.
     const mount=v.rover.arm.getWorldPosition(new THREE.Vector3()),point=to3(c.task.position),direction=point.clone().sub(mount).normalize();
     const pre=point.clone().addScaledVector(direction,-.25),preSolution=v.solve(pre)||solution;
     c.grasp=solution.angles;c.pregrasp=preSolution.angles;v.setArm(c.pregrasp,{opening:1,cut:0});if(c.task.status==='claimed')await transition(c,'verifying');phase(c,'verifying');
    });
    else if(c.time-c.lastMotion>12){if(v.position.distanceTo(c.lastPosition)<.15)guarded(c,async()=>{await reapproach(c,'Ruta bloqueada; sin avance físico')});else{c.lastMotion=c.time;c.lastPosition.copy(v.position)}}
   }else if(c.phase==='verifying'){
    v.aimInspection(to3(c.task.position));
    const point=to3(c.task.position),mount=v.rover.arm.getWorldPosition(new THREE.Vector3()),direction=point.clone().sub(mount).normalize(),grasp=v.solve(point),pre=v.solve(point.clone().addScaledVector(direction,-.25));if(grasp)c.grasp=grasp.angles;if(pre)v.setArm(pre.angles,{opening:1,cut:0});
    if(c.task.status==='verified')guarded(c,async()=>{
     const pod=pods.get(c.task.pod_id),local=v.rover.root.worldToLocal(to3(pod.position)).sub(new THREE.Vector3(...v.spec.base.mount));
     let plan;try{plan=buildHarvestPlan(v.spec,local.toArray(),v.poseState.arm_angles,{motionRate:cfg.motion_rate||1,radius:(pod.radii_m?.[0]||world.config.manipulation.fruit_radii_m[0])*(pod.scale||1)})}catch(e){await reapproach(c,e.message);return}
     await transition(c,'gripping');c.cycle={plan,index:0,time:0,pod};phase(c,plan[0].kind);
    });
    else if(c.time>(cfg.verification_timeout_s||18))guarded(c,async()=>{await transition(c,'rejected','La cámara terrestre no confirmó la alerta');c.task=null;if(patrol.enabled&&c.scanTree)phase(c,'surveying');else await home(c)});
   }
  }
 }
 function updateHarvest(c,dt){const v=c.vehicle,cycle=c.cycle,stage=cycle.plan[cycle.index];v.aimInspection(['withdrawing','lifting','carrying','depositing','releasing','clearing'].includes(stage.kind)?v.rover.tcp.getWorldPosition(new THREE.Vector3()):to3(cycle.pod.position));cycle.time+=dt;const pose=sampleHarvestStage(stage,cycle.time);if(['gripping','cutting'].includes(stage.kind)){const solution=v.solve(to3(cycle.pod.position));if(solution)pose.angles=solution.angles}v.setArm(pose.angles,{opening:pose.opening,cut:pose.cut});
  if(cycle.time<stage.duration||!v.armReady||!v.toolReady)return;
  guarded(c,async()=>{
   if(stage.kind==='gripping'){
    const error=v.rover.tcp.getWorldPosition(new THREE.Vector3()).distanceTo(to3(cycle.pod.position));
    if(error>.035){await transition(c,'unreachable','La pinza no alcanzó el fruto desde la pose física');c.cycle=null;c.task=null;phase(c,'surveying');return}
    await transition(c,'cutting');
   }
   if(stage.kind==='cutting'){await transition(c,'carrying');c.payload=bindFruit(cycle.pod,v)}
   if(stage.kind==='carrying')await transition(c,'depositing');
   if(stage.kind==='depositing'){
    const position=v.rover.root.worldToLocal(v.rover.tool.localToWorld(new THREE.Vector3(...c.payload.local_position))),rotation=v.rover.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().fromArray(payloadPose(c.payload,v).quaternion));
    const slot=c.stored.length,center=[...v.spec.base.bin_center];const layout=cfg.bin_layout||{columns:2,rows:1,pitch_m:.10,layer_m:.15},col=slot%layout.columns,row=Math.floor(slot/layout.columns)%layout.rows,layer=Math.floor(slot/(layout.columns*layout.rows));center[0]+=(col-(layout.columns-1)/2)*layout.pitch_m;center[2]+=(row-(layout.rows-1)/2)*layout.pitch_m;center[1]+=layer*layout.layer_m;center[1]+=(cycle.pod.radii_m?.[2]||world.config.manipulation.fruit_radii_m[2])*(cycle.pod.scale||1)-.085;
    c.payload={...c.payload,mode:'dropping',local_position:position.toArray(),local_quaternion:rotation.toArray(),destination:center,start_elapsed:v.state.elapsed,duration:.65};
   }
   if(stage.kind==='releasing'){
    c.payload={...c.payload,mode:'bin',local_position:c.payload.destination,local_quaternion:[0,0,0,1]};c.stored.push(c.payload);c.payload=null;await transition(c,'completed');c.task=null;
   }
   cycle.index++;cycle.time=0;
   if(cycle.index>=cycle.plan.length){c.cycle=null;if(c.stored.length>=(cfg.bin_capacity_pods||2))await home(c);else phase(c,c.scanTree?'surveying':'idle')}
   else phase(c,cycle.plan[cycle.index].kind);
  });
 }
 function traffic(){const held=new Set();for(let i=0;i<contexts.length;i++)for(let j=i+1;j<contexts.length;j++){const a=contexts[i],b=contexts[j],delta=b.vehicle.position.clone().sub(a.vehicle.position);if(delta.length()>1.65)continue;
   const moving=c=>['navigating','returning','patrolling'].includes(c.phase),forward=c=>new THREE.Vector3(1,0,0).applyQuaternion(c.vehicle.rover.root.quaternion).multiplyScalar(c.vehicle.state.returning?-1:1);
   const towardA=forward(a).dot(delta)>0,towardB=forward(b).dot(delta)<0;
   if(moving(a)&&moving(b)){if(towardA&&towardB){held.add(b.vehicle.id)}else if(towardA)held.add(a.vehicle.id);else if(towardB)held.add(b.vehicle.id)}else if(moving(a)&&towardA)held.add(a.vehicle.id);else if(moving(b)&&towardB)held.add(b.vehicle.id);
  }return held}
 function verificationSources(){return contexts.filter(c=>['verifying','surveying'].includes(c.phase)&&!c.busy&&(c.phase==='surveying'||c.vehicle.armReady)).map(c=>({id:c.vehicle.id,camera:c.vehicle.inspection,follow:c.vehicle.follow,position:c.vehicle.position,simulation_time:c.vehicle.state.elapsed,phase_id:-1,task_id:c.task?.id||null,visionEnabled:true}))}
 function payloads(robotId=null){const out={};for(const c of contexts.filter(c=>!robotId||c.vehicle.id===robotId))for(const payload of [...c.stored,...(c.payload?[c.payload]:[])])out[payload.pod_id]=payloadPose(payload,c.vehicle);return out}

 async function control(action){data=await post('/api/fleet/control',{action});if(action==='reset'){epoch=data.epoch;for(const c of contexts){c.task=null;c.cycle=null;c.scanTree=null;c.surveyDone=false;c.payload=null;c.stored=[];c.breadcrumbs=[c.vehicle.station];c.declined.clear();phase(c,'idle')}}return data}
 return {contexts,update,traffic,verificationSources,payloads,labels,planner,get data(){return data},get error(){return error},framePending(id,value){const c=contexts.find(c=>c.vehicle.id===id);if(c)c.sensorInFlight=value},control,sync};
}
