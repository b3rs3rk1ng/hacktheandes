# PhytNet / CocoaNet pretrained-weight review

2026-10-18. Scope: primary author repository, OSF APIs/wiki and a 4 KiB ONNX tail. No full checkpoint download, model execution, GPU work or laptop mutation.

## Result

**No modern PhytNet cacao checkpoint meeting the requested ready-to-use, explicit-license criteria was verified.** The public author code defines/trains PhytNet and reports research results, but the inspected GitHub tree contains no PhytNet `.pt/.pth/.onnx` artifact. The OSF node has no public child projects and its published model folder contains older CocoaNet/ResNet/ConvNeXt files, not named PhytNet weights.

## Older downloadable candidate, with material gaps

Author OSF folder: https://api.osf.io/v2/nodes/2fw6g/files/osfstorage/63c160368af022025962fbc4/

| Artifact | Bytes | Versioned download |
|---|---:|---|
| CocoaNet18_DN.onnx | 44,703,761 | https://osf.io/download/2jdep/?revision=1 |
| CocoaNet18_DN.pth | 44,806,029 | https://osf.io/download/63c16060fe62d402633c9900/?revision=1 |
| CocoaNet50_DN.onnx | 93,986,516 | https://osf.io/download/63c16064e16c4801e4dc926e/?revision=1 |

For the 18-layer ONNX, OSF reports SHA256 `c9fa8b1cb2f2be342d8c168c3b419b56015ea020ea6436941a1e8088e8b22b05`. This review read only the final 4 KiB, so **did not verify the full content SHA256**.

### Chronology and training provenance

The OSF ONNX version API lists one version, created **2023-01-13 13:45:15**, matching the file's created/modified timestamps. This materially predates our Mendeley sample's 2025 image dates and 2026 publication. It is strong chronology evidence against training on these newly published photographs, subject to the reliability of source metadata and a normal overlap audit; it is not a full training-data manifest.

However, the author's own [OSF wiki](https://api.osf.io/v2/wikis/buvdw/content/) states that `cocoa_disease_images.tar.gz` contains images **scraped from the internet**, while `EcuadorCocoa_EasyDificult.tar.gz` adds approximately 7,000 Ecuador photographs. The old 2023 checkpoint's exact training manifest is not published. It must not be described as the newer PhytNet field-trained checkpoint. Serrano/Vivo and web overlap remain possible in any development comparison; it is not an independent benchmark dataset.

### Classes and preprocessing

The real ONNX tail's tensor metadata encode **input float32 [1,3,750,750], output [1,6]**. Thus it is a six-class image classifier, not a verified two-class Monilia/healthy model. The tensor does not provide class-name metadata. The [author ONNX evaluator](https://github.com/jrsykes/CocoaReader/blob/main/Eval/onnx_eval.py) uses `Resize((750,750))`, `ToTensor()` and ImageFolder's sorted class order, printing names from a local dataset directory; it does not publish that frozen six-class mapping. A small range read of the older dataset confirms a `NotPlant` class, but does not establish all six output meanings.

Do not guess an FPR or healthy index from the newer four/five-class article. A semantically incorrect output mapping would invalidate evaluation.

### License

The PhytNet subfolder README claims MIT for the project, but its linked `CocoaNet/LICENSE` target returned 404; root `LICENSE` also returned 404, and the GitHub repository API reports `license:null`. The OSF node reports `node_license:null`. No explicit license statement for the published trained weights was verified.

Therefore **publicly downloadable at no charge is verified; clearly licensed for reuse/redistribution is not**. Do not apply the article's Creative Commons terms or the code README's MIT claim automatically to the OSF weights.

## Fit to current experiment

CocoaNet18 could become a separate historical CPU baseline if the exact class mapping, checkpoint provenance and weight-use terms are resolved. It cannot directly initialize an EfficientNet-B0: these are different architectures and tensor layouts. The current EfficientNet-B0 ImageNet initialization plus a newly trained three-class head is already the straightforward compatible transfer setup. No demonstrated pretrained replacement from this review justifies changing that run mid-training.

No industrial daily-use or drone robustness claim is documented for these artifacts. Published research metrics do not establish performance on our frozen Mendeley image-label sample.

## Evidence retained

- `osf-models-v1.json`: complete nine-file model-folder metadata.
- `checkpoint-model18-versions.json`: unique dated version.
- `checkpoint-osf-wiki.md`, `checkpoint-osf-children.json`.
- `checkpoint-repo-metadata.json`: license metadata.
- `checkpoint-source_*`: author README/evaluation/export snippets.
- `checkpoint-model18-onnx-tail.bin`: bounded real tensor-metadata probe.
