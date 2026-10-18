#!/usr/bin/env python3
"""Calibrate on validation; evaluate a frozen detector/ROI-classifier pipeline.

Detection manifest: list[{id,image:absolute,split,boxes:[{class_id,bbox:pixel_xyxy}]}].
Image benchmark: list[{id,image:absolute,split,label_class_id,label_source}].
Image labels must be explicit author/annotation labels, never inferred here from
filenames or folders. Classification photos do not supply detection ground truth.

Config declares canonical names, detector_class_mapping (model-name -> class ID),
healthy_class, target_classes, proposal_confidence, nms_iou, and selection policy.
Optional classifier metadata declares architecture, class_names, input_size,
preprocessing:{mode:pad_square,rgb_fill,mean,std}, and
roi:{padding_fraction,min_side_pixels,reference_image_max_side}.
Checkpoint: a plain tensor state_dict, or {state_dict: plain tensor state_dict}.

--fit-only writes selection.json using val only. Pass that file with
--selection-report for test/regression; every inference component is fingerprinted.
--reference-manifest is repeatable; held-out images matching any reference image
or an earlier held-out image are excluded conservatively before inference.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cacao-training"))
from evaluate_detector import (corrupt_image, counts_metrics, divide, evaluate,
                               json_write, match, percentile, predict_boxes,
                               validate_manifest_rows, wilson)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def roi_image(image, bbox, metadata):
    """Shared train/eval ROI geometry, RGB letterbox and minimum visible size.

    min_side_pixels is measured at reference_image_max_side; scaling makes the
    rule independent of the source image's pixel resolution. Padding is applied
    to each side of the unpadded bbox. Returned image has no model transforms.
    """
    from PIL import Image
    cfg, preprocessing = metadata["roi"], metadata["preprocessing"]
    if preprocessing["mode"] != "pad_square":
        raise ValueError("Only explicit pad_square ROI preprocessing is supported")
    size = metadata["input_size"]
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError("Classifier input_size must be a positive integer")
    if len(bbox) != 4 or not all(math.isfinite(v) for v in bbox):
        raise ValueError("Invalid classifier ROI coordinates")
    x1, y1, x2, y2 = bbox
    width, height = image.size
    visible_width = min(width, x2) - max(0, x1)
    visible_height = min(height, y2) - max(0, y1)
    reference = float(cfg["reference_image_max_side"])
    if reference <= 0 or float(cfg["min_side_pixels"]) < 0 or float(cfg["padding_fraction"]) < 0:
        raise ValueError("Invalid ROI padding/minimum/reference geometry")
    minimum = float(cfg["min_side_pixels"]) * max(width, height) / reference
    if visible_width <= 0 or visible_height <= 0 or min(visible_width, visible_height) < minimum:
        return None
    padding = float(cfg["padding_fraction"])
    dx, dy = (x2 - x1) * padding, (y2 - y1) * padding
    crop = image.convert("RGB").crop((max(0, math.floor(x1 - dx)), max(0, math.floor(y1 - dy)),
                                      min(width, math.ceil(x2 + dx)), min(height, math.ceil(y2 + dy))))
    scale = size / max(crop.size)
    resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.BILINEAR)
    fill = preprocessing["rgb_fill"]
    if len(fill) != 3 or any(not isinstance(v, int) or not 0 <= v <= 255 for v in fill):
        raise ValueError("Classifier rgb_fill must contain three byte values")
    canvas = Image.new("RGB", (size, size), tuple(fill))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def roi_array(image, bbox, metadata):
    """Shared NumPy CHW float32 preprocessing; no torch import or label prior."""
    import numpy as np
    prepared = roi_image(image, bbox, metadata)
    if prepared is None:
        return None
    mean = np.asarray(metadata["preprocessing"]["mean"], dtype=np.float32)
    std = np.asarray(metadata["preprocessing"]["std"], dtype=np.float32)
    if mean.shape != (3,) or std.shape != (3,) or not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std <= 0):
        raise ValueError("Classifier mean/std must have three finite channels and positive std")
    return ((np.asarray(prepared, dtype=np.float32) / 255 - mean) / std).transpose(2, 0, 1).copy()


def accumulate_source_annotation_recall(accumulator, boxes, matched_gt):
    """Attribute the existing target matches to provenance, once per GT/key."""
    missing = 0
    for gi, box in enumerate(boxes):
        annotations = {}
        for annotation in box.get("original_stages", []):
            key = (annotation["source"], annotation["class"])
            annotations.setdefault(key, set()).add(annotation["source_class_id"])
        missing += not annotations
        for (source, name), source_ids in annotations.items():
            entry = accumulator.setdefault((source, name), {"source": source, "class": name,
                                                            "source_class_ids": set(), "gt": 0, "tp": 0, "fn": 0})
            entry["source_class_ids"].update(source_ids)
            entry["gt"] += 1
            entry["tp" if gi in matched_gt else "fn"] += 1
    return missing


def target_metrics(rows, predictions, threshold, target_classes, task):
    targets = set(target_classes)
    if task == "image_binary":
        tp = fp = fn = tn = 0
        negative = {}
        records = []
        for row in rows:
            scores = [p["confidence"] for p in predictions[str(row["id"])] if p["class_id"] in targets]
            score = max(scores, default=0.0)
            actual, positive = row["label_class_id"] in targets, score >= threshold
            tp += actual and positive
            fp += not actual and positive
            fn += actual and not positive
            tn += not actual and not positive
            if not actual:
                entry = negative.setdefault(str(row["label_class_id"]), {"images": 0, "false_alarms": 0})
                entry["images"] += 1
                entry["false_alarms"] += positive
            records.append({"id": str(row["id"]), "label_class_id": row["label_class_id"],
                            "score": score, "alert": positive})
        return {"unit": "image", **counts_metrics(tp, fp, fn), "tn": tn,
                "accuracy": divide(tp + tn, len(rows)), "specificity": divide(tn, tn + fp),
                "false_alarm_rate": divide(fp, tn + fp), "negative_classes": negative,
                "alerts": tp + fp, "images": len(rows), "per_image": records,
                "note": "Image alert=max score of any target proposal. Image labels cannot verify that its box covers the affected pod; no box/localization AP is computed."}
    tp = fp = fn = 0
    negative, records, source_recall = {}, [], {}
    source_annotation_missing_gt = 0
    for row in rows:
        gt = [b for b in row["boxes"] if b["class_id"] in targets]
        pred = [p for p in predictions[str(row["id"])] if p["class_id"] in targets and p["confidence"] >= threshold]
        matched = match(pred, gt)
        source_annotation_missing_gt += accumulate_source_annotation_recall(source_recall, gt, {gi for _, gi, _ in matched})
        tp += len(matched)
        fp += len(pred) - len(matched)
        fn += len(gt) - len(matched)
        for box in row["boxes"]:
            if box["class_id"] not in targets:
                negative.setdefault(str(box["class_id"]), {"gt_pods": 0, "pods_with_matched_target_alert": 0})["gt_pods"] += 1
        for _, gi, _ in match(pred, row["boxes"]):
            c = row["boxes"][gi]["class_id"]
            if c not in targets:
                negative[str(c)]["pods_with_matched_target_alert"] += 1
        records.append({"id": str(row["id"]), "tp": len(matched), "fp": len(pred) - len(matched), "fn": len(gt) - len(matched)})
    return {"unit": "annotated_object", **counts_metrics(tp, fp, fn), "alerts": tp + fp,
            "images": len(rows), "matching_iou": 0.5, "negative_classes": negative, "per_image": records,
            "recall_by_source_annotation": [{**entry, "source_class_ids": sorted(entry["source_class_ids"]),
                                               "recall": divide(entry["tp"], entry["gt"])}
                                              for _, entry in sorted(source_recall.items())],
            "target_gt_without_source_annotation": source_annotation_missing_gt,
            "source_annotation_recall_note": "A merged GT may have multiple provenance strata; it counts once per (source,class). Provenance never changes matching or threshold selection.",
            "note": "Negative-class action counts are conservative one-to-one matches, not executed removals. Other-disease alerts are FP for the specific target."}


def select_operating_point(rows, predictions, config, task):
    policy = config["selection"]
    curve = []
    for threshold in [0.001] + [n / 100 for n in range(1, 100)]:
        metrics = target_metrics(rows, predictions, threshold, config["target_classes"], task)
        curve.append({"threshold": threshold, **{k: v for k, v in metrics.items() if k not in {"per_image", "negative_classes", "note"}}})
    minimum_recall, minimum_alerts = policy["min_recall"], policy["min_alerts"]
    nonvacuous = [r for r in curve if r["tp"] > 0 and (r["recall"] or 0) >= minimum_recall and r["alerts"] >= minimum_alerts]
    feasible = [r for r in nonvacuous if (r["precision"] or 0) >= policy["precision_target"]]
    if feasible:
        chosen = max(feasible, key=lambda r: (r["f1"] or 0, r["precision"] or 0, r["recall"] or 0, r["threshold"]))
        status = "target_met_on_validation"
    elif nonvacuous:
        chosen = max(nonvacuous, key=lambda r: (r["precision"] or 0, r["f1"] or 0, r["recall"] or 0, r["threshold"]))
        status = "precision_target_unmet_fallback_max_precision_at_minimum_recall_and_alerts"
    else:
        chosen = max(curve, key=lambda r: (r["f1"] or 0, r["precision"] or 0, r["recall"] or 0, r["threshold"]))
        status = "constraints_unmet_exploratory_f1_fallback"
    return {"split": "val", "task": task, "threshold": chosen["threshold"], "status": status,
            "target_met": bool(feasible), "policy": policy, "validation_metrics": chosen, "curve": curve,
            "note": "95% empirical validation precision is not a guarantee of deployment precision. No thresholds are fitted on test/regression."}


def load_rows(path, task):
    rows = json.loads(Path(path).read_text())
    if task == "image_binary":
        for row in rows:
            if "label_class_id" not in row or not isinstance(row.get("label_source"), str) or not row["label_source"].strip():
                raise ValueError("Image benchmark requires explicit label_class_id and nonempty label_source")
            row.setdefault("boxes", [])
    return rows


def duplicate_audit(rows, reference_paths, distance):
    """Global transitive similarity families, independent of model predictions.

    A held-out family touching any reference is excluded in full. Test-only
    families retain their first non-conflicting row in the declared input order.
    """
    from collections import defaultdict
    from PIL import Image, ImageOps
    from prepare_dataset import UnionFind, phash
    if isinstance(distance, bool) or not isinstance(distance, int) or not 0 <= distance <= 64:
        raise ValueError("Perceptual hash distance must be an integer from 0 to 64")
    cache, references = {}, []
    def identity(path):
        path = str(Path(path).resolve())
        if path not in cache:
            with Image.open(path) as raw:
                im = ImageOps.exif_transpose(raw).convert("RGB")
                exact = hashlib.sha256(im.width.to_bytes(4, "big") + im.height.to_bytes(4, "big") + im.tobytes()).hexdigest()
                cache[path] = (exact, phash(im))
        return cache[path]
    for manifest in reference_paths:
        for row in json.loads(Path(manifest).read_text()):
            exact, perceptual = identity(row["image"])
            references.append((str(row["id"]), exact, perceptual))
    identities = {str(row["id"]): identity(row["image"]) for row in rows}
    labels = {}
    for row in rows:
        if "label_class_id" in row:
            labels.setdefault(identities[str(row["id"])][0], set()).add(row["label_class_id"])
    # References participate in the same graph as held-out rows, including
    # reference-reference and late test-test bridges. A greedy seen-only check
    # could retain A when A~B~reference but A is not directly near the reference.
    nodes = references + [(str(row["id"]), *identities[str(row["id"])]) for row in rows]
    uf = UnionFind(len(nodes))
    for i, (_, exact, perceptual) in enumerate(nodes):
        for j in range(i):
            _, other_exact, other_hash = nodes[j]
            if exact == other_exact or (perceptual ^ other_hash).bit_count() <= distance:
                uf.union(i, j)
    component_references = defaultdict(list)
    for i, reference in enumerate(references):
        component_references[uf.find(i)].append(reference)
    component_nodes = defaultdict(list)
    for i, (identifier, exact, _) in enumerate(nodes):
        component_nodes[uf.find(i)].append(["reference" if i < len(references) else "benchmark", identifier, exact])
    component_ids = {root: digest(members)[:24] for root, members in component_nodes.items()}
    eligible, excluded, representatives = [], [], {}
    for index, row in enumerate(rows):
        exact, perceptual = identities[str(row["id"])]
        root = uf.find(len(references) + index)
        component_id = component_ids[root]
        if len(labels.get(exact, set())) > 1:
            excluded.append({"id": str(row["id"]), "reason": "conflicting_explicit_labels_for_identical_pixels",
                             "component_id": component_id})
            continue
        linked_references = component_references.get(root, [])
        representative = representatives.get(root)
        if linked_references or representative is not None:
            matches = [(rid, (perceptual ^ h).bit_count(), exact == e)
                       for rid, e, h in linked_references if exact == e or (perceptual ^ h).bit_count() <= distance]
            duplicates = [] if representative is None else [
                (representative[0], (perceptual ^ representative[2]).bit_count(), exact == representative[1])]
            excluded.append({"id": str(row["id"]),
                             "reason": "reference_overlap" if linked_references else "within_benchmark_duplicate",
                             "component_id": component_id, "match_scope": "transitive_similarity_component",
                             "component_reference_ids": [r[0] for r in linked_references[:20]],
                             "component_reference_count": len(linked_references),
                             "reference_matches": matches[:20], "benchmark_matches": duplicates})
        else:
            eligible.append(row)
            representatives[root] = (str(row["id"]), exact, perceptual)
    return eligible, {"input_images": len(rows), "eligible_images": len(eligible), "reference_rows": len(references),
                      "reference_manifests": [{"path": str(Path(p).resolve()), "sha256": sha(p)} for p in reference_paths],
                      "phash_distance": distance, "excluded": excluded,
                      "grouping": "Global connected components of reference and benchmark RGB/hash identities; test-only representative is first non-conflicting input row.",
                      "similarity_components": len(component_nodes),
                      "eligible_ids_sha256": digest([str(row["id"]) for row in eligible]),
                      "eligible_pixels_sha256": digest([[str(row["id"]), identities[str(row["id"])][0]] for row in eligible]),
                      "limitation": "Perceptual hashes are conservative proxies, not proof of different farms/trees or all possible source overlap."}


class ROIClassifier:
    def __init__(self, weights, metadata, names, device, class_mapping=None):
        import torch
        from torchvision import models
        self.torch, self.metadata, self.device = torch, metadata, device
        class_names = metadata["class_names"]
        if len(set(class_names)) != len(class_names):
            raise ValueError("Classifier class_names must be unique")
        if class_mapping is None:
            if set(class_names) != set(names):
                raise ValueError("Classifier class names need an explicit canonical class mapping")
            class_mapping = {name: names.index(name) for name in class_names}
        self.mapping = {i: class_mapping[name] for i, name in enumerate(class_names)}
        if any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(names) for c in self.mapping.values()):
            raise ValueError("Invalid classifier class mapping")
        self.model = models.get_model(metadata["architecture"], weights=None, num_classes=len(class_names))
        checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
        state = checkpoint.get("state_dict", checkpoint) if isinstance(checkpoint, dict) else checkpoint
        if not isinstance(state, dict) or not all(isinstance(k, str) and torch.is_tensor(v) for k, v in state.items()):
            raise ValueError("Classifier checkpoint must contain a plain tensor state_dict")
        self.model.load_state_dict(state, strict=True)
        self.model = self.model.to(device).float().eval()

    def classify(self, image, proposals):
        arrays, retained = [], []
        for proposal in proposals:
            array = roi_array(image, proposal["bbox"], self.metadata)
            if array is not None:
                arrays.append(array)
                retained.append(proposal)
        if not arrays:
            return [], {"proposals": len(proposals), "classified": 0, "discarded_small_rois": len(proposals)}
        import numpy as np
        outputs = []
        with self.torch.inference_mode():
            for start in range(0, len(arrays), 32):
                tensor = self.torch.from_numpy(np.stack(arrays[start:start + 32])).to(self.device)
                probabilities = self.model(tensor).softmax(1).cpu().tolist()
                for proposal, probabilities in zip(retained[start:start + 32], probabilities):
                    canonical = {}
                    for index, value in enumerate(probabilities):
                        canonical[self.mapping[index]] = canonical.get(self.mapping[index], 0.0) + value
                    c = max(canonical, key=canonical.get)
                    outputs.append({"bbox": proposal["bbox"], "class_id": c,
                                    "confidence": proposal["confidence"] * canonical[c],
                                    "proposal_confidence": proposal["confidence"],
                                    "proposal_class_id": proposal["class_id"],
                                    "classifier_probability": canonical[c], "classifier_probabilities": canonical})
        return outputs, {"proposals": len(proposals), "classified": len(outputs), "discarded_small_rois": len(proposals) - len(outputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="0")
    parser.add_argument("--classifier-weights", type=Path)
    parser.add_argument("--classifier-metadata", type=Path)
    parser.add_argument("--selection-report", type=Path)
    parser.add_argument("--reference-manifest", type=Path, action="append", default=[])
    parser.add_argument("--fit-only", action="store_true")
    parser.add_argument("--task", choices=["detection", "image_binary"], default="detection")
    parser.add_argument("--split", default="test")
    parser.add_argument("--variants", default="clean", help="Comma-separated clean/motion_blur_5/11/21/brightness_0.6/1.4/downscale_0.5")
    args = parser.parse_args()
    if bool(args.classifier_weights) != bool(args.classifier_metadata):
        parser.error("classifier weights and metadata must be supplied together")
    if args.fit_only and args.selection_report:
        parser.error("fit-only and selection-report are mutually exclusive")
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from ultralytics import YOLO
    torch.set_num_threads(4)
    cv2.setNumThreads(2)
    config = json.loads(args.config.read_text())
    names = config["names"]
    if len(set(names)) != len(names) or not names:
        raise ValueError("Canonical names must be nonempty and unique")
    targets, policy = config["target_classes"], config["selection"]
    if not targets or any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(names) for c in targets):
        raise ValueError("Invalid target class IDs")
    if config["healthy_class"] in targets:
        raise ValueError("Healthy class cannot be a removal target")
    if not 0 < policy["precision_target"] <= 1 or not 0 < policy["min_recall"] <= 1 or policy["min_alerts"] < 1:
        raise ValueError("Invalid nonvacuous selection policy")
    if not 0 < config["proposal_confidence"] < 1 or not 0 < config["nms_iou"] < 1:
        raise ValueError("Invalid proposal/NMS thresholds")
    rows = load_rows(args.manifest, args.task)
    validate_manifest_rows(rows, names, allowed_splits=("train", "val", "test", "regression"))
    if args.task == "image_binary":
        for row in rows:
            c = row["label_class_id"]
            if isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(names):
                raise ValueError("Unmapped explicit image label")
    metadata = json.loads(args.classifier_metadata.read_text()) if args.classifier_metadata else None
    fingerprint = {"weights_sha256": sha(args.weights), "config_sha256": sha(args.config),
                   "classifier_weights_sha256": sha(args.classifier_weights) if args.classifier_weights else None,
                   "classifier_metadata_sha256": sha(args.classifier_metadata) if args.classifier_metadata else None}
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output must be new/empty; refusing stale or overwritten evaluation")
    output.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(args.weights.resolve()))
    declared_map = config["detector_class_mapping"]
    mapping = {int(c): declared_map[name] for c, name in model.names.items()}
    if any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(names) for c in mapping.values()):
        raise ValueError("Invalid detector class mapping")
    classifier_device = torch.device("cuda:" + args.device if args.device.isdigit() else args.device)
    classifier = ROIClassifier(args.classifier_weights, metadata, names, classifier_device,
                               config.get("classifier_class_mapping")) if metadata else None

    def inference_device():
        predictor = getattr(model, "predictor", None)
        return torch.device(predictor.device) if predictor is not None else next(model.model.parameters()).device

    def synchronize():
        device = inference_device()
        if device.type == "cuda":
            torch.cuda.synchronize(device)

    def predict(image):
        proposals = predict_boxes(model, image, config.get("imgsz", 640), args.device, mapping,
                                  confidence=config["proposal_confidence"], nms_iou=config["nms_iou"], agnostic_nms=True)
        if classifier:
            return classifier.classify(Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)), proposals)
        return proposals, {"proposals": len(proposals), "classified": None, "discarded_small_rois": 0}

    def infer(selected_rows, variant, label):
        results, durations = {}, []
        stats = {"proposals": 0, "classified": 0, "discarded_small_rois": 0}
        destination = output / "predictions" / (label + "_" + variant + ".jsonl")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w") as handle:
            for i, row in enumerate(selected_rows):
                synchronize()
                start = time.perf_counter()
                image = cv2.imread(row["image"])
                if image is None:
                    raise ValueError("Cannot decode " + row["image"])
                predictions, counts = predict(corrupt_image(image, variant, cv2, np))
                synchronize()
                elapsed = (time.perf_counter() - start) * 1000
                for key in stats:
                    stats[key] += counts[key] or 0
                results[str(row["id"])] = predictions
                durations.append(elapsed)
                handle.write(json.dumps({"id": str(row["id"]), "image": row["image"], "variant": variant,
                                         "predictions": predictions, "pipeline_ms": elapsed}, allow_nan=False) + "\n")
                if (i + 1) % 100 == 0 or i + 1 == len(selected_rows):
                    print(json.dumps({"stage": label, "variant": variant, "completed": i + 1, "total": len(selected_rows)}), flush=True)
        return results, {"samples": len(durations), "p50_ms": statistics.median(durations),
                         "p95_ms": percentile(durations, 0.95), "mean_ms": statistics.mean(durations),
                         "cuda_synchronized": inference_device().type == "cuda", "proposal_stats": stats,
                         "includes": "disk decode, synthetic corruption if any, YOLO preprocessing/NMS, optional all-ROI classification, CPU output transfer and CUDA sync",
                         "excludes": "capture, networking, robot planning/actuation, output file writes"}

    warmup_row = next((r for r in rows if r["split"] == ("val" if not args.selection_report else args.split)), None)
    if warmup_row is None:
        raise ValueError("No images for the requested selection/evaluation split")
    warmup = cv2.imread(warmup_row["image"])
    if warmup is None:
        raise ValueError("Cannot decode warmup image")
    for _ in range(10):
        predict(warmup)
    synchronize()
    if args.selection_report:
        selection = json.loads(args.selection_report.read_text())
        if selection["inference_fingerprint"] != fingerprint:
            raise ValueError("Frozen threshold belongs to different weights/config/classifier preprocessing")
    else:
        validation = [r for r in rows if r["split"] == "val"]
        if not validation:
            raise ValueError("Threshold selection requires validation images")
        predictions, timing = infer(validation, "clean", "validation")
        selection = select_operating_point(validation, predictions, config, args.task)
        selection.update(inference_fingerprint=fingerprint, validation_manifest_sha256=sha(args.manifest),
                         validation_ids_sha256=digest([str(r["id"]) for r in validation]), latency=timing)
    json_write(output / "selection.json", selection)
    if args.fit_only:
        print(json.dumps({"selection": str(output / "selection.json"), "status": selection["status"], "validation_metrics": selection["validation_metrics"]}, indent=2), flush=True)
        return
    selected_rows = [r for r in rows if r["split"] == args.split]
    if not selected_rows:
        raise ValueError("No images in requested split")
    selected_rows, audit = duplicate_audit(selected_rows, args.reference_manifest, config.get("duplicate_phash_distance", 4))
    if not selected_rows:
        raise ValueError("All benchmark images were excluded by the independence audit")
    threshold = selection["threshold"]
    report = {"inference_fingerprint": fingerprint, "config": config, "classifier_metadata": metadata,
              "manifest_sha256": sha(args.manifest), "task": args.task, "split": args.split,
              "selection_report_sha256": sha(args.selection_report) if args.selection_report else None,
              "selection": {k: v for k, v in selection.items() if k != "curve"}, "duplicate_audit": audit,
              "eligible_benchmark_sha256": digest([{k: row[k] for k in ["id", "label_class_id", "boxes"] if k in row} for row in selected_rows]),
              "device": str(inference_device()), "inference_precision": "FP32", "warmup_iterations": 10,
              "limitations": ["No test-time architecture, checkpoint or threshold fitting.",
                              "Image-level annotations never establish detection/localization mAP.",
                              "Blur/brightness/downscale are synthetic stress tests, not flight/video evidence.",
                              "Other diseases are negatives for the specific target; this is not a universal diagnostic system.",
                              "False-action matches describe risk, not executed removals or proven economic savings."], "variants": {}}
    for variant in args.variants.split(","):
        predictions, timing = infer(selected_rows, variant, args.split)
        metrics = target_metrics(selected_rows, predictions, threshold, targets, args.task)
        entry = {"target_metrics": metrics, "latency": timing}
        if args.task == "detection":
            full = evaluate(selected_rows, predictions, threshold, names, config["healthy_class"], targets[0])
            full.pop("early_symptom", None)
            entry["all_classes_at_fixed_threshold"] = full
        if variant != "clean" and "clean" in report["variants"]:
            clean = report["variants"]["clean"]["target_metrics"]
            entry["delta_vs_clean"] = {key: metrics[key] - clean[key] if metrics[key] is not None and clean[key] is not None else None for key in ["precision", "recall", "f1"]}
        report["variants"][variant] = entry
        json_write(output / "evaluation.json", report)
    print(json.dumps({"report": str(output / "evaluation.json"), "selection_status": selection["status"],
                      "eligible_images": len(selected_rows), "results": {v: {k: x["target_metrics"][k] for k in ["precision", "recall", "f1", "fp", "fn"]} for v, x in report["variants"].items()}}, indent=2), flush=True)


if __name__ == "__main__":
    main()
