import * as THREE from 'three';
import {RoundedBoxGeometry} from '../vendor/RoundedBoxGeometry.js';
import {batchRigidParts} from './batch-rigid-parts.js';

export function createFieldRover(spec){
  const root=new THREE.Group();root.name='Robot de campo — propuesta';
  const materials={
    shell:new THREE.MeshStandardMaterial({color:0xe9eee7,roughness:.35,metalness:.12}),
    blue:new THREE.MeshStandardMaterial({color:0x263f59,roughness:.36,metalness:.28}),
    metal:new THREE.MeshStandardMaterial({color:0xa7b5bf,roughness:.29,metalness:.82}),
    dark:new THREE.MeshStandardMaterial({color:0x273033,roughness:.57,metalness:.3}),
    rubber:new THREE.MeshStandardMaterial({color:0x202628,roughness:.94}),
    amber:new THREE.MeshStandardMaterial({color:0xc9923e,roughness:.4,metalness:.36}),
    lens:new THREE.MeshPhysicalMaterial({color:0x1c3945,roughness:.08,metalness:.65,clearcoat:1}),
    light:new THREE.MeshStandardMaterial({color:0xe2f1ed,emissive:0xd8ede9,emissiveIntensity:.65,roughness:.25})
  };
  function part(name,geometry,material,parent,position=[0,0,0]){const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(...position);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh}
  const geometryCache=new Map();
  function box(name,size,material,parent,position,radius=.012){const r=Math.min(radius,...size.map(v=>v*.24)),key='box:'+size.join(',')+':'+r;if(!geometryCache.has(key))geometryCache.set(key,new RoundedBoxGeometry(...size,3,r));return part(name,geometryCache.get(key),material,parent,position)}
  function cylinder(name,radius,length,material,parent,position,axis='y',segments=32){const key=`cylinder:${radius}:${length}:${segments}`;if(!geometryCache.has(key))geometryCache.set(key,new THREE.CylinderGeometry(radius,radius,length,segments));const mesh=part(name,geometryCache.get(key),material,parent,position);if(axis==='z')mesh.rotation.x=Math.PI/2;if(axis==='x')mesh.rotation.z=Math.PI/2;return mesh}
  function cable(name,points,radius,parent,material=materials.rubber){const path=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));return part(name,new THREE.TubeGeometry(path,32,radius,7,false),material,parent)}
  function bolts(parent,center,radius,number=6){for(let i=0;i<number;i++){const a=i*Math.PI*2/number;cylinder('Tornillo',.005,.007,materials.dark,parent,[center[0]+Math.cos(a)*radius,center[1]+Math.sin(a)*radius,center[2]],'z',8)}}
  const chassis=new THREE.Group();chassis.name='Chasis';chassis.position.y=spec.base.chassis_lift_m??0;root.add(chassis);
  box('Bastidor inferior',[.86,.11,.49],materials.dark,chassis,[0,.285,0]);
  box('Carcasa principal',[spec.base.body_length_m,.25,spec.base.body_width_m],materials.shell,chassis,[0,.455,0],.045);
  box('Tapa de servicio',[.74,.035,.50],materials.shell,chassis,[-.015,.594,0]);
  box('Junta de carcasa',[.88,.014,.615],materials.dark,chassis,[0,.37,0],.012);
  for(const sign of [-1,1]){
    box('Protección lateral',[.72,.056,.025],materials.dark,chassis,[0,.285,sign*.325]);
    for(let i=0;i<5;i++)box('Rejilla de ventilación',[.045,.075,.005],materials.dark,chassis,[-.23+i*.052,.455,sign*.313],.003);
    cylinder('Luz frontal',.025,.015,materials.light,chassis,[.45,.41,sign*.21],'x');
    cylinder('Piloto trasero',.015,.012,materials.amber,chassis,[-.45,.41,sign*.21],'x');
    cable('Paragolpes',[[.49,.23,sign*.34],[.54,.23,sign*.27],[.54,.23,0]],.016,chassis,materials.dark);
  }
  box('Cámara de navegación',[.035,.06,.17],materials.dark,chassis,[.466,.495,0],.01);
  for(const z of [-.053,.053])cylinder('Óptica frontal',.014,.008,materials.lens,chassis,[.487,.495,z],'x');
  for(const z of [-.24,.24])for(const x of [-.32,.32])cylinder('Fijación tapa',.006,.004,materials.metal,chassis,[x,.615,z],'y',12);

  const cameraMounts={};
  const navigation=new THREE.Object3D();navigation.name='Óptica de navegación';navigation.position.set(...spec.cameras.navigation.position_m);navigation.rotation.z=spec.cameras.navigation.pitch_rad;chassis.add(navigation);cameraMounts.navigation=navigation;
  const wheels=[],radius=spec.base.wheel_radius_m,width=spec.base.wheel_width_m;
  function fitStrut(mesh,a,b){const d=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());mesh.scale.y=d.length();}
  for(const x of [-spec.base.wheelbase_m/2,spec.base.wheelbase_m/2])for(const sign of [-1,1]){
    const steering=new THREE.Group();steering.position.set(x,radius,sign*spec.base.track_m/2);steering.name='Mangueta';root.add(steering);
    const spin=new THREE.Group();spin.name='Rueda';steering.add(spin);
    cylinder('Neumático',radius*.93,width*.78,materials.rubber,spin,[0,0,0],'z',48);
    for(const side of [-1,1]){
      part('Hombro del neumático',new THREE.TorusGeometry(radius*.76,radius*.17,12,48),materials.rubber,spin,[0,0,side*width*.32]);
      cylinder('Llanta',radius*.57,.009,materials.dark,spin,[0,0,side*width*.49],'z');
      cylinder('Disco de aluminio',radius*.42,.012,materials.metal,spin,[0,0,side*width*.54],'z');
      cylinder('Buje',radius*.18,.021,materials.blue,spin,[0,0,side*width*.61],'z');
      bolts(spin,[0,0,side*width*.59],radius*.29,6);
      for(let i=0;i<10;i++){const a=i*Math.PI/5,slot=box('Ranura de llanta',[.018,.035,.003],materials.dark,spin,[Math.sin(a)*radius*.46,Math.cos(a)*radius*.46,side*width*.55],.002);slot.rotation.z=-a;}
    }
    // Open chevrons with deep lugs; dimensions scale with wheel specification.
    for(let i=0;i<20;i++)for(const side of [-1,1]){
      const a=(i+(side>0?.18:0))*Math.PI*2/20,tread=box('Taco todoterreno',[radius*.19,radius*.10,width*.52],materials.rubber,spin,[Math.sin(a)*radius*.95,Math.cos(a)*radius*.95,side*width*.25],.004);
      tread.rotation.z=-a;tread.rotateY(side*.48);
    }
    const swing=cylinder('Brazo de suspensión',.019,1,materials.blue,root,[0,0,0]);
    const damper=cylinder('Amortiguador',.014,1,materials.metal,root,[0,0,0]);
    const coil=[];for(let j=0;j<=96;j++){const a=j/96*Math.PI*12;coil.push([.026*Math.cos(a),-.5+j/96,.026*Math.sin(a)])}
    const spring=cable('Muelle de suspensión',coil,.0045,root,materials.dark);
    wheels.push({steering,spin,swing,damper,spring,x,sign});
  }

  const bin=new THREE.Group();bin.name='Recipiente';bin.position.set(...spec.base.bin_center);root.add(bin);
  box('Fondo de recipiente',[.33,.025,.34],materials.dark,bin,[0,-.095,0]);
  for(const side of [-1,1]){
    box('Pared del recipiente',[.018,.20,.35],materials.shell,bin,[side*.169,0,0]);
    box('Pared del recipiente',[.34,.20,.018],materials.shell,bin,[0,0,side*.177]);
    box('Asa',[.10,.027,.027],materials.dark,bin,[0,.104,side*.177]);
  }
  const arm=new THREE.Group();arm.name='Brazo articulado';arm.position.set(...spec.base.mount);root.add(arm);
  cylinder('Placa de montaje',.116,.024,materials.metal,arm,[0,.012,0]);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;cylinder('Perno de montaje',.006,.007,materials.dark,arm,[Math.cos(a)*.094,.028,Math.sin(a)*.094],'y',8)}
  const joints=[];
  function joint(name,parent,position){const group=new THREE.Group();group.name=name;group.position.set(...position);parent.add(group);joints.push(group);return group}
  const base=joint('J1 · giro de base',arm,[0,0,0]);
  cylinder('Carcasa de giro',.087,.125,materials.blue,base,[0,.079,0]);
  cylinder('Anillo de giro',.091,.017,materials.metal,base,[0,.132,0]);
  const shoulder=joint('J2 · hombro',base,[0,spec.arm.shoulder_height_m,0]);
  function servo(parent,radius=.071){
    cylinder('Motor articulación',radius,.143,materials.blue,parent,[0,0,0],'z');
    for(const sign of [-1,1]){cylinder('Tapa de articulación',radius*.91,.012,materials.shell,parent,[0,0,sign*.077],'z');cylinder('Eje',radius*.29,.014,materials.metal,parent,[0,0,sign*.086],'z');bolts(parent,[0,0,sign*.086],radius*.65,5)}
  }
  function link(parent,length){
    box('Eslabón',[length-.052,.106,.118],materials.blue,parent,[length/2,0,0],.035);
    box('Cubierta del eslabón',[length-.12,.014,.102],materials.shell,parent,[length/2,.057,0],.006);
    box('Inserto metálico',[length-.14,.012,.085],materials.metal,parent,[length/2,-.058,0],.004);
    cable('Cable del eslabón',[[.025,.037,-.073],[length*.28,.085,-.081],[length*.68,.076,-.078],[length-.025,.03,-.071]],.007,parent);
  }
  servo(shoulder,.077);link(shoulder,spec.arm.links_m[0]);
  const elbow=joint('J3 · codo',shoulder,[spec.arm.links_m[0],0,0]);servo(elbow,.068);link(elbow,spec.arm.links_m[1]);
  const wrist=joint('J4 · muñeca',elbow,[spec.arm.links_m[1],0,0]);servo(wrist,.052);
  cylinder('Muñeca',.043,spec.arm.wrist_length_m,materials.metal,wrist,[spec.arm.wrist_length_m/2,0,0],'x');
  const roll=joint('J5 · rotación de herramienta',wrist,[spec.arm.wrist_length_m,0,0]);
  cylinder('Anillo de muñeca',.046,.020,materials.blue,roll,[.01,0,0],'x');
  cylinder('Brida',.038,spec.arm.roll_link_m,materials.shell,roll,[spec.arm.roll_link_m/2,0,0],'x');
  const tilt=joint('J6 · orientación de pinza',roll,[spec.arm.roll_link_m,0,0]);
  cylinder('Eje de herramienta',.029,.09,materials.metal,tilt,[0,0,0],'y');
  const tool=new THREE.Group();tool.name='Pinza y corte';tilt.add(tool);
  box('Actuador de pinza',[.08,.052,.22],materials.amber,tool,[.027,0,0],.009);
  cylinder('Husillo de pinza',.007,.235,materials.metal,tool,[.057,0,0],'z');
  const fingers=[];
  for(const sign of [-1,1]){
    const finger=new THREE.Group();finger.name='Dedo de pinza';tool.add(finger);
    box('Dedo',[.145,.025,.015],materials.metal,finger,[.105,-.005,0],.005);
    box('Almohadilla',[.088,.039,.008],materials.rubber,finger,[.12,-.006,-sign*.01],.004);
    fingers.push({group:finger,sign});
  }
  cable('Soporte de cámara',[[-.075,.015,.11],[-.10,.11,.15],spec.cameras.wrist.position_m],.009,tool,materials.metal);
  const toolCamera=new THREE.Group();toolCamera.position.set(...spec.cameras.wrist.position_m);tool.add(toolCamera);toolCamera.name='Cámara de proximidad';
  box('Cámara RGB-D',[.048,.035,.085],materials.dark,toolCamera,[0,0,0],.008);
  for(const z of [-.027,.027])cylinder('Lente de proximidad',.009,.007,materials.lens,toolCamera,[.028,0,z],'x');
  const wristEye=new THREE.Object3D();wristEye.name='Óptica de pinza';wristEye.position.set(...spec.cameras.wrist.eye_offset_m);toolCamera.add(wristEye);
  const lookDirection=new THREE.Vector3(...spec.cameras.wrist.look_at_m).sub(toolCamera.position).normalize();toolCamera.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),lookDirection);cameraMounts.wrist=wristEye;
  box('Soporte de corte',[.035,.105,.025],materials.dark,tool,[.115,.065,-.044],.005);
  const blade=new THREE.Group();blade.position.set(.14,.126,0);tool.add(blade);blade.name='Cuchilla';
  box('Hoja de corte',[.045,.007,.083],materials.metal,blade,[0,0,0],.002);
  cylinder('Articulación cuchilla',.009,.025,materials.amber,blade,[0,0,-.034],'y');
  const tcp=new THREE.Object3D();tcp.name='Punto de agarre';tcp.position.x=spec.arm.tool_tcp_m;tool.add(tcp);

  // Original project marking, deliberately not the reference manufacturer's logo.
  const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=128;
  const context=labelCanvas.getContext('2d');context.clearRect(0,0,512,128);context.fillStyle='#324b42';context.font='500 75px "Avenir Next",sans-serif';context.fillText('cacao',20,92);
  const labelMaterial=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(labelCanvas),transparent:true,depthWrite:false,roughness:.5});
  for(const sign of [-1,1]){const label=part('Identidad',new THREE.PlaneGeometry(.20,.05),labelMaterial,chassis,[.225,.49,sign*.314]);if(sign<0)label.rotation.y=Math.PI}

  function pose(angles,{opening=1,cut=0,travel=0,steering=0,wheelStates=null}={}){
    joints.forEach((joint,i)=>joint.rotation[spec.arm.axes[i]]=angles[i]);
    for(const {group,sign} of fingers)group.position.z=sign*(.057+.036*opening);
    blade.rotation.y=-.42+cut*.72;
    wheels.forEach((wheel,i)=>{
      const state=wheelStates?.[i];wheel.steering.position.y=state?.y??radius;
      wheel.spin.rotation.z=state?-state.rotation:-travel/radius;wheel.steering.rotation.y=state?.steering??(wheel.x>0?steering:0);
      const hub=new THREE.Vector3(wheel.x,wheel.steering.position.y,wheel.sign*(spec.base.track_m/2-.07));
      fitStrut(wheel.swing,new THREE.Vector3(wheel.x-.13,.30+(spec.base.chassis_lift_m??0),wheel.sign*.24),hub);
      const top=new THREE.Vector3(wheel.x+.07,.43+(spec.base.chassis_lift_m??0),wheel.sign*.26),bottom=hub.clone().add(new THREE.Vector3(.025,.015,0));
      fitStrut(wheel.damper,top,bottom);fitStrut(wheel.spring,top,bottom);
    });
    root.updateMatrixWorld(true);
  }
  const rigidFrames=[];root.traverse(node=>{if(node.isGroup&&node!==root)rigidFrames.push(node)});
  const batching=batchRigidParts(rigidFrames);
  pose(spec.arm.folded_rad);
  return {root,joints,wheels,tcp,bin,tool,arm,materials,cameraMounts,batching,pose};
}
