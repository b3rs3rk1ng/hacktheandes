const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Minimum separation during simultaneous linear movement, not just endpoints.
export function sweptGap(a0,a1,b0,b1,margin=0){
 const x=a0.position[0]-b0.position[0],y=a0.position[1]-b0.position[1],dx=a1.position[0]-a0.position[0]-b1.position[0]+b0.position[0],dy=a1.position[1]-a0.position[1]-b1.position[1]+b0.position[1],t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1))),radius=Math.max(a0.radius,a1.radius)+Math.max(b0.radius,b1.radius)+margin;
 return Math.hypot(x+t*dx,y+t*dy)-radius;
}
export function createTrafficCoordinator({margin=.12,horizon=3,step=.15}={}){
 const reservations=new Map(),waitingSince=new Map();
 return {resolve(actors,now,delta){
  const times=[0];for(let t=Math.min(delta||step,step);t<horizon;t+=step)times.push(t);times.push(horizon);
  const plans=new Map(actors.map(actor=>[actor.id,times.map(t=>actor.sample(t))])),holds=new Map(),activePairs=new Set();
  const pinned=id=>{const samples=plans.get(id),first=samples[0];return samples.every(p=>distance(p.position,first.position)<1e-7&&p.radius<=first.radius+1e-7)};
  const conflicts=(a,b,holdA=false,holdB=false)=>{const aa=plans.get(a),bb=plans.get(b);for(let i=1;i<times.length;i++)if(sweptGap(aa[holdA?0:i-1],aa[holdA?0:i],bb[holdB?0:i-1],bb[holdB?0:i],margin)<-1e-8)return true;return false};
  const hold=(id,other)=>{if(!holds.has(id))holds.set(id,new Set());holds.get(id).add(other)};
  for(let pass=0;pass<actors.length+1;pass++){
   const previous=holds.size;
   for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
    const a=actors[i],b=actors[j],ah=holds.has(a.id),bh=holds.has(b.id);
    if(!conflicts(a.id,b.id,ah,bh))continue;
    const key=JSON.stringify([a.id,b.id].sort());activePairs.add(key);
    if(ah&&bh)continue;
    if(ah||pinned(a.id)){hold(b.id,a.id);continue}
    if(bh||pinned(b.id)){hold(a.id,b.id);continue}
    const aCanPass=!conflicts(a.id,b.id,false,true),bCanPass=!conflicts(a.id,b.id,true,false);
    if(!aCanPass&&!bCanPass){hold(a.id,b.id);hold(b.id,a.id);continue}
    const preferred=reservations.get(key),rank=actor=>waitingSince.get(actor.id)??actor.requestedAt??now;
    const winner=aCanPass&&(!bCanPass||preferred===a.id||(preferred!==b.id&&(rank(a)<rank(b)||(rank(a)===rank(b)&&String(a.id)<String(b.id)))))?a:b;
    reservations.set(key,winner.id);hold(winner===a?b.id:a.id,winner.id);
   }
   if(holds.size===previous)break;
  }
  for(const key of reservations.keys())if(!activePairs.has(key))reservations.delete(key);
  for(const actor of actors){if(holds.has(actor.id)){if(!waitingSince.has(actor.id))waitingSince.set(actor.id,now)}else waitingSince.delete(actor.id)}
  return new Map(actors.map(actor=>[actor.id,{allowed:!holds.has(actor.id),blockedBy:[...(holds.get(actor.id)||[])],waitingSince:waitingSince.get(actor.id)??null}]));
 }};
}
