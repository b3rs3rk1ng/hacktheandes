const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Follow the continuous polyline, including its gear boundaries. Looking past
// ordinary vertices avoids orbiting a missed half-metre lattice waypoint.
export function directedRouteTarget(position,path,directions,index,{lookahead=.7,arrival=.18,gearArrival=.18}={}){
 index=Math.max(1,Math.min(index,path.length-1));const direction=directions[index];
 let best=null;
 for(let i=index;i<Math.min(path.length,index+5);i++){
  if(directions[i]!==direction)break;
  const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-8)continue;
  const raw=((position[0]-a[0])*dx+(position[1]-a[1])*dy)/(length*length),t=Math.max(0,Math.min(1,raw)),point=[a[0]+dx*t,a[1]+dy*t],error=distance(position,point);
  if(!best||error<best.error-1e-6)best={index:i,point,error,t,raw,length,lateral:Math.abs((position[0]-a[0])*dy-(position[1]-a[1])*dx)/length};
 }
 if(!best)return {index,direction,target:path[index],deviation:distance(position,path[index]),remaining:distance(position,path.at(-1)),complete:distance(position,path.at(-1))<arrival,gearBoundary:false};
 index=best.index;let end=index;while(end<path.length-1&&directions[end+1]===direction)end++;
 let remaining=(1-best.t)*best.length;for(let i=index+1;i<=end;i++)remaining+=distance(path[i-1],path[i]);
 const terminalDistance=distance(position,path[end]),atEnd=terminalDistance<(end===path.length-1?arrival:gearArrival)||(index===end&&best.raw>=1&&best.lateral<.18);
 let target=best.point,advance=lookahead,i=index;
 while(i<=end){const b=path[i],length=distance(target,b);if(advance<=length){const t=advance/Math.max(length,1e-8);target=target.map((v,k)=>v+(b[k]-v)*t);break}advance-=length;target=b;i++}
 return {index,direction,target,deviation:best.error,remaining,complete:atEnd&&end===path.length-1,gearBoundary:atEnd&&end<path.length-1,nextIndex:end+1};
}
