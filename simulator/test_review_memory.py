"""Tree notes against a loopback FIXTURE of the documented Atomic Memory routes.

The fixture implements /v1/memories/ingest/quick, /search/fast and DELETE
/v1/memories/{id} in memory. It is not the live Atomic Memory service.
"""
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import uuid
from PIL import Image
import orchard_server as server
import review_memory

KEY='amc_test_fixture_key'


class FixtureMemory(ThreadingHTTPServer):
    def __init__(self):
        super().__init__(('127.0.0.1',0),FixtureHandler);self.rows=[];self.requests=[];self.mode='ok'
        threading.Thread(target=self.serve_forever,daemon=True).start()
        self.url=f'http://127.0.0.1:{self.server_port}'


class FixtureHandler(BaseHTTPRequestHandler):
    def reply(self,status,value):
        data=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers()
        try:self.wfile.write(data)
        except BrokenPipeError:pass  # the client already gave up (timeout test)

    def handle_any(self):
        fixture=self.server;url=urlparse(self.path);length=int(self.headers.get('Content-Length') or 0)
        body=json.loads(self.rfile.read(length)) if length else {}
        fixture.requests.append({'method':self.command,'path':url.path,'query':parse_qs(url.query),'body':body,'auth':self.headers.get('Authorization')})
        if fixture.mode=='slow':time.sleep(1)
        if fixture.mode=='fail':return self.reply(500,{'error':'fixture failure'})
        if self.headers.get('Authorization')!='Bearer '+KEY:return self.reply(401,{'error':'unauthorized'})
        if self.command=='POST' and url.path=='/v1/memories/ingest/quick':
            external=body['metadata'].get('externalId')
            if any(r['user_id']==body['user_id'] and r['metadata'].get('externalId')==external for r in fixture.rows):
                stored=[]
            else:
                row={'id':str(uuid.uuid4()),'user_id':body['user_id'],'content':body['conversation'],'metadata':body['metadata'],
                     'source_site':body['source_site'],'created_at':f'2026-10-20T12:00:{len(fixture.rows):02d}.000Z'}
                fixture.rows.append(row);stored=[row['id']]
            return self.reply(200,{'episode_id':'e','facts_extracted':0,'memories_stored':len(stored),'memories_updated':0,'memories_deleted':0,
                                   'memories_skipped':1-len(stored),'stored_memory_ids':stored,'updated_memory_ids':[],'links_created':0,'composites_created':0})
        if self.command=='POST' and url.path=='/v1/memories/search/fast':
            rows=[r for r in fixture.rows if r['user_id']==body['user_id'] and r['source_site']==body.get('source_site',r['source_site'])][:body.get('limit',10)]
            return self.reply(200,{'count':len(rows),'memories':[{k:r[k] for k in ('id','content','metadata','source_site','created_at')} for r in rows]})
        if self.command=='DELETE' and url.path.startswith('/v1/memories/'):
            user=parse_qs(url.query).get('user_id',[None])[0];target=url.path.removeprefix('/v1/memories/')
            match=[r for r in fixture.rows if r['id']==target and r['user_id']==user]
            if not match:return self.reply(404,{'error':'Memory not found'})
            fixture.rows.remove(match[0]);return self.reply(200,{'success':True})
        self.reply(404,{'error':'unknown route'})

    do_POST=do_DELETE=handle_any

    def log_message(self,*args):pass


