"""One declarative scene contract feeds the physical world and the visual renderer."""
import hashlib
import json
import math
from pathlib import Path
import random
from generate_world import at, box, shape, vec, branch
from terrain import build_terrain, height_at, collision_geometry
from vegetation import cacao_structure, fruit_attachments
from flight_geometry import vegetation_capsules

ROOT = Path(__file__).resolve().parent


def scene(config):
    rng = random.Random(config['seed'])
    plants, pods = [], []
    terrain=build_terrain(config)
    for parcel in config['parcels']:
        for row in range(parcel['rows']):
            for col in range(parcel['columns']):
                identifier = f"{parcel['id']}-{row}-{col}"
                x = parcel['origin'][0]+col*parcel['spacing'][0]+rng.uniform(-.15,.15)
                y = parcel['origin'][1]+row*parcel['spacing'][1]+rng.uniform(-.15,.15)
                profile=config.get('vegetation',{}).get('profiles',{}).get(parcel['crop'],{})
                height_range=profile.get('height_m',[3.3,4.2]);height=rng.uniform(*height_range)
                ground=height_at(terrain,x,y)
                plant = {'id':identifier,'crop':parcel['crop'],'position':[x,y,ground],'seed':rng.randrange(1000000),'height':height}
                if profile.get('kind')=='cacao':plant['structure']=cacao_structure(plant['seed'],height)
                plants.append(plant)
                if parcel['crop'] == config['inspection']['crop']:
                    # Preserve the generic scene fixture for crops without a
                    # botanical adapter. A profile may supply real structure;
                    # the common attachment/render contract stays unchanged.
                    support=plant.get('structure') or {'trunk':[[0,0,0],[0,0,min(height*.55,2)]],'radius':.09,'primary':[],'color_family':0}
                    count=rng.randint(*profile.get('pods',[5,5]))
                    for index,attachment in enumerate(fruit_attachments(support,plant['seed']+9001,count,config['manipulation']['fruit_radii_m'])):
                        label=rng.choices(['healthy','monilia','phytophthora'],[.70,.24,.06])[0]
                        local=attachment.pop('local_position');stem=attachment.pop('local_stem')
                        pods.append({'id':identifier+f'-pod-{index}','plant_id':identifier,
                            'position':[x+local[0],y+local[1],ground+local[2]],
                            'stem':[x+stem[0],y+stem[1],ground+stem[2]],
                            'label':label,'variant':rng.randrange(4),'mass_kg':config['manipulation']['mass_kg']*attachment['scale']**3,**attachment})
    home = config['field']['home']
    remaining=[p for p in plants if p['crop']==config['inspection']['crop']];route=[];current=home[:2]
    limit=config['inspection'].get('maximum_trees') or len(remaining)
    while remaining and len(route)<limit:
        nearest=min(remaining,key=lambda p:math.dist(p['position'][:2],current));remaining.remove(nearest)
        route.append(nearest['id']);current=nearest['position'][:2]
    from coverage_plan import build_coverage
    coverage=build_coverage(plants,config)
    if coverage:route=coverage['drone_route'][:limit]
    return {'schema_version':2,'terrain':terrain,'config':config,'plants':plants,'pods':pods,'route':route,'coverage':coverage,'coordinate_system':'ENU meters; render maps to (east,up,-north)'}


