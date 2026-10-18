import {keepAudioEnabled} from '/orchard/audio-lifecycle.js';
import {openSession} from '/orchard/session.js';
import {createLiveActivity} from '/orchard/live-activity.js';
const session=await openSession();
import {createMountedCameraRig} from '/ui/drone/camera-rig.js';
import {createDroneExperience} from '/ui/drone/experience.js';
import * as THREE from 'three';
import {Sky} from '/vendor/Sky.js';
import {SnapshotTimeline} from '/orchard/motion.mjs';
import {createEnvironment} from '/orchard/environment.js';
import {heightAt} from '/orchard/terrain.mjs';
import {instancedCells} from '/orchard/instanced-cells.mjs';
import {createGroundSession} from '/orchard/ground-session.js';
import {createObserverView} from '/orchard/observer-view.js';
import {drawPersonalMap} from '/orchard/personal-map.js';
import {createGroundAudio} from '/orchard/ground-audio.js';
import {setupModelDetails} from '/orchard/model-details.js';
import {setupReviewInbox} from '/orchard/review-inbox.js';

const $=id=>document.getElementById(id), canvas=$('world'), overlay=$('boxes');
const world=await fetch('/api/world').then(r=>r.json());
if(!world.plants?.length)throw Error('No se pudo cargar la distribución de la chacra');
const cfg=world.config, home=cfg.field.home, byPlant=new Map(world.plants.map(p=>[p.id,p]));
const podById=new Map(world.pods.map(p=>[p.id,p]));
const to3=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
const drawingRatio=()=>Math.min(devicePixelRatio,cfg.rendering?.maximum_pixel_ratio||1.25,Math.sqrt((cfg.rendering?.maximum_drawing_pixels||2000000)/(innerWidth*innerHeight)));renderer.setPixelRatio(drawingRatio());renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
renderer.info.autoReset=false;
function prepareScene(camera){for(const vehicle of groundSession.vehicles)vehicle.prepareView(camera)}
const observerView=createObserverView(renderer,{prepareScene,fps:cfg.rendering?.observer_fps||30,maxPixels:cfg.rendering?.observer_max_pixels||180000});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
const scene=new THREE.Scene();const fog=cfg.rendering?.fog||{};scene.fog=new THREE.Fog(fog.color||'#a5b2a0',fog.near_m||12,fog.far_m||44);
const fpv=new THREE.PerspectiveCamera(cfg.camera.vertical_fov_degrees,1,.05,600);
const chase=new THREE.PerspectiveCamera(53,1,.1,600);
const sun=new THREE.DirectionalLight(0xfff0d2,3.0);sun.position.set(-24,42,18);sun.castShadow=true;
const shadowSize=cfg.rendering?.shadow_map_size||1024;sun.shadow.mapSize.set(shadowSize,shadowSize);Object.assign(sun.shadow.camera,{left:-17,right:17,top:17,bottom:-17,near:.5,far:100});sun.shadow.bias=-.00035;sun.shadow.normalBias=.018;
sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target,new THREE.HemisphereLight(0xc9deea,0x716547,2.3));
const sky=new Sky();sky.scale.setScalar(450000);scene.add(sky);
Object.assign(sky.material.uniforms.turbidity,{value:4.5});sky.material.uniforms.rayleigh.value=1.5;sky.material.uniforms.mieCoefficient.value=.004;sky.material.uniforms.mieDirectionalG.value=.82;sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();

const textureLoader=new THREE.TextureLoader();
async function tex(path,repeat=1,color=true){const t=await textureLoader.loadAsync(path);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if(color)t.colorSpace=THREE.SRGBColorSpace;return t}
$('loadingText').textContent='Preparando corteza, hojas y mazorcas…';
const [barkMap,barkNormal,groundMap,groundNormal]=await Promise.all([tex('/assets/bark-color.jpg'),tex('/assets/bark-normal.jpg',1,false),tex('/assets/leaf-litter-color.jpg'),tex('/assets/leaf-litter-normal.jpg',1,false)]);
const bark=new THREE.MeshStandardMaterial({map:barkMap,normalMap:barkNormal,normalScale:new THREE.Vector2(.55,.55),roughness:.96,color:0xb7b3a1});


