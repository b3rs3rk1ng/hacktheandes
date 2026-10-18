#!/usr/bin/env python3
"""Evaluate a YOLO detector using a frozen pixel-coordinate manifest.

Manifest JSON is a list of:
  {"id": "unique-id", "image": "/absolute/actual-image.jpg", "split": "test",
   "boxes": [{"class_id": 0, "bbox": [x1, y1, x2, y2]}]}
Coordinates are pixels in the image on disk, after any dataset normalization.
The data YAML's val/test images must agree exactly with the manifest. Class 0
is healthy and class 1 early symptoms by default; both are configurable.

Dependencies: ultralytics, torch, opencv-python, PyYAML, Pillow, numpy.
Synthetic corruptions measure robustness to image changes, not real flight.
"""
import argparse
import hashlib
import json
import math
import pathlib
import statistics
import time


def json_write(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def safe_float(value):
    value = float(value)
    return value if math.isfinite(value) else None


def divide(a, b):
    return a / b if b else None


def wilson(successes, total):
    if not total:
        return None
    p, z = successes / total, 1.959963984540054
    center = (p + z * z / (2 * total)) / (1 + z * z / total)
    radius = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total)
    return [max(0.0, center - radius), min(1.0, center + radius)]


def iou(a, b):
    width = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    intersection = width * height
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    return intersection / union if union > 0 else 0.0


def match(predictions, boxes, class_map=None, min_iou=0.5):
    """Confidence-ordered one-to-one matching; class_map=None is class agnostic."""
    available = set(range(len(boxes)))
    matches = []
    for pi in sorted(range(len(predictions)), key=lambda i: (-predictions[i]["confidence"], i)):
        prediction = predictions[pi]
        candidates = [gi for gi in available if class_map is None or
                      class_map(prediction["class_id"]) == class_map(boxes[gi]["class_id"])]
        if not candidates:
            continue
        gi = max(candidates, key=lambda gi: (iou(prediction["bbox"], boxes[gi]["bbox"]), -gi))
        overlap = iou(prediction["bbox"], boxes[gi]["bbox"])
        if overlap >= min_iou:
            available.remove(gi)
            matches.append((pi, gi, overlap))
    return matches


def counts_metrics(tp, fp, fn):
    return {
        "tp": tp, "fp": fp, "fn": fn,
        "precision": divide(tp, tp + fp), "recall": divide(tp, tp + fn),
        "f1": divide(2 * tp, 2 * tp + fp + fn),
        "precision_wilson_95": wilson(tp, tp + fp),
        "recall_wilson_95": wilson(tp, tp + fn),
    }


