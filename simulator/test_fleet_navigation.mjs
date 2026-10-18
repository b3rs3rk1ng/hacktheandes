import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGroundPlanner} from './ui/orchard/ground-planner.mjs';
import {createGroundDriver} from './ui/orchard/ground-driver.mjs';
const world=JSON.parse(fs.readFileSync(new URL('./runtime/orchard.json',import.meta.url))),config=JSON.parse(fs.readFileSync(new URL('./orchard_config.json',import.meta.url)));
world.config.fleet=config.fleet;
const planner=createGroundPlanner(world),spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
const plant=world.plants.find(p=>p.id===world.route[0]),pods=world.pods.filter(p=>p.plant_id===plant.id);
let path,target;
for(const pod of pods){for(const goal of planner.approaches(pod,plant)){path=planner.approachPath(config.fleet.robots[0].station_enu,goal,pod);if(path){target=pod;break}}if(path)break}
assert.ok(path);for(let i=1;i<path.length;i++)assert.ok(planner.clear(path[i-1],path[i]));assert.equal(planner.plan(plant.position.slice(0,2),[0,0]),null);
const w={...world,config:{...world.config,ground_vehicle:{...world.config.ground_vehicle,origin_enu:config.fleet.robots[0].station_enu}}},driver=await createGroundDriver(spec,w),[east,north]=w.config.ground_vehicle.origin_enu;
driver.navigate(path.map(([e,n])=>[n-north,e-east]));let state;
for(let i=0;i<24000;i++){state=driver.step();if(state.status==='complete'&&Math.abs(state.speed)<.04||state.status==='stopped')break}
assert.equal(state.status,'complete',JSON.stringify(state));assert.ok(Math.hypot(state.position[0]+north-path.at(-1)[1],state.position[2]+east-path.at(-1)[0])<.3);
const checkpoint=state;driver.restore(checkpoint);let recovered=driver.state();
assert.ok(Math.hypot(...recovered.position.map((v,i)=>v-checkpoint.position[i]))<1e-4,'Frame/center-of-mass restoration must preserve pose');
for(let i=0;i<240;i++)recovered=driver.step();assert.ok(recovered.wheels.filter(w=>w.contact).length>=3,'Restored wheels must contact terrain');
state=recovered;const held=[...state.position];for(let i=0;i<2400;i++)state=driver.step();const holdDrift=Math.hypot(state.position[0]-held[0],state.position[2]-held[2]);assert.ok(holdDrift<.1,'Parking drift '+holdDrift);
const reached=[state.position[2]+east,state.position[0]+north];const home=planner.plan(reached,[east,north]);assert.ok(home);driver.home();
for(let i=0;i<30000;i++){state=driver.step();if(state.charging||state.status==='stopped')break}
assert.equal(state.status,'idle',JSON.stringify(state));assert.ok(state.charging);const before=state.soc;for(let i=0;i<1200;i++)state=driver.step();assert.ok(state.soc>before);assert.ok(state.power<0);
const report={target_id:target.id,path,outbound_reached_enu:reached,return_enu:[state.position[2]+east,state.position[0]+north],charging:true,parking_drift_20s_m:holdDrift,soc_before:before,soc_after:state.soc,checks:['grid avoids trunks and excessive grades','exact start/goal path segments clear','physical drive to alert approach','physical return to own station','gradual positive charge only at station']};fs.writeFileSync(new URL('./evidence/fleet-navigation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');driver.dispose();console.log(JSON.stringify(report));
