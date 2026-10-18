"""
model_utils.py
===============
Loading and inference helpers for both model families:

  1) The 5 fine-tuned, end-to-end torchvision models (.pt checkpoints)
  2) The 40 frozen timm backbones + linear SVM classifiers

Beginners: you shouldn't need to edit this file. If loading fails, it is
almost always because of a mismatch between config.py and your actual
files -- read the printed error message, it tells you what to check.
"""

import os

import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

import config

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
TOP5_V2_DIR = os.environ.get("APRICOT_TOP5V2_DIR", "../models/top5_v2")

def load_top5_v2_model(model_key, device="cpu"):
    """Loads one of the 5 timm-backbone fine-tuned models (top5_v2)."""
    import timm

    info = config.TOP5_V2_MODELS[model_key]
    ckpt_path = os.path.join(config.TOP5_V2_DIR, info["checkpoint"])
    if not os.path.exists(ckpt_path):
        raise FileNotFoundError(
            f"Checkpoint not found: {ckpt_path}\n"
            f"-> Put your top5_v2 folders in {config.TOP5_V2_DIR} "
            f"or set the APRICOT_TOP5V2_DIR environment variable."
        )

    model = timm.create_model(info["arch"], pretrained=False, num_classes=len(config.CLASS_NAMES))

    checkpoint = torch.load(ckpt_path, map_location=device, weights_only=False)

    class_names = None
    if isinstance(checkpoint, dict) and "model_state" in checkpoint:
        state_dict = checkpoint["model_state"]
        if "classes" in checkpoint:
            class_names = list(checkpoint["classes"])
    elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
        state_dict = checkpoint["state_dict"]
    elif isinstance(checkpoint, dict) and all(
        isinstance(v, torch.Tensor) for v in checkpoint.values()
    ):
        state_dict = checkpoint
    elif hasattr(checkpoint, "state_dict"):
        state_dict = checkpoint.state_dict()
    else:
        state_dict = checkpoint

    try:
        model.load_state_dict(state_dict)
    except RuntimeError as e:
        print("NOTE: strict load_state_dict() failed, retrying with strict=False.")
        print(e)
        model.load_state_dict(state_dict, strict=False)

    model.eval()
    model.to(device)

    data_cfg = timm.data.resolve_data_config({}, model=model)
    transform = timm.data.create_transform(**data_cfg)

    return model, info, (class_names or config.CLASS_NAMES), transform


def predict_top5_v2(model, transform, image_path, class_names=None, device="cpu"):
    class_names = class_names or config.CLASS_NAMES
    img = Image.open(image_path).convert("RGB")
    x = transform(img).unsqueeze(0).to(device)
    with torch.no_grad():
        out = model(x)
        probs = torch.softmax(out, dim=1)[0]
    top_idx = int(torch.argmax(probs))
    return class_names[top_idx], float(probs[top_idx]), probs.cpu().numpy(), class_names

def _build_finetuned_arch(arch, num_classes):
    """
    Recreates the torchvision architecture with its final layer replaced
    for `num_classes`. This must match how the classifier head was
    replaced during training -- if your checkpoint was saved with a
    different head shape, edit the matching branch below.
    """
    if arch == "alexnet":
        m = models.alexnet(weights=None)
        m.classifier[6] = nn.Linear(m.classifier[6].in_features, num_classes)
    elif arch == "vgg16":
        m = models.vgg16(weights=None)
        m.classifier[6] = nn.Linear(m.classifier[6].in_features, num_classes)
    elif arch == "googlenet":
        m = models.googlenet(weights=None, aux_logits=True, init_weights=False)
        m.fc = nn.Linear(m.fc.in_features, num_classes)
        if m.aux1 is not None:
            m.aux1.fc2 = nn.Linear(m.aux1.fc2.in_features, num_classes)
        if m.aux2 is not None:
            m.aux2.fc2 = nn.Linear(m.aux2.fc2.in_features, num_classes)
    elif arch == "inception_v3":
        m = models.inception_v3(weights=None, aux_logits=True, init_weights=False)
        m.fc = nn.Linear(m.fc.in_features, num_classes)
        m.AuxLogits.fc = nn.Linear(m.AuxLogits.fc.in_features, num_classes)
    elif arch == "mobilenetv3_small":
        m = models.mobilenet_v3_small(weights=None)
        m.classifier[3] = nn.Linear(m.classifier[3].in_features, num_classes)
    else:
        raise ValueError(f"Unknown finetuned arch: {arch}")
    return m
