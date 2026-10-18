"""
train_yolo.py - YOLOv8 Training Script for IoT Fruit Quality Detection
========================================================================
Trains a YOLOv8 model on the fruit quality dataset with hardware simulation
augmentations to mimic the OV2640 camera sensor (grain, color shift, lighting).

After training completes, this script:
  1. Copies results.png → train_history.png (training curves)
  2. Copies confusion_matrix.png → confusing_matrix.png
  3. Runs validation and writes classification.txt with key metrics
"""

import os
import shutil
import torch
from ultralytics import YOLO

# ──────────────────────────────────────────────
# Intel Arc XPU – Monkey-patch Ultralytics
# ──────────────────────────────────────────────
# Ultralytics' internals only recognise CUDA/CPU/MPS/NPU.
# We patch select_device, memory helpers, and GradScaler
# so that the Intel Arc A750 (XPU) works seamlessly.
import gc
import ultralytics.utils.torch_utils as _tu
import ultralytics.engine.trainer as _trainer
import ultralytics.engine.validator as _validator

# 1) select_device – let "xpu" pass through
_orig_select_device = _tu.select_device

def _patched_select_device(device="", newline=False, verbose=True):
    """Wrap select_device to accept 'xpu' for Intel Arc GPUs."""
    if str(device).lower().strip() == "xpu" and torch.xpu.is_available():
        from ultralytics import __version__
        from ultralytics.utils import PYTHON_VERSION, TORCH_VERSION, LOGGER
        s = (f"Ultralytics {__version__} 🚀 Python-{PYTHON_VERSION} "
             f"torch-{TORCH_VERSION} XPU ({torch.xpu.get_device_name(0)})")
        if verbose:
            LOGGER.info(s)
        return torch.device("xpu")
    return _orig_select_device(device, newline, verbose)

_tu.select_device = _patched_select_device
_trainer.select_device = _patched_select_device
_validator.select_device = _patched_select_device

# 2) _get_memory – route XPU through torch.xpu instead of torch.cuda
def _xpu_get_memory(self, fraction=False):
    """Get XPU memory utilisation in GB or as a fraction."""
    if self.device.type == "xpu":
        mem = torch.xpu.memory_reserved(self.device)
        if fraction:
            props = torch.xpu.get_device_properties(self.device)
            total = props.total_memory
            return (mem / total) if total > 0 else 0
        return mem / 2**30
    return self.__class__._orig_get_memory(self, fraction)

# 3) _clear_memory – call torch.xpu.empty_cache() for XPU
def _xpu_clear_memory(self, threshold=None):
    """Clear XPU memory if utilisation exceeds threshold."""
    if threshold:
        assert 0 <= threshold <= 1
        if self._get_memory(fraction=True) <= threshold:
            return
    gc.collect()
    if self.device.type == "xpu":
        torch.xpu.empty_cache()
    elif self.device.type == "mps":
        torch.mps.empty_cache()
    elif self.device.type != "cpu":
        torch.cuda.empty_cache()

# Save originals then override on the BaseTrainer class
_BaseTrainer = _trainer.BaseTrainer
_BaseTrainer._orig_get_memory = _BaseTrainer._get_memory
_BaseTrainer._get_memory = _xpu_get_memory
_BaseTrainer._clear_memory = _xpu_clear_memory

# 4) GradScaler – use "xpu" device string when on XPU
_orig_setup_train = _BaseTrainer._setup_train

def _patched_setup_train(self):
    """Patch _setup_train to create GradScaler on the correct device."""
    _orig_setup_train(self)
    # After original setup, fix the scaler if we're on XPU
    if self.device.type == "xpu":
        self.scaler = torch.amp.GradScaler("xpu", enabled=self.amp)

_BaseTrainer._setup_train = _patched_setup_train

