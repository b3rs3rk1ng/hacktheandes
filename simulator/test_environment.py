import copy
import json
import math
from pathlib import Path
import subprocess
import unittest
from generate_orchard import scene,world
from terrain import build_terrain,height_at,triangles,mesh
from vegetation import cacao_structure

ROOT=Path(__file__).resolve().parent


class SceneContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config=json.loads((ROOT/'orchard_config.json').read_text())
        cls.config['parcels']=copy.deepcopy(cls.config['parcels'][:2])
        for p in cls.config['parcels']:p.update(rows=3,columns=4)
        cls.data=scene(cls.config)

    def test_roots_follow_the_collision_surface(self):
        for plant in self.data['plants']:
            x,y,z=plant['position'];self.assertAlmostEqual(z,height_at(self.data['terrain'],x,y),places=10)

    def test_ground_is_not_flat_and_service_area_is_flat(self):
        t=self.data['terrain'];self.assertGreater(t['maximum']-t['minimum'],1)
        home=self.config['field']['home']
        for dx,dy in [(0,0),(1,0),(-2,2),(0,-2)]:self.assertEqual(height_at(t,home[0]+dx,home[1]+dy),0)
        flat=copy.deepcopy(self.config);flat['terrain']['amplitude_m']=0
        self.assertEqual(set(build_terrain(flat)['heights']),{0})

    def test_triangle_sampling_and_boundary(self):
        t={'columns':2,'rows':2,'spacing':1,'origin':[-1,-1],'heights':[0,1,2,4]}
        self.assertAlmostEqual(height_at(t,-.75,-.75),.75)
        self.assertAlmostEqual(height_at(t,-.25,-.25),2.75)
        self.assertEqual(height_at(t,10,10),4)
        self.assertEqual(list(triangles(t)),[(0,1,2),(1,3,2)])

    def test_renderer_and_physics_sample_identical_triangles(self):
        t=self.data['terrain'];points=[[-68,6],[-31.7,9.2],[0,-9],[9.3,18.1],[130,140],[-140,-160]]
        script="import {heightAt} from './ui/orchard/terrain.mjs';let s='';for await (const c of process.stdin)s+=c;const d=JSON.parse(s);console.log(JSON.stringify(d.points.map(p=>heightAt(d.terrain,...p))));"
        result=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps({'terrain':t,'points':points}),text=True,capture_output=True,check=True,cwd=ROOT)
        for point,z in zip(points,json.loads(result.stdout)):self.assertAlmostEqual(z,height_at(t,*point),places=10)

    def test_individual_tree_structure_is_repeatable_and_varied(self):
        self.assertEqual(cacao_structure(47,3.8),cacao_structure(47,3.8))
        trees=[p['structure'] for p in self.data['plants'] if p.get('structure')]
        self.assertEqual(len({json.dumps(t,sort_keys=True) for t in trees}),len(trees))
        self.assertGreater(len({len(t['primary']) for t in trees}),1)
        for tree in trees:
            self.assertGreater(len(tree['shoots']),10)
            self.assertTrue(all(b[6]>0 and b[7]>0 for b in tree['bones']))

    def test_fruits_have_attachment_size_and_colour_variation(self):
        plants={p['id']:p for p in self.data['plants']}
        counts={p:0 for p in self.data['route']}
        for pod in self.data['pods']:
            counts[pod['plant_id']]+=1;plant=plants[pod['plant_id']]
            self.assertGreater(pod['position'][2],plant['position'][2]+.1)
            self.assertGreater(pod['stem'][2],pod['position'][2])
            self.assertGreater(pod['mass_kg'],0)
            self.assertAlmostEqual(pod['radii_m'][0]/self.config['manipulation']['fruit_radii_m'][0],pod['scale'])
        self.assertGreater(len(set(counts.values())),1)
        self.assertGreater(len({p['color'] for p in self.data['pods']}),3)

    def test_collision_world_uses_the_shared_mesh(self):
        text=world(self.data)
        self.assertIn('DEF TERRAIN_SURFACE IndexedFaceSet',text)
        self.assertIn('boundingObject USE TERRAIN_SURFACE',text)
        self.assertIn('boundingObject Group',text)

    def test_detail_patch_has_no_overlapping_or_missing_ground(self):
        t=self.data['terrain'];points,faces=mesh(t);area=0
        for face in faces:
            a,b,c=[points[i] for i in face]
            twice=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            self.assertGreater(twice,0);area+=twice/2
        self.assertAlmostEqual(area,(t['columns']-1)*(t['rows']-1)*t['spacing']**2)
        coarse={**t,'patches':[]}
        for patch in t['patches']:
            for i,h in enumerate(patch['heights']):
                x=patch['origin'][0]+i%patch['columns']*patch['spacing'];y=patch['origin'][1]+i//patch['columns']*patch['spacing']
                if i%patch['columns'] in (0,patch['columns']-1) or i//patch['columns'] in (0,patch['rows']-1):self.assertAlmostEqual(h,height_at(coarse,x,y),places=4)

    def test_detail_mesh_contract_matches_javascript(self):
        t=self.data['terrain'];points,faces=mesh(t)
        script="import {terrainMesh} from './ui/orchard/terrain.mjs';let s='';for await(const c of process.stdin)s+=c;const m=terrainMesh(JSON.parse(s));console.log(JSON.stringify(m));"
        result=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(t),text=True,capture_output=True,check=True,cwd=ROOT)
        js=json.loads(result.stdout)
        self.assertEqual(js['positions'],[v for p in points for v in p]);self.assertEqual(js['indices'],[v for face in faces for v in face])

    def test_invalid_patch_layouts_are_rejected(self):
        for change in [{'spacing_m':0},{'origin':[-3,-12]},{'origin':[400,400]}]:
            config=copy.deepcopy(self.config);config['terrain']['detail_patches'][0].update(change)
            with self.assertRaises(ValueError):build_terrain(config)
        config=copy.deepcopy(self.config);config['terrain']['detail_patches']*=2
        with self.assertRaises(ValueError):build_terrain(config)


if __name__=='__main__':unittest.main()
