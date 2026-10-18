"""Geometry-only, contiguous lane plans shared by scout and ground fleet."""
import math
import time


def build_coverage(plants, config):
    fleet=config.get('fleet',{});settings=fleet.get('coverage',{})
    robots=fleet.get('robots',[])
    if not settings.get('enabled') or not robots:return None
    axis=settings.get('axis_enu',[0,1]);length=math.hypot(*axis)
    if not length:raise ValueError('El eje de cobertura no puede ser cero')
    along=[v/length for v in axis];cross=[along[1],-along[0]]
    pitch=settings.get('lane_spacing_m',4)
    crop=config['inspection']['crop'];groups={}
    def project(p,axis):return sum(a*b for a,b in zip(p,axis))
    for plant in plants:
        if plant['crop']!=crop:continue
        lane=round(project(plant['position'],cross)/pitch)
        groups.setdefault(lane,[]).append(plant)
    lanes=sorted(groups);count=len(robots)
    center=sum(project(r['station_enu'],cross) for r in robots)/count
    nearest=min(range(len(lanes)),key=lambda i:abs(lanes[i]*pitch-center))
    start=max(0,min(len(lanes)-count,nearest-count//2))
    blocks=[lanes[start:start+count]]
    right=start+count;left=start
    while right<len(lanes):blocks.append(lanes[right:right+count]);right+=count
    while left>0:blocks.append(lanes[max(0,left-count):left]);left-=count
    batches=[];route=[];forward=True
    for index,block in enumerate(blocks):
        assigned=[]
        for robot,lane in zip(robots,block):
            ordered=sorted(groups[lane],key=lambda p:project(p['position'],along),reverse=not forward)
            assigned.append({'robot_id':robot['id'],'tree_ids':[p['id'] for p in ordered],'lane':lane})
        scout=[]
        for level in range(max(len(l['tree_ids']) for l in assigned)):
            row=[lane['tree_ids'][level] for lane in assigned if level<len(lane['tree_ids'])]
            if level%2:row.reverse()
            scout.extend(row)
        route.extend(scout);batches.append({'id':index,'forward':forward,'lanes':assigned,'scout_tree_ids':scout})
        forward=not forward
    return {'version':1,'axis_enu':along,'cross_enu':cross,'batches':batches,'drone_route':route}


def scout_can_advance(plan, tree_id, progress, lookahead=1):
    if not plan:return True
    batch_index=progress.get('batch',0)
    if batch_index>=len(plan['batches']):return False
    batch=plan['batches'][batch_index];indices=progress.get('indices',{})
    frontier=min(indices.get(l['robot_id'],0) for l in batch['lanes'])
    for lane in batch['lanes']:
        if tree_id in lane['tree_ids']:return lane['tree_ids'].index(tree_id)<=frontier+lookahead
    return False


def next_scout_index(plan, index, progress):
    """Rejoin the current ground frontier after charging or local coverage."""
    if not plan:return index
    complete=set(progress.get('completed',{}));batch_index=progress.get('batch',0)
    for batch in plan['batches'][:batch_index]:
        for lane in batch['lanes']:complete.update(lane['tree_ids'])
    if batch_index<len(plan['batches']):
        for lane in plan['batches'][batch_index]['lanes']:
            complete.update(lane['tree_ids'][:progress.get('indices',{}).get(lane['robot_id'],0)])
    route=plan['drone_route']
    while index<len(route) and route[index] in complete:index+=1
    return index


class CoverageLedger:
    def __init__(self, plan, config, state):
        self.plan=plan;self.cfg=config.get('fleet',{}).get('coverage',{});self.state=state
        for key,value in {'batch':0,'indices':{},'scouted':{},'inspected':{},'completed':{}}.items():state.setdefault(key,value)

    def set_scout(self,status,now=None):
        now=time.time() if now is None else now
        active=self.cfg.get('scout_active_phases',['takeoff','transit','inspect','scout_hold'])
        fresh=now-status.get('updated_at',0)<self.cfg.get('scout_stale_s',4)
        available=fresh and status.get('phase') in active
        self.state['scout']={'available':available,'phase':status.get('phase','offline'),'updated_at':status.get('updated_at',0)}
        self.state['local_inspection_allowed']=bool(self.cfg.get('continue_without_scout',False) and not available)

    def target(self,robot):
        if not self.plan or self.state['batch']>=len(self.plan['batches']):return None
        lane=next((l for l in self.plan['batches'][self.state['batch']]['lanes'] if l['robot_id']==robot),None)
        index=self.state['indices'].get(robot,0)
        return lane['tree_ids'][index] if lane and index<len(lane['tree_ids']) else None

    def observe(self,frame):
        tree=frame.get('plant_id');role=frame.get('camera_role');actor=frame.get('vehicle_id')
        if not self.plan or not tree:return
        if role=='scout' and actor=='drone':record=self.state['scouted'].setdefault(tree,{'frames':[]})
        elif role=='survey' and tree==self.target(actor):record=self.state['inspected'].setdefault(actor,{}).setdefault(tree,{'frames':[]})
        else:return
        if frame['frame_id'] not in record['frames']:record['frames'].append(frame['frame_id'])
        record['frames']=record['frames'][-8:];record['detections']=len(frame['predictions']);record['last_frame']=frame['frame_id']

    def complete(self,robot,tree):
        if self.target(robot)!=tree:raise ValueError('El árbol no es el siguiente de la fila asignada')
        required=self.cfg.get('minimum_survey_frames',2)
        scouted=len(self.state['scouted'].get(tree,{}).get('frames',[]))>=required
        if not scouted and not self.state.get('local_inspection_allowed'):raise ValueError('El dron todavía no envió el reconocimiento del árbol')
        if len(self.state['inspected'].get(robot,{}).get(tree,{}).get('frames',[]))<required:raise ValueError('Faltan imágenes de la cámara terrestre')
        batch=self.plan['batches'][self.state['batch']];indices=self.state['indices'];frontier=min(indices.get(l['robot_id'],0) for l in batch['lanes'])
        if indices.get(robot,0)>frontier+self.cfg.get('maximum_ground_lead_trees',1):raise ValueError('Esperando a los robots vecinos')
        self.state['completed'][tree]={'robot_id':robot,'method':'scout_assisted' if scouted else 'ground_local','time':time.time()}
        indices[robot]=indices.get(robot,0)+1
        if all(indices.get(l['robot_id'],0)>=len(l['tree_ids']) for l in batch['lanes']):self.state['batch']+=1;self.state['indices']={}
        return self.state
