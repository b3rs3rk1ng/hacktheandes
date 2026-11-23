const harvesting=new Set(['reaching','aligning','gripping','cutting','withdrawing','lifting','carrying','depositing','releasing','clearing']);
// Only the small observer follows activity. The visitor's main camera stays put.
export function createActionObserver({minimumHoldMs=6500}={}){
 let current=null,since=-Infinity;
 return {choose(contexts,selected,now){
  const priority=c=>harvesting.has(c.phase)?3:['patrolling','navigating','returning'].includes(c.phase)?2:c.phase==='surveying'?1:0;
  const ranked=[...contexts].sort((a,b)=>priority(b)-priority(a));
  const best=ranked[0],candidate=best&&priority(best)===3?best.vehicle.id:selected==='drone'?best?.vehicle.id:'drone';
  const previous=contexts.find(c=>c.vehicle.id===current),stillActive=current==='drone'||(previous&&priority(previous)>0);
  if(!current||!stillActive||now-since>=minimumHoldMs){if(candidate!==current){current=candidate;since=now}}
  return current;
 }};
}
