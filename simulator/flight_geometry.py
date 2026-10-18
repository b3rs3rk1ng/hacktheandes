"""Shared conservative geometry for physical vegetation and flight clearance.

Capsule endpoints use ENU meters. Neither crop names nor health labels enter
clearance calculations. Fine leaves, webs and vines are not resolved here.
"""
import math

def vegetation_capsules(plant,max_depth=1,min_radius=.018):
    origin=plant['position']
    bones=plant.get('structure',{}).get('bones')
    if bones is None:
        bones=[[0,0,0,0,0,plant['height']*.64,.09,.09,0]]
    for bone in bones:
        radius=max(bone[6:8])
        if bone[8]>max_depth or radius<min_radius:continue
        a=[origin[i]+bone[i] for i in range(3)]
        b=[origin[i]+bone[i+3] for i in range(3)]
        yield {'a':a,'b':b,'radius':radius}

def nearest_on_segment(p,a,b):
    d=[b[i]-a[i] for i in range(3)];length=sum(v*v for v in d)
    t=max(0,min(1,sum((p[i]-a[i])*d[i] for i in range(3))/length)) if length else 0
    return [a[i]+t*d[i] for i in range(3)]

class ObstacleField:
    """Spatially indexed capsules, shared by all compatible airframes/scenes."""
    def __init__(self,capsules,cell_m=4):
        self.capsules=list(capsules);self.cells={};self.cell_m=cell_m
        for index,c in enumerate(self.capsules):
            r=c['radius']
            lo=[math.floor((min(c['a'][i],c['b'][i])-r)/cell_m) for i in range(2)]
            hi=[math.floor((max(c['a'][i],c['b'][i])+r)/cell_m) for i in range(2)]
            for x in range(lo[0],hi[0]+1):
                for y in range(lo[1],hi[1]+1):self.cells.setdefault((x,y),set()).add(index)

    def nearby(self,p,radius):
        indices=set();s=self.cell_m
        for x in range(math.floor((p[0]-radius)/s),math.floor((p[0]+radius)/s)+1):
            for y in range(math.floor((p[1]-radius)/s),math.floor((p[1]+radius)/s)+1):indices.update(self.cells.get((x,y),()))
        return (self.capsules[i] for i in sorted(indices))

    def safety_acceleration(self,position,velocity,vehicle_radius,max_acceleration,margin=.18):
        speed=math.sqrt(sum(v*v for v in velocity[:3]));lookahead=vehicle_radius+margin+speed*speed/(2*max_acceleration)+.5
        answer=[0.0]*3;nearest=float('inf')
        for c in self.nearby(position,lookahead):
            p=nearest_on_segment(position,c['a'],c['b']);delta=[position[i]-p[i] for i in range(3)];length=math.sqrt(sum(x*x for x in delta));gap=length-c['radius']-vehicle_radius
            nearest=min(nearest,gap)
            if length<1e-8:continue
            normal=[v/length for v in delta];toward=max(0,-sum(velocity[i]*normal[i] for i in range(3)))
            stopping=margin+toward*toward/(2*max_acceleration)
            if gap<stopping:
                force=min(max_acceleration*2,max(0,(stopping-gap)*5+toward*2))
                for i in range(3):answer[i]+=normal[i]*force
        length=math.sqrt(sum(v*v for v in answer));scale=min(1,max_acceleration*2/max(length,1e-8))
        return [x*scale for x in answer],nearest

def segment_distance(a,b,c,d):
    """Distance of closed finite 3D segments, including parallel/point cases."""
    sub=lambda x,y:[x[i]-y[i] for i in range(3)]
    dot=lambda x,y:sum(x[i]*y[i] for i in range(3))
    u=sub(b,a);v=sub(d,c);w=sub(a,c);aa=dot(u,u);bb=dot(u,v);cc=dot(v,v);dd=dot(u,w);ee=dot(v,w)
    if aa<1e-12:return math.dist(a,nearest_on_segment(a,c,d))
    if cc<1e-12:return math.dist(c,nearest_on_segment(c,a,b))
    denominator=aa*cc-bb*bb
    s=max(0,min(1,(bb*ee-cc*dd)/denominator)) if denominator>1e-12 else 0
    t=(bb*s+ee)/cc
    if t<0:t=0;s=max(0,min(1,-dd/aa))
    elif t>1:t=1;s=max(0,min(1,(bb-dd)/aa))
    return math.sqrt(sum((w[i]+s*u[i]-t*v[i])**2 for i in range(3)))

def segment_clear(field,a,b,radius,margin=.06):
    midpoint=[(a[i]+b[i])/2 for i in range(3)];reach=math.hypot(b[0]-a[0],b[1]-a[1])/2+radius+margin
    return all(segment_distance(a,b,c['a'],c['b'])>=radius+margin+c['radius'] for c in field.nearby(midpoint,reach))

def plan_vertical_escape(start,height,field,radius,*,margin=.10,max_lateral_m=3.0):
    """Find a clear climb column before ascending through an overhang.

    Bounded search over lateral candidates. Every entire segment is checked
    against the same capsules as physical collisions. Raises if no route fits.
    This is a geometry-assisted local planner, not autonomous perception/SLAM.
    """
    goal=[start[0],start[1],height]
    if segment_clear(field,start,goal,radius,margin):return [goal]
    candidates=[];step=.5
    for ring in range(1,math.ceil(max_lateral_m/step)+1):
        distance=min(max_lateral_m,ring*step)
        for i in range(16):
            angle=i*math.tau/16;low=[start[0]+distance*math.cos(angle),start[1]+distance*math.sin(angle),start[2]];high=[low[0],low[1],height]
            if all(segment_clear(field,a,b,radius,margin) for a,b in [(start,low),(low,high),(high,goal)]):candidates.append((distance,low,high))
        if candidates:break
    if not candidates:raise ValueError('No clear climb column within lateral search range')
    _,low,high=min(candidates,key=lambda row:row[0]);return [low,high,goal]
