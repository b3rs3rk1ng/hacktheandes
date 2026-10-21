const labels={awaiting_evidence:'Esperando nueva foto',awaiting_review:'Por revisar',pending:'Aprobada · esperando robot',claimed:'Robot en camino',verifying:'Verificando de cerca',verified:'Verificación completada',gripping:'Sujetando',cutting:'Cortando',carrying:'Retirando',depositing:'Depositando',completed:'Depositada',rejected:'Fruto conservado',unreachable:'No se pudo alcanzar',interrupted:'Recorrido interrumpido'};
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
export function sectorOf(position,size=20){return `Sector E${Math.floor(position[0]/size)} · N${Math.floor(position[1]/size)}`}

export function setupReviewInbox({container,button,close,world,onDecision,onFollow}={}){
 let data=null,signature='',filter='awaiting_review',sector='',loading=false,acting=false,disposed=false,memory=null;const drafts=new Map(),keep=new Set(),notes=new Map();
 const drawer=button?container.closest('.drawer'):null,heading=element('h2','Buzón de sospechas');
 const intro=element('p','Revisa la foto antes de autorizar la retirada. Cada fruto aparece una sola vez.');
 const summary=element('p','Conectando…','review-summary'),feedback=element('p','','review-feedback');feedback.setAttribute('role','status');
 const controls=element('div',undefined,'review-filters'),statusSelect=element('select'),sectorSelect=element('select');
 statusSelect.setAttribute('aria-label','Filtrar por decisión');sectorSelect.setAttribute('aria-label','Filtrar por sector');
 for(const [value,title] of [['awaiting_review','Por revisar'],['awaiting_evidence','Nueva captura'],['approved','Aprobadas'],['rejected','Conservar'],['all','Todas']]){const o=element('option',title);o.value=value;statusSelect.append(o)}
 const list=element('div',undefined,'review-list'),resume=element('button','Activar terrestres','primary');resume.hidden=true;
 const connection=element('p','Buzón local de la demo · WhatsApp sin conectar.','review-channel');
 container.append(heading,intro,summary,controls,resume,feedback,list,connection);controls.append(statusSelect,sectorSelect);
 const taskParam=new URLSearchParams(location.search).get('task');if(taskParam){filter='all';statusSelect.value='all'}
 const size=world?.config?.fleet?.review_sector_size_m||20;
 async function request(path,body){const r=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});const value=await r.json();if(!r.ok)throw Error(value.error||'No se pudo actualizar el buzón');return value}
 function counts(){const tasks=Object.values(data?.tasks||{}),waiting=tasks.filter(t=>t.status==='awaiting_review').length;
  if(button){button.querySelector('span').textContent=String(waiting);button.setAttribute('aria-label',`Buzón de sospechas: ${waiting} por revisar`)}
  summary.textContent=`${waiting} por revisar · ${tasks.filter(t=>t.review?.decision==='approve').length} aprobadas · ${tasks.filter(t=>t.review?.decision==='reject').length} conservadas · ${tasks.filter(t=>t.status==='awaiting_evidence').length} necesitan nueva foto`;
  resume.hidden=data?.enabled||!tasks.some(t=>t.status==='pending');
 }
 // Remembered tree notes are optional operator context from the server; they
 // never change the photo, score or decision of a suspicion.
 function paintNotes(plant){
  for(const box of list.querySelectorAll('.review-memory')){
   if(box.dataset.plant!==plant)continue;const entry=notes.get(plant),remember=box.parentElement.querySelector('.review-remember');
   if(remember)remember.hidden=memory!==true;box.hidden=memory===false||!entry;box.replaceChildren();if(box.hidden)continue;
   if(entry.state==='error'){box.append(element('p',entry.message,'review-score'));continue}
   if(entry.state==='loading'){box.append(element('p','Buscando notas anteriores de este árbol…','review-score'));continue}
   if(!entry.items.length){box.append(element('p','Sin notas recordadas para este árbol.','review-score'));continue}
   box.append(element('h4','Notas recordadas de este árbol'));
   for(const item of entry.items){
    const row=element('div',undefined,'review-memory-item'),forget=element('button','Olvidar','review-forget');forget.setAttribute('aria-label',`Olvidar nota de ${plant}`);
    forget.onclick=async()=>{forget.disabled=true;try{await request('/api/review/memory/forget',{plant_id:plant,memory_id:item.id});feedback.textContent=`Nota olvidada para ${plant}.`;await loadNotes(plant,true)}catch(e){feedback.textContent=e.message;forget.disabled=false}};
    row.append(element('p',item.note,'review-note'),forget);box.append(row);
   }
   box.append(element('p','Guardadas en Atomic Memory por el operador. No cambian la puntuación ni la decisión.','review-score'));
  }
 }
 async function loadNotes(plant,force=false){
  if(memory===false||!force&&notes.get(plant)?.state==='ready'||notes.get(plant)?.state==='loading')return;
  notes.set(plant,{state:'loading'});paintNotes(plant);
  try{const value=await request('/api/review/memory/recall',{plant_id:plant});memory=value.enabled===true;notes.set(plant,{state:'ready',items:value.notes||[]})}
  catch(e){notes.set(plant,{state:'error',message:e.message})}
  paintNotes(plant);
 }
 function render(){
  if(!data||acting)return;const tasks=Object.values(data.tasks),options=[...new Set(tasks.map(t=>sectorOf(t.position,size)))].sort();
  sectorSelect.replaceChildren();for(const title of ['Todos los sectores',...options]){const o=element('option',title);o.value=title==='Todos los sectores'?'':title;sectorSelect.append(o)}sectorSelect.value=sector;
  const visible=tasks.filter(t=>(!sector||sectorOf(t.position,size)===sector)&&(filter==='all'||filter==='approved'&&t.review?.decision==='approve'||filter==='rejected'&&t.review?.decision==='reject'||['awaiting_review','awaiting_evidence'].includes(filter)&&t.status===filter));
  visible.sort((a,b)=>(b.id===taskParam)-(a.id===taskParam)||(b.created_at-a.created_at));list.replaceChildren();
  if(!visible.length){list.append(element('p',tasks.some(t=>t.status==='awaiting_evidence')&&filter==='awaiting_review'?'Las capturas anteriores necesitan una nueva foto. Puedes verlas en «Nueva captura».':tasks.length?'No hay sospechas en este filtro.':'Aún no hay sospechas. Inicia el recorrido del dron para recibir fotos reales de su cámara.','review-empty'));return}
  for(const task of visible){
   const reviewedEpoch=data.epoch;
   const card=element('article',undefined,'review-card');card.dataset.taskId=task.id;
   const title=element('h3',task.plant_id),status=element('span',labels[task.status]||task.status,'review-state');
   card.append(title,status,element('p',`${sectorOf(task.position,size)} · E ${task.position[0].toFixed(1)} m / N ${task.position[1].toFixed(1)} m`,'review-location'));
   if(task.evidence){const image=element('img');image.src=task.evidence.crop_url;image.alt=`Mazorca sospechosa ${task.pod_id}, capturada por el dron`;image.loading='lazy';
    const link=element('a','Ver foto completa ↗');link.href=task.evidence.image_url;link.target='_blank';link.rel='noopener';card.append(image,link);
    card.append(element('p',`Captura ${new Date(task.evidence.captured_at*1000).toLocaleTimeString('es-PE')} · Puntuación del modelo: ${(task.confidence*100).toFixed(0)}%. No es un diagnóstico.`,'review-score'));
   }else{card.append(element('p',task.previous_evidence?'La captura anterior no comprobaba un fruto visible. Esperando una nueva foto.':'Falta la foto de esta observación anterior. Una nueva detección permitirá revisarla.'));if(task.previous_evidence){const old=element('a','Ver captura anterior (no válida) ↗');old.href=task.previous_evidence.image_url;old.target='_blank';old.rel='noopener';card.append(old)}}
   if(task.status==='awaiting_review'){
    const memoryBox=element('div',undefined,'review-memory');memoryBox.dataset.plant=task.plant_id;memoryBox.hidden=true;
    const note=element('textarea');note.placeholder='Nota opcional para el robot / agricultor';note.maxLength=500;note.setAttribute('aria-label',`Nota para ${task.pod_id}`);note.rows=2;note.value=drafts.get(task.id)||'';note.oninput=()=>drafts.set(task.id,note.value);
    const remember=element('label',undefined,'review-remember'),check=element('input');check.type='checkbox';check.checked=keep.has(task.id);check.onchange=()=>check.checked?keep.add(task.id):keep.delete(task.id);
    remember.hidden=memory!==true;remember.append(check,element('span',`Recordar esta nota para ${task.plant_id} en próximas revisiones`));card.append(memoryBox,note,remember);
    const actions=element('div',undefined,'review-actions'),approve=element('button','Aprobar retirada','primary'),reject=element('button','Conservar fruto','review-reject');
    approve.disabled=reject.disabled=!task.evidence;actions.append(approve,reject);card.append(actions);
    if(!data.enabled)card.append(element('p','La flota está en pausa. Una aprobación se ejecutará al activar los terrestres.','review-score'));
    async function decide(decision){if(acting)return;acting=true;approve.disabled=reject.disabled=true;feedback.textContent='Guardando decisión…';
     try{await request('/api/review/decision',{task_id:task.id,decision,revision:task.review.revision,epoch:reviewedEpoch,note:note.value});let message=decision==='approve'?'Retirada aprobada. El terrestre volverá a verificar este fruto.':'Fruto conservado. El robot no lo retirará.';
      // The decision is already saved; the note is remembered only from that stored review.
      if(memory===true&&check.checked&&note.value.trim()){try{const saved=await request('/api/review/memory/remember',{task_id:task.id});message+=saved.stored?` Nota recordada para ${task.plant_id}.`:saved.unchanged?' La nota ya estaba recordada.':' Atomic Memory no confirmó la nota: no se recordó.';notes.delete(task.plant_id)}catch(e){message+=` ${e.message}`}}
      feedback.textContent=message;await onDecision?.()}
     catch(e){feedback.textContent=e.message}finally{acting=false;signature='';await sync()}
    }
    approve.onclick=()=>decide('approve');reject.onclick=()=>decide('reject');
   }else{
    if(task.review?.note)card.append(element('p',task.review.note,'review-note'));
    if(task.reason)card.append(element('p',task.reason,'review-note'));
    if(task.robot_id){const follow=element('button',`Seguir ${world?.config?.fleet?.robots?.find(r=>r.id===task.robot_id)?.label||task.robot_id}`,'review-follow');follow.onclick=()=>onFollow?.(task.robot_id);if(onFollow)card.append(follow)}
   }
   list.append(card);
  }
  for(const plant of new Set(visible.filter(t=>t.status==='awaiting_review').map(t=>t.plant_id))){paintNotes(plant);loadNotes(plant)}
 }
 async function sync(){if(loading||disposed||document.hidden)return;loading=true;try{const value=await request('/api/fleet');if(data&&value.epoch!==data.epoch){drafts.clear();keep.clear();notes.clear()}data=value;counts();const next=JSON.stringify([value.epoch,value.enabled,Object.values(value.tasks).map(({heartbeat,verification,...task})=>task)]);if(next!==signature&&!acting&&document.activeElement?.tagName!=='TEXTAREA'){signature=next;render()}}catch(e){feedback.textContent=`Sin conexión: ${e.message}. Las decisiones se guardan en el servidor.`}finally{loading=false}}
 statusSelect.onchange=()=>{filter=statusSelect.value;render()};sectorSelect.onchange=()=>{sector=sectorSelect.value;render()};
 resume.onclick=async()=>{resume.disabled=true;try{await request('/api/fleet/control',{action:'start'});await onDecision?.();await sync()}catch(e){feedback.textContent=e.message}finally{resume.disabled=false}};
 if(button){button.onclick=()=>{drawer.hidden=!drawer.hidden;button.setAttribute('aria-expanded',String(!drawer.hidden));if(!drawer.hidden){sync();heading.tabIndex=-1;heading.focus()}};close.onclick=()=>{drawer.hidden=true;button.setAttribute('aria-expanded','false');button.focus()};drawer.addEventListener('keydown',e=>{if(e.key==='Escape')close.click()})}
 sync();const timer=setInterval(sync,1800);return {sync,dispose(){disposed=true;clearInterval(timer)}};
}
