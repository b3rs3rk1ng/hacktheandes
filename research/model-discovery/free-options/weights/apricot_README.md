# Apricot Leaf & Fruit Disease Classification

Code accompanying the paper:

**A Comparative Study of Convolutional Neural Network Architectures for Apricot Leaf and Fruit Disease Classification Under Field Conditions**
Bilal Jan, Aman Iqbal, Hafeez Anwar — FAST National University of Computer and Emerging Sciences (FAST-NUCES), Peshawar Campus

This repo lets you classify a photo of an apricot leaf or fruit into one of **7 classes** (brown rot, gumosis and galls, healthy, other disorder / water stress, shot hole, shot hole leaves, wilting and die-back) using any of **50 pretrained models** evaluated in the paper:

- **5 fine-tuned end-to-end models, torchvision** (Section 4.1): MobileNetV3-Small, AlexNet, VGG-16, GoogLeNet, Inception-v3
- **5 fine-tuned end-to-end models, timm backbones** (Section 4.1b) — HIGHEST accuracy overall: Swin-Base, ViT-Base, ConvNeXt-Base, BEiTv2-Base, EfficientNet-B7
- **40 frozen-backbone + linear-SVM models** (Section 4.5):20 CNN backbones and 20 Vision Transformer backbones (ResNet, ConvNeXt, EfficientNet, VGG, DenseNet, ViT, Swin, BEiT, DeiT, CaiT, PVT, Twins, CoaT, CrossViT, ...)

No machine learning experience needed — `predict.py` is a menu-driven command line tool: it lists every model, you pick one, you give it an image path, it tells you the predicted class.

## Repository Structure

```
apricot-leaf-disease-classification/
├── README.md
├── requirements.txt
├── src/
│   ├── config.py                  <- model registry & file paths
│   ├── model_utils.py             <- loading + inference logic
│   ├── predict.py                 <- the interactive tool you run
│   ├── train_svm_classifiers.py   <- one-time setup for the 40 frozen models
│   └── inspect_npz.py             <- debugging helper for .npz files
├── models/
│   ├── finetuned/                 <- the 5 torchvision .pt checkpoints go here
│   ├── top5_v2/                   <- the 5 timm .pth checkpoints go here (highest accuracy)
│   └── svm/                       <- the 40 .joblib SVM classifiers go here
├── features_cache/                <- the 40-model .npz feature caches go here
└── sample_images/                 <- a few test photos
```

## 1. Setup

