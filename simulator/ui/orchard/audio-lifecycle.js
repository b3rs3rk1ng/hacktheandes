// Browser autoplay requires a gesture on some devices. Keep user intent separate
// from a failed/suspended context, so a later gesture can always recover audio.
export function keepAudioEnabled(audio,hint){
 let wanted=true,lastAttempt=-Infinity;
 const refresh=()=>{if(!hint)return;const blocked=wanted&&audio.context?.state!=='running';hint.hidden=!blocked;hint.textContent=audio.error?'Pulsa la escena para reintentar el audio':'Pulsa la escena para escuchar';};
 function resume(){if(!wanted||document.hidden)return;lastAttempt=performance.now();audio.setEnabled(true,{explicit:false}).then(refresh,refresh);refresh()}
 audio.enabled=true;resume();
 const gesture=()=>{if(audio.context?.state!=='running'||!audio.enabled)resume()};
 addEventListener('pointerdown',gesture);addEventListener('keydown',gesture);addEventListener('focus',gesture);addEventListener('pageshow',gesture);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)gesture()});
 const timer=setInterval(()=>{refresh();if(audio.context?.state!=='running'&&performance.now()-lastAttempt>2000)resume()},2500);
 return {refresh,dispose(){wanted=false;clearInterval(timer);removeEventListener('pointerdown',gesture);removeEventListener('keydown',gesture);removeEventListener('focus',gesture);removeEventListener('pageshow',gesture)}};
}
