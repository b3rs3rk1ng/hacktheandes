"""Webots integrates the rigid body. Only an explicit scenario reset changes pose.

Visual observations come from rendered RGB -> trained YOLO -> geometric ray cast.
The disease labels in the scene never select an action; they score its outcome.
The cutter and attachment are explicitly idealized, without cutting resistance.
"""
import ctypes
import json
import math
from pathlib import Path
import sys
import time
from controller import Supervisor
from controller.wb import wb

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from terrain import height_at
from flight_geometry import vegetation_capsules, ObstacleField, plan_vertical_escape
from flight_core import FlightDynamics, Battery, distance, flight_control, motor_power, return_budget, plan_horizontal_path, wrap
from coverage_plan import scout_can_advance, next_scout_index
from mission_resume import restore_parked

RUNTIME=ROOT/'runtime'
DATA=json.loads((RUNTIME/'orchard.json').read_text())
CFG=DATA['config']; F=CFG['flight']; INS=CFG['inspection']; HOME=CFG['field']['home']
F={**F,'return_height_m':max(F['return_height_m'],DATA.get('terrain',{}).get('maximum',0)+max(p['height'] for p in DATA['plants'])+.65)}
PLANTS={p['id']:p for p in DATA['plants']}; PODS={p['id']:p for p in DATA['pods']}
LABELS={'idle':'Listo en la base','takeoff':'Despegando','transit':'Hacia el siguiente árbol',
 'inspect':'Inspeccionando cacao','grip_approach':'Aproximando la pinza','grip':'Comprobando agarre',
 'retreat':'Retirando la mazorca','return_climb':'Ascendiendo para regresar','return_transit':'Regresando a la base',
 'deposit':'Llevando al recipiente','release':'Depositando la mazorca','landing':'Aterrizando',
 'charging':'Cargando en la base','hold':'Manteniendo posición','failed':'Maniobra detenida','scout_hold':'Mapa enviado · esperando avance de terrestres'}


def read(path, default=None):
    try:return json.loads(path.read_text())
    except (FileNotFoundError,json.JSONDecodeError):return default


def atomic(path, value):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False));tmp.replace(path)


robot=Supervisor(); dt_ms=int(robot.getBasicTimeStep()); dt=dt_ms/1000
body=robot.getSelf();body.enableContactPointsTracking(dt_ms); gripper=robot.getDevice('gripper');gripper.enablePresence(dt_ms)
flight_dynamics=FlightDynamics(F)
battery=Battery(CFG['battery']);phase='idle';phase_id=0;phase_start=robot.getTime()
command_id=None;vision_id=None;frames=0;route_index=0;view_index=0
waypoint=list(HOME);look=[HOME[0],HOME[1]+3,1.6];yaw=math.pi/2
selected=None;active_node=None;loaded=False;removed={};moving={};fixtures={};observed={};visited=set();events=[]
last_status_wall=0;mission_start=None;return_reason=None;hold_phase=None;fast=False
camera_look=list(look);arrival=None;last_thrust=0;outcomes=[]
harvest_enabled=CFG['manipulation']['enabled'] and not F.get('inspection_only',False)
resume_after_charge=False
return_cause=None
navigation_phase_id=None;navigation=[];navigation_index=0
fleet_status={};last_fleet_read=0
resume=restore_parked(read(RUNTIME/'mission-restart.json'),DATA)
(RUNTIME/'mission-restart.json').unlink(missing_ok=True)
if resume:
    battery=Battery(CFG['battery'],resume['battery']['soc']);phase=resume['phase'];route_index=resume.get('route_index',0)
    visited=set(resume.get('visited',[]));observed=resume.get('observed',{});mission_start=-resume.get('mission_time',0)
    resume_after_charge=phase=='charging'

FLIGHT_OBSTACLES=ObstacleField(c for plant in DATA['plants'] for c in vegetation_capsules(plant,max_depth=F.get('branch_collision_depth',1)))
OBSTACLES=[p['position'] for p in DATA['plants'] if p['crop']!='maize']


def payload_mass():
    return selected['mass_kg'] if loaded and selected else 0


def transition(new, reason=None):
    global phase,phase_id,phase_start,frames,arrival
    phase=new;phase_id+=1;phase_start=robot.getTime();frames=0;arrival=None
    event={'phase':new,'phase_id':phase_id,'sim_time':phase_start,'reason':reason,'label':LABELS[new],
           'battery_soc':battery.soc,'position':body.getPosition(),'return_cause':return_cause,
           'return_budget':return_budget(body.getPosition(),HOME,F,battery,payload_mass())}
    events.append(event);events[:]=events[-80:]
    print(json.dumps(event,ensure_ascii=False),flush=True)