function leafGeometry(rows=7,cols=4){const p=[],uv=[],indices=[];for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=i/cols,v=j/rows;p.push((u-.5)*.25,(v-.5)*.48,Math.sin(v*Math.PI)*.067+(u-.5)**2*.12);uv.push(u,v)}for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i;indices.push(a,a+1,a+cols+1,a+1,a+cols+2,a+cols+1)}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g}
const leafMap=await tex('/assets/cacao-leaf.png'), leafGeo=leafGeometry();
const leafMat=new THREE.MeshStandardMaterial({map:leafMap,alphaTest:.5,roughness:.72,side:THREE.DoubleSide,color:0xffffff,bumpMap:leafMap,bumpScale:.0015});
let leafShader;
leafMat.onBeforeCompile=s=>{s.uniforms.uWind={value:0};s.vertexShader='uniform float uWind;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.z += sin(uWind*1.5+instanceMatrix[3].x*.2+instanceMatrix[3].z*.3)*.018*uv.y;\n#endif');leafShader=s};
const cylinder=new THREE.CylinderGeometry(.09,.15,1,9,4), unitCylinder=new THREE.CylinderGeometry(1,1,1,8);
const temp=new THREE.Object3D(), color=new THREE.Color(), Y=new THREE.Vector3(0,1,0);
function instance(geometry,material,count){const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);return mesh}
function write(mesh,index,position,scale=[1,1,1],rotation=null,tint=null){temp.position.copy(position);temp.scale.set(...scale);if(rotation instanceof THREE.Quaternion)temp.quaternion.copy(rotation);else temp.rotation.set(...(rotation||[0,0,0]));temp.updateMatrix();mesh.setMatrixAt(index,temp.matrix);if(tint)mesh.setColorAt(index,tint)}
function segment(mesh,index,a,b,r1){const delta=b.clone().sub(a),q=new THREE.Quaternion().setFromUnitVectors(Y,delta.clone().normalize());write(mesh,index,a.clone().add(b).multiplyScalar(.5),[r1,delta.length(),r1],q)}
const woody=world.plants.filter(p=>p.crop!=='maize');
const environment=createEnvironment(scene,world,{barkMap,barkNormal,groundMap,groundNormal,leafMap},renderer);
const maizePlants=world.plants.filter(p=>p.crop==='maize'),cropRecords=[];
for(const p of maizePlants){const r=rng(p.seed),base=to3(p.position);for(let i=0;i<6;i++){temp.position.copy(base).add(new THREE.Vector3(Math.sin(i*2.4)*.15,.45+i*.14,Math.cos(i*2.4)*.15));temp.scale.set(.55,1.4,.8);temp.rotation.set(.4,i*2.4,.45);temp.updateMatrix();cropRecords.push({position:temp.position.clone(),matrix:temp.matrix.clone(),color:new THREE.Color().setHSL(.2,.34,.47)})}}
instancedCells(scene,cropRecords,leafMat,[{geometry:leafGeo,distance:0},{geometry:leafGeometry(2,1),distance:30}],cfg.vegetation?.cell_size_m||20);

function makePodGeometry(widthSegments,heightSegments){const geometry=new THREE.SphereGeometry(1,widthSegments,heightSegments),pa=geometry.attributes.position;
 for(let i=0;i<pa.count;i++){const x=pa.getX(i),y=pa.getY(i),z=pa.getZ(i),a=Math.atan2(z,x),r=1+.14*Math.cos(a*10)+.012*Math.sin(y*48+a*7);pa.setXYZ(i,x*cfg.manipulation.fruit_radii_m[0]*r,y*cfg.manipulation.fruit_radii_m[2]*(1+.05*y),z*cfg.manipulation.fruit_radii_m[1]*r)}geometry.computeVertexNormals();return geometry;
}
const podLods=cfg.rendering?.pod_lods||[{id:'near',distance_m:4,width_segments:28,height_segments:22,shadow:true},{id:'middle',distance_m:9,width_segments:20,height_segments:12,shadow:false},{id:'far',distance_m:18,width_segments:10,height_segments:7,shadow:false}];
const podGeometries=new Map(podLods.map(lod=>[lod.id,makePodGeometry(lod.width_segments,lod.height_segments)]));
const podMeshes=[],podGroups=new Map(),podMaterials=new Map(),stems=instance(unitCylinder,bark,4000);stems.count=0;
const podCellSize=12,podCellCounts=new Map();
for(const p of world.pods){const key=`${Math.floor(p.position[0]/podCellSize)},${Math.floor(p.position[1]/podCellSize)}`;podCellCounts.set(key,(podCellCounts.get(key)||0)+1)}
function podGroup(p,lod,effective){const cell=`${Math.floor(effective[0]/podCellSize)},${Math.floor(effective[1]/podCellSize)}`,key=`${p.label}:${p.variant}:${lod.id}:${cell}`;let group=podGroups.get(key);if(!group){const mesh=instance(podGeometries.get(lod.id),podMaterials.get(`${p.label}:${p.variant}`),(podCellCounts.get(cell)||0)+cfg.fleet.robots.length+16);mesh.count=0;mesh.castShadow=lod.shadow;mesh.frustumCulled=true;group={key,label:p.label,variant:p.variant,detail:lod.id,mesh,ids:[]};podMeshes.push(group);podGroups.set(key,group)}return group}

