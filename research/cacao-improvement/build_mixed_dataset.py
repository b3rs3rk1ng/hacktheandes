"""Mix annotated manifests with explicit label contracts and leakage-safe groups.

The input box contract is displayed-image pixel XYXY. No class, capture identity,
or split is inferred from a source's name. Existing partitions are preserved;
protected and contradictory families are kept out of new training/validation.
"""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps
import yaml


def load_helpers(path):
    spec = importlib.util.spec_from_file_location('shared_preparation', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False))


def progress(stage, count, total, **details):
    print(json.dumps({'stage': stage, 'count': count, 'total': total, **details}), flush=True)


def read_manifest(path):
    if path.suffix == '.jsonl':
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    value = json.loads(path.read_text())
    return value['rows'] if isinstance(value, dict) else value


def image_digest(im):
    return hashlib.sha256(im.tobytes() + repr(im.size).encode()).hexdigest()


def resolve_path(path, base):
    path = Path(path)
    return path.resolve() if path.is_absolute() else (base / path).resolve()


def read_inputs(config, base, helpers):
    names = config['classes']
    records, excluded, inputs = [], [], []
    for source in config['sources']:
        manifest_path = resolve_path(source['manifest'], base)
        raw_rows = read_manifest(manifest_path)
        inputs.append({'source': source['name'], 'manifest': str(manifest_path),
                       'manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                       'rows': len(raw_rows), 'prior_use': source.get('prior_use', 'unspecified')})
        if source.get('unknown_policy', 'error') not in ('error', 'drop_image'):
            raise ValueError('unknown_policy must be error or drop_image')
        for number, row in enumerate(raw_rows, 1):
            identifier = f"{source['name']}:{row['id']}"
            path = resolve_path(row['image'], manifest_path.parent)
            try:
                with Image.open(path) as opened:
                    orientation = opened.getexif().get(274, 1)
                    if orientation != 1 and source.get('box_frame', 'require-unoriented') != 'display':
                        raise ValueError('nonidentity EXIF requires explicit display-frame annotations')
                    im = ImageOps.exif_transpose(opened).convert('RGB')
                    width, height = im.size
                    if [width, height] != [row['width'], row['height']]:
                        raise ValueError('decoded display size disagrees with annotation dimensions')
                    pixelsha = image_digest(im)
                    perceptual = f'{helpers.phash(im):016x}'
                boxes = []
                for box in row['boxes']:
                    class_id = box['class_id']
                    if not isinstance(class_id, int) or not 0 <= class_id < len(source['classes']):
                        raise ValueError('unmapped source class ID')
                    original = source['classes'][class_id]
                    target = source['class_mapping'].get(original)
                    if target not in names:
                        raise ValueError(f'unmapped source category {original}')
                    xyxy = [float(value) for value in box['bbox']]
                    if (len(xyxy) != 4 or not all(math.isfinite(value) for value in xyxy)
                            or not 0 <= xyxy[0] < xyxy[2] <= width
                            or not 0 <= xyxy[1] < xyxy[3] <= height):
                        raise ValueError('invalid display-frame pixel XYXY box')
                    boxes.append({'class_id': names.index(target), 'bbox': xyxy,
                                  'original_stages': [{'source': source['name'], 'class': original,
                                                       'source_class_id': class_id}]})
                if not boxes:
                    raise ValueError('no annotated objects')
            except (ValueError, KeyError) as error:
                if source.get('unknown_policy', 'error') == 'error':
                    raise ValueError(f'{identifier}: {error}') from error
                excluded.append({'id': identifier, 'reason': str(error)})
                continue
            policy = source['split_policy']
            if policy['kind'] == 'preserve':
                if row['split'] not in policy['map']:
                    raise ValueError(f'{identifier}: existing partition lacks explicit mapping')
                fixed = policy['map'][row['split']]
            elif policy['kind'] == 'grouped':
                fixed = None
            else:
                raise ValueError('Unknown split policy')
            records.append({'id': identifier, 'image': str(path), 'width': width, 'height': height,
                            'pixelsha': pixelsha, 'phash': perceptual, 'boxes': boxes,
                            'source': source['name'], 'source_id': str(row['id']),
                            'source_path': row.get('source_image', row['image']),
                            'source_group': row.get('group'), 'original_split': row['split'],
                            'fixed_split': fixed, 'orientation': orientation,
                            'needs_normalization': orientation != 1,
                            'evaluation_role': source.get('evaluation_role', 'development')})
            if number % 100 == 0 or number == len(raw_rows):
                progress('read_source', number, len(raw_rows), source=source['name'])
    if not records:
        raise ValueError('No valid input records')
    return records, excluded, inputs


def link_groups(records, config, helpers):
    uf = helpers.UnionFind(len(records))
    identities = {}
    threshold = config['grouping']['phash_distance']
    if not isinstance(threshold, int) or not 0 <= threshold <= 64:
        raise ValueError('Invalid perceptual hash distance')
    near_pairs = []
    for i, row in enumerate(records):
        keys = [('pixels', row['pixelsha'])]
        if config['grouping'].get('preserve_source_groups', True) and row['source_group']:
            keys.append(('source_group', row['source'], row['source_group']))
        for key in keys:
            if key in identities:
                uf.union(i, identities[key])
            identities[key] = i
        for j in range(i):
            distance = (int(row['phash'], 16) ^ int(records[j]['phash'], 16)).bit_count()
            if distance <= threshold:
                uf.union(i, j)
                near_pairs.append({'a': records[j]['id'], 'b': row['id'], 'distance': distance})
        if (i+1) % 100 == 0 or i+1 == len(records):
            progress('group_images', i+1, len(records))
    grouped = collections.defaultdict(list)
    for i in range(len(records)):
        grouped[uf.find(i)].append(records[i])
    families = []
    for group in grouped.values():
        identifier = hashlib.sha256('\n'.join(sorted(r['id'] for r in group)).encode()).hexdigest()[:24]
        for row in group:
            row['group'] = identifier
        families.append(group)
    return sorted(families, key=lambda g: g[0]['group']), near_pairs


def partition_families(families, config):
    """Balance grouped sources, retaining compatible fixed source partitions."""
    protected = set(config['grouping']['protected_splits'])
    excluded, fixed, variable = [], [], []
    for family in families:
        fixed_splits = {r['fixed_split'] for r in family if r['fixed_split'] is not None}
        protected_here = fixed_splits & protected
        if protected_here:
            for row in family:
                if row['fixed_split'] in protected_here:
                    row['split'] = row['fixed_split']
                    fixed.append(row)
                else:
                    excluded.append({'id': row['id'], 'group': row['group'],
                                     'reason': 'family_intersects_protected_partition'})
        elif len(fixed_splits) > 1:
            excluded.extend({'id': r['id'], 'group': r['group'],
                             'reason': 'family_connects_incompatible_preserved_partitions'} for r in family)
        elif fixed_splits:
            split = next(iter(fixed_splits))
            for row in family:
                row['split'] = split
                fixed.append(row)
        else:
            variable.append(family)
    grouped_sources = [s for s in config['sources'] if s['split_policy']['kind'] == 'grouped']
    if not grouped_sources and variable:
        raise ValueError('Unassigned families without a grouped source')
    if not variable:
        return fixed, excluded
    split_names = sorted({name for s in grouped_sources for name in s['split_policy']['fractions']})
    nclasses = len(config['classes'])
    source_names = [s['name'] for s in grouped_sources]
    shape = (len(split_names), len(source_names), nclasses + 1)
    targets = np.zeros(shape)
    initial = np.zeros(shape)

    def vector(rows):
        result = np.zeros((len(source_names), nclasses + 1))
        for row in rows:
            if row['source'] not in source_names:
                continue
            si = source_names.index(row['source'])
            result[si, 0] += 1
            for box in row['boxes']:
                result[si, 1 + box['class_id']] += 1
        return result

    totals = vector(fixed + [r for family in variable for r in family])
    for si, source in enumerate(grouped_sources):
        fractions = source['split_policy']['fractions']
        if (not fractions or any(v <= 0 for v in fractions.values())
                or abs(sum(fractions.values()) - 1) > 1e-8):
            raise ValueError('Grouped split fractions must be positive and sum to one')
        for name, fraction in fractions.items():
            targets[split_names.index(name), si] = totals[si] * fraction
    for row in fixed:
        if row['source'] in source_names and row['split'] in split_names:
            initial[split_names.index(row['split'])] += vector([row])
    vectors = [vector(family) for family in variable]
    allowed = []
    by_name = {s['name']: s for s in grouped_sources}
    for family in variable:
        options = set(split_names)
        for source_name in {r['source'] for r in family}:
            options &= set(by_name[source_name]['split_policy']['fractions'])
        if not options:
            raise ValueError('A linked family has no compatible partition')
        allowed.append(sorted(split_names.index(name) for name in options))
    rng = np.random.default_rng(config['seed'])
    best = None
    denominator = np.maximum(targets, 1)
    for _ in range(config['grouping'].get('balance_restarts', 400)):
        order = sorted(range(len(variable)), key=lambda i: -len(variable[i]) * rng.uniform(.5, 1.5))
        counts = initial.copy()
        assignment = {}
        for gi in order:
            costs = []
            for split in allowed[gi]:
                proposed = counts.copy()
                proposed[split] += vectors[gi]
                costs.append((float(np.square((proposed - targets) / denominator).sum()), split))
            _, split = min(costs)
            assignment[gi] = split
            counts[split] += vectors[gi]
        missing = int(np.sum((targets > 0) & (counts == 0)))
        cost = float(np.square((counts - targets) / denominator).sum()) + 1000 * missing
        if best is None or cost < best[0]:
            best = cost, assignment, counts
    if np.any((targets > 0) & (best[2] == 0)):
        raise ValueError('Group split cannot cover every available source/class in each requested partition')
    for gi, family in enumerate(variable):
        for row in family:
            row['split'] = split_names[best[1][gi]]
            fixed.append(row)
    return fixed, excluded


def merge_pixels(rows, config, helpers):
    grouped = collections.defaultdict(list)
    for row in rows:
        grouped[row['pixelsha']].append(row)
    result, excluded = [], []
    for digest, duplicates in sorted(grouped.items()):
        if len({r['split'] for r in duplicates}) != 1:
            raise ValueError('An exact image crosses partitions')
        item = copy.deepcopy(duplicates[0])
        boxes, conflict = [], False
        for box in [b for r in duplicates for b in r['boxes']]:
            same = next((b for b in boxes if b['class_id'] == box['class_id']
                         and helpers.iou(b['bbox'], box['bbox']) >= config['grouping']['duplicate_box_iou']), None)
            if same:
                for stage in box['original_stages']:
                    if stage not in same['original_stages']:
                        same['original_stages'].append(stage)
                continue
            if any(b['class_id'] != box['class_id'] and helpers.iou(b['bbox'], box['bbox'])
                   >= config['grouping']['conflicting_box_iou'] for b in boxes):
                conflict = True
            boxes.append(copy.deepcopy(box))
        if conflict:
            excluded.append({'ids': [r['id'] for r in duplicates], 'reason': 'exact_image_conflicting_categories'})
            continue
        item['id'] = digest[:24]
        item['boxes'] = boxes
        item['provenance'] = [{k: r[k] for k in ('source', 'source_id', 'source_path', 'original_split', 'evaluation_role')}
                              for r in duplicates]
        result.append(item)
    return result, excluded


def augment_image(im, config, seed):
    import cv2
    rng = np.random.default_rng(seed)
    low, high = config['brightness']
    factor = float(rng.uniform(low, high))
    im = ImageEnhance.Brightness(im).enhance(factor)
    low, high = config['motion_blur']['kernel']
    choices = list(range(low if low % 2 else low + 1, high + 1, 2))
    if not choices:
        raise ValueError('Motion blur requires a positive odd kernel range')
    size = int(rng.choice(choices))
    angle = float(rng.choice(config['motion_blur']['angles']))
    kernel = np.zeros((size, size), np.float32)
    kernel[size // 2] = 1
    rotation = cv2.getRotationMatrix2D((size // 2, size // 2), angle, 1)
    kernel = cv2.warpAffine(kernel, rotation, (size, size))
    if kernel.sum() <= 0:
        raise ValueError('Empty motion kernel')
    kernel /= kernel.sum()
    arr = cv2.filter2D(np.asarray(im), -1, kernel, borderType=cv2.BORDER_REFLECT_101)
    return Image.fromarray(arr), {'brightness': factor, 'motion_blur_kernel': size, 'motion_blur_angle': angle}


def add_training_variants(items, config, output):
    aug = config.get('augmentation', {})
    if not aug.get('enabled', False):
        return items
    if aug['variants_per_training_image'] < 0:
        raise ValueError('Negative variant count')
    variants = []
    training = [row for row in items if row['split'] == 'train']
    for number, row in enumerate(training, 1):
        if row['split'] != 'train':
            continue
        for variant in range(aug['variants_per_training_image']):
            seed = int(hashlib.sha256(f"{config['seed']}:{row['id']}:{variant}".encode()).hexdigest()[:16], 16)
            with Image.open(row['image']) as im:
                im, parameters = augment_image(ImageOps.exif_transpose(im).convert('RGB'), aug, seed)
            identifier = hashlib.sha256(f"{row['id']}:augmentation:{seed}".encode()).hexdigest()[:24]
            path = output / 'augmentation' / (identifier + '.jpg')
            path.parent.mkdir(parents=True, exist_ok=True)
            im.save(path, quality=95)
            result = copy.deepcopy(row)
            result.update({'id': identifier, 'image': str(path), 'parent_id': row['id'],
                           'augmentation': parameters, 'pixelsha': image_digest(im)})
            variants.append(result)
        if number % 100 == 0 or number == len(training):
            progress('augment_training', number, len(training))
    return items + variants


def normalize_if_needed(items, output):
    for row in items:
        if not row['needs_normalization']:
            continue
        with Image.open(row['image']) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            path = output / 'normalized' / (row['id'] + '.jpg')
            path.parent.mkdir(parents=True, exist_ok=True)
            im.save(path, quality=95)
        row['image'] = str(path)


def export_detection(items, names, path, collapse=False):
    rows = []
    for number, row in enumerate(items, 1):
        result = copy.deepcopy(row)
        dest = path / 'images' / row['split'] / (row['id'] + '.jpg')
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(str(Path(row['image']).resolve()), dest)
        result['input_image'] = row['image']
        result['image'] = str(dest.absolute())
        if collapse:
            for box in result['boxes']:
                box['disease_class_id'] = box['class_id']
                box['class_id'] = 0
        lines = []
        for box in result['boxes']:
            x1, y1, x2, y2 = box['bbox']
            width, height = row['width'], row['height']
            lines.append(f"{box['class_id']} {(x1+x2)/(2*width):.10f} {(y1+y2)/(2*height):.10f} {(x2-x1)/width:.10f} {(y2-y1)/height:.10f}")
        label = path / 'labels' / row['split'] / (row['id'] + '.txt')
        label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text('\n'.join(lines) + '\n')
        rows.append(result)
        if number % 100 == 0 or number == len(items):
            progress('export_detection', number, len(items), export=path.name)
    dump(path / 'manifest.json', rows)
    splits = sorted({r['split'] for r in rows})
    data = {'path': str(path.absolute()), 'train': 'images/train', 'val': 'images/val',
            'names': dict(enumerate(names))}
    if 'regression' in splits:
        data['test'] = 'images/regression'
    (path / 'data.yaml').write_text(yaml.safe_dump(data, sort_keys=False))
    return {'images': len(rows), 'by_split': dict(collections.Counter(r['split'] for r in rows)),
            'manifest_sha256': hashlib.sha256((path / 'manifest.json').read_bytes()).hexdigest()}


def export_crops(items, names, path, config):
    manifest, skipped = [], []
    path.mkdir(parents=True, exist_ok=True)
    for number, row in enumerate(items, 1):
        im = None
        if config.get('write_images', False):
            with Image.open(row['image']) as opened:
                im = ImageOps.exif_transpose(opened).convert('RGB')
        try:
            for index, box in enumerate(row['boxes']):
                x1, y1, x2, y2 = box['bbox']
                if min(x2 - x1, y2 - y1) < config['min_side']:
                    skipped.append({'parent_id': row['id'], 'box_index': index, 'reason': 'below_min_side'})
                    continue
                px = (x2 - x1) * config['context_fraction']
                py = (y2 - y1) * config['context_fraction']
                crop_box = [max(0, math.floor(x1-px)), max(0, math.floor(y1-py)),
                            min(row['width'], math.ceil(x2+px)), min(row['height'], math.ceil(y2+py))]
                identifier = f"{row['id']}-{index:03d}"
                dest = path / row['split'] / names[box['class_id']] / (identifier + '.jpg')
                if im is not None:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    im.crop(crop_box).save(dest, quality=95)
                manifest.append({'id': identifier, 'parent_id': row['id'], 'source_image_id': row['id'],
                                 'image': row['image'], 'bbox': box['bbox'],
                                 'crop_image': str(dest.absolute()) if im is not None else None,
                                 'group': row['group'], 'split': row['split'], 'class_id': box['class_id'],
                                 'class_name': names[box['class_id']], 'original_stages': box['original_stages'],
                                 'source_stage': box['original_stages'],
                                 'provenance': row['provenance'], 'source_bbox': box['bbox'],
                                 'crop_bbox': crop_box, 'context_fraction': config['context_fraction'],
                                 'min_side': config['min_side'],
                                 'augmentation': row.get('augmentation')})
        finally:
            if im is not None:
                im.close()
        if number % 100 == 0 or number == len(items):
            progress('export_roi_references', number, len(items))
    dump(path / 'manifest.json', manifest)
    dump(path / 'skipped.json', skipped)
    return {'crops': len(manifest), 'skipped': len(skipped),
            'by_split_class': dict(collections.Counter(f"{r['split']}:{r['class_name']}" for r in manifest)),
            'limitations': 'Ground-truth ROIs measure crop classification only, not end-to-end detection.'}


def audit_partitions(items):
    groups, pixels = collections.defaultdict(set), collections.defaultdict(set)
    for row in items:
        groups[row['group']].add(row['split'])
        # Augmentation is linked to its parent group; original pixel identities are checked here.
        if not row.get('augmentation'):
            pixels[row['pixelsha']].add(row['split'])
    if any(len(v) != 1 for v in groups.values()) or any(len(v) != 1 for v in pixels.values()):
        raise ValueError('Group or exact-pixel identity crosses output partitions')
    counts = collections.Counter()
    for row in items:
        for box in row['boxes']:
            counts[f"{row['split']}:{box['class_id']}"] += 1
    return {'groups': len(groups), 'images_by_split': dict(collections.Counter(r['split'] for r in items)),
            'boxes_by_split_class': dict(counts), 'cross_partition_group_links': 0,
            'cross_partition_exact_pixel_links': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--helpers', type=Path, default=Path(__file__).resolve().parents[1] / 'cacao-training' / 'prepare_dataset.py')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output must be new or empty; refusing stale split files')
    output.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config.read_text())
    if len(set(config['classes'])) != len(config['classes']):
        raise ValueError('Duplicate target class names')
    if len({s['name'] for s in config['sources']}) != len(config['sources']):
        raise ValueError('Duplicate source names')
    helpers = load_helpers(args.helpers)
    records, excluded, inputs = read_inputs(config, args.config.resolve().parent, helpers)
    families, near_pairs = link_groups(records, config, helpers)
    assigned, partition_excluded = partition_families(families, config)
    items, conflicts = merge_pixels(assigned, config, helpers)
    if not items:
        raise ValueError('No exportable examples')
    original_audit = audit_partitions(items)
    normalize_if_needed(items, output)
    items = add_training_variants(items, config, output)
    final_audit = audit_partitions(items)
    dump(output / 'mixed_manifest.json', items)
    exports = {}
    export_config = config['exports']
    if export_config.get('disease_detection'):
        exports['disease_detection'] = export_detection(items, config['classes'], output / 'disease')
    if export_config.get('pod_detection'):
        exports['pod_detection'] = export_detection(items, ['pod'], output / 'pod', collapse=True)
    if export_config.get('roi_classification'):
        exports['roi_classification'] = export_crops(items, config['classes'], output / 'roi', export_config['roi_classification'])
    report = {'name': config['name'], 'config': config, 'inputs': inputs,
              'original_audit': original_audit, 'final_audit': final_audit, 'exports': exports,
              'near_duplicate_pairs': near_pairs, 'excluded': excluded + partition_excluded + conflicts,
              'limitations': ['Perceptual hash groups are image-similarity proxies, not farm/tree identities.',
                             'Previously examined test sources are now development data; new validation is not independent.',
                             'The preserved regression partition has previously influenced development decisions.',
                             'Offline blur/brightness augmentations are not evidence of real drone-flight performance.']}
    dump(output / 'audit.json', report)
    print(json.dumps({'original_audit': original_audit, 'final_audit': final_audit,
                      'exports': exports, 'excluded': len(report['excluded'])}, indent=2), flush=True)


if __name__ == '__main__':
    main()