def evaluate(rows, predictions_by_id, threshold, names, healthy_class=0, early_class=1):
    """All detections/GT count; wrong-class predictions yield FP plus FN."""
    n = len(names)
    stage = [[0, 0, 0] for _ in range(n)]  # TP, FP, FN
    binary = [[0, 0, 0] for _ in range(2)]
    confusion = [[0] * (n + 1) for _ in range(n + 1)]
    early_total = early_any_symptom = healthy_total = healthy_actions = 0
    image_records = []
    for row in rows:
        gt = row["boxes"]
        pred = [p for p in predictions_by_id[str(row["id"])] if p["confidence"] >= threshold]
        exact_matches = match(pred, gt, lambda c: c)
        binary_matches = match(pred, gt, lambda c: int(c != healthy_class))
        exact_p, exact_g = {m[0] for m in exact_matches}, {m[1] for m in exact_matches}
        binary_p, binary_g = {m[0] for m in binary_matches}, {m[1] for m in binary_matches}
        for pi, gi, _ in exact_matches:
            stage[gt[gi]["class_id"]][0] += 1
        for pi, p in enumerate(pred):
            if pi not in exact_p:
                stage[p["class_id"]][1] += 1
            if pi not in binary_p:
                binary[int(p["class_id"] != healthy_class)][1] += 1
        for gi, box in enumerate(gt):
            if gi not in exact_g:
                stage[box["class_id"]][2] += 1
            if gi not in binary_g:
                binary[int(box["class_id"] != healthy_class)][2] += 1
        for _, gi, _ in binary_matches:
            binary[int(gt[gi]["class_id"] != healthy_class)][0] += 1
        agnostic = match(pred, gt)
        for pi, gi, _ in agnostic:
            confusion[gt[gi]["class_id"]][pred[pi]["class_id"]] += 1
        agnostic_p, agnostic_g = {m[0] for m in agnostic}, {m[1] for m in agnostic}
        for pi, p in enumerate(pred):
            if pi not in agnostic_p:
                confusion[n][p["class_id"]] += 1
        for gi, box in enumerate(gt):
            if gi not in agnostic_g:
                confusion[box["class_id"]][n] += 1
        # A healthy prediction cannot hide a concurrent suggested removal:
        # match only action-producing (symptomatic) predictions against all GT.
        action_predictions = [p for p in pred if p["class_id"] != healthy_class]
        action_matches = match(action_predictions, gt)
        mistaken = [gi for _, gi, _ in action_matches if gt[gi]["class_id"] == healthy_class]
        healthy_actions += len(mistaken)
        healthy_total += sum(b["class_id"] == healthy_class for b in gt)
        early_total += sum(b["class_id"] == early_class for b in gt)
        early_any_symptom += sum(gt[gi]["class_id"] == early_class for _, gi, _ in binary_matches)
        image_records.append({
            "id": str(row["id"]), "image": row["image"], "predictions": len(pred),
            "exact_stage_tp": len(exact_matches), "exact_stage_fp": len(pred) - len(exact_matches),
            "exact_stage_fn": len(gt) - len(exact_matches),
            "healthy_mistaken_actions": len(mistaken),
        })
    return {
        "images": len(rows), "threshold": threshold, "matching_iou": 0.5,
        "matching": "confidence-descending greedy, one-to-one, class-aware after explicit remapping",
        "per_class": [{"class_id": i, "name": names[i], "gt_instances": c[0] + c[2],
                       **counts_metrics(*c)} for i, c in enumerate(stage)],
        "binary": {
            "healthy": {"original_class_id": healthy_class, **counts_metrics(*binary[0])},
            "symptomatic": {"original_class_ids": [i for i in range(n) if i != healthy_class],
                            **counts_metrics(*binary[1])},
        },
        "early_symptom": {
            "class_id": early_class, "gt_instances": early_total,
            "exact_stage_recall": divide(stage[early_class][0], early_total),
            "any_symptom_tp": early_any_symptom,
            "any_symptom_recall": divide(early_any_symptom, early_total),
            "any_symptom_recall_wilson_95": wilson(early_any_symptom, early_total),
        },
        "healthy_mistaken_actions": {
            "healthy_gt_instances": healthy_total, "healthy_pods_targeted_as_symptomatic": healthy_actions,
            "per_100_healthy_pods": 100 * healthy_actions / healthy_total if healthy_total else None,
            "definition": "symptom predictions matched class-agnostically to all GT at IoU>=0.5; count matched healthy GT",
        },
        "confusion": {"rows": "ground truth", "columns": "prediction",
                      "names": names + ["background"], "matrix": confusion},
        "uncertainty_note": "Wilson intervals treat pods as independent; same-tree/capture dependence can widen uncertainty.",
        "per_image": image_records,
    }


def choose_threshold(rows, predictions, names, healthy_class, early_class, precision_target):
    curve = []
    for threshold in [0.001] + [i / 100 for i in range(1, 100)]:
        m = evaluate(rows, predictions, threshold, names, healthy_class, early_class)["binary"]["symptomatic"]
        curve.append({"threshold": threshold, **m})
    eligible = [r for r in curve if r["tp"] > 0 and r["precision"] >= precision_target]
    selected = max(eligible or curve,
                   key=lambda r: (r["f1"] or 0, r["precision"] or 0, r["recall"] or 0, r["threshold"]))
    return {
        "split": "val", "precision_target": precision_target,
        "target_precision_satisfied": bool(eligible), "threshold": selected["threshold"],
        "selection_rule": "maximum symptomatic F1 subject to precision target; if infeasible, maximum unconstrained F1; ties precision, recall, higher threshold",
        "selected_validation_metrics": selected, "curve": curve,
    }


