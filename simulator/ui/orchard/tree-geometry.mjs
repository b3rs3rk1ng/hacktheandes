import * as THREE from '../vendor/three.module.js';

const Y=new THREE.Vector3(0,1,0),to3=p=>new THREE.Vector3(p[0],p[2],-p[1]);

// Closed tapered branches. Rounded ends overlap at shared nodes, so bends and
// forks have no open cross-section. Distant geometry uses inexpensive flat caps.
export function appendTube(vertices,colors,uvs,faces,base,bone,tone,detailed=true){
 const start=base.clone().add(to3(bone)),end=base.clone().add(to3(bone.slice(3))),axis=end.clone().sub(start),length=axis.length();axis.normalize();
 const normal=new THREE.Vector3().crossVectors(axis,Math.abs(axis.y)>.95?new THREE.Vector3(1,0,0):Y).normalize(),binormal=new THREE.Vector3().crossVectors(axis,normal).normalize();
 const sides=bone[8]===0?9:bone[8]===1?7:5;
 function vertex(p,u,v){const index=vertices.length/3;vertices.push(...p.toArray());uvs.push(u,v);const moss=bone[8]===0?Math.max(0,1-(p.y-base.y)/.65):0;colors.push(tone*(.83-moss*.13),tone*(.86+moss*.03),tone*(.80-moss*.15));return index}
 function ring(center,radius,v){const offset=vertices.length/3;for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2;vertex(center.clone().addScaledVector(normal,Math.cos(a)*radius).addScaledVector(binormal,Math.sin(a)*radius),j/sides*1.6,v)}return offset}
 function join(a,b){for(let j=0;j<sides;j++)faces.push(a+j,a+j+1,b+j,a+j+1,b+j+1,b+j)}
 const first=ring(start,bone[6],0),last=ring(end,bone[7],length*1.8);join(first,last);
 for(const sign of [-1,1]){
  const point=sign<0?start:end,radius=bone[sign<0?6:7],v=sign<0?0:length*1.8;let edge=sign<0?first:last;
  if(detailed&&radius>=.03){const dome=ring(point.clone().addScaledVector(axis,sign*radius*Math.SQRT1_2),radius*Math.SQRT1_2,v);if(sign<0)join(dome,edge);else join(edge,dome);edge=dome}
  const pole=vertex(point.clone().addScaledVector(axis,detailed?sign*radius:0),.5,v);
  for(let j=0;j<sides;j++)if(sign<0)faces.push(pole,edge+j+1,edge+j);else faces.push(pole,edge+j,edge+j+1);
 }
}
