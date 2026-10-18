import {initPhysics,createRoverDynamics} from '../robotics/rover-dynamics.mjs';
import RAPIER from '../robotics/physics-vendor/rapier.mjs';
import {heightAt,terrainMesh} from './terrain.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
export function pathProjection(point,path){let total=0,best={distance:Infinity,along:0};
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(!length)continue;const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(length*length),0,1),distance=Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dz);if(distance<best.distance)best={distance,along:total+t*length};total+=length}
 return {...best,total,progress:total?best.along/total:0};
}

// Adapter over the existing chassis, tire and suspension factory. The route
// controller applies wheel forces; only an explicit reset writes a body pose.
export async function createGroundDriver(spec,world){
 await initPhysics();const config=world.config.ground_vehicle,p=spec.dynamics,[east,north]=config.origin_enu,ground=heightAt(world.terrain,east,north);
 const surface=terrainMesh(world.terrain),vertices=new Float32Array(surface.positions.length);
 for(let i=0;i<vertices.length;i+=3){const [x,y,z]=surface.positions.slice(i,i+3);vertices.set([y-north,z-ground,x-east],i)}
 // ENU->(north,up,east) preserves the triangle orientation.
 const course={vertices,indices:new Uint32Array(surface.indices),config:{startX:0,finishX:config.route_local_xz.at(-1)[0]}};
 const dynamics=createRoverDynamics(spec,{course}),initial=config.route_local_xz[0];
 for(const plant of world.plants){if(plant.crop==='maize')continue;const [x,y,z]=plant.position;const h=plant.structure?.fork_height||plant.height*.6;dynamics.world.createCollider(RAPIER.ColliderDesc.cylinder(h/2,plant.structure?.radius||.09).setTranslation(y-north,z-ground+h/2,x-east))}
 let elapsed=0,status='idle',index=1,route=config.route_local_xz,steering=0,returning=false,soc=1,energy=0,power=config.idle_power_w,fast=false;
 let charging=false,auxiliaryPower=0,meanPower=config.idle_power_w;
 function state(){const s=dynamics.state();return {...s,elapsed,status,index,returning,soc,power,energy,fast,charging,estimated_hours:soc*config.battery_wh/Math.max(config.idle_power_w,meanPower),origin:[east,ground,-north],route,progress:pathProjection([s.position[0],s.position[2]],route).progress}}
 function reset(initialSoc=1){const y=heightAt(world.terrain,east+initial[1],north+initial[0])-ground;dynamics.body.setTranslation({x:initial[0],y:p.center_y_m+y+.08,z:initial[1]},true);dynamics.body.setRotation({x:0,y:0,z:0,w:1},true);dynamics.body.setLinvel({x:0,y:0,z:0},true);dynamics.body.setAngvel({x:0,y:0,z:0},true);elapsed=0;status='idle';index=1;route=config.route_local_xz;returning=false;soc=initialSoc;energy=0;steering=0;return state()}
 function start(){if(status==='complete')return;status='running';dynamics.body.wakeUp()}
 function home(){if(returning)return;const s=dynamics.state();route=[[s.position[0],s.position[2]],...route.slice(0,index).reverse()];index=1;returning=true;status='running';dynamics.body.wakeUp()}
 function step({enabled=true}={}){
  const s=dynamics.state(),[x,,z]=s.position,dt=p.timestep_s;
  if(Math.abs(s.pitch)>p.stop_tilt_rad||Math.abs(s.roll)>p.stop_tilt_rad)status='stopped';
  if(soc<.15&&!returning&&status==='running')home();
  const target=route[index],distance=target?Math.hypot(target[0]-x,target[1]-z):0;
  if(status==='running'&&distance<(index<route.length-1?.5:(world.config.fleet?.navigation_arrival_m||.25))){if(index<route.length-1)index++;else status=returning?'idle':'complete'}
  const active=enabled&&status==='running'&&elapsed>.8&&soc>0;
  let force=0;
  if(active){const target=route[index],a=route[index-1],vx=target[0]-a[0],vz=target[1]-a[1],length=Math.hypot(vx,vz),projection=((x-a[0])*vx+(z-a[1])*vz)/length,look=clamp(projection+1.5,0,length),dx=a[0]+vx/length*look-x,dz=a[1]+vz/length*look-z,targetYaw=Math.atan2(-dz,dx),reverse=Math.cos(angle(targetYaw-s.yaw))<0,sign=reverse?-1:1;
   const heading=targetYaw+(reverse?Math.PI:0),desiredSteer=clamp(angle(heading-s.yaw)*1.6*sign,-.45,.45);steering+=(desiredSteer-steering)*Math.min(1,dt*5);
   const speed=(reverse?config.reverse_speed_mps:config.cruise_speed_mps)*Math.min(1,Math.max(.2,distance*1.7));force=clamp((sign*speed-s.speed)*p.speed_gain+s.mass*9.81*Math.sin(s.pitch)/4,-p.max_drive_force_n,p.max_drive_force_n);
  }else steering*=Math.max(0,1-dt*5);
  for(let i=0;i<4;i++){dynamics.vehicle.setWheelSteering(i,i>=2?steering:0);dynamics.vehicle.setWheelEngineForce(i,force);dynamics.vehicle.setWheelBrake(i,active?0:config.holding_brake_impulse??p.brake_impulse*8)}
  // A parking brake resists tangential slip, bounded by Coulomb friction at
  // actual wheel contacts. This applies an impulse, never a pose/velocity reset.
  if(!active&&!dynamics.body.isSleeping()){const normal={x:0,y:0,z:0};let contacts=0;for(let i=0;i<4;i++){if(!s.wheels[i].contact)continue;const n=dynamics.vehicle.wheelContactNormal(i);if(n){normal.x+=n.x;normal.y+=n.y;normal.z+=n.z;contacts++}}
   if(contacts>=2){const length=Math.hypot(normal.x,normal.y,normal.z);for(const axis of ['x','y','z'])normal[axis]/=length;const v=dynamics.body.linvel(),vn=v.x*normal.x+v.y*normal.y+v.z*normal.z,gn=-9.81*normal.y,impulse={};for(const axis of ['x','y','z'])impulse[axis]=-s.mass*(v[axis]-vn*normal[axis]+((axis==='y'?-9.81:0)-gn*normal[axis])*dt);const magnitude=Math.hypot(impulse.x,impulse.y,impulse.z),limit=p.ground_friction*s.mass*9.81*normal.y*dt*contacts/4,scale=magnitude?Math.min(1,limit/magnitude):0;for(const axis of ['x','y','z'])impulse[axis]*=scale;dynamics.body.applyImpulse(impulse,true)}
  }
  if(active||!dynamics.body.isSleeping())dynamics.vehicle.updateVehicle(dt,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);dynamics.world.step();elapsed+=dt;
  // Let the rigid-body solver sleep a parked vehicle after actual ground
  // contact. This prevents accumulated numerical creep during long charging.
  if(!active&&s.wheels.filter(w=>w.contact).length>=3){const v=dynamics.body.linvel(),w=dynamics.body.angvel();if(Math.hypot(v.x,v.y,v.z)<.02&&Math.hypot(w.x,w.y,w.z)<.05)dynamics.body.sleep()}
  charging=['idle','complete'].includes(status)&&Math.hypot(x-initial[0],z-initial[1])<.3&&Math.abs(s.speed)<.04&&soc<1;
  power=charging?-(world.config.fleet?.charge_power_w||600)*Math.min(1,Math.max(.08,(1-soc)*12)):config.idle_power_w+auxiliaryPower+Math.abs(4*force*s.speed)/config.motor_efficiency;if(power>0)meanPower+=(power-meanPower)*Math.min(1,dt/15);const wh=power*dt/3600;energy+=Math.max(0,wh);soc=clamp(soc-wh/config.battery_wh,0,1);
  return state();
 }
 // Stable support clears the safety stop; it does not establish arrival.
 // Hold position until the caller resumes the route or supplies a new one.
 function recover(){const s=dynamics.state();if(status!=='stopped'||Math.abs(s.pitch)>p.stop_tilt_rad*.7||Math.abs(s.roll)>p.stop_tilt_rad*.7||s.wheels.filter(w=>w.contact).length<3||Math.abs(s.speed)>.05)return false;status='paused';dynamics.body.wakeUp();return true}
 function navigate(points,{home=false}={}){if(points.length<2||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw Error('Ruta terrestre inválida');route=points;index=1;returning=home;status='running';dynamics.body.wakeUp();return state()}
 function restore(saved){
  if(!saved||saved.origin?.some((v,i)=>Math.abs(v-[east,ground,-north][i])>.01))return false;
  if(![saved.position,saved.rotation].every(v=>Array.isArray(v)&&v.every(Number.isFinite))||saved.position.length!==3||saved.rotation.length!==4)return false;
  const [qx,qy,qz,qw]=saved.rotation,com=p.center_y_m;
  const surfaceY=heightAt(world.terrain,east+saved.position[2],north+saved.position[0])-ground;
  const frameY=!saved.wheels?.some(w=>w.contact)&&saved.position[1]<surfaceY-.25?surfaceY+.08:saved.position[1];
  dynamics.body.setTranslation({x:saved.position[0]+2*(qx*qy-qz*qw)*com,y:frameY+(1-2*(qx*qx+qz*qz))*com,z:saved.position[2]+2*(qy*qz+qx*qw)*com},true);
  dynamics.body.setRotation({x:saved.rotation[0],y:saved.rotation[1],z:saved.rotation[2],w:saved.rotation[3]},true);
  dynamics.body.setLinvel({x:0,y:0,z:0},true);dynamics.body.setAngvel({x:0,y:0,z:0},true);
  elapsed=saved.elapsed||0;soc=clamp(saved.soc??1,0,1);energy=saved.energy||0;status='complete';return true;
 }
 reset();return {dynamics,step,state,reset,restore,recover,start,home,navigate,setAuxiliaryPower(watts){auxiliaryPower=Math.max(0,watts)},setFast(value){fast=value},pause(){if(status==='running')status='paused'},resume(){if(status==='paused'){status='running';dynamics.body.wakeUp()}},dispose:()=>dynamics.dispose()};
}
