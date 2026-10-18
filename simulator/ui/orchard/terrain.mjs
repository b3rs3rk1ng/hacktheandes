export function heightAt(terrain,x,y){
 if(!terrain)return 0;
 for(const p of terrain.patches||[])if(x>=p.origin[0]&&y>=p.origin[1]&&x<=p.origin[0]+(p.columns-1)*p.spacing&&y<=p.origin[1]+(p.rows-1)*p.spacing)return heightAt(p,x,y);
 const {columns:nx,rows:ny,spacing:s,origin:[ox,oy],heights:h}=terrain;
 let u=Math.max(0,Math.min(nx-1,(x-ox)/s)),v=Math.max(0,Math.min(ny-1,(y-oy)/s));
 const i=Math.min(nx-2,Math.floor(u)),j=Math.min(ny-2,Math.floor(v));u-=i;v-=j;const a=j*nx+i;
 return u+v<=1?h[a]*(1-u-v)+h[a+1]*u+h[a+nx]*v:h[a+1]*(1-v)+h[a+nx]*(1-u)+h[a+nx+1]*(u+v-1);
}

// ENU vertices, one authoritative topology for Three.js and Rapier/Webots.
export function terrainMesh(terrain){
 const positions=[],indices=[];
 for(const grid of [terrain,...(terrain.patches||[])]){
  const offset=positions.length/3,nx=grid.columns,s=grid.spacing,[ox,oy]=grid.origin;
  grid.heights.forEach((h,i)=>positions.push(ox+(i%nx)*s,oy+Math.floor(i/nx)*s,h));
  for(let j=0;j<grid.rows-1;j++)for(let i=0;i<nx-1;i++){
   const x=ox+(i+.5)*s,y=oy+(j+.5)*s;
   if((grid.patches||[]).some(p=>x>p.origin[0]&&y>p.origin[1]&&x<p.origin[0]+(p.columns-1)*p.spacing&&y<p.origin[1]+(p.rows-1)*p.spacing))continue;
   const a=offset+j*nx+i;indices.push(a,a+1,a+nx,a+1,a+nx+1,a+nx);
  }
 }
 return {positions,indices};
}
