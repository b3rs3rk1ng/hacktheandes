---
license: apache-2.0
tags:
- image-classification
- pytorch
- mobilenetv2
- fruit-freshness
- vegetable-freshness
datasets:
- raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables
---

# Fruit & Vegetable Freshness Classifier (MobileNetV2)

Fine-tuned MobileNetV2 for binary classification of fruit/vegetable freshness (fresh vs stale).

## Model Details
- **Base model:** google/mobilenet_v2_1.0_224
- **Task:** Binary image classification (fresh / stale)
- **Classes:** apple, banana, bitter gourd, capsicum, orange, tomato
- **Input size:** 224x224 RGB
- **Framework:** PyTorch

## Training
- Fine-tuned in two phases: (1) frozen backbone, classifier head only, (2) unfroze last 4 backbone blocks at low LR
- Normalization: ImageNet mean/std

## Usage
```python
import torch
from torchvision import models, transforms
from PIL import Image

model = models.mobilenet_v2()
model.classifier = torch.nn.Sequential(
    torch.nn.Dropout(0.3),
    torch.nn.Linear(model.classifier[1].in_features, 2)
)
model.load_state_dict(torch.load("freshness_mobilenetv2_state_dict.pth", map_location="cpu"))
model.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

img = Image.open("test.jpg").convert("RGB")
x = transform(img).unsqueeze(0)
with torch.no_grad():
    output = model(x)
    pred = torch.argmax(output, dim=1).item()
label = "fresh" if pred == 0 else "stale"
print(label)
```
