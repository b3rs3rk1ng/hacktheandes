"""Unit-aware flight energy, return reserve and geometry shared by mission modes.

This is an engineering approximation, not calibration for a commercial airframe.
It has no dependencies on rendering, crop names or disease ground truth.
"""
import math
import heapq


def clamp(value, low, high):
    return max(low, min(high, value))


def distance(a, b):
    return math.sqrt(sum((x-y)**2 for x, y in zip(a, b)))


def wrap(angle):
    return (angle + math.pi) % math.tau - math.pi


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def motor_power(thrust, cfg):
    area = cfg['rotors'] * math.pi * cfg['rotor_radius_m']**2
    induced = max(0, thrust)**1.5 / math.sqrt(2 * cfg['air_density'] * area)
    return induced / cfg['motor_efficiency'] + cfg['profile_power_w'] + cfg['avionics_w']


class Battery:
    def __init__(self, cfg, soc=None):
        self.cfg = cfg
        self.soc = clamp(cfg['initial_soc'] if soc is None else soc, 0, 1)
        self.current_a = 0
        self.voltage_v = self.open_voltage
        self.power_w = 0
        self.used_wh = 0

    @property
    def open_voltage(self):
        return self.cfg['cells'] * (3.35 + 0.85 * self.soc)

    @property
    def nominal_wh(self):
        return self.cfg['cells'] * 3.7 * self.cfg['capacity_ah']

    @property
    def remaining_wh(self):
        return self.nominal_wh * self.soc

    def consume(self, power_w, dt):
        if dt < 0 or not math.isfinite(dt) or power_w < 0 or not math.isfinite(power_w):
            raise ValueError('Finite nonnegative power and timestep required')
        resistance = self.cfg['internal_resistance_ohm']
        voc = self.open_voltage
        discriminant = max(0, voc*voc - 4*resistance*power_w)
        current = 2*power_w/max(1e-6, voc + math.sqrt(discriminant))
        self.soc = max(0, self.soc - current*dt/(3600*self.cfg['capacity_ah']))
        self.current_a = current if self.soc else 0
        self.voltage_v = max(0, self.open_voltage-self.current_a*resistance)
        self.power_w = self.current_a*self.voltage_v
        self.used_wh += self.power_w*dt/3600

    def charge(self, dt):
        if dt < 0 or not math.isfinite(dt):
            raise ValueError('Finite nonnegative timestep required')
        taper = min(1, max(0, (1-self.soc)/.2))
        current = self.cfg['charge_current_a']*taper
        self.soc = min(1, self.soc + current*dt*self.cfg['charge_efficiency']/(3600*self.cfg['capacity_ah']))
        self.current_a = -current
        self.voltage_v = min(4.2*self.cfg['cells'], self.open_voltage+current*self.cfg['internal_resistance_ohm'])
        self.power_w = -current*self.voltage_v

    def telemetry(self):
        return {'soc':self.soc, 'remaining_wh':self.remaining_wh, 'nominal_wh':self.nominal_wh,
                'voltage_v':self.voltage_v, 'current_a':self.current_a, 'power_w':self.power_w, 'used_wh':self.used_wh}


def return_budget(position, home, flight, battery, payload_kg=0):
    horizontal = math.hypot(position[0]-home[0], position[1]-home[1])
    height = max(flight['return_height_m'], position[2])
    climb = max(0, height-position[2])/flight['climb_speed_mps']
    descent = (height-home[2])/flight['climb_speed_mps']
    # Explicit path margin plus landing/settling. Returning flies above canopy.
    seconds = climb + horizontal/flight['cruise_speed_mps']*1.35 + descent + 15
    hover = motor_power((flight['mass_kg']+payload_kg)*9.81, flight)
    travel_wh = hover*seconds/3600*1.2
    reserve_wh = battery.nominal_wh*battery.cfg['reserve_fraction']
    return {'distance_m':horizontal, 'estimated_seconds':seconds, 'travel_wh':travel_wh,
            'reserve_wh':reserve_wh, 'required_wh':travel_wh+reserve_wh,
            'margin_wh':battery.remaining_wh-travel_wh-reserve_wh}


