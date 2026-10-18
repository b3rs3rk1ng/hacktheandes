// Interpolate remote telemetry on its wall clock, independently of render FPS
// and simulation speed. Never invent a pose beyond the latest physics sample.
export class SnapshotTimeline {
  constructor({delayMs=220,maxGapMs=10000,maxSamples=64,adaptive=false}={}) {
    Object.assign(this,{delayMs,baseDelayMs:delayMs,maxGapMs,maxSamples,adaptive});this.clear();
  }
  clear() {this.samples=[];this.offsets=[];this.intervals=[];this.delayMs=this.baseDelayMs;this.playhead=-Infinity;this.lastSampleTime=null;}
  push(state,receivedAt) {
    const time=state.updated_at*1000,previous=this.samples.at(-1);
    if(!Number.isFinite(time)||!Number.isFinite(receivedAt))return false;
    if(previous&&time<=previous.time)return false;
    const reset=previous&&(state.simulation_time<previous.state.simulation_time||state.mission_time<previous.state.mission_time||
      (state.phase==='idle'&&previous.state.phase!=='idle')||receivedAt-previous.receivedAt>this.maxGapMs);
    if(reset)this.clear();
    if(this.adaptive&&this.samples.length){
      this.intervals.push(receivedAt-this.samples.at(-1).receivedAt);if(this.intervals.length>24)this.intervals.shift();
      const sorted=[...this.intervals].sort((a,b)=>a-b),cadence=sorted[Math.floor((sorted.length-1)*.85)];
      this.delayMs=Math.max(this.baseDelayMs,Math.min(3000,cadence*1.25),this.delayMs*.99);
    }
    this.samples.push({state,time,receivedAt});this.offsets.push(receivedAt-time);
    if(this.samples.length>this.maxSamples)this.samples.shift();
    if(this.offsets.length>this.maxSamples)this.offsets.shift();
    return true;
  }
  sample(now) {
    if(!this.samples.length)return null;
    const first=this.samples[0],last=this.samples.at(-1);
    const requested=now-Math.min(...this.offsets)-this.delayMs;
    const desired=Math.min(last.time,Math.max(first.time,this.playhead,requested));
    // A delayed packet must not fast-forward the playhead in a single frame.
    // After an underrun the resulting extra delay is retained, not caught up
    // with visible speed bursts. Reconnection/reset explicitly clears it.
    const elapsed=this.lastSampleTime===null?0:Math.max(0,now-this.lastSampleTime);
    this.playhead=Number.isFinite(this.playhead)?Math.max(first.time,Math.min(desired,this.playhead+elapsed*(this.adaptive&&desired-this.playhead>this.delayMs+500?1.1:1))):desired;
    this.lastSampleTime=now;
    let before=first,after=last;
    for(const sample of this.samples){if(sample.time<=this.playhead)before=sample;else{after=sample;break;}}
    if(before.time===last.time)after=last;
    const alpha=after.time===before.time?0:(this.playhead-before.time)/(after.time-before.time);
    return {from:before.state,to:after.state,alpha,time:this.playhead};
  }
}
