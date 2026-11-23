import {heightAt} from './terrain.mjs';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
// Every fruit gets a checked viewpoint or an explicit blocked result.
export function planTreeSurvey(tree,pods,field,terrain,{start=null,radius=.46}={}){
 const bearing=pod=>Math.atan2(pod.position[1]-tree.position[1],pod.position[0]-tree.position[0]),ordered=[...pods].sort((a,b)=>bearing(a)-bearing(b)||a.position[2]-b.position[2]);
 const stops=[],blocked=[];let previous=start;
 for(const pod of ordered){
  function candidates(wide){const out=[],turns=wide?Array.from({length:32},(_,i)=>i*Math.PI/16):[0,.3,-.3,.65,-.65,1,-1,1.5,-1.5,Math.PI];
   for(const turn of turns)for(const range of wide?[1.1,1.7,2.3,3,3.8,4.5]:[1.3,1.7,2.2,2.7,3.2])for(const level of wide?[.8,1.2,1.6,2,2.4,2.8,3.2]:[0,-.5,.4]){
    const a=bearing(pod)+turn,x=pod.position[0]+Math.cos(a)*range,y=pod.position[1]+Math.sin(a)*range,ground=heightAt(terrain,x,y),z=wide?ground+level:Math.max(ground+.9,Math.min(ground+2.2,pod.position[2]+level)),eye=[x,y,z],pitch=Math.atan2(pod.position[2]-z,range);
    if(pitch>.43||pitch<-.95||!field.clear(eye,eye,radius,{groundMargin:.4,includeFoliage:true})||!field.visible(eye,pod))continue;
    out.push({eye,cost:(previous?distance(previous,eye):range)+Math.abs(Math.atan2(Math.sin(turn),Math.cos(turn)))*.15});
   }
   return out.sort((a,b)=>a.cost-b.cost);
  }
  const clear=(a,b)=>field.clear(a,b,radius,{groundMargin:.4,includeFoliage:true});
  function around(eye){
   const center=tree.position,a=Math.atan2(previous[1]-center[1],previous[0]-center[0]),b=Math.atan2(eye[1]-center[1],eye[0]-center[0]),short=Math.atan2(Math.sin(b-a),Math.cos(b-a)),base=Math.max(Math.hypot(previous[0]-center[0],previous[1]-center[1]),Math.hypot(eye[0]-center[0],eye[1]-center[1]));
   for(const padding of [0,.4,.8])for(const turn of [short,short>0?short-Math.PI*2:short+Math.PI*2]){
    const r=base+padding,count=Math.max(2,Math.ceil(Math.abs(turn)/(Math.PI/12))),path=[previous];
    for(let i=0;i<=count;i++)path.push([center[0]+Math.cos(a+turn*i/count)*r,center[1]+Math.sin(a+turn*i/count)*r,previous[2]+(eye[2]-previous[2])*i/count]);path.push(eye);
    if(path.slice(1).every((p,i)=>clear(path[i],p)))return path;
   }return null;
  }
  let chosen=null;
  for(const wide of [false,true]){
   const options=candidates(wide);let selected=null,path=null;
   for(const candidate of options)if(!previous||clear(previous,candidate.eye)){selected=candidate;path=previous?[previous,candidate.eye]:[candidate.eye,candidate.eye];break}
   if(!selected&&previous)for(const candidate of options.slice(0,16)){path=around(candidate.eye);if(path){selected=candidate;break}}
   if(!selected&&previous)for(const candidate of options.slice(0,4)){path=field.plan(previous,candidate.eye,{radius,groundMargin:.4,includeFoliage:true,maxNodes:1200});if(path){selected=candidate;break}}
   if(selected){chosen={tree,pod,flight:selected.eye,path,kind:'scan',ordinal:stops.length+1,total:pods.length};break}
  }
  if(chosen){stops.push(chosen);previous=chosen.flight}else blocked.push({pod_id:pod.id,reason:'Sin aproximación con visibilidad y espacio libre'});
 }
 return {tree,stops,blocked,total:pods.length};
}
