# Independent review of `prepare_dataset.py`

Reviewed 2026-10-18 while the parent agent prepared the training pipeline. No parent-owned code was edited by this audit task.

Changes requested before training:

1. **Normalize EXIF orientation on input and output.** Reading only `Image.open(...).convert('RGB')` allows square orientation-6 originals to pass dimension checks with a 90-degree mismatch between RGB and labels. `/rows` assets are normalized, but raw parquet bytes need an explicit verified contract. `ImageOps.exif_transpose` is the general image-input solution.
2. **Propagate every capture day when merging duplicate rows.** Taking only the first record's date can lose a known date when its first alias is `m0 (95).jpg`, or discard a second known date. Grouping must link all dates attached to an exact-image group.
3. **Prevent stale output from previous preparations.** Creating existing image/label folders and writing a new manifest leaves old files available to YOLO. Require a fresh output directory, fail if it already contains outputs, or rebuild only the pipeline-owned output paths before writing a new split.

Verified implementation choices:

- Category resolution uses original COCO category names rather than source directory names.
- Repeated COCO file names collect annotations instead of replacing earlier IDs.
- Unknown categories exclude the full duplicate-image group.
- Exact-image annotations are unioned, and contradictory overlapping categories exclude the group.
- Geometry rejects non-finite, non-positive, or out-of-image boxes rather than inventing a correction.
- Perceptual groups and entire capture days are assigned as units, with class coverage checked.
- Annotation boxes scale with image dimensions before YOLO normalization.

Source evidence for the conflict check is in `label_conflict_audit.json`: nine cross-class high-IoU pairs, zero h0-versus-symptomatic pairs, and no duplicate-group dimension conflicts using original CRC/size identities.
