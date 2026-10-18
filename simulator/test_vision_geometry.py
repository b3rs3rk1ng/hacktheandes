import copy
import unittest
from vision_geometry import SceneLocalizer, validate_camera

CAMERA={'position':[0,1,0],'quaternion':[0,0,0,1],'vertical_fov_degrees':60,'aspect':2}


def fruit(identifier='object',position=None):
    return {'id':identifier,'plant_id':'tree','position':position or [0,3,1],'radii_m':[.15,.10,.30]}


class VisibleLocalization(unittest.TestCase):
    def localize(self,world,bbox=None,camera=None):
        return SceneLocalizer(world).associate([{'confidence':.99,'class_id':1,'bbox':bbox or [302,128,338,192]}],camera or CAMERA,640,320)

    def test_visible_fruit_is_localized_without_disease_labels(self):
        obj=fruit();world={'pods':[obj],'plants':[]};a=self.localize(world)
        self.assertEqual(a['associations'][0]['pod_id'],'object')
        self.assertGreaterEqual(a['associations'][0]['visible_samples'],3)
        obj['label']='healthy';self.assertEqual(self.localize(world),a)
        obj['label']='monilia';self.assertEqual(self.localize(world),a)

    def test_trunk_blocks_object_behind_it_but_not_object_in_front(self):
        tree={'position':[0,1.5,0],'height':3}
        result=self.localize({'pods':[fruit()],'plants':[tree]})
        self.assertFalse(result['associations'])
        self.assertEqual(result['rejected'][0]['reason'],'object_occluded_or_insufficient_view')
        obj=fruit(position=[0,1,1]);result=self.localize({'pods':[obj],'plants':[tree]},[260,40,380,280])
        self.assertEqual(result['associations'][0]['pod_id'],'object')

    def test_large_trunk_box_cannot_claim_a_small_visible_fruit(self):
        self.assertFalse(self.localize({'pods':[fruit()],'plants':[]},[246,0,369,320])['associations'])

    def test_no_geometry_hit_cannot_create_an_object_identity(self):
        self.assertFalse(self.localize({'pods':[],'plants':[]})['associations'])

    def test_a_closer_fruit_also_occludes_a_background_fruit(self):
        front=fruit('front',[0,1.5,1]);front['radii_m']=[.4,.2,.65]
        result=self.localize({'pods':[front,fruit('behind')],'plants':[]})
        self.assertFalse(result['associations'])

    def test_wrong_pose_or_removed_object_does_not_match(self):
        world={'pods':[fruit()],'plants':[]}
        self.assertFalse(self.localize(world,camera={**CAMERA,'position':[2,1,0]})['associations'])
        self.assertFalse(SceneLocalizer(world).associate([{'confidence':.9,'bbox':[302,128,338,192]}],CAMERA,640,320,['object'])['associations'])

    def test_other_ids_and_translated_scene_follow_same_contract(self):
        obj=fruit('new-species-789',[10,23,1]);camera={**CAMERA,'position':[10,1,-20]}
        self.assertEqual(self.localize({'pods':[obj],'plants':[]},camera=camera)['associations'][0]['pod_id'],obj['id'])

    def test_two_predictions_cannot_claim_the_same_fruit(self):
        predictions=[{'confidence':.8,'bbox':[302,128,338,192]},{'confidence':.95,'bbox':[302,128,338,192]}]
        result=SceneLocalizer({'pods':[fruit()]}).associate(predictions,CAMERA,640,320)
        self.assertEqual(len(result['associations']),1);self.assertEqual(result['associations'][0]['prediction_index'],1)

    def test_pose_requires_normalized_rotation_and_matching_image_aspect(self):
        for value in [{**CAMERA,'quaternion':[0,0,0,0]},{**CAMERA,'aspect':1},{**CAMERA,'position':[0,float('nan'),0]}]:
            with self.assertRaises(ValueError):validate_camera(value,640,320)

    def test_declarative_overlap_policy_can_be_stricter(self):
        world={'pods':[fruit()],'config':{'inspection':{'association':{'minimum_box_iou':.99999}}}}
        self.assertFalse(self.localize(world)['associations'])


if __name__=='__main__':unittest.main()
