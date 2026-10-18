---
license: mit
tags:
  - image-classification
  - regression
  - vision-transformer
  - fruit
  - vegetable
---

# Vision Transformer for Fruit & Vegetable Quality

This is a fine-tuned Vision Transformer (ViT) model that performs two tasks:

1.  **Classifies** the type of fruit or vegetable in an image.
2.  **Predicts a quality score** for that fruit or vegetable.

## How to Use

To use this model, you must pass `trust_remote_code=True` because it uses a custom architecture.

```python
from transformers import ViTImageProcessor, AutoModel
from PIL import Image
import requests

# Load the processor and model
processor = ViTImageProcessor.from_pretrained("your-hf-username/vit-fruit-veg-quality-predictor")
model = AutoModel.from_pretrained("your-hf-username/vit-fruit-veg-quality-predictor", trust_remote_code=True)

# Example image
url = '[https://some-url.com/path/to/an/apple.jpg](https://some-url.com/path/to/an/apple.jpg)'
image = Image.open(requests.get(url, stream=True).raw)

# Preprocess the image and run inference
inputs = processor(images=image, return_tensors="pt")
outputs = model(**inputs)

# Get results
predicted_class_idx = outputs.product_logits.argmax(-1).item()
predicted_product = model.config.id2label[predicted_class_idx]
predicted_quality = outputs.quality_score.item()

print(f"Predicted Product: {predicted_product}")
print(f"Predicted Quality Score: {predicted_quality:.2f}")
```
