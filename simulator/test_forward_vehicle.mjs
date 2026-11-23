import fs from 'node:fs';import assert from 'node:assert/strict';import {createGroundPlanner} from './ui/orchard/ground-planner.mjs';import {createGroundDriver} from './ui/orchard/ground-driver.mjs';
const world=JSON.parse(fs.readFileSync(new URL('./runtime/orchard.json',import.meta.url))),spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url))),planner=createGroundPlanner(world),results=[];
for(const yaw of [0,Math.PI]){
 const start=[2,-8],goal=[2,5],t=performance.now(),route=planner.planVehicle(start,goal,yaw,0);assert.ok(route,'heading route');console.log(JSON.stringify({yaw,planningMs:performance.now()-t,points:route.points.length}));
 let reverse=0,totalReverse=0;for(let i=1;i<route.points.length;i++){const length=Math.hypot(...route.points[i].map((v,j)=>v-route.points[i-1][j]));if(route.directions[i]<0){reverse+=length;totalReverse+=length;assert.ok(reverse<=2.41)}else reverse=0}
 const cfg={...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:start}}},driver=await createGroundDriver(spec,cfg),initial=driver.state();driver.restore({...initial,rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)]});driver.navigate(route.points.map(([e,n])=>[n-start[1],e-start[0]]),{directions:route.directions});let state;for(let i=0;i<30000;i++){state=driver.step();if(state.status==='complete'||state.status==='stopped')break}
 results.push({yaw,totalReverse,status:state.status,yawEnd:state.yaw,position:state.position});driver.dispose();assert.equal(state.status,'complete',JSON.stringify(results.at(-1)));assert.ok(Math.abs(Math.atan2(Math.sin(state.yaw),Math.cos(state.yaw)))<.6,JSON.stringify(results.at(-1)));
}
// A short reverse manoeuvre must brake before changing back to forward.
{
 const cfg={...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:[2,-8]}}},driver=await createGroundDriver(spec,cfg);
 driver.navigate([[0,0],[-1,0],[-.5,0]],{directions:[1,-1,1]});let state,min=0;
 for(let i=0;i<20000;i++){state=driver.step();min=Math.min(min,state.position[0]);if(state.status==='complete'||state.status==='stopped')break}
 assert.equal(state.status,'complete');assert.ok(min<-.7&&min>-1.2);assert.ok(Math.abs(state.position[0]+.5)<.20);
 results.push({case:'short_reverse_then_forward',status:state.status,furthest_reverse_m:min,position:state.position});driver.dispose();
}
fs.writeFileSync(new URL('./evidence/forward-navigation.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
