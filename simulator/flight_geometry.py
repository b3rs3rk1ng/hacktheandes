"""Shared conservative geometry for physical vegetation and flight clearance.

Capsule endpoints use ENU meters. Neither crop names nor health labels enter
clearance calculations. Fine leaves, webs and vines are not resolved here.
"""
import math
import heapq

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


def plan_flight_path(start,goal,field,radius,*,height,ground_height=lambda x,y:0,margin=.24,cell=.5,max_nodes=5000):
    """Capsule-aware 3D routes, with a canopy corridor for long transfers.

    A blocked inspection pose is adjusted locally, preserving the separate
    camera look target. Every emitted segment checks trunks AND branches.
    """
    start=list(start);goal=list(goal)
    def point_ok(p):return p[2]>=ground_height(*p[:2])+radius+.08 and segment_clear(field,p,p,radius,margin)
    def clear(a,b):
        steps=max(1,math.ceil(math.dist(a,b)/cell))
        return segment_clear(field,a,b,radius,margin) and all((a[2]+(b[2]-a[2])*i/steps)>=ground_height(a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps)+radius+.08 for i in range(steps+1))
    if not point_ok(goal):
        candidates=[]
        for ring in range(1,5):
            for z in [0,.2,-.2,.4]:
                for i in range(16):
                    a=i*math.tau/16;p=[goal[0]+ring*.2*math.cos(a),goal[1]+ring*.2*math.sin(a),goal[2]+z]
                    if point_ok(p):candidates.append((math.dist(p,goal),p))
            if candidates:break
        if not candidates:raise ValueError('No clear inspection pose near requested target')
        goal=min(candidates,key=lambda c:c[0])[1]
    if clear(start,goal):return [goal]
    # Nearby inspections use a bounded voxel search below/through the canopy.
    if math.dist(start,goal)<12:
        cell=min(cell,max(.05,math.dist(start,goal)/3))
        source=tuple(round(v/cell) for v in start);target=tuple(round(v/cell) for v in goal)
        lo=[min(start[i],goal[i])-3 for i in range(3)];hi=[max(start[i],goal[i])+3 for i in range(3)]
        def position(k):return start if k==source else goal if k==target else [v*cell for v in k]
        def heuristic(k):return math.dist(position(k),goal)
        queue=[(heuristic(source),0,source)];cost={source:0};parents={};occupied={};count=0
        while queue and count<max_nodes:
            _,g,k=heapq.heappop(queue)
            if g>cost[k]:continue
            count+=1
            if k==target:
                path=[goal]
                while k in parents:k=parents[k];path.append(position(k))
                path.reverse();out=[];index=0
                while index<len(path)-1:
                    end=len(path)-1
                    while end>index+1 and not clear(path[index],path[end]):end-=1
                    out.append(path[end]);index=end
                return out
            a=position(k)
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    for dz in (-1,0,1):
                        if not (dx or dy or dz):continue
                        n=(k[0]+dx,k[1]+dy,k[2]+dz);b=position(n)
                        if any(b[i]<lo[i] or b[i]>hi[i] for i in range(3)):continue
                        if n not in occupied:occupied[n]=point_ok(b)
                        if not occupied[n]:continue
                        candidate=g+math.dist(a,b)
                        if candidate>=cost.get(n,float('inf')) or not clear(a,b):continue
                        cost[n]=candidate;parents[n]=k;heapq.heappush(queue,(candidate+heuristic(n)*1.15,candidate,n))
    # The same checked escape mechanism also supplies the descent corridor.
    climb=plan_vertical_escape(start,height,field,radius,margin=margin)
    descent=plan_vertical_escape(goal,height,field,radius,margin=margin)
    path=[*climb,*reversed([goal,*descent])]
    out=[];previous=start
    for p in path:
        if math.dist(previous,p)<1e-6:continue
        if not clear(previous,p):raise ValueError('No clear connecting flight corridor')
        out.append(p);previous=p
    return out


def plan_scan_segment(center,look,preferred,field,radius,span=1.2,margin=.24,ground_height=lambda x,y:0):
    """A swept-clear viewing pass. The camera keeps its separate look target."""
    tangent=[look[1]-center[1],center[0]-look[0],0];length=math.hypot(*tangent[:2])
    tangent=[v/max(length,1e-8) for v in tangent]
    if sum(tangent[i]*preferred[i] for i in range(2))<0:tangent=[-v for v in tangent]
    axes=[tangent,*([math.cos(i*math.pi/4),math.sin(i*math.pi/4),0] for i in range(8)),[0,0,1]]
    for distance in [span,span*.75,span*.5,span*.25]:
        for axis in axes:
            for offset in [-.5,0,-1]:
                a=[center[i]+axis[i]*distance*offset for i in range(3)];b=[a[i]+axis[i]*distance for i in range(3)]
                if min(p[2]-ground_height(*p[:2]) for p in (a,b))<radius+.08:continue
                if segment_clear(field,a,b,radius,margin):return [a,b]
    raise ValueError('No clear viewing pass around inspection pose')
