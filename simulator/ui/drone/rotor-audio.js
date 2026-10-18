import {clamp} from './rotor-core.mjs';
// Synthesized four-motor sound: blade-passage harmonics + broadband rotor air.
// No recorded aircraft or vendor-calibrated sound pressure is claimed.
export class RotorAudio {
 constructor(count){this.count=count;this.enabled=false;this.active=true;this.explicitChoice=false;this.context=null;this.error=null;}
 async setEnabled(enabled,{explicit=true}={}){
  if(explicit)this.explicitChoice=true;
  try{
   if(enabled&&!this.context)this.create();
   if(enabled&&this.context.state!=='running')await this.context.resume();
   this.enabled=enabled;this.error=null;
   if(this.context)this.master.gain.setTargetAtTime(enabled?.38:0,this.context.currentTime,.08);
  }catch(e){this.error=e.message;this.enabled=false;}
  this.onchange?.();return this.enabled;
 }
 create(){
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)throw Error('Audio no disponible en este navegador');
  const c=this.context=new Audio({latencyHint:'interactive'});this.master=c.createGain();this.master.gain.value=0;
  const limiter=c.createDynamicsCompressor();limiter.threshold.value=-14;limiter.knee.value=12;limiter.ratio.value=5;this.master.connect(limiter);limiter.connect(c.destination);
  const buffer=c.createBuffer(1,Math.floor(c.sampleRate*2.73),c.sampleRate),samples=buffer.getChannelData(0);let seed=9281;for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/4294967296*2-1);}
  const real=new Float32Array(17),imag=new Float32Array(17);for(let i=1;i<17;i++)imag[i]=Math.exp(-i*.16)/Math.sqrt(i);const wave=c.createPeriodicWave(real,imag);
  this.motors=Array.from({length:this.count},(_,i)=>{
   const panner=c.createPanner();panner.panningModel='equalpower';panner.distanceModel='inverse';panner.refDistance=1;panner.rolloffFactor=.75;panner.maxDistance=120;
   const filter=c.createBiquadFilter();filter.type='lowpass';filter.Q.value=.55;filter.frequency.value=6000;
   const gain=c.createGain();gain.gain.value=0;gain.connect(filter);filter.connect(panner);panner.connect(this.master);
   const osc=c.createOscillator();osc.setPeriodicWave(wave);osc.frequency.value=30;
   const toneGain=c.createGain();toneGain.gain.value=.11;osc.connect(toneGain);toneGain.connect(gain);osc.start();
   const noise=c.createBufferSource();noise.buffer=buffer;noise.loop=true;noise.playbackRate.value=1+i*.013;
   const air=c.createBiquadFilter();air.type='bandpass';air.Q.value=.55;air.frequency.value=1600;
   const airGain=c.createGain();airGain.gain.value=.25;noise.connect(air);air.connect(airGain);airGain.connect(gain);noise.start(0,i*.31);
   const flutter=c.createOscillator();flutter.frequency.value=17+i*2.3;const flutterGain=c.createGain();flutterGain.gain.value=2.2;flutter.connect(flutterGain);flutterGain.connect(osc.frequency);flutter.start();
   return {panner,filter,gain,osc,air,airGain,toneGain,flutter};
  });
 }
 update(rotors,positions,camera,dt,active=true){
  this.active=active;if(!this.context)return;const c=this.context,t=c.currentTime;
  const target=this.enabled&&!document.hidden?.38:0;this.master.gain.setTargetAtTime(target,t,.09);
  const listener=c.listener,position=camera.position,forward=camera.getWorldDirection(this.forward??=camera.position.clone()),up=(this.up??=camera.up.clone()).copy(camera.up).applyQuaternion(camera.quaternion);
  const set=(p,v)=>p?.setTargetAtTime(v,t,.045);
  ['X','Y','Z'].forEach((axis,i)=>{const key=axis.toLowerCase();set(listener['position'+axis],position[key]);set(listener['forward'+axis],forward[key]);set(listener['up'+axis],up[key]);});
  const previous=this.previousListener??=position.clone(),listenerVelocity=position.clone().sub(previous).divideScalar(Math.max(dt,.001));previous.copy(position);
  rotors.forEach((r,i)=>{const m=this.motors[i],p=positions[i],distance=p.distanceTo(position),direction=p.clone().sub(position).normalize();
   const sourcePrevious=this.previousSources??=positions.map(p=>p.clone()),sourceVelocity=p.clone().sub(sourcePrevious[i]).divideScalar(Math.max(dt,.001));sourcePrevious[i].copy(p);
   // Bound Doppler under camera switches; motor pitch itself follows physical load.
   const doppler=clamp((343+clamp(listenerVelocity.dot(direction),-20,20))/(343+clamp(sourceVelocity.dot(direction),-20,20)),.94,1.06);
   const revs=r.omega/(2*Math.PI),load=clamp(r.thrust/7,0,1.8);
   set(m.osc.frequency,Math.max(15,revs*2*(1+(i-1.5)*.0015)*doppler));set(m.gain.gain,active?clamp(revs/25,0,1)*Math.sqrt(load):0);
   set(m.air.frequency,850+revs*16);set(m.airGain.gain,.15+.19*Math.sqrt(load));set(m.filter.frequency,Math.max(650,7000/(1+distance*.065)));
   set(m.panner.positionX,p.x);set(m.panner.positionY,p.y);set(m.panner.positionZ,p.z);
  });
 }
 dispose(){this.context?.close();}
}
export function mountSoundControl(audio,{parent=document.querySelector('header'),startButton=document.getElementById('start')}={}){
 const button=document.createElement('button');button.id='droneSound';button.className='drone-sound';button.type='button';button.setAttribute('aria-pressed','false');
 const style=document.createElement('style');style.textContent='.drone-sound{display:inline-flex;align-items:center;gap:7px;background:#14231dbb;border:1px solid #f1f4e03b;border-radius:8px;padding:9px 11px;font-size:11px;white-space:nowrap}.drone-sound svg{width:16px;height:16px}.drone-sound[aria-pressed=true]{color:#e2edc9}.drone-sound:focus-visible{outline:2px solid #efbb68;outline-offset:3px}@media(max-width:600px){.drone-sound{padding:8px}.drone-sound span{display:none}}';document.head.append(style);
 audio.onchange=()=>{button.setAttribute('aria-pressed',String(audio.enabled));button.setAttribute('aria-label',audio.enabled?'Silenciar motores del dron':'Activar sonido del dron');button.title=audio.error||'Sonido espacial de motores y hélices';button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9h4l5-4v14l-5-4H4z"/>'+(audio.enabled?'<path d="M16 8q5 4 0 8M19 5q8 7 0 14"/>':'<path d="m17 9 5 6m0-6-5 6"/>')+'</svg><span>'+(audio.enabled?'Sonido activo':'Activar sonido')+'</span>';};
 button.onclick=()=>audio.setEnabled(!audio.enabled);parent?.insertBefore(button,parent.lastElementChild);audio.onchange();
 startButton?.addEventListener('click',()=>{if(!audio.explicitChoice)audio.setEnabled(true,{explicit:false});});
 return button;
}
