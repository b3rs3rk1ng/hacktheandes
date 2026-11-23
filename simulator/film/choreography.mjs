// Deterministic tracks sampled from collision-cleared navigation paths.
// Coordinates are ENU horizontal pairs, independent of a scene or robot identity.
export function pathTrack(points){
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),length=lengths.reduce((a,b)=>a+b,0);
 return {points,length,sample(progress){let distance=Math.max(0,Math.min(1,progress))*length,index=0;while(index<lengths.length-1&&distance>lengths[index])distance-=lengths[index++];const a=points[index],b=points[index+1],u=distance/(lengths[index]||1);return {point:a.map((v,i)=>v+(b[i]-v)*u),yaw:Math.atan2(b[1]-a[1],b[0]-a[0]),travel:Math.max(0,Math.min(1,progress))*length}}};
}
export function minimumSeparation(tracks,samples=1000){let minimum=Infinity;for(let step=0;step<=samples;step++){const p=tracks.map(t=>t.sample(step/samples).point);for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)minimum=Math.min(minimum,Math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1]))}return minimum}
// A released body follows gravity, then a damped contact bounce. No pose switch.
export function fallDistance(time,height,{gravity=3.5,restitution=.22}={}){const hit=Math.sqrt(2*height/gravity);if(time<=hit)return Math.min(height,.5*gravity*Math.max(0,time)**2);let t=time-hit,v=Math.sqrt(2*gravity*height)*restitution;for(let bounce=0;bounce<5;bounce++){const duration=2*v/gravity;if(t<=duration)return height-(v*t-.5*gravity*t*t);t-=duration;v*=restitution}return height}
// Continuous angular release, followed by a damped roll onto the body's side.
export function tumbleAngles(time,impactTime,{impactRoll=1.1,restRoll=Math.PI/2,damping=7,frequency=12}={}){
 const t=Math.max(0,time),speed=impactRoll/impactTime;
 if(t<=impactTime)return [.14*Math.sin(t/impactTime*Math.PI/2),.28*t,speed*t];
 const dt=t-impactTime,a=impactRoll-restRoll,b=(speed+damping*a)/frequency,decay=Math.exp(-damping*dt);
 return [.14*decay*(Math.cos(frequency*dt)+damping/frequency*Math.sin(frequency*dt)),.28*impactTime+.08*(1-Math.exp(-3*dt)),restRoll+decay*(a*Math.cos(frequency*dt)+b*Math.sin(frequency*dt))];
}
// Two held upper corners; hanging strips bend with delayed waves and free hems.
// Arc-length integration keeps each vertical strip at its original length.
export function clothPoint(u,v,time,{width,height,tilt=0,forwardAngle=.85,windAmplitude=.48}={}){
 const across=Math.sin(Math.PI*u),steps=12,ds=height*v/steps;
 let y=-.075*across,z=.045*across*Math.sin(time*2.4+u*5);
 for(let j=0;j<steps;j++){
  const depth=v*(j+.5)/steps;
  const wave=windAmplitude*(.22+.78*depth)*Math.sin(2*Math.PI*(1.15*u-.64*time)-depth*4.8);
  const folds=.17*depth*Math.sin(2*Math.PI*(2.6*u-1.15*time)-depth*7);
  const angle=forwardAngle+tilt*Math.cos(depth*.8)+wave+folds;
  y-=ds*Math.cos(angle);z+=ds*Math.sin(angle);
 }
 return [(u-.5)*width,y,z];
}
export function roundCorners(points,clear,radius=.35){
 const result=[points[0]];
 for(let i=1;i<points.length-1;i++){
  const a=points[i-1],b=points[i],c=points[i+1],ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]),r=Math.min(radius,ab*.3,bc*.3);
  const entry=b.map((v,j)=>v+(a[j]-v)*r/ab),exit=b.map((v,j)=>v+(c[j]-v)*r/bc),curve=Array.from({length:17},(_,j)=>{const t=j/16;return b.map((_,k)=>(1-t)**2*entry[k]+2*t*(1-t)*b[k]+t*t*exit[k])});
  const candidate=[result.at(-1),...curve,c];if(candidate.slice(1).every((p,j)=>clear(candidate[j],p)))result.push(...curve);else result.push(b);
 }
 return [...result,points.at(-1)];
}
