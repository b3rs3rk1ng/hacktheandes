"""Optional tree notes for the operator, kept in Atomic Memory between scenarios.

Disabled unless the server is configured. The memory subject comes from server
configuration for the single operator credential; requests never choose it.
Notes are reference context for a person: they never change a review decision,
a task state, the alert threshold or the detector's scores.
"""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

SOURCE_SITE='cacao-orchard-review'
DEFAULT_URL='https://api.atomicstrata.ai'
IDENTIFIER=re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')


class MemoryUnavailable(Exception):
    """Atomic Memory did not complete the request; nothing is assumed saved."""


def prefix(plant_id):
    return f'Nota del agricultor sobre el árbol de cacao {plant_id}: '


class TreeNotes:
    def __init__(self,url,key,operator,timeout=4.0,opener=urlopen):
        self.url=url.rstrip('/');self.key=key;self.subject='cacao-operator:'+operator;self.timeout=timeout;self.opener=opener

    def call(self,method,path,body=None):
        request=Request(self.url+path,method=method,data=None if body is None else json.dumps(body,ensure_ascii=False).encode(),
                        headers={'Authorization':'Bearer '+self.key,'Content-Type':'application/json','Accept':'application/json'})
        try:
            with self.opener(request,timeout=self.timeout) as response:return json.loads(response.read() or b'{}')
        except HTTPError as error:
            error.close();raise MemoryUnavailable(f'Atomic Memory respondió {error.code}') from None
        except (URLError,TimeoutError,OSError,ValueError):
            raise MemoryUnavailable('Atomic Memory no respondió a tiempo') from None

    def recall(self,plant_id,limit=5):
        start=prefix(plant_id)
        reply=self.call('POST','/v1/memories/search/fast',{'user_id':self.subject,'query':start+'observaciones anteriores del árbol',
                                                           'limit':50,'source_site':SOURCE_SITE})
        rows=reply.get('memories') if isinstance(reply,dict) else None
        if not isinstance(rows,list):raise MemoryUnavailable('Respuesta inesperada de Atomic Memory')
        # Search ranks semantically; only exact notes written for this tree count.
        notes=[{'id':row['id'],'note':row['content'][len(start):],'created_at':row.get('created_at')}
               for row in rows if isinstance(row,dict) and isinstance(row.get('id'),str) and isinstance(row.get('content'),str) and row['content'].startswith(start)]
        notes.sort(key=lambda n:str(n['created_at'] or ''),reverse=True)
        return notes[:limit]

    def remember(self,task,epoch):
        note=task['review']['note'].strip()
        reply=self.call('POST','/v1/memories/ingest/quick',{'user_id':self.subject,'conversation':prefix(task['plant_id'])+note,
            'source_site':SOURCE_SITE,'skip_extraction':True,'content_class':'summary',
            'metadata':{'externalId':f'cacao-review:{epoch}:{task["id"]}','cacao_plant_id':task['plant_id'],'cacao_pod_id':task['pod_id'],
                        'cacao_review_decision':task['review']['decision']}})
        stored=reply.get('stored_memory_ids') if isinstance(reply,dict) else None
        if not isinstance(stored,list):raise MemoryUnavailable('Respuesta inesperada de Atomic Memory')
        return {'stored':len(stored)>0,'unchanged':not stored and bool(reply.get('memories_skipped'))}

    def forget(self,plant_id,memory_id):
        if memory_id not in [n['id'] for n in self.recall(plant_id,limit=50)]:raise ValueError('La nota no pertenece a este árbol')
        reply=self.call('DELETE','/v1/memories/'+quote(memory_id,safe='')+'?'+urlencode({'user_id':self.subject}))
        if not isinstance(reply,dict) or reply.get('success') is not True:raise MemoryUnavailable('Atomic Memory no confirmó el borrado')


def from_env(env):
    """Return (TreeNotes or None, reason). Off by default; never raises."""
    if env.get('CACAO_REVIEW_MEMORY')!='1':return None,'Notas recordadas desactivadas'
    key=env.get('ATOMICMEMORY_API_KEY','').strip();operator=env.get('CACAO_REVIEW_MEMORY_OPERATOR_ID','').strip()
    url=env.get('ATOMICMEMORY_API_URL','').strip() or DEFAULT_URL;parsed=urlparse(url)
    if not key:return None,'Falta ATOMICMEMORY_API_KEY en el servidor'
    if not IDENTIFIER.fullmatch(operator):return None,'CACAO_REVIEW_MEMORY_OPERATOR_ID debe ser un identificador estable'
    # The project key travels only over TLS, except to a loopback test service.
    if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in ('127.0.0.1','localhost','::1')):
        return None,'ATOMICMEMORY_API_URL debe usar https'
    return TreeNotes(url,key,operator),None
