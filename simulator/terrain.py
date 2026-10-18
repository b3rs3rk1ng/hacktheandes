"""One sampled height field for geometry, plant roots, collision and flight clearance."""
import math


def smoothstep(a,b,value):
    t=max(0,min(1,(value-a)/(b-a)))
    return t*t*(3-2*t)


def build_terrain(config):
    cfg=config.get('terrain',{});spacing=cfg.get('grid_spacing_m',2)
    width,depth=[size+2*cfg.get('margin_m',12) for size in config['field']['size_m']]
    nx,ny=math.ceil(width/spacing)+1,math.ceil(depth/spacing)+1
    origin=[-width/2,-depth/2];home=config['field']['home'];seed=config['seed']*.137
    amplitude=cfg.get('amplitude_m',.7);wave=cfg.get('wavelength_m',44)
    heights=[]
    for j in range(ny):
        for i in range(nx):
            x,y=origin[0]+i*spacing,origin[1]+j*spacing
            broad=math.sin(x/wave*math.tau+seed)*.45+math.sin((y+x*.23)/(wave*.83)*math.tau-seed)*.34
            local=math.sin(x/7.7+seed)*math.sin(y/9.4-seed)*.16+math.sin((x-y)/3.4)*.035
            # One flat service area is a declared scene feature, not a crop-ID exception.
            flat=smoothstep(cfg.get('service_radius_m',8),cfg.get('service_blend_m',14),math.hypot(x-home[0],y-home[1]))
            heights.append(round(amplitude*(broad+local)*flat,5))
    terrain={'origin':origin,'spacing':spacing,'columns':nx,'rows':ny,'heights':heights,
             'diagonal':'b-c','minimum':min(heights),'maximum':max(heights),'patches':[]}
    for patch in cfg.get('detail_patches',[]):
        px,py=patch['origin'];width,depth=patch['size_m'];step=patch['spacing_m']
        # Patch boundaries follow coarse grid edges; the fine edge interpolates
        # that same coarse edge, avoiding cracks and overlapping collision faces.
        if any(abs(v/spacing-round(v/spacing))>1e-7 for v in [px-origin[0],py-origin[1],width,depth]):
            raise ValueError('Terrain patch boundaries must align with the coarse grid')
        if width<=0 or depth<=0 or step<=0:raise ValueError('Invalid terrain patch dimensions')
        if any(abs(v/step-round(v/step))>1e-7 for v in [width,depth]):raise ValueError('Patch spacing must divide its size')
        if px<origin[0] or py<origin[1] or px+width>origin[0]+(nx-1)*spacing or py+depth>origin[1]+(ny-1)*spacing:raise ValueError('Patch outside terrain')
        if any(px<p['origin'][0]+(p['columns']-1)*p['spacing'] and px+width>p['origin'][0] and py<p['origin'][1]+(p['rows']-1)*p['spacing'] and py+depth>p['origin'][1] for p in terrain['patches']):raise ValueError('Terrain patches cannot overlap')
        cols,rows=round(width/step)+1,round(depth/step)+1;detail=[]
        for j in range(rows):
            for i in range(cols):
                x,y=px+i*step,py+j*step;extra=0
                for f in patch.get('features',[]):
                    angle=math.radians(f.get('angle_degrees',0));dx,dy=x-f['center'][0],y-f['center'][1]
                    u=dx*math.cos(angle)+dy*math.sin(angle);v=-dx*math.sin(angle)+dy*math.cos(angle)
                    extra+=f['height_m']*math.exp(-2*((u/f['radii_m'][0])**2+(v/f['radii_m'][1])**2))
                edge=smoothstep(0,1,min(x-px,px+width-x,y-py,py+depth-y))
                service=smoothstep(cfg.get('service_radius_m',8),cfg.get('service_blend_m',14),math.hypot(x-home[0],y-home[1]))
                detail.append(round(height_at(terrain,x,y)+extra*edge*service,5))
        terrain['patches'].append({'origin':[px,py],'spacing':step,'columns':cols,'rows':rows,'heights':detail,'diagonal':'b-c'})
    all_heights=heights+[h for p in terrain['patches'] for h in p['heights']]
    terrain.update(minimum=min(all_heights),maximum=max(all_heights));return terrain


def height_at(terrain,x,y):
    """Barycentric sampling of the same two triangles used by Webots and Three."""
    if not terrain:return 0
    for patch in terrain.get('patches',[]):
        ox,oy=patch['origin']
        if ox<=x<=ox+(patch['columns']-1)*patch['spacing'] and oy<=y<=oy+(patch['rows']-1)*patch['spacing']:return height_at(patch,x,y)
    nx,ny=terrain['columns'],terrain['rows'];step=terrain['spacing'];ox,oy=terrain['origin']
    u=max(0,min(nx-1,(x-ox)/step));v=max(0,min(ny-1,(y-oy)/step))
    i,j=min(nx-2,int(u)),min(ny-2,int(v));u-=i;v-=j
    h=terrain['heights'];a=j*nx+i
    if u+v<=1:return h[a]*(1-u-v)+h[a+1]*u+h[a+nx]*v
    return h[a+1]*(1-v)+h[a+nx]*(1-u)+h[a+nx+1]*(u+v-1)


def triangles(terrain):
    nx,ny=terrain['columns'],terrain['rows']
    for j in range(ny-1):
        for i in range(nx-1):
            x=terrain['origin'][0]+(i+.5)*terrain['spacing'];y=terrain['origin'][1]+(j+.5)*terrain['spacing']
            if any(p['origin'][0]<x<p['origin'][0]+(p['columns']-1)*p['spacing'] and p['origin'][1]<y<p['origin'][1]+(p['rows']-1)*p['spacing'] for p in terrain.get('patches',[])):continue
            a=j*nx+i;yield(a,a+1,a+nx);yield(a+1,a+nx+1,a+nx)


def mesh(terrain):
    points=[];faces=[]
    for grid in [terrain,*terrain.get('patches',[])]:
        offset=len(points);nx=grid['columns'];ox,oy=grid['origin'];step=grid['spacing']
        points.extend((ox+(i%nx)*step,oy+(i//nx)*step,height) for i,height in enumerate(grid['heights']))
        faces.extend(tuple(v+offset for v in face) for face in triangles(grid))
    return points,faces


def collision_geometry(terrain):
    vertices,indices=mesh(terrain)
    points=','.join(' '.join(f'{v:.5f}' for v in point) for point in vertices)
    faces=','.join(' '.join(map(str,t))+' -1' for t in indices)
    return 'IndexedFaceSet { creaseAngle 1 coord Coordinate { point [ '+points+' ] } coordIndex [ '+faces+' ] }'