for(const label of cfg.model.names)for(let v=0;v<4;v++){
 const texture=await tex(`/assets/pods/${label}-${v}.jpg`),material=new THREE.MeshStandardMaterial({map:texture,bumpMap:texture,bumpScale:.0015,roughness:.81,color:0xf0ebd8});
 if(label==='healthy')material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat podLuma=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=mix(vec3(.35+podLuma*1.3),diffuseColor.rgb,.10);');};
 podMaterials.set(`${label}:${v}`,material);
}
const nearCenter=new THREE.Vector3(1e8,0,1e8);let nearPods=[],detailCentersKey='',detailRemovedKey='';
function combinedPayloads(){return {...(renderState?.payloads||{}),...groundSession.fleet.payloads()}}
function combinedRemoved(){return new Set([...(renderState?.removed||[]),...groundSession.fleet.data.removed])}
function updateDetail(position,force=false){
 const centers=[position,...groundSession.fleet.verificationSources().map(s=>s.position),drone.position],key=centers.map(p=>`${Math.floor(p.x/2)},${Math.floor(p.z/2)}`).join('|');
 const removedKey=[...combinedRemoved()].join('|');if(!force&&detailCentersKey===key&&detailRemovedKey===removedKey)return;detailCentersKey=key;detailRemovedKey=removedKey;nearCenter.copy(position);environment.updateDetail(position,true,centers.slice(1));
 const range=podLods.at(-1).distance_m,removed=combinedRemoved(),payloads=combinedPayloads();nearPods=[];let si=0;
 for(const group of podMeshes)group.ids=[];
 for(const p of world.pods){const moving=payloads[p.id],effective=moving?.position||p.position,d2=Math.min(...centers.map(c=>(effective[0]-c.x)**2+(effective[2]-c.y)**2+(effective[1]+c.z)**2));if(d2>=range*range&&!moving)continue;
  nearPods.push(p);if(removed.has(p.id)&&!moving)continue;
  if(!moving&&d2<=(cfg.rendering?.stem_distance_m||7)**2){const start=to3(p.position).add(new THREE.Vector3(0,(p.radii_m?.[2]||cfg.manipulation.fruit_radii_m[2])*.97,0)),end=p.stem?to3(p.stem):to3(byPlant.get(p.plant_id).position).setY(start.y);segment(stems,si++,start,end,.004)}
  const lod=podLods.find(l=>d2<l.distance_m*l.distance_m)||podLods.at(-1),group=podGroup(p,lod,effective),n=group.ids.length;group.ids.push(p.id);
  const scale=p.scale||1;write(group.mesh,n,to3(effective),[scale,scale,scale],moving?.orientation?bodyQuaternion(moving.orientation):[0,p.angle,0],color.set(p.label==='healthy'?(p.color||'#8d6a37'):'#ffffff'));
 }
 stems.count=si;stems.instanceMatrix.needsUpdate=true;stems.computeBoundingSphere();stems.frustumCulled=true;
 for(let i=podMeshes.length-1;i>=0;i--){const group=podMeshes[i];if(!group.ids.length){scene.remove(group.mesh);group.mesh.dispose();podGroups.delete(group.key);podMeshes.splice(i,1);continue}group.mesh.count=group.ids.length;group.mesh.instanceMatrix.needsUpdate=true;if(group.mesh.instanceColor)group.mesh.instanceColor.needsUpdate=true;group.mesh.computeBoundingSphere();group.mesh.boundingSphere.radius+=2}
}

const base=new THREE.Group();base.position.copy(to3(home)).setY(0);scene.add(base);
function mesh(geometry,material,position,parent=scene){const m=new THREE.Mesh(geometry,material);m.position.set(...position);m.castShadow=m.receiveShadow=true;parent.add(m);return m}
const concrete=new THREE.MeshStandardMaterial({color:0x899184,roughness:.95}), metal=new THREE.MeshStandardMaterial({color:0x28372f,roughness:.48,metalness:.5}),ivory=new THREE.MeshStandardMaterial({color:0xdbe0cb,roughness:.7});
mesh(new THREE.CylinderGeometry(1.23,1.28,.08,64),concrete,[0,.04,0],base);
const padRing=mesh(new THREE.TorusGeometry(.98,.025,6,80),ivory,[0,.086,0],base);padRing.rotation.x=-Math.PI/2;
for(const x of [-.25,.25])mesh(new THREE.BoxGeometry(.075,.006,.65),ivory,[x,.085,0],base);mesh(new THREE.BoxGeometry(.48,.006,.075),ivory,[0,.085,0],base);
const bin=new THREE.Group();bin.position.copy(to3(cfg.manipulation.bin));scene.add(bin);const bs=cfg.manipulation.bin_size;
mesh(new THREE.BoxGeometry(bs[0],.08,bs[1]),metal,[0,.04,0],bin);
for(const sign of [-1,1]){mesh(new THREE.BoxGeometry(.045,bs[2],bs[1]),metal,[sign*bs[0]/2,bs[2]/2,0],bin);mesh(new THREE.BoxGeometry(bs[0],bs[2],.045),metal,[0,bs[2]/2,sign*bs[1]/2],bin)}
mesh(new THREE.BoxGeometry(.15,1.0,.18),metal,[-1.4,.5,.3],base);const chargerLamp=mesh(new THREE.BoxGeometry(.09,.1,.02),new THREE.MeshStandardMaterial({color:0xaed78c,emissive:0x759c53,emissiveIntensity:.8}),[-1.4,.82,.4],base);
const solar=mesh(new THREE.BoxGeometry(2.1,.07,1.2),new THREE.MeshStandardMaterial({color:0x233e4c,metalness:.25,roughness:.35}),[-2.3,1.8,-1],base);solar.rotation.z=.18;
for(const x of [-3,-1.5])mesh(new THREE.CylinderGeometry(.035,.035,1.8,8),metal,[x,.9,-1],base);

