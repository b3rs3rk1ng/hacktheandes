---
dataset_info:
  features:
  - name: image
    dtype: image
  - name: objects
    struct:
    - name: bbox
      list:
        list: float64
    - name: categories
      list:
        class_label:
          names:
            '0': '0'
            '1': '1'
            '2': '2'
            '3': '3'
            '4': '4'
  - name: treatment
    dtype: string
  splits:
  - name: train
    num_bytes: 2459441898
    num_examples: 1950
  download_size: 2667825999
  dataset_size: 2459441898
configs:
- config_name: default
  data_files:
  - split: train
    path: data/train-*
---
# Cocoa Monilia Detection

This dataset contains real RGB images of cocoa plants exhibiting monilia disease symptoms, collected in field environments across two Colombian locations. Images were captured using a variety of handheld smartphones during the September 2024 to February 2025 collection period, providing diverse natural lighting and environmental conditions for agricultural disease detection research. The dataset contains 1,950 images with 2,159 bounding box annotations across 5 categories.

This dataset is indexed on https://project-agml.github.io/ as part of the AgML python library.

## Citation

```bibtex
@article{alvarado2026cocoamoniliadataset,
  title={CocoaMoniliaDataSet: A cocoa pod dataset to detect and classify Monilia roreri in real conditions},
  author={Alvarado, Joan and Restrepo-Arias, Juan Felipe and Velásquez, David and Branch-Bedoya, John W. and Maiza, Mikel},
  journal={Data in Brief},
  volume={64},
  pages={112447},
  year={2026},
  publisher={Elsevier}
}
```
Alvarado Molina, J. F., Restrepo-Arias, J. F., Velásquez, D., Branch Bedoya, J. W., & Maiza, M. (2025). CocoaMoniliaDataSet [Dataset]. Zenodo. https://doi.org/10.5281/zenodo.17716661

*This dataset was reformatted from its original format to match HuggingFace standards.*
