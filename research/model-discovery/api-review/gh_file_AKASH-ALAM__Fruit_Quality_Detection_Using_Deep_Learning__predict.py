"""
predict.py - YOLOv8 Prediction Script for IoT Fruit Quality Detection
======================================================================
Loads the trained YOLOv8 model and runs object detection on a given
image.  Prints every detected fruit, its class, confidence, bounding
box, and an overall quality verdict.

Usage:
    python predict.py <image_path>              # single image
    python predict.py <image_path> --save       # save annotated result
"""

import os
import sys
import argparse
from ultralytics import YOLO

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(PROJECT_ROOT, "model", "fruit_quality", "weights", "best.onnx")
IMG_SIZE = 320  # must match training resolution
CONF_THRESHOLD = 0.25  # minimum confidence to display


def predict_image(image_path, save=False, show=False):
    """Run YOLOv8 inference on a single image and print results."""

    # ── Validate inputs ──────────────────────────
    if not os.path.exists(image_path):
        print(f"Error: Image file not found at {image_path}")
        sys.exit(1)

    if not os.path.exists(MODEL_PATH):
        print(f"Error: Model not found at {MODEL_PATH}.\n"
              f"       Make sure training is complete (run train_yolo.py first).")
        sys.exit(1)

    # ── Load model ───────────────────────────────
    print(f"[INFO] Loading model from {MODEL_PATH}...")
    model = YOLO(MODEL_PATH, task="detect")

    # ── Run inference ────────────────────────────
    print(f"[INFO] Processing image: {image_path}")
    results = model.predict(
        source=image_path,
        imgsz=IMG_SIZE,
        conf=CONF_THRESHOLD,
        save=save,          # save annotated image to runs/detect/
        show=show,          # pop up a window with results
        verbose=False,
    )

    # ── Parse detections ─────────────────────────
    result = results[0]  # single image → first result
    boxes = result.boxes

    if len(boxes) == 0:
        print("\n" + "=" * 55)
        print("  PREDICTION RESULT")
        print("=" * 55)
        print("  No fruits detected in the image.")
        print("  Try a different image or lower the confidence threshold.")
        print("=" * 55)
        return

    # Collect all detections
    detections = []
    for box in boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        label = result.names[cls_id]
        xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]
        detections.append({
            "label": label,
            "confidence": conf,
            "bbox": xyxy,
        })

    # Sort by confidence (highest first)
    detections.sort(key=lambda d: d["confidence"], reverse=True)

    # ── Display results ──────────────────────────
    print("\n" + "=" * 55)
    print("  PREDICTION RESULTS")
    print("=" * 55)
    print(f"  Detected {len(detections)} object(s):\n")

    for i, det in enumerate(detections, 1):
        label = det["label"]
        conf = det["confidence"] * 100
        x1, y1, x2, y2 = det["bbox"]

        # Determine quality based on class name prefix
        if label.startswith("Good"):
            quality = "✅ FRESH – good to eat / process"
        elif label.startswith("Rotten"):
            quality = "❌ SPOILED – remove from batch"
        else:
            quality = "❓ Unknown quality"

        print(f"  [{i}] {label}")
        print(f"      Confidence : {conf:.1f}%")
        print(f"      Quality    : {quality}")
        print(f"      BBox       : ({x1:.0f}, {y1:.0f}) → ({x2:.0f}, {y2:.0f})")
        print()

    # ── Overall verdict ──────────────────────────
    bad_count = sum(1 for d in detections if d["label"].startswith("Rotten"))
    good_count = sum(1 for d in detections if d["label"].startswith("Good"))

    print("-" * 55)
    print(f"  Summary: {good_count} fresh, {bad_count} spoiled")
    if bad_count > 0:
        print("  ⚠  ALERT: Spoiled fruit detected in this image!")
    else:
        print("  ✓  All detected fruits appear fresh.")
    print("=" * 55)

    if save:
        save_dir = result.save_dir
        print(f"\n[INFO] Annotated image saved to: {save_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test the YOLOv8 Fruit Quality Detection Model"
    )
    parser.add_argument("image_path", help="Path to the image to test")
    parser.add_argument("--save", action="store_true",
                        help="Save annotated result image")
    parser.add_argument("--show", action="store_true",
                        help="Display result in a pop-up window")
    parser.add_argument("--conf", type=float, default=CONF_THRESHOLD,
                        help=f"Confidence threshold (default: {CONF_THRESHOLD})")
    args = parser.parse_args()

    CONF_THRESHOLD = args.conf
    predict_image(args.image_path, save=args.save, show=args.show)
