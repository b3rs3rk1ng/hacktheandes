// Read-only CDP diagnostics; never print the host URL or operator credential.
const port=process.env.CACAO_DEBUG_PORT||18438;
const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()),page=pages.find(p=>p.type==='page');
if(!page)throw Error('No host page');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
const expression=process.argv[2]||`JSON.stringify({ready:!!window.cacao,session:window.cacao?.session?{authority:cacao.session.authority,readonly:cacao.session.readonly}:null,metrics:window.cacao?.metrics,state:window.cacao?.state?{phase:cacao.state.phase,tree:cacao.state.plant_id,visited:cacao.state.visited?.length}:null,fleet:window.cacao?.fleet?{enabled:cacao.fleet.data.enabled,error:cacao.fleet.error,indices:cacao.fleet.data.coverage.indices,robots:cacao.fleet.contexts.map(c=>({id:c.vehicle.id,phase:c.phase,error:c.error,tree:c.scanTree?.id,position:c.vehicle.position.toArray(),speed:c.vehicle.state.speed,time:c.time}))}:null,loading:document.getElementById('loadingText')?.textContent})`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const result=await new Promise((resolve,reject)=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)resolve(m)};setTimeout(()=>reject(Error('CDP timeout')),20000).unref()});
console.log(JSON.stringify(result.result?.result?.value??result));ws.close();
