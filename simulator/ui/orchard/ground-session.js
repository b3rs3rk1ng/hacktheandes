import {displayNumber} from './ui-format.mjs';
import {createGroundVehicle} from './ground-vehicle.js';
import {createVehicleSelector} from './vehicle-selector.mjs';
import {createRemoteFleet} from './remote-fleet.js';
import {labels,createFleetSession} from './fleet-session.js';

export async function createGroundSession({scene,world,droneCommand,onChange,session}){
 const $=id=>document.getElementById(id),robots=world.config.fleet.robots,vehicles=[];
 const initial=session.authority?await fetch('/api/fleet').then(r=>r.json()):null;
 // Sequential construction avoids concurrent initialization of the WASM factory.
 for(const robot of robots)vehicles.push(await createGroundVehicle(scene,world,{...robot,remote:session.readonly,snapshot:initial?.robots?.[robot.id]}));
 async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||'Falló la coordinación');return result}
 const fleet=session.readonly?createRemoteFleet(world,vehicles,labels):createFleetSession({world,vehicles,post,hostId:session.hostId});
 for(const robot of [...robots,{id:'drone',label:'Dron'}]){const row=document.createElement('div');row.id='fleet-'+robot.id;row.className='fleet-row';const name=document.createElement('span'),battery=document.createElement('b'),status=document.createElement('small');name.textContent=robot.label;battery.textContent='—';status.textContent='Preparando';row.append(name,battery,status);$('fleetRows').append(row)}
 const selector=createVehicleSelector($('vehicleSelector'),(id,previous)=>{$('evaluation').hidden=true;onChange?.(id,previous)},[...robots,{id:'drone',label:'Dron'}]);
 function active(){return selector.selected!=='drone'}
 function selected(){return vehicles.find(v=>v.id===selector.selected)||vehicles[0]}
 let captionKey='';
 function captions(mainView){const key=selector.selected+':'+mainView;if(key===captionKey)return;captionKey=key;const label=active()?selected().label:'dron';$('otherView').textContent=(mainView==='fpv'?'Vista externa · ':'Cámara a bordo · ')+label;$('targetCaption').textContent=(mainView==='fpv'?'Cámara a bordo · ':'Vista externa · ')+label;document.querySelector('.identity span').textContent=active()?'Inspección y retirada terrestre':'Vuelo de inspección'}
 function syncUI(){
  const tasks=Object.values(fleet.data.tasks),completed=tasks.filter(t=>t.status==='completed').length;
  $('fleetSummary').textContent=`${tasks.filter(t=>t.status==='awaiting_review').length} por revisar · ${completed} depositados`;
  for(const c of fleet.contexts){const row=$('fleet-'+c.vehicle.id);if(row){row.querySelector('small').textContent=fleet.labels[c.phase]+(c.error?' · '+c.error:'');row.querySelector('b').textContent=(c.vehicle.state.soc*100).toFixed(0)+'%'}}
  $('fleetConnection').textContent=fleet.error?'Coordinación: '+fleet.error:fleet.data.returning?'Todos regresan a sus estaciones':fleet.data.enabled?(fleet.data.coverage?.local_inspection_allowed?'Dron fuera de reconocimiento · inspección terrestre local':'Dron reconoce delante · terrestres avanzan en filas vecinas'):'Lista para iniciar';
  if(!active())return;const vehicle=selected(),s=vehicle.state,c=fleet.contexts.find(c=>c.vehicle===vehicle);
  $('groundPhase').textContent=vehicle.label+' · '+(fleet.labels[c.phase]||c.phase);
  $('groundClock').textContent=String(Math.floor(s.elapsed/60)).padStart(2,'0')+':'+String(Math.floor(s.elapsed%60)).padStart(2,'0');
  $('groundInstruction').textContent=c.error|| (c.task?`Objetivo ${c.task.pod_id} · ${c.task.verification?.length||0}/${world.config.fleet.verification_frames} confirmaciones de cámara`:s.charging?'Carga gradual en su estación': c.scanTree?`Árbol ${c.scanTree.id} · fila propia · avance junto al equipo`:'Recibe el mapa del dron y sigue su fila');
  const lane=world.coverage?.batches[fleet.data.coverage?.batch||0]?.lanes.find(l=>l.robot_id===vehicle.id),checked=fleet.data.coverage?.indices?.[vehicle.id]||0;$('groundProgress').style.width=((lane?(checked+Math.min(.99,s.progress))/lane.tree_ids.length:s.progress)*100)+'%';$('groundSpeed').textContent=displayNumber(Math.abs(s.speed),2,.015);c.uiPitch??=s.pitch;c.uiRoll??=s.roll;c.uiPitch+=(s.pitch-c.uiPitch)*.08;c.uiRoll+=(s.roll-c.uiRoll)*.08;$('groundPitch').textContent=displayNumber(c.uiPitch*180/Math.PI,1,.15)+'°';$('groundRoll').textContent=displayNumber(c.uiRoll*180/Math.PI,1,.15)+'°';$('groundContacts').textContent=s.wheels.filter(w=>w.contact).length+' / 4';
  $('groundSoc').textContent=(s.soc*100).toFixed(1)+'%';$('groundEnergy').textContent=Math.round(s.power)+' W · '+(s.charging?'cargando':s.estimated_hours.toFixed(1)+' h estimadas');
  $('start').disabled=false;$('return').disabled=false;$('accelerate').setAttribute('aria-pressed',String(s.fast));$('accelerate').textContent=s.fast?'Tiempo acelerado':'Tiempo real';$('harvest').disabled=true;$('evaluationButton').hidden=true;
 }
 function update(dt){fleet.update(dt);const held=fleet.traffic();for(const vehicle of vehicles)vehicle.update(dt,!held.has(vehicle.id));syncUI();if(!active()){$('harvest').disabled=Boolean(world.config.flight.inspection_only);$('evaluationButton').hidden=false}}
 async function command(action,extra={}){
  if(session.readonly)throw Error('Visor en vivo; sólo observación');
  if(action==='start'){await fleet.control('start');await droneCommand('start')}
  else if(action==='return'){await fleet.control('return');await droneCommand('return')}
  else if(action==='reset'){await fleet.control('reset');for(const v of vehicles)await v.command('reset',extra);await droneCommand('reset',extra)}
  else if(action==='hold')await fleet.control('hold');
  else if(action==='resume')await fleet.control('start');
  else if(action==='speed'){for(const v of vehicles)await v.command('speed',extra);await droneCommand('speed',extra)}
  else throw Error('Orden no disponible para la flota');await fleet.sync();
 }
 return {get vehicle(){return selected()},vehicles,fleet,selector,active,update,syncUI,captions,command,receive:fleet.receive,get source(){const v=selected(),c=fleet.contexts.find(c=>c.vehicle===v),verifying=c.phase==='verifying',inspecting=['verifying','surveying','awaiting_review'].includes(c.phase);return {id:v.id,camera:inspecting?v.inspection:v.camera,follow:v.follow,position:v.position,simulation_time:v.state.elapsed,phase_id:-1,task_id:verifying?c.task?.id:null}}};
}
