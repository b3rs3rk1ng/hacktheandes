import * as THREE from 'three';
import {RoundedBoxGeometry} from '../vendor/RoundedBoxGeometry.js';
import {rotorLayout,clamp} from './rotor-core.mjs';
import {batchRigidParts} from '../robotics/batch-rigid-parts.js';
import {cageEdges} from './cage-geometry.mjs';
const Y=new THREE.Vector3(0,1,0),Q=new THREE.Quaternion();
// Original procedural inspection model, visually informed by a geodesic-cage
// industrial drone. It does not reproduce Flyability's proprietary mechanics.
export function createGuardedDrone(cfg){
 const root=new THREE.Group();root.name='Dron de inspección protegido';const chassis=new THREE.Group();chassis.name='Chasis interno';root.add(chassis);
 const radius=cfg.flight.cage_radius_m??.285,centerY=cfg.flight.cage_center_y_m??.045;
 const materials={carbon:new THREE.MeshStandardMaterial({color:0x252d2b,roughness:.46,metalness:.40}),body:new THREE.MeshStandardMaterial({color:0x303937,roughness:.40,metalness:.20}),alloy:new THREE.MeshStandardMaterial({color:0xadb7b5,roughness:.29,metalness:.80}),rubber:new THREE.MeshStandardMaterial({color:0x101714,roughness:.91}),red:new THREE.MeshStandardMaterial({color:0xbf3d22,roughness:.37,metalness:.15}),glass:new THREE.MeshPhysicalMaterial({color:0x123038,metalness:.55,roughness:.08,clearcoat:1})};
 const mesh=(g,m,p,parent=chassis)=>{const o=new THREE.Mesh(g,m);o.position.set(...p);o.castShadow=o.receiveShadow=true;parent.add(o);return o};
 const box=(s,m,p,parent=chassis,r=.01)=>mesh(new RoundedBoxGeometry(...s,2,r),m,p,parent);
 const tube=(a,b,r,m,parent=chassis)=>{a=new THREE.Vector3(...a);b=new THREE.Vector3(...b);const d=b.clone().sub(a);const o=mesh(new THREE.CylinderGeometry(r,r,d.length(),8),m,a.clone().add(b).multiplyScalar(.5).toArray(),parent);o.quaternion.setFromUnitVectors(Y,d.normalize());return o};
 box([.28,.063,.15],materials.body,[0,-.018,0],chassis,.023);
 box([.205,.026,.11],materials.carbon,[-.018,.025,0],chassis,.009);
 box([.167,.063,.084],materials.rubber,[-.025,.124,0],chassis,.012);
 box([.155,.015,.08],materials.carbon,[-.025,.163,0]);
 for(const x of [-.079,.027]){box([.014,.064,.093],materials.alloy,[x,.123,0],chassis,.003);box([.018,.012,.028],materials.rubber,[x,.166,0],chassis,.003)}
 // LiDAR/VIO-style sensor housings and forward floodlights, without brand marks.
 box([.045,.038,.081],materials.red,[.158,-.025,0],chassis,.009);
 const cameraPosition=new THREE.Vector3(cfg.camera.offset_m[0],cfg.camera.offset_m[2],-cfg.camera.offset_m[1]);
 const gimbal=new THREE.Group();gimbal.position.copy(cameraPosition);gimbal.name='Centro óptico orientable';chassis.add(gimbal);
 tube([.13,-.025,0],[cameraPosition.x-.030,cameraPosition.y+.024,cameraPosition.z],.006,materials.alloy);
 box([.039,.042,.046],materials.red,[-.027,0,0],gimbal,.006);
 const lens=mesh(new THREE.CylinderGeometry(.014,.017,.012,24),materials.glass,[-.006,0,0],gimbal);lens.rotation.z=-Math.PI/2;
 const rim=mesh(new THREE.TorusGeometry(.017,.0025,6,24),materials.rubber,[-.001,0,0],gimbal);rim.rotation.y=Math.PI/2;
 const leds=new THREE.MeshStandardMaterial({color:0xece7cb,emissive:0xece0af,emissiveIntensity:1.5,roughness:.35});
 for(const side of [-1,1]){box([.032,.020,.055],materials.rubber,[.132,-.025,side*.090]);for(let j=0;j<3;j++)box([.003,.009,.010],leds,[.150,-.025,side*(.075+j*.014)],chassis,.001)}
 const layout=rotorLayout(cfg.flight),rotors=[];
 const bladeGeometry=(()=>{const p=[],uv=[],ix=[],r=cfg.flight.rotor_radius_m;for(let i=0;i<=12;i++){const u=i/12,x=.012+(r-.012)*u,c=r*(.18*Math.sin(Math.PI*(.12+u*.87))+.018),s=r*.1*u*u,t=.38-.28*u;for(const side of [-1,1]){const z=s+side*c/2;p.push(x,-z*Math.sin(t),z*Math.cos(t));uv.push(u,side===1?1:0)}}for(let i=0;i<12;i++){const a=i*2;ix.push(a,a+1,a+2,a+1,a+3,a+2)}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;})();
 const bladeMat=materials.carbon.clone();bladeMat.side=THREE.DoubleSide;
 for(const [i,l] of layout.entries()){
  const [x,y,z]=l.position,r=cfg.flight.rotor_radius_m;
  tube([x*.25,-.002,z*.25],[x,y-.02,z],.009,materials.carbon);
  mesh(new THREE.CylinderGeometry(.018,.021,.021,20),materials.alloy,[x,y-.015,z]);
  mesh(new THREE.CylinderGeometry(.020,.020,.022,24),materials.carbon,[x,y+.004,z]);
  // Thin shroud and cross braces keep the blades inside a protected envelope.
  const ring=mesh(new THREE.TorusGeometry(r+.008,.0045,6,56),materials.carbon,[x,y+.024,z]);ring.rotation.x=-Math.PI/2;
  for(let j=0;j<3;j++){const a=j*Math.PI*2/3;tube([x,y-.008,z],[x+Math.cos(a)*(r+.008),y+.020,z+Math.sin(a)*(r+.008)],.0025,materials.carbon)}
  const spin=new THREE.Group();spin.position.set(x,y+.027,z);spin.name=`Hélice ${i+1}`;chassis.add(spin);
  for(let j=0;j<2;j++){const b=mesh(bladeGeometry,bladeMat,[0,0,0],spin);b.rotation.y=j*Math.PI;b.scale.z=l.direction;}
  mesh(new THREE.CylinderGeometry(.008,.010,.010,10),materials.alloy,[0,.004,0],spin);
  const blurMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{opacity:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform float opacity;void main(){float r=length(vUv-.5)*2.;float a=smoothstep(.13,.25,r)*(1.-smoothstep(.88,1.,r));gl_FragColor=vec4(.24,.27,.25,opacity*a*(.82+.18*sin(r*70.)));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
  const blur=mesh(new THREE.PlaneGeometry(r*2,r*2),blurMat,[x,y+.029,z]);blur.rotation.x=-Math.PI/2;blur.castShadow=blur.receiveShadow=false;rotors.push({spin,blur});
 }
 const cage=new THREE.Group();cage.name='Jaula protectora geodésica';root.add(cage);
 const sphere=new THREE.IcosahedronGeometry(radius,1),edges=cageEdges(sphere.attributes.position.array,sphere.index?.array,{radius,centerY});sphere.dispose();
 const struts=new THREE.InstancedMesh(new THREE.CylinderGeometry(.0023,.0023,1,6),materials.carbon,edges.length),temp=new THREE.Object3D(),joints=[];const jointMap=new Set();
 for(const [i,e] of edges.entries()){const a=new THREE.Vector3(...e.a),b=new THREE.Vector3(...e.b),d=b.clone().sub(a);temp.position.copy(a).add(b).multiplyScalar(.5);temp.quaternion.setFromUnitVectors(Y,d.clone().normalize());temp.scale.set(1,d.length(),1);temp.updateMatrix();struts.setMatrixAt(i,temp.matrix);
  for(const p of [e.a,e.b]){const key=p.map(n=>n.toFixed(4)).join(',');if(!jointMap.has(key)){jointMap.add(key);joints.push(p)}}
 }struts.castShadow=struts.receiveShadow=true;cage.add(struts);
 const nodes=new THREE.InstancedMesh(new THREE.SphereGeometry(.0042,7,5),materials.rubber,joints.length);joints.forEach((p,i)=>{temp.position.set(...p);temp.quaternion.identity();temp.scale.setScalar(1);temp.updateMatrix();nodes.setMatrixAt(i,temp.matrix)});nodes.castShadow=true;cage.add(nodes);
 // Rigid chassis mounts with short elastomer isolators under the outer cage.
 for(const side of [-1,1]){tube([0,-.020,side*.070],[0,-.10,side*.18],.004,materials.alloy);mesh(new THREE.SphereGeometry(.008,10,6),materials.rubber,[0,-.10,side*.18]);}
 const status=new THREE.MeshStandardMaterial({color:0xd5532e,emissive:0xa93816,emissiveIntensity:.8});box([.009,.013,.016],status,[-.145,-.018,0],chassis,.002);
 // Keep the legacy harvesting articulation contract; this guarded airframe is
 // inspection-only. Picking belongs to the separate ground robot.
 const batching=batchRigidParts([chassis,gimbal]);
 root.userData={batching,cageRadius:radius,collisionCenter:[0,centerY,0],reference:'Inspired by industrial caged inspection drones; not a calibrated Elios replica',cageStruts:edges.length};
 return {root,fingers:[],rotors,gimbal,cage,update(state,cameraQuaternion){
  state.rotors.forEach((r,i)=>{const p=rotors[i],blur=clamp((r.omega-45)/100,0,1);p.spin.rotation.y=r.angle;p.spin.visible=blur<.85;p.blur.visible=blur>.01;p.blur.material.uniforms.opacity.value=.22*blur});
  if(cameraQuaternion){Q.copy(root.quaternion).invert().multiply(cameraQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));gimbal.quaternion.copy(Q);}
 }};
}
