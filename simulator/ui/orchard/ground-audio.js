// Shared user-controlled audio context; synthesized soil/leaf friction and
// electric servos follow measured vehicle/joint motion, including other actors.
export function createGroundAudio(control,vehicles){
 let channels=null;const stats={enabled:false,rolling:0,servos:0,error:null};
 function create(){const c=control.context,buffer=c.createBuffer(1,c.sampleRate*2,c.sampleRate),samples=buffer.getChannelData(0);let seed=8173;for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=seed/2147483648-1}
  channels=vehicles.map((v,index)=>{
   const pan=()=>{const p=c.createPanner();p.panningModel='equalpower';p.distanceModel='inverse';p.refDistance=1;p.rolloffFactor=.8;p.connect(control.master);return p},wheels=pan(),arm=pan();
   function noise(type,freq,destination){const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=buffer;source.loop=true;source.playbackRate.value=1+index*.017;filter.type=type;filter.frequency.value=freq;filter.Q.value=.6;gain.gain.value=0;source.connect(filter);filter.connect(gain);gain.connect(destination);source.start(0,index*.17);return {source,filter,gain}}
   const soil=noise('lowpass',600,wheels),leaves=noise('bandpass',2200,wheels),servo=c.createOscillator(),servoGain=c.createGain();servo.type='triangle';servo.frequency.value=220;servoGain.gain.value=0;servo.connect(servoGain);servoGain.connect(arm);servo.start();return {v,wheels,arm,soil,leaves,servo,servoGain};
  });
 }
 function update(){stats.enabled=control.enabled;if(!control.context)return;try{if(!channels)create();const c=control.context,t=c.currentTime,set=(p,value)=>p.setTargetAtTime(value,t,.06);stats.rolling=stats.servos=0;
  for(const ch of channels){const v=ch.v,s=v.state,speed=Math.abs(s.speed),contacts=s.wheels.filter(w=>w.contact).length/4,rough=s.wheels.reduce((n,w)=>n+Math.abs(w.compression),0),roll=Math.min(1,speed/ .65)*contacts,servo=Math.min(1,v.soundState.armSpeed*.18+v.soundState.toolSpeed*.12);stats.rolling+=roll;stats.servos+=servo;const active=control.enabled&&!document.hidden;
   set(ch.soil.gain.gain,active?roll*.28:0);set(ch.soil.filter.frequency,180+speed*650);set(ch.leaves.gain.gain,active?roll*(.05+Math.min(.12,rough*.2)):0);set(ch.servoGain.gain,active?servo*.07:0);set(ch.servo.frequency,180+Math.min(500,v.soundState.armSpeed*90+v.soundState.toolSpeed*30));
   for(const [p,node] of [[v.position,ch.wheels],[v.rover.arm.getWorldPosition(v.position.clone()),ch.arm]])for(const axis of ['X','Y','Z'])set(node['position'+axis],p[axis.toLowerCase()]);
  }}catch(e){stats.error=e.message}}
 return {update,stats};
}