def reset(soc):
    global battery,route_index,view_index,selected,active_node,loaded,removed,moving,fixtures,observed,visited,events,mission_start,return_reason,return_cause,outcomes
    gripper.unlock()
    flight_dynamics.reset()
    for node in list(moving.values()):node.remove()
    for node in list(fixtures.values()):node.remove()
    moving={};fixtures={};removed={};observed={};visited=set();events=[];outcomes=[];selected=None;active_node=None;loaded=False
    body.getField('translation').setSFVec3f(HOME);body.getField('rotation').setSFRotation([0,0,1,math.pi/2]);body.resetPhysics()
    battery=Battery(CFG['battery'],soc);route_index=0;view_index=0;mission_start=None;return_reason=None;return_cause=None
    transition('idle','Escenario restablecido explícitamente')


def return_home(reason,resume=True,cause='operator'):
    global return_reason,selected,active_node,resume_after_charge,return_cause
    if phase not in ('return_climb','return_transit','deposit','release','landing','charging','idle'):
        if selected and not loaded and phase in ('grip_approach','grip'):
            gripper.unlock();active_node.remove();moving.pop(selected['id'],None);fixtures.pop(selected['id']).remove();selected=None;active_node=None
        return_reason=reason;return_cause=cause;resume_after_charge=resume;transition('return_climb',reason)


