# CocoaMoniliaDataSet audit

Audit performed 2026-10-18. Metadata, four COCO annotation files, and selected JPEG samples were inspected; the 6.2 GB original dataset was not downloaded by this audit task.

## Sources and license

- Original dataset, version 2: <https://zenodo.org/records/17716661>
- Machine-readable record: <https://zenodo.org/api/records/17716661>
- Author repository: <https://github.com/joanfco30/CocoaMoniliaDataSet>
- Dataset paper: <https://doi.org/10.1016/j.dib.2025.112447>
- Mirror: <https://huggingface.co/datasets/Project-AgML/cocoa_monilia_detection>, revision `07aeef939a7009fc13202a812185607772759f2d`.
- Zenodo and author README specify **CC BY 4.0**. Model/framework licensing is a separate issue.

`index.json` and `zip_directory.json` contain the ZIP central directory: name, uncompressed size, compressed size, CRC32 and local-header offset. The four `instances_*.json` files are the original annotation documents. Metadata extraction via HTTP ranges transferred approximately 2.5 MB.

## Actual schema and discrepancies

COCO bounding boxes are `[x, y, width, height]` in the coordinate system described by `images[].width/height`. Polygon segmentations and an `occluded` attribute are present. Every `date_captured` field is `0`; COCO contains no farm, tree or capture-session identifier. All sampled `occluded` values in these files are false, so that field does not substantiate evaluation under occlusion.

Actual categories, according to `categories[].name` and counted in all original annotations:

| COCO ID | Name | Raw annotation count | Documented meaning |
|---:|---|---:|---|
| 1 | h0 | 754 | No visible Monilia symptoms |
| 2 | m1 | 442 | Humps |
| 3 | m2 | 416 | Brown/oily spots |
| 4 | m3 | 511 | Sporulation |
| 5 | m4 | 39 | **Not defined by the dataset description or README** |

There are **2,162 raw annotations**. The 2,123 described by the authors are exactly the total after subtracting the 39 `m4` annotations. `m4` occurs in 31 source paths, frequently alongside documented classes. A conservative first baseline should exclude the entire image when an unmapped class occurs; removing only the unknown box teaches the model that this visible pod is background. No biological meaning should be assigned to `m4` without clarification from the authors.

Every per-directory COCO document includes multiple categories. **Folder names and the mirror's `treatment` field are not the class of every pod.** Resolve annotation class through `categories[]`, not through the directory.

The ZIP and published splits contain **1,950 image files**. COCO lists 1,953 image entries because `instances_h0.json` repeats three file names under different image IDs:

- `IMG_20240229_004017_751 - copia.jpg`: IDs 284 and 647.
- `IMG_20240229_005546_106 - copia.jpg`: IDs 285 and 648.
- `IMG_20240802_131414 - copia.jpg`: IDs 350 and 649.

Union annotations for the same source file; do not silently replace entries keyed by file name.

## Duplicate images, annotation conflicts and split leakage

The central directory exposes 39 groups with identical CRC32 and uncompressed size, each containing two files. These are strong original-byte duplicate candidates; verify with a cryptographic hash when the originals are available. Thirty-six groups share a basename across class folders; three groups use different basenames (`m0 (95..97).jpg` aliases). Another shared basename, `IMG_20240802_130325.jpg`, has different CRC/size in `h0` and `m2`, so **basename alone is not image identity**.

Twelve CRC/size groups cross published split boundaries: eight train/validation, three train/test and one validation/test. Published splits have 1,560/195/195 paths, with no repeated *full path*, but this does not prevent duplicate-photo leakage.

After combining annotations for a CRC/size group, nine annotation pairs of different classes have IoU >= 0.8. Eight are disagreements between symptomatic stages; one is `m3` versus undocumented `m4`. None of these high-overlap pairs is `h0` versus a symptomatic class. See `label_conflict_audit.json`. Excluding groups with contradictory labels is an explicit conservative baseline policy.

The author notebook uses `random.shuffle` without a fixed seed, stratification, or capture grouping. It copies files to split folders by basename, which can overwrite images or labels. Do not reuse that splitter. Its default `model.val()` call is a validation evaluation, not a documented held-out test or drone evaluation.

## Mirror geometry: important verified conversion error

Use the mirror's **images** with the **original COCO annotations**. Do not use the mirror's boxes without a separate conversion audit.

Four mirror `/rows` JPEG assets were visually inspected against original COCO overlays, including two non-square images. All four original COCO overlays align with the pods, and the decoded mirror dimensions match COCO dimensions. See `mirror_samples/COCO_overlay_contact_sheet.jpg` and `overlay_checks.json`.

However, the mirror's exported boxes are wrong on sampled non-square images:

| Mirror row | Original source file | COCO box | Mirror exported box |
|---:|---|---|---|
| 1 | h0/IMG_20240928_102531.jpg | 811,412,1655,2981 | 1084.224,308.176,2212.568,2229.788 |
| 19 | h0/IMG_20240928_102812.jpg | 1724,1268,2982,5779 | 2298.664,950.997,3976,4334.25 |

Original JPEG headers were fetched with 128 KiB HTTP ranges to verify the mechanism. Both originals have EXIF orientation 6 and raw dimensions 4000x2992 / 8000x6000. COCO and the correctly oriented mirror assets use 2992x4000 / 6000x8000. The mirror box conversion used raw width/height while the RGB asset applies EXIF transpose. Square samples conceal this width/height error. Mirror `/rows` assets have no EXIF left.

**Normalize input images with `ImageOps.exif_transpose` before computing geometry and before writing training images.** This is a no-op for already normalized assets, and protects raw parquet bytes or original JPEG inputs. Enforce exact decoded-image/COCO dimension agreement. Never apply an inferred transpose solely from a particular file name.

## Grouping that is supported by available evidence

Some original JPEG EXIF headers contain `DateTimeOriginal` and GPS coordinates; the mirror assets strip that metadata. No exhaustive EXIF inventory was performed. Filename dates and 13-digit millisecond timestamps provide **capture-day proxies**, not tree or farm identities. A millisecond timestamp interpreted in UTC is a declared convention, not a verified local capture date.

For this baseline: merge exact-image duplicates and their annotations, propagate **all** known source dates from a merged group, group full capture days, and link perceptual near-duplicates before selecting train/validation/test. Unknown-date files may join a dated group through an exact-image alias or a perceptual link. An unknown date must not be fabricated. Preserve the resulting group identity and check it is disjoint across splits.

The paper describes two Colombian field sites and handheld smartphone acquisition. Without per-file location inventory and drone footage, the resulting baseline is not evidence of unseen-farm, flight-motion, or industrial performance.

## Download volume

The original ZIP is 6,187,303,002 bytes with MD5 `d3531c4a62f3aaff9c146c7a8ae39a6b`. RGB files account for 6,121,457,049 compressed bytes; selecting JPEG entries alone barely reduces the download. The mirror consists of five parquet shards totaling 2,667,825,999 bytes. Recompression can change image hashes, which is why original ZIP identities and decoded-pixel identities serve different purposes.
