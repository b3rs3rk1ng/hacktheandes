import * as THREE from 'three';
import {heightAt,terrainMesh} from './terrain.mjs';
import {sectorStream} from './sector-stream.mjs';
import {appendTube} from './tree-geometry.mjs';

const Y=new THREE.Vector3(0,1,0),to3=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const hash=(x,y)=>Math.imul(x^0x45d9f3b,0x45d9f3b)^Math.imul(y^0x119de1f3,0x119de1f3);
const rounded=(v,n=5)=>Number(v.toFixed(n));

export function leafGeometry(rows=3,columns=2){
 const p=[],uv=[],indices=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){const u=i/columns,v=j/rows;p.push(u-.5,v,.13*Math.sin(v*Math.PI)+.10*(u-.5)**2-.12*v*v);uv.push(u,v)}
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){const a=j*(columns+1)+i;indices.push(a,a+1,a+columns+1,a+1,a+columns+2,a+columns+1)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

function bakeLeafCluster(renderer,leafMap){
 const scene=new THREE.Scene(),geometry=leafGeometry(4,2),material=new THREE.MeshBasicMaterial({map:leafMap,transparent:true,alphaTest:.5,side:THREE.DoubleSide});
 const r=rng(117);for(let i=0;i<9;i++){const leaf=new THREE.Mesh(geometry,material);const side=i%2?-1:1;leaf.position.set(side*.10,-.23+i/8*.38,(r()-.5)*.05);leaf.scale.set(.13+r()*.03,.31+r()*.08,.14);leaf.rotation.z=side*(.75+r()*.48)+(i===8?-.7:0);leaf.rotation.y=(r()-.5)*.55;scene.add(leaf)}
 const camera=new THREE.OrthographicCamera(-.48,.48,.48,-.48,.01,5);camera.position.z=2;
 const target=new THREE.WebGLRenderTarget(512,512);target.texture.colorSpace=THREE.SRGBColorSpace;target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
 const previousTarget=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),tone=renderer.toneMapping;
 renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.toneMapping=THREE.NoToneMapping;renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(previousTarget);renderer.setClearColor(clear,alpha);renderer.toneMapping=tone;geometry.dispose();material.dispose();return target.texture;
}

