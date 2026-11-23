import fs from 'node:fs';import assert from 'node:assert/strict';
import {createGroundPlanner} from './ui/orchard/ground-planner.mjs';
import {createGroundDriver,pathProjection} from './ui/orchard/ground-driver.mjs';
const world=JSON.parse(fs.readFileSync(process.argv[2]||'/tmp/cacao-final-world.json')),snapshot=JSON.parse(fs.readFileSync(process.argv[3]||'/tmp/cacao-final-fleet.json')),spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url))),planner=createGroundPlanner(world),results=[];
for(const captured of Object.values(snapshot.robots).filter(r=>r.phase==='blocked')){
 const robot=world.config.fleet.robots.find(r=>r.id===captured.id),origin=robot.station_enu,config={...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:origin}}},driver=await createGroundDriver(spec,config);driver.restore(captured.dynamics);
 const state=driver.state(),start=[state.position[2]+origin[0],state.position[0]+origin[1]],route=planner.planVehicle(start,origin,state.yaw,null);assert.ok(route,'Exact supported pose must connect to the navigation grid');
 driver.navigate(route.points.map(([x,y])=>[y-origin[1],x-origin[0]]),{home:true,directions:route.directions});let next,maxDeviation=0;
 for(let i=0;i<90000;i++){next=driver.step();if(i%60===0)maxDeviation=Math.max(maxDeviation,pathProjection([next.position[2]+origin[0],next.position[0]+origin[1]],route.points).distance);if(next.charging||next.status==='stopped')break}
 const report={id:robot.id,status:next.status,charging:next.charging,elapsed:next.elapsed-state.elapsed,maxDeviation,points:route.points.length};results.push(report);driver.dispose();console.log(JSON.stringify(report));assert.equal(next.status,'idle');assert.ok(next.charging);
}
assert.ok(results.length,'Capture must include a blocked return');fs.writeFileSync(new URL('./evidence/captured-home-route.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