def split_paths(config, yaml_path, split):
    root = pathlib.Path(config.get("path", yaml_path.parent)).expanduser()
    if not root.is_absolute():
        root = yaml_path.parent / root
    raw = config.get(split)
    if not raw:
        raise ValueError(f"Data YAML has no {split!r} split")
    paths = set()
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp", ".dng", ".mpo", ".pfm", ".heic"}
    for item in raw if isinstance(raw, list) else [raw]:
        p = pathlib.Path(item).expanduser()
        p = p if p.is_absolute() else root / p
        if p.is_dir():
            paths.update(str(f.resolve()) for f in p.rglob("*") if f.suffix.lower() in extensions)
        elif p.suffix.lower() == ".txt":
            for line in p.read_text().splitlines():
                if line.strip():
                    f = pathlib.Path(line.strip()).expanduser()
                    # Ultralytics image lists resolve ./ relative to the list file.
                    f = p.parent / str(f)[2:] if line.strip().startswith("./") else f
                    if not f.is_absolute():
                        f = pathlib.Path.cwd() / f
                    paths.add(str(f.resolve()))
        elif p.is_file():
            paths.add(str(p.resolve()))
        else:
            raise ValueError(f"Split path does not exist: {p}")
    return paths


def validate_manifest_rows(rows, names, allowed_splits=("train", "val", "test"), required_splits=()):
    """Common image, class, geometry and identity validation for all benchmarks."""
    from PIL import Image
    if not isinstance(rows, list):
        raise ValueError("Manifest must be a JSON list; see module docstring")
    ids, image_split = set(), {}
    for row in rows:
        identifier = str(row["id"])
        if identifier in ids:
            raise ValueError(f"Duplicate manifest id: {identifier}")
        ids.add(identifier)
        image = pathlib.Path(row["image"])
        if not image.is_absolute() or not image.is_file():
            raise ValueError(f"Image must be an existing absolute path: {image}")
        row["image"] = str(image.resolve())
        split = row["split"]
        if split not in allowed_splits:
            raise ValueError(f"Unexpected split: {split}")
        if row["image"] in image_split:
            raise ValueError(f"Repeated image path in manifest: {image}")
        image_split[row["image"]] = split
        with Image.open(image) as im:
            width, height = im.size
        for box in row["boxes"]:
            c, b = box["class_id"], box["bbox"]
            if isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(names):
                raise ValueError(f"Invalid class_id for {identifier}: {c}")
            if len(b) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in b):
                raise ValueError(f"Nonfinite/invalid bbox for {identifier}: {b}")
            if not (0 <= b[0] < b[2] <= width + 1e-3 and 0 <= b[1] < b[3] <= height + 1e-3):
                raise ValueError(f"Box outside actual {width}x{height} image for {identifier}: {b}")
    for split in required_splits:
        if not any(r['split'] == split for r in rows):
            raise ValueError(f'Manifest has no required {split!r} images')
    return rows


def load_manifest(path, names, config, yaml_path):
    rows = validate_manifest_rows(json.loads(path.read_text()), names, required_splits=("val", "test"))
    for split in ["val", "test"]:
        actual = {r["image"] for r in rows if r["split"] == split}
        expected = split_paths(config, yaml_path, split)
        if not actual or actual != expected:
            raise ValueError(f"YAML/manifest {split} mismatch: manifest={len(actual)}, yaml={len(expected)}, only_manifest={sorted(actual - expected)[:3]}, only_yaml={sorted(expected - actual)[:3]}")
    return rows


