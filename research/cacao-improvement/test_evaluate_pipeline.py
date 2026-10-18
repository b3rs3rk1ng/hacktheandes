"""Pipeline metric/preprocessing checks without ML frameworks or GPU."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location("evaluate_pipeline", Path(__file__).with_name("evaluate_pipeline.py"))
PIPELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PIPELINE)


def row(identifier, c):
    return {"id": str(identifier), "image": "/dummy.jpg", "split": "val",
            "boxes": [{"class_id": c, "bbox": [0, 0, 10, 10]}]}


def prediction(score):
    return [{"class_id": 1, "bbox": [0, 0, 10, 10], "confidence": score}]


CONFIG = {"target_classes": [1], "selection": {"precision_target": 0.95, "min_recall": 0.5, "min_alerts": 20}}
METADATA = {
    "architecture": "efficientnet_b0", "class_names": ["healthy", "monilia", "phytophthora"],
    "input_size": 256,
    "preprocessing": {"mode": "pad_square", "rgb_fill": [114, 114, 114], "mean": [0, 0, 0], "std": [1, 1, 1]},
    "roi": {"padding_fraction": 0.1, "min_side_pixels": 32, "reference_image_max_side": 1280},
}


class PipelineMetrics(unittest.TestCase):
    def test_precision_target_does_not_reward_ten_easy_alerts_below_minimum_recall(self):
        rows = [row(i, 1) for i in range(40)] + [row(i, 0) for i in range(40, 55)]
        predictions = {str(i): prediction(0.99 if i < 10 else 0.6 if i < 40 else 0.8) for i in range(55)}
        result = PIPELINE.select_operating_point(rows, predictions, CONFIG, "detection")
        self.assertFalse(result["target_met"])
        self.assertIn("max_precision_at_minimum_recall", result["status"])
        selected = result["validation_metrics"]
        self.assertEqual((selected["tp"], selected["fp"]), (40, 15))
        self.assertGreaterEqual(selected["recall"], 0.5)
        self.assertGreaterEqual(selected["alerts"], 20)

    def test_feasible_precision_policy_is_met_only_with_enough_recall_and_alerts(self):
        rows = [row(i, 1) for i in range(30)] + [row(i, 0) for i in range(30, 50)]
        predictions = {str(i): prediction(0.9 if i < 30 else 0.2) for i in range(50)}
        result = PIPELINE.select_operating_point(rows, predictions, CONFIG, "detection")
        self.assertTrue(result["target_met"])
        self.assertEqual(result["validation_metrics"]["precision"], 1)
        self.assertEqual(result["validation_metrics"]["recall"], 1)
        self.assertEqual(result["validation_metrics"]["alerts"], 30)

    def test_no_alerts_is_explicitly_infeasible(self):
        rows = [row(i, 1) for i in range(30)]
        result = PIPELINE.select_operating_point(rows, {str(i): [] for i in range(30)}, CONFIG, "detection")
        self.assertFalse(result["target_met"])
        self.assertIn("constraints_unmet", result["status"])
        self.assertEqual(result["validation_metrics"]["alerts"], 0)

    def test_image_labels_are_explicit_and_metrics_count_images_not_objects(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "manifest.json"
            path.write_text(json.dumps([{"id": "healthy-folder-name", "image": "/Healthy/a.jpg", "split": "test"}]))
            with self.assertRaisesRegex(ValueError, "explicit label_class_id"):
                PIPELINE.load_rows(path, "image_binary")
        rows = [{"id": "positive", "label_class_id": 1}, {"id": "healthy", "label_class_id": 0},
                {"id": "other_disease", "label_class_id": 2}]
        # Multiple detections of the positive image still count as one image.
        predictions = {"positive": prediction(0.9) + prediction(0.8), "healthy": [], "other_disease": prediction(0.9)}
        metrics = PIPELINE.target_metrics(rows, predictions, 0.5, [1], "image_binary")
        self.assertEqual((metrics["tp"], metrics["fp"], metrics["fn"], metrics["tn"]), (1, 1, 0, 1))
        self.assertEqual(metrics["negative_classes"]["2"]["false_alarms"], 1)
        self.assertEqual(metrics["unit"], "image")
        self.assertNotIn("map50", metrics)

    def test_source_annotation_recall_reuses_target_matches_and_counts_each_gt_once(self):
        stage_a = {"source": "provider-x", "class": "stage-a", "source_class_id": 4}
        stage_b = {"source": "provider-x", "class": "stage-b", "source_class_id": 7}
        rows = [{"id": "staged", "boxes": [
            {"class_id": 1, "bbox": [0, 0, 10, 10], "original_stages": [stage_a, stage_a]},
            {"class_id": 1, "bbox": [20, 0, 30, 10], "original_stages": [stage_b]},
            {"class_id": 1, "bbox": [40, 0, 50, 10], "original_stages": [stage_a]},
            {"class_id": 1, "bbox": [60, 0, 70, 10]},
        ]}]
        predictions = {"staged": [
            {"class_id": 1, "bbox": [0, 0, 10, 10], "confidence": 0.9},
            {"class_id": 1, "bbox": [20, 0, 30, 10], "confidence": 0.8},
            {"class_id": 1, "bbox": [40, 0, 50, 10], "confidence": 0.2},
        ]}
        result = PIPELINE.target_metrics(rows, predictions, 0.5, [1], "detection")
        self.assertEqual((result["tp"], result["fn"]), (2, 2))
        provenance = {r["class"]: r for r in result["recall_by_source_annotation"]}
        self.assertEqual((provenance["stage-a"]["gt"], provenance["stage-a"]["tp"], provenance["stage-a"]["fn"]), (2, 1, 1))
        self.assertEqual(provenance["stage-a"]["recall"], 0.5)
        self.assertEqual(provenance["stage-a"]["source_class_ids"], [4])
        self.assertEqual((provenance["stage-b"]["gt"], provenance["stage-b"]["tp"], provenance["stage-b"]["fn"]), (1, 1, 0))
        self.assertEqual(result["target_gt_without_source_annotation"], 1)

    def test_letterbox_preserves_rgb_aspect_and_normalized_channel_order(self):
        source = Image.new("RGB", (100, 50), (255, 0, 0))
        crop = PIPELINE.roi_image(source, [0, 0, 100, 50], METADATA)
        self.assertEqual(crop.size, (256, 256))
        self.assertEqual(crop.getpixel((128, 0)), (114, 114, 114))
        self.assertEqual(crop.getpixel((128, 128)), (255, 0, 0))
        array = PIPELINE.roi_array(source, [0, 0, 100, 50], METADATA)
        self.assertEqual(array.shape, (3, 256, 256))
        self.assertEqual(array.dtype, np.float32)
        np.testing.assert_array_equal(array[:, 128, 128], [1, 0, 0])

    def test_minimum_roi_size_scales_with_source_resolution(self):
        for width, height, bbox in [(1280, 640, [0, 0, 31, 100]), (640, 320, [0, 0, 15.5, 50])]:
            with self.subTest(size=(width, height)):
                self.assertIsNone(PIPELINE.roi_image(Image.new("RGB", (width, height)), bbox, METADATA))
        self.assertIsNotNone(PIPELINE.roi_image(Image.new("RGB", (1280, 640)), [0, 0, 32, 100], METADATA))

    def test_reference_duplicates_and_conflicting_image_labels_are_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for i in range(3):
                pixels = np.random.default_rng(i).integers(0, 256, (64, 64, 3), dtype=np.uint8)
                Image.fromarray(pixels).save(root / f"{i}.png")
            references = root / "reference.json"
            references.write_text(json.dumps([{"id": "training-photo", "image": str(root / "0.png")}]))
            rows = [{"id": "reference-copy", "image": str(root / "0.png"), "label_class_id": 0},
                    {"id": "conflict-a", "image": str(root / "1.png"), "label_class_id": 0},
                    {"id": "conflict-b", "image": str(root / "1.png"), "label_class_id": 1},
                    {"id": "independent", "image": str(root / "2.png"), "label_class_id": 1}]
            eligible, audit = PIPELINE.duplicate_audit(rows, [references], 4)
            self.assertEqual([r["id"] for r in eligible], ["independent"])
            self.assertEqual(len(audit["excluded"]), 3)

    def test_transitive_test_bridge_to_reference_excludes_the_entire_family(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, value in [("a", 10), ("b", 20), ("reference", 30)]:
                Image.new("RGB", (32, 32), (value, 0, 0)).save(root / (name + ".png"))
            references = root / "references.json"
            references.write_text(json.dumps([{"id": "training", "image": str(root / "reference.png")}]))
            rows = [{"id": name, "image": str(root / (name + ".png")), "label_class_id": 1}
                    for name in ["a", "b"]]
            # A=000, B=001, R=011: A~B~R at distance one, A !~ R.
            hashes = {10: 0b000, 20: 0b001, 30: 0b011}
            with patch("prepare_dataset.phash", side_effect=lambda im: hashes[im.getpixel((0, 0))[0]]):
                eligible, audit = PIPELINE.duplicate_audit(rows, [references], 1)
            self.assertEqual(eligible, [])
            self.assertEqual([r["reason"] for r in audit["excluded"]], ["reference_overlap"] * 2)
            self.assertEqual(audit["excluded"][0]["reference_matches"], [])
            self.assertEqual(audit["excluded"][0]["component_reference_ids"], ["training"])
            self.assertEqual(len({r["component_id"] for r in audit["excluded"]}), 1)

    def test_test_only_transitive_family_keeps_first_input_row_despite_late_bridge(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, value in [("a", 10), ("b", 20), ("c", 30), ("independent", 40)]:
                Image.new("RGB", (32, 32), (value, 0, 0)).save(root / (name + ".png"))
            rows = [{"id": name, "image": str(root / (name + ".png")), "label_class_id": 1}
                    for name in ["a", "c", "b", "independent"]]
            hashes = {10: 0b0000, 20: 0b0001, 30: 0b0011, 40: 0b1111}
            with patch("prepare_dataset.phash", side_effect=lambda im: hashes[im.getpixel((0, 0))[0]]):
                eligible, audit = PIPELINE.duplicate_audit(rows, [], 1)
            self.assertEqual([r["id"] for r in eligible], ["a", "independent"])
            self.assertEqual([r["id"] for r in audit["excluded"]], ["c", "b"])
            self.assertEqual(audit["excluded"][0]["benchmark_matches"], [("a", 2, False)])


if __name__ == "__main__":
    unittest.main()
