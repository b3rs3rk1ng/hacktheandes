import * as THREE from 'three';

// Render the secondary scene at its own cadence; compositing the cached view
// costs one quad instead of repeating the whole orchard every animation frame.
export function createObserverView(renderer,{fps=30,maxPixels=180000,prepareScene=()=>{}}={}){
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
 target.texture.colorSpace=THREE.LinearSRGBColorSpace;
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:target.texture,depthTest:false,depthWrite:false,toneMapped:true})));
 let last=-Infinity,lastCamera=null,width=0,height=0;const stats={updates:0,composites:0};
 function render(world,sensor,rect,screenHeight,time){
  const scale=Math.min(renderer.getPixelRatio(),Math.sqrt(maxPixels/(rect.width*rect.height))),w=Math.max(1,Math.round(rect.width*scale)),h=Math.max(1,Math.round(rect.height*scale));
  if(w!==width||h!==height){width=w;height=h;target.setSize(w,h);last=-Infinity}
  if(time-last>=1000/fps-.25||sensor!==lastCamera){
   const previous=renderer.getRenderTarget(),aspect=sensor.aspect;sensor.aspect=rect.width/rect.height;sensor.updateProjectionMatrix();
   prepareScene(sensor);renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.render(world,sensor);renderer.setRenderTarget(previous);
   sensor.aspect=aspect;sensor.updateProjectionMatrix();last=time;lastCamera=sensor;stats.updates++;
  }
  renderer.setViewport(rect.left,screenHeight-rect.bottom,rect.width,rect.height);renderer.setScissor(rect.left,screenHeight-rect.bottom,rect.width,rect.height);renderer.setScissorTest(true);renderer.render(scene,camera);renderer.setScissorTest(false);stats.composites++;
 }
 return {render,stats,dispose(){target.dispose();scene.children[0].geometry.dispose();scene.children[0].material.dispose()}};
}
