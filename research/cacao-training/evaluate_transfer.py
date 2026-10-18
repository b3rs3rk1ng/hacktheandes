"""Evaluate independent labelled images with a frozen internal threshold.

Class remapping is explicit configuration. Other diseases remain distinct GT.
No checkpoint or threshold selection occurs in this program.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from evaluate_detector import evaluate, json_write, match, predict_boxes, validate_manifest_rows
from prepare_dataset import phash


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--weights', type=Path, required=True)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--internal-report', type=Path, required=True)
    p.add_argument('--internal-manifest', type=Path, required=True)
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--device', default='0')
    args = p.parse_args()
    import cv2
    import torch
    from PIL import Image, ImageOps
    from ultralytics import YOLO
    torch.set_num_threads(4); cv2.setNumThreads(2)
    cfg = json.loads(args.config.read_text()); names = cfg['names']
    previous = json.loads(args.internal_report.read_text())
    weights_sha = hashlib.sha256(args.weights.read_bytes()).hexdigest()
    if weights_sha != previous['weights_sha256']: raise ValueError('Internal threshold belongs to different weights')
    if hashlib.sha256(args.internal_manifest.read_bytes()).hexdigest() != previous['manifest_sha256']:
        raise ValueError('Internal dataset fingerprint disagrees with the frozen evaluation')
    threshold = previous['threshold_selection']['threshold']
    rows = validate_manifest_rows(json.loads(args.manifest.read_text()), names,
                                 allowed_splits=('test',), required_splits=('test',))
    internal = json.loads(args.internal_manifest.read_text())
    hashes = [(r['id'], int(r['phash'],16)) for r in internal]
    excluded = []; eligible = []
    for row in rows:
        with Image.open(row['image']) as im:
            value = phash(ImageOps.exif_transpose(im).convert('RGB'))
        close = [(identifier,(value ^ h).bit_count()) for identifier,h in hashes if (value ^ h).bit_count() <= cfg['duplicate_phash_distance']]
        if close or row.get('exact_pixel_duplicate_of'):
            excluded.append({'id':row['id'],'near_internal_images':close,'exact_external_duplicate':row.get('exact_pixel_duplicate_of')})
        else: eligible.append(row)
    if not eligible: raise ValueError('No eligible independent images')
    model = YOLO(str(args.weights))
    mapping = {int(i): cfg['prediction_class_mapping'][name] for i,name in model.names.items()}
    if any(not isinstance(c,int) or not 0 <= c < len(names) for c in mapping.values()): raise ValueError('Invalid prediction remapping')
    args.output.mkdir(parents=True,exist_ok=True)
    all_predictions={}; other_errors={str(c):0 for c in cfg['other_disease_classes']}
    with (args.output/'predictions.jsonl').open('w') as f:
        for i,row in enumerate(eligible):
            im=cv2.imread(row['image'])
            if im is None: raise ValueError('Cannot decode '+row['image'])
            pred = predict_boxes(model,im,previous['imgsz'],args.device,mapping)
            all_predictions[str(row['id'])]=pred
            selected=[p for p in pred if p['confidence'] >= threshold]
            f.write(json.dumps({'id':row['id'],'source_image':row.get('source_image'),'ground_truth':row['boxes'],'predictions':selected})+'\n')
            target=[p for p in selected if p['class_id']==cfg['target_disease_class']]
            for _,gi,_ in match(target,row['boxes']):
                c=str(row['boxes'][gi]['class_id'])
                if c in other_errors: other_errors[c]+=1
            if (i+1)%50==0: print(json.dumps({'stage':'external','completed':i+1,'total':len(eligible)}),flush=True)
    metrics=evaluate(eligible,all_predictions,threshold,names,cfg['healthy_class'],cfg['target_disease_class'])
    # This benchmark has disease categories, not symptom stages: use explicit names.
    metrics.pop('early_symptom',None)
    metrics['any_annotated_disease']=metrics.pop('binary')
    report={'weights_sha256':weights_sha,'threshold':threshold,'threshold_fitted_on':'internal validation only',
            'internal_report_sha256':hashlib.sha256(args.internal_report.read_bytes()).hexdigest(),
            'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
            'mapping':cfg,'input_images':len(rows),'eligible_images':len(eligible),'excluded_duplicates':excluded,
            'other_disease_pods_predicted_as_target':other_errors,'metrics':metrics,
            'limitations':['External still photos, not flight or camera-motion validation.',
                          'No test-time threshold fitting; duplicate checks are conservative perceptual proxies.',
                          'Labels are public-dataset annotations, not independent laboratory diagnoses.',
                          'Classes in other_disease_classes count as false positives for the specific target disease, and as positives for any-annotated-disease metrics.']}
    json_write(args.output/'evaluation.json',report)
    print(json.dumps({'eligible_images':len(eligible),'per_class':metrics['per_class'],'other_disease_target_errors':other_errors},indent=2),flush=True)


if __name__=='__main__':main()
