# Development mix and evaluation boundaries

The builder reads the existing normalized-image manifest contract: absolute or manifest-relative `image`, `id`, `width`, `height`, `split`, and `boxes` with pixel XYXY coordinates and integer `class_id`. Target categories and source mappings are declared in `mixed_config.json`. Existing preparation helpers (`UnionFind`, perceptual hash and IoU) are imported with `--helpers`; the source training pipeline is not modified.

```sh
python build_mixed_dataset.py \
  --config mixed_config.json \
  --output /home/f3mt0/hacktheandes-cacao-improvement/data/mixed-v2 \
  --helpers /home/f3mt0/hacktheandes-cacao-training/prepare_dataset.py
```

The shipped config is deliberately deployment-relative: its two manifests point from `/home/f3mt0/hacktheandes-cacao-improvement/` to the existing `/home/f3mt0/hacktheandes-cacao-training/data/` directories. Change these declarative paths when running elsewhere.

## Data roles

- CocoaMonilia source: preserve original train/validation partitions; map the old test partition to **regression**. Do not train on its images.
- Serrano/Torres source: use the corrected **312-image** manifest `external-v2`, not the earlier 298-image conversion. It contains 1,591 objects: 1,219 healthy, 145 Monilia and 227 Phytophthora. It was previously inspected/evaluated; it is now explicitly **development data**.
- The newly located Mendeley dataset is absent from the builder configuration. It must remain outside fitting, threshold selection and model selection if it is to serve as a fresh evaluation.

Neither the new mixed validation cohort nor the legacy regression cohort is a new independent test. Report them by source as development/regression evidence. Select all model and action thresholds on development validation before running a fresh test.

The final evaluator also forms global transitive similarity components across reference and benchmark images. It excludes every benchmark component connected to a reference and keeps the first non-conflicting representative of benchmark-only components. This may reduce the final benchmark count below the original split count; every excluded ID and reason is recorded. The original checkpoint is recalibrated on the same mixed validation policy as the new candidates before comparison.

## Labels and ambiguity

CocoaMonilia `h0` maps to healthy, while `m1/m2/m3` map to Monilia. This merges documented symptom stages; it does not assert a laboratory diagnosis or latent-infection detection. `h0` means no visible symptoms, and early `m1` humps may be subtle. Confusion between the two can be annotation or visibility uncertainty as well as model error. Preserve stage metadata to report performance for `m1` separately even when training a three-class model.

Serrano categories come from the original per-object class mapping, not folder names. Its healthy annotations include numerous small/distant pods. A classifier trained on crops large enough to show symptoms has a different operating population from a detector evaluated over every annotated pod. The ROI exporter therefore records exclusions below the declared 32-pixel minimum side; these exclusions must not disappear from end-to-end detector metrics.

Original category disagreements between symptom stages were already excluded by the CocoaMonilia preparation. The mixed builder unions exact-image annotations after remapping and excludes contradictory high-overlap target labels. It never relabels a specimen based on its source name.

## Group boundaries

The builder recomputes hashes from decoded, EXIF-normalized RGB pixels, links exact image identities across all sources, preserves existing source groups, and links perceptual hashes within the configured Hamming distance. These are **similarity families**, not farm/tree IDs or verified camera bursts. Sequential Serrano file names such as `Sana1.jpg` and `Sana2.jpg` are not evidence of a shared plant/session, so they are not used as identity.

Any family intersecting the protected regression partition is excluded from new train/validation. If a new similarity link joins incompatible original train/validation partitions, that linked family is excluded rather than moved across the preserved boundary. Remaining Serrano families are assigned as whole groups to 80/20 train/validation, balancing image and category counts. Exact pixels and group identities must be disjoint across output partitions.

`audit.json` records all similarity edges and exclusions. Actual Serrano group counts require reading the image pixels during preparation; the local evidence manifest alone does not contain perceptual hashes. No source-specific grouping identity is invented to fill that gap.

## Export and augmentation contracts

`disease/` exports three-class YOLO images/labels; `pod/` optionally collapses each annotated object to `pod`. Images are symlinks to existing normalized originals or newly generated augmentation JPEGs; originals are never modified. In both YAMLs, `test` points to the explicitly named **regression** image directory for tool compatibility.

Exactly one configured brightness/motion-blur variant is generated per original training image, deterministically from image identity and seed. No variant is created for validation or regression, and all variants retain their parent's group and boxes. This is a synthetic robustness exercise, not validation of camera motion or real flight.

`roi/manifest.json` contains full-frame absolute `image`, original pixel `bbox`, class/split/group, parent/source image identity and original stage metadata. It records context 0.1 and minimum side 32; it does not crop/re-pad images by default. Training and inference must apply the same ROI helper. `write_images:true` is an optional debugging export, and its saved crop path is separate from the full-frame `image` field.

Ground-truth ROI classification measures classification given correct localization. A deployed detector-plus-classifier must also be evaluated end to end on predicted boxes, including missed pods, false boxes and an explicit abstention rule. Crop metrics alone cannot establish that architecture is superior.

## Verification

`test_mixed_dataset.py` runs a complete small synthetic preparation using the shared helpers and the real exports. It verifies label mapping and stage retention, source groups, old-partition preservation, cross-source protected-image exclusion, exact-image annotation union, unknown-image exclusion, training-only augmentation, ROI references, single-class pod export and refusal to overwrite stale outputs. It does not assess diagnostic accuracy.
