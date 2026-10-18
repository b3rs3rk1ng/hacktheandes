import * as THREE from 'three';
import {groundWash,clamp} from './rotor-core.mjs';
const uniformCode=`
uniform vec3 uRotorOrigin,uRotorAxis;
uniform float uRotorInduced,uRotorGround,uRotorRadius,uRotorTime;
vec3 rotorDisplacement(vec3 p,float flex){
 vec3 d=p-uRotorOrigin;float depth=dot(d,uRotorAxis);
 if(depth<-.12||uRotorInduced<.01)return vec3(0.);
 float spread=uRotorRadius+max(0.,depth)*.28;
 float radial=length(d-uRotorAxis*depth);
 float jet=2.*uRotorInduced*exp(-radial*radial/(spread*spread))/(1.+max(0.,depth)*.27);
 float height=max(.05,uRotorOrigin.y-uRotorGround);
 vec2 impact=uRotorOrigin.xz+uRotorAxis.xz*height/max(.3,-uRotorAxis.y);
 vec2 lateral=p.xz-impact;float r=length(lateral),width=uRotorRadius*1.2+height*.42;
 float wall=2.*uRotorInduced/(1.+.38*height*height)*exp(-r*r/(width*width*2.))*exp(-max(0.,p.y-uRotorGround)/.55)*smoothstep(0.,.3,r);
 vec3 velocity=uRotorAxis*jet+vec3(lateral.x,0.,lateral.y)/max(r,.01)*wall;
 float strength=min(1.,length(velocity)/5.);
 float flutter=sin(uRotorTime*23.+p.x*19.+p.z*13.)*.016+sin(uRotorTime*37.+p.z*31.)*.009;
 vec3 displacement=velocity*.016;
 if(p.y-uRotorGround<.16){displacement.y=abs(flutter)*strength;displacement.xz*=.4;}
 displacement+=vec3(flutter,flutter*.6,-flutter*.7)*strength;
 return displacement*flex;
}
`;
// Opt-in generic material adapter: preserves the terrain chat's existing wind,
// color and LOD hooks. World-space deflection works for all leaf scales/rotations.
export function createRotorWash(scene,{heightAt,rotorRadius,home,dustiness=.30,maxDust=640,maxLeaves=72}){
 const uniforms={uRotorOrigin:{value:new THREE.Vector3()},uRotorAxis:{value:new THREE.Vector3(0,-1,0)},uRotorInduced:{value:0},uRotorGround:{value:0},uRotorRadius:{value:rotorRadius*2},uRotorTime:{value:0}};
 const bound=new WeakSet();let boundCount=0;
 function bindVegetation(root){root.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material||bound.has(material)||!material.map||!(material.alphaTest>0))continue;
   bound.add(material);boundCount++;const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material),baseKey=cache();
   material.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=uniformCode+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
