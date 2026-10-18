import * as THREE from 'three';
import {RoundedBoxGeometry} from '../vendor/RoundedBoxGeometry.js';
import {rotorLayout,clamp} from './rotor-core.mjs';
const Y=new THREE.Vector3(0,1,0);
export function createInspectionDrone(cfg){
 const root=new THREE.Group();root.name='Dron de inspección · multirrotor';
 const body=new THREE.Group();body.name='Chasis';root.add(body);
 const mat={shell:new THREE.MeshStandardMaterial({color:0xd5d8d5,roughness:.31,metalness:.18}),carbon:new THREE.MeshStandardMaterial({color:0x202625,roughness:.48,metalness:.35}),rubber:new THREE.MeshStandardMaterial({color:0x171a19,roughness:.9}),alloy:new THREE.MeshStandardMaterial({color:0x9ba6a6,metalness:.85,roughness:.28}),orange:new THREE.MeshStandardMaterial({color:0xcd632b,roughness:.45,metalness:.2}),glass:new THREE.MeshPhysicalMaterial({color:0x102d35,metalness:.65,roughness:.08,clearcoat:1})};
 const mesh=(g,m,p,parent=body)=>{const o=new THREE.Mesh(g,m);o.position.set(...p);o.castShadow=o.receiveShadow=true;parent.add(o);return o};
 const box=(s,m,p,parent=body,r=.012)=>mesh(new RoundedBoxGeometry(...s,2,r),m,p,parent);
 const tube=(a,b,r,m,parent=body)=>{a=new THREE.Vector3(...a);b=new THREE.Vector3(...b);const o=mesh(new THREE.CylinderGeometry(r,r,a.distanceTo(b),10),m,a.clone().add(b).multiplyScalar(.5).toArray(),parent);o.quaternion.setFromUnitVectors(Y,b.sub(a).normalize());return o};
 const bolt=(p,parent=body)=>mesh(new THREE.CylinderGeometry(.0035,.0035,.003,6),mat.alloy,p,parent);
 box([.33,.092,.255],mat.carbon,[0,-.008,0]);
 box([.29,.082,.232],mat.shell,[.008,.051,0],body,.03);
 box([.232,.072,.144],mat.rubber,[-.037,.120,0]);
 box([.218,.028,.132],mat.carbon,[-.037,.165,0]);
 for(const x of [-.108,.043]){box([.018,.073,.151],mat.rubber,[x,.128,0],body,.004);box([.024,.008,.028],mat.alloy,[x,.169,.025],body,.002)}
 for(const x of [-.12,.12])for(const z of [-.09,.09])bolt([x,.095,z]);
 // Nose bumper, cooling slots and rear battery connector.
 box([.026,.048,.185],mat.orange,[.157,.022,0],body,.008);
 for(let i=0;i<7;i++)for(const z of [-.118,.118])box([.008,.014,.003],mat.rubber,[-.09+i*.021,.062,z],body,.001);
 box([.026,.024,.039],mat.orange,[-.174,.067,.044]);tube([-.177,.065,.044],[-.19,.105,.02],.003,mat.rubber);
 for(const z of [-.054,.054]){tube([-.13,.09,z],[-.18,.22,z],.003,mat.rubber);mesh(new THREE.SphereGeometry(.004,8,6),mat.rubber,[-.18,.22,z]);}
 const layout=rotorLayout(cfg.flight),rotors=[];
 function bladeGeometry(radius){
  const p=[],indices=[],uv=[],steps=13;
  for(let i=0;i<=steps;i++){const u=i/steps,x=.015+(radius-.015)*u,chord=radius*(.19*Math.sin(Math.PI*(.15+u*.84))+.012),sweep=radius*.10*u*u,twist=.35-.25*u;
   for(const side of [-1,1]){const z=sweep+side*chord/2;p.push(x,-z*Math.sin(twist)+.002*Math.sin(u*Math.PI),z*Math.cos(twist));uv.push(u,side===1?1:0)}
  }
  for(let i=0;i<steps;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
 }
 const propMat=mat.carbon.clone();propMat.side=THREE.DoubleSide;
 const blade=bladeGeometry(cfg.flight.rotor_radius_m);
 for(const [i,l] of layout.entries()){
  const [x,y,z]=l.position;
  tube([Math.sign(x)*.09,.005,Math.sign(z)*.08],[x,y-.026,z],.018,mat.carbon);
  tube([Math.sign(x)*.11,.020,Math.sign(z)*.08],[x,y-.014,z],.0025,mat.orange);
  box([.060,.018,.025],mat.rubber,[x*.67,y-.022,z*.67]);
  mesh(new THREE.CylinderGeometry(.027,.030,.020,24),mat.carbon,[x,y-.02,z]);
  mesh(new THREE.CylinderGeometry(.026,.026,.032,32),mat.alloy,[x,y+.004,z]);
  const bell=mesh(new THREE.CylinderGeometry(.027,.027,.022,24),mat.carbon,[x,y+.011,z]);
  for(let j=0;j<8;j++){const a=j*Math.PI/4;box([.009,.013,.003],mat.rubber,[x+Math.cos(a)*.026,y+.012,z+Math.sin(a)*.026],body,.001).rotation.y=-a+Math.PI/2;}
  const spin=new THREE.Group();spin.position.set(x,y+.027,z);spin.name=`Rotor ${i+1}`;body.add(spin);
  for(let j=0;j<2;j++){const b=mesh(blade,propMat,[0,0,0],spin);b.rotation.y=j*Math.PI;b.scale.z=l.direction;}
  mesh(new THREE.CylinderGeometry(.012,.013,.012,12),mat.alloy,[0,.005,0],spin);bolt([0,.012,0],spin);
  // Exposure-integrated propeller disc removes discrete blade strobing at FPS.
  const blurMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{opacity:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform float opacity;void main(){float r=length(vUv-.5)*2.;float a=smoothstep(.12,.24,r)*(1.-smoothstep(.84,1.,r));float rings=.75+.25*sin(r*70.);gl_FragColor=vec4(.19,.22,.21,opacity*a*rings);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
  // Shader include directives must start on their own line.
  blurMat.fragmentShader=blurMat.fragmentShader.replace(';#include',';\n#include');
  const blur=mesh(new THREE.PlaneGeometry(cfg.flight.rotor_radius_m*2,cfg.flight.rotor_radius_m*2),blurMat,[x,y+.030,z]);blur.rotation.x=-Math.PI/2;blur.castShadow=blur.receiveShadow=false;
  const lightMat=new THREE.MeshStandardMaterial({color:x>0?0xd8ecbc:0xbf321d,emissive:x>0?0x87a575:0xc32310,emissiveIntensity:1.4,roughness:.3});
  mesh(new THREE.SphereGeometry(.008,10,6),lightMat,[x,y-.035,z]);
  rotors.push({spin,blur,bell});
 }
 // Compliant landing skids retain the collision envelope of the simulator.
 for(const z of [-.18,.18]){tube([-.18,-.219,z],[.20,-.219,z],.009,mat.rubber);for(const x of [-.13,.13]){tube([x,-.035,z*.62],[x,-.21,z],.007,mat.alloy);box([.055,.010,.023],mat.rubber,[x,-.225,z],body,.004)}}
 const cameraPosition=new THREE.Vector3(cfg.camera.offset_m[0],cfg.camera.offset_m[2],-cfg.camera.offset_m[1]);
 tube([.09,-.06,.09],cameraPosition.clone().add(new THREE.Vector3(-.07,.07,0)).toArray(),.009,mat.carbon);
 const gimbal=new THREE.Group();gimbal.position.copy(cameraPosition);body.add(gimbal);
 box([.055,.069,.073],mat.alloy,[-.065,0,0],gimbal,.01);
 box([.064,.047,.058],mat.carbon,[-.034,0,0],gimbal,.009);
 const lens=mesh(new THREE.CylinderGeometry(.020,.022,.012,32),mat.glass,[-.007,0,0],gimbal);lens.rotation.z=-Math.PI/2;
 const ring=mesh(new THREE.TorusGeometry(.022,.003,6,32),mat.rubber,[-.002,0,0],gimbal);ring.rotation.y=Math.PI/2;
 // Keep the existing harvest tool at its physical connector, not a new fake arm.
 const fingers=[];tube([.08,-.025,0],[.43,-.025,0],.012,mat.carbon);box([.049,.027,.15],mat.alloy,[.43,-.025,0]);
 for(const sign of [-1,1]){const f=new THREE.Group();f.position.set(.49,-.015,sign*.10);root.add(f);box([.15,.027,.02],mat.carbon,[0,0,0],f,.005);box([.025,.030,.026],mat.rubber,[.068,0,0],f,.003);fingers.push(f)}
 const cutter=box([.04,.004,.024],mat.alloy,[.555,-.012,.028]);cutter.rotation.y=.3;
 // One material per fixed assembly, never merge rotor/gimbal articulation.
 function batch(parent){const groups=new Map();for(const o of [...parent.children])if(o.isMesh&&o.material!==propMat&&!o.material.isShaderMaterial){const key=o.geometry.type+JSON.stringify(o.geometry.parameters)+o.material.uuid;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o)}
  for(const list of groups.values()){if(list.length<3)continue;const first=list[0],inst=new THREE.InstancedMesh(first.geometry,first.material,list.length);let i=0;for(const o of list){ // Only identical geometry parameters can share an instance buffer.
    if(JSON.stringify(o.geometry.parameters)!==JSON.stringify(first.geometry.parameters))continue;o.updateMatrix();inst.setMatrixAt(i++,o.matrix);parent.remove(o);
   }inst.count=i;inst.castShadow=inst.receiveShadow=true;parent.add(inst)}
 }
 batch(body);
 root.userData.dimensions={rotorRadius:cfg.flight.rotor_radius_m,rotorCenters:layout.map(r=>r.position)};
 return {root,fingers,rotors,gimbal,update(rotorState,cameraQuaternion){
  rotorState.rotors.forEach((r,i)=>{const p=rotors[i],blur=clamp((r.omega-45)/100,0,1);p.spin.rotation.y=r.angle;p.spin.visible=blur<.85;p.blur.material.uniforms.opacity.value=.20*blur;p.blur.visible=blur>.01;});
  if(cameraQuaternion){const q=root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cameraQuaternion);q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));gimbal.quaternion.copy(q);}
 }};
}
