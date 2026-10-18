#!/usr/bin/env python3
"""Download public Hugging Face Parquet shards and extract images reproducibly.

Dependencies for extraction only: pip install pyarrow Pillow
Example:
  python fetch_parquet.py --repo org/dataset --output /data/dataset --workers 16 \
    --max-side 1280 --coco h0=instances_h0.json --coco m1=instances_m1.json

HF annotations are preserved as metadata; they are never used to create labels.
COCO annotation indices, dimensions, and all join ambiguities are recorded.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import random
import re
import shutil
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlparse, parse_qs
from urllib.request import Request, urlopen

PRINT_LOCK = threading.Lock()


def log(message):
    with PRINT_LOCK:
        print(message, flush=True)


def atomic_json(path, value):
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def headers(extra=None):
    out = {'User-Agent': 'public-parquet-image-fetcher/1.0'}
    token = os.environ.get('HF_TOKEN')
    if token:
        out['Authorization'] = 'Bearer ' + token
    out.update(extra or {})
    return out


def sha256_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def api_json(url, retries=5):
    for attempt in range(retries):
        try:
            with urlopen(Request(url, headers=headers()), timeout=90) as response:
                return json.load(response), response.headers
        except Exception:
            if attempt + 1 == retries:
                raise
            time.sleep(min(30, 2 ** attempt + random.random()))


def list_shards(repo, revision):
    # Resolve a mutable revision once, then use immutable commit SHA throughout.
    base = 'https://huggingface.co/api/datasets/' + quote(repo, safe='/')
    info, _ = api_json(base + '/revision/' + quote(revision, safe=''))
    commit = info['sha']
    url = base + '/tree/' + quote(commit, safe='') + '?recursive=true&expand=false&limit=1000'
    entries = []
    while url:
        page, response_headers = api_json(url)
        entries.extend(page)
        links = response_headers.get('Link', '')
        next_links = re.findall(r'<([^>]+)>;\s*rel="next"', links)
        url = next_links[0] if next_links else None
    shards = [entry for entry in entries
              if entry.get('type') == 'file' and entry['path'].endswith('.parquet')]
    if not shards:
        raise RuntimeError('Repository revision contains no Parquet files')
    return commit, sorted(shards, key=lambda entry: entry['path'])


def safe_relative(value):
    # Avoid writing an untrusted remote path outside the requested destination.
    value = str(value).replace('\\', '/')
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or any(part in ('..', '') for part in p.parts):
        raise ValueError('Unsafe relative path: ' + value)
    return Path(*p.parts)


def fetch_part(task, args):
    url, start, end, target = task
    expected_size = end - start + 1
    if target.exists() and target.stat().st_size == expected_size:
        return expected_size
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(args.retries):
        temp = target.with_name(target.name + '.tmp')
        try:
            request = Request(url, headers=headers({'Range': f'bytes={start}-{end}'}))
            with urlopen(request, timeout=args.timeout) as response:
                content_range = response.headers.get('Content-Range', '')
                if response.status != 206 or not content_range.startswith(f'bytes {start}-{end}/'):
                    raise RuntimeError(f'Server ignored requested range {start}-{end}: '
                                       f'HTTP {response.status}, {content_range!r}')
                length = 0
                with temp.open('wb') as stream:
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        length += len(block)
                        if length > expected_size:
                            raise RuntimeError('Range response exceeded expected length')
                        stream.write(block)
                if length != expected_size:
                    raise RuntimeError(f'Truncated range: {length}/{expected_size} bytes')
            os.replace(temp, target)
            return expected_size
        except Exception as error:
            temp.unlink(missing_ok=True)
            if attempt + 1 == args.retries:
                raise RuntimeError(f'Could not download {start}-{end}: {error}') from error
            log(f'Retry {attempt + 1}/{args.retries} range {start}-{end}: {error}')
            time.sleep(min(30, 2 ** attempt + random.random()))


def download_shards(args, commit, shards):
    cache = args.output / 'parquet'
    parts_root = args.output / '.download-parts' / commit
    cache.mkdir(parents=True, exist_ok=True)
    tasks = []
    pending_shards = []
    paths = []
    for shard in shards:
        relative = safe_relative(shard['path'])
        destination = cache / relative
        paths.append(destination)
        expected_hash = shard.get('lfs', {}).get('oid')
        size = shard['size']
        if destination.exists() and destination.stat().st_size == size:
            if not expected_hash or sha256_file(destination) == expected_hash:
                log(f'Cached and verified {shard["path"]}')
                continue
        url = ('https://huggingface.co/datasets/' + quote(args.repo, safe='/')
               + '/resolve/' + commit + '/' + quote(shard['path'], safe='/')
               + '?download=true')
        part_dir = parts_root / relative
        shard_tasks = []
        for i, start in enumerate(range(0, size, args.chunk_mib * 1024 * 1024)):
            end = min(size - 1, start + args.chunk_mib * 1024 * 1024 - 1)
            task = (url, start, end, part_dir / f'{i:06d}.part')
            tasks.append(task)
            shard_tasks.append(task)
        pending_shards.append((shard, destination, shard_tasks))
    total = sum(end - start + 1 for _, start, end, _ in tasks)
    complete = 0
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch_part, task, args) for task in tasks]
        for future in as_completed(futures):
            complete += future.result()
            elapsed = max(0.001, time.monotonic() - started)
            log(f'Download {complete / 1e6:.1f}/{total / 1e6:.1f} MB '
                f'({complete / elapsed / 1e6:.2f} MB/s including resumed parts)')
    for shard, destination, shard_tasks in pending_shards:
        destination.parent.mkdir(parents=True, exist_ok=True)
        assembled = destination.with_name(destination.name + '.assembling')
        digest = hashlib.sha256()
        with assembled.open('wb') as output:
            for _, _, _, part in shard_tasks:
                with part.open('rb') as source:
                    for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
                        output.write(block)
                        digest.update(block)
        actual_hash = digest.hexdigest()
        expected_hash = shard.get('lfs', {}).get('oid')
        if assembled.stat().st_size != shard['size'] or (expected_hash and actual_hash != expected_hash):
            assembled.unlink(missing_ok=True)
            raise RuntimeError(f'Size/checksum mismatch for {shard["path"]}; '
                               'remove its .download-parts directory and retry')
        os.replace(assembled, destination)
        log(f'Verified SHA256 {shard["path"]}: {actual_hash}')
        if not args.keep_parts:
            for _, _, _, part in shard_tasks:
                part.unlink(missing_ok=True)
    return paths


def normalize(value):
    return str(PurePosixPath(str(value).replace('\\', '/'))).removeprefix('./')


def build_coco_index(specs):
    exact = {}
    file_names = {}
    entries = []
    for spec in specs:
        if '=' in spec:
            prefix, filename = spec.split('=', 1)
        else:
            prefix, filename = '', spec
        source = Path(filename)
        data = json.loads(source.read_text())
        annotations = {}
        for annotation in data.get('annotations', []):
            annotations.setdefault(annotation['image_id'], []).append(annotation)
        for image in data['images']:
            item = {'source': str(source), 'prefix': prefix, 'image': image,
                    'annotations': annotations.get(image['id'], []),
                    'categories': data.get('categories', [])}
            entries.append(item)
            filename_key = normalize(image['file_name'])
            canonical = normalize(str(PurePosixPath(prefix) / filename_key))
            exact.setdefault(canonical, []).append(item)
            file_names.setdefault(filename_key, []).append(item)
    return exact, file_names, entries


def match_coco(original_path, dimensions, exact, file_names):
    if not exact:
        return {'status': 'not_requested'}
    key = normalize(original_path or '')
    candidates = exact.get(key, [])
    method = 'exact_path'
    if not candidates:
        # Compare complete COCO file_name suffixes, never blindly take basename.
        # Every candidate must be globally unique across all COCO inputs.
        matches = []
        for filename, entries in file_names.items():
            if key == filename or key.endswith('/' + filename):
                matches.extend(entries)
        candidates = matches
        method = 'unique_exact_filename_suffix'
    if len(candidates) != 1:
        return {'status': 'ambiguous' if candidates else 'unmatched',
                'candidates': [{'source': c['source'], 'prefix': c['prefix'],
                                'image_id': c['image']['id'],
                                'file_name': c['image']['file_name']} for c in candidates]}
    item = candidates[0]
    image = item['image']
    match = {'status': 'matched', 'method': method, 'source': item['source'],
             'prefix': item['prefix'], 'image_id': image['id'],
             'file_name': image['file_name'],
             'width': image.get('width'), 'height': image.get('height'),
             'annotations': item['annotations'], 'categories': item['categories']}
    if tuple(dimensions) != (image.get('width'), image.get('height')):
        match['status'] = 'dimension_mismatch'
    return match


def extract_shards(args, paths):
    import pyarrow.parquet as pq
    from PIL import Image
    exact, file_names, coco_entries = build_coco_index(args.coco)
    images_dir = args.output / 'images'
    images_dir.mkdir(exist_ok=True)
    metadata_temp = args.output / 'rows.jsonl.tmp'
    stats = {'rows': 0, 'matches': {}, 'image_path_missing': 0,
             'resized': 0, 'output': str(args.output), 'coco_images': len(coco_entries)}
    seen_outputs = {}
    with metadata_temp.open('w') as metadata:
        for shard in paths:
            parquet = pq.ParquetFile(shard)
            index_in_shard = 0
            for batch in parquet.iter_batches(batch_size=args.batch_size):
                for row in batch.to_pylist():
                    item = row.pop(args.image_column)
                    image_bytes = item.get('bytes') if isinstance(item, dict) else item
                    original_path = item.get('path') if isinstance(item, dict) else None
                    if image_bytes is None:
                        raise RuntimeError(f'{shard}:{index_in_shard} contains no embedded image bytes')
                    digest = hashlib.sha256(image_bytes).hexdigest()
                    with Image.open(io.BytesIO(image_bytes)) as image:
                        width, height = image.size
                        source_format = image.format
                        resized = bool(args.max_side and max(width, height) > args.max_side)
                        if resized:
                            image.thumbnail((args.max_side, args.max_side), Image.Resampling.LANCZOS)
                        output_width, output_height = image.size
                        if args.naming == 'row':
                            relative = Path(f'{stats["rows"]:08d}.jpg')
                        elif original_path:
                            try:
                                relative = safe_relative(original_path)
                            except ValueError:
                                relative = Path(shard.stem) / f'{index_in_shard:06d}'
                        else:
                            stats['image_path_missing'] += 1
                            relative = Path(shard.stem) / f'{index_in_shard:06d}'
                        # Re-encoded images receive an explicit JPEG suffix.
                        if resized:
                            relative = relative.with_suffix('.jpg')
                        elif not relative.suffix:
                            relative = relative.with_suffix('.' + (source_format or 'bin').lower())
                        key = str(relative)
                        if key in seen_outputs and seen_outputs[key] != digest:
                            raise RuntimeError(f'Output path collision for {key}; paths do not identify unique images')
                        seen_outputs[key] = digest
                        destination = images_dir / relative
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        temp = destination.with_name(destination.name + '.tmp')
                        if resized:
                            image.convert('RGB').save(temp, format='JPEG', quality=args.jpeg_quality)
                        else:
                            temp.write_bytes(image_bytes)
                        os.replace(temp, destination)
                    match = match_coco(original_path, (width, height), exact, file_names)
                    stats['matches'][match['status']] = stats['matches'].get(match['status'], 0) + 1
                    stats['resized'] += int(resized)
                    record = {'shard': str(shard.relative_to(args.output)),
                              'row_in_shard': index_in_shard, 'row_index': stats['rows'],
                              'row_idx': stats['rows'], 'image': str(destination),
                              'source_path': original_path, 'sha256': digest,
                              'original_path': original_path,
                              'output_path': str(destination.relative_to(args.output)),
                              'original_sha256': digest, 'original_bytes': len(image_bytes),
                              'width': width, 'height': height,
                              'output_width': output_width, 'output_height': output_height,
                              'scale_x': output_width / width, 'scale_y': output_height / height,
                              'metadata': row, 'coco': match}
                    for extra_key, extra_value in row.items():
                        if extra_key not in record and isinstance(extra_value, (str, int, float, bool, type(None))):
                            record[extra_key] = extra_value
                    metadata.write(json.dumps(record, ensure_ascii=False, default=str) + '\n')
                    index_in_shard += 1
                    stats['rows'] += 1
                metadata.flush()
            log(f'Extracted {shard.name}: {index_in_shard} images; total {stats["rows"]}')
    os.replace(metadata_temp, args.output / 'rows.jsonl')
    atomic_json(args.output / 'extraction-summary.json', stats)
    log(json.dumps(stats, ensure_ascii=False))
    if args.require_coco_match and stats['matches'] != {'matched': stats['rows']}:
        raise RuntimeError('Some images have missing, ambiguous, or dimension-incompatible COCO matches; '
                           'see rows.jsonl. No labels were generated.')


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='Hugging Face dataset repository org/name')
    parser.add_argument('--revision', default='main')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--chunk-mib', type=int, default=32)
    parser.add_argument('--retries', type=int, default=6)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--max-side', type=int, default=0, help='0 preserves original embedded image bytes')
    parser.add_argument('--jpeg-quality', type=int, default=92)
    parser.add_argument('--image-column', default='image')
    parser.add_argument('--naming', choices=['row', 'source'], default='row',
                        help='row gives stable unique image filenames; source preserves safe embedded paths')
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--coco', action='append', default=[], metavar='[PREFIX=]FILE',
                        help='Original COCO JSON; optional explicit path prefix. Repeatable.')
    parser.add_argument('--require-coco-match', action='store_true')
    parser.add_argument('--keep-parts', action='store_true')
    parser.add_argument('--download-only', action='store_true')
    parser.add_argument('--extract-only', action='store_true')
    parser.add_argument('--manifest-only', action='store_true')
    args = parser.parse_args()
    if min(args.workers, args.chunk_mib, args.retries, args.batch_size) < 1:
        parser.error('workers, chunk-mib, retries, and batch-size must be positive')
    if args.max_side < 0 or not 1 <= args.jpeg_quality <= 100:
        parser.error('max-side must be >= 0; jpeg-quality must be 1..100')
    if args.require_coco_match and not args.coco:
        parser.error('--require-coco-match requires --coco')
    args.output = args.output.expanduser().resolve()
    return args


def main():
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / 'download-manifest.json'
    if args.extract_only:
        manifest = json.loads(manifest_path.read_text())
        if manifest['repo'] != args.repo:
            raise RuntimeError('Existing manifest belongs to a different repository')
        paths = [args.output / 'parquet' / safe_relative(s['path']) for s in manifest['shards']]
    else:
        commit, shards = list_shards(args.repo, args.revision)
        manifest = {'repo': args.repo, 'requested_revision': args.revision,
                    'commit': commit, 'shards': shards,
                    'bytes': sum(s['size'] for s in shards)}
        if manifest_path.exists():
            previous = json.loads(manifest_path.read_text())
            if previous.get('repo') != args.repo or previous.get('commit') != commit:
                raise RuntimeError('Output directory contains a different repo/revision; choose another output')
        atomic_json(manifest_path, manifest)
        log(f'Resolved {args.repo}@{commit}: {len(shards)} shards, {manifest["bytes"] / 1e9:.3f} GB')
        if args.manifest_only:
            return
        paths = download_shards(args, commit, shards)
    if not args.download_only:
        extract_shards(args, paths)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        log(f'ERROR: {type(error).__name__}: {error}')
        sys.exit(1)
