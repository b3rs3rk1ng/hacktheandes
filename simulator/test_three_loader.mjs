// Resolve the same pinned Three.js module used by the browser import map.
export async function resolve(specifier,context,next){
 if(specifier==='three')return {url:new URL('./ui/vendor/three.module.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}
