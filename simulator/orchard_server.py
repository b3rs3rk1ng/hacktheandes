"""Loopback scene/telemetry service and actual pixel-only YOLO inference.

Rendering annotations never enter the detector. Observations may refer only to
predictions returned for an existing frame, then associate its box with geometry.
"""
import argparse
from collections import OrderedDict
import hashlib
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
import threading
import time
from urllib.parse import unquote, urlparse
import uuid
from fleet_core import Fleet, ReviewConflict
from review_evidence import save_evidence, evidence_path
from vision_geometry import SceneLocalizer, validate_camera, VERSION as LOCALIZATION_VERSION
from access import authorized
import review_memory

ROOT=Path(__file__).resolve().parent;RUNTIME=ROOT/'runtime'
CFG=json.loads((ROOT/'orchard_config.json').read_text())
LOCK=threading.Lock();FRAMES=OrderedDict();FRAME_IMAGES=OrderedDict();STARTED=time.time()
MODEL=None;MODEL_ERROR='Modelo iniciando';MODEL_INFO={};LAST=None
FLEET_LOCK=threading.Lock()
WORLD_CACHE=None
NOTES,NOTES_REASON=review_memory.from_env(os.environ)


def world_snapshot():
    global WORLD_CACHE
    path=RUNTIME/'orchard.json'
    try:key=(str(path),path.stat().st_mtime_ns)
    except FileNotFoundError:return {},None
    if WORLD_CACHE is None or WORLD_CACHE[0]!=key:
        data=read(path,{})
        WORLD_CACHE=(key,data,SceneLocalizer(data))
    return WORLD_CACHE[1],WORLD_CACHE[2]


def fleet_call(method=None,*args):
    with FLEET_LOCK:
        world,_=world_snapshot()
        fleet=Fleet(CFG,read(RUNTIME/'fleet-state.json'),plan=world.get('coverage'))
        fleet.coverage.set_scout(read(RUNTIME/'mission-status.json',{}))
        result=getattr(fleet,method)(*args) if method else None
        snapshot=fleet.snapshot();atomic(RUNTIME/'fleet-state.json',snapshot)
        return snapshot if result is None else result


def atomic(path,value):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False));temporary.replace(path)


def read(path,default=None):
    try:return json.loads(path.read_text())
    except (FileNotFoundError,json.JSONDecodeError):return default


def accepts_gzip(header):
    encodings={}
    for item in header.lower().split(','):
        parts=item.strip().split(';');quality=1.0
        for parameter in parts[1:]:
            if parameter.strip().startswith('q='):
                try:quality=float(parameter.strip()[2:])
                except ValueError:quality=0
        encodings[parts[0].strip()]=quality
    return encodings.get('gzip',encodings.get('*',0))>0


