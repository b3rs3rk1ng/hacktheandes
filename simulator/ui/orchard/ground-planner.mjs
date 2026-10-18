import {heightAt} from './terrain.mjs';

// A common metric navigation grid: trunk clearance + grade, independent of
// parcel names, task IDs and disease labels. Returned paths remain on the ground.
export function createGroundPlanner(world){
 const cfg=world.config.fleet||{},step=cfg.navigation_grid_m||.6,clearance=cfg.navigation_clearance_m||.72,t=world.terrain;
 const min=t.origin,max=[min[0]+(t.columns-1)*t.spacing,min[1]+(t.rows-1)*t.spacing],bins=new Map(),cache=new Map();
 for(const p of world.plants){if(p.crop==='maize')continue;const key=`${Math.floor(p.position[0]/4)},${Math.floor(p.position[1]/4)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p)}
 function safe(p){if(p[0]<min[0]+1||p[1]<min[1]+1||p[0]>max[0]-1||p[1]>max[1]-1)return false;
  const bx=Math.floor(p[0]/4),by=Math.floor(p[1]/4);
  for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++)for(const tree of bins.get(`${x},${y}`)||[])if(Math.hypot(p[0]-tree.position[0],p[1]-tree.position[1])<clearance+(tree.structure?.radius||.09))return false;
  const h=heightAt(t,...p);return [[step,0],[0,step]].every(d=>Math.abs(heightAt(t,p[0]+d[0],p[1]+d[1])-h)/step<.46);
 }
 function clear(a,b){const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(step*.5));for(let i=0;i<=n;i++)if(!safe([a[0]+(b[0]-a[0])*i/(n||1),a[1]+(b[1]-a[1])*i/(n||1)]))return false;return true}
 const key=p=>p.join(','),point=p=>[p[0]*step,p[1]*step];
 function plan(start,goal){
  if(!safe(start)||!safe(goal))return null;if(clear(start,goal))return [start,goal];
  const a=start.map(v=>Math.round(v/step)),b=goal.map(v=>Math.round(v/step)),g=new Map([[key(a),0]]),parent=new Map(),open=[{p:a,f:0}],closed=new Set();let count=0;
  function valid(p){const k=key(p);if(!cache.has(k))cache.set(k,safe(point(p)));return cache.get(k)}
  while(open.length&&count++<35000){let best=0;for(let i=1;i<open.length;i++)if(open[i].f<open[best].f)best=i;const node=open.splice(best,1)[0],k=key(node.p);if(closed.has(k))continue;closed.add(k);
   if(k===key(b)){const path=[goal];let cur=k;while(parent.has(cur)){path.push(point(cur.split(',').map(Number)));cur=parent.get(cur)}path.push(start);path.reverse();const out=[start];let index=0;while(index<path.length-1){let next=index+1;for(let i=next+1;i<path.length&&clear(path[index],path[i]);i++)next=i;out.push(path[next]);index=next}return out}
   for(const d of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const p=[node.p[0]+d[0],node.p[1]+d[1]],pk=key(p);if(closed.has(pk)||!valid(p)||!clear(point(node.p),point(p)))continue;const cost=g.get(k)+Math.hypot(...d)*step;if(cost>=(g.get(pk)??Infinity))continue;g.set(pk,cost);parent.set(pk,k);open.push({p,f:cost+Math.hypot(p[0]-b[0],p[1]-b[1])*step})}
  }return null;
 }
 function planFromPose(start,goal,yaw=null){
  if(safe(start))return plan(start,goal);
  // A physical vehicle may stop inside the conservative planning margin.
  // Escape only away from nearby trunks; never shrink an existing clearance.
  const nearby=[];const bx=Math.floor(start[0]/4),by=Math.floor(start[1]/4);
  for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++)for(const tree of bins.get(`${x},${y}`)||[]){const r=tree.structure?.radius||.09,d=Math.hypot(start[0]-tree.position[0],start[1]-tree.position[1]);if(d<r+.18)return null;nearby.push({p:tree.position,minimum:Math.min(d,r+clearance)})}
  if(Number.isFinite(yaw)){
   const forward=Math.PI/2+yaw;
   // First create room along the vehicle's actual forward/reverse axis. A
   // car cannot escape a trunk by moving sideways toward a grid waypoint.
   for(const length of [step*3,step*4])for(const angle of [forward,forward+Math.PI]){
    const endpoint=[start[0]+Math.cos(angle)*length,start[1]+Math.sin(angle)*length];if(!safe(endpoint))continue;
    let pass=true;const n=Math.ceil(length/.1);
    for(let i=0;i<=n&&pass;i++){const q=[start[0]+(endpoint[0]-start[0])*i/n,start[1]+(endpoint[1]-start[1])*i/n];for(const tree of nearby)if(Math.hypot(q[0]-tree.p[0],q[1]-tree.p[1])<tree.minimum-1e-5){pass=false;break}}
    if(pass){const path=plan(endpoint,goal);if(path)return [start,...path]}
   }
  }
  const candidates=[];
  for(const radius of [step,step*2,step*3])for(let turn=0;turn<16;turn++){
   const a=turn*Math.PI/8,p=[start[0]+Math.cos(a)*radius,start[1]+Math.sin(a)*radius];if(!safe(p))continue;
   const n=Math.ceil(radius/.1);let pass=true;
   for(let i=0;i<=n&&pass;i++){const q=[start[0]+(p[0]-start[0])*i/n,start[1]+(p[1]-start[1])*i/n];for(const tree of nearby)if(Math.hypot(q[0]-tree.p[0],q[1]-tree.p[1])<tree.minimum-1e-5){pass=false;break}}
   if(pass)candidates.push(p);
  }
  candidates.sort((a,b)=>Math.hypot(a[0]-goal[0],a[1]-goal[1])-Math.hypot(b[0]-goal[0],b[1]-goal[1]));
  for(const candidate of candidates){const path=plan(candidate,goal);if(path)return [start,...path]}
  return null;
 }
 function approaches(pod,plant){const a=Math.atan2(pod.position[1]-plant.position[1],pod.position[0]-plant.position[0]),out=[];
  for(const turn of [0,.4,-.4,.8,-.8,1.2,-1.2,Math.PI])for(const r of [.85,1,.75]){const p=[pod.position[0]+Math.cos(a+turn)*r,pod.position[1]+Math.sin(a+turn)*r];if(safe(p))out.push(p)}return out;
 }
 function approachPath(start,goal,pod){const d=[pod.position[0]-goal[0],pod.position[1]-goal[1]],length=Math.hypot(...d);for(const lead of [2.4,1.8,1.3]){const staging=[goal[0]-d[0]/length*lead,goal[1]-d[1]/length*lead];if(!clear(staging,goal))continue;const path=plan(start,staging);if(path)return [...path,goal]}return null}
 return {plan,planFromPose,safe,clear,approaches,approachPath};
}