# ──────────────────────────────────────────────
# Main entry point (required on Windows for
# multiprocessing dataloader workers)
# ──────────────────────────────────────────────
if __name__ == '__main__':

    # ──────────────────────────────────────────────
    # Configuration
    # ──────────────────────────────────────────────
    PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
    DATASET_YAML = os.path.join(PROJECT_ROOT, "Dataset", "data.yaml")
    MODEL_OUTPUT_DIR = os.path.join(PROJECT_ROOT, "model")

    # Training hyper-parameters
    EPOCHS = 50
    IMG_SIZE = 320
    BATCH_SIZE = 64
    BASE_MODEL = "yolov8n.pt"  # Nano variant – ideal for IoT/edge deployment

    # ── Device selection (Intel Arc XPU > CUDA > CPU) ──
    if torch.xpu.is_available():
        DEVICE = "xpu"
        print(f"[GPU] Intel XPU detected: {torch.xpu.get_device_name(0)}")
    elif torch.cuda.is_available():
        DEVICE = 0
        print(f"[GPU] CUDA detected: {torch.cuda.get_device_name(0)}")
    else:
        DEVICE = "cpu"
        print("[CPU] No GPU found – training on CPU (will be slow)")

    # YOLO project / name determine where Ultralytics saves results
    TRAIN_PROJECT = MODEL_OUTPUT_DIR
    TRAIN_NAME = "fruit_quality"

    # ──────────────────────────────────────────────
    # 1. Train the model
    # ──────────────────────────────────────────────
    print("=" * 60)
    print("  YOLOv8 Training – IoT Fruit Quality Detection")
    print("=" * 60)

    model = YOLO(BASE_MODEL)

    results = model.train(
        data=DATASET_YAML,
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH_SIZE,
        project=TRAIN_PROJECT,
        name=TRAIN_NAME,
        exist_ok=True,
        device=DEVICE,
        amp=False,    # Disable AMP – Ultralytics' AMP check is CUDA-centric
        workers=4,    # Windows doesn't support forked dataloader workers
        deterministic=False,

        # ── OV2640 Hardware Simulation Augmentations ──
        # Exaggerate saturation & brightness jitter to mimic the
        # sensor's poor white-balance and auto-exposure behaviour.
        hsv_s=0.9,   # Heavy saturation jitter
        hsv_v=0.6,   # Brightness / exposure jitter
        mosaic=0.5,  # Moderate mosaic – keeps context realistic

        # General robustness augmentations
        flipud=0.1,
        fliplr=0.5,
        degrees=15.0,
    )

    # The actual training output directory used by Ultralytics
    TRAIN_OUTPUT_DIR = os.path.join(TRAIN_PROJECT, TRAIN_NAME)

    print("\n" + "=" * 60)
    print("  Training complete – extracting evaluation files …")
    print("=" * 60)

    # ──────────────────────────────────────────────
    # 2. Extract training history graph
    # ──────────────────────────────────────────────
    try:
        results_png = os.path.join(TRAIN_OUTPUT_DIR, "results.png")
        if os.path.exists(results_png):
            dest = os.path.join(PROJECT_ROOT, "train_history.png")
            shutil.copy2(results_png, dest)
            print(f"[✓] Training history  → {dest}")
        else:
            print("[!] results.png not found in training output – skipping train_history.png")
    except Exception as e:
        print(f"[!] Could not copy training history: {e}")

    # ──────────────────────────────────────────────
    # 3. Extract confusion matrix
    # ──────────────────────────────────────────────
    try:
        # Ultralytics may output either the normalized or plain version
        cm_normalized = os.path.join(TRAIN_OUTPUT_DIR, "confusion_matrix_normalized.png")
        cm_plain = os.path.join(TRAIN_OUTPUT_DIR, "confusion_matrix.png")

        if os.path.exists(cm_normalized):
            src = cm_normalized
        elif os.path.exists(cm_plain):
            src = cm_plain
        else:
            src = None

        if src:
            dest = os.path.join(PROJECT_ROOT, "confusing_matrix.png")
            shutil.copy2(src, dest)
            print(f"[✓] Confusion matrix  → {dest}")
        else:
            print("[!] No confusion matrix file found in training output – skipping")
    except Exception as e:
        print(f"[!] Could not copy confusion matrix: {e}")

    # ──────────────────────────────────────────────
    # 4. Run validation & generate classification.txt
    # ──────────────────────────────────────────────
    try:
        print("\n[INFO] Running validation to collect final metrics …")
        metrics = model.val()

        precision = metrics.box.mp       # Mean Precision across classes
        recall    = metrics.box.mr       # Mean Recall across classes
        map50     = metrics.box.map50    # mAP @ IoU 0.50
        map50_95  = metrics.box.map      # mAP @ IoU 0.50:0.95

        report_path = os.path.join(PROJECT_ROOT, "classification.txt")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("=" * 55 + "\n")
            f.write("  Fruit Quality Detection – YOLOv8 Evaluation Report\n")
            f.write("=" * 55 + "\n\n")

            f.write(f"  Precision      : {precision:.4f}\n")
            f.write(f"  Recall         : {recall:.4f}\n")
            f.write(f"  mAP@50         : {map50:.4f}\n")
            f.write(f"  mAP@50-95      : {map50_95:.4f}\n")
            f.write("\n" + "-" * 55 + "\n")
            f.write("  Metric Interpretation\n")
            f.write("-" * 55 + "\n\n")
            f.write("  • Precision  – Of all detections the model made,\n")
            f.write("                 how many were actually correct.\n")
            f.write("                 Higher = fewer false positives.\n\n")
            f.write("  • Recall     – Of all real objects in the images,\n")
            f.write("                 how many did the model find.\n")
            f.write("                 Higher = fewer missed detections.\n\n")
            f.write("  • mAP@50     – Mean Average Precision at 50% IoU\n")
            f.write("                 threshold. A good general measure\n")
            f.write("                 of detection accuracy.\n\n")
            f.write("  • mAP@50-95  – Mean AP averaged across IoU from\n")
            f.write("                 0.50 to 0.95 (stricter). Reflects\n")
            f.write("                 how well bounding boxes align with\n")
            f.write("                 ground truth.\n\n")
            f.write("=" * 55 + "\n")
            f.write("  Model   : YOLOv8n (Nano) @ 320×320\n")
            f.write(f"  Epochs  : {EPOCHS}\n")
            f.write(f"  Dataset : {DATASET_YAML}\n")
            f.write("=" * 55 + "\n")

        print(f"[✓] Classification report → {report_path}")
    except Exception as e:
        print(f"[!] Could not generate classification.txt: {e}")

    # ──────────────────────────────────────────────
    # Done
    # ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  All done!  Output files in project root:")
    print("    • train_history.png   – Training loss/metric curves")
    print("    • confusing_matrix.png – Confusion matrix heatmap")
    print("    • classification.txt  – Precision, Recall, mAP scores")
    print("=" * 60)

