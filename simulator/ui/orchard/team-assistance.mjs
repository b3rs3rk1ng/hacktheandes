// A free vehicle can help a neighboring lane at its current inspected frontier.
// The scout's evidence and the original lane progress remain authoritative.
export function canAssistTask(task,{robotId,position,plan,coverage,radius=0,minimumFrames=2}){
 if(task.status!=='pending'||!(radius>0)||!position||!task.position)return false;
 if(Math.hypot(task.position[0]-position[0],task.position[1]-position[1])>radius)return false;
 const batch=plan?.batches[coverage?.batch||0];
 const owner=batch?.lanes.find(l=>l.tree_ids.includes(task.plant_id));
 if(!owner||owner.robot_id===robotId)return false;
 const index=owner.tree_ids.indexOf(task.plant_id);
 return index<=(coverage.indices?.[owner.robot_id]||0)&&
  (coverage.scouted?.[task.plant_id]?.frames?.length||0)>=minimumFrames;
}