function clusterGeometry(){
 const positions=[],uv=[],indices=[];
 const planes=[[-.48,-.48,0,.48,-.48,0,.48,.48,0,-.48,.48,0],[0,-.48,-.48,0,-.48,.48,0,.48,.48,0,.48,-.48],[-.48,0,-.48,.48,0,-.48,.48,0,.48,-.48,0,.48]];
 for(const plane of planes){const start=positions.length/3;positions.push(...plane);uv.push(0,0,1,0,1,1,0,1);indices.push(start,start+1,start+2,start,start+2,start+3)}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function createEnvironment(scene,world,textures,renderer){
 const cfg=world.config,terrain=world.terrain,vcfg=cfg.vegetation||{},tcfg=cfg.terrain||{},wind={value:0};
 const temp=new THREE.Object3D(),tint=new THREE.Color(),farRanges=new Map(),activeNear=new Set();
 const stats={treeCells:0,bones:0,farClusters:0,nearLeaves:0,litterLeaves:0,terrainTriangles:0,residentTrees:0,nearTrees:0,backgroundClusters:0,disposedCells:0};
 const bark=new THREE.MeshStandardMaterial({map:textures.barkMap,normalMap:textures.barkNormal,normalScale:new THREE.Vector2(.22,.22),vertexColors:true,roughness:.91});
 const leafMaterial=new THREE.MeshStandardMaterial({map:textures.leafMap,alphaTest:.55,side:THREE.DoubleSide,roughness:.85,emissive:0x233218,emissiveIntensity:.09});
 leafMaterial.onBeforeCompile=shader=>{shader.uniforms.uForestWind=wind;shader.vertexShader='uniform float uForestWind;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.z+=sin(uForestWind*1.3+instanceMatrix[3].x*.3+instanceMatrix[3].z*.4)*.025*uv.y*uv.y;\n#endif');};
 const litterMaterial=new THREE.MeshStandardMaterial({map:textures.leafMap,alphaTest:.6,side:THREE.DoubleSide,roughness:1});
 litterMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat leafLuma=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=vec3(.66+leafLuma*.62);');};
 function instanced(geometry,material,count,shadow=true){const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);return mesh}
 function put(mesh,index,position,scale,quaternion,color){temp.position.copy(position);temp.quaternion.copy(quaternion);temp.scale.set(...scale);temp.updateMatrix();mesh.setMatrixAt(index,temp.matrix);if(color)mesh.setColorAt(index,color)}
 const curvedLeaves=leafGeometry(3,2),clusters=clusterGeometry(),clusterMaterial=leafMaterial.clone();clusterMaterial.map=bakeLeafCluster(renderer,textures.leafMap);clusterMaterial.onBeforeCompile=leafMaterial.onBeforeCompile;

 // A single coarse collision/render surface. Fine texture detail adds no vertices.
 const surface=terrainMesh(terrain),positions=[],uv=[],indices=surface.indices;
 for(let i=0;i<surface.positions.length;i+=3){const [east,north,h]=surface.positions.slice(i,i+3);positions.push(east,h,-north);uv.push(east/(tcfg.texture_tile_m||2.2),north/(tcfg.texture_tile_m||2.2))}
 const groundGeometry=new THREE.BufferGeometry();groundGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));groundGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));groundGeometry.setIndex(indices);groundGeometry.computeVertexNormals();
 const groundMaterial=new THREE.MeshStandardMaterial({map:textures.groundMap,normalMap:textures.groundNormal,normalScale:new THREE.Vector2(.55,.55),roughness:1,color:0xc7bca8});
 const pathCode=(tcfg.paths||[]).map(path=>{const [a,b]=[path.start,path.end].map(p=>[p[0],-p[1]]);return `{vec2 a=vec2(${a.map(v=>v.toFixed(4))}),b=vec2(${b.map(v=>v.toFixed(4))});vec2 ab=b-a;float t=clamp(dot(vForestGround-a,ab)/dot(ab,ab),0.,1.);float d=length(vForestGround-a-t*ab);pathWeight=max(pathWeight,1.-smoothstep(${(path.width*.3).toFixed(4)},${(path.width*.7).toFixed(4)},d));}`}).join('\n');
 groundMaterial.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec2 vForestGround;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvForestGround=(modelMatrix*vec4(transformed,1.)).xz;');
  shader.fragmentShader='varying vec2 vForestGround;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>\nfloat macroNoise=sin(vForestGround.x*.16+sin(vForestGround.y*.11))*sin(vForestGround.y*.19+vForestGround.x*.05);diffuseColor.rgb*=.88+macroNoise*.13;float pathWeight=0.;${pathCode}\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.17,.125,.085)*(.9+macroNoise*.12),pathWeight*.88);`);
 };
 const ground=new THREE.Mesh(groundGeometry,groundMaterial);ground.name='Terreno compartido con física';ground.receiveShadow=true;scene.add(ground);stats.terrainTriangles=indices.length/3;

 const woody=world.plants.filter(p=>p.crop!=='maize'),cells=new Map(),cellSize=vcfg.cell_size_m||20;
 for(const plant of woody){const key=`${Math.floor(plant.position[0]/cellSize)},${Math.floor(plant.position[1]/cellSize)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(plant)}
 const countPerShoot=vcfg.leaves_per_shoot||7;
 function shootRecords(plant){
  if(plant.structure)return plant.structure.shoots;
  // Existing secondary crops remain visual approximations; they share batching/LOD.
  const r=rng(plant.seed),out=[],h=plant.crop==='coffee'?1.7:plant.height;
  for(let i=0;i<14;i++){const a=r()*Math.PI*2,rad=r()*(plant.crop==='coffee'?.65:.9);out.push([Math.cos(a)*rad,Math.sin(a)*rad,h*.70+r()*.28,a,plant.crop==='banana'?2.5:.75,Math.floor(r()*1e6)])}
  return out;
 }
 function forLeaves(plant,callback){let index=0;const base=to3(plant.position);
  for(const shoot of shootRecords(plant)){const r=rng(shoot[5]),origin=base.clone().add(to3(shoot));for(let j=0;j<countPerShoot;j++){
   const side=j%2?-1:1,az=shoot[3]+side*(.48+r()*.68),pitch=-.15-r()*.65;
   const distance=(j/(countPerShoot-1))*.40;const position=origin.clone().add(new THREE.Vector3(Math.cos(shoot[3])*distance,.015-Math.abs(j-3)*.008,-Math.sin(shoot[3])*distance));
   const direction=new THREE.Vector3(Math.cos(az)*Math.cos(pitch),Math.sin(pitch),-Math.sin(az)*Math.cos(pitch)),quaternion=new THREE.Quaternion().setFromUnitVectors(Y,direction);
   quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y,(r()-.5)*.45));
   const length=(.29+r()*.12)*shoot[4],width=length*(.33+r()*.10);
   const young=j===countPerShoot-1&&r()>.72;
   tint.setHSL(young?.075:.23+(plant.structure?.leaf_tone||0)+r()*.035,young?.43:.15+r()*.18,young?.54:.65+r()*.18);
   callback(index++,position,[width,length,length*.46],quaternion,tint);
  }}return index;
 }
 function treeBones(plant){if(plant.structure)return plant.structure.bones;return [[0,0,0,0,0,plant.height*.76,.09,.055,0]];}

 // The distant orchard stays inexpensive: a trunk and a few crown clusters per
 // logical plant. Resident sectors replace it with actual branches and shoots.
 const backgroundRanges=new Map(),backgroundTrunks=instanced(new THREE.CylinderGeometry(1,1,1,5),new THREE.MeshStandardMaterial({map:textures.barkMap,roughness:1}),woody.length,false);
 const backgroundLeaves=instanced(clusters,clusterMaterial,woody.reduce((n,p)=>n+(p.structure?.primary.length||3),0),false);let bgIndex=0;
 woody.forEach((plant,index)=>{const base=to3(plant.position),h=plant.structure?.fork_height||plant.height*.7;put(backgroundTrunks,index,base.clone().add(new THREE.Vector3(0,h/2,0)),[plant.structure?.radius||.08,h,plant.structure?.radius||.08],new THREE.Quaternion(),new THREE.Color(.60,.61,.55));
  const shoots=plant.structure?.primary.map(nodes=>nodes[2])||[[0,0,plant.height*.75],[.5,0,plant.height*.8],[-.5,0,plant.height*.8]],start=bgIndex;
  for(const shoot of shoots)put(backgroundLeaves,bgIndex++,base.clone().add(to3(shoot)),[1.6,1.35,1.6],new THREE.Quaternion().setFromAxisAngle(Y,plant.seed),new THREE.Color(.64,.73,.51));
  backgroundRanges.set(plant.id,[{mesh:backgroundTrunks,start:index,count:1,saved:null},{mesh:backgroundLeaves,start,count:bgIndex-start,saved:null}]);
 });backgroundTrunks.instanceMatrix.needsUpdate=backgroundLeaves.instanceMatrix.needsUpdate=true;stats.backgroundClusters=bgIndex;
 function toggleRange(range,hidden){const attr=range.mesh.instanceMatrix,start=range.start*16,count=range.count*16;
  if(hidden&&!range.saved){range.saved=attr.array.slice(start,start+count);const matrix=new THREE.Matrix4().makeScale(.00001,.00001,.00001).setPosition(0,-1000,0);for(let i=start;i<start+count;i+=16)matrix.toArray(attr.array,i);attr.addUpdateRange(start,count);attr.needsUpdate=true}
  else if(!hidden&&range.saved){attr.array.set(range.saved,start);range.saved=null;attr.addUpdateRange(start,count);attr.needsUpdate=true}
 }
 const sectors=new Map([...cells].map(([key,plants])=>{const [x,z]=key.split(',').map(Number);return [key,{plants,bounds:{minX:x*cellSize,maxX:(x+1)*cellSize,minZ:-(z+1)*cellSize,maxZ:-z*cellSize}}]}));
 function loadCell({plants}){
  const vertices=[],colors=[],uvs=[],faces=[],farVertices=[],farColors=[],farUvs=[],farFaces=[];
  const leafCount=plants.reduce((n,p)=>n+shootRecords(p).length,0),leaves=instanced(clusters,clusterMaterial,leafCount,false);let cursor=0;
  for(const plant of plants){const base=to3(plant.position),r=rng(plant.seed),tone=.78+r()*.26;
   for(const bone of treeBones(plant)){appendTube(vertices,colors,uvs,faces,base,bone,tone);if(bone[8]<=1)appendTube(farVertices,farColors,farUvs,farFaces,base,bone,tone,false);stats.bones++}
   // Short roots add a grounded base without dense collision meshes.
   if(plant.structure)for(let j=0;j<4;j++){const a=r()*Math.PI*2,len=.26+r()*.20,x=plant.position[0]+Math.cos(a)*len,y=plant.position[1]+Math.sin(a)*len;appendTube(vertices,colors,uvs,faces,base,[0,0,.15,Math.cos(a)*len,Math.sin(a)*len,heightAt(terrain,x,y)-plant.position[2]+.025,.045,.009,2],tone)}
   const start=cursor;for(const shoot of shootRecords(plant)){const position=base.clone().add(to3(shoot));position.y-=.12;const quaternion=new THREE.Quaternion().setFromAxisAngle(Y,-shoot[3]);tint.setHSL(.245+(plant.structure?.leaf_tone||0),.17,.72+r()*.16);put(leaves,cursor++,position,[shoot[4],shoot[4],shoot[4]],quaternion,tint)}farRanges.set(plant.id,{mesh:leaves,start,count:cursor-start,saved:null});
  }
  leaves.instanceMatrix.needsUpdate=true;leaves.instanceColor.needsUpdate=true;leaves.computeBoundingSphere();leaves.frustumCulled=true;stats.farClusters+=cursor;
  const center=plants.reduce((v,p)=>v.add(to3(p.position)),new THREE.Vector3()).multiplyScalar(1/plants.length),lod=new THREE.LOD();lod.position.copy(center);
  function branchMesh(p,c,u,f){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geometry.setIndex(f);geometry.translate(-center.x,-center.y,-center.z);geometry.computeVertexNormals();geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,bark);mesh.castShadow=mesh.receiveShadow=true;return mesh}
  lod.addLevel(branchMesh(vertices,colors,uvs,faces),0);lod.addLevel(branchMesh(farVertices,farColors,farUvs,farFaces),vcfg.branch_detail_radius_m||32,.12);scene.add(lod);for(const plant of plants)for(const range of backgroundRanges.get(plant.id))toggleRange(range,true);
  return {leaves,lod,plants,boneCount:plants.reduce((n,p)=>n+treeBones(p).length,0)};
 }
 const stream=sectorStream(sectors,{load:loadCell,unload:cell=>{scene.remove(cell.leaves,cell.lod);cell.leaves.dispose();cell.lod.traverse(node=>{if(node.isMesh)node.geometry.dispose()});for(const plant of cell.plants){farRanges.delete(plant.id);for(const range of backgroundRanges.get(plant.id))toggleRange(range,false)}stats.bones-=cell.boneCount;stats.farClusters-=cell.leaves.count;stats.disposedCells++;},loadRadius:vcfg.resident_radius_m||34,releaseRadius:vcfg.release_radius_m||44});

 const near=instanced(curvedLeaves,leafMaterial,vcfg.near_leaf_limit||22000);near.count=0;
 const litter=instanced(leafGeometry(3,1),litterMaterial,tcfg.litter_max_instances||10000,false);litter.count=0;
 let previous=new THREE.Vector3(Infinity,Infinity,Infinity);
 function hideFar(plant,hidden){const range=farRanges.get(plant.id);if(range)toggleRange(range,hidden)}
 function pathDistance(x,y,path){const [a,b]=[path.start,path.end],dx=b[0]-a[0],dy=b[1]-a[1],t=THREE.MathUtils.clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)}
 function updateDetail(position,force=false,additional=[]){
  if(!force&&previous.distanceToSquared(position)<4)return;const points=[position,...additional],distance=p=>Math.min(...points.map(c=>Math.hypot(p.position[0]-c.x,-p.position[1]-c.z)));const began=performance.now();previous.copy(position);const streamBegan=performance.now();stream.update(points);stats.lastStreamMs=performance.now()-streamBegan;stats.treeCells=stream.resident.size;stats.residentTrees=[...stream.resident.values()].reduce((n,c)=>n+c.plants.length,0);const radius=vcfg.near_radius_m||12,newNear=new Set();let n=0;
  const nearby=woody.filter(p=>distance(p)<radius).sort((a,b)=>distance(a)-distance(b));
  for(const plant of nearby){const count=shootRecords(plant).length*countPerShoot;if(n+count>near.instanceMatrix.count)break;newNear.add(plant.id);forLeaves(plant,(_,p,s,q,c)=>put(near,n++,p,s,q,c));hideFar(plant,true)}
  for(const id of activeNear)if(!newNear.has(id))hideFar({id},false);activeNear.clear();for(const id of newNear)activeNear.add(id);
  stats.lastFoliageMs=performance.now()-began;const litterBegan=performance.now();near.count=n;near.instanceMatrix.needsUpdate=true;if(near.instanceColor)near.instanceColor.needsUpdate=true;stats.nearLeaves=n;stats.nearTrees=newNear.size;
  const litterRadius=tcfg.litter_radius_m||16,cell=1.2,cx=Math.floor(position.x/cell),cy=Math.floor(-position.z/cell),steps=Math.ceil(litterRadius/cell),perCell=Math.round((tcfg.litter_density_m2||11)*cell*cell);let index=0;
  for(let y=cy-steps;y<=cy+steps;y++)for(let x=cx-steps;x<=cx+steps;x++){
   if(Math.hypot((x+.5)*cell-position.x,(y+.5)*cell+position.z)>litterRadius)continue;const r=rng(hash(x,y)^cfg.seed);
   for(let j=0;j<perCell&&index<litter.instanceMatrix.count;j++){
    const east=(x+r())*cell,north=(y+r())*cell;if(Math.hypot(east-cfg.field.home[0],north-cfg.field.home[1])<2.3)continue;
    const onPath=(tcfg.paths||[]).some(p=>pathDistance(east,north,p)<p.width*.48);if(onPath&&r()>.18)continue;
    const h=heightAt(terrain,east,north)+.009,dx=(heightAt(terrain,east+.2,north)-heightAt(terrain,east-.2,north))/.4,dn=(heightAt(terrain,east,north+.2)-heightAt(terrain,east,north-.2))/.4;
    const normal=new THREE.Vector3(-dx,1,dn).normalize(),q=new THREE.Quaternion().setFromUnitVectors(Y,normal);q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,r()*Math.PI*2));q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    const length=.13+r()*.18;tint.setHSL(.055+r()*.035,.24+r()*.25,.18+r()*.17);
    put(litter,index++,new THREE.Vector3(east,h,-north),[length*(.30+r()*.12),length,length*.26],q,tint);
   }
  }
  litter.count=index;litter.instanceMatrix.needsUpdate=true;if(litter.instanceColor)litter.instanceColor.needsUpdate=true;stats.litterLeaves=index;stats.lastLitterMs=performance.now()-litterBegan;stats.lastDetailMs=performance.now()-began;stats.maxDetailMs=Math.max(stats.maxDetailMs||0,stats.lastDetailMs);
 }
 return {updateDetail,updateWind:time=>wind.value=time,stats,ground,heightAt:(x,y)=>heightAt(terrain,x,y)};
}
