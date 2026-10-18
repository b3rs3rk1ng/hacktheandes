"""Boundary-contract fixtures for the generic external YOLO adapter."""
import importlib.util
from pathlib import Path
import unittest

SOURCE=Path(__file__).with_name('yolo_to_manifest.py')
SPEC=importlib.util.spec_from_file_location('external_yolo_adapter',SOURCE)
ADAPTER=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)

class NormalizedBoundaryTests(unittest.TestCase):
    mapping={0:{'target_id':0,'source_name':'item'}}

    def parse(self,cx,width,tolerance=0):
        repairs=[]
        boxes=ADAPTER.parse_labels(f'0 {cx:.10f} .5 {width:.10f} .5',
                                  self.mapping,100,100,tolerance=tolerance,repairs=repairs)
        return boxes,repairs

    def test_exact_one_needs_no_repair(self):
        boxes,repairs=self.parse(.75,.5)
        self.assertEqual(boxes[0]['bbox'],[50,25,100,75])
        self.assertEqual(repairs,[])

    def test_declared_tolerance_records_boundary_rounding(self):
        boxes,repairs=self.parse(.7500005,.5,1e-6)
        self.assertEqual(boxes[0]['bbox'][2],100)
        self.assertEqual(len(repairs),1)
        self.assertAlmostEqual(repairs[0]['original_normalized_xyxy'][2],1.0000005)
        self.assertEqual(repairs[0]['repaired_normalized_xyxy'][2],1)
        self.assertEqual(repairs[0]['tolerance'],1e-6)
        self.assertEqual(boxes[0]['coordinate_repair'],repairs[0])

    def test_default_zero_tolerance_remains_strict(self):
        with self.assertRaises(ValueError):self.parse(.7500005,.5)

    def test_beyond_declared_tolerance_is_rejected(self):
        with self.assertRaises(ValueError):self.parse(.750002,.5,1e-6)

    def test_zero_area_is_rejected(self):
        with self.assertRaises(ValueError):self.parse(.5,0,1e-6)

    def test_zero_area_after_boundary_repair_is_rejected(self):
        with self.assertRaises(ValueError):
            ADAPTER.parse_labels('0 -0.00000005 .5 0.0000001 .5',
                                 self.mapping,100,100,tolerance=1e-6)

if __name__=='__main__':unittest.main()
