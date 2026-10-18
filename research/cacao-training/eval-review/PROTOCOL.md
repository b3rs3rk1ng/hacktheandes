# Independent evaluation review — cacao / visible moniliasis

Date: 2026-10-18. Scope: protocol review and small public metadata requests only; no GPU, training, remote changes or image dataset download performed by this review.

## What the training can establish

The proposed detector has four visible-symptom classes: `h0` (apparently healthy), `m1` (humps), `m2` (brown/oily spots), `m3` (sporulation). An RGB model cannot certify absence of infection before visible symptoms, diagnose all cacao diseases, localize a safe cut, or establish safe autonomous flight/collection. “Healthy” in the report should mean **without annotated visible symptoms**, not pathogen negative.

## Frozen internal test

1. Audit image/label counts, class IDs, empty labels, nonfinite/out-of-range/zero-area boxes; examine annotations on a deterministic random sample. Compare dataset paper, original Zenodo and downloaded archive; the AgML repack reports different counts/classes and must not be silently mixed with the original.
2. Group exact duplicates by SHA-256 before splitting; preferably also cluster near duplicates by perceptual hash and inspect nearest pairs. Preserve capture/tree/parcel groups if available. Stratify groups, not images, into approximately 70/15/15 train/val/test. Record seed, manifest hashes and counts. Without capture metadata, image-split independence is limited even after duplicate checks.
3. Train and choose checkpoint on validation only. Choose one operating confidence threshold on validation before opening test results. Do not tune threshold or crop selection against the test set.
4. Report native four-class AP50, AP50-95, class P/R/F1 and confusion matrix, with the number of GT instances per class. Highlight `m1` separately: good late-sporulation detection is not evidence of early detection.
5. Additionally remap ground truth and predictions to `h0` vs `symptomatic={m1,m2,m3}` **before** one-to-one IoU >= 0.5 matching. Use fixed threshold, descending-confidence matching and count unmatched GT as FN / extra detections as FP. Report binary AP separately if implemented; do not label classification accuracy as detection mAP.
6. Report symptomatic recall, symptomatic precision, and healthy GT pods falsely assigned symptomatic per 100 healthy GT pods. Include missed pods, other wrong classes and duplicate predictions; do not evaluate only successful detections/crops.
7. Provide Wilson confidence intervals for binomial rates, or bootstrap whole image/capture groups for interval estimates. A small test is a prototype estimate, not a stable field guarantee.

## Motion-related stress test

Use the identical frozen test set, labels and confidence threshold. Apply separately: linear motion-blur kernels 5/11/21 pixels (several deterministic directions), brightness 0.6/1.4 and downscale to 50% then resize. Keep boxes unchanged for photometric blur/brightness; preserve exact geometry for resizing. Report each corruption severity and delta from clean AP50 and symptomatic P/R. These are **synthetic corruption tests**, not a drone video benchmark, temporal tracking evaluation or proof of flight robustness. Do not count multiple corruptions of one image as independent examples in confidence intervals.

For batch-1 latency report warmup, GPU synchronization, device, image resolution, precision, p50/p95, measured boundaries and memory. Model forward excludes camera capture, radio transport, decode/preprocessing, NMS, planning and flight; do not advertise its reciprocal as full-system FPS.

## Stronger external test candidate

**Cocoa Diseases (YOLOv4), Serrano / UNAB, released 2020.** Different collection era/origin than CocoaMoniliaDataSet (2024–25). The original thesis describes annotated natural-setting cocoa images for Monilia, Phytophthora and healthy pods. Public metadata lists 312 images; a dataset mirror reports 1,591 boxes. This is more appropriate for detector validation than Bagua folder labels without reviewed boxes, but still requires overlap audit and annotation checks.

- Original dataset: https://www.kaggle.com/datasets/serranosebas/enfermedades-cacao-yolov4
- Primary thesis: https://repository.unab.edu.co/bitstream/handle/20.500.12749/13367/2020_Tesis_Juan_Sebastian_Serrano_Arenas.pdf
- Public metadata API tested successfully: https://www.kaggle.com/api/v1/datasets/list?search=enfermedades-cacao-yolov4
- Public file listing API tested successfully: https://www.kaggle.com/api/v1/datasets/list/serranosebas/enfermedades-cacao-yolov4 (paginated; first page alone is incomplete).
- Secondary mirror with boxes/download instructions: https://github.com/dataset-ninja/cocoa-diseases ; https://datasetninja.com/cocoa-diseases
- Roboflow mirror: https://universe.roboflow.com/home-fbwrm/cocoa-diseases-cq5jt ; 312 images / 3 classes, no trained models at review time. It is a mirror, **not another independent dataset**.

Kaggle API reports `Database: Open Database, Contents: © Original Authors`, 1,671,357,375 bytes, last update 2020-10-23. Dataset Ninja calls it ODbL 1.0, whereas Roboflow mirror displays CC BY 4.0. Preserve original attribution/terms and flag the discrepancy; do not assume the uploader can relicense all image contents.

Freeze this dataset as external test, do not add it to training before initial external metrics. Remap predicted `m1/m2/m3` to Monilia because external annotations have no symptom stages. Retain Phytophthora as **other disease**; report Monilia false positives on these boxes separately. It must not silently become “healthy” or “Monilia” ground truth. Report Monilia and healthy detection metrics for eligible boxes with a clearly declared policy for other-disease boxes; do not count ignored regions as ordinary background.

## Other candidate, classification only

The Mendeley primary record “Image Dataset of Healthy and Monilia-Infected Cocoa Pods for Disease Classification” (2026-10-08) declares 2,184 images, 1,342 infected / 842 healthy, CC BY 4.0:
https://data.mendeley.com/datasets/ykbtpsyfv9/1

It is not a ready bounding-box benchmark. Source independence, actual files, duplicate overlap and labels still need auditing. Do not use its folder-label totals as object-level ground truth.

## Primary training sources

- Original record: https://zenodo.org/records/17716661
- Dataset paper: https://pmc.ncbi.nlm.nih.gov/articles/PMC12834835/
- Authors' repository: https://github.com/joanfco30/CocoaMoniliaDataSet

The paper declares 1,953 JPGs / 2,123 instances: h0 754, m1 442, m2 416, m3 511; four classes and COCO/YOLO/masks, smartphone capture at two Colombian locations. The AgML HF repack instead says 1,950 / 2,159 / five categories: https://huggingface.co/datasets/Project-AgML/cocoa_monilia_detection . Determine counts from the downloaded artifact and report that exact version rather than treating these as interchangeable.

## Why Bagua remains secondary

`research/bagua-validation/REPORT.md` and `evaluate.py` confirm 73 exact-byte-unique images (50 diseased / 23 healthy), ordered public folder sampling, no boxes or independent per-image diagnostic verification, visually similar images, and a full-photo vs crop domain shift. A detector can produce qualitative overlays here; quantitative object P/R requires reviewed boxes. Its folder-level labels alone do not establish detector misses or false positives per fruit.
