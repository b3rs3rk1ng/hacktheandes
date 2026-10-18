---
language: id
license: apache-2.0
metrics:
- accuracy
---

# Model yazidsupriadi/fruits-vegetables-diseases

This model is a ResNet18 model trained to classify diseases in vegetables and fruits.

## Training

- **Dataset**: Custom Fruits and Vegetables Disease Dataset from Kaggle
- **Model**: ResNet18
- **Optimizer**: SGD with learning rate 0.001 and momentum 0.9
- **Classes**: 28
- **Batch Size**: 32
- **Epoch**: 5
- **Optimizer**: SGD with learning rate 0.001 and momentum 0.9
- **Loss Function**: CrossEntropyLoss

## Training Results per Epoch

Epoch 1: Loss = 0.0101, Accuracy = 95.41%
Epoch 2: Loss = 0.0051, Accuracy = 97.05%
Epoch 3: Loss = 0.0029, Accuracy = 97.82%
Epoch 4: Loss = 0.0016, Accuracy = 97.66%
Epoch 5: Loss = 0.0012, Accuracy = 98.00%


## Evaluation

- **Accuracy**: 98.00%
