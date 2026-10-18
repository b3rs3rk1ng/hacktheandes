# 🍑 Multi-Disease Detection in Apricot Fruits using YOLOv8

This project focuses on detecting multiple diseases in apricot fruits using **YOLOv8**, a state-of-the-art object detection model. The dataset was collected and annotated using **Roboflow**, then trained and tested using **Ultralytics YOLOv8** in Python.

##Test it at : https://multi-disease-detection-using-yplov08.onrender.com/

---

## 📸 Dataset Overview

The dataset was created and annotated on [Roboflow](https://roboflow.com/).
It contains **3,900+ labeled images** of apricot fruits under different conditions.
Each image is annotated for multiple disease types such as:

* **Brown Rot**
* **Powdery Mildew**
* **Shot Hole**
* **Healthy**
* **Other Damage**

Below is a snapshot of the dataset annotation process on Roboflow 👇

![Dataset Screenshot](./Screenshot%20(20).png)


---

## ⚙️ Project Workflow

### **1. Dataset Preparation**

* Collected images of apricot fruits in various lighting and background conditions.
* Uploaded and annotated images in Roboflow for object detection.
* Divided the dataset into:

  * **Train:** 70%
  * **Validation:** 20%
  * **Test:** 10%
* Exported dataset in **YOLOv8 format**.

---

### **2. Model Training**

**Environment Setup:**

```bash
pip install ultralytics
```

**Verify Installation:**

```bash
yolo version
```

**Train the Model:**

```bash
yolo detect train data=data.yaml model=yolov8n.pt epochs=100 imgsz=640
```

**Parameters Explained:**

* `data.yaml` → Contains paths to train/val/test datasets.
* `model` → Base model (YOLOv8n, YOLOv8s, YOLOv8m, etc.)
* `epochs` → Number of training iterations.
* `imgsz` → Input image size.

---

### **3. Model Evaluation**

After training, the model performance was evaluated using metrics such as:

* **mAP (mean Average Precision)**
* **Precision**
* **Recall**
* **F1 Score**

To visualize results:

```bash
yolo detect val model=runs/detect/train/weights/best.pt data=data.yaml
```

---

### **4. Model Testing**

To test the trained model on new images:

```bash
yolo detect predict model=runs/detect/train/weights/best.pt source="path_to_image_or_folder"
```

Predictions are saved automatically in the `runs/detect/predict` directory.

---

## 🧠 Technologies Used

* **YOLOv8 (Ultralytics)**
* **Python**
* **Roboflow**
* **OpenCV**
* **NumPy**
* **Matplotlib**

---

## 🚀 Results

The trained YOLOv8 model successfully detects and classifies multiple fruit diseases in real time.
This model can be deployed for:

* Fruit sorting automation
* Quality inspection
* Agricultural monitoring systems

---

## 📂 Project Structure

```
├── data.yaml
├── train/
├── val/
├── test/
├── runs/
├── Screenshot (20).png
├── yolov8_training.ipynb
└── README.md
```

---

## 👨‍💻 Author

**Wazir Muzammil**
📧 Email: [itzmuzu@gmail.com](mailto:itzmuzu@gmail.com)
🔗 GitHub: [MuzamilWazir](https://github.com/MuzamilWazir)

---


