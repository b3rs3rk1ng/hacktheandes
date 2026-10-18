// Geodesic cage topology shared by render/export tests. Input is an indexed or
// unindexed triangular sphere; output unique struts, with a camera aperture.
export function cageEdges(vertices,indices,{radius,centerY=.045,aperture=true}={}){
 const points=[],ids=new Map(),index=[];
 for(let i=0;i<vertices.length;i+=3){const v=[vertices[i],vertices[i+1],vertices[i+2]],key=v.map(x=>x.toFixed(5)).join(',');if(!ids.has(key)){ids.set(key,points.length);points.push(v)}index.push(ids.get(key));}
 const edges=new Map(),faces=indices??Array.from({length:index.length},(_,i)=>i);
 for(let i=0;i<faces.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){const j=index[faces[i+a]],k=index[faces[i+b]],key=[Math.min(j,k),Math.max(j,k)].join(',');if(j===k||edges.has(key))continue;
  const p=points[j],q=points[k],mid=p.map((v,t)=>(v+q[t])/2);
  if(aperture&&mid[0]>radius*.72&&Math.abs(mid[1])<radius*.40&&Math.abs(mid[2])<radius*.40)continue;
  edges.set(key,{a:[p[0],p[1]+centerY,p[2]],b:[q[0],q[1]+centerY,q[2]]});
 }
 return [...edges.values()];
}
