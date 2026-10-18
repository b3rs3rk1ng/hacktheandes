import assert from 'node:assert/strict';
import {SnapshotTimeline} from './ui/orchard/motion.mjs';
const state=(wall,sim=wall,phase='transit')=>({updated_at:wall/1000,simulation_time:sim,phase});
const t=new SnapshotTimeline({delayMs:100,maxGapMs:1500});
assert.equal(t.sample(0),null);
t.push(state(1000),100);t.push(state(1100),200);t.push(state(1200),300);
let s=t.sample(350);assert.equal(s.from.updated_at,1.1);assert.equal(s.alpha,.5);
// Smoothly advance between packets rather than stepping at receive boundaries.
assert.equal(t.sample(375).alpha,.75);
// A late/duplicate packet cannot reverse the visible flight.
assert.equal(t.push(state(1100),280),false);
t.push(state(1300),480);s=t.sample(490);assert.ok(s.time>=1175);
assert.ok(t.sample(500).time>=s.time);
// Outage: hold the last known physical pose, never extrapolate through a tree.
s=t.sample(5000);assert.equal(s.from.updated_at,1.3);assert.equal(s.to.updated_at,1.3);
// Reconnect and explicit reset establish a new timeline rather than flying
// through the intervening world to disguise a scenario reset.
t.push(state(6000,6000),5100);assert.equal(t.samples.length,1);
t.push(state(6100,100,'idle'),5200);assert.equal(t.samples.length,1);
assert.equal(t.sample(5200).from.phase,'idle');
// Clock offsets are independent of simulated clock acceleration.
const fast=new SnapshotTimeline({delayMs:100});
fast.push(state(1000,0),50);fast.push(state(1100,600),150);
s=fast.sample(200);assert.equal(s.alpha,.5);
assert.equal(s.from.simulation_time+(s.to.simulation_time-s.from.simulation_time)*s.alpha,300);
// A late packet used to jump 0.6 m in one video frame. The playhead now
// advances by wall time even when a new snapshot arrives after an underrun.
const jitter=new SnapshotTimeline({delayMs:100});
jitter.push(state(1000),100);jitter.sample(100);jitter.sample(490);
jitter.push(state(1400),500);const before=jitter.playhead;
assert.ok(jitter.sample(506).time-before<=16);
const after=jitter.playhead;
assert.ok(jitter.sample(522).time-after<=16);
const reset=new SnapshotTimeline();
reset.push({...state(1000),mission_time:50},100);
reset.push({...state(1100),mission_time:1},200);
assert.equal(reset.samples.length,1); // Reset can occur between viewer polls.
console.log('Snapshot interpolation: interpolation, jitter, stale packets, outage, reset and fast time passed.');

// Public network cadence determines the interpolation buffer, without changing
// the underlying physical state or extrapolating beyond a received snapshot.
const publicStream=new SnapshotTimeline({delayMs:220,adaptive:true});
for(let i=0;i<8;i++){publicStream.push(state(10000+i*1000),i*1000);publicStream.sample(i*1000);}
assert.equal(publicStream.delayMs,1250);
let prior=publicStream.sample(7000).time;
for(let now=7016;now<7990;now+=16){const value=publicStream.sample(now);assert.ok(value.time>prior);assert.ok(value.time-prior<=16.001);prior=value.time;}
assert.ok(prior<17000);
