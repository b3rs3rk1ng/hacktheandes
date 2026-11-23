import * as THREE from 'three';
import {pathProjection} from './ground-driver.mjs';
import {teamFrontier} from './team-frontier.mjs';
const point=p=>new THREE.Vector3(p[0],p[2],-p[1]);

// Consume the shared lane plan; neither crop labels nor disease truth choose
// routes. Progress requires scout frames and fresh ground-camera frames.
export function createCoveragePatrol({world,planner,post,getData,setData,phase,guarded,assign,home,hasTasks}){
 const plan=world.coverage,settings=world.config.fleet.coverage||{},plants=new Map(world.plants.map(p=>[p.id,p])),pods=new Map();
 for(const pod of world.pods){if(!pods.has(pod.plant_id))pods.set(pod.plant_id,[]);pods.get(pod.plant_id).push(pod)}
 const terminal=new Set(['completed','rejected','unreachable','interrupted']);
 function target(c){const progress=getData().coverage||{},batch=plan?.batches[progress.batch||0],lane=batch?.lanes.find(l=>l.robot_id===c.vehicle.id),index=progress.indices?.[c.vehicle.id]||0;return {batch,lane,index,tree:plants.get(lane?.tree_ids[index]),progress}}
 function focus(c){if(!c.scanTree)return;const options=pods.get(c.scanTree.id)||[],height=[1.1,1.55,1.9][Math.min(2,Math.floor(c.time/2))],base=c.scanTree.position;
  const pod=options.reduce((best,p)=>{const score=Math.abs(p.position[2]-base[2]-height)*3+point(p.position).distanceTo(c.vehicle.position)*.2;return !best||score<best.score?{p,score}:best},null)?.p;
  c.vehicle.aimInspection(point(pod?.position||[base[0],base[1],base[2]+height]));
 }
 async function finish(c){if(!c.scanTree)return;setData(await post('/api/fleet/tree-complete',{robot_id:c.vehicle.id,plant_id:c.scanTree.id}));c.scanTree=null;c.surveyDone=false;c.vehicle.aimInspection(null);c.vehicle.setArm(c.vehicle.spec.arm.folded_rad,{opening:1,cut:0});phase(c,'idle')}
 function ready(c){if(c.sensorInFlight)return;const data=getData(),info=target(c);if(!info.progress.local_inspection_allowed&&(info.progress.scouted?.[c.scanTree?.id]?.frames.length||0)<(settings.minimum_survey_frames||2)){phase(c,'waiting_scout');return}const tasks=Object.values(data.tasks).filter(t=>t.plant_id===c.scanTree?.id&&!terminal.has(t.status)&&t.status!=='awaiting_evidence');
  if(tasks.some(t=>t.status==='pending')||hasTasks(c)){guarded(c,()=>assign(c));return}
  if(tasks.some(t=>t.status!=='awaiting_review')){phase(c,'waiting_team');return}
  const indices=info.progress.indices||{},frontier=teamFrontier(info.batch.lanes,indices,data.robots);
  if(info.index>frontier+(settings.maximum_ground_lead_trees||1)){phase(c,'waiting_team');return}
  guarded(c,()=>finish(c));
 }
 function update(c){if(!plan)return false;const v=c.vehicle;
  if(['idle','charging','waiting_scout','waiting_team'].includes(c.phase)){
   if(c.retryAfter&&performance.now()<c.retryAfter)return true;
   if(c.surveyDone&&c.scanTree){ready(c);return true}
   const info=target(c);if(!info.tree){phase(c,'waiting_team');return true}
   c.scanTree=info.tree;const minFrames=settings.minimum_survey_frames||2,scout=info.progress.scouted?.[info.tree.id];
   if((scout?.frames.length||0)<minFrames&&!info.progress.local_inspection_allowed){phase(c,'waiting_scout');return true}
   const indices=info.progress.indices||{},frontier=teamFrontier(info.batch.lanes,indices,getData().robots);if(info.index>frontier+(settings.maximum_ground_lead_trees||1)){phase(c,'waiting_team');return true}
   phase(c,'planning');guarded(c,async()=>{
    try{
     const p=info.tree.position,dir=info.batch.forward?1:-1,axis=plan.axis_enu,cross=plan.cross_enu,offset=settings.aisle_offset_m||1.25,back=(settings.stop_before_tree_m||.6)*dir;
     let route=null,path=null;for(const side of [1,-1]){
      const goal=[p[0]+cross[0]*offset*side-axis[0]*back,p[1]+cross[1]*offset*side-axis[1]*back];
      if(Math.hypot(v.position.x-goal[0],-v.position.z-goal[1])<(world.config.fleet.navigation_arrival_m||.25)){v.driver.stop();phase(c,'surveying');focus(c);return}
      route=await planner.planVehicle([v.position.x,-v.position.z],goal,v.state.yaw,null);path=route?.points;if(path)break;
     }
     if(c.phase!=='planning'||target(c).tree?.id!==info.tree.id)return;
     if(!path){c.error='Buscando otra aproximación';phase(c,'waiting_team');c.retryAfter=performance.now()+2000;return}
     c.path=path;c.breadcrumbs??=[v.station];c.breadcrumbs.push(...path.slice(1));v.navigate(path,{directions:route.directions});phase(c,'patrolling');
    }catch(e){phase(c,'waiting_team');c.retryAfter=performance.now()+2000;throw e}
   });return true;
  }
  if(c.phase==='patrolling'){
   if(pathProjection([v.position.x,-v.position.z],c.path).distance>1){v.driver.pause();phase(c,'waiting_team');c.retryAfter=performance.now()+1000;c.error='Recalculando trayectoria desde la posición real';return true}
   const p=c.path[Math.min(c.path.length-1,Math.max(1,v.state.index))];if(p)v.aimInspection(point([p[0],p[1],v.position.y+1.12]));
   if(c.time-c.lastMotion>12){
    if(v.position.distanceTo(c.lastPosition)<.15){v.driver.pause();phase(c,'waiting_team');c.retryAfter=performance.now()+1000;c.error='Recalculando aproximación desde la pose real';return true}
    c.lastMotion=c.time;c.lastPosition.copy(v.position);
   }
   if(v.state.status==='complete'&&Math.abs(v.state.speed)<.04){v.setArm(v.spec.arm.folded_rad);phase(c,'surveying');focus(c)}return true;
  }
  if(c.phase==='surveying'){
   if(c.surveyDone){ready(c);return true}
   focus(c);const inspected=getData().coverage?.inspected?.[v.id]?.[c.scanTree.id];
   if(c.time>=(settings.survey_seconds||6)&&(inspected?.frames.length||0)>=(settings.minimum_survey_frames||2)){c.surveyDone=true;ready(c)}return true;
  }
  if(c.phase==='awaiting_review'){focus(c);ready(c);return true}
  return false;
 }
 return {update,finish,focus,enabled:!!plan};
}
