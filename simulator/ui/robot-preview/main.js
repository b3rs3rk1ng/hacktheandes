import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {RoomEnvironment} from '../vendor/RoomEnvironment.js';
import {createFieldRover} from '../robotics/field-rover.js';
import {buildReview,sampleReview} from '../robotics/review-motion.mjs';
import {initPhysics,createRoverDynamics} from '../robotics/rover-dynamics.mjs';
import {buildCourse,courseSection} from '../robotics/terrain-course.mjs';
import {createTerrainScene} from '../robotics/terrain-scene.js';

const $=id=>document.getElementById(id);
const spec=await fetch('../robotics/rover-spec.json').then(r=>{if(!r.ok)throw Error('No se pudo cargar la propuesta');return r.json()});
const plan=buildReview(spec),canvas=$('scene'),stage=canvas.parentElement;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0xe7edef);
renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
const scene=new THREE.Scene();scene.fog=new THREE.Fog(0xe7edef,17,32);
const camera=new THREE.PerspectiveCamera(42,1,.02,70);
camera.position.set(1.95,1.45,2.2);
const controls=new OrbitControls(camera,canvas);controls.target.set(.20,.82,0);
controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.49;
controls.minDistance=.65;controls.maxDistance=24;controls.update();
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
scene.environmentIntensity=.7;
scene.add(new THREE.HemisphereLight(0xf5fafc,0xb0b9b6,1.3));
const key=new THREE.DirectionalLight(0xfffbf3,2.6);key.position.set(1.3,5.0,3);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-2.3,right:2.5,top:2.3,bottom:-2.2,near:.2,far:10});key.shadow.normalBias=.008;key.shadow.bias=-.00012;key.shadow.radius=3;scene.add(key);
const fill=new THREE.DirectionalLight(0xc5dce9,1.25);fill.position.set(-4,2,-2);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:0xd5e0e3,roughness:.87}));floor.rotation.x=-Math.PI/2;floor.position.y=-.009;floor.receiveShadow=true;scene.add(floor);
const linePoints=[new THREE.Vector3(-.95,.002,0),new THREE.Vector3(.24,.002,0)];
const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints),new THREE.LineDashedMaterial({color:0xa9bac0,dashSize:.055,gapSize:.04}));route.computeLineDistances();scene.add(route);
const rover=createFieldRover(spec);scene.add(rover.root);
const reviewBounds=new THREE.Box3();for(let t=0;t<=plan.duration;t+=.5){const p=sampleReview(t,plan);rover.root.position.set(...p.base);rover.pose(p.angles);reviewBounds.union(new THREE.Box3().setFromObject(rover.root));}

await initPhysics();
const course=buildCourse(),dynamics=createRoverDynamics(spec,{course});
const terrainScene=await createTerrainScene(course);scene.add(terrainScene);
const navCamera=new THREE.PerspectiveCamera(spec.cameras.navigation.fov_deg,1,.018,45),wristCamera=new THREE.PerspectiveCamera(spec.cameras.wrist.fov_deg,1,.012,35),insetCamera=new THREE.PerspectiveCamera(43,1,.02,70);
const opticalRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2);
let mode='terrain',physicsState=dynamics.state(),previousPhysics=physicsState,accumulator=0,insetRect=null,followOffset=new THREE.Vector3(2.0,1.4,2.6);