class TreeNotesConfiguration(unittest.TestCase):
    def test_disabled_unless_explicitly_configured_on_the_server(self):
        self.assertIsNone(review_memory.from_env({})[0])
        self.assertIsNone(review_memory.from_env({'ATOMICMEMORY_API_KEY':KEY,'CACAO_REVIEW_MEMORY_OPERATOR_ID':'huerto'})[0])
        self.assertIn('ATOMICMEMORY_API_KEY',review_memory.from_env({'CACAO_REVIEW_MEMORY':'1','CACAO_REVIEW_MEMORY_OPERATOR_ID':'huerto'})[1])
        self.assertIsNone(review_memory.from_env({'CACAO_REVIEW_MEMORY':'1','ATOMICMEMORY_API_KEY':KEY,'CACAO_REVIEW_MEMORY_OPERATOR_ID':'a b'})[0])
        insecure={'CACAO_REVIEW_MEMORY':'1','ATOMICMEMORY_API_KEY':KEY,'CACAO_REVIEW_MEMORY_OPERATOR_ID':'huerto','ATOMICMEMORY_API_URL':'http://memory.example'}
        self.assertIn('https',review_memory.from_env(insecure)[1])
        notes,_=review_memory.from_env({**insecure,'ATOMICMEMORY_API_URL':''})
        self.assertEqual((notes.url,notes.subject),('https://api.atomicstrata.ai','cacao-operator:huerto'))

    def test_timeout_is_bounded_and_reported_as_not_saved(self):
        fixture=FixtureMemory();fixture.mode='slow'
        try:
            notes=review_memory.TreeNotes(fixture.url,KEY,'huerto',timeout=.2);started=time.monotonic()
            with self.assertRaises(review_memory.MemoryUnavailable):notes.recall('cacao-4-18')
            self.assertLess(time.monotonic()-started,.9)
        finally:fixture.shutdown();fixture.server_close()


