"""Seeded botanical structure, authored once and consumed by every scene view.

Geometry is a visual approximation of a pruned cacao tree, not a botanical or
yield model. Disease labels do not enter structural generation or navigation.
"""
import math
import random


def interpolate(a,b,t):return [x+(y-x)*t for x,y in zip(a,b)]
def rounded(p):return [round(x,5) for x in p]


def cacao_structure(seed,height):
    rng=random.Random(seed);bones=[];shoots=[]
    radius=rng.uniform(.085,.145);fork=rng.uniform(1.32,1.85);rotation=rng.uniform(0,math.tau)
    lean=[rng.uniform(-.18,.18),rng.uniform(-.18,.18)]
    path=[[0,0,0],[lean[0]*.18,lean[1]*.18,fork*.35],[lean[0]*.58,lean[1]*.58,fork*.73],[*lean,fork]]
    def bone(a,b,r0,r1,level):bones.append([*rounded(a),*rounded(b),round(r0,5),round(r1,5),level])
    for i in range(3):bone(path[i],path[i+1],radius*(1.13-i*.15),radius*(.98-i*.15),0)
    branch_count=rng.randint(3,5);spread=rng.uniform(1.45,2.0);primary=[]
    for i in range(branch_count):
        angle=rotation+i*math.tau/branch_count+rng.uniform(-.28,.28);length=spread*rng.uniform(.80,1.18);rise=height-fork-rng.uniform(.25,.65)
        direction=[math.cos(angle),math.sin(angle)];side=[-direction[1],direction[0]];bend=rng.uniform(-.23,.23)
        nodes=[path[-1]]
        for k,t in enumerate([.32,.69,1]):nodes.append([lean[0]+direction[0]*length*t+side[0]*bend*t*t,lean[1]+direction[1]*length*t+side[1]*bend*t*t,fork+rise*(t**.74)])
        primary.append(nodes)
        for k in range(3):bone(nodes[k],nodes[k+1],radius*(.61-k*.15),radius*(.46-k*.14),1)
        # Alternating side shoots: leaves emerge from twigs rather than a sphere.
        for side_sign in [-1,1]:
            start=interpolate(nodes[1],nodes[2],rng.uniform(.12,.92));az=angle+side_sign*rng.uniform(.48,.9)
            shoot_length=rng.uniform(.55,.94);end=[start[0]+math.cos(az)*shoot_length,start[1]+math.sin(az)*shoot_length,start[2]+rng.uniform(.15,.45)]
            bone(start,end,.025,.010,2)
            for j in range(3):
                root=interpolate(start,end,.34+j*.30);a=az+(-1 if j%2 else 1)*rng.uniform(.48,.86)
                tip=[root[0]+math.cos(a)*rng.uniform(.23,.43),root[1]+math.sin(a)*rng.uniform(.23,.43),root[2]+rng.uniform(-.05,.19)]
                bone(root,tip,.010,.0038,3)
                middle=interpolate(root,tip,.42)
                shoots.append([*rounded(middle),round(a+side_sign*.22,5),round(rng.uniform(.85,1.12),4),rng.randrange(1000000)])
                shoots.append([*rounded(tip),round(a,5),round(rng.uniform(.85,1.2),4),rng.randrange(1000000)])
        # A hanging terminal spray softens the branch silhouette.
        shoots.append([*rounded(nodes[-1]),round(angle,5),round(rng.uniform(.95,1.2),4),rng.randrange(1000000)])
        for node in nodes[1:3]:shoots.append([*rounded(node),round(angle,5),round(rng.uniform(.9,1.15),4),rng.randrange(1000000)])
    return {'bones':bones,'shoots':shoots,'trunk':path,'primary':primary,'radius':radius,
            'fork_height':fork,'spread':spread,'leaf_tone':rng.uniform(-.025,.025),'color_family':rng.randrange(2)}


def fruit_attachments(structure,seed,count,base_radii):
    rng=random.Random(seed);result=[];path=structure['trunk'];radius=structure['radius']
    for i in range(count):
        scale=rng.uniform(.84,1.15);radii=[v*scale for v in base_radii]
        angle=rng.uniform(-math.pi,math.pi)
        if not structure.get('primary') or i<count*.68:
            t=rng.uniform(.20,.98);z=path[-1][2]*t;core=[path[-1][0]*t,path[-1][1]*t,z]
            center=[core[0]+(radius*.9+radii[0]+.025)*math.cos(angle),core[1]+(radius*.9+radii[0]+.025)*math.sin(angle),z]
            stem=[core[0]+radius*.9*math.cos(angle),core[1]+radius*.9*math.sin(angle),z+radii[2]+.025]
        else:
            nodes=rng.choice(structure['primary']);core=interpolate(nodes[0],nodes[2],rng.uniform(.35,.92));angle=math.atan2(core[1],core[0])
            stem=list(core);center=[core[0]+.025*math.cos(angle),core[1]+.025*math.sin(angle),core[2]-radii[2]-.055]
        # Red-fruited and green-fruited trees each retain their own colour family.
        ripe=rng.random()>.63
        if structure['color_family']==0:color=rng.choice(['#c1a037','#c8ac46','#b6a543']) if ripe else rng.choice(['#547638','#66833d','#708c43'])
        else:color=rng.choice(['#b27734','#b98c3e']) if ripe else rng.choice(['#944453','#aa4d60','#803c4c'])
        result.append({'local_position':rounded(center),'local_stem':rounded(stem),'angle':angle,
                       'radii_m':radii,'scale':scale,'color':color})
    return result