const context=new THREE.Group();context.name='Árbol de referencia';scene.add(context);
const barkMap=await new THREE.TextureLoader().loadAsync('/assets/bark-color.jpg');barkMap.colorSpace=THREE.SRGBColorSpace;barkMap.wrapS=barkMap.wrapT=THREE.RepeatWrapping;barkMap.repeat.set(2,2);
const bark=new THREE.MeshStandardMaterial({map:barkMap,color:0x9c9c8a,roughness:.97});
function segment(a,b,radius,parent,material=bark){a=new THREE.Vector3(...a);b=new THREE.Vector3(...b);const delta=b.clone().sub(a),m=new THREE.Mesh(new THREE.CylinderGeometry(radius*.75,radius,delta.length(),14),material);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());m.castShadow=m.receiveShadow=true;parent.add(m);return m}
segment([1.32,0,-.12],[1.29,1.95,-.12],.092,context);
segment([1.3,1.5,-.12],[1.72,2.1,-.24],.028,context);
segment([1.3,1.68,-.12],[.97,2.10,-.29],.025,context);
const leafMap=await new THREE.TextureLoader().loadAsync('/assets/cacao-leaf.png');leafMap.colorSpace=THREE.SRGBColorSpace;
const leafMaterial=new THREE.MeshStandardMaterial({map:leafMap,alphaTest:.55,side:THREE.DoubleSide,roughness:.8,color:0xd8e5d2});
const leafGeometry=new THREE.PlaneGeometry(.21,.43,3,6),lp=leafGeometry.attributes.position;
for(let i=0;i<lp.count;i++)lp.setZ(i,Math.sin((lp.getY(i)/.43+.5)*Math.PI)*.035);leafGeometry.computeVertexNormals();
for(let i=0;i<54;i++){const a=i*2.399963,rad=.12+.39*((i*17%53)/53),leaf=new THREE.Mesh(leafGeometry,leafMaterial);leaf.position.set(1.30+Math.cos(a)*rad,1.90+Math.sin(i*3.1)*.19,-.12+Math.sin(a)*rad);leaf.rotation.set(.3+Math.sin(i)*.8,a,Math.sin(i*1.9)*.8);leaf.castShadow=true;context.add(leaf)}
const podPosition=new THREE.Vector3(...spec.review.targets.pod);
const stem=segment([podPosition.x,podPosition.y+.138,podPosition.z],[1.25,1.51,-.10],.005,context);
const podGeometry=new THREE.SphereGeometry(1,44,30),pp=podGeometry.attributes.position,colors=[];
for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i),a=Math.atan2(z,x),r=1+.062*Math.cos(a*10);pp.setXYZ(i,x*.0525*r,y*.14,z*.0525*r);const c=new THREE.Color().setHSL(.095+.018*Math.sin(y*7+a*3),.48,.32+.09*Math.cos(a*10)+.025*Math.sin(y*140+a*90));colors.push(c.r,c.g,c.b)}podGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));podGeometry.computeVertexNormals();
const pod=new THREE.Mesh(podGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83}));pod.name='Mazorca de demostración';pod.castShadow=pod.receiveShadow=true;scene.add(pod);

