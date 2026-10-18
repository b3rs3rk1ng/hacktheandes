"""Simulator-only RGB-box localization with a frozen camera and known geometry.

This is not a vision classifier or real-world depth sensor. Disease labels are
never read. Hidden objects cannot become targets just because a ray passes them.
"""
import math
from flight_geometry import vegetation_capsules, segment_distance
from terrain import height_at

VERSION=1


def rotate(q,p):
    x,y,z,w=q;vx,vy,vz=p
    tx,ty,tz=2*(y*vz-z*vy),2*(z*vx-x*vz),2*(x*vy-y*vx)
    return [vx+w*tx+y*tz-z*ty,vy+w*ty+z*tx-x*tz,vz+w*tz+x*ty-y*tx]


def validate_camera(value,width,height):
    if not isinstance(value,dict):raise ValueError('Falta la pose de la cámara capturada')
    for key,size in [('position',3),('quaternion',4)]:
        values=value.get(key)
        if not isinstance(values,list) or len(values)!=size or not all(isinstance(x,(float,int)) and not isinstance(x,bool) and math.isfinite(x) for x in values):
            raise ValueError('Pose de cámara inválida')
    if abs(sum(v*v for v in value['quaternion'])-1)>.002:raise ValueError('Orientación de cámara sin normalizar')
    fov=value.get('vertical_fov_degrees');aspect=value.get('aspect')
    if not isinstance(fov,(int,float)) or not 5<fov<160:raise ValueError('Campo de visión inválido')
    if not isinstance(aspect,(int,float)) or not math.isfinite(aspect) or abs(aspect-width/height)>.02:raise ValueError('La cámara y el fotograma tienen proporciones distintas')
    return value


def box_iou(a,b):
    intersection=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    union=max(0,a[2]-a[0])*max(0,a[3]-a[1])+max(0,b[2]-b[0])*max(0,b[3]-b[1])-intersection
    return intersection/union if union>0 else 0


def ellipsoid_entry(origin,direction,obj,fallback):
    center=obj['position'];angle=obj.get('angle',0);cs,sn=math.cos(angle),math.sin(angle);r=obj.get('radii_m',fallback)
    d=[origin[i]-center[i] for i in range(3)]
    local=[d[0]*cs+d[1]*sn,-d[0]*sn+d[1]*cs,d[2]]
    ray=[direction[0]*cs+direction[1]*sn,-direction[0]*sn+direction[1]*cs,direction[2]]
    aa=sum((ray[i]/r[i])**2 for i in range(3));bb=2*sum(local[i]*ray[i]/r[i]**2 for i in range(3));cc=sum((local[i]/r[i])**2 for i in range(3))-1
    disc=bb*bb-4*aa*cc
    if disc<0:return None
    t=(-bb-math.sqrt(disc))/(2*aa)
    return t if t>0 else None