const stationLamps=new Map();
for(const robot of cfg.fleet.robots){const [east,north]=robot.station_enu,station=new THREE.Group();station.position.set(east,heightAt(world.terrain,east,north),-north);scene.add(station);
 const pad=mesh(new THREE.PlaneGeometry(1.45,1.75),new THREE.MeshStandardMaterial({color:0x526455,roughness:.95}),[0,.006,0],station);pad.rotation.x=-Math.PI/2;
 for(const sign of [-1,1])mesh(new THREE.BoxGeometry(.035,.008,1.5),ivory,[sign*.64,.014,0],station);
 mesh(new THREE.BoxGeometry(.16,.8,.14),metal,[.88,.4,.72],station);const lamp=mesh(new THREE.BoxGeometry(.10,.035,.02),new THREE.MeshStandardMaterial({color:0xb9d995,emissive:0x8dbd65,emissiveIntensity:.2}),[.88,.73,.8],station);stationLamps.set(robot.id,lamp);
 const label=document.createElement('canvas');label.width=256;label.height=80;const ctx=label.getContext('2d');ctx.fillStyle='#182d22';ctx.fillRect(0,0,256,80);ctx.fillStyle='#e6edcf';ctx.font='24px sans-serif';ctx.fillText(robot.label+' · Carga',12,48);mesh(new THREE.PlaneGeometry(.72,.225),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(label),side:THREE.DoubleSide}),[.65,.95,.71],station);
}
const droneExperience=createDroneExperience({scene,cfg,heightAt:(x,z)=>heightAt(world.terrain,x,-z),home:to3(home)});
const drone=droneExperience.drone,fingers=droneExperience.fingers;
const droneCameraRig=createMountedCameraRig(fpv,drone,to3(cfg.camera.offset_m),cfg.camera.gimbal);
droneExperience.bindVegetation(scene);
if(cfg.flight.inspection_only){const option=$('harvest').closest('label');option.hidden=true;const explanation=option.nextElementSibling;if(explanation?.tagName==='P')explanation.textContent='El dron inspecciona y registra alertas. Esta variante no lleva herramienta de retirada ni pulverizador.';}

const groundSession=await createGroundSession({scene,world,session,droneCommand,onChange:()=>{droneExperience.setActive(true);latest=null;nearCenter.set(1e8,0,1e8);groundSession.captions(mainView)}});
droneExperience.setActive(true);
const groundAudio=createGroundAudio(droneExperience.audio,groundSession.vehicles),activity=createLiveActivity($('activityRows'));
$('droneSound')?.remove();if(!session.authority)keepAudioEnabled(droneExperience.audio,$('audioHint'));
const source=()=>groundSession.active()?groundSession.source:{id:'drone',camera:fpv,follow:chase,position:drone.position,simulation_time:renderState?.simulation_time,phase_id:renderState?.phase_id,visionEnabled:!['idle','charging','failed','scout_hold'].includes(renderState?.phase)};

