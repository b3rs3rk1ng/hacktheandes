"""Persistent simulator task contract: human approval and fresh vision before a cut.

Scene geometry locates fruit; scene disease labels are never consulted here.
The renderer owns idealized arm motion, not force-controlled manipulation.
"""
import copy
import math
import time
from vision_geometry import VERSION as LOCALIZATION_VERSION
from coverage_plan import CoverageLedger

TERMINAL={'completed','rejected','unreachable','interrupted'}
NEXT={'claimed':'verifying','verified':'gripping','gripping':'cutting',
      'cutting':'carrying','carrying':'depositing','depositing':'completed'}
WAITING={'pending','awaiting_review','awaiting_evidence'}


class ReviewConflict(ValueError):
    pass


class Fleet:
    def __init__(self, config, state=None, clock=time.time, plan=None):
        self.cfg=config; self.clock=clock
        self.robots={r['id']:r for r in config.get('fleet',{}).get('robots',[])}
        self.data=copy.deepcopy(state) if state else {'enabled':False,'returning':False,'tasks':{},'removed':[], 'robots':{},'events':[],'epoch':0}
        self.coverage=CoverageLedger(plan,config,self.data.setdefault('coverage',{}))
        # Old automatic tasks have no human authorization. Never infer one from
        # a model score or from an already running browser.
        for task in self.data['tasks'].values():
            evidence=task.get('evidence')
            if evidence and (evidence.get('localization') or {}).get('version')!=LOCALIZATION_VERSION and task['pod_id'] not in self.data['removed']:
                task['previous_evidence']=evidence;task['evidence']=None
                if task.get('review',{}).get('decision')!='reject':
                    previous=task.get('review',{});task['review']={'decision':'pending','revision':previous.get('revision',0)+1,
                        'previous_decision':previous.get('decision'),'reason':'La captura anterior no comprobaba visibilidad del fruto'}
                    task.update(status='awaiting_evidence',robot_id=None,verification=[])
            if 'review' not in task:
                task['review']={'decision':'pending','revision':1}
                if task['status'] not in TERMINAL and task['pod_id'] not in self.data['removed']:
                    task.update(status='awaiting_review',robot_id=None,verification=[])
            if task['status']=='awaiting_review' and not task.get('evidence'):
                task['status']='awaiting_evidence'

    def event(self, task, kind):
        self.data['events'].append({'time':self.clock(),'kind':kind,'task_id':task.get('id'),'robot_id':task.get('robot_id')})
        self.data['events']=self.data['events'][-160:]

    def expire(self):
        for task in self.data['tasks'].values():
            if task['status'] not in TERMINAL|WAITING and self.clock()-task.get('heartbeat',0)>self.cfg.get('fleet',{}).get('task_lease_s',90):
                task['status']='interrupted' if task['pod_id'] in self.data['removed'] else 'pending'
                task['robot_id']=None;task['verification']=[];self.event(task,'lease_expired')

    def observe(self, frame, associations, pods):
        self.coverage.observe(frame)
        actor=frame.get('vehicle_id','drone'); threshold=self.cfg['inspection']['alert_threshold']
        targets=self.cfg['inspection']['target_class_ids'];seen=set()
        for item in associations:
            pid=item['pod_id'];prediction=frame['predictions'][item['prediction_index']]
            if pid not in pods or pid in seen:continue
            seen.add(pid)
            if prediction['class_id'] not in targets or prediction['confidence']<threshold:continue
            if actor=='drone' or frame.get('camera_role')=='survey':
                if pid in self.data['removed']:continue
                evidence=frame.get('review_evidence',{}).get(pid)
                if pid in self.data['tasks']:
                    task=self.data['tasks'][pid]
                    if task['status'] in ('awaiting_review','awaiting_evidence') and not task.get('evidence') and evidence:
                        task.update(status='awaiting_review',evidence=evidence,drone_frame=frame['frame_id'],confidence=prediction['confidence'])
                        task['review']['revision']+=1
                    continue
                pod=pods[pid]
                self.data['tasks'][pid]={'id':pid,'pod_id':pid,'plant_id':pod['plant_id'],'position':pod['position'],
                    'status':'awaiting_review' if evidence else 'awaiting_evidence','robot_id':None,'created_at':self.clock(),'drone_frame':frame['frame_id'],
                    'confidence':prediction['confidence'],'verification':[], 'evidence':evidence,'detected_by':actor,
                    'review':{'decision':'pending','revision':1}}
                self.event(self.data['tasks'][pid],'alert_located')
            elif actor in self.robots:
                task=self.data['tasks'].get(pid)
                if not task or task['robot_id']!=actor or task['status']!='verifying':continue
                if frame.get('task_id')!=task['id'] or frame['wall_time']<task['verification_started']:continue
                if frame['frame_id'] in task['verification']:continue
                task['verification'].append(frame['frame_id']);task['heartbeat']=self.clock()
                if len(task['verification'])>=self.cfg.get('fleet',{}).get('verification_frames',2):
                    task['status']='verified';self.event(task,'camera_verified')

    def review(self, pid, decision, revision, note='', epoch=None):
        if isinstance(epoch,bool) or not isinstance(epoch,int) or epoch!=self.data['epoch']:
            raise ReviewConflict('El escenario cambió. Actualiza el buzón antes de decidir.')
        task=self.data['tasks'].get(pid)
        if not task:raise ValueError('Sospecha desconocida')
        if decision not in ('approve','reject'):raise ValueError('Decisión inválida')
        if isinstance(revision,bool) or not isinstance(revision,int):raise ValueError('Versión de revisión inválida')
        if not isinstance(note,str) or len(note)>500:raise ValueError('Nota demasiado larga')
        current=task['review']
        if current['decision']==decision and current.get('previous_revision')==revision:return task
        if current['decision']!='pending' or current['revision']!=revision:
            raise ReviewConflict('La sospecha ya cambió o fue revisada. Actualiza el buzón.')
        if task['status']!='awaiting_review':raise ReviewConflict('La tarea ya no espera revisión')
        if not task.get('evidence'):raise ValueError('Falta la foto original; espera una nueva observación del dron')
        if (task['evidence'].get('localization') or {}).get('version')!=LOCALIZATION_VERSION:
            raise ValueError('La foto no tiene una localización visible comprobada')
        task['review']={'decision':decision,'revision':revision+1,'previous_revision':revision,
                        'decided_at':self.clock(),'actor':'operador local','note':note.strip()}
        task.update(status='pending' if decision=='approve' else 'rejected',robot_id=None,verification=[])
        self.event(task,'human_approved' if decision=='approve' else 'human_rejected')
        return task

    def control(self, action):
        if action=='reset':
            epoch=self.data['epoch']+1
            self.data={'enabled':False,'returning':False,'tasks':{},'removed':[], 'robots':{},'events':[],'epoch':epoch}
            self.coverage=CoverageLedger(self.coverage.plan,self.cfg,self.data.setdefault('coverage',{}))
        elif action in ('start','return','hold'):
            self.data['enabled']=action=='start';self.data['returning']=action=='return'
        else:raise ValueError('Orden de flota desconocida')

    def claim(self, pid, robot):
        self.expire()
        if robot not in self.robots:raise ValueError('Robot desconocido')
        if not self.data['enabled']:raise ValueError('Flota detenida')
        task=self.data['tasks'].get(pid)
        if not task or task['status']!='pending':raise ValueError('Objetivo ya asignado o terminado')
        if task['review']['decision']!='approve':raise ValueError('Falta aprobación del agricultor')
        if self.coverage.plan and self.coverage.target(robot)!=task['plant_id']:raise ValueError('El robot debe llegar a ese árbol siguiendo su fila')
        if any(t.get('robot_id')==robot and t['status'] not in TERMINAL|WAITING for t in self.data['tasks'].values()):raise ValueError('Robot ocupado')
        if any(t['plant_id']==task['plant_id'] and t['status'] not in TERMINAL|WAITING for t in self.data['tasks'].values()):raise ValueError('Otro robot está atendiendo ese árbol')
        task.update(status='claimed',robot_id=robot,heartbeat=self.clock(),verification=[])
        self.event(task,'assigned');return task

    def retry(self, pid):
        task=self.data['tasks'].get(pid)
        if not task or task['status'] not in {'unreachable','rejected','interrupted'} or task['review']['decision']!='approve' or pid in self.data['removed']:
            raise ValueError('Sólo se puede reintentar una tarea aprobada sin retirar el fruto')
        task.update(status='pending',robot_id=None,verification=[])
        task.pop('reason',None);self.event(task,'retry_requested');return task

    def complete_tree(self,robot,tree):
        if any(t['plant_id']==tree and t['status'] not in TERMINAL|{'awaiting_evidence','awaiting_review'} for t in self.data['tasks'].values()):raise ValueError('Hay una retirada aprobada pendiente en este árbol')
        self.coverage.complete(robot,tree)
        self.event({'id':tree,'robot_id':robot},'tree_surveyed')

    def transition(self, pid, robot, status, reason=None):
        task=self.data['tasks'].get(pid)
        if not task or task.get('robot_id')!=robot:raise ValueError('La tarea no pertenece al robot')
        if task['status']==status:return task
        if status not in {'rejected','unreachable','interrupted'} and NEXT.get(task['status'])!=status:raise ValueError('Transición de tarea inválida')
        if task['status'] in TERMINAL:raise ValueError('La tarea ya terminó')
        if status not in {'rejected','unreachable','interrupted'} and task['review']['decision']!='approve':
            raise ValueError('Falta aprobación del agricultor')
        task.update(status=status,heartbeat=self.clock())
        if reason:task['reason']=str(reason)[:240]
        if status=='verifying':task['verification_started']=self.clock();task['verification']=[]
        if status=='carrying' and pid not in self.data['removed']:self.data['removed'].append(pid)
        self.event(task,status);return task

    def lease(self, owner):
        if not isinstance(owner,str) or not 8<=len(owner)<=100:raise ValueError('Identidad de simulación inválida')
        previous=self.data.get('host_lease',{})
        if previous.get('owner') not in (None,owner) and self.clock()-previous.get('updated_at',0)<8:return {'granted':False}
        self.data['host_lease']={'owner':owner,'updated_at':self.clock()};return {'granted':True}

    def heartbeat(self, robots, owner=None):
        if owner and not self.lease(owner)['granted']:raise ValueError('Otra sesión mantiene la simulación compartida')
        for robot in robots:
            rid=robot.get('id');position=robot.get('position');soc=robot.get('soc')
            if rid not in self.robots or not isinstance(position,list) or len(position)!=3 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in position):raise ValueError('Telemetría terrestre inválida')
            if not isinstance(soc,(int,float)) or not math.isfinite(soc) or not 0<=soc<=1:raise ValueError('Batería inválida')
            previous=self.data['robots'].get(rid,{})
            started=previous.get('phase_started_at',self.clock()) if previous.get('phase')==robot.get('phase') and previous.get('plant_id')==robot.get('plant_id') else self.clock()
            self.data['robots'][rid]={**robot,'updated_at':self.clock(),'phase_started_at':started}
            for task in self.data['tasks'].values():
                if task.get('robot_id')==rid and task['status'] not in TERMINAL:task['heartbeat']=self.clock()

    def snapshot(self):
        self.expire();return copy.deepcopy(self.data)
