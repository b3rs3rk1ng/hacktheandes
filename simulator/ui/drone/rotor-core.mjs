// Shared SI model for propeller display, wash and sound. Geometry is Y-up.
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const approach=(v,target,dt,tau)=>target+(v-target)*Math.exp(-Math.max(0,dt)/tau);
export function rotorLayout(flight){
 const count=flight.rotors??4,r=flight.rotor_radius_m,arm=flight.rotor_arm_m??r*2.23;
 return Array.from({length:count},(_,i)=>{const a=(i+.5)*Math.PI*2/count;return {position:[Math.cos(a)*arm,.045,Math.sin(a)*arm],direction:i%2?-1:1};});
}
export class RotorState {
 constructor(flight){this.flight=flight;this.layout=rotorLayout(flight);this.reset();}
 reset(){this.rotors=this.layout.map(()=>({omega:0,angle:0,thrust:0}));this.totalThrust=0;this.induced=0;}
 update(dt,thrust,angularVelocity=[0,0,0]){
  if(!Number.isFinite(dt)||dt<0||!Number.isFinite(thrust))throw Error('Finite rotor timestep and thrust required');
  dt=Math.min(dt,.1);const f=this.flight,diameter=2*f.rotor_radius_m,ct=f.propeller_thrust_coefficient??.10,rho=f.air_density;
  const mean=clamp(thrust,0,f.max_thrust_n)/this.rotors.length;
  this.rotors.forEach((r,i)=>{const p=this.layout[i].position;
   // Aggregate physics has no individual ESC telemetry: differential RPM is an
   // explicitly bounded display approximation from actual angular velocity.
   const mix=clamp(angularVelocity[0]*p[2]*.035-angularVelocity[2]*p[0]*.035+angularVelocity[1]*this.layout[i].direction*.015,-.08,.08);
   const target=Math.sqrt(mean*(1+mix)/(ct*rho*diameter**4))*2*Math.PI;
   r.omega=approach(r.omega,target,dt,f.visual_motor_lag_s??.12);
   r.thrust=ct*rho*(r.omega/(2*Math.PI))**2*diameter**4;
   r.angle=(r.angle+this.layout[i].direction*r.omega*dt)%(2*Math.PI);
  });
  this.totalThrust=this.rotors.reduce((n,r)=>n+r.thrust,0);
  this.induced=Math.sqrt(this.totalThrust/(2*rho*this.rotors.length*Math.PI*f.rotor_radius_m**2));return this;
 }
}
export function groundWash(induced,height,rotorRadius){
 const h=Math.max(.05,height),radius=rotorRadius*2.4+h*.42;
 return {radius,speed:2*induced/(1+.38*h*h),emission:clamp((2.5-h)/2.1,0,1)*clamp(induced/5,0,1)};
}
// Reduced wake field: expanding jet below rotor, radial wall jet near ground.
// Used for tests/particles; the GPU foliage uses the same falloffs.
export function washVelocity(point,{origin,axis=[0,-1,0],induced,groundY=0,radius=.33}){
 const d=point.map((v,i)=>v-origin[i]),depth=d.reduce((n,v,i)=>n+v*axis[i],0);
 if(depth<-.12||induced<=0)return [0,0,0];
 const lateral=d.map((v,i)=>v-axis[i]*depth),r=Math.hypot(...lateral),spread=radius+Math.max(0,depth)*.28;
 const jet=2*induced*Math.exp(-r*r/(spread*spread))/(1+Math.max(0,depth)*.27);
 const g=groundWash(induced,origin[1]-groundY,radius/2),dx=point[0]-origin[0],dz=point[2]-origin[2],rad=Math.hypot(dx,dz);
 const wall=g.speed*Math.exp(-rad*rad/(g.radius*g.radius*2))*Math.exp(-Math.max(0,point[1]-groundY)/.55)*clamp(rad/.3,0,1);
 return [axis[0]*jet+dx/Math.max(rad,.01)*wall,axis[1]*jet,axis[2]*jet+dz/Math.max(rad,.01)*wall];
}
