"""Meaningful isolation fixtures: mappings, protected families and augmentation."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent


class MixedDatasetTest(unittest.TestCase):
    def test_end_to_end_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            rng = np.random.default_rng(73)
            images = {}

            def row(identifier, split, category, group, duplicate=None):
                path = base / (identifier + '.png')
                if duplicate:
                    Image.open(images[duplicate]).save(path)
                else:
                    Image.fromarray(rng.integers(0, 256, (64, 64, 3), dtype=np.uint8)).save(path)
                images[identifier] = path
                return {'id': identifier, 'image': str(path), 'split': split, 'width': 64, 'height': 64,
                        'group': group, 'boxes': [{'class_id': category, 'bbox': [10, 12, 52, 54]}]}

            a = [row('a0', 'train', 0, 'at'), row('a1', 'train', 1, 'at'),
                 row('a2', 'val', 2, 'av'), row('a3', 'test', 3, 'ar'),
                 row('unknown', 'train', 4, 'au')]
            b = [row(f'b{g}-{c}', 'test', c, f'bg{g}') for g in range(4) for c in range(3)]
            b += [row('protected-copy', 'test', 1, None, 'a3'),
                  row('training-copy', 'test', 0, None, 'a0')]
            (base / 'a.json').write_text(json.dumps(a))
            (base / 'b.json').write_text(json.dumps(b))
            config = json.loads((HERE / 'mixed_config.json').read_text())
            config['sources'][0].update({'name': 'source_a', 'manifest': 'a.json',
                                         'classes': ['h0', 'm1', 'm2', 'm3', 'unknown']})
            config['sources'][1].update({'name': 'source_b', 'manifest': 'b.json'})
            config['grouping']['balance_restarts'] = 40
            config['exports']['roi_classification']['min_side'] = 32
            config_path = base / 'config.json'
            config_path.write_text(json.dumps(config))
            out = base / 'output'
            command = [sys.executable, str(HERE / 'build_mixed_dataset.py'), '--config',
                       str(config_path), '--output', str(out)]
            subprocess.run(command, check=True, capture_output=True, text=True)
            manifest = json.loads((out / 'mixed_manifest.json').read_text())
            audit = json.loads((out / 'audit.json').read_text())
            original = [r for r in manifest if not r.get('augmentation')]
            provenance = {p['source_id']: row for row in original for p in row['provenance']}
            self.assertEqual(provenance['a0']['split'], 'train')
            self.assertEqual(provenance['a1']['split'], 'train')
            self.assertEqual(provenance['a2']['split'], 'val')
            self.assertEqual(provenance['a3']['split'], 'regression')
            self.assertNotIn('protected-copy', provenance)
            self.assertNotIn('unknown', provenance)
            self.assertEqual(provenance['a2']['boxes'][0]['class_id'], 1)
            self.assertEqual(provenance['a2']['boxes'][0]['original_stages'][0]['class'], 'm2')
            self.assertEqual(len(provenance['a0']['provenance']), 2)
            self.assertEqual(audit['final_audit']['cross_partition_group_links'], 0)
            for group in range(4):
                self.assertEqual(len({provenance[f'b{group}-{c}']['split'] for c in range(3)}), 1)
            augmented = [r for r in manifest if r.get('augmentation')]
            self.assertEqual(len(augmented), sum(r['split'] == 'train' for r in original))
            self.assertTrue(all(r['split'] == 'train' for r in augmented))
            crops = json.loads((out / 'roi' / 'manifest.json').read_text())
            self.assertTrue(all(Path(c['image']).is_file() and c['bbox'] == [10., 12., 52., 54.] for c in crops))
            self.assertTrue(all(c['crop_image'] is None for c in crops))
            pod = json.loads((out / 'pod' / 'manifest.json').read_text())
            self.assertTrue(all(box['class_id'] == 0 for r in pod for box in r['boxes']))
            self.assertTrue(Path(pod[0]['image']).is_symlink())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
