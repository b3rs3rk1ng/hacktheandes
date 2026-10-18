# New external cohort: Mendeley ykbtpsyfv9 v1

Inspected 2026-10-18. This is a new candidate holdout; do not train or tune thresholds on it. Serrano/Kaggle was already inspected and may now enter development; it cannot serve as independent test again.

## Verified publication and access

Original: https://data.mendeley.com/datasets/ykbtpsyfv9/1

Title: Image Dataset of Healthy and Monilia-Infected Cocoa Pods for Disease Classification. Published 8 October 2026, version 1, DOI 10.17632/ykbtpsyfv9.1. Authors Diego Rengifo-Lozano and Jhosep Sánchez-Flores declare **2,184 labeled images: 1,342 Monilia and 842 healthy**, under **CC BY 4.0**. DataCite lists both authors at Universidad Nacional de San Martín, Peru; this affiliation alone does not prove collection location. The description does not establish farm IDs, dates, diagnostic protocol or prior-dataset overlap. See `datacite.json`.

Two files were observed directly through the public browser record and probed via HTTP ranges, without credentials:

| File | Exact bytes | Stable public download |
|---|---:|---|
| Monilia.rar | 5,710,821,257 | https://data.mendeley.com/public-files/datasets/ykbtpsyfv9/files/c090101b-7718-43fa-a4fb-f1f6604b338c/file_downloaded |
| Sanos.rar | 3,143,246,055 | https://data.mendeley.com/public-files/datasets/ykbtpsyfv9/files/48c379b8-dd3d-42e8-97f6-85b97cca0f3b/file_downloaded |

Both redirect to public EU-west-1 S3 objects, return HTTP 206 and support byte ranges. The exact resolved URLs, sizes and SHA256 checksums displayed by Mendeley are recorded in `mendeley_files.json`. Total **8,854,067,312 bytes**. The multipart S3 ETags are not content MD5 checksums.

Some initial page/API requests returned 403, and guessed legacy dataset API routes are not valid endpoints. The actual observed public-file links work. No login/API key is needed. `download-probes.json` preserves the requests and response headers.

## Actual archive/images inspected

The first 64 KiB of each archive identify RAR 5 with the first file **non-solid, compression method 0 (stored)**:

- `Monilia/20250501_152430.jpg`, 3,739,587 bytes, data offset 95.
- `Sanos/20250125_090440.jpg`, 3,803,983 bytes, data offset 93.

The first complete JPEG in each archive was fetched by its known byte range only, decoded and visually checked. Both have raw dimensions 4000×3000 and EXIF orientation 6. These samples do not establish the contents of the whole archive.

**Critical domain limit:** the first Monilia sample is a harvested pod placed on black cloth; the first healthy sample shows several pods on a tree. A class-dependent background/capture setup may confound image classification. The dataset is not yet verified as an in-orchard/drone benchmark. No bounding boxes are declared or observed. Image-level labels do not identify every pod in a multi-pod scene.

No source RGB photos were added to this repository; temporary previews remain outside the project. Small RAR-header samples and metadata support these observations.

## Configurable downloader

`fetch_files.py` reuses the existing common HTTP-range implementation in `research/cacao-training/download-review/fetch_parquet.py`: concurrent ranges, resumable chunks, bounded retries, exact range checks and SHA256 verification. It accepts arbitrary declared file URLs/sizes/hashes; no dataset-specific behavior lives in the engine. Dataset metadata is isolated in `mendeley_files.json`.

```sh
python fetch_files.py --config mendeley_files.json --output /data/new-external-archives --workers 8 --chunk-mib 32 --range-engine /path/to/fetch_parquet.py
```

During assembly it needs room for the archives plus temporary parts. It deletes parts after each verified file unless `--keep-parts` is explicit. Do not run a second full download in parallel with an existing curl copy of the same files.

## Streaming extraction and frozen manifest

`extract_image_archives.py` uses `libarchive-c` with system libarchive to stream images directly into resized derivative JPEGs. It does not unpack 8.85 GB of raw images. Dependencies: `Pillow numpy scipy libarchive-c`. Source archives remain untouched.

```sh
python extract_image_archives.py --config mendeley_files.json --archives /data/new-external-archives --output /data/new-external-test --max-side 1280
```

Labels come exclusively from the explicit per-archive author metadata in the configuration, not guesses from member folder names. The extractor verifies archive SHA256, handles EXIF transpose, checks expected image counts, rejects unsafe paths, bounds per-image memory, and refuses an output directory containing prior files.

`manifest.json` contains `{id,image:absolute,split:"test",label_class_id,label_name,label_source,source_archive,source_image,source_sha256,pixelsha,phash,capture_group,...}`. All rows are TEST. It supplies no invented object boxes. `audit.json` records totals, EXIF, image groups, pixel duplicates, metadata members and hashes. `pixelsha` and `phash` use exactly the same algorithms as the existing CocoaMonilia preparation script, enabling source-overlap checks. The declarative capture-group regex groups dated filenames; it does not prove farm or fruit identity.

Before evaluation compare pixel hashes and pHashes against **all** development sources (CocoaMonilia, Serrano and any Bagua used for fitting). Resolve/remove overlaps with a fixed rule before inspecting predictions. Report grouping limits, class/background confounding and image-level precision/recall only. Do not report object mAP, fruit-count recall, diagnostic certainty, airborne robustness or guaranteed loss prevention from these labels.

Verification: Python compilation; a tiny archive stream fixture passed explicit label metadata, filename-date grouping, SHA256, EXIF 6 transpose, resize and pHash generation without object boxes. Downloader uses the already tested shared range engine. No laptop/GPU changes or full-dataset Mac download occurred.