def load_finetuned_model(model_key, device="cpu"):
    info = config.FINETUNED_MODELS[model_key]
    ckpt_path = os.path.join(config.CHECKPOINT_DIR, info["checkpoint"])
    if not os.path.exists(ckpt_path):
        raise FileNotFoundError(
            f"Checkpoint not found: {ckpt_path}\n"
            f"-> Put your .pt files in {config.CHECKPOINT_DIR} "
            f"or set the APRICOT_CKPT_DIR environment variable."
        )

    model = _build_finetuned_arch(info["arch"], num_classes=len(config.CLASS_NAMES))

    checkpoint = torch.load(ckpt_path, map_location=device, weights_only=False)

    # Handles checkpoints saved in any of these common formats:
    #   - a raw state_dict
    #   - {"state_dict": ..., ...}
    #   - {"model_state": ..., "classes": [...], "val_acc": ...}  <- this project's format
    #   - a full nn.Module object saved directly with torch.save(model)
    class_names = None
    if isinstance(checkpoint, dict) and "model_state" in checkpoint:
        state_dict = checkpoint["model_state"]
        if "classes" in checkpoint:
            class_names = list(checkpoint["classes"])
    elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
        state_dict = checkpoint["state_dict"]
    elif isinstance(checkpoint, dict) and all(
        isinstance(v, torch.Tensor) for v in checkpoint.values()
    ):
        state_dict = checkpoint
    elif hasattr(checkpoint, "state_dict"):
        state_dict = checkpoint.state_dict()
    else:
        state_dict = checkpoint

    try:
        model.load_state_dict(state_dict)
    except RuntimeError as e:
        print("NOTE: strict load_state_dict() failed, retrying with strict=False.")
        print("If predictions look wrong, the classifier head in")
        print("_build_finetuned_arch() probably doesn't match how this")
        print("checkpoint was trained. Original error:")
        print(e)
        model.load_state_dict(state_dict, strict=False)

    model.eval()
    model.to(device)

    if class_names is not None and class_names != config.CLASS_NAMES:
        print("NOTE: this checkpoint stores its own class order:")
        print(f"      {class_names}")
        print("      Using the checkpoint's order for this prediction "
              "(overrides config.CLASS_NAMES).")

    return model, info, (class_names or config.CLASS_NAMES)
def get_finetuned_transform(input_size):
    return transforms.Compose([
        transforms.Resize((input_size, input_size)),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
def predict_finetuned(model, image_path, input_size, class_names=None, device="cpu"):
    class_names = class_names or config.CLASS_NAMES
    transform = get_finetuned_transform(input_size)
    img = Image.open(image_path).convert("RGB")
    x = transform(img).unsqueeze(0).to(device)
    with torch.no_grad():
        out = model(x)
        if isinstance(out, tuple):  # inception/googlenet can return aux outputs
            out = out[0]
        probs = torch.softmax(out, dim=1)[0]
    top_idx = int(torch.argmax(probs))
    return class_names[top_idx], float(probs[top_idx]), probs.cpu().numpy(), class_names

def load_backbone(model_name, device="cpu"):
    """Loads a timm backbone as a pure feature extractor (num_classes=0),
    and builds the exact preprocessing transform that backbone expects."""
    import timm
    model = timm.create_model(model_name, pretrained=True, num_classes=0)
    model.eval()
    model.to(device)
    data_cfg = timm.data.resolve_data_config({}, model=model)
    transform = timm.data.create_transform(**data_cfg)
    return model, transform


def extract_feature(model, transform, image_path, device="cpu"):
    img = Image.open(image_path).convert("RGB")
    x = transform(img).unsqueeze(0).to(device)
    with torch.no_grad():
        feat = model(x)
    return feat.cpu().numpy().reshape(1, -1)

def load_svm(model_name):
    import joblib
    path = os.path.join(config.SVM_DIR, f"{model_name}.joblib")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"SVM classifier not found: {path}\n"
            f"-> Run 'python train_svm_classifiers.py' first to build it "
            f"from your cached .npz features (see README)."
        )
    return joblib.load(path)

def predict_frozen_svm(model_name, image_path, device="cpu"):
    backbone, transform = load_backbone(model_name, device=device)
    feat = extract_feature(backbone, transform, image_path, device=device)
    clf = load_svm(model_name)

    pred = clf.predict(feat)[0]
    label = config.CLASS_NAMES[int(pred)] if str(pred).isdigit() or isinstance(pred, (int,)) else str(pred)

    scores = None
    if hasattr(clf, "decision_function"):
        scores = clf.decision_function(feat)[0]
    return label, scores
