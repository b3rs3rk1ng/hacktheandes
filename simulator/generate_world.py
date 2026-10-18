"""Build a self-contained Webots scene from a declarative manipulation fixture."""
import json
import math
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parent


def vec(values):
    return ' '.join(f'{x:.6g}' for x in values)


def material(color, metal=0, roughness=0.75, transparency=0):
    return f'PBRAppearance {{ baseColor {vec(color)} metalness {metal} roughness {roughness} transparency {transparency} }}'


def shape(geometry, color, **kwargs):
    return f'Shape {{ appearance {material(color, **kwargs)} geometry {geometry} }}'


def at(position, content, rotation=None, scale=None):
    kind = 'Transform' if scale else 'Pose'
    return f'{kind} {{ translation {vec(position)} ' + (f'rotation {vec(rotation)} ' if rotation else '') + (f'scale {vec(scale)} ' if scale else '') + f'children [ {content} ] }}'


def box(size, color, **kwargs):
    return shape(f'Box {{ size {vec(size)} }}', color, **kwargs)


def sphere(radius, color, **kwargs):
    return shape(f'Sphere {{ radius {radius} subdivision 2 }}', color, **kwargs)


def mesh_ellipsoid(radii, color, ribs=0, rings=16, segments=32):
    points = []
    faces = []
    for i in range(rings + 1):
        latitude = math.pi * i / rings
        for j in range(segments):
            angle = 2 * math.pi * j / segments
            wave = 1 + 0.055 * math.cos(ribs * angle) if ribs else 1
            points.append([radii[0] * math.sin(latitude) * math.cos(angle) * wave,
                           radii[1] * math.sin(latitude) * math.sin(angle) * wave,
                           radii[2] * math.cos(latitude)])
    for i in range(rings):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            faces.extend([[a, a + segments, b], [b, a + segments, b + segments]])
    geometry = 'IndexedFaceSet { creaseAngle 1.1 coord Coordinate { point [ ' + ','.join(vec(p) for p in points) + ' ] } coordIndex [ ' + ','.join(' '.join(map(str, f)) + ' -1' for f in faces) + ' ] }'
    return shape(geometry, color)


def branch(start, end, radius, color):
    delta = [b - a for a, b in zip(start, end)]
    length = math.sqrt(sum(x * x for x in delta))
    rotation = [-delta[1], delta[0], 0, math.acos(delta[2] / length)]
    if abs(rotation[0]) + abs(rotation[1]) < 1e-8:
        rotation = [1, 0, 0, 0 if delta[2] >= 0 else math.pi]
    return at([(a + b) / 2 for a, b in zip(start, end)], shape(f'Cylinder {{ radius {radius} height {length} subdivision 12 }}', color), rotation)


def look_at(position, target):
    delta = [b-a for a,b in zip(position,target)]
    yaw = math.atan2(delta[1],delta[0])
    pitch = math.atan2(-delta[2],math.hypot(delta[0],delta[1]))
    sy, cy = math.sin(yaw/2), math.cos(yaw/2)
    sp, cp = math.sin(pitch/2), math.cos(pitch/2)
    q = [-sy*sp, cy*sp, sy*cp, cy*cp]
    angle = 2*math.acos(q[3])
    norm = math.sqrt(sum(v*v for v in q[:3]))
    return [*(v/norm for v in q[:3]),angle]