class TreeNotesReview(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.old=(server.RUNTIME,server.NOTES,server.NOTES_REASON)
        server.RUNTIME=Path(self.directory.name)
        server.atomic(server.RUNTIME/'orchard.json',{'pods':[{'id':'cacao-4-18-pod-6','plant_id':'cacao-4-18','position':[4,22,.4]},
                                                             {'id':'cacao-4-1-pod-2','plant_id':'cacao-4-1','position':[4,2,.4]}]})
        image=io.BytesIO();Image.new('RGB',(200,150),(20,80,10)).save(image,format='JPEG')
        self.add_frame(image.getvalue())
        self.fixture=FixtureMemory();server.NOTES=review_memory.TreeNotes(self.fixture.url,KEY,'operador-a',timeout=.5)
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);self.base='http://127.0.0.1:'+str(self.http.server_port)
        threading.Thread(target=self.http.serve_forever,daemon=True).start()

    def add_frame(self,jpeg):
        self.jpeg=jpeg
        server.FRAMES['memory-frame']={'frame_id':'memory-frame','wall_time':time.time(),'phase_id':1,'sim_time':3,'vehicle_id':'drone',
            'predictions':[{'class_id':1,'confidence':.9,'bbox':[10,10,80,100]}],
            'localization':{'version':1,'associations':[{'prediction_index':0,'pod_id':'cacao-4-18-pod-6','version':1,'visible_samples':5,'box_iou':.9}]}}
        server.FRAME_IMAGES['memory-frame']=jpeg

    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.fixture.shutdown();self.fixture.server_close()
        server.RUNTIME,server.NOTES,server.NOTES_REASON=self.old
        server.FRAMES.pop('memory-frame',None);server.FRAME_IMAGES.pop('memory-frame',None);self.directory.cleanup()

    def request(self,path,body=None,headers=None):
        try:
            with urlopen(Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**(headers or {})}),timeout=5) as r:
                return r.status,json.loads(r.read())
        except HTTPError as e:
            with e:return e.code,json.loads(e.read())

    def reviewed(self,note='Cicatriz antigua de un golpe: el modelo la confunde con monilia. Revisar de cerca.',decision='reject'):
        self.assertEqual(self.request('/api/observe',{'frame_id':'memory-frame','associations':[]})[0],202)
        state=self.request('/api/fleet')[1]
        status,_=self.request('/api/review/decision',{'task_id':'cacao-4-18-pod-6','decision':decision,'revision':1,'epoch':state['epoch'],'note':note})
        self.assertEqual(status,200)

    def test_note_from_a_saved_review_returns_after_reset_and_can_be_forgotten(self):
        self.reviewed()
        status,saved=self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})
        self.assertEqual((status,saved['stored'],saved['plant_id']),(200,True,'cacao-4-18'))
        sent=self.fixture.requests[-1]['body']
        self.assertEqual((sent['user_id'],sent['skip_extraction'],sent['content_class']),('cacao-operator:operador-a',True,'summary'))
        self.assertEqual(sent['metadata']['cacao_review_decision'],'reject')
        # Retrying the same stored review does not create a second note.
        self.assertTrue(self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})[1]['unchanged'])
        self.assertEqual(len(self.fixture.rows),1)
        # A new scenario clears every task; the tree note is still recalled.
        self.request('/api/fleet/control',{'action':'reset'});self.assertEqual(self.request('/api/fleet')[1]['tasks'],{})
        status,recalled=self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'})
        self.assertEqual(status,200)
        self.assertEqual([n['note'] for n in recalled['notes']],['Cicatriz antigua de un golpe: el modelo la confunde con monilia. Revisar de cerca.'])
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-1'})[1]['notes'],[])
        status,_=self.request('/api/review/memory/forget',{'plant_id':'cacao-4-18','memory_id':recalled['notes'][0]['id']})
        self.assertEqual(status,200);self.assertEqual(self.fixture.rows,[])
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'})[1]['notes'],[])

    def test_requests_cannot_choose_the_memory_subject(self):
        self.reviewed();self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6','user_id':'cacao-operator:operador-b'})
        self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18','user_id':'cacao-operator:operador-b'})
        self.assertEqual({r['body'].get('user_id') for r in self.fixture.requests},{'cacao-operator:operador-a'})
        other=review_memory.TreeNotes(self.fixture.url,KEY,'operador-b')
        self.assertEqual(other.recall('cacao-4-18'),[])
        with self.assertRaises(ValueError):other.forget('cacao-4-18',self.fixture.rows[0]['id'])
        self.assertEqual(len(self.fixture.rows),1)

    def test_public_viewer_cannot_read_or_write_notes(self):
        self.reviewed();(server.RUNTIME/'operator-token.txt').write_text('operator-secret')
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'})[0],403)
        self.assertEqual(self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})[0],403)
        self.assertEqual(self.fixture.requests,[])
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'},{'Authorization':'Bearer operator-secret'})[0],200)

    def test_provider_failure_keeps_the_decision_and_says_the_note_was_not_saved(self):
        self.reviewed(decision='approve');self.fixture.mode='fail'
        status,reply=self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})
        self.assertEqual(status,503);self.assertIn('no se guardó',reply['error']);self.assertNotIn(KEY,reply['error'])
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'})[0],503)
        task=json.loads((server.RUNTIME/'fleet-state.json').read_text())['tasks']['cacao-4-18-pod-6']
        self.assertEqual((task['review']['decision'],task['status']),('approve','pending'))

    def test_only_saved_reviews_with_a_note_and_known_trees_are_accepted(self):
        self.assertEqual(self.request('/api/observe',{'frame_id':'memory-frame','associations':[]})[0],202)
        self.assertEqual(self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})[0],400)
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-9-99'})[0],400)
        self.assertEqual(self.fixture.requests,[])
        state=self.request('/api/fleet')[1]
        self.request('/api/review/decision',{'task_id':'cacao-4-18-pod-6','decision':'reject','revision':1,'epoch':state['epoch'],'note':'  '})
        self.assertEqual(self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})[0],400)

    def test_disabled_feature_keeps_the_inbox_unchanged(self):
        server.NOTES,server.NOTES_REASON=None,'Notas recordadas desactivadas'
        self.assertEqual(self.request('/api/review/memory/recall',{'plant_id':'cacao-4-18'}),(200,{'enabled':False,'reason':'Notas recordadas desactivadas'}))
        self.reviewed();self.assertEqual(self.request('/api/review/memory/remember',{'task_id':'cacao-4-18-pod-6'})[0],409)
        self.assertEqual(self.fixture.requests,[])


if __name__=='__main__':unittest.main()