def load_model(weights,device):
    global MODEL,MODEL_ERROR,MODEL_INFO
    try:
        import numpy as np
        import torch
        from ultralytics import YOLO
        digest=hashlib.sha256(weights.read_bytes()).hexdigest()
        if digest!=CFG['model']['sha256']:raise ValueError('El checkpoint no coincide con el modelo seleccionado')
        model=YOLO(str(weights))
        names=[model.names[i] for i in sorted(model.names)]
        if names!=CFG['model']['names']:raise ValueError('Las clases del modelo no coinciden con el contrato')
        model.predict(np.zeros((384,640,3),dtype=np.uint8),device=device,imgsz=640,verbose=False,quantize=None)
        MODEL=model;MODEL_ERROR=None
        MODEL_INFO={'checkpoint':weights.name,'sha256':digest,'names':names,'device':str(model.predictor.device),'threshold':CFG['inspection']['alert_threshold'],'precision':'FP32','actual_inference':True}
        print(json.dumps({'model_ready':MODEL_INFO}),flush=True)
    except Exception as error:
        MODEL_ERROR=str(error);print(json.dumps({'model_error':MODEL_ERROR}),flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    disable_nagle_algorithm=True
    def send(self,status,value,mime='application/json; charset=utf-8'):
        data=value if isinstance(value,bytes) else json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        compressed=len(data)>4096 and mime.startswith('application/json') and accepts_gzip(self.headers.get('Accept-Encoding',''))
        if compressed:data=gzip.compress(data,compresslevel=3)
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        if compressed:self.send_header('Content-Encoding','gzip');self.send_header('Vary','Accept-Encoding')
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass

    def do_GET(self):
        route=unquote(urlparse(self.path).path)
        if route=='/api/session':self.send(200,{'operator':authorized(self.headers,RUNTIME),'shared':True});return
        if route=='/api/live':
            physical=read(RUNTIME/'mission-status.json',{})
            physical['counts']={'alerts':sum(o.get('target_score',0)>=CFG['inspection']['alert_threshold'] for o in physical.get('observed',{}).values())}
            for key in ('observed','events','limits'):physical.pop(key,None)
            fleet=read(RUNTIME/'fleet-state.json',{})
            self.send(200,{'physics':physical,'fleet':fleet,'model':MODEL_INFO,'model_error':MODEL_ERROR,'last_inference':LAST,'server_time':time.time()});return
        if route=='/api/fleet':self.send(200,fleet_call());return
        if route.startswith('/api/review/evidence/'):
            path=evidence_path(RUNTIME/'review-evidence',route.removeprefix('/api/review/evidence/'))
            if path:self.send(200,path.read_bytes(),'image/jpeg')
            else:self.send(404,{'error':'Foto no disponible'})
            return
        if route=='/api/model-card':self.send(200,read(ROOT/'assets/cacao-model-card.json',{}));return
        if route in ('/api/status','/api/telemetry'):
            state=read(RUNTIME/'mission-status.json',{})
            compact=route=='/api/telemetry'
            if compact:
                # The live viewer needs poses and counters, not a growing
                # observation history or a second copy of inference boxes.
                state={**state,'counts':{'alerts':sum(o.get('target_score',0)>=CFG['inspection']['alert_threshold'] for o in state.get('observed',{}).values())}}
                for key in ('observed','events','limits'):state.pop(key,None)
            reply={'physics':state,'model':MODEL_INFO,'model_error':MODEL_ERROR,'server_time':time.time()}
            if not compact:reply['last_inference']=LAST
            self.send(200,reply);return
        if route=='/api/world':
            self.send(200,read(RUNTIME/'orchard.json',{}));return
        if route=='/api/evaluation':
            data=read(RUNTIME/'orchard.json',{});state=read(RUNTIME/'mission-status.json',{})
            pods={p['id']:p for p in data.get('pods',[])};tp=fp=fn=tn=0
            for pid,obs in state.get('observed',{}).items():
                if pid not in pods:continue
                actual=pods[pid]['label'] in [CFG['model']['names'][i] for i in CFG['inspection']['target_class_ids']];alert=obs.get('target_score',0)>=CFG['inspection']['alert_threshold']
                tp+=actual and alert;fp+=not actual and alert;fn+=actual and not alert;tn+=not actual and not alert
            self.send(200,{'unit':'geometrically_associated_observed_pod','tp':tp,'fp':fp,'fn':fn,'tn':tn,'outcomes':state.get('outcomes',[]),'limitation':'Sólo frutos asociados a una caja. No cuenta todos los frutos visibles omitidos; no equivale a recall de detección ni a prueba independiente.'});return
        paths={'/':ROOT/'ui/orchard/index.html','/review':ROOT/'ui/orchard/review.html','/vision.jpg':RUNTIME/'mission-camera.jpg'}
        path=paths.get(route)
        if path is None:
            bases={'/ui/':ROOT/'ui','/assets/':ROOT/'assets','/vendor/':ROOT/'ui/vendor','/orchard/':ROOT/'ui/orchard','/robotics/':ROOT/'ui/robotics'}
            for prefix,base in bases.items():
                if route.startswith(prefix):
                    candidate=(base/route[len(prefix):]).resolve()
                    if candidate.is_relative_to(base.resolve()):path=candidate
                    break
        if path is None or not path.is_file():self.send(404,{'error':'Recurso no disponible'});return
        self.send(200,path.read_bytes(),mimetypes.guess_type(path.name)[0] or 'application/octet-stream')

    def do_POST(self):
        global LAST
        if not authorized(self.headers,RUNTIME):self.close_connection=True;self.send(403,{'error':'Esta sesión sólo puede observar la flota'});return
        origin=self.headers.get('Origin')
        if origin and origin not in [f'http://{self.headers.get("Host")}',f'https://{self.headers.get("Host")}']:self.send(403,{'error':'Origen inválido'});return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=2_000_000:
                self.close_connection=True;self.send(413,{'error':'Cuerpo demasiado grande o vacío'});return
            body=self.rfile.read(length);route=urlparse(self.path).path
            if route=='/api/infer':
                if self.headers.get('Content-Type')!='image/jpeg':self.send(415,{'error':'Se requiere JPEG'});return
                if MODEL is None:self.send(503,{'error':MODEL_ERROR});return
                if not LOCK.acquire(blocking=False):self.send(429,{'error':'Inferencia en curso'});return
                try:
                    import cv2,numpy as np,torch
                    frame_id=self.headers.get('X-Frame-Id','')
                    vehicle_id=self.headers.get('X-Vehicle-Id','drone')
                    if vehicle_id not in ['drone',*[r['id'] for r in CFG.get('fleet',{}).get('robots',[])]]:raise ValueError('Cámara desconocida')
                    sim_time=float(self.headers['X-Sim-Time']);phase_id=int(self.headers['X-Phase-Id'])
                    if not 1<=len(frame_id)<=80 or not math.isfinite(sim_time):raise ValueError('Metadatos inválidos')
                    image=cv2.imdecode(np.frombuffer(body,dtype=np.uint8),cv2.IMREAD_COLOR)
                    if image is None or max(image.shape[:2])>1280:raise ValueError('Imagen inválida o demasiado grande')
                    camera=json.loads(self.headers.get('X-Camera-Pose','null'))
                    if camera is not None:validate_camera(camera,image.shape[1],image.shape[0])
                    device=MODEL.predictor.device
                    if device.type=='cuda':torch.cuda.synchronize(device)
                    started=time.perf_counter();m=CFG['model']
                    result=MODEL.predict(image,conf=m['proposal_confidence'],iou=m['nms_iou'],agnostic_nms=True,imgsz=m['imgsz'],device=str(device),verbose=False,quantize=None)[0]
                    boxes=[]
                    for box in result.boxes:
                        boxes.append({'bbox':box.xyxy[0].cpu().tolist(),'class_id':int(box.cls[0]),'confidence':float(box.conf[0])})
                    if device.type=='cuda':torch.cuda.synchronize(device)
                    reply={'frame_id':frame_id,'sim_time':sim_time,'phase_id':phase_id,'width':image.shape[1],'height':image.shape[0],'predictions':boxes,'inference_ms':1000*(time.perf_counter()-started),'wall_time':time.time(),'source':'trained_yolo11s_pixels_only'}
                    reply.update(vehicle_id=vehicle_id,task_id=self.headers.get('X-Task-Id'))
                    if vehicle_id=='drone':
                        physical=read(RUNTIME/'mission-status.json',{})
                        if physical.get('phase')=='inspect' and physical.get('phase_id')==phase_id:reply.update(plant_id=physical.get('plant_id'),camera_role='scout')
                    else:
                        actor=read(RUNTIME/'fleet-state.json',{}).get('robots',{}).get(vehicle_id,{})
                        if actor.get('phase')=='surveying':reply.update(plant_id=actor.get('plant_id'),camera_role='survey')
                    localization_start=time.perf_counter();world,localizer=world_snapshot()
                    removed=read(RUNTIME/'fleet-state.json',{}).get('removed',[])
                    reply['camera']=camera
                    reply['localization']=localizer.associate(boxes,camera,image.shape[1],image.shape[0],removed) if camera and localizer else {
                        'version':LOCALIZATION_VERSION,'associations':[],'rejected':[{'prediction_index':i,'reason':'missing_camera_pose'} for i in range(len(boxes))]}
                    reply['localization_ms']=1000*(time.perf_counter()-localization_start)
                    FRAMES[frame_id]=reply
                    FRAME_IMAGES[frame_id]=body
                    while len(FRAMES)>24:
                        old,_=FRAMES.popitem(last=False);FRAME_IMAGES.pop(old,None)
                    LAST=reply;MODEL_INFO['frames_processed']=MODEL_INFO.get('frames_processed',0)+1
                    temporary=RUNTIME/'mission-camera.tmp';temporary.write_bytes(body);temporary.replace(RUNTIME/'mission-camera.jpg')
                    atomic(RUNTIME/'mission-last-inference.json',reply)
                    self.send(200,reply)
                finally:LOCK.release()
                return
            if self.headers.get('Content-Type')!='application/json':self.send(415,{'error':'Se requiere JSON'});return
            value=json.loads(body)
            if route=='/api/host/lease':self.send(200,fleet_call('lease',value['host_id']));return
            if route.startswith('/api/review/memory/'):self.tree_notes(route.removeprefix('/api/review/memory/'),value);return
            if route=='/api/review/decision':
                self.send(200,fleet_call('review',value['task_id'],value['decision'],value['revision'],value.get('note',''),value.get('epoch')));return
            if route=='/api/fleet/control':self.send(200,fleet_call('control',value['action']));return
            if route=='/api/fleet/claim':self.send(200,fleet_call('claim',value['task_id'],value['robot_id']));return
            if route=='/api/fleet/tree-complete':self.send(200,fleet_call('complete_tree',value['robot_id'],value['plant_id']));return
            if route=='/api/fleet/retry':self.send(200,fleet_call('retry',value['task_id']));return
            if route=='/api/fleet/transition':self.send(200,fleet_call('transition',value['task_id'],value['robot_id'],value['status'],value.get('reason')));return
            if route=='/api/fleet/heartbeat':self.send(200,fleet_call('heartbeat',value['robots'],value.get('host_id')));return
            if route=='/api/command':
                action=value.get('action')
                if action not in ['start','return','reset','hold','resume','speed','harvest']:raise ValueError('Acción desconocida')
                command={'action':action,'id':uuid.uuid4().hex,'created_at':time.time()}
                if action=='reset':
                    soc=value.get('soc',CFG['battery']['initial_soc'])
                    if isinstance(soc,bool) or not isinstance(soc,(int,float)) or not math.isfinite(soc) or not 0<=soc<=1:raise ValueError('Carga inicial inválida')
                    command['soc']=soc
                if action=='speed':command['fast']=bool(value.get('fast',False))
                if action=='harvest':command['enabled']=bool(value.get('enabled',False))
                queue=RUNTIME/'mission-commands';queue.mkdir(exist_ok=True)
                atomic(queue/(str(time.time_ns())+'_'+command['id']+'.json'),command);self.send(202,command);return
            if route=='/api/observe':
                with LOCK:
                    frame=FRAMES.get(value.get('frame_id'))
                    if not frame or time.time()-frame['wall_time']>20:raise ValueError('El fotograma no existe o expiró')
                    proposals=[];seen=set()
                    for association in value.get('associations',[])[:64]:
                        index=association['prediction_index'];pid=association['pod_id']
                        if isinstance(index,bool) or not isinstance(index,int) or not 0<=index<len(frame['predictions']):raise ValueError('Predicción inválida')
                        if not isinstance(pid,str) or len(pid)>100 or (index,pid) in seen:continue
                        seen.add((index,pid))
                    # Object identity comes from server-side localization of
                    # this exact frame. Caller-provided fruit IDs are not proof.
                    associations=frame.get('localization',{}).get('associations',[])
                    for association in associations:
                        prediction=frame['predictions'][association['prediction_index']]
                        proposals.append({'pod_id':association['pod_id'],'class_id':prediction['class_id'],'confidence':prediction['confidence']})
                    if frame.get('vehicle_id','drone')=='drone':atomic(RUNTIME/'mission-vision.json',{'frame_id':frame['frame_id'],'sim_time':frame['sim_time'],'phase_id':frame['phase_id'],'proposals':proposals})
                    data,_=world_snapshot()
                    pods={p['id']:p for p in data.get('pods',[])}
                    evidence={}
                    if (frame.get('vehicle_id','drone')=='drone' or frame.get('camera_role')=='survey') and frame['frame_id'] in FRAME_IMAGES:
                        snapshot=fleet_call()
                        for item in associations:
                            pid=item['pod_id'];prediction=frame['predictions'][item['prediction_index']]
                            previous=snapshot['tasks'].get(pid)
                            if pid not in pods or (previous and previous.get('evidence')):continue
                            if prediction['class_id'] not in CFG['inspection']['target_class_ids'] or prediction['confidence']<CFG['inspection']['alert_threshold']:continue
                            evidence[pid]=save_evidence(RUNTIME/'review-evidence',FRAME_IMAGES[frame['frame_id']],prediction,frame,item)
                    fleet_call('observe',{**frame,'review_evidence':evidence},associations,pods)
                self.send(202,{'associations':len(proposals)});return
            self.send(404,{'error':'Acción no disponible'})
        except ReviewConflict as error:self.send(409,{'error':str(error)})
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as error:self.send(400,{'error':str(error)})
        except Exception as error:
            print(json.dumps({'request_error':str(error)}),flush=True);self.send(500,{'error':'Falló la operación: '+str(error)})

    def tree_notes(self,action,value):
        # Operator-only (checked in do_POST) and outside the review decision:
        # a slow or failed memory service never blocks or alters a decision.
        if action not in ('recall','remember','forget'):self.send(404,{'error':'Acción no disponible'});return
        if NOTES is None:
            self.send(200,{'enabled':False,'reason':NOTES_REASON}) if action=='recall' else self.send(409,{'error':NOTES_REASON})
            return
        if action=='remember':
            snapshot=fleet_call();task=snapshot['tasks'].get(value['task_id'])
            if not task or task['review']['decision'] not in ('approve','reject'):raise ValueError('Sólo se recuerda la nota de una revisión guardada')
            if not task['review'].get('note'):raise ValueError('La revisión no tiene nota')
            work=lambda:NOTES.remember(task,snapshot['epoch']);plant=task['plant_id']
        else:
            plant=value['plant_id'];world,_=world_snapshot()
            if not isinstance(plant,str) or plant not in {p.get('plant_id') for p in world.get('pods',[])}:raise ValueError('Árbol desconocido')
            if action=='recall':work=lambda:{'notes':NOTES.recall(plant)}
            else:
                memory_id=value['memory_id']
                if not isinstance(memory_id,str) or not 0<len(memory_id)<=128:raise ValueError('Nota inválida')
                work=lambda:(NOTES.forget(plant,memory_id),{'forgotten':memory_id})[1]
        try:self.send(200,{'enabled':True,'plant_id':plant,**work()})
        except review_memory.MemoryUnavailable as error:
            self.send(503,{'error':f'{error}. '+('No se pudieron consultar las notas recordadas.' if action=='recall' else 'La nota no se guardó.' if action=='remember' else 'La nota no se borró.')})

    def log_message(self,fmt,*args):
        if len(args)>1 and str(args[1]) not in ('200','202','429'):super().log_message(fmt,*args)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--weights',type=Path,default=Path(CFG['model']['weights']));parser.add_argument('--device',default='0');args=parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    threading.Thread(target=load_model,args=(args.weights,args.device),daemon=True).start()
    print('Orchard: http://127.0.0.1:'+str(CFG['server']['port']),flush=True)
    ThreadingHTTPServer((CFG['server']['host'],CFG['server']['port']),Handler).serve_forever()