def build(config):
    rng = random.Random(config['seed'])
    pod = config['target']
    drone = config['drone']
    tree = config['tree']
    bin_config = config['bin']
    tx, ty, _ = tree['position']
    green = [0.17, 0.32, 0.16]
    world = ['#VRML_SIM R2025a utf8',
             f'WorldInfo {{ basicTimeStep {config["time_step_ms"]} FPS 30 coordinateSystem "ENU" title "Cacao: ensayo de manipulación" }}',
             f'Viewpoint {{ orientation {vec(look_at([-4.1,-6.1,3.65],[.4,0,1.3]))} position -4.1 -6.1 3.65 fieldOfView 0.82 }}',
             'Background { skyColor [ 0.73 0.84 0.88 ] }',
             'DirectionalLight { direction -0.4 0.6 -1 intensity 2.1 ambientIntensity 0.7 castShadows TRUE }',
             'Fog { color 0.73 0.84 0.88 visibilityRange 65 }',
             'Solid { translation 0 0 -0.07 children [ ' + box([24, 24, 0.12], [0.33, 0.40, 0.23]) + ' ] boundingObject Box { size 24 24 0.12 } }']
    # A tiled work area makes scale and direction visible without external assets.
    for i in range(-5, 6):
        world.append(at([i, 0, -0.004], box([0.014, 10, 0.004], [0.46, 0.51, 0.36])))
        world.append(at([0, i, -0.004], box([10, 0.014, 0.004], [0.46, 0.51, 0.36])))
    tree_shapes = [branch([tx, ty, 0], [tx, ty, 2.8], 0.18, [0.28, 0.17, 0.10])]
    for angle in [0.2, 1.9, 3.5, 5.2]:
        end = [tx + 0.7 * math.cos(angle), ty + 0.7 * math.sin(angle), 2.85]
        tree_shapes.append(branch([tx, ty, 1.85], end, 0.065, [0.30, 0.19, 0.11]))
    for _ in range(85):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(0.10, 1.10)
        point = [tx + radius * math.cos(angle), ty + radius * math.sin(angle), rng.uniform(2.55, 3.12)]
        leaf = mesh_ellipsoid([0.34, 0.13, 0.025], [green[0] + rng.uniform(-.05, .08), green[1] + rng.uniform(-.04, .12), green[2]], rings=5, segments=10)
        tree_shapes.append(at(point, leaf, [0, 0, 1, angle]))
    world.append('Solid { name "Árbol de prueba" children [ ' + '\n'.join(tree_shapes) + f' ] boundingObject Pose {{ translation {tx} {ty} 1.4 children [ Cylinder {{ radius 0.18 height 2.8 }} ] }} }}')
    # The stem is a mechanical connector; releasing it represents a commanded cut.
    stem_position = [a + b for a, b in zip(pod['position'], pod['stem_offset'])]
    world.append(f'DEF FIXTURE Robot {{ name "Stem fixture" controller "<none>" children [ Connector {{ translation {vec(stem_position)} rotation 0 0 1 3.14159265 name "stem fixture" model "stem" type "passive" }} ] }}')
    stem_shape = branch(stem_position, [tx - .16, ty, pod['position'][2]], .014, [.25, .22, .11])
    stem_shape = stem_shape.replace('appearance PBRAppearance', 'appearance DEF STEM_MATERIAL PBRAppearance')
    world.append('DEF STEM_VISUAL Pose { children [ ' + stem_shape + ' ] }')
    pod_surface = mesh_ellipsoid(pod['radii'], [0.76, 0.29, 0.12], ribs=10)
    # Marking identifies the selected fixture, not an inferred disease.
    pod_surface += at([-.12, -.03, .045], mesh_ellipsoid([.017, .074, .095], [.40, .22, .12], rings=8, segments=12))
    world.append(f'DEF TARGET Solid {{ translation {vec(pod["position"])} name "Mazorca de prueba" children [ {pod_surface} Connector {{ translation {vec(pod["grip_offset"])} rotation 0 0 1 3.14159265 name "fruit grip" model "grip" type "passive" }} DEF STEM_CONNECTOR Connector {{ translation {vec(pod["stem_offset"])} name "fruit stem" model "stem" type "symmetric" isLocked TRUE }} ] boundingObject Sphere {{ radius 0.125 }} physics Physics {{ density -1 mass {pod["mass_kg"]} }} }}')
    # One active connector on a robot controls the stem, while its passive peer is static.
    world[-1] = world[-1].replace('model "stem" type "symmetric"', 'model "stem" type "active"')
    bx, by, bz = bin_config['position']
    w, d, h = bin_config['size']
    bin_parts = [([0, 0, .035], [w, d, .07]), ([-w/2, 0, h/2], [.045, d, h]), ([w/2, 0, h/2], [.045, d, h]), ([0, -d/2, h/2], [w, .045, h]), ([0, d/2, h/2], [w, .045, h])]
    world.append(f'DEF BIN Solid {{ translation {vec([bx, by, bz])} name "Recipiente" children [ ' + ' '.join(at(p, box(s, [.05, .32, .40])) for p, s in bin_parts) + ' ] boundingObject Group { children [ ' + ' '.join(at(p, f'Box {{ size {vec(s)} }}') for p, s in bin_parts) + ' ] } }')
    # Background pods are fixtures to show why a target must be selected.
    for offset, color in [([.20, .24, .9], [.77, .65, .12]), ([.02, -.22, 1.95], [.29, .48, .12])]:
        world.append(at([tx + offset[0], ty + offset[1], offset[2]], mesh_ellipsoid([.11, .11, .22], color, ribs=10)))
    drone_parts = [box([.38, .28, .13], [.88, .90, .84], metal=.15),
                   at([-.04, 0, .075], box([.21, .20, .035], [.10, .18, .23])),
                   at([.19, 0, 0], box([.012, .20, .035], [.10, .85, .72])),
                   at([.40, 0, -.025], box([.46, .045, .055], [.16, .21, .23], metal=.65)),
                   at([.59, 0, 0], box([.04, .25, .10], [.91, .51, .10], metal=.3))]
    for x in [-.32, .32]:
        for y in [-.30, .30]:
            drone_parts.append(branch([0, 0, 0], [x, y, 0], .033, [.20, .27, .27]))
            drone_parts.append(at([x, y, .03], shape('Cylinder { radius .042 height .08 }', [.13, .20, .23], metal=.6)))
            drone_parts.append(at([x, y, .08], shape('Cylinder { radius .17 height .003 subdivision 32 }', [.13, .20, .23], transparency=.65)))
    for sign in [-1, 1]:
        drone_parts.append(at([.70, sign * .16, 0], box([.23, .026, .028], [.23, .29, .29], metal=.6)))
    for x in [-.13, .13]:
        drone_parts.append(branch([x, -.10, -.05], [x, -.17, -.19], .013, [.17, .24, .25]))
        drone_parts.append(branch([x, .10, -.05], [x, .17, -.19], .013, [.17, .24, .25]))
    drone_parts.append('Camera { translation .20 0 .04 name "camera" width 480 height 320 fieldOfView 1.12 near .03 }')
    drone_parts.append(f'Connector {{ translation {vec(drone["tool_offset"])} name "gripper" model "grip" type "active" distanceTolerance {config["grip_tolerance_m"]} axisTolerance .15 numberOfRotations 0 snap FALSE }}')
    world.append(f'DEF DRONE Robot {{ translation {vec(drone["initial_position"])} name "Dron de ensayo" supervisor TRUE controller "aerial_lab" children [ ' + '\n'.join(drone_parts) + f' ] boundingObject Box {{ size .43 .36 .21 }} physics Physics {{ density -1 mass {drone["mass_kg"]} centerOfMass [ 0 0 0 ] inertiaMatrix [ {vec(drone["inertia_kg_m2"])} 0 0 0 ] }} }}')
    return '\n'.join(world) + '\n'


if __name__ == '__main__':
    config = json.loads((ROOT / 'config.json').read_text())
    output = ROOT / 'worlds/cacao.wbt'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(build(config))
    print(output)