class SceneLocalizer:
    def __init__(self,world):
        self.world=world;cfg=world.get('config',{})
        self.cfg=cfg.get('inspection',{}).get('association',{})
        self.radius=cfg.get('manipulation',{}).get('fruit_radii_m',[.1,.1,.22])
        self.objects=world.get('pods',[]);self.cell=2.;self.cells={}
        for plant in world.get('plants',[]):
            for capsule in vegetation_capsules(plant,max_depth=3,min_radius=.006):
                a,b,r=capsule['a'],capsule['b'],capsule['radius']
                for x in range(math.floor((min(a[0],b[0])-r)/self.cell),math.floor((max(a[0],b[0])+r)/self.cell)+1):
                    for y in range(math.floor((min(a[1],b[1])-r)/self.cell),math.floor((max(a[1],b[1])+r)/self.cell)+1):self.cells.setdefault((x,y),[]).append(capsule)

    def clear(self,a,b):
        seen=set()
        for x in range(math.floor(min(a[0],b[0])/self.cell),math.floor(max(a[0],b[0])/self.cell)+1):
            for y in range(math.floor(min(a[1],b[1])/self.cell),math.floor(max(a[1],b[1])/self.cell)+1):
                for c in self.cells.get((x,y),[]):
                    if id(c) in seen:continue
                    seen.add(id(c))
                    if segment_distance(a,b,c['a'],c['b'])<c['radius']:return False
        terrain=self.world.get('terrain')
        if terrain:
            n=max(1,math.ceil(math.dist(a,b)/.15))
            for i in range(1,n):
                t=i/n;p=[a[j]+(b[j]-a[j])*t for j in range(3)]
                if p[2]<height_at(terrain,p[0],p[1])+.005:return False
        return True

    def associate(self,predictions,camera,width,height,removed=()):
        validate_camera(camera,width,height)
        q=camera['quaternion'];qi=[-q[0],-q[1],-q[2],q[3]];origin=camera['position'];enu=[origin[0],-origin[2],origin[1]]
        focal=height/(2*math.tan(math.radians(camera['vertical_fov_degrees'])/2))
        def project(p):
            local=rotate(qi,[p[0]-origin[0],p[2]-origin[1],-p[1]-origin[2]])
            if local[2]>=-.03:return None
            return [width/2+focal*local[0]/-local[2],height/2-focal*local[1]/-local[2]]
        candidates=[];removed=set(removed)
        for obj in self.objects:
            center=obj['position'];distance=math.dist(enu,center)
            if obj['id'] in removed or distance>self.cfg.get('maximum_range_m',18):continue
            a=obj.get('angle',0);cs,sn=math.cos(a),math.sin(a);r=obj.get('radii_m',self.radius)
            corners=[]
            for x in [-r[0]*1.16,r[0]*1.16]:
                for y in [-r[1]*1.16,r[1]*1.16]:
                    for z in [-r[2]*1.06,r[2]*1.06]:
                        p=project([center[0]+x*cs-y*sn,center[1]+x*sn+y*cs,center[2]+z])
                        if p:corners.append(p)
            if len(corners)!=8:continue
            rect=[max(0,min(p[0] for p in corners)),max(0,min(p[1] for p in corners)),min(width,max(p[0] for p in corners)),min(height,max(p[1] for p in corners))]
            if rect[2]<=rect[0] or rect[3]<=rect[1]:continue
            candidates.append((obj,rect,distance))
        associations=[];rejected=[];used=set()
        for index,prediction in sorted(enumerate(predictions),key=lambda x:-x[1]['confidence']):
            b=prediction['bbox'];matches=[]
            for obj,rect,distance in candidates:
                if obj['id'] in used:continue
                overlap=box_iou(b,rect)
                if overlap>=self.cfg.get('minimum_box_iou',.25):matches.append((overlap,distance,obj,rect))
            reason='box_does_not_match_object'
            for overlap,distance,obj,rect in sorted(matches,key=lambda m:(-m[0],m[1])):
                center=obj['position'];angle=obj.get('angle',0);cs,sn=math.cos(angle),math.sin(angle);r=obj.get('radii_m',self.radius)
                # Rays at the projected center and interior offsets must hit the
                # actual ellipsoid before wood/ground. No fixed-radius hidden hit.
                p=project(center)
                if not p:continue
                visible=0;attempts=0
                for dx,dy in [(0,0),(-.18,0),(.18,0),(0,-.18),(0,.18)]:
                    px,py=p[0]+dx*(rect[2]-rect[0]),p[1]+dy*(rect[3]-rect[1])
                    if not (b[0]<=px<=b[2] and b[1]<=py<=b[3] and 0<=px<width and 0<=py<height):continue
                    direction=rotate(q,[(px-width/2)/focal,-(py-height/2)/focal,-1]);direction=[direction[0],-direction[2],direction[1]]
                    t=ellipsoid_entry(enu,direction,obj,self.radius)
                    if t is None:continue
                    attempts+=1;hit=[enu[i]+direction[i]*t for i in range(3)]
                    blocked=False
                    for other,_,other_distance in candidates:
                        if other['id']==obj['id'] or other_distance>distance+max(r):continue
                        entry=ellipsoid_entry(enu,direction,other,self.radius)
                        if entry is not None and entry<t-1e-4:blocked=True;break
                    visible+=not blocked and self.clear(enu,hit)
                if visible<self.cfg.get('minimum_visible_samples',3):reason='object_occluded_or_insufficient_view';continue
                used.add(obj['id']);associations.append({'prediction_index':index,'pod_id':obj['id'],'version':VERSION,
                    'projected_bbox':rect,'box_iou':overlap,'visible_samples':visible,'sample_count':5,'distance_m':distance})
                break
            else:
                rejected.append({'prediction_index':index,'reason':reason})
        return {'version':VERSION,'method':'known_scene_geometry_not_a_visual_classifier','associations':associations,'rejected':rejected}