```bash
git clone https://github.com/amaniqbal-ai/apricot-disease-classification
cd apricot-disease-classification
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Download the Pretrained Models

All model weights and feature caches are provided as ready-to-use downloads on the **[v1.0 and v1.1 Release](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/tag/v1.0)** — no training required.

Download these 5 files from the release page:

| File | Size | Goes into |
|---|---|---|
| [`finetuned.zip`](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.0/finetuned.zip) | 805 MB | `models/finetuned/` |
| [`top5_v2.zip`](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.1/top5_v2.zip) | ~1.5 GB | `models/top5_v2/` |
| [`svm.zip`](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.0/svm.zip) | 2.4 MB | `models/svm/` |
| [`features_cache1.zip`](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.0/features_cache1.zip) | 1.52 GB | `features_cache/` |
| [`features_cache2.zip`](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.0/features_cache2.zip) | 1.44 GB | `features_cache/` |

**Steps:**

1. Extract each ZIP file.
2. Copy the **contents** of the extracted `models` folder into the matching directory below — don't create an extra nested `models` folder.

```
apricot-disease-classification/
├── features_cache/
│   └── (contents of features_cache1.zip + features_cache2.zip)
└── models/
    ├── finetuned/
    │   └── (contents of finetuned.zip's models folder)
    ├── top5_v2/
    │   └── (contents of top5_v2.zip -- 5 subfolders, one per model)
    └── svm/
        └── (contents of svm.zip's models folder)
```

> That's it — the fine-tuned models and SVM classifiers are ready to use immediately. You do **not** need to run `train_svm_classifiers.py` unless you want to regenerate the SVMs from scratch.

## 3. Usage

```bash
cd src
python predict.py
```

You'll see something like:

```
APRICOT LEAF & FRUIT DISEASE CLASSIFIER -- 50 models available
======================================================================

[A] Fine-tuned end-to-end models, torchvision (5) -- simplest, recommended:
    - MobileNetV3-Small (fine-tuned) -- RECOMMENDED for mobile deployment  (test acc: 79.9%)
    - AlexNet (fine-tuned)  (test acc: 82.7%)
    - VGG-16 (fine-tuned) -- HIGHEST accuracy in the paper  (test acc: 84.3%)
    - GoogLeNet / Inception-v1 (fine-tuned)  (test acc: 79.8%)
    - Inception-v3 (fine-tuned)  (test acc: 73.1%)

[A2] Fine-tuned end-to-end models, timm backbones (5) -- highest accuracy:
    - Swin-Base (fine-tuned, timm) -- HIGHEST accuracy overall  (test acc: 88.46%)
    - ViT-Base (fine-tuned, timm)  (test acc: 87.07%)
    - ConvNeXt-Base (fine-tuned, timm)  (test acc: 85.46%)
    - BEiTv2-Base (fine-tuned, timm)  (test acc: 83.14%)
    - EfficientNet-B7 (fine-tuned, timm)  (test acc: 80.11%)

[B] Frozen backbone + linear SVM models (40):
    - 20 CNN backbones (ResNet, ConvNeXt, EfficientNet, VGG, ...)
    - 20 Vision Transformer backbones (ViT, Swin, BEiT, DeiT, ...)

What would you like to use?
  1. Fine-tuned end-to-end model (torchvision -- 5 choices, simplest)
  2. Fine-tuned end-to-end model (timm backbones -- 5 choices, highest accuracy)
  3. Frozen backbone + SVM (research comparison -- 40 choices)
What would you like to use? [1-3]:
```

Pick a category, pick a model, then paste the path to your image (e.g. `../sample_images/leaf1.jpg`) — it prints the predicted class plus a confidence breakdown across all 7 classes.

### Quick recommendation

- **Best practical, deployable model:** option 1 → **MobileNetV3-Small** — the paper's recommended model for on-device / mobile use (best accuracy-to-cost trade-off, ~2.5M parameters).
-**Highest raw accuracy:** **Swin-Base** (88.46%) from the timm fine-tuned list — best overall in the paper, at the cost of a much larger backbone (~87M params).

## 4. How Each Model Family Works

**Fine-tuned models:** a full ImageNet-pretrained network (AlexNet, VGG-16, GoogLeNet, Inception-v3, or MobileNetV3-Small) with its final layer replaced for 7 classes, then fine-tuned end-to-end on the apricot dataset. Prediction is a single forward pass through the network.
**Fine-tuned models (timm backbones):** the same end-to-end fine-tuning approach, but starting from larger modern architectures (Swin, ViT, ConvNeXt, BEiTv2, EfficientNet-B7) loaded via `timm`, with a 7-class head trained on top. Highest raw accuracy in the paper, at the cost of larger checkpoints and slower inference.

**Frozen backbone + SVM models:** a pretrained backbone (CNN or Vision Transformer, loaded via `timm`) is used purely as a fixed feature extractor — no weights are updated. Its pooled output feature vector is classified by a separately-trained linear SVM. This matches the "frozen-feature-plus-SVM" benchmark in Section 4.5 of the paper.

## 5. Notes / Limitations

- All 50 models were trained/evaluated on augmented derivatives of the same 748 original photographs (see Sections 3.2 and 5 of the paper for the leakage-free splitting methodology). This code loads the already-trained artifacts for inference on a new image — it does not retrain the fine-tuned models.
- First-time use of a frozen backbone will download its ImageNet-pretrained weights via `timm` (requires an internet connection once; cached afterward).
- Want to retrain the SVMs yourself instead of using the release download? Run `python src/train_svm_classifiers.py` after populating `features_cache/` — see `src/inspect_npz.py` if it can't find the feature/label keys in your `.npz` files.

## Citation

If you use this code, please cite the paper (see `paper/` if you add the PDF, or update this section with the final publication details).

## License

MIT
