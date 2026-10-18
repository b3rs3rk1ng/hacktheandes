# Frozen sampled external holdout — 2026-10-18

The complete Mendeley archives downloaded too slowly from laptop. Instead of waiting hours or selecting a convenient prefix, `sample_remote_rar.py` uses the RAR5 **Quick Open directory** to enumerate the complete declared image population and then download an explicitly frozen stratified sample.

Format authority: [RARLab RAR 5 specification](https://www.rarlab.com/technote.htm). The mechanism is general: public HTTP Range access, a valid RAR5 Quick Open locator, complete cached headers, single-volume unencrypted non-solid entries. It does not depend on dataset names or image-folder diagnoses.

## Fixed plan, written before image inference

- Seed **20261019**, provided explicitly by the parent task.
- Uniform random sampling without replacement within the two **author-declared image classes**.
- Exactly **200 healthy + 200 Monilia images**, drawn from all **842 healthy + 1,342 Monilia** directory entries.
- Source image/header ranges total **1,598,776,569 bytes**, below the authorized 2 GB budget.
- `sample-downloads/sampling-plan.json` SHA256: `0e3e04711291d608c8ca1121dc2713499d3a3651339867b607fa75b0ce165b87`.
- Whole source cohort remains reserved for external test, including unsampled images. No fitting, checkpoint selection, or threshold selection on these images.

The original filename dates identify eight class/date groups in the selected sample: healthy 20250125/20250325/20250426/20250518/20250524; Monilia 20250501/20250502/20250523. These are capture-date proxies, not farm or pod IDs. Sampling is stratified by class, not by date; groups are recorded for clustered reporting. Adjacent frames may share pods. Balanced class sampling does not estimate disease prevalence.

## Integrity and processing contract

1. Read and validate the RAR main header and Quick Open locator with header CRC32.
2. Fetch only the Quick Open tail (about 105/64 KB), check every cached structure CRC and every complete cached file-header CRC. Counts must match the author declarations.
3. Freeze and hash the full index and selected plan.
4. Fetch each selected original header plus packed file bytes. Check the original header is byte-identical to the cached header used for sampling/extraction, as required by RARLab's warning against interpreting a different cached filename.
5. Files use compression methods **0 (234 selected)** and **3 (166 selected)**. For non-solid compressed entries, construct a minimal standalone RAR envelope from the verified original file header/data and decode using system libarchive. Do not silently exclude compressed files or bias sampling toward STORED images.
6. Verify each extracted JPEG's unpacked size and CRC32. Compute its SHA256, decoded/exif-transposed pixel hash, and pHash using the project's existing algorithms.
7. EXIF-transpose, resize to max-side 1280 and save a derivative. Preserve author label provenance and capture-date proxy in the image-level test manifest. Raw source ranges are deleted after each verified derivative/record is committed.

**No full-archive SHA256 is claimed.** It cannot be checked without downloading the full archive. The per-image checks establish the integrity of the selected archived content against its checked directory/header CRCs, not pathogen diagnosis. The declared full-archive SHA256 is retained as source metadata only, with `verified:false`.

## Outputs and execution

```sh
PYTHONPATH=/path/to/local-dependencies python sample_remote_rar.py --config mendeley_files.json --output sample-downloads --seed 20261019 --per-class 200 --workers 8 --max-side 1280
```

`--index-only` writes the full indexes and frozen plan without downloading source images. Resume uses per-image records plus derivative files; a changed plan requires a new destination. `--range-engine` can point to the existing shared `fetch_parquet.py` range/retry implementation.

Outputs under `sample-downloads/`: `indexes`, `sampling-plan.json`, `records`, `images/test`, final `manifest.json`, `audit.json`, and progress log. The manifest has absolute local image paths plus `image_relative`, so paths can be rewritten explicitly after copying derivative images to laptop. It contains image-level labels and **no invented bounding boxes**.

Source-size or throughput observations are not drone-performance evidence. The previously observed class/background confounding remains: one inspected Monilia image showed a harvested pod on black cloth while a healthy image showed several pods on a tree. Evaluate this as an auxiliary independent image-label sample, with clustered uncertainty and development-source overlap checks. Do not report object mAP, fruit recall, flight robustness or independent-pod accuracy.

Verification: seven synthetic header-contract fixtures pass; real selected method-0 and method-3 images passed original-header equality, unpacked CRC32, JPEG decoding, EXIF 6 and resize before the complete sample download began.

## Completed artifact

All **400/400 selected images completed**, with 200 per class, and every selected original header equality plus unpacked CRC32 check passed. The 400 decoded pixel hashes are distinct (near duplicates still require clustering). Derived JPEG assets occupy **204,869,033 bytes**; source-range cache is empty. No full source archives were downloaded on Mac.

- Original local `sample-downloads/manifest.json` SHA256: `955dfa4f110101d82a91142934a6ba1433681d64d78324c5d549ac358467f20a`.
- Portable `sample-downloads/manifest-laptop.json` SHA256: `efd8a8e494e48ee014b59a179831e62003faf076e106a88174a6bd93b28153c6`.
- Portable image root: `/home/f3mt0/hacktheandes-cacao-improvement/data/mendeley-sample`.

The generic `research/cacao-improvement/rebase_manifest.py` changed only each record's declared `image` path. IDs, labels, original image/source paths, checksums, groups and the frozen sampling plan remain intact. The final manifest, sampling plan, complete indexes, per-image records and JPEG derivatives can be copied together; no 1.6 GB of source payload remains in the delivery directory.