let selectedView='three';
let time=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,manual=null,lastTime=null,currentPose=null,cameraMove=null,frames=0,fps=0,lastFps=0;
const payload=spec.review.payload,reference=sampleReview(payload.grasp_s,plan);
rover.root.position.set(...reference.base);rover.pose(reference.angles);
const graspRotation=rover.tcp.getWorldQuaternion(new THREE.Quaternion()).invert();
const releasePose=sampleReview(payload.release_s,plan);
rover.root.position.set(...releasePose.base);rover.pose(releasePose.angles);
const releaseRotation=rover.tcp.getWorldQuaternion(new THREE.Quaternion()).multiply(graspRotation).clone();
const releasePosition=rover.tcp.getWorldPosition(new THREE.Vector3());
const jointNames=['Giro de base','Hombro','Codo','Muñeca','Rotación de pinza','Orientación de pinza'];
const jointInputs=jointNames.map((name,i)=>{
  const row=document.createElement('div'),label=document.createElement('label'),title=document.createElement('span'),value=document.createElement('output'),input=document.createElement('input');
  label.className='joint-label';label.htmlFor='joint-'+i;title.textContent=name;label.append(title,value);input.type='range';input.id='joint-'+i;input.min=String(spec.arm.limits_rad[i][0]*180/Math.PI);input.max=String(spec.arm.limits_rad[i][1]*180/Math.PI);input.step='.1';input.setAttribute('aria-label',name);
  input.addEventListener('input',()=>{if(!manual)manual=currentPose.angles.slice();manual[i]=Number(input.value)*Math.PI/180;playing=false;updatePlayback()});
  row.append(label,input);$('joints').append(row);return {input,value};
});
function showMessage(text){$('message').textContent=text;$('message').hidden=false;setTimeout(()=>$('message').hidden=true,5000)}
function updatePlayback(){
  if(mode==='terrain'){$('playLabel').textContent=playing?'Pausar':physicsState.status==='running'?'Iniciar':'Repetir';$('play').setAttribute('aria-label',playing?'Pausar recorrido':'Iniciar recorrido');$('playIcon').innerHTML=playing?'<path d="M2 1h4v15H2zm7 0h4v15H9z"/>':'<path d="M2 1.5 14 8.5 2 15.5Z"/>';return;}
  $('playLabel').textContent=playing?'Pausar':time>=plan.duration?'Repetir':'Ver movimiento';
  $('play').setAttribute('aria-label',playing?'Pausar secuencia':'Reproducir secuencia');
  $('playIcon').innerHTML=playing?'<path d="M2 1h4v15H2zm7 0h4v15H9z"/>':'<path d="M2 1.5 14 8.5 2 15.5Z"/>';
}
function clock(t){return '00:'+String(Math.floor(t)).padStart(2,'0')}
function setTime(value){time=THREE.MathUtils.clamp(value,0,plan.duration);manual=null;playing=false;updatePlayback();renderPose()}
function renderArm(){
  rover.root.quaternion.identity();
  const pose=sampleReview(time,plan);if(manual)pose.angles=manual.slice();currentPose=pose;
  rover.root.position.set(...pose.base);rover.pose(pose.angles,{opening:pose.opening,cut:pose.cut,travel:pose.base[0]-plan.frames[0].base[0]});
  context.visible=$('showTree').checked;pod.visible=context.visible;
  stem.visible=time<payload.attach_s;
  if(time<payload.attach_s){pod.position.copy(podPosition);pod.quaternion.identity()}
  else if(time<payload.release_s){rover.tcp.getWorldPosition(pod.position);rover.tcp.getWorldQuaternion(pod.quaternion).multiply(graspRotation)}
  else {const fallTime=time-payload.release_s;pod.quaternion.copy(releaseRotation);pod.position.copy(releasePosition);pod.position.y=Math.max(payload.settled_y_m,releasePosition.y-.5*9.81*fallTime*fallTime);if(pod.position.y===payload.settled_y_m)pod.position.set(pose.base[0]+payload.bin_offset[0],payload.bin_offset[1],pose.base[2]+payload.bin_offset[2]);}
  const phaseIndex=spec.review.phases.findIndex(p=>time>=p.start&&time<p.end),index=phaseIndex<0?spec.review.phases.length-1:phaseIndex,phase=spec.review.phases[index];
  $('phase').textContent=manual?'Revisión de articulaciones':phase.label;$('description').textContent=manual?'Mueve los controles para revisar el alcance y la forma del brazo.':phase.description;
  $('stepNumber').textContent=manual?'Control manual':String(index+1).padStart(2,'0')+' / '+String(spec.review.phases.length).padStart(2,'0');
  $('currentTime').textContent=clock(time);$('time').value=String(time);
  for(let i=0;i<jointInputs.length;i++){const degrees=pose.angles[i]*180/Math.PI,j=jointInputs[i];if(document.activeElement!==j.input)j.input.value=String(degrees);j.value.textContent=Math.round(degrees)+'°';}
}
const suspensionLabels=['Trasera izq.','Trasera der.','Delantera izq.','Delantera der.'];
const suspensionBars=suspensionLabels.map(label=>{const el=document.createElement('div');el.className='suspension-wheel';el.innerHTML='<span></span><div class="suspension-track"><i></i></div>';el.querySelector('span').textContent=label;$('suspensionBars').append(el);return el});
function renderTerrain(alpha){
 const p=physicsState,prev=previousPhysics;
 rover.root.position.fromArray(prev.position).lerp(new THREE.Vector3().fromArray(p.position),alpha);
 rover.root.quaternion.fromArray(prev.rotation).slerp(new THREE.Quaternion().fromArray(p.rotation),alpha);
 const wheels=p.wheels.map((w,i)=>({...w,y:THREE.MathUtils.lerp(prev.wheels[i].y,w.y,alpha),rotation:THREE.MathUtils.lerp(prev.wheels[i].rotation,w.rotation,alpha),steering:THREE.MathUtils.lerp(prev.wheels[i].steering,w.steering,alpha)}));
 rover.pose(spec.arm.folded_rad,{wheelStates:wheels});
 context.visible=pod.visible=false;
 const section=courseSection(p.position[0],course.config),done=p.status==='complete',stopped=p.status==='stopped';
 $('stepNumber').textContent=done?'Recorrido completado':stopped?'Detenido por seguridad':'PRUEBA FÍSICA · '+clock(p.elapsed);
 $('phase').textContent=done?'Llegó a la meta':stopped?'Recorrido interrumpido':section;
 $('description').textContent=done?'Terminó el circuito y aplica el freno. Puedes reiniciar o revisar el brazo.':stopped?'Superó el límite de inclinación o salió del corredor. Reinicia para repetir.':'El brazo viaja plegado. Las ruedas y el chasis responden al contacto con el suelo.';
 $('actualSpeed').textContent=Math.abs(p.speed).toFixed(2);$('pitch').textContent=(p.pitch*180/Math.PI).toFixed(1)+'°';$('roll').textContent=(p.roll*180/Math.PI).toFixed(1)+'°';$('contacts').textContent=p.wheels.filter(w=>w.contact).length+' / 4';
 p.wheels.forEach((w,i)=>{suspensionBars[i].querySelector('i').style.width=THREE.MathUtils.clamp(w.compression/spec.dynamics.suspension_travel_m*100,0,100)+'%';suspensionBars[i].classList.toggle('air',!w.contact);suspensionBars[i].title=Math.round(w.compression*1000)+' mm de compresión';});
 const distance=Math.max(0,p.position[0]-course.config.startX),total=course.config.finishX-course.config.startX;$('currentTime').textContent=distance.toFixed(1)+' m';$('time').value=Math.min(total,distance);$('sequenceLabel').textContent='Recorrido autónomo · '+section;
}
function renderPose(){if(mode==='terrain')renderTerrain(playing?accumulator/spec.dynamics.timestep_s:1);else renderArm();}
function resize(){const width=stage.clientWidth,height=stage.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();const r=$('cameraInset').getBoundingClientRect(),s=stage.getBoundingClientRect();insetRect={left:r.left-s.left,bottom:height-(r.bottom-s.top),width:r.width,height:r.height};if(window.roverPreview&&selectedView&&mode==='arm'&&!['nav','wrist'].includes(selectedView))view(selectedView)}
new ResizeObserver(resize).observe(stage);resize();
const views={three:new THREE.Vector3(1.75,.63,2.2),side:new THREE.Vector3(0,.14,1),front:new THREE.Vector3(1,.2,0)};
function fittedView(direction){
 const forward=direction.clone().normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),forward).normalize(),up=new THREE.Vector3().crossVectors(forward,right),target=reviewBounds.getCenter(new THREE.Vector3()),halfFov=Math.tan(camera.fov*Math.PI/360);let distance=0;
 for(const x of [reviewBounds.min.x,reviewBounds.max.x])for(const y of [reviewBounds.min.y,reviewBounds.max.y])for(const z of [reviewBounds.min.z,reviewBounds.max.z]){const p=new THREE.Vector3(x,y,z).sub(target);distance=Math.max(distance,p.dot(forward)+Math.max(Math.abs(p.dot(right))/(halfFov*camera.aspect),Math.abs(p.dot(up))/halfFov));}
 return {position:target.clone().addScaledVector(forward,distance*1.08),target};
}
function view(name){
 selectedView=name;cameraMove=null;controls.enabled=!['nav','wrist'].includes(name);
 if(mode==='terrain'){
   if(name==='course')cameraMove={position:new THREE.Vector3(6.8,11,13),target:new THREE.Vector3(4.5,.1,0)};
   else if(views[name])followOffset=views[name].clone().normalize().multiplyScalar(3.7);
 }else if(views[name])cameraMove=fittedView(views[name]);
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
 $('mainCameraLabel').hidden=controls.enabled;$('mainCameraLabel').textContent=name==='wrist'?'Cámara de pinza · montada en la muñeca':'Cámara frontal · montada en el chasis';
 document.querySelector('.orbit-hint').textContent=controls.enabled?'Arrastra para girar · Acerca con la rueda o con dos dedos':'Vista desde el sensor · La cámara acompaña la inclinación del robot';
}
function setMode(next){
 mode=next;document.body.dataset.mode=mode;accumulator=0;manual=null;playing=true;time=0;
 document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
 const terrain=mode==='terrain';terrainScene.visible=terrain;floor.visible=route.visible=!terrain;
 $('time').disabled=terrain;$('time').max=terrain?String(course.config.finishX-course.config.startX):String(plan.duration);
 $('timeTotal').textContent=terrain?' / '+(course.config.finishX-course.config.startX).toFixed(1)+' m':' / 00:28';
 $('stageSubtitle').textContent=terrain?'Ruedas de 45 cm · Tracción en las cuatro ruedas':'Brazo de seis ejes · Agarre, corte y depósito';
 $('sequenceLabel').textContent=terrain?'Recorrido autónomo':'Desplazamiento, agarre y depósito';
 $('chapters').innerHTML=(terrain?['Surcos','Subida','Pendiente lateral','Raíces']:['Desplazarse','Agarrar y cortar','Depositar','Plegar']).map(t=>'<span>'+t+'</span>').join('');
 $('reviewNote').textContent=terrain?'Gravedad, chasis rígido y suspensión por rayos (Rapier). Masa de 105.5 kg y agarre estimados. No valida barro deformable, vegetación ni un robot real.':'El brazo sigue una secuencia programada para revisar el diseño. Todavía no valida contacto de la pinza, fuerzas de corte ni equilibrio al cosechar.';
 if(terrain){physicsState=previousPhysics=dynamics.reset();}else rover.root.quaternion.identity();
 renderPose();view('three');
 if(terrain){controls.target.copy(rover.root.position).add(new THREE.Vector3(0,.72,0));camera.position.copy(controls.target).add(followOffset);controls.update();}
 updatePlayback();
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view));
controls.addEventListener('start',()=>{cameraMove=null;selectedView=null;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'))});
$('play').onclick=()=>{if(mode==='terrain'){if(physicsState.status!=='running'){physicsState=previousPhysics=dynamics.reset();accumulator=0;}playing=!playing;}else{if(manual||time>=plan.duration){manual=null;time=0;}playing=!playing;}updatePlayback()};
$('restart').onclick=()=>{manual=null;time=0;playing=false;accumulator=0;if(mode==='terrain')physicsState=previousPhysics=dynamics.reset();updatePlayback();renderPose()};
$('time').oninput=()=>{if(mode==='arm')setTime(Number($('time').value))};
$('jointToggle').onclick=()=>{const expanded=$('jointToggle').getAttribute('aria-expanded')!=='true';$('jointToggle').setAttribute('aria-expanded',String(expanded));$('joints').hidden=!expanded;$('jointToggle').querySelector('span').textContent=expanded?'−':'+'};
$('showTree').onchange=renderPose;
async function exportModel(){const {GLTFExporter}=await import('../vendor/GLTFExporter.js');rover.root.updateMatrixWorld(true);return new GLTFExporter().parseAsync(rover.root,{binary:true,onlyVisible:true});}
$('download').onclick=async()=>{
 const button=$('download');button.disabled=true;playing=false;updatePlayback();
 try{const buffer=await exportModel(),url=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download='cacao-robot-propuesta.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);showMessage('Modelo exportado con la pose y las articulaciones visibles.');}
 catch(error){showMessage('No se pudo exportar: '+error.message)}finally{button.disabled=false;}
};
function updateMountedCamera(cam,mount){mount.getWorldPosition(cam.position);mount.getWorldQuaternion(cam.quaternion).multiply(opticalRotation);cam.updateMatrixWorld(true);}
function renderViews(){
 updateMountedCamera(navCamera,rover.cameraMounts.navigation);updateMountedCamera(wristCamera,rover.cameraMounts.wrist);
 const fpv=selectedView==='nav'||selectedView==='wrist',main=fpv?(selectedView==='nav'?navCamera:wristCamera):camera;
 const width=stage.clientWidth,height=stage.clientHeight;main.aspect=width/height;main.updateProjectionMatrix();
 renderer.setViewport(0,0,width,height);renderer.setScissorTest(false);renderer.shadowMap.needsUpdate=true;renderer.render(scene,main);
 const r=insetRect;
 let second=navCamera;
 if(fpv){second=insetCamera;const target=rover.root.position.clone().add(new THREE.Vector3(0,.73,0));second.position.copy(target).add(new THREE.Vector3(2.1,1.2,2.7));second.lookAt(target);}
 $('insetLabel').textContent=fpv?'Vista exterior · en vivo':'Cámara frontal · en vivo';
 second.aspect=r.width/r.height;second.updateProjectionMatrix();
 renderer.setViewport(r.left,r.bottom,r.width,r.height);renderer.setScissor(r.left,r.bottom,r.width,r.height);renderer.setScissorTest(true);renderer.clearDepth();renderer.render(scene,second);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);
}
function animate(now){requestAnimationFrame(animate);const dt=lastTime===null?0:Math.min((now-lastTime)/1000,.05);lastTime=now;
 if(playing){
  if(mode==='terrain'){
   accumulator+=dt*Number($('speed').value);
   while(accumulator>=spec.dynamics.timestep_s){previousPhysics=physicsState;physicsState=dynamics.step();accumulator-=spec.dynamics.timestep_s;}
   if(physicsState.status!=='running'&&Math.abs(physicsState.speed)<.025){playing=false;updatePlayback();}
  }else{time+=dt*Number($('speed').value);if(time>=plan.duration){if($('loop').checked)time%=plan.duration;else{time=plan.duration;playing=false;updatePlayback();}}}
 }
 renderPose();
 if(mode==='terrain'&&views[selectedView]){const target=rover.root.position.clone().add(new THREE.Vector3(0,.72,0)),t=1-Math.exp(-5*dt);controls.target.lerp(target,t);camera.position.lerp(target.clone().add(followOffset),t);}
 if(cameraMove){const t=1-Math.exp(-7*dt);camera.position.lerp(cameraMove.position,t);controls.target.lerp(cameraMove.target,t);if(camera.position.distanceTo(cameraMove.position)<.002&&controls.target.distanceTo(cameraMove.target)<.002)cameraMove=null;}
 const center=rover.root.position;key.position.set(center.x+1.3,center.y+5,center.z+3);key.target.position.copy(center);key.target.updateMatrixWorld();
 controls.update();renderViews();frames++;if(now-lastFps>1000){fps=frames*1000/(now-lastFps);frames=0;lastFps=now;$('fpsReadout').textContent=Math.round(fps)+' fps';}
}
setMode('terrain');if(matchMedia('(prefers-reduced-motion: reduce)').matches){playing=false;updatePlayback();}$('loading').hidden=true;requestAnimationFrame(animate);
window.roverPreview={spec,plan,rover,scene,camera,renderer,controls,exportModel,view,setTime,setMode,dynamics,get mode(){return mode},get physicsState(){return physicsState},get time(){return time},get pose(){return currentPose},get playing(){return playing},get fps(){return fps}};
