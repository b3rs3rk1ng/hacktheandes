# Independent external test: Cocoa Diseases (YOLOv4)

Review date: 2026-10-18. This review fetched only HTTP metadata/ranges, class files, a ZIP index and two JPEG headers. It did not train a model, access laptop, or download a full image/archive in Mac.

## Verified public access and format

Original dataset: https://www.kaggle.com/datasets/serranosebas/enfermedades-cacao-yolov4

Unauthenticated, public download URL tested with GET and Range:

https://www.kaggle.com/api/v1/datasets/download/serranosebas/enfermedades-cacao-yolov4?datasetVersionNumber=2

It redirects to a signed public Google Storage URL; use the stable Kaggle URL, not the expiring redirect. Observed HTTP 206, Accept-Ranges bytes, total size **1,671,357,375 bytes**, ETag `560b2b3bf79e580a28f025cd4789c8a4` (not independently verified as a content checksum). `original-zip-index.json` contains the actual archive directory: **627 entries = 312 JPEG + 312 sidecar TXT annotations + 3 classes.txt**. Images/labels are adjacent, e.g. `Enfermedades Cacao/Fito/Fito1.jpg` and `Fito1.txt`.

All three original `classes.txt` files were read through ZIP ranges and agree, including order:

| Original YOLO ID | Original name | Export ID/name | Role |
|---|---|---|---|
| 0 | Fitoftora | 2 / phytophthora | Other disease |
| 1 | Monilia | 1 / monilia | Target disease |
| 2 | Sana | 0 / healthy | Apparently healthy label |

The labels contain **per-object classes**, not one class per folder. For example, `Sana1.txt` includes class 0, and `Monilia1.txt` contains both class 1 and class 2. Do not derive diagnoses from folder or image names.

Two original JPEG headers (`Fito1.jpg`, `Monilia1.jpg`) show raw dimensions 3120×4160 and EXIF orientation 1. This is not a complete geometry audit; the adapter checks every image and rejects nonidentity EXIF by default. Header results are in `original-jpeg-header-samples.json`.

## Mirror

https://github.com/dataset-ninja/cocoa-diseases/blob/main/DOWNLOAD.md points to a public Supervisely TAR. HTTP GET with Range succeeds (HEAD returned 404), total **1,673,768,960 bytes**. The first 128 KiB contain `meta.json` and genuine per-image annotation JSONs. Format: `all/img/<name>.jpg`, `all/ann/<name>.jpg.json`; rectangle objects with `classTitle`, `points.exterior` and image size. Actual `meta.json` lists `healthy`, `monilia`, `phytophthora`. The mirror conversion source confirms original ID mapping above. `access-probes.json`, `sample_meta.json` and small sampled annotation JSONs preserve evidence.

Prefer the original Kaggle ZIP: it is available, slightly smaller, and preserves original labels. The mirror is the same source dataset, not a second independent benchmark.

## License and attribution

The original Kaggle API (`kaggle_metadata.json`) reports **“Database: Open Database, Contents: © Original Authors”**, last updated 2020-10-23. Dataset Ninja identifies ODbL 1.0. A Roboflow mirror declares CC BY 4.0, but that is not evidence the original image contents were relicensed. Preserve the original source/attribution and do not substitute the mirror's CC BY label. This review does not establish redistribution permission for the image contents; no photos were published.

Authors: Juan Sebastián Serrano Arenas and Camilo Andrés Torres Villamizar. Primary thesis: https://repository.unab.edu.co/handle/20.500.12749/13367

## Adapter

`yolo_to_manifest.py` reads an existing ZIP or directory, without unsafe archive extraction or folder-derived labels. `class_mapping.json` is explicit, configurable dataset metadata. Output directory must be new or empty.

```sh
python yolo_to_manifest.py --zip /path/original.zip --output /path/external-derived --mapping class_mapping.json --max-side 1280
```

Outputs:

- `manifest.json`: list of `{id,image:absolute,split:"test",width,height,boxes:[{class_id,bbox:pixel_xyxy,...}]}` compatible with the project's independent evaluator.
- JPEG copies resized to max-side 1280 (configurable), `labels/test` with normalized YOLO boxes, `instances_test.json` in COCO, explicit class names in `data.yaml`.
- `audit.json`: class counts, all original EXIF orientations, all excluded images/reasons, duplicate pixel hashes and manifest hash. `train: null`; `val` aliases test for library compatibility only. Never fit checkpoint/threshold on this dataset.

By default (`--box-tolerance 0`) boxes are not clipped. An explicit normalized boundary tolerance, e.g. `--box-tolerance 1e-6` for six-decimal YOLO rounding, permits only boundary excursions within that tolerance to be clamped to [0,1]. Every repaired box records the original and repaired normalized XYXY, tolerance, source image and line in `audit.json` and its manifest box. Nonfinite, unmapped, zero-area or annotations beyond the declared tolerance cause an explicit whole-image exclusion (default) or failure (`--invalid-image fail`). This may reduce the usable sample; report exclusions. No individual annotations are silently discarded. Nonidentity EXIF requires declaring reviewed `--box-frame raw` (transform box corners with EXIF) or `--box-frame display` (annotations already refer to displayed pixels). Default `require-unoriented` refuses to guess.

Boundary fixtures also passed: exact upper edge 1 without repair; 1+0.5e-6 repaired with tolerance 1e-6; strict default, 1+2e-6 and zero-area boxes rejected. Compilation and two tiny ZIP fixtures passed: configurable source/target remapping, pixel XYXY export, resize, raw-frame orientation 1 and 90-degree orientation 6. These tests verify adapter mechanics, not the original dataset's diagnostic truth. Inspect sampled overlays after conversion.

Use only as frozen external test. Keep Phytophthora as a distinct third class and report Monilia false positives on it. Our four-stage model predictions can be remapped as healthy→healthy and m1/m2/m3→monilia; do not pretend it can name Phytophthora. The separate source, collection era and provenance strengthen transfer evaluation, but overlap/duplicate audits remain required.
