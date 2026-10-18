export async function openSession(){
 const original=globalThis.fetch.bind(globalThis),params=new URLSearchParams(location.hash.slice(1));let token=params.get('host');
 if(token){localStorage.setItem('cacao.operator',token);history.replaceState(null,'',location.pathname+location.search)}else token=localStorage.getItem('cacao.operator');
 const headers=token?{Authorization:'Bearer '+token}:{};
 const session=await original('/api/session',{headers}).then(r=>r.json());
 if(token)globalThis.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&String(init.method||'GET').toUpperCase()==='POST'){const h=new Headers(init.headers);h.set('Authorization','Bearer '+token);return original(input,{...init,headers:h})}return original(input,init)};
 let authority=session.operator&&new URLSearchParams(location.search).has('authority'),hostId=null;
 if(authority){hostId=crypto.randomUUID();let lease;for(let attempt=0;attempt<16;attempt++){lease=await fetch('/api/host/lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host_id:hostId})}).then(r=>r.json());if(lease.granted)break;await new Promise(r=>setTimeout(r,750))}authority=lease.granted===true}
 document.body.dataset.viewer=String(!authority);
 return {...session,authority,hostId,readonly:!authority};
}
