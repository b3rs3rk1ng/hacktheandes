"""Closed-loop rigid-body flight and an explicitly idealized connector gripper.

The selected target position is supplied by the fixture, not inferred from images.
No pose is overwritten during an active trial. Reset is the only teleport operation.
"""
from controller import Supervisor
from controller.wb import wb
import ctypes
import json
import math
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / 'config.json').read_text())
RUNTIME = ROOT / 'runtime'
RUNTIME.mkdir(exist_ok=True)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False))
    temporary.replace(path)


def clamp(value, low, high):
    return max(low, min(high, value))


def distance(a, b):
    return math.sqrt(sum((x-y)**2 for x, y in zip(a, b)))


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def apply_torque(node, torque, relative=False):
    """Use the documented C API: R2025a's Python addTorque calls add_force."""
    if len(torque) != 3 or not all(math.isfinite(v) for v in torque):
        raise ValueError('Torque must contain three finite components')
    wb.wb_supervisor_node_add_torque(node._ref,(ctypes.c_double*3)(*torque),int(relative))


robot = Supervisor()
step = int(robot.getBasicTimeStep())
body = robot.getSelf()
target = robot.getFromDef('TARGET')
stem = robot.getFromDef('STEM_CONNECTOR').getField('isLocked')
stem_visual = robot.getFromDef('STEM_MATERIAL').getField('transparency')
gripper = robot.getDevice('gripper')
gripper.enablePresence(step)
camera = robot.getDevice('camera')
camera.enable(160)
drone_config = CONFIG['drone']
pod_config = CONFIG['target']
tool_offset = drone_config['tool_offset']
pod_contact = [a+b for a,b in zip(pod_config['position'], pod_config['grip_offset'])]
grasp_position = [a-b for a,b in zip(pod_contact, tool_offset)]
bin_position = CONFIG['bin']['position']
bin_size = CONFIG['bin']['size']
deposit_position = [bin_position[0] - tool_offset[0] - .15, bin_position[1], bin_size[2] + .55]
initial = drone_config['initial_position']
phase = 'ready'
phase_started = robot.getTime()
trial_started = None
command_id = None
loaded = False
released = False
last_status = -1
last_camera = -1
events = []
waypoint = list(initial)
grip_verified = False
result = None

LABELS = {
    'ready': 'Listo para iniciar', 'takeoff': 'Despegando',
    'approach': 'Acercándose al árbol', 'align': 'Alineando la pinza',
    'grip': 'Sujetando la mazorca', 'cut': 'Corte simulado del tallo',
    'retreat': 'Retirando la mazorca', 'transport': 'Llevando al recipiente',
    'release': 'Soltando la mazorca', 'verify': 'Comprobando depósito',
    'done': 'Mazorca depositada', 'failed': 'Ensayo detenido'
}


def transition(new_phase, note=None):
    global phase, phase_started
    phase = new_phase
    phase_started = robot.getTime()
    event = {'phase':phase, 'time':round(robot.getTime(),3), 'label':note or LABELS[phase]}
    events.append(event)
    print(json.dumps(event, ensure_ascii=False), flush=True)


def reset():
    global loaded, released, waypoint, trial_started, grip_verified, result, events
    gripper.unlock()
    stem.setSFBool(False)
    body.getField('translation').setSFVec3f(initial)
    body.getField('rotation').setSFRotation([0,0,1,0])
    target.getField('translation').setSFVec3f(pod_config['position'])
    target.getField('rotation').setSFRotation([0,0,1,0])
    body.resetPhysics()
    target.resetPhysics()
    stem_visual.setSFFloat(0.0)
    robot.step(step)
    stem.setSFBool(True)
    loaded = released = grip_verified = False
    result = None
    waypoint = list(initial)
    trial_started = robot.getTime()
    events = []
    transition('takeoff')


def fly_to(position):
    """A thrust/attitude controller; Webots integrates position and contacts."""
    current = body.getPosition()
    velocity = body.getVelocity()
    rotation = body.getOrientation()
    mass = drone_config['mass_kg'] + (pod_config['mass_kg'] if loaded else 0)
    acceleration = [clamp(drone_config['position_kp']*(position[i]-current[i]) - drone_config['velocity_kd']*velocity[i], -1.5, 1.5) for i in range(3)]
    force = [mass*acceleration[0], mass*acceleration[1], mass*(9.81+acceleration[2])]
    norm = math.sqrt(sum(x*x for x in force))
    desired_up = [x/norm for x in force]
    up = [rotation[2],rotation[5],rotation[8]]
    error = cross(up, desired_up)
    inertia = list(drone_config['inertia_kg_m2'])
    lever_local = [tool_offset[0]-pod_config['grip_offset'][0],tool_offset[1],tool_offset[2]]
    if loaded:
        for i in range(3):
            inertia[i] += pod_config['mass_kg']*sum(lever_local[j]**2 for j in range(3) if i != j)
    frequency = drone_config['attitude_frequency']
    damping = drone_config['attitude_damping']
    error[2] = -math.atan2(rotation[3],rotation[0])
    torque = [inertia[i]*(frequency**2*error[i] - 2*damping*frequency*velocity[i+3]) for i in range(3)]
    if loaded:
        # The simulated controller knows the configured payload mass and lever.
        lever_world = [sum(rotation[3*i+j]*lever_local[j] for j in range(3)) for i in range(3)]
        payload_force = [v*pod_config['mass_kg']/mass for v in force]
        payload_torque = cross(lever_world,payload_force)
        torque = [a+b for a,b in zip(torque,payload_torque)]
    thrust = clamp(sum(a*b for a,b in zip(force,up)),0,drone_config['max_force_n'])
    body.addForce([0,0,thrust],True)
    apply_torque(body,torque)
    return distance(current,position) < drone_config['position_tolerance_m'] and math.sqrt(sum(v*v for v in velocity[:3])) < .04