mat4 washFrame=modelMatrix;
#ifdef USE_INSTANCING
washFrame*=instanceMatrix;
#endif
vec3 washPoint=(washFrame*vec4(transformed,1.)).xyz;
vec3 washDelta=rotorDisplacement(washPoint,uv.y*uv.y);
transformed+=inverse(mat3(washFrame))*washDelta;
`);
   };material.customProgramCacheKey=()=>baseKey+'|local-rotor-wash-v2';material.needsUpdate=true;
  }});return boundCount;}
 const positions=new Float32Array(maxDust*3),ages=new Float32Array(maxDust),sizes=new Float32Array(maxDust),velocities=new Float32Array(maxDust*3),lives=new Float32Array(maxDust),opacities=new Float32Array(maxDust);
 ages.fill(-1);positions.fill(-1000);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('particleSize',new THREE.BufferAttribute(sizes,1));geometry.setAttribute('opacity',new THREE.BufferAttribute(opacities,1).setUsage(THREE.DynamicDrawUsage));
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelScale:{value:700}},vertexShader:'attribute float particleSize,opacity;varying float alpha;uniform float pixelScale;void main(){alpha=opacity;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(particleSize*pixelScale/max(.1,-mv.z),1.,100.);}',fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.)*(1.-smoothstep(.7,1.,r));if(a*alpha<.003)discard;gl_FragColor=vec4(.52,.43,.32,a*alpha);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 const dust=new THREE.Points(geometry,material);dust.name='Polvo local de hélices';dust.frustumCulled=false;dust.renderOrder=2;scene.add(dust);
 const leafGeometry=new THREE.PlaneGeometry(.07,.13,1,2),pa=leafGeometry.attributes.position;for(let i=0;i<pa.count;i++)pa.setZ(i,Math.sin((pa.getY(i)+.065)/.13*Math.PI)*.022);leafGeometry.computeVertexNormals();
 const leaves=new THREE.InstancedMesh(leafGeometry,new THREE.MeshStandardMaterial({color:0x715335,roughness:1,side:THREE.DoubleSide}),maxLeaves);leaves.name='Hojas secas levantadas por aire';leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);leaves.frustumCulled=false;leaves.castShadow=false;scene.add(leaves);
 const dryLeaves=Array.from({length:maxLeaves},()=>({age:-1,p:new THREE.Vector3(),v:new THREE.Vector3(),angle:0,spin:0,life:0})),temp=new THREE.Object3D();
 let randomSeed=1731;const random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296};
 let dustCursor=0,leafCursor=0,dustBudget=0,leafBudget=0,wasActive=false;
 const stats={dust:0,leaves:0,inducedMps:0,groundSpeedMps:0,heightM:0,vegetationMaterials:0};
 function clear(){ages.fill(-1);dryLeaves.forEach(p=>p.age=-1);dustBudget=leafBudget=0;}
 function update(dt,{origin,axis,induced,wind=[0,0,0],time=0,active=true,camera}){
  dt=Math.min(.05,Math.max(0,dt));if(!active&&wasActive)clear();wasActive=active;
  uniforms.uRotorOrigin.value.copy(origin);uniforms.uRotorAxis.value.copy(axis);uniforms.uRotorInduced.value=active?induced:0;uniforms.uRotorTime.value=time;
  const ground=heightAt(origin.x,origin.z),height=Math.max(.05,origin.y-ground),wash=groundWash(active?induced:0,height,rotorRadius);
  uniforms.uRotorGround.value=ground;const center=origin.clone().addScaledVector(axis,height/Math.max(.3,-axis.y));center.y=ground;
  const speed=wash.speed,emission=active?wash.emission:0;
  dustBudget+=dt*140*emission*dustiness;leafBudget+=dt*14*emission;
  function spawnPosition(){const a=random()*Math.PI*2,r=.22+random()*wash.radius*.70;return new THREE.Vector3(center.x+Math.cos(a)*r,0,center.z+Math.sin(a)*r);}
  while(dustBudget>=1){dustBudget--;const i=dustCursor++%maxDust,p=spawnPosition(),rad=p.clone().sub(center).setY(0).normalize();
   // Concrete pad stays clean: dust originates at its edge or in the soil.
   if(home&&Math.hypot(p.x-home.x,p.z-home.z)<1.27){p.x=center.x+rad.x*1.3;p.z=center.z+rad.z*1.3;}
   p.y=heightAt(p.x,p.z)+.015;const k=i*3;p.toArray(positions,k);const v=rad.multiplyScalar(speed*(.20+random()*.22));v.y=.20+random()*.55;v.toArray(velocities,k);ages[i]=0;lives[i]=1.3+random()*1.1;sizes[i]=.09+random()*.14;
  }
  while(leafBudget>=1){leafBudget--;const p=dryLeaves[leafCursor++%maxLeaves];p.p.copy(spawnPosition());if(home&&Math.hypot(p.p.x-home.x,p.p.z-home.z)<1.25)continue;
   p.p.y=heightAt(p.p.x,p.p.z)+.025;p.v.copy(p.p).sub(center).setY(0).normalize().multiplyScalar(speed*(.14+random()*.12));p.v.y=.4+random()*.7;p.age=0;p.life=1.4+random()*1.2;p.angle=random()*6.28;p.spin=(random()-.5)*18;
  }
  stats.dust=0;
  for(let i=0;i<maxDust;i++){const k=i*3;if(ages[i]<0){opacities[i]=0;continue;}ages[i]+=dt;const age=ages[i]/lives[i];if(age>=1){ages[i]=-1;opacities[i]=0;continue;}
   positions[k]+=velocities[k]*dt;positions[k+1]+=velocities[k+1]*dt;positions[k+2]+=velocities[k+2]*dt;
   velocities[k]+=(wind[0]-velocities[k])*.65*dt;velocities[k+2]+=(wind[2]-velocities[k+2])*.65*dt;velocities[k+1]-=.15*dt;
   const floor=heightAt(positions[k],positions[k+2])+.02;if(positions[k+1]<floor)positions[k+1]=floor;
   opacities[i]=.13*Math.sin(Math.PI*age)*Math.min(1,ages[i]*5);stats.dust++;
  }
  geometry.attributes.position.needsUpdate=true;geometry.attributes.opacity.needsUpdate=true;
  // Per-camera drawing resolution accounts for FPV and observer distances.
  if(camera)material.uniforms.pixelScale.value=innerHeight/2/Math.tan(camera.fov*Math.PI/360);
  let n=0;for(const p of dryLeaves){if(p.age<0)continue;p.age+=dt;if(p.age>p.life){p.age=-1;continue;}p.v.y-=1.5*dt;p.v.x+=(wind[0]-p.v.x)*dt;p.v.z+=(wind[2]-p.v.z)*dt;p.p.addScaledVector(p.v,dt);const floor=heightAt(p.p.x,p.p.z)+.025;if(p.p.y<floor){p.p.y=floor;p.v.y=Math.abs(p.v.y)*.12;p.v.multiplyScalar(.90);}
   temp.position.copy(p.p);temp.rotation.set(p.angle+p.age*p.spin,p.angle+p.age*3,p.age*p.spin*.5);temp.scale.setScalar(Math.min(1,(p.life-p.age)*3));temp.updateMatrix();leaves.setMatrixAt(n++,temp.matrix);
  }leaves.count=n;leaves.instanceMatrix.needsUpdate=true;stats.leaves=n;stats.inducedMps=active?induced:0;stats.groundSpeedMps=speed;stats.heightM=height;stats.vegetationMaterials=boundCount;
  dust.visible=active;leaves.visible=active;
 }
 return {bindVegetation,update,stats,clear,uniforms,dust,leaves};
}
