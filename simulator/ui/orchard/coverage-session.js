import * as THREE from 'three';
const point=p=>new THREE.Vector3(p[0],p[2],-p[1]);

// Consume the shared lane plan; neither crop labels nor disease truth choose
// routes. Progress requires scout frames and fresh ground-camera frames.
export function createCoveragePatrol({world,planner,post,getData,setData,phase,guarded,assign,home}){
 const plan=world.coverage,settings=world.config.fleet.coverage||{},plants=new Map(world.plants.map(p=>[p.id,p])),pods=new Map();
 for(const pod of world.pods){if(!pods.has(pod.plant_id))pods.set(pod.plant_id,[]);pods.get(pod.plant_id).push(pod)}
 const terminal=new Set(['completed','rejected','unreachable','interrupted']);
 function target(c){const progress=getData().coverage||{},batch=plan?.batches[progress.batch||0],lane=batch?.lanes.find(l=>l.robot_id===c.vehicle.id),index=progress.indices?.[c.vehicle.id]||0;return {batch,lane,index,tree:plants.get(lane?.tree_ids[index]),progress}}
 function focus(c){if(!c.scanTree)return;const options=pods.get(c.scanTree.id)||[],height=[1.1,1.55,1.9][Math.min(2,Math.floor(c.time/2))],base=c.scanTree.position;
  const pod=options.reduce((best,p)=>{const score=Math.abs(p.position[2]-base[2]-height)*3+point(p.position).distanceTo(c.vehicle.position)*.2;return !best||score<best.score?{p,score}:best},null)?.p;
  c.vehicle.aimInspection(point(pod?.position||[base[0],base[1],base[2]+height]));
 }
 async function finish(c){if(!c.scanTree)return;setData(await post('/api/fleet/tree-complete',{robot_id:c.vehicle.id,plant_id:c.scanTree.id}));c.scanTree=null;c.surveyDone=false;c.vehicle.aimInspection(null);c.vehicle.setArm(c.vehicle.spec.arm.folded_rad,{opening:1,cut:0});phase(c,'idle')}
 function ready(c){const data=getData(),info=target(c);if(!info.progress.local_inspection_allowed&&(info.progress.scouted?.[c.scanTree?.id]?.frames.length||0)<(settings.minimum_survey_frames||2)){phase(c,'waiting_scout');return}const tasks=Object.values(data.tasks).filter(t=>t.plant_id===c.scanTree?.id&&!terminal.has(t.status)&&t.status!=='awaiting_evidence');
  if(tasks.some(t=>t.status==='pending')){guarded(c,()=>assign(c));return}
  if(tasks.some(t=>t.status!=='awaiting_review')){phase(c,'awaiting_review');return}
  const indices=info.progress.indices||{},frontier=Math.min(...info.batch.lanes.map(l=>indices[l.robot_id]||0));
  if(info.index>frontier+(settings.maximum_ground_lead_trees||1)){phase(c,'waiting_team');return}
  guarded(c,()=>finish(c));
 }
 function update(c){if(!plan)return false;const v=c.vehicle;
  if(['idle','charging','waiting_scout','waiting_team'].includes(c.phase)){
   if(c.surveyDone&&c.scanTree){ready(c);return true}
   const info=target(c);if(!info.tree){phase(c,'waiting_team');return true}
   c.scanTree=info.tree;const minFrames=settings.minimum_survey_frames||2,scout=info.progress.scouted?.[info.tree.id];
   if((scout?.frames.length||0)<minFrames&&!info.progress.local_inspection_allowed){phase(c,'waiting_scout');return true}
   const indices=info.progress.indices||{},frontier=Math.min(...info.batch.lanes.map(l=>indices[l.robot_id]||0));if(info.index>frontier+(settings.maximum_ground_lead_trees||1)){phase(c,'waiting_team');return true}
   const p=info.tree.position,dir=info.batch.forward?1:-1,axis=plan.axis_enu,cross=plan.cross_enu,offset=settings.aisle_offset_m||1.25,back=(settings.stop_before_tree_m||.6)*dir;
   let path=null;for(const side of [1,-1]){const goal=[p[0]+cross[0]*offset*side-axis[0]*back,p[1]+cross[1]*offset*side-axis[1]*back];path=planner.planFromPose([v.position.x,-v.position.z],goal);if(path)break}
   if(!path){c.error='No hay paso seguro hasta el siguiente árbol';phase(c,'waiting_team');return true}
   c.path=path;c.breadcrumbs??=[v.station];c.breadcrumbs.push(...path.slice(1));v.navigate(path);phase(c,'patrolling');return true;
  }
  if(c.phase==='patrolling'){
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
