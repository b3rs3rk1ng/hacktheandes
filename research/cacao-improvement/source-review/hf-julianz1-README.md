---
dataset_info:
  features:
  - name: id
    dtype: int32
  - name: image_id
    dtype: string
  - name: image
    dtype: image
  - name: image_name
    dtype: string
  - name: width
    dtype: int32
  - name: height
    dtype: int32
  - name: annotations
    sequence:
    - name: label
      dtype: int32
    - name: x_center
      dtype: float32
    - name: y_center
      dtype: float32
    - name: width
      dtype: float32
    - name: height
      dtype: float32
  splits:
  - name: train
    num_bytes: 6291816757.022
    num_examples: 4423
  - name: validation
    num_bytes: 1563211048.426
    num_examples: 1106
  download_size: 7822915368
  dataset_size: 7855027805.448
configs:
- config_name: default
  data_files:
  - split: train
    path: data/train-*
  - split: validation
    path: data/validation-*
---
