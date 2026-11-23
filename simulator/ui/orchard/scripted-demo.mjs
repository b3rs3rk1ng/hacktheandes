import * as THREE from '../vendor/three.module.js';
import {createTrafficCoordinator} from './traffic-coordinator.mjs';
import {createGroundMotionRows,sampleGroundMotion,advanceWheelOdometry,groundEnvelopeRadius} from './scripted-ground-motion.mjs';
import {planTreeSurvey} from './tree-survey.mjs';
import {createSceneClearance} from './scene-clearance.mjs';
import {createGroundPlanner} from './ground-planner.mjs';
import {heightAt} from './terrain.mjs';
import {buildHarvestPlan,sampleHarvestStage} from './harvest-motion.mjs';

const clamp=n=>Math.max(0,Math.min(1,n)),ease=n=>{n=clamp(n);return n*n*(3-2*n)},mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t);
const yAxis=new THREE.Vector3(0,1,0),point=p=>new THREE.Vector3(p[0],p[2],-p[1]);
// Presentation adapter. It emits the existing telemetry contract, never observations
// or inference evidence. All routes and targets come from the supplied scene.
export function createScriptedDemo(world,vehicles,{travelSeconds=3,harvestSeconds=6,scanSeconds=1.4,droneTravelSeconds=4.5,groundSpeed=.85,droneSpeed=1,treesPerLane=6,deferPlanning=false}={}){
 const plants=new Map(world.plants.map(p=>[p.id,p])),pods=new Map();
 for(const pod of world.pods){if(!pods.has(pod.plant_id))pods.set(pod.plant_id,[]);pods.get(pod.plant_id).push(pod)}
 const crop=world.config.inspection.crop,available=world.plants.filter(p=>p.crop===crop);
 const lanes=world.coverage?.batches?.[0]?.lanes||vehicles.map(v=>({robot_id:v.id,tree_ids:[...available].sort((a,b)=>Math.hypot(a.position[0]-v.station[0],a.position[1]-v.station[1])-Math.hypot(b.position[0]-v.station[0],b.position[1]-v.station[1])).map(p=>p.id)}));
 let clearance=createSceneClearance(world);const planner=world.terrain?createGroundPlanner(world):null;
 const tracks=vehicles.map((vehicle,index)=>{
  const lane=lanes.find(l=>l.robot_id===vehicle.id)||lanes[index%lanes.length],spec=vehicle.spec;
  const stops=[];
  for(const id of lane.tree_ids.slice(0,treesPerLane)){
   const tree=plants.get(id);if(!tree)continue;const candidates=[];
   const choices=[...(pods.get(id)||[])].sort((a,b)=>Math.abs(a.position[2]-tree.position[2]-1)-Math.abs(b.position[2]-tree.position[2]-1));
   for(const pod of choices){
    const bearing=Math.atan2(pod.position[1]-tree.position[1],pod.position[0]-tree.position[0]);
    const stop=[pod.position[0]+Math.cos(bearing)*.85,pod.position[1]+Math.sin(bearing)*.85];
    if(planner&&!planner.safe(stop))continue;
    let park=null;for(const reach of [.8,.65,.5]){const point=[stop[0]+Math.cos(bearing)*reach,stop[1]+Math.sin(bearing)*reach];if(!planner||planner.clear(stop,point)){park=point;break}}if(!park)continue;
    const yaw=bearing+Math.PI,root=new THREE.Quaternion().setFromAxisAngle(yAxis,yaw),ground=heightAt(world.terrain,...stop);
    const local=point(pod.position).sub(new THREE.Vector3(stop[0],ground+.045,-stop[1])).applyQuaternion(root.clone().invert()).sub(new THREE.Vector3(...spec.base.mount));
    try{const plan=buildHarvestPlan(spec,local.toArray(),spec.arm.folded_rad);candidates.push({tree,pod,stop,park,yaw,plan,total:plan.reduce((n,s)=>n+s.duration,0)})}catch{}
   }
   if(candidates.length)stops.push({...candidates[0],candidates});
  }
  if(!stops.length)throw Error('La demo necesita al menos una mazorca alcanzable por vehículo');
  return {vehicle,stops,route:stops,offset:index*.9};
 });
 function length(path){return path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-path[i][j])),0)}
 function along(path,progress){let remaining=length(path)*clamp(progress);for(let i=1;i<path.length;i++){const distance=Math.hypot(...path[i].map((v,j)=>v-path[i-1][j]));if(remaining<=distance||i===path.length-1)return {position:mix(path[i-1],path[i],clamp(remaining/(distance||1))),heading:Math.atan2(path[i][1]-path[i-1][1],path[i][0]-path[i-1][0])};remaining-=distance}return {position:path[0],heading:0}}
 function at(track,time){const cycle=Math.floor(time/track.total),phase=time-cycle*track.total;let index=track.rows.findIndex((r,i)=>phase<(track.rows[i+1]?.start??track.total));if(index<0)index=track.rows.length-1;const row=track.rows[index];return {...row,index,cycle,local:phase-row.start}}
 function rebuildTrack(track){
  const current=track.schedule?at(track.schedule,track.elapsed||0):null;
  track.route=track.stops;track.schedule=createGroundMotionRows(track.route,planner,{speed:groundSpeed,minimumTravel:travelSeconds,harvestSeconds,initialPose:{position:track.vehicle.station,yaw:Math.PI/2},returnPose:{position:track.vehicle.station,yaw:Math.PI/2}});
  if(current){const row=track.schedule.rows.find(r=>Boolean(r.returning)===Boolean(current.returning)&&r.stop.tree.id===current.stop.tree.id);if(row)track.elapsed=row.start+current.local;}
 }
 for(const track of tracks)rebuildTrack(track);
 // Reserve the ground routes as swept volumes, so air routes cannot cross
 // either a parked rover or its future route during the inspection sequence.
 const reservations=[];
 for(const track of tracks)for(const row of track.schedule.rows)for(let i=1;i<row.path.length;i++){
  const a=row.path[i-1],b=row.path[i],lift=p=>[p[0],p[1],heightAt(world.terrain,...p)+.65];reservations.push({a:lift(a),b:lift(b),radius:.5,opaque:false});
 }
 clearance=createSceneClearance(world,{obstacles:reservations});
 const trees=[...new Map(lanes.flatMap(l=>l.tree_ids.slice(0,treesPerLane)).map(id=>[id,plants.get(id)]).filter(([,tree])=>tree)).values()].sort((a,b)=>a.position[1]-b.position[1]||a.position[0]-b.position[0]);
 const droneStops=[],surveys=[],releaseTimes=new Map(),inspectedPods=new Set(),droneRoute=droneStops;
 const droneTrack={rows:[],total:0};let planningComplete=false,worker=null;
 function appendSurvey(survey){
  surveys.push(survey);for(const stop of survey.stops)inspectedPods.add(stop.pod.id);if(!survey.stops.length)return;
  for(const track of tracks){const index=track.stops.findIndex(s=>s.tree.id===survey.tree.id);if(index<0||inspectedPods.has(track.stops[index].pod.id))continue;
   const original=track.stops[index],alternative=original.candidates.find(c=>inspectedPods.has(c.pod.id));
   if(alternative){track.stops[index]={...alternative,candidates:original.candidates};rebuildTrack(track);}
  }
  const tree=survey.tree,assigned=tracks.filter(t=>t.stops.some(s=>s.tree.id===tree.id&&inspectedPods.has(s.pod.id))).map(t=>({id:t.vehicle.id,label:t.vehicle.label||t.vehicle.id,pod_id:t.stops.find(s=>s.tree.id===tree.id).pod.id})),last=survey.stops.at(-1);
  const additions=[...survey.stops,{...last,kind:'dispatch',assigned,total:survey.total,blocked:survey.blocked.length,ordinal:survey.stops.length,path:[last.flight,last.flight]}];
  for(const stop of additions){const previous=droneStops.at(-1)||stop,path=previous===stop?[stop.flight,stop.flight]:stop.path;
   const travel=stop.kind==='dispatch'?0:Math.max(.5,1.5*length(path)/droneSpeed),hold=stop.kind==='dispatch'?2:scanSeconds;
   droneTrack.rows.push({stop,previous,path,travel,hold,start:droneTrack.total});droneTrack.total+=travel+hold;droneStops.push(stop);
   if(stop.kind==='dispatch')releaseTimes.set(tree.id,droneTrack.total+2);
  }
 }
 if(!trees.length)throw Error('La demo necesita árboles para inspeccionar');
 appendSurvey(planTreeSurvey(trees[0],pods.get(trees[0].id)||[],clearance,world.terrain));
 if(deferPlanning&&typeof Worker!=='undefined'&&trees.length>1){
  worker=new Worker(new URL('./tree-survey-worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{if(data.survey)appendSurvey(data.survey);if(data.done){planningComplete=true;worker.terminate()}if(data.error){planningComplete=true;console.error(data.error)}};
  worker.postMessage({world:{terrain:world.terrain,plants:world.plants.map(p=>({id:p.id,position:p.position,height:p.height,structure:p.structure}))},reservations,trees:trees.slice(1).map(tree=>({tree,pods:pods.get(tree.id)||[]})),start:droneStops.at(-1)?.flight});
 }else{
  for(const tree of trees.slice(1))appendSurvey(planTreeSurvey(tree,pods.get(tree.id)||[],clearance,world.terrain,{start:droneStops.at(-1)?.flight}));planningComplete=true;
 }
 if(!droneStops.length)throw Error('No hay una aproximación libre para inspeccionar la escena');
 for(const track of tracks){track.elapsed=0;track.lastSeconds=0;track.wheelAngles=[0,0,0,0];track.previousMotion=null;}
 const started=Date.now()/1000,traffic=createTrafficCoordinator(world.config.fleet?.traffic);
 const releasedAt=(stop,seconds)=>inspectedPods.has(stop.pod.id)&&seconds>=(releaseTimes.get(stop.tree.id)??Infinity);
 function progressAt(track,offset,seconds){let target=Math.min(track.schedule.total-1e-6,track.elapsed+offset);for(const row of track.schedule.rows)if(row.start>=track.elapsed&&!releasedAt(row.stop,seconds)){target=Math.min(target,row.start);break}return target;}
 function groundAt(track,elapsed,seconds){
  const segment=at(track.schedule,elapsed),row=track.schedule.rows[segment.index],released=releasedAt(segment.stop,seconds),motion=sampleGroundMotion(row,segment.local,released),action=clamp((segment.local-segment.travel)/harvestSeconds);let stage=segment.stop.plan[0],stageTime=action*segment.stop.total;
  for(const s of segment.stop.plan){stage=s;if(stageTime<=s.duration)break;stageTime-=s.duration}
  const harvesting=motion.phase==='harvesting',pose=harvesting?sampleHarvestStage(stage,stageTime):{angles:track.vehicle.spec.arm.folded_rad,opening:1,cut:0};
  return {...segment,row,released,motion,harvesting,pose,stage};
 }

 function sample(seconds){
  seconds=Math.max(0,seconds);
  const now=started+seconds,robots={},tasks={},payloads={},removed=[],events=[];
  const deltas=new Map(tracks.map(track=>[track.vehicle.id,Math.max(0,Math.min(.1,seconds-track.lastSeconds))]));
  for(const track of tracks)track.visualRadius=groundEnvelopeRadius(track.vehicle.spec,track.vehicle.poseState?.arm_angles||track.vehicle.spec.arm.folded_rad);
  const decisions=traffic.resolve(tracks.map(track=>({id:track.vehicle.id,requestedAt:releaseTimes.get(at(track.schedule,track.elapsed).stop.tree.id)??Infinity,sample(offset){const state=groundAt(track,progressAt(track,offset,seconds),seconds);return {position:state.motion.position,radius:Math.max(track.visualRadius,groundEnvelopeRadius(track.vehicle.spec,state.pose.angles))}}})),seconds,Math.max(...deltas.values()));
  for(const track of tracks){
   const {vehicle,route}=track,spec=vehicle.spec,decision=decisions.get(vehicle.id),delta=deltas.get(vehicle.id);track.lastSeconds=seconds;
   if(decision.allowed)track.elapsed=progressAt(track,delta,seconds);
   const state=groundAt(track,track.elapsed,seconds),{index,row,local,stop,previous,path,travel,released,motion,pose,stage,harvesting}=state,xy=motion.position,yaw=motion.yaw,ground=heightAt(world.terrain,...xy),origin=[...vehicle.station],baseHeight=heightAt(world.terrain,...origin),moving=['navigating','approaching','retreating','returning'].includes(motion.phase);
   const groundFinished=track.elapsed>=track.schedule.total-1.1e-6,phase=groundFinished?'complete':harvesting?stage.kind:motion.phase,held=!decision.allowed,displayPhase=held?'waiting_traffic':phase,speed=groundFinished||held?0:motion.speed;
   track.wheelAngles=advanceWheelOdometry(track.previousMotion,motion,track.wheelAngles,spec);track.previousMotion=motion;
   if(track.phase!==displayPhase){track.phase=displayPhase;track.phaseStartedAt=now;}
   const r={id:vehicle.id,position:[...xy,ground+.045],phase:displayPhase,look_at:moving||phase==='positioning'?[xy[0]+Math.cos(yaw)*3,xy[1]+Math.sin(yaw)*3,ground+1.1]:stop.pod.position,error:held?'Cediendo el paso a '+decision.blockedBy.map(id=>vehicles.find(v=>v.id===id)?.label||id).join(', '):'',plant_id:stop.tree.id,task_id:stop.pod.id,path:[previous.stop,stop.stop],updated_at:now,phase_started_at:track.phaseStartedAt,arm_angles:pose.angles,opening:pose.opening,cut:pose.cut,removed:[],payloads:{},dynamics:{position:[xy[1]-origin[1],ground-baseHeight+.045,xy[0]-origin[0]],rotation:new THREE.Quaternion().setFromAxisAngle(yAxis,yaw-Math.PI/2).toArray(),origin:[origin[0],baseHeight,-origin[1]],speed,pitch:0,roll:0,elapsed:seconds,status:groundFinished?'complete':held||phase==='waiting_scout'?'paused':'running',soc:.96,power:120,charging:false,estimated_hours:16,fast:false,progress:local/(travel+harvestSeconds),wheels:Array.from({length:4},(_,wheelIndex)=>({y:spec.base.wheel_radius_m,rotation:track.wheelAngles[wheelIndex],steering:0,compression:0,contact:true}))}};
   // Completed fruit stays in the bin; active fruit follows the existing tool pose.
   const completed=new Set(route.slice(0,Math.min(index,route.length)).map(s=>s.pod.id));
   if((harvesting||phase==='retreating'||phase==='complete')&&['withdrawing','lifting','carrying','depositing','releasing','clearing','folding','retreating','complete'].includes(phase)){
    const bin=['releasing','clearing','folding','retreating','complete'].includes(phase);
    r.payloads[stop.pod.id]={pod_id:stop.pod.id,robot_id:vehicle.id,mode:bin?'bin':'tool',local_position:bin?spec.base.bin_center:[spec.arm.tool_tcp_m,0,0],local_quaternion:[0,0,0,1]};removed.push(stop.pod.id);
   }
   for(const id of completed){if(id===stop.pod.id&&!row.returning)continue;r.payloads[id]={pod_id:id,robot_id:vehicle.id,mode:'bin',local_position:spec.base.bin_center,local_quaternion:[0,0,0,1]};removed.push(id);tasks[id]={id,pod_id:id,position:track.stops.find(s=>s.pod.id===id).pod.position,status:'completed',robot_id:vehicle.id,simulated:true}}
   tasks[stop.pod.id]={id:stop.pod.id,pod_id:stop.pod.id,plant_id:stop.tree.id,position:stop.pod.position,status:row.returning?'completed':!released?'pending_inspection':['folding','retreating','complete'].includes(phase)?'completed':'assigned',robot_id:vehicle.id,simulated:true};
   r.removed=removed.slice();robots[vehicle.id]=r;Object.assign(payloads,r.payloads);
   if(released)events.push({kind:['folding','retreating','complete'].includes(phase)?'completed':'assigned',robot_id:vehicle.id,time:started+(releaseTimes.get(stop.tree.id)||0)});
  }
  const finished=planningComplete&&seconds>=droneTrack.total,flight=at(droneTrack,Math.min(seconds,droneTrack.total-1e-6)),{index:di,local:dl,stop:target,previous:before,travel:flightTravel}=flight;
  const u=ease(dl/flightTravel),a=before.flight,b=target.flight,position=along(flight.path,u).position,look_at=mix(before.pod.position,target.pod.position,u),yaw=Math.atan2(look_at[1]-position[1],look_at[0]-position[0]),c=Math.cos(yaw),s=Math.sin(yaw),scanning=!finished&&dl>=flightTravel&&target.kind==='scan',dispatching=!finished&&dl>=flightTravel&&target.kind==='dispatch';
  const physics={engine:'Scripted presentation · CPU',simulated:true,updated_at:now,simulation_time:seconds,mission_time:seconds,phase:finished?'complete':scanning?'inspect':dispatching?'dispatch':'transit',phase_id:di,label:finished?'Inspección completada':dispatching?'Enviando orden al robot':scanning?`Mazorca ${target.ordinal} de ${target.total}`:'Rodeando el árbol',phase_elapsed_s:scanning?dl-flightTravel:dl,position,look_at,orientation:[c,-s,0,s,c,0,0,0,1],velocity:mix(a,b,1).map((v,i)=>scanning?0:(v-a[i])/flightTravel),thrust_n:24,battery:{soc:.94,remaining_wh:330,voltage_v:24,power_w:240},return_budget:{required_wh:20,margin_wh:310,distance_m:Math.hypot(position[0],position[1])},plant_id:target.tree.id,visited:droneStops.slice(0,finished?droneStops.length:Math.min(di,droneStops.length)).filter(s=>s.kind==='dispatch'&&!s.blocked).map(s=>s.tree.id),removed:[],payloads:{},outcomes:[],route_index:di%droneRoute.length,route_count:droneRoute.length,camera_frames_at_view:0,counts:{alerts:droneStops.slice(0,di).filter(s=>s.kind==='scan').length},accelerated:false,harvest_enabled:false};
  return {physics,fleet:{simulated:true,enabled:true,returning:false,robots,tasks,removed,events,coverage:{local_inspection_allowed:true,indices:{},scouted:{},inspected:{}}},model:{actual_inference:false,simulated:true},model_error:null,scene_revision:world.revision,preview:{pod:target.pod,tree_id:target.tree.id,ordinal:target.ordinal,total:target.total,progress:scanning?clamp((dl-flightTravel)/scanSeconds):null},dispatch:dispatching?{tree_id:target.tree.id,assigned:target.assigned,analyzed:target.ordinal,total:target.total,blocked:target.blocked,progress:clamp((dl-flightTravel)/2)}:null};
 }
 return {sample,tracks,droneRoute,droneTrack,clearance,surveys,releaseTimes,get traffic(){return traffic},get planningComplete(){return planningComplete},dispose(){worker?.terminate()}};
}
