"""Small independent metric cases; no torch/Ultralytics/GPU dependencies."""
import importlib.util
import pathlib
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("evaluate_detector", pathlib.Path(__file__).parents[1] / "evaluate_detector.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)
NAMES = ["h0", "m1", "m2", "m3"]


def box(c, xyxy=(0, 0, 10, 10), confidence=None):
    value = {"class_id": c, "bbox": list(xyxy)}
    if confidence is not None:
        value["confidence"] = confidence
    return value


def row(identifier, boxes):
    return {"id": identifier, "image": "/test.jpg", "split": "test", "boxes": boxes}


class FakeTensor:
    """Only the tensor protocol that predict_boxes consumes; no ML imports."""
    def __init__(self, values):
        self.values = values

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.values


class FakeModel:
    def __init__(self, values):
        self.values = values
        self.calls = []

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        return [SimpleNamespace(boxes=SimpleNamespace(data=FakeTensor(self.values)))]


class PredictionAdapter(unittest.TestCase):
    def test_explicit_many_to_one_mapping_preserves_boxes_and_other_disease_errors(self):
        tensor_rows = [
            [0, 0, 10, 10, 0.95, 0],
            [20, 0, 30, 10, 0.9, 1],
            [40, 0, 50, 10, 0.85, 2],
            [60, 0, 70, 10, 0.8, 3],
        ]
        model, image = FakeModel(tensor_rows), object()
        predictions = evaluation.predict_boxes(model, image, imgsz=640, device="cpu",
                                               class_mapping={0: 0, 1: 1, 2: 1, 3: 1})
        self.assertEqual([p["class_id"] for p in predictions], [0, 1, 1, 1])
        self.assertEqual([p["bbox"] for p in predictions], [r[:4] for r in tensor_rows])
        self.assertEqual([p["confidence"] for p in predictions], [r[4] for r in tensor_rows])
        self.assertIs(model.calls[0]["source"], image)
        self.assertIsNone(model.calls[0]["quantize"])
        self.assertFalse(model.calls[0]["rect"])
        self.assertEqual(model.calls[0]["conf"], 0.001)
        # Last two target=monilia predictions cover other-disease GT: they must
        # be monilia FP/other-disease FN, although generic disease detects them.
        gt = [box(0), box(1, (20, 0, 30, 10)),
              box(2, (40, 0, 50, 10)), box(2, (60, 0, 70, 10))]
        metrics = evaluation.evaluate([row("external", gt)], {"external": predictions},
                                      0.5, ["healthy", "monilia", "phytophthora"])
        self.assertEqual(metrics["per_class"][1]["tp"], 1)
        self.assertEqual(metrics["per_class"][1]["fp"], 2)
        self.assertEqual(metrics["per_class"][2]["fn"], 2)
        self.assertEqual(metrics["binary"]["symptomatic"]["tp"], 3)

    def test_missing_or_mismatched_mapping_rejects_unknown_source_class(self):
        model = FakeModel([[0, 0, 10, 10, 0.9, 3]])
        for mapping in [{0: 0, 1: 1}, {"0": 0, "1": 1, "2": 1, "3": 1}]:
            with self.subTest(mapping=mapping):
                with self.assertRaises(KeyError):
                    evaluation.predict_boxes(model, object(), device="cpu", class_mapping=mapping)

    def test_nonfinite_coordinates_or_confidence_reject_entire_prediction(self):
        for bad_column, value in [(0, float("nan")), (3, float("inf")), (4, float("nan")), (4, float("inf"))]:
            with self.subTest(column=bad_column, value=value):
                values = [0, 0, 10, 10, 0.9, 1]
                values[bad_column] = value
                with self.assertRaisesRegex(ValueError, "nonfinite"):
                    evaluation.predict_boxes(FakeModel([values]), object(), device="cpu",
                                             class_mapping={0: 0, 1: 1})


class DetectionMetrics(unittest.TestCase):
    def test_duplicate_is_false_positive_and_wrong_stage_can_be_binary_correct(self):
        rows = [row("a", [box(1)])]
        predictions = {"a": [box(2, confidence=0.9), box(2, confidence=0.8)]}
        result = evaluation.evaluate(rows, predictions, 0.5, NAMES)
        self.assertEqual(result["per_class"][1]["fn"], 1)
        self.assertEqual(result["per_class"][2]["fp"], 2)
        self.assertEqual(result["binary"]["symptomatic"]["tp"], 1)
        self.assertEqual(result["binary"]["symptomatic"]["fp"], 1)
        self.assertEqual(result["early_symptom"]["any_symptom_recall"], 1)
        self.assertEqual(result["early_symptom"]["exact_stage_recall"], 0)

    def test_healthy_detection_does_not_hide_concurrent_wrong_action(self):
        rows = [row("a", [box(0)])]
        predictions = {"a": [box(0, confidence=0.99), box(1, confidence=0.9)]}
        result = evaluation.evaluate(rows, predictions, 0.5, NAMES)
        self.assertEqual(result["binary"]["healthy"]["tp"], 1)
        self.assertEqual(result["binary"]["symptomatic"]["fp"], 1)
        self.assertEqual(result["healthy_mistaken_actions"]["per_100_healthy_pods"], 100)

    def test_misses_and_background_detections_count(self):
        rows = [row("a", [box(3)]), row("b", [])]
        predictions = {"a": [], "b": [box(3, confidence=0.9)]}
        result = evaluation.evaluate(rows, predictions, 0.5, NAMES)
        self.assertEqual(result["binary"]["symptomatic"]["fn"], 1)
        self.assertEqual(result["binary"]["symptomatic"]["fp"], 1)
        self.assertEqual(result["confusion"]["matrix"][3][4], 1)
        self.assertEqual(result["confusion"]["matrix"][4][3], 1)

    def test_precision_constraint_takes_priority_over_unconstrained_f1(self):
        rows = [row("a", [box(1)]), row("b", [box(2)]), row("c", [box(0)])]
        predictions = {"a": [box(1, confidence=0.9)], "b": [box(2, confidence=0.6)], "c": [box(1, confidence=0.7)]}
        selected = evaluation.choose_threshold(rows, predictions, NAMES, 0, 1, 0.9)
        self.assertTrue(selected["target_precision_satisfied"])
        self.assertGreater(selected["threshold"], 0.7)
        self.assertEqual(selected["selected_validation_metrics"]["precision"], 1)
        self.assertEqual(selected["selected_validation_metrics"]["recall"], 0.5)

    def test_unattainable_target_is_explicit(self):
        rows = [row("a", [box(0)])]
        selected = evaluation.choose_threshold(rows, {"a": [box(1, confidence=0.9)]}, NAMES, 0, 1, 0.9)
        self.assertFalse(selected["target_precision_satisfied"])
        self.assertIsNone(selected["selected_validation_metrics"]["recall"])


if __name__ == "__main__":
    unittest.main()
