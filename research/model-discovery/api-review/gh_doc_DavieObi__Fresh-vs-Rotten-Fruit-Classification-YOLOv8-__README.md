# Fresh vs Rotten Fruit Classification (YOLOv8)

## Project Overview

This project implements an **image classification system** to automatically determine whether fruits are **Fresh** or **Rotten** using **YOLOv8 classification models**.
The dataset contains images of **Apples, Bananas, and Strawberries**, each categorized into *Fresh* and *Rotten* classes.

The goal is to:

* Prepare a hierarchical image dataset
* Convert it into YOLOv8-compatible classification format
* Train a YOLOv8 classification model
* Evaluate performance using confusion matrices and metrics
* Perform inference on unseen images

---

## 🗂 Dataset Structure (Original)

The dataset is organized as follows:

```
Fruit Freshness Dataset/
│
├── Apple/
│   ├── Fresh/
│   └── Rotten/
│
├── Banana/
│   ├── Fresh/
│   └── Rotten/
│
└── Strawberry/
    ├── Fresh/
    └── Rotten/
```

Each subfolder contains images corresponding to the fruit’s condition.

---

## 🔄 Dataset Reformatting (YOLOv8 Requirement)

YOLOv8 **classification models** expect the following structure:

```
fruit_cls/
│
├── train/
│   ├── Apple_Fresh/
│   ├── Apple_Rotten/
│   ├── Banana_Fresh/
│   ├── Banana_Rotten/
│   ├── Strawberry_Fresh/
│   └── Strawberry_Rotten/
│
└── val/
    ├── Apple_Fresh/
    ├── Apple_Rotten/
    ├── Banana_Fresh/
    ├── Banana_Rotten/
    ├── Strawberry_Fresh/
    └── Strawberry_Rotten/
```

Each class is flattened into a single folder combining **fruit type + condition**.

---

## ⚙️ Environment & Requirements

### Python Version

* Python **3.8+**

### Required Libraries

```bash
pip install ultralytics torch torchvision pillow matplotlib pandas
```

---

## 🚀 Model Initialization

We use a **pretrained YOLOv8 classification model**:

```python
from ultralytics import YOLO

model = YOLO("yolov8n-cls.pt")
```

---

## 🏗 Dataset Splitting (Train / Validation)

* **80%** training
* **20%** validation
* Random seed set for reproducibility

Images are copied into:

```
fruit_cls/train/
fruit_cls/val/
```

Each class folder contains only images belonging to that class.

---

## 🧪 Dataset Verification

To confirm correct splitting:

```python
for root, dirs, files in os.walk("fruit_cls"):
    print(root, "→", len(files))
```

This ensures:

* Images exist inside class folders
* No images remain at root level

---

## 🏋️ Model Training

```python
model.train(
    data="fruit_cls",
    epochs=30,
    imgsz=224,
    batch=32
)
```

### Training Outputs

All results are saved automatically under:

```
runs/classify/train/
```

Including:

* `confusion_matrix.png`
* `confusion_matrix_normalized.png`
* `results.png`
* `results.csv`
* model weights

---

## 🔍 Model Inference (Prediction)

### Predict on Validation Images

```python
results = model.predict(
    source="fruit_cls/val/Apple_Fresh",
    save=True
)
```

Prediction outputs are saved in:

```
runs/classify/predict/
```

Each image includes:

* Predicted class
* Confidence score (e.g. **Fresh – 1.00**)

---

## 📊 Model Evaluation

### Confusion Matrix

```python
from PIL import Image

Image.open("runs/classify/train/confusion_matrix.png")
```

### Normalized Confusion Matrix

```python
Image.open("runs/classify/train/confusion_matrix_normalized.png")
```

### Training Curves

```python
Image.open("runs/classify/train/results.png")
```

---

## 📈 Metrics File

All epoch-wise metrics are available in:

```
runs/classify/train/results.csv
```

This includes:

* Accuracy
* Loss values
* Validation performance

---

## ✅ Results Summary

* Model correctly classifies **Fresh vs Rotten** fruits
* Achieved high confidence predictions on validation images
* Confusion matrix confirms strong class separation
* Transfer learning via YOLOv8 significantly reduces training time

---

## 🧠 Key Learnings

* YOLOv8 can be effectively used for **image classification**, not just detection
* Dataset structure is critical for YOLO-based workflows
* Proper train/val splitting prevents data leakage
* Confusion matrices provide clear insight into misclassifications

---

## 🔮 Future Improvements

* Add a **test dataset**
* Try larger models (`yolov8s-cls`, `yolov8m-cls`)
* Apply data augmentation
* Deploy using **Streamlit or FastAPI**
* Extend to more fruit categories

---

## 👤 Author

**David Obi**
