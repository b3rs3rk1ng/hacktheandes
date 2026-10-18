// Y-up, metres. One mesh is shared by the renderer and collision world.
export const courseConfig={
  bounds:{minX:-4,maxX:14,minZ:-3,maxZ:3,spacing:.08},startX:-2.4,finishX:11.6,
  sections:[{x:0,label:'Surcos y piedras'},{x:2,label:'Subida · 8°'},{x:5,label:'Pendiente lateral · 6°'},{x:7,label:'Bajada'},{x:10,label:'Raíces'},{x:11.6,label:'Meta'}],
  incline:{start:2,crest:5,descent:7,end:10,grade:.14},crossSlope:{start:4.8,end:7.2,grade:.105},
  ruts:{start:0,end:1.8,depth:.045,track:.80,width:.12},
  rocks:[{x:.5,z:-.39,height:.065,rx:.16,rz:.14},{x:1.2,z:.42,height:.08,rx:.19,rz:.16},{x:6,z:-.50,height:.055,rx:.17,rz:.20}],
  roots:[{x:10.5,radius:.045,skew:.13}]
};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
export function terrainHeight(x,z,c=courseConfig){
  const p=c.incline;
  let h=p.grade*Math.max(0,Math.min(p.crest-p.start,x-p.start))-p.grade*Math.max(0,Math.min(p.end-p.descent,x-p.descent));
  h+=c.crossSlope.grade*z*smooth(c.crossSlope.start,c.crossSlope.start+.6,x)*(1-smooth(c.crossSlope.end-.6,c.crossSlope.end,x));
  const r=c.ruts,mask=smooth(r.start,r.start+.25,x)*(1-smooth(r.end-.25,r.end,x));
  h-=r.depth*mask*Math.exp(-Math.pow((Math.abs(z)-r.track/2)/r.width,2));
  h+=.004*Math.sin(x*9+z*5)*Math.sin(z*12-x*4)*smooth(-.5,.2,x);
  for(const rock of c.rocks){const d=Math.pow((x-rock.x)/rock.rx,2)+Math.pow((z-rock.z)/rock.rz,2);h+=rock.height*Math.exp(-d*1.8)}
  for(const root of c.roots){const d=x-root.x-z*root.skew;if(Math.abs(d)<root.radius)h+=Math.sqrt(root.radius**2-d*d)}
  return h;
}
export function buildCourse(c=courseConfig){
 const b=c.bounds,nx=Math.ceil((b.maxX-b.minX)/b.spacing),nz=Math.ceil((b.maxZ-b.minZ)/b.spacing),vertices=new Float32Array((nx+1)*(nz+1)*3),indices=new Uint32Array(nx*nz*6);
 for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const x=b.minX+(b.maxX-b.minX)*i/nx,z=b.minZ+(b.maxZ-b.minZ)*j/nz,k=(i*(nz+1)+j)*3;vertices.set([x,terrainHeight(x,z,c),z],k)}
 let k=0;for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){const a=i*(nz+1)+j,d=a+nz+1;indices.set([a,a+1,d,a+1,d+1,d],k);k+=6}
 return {vertices,indices,config:c};
}
export function courseSection(x,c=courseConfig){return [...c.sections].reverse().find(s=>x>=s.x)?.label??'Aproximación';}
