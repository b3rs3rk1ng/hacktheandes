"""Derive cylindrical skin textures from annotated TRAIN crops, never test photos.

The sinusoidal projection samples inside the fruit silhouette approximation and
wraps continuously around a mesh. Provenance is retained. These assets are not an
independent benchmark of the detector trained on their source photographs.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps


def prepare(manifest, output, names, per_class=4):
    rows=json.loads(Path(manifest).read_text());output=Path(output);output.mkdir(parents=True,exist_ok=True)
    candidates={c:[] for c in range(len(names))}
    for row in rows:
        if row['split']!='train' or row.get('augmentation'):continue
        for box in row['boxes']:
            x1,y1,x2,y2=box['bbox'];area=(x2-x1)*(y2-y1)
            if min(x2-x1,y2-y1)<100 or area/(row['width']*row['height'])<.08:continue
            key=hashlib.sha256((str(row['id'])+str(box['bbox'])).encode()).hexdigest()
            candidates[box['class_id']].append((key,row,box))
    records=[]
    for c,items in candidates.items():
        used=set();count=0
        for _,row,box in sorted(items,key=lambda p:p[0]):
            if row['image'] in used:continue
            used.add(row['image']);path=Path(row['image'])
            with Image.open(path) as raw:crop=ImageOps.exif_transpose(raw).convert('RGB').crop(tuple(box['bbox'])).resize((512,1024))
            pixels=np.asarray(crop)
            u,v=np.meshgrid(np.linspace(0,1,512),np.linspace(0,1,1024))
            # Polar silhouette of a vertically oriented cacao pod.
            silhouette=np.sqrt(np.clip(1-(2*v-1)**2,0,1))
            px=np.clip(np.round(255.5+200*np.sin(math.tau*u)*silhouette),0,511).astype(int)
            py=np.clip(np.round(25+v*974),0,1023).astype(int)
            texture=Image.fromarray(pixels[py,px]);name=f'{names[c]}-{count}.jpg';texture.save(output/name,quality=91)
            records.append({'file':name,'class_name':names[c],'class_id':c,'source_id':row['id'],'source_image':str(path),'source_split':'train','source_bbox':box['bbox'],'original_stages':box.get('original_stages',[]),'sha256':hashlib.sha256((output/name).read_bytes()).hexdigest()})
            count+=1
            if count>=per_class:break
        if count!=per_class:raise ValueError(f'Not enough eligible training crops for class {c}')
    (output/'provenance.json').write_text(json.dumps({'manifest_sha256':hashlib.sha256(Path(manifest).read_bytes()).hexdigest(),'license':'Source dataset licenses apply; see scene asset credits.','independent_validation':False,'records':records},indent=2))
    print(json.dumps({'textures':len(records),'output':str(output)}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--output',required=True);p.add_argument('--names',nargs='+',required=True);p.add_argument('--per-class',type=int,default=4);a=p.parse_args()
    prepare(a.manifest,a.output,a.names,a.per_class)
