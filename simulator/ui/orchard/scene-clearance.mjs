import {heightAt} from './terrain.mjs';
const sub=(a,b)=>a.map((n,i)=>n-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),clamp=n=>Math.max(0,Math.min(1,n));
export function segmentDistance(a,b,c,d){
 const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);
 const nearest=(p,x,y)=>{const delta=sub(y,x),t=clamp(dot(sub(p,x),delta)/(dot(delta,delta)||1));return x.map((n,i)=>n+t*delta[i])};
 if(aa<1e-12)return Math.hypot(...sub(a,nearest(a,c,d)));if(cc<1e-12)return Math.hypot(...sub(c,nearest(c,a,b)));
 const denominator=aa*cc-bb*bb;let s=denominator>1e-12?clamp((bb*ee-cc*dd)/denominator):0,t=(bb*s+ee)/cc;
 if(t<0){t=0;s=clamp(-dd/aa)}else if(t>1){t=1;s=clamp((bb-dd)/aa)}
 return Math.hypot(...w.map((n,i)=>n+s*u[i]-t*v[i]));
}
// The same conservative capsule geometry used by physical flight/localization.
// Spatial queries are shared by route clearance and optical line of sight.
export function createSceneClearance(world,{cellSize=4,obstacles=[]}={}){
 const cells=new Map(),capsules=[],foliageCells=new Map();
 function register(c){capsules.push(c);const r=c.radius;
  for(let x=Math.floor((Math.min(c.a[0],c.b[0])-r)/cellSize);x<=Math.floor((Math.max(c.a[0],c.b[0])+r)/cellSize);x++)for(let y=Math.floor((Math.min(c.a[1],c.b[1])-r)/cellSize);y<=Math.floor((Math.max(c.a[1],c.b[1])+r)/cellSize);y++){const k=`${x},${y}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(c)}
 }
 for(const obstacle of obstacles)register(obstacle);
 for(const plant of world.plants){
  for(const shoot of plant.structure?.shoots||[]){const center=plant.position.map((n,i)=>n+shoot[i]);const c={a:center,b:center,radius:.40*(shoot[4]||1)};for(let x=Math.floor((center[0]-c.radius)/cellSize);x<=Math.floor((center[0]+c.radius)/cellSize);x++)for(let y=Math.floor((center[1]-c.radius)/cellSize);y<=Math.floor((center[1]+c.radius)/cellSize);y++){const key=`${x},${y}`;if(!foliageCells.has(key))foliageCells.set(key,[]);foliageCells.get(key).push(c)}}
  const bones=plant.structure?.bones||(!plant.height?[]:[[0,0,0,0,0,plant.height*.76,.09,.09,0]]);
  for(const bone of bones){if(bone[8]>3)continue;const radius=Math.max(bone[6],bone[7]);if(radius<.006)continue;
   register({a:plant.position.map((n,i)=>n+bone[i]),b:plant.position.map((n,i)=>n+bone[i+3]),radius});
  }
 }
 function nearby(a,b,radius,source=cells){const found=new Set();for(let x=Math.floor((Math.min(a[0],b[0])-radius)/cellSize);x<=Math.floor((Math.max(a[0],b[0])+radius)/cellSize);x++)for(let y=Math.floor((Math.min(a[1],b[1])-radius)/cellSize);y<=Math.floor((Math.max(a[1],b[1])+radius)/cellSize);y++)for(const c of source.get(`${x},${y}`)||[])found.add(c);return found}
 function clear(a,b,radius=0,{groundMargin=0,includeFoliage=false}={}){
  if(includeFoliage)for(const c of nearby(a,b,radius,foliageCells))if(segmentDistance(a,b,c.a,c.b)<c.radius+radius)return false;
  for(const c of nearby(a,b,radius))if((radius>0||c.opaque!==false)&&segmentDistance(a,b,c.a,c.b)<c.radius+radius)return false;
  const count=Math.max(1,Math.ceil(Math.hypot(...sub(b,a))/.25));for(let i=0;i<=count;i++){const p=a.map((n,j)=>n+(b[j]-n)*i/count);if(p[2]<heightAt(world.terrain,p[0],p[1])+groundMargin+radius)return false}return true;
 }
 function visible(camera,pod){
  const direction=sub(camera,pod.position),distance=Math.hypot(...direction);if(distance<.05)return false;const normal=direction.map(v=>v/distance),radii=pod.radii_m||[.055,.055,.14];
  const radius=1/Math.sqrt((normal[0]/radii[0])**2+(normal[1]/radii[1])**2+(normal[2]/radii[2])**2);
  return [[0,0,0],[.025,0,0],[-.025,0,0],[0,0,.04],[0,0,-.04]].filter(offset=>clear(camera,pod.position.map((n,i)=>n+normal[i]*radius+offset[i]))).length>=3;
 }
 function plan(start,goal,{radius=.42,groundMargin=1.65,step=.6,maxNodes=14000,includeFoliage=false}={}){
  const pass=(a,b)=>clear(a,b,radius,{groundMargin,includeFoliage});if(!pass(start,start)||!pass(goal,goal))return null;if(pass(start,goal))return [start,goal];
  // When a local view sits below a crown, use a checked exit column and
  // cross above the vegetation instead of searching/cutting through branches.
  const around=[...nearby(start,goal,5),...(includeFoliage?nearby(start,goal,5,foliageCells):[])],height=Math.max(start[2],goal[2],...around.map(c=>Math.max(c.a[2],c.b[2])+c.radius))+radius+.35;
  function exits(endpoint){const options=[];for(const reach of [0,.8,1.6,2.4,3.2,4.8])for(let i=0;i<(reach?16:1);i++){
   const a=i*Math.PI/8,low=[endpoint[0]+Math.cos(a)*reach,endpoint[1]+Math.sin(a)*reach,endpoint[2]],high=[low[0],low[1],height];
   if(pass(endpoint,low)&&pass(low,high))options.push({low,high,cost:reach});
  }return options.sort((a,b)=>a.cost-b.cost).slice(0,6)}
  const from=exits(start),to=exits(goal),bridges=[];
  for(const a of from)for(const b of to)if(pass(a.high,b.high))bridges.push({path:[start,a.low,a.high,b.high,b.low,goal],cost:a.cost+b.cost+Math.hypot(a.high[0]-b.high[0],a.high[1]-b.high[1])});
  if(bridges.length)return bridges.sort((a,b)=>a.cost-b.cost)[0].path;
  const key=p=>p.join(','),point=p=>p.map((v,i)=>start[i]+v*step),nodes=[{p:[0,0,0],cost:0,score:Math.hypot(...sub(goal,start))}],costs=new Map([['0,0,0',0]]),parents=new Map(),closed=new Set();let iterations=0;
  while(nodes.length&&iterations++<maxNodes){let best=0;for(let i=1;i<nodes.length;i++)if(nodes[i].score<nodes[best].score)best=i;const node=nodes.splice(best,1)[0],k=key(node.p);if(closed.has(k))continue;closed.add(k);const here=point(node.p);
   if(Math.hypot(...sub(here,goal))<step*2&&pass(here,goal)){const path=[goal,here];let previous=k;while(parents.has(previous)){previous=parents.get(previous);path.push(point(previous.split(',').map(Number)))}path.reverse();const result=[path[0]];let index=0;while(index<path.length-1){let next=index+1;for(let j=next+1;j<path.length;j++)if(pass(path[index],path[j]))next=j;result.push(path[next]);index=next}return result}
   for(const delta of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const p=node.p.map((n,i)=>n+delta[i]),pk=key(p),there=point(p),cost=node.cost+step;if(closed.has(pk)||cost>=(costs.get(pk)??Infinity)||!pass(here,there))continue;costs.set(pk,cost);parents.set(pk,k);nodes.push({p,cost,score:cost+Math.hypot(...sub(there,goal))})}
  }return null;
 }
 return {clear,visible,plan,capsules};
}
