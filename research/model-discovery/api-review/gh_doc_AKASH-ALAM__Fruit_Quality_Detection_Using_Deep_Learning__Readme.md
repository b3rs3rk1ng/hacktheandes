# Smart IoT System for Fruit Quality Detection Using Deep Learning

An end-to-end, ultra-low-cost IoT computer vision system designed to automate fruit quality inspection. This project proves that highly accurate, multi-object enterprise-grade AI inspection can be achieved on budget edge hardware (a $15 camera) without heavy local GPU processing. 

---

## 🚀 Project Overview

Fruit spoilage is a critical challenge in agricultural supply chains. Existing automated solutions often rely on expensive industrial cameras or struggle with overlapping fruits. This project provides a decentralized, low-cost system capable of multi-object detection and real-time quality classification.

The entire ecosystem is controlled via an asynchronous Telegram Bot interface, allowing users to trigger hardware captures remotely and receive immediate, annotated quality reports directly to their phones or desktops.

---

## ✨ Key Features & Performance

Initial iterations utilizing MobileNetV2 struggled to localize and separate multiple fruits in a single frame. The architecture was pivoted to a custom YOLOv8 Nano model trained on a manually cleaned dataset of 8 distinct classes of fresh and spoiled fruits. 

To overcome cloud latency and timeouts, the PyTorch `.pt` weights were optimized into the ONNX format. This eliminated framework overhead and reduced inference latency on a free-tier cloud CPU from over 15 seconds down to just 3-4 seconds.

| Metric | Score |
| :--- | :--- |
| **mAP@50** | 98.97% |
| **Precision** | 98.17% |
| **Recall** | 97.79% |
| **Inference Speed** | 3-4 seconds (Cloud CPU) |

### Data & Labels
![Labels](model/fruit_quality/labels.jpg)
![Training Batch 0](model/fruit_quality/train_batch0.jpg)

### Evaluation Metrics
![Training History](train_history.png)
![Confusion Matrix](model/fruit_quality/confusion_matrix_normalized.png)
![Validation Predictions](model/fruit_quality/val_batch2_pred.jpg)

---

## 🛠️ Technology Stack

| Component | Technologies Used |
| :--- | :--- |
| **Hardware** | ESP32-CAM Development Board, OV2640 2MP Camera Sensor |
| **Deep Learning** | YOLOv8 Nano (trained on Intel Arc A750 GPU), ONNX Runtime |
| **Backend** | Python 3.10, FastAPI, Uvicorn, OpenCV, httpx, asyncio |
| **Cloud Infrastructure**| Hugging Face Spaces (Free Tier CPU) |
| **User Interface** | Telegram Bot API |
| **Edge Firmware** | C++ (Arduino IDE), WiFiClientSecure, HTTPClient |

---

## ⚙️ System Architecture

The operational flow is designed asynchronously to prevent blocking and handle hardware timeouts:

1. The user sends a `/capture` command via the Telegram Bot.
2. The FastAPI backend receives the command and sets a state trigger flag.
3. The ESP32-CAM (polling every 2 seconds) detects the flag, wakes up, clears stale buffers, and captures a QVGA image.
4. The edge device compresses the frame to JPEG and pushes the payload via HTTP POST to the cloud.
5. The ONNX-optimized YOLOv8 engine processes the image and calculates confidence scores.
6. OpenCV draws bounding boxes, formats a Markdown statistical summary, and pushes the final report back to the user.

---

## 💻 Installation & Setup Guide

### 1. Model & Software Environment
To run this project on a local machine (Windows, Mac, or Linux), follow these steps:

* Download Python 3.10 or newer (ensure you check "Add python.exe to PATH" during installation on Windows).
* Download the dataset from Mendeley: [Rotten Fruit Detector Dataset (v3)](https://data.mendeley.com/datasets/xkbjx8959c/2).
* Open your terminal and create an isolated virtual environment:

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Mac/Linux
python3 -m venv venv
source venv/bin/activate
```

* Install the required AI packages (this installs `ultralytics`, `opencv-python`, and `onnxruntime`):

```bash
pip install -r requirements.txt
```

* Test the model on a local image (the `--show` flag will pop up a window with bounding boxes):

```bash
python predict.py "1.jpg" --show
```

### 2. Hardware Pipeline (ESP32-CAM)
To connect the physical camera to your network:
* Plug the ESP32-CAM into your computer using an ESP32-CAM-MB micro-USB shield.
* Open the Arduino IDE.
* Update the Wi-Fi credentials (SSID and Password) to your local router in the `ESP-32_Flash_File.cpp` file.
* Flash the code to the board.

### 3. Telegram Bot Configuration
To set up your own remote UI:
* Open Telegram and search for "BotFather".
* Send the `/newbot` command and provide a name and username (e.g., `Rotten Fruit Detector`).
* Copy the generated `BOT TOKEN`.
* Install the specific bot libraries in your environment:

```bash
pip install python-telegram-bot inference pillow
```

---

## 🚧 Limitations & Future Work

* **Cloud Sleep States:** The current deployment relies on the Hugging Face Free Tier, which imposes a "cold start" sleep state after 48 hours of inactivity. Future iterations will migrate to a dedicated DigitalOcean App Platform container to eliminate this delay.
* **Network Dependency:** The system strictly requires a 2.4GHz Wi-Fi connection, making deep-field agricultural deployment challenging. Future hardware will integrate a custom PCB with a battery management system and a GSM/LTE module for remote operation.
* **Dataset Expansion:** The model will be continuously trained on expanded datasets to include more regional fruit classifications.

---

## 👥 Project Team

This architecture scales directly to conveyor-belt sorting systems and cold-chain logistics monitoring at a fraction of traditional costs. None of this was possible without the dedication of the team. 

**Supervised by:** Sayefa Arafah Arpona (Lecturer, Department of CSE, Bangladesh University of Business and Technology)

**R&D by:** [Sohel Rana](https://github.com/mr-sohel), [Faysal Islam Fahad](https://github.com/faysal-islam-fd), Naushin Sultana MiMi, and Mst. Milhan Jannat Jerin.
