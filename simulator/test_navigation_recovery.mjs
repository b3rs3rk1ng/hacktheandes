import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGroundDriver} from './ui/orchard/ground-driver.mjs';
import {createGroundPlanner} from './ui/orchard/ground-planner.mjs';
const world=JSON.parse(fs.readFileSync(new URL('./runtime/orchard.json',import.meta.url))),live=JSON.parse(fs.readFileSync(new URL('./runtime/fleet-navigation-recovery.json',import.meta.url))),config=JSON.parse(fs.readFileSync(new URL('./orchard_config.json',import.meta.url))),spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
world.config.fleet=config.fleet;
const planner=createGroundPlanner(world),results=[];
for(const robot of config.fleet.robots){
 const saved=live.robots[robot.id],plant=world.plants.find(p=>p.id===saved.plant_id);if(!saved||!plant)continue;
 const origin=robot.station_enu,cfg={...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:origin}}},driver=await createGroundDriver(spec,cfg);assert.ok(driver.restore(saved.dynamics));
 const start=saved.position.slice(0,2),goals=[1,-1].map(side=>[plant.position[0]+side*1.25,plant.position[1]-.6]);let path;
 for(const goal of goals){path=planner.planFromPose(start,goal,saved.dynamics.yaw);if(path)break}assert.ok(path,robot.id+' recovery route');
 driver.navigate(path.map(([e,n])=>[n-origin[1],e-origin[0]]));let state,maxTilt=0;
 for(let i=0;i<24000;i++){state=driver.step();maxTilt=Math.max(maxTilt,Math.abs(state.pitch),Math.abs(state.roll));if(state.status==='stopped'&&driver.recover()){const current=[state.position[2]+origin[0],state.position[0]+origin[1]],next=planner.planFromPose(current,path.at(-1),state.yaw);if(next)driver.navigate(next.map(([e,n])=>[n-origin[1],e-origin[0]]));}if(state.status==='complete')break}
 const reached=[state.position[2]+origin[0],state.position[0]+origin[1]],distance=Math.hypot(...reached.map((v,i)=>v-path.at(-1)[i]));results.push({id:robot.id,path,status:state.status,reached,distance,maxTilt});driver.dispose();
 assert.equal(state.status,'complete',JSON.stringify(results.at(-1)));assert.ok(distance<.35,JSON.stringify(results.at(-1)));
}
fs.writeFileSync(new URL('./evidence/navigation-recovery.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
