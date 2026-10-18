import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RotorState,groundWash,washVelocity} from './ui/drone/rotor-core.mjs';
const F=JSON.parse(readFileSync(new URL('./orchard_config.json',import.meta.url))).flight;
function settle(fps,thrust,flight=F){const r=new RotorState(flight);for(let t=0;t<5*fps;t++)r.update(1/fps,thrust);return r;}
const thrust=F.mass_kg*9.81,a=settle(30,thrust),b=settle(120,thrust);
assert.ok(Math.abs(a.totalThrust-thrust)<1e-8);assert.ok(Math.abs(a.induced-b.induced)<1e-8);
assert.ok(a.rotors.every(r=>r.omega>0));assert.ok(settle(60,thrust*1.2).rotors[0].omega>a.rotors[0].omega);
assert.ok(groundWash(a.induced,.4,F.rotor_radius_m).emission>groundWash(a.induced,3,F.rotor_radius_m).emission);
assert.equal(groundWash(a.induced,3,F.rotor_radius_m).emission,0);
const field={origin:[0,1,0],induced:a.induced,radius:F.rotor_radius_m*2,groundY:0};
assert.ok(washVelocity([0,.6,0],field)[1]<0);assert.deepEqual(washVelocity([0,2,0],field),[0,0,0]);
assert.ok(Math.hypot(...washVelocity([.7,.1,0],field))>Math.hypot(...washVelocity([8,.1,0],field))*100);
assert.ok(washVelocity([.7,.1,0],field)[0]>0);
for(let i=0;i<600;i++)a.update(1/60,0);assert.ok(a.totalThrust<1e-12);assert.equal(a.rotors.length,4);
assert.equal(settle(60,thrust,{...F,rotors:6}).rotors.length,6);
assert.ok(settle(60,thrust,{...F,rotor_radius_m:.22}).rotors[0].omega<b.rotors[0].omega);
assert.throws(()=>a.update(-1,20));assert.throws(()=>a.update(.1,NaN));
console.log('Rotor tests: FPS independence, load/radius/count, spool-down, wake direction/locality/height passed.');