while robot.step(step) != -1:
    now = robot.getTime()
    try:
        command = json.loads((RUNTIME/'command.json').read_text())
        if command.get('id') != command_id:
            command_id = command.get('id')
            if command.get('action') == 'start':
                reset()
                now = robot.getTime()
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    elapsed = now-phase_started
    if phase == 'takeoff':
        waypoint = [initial[0],initial[1],grasp_position[2]+.15]
    elif phase == 'approach':
        waypoint = [grasp_position[0]-.55,grasp_position[1],grasp_position[2]+.15]
    elif phase in ('align','grip','cut'):
        waypoint = list(grasp_position)
    elif phase == 'retreat':
        waypoint = [grasp_position[0]-.85,grasp_position[1],grasp_position[2]+.2]
    elif phase == 'transport':
        waypoint = list(deposit_position)
    stable = fly_to(waypoint)
    if phase == 'takeoff' and stable:
        transition('approach')
    elif phase == 'approach' and stable:
        transition('align')
    elif phase == 'align' and stable:
        if gripper.getPresence() == 1:
            gripper.lock()
            grip_verified = True
            transition('grip')
        elif elapsed > 12:
            result = 'grip_not_aligned'
            transition('failed','La pinza no alcanzó la posición de agarre')
    elif phase == 'grip' and elapsed > 1:
        # The cut is forbidden until a compatible connector is present and locked.
        if grip_verified and gripper.isLocked() and gripper.getPresence() == 1:
            stem.setSFBool(False)
            stem_visual.setSFFloat(1.0)
            loaded = True
            transition('cut')
        else:
            result = 'grip_lost'
            transition('failed','Se perdió el agarre; no se ejecutó el corte')
    elif phase == 'cut' and elapsed > 1:
        transition('retreat')
    elif phase == 'retreat' and stable:
        transition('transport')
    elif phase == 'transport' and stable:
        gripper.unlock()
        loaded = False
        released = True
        transition('release')
    elif phase == 'release' and elapsed > .8:
        transition('verify')
    elif phase == 'verify' and elapsed > 2:
        p = target.getPosition()
        inside = abs(p[0]-bin_position[0]) < bin_size[0]/2 and abs(p[1]-bin_position[1]) < bin_size[1]/2 and .05 < p[2] < bin_size[2]+.26
        result = 'deposited' if inside else 'missed_bin'
        transition('done' if inside else 'failed')
    if phase not in ('ready','done','failed') and trial_started is not None and now-trial_started > 100:
        result = 'timeout'
        transition('failed','La maniobra no convergió en el tiempo previsto')
    if now-last_status >= .10:
        last_status = now
        position = body.getPosition()
        status = {'phase':phase,'label':LABELS[phase],'simulation_time':round(now,2),
                  'trial_time':round(now-trial_started,2) if trial_started is not None else 0,
                  'position':[round(v,3) for v in position], 'target_position':[round(v,3) for v in target.getPosition()],
                  'velocity':[round(v,3) for v in body.getVelocity()], 'orientation':[round(v,3) for v in body.getOrientation()],
                  'waypoint':waypoint,'gripper_locked':gripper.isLocked(),'grip_present':gripper.getPresence()==1,
                  'stem_attached':stem.getSFBool(),'payload_attached':loaded,'result':result,'events':events,
                  'updated_at':time.time(),'engine':'Webots R2025a / ODE',
                  'limits':['Objetivo y posición conocidos por el simulador; sin diagnóstico de enfermedad.',
                            'Agarre idealizado con conector; corte representado soltando la unión.',
                            'Control de empuje y actitud simplificado; sin aerodinámica de hélices ni viento.']}
        atomic_json(RUNTIME/'status.json',status)
    if now-last_camera >= .7:
        last_camera = now
        camera.saveImage(str(RUNTIME/'camera.jpg'),80)
