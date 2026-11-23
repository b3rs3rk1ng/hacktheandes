import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneClearance,segmentDistance} from './ui/orchard/scene-clearance.mjs';
test('optical visibility rejects hidden fruit for translated and rotated scenes',()=>{
 for(const angle of [0,Math.PI/2,Math.PI])for(const origin of [[0,0,0],[12,-8,0]]){
  const position=(x,y,z)=>[origin[0]+x*Math.cos(angle)-y*Math.sin(angle),origin[1]+x*Math.sin(angle)+y*Math.cos(angle),z];
  const field=createSceneClearance({plants:[{position:origin,height:4}],terrain:null});
  const pod={position:position(-.2,0,1),radii_m:[.055,.055,.14]};
  assert.equal(field.visible(position(2,0,1),pod),false,'cannot see through trunk');
  assert.equal(field.visible(position(-2,0,1),pod),true,'fruit on near side is visible');
 }
});
test('swept airframe route detours around wood and preserves radius',()=>{
 const field=createSceneClearance({plants:[{position:[0,0,0],height:4}],terrain:null}),a=[-2,0,1],b=[2,0,1];
 assert.equal(field.clear(a,b,.42),false);
 const route=field.plan(a,b,{radius:.42,groundMargin:0});assert.ok(route);
 for(let i=1;i<route.length;i++)assert.ok(field.clear(route[i-1],route[i],.42));
 assert.equal(segmentDistance([-1,0,0],[1,0,0],[0,-1,0],[0,1,0]),0);
});
