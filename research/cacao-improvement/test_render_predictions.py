import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image

SPEC = importlib.util.spec_from_file_location("render_predictions", Path(__file__).with_name("render_predictions.py"))
RENDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDER)


class RenderTests(unittest.TestCase):
    def test_deterministic_six_local_images_and_remote_prediction_paths_ignored(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = root / "local.png"
            Image.new("RGB", (32, 16), (50, 100, 150)).save(image)
            rows = [{"id": f"{c}-{i}", "image": str(image), "label_class_id": c} for c in [1, 0] for i in [3, 1, 0, 2]]
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps(rows))
            records = [{"id": row["id"], "image": "/remote/path/never/open.jpg", "predictions": [
                {"class_id": 1, "confidence": 0.8, "bbox": [2, 2, 15, 12]},
                {"class_id": 0, "confidence": 0.99, "bbox": [1, 1, 25, 13]}]} for row in rows]
            files = [root / "baseline.jsonl", root / "new.jsonl"]
            for path in files:
                path.write_text("\n".join(json.dumps(row) for row in records))
            output = root / "pairs.png"
            ids = RENDER.render(manifest, files, [0.5, 0.9], ["Baseline", "Nuevo"], [1], output)
            self.assertEqual(ids, ["0-0", "0-1", "0-2", "1-0", "1-1", "1-2"])
            with Image.open(output) as rendered:
                self.assertEqual(rendered.size, (1200, 2128))


if __name__ == "__main__":
    unittest.main()
