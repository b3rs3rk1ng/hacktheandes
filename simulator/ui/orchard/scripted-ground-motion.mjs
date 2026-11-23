const clamp=t=>Math.max(0,Math.min(1,t)),ease=t=>{t=clamp(t);return t*t*(3-2*t)},mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const angle=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
export const pathLength=path=>path.slice(1).reduce((n,p,i)=>n+distance(path[i],p),0);
function along(path,progress){let remaining=pathLength(path)*clamp(progress);for(let i=1;i<path.length;i++){const length=distance(path[i-1],path[i]);if(remaining<=length||i===path.length-1)return {position:mix(path[i-1],path[i],clamp(remaining/(length||1))),yaw:Math.atan2(path[i][1]-path[i-1][1],path[i][0]-path[i-1][0])};remaining-=length}return {position:path[0],yaw:0}}
export function createGroundMotionRows(stops,planner,{speed=.85,reverseSpeed=.45,minimumTravel=3,harvestSeconds=6,turnSeconds=1.2,initialPose=null,returnPose=null}={}){
 const rows=[];let total=0;
 for(let i=0;i<stops.length;i++){
  const stop=stops[i],previous=i===0&&initialPose?{park:initialPose.position,stop:initialPose.position,yaw:initialPose.yaw}:stops[(i+stops.length-1)%stops.length],cruisePath=planner?planner.plan(previous.park,stop.park):[previous.park,stop.park];
  if(!cruisePath)throw Error('No existe una ruta libre entre posiciones de espera');
  const cruise=Math.max(minimumTravel,1.5*pathLength(cruisePath)/speed),approach=1.5*distance(stop.park,stop.stop)/Math.min(speed,.45),retreat=1.5*distance(stop.stop,stop.park)/reverseSpeed,travel=cruise+turnSeconds*2+approach;
  rows.push({stop,previous,path:[...cruisePath,stop.stop],cruisePath,cruise,turn:turnSeconds,approach,retreat,travel,harvest:harvestSeconds,start:total});total+=travel+harvestSeconds+retreat;
 }
 if(returnPose&&stops.length){
  const previous=stops.at(-1),stop={...previous,stop:returnPose.position,park:returnPose.position,yaw:returnPose.yaw},cruisePath=planner?planner.plan(previous.park,stop.park):[previous.park,stop.park];
  if(!cruisePath)throw Error('No existe una ruta libre de regreso a la estación');
  const cruise=Math.max(minimumTravel,1.5*pathLength(cruisePath)/speed),travel=cruise+turnSeconds*2;
  rows.push({stop,previous,path:cruisePath,cruisePath,cruise,turn:turnSeconds,approach:0,retreat:0,travel,harvest:0,start:total,returning:true});total+=travel;
 }
 return {rows,total};
}
export function sampleGroundMotion(row,local,released=true){
 const {stop,previous,cruisePath,cruise,turn,approach,travel,harvest,retreat}=row;
 if(!released)return {position:previous.park,yaw:previous.yaw,speed:0,phase:'waiting_scout'};
 if(row.returning&&local>=travel)return {position:stop.park,yaw:stop.yaw,speed:0,phase:'complete'};
 const departure=along(cruisePath,0).yaw;
 if(local<turn)return {position:previous.park,yaw:angle(previous.yaw,departure,ease(local/turn)),speed:0,phase:'positioning'};
 if(local<cruise+turn){const t=clamp((local-turn)/cruise),p=along(cruisePath,ease(t));return {...p,yaw:p.yaw,speed:pathLength(cruisePath)*6*t*(1-t)/cruise,phase:row.returning?'returning':'navigating'}}
 const arrival=along(cruisePath,1).yaw;
 if(local<cruise+turn*2)return {position:stop.park,yaw:angle(arrival,stop.yaw,ease((local-cruise-turn)/turn)),speed:0,phase:'positioning'};
 if(local<travel){const t=clamp((local-cruise-turn*2)/approach);return {position:mix(stop.park,stop.stop,ease(t)),yaw:stop.yaw,speed:distance(stop.park,stop.stop)*6*t*(1-t)/approach,phase:'approaching'}}
 if(local<travel+harvest)return {position:stop.stop,yaw:stop.yaw,speed:0,phase:'harvesting'};
 const t=clamp((local-travel-harvest)/retreat);return {position:mix(stop.stop,stop.park,ease(t)),yaw:stop.yaw,speed:-distance(stop.stop,stop.park)*6*t*(1-t)/retreat,phase:'retreating'};
}
// Wheel rotation follows signed motion, including reverse and a turn in place.
export function advanceWheelOdometry(previous,current,wheels,spec){
 if(!previous)return wheels.slice();const dx=current.position[0]-previous.position[0],dy=current.position[1]-previous.position[1],midYaw=angle(previous.yaw,current.yaw,.5),travel=dx*Math.cos(midYaw)+dy*Math.sin(midYaw),turn=Math.atan2(Math.sin(current.yaw-previous.yaw),Math.cos(current.yaw-previous.yaw));
 return wheels.map((value,i)=>value+(travel+(i%2?1:-1)*turn*spec.base.track_m/2)/spec.base.wheel_radius_m);
}

export function groundEnvelopeRadius(spec,angles=spec.arm.folded_rad){
 const base=spec.base,body=Math.hypot(Math.max(base.body_length_m,base.wheelbase_m+base.wheel_radius_m*2),Math.max(base.body_width_m,base.track_m+base.wheel_width_m))/2;
 const [shoulder,elbow,wrist]=angles.slice(1,4),a=spec.arm.links_m[0]*Math.cos(shoulder),b=a+spec.arm.links_m[1]*Math.cos(shoulder+elbow),tip=b+(spec.arm.wrist_length_m+spec.arm.roll_link_m+spec.arm.tool_tcp_m)*Math.cos(shoulder+elbow+wrist);
 return Math.max(body,Math.hypot(base.mount[0],base.mount[2])+Math.max(Math.abs(a),Math.abs(b),Math.abs(tip))+.06);
}
