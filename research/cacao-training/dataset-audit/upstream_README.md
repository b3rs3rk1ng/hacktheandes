# CocoaMoniliaDataSet
**CocoaMoniliaDataset v1** is an annotated RGB image dataset created to support computer vision task for the detection of *Moniliophthora roreri* in cocoa pods. The dataset includes four classes: (1) Healthy cocoa pods labeled as **h0**, (2) First cycle of Monilia (Humps) labeled as **m1**, (3) It is a combination of the second and third cycle of the disease (Brown and oily spots) labeled as **m2**, and (4) Fourth cycle of Monilia (Sporulation) labeled as **m3**. The annotation formats are provided in **COCO 1.0**, **YOLO**, and **Segmentation Maks 1.1**.

<a href="https://colab.research.google.com/drive/1C4zdLG0hXHoqtQQvP15NHhZAWn_U4jQI?usp=sharing"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"></a>

## Dataset Availability on Zenodo

**Repository name:**  Zenodo

**Dataset DOI:**  [10.5281/zenodo.17716661](https://doi.org/10.5281/zenodo.17716661).


**Direct download URL:** [https://zenodo.org/records/17716661](https://zenodo.org/records/17716661) 

## **CocoaMoniliaDataset v1** structure
The dataset follows the structure shown below:
```
CocoaMoniliaDataSet/
│
├── cocoapods_images/
│     ├── h0/
│     ├── m1/
│     ├── m2/
│     ├── m3/
│
│── COCO_annotations/
│     ├── instances_h0.json
│     ├── instances_m1.json
│     ├── instances_m2.json
│     ├── instances_m3.json
│
│── mask_segmentation/
│     ├── SegmentationClassh0/
│     ├── segmentationObjecth0/
│     ├── SegmentationClassm1/
│     ├── segmentationObjectm1/
│     ├── SegmentationClassm2/
│     ├── segmentationObjectm2/
│     ├── SegmentationClassm3/
│     ├── segmentationObjectm3/
│  
│── YOLO_annotations/
      ├── h0/
      ├── m1/
      ├── m2/
      ├── m3/
```
Each directory contains images and their annotations organized by class.

## Class Definitions


| Label  | Class name |Description |
| ------------- | ------------- |------------- |
|h0  | Healthy  | Cocoa pods without visible *Monilia* symptoms  |
| m1  | Humps  | First cycle of Monilia   | 
| m2  | Brown/oily spots  | Second-third cycle of *Monilia*  | 
| m3  | Sporulation | Fourth cycle of *Monilia*  | 


## Download and Unzip the Dataset.
```
!wget -O dataset.zip "https://zenodo.org/records/17156052/files/CocoaMoniliaDataSet.zip?download=1"
!unzip dataset.zip
```

## Example: Loading COCO Annotation format

```python
from pycocotools.coco import COCO
coco = COCO("COCO_annotations/instances_m2.json")
image_ids = coco.getImgIds()
ann_ids = coco.getAnnIds(imgIds=image_ids[0])
annotations = coco.loadAnns(ann_ids)
```
## Example: Loading Segmentation Mask Format

```python
# Paths
IMAGE_DIR = Path("CocoaMoniliaDataSet/cocoapods_images/m1")
MASK_CLASS_DIR = Path("CocoaMoniliaDataSet/mask_segmentation/SegmentationClassm1")
MASK_OBJ_DIR   = Path("CocoaMoniliaDataSet/mask_segmentation/segmentationObjectm1")

image_id = "1728667861354"  # example

# Load RGB image

rgb = cv.imread(str(IMAGE_DIR / f"{image_id}.jpg"))
rgb = cv.cvtColor(rgb, cv.COLOR_BGR2RGB)
# Load class mask

class_mask = cv.imread(str(MASK_CLASS_DIR / f"{image_id}.png"), cv.IMREAD_COLOR)
class_mask = cv.cvtColor(class_mask, cv.COLOR_BGR2RGB) # Convert from BGR to RGB to correct RGB visualization

# Load instance mask

instance_mask = cv.imread(str(MASK_OBJ_DIR / f"{image_id}.png"))
instance_mask = cv.cvtColor(instance_mask, cv.COLOR_BGR2RGB) # Convert from BGR to RGB to correct RGB visualization
```
## Label map of the segmentation mask 1.1 annotation

| Classes  | RGB color value |
| ------------- | ------------- |
| h0  | (61,242,60)  |
| m1  | (250,50,83)  |
| m2  | (245,147,49)  |
| m3  | (50,183,250)  |

## Example: Converting COCO to YOLO Bounding Box Format

In YOLO object detection format, each image has a corresponding txt file with a single line with the box coordinates for each bounding box. The format of each row is the following:

```
<class_id> <center_x> <center_y> <width> <height> 
```
Example code:

```python
for ann in coco["annotations"]:
  image_id = ann["image_id"]
  cat_id = ann["category_id"]
  if format_ == "bbox":
    bbox  = ann[format_]
    x_min, y_min, w_box, h_box = bbox
    image_info = images[image_id]
    img_w, img_h = image_info["width"], image_info["height"]

    cx = (x_min + w_box / 2) / img_w
    cy = (y_min + h_box / 2) / img_h
    w_norm = w_box / img_w
    h_norm = h_box / img_h

    yolo_line = f"{cat_id - 1} {cx:.6f} {cy:.6f} {w_norm:.6f} {h_norm:.6f}
```

## Example: Converting COCO to YOLO Instance Segmentation Format 

In YOLO instance segmentation, each image has a corresponding txt file with coordinates that outline each object in the image. The format of each row is the following:

```
<class-index> <x1> <y1> <x2> <y2> ... <xn> <yn>
```

### The next code is a way to iterate over annotations to convert COCO format to YOLO instance segmentation.

```python
if isinstance(segmentation, list):
  for seg in segmentation:
    if len(seg) < 6:
      continue  
                  
    norm_coords = []
    for i in range(0, len(seg), 2):
      x = seg[i] / img_w
      y = seg[i + 1] / img_h
      norm_coords.append(f"{x:.6f} {y:.6f}")

    line = f"{cat_id - 1} " + " ".join(norm_coords)  
    yolo_lines.append(line)
```

### Dataset Splitting Methods


<img width="697" height="117" alt="image" src="https://github.com/user-attachments/assets/2c573c83-bb2a-44dd-9800-65331baad92e" />

The notebook [CocoaMoniliaDataSet.ipynb](https://github.com/joanfco30/CocoaMoniliaDataSet/blob/main/CocoaMoniliaDataSet.ipynb) includes functions for creating train/validation/splits for both object detection and instance segmentation. YOLO expects the following structure:

```
│── DataSet_split_seg/
│     ├─ images/
│     │    ├── train/
│     │    ├── test/
│     │    ├── val/
│     │
│     │
│     ├─ labels/
           ├── train/
           ├── test/
           ├── val/
```
## YAML File Configuration Example

YAML file defines the dataset path and class names. The label files, according to the task, contain normalized bounding box coordinates with their respective class, or the polygon coordinates of its mask. 
```python
WORK_DIR = Path("/content/DataSet_split_bbox")

yaml_conf_file = f"""
path: {WORK_DIR}
train: images/train
val: images/val
test: images/test
names:
  0: h0
  1: m1
  2: m2
  3: m3
"""

(WORK_DIR / "yolovx.yaml").write_text(yaml_conf_file)
```
Output
```
path: /content/DataSet_split_bbox
train: images/train
val: images/val
test: images/test

names:
  0: h0
  1: m1
  2: m2
  3: m3
```
# Training a YOLO Model

 
```python
from ultralytics import YOLO

model = YOLO("yolo11l.pt")
results = model.train(data="yolovx.yaml", epochs=50, imgsz=640, device=0)
```
Metrics
```python
mAP50-95: 0.8949005285588628
mAP50: 0.9104535766547039
IoU (mean across classes): 0.8949005285588629
```

## License

CocoaMoniliaDataSet is distributed under the Creative Commons Attribution 4.0 International
License (CC BY 4.0).


[https://creativecommons.org/licenses/by/4.0/](https://creativecommons.org/licenses/by/4.0/) 


## Citation
```APA
Alvarado Molina, J. F., Restrepo-Arias, J. F., Velásquez, D., Branch Bedoya, J. W., & Maiza, M. (2025). CocoaMoniliaDataSet [Data set]. Zenodo. https://doi.org/10.5281/zenodo.17716661
```
