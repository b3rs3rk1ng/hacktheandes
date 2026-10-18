export function createVehicleSelector(element,onChange,options=[{id:'ground',label:'Robot terrestre'},{id:'drone',label:'Dron'}]){
 let selected=options[0].id;try{let saved=localStorage.getItem('cacao.vehicle');if(saved==='ground'&&!options.some(o=>o.id==='ground'))saved=options[0].id;if(options.some(o=>o.id===saved))selected=saved}catch{}
 for(const option of options){const button=document.createElement('button');button.type='button';button.dataset.vehicle=option.id;button.textContent=option.label;button.setAttribute('aria-pressed',String(option.id===selected));button.onclick=()=>select(option.id);element.append(button)}
 function body(){document.body.dataset.vehicle=selected==='drone'?'drone':'ground';document.body.dataset.vehicleId=selected}
 function select(id){if(!options.some(o=>o.id===id))throw Error('Vehículo desconocido');const previous=selected;selected=id;for(const button of element.children)button.setAttribute('aria-pressed',String(button.dataset.vehicle===id));body();try{localStorage.setItem('cacao.vehicle',id)}catch{}onChange(id,previous);window.dispatchEvent(new CustomEvent('cacao:vehiclechange',{detail:{vehicle:id,previous}}))}
 body();return {select,get selected(){return selected}};
}
