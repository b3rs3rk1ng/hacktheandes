---
widget:
  - src: >-
      https://example.com/path_to_your_image.jpg
    example_title: Example Image
---

# Detect Healthy and Rotten Fruits

This model classifies images of fruits and vegetables as healthy or rotten.

## Example Usage

```python
from transformers import pipeline

classifier = pipeline(model="Rodanciu/detect-healthy-rotten-fruits")
result = classifier("path_to_your_image.jpg")
print(result)