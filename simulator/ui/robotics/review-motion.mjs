import {solveArm,mix,smoothStep} from './arm-kinematics.mjs';

// Keyframes describe a design review, not robot control. All lengths and
// targets come from the same specification used to build the visible model.
export function buildReview(spec){
  let previous={time:0,base:[0,0,0],angles:spec.arm.folded_rad,opening:1,cut:0};
  const frames=spec.review.keyframes.map(frame=>{
    const current={...previous,...frame,base:frame.base||previous.base};
    if(frame.pose==='folded')current.angles=spec.arm.folded_rad.slice();
    if(frame.target){
      const target=spec.review.targets[frame.target].map((v,i)=>v-current.base[i]-spec.base.mount[i]);
      const solved=solveArm(target,frame.pitch||0,spec.arm);
      if(!solved.reachable)throw Error(`El objetivo ${frame.target} queda fuera del alcance propuesto`);
      current.angles=solved.angles;
    }
    if(frame.roll!==undefined){current.angles=current.angles.slice();current.angles[4]=frame.roll;}
    previous=current;return current;
  });
  if(frames.some((f,i)=>i&&f.time<=frames[i-1].time))throw Error('La secuencia debe avanzar en el tiempo');
  return {frames,duration:frames.at(-1).time};
}

export function sampleReview(time,plan){
  time=Math.max(0,Math.min(plan.duration,time));
  let left=plan.frames[0],right=plan.frames.at(-1);
  for(const frame of plan.frames){if(frame.time<=time)left=frame;else{right=frame;break;}}
  if(time===plan.duration)right=left;
  const t=right.time===left.time?0:smoothStep((time-left.time)/(right.time-left.time));
  return {time,base:mix(left.base,right.base,t),angles:mix(left.angles,right.angles,t),opening:left.opening+(right.opening-left.opening)*t,cut:left.cut+(right.cut-left.cut)*t};
}
