import {createGroundPlanner} from '/orchard/ground-planner.mjs';
import {pathTrack,minimumSeparation,fallDistance,tumbleAngles,clothPoint,roundCorners} from '/film/choreography.mjs';
import {heightAt} from '/orchard/terrain.mjs';
import {buildHarvestPlan,sampleHarvestStage} from '/orchard/harvest-motion.mjs';

// Directed film poses are intentionally isolated from mission/physics authority.
// The assets, arm solver, harvest stages and RGB detector are the project originals.
export async function createFilmDirector({THREE,scene,renderer,world,droneExperience,vehicles,environment,updateDetail,prepareScene,sun,sky,canvas}){
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z), to3=p=>V(p[0],p[2],-p[1]);
 const clamp=n=>Math.max(0,Math.min(1,n)), ease=n=>{n=clamp(n);return n*n*(3-2*n)}, lerp=(a,b,t)=>a+(b-a)*t;
 const mix=(a,b,t)=>a.clone().lerp(b,ease(t));
 const ground=(x,z)=>heightAt(world.terrain,x,-z);
 const drone=droneExperience.drone,home=to3(world.config.field.home);
 let target=null,heroPos=null,heroYaw=0,plan=null,planDuration=0,detection=null,detectionImage=null;
 const W=1080,H=1920;
 const planner=createGroundPlanner(world);let team=[],tracks=[],releaseAt=0,releaseLocal=null,attachmentLocal=null,releaseSpinAxis=V(0,0,1);
 renderer.setPixelRatio(1.25);renderer.setSize(W,H);renderer.toneMappingExposure=1.02;
 renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;
 scene.add(new THREE.HemisphereLight(0xcce6f0,0x8c8068,1.1));sun.intensity=3.2;sun.color.set('#ffe6bf');
 scene.fog.color.set('#889b90');scene.fog.near=50;scene.fog.far=135;
 const filmCamera=new THREE.PerspectiveCamera(43,W/H,.025,650);
 const sensor=new THREE.PerspectiveCamera(49,W/H,.02,650);
 const folded=vehicles.map(v=>v.spec.arm.folded_rad.slice());
 const css=document.createElement('style');css.textContent=`
body{margin:0;background:#000;overflow:hidden}body>*:not(#viewport):not(#film-overlay):not(#film-capture){display:none!important}
#viewport{position:fixed!important;inset:0!important}#viewport #world{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}#viewport>*:not(#world){display:none!important}
#film-overlay{position:fixed;inset:0;pointer-events:none;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased}
#film-top{position:absolute;left:56px;top:108px;font-size:26px;font-weight:600;letter-spacing:2px;text-shadow:0 1px 10px #0006}
#film-meta,#film-step,#film-rule,#film-bottom{display:none}
#film-copy{position:absolute;left:56px;right:126px;bottom:320px;padding:36px 40px 38px;border-radius:36px;background:rgba(22,24,25,.55);backdrop-filter:blur(32px) saturate(70%);-webkit-backdrop-filter:blur(32px) saturate(70%);border:1px solid #ffffff29;box-shadow:0 12px 45px #00000012}
#film-title{font-size:88px;line-height:1.04;font-weight:600;letter-spacing:-3.2px;white-space:pre-line;text-wrap:balance}
#film-sub{font-size:26px;line-height:1.2;font-weight:400;letter-spacing:-.3px;color:#ffffffe0;margin-top:20px}#film-sub:empty{display:none}
#film-detection{position:absolute;border:2px solid #fff8;display:none}#film-detection span{position:absolute;top:-58px;left:-2px;padding:12px 18px;border-radius:16px;background:#1a211c66;backdrop-filter:blur(20px);color:#fff;font-size:26px;white-space:nowrap}
#film-vignette{position:absolute;inset:0;box-shadow:inset 0 0 180px #00000024}#film-black{position:absolute;inset:0;background:#020705;opacity:0}
`;document.head.append(css);
 const overlay=document.createElement('div');overlay.id='film-overlay';overlay.innerHTML=`<div id="film-vignette"></div><div id="film-top"><span id="film-brand">CACAO</span><span id="film-meta">TECNOLOGÍA PARA EL CAMPO</span></div><div id="film-detection"><span></span></div><div id="film-copy"><div id="film-step"></div><div id="film-title"></div><div id="film-sub"></div></div><div id="film-rule"><i></i></div><div id="film-bottom"><span>SECUENCIA DIRIGIDA EN SIMULACIÓN</span><span id="film-chapter"></span></div><div id="film-black"></div>`;document.body.append(overlay);
 const $=id=>document.getElementById(id);
 const detectionPlate=document.createElement('img');detectionPlate.src='/output/detection-frame.jpg';detectionPlate.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';overlay.prepend(detectionPlate);
 const chapters=[
  {s:0,e:3,k:'01 / La misión',t:'Proteger\nla cosecha.',sub:''},
  {s:3,e:9,k:'02 / Despegue',t:'Cada fruto\ncuenta.',sub:''},
  {s:9,e:14,k:'03 / Reconocimiento',t:'Ver el problema\na tiempo.',sub:''},
  {s:14,e:21,k:'04 / Visión artificial',t:'Detectar\ncon IA.',sub:''},
  {s:21,e:26,k:'05 / Equipo terrestre',t:'Pasar\na la acción.',sub:''},
  {s:26,e:31,k:'06 / Coordinación',t:'Trabajar\nen equipo.',sub:''},
  {s:31,e:39,k:'07 / Retirada',t:'Retirar el\nfruto afectado.',sub:''},
  {s:39,e:46,k:'08 / Recogida',t:'Recoger.\nCuidar.',sub:''},
  {s:46,e:52,k:'09 / Trabajo en equipo',t:'Una mirada.\nTodo un equipo.',sub:''},
  {s:52,e:59,k:'10 / Regreso',t:'Volver.\nContinuar.',sub:''},
  {s:59,e:63,k:'11 / Impacto',t:'Menos pérdidas.\nMás valor.',sub:''},
  {s:63,e:72,k:'12 / Hecho en Perú',t:'El futuro\nlo cultivamos.',sub:'Hecho en Perú.'}
 ];

 let preview=false,previewStart=0;
 const flagTexture=await new THREE.TextureLoader().loadAsync('/film/assets/peru.svg');flagTexture.colorSpace=THREE.SRGBColorSpace;flagTexture.anisotropy=16;
 const flagWidth=2.1,flagHeight=flagWidth*2/3;
 const flagGeo=new THREE.PlaneGeometry(flagWidth,flagHeight,80,40),flagMat=new THREE.MeshStandardMaterial({side:THREE.DoubleSide,roughness:.82,map:flagTexture});
 const pa=flagGeo.attributes.position,flagBase=pa.array.slice();
 const flag=new THREE.Mesh(flagGeo,flagMat);flag.castShadow=true;flag.visible=false;scene.add(flag);
 const poleMat=new THREE.MeshStandardMaterial({color:'#b6c1ba',metalness:.8,roughness:.2});
 const poles=vehicles.map(()=>{const p=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,8),poleMat);p.visible=false;scene.add(p);return p});
 const payload=new THREE.Mesh(new THREE.SphereGeometry(1,28,20),new THREE.MeshStandardMaterial({roughness:.85}));payload.visible=false;scene.add(payload);const podVertices=payload.geometry.attributes.position;for(let i=0;i<podVertices.count;i++){const x=podVertices.getX(i),y=podVertices.getY(i),z=podVertices.getZ(i),r=1+.14*Math.cos(Math.atan2(z,x)*10)+.012*Math.sin(y*48+Math.atan2(z,x)*7);podVertices.setXYZ(i,x*r,y*(1+.05*y),z*r)}payload.geometry.computeVertexNormals();
 let targetMeshes=[];const hiddenMatrices=new Map();
 function restoreTarget(){for(const [mesh,index,matrix] of targetMeshes){mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.needsUpdate=true}targetMeshes=[]}
 function hideTarget(){if(!target)return;const pos=to3(target.position);scene.traverse(node=>{if(!node.isInstancedMesh||!node.material?.map?.image?.src?.includes(`/assets/pods/${target.label}-${target.variant}.jpg`))return;for(let i=0;i<node.count;i++){const m=new THREE.Matrix4();node.getMatrixAt(i,m);const p=V().setFromMatrixPosition(m);if(p.distanceTo(pos)<.02){targetMeshes.push([node,i,m.clone()]);node.setMatrixAt(i,new THREE.Matrix4().makeScale(0,0,0));node.instanceMatrix.needsUpdate=true}}})}
 function poseVehicle(v,p,yaw,angles,opening=1,cut=0,travel=0,{followTerrain=false}={}){
  const root=v.rover.root;root.visible=true;root.position.copy(p);root.rotation.set(0,yaw,0);let wheelStates=null;
  if(followTerrain){
   const dx=(ground(p.x+.35,p.z)-ground(p.x-.35,p.z))/.7,dz=(ground(p.x,p.z+.35)-ground(p.x,p.z-.35))/.7,normal=V(-dx,1,-dz).normalize();
   root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(V(0,1,0),normal));
   const up=V(0,1,0).applyQuaternion(root.quaternion);
   wheelStates=v.rover.wheels.map(w=>{const foot=V(w.x,0,w.sign*v.spec.base.track_m/2).applyQuaternion(root.quaternion).add(p);return {y:(ground(foot.x,foot.z)+v.spec.base.wheel_radius_m-foot.y)/up.y,rotation:travel/v.spec.base.wheel_radius_m,steering:0}});
  }
  v.rover.pose(angles,{opening,cut,travel,wheelStates});root.updateMatrixWorld(true);
 }
 const stations=vehicles.map(v=>V(v.station[0],ground(v.station[0],-v.station[1])+.035,-v.station[1]));
 function aim(pos,at,fov=43){filmCamera.position.copy(pos);filmCamera.position.y=Math.max(filmCamera.position.y,ground(pos.x,pos.z)+.35);filmCamera.fov=fov;filmCamera.lookAt(at);filmCamera.updateProjectionMatrix();filmCamera.updateMatrixWorld(true)}
 function harvestAt(t){let elapsed=t*planDuration;for(const stage of plan){if(elapsed<=stage.duration)return {...sampleHarvestStage(stage,elapsed),kind:stage.kind};elapsed-=stage.duration}return {...sampleHarvestStage(plan.at(-1),plan.at(-1).duration),kind:'folding'}}
 function configureTarget(pod){
  target=pod;const pp=to3(pod.position);const r=vehicles[0];
  // Try azimuths/stand-off distances against the shared arm solver and full harvest contract.
  let result=null;
  const plant=world.plants.find(p=>p.id===pod.plant_id),radial=pp.clone().sub(to3(plant.position));radial.y=0;radial.normalize();
  search: for(const dist of [.66,.76,.88,1.0])for(let j=0;j<16;j++){
   const a=Math.atan2(radial.z,radial.x)+j*Math.PI/8,p=pp.clone().add(V(Math.cos(a)*dist,0,Math.sin(a)*dist));p.y=ground(p.x,p.z)+.035;
   if(!planner.safe([p.x,-p.z]))continue;
   const yaw=Math.atan2(-(pp.z-p.z),pp.x-p.x);poseVehicle(r,p,yaw,folded[0]);
   const local=r.rover.root.worldToLocal(pp.clone()).sub(V(...r.spec.base.mount));
   try{const stages=buildHarvestPlan(r.spec,local.toArray(),folded[0],{radius:pod.radii_m[0],motionRate:1});result={p,yaw,stages};break search}catch{}
  }
  if(!result)throw Error('Target has no complete shared harvest plan');
  heroPos=result.p;heroYaw=result.yaw;plan=result.stages;
  const releaseSide=heroPos.clone().sub(pp);releaseSide.y=0;releaseSide.normalize();releaseSpinAxis=releaseSide.clone().multiplyScalar(2.1).addScaledVector(V(-releaseSide.z,0,releaseSide.x),.8).normalize();
  // Hold above the collection bin before opening, leaving a visible gravity fall.
  const carry=plan.find(s=>s.kind==='carrying'),deposit=plan.find(s=>s.kind==='depositing');deposit.target.angles=carry.target.angles.slice();
  const releasing=plan.find(s=>s.kind==='releasing');releasing.from.angles=carry.target.angles.slice();releasing.target.angles=carry.target.angles.slice();
  plan.find(s=>s.kind==='clearing').from.angles=carry.target.angles.slice();
  planDuration=plan.reduce((n,s)=>n+s.duration,0);
  const r0=vehicles[0];poseVehicle(r0,heroPos,heroYaw,plan.find(s=>s.kind==='cutting').target.angles);
  attachmentLocal=r0.rover.tcp.worldToLocal(pp.clone());
  poseVehicle(r0,heroPos,heroYaw,carry.target.angles);
  releaseLocal=r0.rover.root.worldToLocal(r0.rover.tcp.localToWorld(attachmentLocal.clone()));
  releaseAt=31+15*plan.slice(0,plan.findIndex(s=>s.kind==='releasing')).reduce((n,s)=>n+s.duration,0)/planDuration;
  team=[heroPos.clone()];
  for(let i=1;i<vehicles.length;i++){
   const wanted=heroPos.clone().add(V(i*4,0,.5));let chosen=null;
   for(const dz of [0,1,-1,2,-2])for(const dx of [0,.5,-.5,1,-1]){const q=wanted.clone().add(V(dx,0,dz));if(!chosen&&planner.safe([q.x,-q.z])&&team.every(p=>Math.hypot(p.x-q.x,p.z-q.z)>1.8))chosen=q}
   if(!chosen)throw Error('No clear team work pose');chosen.y=ground(chosen.x,chosen.z)+.035;team.push(chosen);
  }
  tracks=team.map((p,i)=>{const path=planner.plan([stations[i].x,-stations[i].z],[p.x,-p.z]);if(!path)throw Error('No collision-free film route');return pathTrack(roundCorners(path,planner.clear))});
  if(minimumSeparation(tracks)<1.3)throw Error('Film routes violate fleet spacing');
  const img=new THREE.TextureLoader().load(`/assets/pods/${pod.label}-${pod.variant}.jpg`);img.colorSpace=THREE.SRGBColorSpace;payload.material.map=img;payload.material.needsUpdate=true;payload.scale.set(pod.radii_m[0],pod.radii_m[2],pod.radii_m[1]);
  // Sensor sees this same fruit from the reachable approach side.
  const dir=radial; sensor.position.copy(pp).addScaledVector(dir,1.12).add(V(0,.14,0));sensor.lookAt(pp);sensor.updateMatrixWorld(true);
  return {id:pod.id,heroPos:heroPos.toArray(),height:pp.y-ground(pp.x,pp.z),planDuration};
 }
 function render(t=0){
  if(renderer.getPixelRatio()!==1.25){renderer.setPixelRatio(1.25);renderer.setSize(W,H)}
  t=Math.max(0,Math.min(72,t));restoreTarget();flag.visible=false;poles.forEach(p=>p.visible=false);payload.visible=false;
  const chapter=chapters.find(c=>t>=c.s&&t<c.e)||chapters.at(-1),u=(t-chapter.s)/(chapter.e-chapter.s);
  $('film-step').textContent=chapter.k;$('film-title').innerText=chapter.t;$('film-sub').textContent=chapter.sub;$('film-chapter').textContent=chapter.k.split(' / ')[0].toUpperCase();$('film-rule').firstElementChild.style.width=`${t/72*100}%`;
  const fade=Math.min(clamp((t-chapter.s)/.5),clamp((chapter.e-t)/.4));$('film-copy').style.opacity=fade;
  $('film-black').style.opacity=t<.8?1-t/.8:t>70.8?clamp((t-70.8)/1.2):0;
  const pp=target?to3(target.position):V(0,1,-8);
  const atWork=heroPos||V(1,0,-6);
  // Team poses and paths are planned once against the original orchard geometry.
  let stage=plan?harvestAt((t-31)/15):null;
  for(let i=0;i<vehicles.length;i++){
   let p=stations[i].clone(),yaw=Math.PI/2,angles=folded[i],travel=0,opening=1,cut=0;
   if(t>=21&&t<26){const q=tracks[i].sample(ease((t-21)/5));p=V(q.point[0],0,-q.point[1]);yaw=q.yaw;travel=q.travel;}
   else if(t>=26&&t<52){p=team[i].clone();yaw=i===0?heroYaw:Math.PI/2;travel=12;if(i===0&&t>=31&&t<46){angles=stage.angles;opening=stage.opening;cut=stage.cut}else if(i>0&&t>=31){const q=(Math.sin((t-31)*.6+i)+1)*.5;angles=folded[i].map((a,j)=>a+(j===1?-.32:j===2?.35:0)*q)}}
   else if(t>=52&&t<59){const q=tracks[i].sample(1-ease((t-52)/7));p=V(q.point[0],0,-q.point[1]);yaw=q.yaw+Math.PI;travel=tracks[i].length-q.travel;}
   else if(t>=59){p=stations[i].clone();if(t>=63)p.z+=3; p.y=ground(p.x,p.z)+.035;yaw=t>=63&&i===2?-Math.PI/2:Math.PI/2;}
   p.y=ground(p.x,p.z)+.035;poseVehicle(vehicles[i],p,yaw,angles,opening,cut,travel,{followTerrain:(t>=21&&t<26)||(t>=52&&t<59)});
  }
  drone.visible=!(t>=14&&t<21);drone.position.copy(home);drone.rotation.set(0,Math.PI,0);
  const dtarget=pp.clone().add(V(1.3,1.0,1.2));
  if(t<3)drone.position.y=home.y;
  else if(t<9)drone.position.copy(mix(home,home.clone().add(V(0,3.8,-1.5)),(t-3)/6));
  else if(t<14)drone.position.copy(mix(home.clone().add(V(0,3.8,-1.5)),dtarget,(t-9)/5));
  else if(t<52)drone.position.copy(dtarget).add(V(Math.sin(t*.2)*.09,Math.sin(t*.7)*.04,0));
  else if(t<59)drone.position.copy(mix(dtarget,home.clone().add(V(0,2.2,0)),(t-52)/7));
  else if(t<63)drone.position.copy(mix(home.clone().add(V(0,2.2,0)),home,(t-59)/4));
  else drone.position.copy(mix(home,V(4.4,3.7,8.4),(t-63)/3)).add(V(0,Math.sin(t)*.025,0));
  const state={updated_at:Date.now()/1000,thrust_n:t<1.4||t>61&&t<63?0:world.config.flight.mass_kg*9.81,velocity:[0,0,0,0,0,0],wind_mps:[.35,.15,0]};
  if(t<3)aim(mix(V(1.15,.58,9.2),V(.88,.65,9.0),u),home.clone().add(V(0,.11,0)),48);
  else if(t<9)aim(mix(V(2.5,1.2,11.4),V(5.1,3.6,12.4),u),drone.position.clone().add(V(0,-.15,0)),43);
  else if(t<14)aim(drone.position.clone().add(V(2.2,.85,3.8)),drone.position.clone().add(V(-.25,-.2,-.3)),45);
  else if(t<21){filmCamera.position.copy(sensor.position);filmCamera.quaternion.copy(sensor.quaternion);filmCamera.fov=sensor.fov;filmCamera.updateProjectionMatrix();filmCamera.updateMatrixWorld(true);}
  else if(t<26){const p=vehicles[0].position;aim(p.clone().add(V(2,.48,2.5)),p.clone().add(V(0,.48,0)),45);}
  else if(t<31){const center=team[1].clone().add(V(0,.6,0));aim(mix(center.clone().add(V(1,9,21)),center.clone().add(V(-1,8,20)),u),center,50)}
  else if(t<39){const middle=pp.clone().lerp(atWork.clone().add(V(0,.7,0)),.35),side=heroPos.clone().sub(pp);side.y=0;side.normalize();const tangent=V(-side.z,0,side.x);aim(middle.clone().addScaledVector(side,3.5).addScaledVector(tangent,1.35).add(V(0,.5,0)),middle.clone().add(V(0,.2,0)),46)}
  else if(t<46){const center=vehicles[0].rover.bin.getWorldPosition(V()),side=heroPos.clone().sub(pp);side.y=0;side.normalize();const tangent=V(-side.z,0,side.x);aim(center.clone().addScaledVector(side,2.1).addScaledVector(tangent,.8).add(V(0,1.25,0)),center.clone().add(V(0,.25,0)),42)}
  else if(t<52){const center=team[1].clone().add(V(0,.7,0));aim(mix(center.clone().add(V(-1,9,21)),center.clone().add(V(2,8,22)),u),center,50)}
  else if(t<59){const center=vehicles[1].position.clone().add(V(0,.5,0));aim(center.clone().add(V(5,3,6.5)),center,48)}
  else if(t<63)aim(mix(V(8.8,2.1,13.7),V(9.5,2.7,14.8),u),V(3.2,.8,8),45);
  else{
   const elapsed=t-63,raised=ease(elapsed/1.8),rock=elapsed>2?Math.sin((elapsed-2)*Math.PI/1.6)*ease((elapsed-2)/.5):0;
   const centerX=(stations[0].x+stations[1].x)/2,baseY=(vehicles[0].position.y+vehicles[1].position.y)/2;
   const top=baseY+lerp(1.46,1.61,raised)+.035*rock,z=stations[0].z+3.56+.12*rock,tilt=.42*rock;
   flag.visible=true;flag.position.set(centerX,top,z);
   for(let i=0;i<pa.count;i++){const u=flagBase[i*3]/flagWidth+.5,v=.5-flagBase[i*3+1]/flagHeight;
    pa.setXYZ(i,...clothPoint(u,v,elapsed,{width:flagWidth,height:flagHeight,tilt}));
   }pa.needsUpdate=true;flagGeo.computeVertexNormals();
   vehicles.slice(0,2).forEach((v,i)=>{const grip=V(centerX+(i===0?-1:1)*flagWidth/2,top,z),solved=v.solve(grip);if(!solved)throw Error('Flag grip outside arm reach');v.rover.pose(solved.angles,{opening:.05});});
   // An open, upright gripper: raise, hold, three broad side-to-side waves, hold.
   const salute=vehicles[2],raise=ease(elapsed/1.4),phase=clamp((elapsed-1.9)/4.5),wave=elapsed>=1.9&&elapsed<6.4?Math.sin(phase*Math.PI*6):0;
   const raisedAngles=[.78*wave,.60,.50,.47,0,.48*wave],angles=folded[2].map((a,i)=>lerp(a,raisedAngles[i],raise));
   salute.rover.pose(angles,{opening:raise});
   const look=V(4.6,baseY+1.1,11),pull=ease((elapsed-4)/5);aim(V(lerp(8,9,pull),baseY+lerp(3.2,5,pull),lerp(28,34,pull)),look,43);
  }

  // Reuse streamed terrain, tree/fruit meshes and original vehicle LODs.
  environment.updateWind(t);updateDetail(t>=14&&t<21?sensor.position:filmCamera.position,true);prepareScene(filmCamera);
  const detached=stage&&['withdrawing','lifting','carrying','depositing','releasing','clearing','folding'].includes(stage.kind);
  if(target&&t>=31&&detached){
   hideTarget();payload.visible=true;payload.rotation.set(0,target.angle,0);
   if(t<releaseAt)payload.position.copy(vehicles[0].rover.tcp.localToWorld(attachmentLocal.clone()));
   else{const binLocal=V(...vehicles[0].spec.base.bin_center),floorY=binLocal.y-.0825,dt=t-releaseAt;
    const support=angles=>{const axisY=Math.cos(angles[0])*Math.cos(angles[2]);return Math.hypot(target.radii_m[2]*1.05*axisY,target.radii_m[0]*1.15*Math.sqrt(1-axisY*axisY));};
    const impactSupport=support([.14,0,1.1]),drop=Math.max(.02,releaseLocal.y-floorY-impactSupport);
    const gravity=9.81,hit=Math.sqrt(2*drop/gravity),angles=tumbleAngles(dt,hit);
    const local=releaseLocal.clone();local.y-=fallDistance(dt,drop,{gravity,restitution:.16});if(dt>=hit)local.y+=support(angles)-impactSupport;local.y=Math.max(local.y,floorY+support(angles));const settle=ease(dt/1.15);local.x=lerp(releaseLocal.x,binLocal.x,settle);local.z=lerp(releaseLocal.z,binLocal.z,settle);payload.position.copy(vehicles[0].rover.root.localToWorld(local));payload.rotation.set(angles[0],target.angle+angles[1],0,'YXZ');payload.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(releaseSpinAxis,angles[2]));}
  }
  sun.position.copy(filmCamera.position).add(V(-18,32,16));sun.target.position.copy(t>=63?V(4.4,0,7):pp);sun.target.updateMatrixWorld();
  sky.material.uniforms.sunPosition.value.copy(V(-.5,.48,.55)).normalize();
  droneExperience.update(1/24,state,filmCamera,{latestTelemetryAt:Date.now()/1000});
  renderer.shadowMap.needsUpdate=true;renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);renderer.clear();renderer.render(scene,filmCamera);
  const box=$('film-detection');box.style.display='none';detectionPlate.style.display=t>=14&&t<21?'block':'none';
  if(t>=15.1&&t<20.7&&detection){const pred=detection.selected,[x1,y1,x2,y2]=pred.bbox;box.style.display='block';const scale=H/detection.height,offset=(detection.width*scale-W)/2;box.style.left=(x1*scale-offset)+'px';box.style.top=y1*scale+'px';box.style.width=(x2-x1)*scale+'px';box.style.height=(y2-y1)*scale+'px';box.firstElementChild.textContent=`${detection.names[pred.class_id]} · ${(pred.confidence*100).toFixed(0)}% confianza`}
  return {time:t,chapter:chapter.k,target:target?.id,drawCalls:renderer.info.render.calls};
 }
 async function infer(){render(16);const c=document.createElement('canvas');c.width=640;c.height=800;c.getContext('2d').drawImage(canvas,0,0,640,800);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.94));const res=await fetch('/film/infer',{method:'POST',body:blob});if(!res.ok)throw Error(await res.text());const result=await res.json();const candidates=result.predictions.filter(p=>p.class_id!==0&&p.confidence>=world.config.inspection.alert_threshold).sort((a,b)=>b.confidence-a.confidence);if(!candidates.length)return result;detection={...result,selected:candidates[0]};detectionImage=blob;await fetch('/film/save/detection-frame.jpg',{method:'POST',body:blob});await fetch('/film/save/detection.json',{method:'POST',body:JSON.stringify(detection,null,2)});return detection}
 const candidates=world.pods.filter(p=>{const pos=to3(p.position),h=pos.y-ground(pos.x,pos.z);return p.label!=='healthy'&&pos.distanceTo(home)<26&&h>.85&&h<1.45}).sort((a,b)=>to3(a.position).distanceTo(home)-to3(b.position).distanceTo(home));
 let selected;
 for(const pod of candidates){try{selected=configureTarget(pod);break}catch{}}
 if(!selected)throw Error('No reachable target in this scene');
 render(0);
 return {render,get diagnostics(){return {routes:tracks.map(t=>t.points),separation:minimumSeparation(tracks),releaseAt,releaseLocal:releaseLocal.toArray(),attachmentLocal:attachmentLocal.toArray(),trees:environment.stats}},restoreDetection(saved){configureTarget(world.pods.find(p=>p.id===saved.target_id));sensor.position.fromArray(saved.sensor.position);sensor.quaternion.fromArray(saved.sensor.quaternion);sensor.fov=saved.sensor.fov;sensor.updateProjectionMatrix();sensor.updateMatrixWorld(true);detection=saved;return {target:target.id,confidence:saved.selected.confidence};},setSensorView({distance=1.12,angle=0,height=.14}={}){const pp=to3(target.position),plant=world.plants.find(p=>p.id===target.plant_id),dir=pp.clone().sub(to3(plant.position));dir.y=0;dir.normalize().applyAxisAngle(V(0,1,0),angle);sensor.position.copy(pp).addScaledVector(dir,distance).add(V(0,height,0));sensor.lookAt(pp);sensor.updateMatrixWorld(true);},configureTarget:id=>configureTarget(world.pods.find(p=>p.id===id)),infer,candidates:candidates.slice(0,30).map(p=>({id:p.id,label:p.label,position:p.position})),get detection(){return detection},get selected(){return {id:target.id,heroPos:heroPos.toArray(),planDuration}},chapters,duration:72,width:W,height:H,camera:filmCamera,preview(){preview=true;previewStart=performance.now();const loop=()=>{if(!preview)return;render((performance.now()-previewStart)/1000%72);requestAnimationFrame(loop)};loop()},stop(){preview=false}};
}