def world(data):
    c = data['config']; f = c['flight']; home = c['field']['home']
    terrain_mesh=collision_geometry(data['terrain'])
    result = ['#VRML_SIM R2025a utf8',
      'WorldInfo { basicTimeStep 16 coordinateSystem "ENU" title "Cacao: misión física" FPS 30 }',
      'Viewpoint { position 0 -16 8 orientation 0.85 0.3 0.4 1.3 }',
      'Background { skyColor [ .6 .75 .85 ] }',
      'DirectionalLight { direction -.4 .6 -1 intensity 1.5 }',
      'Solid { name "terrain" children [ Shape { castShadows FALSE appearance PBRAppearance { baseColor .25 .18 .11 roughness 1 } geometry DEF TERRAIN_SURFACE '+terrain_mesh+' } ] boundingObject USE TERRAIN_SURFACE }',
      'Solid { name "landing-pad" translation '+vec([home[0],home[1],.04])+' children [ '+shape('Cylinder { radius 1.2 height .08 }',[.24,.31,.29])+' ] boundingObject Cylinder { radius 1.2 height .08 } }']
    # Trunks are real collision geometry; distant foliage is a visual detail.
    for plant in data['plants']:
        if plant['crop'] not in ('cacao','banana','coffee'):continue
        x,y,z=plant['position'];h=plant['height']*.64
        if plant.get('structure'):
            collisions=[]
            for capsule in vegetation_capsules(plant,max_depth=f.get('branch_collision_depth',1)):
                start=[capsule['a'][i]-plant['position'][i] for i in range(3)];end=[capsule['b'][i]-plant['position'][i] for i in range(3)]
                delta=[b-a for a,b in zip(start,end)];length=math.sqrt(sum(v*v for v in delta));r=capsule['radius']
                axis=[-delta[1],delta[0],0,math.acos(max(-1,min(1,delta[2]/max(length,1e-8))))]
                if abs(axis[0])+abs(axis[1])<1e-8:axis=[1,0,0,0]
                collisions.append(at([(a+b)/2 for a,b in zip(start,end)],f'Capsule {{ radius {r:.5f} height {max(.001,length-2*r):.5f} subdivision 6 }}',axis))
            result.append(f'Solid {{ name "{plant["id"]}" translation {x} {y} {z} boundingObject Group {{ children [ '+ ' '.join(collisions)+' ] } }')
        else:
            radius=.09
            result.append(f'Solid {{ name "{plant["id"]}" translation {x} {y} {z+h/2} children [ '+shape(f'Cylinder {{ radius {radius} height {h} subdivision 6 }}',[.25,.15,.08])+f' ] boundingObject Cylinder {{ radius {radius} height {h} subdivision 6 }} }}')
    b=c['manipulation']; bx,by,bz=b['bin']; w,d,h=b['bin_size']
    pieces=[([0,0,.04],[w,d,.08]),([-w/2,0,h/2],[.045,d,h]),([w/2,0,h/2],[.045,d,h]),([0,-d/2,h/2],[w,.045,h]),([0,d/2,h/2],[w,.045,h])]
    result.append('Solid { name "collection-bin" translation '+vec([bx,by,bz])+' children [ '+' '.join(at(p,box(s,[.19,.27,.25])) for p,s in pieces)+' ] boundingObject Group { children [ '+' '.join(at(p,'Box { size '+vec(s)+' }') for p,s in pieces)+' ] } }')
    parts=[box([.38,.30,.13],[.20,.24,.23]),'Connector { translation .5 0 0 name "gripper" model "orchard-grip" type "active" distanceTolerance .055 axisTolerance .5 snap FALSE }']
    camera= c['camera']; horizontal_fov=2*math.atan(math.tan(math.radians(camera['vertical_fov_degrees'])/2)*camera['width']/camera['height'])
    parts.append('Camera { translation '+vec(camera['offset_m'])+' name "camera" width '+str(camera['width'])+' height '+str(camera['height'])+' fieldOfView '+str(horizontal_fov)+' near .05 }')
    for x in [-.26,.26]:
        for y in [-.26,.26]:parts.append(branch([0,0,0],[x,y,0],.018,[.16,.18,.17]))
    collision='Group { children [ Box { size .40 .32 .16 } Pose { translation 0 0 -.19 children [ Box { size .35 .40 .06 } ] } ] }'
    if f.get('cage_radius_m'):
        # Conservative closed sphere matches the outside cage envelope. It does
        # not model openings, flexible struts, snagging or proprietary recovery.
        collision=at([0,0,f.get('cage_center_y_m',.045)],'Sphere { radius '+str(f['cage_radius_m'])+' subdivision 2 }')
    result.append('DEF MISSION_DRONE Robot { translation '+vec(home)+' name "Cacao mission" supervisor TRUE controller "orchard_mission" children [ '+' '.join(parts)+' ] boundingObject '+collision+' physics Physics { density -1 mass '+str(f['mass_kg'])+' centerOfMass [ 0 0 0 ] inertiaMatrix [ '+vec(f['inertia'])+' 0 0 0 ] } }')
    return '\n'.join(result)+'\n'


if __name__=='__main__':
    config=json.loads((ROOT/'orchard_config.json').read_text()); data=scene(config)
    (ROOT/'runtime').mkdir(exist_ok=True); (ROOT/'worlds').mkdir(exist_ok=True)
    encoded=json.dumps(data,separators=(',',':'))
    (ROOT/'runtime/orchard.json').write_text(encoded)
    (ROOT/'worlds/orchard.wbt').write_text(world(data))
    print(json.dumps({'plants':len(data['plants']),'pods':len(data['pods']),'route':len(data['route']),'scene_sha256':hashlib.sha256(encoded.encode()).hexdigest()}))