def native_metrics(metrics, names):
    box = metrics.box
    indices = [int(i) for i in getattr(box, "ap_class_index", range(len(names)))]
    per_class = []
    for c, name in enumerate(names):
        item = {"class_id": c, "name": name}
        position = indices.index(c) if c in indices else None
        for key, attr in [("precision", "p"), ("recall", "r"), ("f1", "f1"), ("ap50", "ap50"), ("ap50_95", "ap")]:
            values = getattr(box, attr, [])
            item[key] = safe_float(values[position]) if position is not None and position < len(values) else None
        per_class.append(item)
    return {
        "map50": safe_float(box.map50), "map50_95": safe_float(box.map),
        "map75": safe_float(box.map75), "per_class": per_class,
        "summary": {str(k): safe_float(v) for k, v in metrics.results_dict.items()},
        "speed_ms_per_image": {str(k): safe_float(v) for k, v in metrics.speed.items()},
        "note": "Native P/R/F1 use Ultralytics' own max-F1 operating point, not the frozen validation-selected threshold used in independent metrics.",
    }


def corrupt_image(image, variant, cv2, np):
    if variant.startswith("motion_blur_"):
        kernel_size = int(variant.rsplit("_", 1)[1])
        # Horizontal smear is deterministic and does not move GT boxes.
        kernel = np.zeros((kernel_size, kernel_size), dtype=np.float32)
        kernel[kernel_size // 2, :] = 1.0 / kernel_size
        return cv2.filter2D(image, -1, kernel, borderType=cv2.BORDER_REFLECT_101)
    if variant.startswith("brightness_"):
        factor = float(variant.rsplit("_", 1)[1])
        return np.clip(image.astype(np.float32) * factor, 0, 255).astype(np.uint8)
    if variant == "downscale_0.5":
        height, width = image.shape[:2]
        small = cv2.resize(image, (max(1, width // 2), max(1, height // 2)), interpolation=cv2.INTER_AREA)
        return cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)
    if variant != "clean":
        raise ValueError(variant)
    return image


def percentile(values, q):
    ordered = sorted(values)
    point = (len(ordered) - 1) * q
    lo, hi = math.floor(point), math.ceil(point)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (point - lo)


def predict_boxes(model, image, imgsz=640, device="0", class_mapping=None, *,
                  confidence=0.001, nms_iou=0.7, agnostic_nms=False):
    """Shared inference contract; optional explicit mapping to benchmark classes."""
    result = model.predict(source=image, imgsz=imgsz, device=device,
                           conf=confidence, iou=nms_iou, max_det=300, rect=False,
                           augment=False, agnostic_nms=agnostic_nms, quantize=None, verbose=False)[0]
    if result.boxes is None:
        return []
    predictions = []
    for row in result.boxes.data.detach().cpu().tolist():
        source_class = int(row[5])
        target_class = class_mapping[source_class] if class_mapping is not None else source_class
        box = {"bbox": [float(v) for v in row[:4]], "confidence": float(row[4]), "class_id": target_class}
        if not math.isfinite(box["confidence"]) or not all(math.isfinite(v) for v in box["bbox"]):
            raise ValueError("Model produced nonfinite confidence/coordinates")
        predictions.append(box)
    return predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", type=pathlib.Path, required=True)
    parser.add_argument("--data", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True, help="Output directory")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--healthy-class", type=int, default=0)
    parser.add_argument("--early-class", type=int, default=1)
    parser.add_argument("--precision-target", type=float, default=0.90)
    parser.add_argument("--examples", type=int, default=12)
    args = parser.parse_args()
    import cv2
    import numpy as np
    import torch
    import ultralytics
    import yaml
    from ultralytics import YOLO

    torch.set_num_threads(4)
    cv2.setNumThreads(2)

    if not args.weights.is_file():
        parser.error("--weights must be an existing local checkpoint")
    if not 0 < args.precision_target <= 1 or args.examples < 0:
        parser.error("precision target must be in (0,1] and examples nonnegative")
    config = yaml.safe_load(args.data.read_text())
    declared_names = config["names"]
    if isinstance(declared_names, dict):
        declared_names = {int(k): str(v) for k, v in declared_names.items()}
        if set(declared_names) != set(range(len(declared_names))):
            raise ValueError("YAML names must use contiguous zero-based class IDs")
        names = [declared_names[i] for i in range(len(declared_names))]
    else:
        names = [str(v) for v in declared_names]
    if not 0 <= args.healthy_class < len(names) or not 0 <= args.early_class < len(names) or args.healthy_class == args.early_class:
        parser.error("healthy/early classes must be distinct valid class IDs")
    rows = load_manifest(args.manifest, names, config, args.data.resolve())
    val_rows = [r for r in rows if r["split"] == "val"]
    test_rows = [r for r in rows if r["split"] == "test"]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(args.weights.resolve()))
    if len(model.names) != len(names):
        raise ValueError(f"Model has {len(model.names)} classes, YAML has {len(names)}")
    model_names = [str(model.names[i]) for i in range(len(names))]
    if model_names != names:
        raise ValueError(f"Model/YAML class names or order disagree: model={model_names}, YAML={names}")
    def inference_device():
        # AutoBackend may hold a CUDA model copy while YOLO.model stays on CPU.
        predictor = getattr(model, 'predictor', None)
        if predictor is not None and getattr(predictor, 'device', None) is not None:
            return torch.device(predictor.device)
        return next(model.model.parameters()).device

    def synchronize():
        device = inference_device()
        if device.type == "cuda":
            torch.cuda.synchronize(device)

    def predict(image):
        predictions = predict_boxes(model, image, args.imgsz, args.device)
        if any(not 0 <= p["class_id"] < len(names) for p in predictions):
            raise ValueError("Model produced invalid class")
        return predictions

    warmup = cv2.imread(val_rows[0]["image"])
    if warmup is None:
        raise ValueError("Could not decode warmup image")
    for _ in range(10):
        predict(warmup)
    synchronize()
    device = inference_device()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)

    def infer_rows(selected_rows, variant, threshold=None):
        predictions, durations = {}, []
        path = output / "predictions" / (variant + ".jsonl")
        path.parent.mkdir(parents=True, exist_ok=True)
        example_indices = set(np.linspace(0, len(selected_rows) - 1, min(args.examples, len(selected_rows)), dtype=int).tolist())
        with path.open("w") as f:
            for i, row in enumerate(selected_rows):
                synchronize()
                start = time.perf_counter()
                image = cv2.imread(row["image"])
                if image is None:
                    raise ValueError(f"Could not decode {row['image']}")
                image = corrupt_image(image, variant, cv2, np)
                values = predict(image)
                synchronize()
                duration = (time.perf_counter() - start) * 1000
                durations.append(duration)
                predictions[str(row["id"])] = values
                shown = values if threshold is None else [p for p in values if p["confidence"] >= threshold]
                f.write(json.dumps({"id": str(row["id"]), "image": row["image"], "split": row["split"],
                                    "variant": variant, "pipeline_ms": duration, "ground_truth": row["boxes"],
                                    "predictions": shown}, allow_nan=False) + "\n")
                if threshold is not None and i in example_indices:
                    overlay = image.copy()
                    for boxes, color, prefix in [(row["boxes"], (80, 210, 80), "GT"), (shown, (40, 160, 255), "P")]:
                        for box in boxes:
                            x1, y1, x2, y2 = [round(v) for v in box["bbox"]]
                            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)
                            label = prefix + " " + names[box["class_id"]]
                            if "confidence" in box:
                                label += f" {box['confidence']:.2f}"
                            cv2.putText(overlay, label, (max(0, x1), max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
                    example_path = output / "examples" / variant
                    example_path.mkdir(parents=True, exist_ok=True)
                    basename = hashlib.sha256(str(row["id"]).encode()).hexdigest()[:12] + ".jpg"
                    if not cv2.imwrite(str(example_path / basename), overlay):
                        raise OSError("Could not save example overlay")
                if (i + 1) % 50 == 0 or i + 1 == len(selected_rows):
                    print(json.dumps({"stage": variant, "completed_images": i + 1, "total_images": len(selected_rows)}), flush=True)
        return predictions, durations

    # Reuse clean transform under a distinct output name for val candidates.
    val_predictions, _ = infer_rows(val_rows, "clean")
    validation_candidate_file = output / "predictions" / "validation_candidates.jsonl"
    (output / "predictions" / "clean.jsonl").replace(validation_candidate_file)
    selection = choose_threshold(val_rows, val_predictions, names, args.healthy_class, args.early_class, args.precision_target)
    json_write(output / "threshold_selection.json", selection)
    threshold = selection["threshold"]
    json_write(output / "validation_operating_metrics.json", evaluate(val_rows, val_predictions, threshold, names, args.healthy_class, args.early_class))
    # Open the held-out test only after the operating threshold is frozen.
    native = model.val(data=str(args.data.resolve()), split="test", imgsz=args.imgsz,
                       device=args.device, batch=1, workers=0, conf=0.001, iou=0.7,
                       rect=False, augment=False, half=False, plots=True, save_json=False,
                       project=str(output), name="native_test", exist_ok=True, verbose=False)
    json_write(output / "ultralytics_metrics.json", native_metrics(native, names))
    variants = ["clean", "motion_blur_5", "motion_blur_11", "motion_blur_21", "brightness_0.6", "brightness_1.4", "downscale_0.5"]
    report = {
        "schema_version": 1, "manifest_schema": "list[{id,image:absolute,split,boxes:[{class_id,bbox:pixel_xyxy}]}]",
        "weights": str(args.weights.resolve()), "weights_sha256": hashlib.sha256(args.weights.read_bytes()).hexdigest(),
        "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(), "data_yaml": str(args.data.resolve()),
        "names": names, "imgsz": args.imgsz, "device": str(device), "inference_precision": "FP32",
        "torch_version": torch.__version__, "ultralytics_version": ultralytics.__version__,
        "gpu": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
        "native_test_metrics_file": "ultralytics_metrics.json", "threshold_selection": {k: v for k, v in selection.items() if k != "curve"},
        "limitations": [
            "Visible-symptom annotations do not establish laboratory diagnosis or absence of latent infection.",
            "Synthetic horizontal blur/brightness/downscale tests are not real drone/video validation.",
            "Independent fixed-threshold IoU0.5 metrics and native mAP measure different operating summaries.",
            "A detection does not establish safe autonomous removal, grasping, cut location, navigation or economic savings.",
        ],
        "variants": {},
    }
    for variant in variants:
        predictions, durations = infer_rows(test_rows, variant, threshold)
        metrics = evaluate(test_rows, predictions, threshold, names, args.healthy_class, args.early_class)
        if variant == "clean":
            report["batch1_latency"] = {
                "samples": len(durations), "warmup_iterations": 10,
                "p50_ms": statistics.median(durations), "p95_ms": percentile(durations, 0.95),
                "mean_ms": statistics.mean(durations), "min_ms": min(durations), "max_ms": max(durations),
                "includes": "disk image decode + Ultralytics preprocessing + batch1 inference + NMS + CPU box transfer + CUDA sync; no output writes/overlays",
                "excludes": "camera capture, network, planner and actuation", "cuda_synchronized": device.type == "cuda",
                "peak_allocated_gpu_bytes": torch.cuda.max_memory_allocated(device) if device.type == "cuda" else None,
            }
        else:
            clean = report["variants"]["clean"]["binary"]["symptomatic"]
            current = metrics["binary"]["symptomatic"]
            metrics["delta_vs_clean"] = {k: current[k] - clean[k] if current[k] is not None and clean[k] is not None else None for k in ["precision", "recall", "f1"]}
        report["variants"][variant] = metrics
        json_write(output / "evaluation.json", report)
    print(json.dumps({"evaluation": str(output / "evaluation.json"), "threshold": threshold,
                      "clean_symptomatic": report["variants"]["clean"]["binary"]["symptomatic"],
                      "batch1_latency": report["batch1_latency"]}, indent=2, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
