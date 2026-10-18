import assert from 'node:assert/strict';
import {sectorStream} from './ui/orchard/sector-stream.mjs';
const sectors=new Map(Array.from({length:100},(_,i)=>[i,{id:i,bounds:{minX:i*10,maxX:(i+1)*10,minZ:0,maxZ:10},health:'preserved'}]));
let loads=0,unloads=0;
const stream=sectorStream(sectors,{load:s=>{loads++;return {sector:s}},unload:()=>unloads++,loadRadius:12,releaseRadius:18});
stream.update([{x:0,z:0}]);const first=stream.resident.get(0);assert.ok(stream.resident.size<5);
stream.update([{x:1,z:1}]);assert.equal(stream.resident.get(0),first);assert.equal(unloads,0);
stream.update([{x:35,z:0}]);assert.ok(!stream.resident.has(0));assert.ok(unloads>0);
stream.update([{x:0,z:0},{x:900,z:0}]);assert.ok(stream.resident.has(0));assert.ok(stream.resident.has(90));assert.equal(stream.resident.get(0).sector,first.sector);
assert.equal(first.sector.health,'preserved');
for(let x=0;x<900;x+=10){stream.update([{x,z:0}]);assert.ok(stream.resident.size<=7)}
assert.ok(loads>90&&unloads>80);stream.dispose();assert.equal(stream.resident.size,0);
console.log('Sector residency: bounded loading, hysteresis, two cameras, unloading and return passed.');
