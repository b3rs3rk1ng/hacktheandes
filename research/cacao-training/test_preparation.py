"""Functional preparation checks on tiny, generated, explicitly labelled images.

Run with the same NumPy/SciPy/Pillow/PyYAML environment as prepare_dataset.py:
    python test_preparation.py -v
No downloads, model imports, GPU or existing project datasets are required.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

import numpy as np
from PIL import Image, ImageOps

SPEC = importlib.util.spec_from_file_location("prepare_dataset", pathlib.Path(__file__).with_name("prepare_dataset.py"))
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


def boxes():
    return [(0, [2, 3, 20, 24]), (1, [33, 31, 55, 55])]


class Fixture:
    """Two configurable classes, two COCO source groups, three independent days."""
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.rows = []
        self.arrays = []
        self.max_side = 64
        self.classes = ["healthy_visual", "symptomatic_visual"]
        self.documents = {}
        for group in ["a", "b"]:
            self.documents[group] = {
                "images": [], "annotations": [],
                # Category IDs deliberately differ between source documents.
                "categories": [{"id": self.category_id(group, i), "name": name}
                               for i, name in enumerate(self.classes + ["unmapped_visual_condition"])],
            }
        for day in range(1, 4):
            self.add("a", f"IMG_202601{day:02d}_100001.png", seed=day)

    @staticmethod
    def category_id(group, class_id):
        return {"a": [1, 7, 99], "b": [11, 17, 199]}[group][class_id]

    @staticmethod
    def random_image(seed):
        return np.random.default_rng(seed).integers(0, 256, size=(64, 64, 3), dtype=np.uint8)

    def add(self, group, source_name, *, seed=None, pixels=None, annotation_boxes=None):
        if pixels is None:
            pixels = self.random_image(seed)
        self.arrays.append(pixels.copy())
        image_path = self.root / "raw" / f"row-{len(self.rows):03d}.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(pixels).save(image_path)
        document = self.documents[group]
        image_id = len(document["images"]) + 1
        document["images"].append({"id": image_id, "file_name": source_name, "width": 64, "height": 64})
        for class_id, xyxy in boxes() if annotation_boxes is None else annotation_boxes:
            x1, y1, x2, y2 = xyxy
            document["annotations"].append({
                "id": len(document["annotations"]) + 1, "image_id": image_id,
                "category_id": self.category_id(group, class_id),
                "bbox": [x1, y1, x2 - x1, y2 - y1], "iscrowd": 0,
            })
        self.rows.append({"image": str(image_path), "source_path": f"original/{group}/{source_name}", "treatment": group})
        return (group, source_name)

    def write(self):
        # Prove the fixture cannot accidentally merge unrelated random images
        # through the near-duplicate rule that the production config uses.
        hashes = {}
        for array in self.arrays:
            identity = hashlib.sha256(array.tobytes()).hexdigest()
            hashes[identity] = PREPARE.phash(Image.fromarray(array))
        values = list(hashes.values())
        assert all((a ^ b).bit_count() > 4 for i, a in enumerate(values) for b in values[:i]), "Fixture pHash collision"
        sources = []
        for group, document in self.documents.items():
            name = f"coco-{group}.json"
            (self.root / name).write_text(json.dumps(document))
            sources.append({"group": group, "annotations": name})
        config = {
            "dataset": {"name": "generated-functional-fixture"}, "classes": self.classes,
            "coco_sources": sources, "unknown_category_policy": "drop_image", "dimension_policy": "exact",
            "duplicate_box_iou": 0.9, "conflicting_box_iou": 0.8, "phash_distance": 4,
            "group_capture_day": True,
            "capture_patterns": [{"pattern": r"(20[0-9]{6})_([0-9]{6})", "format": "%Y%m%d%H%M%S"}],
            "split_fractions": {"train": 1 / 3, "val": 1 / 3, "test": 1 / 3},
            "seed": 51, "max_side": self.max_side,
        }
        (self.root / "config.json").write_text(json.dumps(config))
        (self.root / "rows.jsonl").write_text("\n".join(json.dumps(row) for row in self.rows) + "\n")

    def run(self):
        self.write()
        out = self.root / "prepared"
        argv = ["prepare_dataset.py", "--config", str(self.root / "config.json"),
                "--rows", str(self.root / "rows.jsonl"), "--output", str(out)]
        with mock.patch("sys.argv", argv), contextlib.redirect_stdout(io.StringIO()):
            PREPARE.main()
        return json.loads((out / "manifest.json").read_text()), json.loads((out / "audit.json").read_text())


def containing(manifest, source):
    return [row for row in manifest if source in [tuple(s) for s in row["sources"]]]


class PreparationFunctionalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cacao-preparation-functional-")
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Fixture(self.temporary.name)

    def assert_split_coverage(self, manifest):
        self.assertEqual({r["split"] for r in manifest}, {"train", "val", "test"})
        for split in ["train", "val", "test"]:
            classes = {b["class_id"] for r in manifest if r["split"] == split for b in r["boxes"]}
            self.assertEqual(classes, {0, 1})

    def test_distinct_same_basename_joins_by_source_group(self):
        source_name = "IMG_20260104_100001.png"
        first = self.fixture.add("a", source_name, seed=101)
        second_boxes = [(0, [3, 5, 25, 27]), (1, [35, 33, 60, 58])]
        second = self.fixture.add("b", source_name, seed=102, annotation_boxes=second_boxes)
        manifest, audit = self.fixture.run()
        self.assert_split_coverage(manifest)
        left, right = containing(manifest, first), containing(manifest, second)
        self.assertEqual((len(left), len(right)), (1, 1))
        self.assertNotEqual(left[0]["id"], right[0]["id"])
        self.assertEqual([b["bbox"] for b in left[0]["boxes"]], [b for _, b in boxes()])
        self.assertEqual([b["bbox"] for b in right[0]["boxes"]], [b for _, b in second_boxes])
        self.assertEqual(audit["audit"]["duplicate_rows_removed"], 0)

    def test_exact_duplicates_union_boxes_across_source_groups(self):
        pixels = self.fixture.random_image(201)
        first = self.fixture.add("a", "IMG_20260104_100001.png", pixels=pixels)
        second = self.fixture.add("b", "IMG_20260105_100001.png", pixels=pixels,
                                  annotation_boxes=boxes() + [(1, [3, 40, 18, 60])])
        manifest, audit = self.fixture.run()
        self.assert_split_coverage(manifest)
        merged = containing(manifest, first)
        self.assertEqual(len(merged), 1)
        self.assertEqual(containing(manifest, second)[0]["id"], merged[0]["id"])
        self.assertEqual(len(merged[0]["sources"]), 2)
        self.assertEqual(len(merged[0]["boxes"]), 3)
        self.assertEqual({b["class_id"] for b in merged[0]["boxes"]}, {0, 1})
        self.assertEqual(audit["audit"]["duplicate_rows_removed"], 1)
        self.assertEqual(len(manifest), 4)

    def test_unknown_category_excludes_entire_duplicate_image_family(self):
        pixels = self.fixture.random_image(301)
        first = self.fixture.add("a", "IMG_20260104_100001.png", pixels=pixels)
        unknown = self.fixture.add("b", "IMG_20260105_100001.png", pixels=pixels,
                                  annotation_boxes=boxes() + [(2, [3, 40, 18, 60])])
        manifest, audit = self.fixture.run()
        self.assert_split_coverage(manifest)
        self.assertEqual(containing(manifest, first), [])
        self.assertEqual(containing(manifest, unknown), [])
        excluded = [e for e in audit["excluded"] if any("unmapped_categories:" in reason for reason in e["reason"])]
        self.assertEqual(len(excluded), 1)
        self.assertEqual({tuple(s) for s in excluded[0]["sources"]}, {first, unknown})
        self.assertEqual(len(manifest), 3)

    def test_conflicting_labels_at_same_location_exclude_image(self):
        pixels = self.fixture.random_image(401)
        first = self.fixture.add("a", "IMG_20260104_100001.png", pixels=pixels)
        conflict = self.fixture.add("b", "IMG_20260105_100001.png", pixels=pixels,
                                   annotation_boxes=[(1, [2, 3, 20, 24])])
        manifest, audit = self.fixture.run()
        self.assert_split_coverage(manifest)
        self.assertEqual(containing(manifest, first), [])
        self.assertEqual(containing(manifest, conflict), [])
        excluded = [e for e in audit["excluded"] if "conflicting_overlapping_categories" in e["reason"]]
        self.assertEqual(len(excluded), 1)
        self.assertEqual({tuple(s) for s in excluded[0]["sources"]}, {first, conflict})

    def test_all_capture_days_from_merged_aliases_remain_in_one_split(self):
        pixels = self.fixture.random_image(501)
        first = self.fixture.add("a", "IMG_20260110_100001.png", pixels=pixels)
        second = self.fixture.add("b", "IMG_20260111_100001.png", pixels=pixels)
        peer_first_day = self.fixture.add("a", "IMG_20260110_110001.png", seed=502)
        peer_second_day = self.fixture.add("b", "IMG_20260111_110001.png", seed=503)
        manifest, _ = self.fixture.run()
        self.assert_split_coverage(manifest)
        merged = containing(manifest, first)[0]
        self.assertEqual(merged["capture_days"], ["2026-01-10", "2026-01-11"])
        related = [containing(manifest, source)[0] for source in [first, second, peer_first_day, peer_second_day]]
        self.assertEqual(len({r["split"] for r in related}), 1)
        self.assertEqual(len({r["group"] for r in related}), 1)
        day_splits = {}
        for row in manifest:
            for day in row["capture_days"]:
                day_splits.setdefault(day, set()).add(row["split"])
        self.assertTrue(all(len(splits) == 1 for splits in day_splits.values()))

    def test_stale_output_is_rejected_without_modification(self):
        self.fixture.write()
        out = self.fixture.root / "prepared"
        out.mkdir()
        marker = out / "existing-run.txt"
        marker.write_text("preserve existing output")
        with self.assertRaisesRegex(ValueError, "Output must be new or empty"):
            self.fixture.run()
        self.assertEqual(marker.read_text(), "preserve existing output")
        self.assertEqual({p.name for p in out.iterdir()}, {marker.name})

    def test_exif_6_rectangular_and_square_pixels_and_labels_use_display_frame(self):
        # Rectangular geometry alone cannot catch a skipped transpose on a
        # square image. Check rendered corner colors independently in both.
        for raw_width, raw_height in [(80, 40), (80, 80)]:
            with self.subTest(raw_size=(raw_width, raw_height)):
                with tempfile.TemporaryDirectory(prefix="cacao-exif-functional-") as folder:
                    fixture = Fixture(folder)
                    fixture.max_side = 128  # Preserve the oriented pixel size.
                    display_width, display_height = raw_height, raw_width
                    annotation_boxes = [
                        (0, [2, 3, 16, 25]),
                        (1, [display_width - 16, display_height - 25,
                             display_width - 2, display_height - 3]),
                    ]
                    source = fixture.add("a", "IMG_20260104_100001.jpg", seed=601,
                                         annotation_boxes=annotation_boxes)
                    # Distinct source quadrants: EXIF 6 must rotate pixels 90
                    # degrees clockwise, even when width == height.
                    red, green, blue, yellow = [(230, 25, 30), (25, 210, 45), (35, 70, 225), (240, 220, 25)]
                    pixels = np.empty((raw_height, raw_width, 3), dtype=np.uint8)
                    pixels[:raw_height // 2, :raw_width // 2] = red
                    pixels[:raw_height // 2, raw_width // 2:] = green
                    pixels[raw_height // 2:, raw_width // 2:] = blue
                    pixels[raw_height // 2:, :raw_width // 2] = yellow
                    original_path = pathlib.Path(fixture.rows[-1]["image"])
                    jpeg_path = original_path.with_suffix(".jpg")
                    exif = Image.Exif()
                    exif[274] = 6
                    Image.fromarray(pixels).save(jpeg_path, format="JPEG", quality=98, subsampling=0, exif=exif)
                    original_path.unlink()
                    fixture.rows[-1]["image"] = str(jpeg_path)
                    fixture.documents["a"]["images"][-1].update(width=display_width, height=display_height)
                    with Image.open(jpeg_path) as encoded:
                        self.assertEqual(encoded.size, (raw_width, raw_height))
                        self.assertEqual(encoded.getexif()[274], 6)
                        # Keep the fixture's anti-collision audit tied to the
                        # exact decoded/oriented pixels that preparation sees.
                        fixture.arrays[-1] = np.asarray(ImageOps.exif_transpose(encoded).convert("RGB")).copy()
                    manifest, audit = fixture.run()
                    self.assert_split_coverage(manifest)
                    self.assertEqual(audit["excluded"], [])
                    prepared = containing(manifest, source)[0]
                    self.assertEqual((prepared["width"], prepared["height"]), (display_width, display_height))
                    self.assertEqual([b["bbox"] for b in prepared["boxes"]], [b for _, b in annotation_boxes])
                    with Image.open(prepared["image"]) as rendered:
                        self.assertEqual(rendered.size, (display_width, display_height))
                        self.assertEqual(len(rendered.getexif()), 0)
                        output_pixels = np.asarray(rendered.convert("RGB"), dtype=float)
                    # Output TL/TR/BR/BL must be original BL/TL/TR/BR.
                    probes = [
                        (8, 8, yellow), (display_width - 9, 8, red),
                        (display_width - 9, display_height - 9, green),
                        (8, display_height - 9, blue),
                    ]
                    for x, y, expected_color in probes:
                        measured = output_pixels[y - 2:y + 3, x - 2:x + 3].mean(axis=(0, 1))
                        self.assertLess(float(np.max(np.abs(measured - expected_color))), 20)
                    # Independently read YOLO labels: they describe the same
                    # display-space boxes, normalized by oriented dimensions.
                    label_path = pathlib.Path(prepared["image"].replace("/images/", "/labels/")).with_suffix(".txt")
                    labels = [list(map(float, line.split())) for line in label_path.read_text().splitlines()]
                    for label, (class_id, bbox) in zip(labels, annotation_boxes):
                        x1, y1, x2, y2 = bbox
                        expected = [class_id, (x1 + x2) / (2 * display_width),
                                    (y1 + y2) / (2 * display_height),
                                    (x2 - x1) / display_width, (y2 - y1) / display_height]
                        np.testing.assert_allclose(label, expected, atol=1e-8, rtol=0)


if __name__ == "__main__":
    unittest.main()
