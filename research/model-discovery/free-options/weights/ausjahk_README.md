---
library_name: transformers
license: apache-2.0
base_model: microsoft/resnet-18
tags:
- generated_from_trainer
datasets:
- imagefolder
metrics:
- accuracy
model-index:
- name: fruits-fresh-rotten-from-scratch
  results:
  - task:
      type: image-classification
      name: Image Classification
    dataset:
      name: imagefolder
      type: imagefolder
      config: default
      split: train
      args: default
    metrics:
    - type: accuracy
      value: 0.9610270518110958
      name: Accuracy
---

<!-- This model card has been generated automatically according to the information the Trainer had access to. You
should probably proofread and complete it, then remove this comment. -->

# fruits-fresh-rotten-from-scratch

This model is a fine-tuned version of [microsoft/resnet-18](https://huggingface.co/microsoft/resnet-18) on the imagefolder dataset.
It achieves the following results on the evaluation set:
- Loss: 0.1142
- Accuracy: 0.9610

## Model description

More information needed

## Intended uses & limitations

More information needed

## Training and evaluation data

More information needed

## Training procedure

### Training hyperparameters

The following hyperparameters were used during training:
- learning_rate: 0.001
- train_batch_size: 32
- eval_batch_size: 8
- seed: 42
- optimizer: Use OptimizerNames.ADAMW_TORCH_FUSED with betas=(0.9,0.999) and epsilon=1e-08 and optimizer_args=No additional optimizer arguments
- lr_scheduler_type: linear
- num_epochs: 3

### Training results

| Training Loss | Epoch | Step | Validation Loss | Accuracy |
|:-------------:|:-----:|:----:|:---------------:|:--------:|
| No log        | 1.0   | 273  | 0.4614          | 0.8542   |
| 0.4901        | 2.0   | 546  | 0.1885          | 0.9372   |
| 0.4901        | 3.0   | 819  | 0.1142          | 0.9610   |


### Framework versions

- Transformers 5.16.1
- Pytorch 2.11.0+cu128
- Datasets 4.0.0
- Tokenizers 0.23.1