const timeline=new SnapshotTimeline({delayMs:220,adaptive:session.readonly});
let renderState=null,cameraReady=false,lastAnimationTime=null,chaseChoice=0,lastShadowUpdate=-Infinity,lastRemoved='';
let sharedVision=null,autoStarted=false;
let state=null,lastReceive=0,mainView='fpv',latest=null,busy=false,lastInfer=0,inferError='',frames=0,fps=0,lastFps=performance.now(),renderCount=0,lastMap=0;
let width=innerWidth,height=innerHeight,mainAspect=width/height,lastChaseUpdate=0;const chaseGoal=new THREE.Vector3(0,2,10);
const capture=document.createElement('canvas'),captureContext=capture.getContext('2d'),boxContext=overlay.getContext('2d');
const worldMatrix=new THREE.Matrix4(), cameraTarget=new THREE.Quaternion();
const mix3=(a,b,t)=>a.map((v,i)=>THREE.MathUtils.lerp(v,b[i],t));
function bodyQuaternion(r){worldMatrix.set(r[0],r[2],-r[1],0,r[6],r[8],-r[7],0,-r[3],-r[5],r[4],0,0,0,0,1);return new THREE.Quaternion().setFromRotationMatrix(worldMatrix)}
let observerBounds;const observerRect=()=>observerBounds||$('observer').getBoundingClientRect();
function resize(){observerBounds=$('observer').getBoundingClientRect();width=innerWidth;height=innerHeight;mainAspect=width/height;renderer.setPixelRatio(drawingRatio());renderer.setSize(width,height);overlay.width=width*devicePixelRatio;overlay.height=height*devicePixelRatio;boxContext.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);fpv.aspect=mainAspect;fpv.updateProjectionMatrix();const rect=observerRect();chase.aspect=mainView==='chase'?mainAspect:rect.width/rect.height;chase.updateProjectionMatrix();capture.width=Math.min(640,Math.round(768*mainAspect));capture.height=Math.round(capture.width/mainAspect)}
addEventListener('resize',resize);resize();
function renderFull(camera){prepareScene(camera);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();renderer.render(scene,camera)}
function updateDrone(deltaSeconds){const sample=timeline.sample(performance.now());if(!sample)return;
 const {from,to,alpha}=sample;renderState={...from,position:mix3(from.position,to.position,alpha),look_at:mix3(from.look_at,to.look_at,alpha),simulation_time:THREE.MathUtils.lerp(from.simulation_time,to.simulation_time,alpha),thrust_n:THREE.MathUtils.lerp(from.thrust_n||0,to.thrust_n||0,alpha),velocity:mix3(from.velocity,to.velocity,alpha),payloads:{...from.payloads}};
 for(const [id,payload] of Object.entries(from.payloads))if(to.payloads[id])renderState.payloads[id]={...payload,position:mix3(payload.position,to.payloads[id].position,alpha)};
 drone.position.copy(to3(renderState.position));drone.quaternion.copy(bodyQuaternion(from.orientation)).slerp(bodyQuaternion(to.orientation),alpha);drone.updateMatrixWorld();
 if(!cameraReady){droneCameraRig.reset();cameraReady=true;}
 const cameraAim=['idle','charging'].includes(renderState.phase)?new THREE.Vector3(4,0,0).applyQuaternion(drone.quaternion).add(drone.position):to3(renderState.look_at);
 droneCameraRig.update(deltaSeconds,cameraAim);
 const forward=new THREE.Vector3(1,0,0).applyQuaternion(drone.quaternion),yaw=Math.atan2(-forward.z,forward.x);
 if(performance.now()-lastChaseUpdate>250){lastChaseUpdate=performance.now();const nearby=woody.filter(p=>Math.hypot(p.position[0]-renderState.position[0],p.position[1]-renderState.position[1])<9),options=[];
  for(let j=0;j<8;j++){const a=yaw+Math.PI+j*Math.PI/4,point=drone.position.clone().add(new THREE.Vector3(Math.cos(a)*2.6,0,-Math.sin(a)*2.6));point.y=drone.position.y<3?Math.min(1.9,drone.position.y+.65):drone.position.y+1.6;let cost=Math.min(j,8-j)*.08;for(const p of nearby){const tree=to3(p.position),d=Math.hypot(point.x-tree.x,point.z-tree.z);cost+=Math.max(0,1.65-d)**2*8;const vx=drone.position.x-point.x,vz=drone.position.z-point.z,t=THREE.MathUtils.clamp(((tree.x-point.x)*vx+(tree.z-point.z)*vz)/(vx*vx+vz*vz),0,1),hit=Math.hypot(point.x+t*vx-tree.x,point.z+t*vz-tree.z);if(hit<.32&&Math.min(point.y,drone.position.y)<p.height*.7)cost+=15;}options.push({point,cost})}
  const best=options.reduce((a,b)=>a.cost<b.cost?a:b);if(best.cost+.8<options[chaseChoice].cost)chaseChoice=options.indexOf(best);chaseGoal.copy(options[chaseChoice].point);
 }
 chase.position.lerp(chaseGoal,1-Math.exp(-4*deltaSeconds));chase.lookAt(drone.position.clone().add(new THREE.Vector3(0,.10,0)));chase.updateMatrixWorld();

 const payloads=combinedPayloads(),removed=combinedRemoved(),removedKey=[...removed].join('|');if(Object.keys(payloads).length||removedKey!==lastRemoved){lastRemoved=removedKey; for(const group of podMeshes){for(let i=0;i<group.ids.length;i++){const pid=group.ids[i],moving=payloads[pid];if(moving){const pod=podById.get(pid),scale=pod.scale||1;write(group.mesh,i,to3(moving.position),[scale,scale,scale],moving.orientation?bodyQuaternion(moving.orientation):[0,pod.angle,0]);}else if(removed.has(pid))write(group.mesh,i,new THREE.Vector3(0,-100,0),[0,0,0])}group.mesh.instanceMatrix.needsUpdate=true}}

 sun.position.copy(drone.position).add(new THREE.Vector3(-24,42,18));sun.target.position.copy(drone.position).setY(0);sun.target.updateMatrixWorld();chargerLamp.material.emissiveIntensity=state.phase==='charging'?1.1:.2;
 for(const [i,finger] of fingers.entries())finger.position.z=THREE.MathUtils.lerp(finger.position.z,(i===0?-1:1)*(renderState.gripper_locked?.045:.10),1-Math.exp(-14*deltaSeconds));
}
async function requestVision(sensor){if(session.readonly||!sensor||busy||!renderState||performance.now()-lastInfer<cfg.camera.inference_interval_ms)return;busy=true;lastInfer=performance.now();
 // Copy RGB before drawing the observer or any HTML/HUD overlay.
 captureContext.drawImage(canvas,0,0,canvas.width,canvas.height,0,0,capture.width,capture.height);
 const capturedCamera=sensor.camera.clone();capturedCamera.updateMatrixWorld();
 const cameraPose={position:capturedCamera.position.toArray(),quaternion:capturedCamera.quaternion.toArray(),vertical_fov_degrees:capturedCamera.fov,aspect:capturedCamera.aspect};
 const frameId=crypto.randomUUID(),simTime=sensor.simulation_time,phaseId=sensor.phase_id,pose=sensor.position.clone();
 try{const blob=await new Promise(resolve=>capture.toBlob(resolve,'image/jpeg',.91));const response=await fetch('/api/infer',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'image/jpeg','X-Frame-Id':frameId,'X-Sim-Time':String(simTime),'X-Phase-Id':String(phaseId),'X-Vehicle-Id':sensor.id,'X-Task-Id':sensor.task_id||'','X-Camera-Pose':JSON.stringify(cameraPose)},body:blob});const result=await response.json();if(!response.ok)throw Error(result.error||'Inferencia no disponible');latest={...result,vehicle:sensor.id,received:performance.now(),pose,camera:capturedCamera};frames++;inferError='';
  const associations=result.localization?.associations||[];
  await fetch('/api/observe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({frame_id:frameId,associations})});
 }catch(error){inferError=error.message}finally{busy=false}
}
function drawBoxes(){boxContext.clearRect(0,0,width,height);if(!latest||latest.vehicle!==source().id||mainView!=='fpv'||performance.now()-latest.received>1200||source().position.distanceTo(latest.pose)>.16)return;const angle=source().camera.quaternion.angleTo(latest.camera.quaternion);if(angle>.09)return;
 for(const p of latest.predictions){if(p.confidence<cfg.inspection.alert_threshold)continue;const [x1,y1,x2,y2]=p.bbox.map((v,i)=>v*(i%2?height/latest.height:width/latest.width)),localized=latest.localization?.associations?.some(a=>a.prediction_index===latest.predictions.indexOf(p)),text=localized?`${cfg.model.class_labels[p.class_id]} ${Math.round(p.confidence*100)}%`:'Detección sin fruto localizado';boxContext.strokeStyle=p.class_id===0?'#c2d3a1':'#efbb68';boxContext.lineWidth=1.5;boxContext.strokeRect(x1,y1,x2-x1,y2-y1);boxContext.font='12px "Avenir Next",sans-serif';const tw=boxContext.measureText(text).width;boxContext.fillStyle='#18291ee8';boxContext.fillRect(x1,y1-24,tw+16,23);boxContext.fillStyle=p.class_id===0?'#d9e5c8':'#efc581';boxContext.fillText(text,x1+8,y1-8)}
}
function drawMap(){const sensor=source();drawPersonalMap($('map'),{world,sensor,contexts:groundSession.fleet.contexts,fleet:groundSession.fleet.data,drone:state});const v=groundSession.active()?groundSession.vehicle.label:'Dron';$('mapTitle').textContent='Mapa · '+v;$('hectares').textContent='Vista local';const c=groundSession.fleet.contexts.find(c=>c.vehicle.id===sensor.id);$('mapMission').textContent=c?.task?'Objetivo: '+c.task.pod_id:c?'Ruta y estación propias':'Alertas detectadas · posición del dron';}

