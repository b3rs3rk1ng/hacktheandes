import RAPIER from './physics-vendor/rapier.mjs';
import {buildCourse,courseConfig,terrainHeight} from './terrain-course.mjs';
let ready;export async function initPhysics(){ready??=RAPIER.init();await ready;}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rotate(q,v){const tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);return{x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx}}
export function createRoverDynamics(spec,{course=buildCourse(),config=spec.dynamics}={}){
 const c=course.config??courseConfig,b=spec.base,p=config,com=p.center_y_m;
 const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=p.timestep_s;
 world.createCollider(RAPIER.ColliderDesc.trimesh(course.vertices,course.indices).setFriction(p.ground_friction));
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.startX,com+.08,0).setLinearDamping(.1).setAngularDamping(.6).setCanSleep(false));
 for(const shape of p.colliders){world.createCollider(RAPIER.ColliderDesc.cuboid(...shape.half_extents).setTranslation(shape.center[0],shape.center[1]-com,shape.center[2]).setMass(shape.mass_kg).setFriction(.55),body)}
 const vehicle=world.createVehicleController(body);vehicle.indexUpAxis=1;vehicle.setIndexForwardAxis=0;
 const wheelPositions=[];
 for(const x of [-b.wheelbase_m/2,b.wheelbase_m/2])for(const sign of [-1,1]){
  const i=wheelPositions.length;wheelPositions.push({x,z:sign*b.track_m/2});
  vehicle.addWheel({x,y:b.wheel_radius_m+p.suspension_rest_m-com,z:sign*b.track_m/2},{x:0,y:-1,z:0},{x:0,y:0,z:1},p.suspension_rest_m,b.wheel_radius_m);
  vehicle.setWheelSuspensionStiffness(i,p.spring_stiffness);vehicle.setWheelSuspensionCompression(i,p.compression_damping);vehicle.setWheelSuspensionRelaxation(i,p.rebound_damping);vehicle.setWheelMaxSuspensionTravel(i,p.suspension_travel_m);vehicle.setWheelMaxSuspensionForce(i,3000);vehicle.setWheelFrictionSlip(i,p.tire_friction_slip);vehicle.setWheelSideFrictionStiffness(i,1);
 }
 let elapsed=0,status='running',steering=0;
 function state(){const pos=body.translation(),velocity=body.linvel(),q=body.rotation(),f=rotate(q,{x:1,y:0,z:0}),up=rotate(q,{x:0,y:1,z:0}),off=rotate(q,{x:0,y:-com,z:0});return{position:[pos.x+off.x,pos.y+off.y,pos.z+off.z],rotation:[q.x,q.y,q.z,q.w],speed:velocity.x*f.x+velocity.y*f.y+velocity.z*f.z,pitch:Math.asin(clamp(f.y,-1,1)),roll:Math.atan2(-up.z,up.y),yaw:Math.atan2(-f.z,f.x),elapsed,status,mass:body.mass(),wheels:wheelPositions.map((_,i)=>({y:b.wheel_radius_m+p.suspension_rest_m-vehicle.wheelSuspensionLength(i),rotation:vehicle.wheelRotation(i),steering:vehicle.wheelSteering(i),compression:p.suspension_rest_m-vehicle.wheelSuspensionLength(i),contact:vehicle.wheelIsInContact(i),force:vehicle.wheelSuspensionForce(i)}))};}
 function step({drive=true,targetSpeed=p.cruise_speed_mps}={}){
  const s=state(),x=s.position[0],z=s.position[2];
  if(status==='running'&&(Math.abs(s.roll)>p.stop_tilt_rad||Math.abs(s.pitch)>p.stop_tilt_rad||Math.abs(z)>2||s.position[1]<-1))status='stopped';
  if(status==='running'&&x>=c.finishX)status='complete';
  const active=drive&&status==='running'&&elapsed>.8;
  const desired=active?targetSpeed*Math.min(1,Math.max(.2,(c.finishX-x)*1.8)):0;
  steering+=(clamp(z*.65-s.yaw*1.8,-.30,.30)-steering)*Math.min(1,p.timestep_s*5);
  const force=active?clamp((desired-s.speed)*p.speed_gain,-p.max_drive_force_n,p.max_drive_force_n):0;
  for(let i=0;i<4;i++){vehicle.setWheelSteering(i,wheelPositions[i].x>0?steering:0);vehicle.setWheelEngineForce(i,force);vehicle.setWheelBrake(i,active?0:p.brake_impulse);}
  vehicle.updateVehicle(p.timestep_s,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);world.step();elapsed+=p.timestep_s;return state();
 }
 function reset(){body.setTranslation({x:c.startX,y:com+terrainHeight(c.startX,0,c)+.08,z:0},true);body.setRotation({x:0,y:0,z:0,w:1},true);body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);elapsed=0;status='running';steering=0;return state()}
 return {world,body,vehicle,course,step,state,reset,dispose:()=>world.free()};
}
