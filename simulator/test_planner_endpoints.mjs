import assert from 'node:assert/strict';
import {createGroundPlanner} from './ui/orchard/ground-planner.mjs';
const world={config:{fleet:{}},terrain:{origin:[-12,-12],columns:41,rows:41,spacing:.6,heights:Array(41*41).fill(0)},plants:[{position:[0,0,0],crop:'tree',structure:{radius:.09}}]};
const planner=createGroundPlanner(world);
for(const [start,goal] of [[[.82,0],[-3,0]],[[3,0],[-.82,0]],[[.82,0],[-.82,0]],[[0,.82],[0,-.82]]]){
 assert.ok(planner.safe(start)&&planner.safe(goal));
 const path=planner.plan(start,goal);assert.ok(path,JSON.stringify({start,goal}));
 assert.deepEqual(path[0],start);assert.deepEqual(path.at(-1),goal);
 for(let i=1;i<path.length;i++)assert.ok(planner.clear(path[i-1],path[i]));
}
assert.equal(planner.plan([0,0],[4,0]),null,'genuinely occupied starts stay blocked');
assert.equal(planner.plan([4,0],[0,0]),null,'genuinely occupied goals stay blocked');
console.log('Grid endpoint attachment: exact valid poses, both ends, rotated routes and occupied poses passed');
