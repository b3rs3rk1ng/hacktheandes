import {solveArm,smoothStep,mix} from '../robotics/arm-kinematics.mjs';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function buildHarvestPlan(spec,fruitLocal,initialAngles,{radius=.055,minimumSpan=.094,maximumSpan=.166,motionRate=1}={}){
 const arm=spec.arm,bin=spec.base.bin_center.map((v,i)=>v-spec.base.mount[i]);
 const solve=(point,pitches=[0,.35,-.35,.7,-.7,1.1,-1.1,-Math.PI/2,Math.PI/2])=>{for(const pitch of pitches){const s=solveArm(point,pitch,arm);if(s.reachable)return s.angles}throw Error('No hay pose alcanzable para completar la recogida')};
 const length=Math.hypot(...fruitLocal),direction=fruitLocal.map(v=>v/length),pre=fruitLocal.map((v,i)=>v-direction[i]*.20),retreat=fruitLocal.map((v,i)=>v-direction[i]*.30+(i===1?.06:0));
 const bearing=Math.atan2(fruitLocal[2],fruitLocal[0]),lift=[Math.cos(bearing)*.36,.72,Math.sin(bearing)*.36],above=bin.map((v,i)=>v+(i===1?.42:0)),lower=bin.map((v,i)=>v+(i===1?.12:0));
 const closed=clamp((radius*2-minimumSpan)/(maximumSpan-minimumSpan),0,.85),rows=[
  ['reaching',solve(pre),1,0,1.8],['aligning',solve(fruitLocal),1,0,1.5],['gripping',null,closed,0,1.2],
  ['cutting',null,closed,1,1.2],['withdrawing',solve(retreat),closed,0,2],['lifting',solve(lift),closed,0,2],
  ['carrying',solve(above,[-Math.PI/2,0,-.7,.7]),closed,0,3],['depositing',solve(lower,[-Math.PI/2,-.7,.7]),closed,0,2],
  ['releasing',null,1,0,1.4],['clearing',solve(above,[-Math.PI/2,0,-.7,.7]),1,0,2],['folding',arm.folded_rad,1,0,2.5]
 ];
 let previous={angles:initialAngles.slice(),opening:1,cut:0};
 return rows.map(([kind,angles,opening,cut,minimum])=>{angles=angles||previous.angles;const target={angles:angles.slice(),opening,cut},duration=Math.max(minimum,1.5*Math.max(...angles.map((v,i)=>Math.abs(v-previous.angles[i])))/.85),stage={kind,from:previous,target,duration:duration/motionRate};previous=target;return stage});
}
export function sampleHarvestStage(stage,time){const t=smoothStep(time/stage.duration);return {angles:mix(stage.from.angles,stage.target.angles,t),opening:stage.from.opening+(stage.target.opening-stage.from.opening)*t,cut:stage.from.cut+(stage.target.cut-stage.from.cut)*t}}
