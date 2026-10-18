# Access/speed follow-up — 2026-10-18

A bounded 1 MiB Range GET at offset 8 MiB from Mac, with two concurrent connections, returned valid 206 ranges:

- Mendeley Monilia S3: 1.874 s, 0.559 MB/s.
- Mendeley healthy S3: 1.888 s, 0.555 MB/s.

Raw results: `speed-range-1mb.json`. These include connection time; they do not establish sustained laptop throughput or linear scaling with 16 workers. No URL cache parameters were needed. Changing to bounded concurrent ranges is plausible; a single slow whole-file connection is not evidence the source lacks bandwidth.

## PhytNet / CocoaNet Ecuador alternative

Primary article: https://pmc.ncbi.nlm.nih.gov/articles/PMC12188622/ (doi 10.1002/aps3.70010).

Public OSF node and file listing APIs work without credentials:

- https://api.osf.io/v2/nodes/2fw6g/
- https://api.osf.io/v2/nodes/2fw6g/files/osfstorage/

The article reports 7,220 cocoa images, of which 258 Vivo images came from Serrano/Kaggle and 409 came from web sources. Its other 6,553 images (Google 1,909; Olympus 1,565; Samsung 3,079) were collected for the Ecuador research. Do not call all 7,220 independent. (Earlier quick arithmetic estimate 6,573 was incorrect; exact subtraction 7,220−258−409=6,553.)

OSF provides a smaller processed archive:

- `Full_cocoa_dataset/EcuadorCocoa_EasyDificult.tar.gz`
- Exact size 658,159,573 bytes.
- Public download: https://osf.io/download/g37kw/
- HTTP Range tested successfully: first 1 MiB in 4.013 seconds including redirects (~0.261 MB/s).
- TAR members start with `EcuadorWebImages_EasyDif_FinalClean_Compress500_split_NotCooca/`, with Easy/Difficult and train/val structures, including FPR, BPR, Healthy, WBD and NotCocoa.
- The observed first image names include original `PXL_2023...` and `M3200033.JPG` camera names preceded by numeric timestamps. There is no verified complete source-provenance mapping yet. Do not infer all source identities from these examples.

The processed archive mixes field images, web/Kaggle contributions and a non-cocoa class. An independent cohort would require explicit exclusion of Vivo/web and source-overlap audit. The OSF node reports `node_license: null`; do not substitute the article's Creative Commons license for an unverified dataset license.

The raw collection is much larger, in four ZIPs:

| File | Bytes | Public download |
|---|---:|---|
| Raw_Ecuador_images_11_03_23_1.zip | 4,203,258,796 | https://osf.io/download/snxup/ |
| Raw_Ecuador_images_11_03_23_2.zip | 3,998,047,941 | https://osf.io/download/8pqez/ |
| Raw_Ecuador_images_11_03_23_3.zip | 4,706,125,567 | https://osf.io/download/2y4a8/ |
| Raw_Ecuador_images_11_03_23_4.zip | 3,869,355,950 | https://osf.io/download/qyxe2/ |

Source metadata are in `osfnode.json`, `osffiles.json`, `osf-full-files.json`, `osf-raw-files.json`. No full archive was downloaded in this review.

## Hugging Face

No Hugging Face mirror was found under the exact Mendeley record ID or PhytNet name. Several unrelated cocoa datasets exist; their names alone do not establish a mirror or independence. `julianz1/cocoa-disease-detection` has 5,529 box-annotated images but no provenance described in its README. `sauriber/cocoa_diseases` offers a 4.38 GB ZIP without a README at main. Neither can replace a provenance-checked holdout on the available evidence.

The Mendeley data remain better documented for the current binary image-label evaluation and have a verified CC BY 4.0 license, but the previously noted background confounding and missing bounding boxes still apply. The smaller OSF archive is a possible future research source, not a fully vetted replacement ready for claims about drone performance.
