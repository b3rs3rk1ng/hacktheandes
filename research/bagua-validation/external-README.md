# Deep Learning-Based Cocoa Pod Disease Detection

**A Multi-Class Classification System for Ghanaian Farmers**

**Author:** Enoch K. Koranteng — Department of Computer Engineering, Kwame Nkrumah University of Science and Technology

## Overview

Cocoa is a cornerstone of Ghana's economy, but fungal and pest diseases
destroy 30–40% of global cocoa production each year, and trained agronomists
are chronically scarce in rural areas. This project trains and evaluates
three CNN architectures — **ResNet-50**, **EfficientNet-B0**, and
**MobileNetV3-Small** — via ImageNet transfer learning to classify five pod
conditions (four diseases plus healthy) directly from smartphone images.

| Class | Condition |
|---|---|
| 0 | Healthy |
| 1 | *Carmenta foraseminis* (cocoa pod borer) |
| 2 | *Moniliophthora perniciosa* (witches' broom) |
| 3 | *Moniliophthora roreri* (frosty pod rot) |
| 4 | *Phytophthora palmivora* (black pod) |

Class imbalance (the rarest class is 2.3% of samples) is addressed with
inverse-frequency cross-entropy weighting. Models are evaluated on accuracy,
macro F1, per-class precision/recall, ROC AUC, inference latency, parameter
count, and model footprint — covering both predictive quality and edge
deployment feasibility.

**Results:** ResNet-50 achieves the highest test accuracy (87.25%),
EfficientNet-B0 the best macro F1 (0.755) at 4.01M parameters, and
MobileNetV3-Small the lowest latency (3.9 ms) at 1.52M parameters. Full
methodology and discussion are in the paper.

## Repository structure

```
Deep_Learning_Based_Cocoa_Pod_Disease_Detection.pdf   Final paper (IEEE format)
paper/            LaTeX source
src/              Training/evaluation pipeline (models, dataset, train, evaluate, main)
figures/          Paper figures (confusion matrices, ROC curves, training curves, sample images)
results/          Metrics (JSON/CSV), per-sample predictions and probabilities (.npy), training log
requirements.txt  Python dependencies
```

Trained model checkpoints (`.pth`, ~112MB total) and the raw image dataset
(~470MB) are not tracked in this repo — see below for how to get them.

## Dataset

The dataset is 3,285 annotated pod-crop images across the 5 classes,
collected and labeled (YOLO-format bounding boxes) by the author. Expected
layout for `src/main.py --data_root`:

```
cocoa_diseases/
├── images/        (.jpg)
├── labels/         YOLO-format .txt annotations
└── notes.json       class id -> name mapping
```

Download the full dataset from the [Releases](../../releases) page of this
repository and extract it to `cocoa_diseases/` in the project root.

## Setup

```bash
pip install -r requirements.txt
```

## Training

```bash
python src/main.py --data_root cocoa_diseases --results_dir results
```

Trains all three models by default. Use `--models resnet50` (etc.) to train
a subset, and `--epochs`/`--batch_size`/`--lr`/`--patience` to tune. Outputs
per-model checkpoints, metrics, confusion matrices, and comparison plots to
`results_dir`.

Pretrained checkpoints (so you can reproduce the evaluation/figures without
retraining) are attached to the [Releases](../../releases) page.

## Paper

The final paper PDF is at the repository root. LaTeX source is in
`paper/cocoa_ieee_extended.tex` if you want to recompile it.
