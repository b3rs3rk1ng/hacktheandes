#!/usr/bin/env python3
"""Render deterministic image-label examples; no inferred or invented GT boxes.
Example: --manifest local.json --predictions base.jsonl new.jsonl
 --thresholds 0.50 0.74 --labels Baseline Nuevo --target-classes 1 --output pairs.png
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps


def load_predictions(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            key = str(row["id"])
            if key in result:
                raise ValueError("Repeated prediction ID: " + key)
            result[key] = row["predictions"]
    return result


def select_examples(rows, targets):
    ordered = sorted(rows, key=lambda row: str(row["id"]))
    return [row for positive in [False, True]
            for row in [r for r in ordered if (r["label_class_id"] in targets) == positive][:3]]


def render(manifest, prediction_paths, thresholds, labels, targets, output, font_path=None):
    rows = select_examples(json.loads(Path(manifest).read_text()), set(targets))
    if not rows:
        raise ValueError("No explicitly image-labelled examples")
    predictions = [load_predictions(path) for path in prediction_paths]
    if len(predictions) != 2 or len(thresholds) != 2 or len(labels) != 2:
        raise ValueError("Exactly two prediction files, thresholds and labels are required")
    if any(not math.isfinite(t) or not 0 <= t <= 1 for t in thresholds):
        raise ValueError("Thresholds must be finite probabilities")
    width, height, header = 600, 340, 88
    canvas = Image.new("RGB", (width * 2, header + height * len(rows)), "#f7f5ef")
    font = ImageFont.truetype(str(font_path), 16) if font_path else ImageFont.load_default(size=16)
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 10), "Muestra determinista por ID; no seleccionada por aciertos.", fill="#222222", font=font)
    draw.text((12, 34), "Verdad sólo por IMAGEN. Las cajas son predicciones; no hay cajas GT.", fill="#222222", font=font)
    for index, row in enumerate(rows):
        identifier, top = str(row["id"]), header + index * height
        with Image.open(row["image"]) as raw:
            image = ImageOps.exif_transpose(raw).convert("RGB")
        truth = row.get("label_name", str(row["label_class_id"]))
        truth += " | objetivo" if row["label_class_id"] in targets else " | sin etiqueta objetivo"
        draw.text((12, top), f"ID {identifier}  —  VERDAD IMAGEN: {truth}", fill="#222222", font=font)
        for column in range(2):
            if identifier not in predictions[column]:
                raise ValueError("Missing prediction record for selected ID: " + identifier)
            selected = [p for p in predictions[column][identifier]
                        if p["class_id"] in targets and p["confidence"] >= thresholds[column]]
            left = column * width
            draw.text((left + 12, top + 25), f"{labels[column]} | umbral {thresholds[column]:.2f} | {len(selected)} cajas", fill="#222222", font=font)
            scale = min((width - 24) / image.width, (height - 68) / image.height)
            resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
            xoff, yoff = left + (width - resized.width) // 2, top + 55
            canvas.paste(resized, (xoff, yoff))
            sx, sy = resized.width / image.width, resized.height / image.height
            for box in selected:
                xy = box["bbox"]
                if len(xy) != 4 or not all(math.isfinite(v) for v in xy):
                    raise ValueError("Invalid prediction bbox")
                x1, y1, x2, y2 = [xoff + xy[0] * sx, yoff + xy[1] * sy, xoff + xy[2] * sx, yoff + xy[3] * sy]
                draw.rectangle((x1, y1, x2, y2), outline="#e36f12", width=3)
                draw.text((x1 + 2, max(yoff, y1 - 17)), f"{box['class_id']} {box['confidence']:.2f}", fill="#e36f12", font=font)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)
    return [str(row["id"]) for row in rows]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--predictions", required=True, nargs=2, type=Path)
    parser.add_argument("--thresholds", required=True, nargs=2, type=float)
    parser.add_argument("--labels", required=True, nargs=2)
    parser.add_argument("--target-classes", required=True, nargs="+", type=int)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--font", type=Path, help="Optional TrueType font for Unicode labels")
    args = parser.parse_args()
    ids = render(args.manifest, args.predictions, args.thresholds, args.labels, args.target_classes, args.output, args.font)
    print(json.dumps({"output": str(args.output), "ids": ids, "truth_unit": "image", "ground_truth_boxes_rendered": False}))


if __name__ == "__main__":
    main()
