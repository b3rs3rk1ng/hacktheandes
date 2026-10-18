import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createGroundDriver,pathProjection} from './ui/orchard/ground-driver.mjs';
assert.equal(pathProjection([8,4],[[5,4],[8,4],[8,8]]).progress,3/7);
assert.equal(pathProjection([8,8],[[5,4],[8,4],[8,8]]).progress,1);
assert.equal(pathProjection([10,6],[[5,4],[8,4],[8,8]]).distance,2);
const raw=fs.readFileSync(new URL('./runtime/orchard.json',import.meta.url));
const world=JSON.parse(raw),spec=JSON.parse(fs.readFileSync(new URL('./ui/robotics/rover-spec.json',import.meta.url)));
const driver=await createGroundDriver(spec,world),trace=[];let s,peakPitch=0,peakRoll=0,minContacts=4,maxCrossTrack=0;
for(let i=0;i<480;i++)s=driver.step({enabled:false});assert.ok(Math.abs(s.position[0])<.005);
driver.start();
function record(i){if(i>120){peakPitch=Math.max(peakPitch,Math.abs(s.pitch));peakRoll=Math.max(peakRoll,Math.abs(s.roll));minContacts=Math.min(minContacts,s.wheels.filter(w=>w.contact).length);maxCrossTrack=Math.max(maxCrossTrack,Math.abs(s.position[2]))}if(i%120===0)trace.push({time:s.elapsed,position:s.position,speed:s.speed,pitch:s.pitch,roll:s.roll,contacts:s.wheels.filter(w=>w.contact).length,status:s.status,returning:s.returning})}
for(let i=0;i<24000;i++){s=driver.step();record(i);if(s.status==='complete'||s.status==='stopped')break}
assert.equal(s.status,'complete');assert.ok(peakPitch>8*Math.PI/180);assert.ok(peakRoll>4*Math.PI/180);assert.ok(maxCrossTrack<.4);assert.ok(s.soc<1&&s.soc>.9);
const outbound={time:s.elapsed,position:s.position};driver.home();
for(let i=0;i<30000;i++){s=driver.step();record(i);if(s.status==='stopped'||s.status==='idle'&&Math.abs(s.speed)<.03)break}
assert.equal(s.status,'idle');assert.ok(Math.hypot(s.position[0],s.position[2])<.35);assert.ok(maxCrossTrack<1.5);const returnTime=s.elapsed;
driver.dynamics.body.setRotation({x:Math.sin(.8/2),y:0,z:0,w:Math.cos(.8/2)},true);s=driver.step();assert.equal(s.status,'stopped');for(let i=0;i<4;i++)assert.equal(driver.dynamics.vehicle.wheelEngineForce(i),0);
const reset=driver.reset(.75);assert.equal(reset.status,'idle');assert.equal(reset.soc,.75);assert.ok(Math.abs(reset.position[0])<1e-6);
// A shifted start and multiple segments use the same controller and progress
// contract; returning follows the declared path instead of an X-axis shortcut.
const alternate=structuredClone(world);alternate.plants=[];alternate.terrain.patches=[];alternate.terrain.heights.fill(0);alternate.config.ground_vehicle.route_local_xz=[[5,.2],[12,.2],[16,.6]];
const other=await createGroundDriver(spec,alternate);assert.ok(Math.abs(other.state().position[0]-5)<1e-6);other.start();let a;
for(let i=0;i<6000;i++){a=other.step();if(a.status==='complete'||a.status==='stopped')break}
assert.equal(a.status,'complete');assert.ok(a.progress>.98);other.home();
for(let i=0;i<9000;i++){a=other.step();if(a.status==='idle'&&Math.abs(a.speed)<.03||a.status==='stopped')break}
assert.equal(a.status,'idle');assert.ok(Math.hypot(a.position[0]-5,a.position[2]-.2)<.35);other.dispose();
const report={engine:'Rapier 0.21.0',scene_sha256:crypto.createHash('sha256').update(raw).digest('hex'),terrain_sha256:crypto.createHash('sha256').update(JSON.stringify(world.terrain)).digest('hex'),outbound,return_time_s:returnTime,peak_pitch_deg:peakPitch*180/Math.PI,peak_roll_deg:peakRoll*180/Math.PI,min_contacts:minContacts,max_cross_track_m:maxCrossTrack,trace,checks:['stationary without motor','complete outbound route','reverse return','tilt stop with zero engine force','explicit reset','shifted multi-segment route and return'],limits:'Rigid ground, raycast tires, folded arm; no mud, hardware calibration or harvesting/contact validation.'};
fs.writeFileSync(new URL('./evidence/ground-orchard-physics.json',import.meta.url),JSON.stringify(report,null,2)+'\n');driver.dispose();console.log(JSON.stringify({...report,trace:undefined},null,2));
