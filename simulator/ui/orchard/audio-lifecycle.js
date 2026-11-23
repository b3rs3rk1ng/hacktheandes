// Start audio on entry. If autoplay is blocked, a normal page interaction
// unlocks the same context without introducing a separate sound control.
export function keepAudioEnabled(audio){
 let wanted=true,lastAttempt=-Infinity;
 function resume(){if(!wanted||document.hidden)return;lastAttempt=performance.now();audio.setEnabled(true,{explicit:false}).catch(()=>{});}
 const refresh=()=>{if(audio.context?.state!=='running'||!audio.enabled)resume()};
 audio.enabled=true;resume();
 const visibility=()=>{if(!document.hidden)refresh()};
 const events=['pointerdown','touchend','keydown','focus','pageshow'];
 for(const event of events)addEventListener(event,refresh);
 document.addEventListener('visibilitychange',visibility);
 const timer=setInterval(()=>{if(performance.now()-lastAttempt>2000)refresh()},2500);
 return {refresh,dispose(){wanted=false;clearInterval(timer);for(const event of events)removeEventListener(event,refresh);document.removeEventListener('visibilitychange',visibility)}};
}
