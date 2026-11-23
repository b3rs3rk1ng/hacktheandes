const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
// Heading-aware bicycle lattice. Reverse is allowed only in bounded manoeuvres;
// a route must finish facing its travel direction, rather than backing a row.
export function planVehicleRoute(start,goal,yaw,goalYaw,{safe,clear,referencePath=null,wheelbase=.76,steering=.38,maxNodes=24000,step=.5,maxReverse=2,goalTolerance=.18}={}){
 const fixedHeading=Number.isFinite(goalYaw),targetTheta=Math.PI/2+(fixedHeading?goalYaw:Math.atan2(-(goal[0]-start[0]),goal[1]-start[1])),initial={x:start[0],y:start[1],theta:Math.PI/2+yaw,g:0,parent:null,direction:1,reverse:0};
 const key=n=>`${Math.round(n.x/.35)},${Math.round(n.y/.35)},${Math.round(wrap(n.theta)/(.15))},${n.direction},${Math.round(n.reverse/.5)}`;
 const heap=[],costs=new Map(),push=n=>{heap.push(n);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].f<=n.f)break;heap[i]=heap[p];i=p}heap[i]=n};
 function pop(){const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j}heap[i]=last}return top}
 const guide=referencePath||[start,goal],remaining=guide.map(()=>0);for(let i=guide.length-2;i>=0;i--)remaining[i]=remaining[i+1]+Math.hypot(guide[i+1][0]-guide[i][0],guide[i+1][1]-guide[i][1]);
 const heuristic=n=>{let closest=Infinity,travel=0;for(let i=1;i<guide.length;i++){const a=guide[i-1],b=guide[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),t=length?Math.max(0,Math.min(1,((n.x-a[0])*dx+(n.y-a[1])*dy)/(length*length))):0,d=Math.hypot(n.x-a[0]-t*dx,n.y-a[1]-t*dy);if(d<closest){closest=d;travel=remaining[i]+(1-t)*length}}return closest+travel+(fixedHeading?.5*Math.abs(wrap(n.theta-targetTheta)):0)};initial.f=heuristic(initial);push(initial);costs.set(key(initial),0);
 for(let count=0;heap.length&&count<maxNodes;count++){
  const n=pop();if(n.g>(costs.get(key(n))??Infinity)+1e-8)continue;
  if(Math.hypot(n.x-goal[0],n.y-goal[1])<goalTolerance&&(!fixedHeading||Math.abs(wrap(n.theta-targetTheta))<.28)&&n.direction===1){
   const points=[],directions=[];let p=n;while(p){points.push([p.x,p.y]);directions.push(p.direction);p=p.parent}points.reverse();directions.reverse();
   // Do not append a sideways correction shorter than the turning radius.
   // The terminal pose already satisfies the declared position tolerance.
   return {points,directions,endYaw:wrap(n.theta-Math.PI/2),expanded:count};
  }
  for(const direction of [1,-1])for(const turn of [0,-steering,steering]){
   const reverse=direction<0?(n.direction<0?n.reverse:0)+step:0;if(reverse>maxReverse+.001)continue;
   let x=n.x,y=n.y,theta=n.theta,valid=true;const ds=step/5;
   for(let i=0;i<5;i++){const change=direction*ds*Math.tan(turn)/wheelbase;x+=direction*ds*Math.cos(theta+change/2);y+=direction*ds*Math.sin(theta+change/2);theta+=change;if(!safe([x,y])){valid=false;break}}
   if(!valid)continue;const g=n.g+step*(direction<0?6:1)+(n.direction!==direction?.9:0)+Math.abs(turn)*.08,node={x,y,theta,g,parent:n,direction,reverse};
   const k=key(node);if(g>=(costs.get(k)??Infinity))continue;costs.set(k,g);node.f=g+heuristic(node)*1.12;push(node);
  }
 }return null;
}

// Keep the nonholonomic search local along a coarse route through the field.
export function planGuidedVehicleRoute(start,goal,yaw,goalYaw,options={}){
 const guide=options.referencePath||[start,goal],lengths=[0];for(let i=1;i<guide.length;i++)lengths.push(lengths.at(-1)+Math.hypot(guide[i][0]-guide[i-1][0],guide[i][1]-guide[i-1][1]));
 if(lengths.at(-1)<=12)return planVehicleRoute(start,goal,yaw,goalYaw,options);
 const at=s=>{let i=1;while(i<guide.length-1&&lengths[i]<s)i++;const t=(s-lengths[i-1])/Math.max(1e-8,lengths[i]-lengths[i-1]);return guide[i-1].slice(0,2).map((v,k)=>v+(guide[i][k]-v)*t)};
 const points=[start],directions=[1];let current=start,heading=yaw,expanded=0;
 for(let distance=8;;distance+=8){const end=distance>=lengths.at(-1),s=Math.min(distance,lengths.at(-1)),target=end?goal:at(s),before=at(Math.max(0,s-.5)),after=at(Math.min(lengths.at(-1),s+.5)),targetYaw=end?goalYaw:null,previous=Math.max(0,s-8),referencePath=[current,...guide.filter((p,i)=>lengths[i]>previous&&lengths[i]<s),target];
  const route=planVehicleRoute(current,target,heading,targetYaw,{...options,referencePath});if(!route)return null;
  points.push(...route.points.slice(1));directions.push(...route.directions.slice(1));current=route.points.at(-1);heading=route.endYaw;expanded+=route.expanded;
  if(end)return {points,directions,endYaw:heading,expanded};
 }
}
