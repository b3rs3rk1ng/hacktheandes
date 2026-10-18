import * as THREE from 'three';
import {terrainHeight} from './terrain-course.mjs';
export async function createTerrainScene(course){
 const root=new THREE.Group();root.name='Circuito físico de prueba';
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(course.vertices,3));geometry.setIndex(new THREE.BufferAttribute(course.indices,1));
 const uv=[],colors=[],color=new THREE.Color();
 for(let i=0;i<course.vertices.length;i+=3){const x=course.vertices[i],z=course.vertices[i+2];uv.push(x*.65,z*.65);const path=Math.exp(-Math.pow(z/1.2,6));color.setRGB(.42+path*.29,.45+path*.15,.29+path*.12);for(const rock of course.config.rocks){const d=((x-rock.x)/rock.rx)**2+((z-rock.z)/rock.rz)**2;if(d<1.1)color.setRGB(.57,.56,.51)}for(const r of course.config.roots)if(Math.abs(x-r.x-z*r.skew)<r.radius)color.setRGB(.32,.24,.14);colors.push(color.r,color.g,color.b)}
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
 const loader=new THREE.TextureLoader(),[map,normalMap]=await Promise.all([loader.loadAsync('/assets/ground-color.jpg'),loader.loadAsync('/assets/ground-normal.jpg')]);map.colorSpace=THREE.SRGBColorSpace;for(const t of [map,normalMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;}
 const ground=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map,normalMap,normalScale:new THREE.Vector2(.45,.45),vertexColors:true,roughness:1}));ground.receiveShadow=true;root.add(ground);
 const borderMaterial=new THREE.MeshStandardMaterial({color:0x827450,roughness:1}),markerMaterial=new THREE.MeshStandardMaterial({color:0xc28c3d,roughness:.8});
 for(const sec of course.config.sections){for(const z of [-1.25,1.25]){const h=terrainHeight(sec.x,z,course.config),post=new THREE.Mesh(new THREE.CylinderGeometry(.013,.018,.30,8),borderMaterial);post.position.set(sec.x,h+.15,z);post.castShadow=true;root.add(post);const cap=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.06,10),markerMaterial);cap.position.set(sec.x,h+.28,z);root.add(cap)}
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=112;const ctx=canvas.getContext('2d');ctx.fillStyle='#eef0de';ctx.fillRect(0,0,768,112);ctx.fillStyle='#34413d';ctx.font='500 45px sans-serif';ctx.textAlign='center';ctx.fillText(sec.label,384,74);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.08,.16),new THREE.MeshStandardMaterial({map:texture,side:THREE.DoubleSide,roughness:1}));sign.position.set(sec.x,terrainHeight(sec.x,-1.25,course.config)+.43,-1.25);sign.rotation.y=-Math.PI/2;root.add(sign)}
 // Vegetation outside the collision corridor gives scale without concealing the test.
 const bladeVertices=[],bladeColors=[];
 for(let i=0;i<6;i++){const a=i*2.4,h=.14+(i*.31% .13),w=.009,dx=Math.cos(a),dz=Math.sin(a);bladeVertices.push(-dz*w,0,dx*w,dz*w,0,-dx*w,dx*.024,h*.57,dz*.024,dx*.024,h*.57,dz*.024,dz*w,0,-dx*w,dx*.055,h,dz*.055);for(let j=0;j<6;j++)bladeColors.push(.20+i*.025,.29+i*.025,.09+i*.014);}
 const grassGeo=new THREE.BufferGeometry();grassGeo.setAttribute('position',new THREE.Float32BufferAttribute(bladeVertices,3));grassGeo.setAttribute('color',new THREE.Float32BufferAttribute(bladeColors,3));grassGeo.computeVertexNormals();
 const grassMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}),grass=new THREE.InstancedMesh(grassGeo,grassMat,700),dummy=new THREE.Object3D();
 for(let i=0;i<700;i++){const x=-3+(i*7.713%16),z=(i%2?1:-1)*(1.45+(i*.617%1.4));dummy.position.set(x,terrainHeight(x,z,course.config),z);dummy.rotation.set(.12*Math.sin(i),i*2.4,.14*Math.cos(i));dummy.scale.setScalar(.6+(i*3.7%1));dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix)}root.add(grass);
 return root;
}
