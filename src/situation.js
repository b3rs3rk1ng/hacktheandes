import { createSituationMap, loadLocalities } from './map-view.js';
import { loadFields, saveFields, mergeField, selectFieldAt, fieldFreshness } from './field-store.js';
import { loadLocation, saveLocation, locateDevice, normalizeLocation } from './location.js';
const $ = id => document.getElementById(id);
const dateText = value => new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/Lima'}).format(new Date(value));
const levelNames = ['Sin clasificación','Clasificación amarilla','Clasificación naranja','Clasificación roja'];
export async function createSituationUI(storage,{toast=()=>{},onReset=()=>{}}={}) {
  let fields = loadFields(storage);
  let context = 'live';
  let mapView = 'national';
  const localities = await loadLocalities();
  let position = loadLocation(storage, localities[0]);
  const map = await createSituationMap($('situation-map'),{onSelect:value=>selectPosition(value)});
  for (const item of localities) {
    const option=document.createElement('option'); option.value=item.id; option.textContent=`${item.name} · ${item.region}`;
    $('map-locality').append(option);
  }
  function selectPosition(value) {
    position=normalizeLocation(value);
    try { saveLocation(storage,position); } catch { toast('No se pudo guardar la ubicación. Se conserva mientras la app esté abierta.'); }
    render();
  }
  function render() {
    const selected=localities.find(item=>Math.abs(item.longitude-position.longitude)<0.00001&&Math.abs(item.latitude-position.latitude)<0.00001);
    $('map-locality').value=selected?.id||'';
    $('position-name').textContent=position.name;
    $('position-coordinates').textContent=`${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}${Number.isFinite(position.accuracy) ? ` · precisión ±${Math.round(position.accuracy)} m` : ''}`;
    map.setLocation(position);
    const active=fields.filter(record=>record.field.context===context);
    map.setFields(active.map(record=>record.field));
    $('map-context').textContent=context==='replay'?'HISTÓRICO · demostración':'Datos recibidos por sonido';
    $('map-context').classList.toggle('historical',context==='replay');
    const {record,coverage}=selectFieldAt(fields,position.longitude,position.latitude,{context});
    $('local-level').textContent=record?levelNames[record.sample.value]:'Aún sin datos para este punto';
    $('local-level').dataset.level=record?.sample.value ?? '';
    if(record) {
      const freshness=fieldFreshness(record.field);
      const staleText=context==='replay'?'Histórico':freshness==='expired'?'Desactualizado':freshness==='future'?'Revisar reloj':'Último análisis';
      $('field-observed').textContent=`${staleText} · ${dateText(record.field.observedAt)}`;
      $('field-received').textContent=`Recibido ${dateText(record.receivedAt)} · ${record.field.cols} × ${record.field.rows} celdas`;
      $('field-explanation').textContent=record.sample.value===0?'La fuente no asigna una categoría aquí. Esto no confirma ausencia del fenómeno.':record.field.variable==='precipitation-category'?'Categoría del análisis de precipitación. No confirma daños ni indica una ruta segura.':'Categoría recibida de la fuente. Consulta el alcance de su información.';
      $('field-source').textContent=record.field.source.name;
      $('field-source').href=record.field.source.url;
      $('field-source').hidden=false;
    } else {
      $('field-observed').textContent=coverage?'La fuente no tiene dato en esta celda.':active.length?'La señal recibida no cubre este punto.':'El mapa está guardado. La información llegará al escuchar.';
      $('field-received').textContent='Tu ubicación se usa solamente en este teléfono.';
      $('field-explanation').textContent='Una misma emisión puede llevar datos de varios lugares. Tu teléfono muestra los que corresponden a tu ubicación.';
      $('field-source').hidden=true;
    }
    $('field-count').textContent=`${active.length} capas`;
    const latest=active.slice().sort((a,b)=>Date.parse(b.field.observedAt)-Date.parse(a.field.observedAt))[0];
    $('map-updated').textContent=latest?`Más reciente: ${dateText(latest.field.observedAt)}${context==='live'&&active.some(record=>fieldFreshness(record.field)!=='current')?' · hay capas antiguas':''}`:'Esperando primera recepción';
  }
  $('map-locality').addEventListener('change',()=>{const selected=localities.find(item=>item.id===$('map-locality').value);if(selected){selectPosition(selected);mapView='local';map.setView(mapView);updateViewButtons();}});
  $('gps-button').addEventListener('click',async()=>{
    $('gps-button').disabled=true; $('location-feedback').textContent='Buscando GPS… Puede tardar sin internet.';
    try { selectPosition(await locateDevice(navigator.geolocation));mapView='local';map.setView(mapView);updateViewButtons();$('location-feedback').textContent='Ubicación guardada en este teléfono.'; }
    catch(error){$('location-feedback').textContent=error.message;}
    finally{$('gps-button').disabled=false;}
  });
  function updateViewButtons(){document.querySelectorAll('[data-map-view]').forEach(button=>{button.classList.toggle('active',button.dataset.mapView===mapView);button.setAttribute('aria-pressed',String(button.dataset.mapView===mapView));});}
  document.querySelectorAll('[data-map-view]').forEach(button=>button.addEventListener('click',()=>{mapView=button.dataset.mapView;map.setView(mapView);updateViewButtons();}));
  $('field-context').addEventListener('change',()=>{context=$('field-context').value;render();});
  $('clear-map').addEventListener('click',()=>{try{saveFields(storage,[]);fields=[];onReset();render();toast('Datos del mapa borrados. La ubicación y el mapa base se conservan.');}catch{toast('No se pudo borrar el almacenamiento.');}});
  render();updateViewButtons();setInterval(render,60000);
  return {
    async receive(field) {
      const hadLive=fields.some(record=>record.field.context==='live');
      const result=mergeField(fields,field);fields=result.fields;
      if(field.context==='live'&&!hadLive){context='live';$('field-context').value=context;}
      let saved=true;try{saveFields(storage,fields);}catch{saved=false;}
      if(field.context==='replay'&&!fields.some(record=>record.field.context==='live')) {context='replay';$('field-context').value=context;}
      render();
      return result.stale?'Llegó una observación anterior. Se conservó la más reciente.':result.duplicate?'El mapa ya tenía esta actualización.':`Mapa actualizado por sonido${field.context==='replay'?' · histórico':''}.${saved?'':' No se pudo guardar en este navegador.'}`;
    },
    records:()=>fields,
  };
}
