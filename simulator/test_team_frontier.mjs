import assert from 'node:assert/strict';import {teamFrontier} from './ui/orchard/team-frontier.mjs';
const lanes=['a','b','c'].map(robot_id=>({robot_id})),indices={a:4,b:4,c:0};
assert.equal(teamFrontier(lanes,indices),0);
assert.equal(teamFrontier(lanes,indices,{c:{phase:'returning'}}),4);
assert.equal(teamFrontier(lanes,indices,{c:{phase:'charging'}}),4);
assert.equal(teamFrontier(lanes,indices,{c:{phase:'patrolling'}}),0);
assert.equal(teamFrontier(lanes,indices,Object.fromEntries(lanes.map(l=>[l.robot_id,{phase:'charging'}]))),0);
console.log('Team frontier: field coordination continues during station trips; rejoining restores coordination');
