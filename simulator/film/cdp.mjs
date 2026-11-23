import fs from 'node:fs/promises';
export async function connect(port=19440){
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());const page=pages.find(p=>p.type==='page'&&p.url.includes(':19441'));
 if(!page)throw Error('Film page not found');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 let id=0;const pending=new Map();const errors=[];
 ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);if(!p)return;pending.delete(d.id);d.error?p.reject(Error(JSON.stringify(d.error))):p.resolve(d.result)}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails);else if(d.method==='Log.entryAdded'&&d.params.entry.level==='error')errors.push(d.params.entry)};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 await call('Runtime.enable');await call('Log.enable');return {call,evaluate,errors,close:()=>ws.close()};
}
if(process.argv[1]?.endsWith('/cdp.mjs')){const c=await connect();try{if(process.argv[2]==='shot'){await c.call('Emulation.setDeviceMetricsOverride',{width:1080,height:1920,deviceScaleFactor:1,mobile:false});if(process.argv[4])await c.evaluate(`window.film.render(${Number(process.argv[4])})`);const r=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(process.argv[3],Buffer.from(r.data,'base64'));console.log(process.argv[3])}else{console.log(JSON.stringify(await c.evaluate(process.argv[2]||'({ready:!!window.film,errors:document.body.innerText.slice(-200)})')));console.log(JSON.stringify(c.errors))}}finally{c.close()}}