function clock(t){t=Math.max(0,Math.floor(t));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`}
function updateUI(data){if(data.fleet)groundSession.receive?.(data.fleet);if(data.last_inference)sharedVision=data.last_inference;state=data.physics;if(!state?.position)return;lastReceive=performance.now();const previous=timeline.samples.at(-1)?.state;if(previous&&(state.simulation_time<previous.simulation_time||state.mission_time<previous.mission_time||(state.phase==='idle'&&previous.phase!=='idle')))cameraReady=false;timeline.push(state,lastReceive);const b=state.battery,r=state.return_budget,soc=b.soc*100;const connected=Date.now()/1000-state.updated_at<4;
 $('live').classList.toggle('live',connected);$('connection').textContent=connected?'Simulación física conectada':'Esperando al simulador';$('phase').textContent=state.label;$('clock').textContent=clock(state.mission_time);$('visited').textContent=state.visited.length;$('alerts').textContent=state.counts.alerts;$('collected').textContent=Object.values(groundSession.fleet.data.tasks).filter(t=>t.status==='completed').length+state.outcomes.filter(p=>p.deposited).length;$('progress').style.width=100*state.route_index/state.route_count+'%';
 $('instruction').textContent=state.phase==='inspect'?`Árbol ${state.route_index+1} de ${state.route_count} · ${state.camera_frames_at_view} imágenes analizadas`:state.return_reason&&state.phase.startsWith('return')?state.return_reason:state.phase==='charging'?'En la base · carga gradual CC/CV':state.phase==='idle'?'Listo para recorrer las filas de cacao':state.plant_id.replaceAll('-',' ');
 $('soc').textContent=soc.toFixed(1)+'%';$('batteryFill').setAttribute('width',String(21*b.soc));document.querySelector('.power').classList.toggle('low',soc<25);$('batteryMode').textContent=state.phase==='charging'?'Cargando en base':'Batería de vuelo';$('energy').textContent=`${b.voltage_v.toFixed(1)} V · ${b.remaining_wh.toFixed(1)} Wh disponibles`;$('reserve').textContent=`${r.required_wh.toFixed(1)} Wh para regreso + reserva`;
 $('altitude').textContent=Math.max(0,state.position[2]-heightAt(world.terrain,state.position[0],state.position[1])-.34).toFixed(1);$('speed').textContent=Math.hypot(...state.velocity.slice(0,3)).toFixed(1);$('power').textContent=Math.round(b.power_w);$('distance').textContent=Math.round(r.distance_m);$('start').disabled=!connected||!data.model.actual_inference||r.margin_wh<=0||!['idle','charging'].includes(state.phase);$('return').disabled=['idle','charging','landing'].includes(state.phase);$('accelerate').setAttribute('aria-pressed',String(state.accelerated));$('accelerate').textContent=state.accelerated?'Tiempo acelerado':'Tiempo real';$('harvest').checked=state.harvest_enabled;
 $('modelStatus').textContent=data.model_error?`Modelo no disponible: ${data.model_error}`:`YOLO11s entrenado · ${session.readonly?(data.model.frames_processed||0):frames} imágenes de cámara analizadas · ${(latest||sharedVision)?(latest||sharedVision).inference_ms.toFixed(0)+' ms de inferencia':'esperando primera imagen'}`;
 const droneRow=$('fleet-drone');if(droneRow){droneRow.querySelector('small').textContent=state.label;droneRow.querySelector('b').textContent=(b.soc*100).toFixed(0)+'%'}
 activity.update({fleet:groundSession.fleet,drone:state,vision:latest||sharedVision});$('activityTime').textContent=clock(state.mission_time);
 if(session.authority&&!autoStarted&&data.model.actual_inference){autoStarted=true;(state.phase==='idle'?command('start'):groundSession.fleet.control('start')).catch(error=>message(error.message));}
 if(inferError)$('modelStatus').textContent='Cámara: '+inferError;groundSession.syncUI();
}
async function poll(){try{const r=await fetch(session.readonly?'/api/live':'/api/telemetry',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Servicio no disponible');updateUI(await r.json())}catch(error){$('connection').textContent='Conexión interrumpida';$('live').classList.remove('live')}setTimeout(poll,session.readonly?250:75)}
function message(text){$('message').textContent=text;$('message').hidden=false;setTimeout(()=>$('message').hidden=true,7000)}
async function droneCommand(action,extra={}){const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});const result=await r.json();if(!r.ok)throw Error(result.error);return result}
async function command(action,extra={}){return groundSession.command(action,extra)}
$('start').onclick=()=>command('start').catch(e=>message(e.message));$('return').onclick=()=>command('return').catch(e=>message(e.message));$('accelerate').onclick=()=>command('speed',{fast:!(groundSession.active()?groundSession.vehicle.state.fast:state?.accelerated)}).catch(e=>message(e.message));
$('harvest').onchange=()=>command('harvest',{enabled:$('harvest').checked}).catch(e=>message(e.message));
$('swap').onclick=()=>{mainView=mainView==='fpv'?'chase':'fpv';$('otherView').textContent=mainView==='fpv'?'Seguimiento del dron':'Cámara del dron';$('targetCaption').textContent=mainView==='fpv'?'Cámara del dron':'Seguimiento del dron';groundSession.captions(mainView);resize()};
$('settingsButton').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('evaluation').hidden=true};$('closeSettings').onclick=()=>$('settings').hidden=true;$('initialSoc').oninput=()=>$('initialSocValue').textContent=$('initialSoc').value+'%';$('reset').onclick=async()=>{await command('reset',{soc:Number($('initialSoc').value)/100});$('settings').hidden=true;latest=null;message('Escenario restablecido en la base con la carga inicial elegida.')};
$('closeEvaluation').onclick=()=>$('evaluation').hidden=true;$('evaluationButton').onclick=async()=>{$('evaluation').hidden=!$('evaluation').hidden;$('settings').hidden=true;if(!$('evaluation').hidden){const e=await fetch('/api/evaluation').then(r=>r.json());const rows=[['Monilia correctamente señalada',e.tp],['Otras mazorcas señaladas por error',e.fp],['Monilia asociada sin alerta suficiente',e.fn],['Otras mazorcas asociadas sin alerta',e.tn]];$('evaluationContent').replaceChildren(...rows.map(([label,n])=>{const d=document.createElement('div');d.className='evaluation-row';const t=document.createElement('span');t.textContent=label;const b=document.createElement('b');b.textContent=n;d.append(t,b);return d}))}};

let visionCursor=0;
function chooseVisionSource(){if(session.readonly)return null;const candidates=groundSession.fleet.verificationSources();if(renderState&&!['idle','charging','failed','scout_hold'].includes(renderState.phase))candidates.push({id:'drone',camera:fpv,position:drone.position,simulation_time:renderState.simulation_time,phase_id:renderState.phase_id});const selected=source();if(!session.authority&&selected.id!=='drone'&&!candidates.some(c=>c.id===selected.id))candidates.push(selected);if(!candidates.length)return null;return candidates[visionCursor%candidates.length]}
function animate(time){if(session.authority)setTimeout(()=>animate(performance.now()),16);else requestAnimationFrame(animate);renderer.info.reset();const deltaSeconds=lastAnimationTime===null?1/60:Math.min(.05,(time-lastAnimationTime)/1000);lastAnimationTime=time;renderCount++;const elapsed=time-lastFps;if(elapsed>1000){fps=renderCount*1000/elapsed;renderCount=0;lastFps=time;$('performance').textContent=`${fps.toFixed(0)} fps · ${groundSession.active()?'Rapier · terrestre':'Webots / ODE · '+(state?.accelerated?'reloj acelerado':'tiempo real')}`}
 if(leafShader)leafShader.uniforms.uWind.value=time/1000;environment.updateWind(time/1000);
 groundSession.update(deltaSeconds);for(const v of groundSession.vehicles)stationLamps.get(v.id).material.emissiveIntensity=v.state.charging?1.4:.15;updateDrone(deltaSeconds);const sensor=source();updateDetail(sensor.position);groundSession.captions(mainView);droneExperience.update(deltaSeconds,renderState,mainView==='fpv'?sensor.camera:sensor.follow,{latestTelemetryAt:state?.updated_at});groundAudio.update();sun.position.copy(sensor.position).add(new THREE.Vector3(-24,42,18));sun.target.position.copy(sensor.position).setY(0);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=time-lastShadowUpdate>=1000/(cfg.rendering?.shadow_update_hz||20)-.25;if(renderer.shadowMap.needsUpdate)lastShadowUpdate=time;
 // Inference uses the selected vehicle sensor; the observer and HUD stay outside RGB.
 const main=mainView==='fpv'?sensor.camera:sensor.follow;main.aspect=mainAspect;main.updateProjectionMatrix();
 const inferenceSensor=chooseVisionSource(),captureFrame=!!inferenceSensor&&!busy&&renderState&&time-lastInfer>=cfg.camera.inference_interval_ms;
 if(captureFrame){visionCursor++;inferenceSensor.camera.aspect=mainAspect;inferenceSensor.camera.updateProjectionMatrix();renderFull(inferenceSensor.camera);requestVision(inferenceSensor)}
 if(session.authority)return;
 if(!captureFrame||main!==inferenceSensor.camera)renderFull(main);
 const rect=observerRect(),inset=mainView==='fpv'?sensor.follow:sensor.camera;observerView.render(scene,inset,rect,height,time);drawBoxes();if(time-lastMap>350){drawMap();lastMap=time}
}
// A readable initial view before the first physics packet.
drone.position.copy(to3(home));fpv.position.copy(to3(home)).add(new THREE.Vector3(0,.02,0));fpv.lookAt(new THREE.Vector3(0,1.6,-6));chase.position.set(3,3,12);updateDetail(to3(home),true);drawMap();
setupModelDetails().catch(error=>message(error.message));
setupReviewInbox({container:$('reviewInbox'),button:$('reviewButton'),close:$('closeReview'),world,onDecision:()=>groundSession.fleet.sync(),onFollow:id=>{groundSession.selector.select(id);$('reviewDrawer').hidden=true;$('reviewButton').setAttribute('aria-expanded','false')}});$('loading').hidden=true;poll();requestAnimationFrame(animate);
window.cacao={session,groundAudio,fleet:groundSession.fleet,droneCameraRig,droneExperience,vehicles:{get ground(){return groundSession.vehicle},grounds:groundSession.vehicles,selector:groundSession.selector},get selectedVehicle(){return groundSession.selector.selected},get state(){return state},get latest(){return latest},get renderState(){return renderState},get motion(){return {bufferedSamples:timeline.samples.length,playhead:timeline.playhead}},get metrics(){return{fps,frames,busy,inferError,renderer:renderer.info.render,environment:environment.stats,observer:observerView.stats}},camera:fpv,scene,renderer,command,droneCommand,world};