def flight_control(position, velocity, rotation, waypoint, yaw, cfg, payload_kg=0, *, acceleration_override=None):
    desired_velocity = []
    for i in range(3):
        speed = cfg['climb_speed_mps'] if i == 2 else cfg['cruise_speed_mps']
        desired_velocity.append(clamp(cfg['position_kp']*(waypoint[i]-position[i]), -speed, speed))
    acceleration = [clamp(cfg['velocity_kd']*(desired_velocity[i]-velocity[i]), -cfg['max_acceleration_mps2'], cfg['max_acceleration_mps2']) for i in range(3)]
    if acceleration_override is not None:
        acceleration = list(acceleration_override)
    mass = cfg['mass_kg']+payload_kg
    force = [mass*acceleration[0], mass*acceleration[1], mass*(9.81+acceleration[2])]
    norm = math.sqrt(sum(v*v for v in force))
    up = [rotation[2], rotation[5], rotation[8]]
    error = cross(up, [v/norm for v in force])
    error[2] = wrap(yaw-math.atan2(rotation[3],rotation[0]))
    frequency = cfg['attitude_frequency']
    payload_lever=cfg['payload_lever_m']
    inertia=[cfg['inertia'][i]+(payload_kg*payload_lever**2 if i in (1,2) else 0) for i in range(3)]
    torque = [inertia[i]*(frequency**2*error[i]-2*cfg['attitude_damping']*frequency*velocity[i+3]) for i in range(3)]
    if payload_kg:
        lever = [rotation[0]*payload_lever,rotation[3]*payload_lever,rotation[6]*payload_lever]
        compensation = cross(lever,[v*payload_kg/mass for v in force])
        torque = [a+b for a,b in zip(torque,compensation)]
    thrust = clamp(sum(a*b for a,b in zip(force,up)),0,cfg['max_thrust_n'])
    relative = [velocity[i]-cfg['wind_mps'][i] for i in range(3)]
    drag = [-.5*cfg['air_density']*cfg['drag_area_m2']*v*abs(v) for v in relative]
    stable = distance(position,waypoint)<.065 and math.sqrt(sum(v*v for v in velocity[:3]))<.10 and abs(error[2])<.12
    return thrust, torque, drag, stable


class FlightDynamics:
    """Stateful command shaping, motor response and smooth gusts in SI units.

    This never writes a vehicle pose. The physics engine still integrates all
    forces, torques and contacts. Defaults can be overridden per airframe.
    """
    def __init__(self, cfg):
        self.cfg = cfg
        self.reset()

    def reset(self):
        self.acceleration = [0.0]*3
        self.yaw = None
        self.yaw_rate = 0.0
        self.thrust = 0.0
        self.wind = list(self.cfg.get('wind_mps', [0, 0, 0]))

    def step(self, position, velocity, rotation, waypoint, yaw, dt, *, time_s=0, payload_kg=0, armed=True, safety_acceleration=None):
        if not math.isfinite(dt) or dt <= 0:
            raise ValueError('Positive finite flight timestep required')
        c = self.cfg
        if not armed:
            self.reset()
            self.yaw = math.atan2(rotation[3], rotation[0])
            return 0.0, [0.0]*3, [0.0]*3, False
        if self.yaw is None:
            self.yaw = math.atan2(rotation[3], rotation[0])
        jerk = c.get('max_jerk_mps3', 3.0)
        desired = []
        for i in range(3):
            speed = c['climb_speed_mps'] if i == 2 else c['cruise_speed_mps']
            v = clamp(c['position_kp']*(waypoint[i]-position[i]), -speed, speed)
            desired.append(clamp(c['velocity_kd']*(v-velocity[i]), -c['max_acceleration_mps2'], c['max_acceleration_mps2']))
        if safety_acceleration is not None:
            # Safety acceleration can cancel a navigation command toward an
            # obstacle. Clamp after combining; no pose or velocity is rewritten.
            desired = [clamp(desired[i]+safety_acceleration[i], -c['max_acceleration_mps2'], c['max_acceleration_mps2']) for i in range(3)]
        # Limit the vector jerk, not each component separately.
        delta = [desired[i]-self.acceleration[i] for i in range(3)]
        length = math.sqrt(sum(x*x for x in delta))
        scale = min(1, jerk*dt/max(length, 1e-9))
        self.acceleration = [self.acceleration[i]+delta[i]*scale for i in range(3)]
        target_rate = clamp(wrap(yaw-self.yaw)*2.5, -c.get('max_yaw_rate_rad_s', .85), c.get('max_yaw_rate_rad_s', .85))
        limit = c.get('max_yaw_acceleration_rad_s2', 1.5)*dt
        self.yaw_rate += clamp(target_rate-self.yaw_rate, -limit, limit)
        self.yaw = wrap(self.yaw+self.yaw_rate*dt)
        gust = c.get('gust_amplitude_mps', .24)
        self.wind = [c['wind_mps'][0]+gust*(math.sin(time_s*.71)+.35*math.sin(time_s*1.73)),
                     c['wind_mps'][1]+gust*(.7*math.sin(time_s*.53+1)+.25*math.sin(time_s*1.31)),
                     c['wind_mps'][2]+gust*.12*math.sin(time_s*.83)]
        thrust, torque, drag, stable = flight_control(position, velocity, rotation, waypoint, self.yaw,
            {**c, 'wind_mps': self.wind}, payload_kg, acceleration_override=self.acceleration)
        tau = c.get('motor_response_s', .12)
        self.thrust += (thrust-self.thrust)*(1-math.exp(-dt/max(tau, .001)))
        max_torque = c.get('max_torque_nm', [1.4, 1.4, .35])
        torque = [clamp(t, -max_torque[i], max_torque[i]) for i,t in enumerate(torque)]
        stable = stable and abs(wrap(yaw-math.atan2(rotation[3], rotation[0]))) < .12
        return self.thrust, torque, drag, stable


