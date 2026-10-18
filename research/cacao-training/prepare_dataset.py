"""COCO + image-row adapter with audited labels and group-held-out splits.

No class is inferred from a folder/treatment; those fields only disambiguate paths.
Inputs: original COCO documents, mirror rows JSONL, optional ZIP central index.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.fft import dctn
import yaml


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2-x1)*max(0, y2-y1)
    return inter / max(1e-9, (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1])-inter)


class UnionFind:
    def __init__(self, n): self.p = list(range(n))
    def find(self, i):
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i
    def union(self, a, b): self.p[self.find(a)] = self.find(b)


def capture_day(name, patterns):
    for spec in patterns:
        m = re.search(spec['pattern'], name)
        if m:
            try:
                if spec.get('epoch_milliseconds'):
                    value = dt.datetime.fromtimestamp(int(m[1])/1000, dt.timezone.utc)
                else:
                    value = dt.datetime.strptime(''.join(m.groups()), spec['format'])
                return value.strftime('%Y-%m-%d')
            except (ValueError, OverflowError): pass
    return None


def phash(im):
    arr = np.asarray(im.convert('L').resize((32, 32)), dtype=float)
    coef = dctn(arr, type=2, norm='ortho')[:8, :8].ravel()
    bits = coef > np.median(coef[1:])
    return sum(int(v) << i for i, v in enumerate(bits))


def read_rows(path):
    if path.suffix == '.jsonl': return [json.loads(s) for s in path.read_text().splitlines() if s.strip()]
    value = json.loads(path.read_text())
    return value['rows'] if isinstance(value, dict) else value


def grouped_split(items, cfg):
    uf = UnionFind(len(items))
    days = {}
    for i, x in enumerate(items):
        if cfg['group_capture_day']:
            for day in x['capture_days']:
                if day in days: uf.union(i, days[day])
                days[day] = i
    near_pairs = []
    for i, a in enumerate(items):
        for j in range(i):
            distance = (int(a['phash'], 16) ^ int(items[j]['phash'], 16)).bit_count()
            if distance <= cfg['phash_distance']:
                uf.union(i, j)
                near_pairs.append([items[j]['id'], a['id'], distance])
    groups = collections.defaultdict(list)
    for i in range(len(items)): groups[uf.find(i)].append(i)
    groups = sorted(groups.values(), key=lambda g: items[g[0]]['id'])
    stats = np.array([[len(g)] + [sum(b['class_id'] == c for i in g for b in items[i]['boxes'])
                                  for c in range(len(cfg['classes']))] for g in groups], dtype=float)
    fractions = np.array(list(cfg['split_fractions'].values()))
    target = fractions[:, None] * stats.sum(axis=0)[None, :]
    rng = np.random.default_rng(cfg['seed'])
    best = None
    # Random restarts + greedy group placement; optimize image and class counts.
    for _ in range(1200):
        order = np.argsort(-stats[:, 0] * rng.uniform(.5, 1.5, len(groups)))
        counts = np.zeros_like(target)
        assignment = np.zeros(len(groups), dtype=int)
        for gi in order:
            costs = []
            for split in range(len(fractions)):
                proposed = counts.copy(); proposed[split] += stats[gi]
                costs.append(float(np.square((proposed-target)/np.maximum(target, 1)).sum()))
            split = int(np.argmin(costs))
            assignment[gi] = split; counts[split] += stats[gi]
        cost = float(np.square((counts-target)/np.maximum(target, 1)).sum())
        cost += 1000 * int(np.any(counts[:, 1:] == 0))
        if best is None or cost < best[0]: best = (cost, assignment.copy(), counts.copy())
    assert best is not None
    if np.any(best[2][:, 1:] == 0): raise ValueError('Cannot form three group splits covering every class')
    split_names = list(cfg['split_fractions'])
    for gi, g in enumerate(groups):
        gid = hashlib.sha256('\n'.join(sorted(items[i]['id'] for i in g)).encode()).hexdigest()[:16]
        for i in g:
            items[i]['group'] = gid; items[i]['split'] = split_names[int(best[1][gi])]
    return {'group_count': len(groups), 'near_duplicate_pairs': near_pairs, 'balance_cost': best[0],
            'columns': ['images']+cfg['classes'], 'split_counts': dict(zip(split_names, best[2].astype(int).tolist()))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--rows', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--zip-index', type=Path)
    args = p.parse_args()
    cfg = json.loads(args.config.read_text()); base = args.config.resolve().parent
    if cfg['unknown_category_policy'] != 'drop_image': raise ValueError('Unsupported unknown category policy')
    if cfg['dimension_policy'] != 'exact': raise ValueError('Only exact decoded/annotation dimensions are supported')
    out = args.output.resolve()
    if out.exists() and any(out.iterdir()): raise ValueError('Output must be new or empty to avoid stale split images')
    out.mkdir(parents=True, exist_ok=True)
    classes = cfg['classes']; lookup = {}; audit = collections.Counter(); excluded = []
    for spec in cfg['coco_sources']:
        source = json.loads((base/spec['annotations']).read_text())
        names = {c['id']: c['name'] for c in source['categories']}
        by_id = {}
        for im in source['images']:
            key = (spec['group'], Path(im['file_name']).name)
            entry = lookup.setdefault(key, {'width': im['width'], 'height': im['height'], 'boxes': [], 'unknown': set()})
            if (entry['width'], entry['height']) != (im['width'], im['height']): raise ValueError(f'Conflicting sizes: {key}')
            by_id[im['id']] = entry
        for a in source['annotations']:
            name = names[a['category_id']]; entry = by_id[a['image_id']]
            if name not in classes: entry['unknown'].add(name); continue
            x, y, w, h = map(float, a['bbox'])
            entry['boxes'].append({'class_id': classes.index(name), 'bbox': [x,y,x+w,y+h]})
    # Source ZIP CRC+size identifies original-byte duplicates despite mirror recompression.
    source_identity = {}
    if args.zip_index:
        z = json.loads(args.zip_index.read_text())
        z = z.get('entries', z) if isinstance(z, dict) else z
        for e in z:
            path = Path(e.get('name', e.get('filename', '')))
            if len(path.parts) >= 3:
                source_identity[(path.parent.name, path.name)] = (e.get('crc32', e.get('crc')), e.get('size', e.get('file_size')))
    records = []
    for row in read_rows(args.rows):
        imgpath = Path(row['image'])
        if not imgpath.is_absolute(): imgpath = args.rows.parent/imgpath
        source_path = row.get('source_path', row.get('path', ''))
        key = (row['treatment'], Path(source_path).name)
        if key not in lookup: raise ValueError(f'Cannot join image to original COCO: {key}')
        entry = lookup[key]
        with Image.open(imgpath) as opened:
            im = ImageOps.exif_transpose(opened).convert('RGB')
            w, h = im.size
            if (w, h) != (entry['width'], entry['height']):
                excluded.append({'key': key, 'reason': 'dimension_mismatch', 'actual': [w,h], 'annotation': [entry['width'],entry['height']]})
                continue
            pixelsha = hashlib.sha256(im.tobytes()+str(im.size).encode()).hexdigest()
            records.append({'image': str(imgpath.resolve()), 'key': key, 'width': w, 'height': h,
                            'pixelsha': pixelsha, 'source_identity': source_identity.get(key),
                            'boxes': entry['boxes'], 'unknown': list(entry['unknown']),
                            'phash': f'{phash(im):016x}', 'capture_day': capture_day(key[1], cfg['capture_patterns'])})
    audit['source_rows'] = len(read_rows(args.rows)); audit['joined_dimension_valid_rows'] = len(records)
    uf = UnionFind(len(records)); identities = {}
    for i, r in enumerate(records):
        ids = [('pixel', r['pixelsha'])]
        if r['source_identity'] and r['source_identity'][0] is not None: ids.append(('source', *r['source_identity']))
        for key in ids:
            if key in identities: uf.union(i, identities[key])
            identities[key] = i
    merged = collections.defaultdict(list)
    for i, r in enumerate(records): merged[uf.find(i)].append(r)
    items = []
    for duplicates in merged.values():
        r = duplicates[0].copy(); r['sources'] = [d['key'] for d in duplicates]
        r['capture_days'] = sorted({d['capture_day'] for d in duplicates if d['capture_day']})
        audit['duplicate_rows_removed'] += len(duplicates)-1
        reasons = []; unknown = sorted({c for d in duplicates for c in d['unknown']})
        if unknown: reasons.append('unmapped_categories:'+','.join(unknown))
        boxes = []
        for box in [b for d in duplicates for b in d['boxes']]:
            b = box['bbox']; w,h = r['width'],r['height']
            if not np.isfinite(b).all() or b[0] < -1 or b[1] < -1 or b[2] > w+1 or b[3] > h+1 or b[2] <= b[0] or b[3] <= b[1]:
                reasons.append('invalid_box'); continue
            box = {'class_id': box['class_id'], 'bbox': [max(0,b[0]),max(0,b[1]),min(w,b[2]),min(h,b[3])]}
            if any(box['class_id'] == a['class_id'] and iou(box['bbox'],a['bbox']) >= cfg['duplicate_box_iou'] for a in boxes): continue
            if any(box['class_id'] != a['class_id'] and iou(box['bbox'],a['bbox']) >= cfg['conflicting_box_iou'] for a in boxes): reasons.append('conflicting_overlapping_categories')
            boxes.append(box)
        if not boxes: reasons.append('no_usable_boxes')
        if reasons:
            excluded.append({'sources': r['sources'], 'reason': sorted(set(reasons))}); continue
        r['id'] = r['pixelsha'][:24]; r['boxes'] = boxes
        items.append(r)
    items.sort(key=lambda r:r['id'])
    split_audit = grouped_split(items,cfg)
    for field in ('group', 'pixelsha'):
        seen = {}
        for r in items:
            if r[field] in seen and seen[r[field]] != r['split']:
                raise AssertionError(f'{field} leaks across splits')
            seen[r[field]] = r['split']
    by_id = {r['id']:r for r in items}
    assert all(by_id[a]['split'] == by_id[b]['split'] for a,b,_ in split_audit['near_duplicate_pairs'])
    for split in cfg['split_fractions']:
        (out/'images'/split).mkdir(parents=True,exist_ok=True)
        (out/'labels'/split).mkdir(parents=True,exist_ok=True)
    for r in items:
        with Image.open(r['image']) as im:
            im = ImageOps.exif_transpose(im).convert('RGB'); im.thumbnail((cfg['max_side'],cfg['max_side']), Image.Resampling.LANCZOS)
            w,h = im.size; sx,sy = w/r['width'],h/r['height']
            dest = out/'images'/r['split']/(r['id']+'.jpg'); im.save(dest,quality=95)
        for b in r['boxes']:
            a=b['bbox']; b['bbox']=[a[0]*sx,a[1]*sy,a[2]*sx,a[3]*sy]
        r['source_image']=r['image']; r['image']=str(dest); r['width']=w;r['height']=h
        lines=[]
        for b in r['boxes']:
            x1,y1,x2,y2=b['bbox']
            lines.append(f"{b['class_id']} {(x1+x2)/(2*w):.9f} {(y1+y2)/(2*h):.9f} {(x2-x1)/w:.9f} {(y2-y1)/h:.9f}")
        (out/'labels'/r['split']/(r['id']+'.txt')).write_text('\n'.join(lines)+'\n')
        r.pop('unknown',None)
    manifest_text = json.dumps(items,indent=2)
    (out/'manifest.json').write_text(manifest_text)
    (out/'data.yaml').write_text(yaml.safe_dump({'path':str(out),'train':'images/train','val':'images/val','test':'images/test','names':dict(enumerate(classes))},sort_keys=False))
    report = {'dataset':cfg['dataset'],'audit':dict(audit),'excluded':excluded,'split_audit':split_audit,
              'manifest_sha256':hashlib.sha256(manifest_text.encode()).hexdigest(), 'config':cfg,
              'limits':'Capture-day and perceptual groups are proxies. Farm/tree IDs are unavailable; no drone frames.'}
    (out/'audit.json').write_text(json.dumps(report,indent=2))
    # Deterministic annotation contact sheet for a human geometry check.
    rng=np.random.default_rng(cfg['seed']); sample=rng.choice(len(items),min(20,len(items)),replace=False)
    sheet=Image.new('RGB',(5*320,4*340),'white'); colors=['green','orange','red','magenta']
    for pos,i in enumerate(sample):
        r=items[int(i)]; im=Image.open(r['image']).convert('RGB'); sx=320/im.width; sy=320/im.height
        im=im.resize((320,320)); draw=ImageDraw.Draw(im)
        for b in r['boxes']:
            xy=[v*(sx if j%2==0 else sy) for j,v in enumerate(b['bbox'])]
            draw.rectangle(xy,outline=colors[b['class_id']],width=3);draw.text((xy[0],xy[1]),classes[b['class_id']],fill='white')
        sheet.paste(im,((pos%5)*320,(pos//5)*340));ImageDraw.Draw(sheet).text(((pos%5)*320,(pos//5)*340+321),r['split']+' '+str(r['sources'][0]),fill='black')
    sheet.save(out/'annotation_review.jpg')
    print(json.dumps({'usable_images':len(items),'split_audit':{k:v for k,v in split_audit.items() if k!='near_duplicate_pairs'},'excluded':len(excluded),'audit':dict(audit)},indent=2))


if __name__ == '__main__': main()