def inspection_pose():
    plant=PLANTS[DATA['route'][route_index]];x,y,_=plant['position'];levels=INS.get('height_levels_m',[INS['height_m']]);a=INS['angles'][view_index//len(levels)];height=levels[view_index%len(levels)]+plant['position'][2]
    return [x+INS['radius_m']*math.cos(a),y+INS['radius_m']*math.sin(a),height],[x,y,height]


def spawn_target(pod):
    identifier=pod['id'];p=pod['position'];a=pod['angle']
    stem_model='stem-'+identifier;children=robot.getRoot().getField('children');grip_offset=CFG['manipulation']['grip_offset_m'];radii=pod.get('radii_m',CFG['manipulation']['fruit_radii_m']);radius=radii[0];length=radii[2]*2-2*radius
    # As in the original manipulation lab: a dynamic fruit is held by a stem
    # connector until grip is verified. Never lock the drone to a static fruit.
    fixture=f'Robot {{ translation {p[0]-math.cos(a)*grip_offset} {p[1]-math.sin(a)*grip_offset} {p[2]} name "fixture-{identifier}" controller "<none>" children [ Connector {{ rotation 0 0 1 {a} name "stem fixture" model "{stem_model}" type "passive" }} ] }}'
    children.importMFNodeFromString(-1,fixture);fixtures[identifier]=children.getMFNode(-1)
    text=f'Solid {{ translation {p[0]} {p[1]} {p[2]} name "{identifier}" children [ Shape {{ appearance PBRAppearance {{ baseColor .45 .28 .12 }} geometry Sphere {{ radius {radius} }} }} Connector {{ translation {math.cos(a)*grip_offset} {math.sin(a)*grip_offset} 0 rotation 0 0 1 {a} name "fruit grip" model "orchard-grip" type "passive" }} Connector {{ translation {-math.cos(a)*grip_offset} {-math.sin(a)*grip_offset} 0 rotation 0 0 1 {a+math.pi} name "fruit stem" model "{stem_model}" type "active" isLocked TRUE }} ] boundingObject Capsule {{ radius {radius} height {length} }} physics Physics {{ density -1 mass {pod["mass_kg"]} }} }}'
    children.importMFNodeFromString(-1,text)
    node=children.getMFNode(-1);moving[identifier]=node
    return node


while robot.step(dt_ms)!=-1:
    now=robot.getTime();position=body.getPosition();velocity=body.getVelocity();rotation=body.getOrientation()
    if time.monotonic()-last_fleet_read>.2:
        fleet_status=read(RUNTIME/'fleet-state.json',{});last_fleet_read=time.monotonic()
        if phase in ('idle','charging','scout_hold','takeoff'):
            route_index=next_scout_index(DATA.get('coverage'),route_index,fleet_status.get('coverage',{}))
            if route_index>=len(DATA['route']) and phase in ('scout_hold','takeoff'):return_home('Recorrido completado por el equipo',cause='route_complete')
    for command_path in sorted((RUNTIME/'mission-commands').glob('*.json')):
        command=read(command_path,{})
        if command.get('id') and command['id']!=command_id:
            command_id=command['id'];action=command['action']
            if action=='reset':reset(command.get('soc',CFG['battery']['initial_soc']))
            elif action=='start' and phase in ('idle','charging') and route_index<len(DATA['route']):
                if battery.remaining_wh > return_budget(position,HOME,F,battery)['required_wh']:
                    mission_start=now;return_reason=None;transition('takeoff')
                else:events.append({'phase':'idle','label':'Carga insuficiente para despegar con reserva','sim_time':now})
            elif action=='return':return_home('Regreso solicitado',resume=False)
            elif action=='hold' and phase not in ('idle','charging','hold'):
                hold_phase=phase;waypoint=list(position);transition('hold')
            elif action=='resume' and phase=='hold':transition(hold_phase or 'return_climb')
            elif action=='speed':
                fast=bool(command.get('fast'));robot.simulationSetMode(Supervisor.SIMULATION_MODE_FAST if fast else Supervisor.SIMULATION_MODE_REAL_TIME)
            elif action=='harvest':harvest_enabled=bool(command.get('enabled')) and not F.get('inspection_only',False)
        command_path.unlink(missing_ok=True)

    vision=read(RUNTIME/'mission-vision.json',{})
    if vision.get('frame_id') and vision['frame_id']!=vision_id:
        vision_id=vision['frame_id']
        if phase=='inspect' and vision.get('phase_id')==phase_id and vision.get('sim_time',-1)>=phase_start:
            frames+=1
            frame_best={};frame_scores={}
            for proposal in vision.get('proposals',[]):
                pid=proposal.get('pod_id');pod=PODS.get(pid)
                if not pod or pod['plant_id']!=DATA['route'][route_index] or pid in removed:continue
                if proposal['confidence']>frame_best.get(pid,{}).get('confidence',-1):frame_best[pid]=proposal
                if proposal['class_id'] in INS['target_class_ids']:frame_scores[pid]=max(frame_scores.get(pid,0),proposal['confidence'])
            for pid,proposal in frame_best.items():
                previous=observed.get(pid,{})
                observed[pid]={'class_id':proposal['class_id'],'confidence':proposal['confidence'],'sim_time':now,
                    'target_score':max(previous.get('target_score',0),frame_scores.get(pid,0)),'frames_seen':previous.get('frames_seen',0)+1}
            candidates=[p for p in vision.get('proposals',[]) if p.get('pod_id') in PODS and PODS[p['pod_id']]['plant_id']==DATA['route'][route_index] and p['pod_id'] not in removed and p['class_id'] in INS['target_class_ids'] and p['confidence']>=INS['alert_threshold']]
            if candidates and harvest_enabled and distance(position,waypoint)<.15:
                proposal=max(candidates,key=lambda p:p['confidence']);selected={**PODS[proposal['pod_id']], 'prediction_class_id':proposal['class_id']}
                active_node=spawn_target(selected);transition('grip_approach','Alerta visual del modelo; pinza idealizada')

    budget=return_budget(position,HOME,F,battery,payload_mass())
    if budget['margin_wh']<=0:return_home('Reserva para volver y aterrizar',cause='energy_reserve')
    if battery.soc<=0 and phase not in ('idle','charging','failed'):transition('failed','Energía agotada')

    if phase=='idle':waypoint=list(HOME);look=[HOME[0],HOME[1]+4,1.6]
    elif phase=='scout_hold':pass
    elif phase=='takeoff':waypoint=[HOME[0],HOME[1],2.0];look=[0,6,1.55]
    elif phase in ('transit','inspect'):
        desired,look=inspection_pose()
        if phase=='transit':
            if navigation_phase_id!=phase_id:
                navigation_phase_id=phase_id;navigation_index=0
                try:navigation=plan_horizontal_path(position,desired,OBSTACLES,clearance=INS['obstacle_clearance_m'])
                except ValueError:
                    navigation=[];return_home('No se encontró una aproximación libre de troncos',cause='blocked_path');waypoint=[position[0],position[1],F['return_height_m']]
            if navigation:
                target_xy=navigation[navigation_index]
                if math.dist(position[:2],target_xy)<.10 and navigation_index<len(navigation)-1:navigation_index+=1
                waypoint=[*navigation[navigation_index],max(desired[2],height_at(DATA.get('terrain'),*position[:2])+.9,height_at(DATA.get('terrain'),*navigation[navigation_index])+.9)]
        else:waypoint=desired
    elif phase in ('grip_approach','grip'):
        a=selected['angle'];radius=CFG['manipulation']['tool_offset_m']+CFG['manipulation']['grip_offset_m']
        waypoint=[selected['position'][0]+radius*math.cos(a),selected['position'][1]+radius*math.sin(a),selected['position'][2]];look=list(selected['position'])
    elif phase=='retreat':
        a=selected['angle'];waypoint=[selected['position'][0]+1.2*math.cos(a),selected['position'][1]+1.2*math.sin(a),selected['position'][2]+.25];look=list(selected['position'])
    elif phase=='return_climb':
        if arrival is None:arrival=list(position)
        if navigation_phase_id!=phase_id:
            navigation_phase_id=phase_id;navigation_index=0
            try:navigation=plan_vertical_escape(position,F['return_height_m'],FLIGHT_OBSTACLES,F.get('cage_radius_m',.35)+abs(F.get('cage_center_y_m',0)),margin=F.get('obstacle_margin_m',.18))
            except ValueError:
                navigation=[];hold_phase='return_climb';waypoint=list(position);transition('hold','No se encontró un ascenso libre de ramas; vuelo detenido')
        if navigation:
            if distance(position,navigation[navigation_index])<.10 and navigation_index<len(navigation)-1:navigation_index+=1
            waypoint=navigation[navigation_index]
        look=[HOME[0],HOME[1],position[2]]
    elif phase=='return_transit':waypoint=[HOME[0],HOME[1],F['return_height_m']];look=[HOME[0],HOME[1]+3,2]
    elif phase in ('deposit','release'):
        b=CFG['manipulation']['bin'];waypoint=[b[0]-.5,b[1],1.1];look=[b[0]+2,b[1],1.1]
    elif phase=='landing':
        contact_height=max(height_at(DATA.get('terrain'),HOME[0],HOME[1]),.08)+F.get('cage_radius_m',.22)-F.get('cage_center_y_m',0)
        waypoint=[HOME[0],HOME[1],min(HOME[2],contact_height-.008)];look=[HOME[0],HOME[1]+3,1.6]
    elif phase=='charging':waypoint=list(HOME);look=[HOME[0],HOME[1]+3,1.6]
    if phase not in ('hold',):
        delta=[look[0]-position[0],look[1]-position[1]]
        if math.hypot(*delta)>.05:yaw=math.atan2(delta[1],delta[0])
    safety_acceleration,obstacle_gap=FLIGHT_OBSTACLES.safety_acceleration(position,velocity,F.get('cage_radius_m',.35)+abs(F.get('cage_center_y_m',0)),F['max_acceleration_mps2'])
    thrust,torque,drag,stable=flight_dynamics.step(position,velocity,rotation,waypoint,yaw,dt,time_s=now,payload_kg=payload_mass(),armed=phase not in ('idle','charging','failed'),safety_acceleration=safety_acceleration)
    ground=phase in ('idle','charging')
    if not ground and phase!='failed':
        body.addForce([0,0,thrust],True);body.addForce(drag,False)
        wb.wb_supervisor_node_add_torque(body._ref,(ctypes.c_double*3)(*torque),0)
        battery.consume(motor_power(thrust,F),dt)
    elif phase=='charging':battery.charge(dt)
    else:battery.consume(0,dt)
    last_thrust=thrust if not ground else 0

    if phase=='takeoff' and stable:transition('transit')
    elif phase=='transit' and stable and navigation_index==len(navigation)-1:transition('inspect')
    elif phase=='inspect' and stable and now-phase_start>=INS['dwell_s'] and frames>=INS['minimum_frames']:
        view_index+=1
        if view_index>=len(INS['angles'])*len(INS.get('height_levels_m',[INS['height_m']])):
            visited.add(DATA['route'][route_index]);route_index+=1;view_index=0
        if route_index>=len(DATA['route']):return_home('Recorrido de inspección completado',cause='route_complete')
        elif DATA.get('coverage') and not scout_can_advance(DATA['coverage'],DATA['route'][route_index],fleet_status.get('coverage',{}),CFG.get('fleet',{}).get('coverage',{}).get('scout_lookahead_trees',1)):
            waypoint=list(position);transition('scout_hold','Los terrestres mantienen filas vecinas; el dron conserva un árbol de ventaja')
        else:transition('transit')
    elif phase=='scout_hold' and scout_can_advance(DATA.get('coverage'),DATA['route'][min(route_index,len(DATA['route'])-1)],fleet_status.get('coverage',{}),CFG.get('fleet',{}).get('coverage',{}).get('scout_lookahead_trees',1)):
        transition('transit','Los terrestres avanzaron al siguiente árbol')
    elif phase=='grip_approach':
        if stable and gripper.getPresence():gripper.lock();transition('grip')
        elif now-phase_start>18:
            events.append({'sim_time':now,'label':'No se confirmó contacto; fruto intacto'})
            active_node.remove();moving.pop(selected['id'],None);fixtures.pop(selected['id']).remove();selected=None;active_node=None;transition('inspect')
    elif phase=='grip' and now-phase_start>.5:
        if gripper.isLocked():
            active_node.getField('children').getMFNode(2).getField('isLocked').setSFBool(False)
            loaded=True;removed[selected['id']]=True;transition('retreat','Unión liberada después de confirmar agarre')
        else:
            active_node.remove();moving.pop(selected['id'],None);fixtures.pop(selected['id']).remove();selected=None;active_node=None;transition('inspect','Agarre no confirmado; no se corta')
    elif phase=='retreat' and stable:return_home('Transportando una mazorca al recipiente',cause='payload')
    elif phase=='return_climb' and stable and navigation_index==len(navigation)-1:transition('return_transit')
    elif phase=='return_transit' and stable:transition('deposit' if loaded else 'landing')
    elif phase=='deposit' and stable:
        gripper.unlock();loaded=False;transition('release')
    elif phase=='release' and now-phase_start>2:
        p=active_node.getPosition();b=CFG['manipulation']['bin'];s=CFG['manipulation']['bin_size']
        deposited=abs(p[0]-b[0])<s[0]/2 and abs(p[1]-b[1])<s[1]/2 and -.1<p[2]<s[2]+.3
        outcomes.append({'pod_id':selected['id'],'deposited':deposited,'actual_label':selected['label'],'predicted_class':CFG['model']['names'][selected['prediction_class_id']],'sim_time':now})
        transition('landing','Depósito confirmado' if deposited else 'El fruto cayó fuera del recipiente')
    elif phase=='landing' and body.getContactPoints() and distance(position,HOME)<.12 and math.sqrt(sum(v*v for v in velocity[:3]))<.16:
        transition('charging','Contacto con la base; carga CC/CV aproximada')
    elif phase=='charging' and battery.soc>=CFG['battery']['resume_at_soc'] and resume_after_charge and INS['auto_resume_after_charge'] and route_index<len(DATA['route']):
        resume_after_charge=False;transition('takeoff','Carga suficiente; se retoma el recorrido')

    if time.monotonic()-last_status_wall>.075:
        last_status_wall=time.monotonic()
        payloads={pid:{'position':node.getPosition(),'orientation':node.getOrientation()} for pid,node in moving.items()}
        current_plant=DATA['route'][min(route_index,len(DATA['route'])-1)]
        status={'engine':'Webots R2025a / ODE','updated_at':time.time(),'simulation_time':now,'mission_time':now-mission_start if mission_start else 0,
          'phase_elapsed_s':now-phase_start,'last_command_id':command_id,'phase':phase,'phase_id':phase_id,'label':LABELS[phase],'position':position,'velocity':velocity,'orientation':rotation,'look_at':look,'waypoint':waypoint,
          'battery':battery.telemetry(),'return_budget':budget,'return_reason':return_reason,'return_cause':return_cause,'thrust_n':last_thrust,'wind_mps':flight_dynamics.wind,'obstacle_clearance_m':obstacle_gap if math.isfinite(obstacle_gap) else None,'contact_count':len(body.getContactPoints()),
          'plant_id':current_plant,'visited':list(visited),'observed':observed,'removed':list(removed),'payload_attached':loaded,'gripper_locked':gripper.isLocked(),'payloads':payloads,'outcomes':outcomes,
          'events':events[-20:],'accelerated':fast,'camera_frames_at_view':frames,'route_index':route_index,'route_count':len(DATA['route']),
          'harvest_enabled':harvest_enabled,
          'limits':['Potencia y batería aproximadas, sin calibración de un dron real.','Texturas sintéticas/derivadas de entrenamiento no constituyen una nueva prueba independiente.','Asociación de detecciones a geometría conocida; no SLAM ni estimación de profundidad aprendida.','Agarre con conector y corte sin resistencia; follaje visual sin colisiones.']}
        atomic(RUNTIME/'mission-status.json',status)