def plan_horizontal_path(start, goal, obstacles, clearance=.58, cell=.4):
    """A* with swept-segment clearance around circular static obstacles.

    Positions are horizontal meters. No crop/source identity enters planning.
    Occupancy is conservative; every emitted segment is checked at the declared
    physical clearance, including exact start and goal. Raises on no route.
    """
    start=tuple(start[:2]);goal=tuple(goal[:2]);obstacles=[tuple(p[:2]) for p in obstacles]
    def clear(a,b):
        dx,dy=b[0]-a[0],b[1]-a[1];squared=dx*dx+dy*dy
        for x,y in obstacles:
            t=clamp(((x-a[0])*dx+(y-a[1])*dy)/squared,0,1) if squared else 0
            if math.hypot(a[0]+t*dx-x,a[1]+t*dy-y)<clearance:return False
        return True
    if clear(start,goal):return [list(goal)]
    # Local bounds cover a few neighboring rows; paths can route around clumps.
    low=[min(start[i],goal[i])-5 for i in range(2)];high=[max(start[i],goal[i])+5 for i in range(2)]
    obstacles=[p for p in obstacles if all(low[i]-clearance<=p[i]<=high[i]+clearance for i in range(2))]
    def key(p):return (round(p[0]/cell),round(p[1]/cell))
    source,destination=key(start),key(goal)
    def position(k):return start if k==source else goal if k==destination else (k[0]*cell,k[1]*cell)
    queue=[(0,source)];cost={source:0};parent={};closed=set()
    while queue:
        _,current=heapq.heappop(queue)
        if current in closed:continue
        if current==destination:
            path=[goal]
            while current in parent:
                current=parent[current];path.append(position(current))
            path.reverse();simplified=[path[0]];i=0
            while i<len(path)-1:
                j=len(path)-1
                while j>i+1 and not clear(path[i],path[j]):j-=1
                simplified.append(path[j]);i=j
            return [list(p) for p in simplified[1:]]
        closed.add(current)
        for dx,dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            neighbor=(current[0]+dx,current[1]+dy);a,b=position(current),position(neighbor)
            if neighbor in closed or any(b[i]<low[i] or b[i]>high[i] for i in range(2)) or not clear(a,b):continue
            candidate=cost[current]+math.dist(a,b)
            if candidate<cost.get(neighbor,float('inf')):
                cost[neighbor]=candidate;parent[neighbor]=current
                heapq.heappush(queue,(candidate+math.dist(b,goal),neighbor))
    raise ValueError('No horizontal route satisfies the configured clearance')
