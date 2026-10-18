#!/usr/bin/env python3
"""Adapt an independent YOLO-box dataset ZIP/directory to a frozen test manifest.

Source classes and target meanings come from explicit JSON configuration, never
from directory names. Pixel boxes use xyxy. Only test images are produced.
Requires Pillow; no ML framework, service, credentials, or training.
"""
from __future__ import annotations
import argparse,collections,hashlib,io,json,math,os
from pathlib import Path,PurePosixPath
import zipfile
from PIL import Image,ImageOps

IMAGE_SUFFIXES={'.jpg','.jpeg','.png','.bmp','.webp','.tif','.tiff'}

class Source:
    def __init__(self,path):
        self.path=path.resolve();self.archive=None
        if path.is_file():
            self.archive=zipfile.ZipFile(path)
            infos=[i for i in self.archive.infolist() if not i.is_dir()]
            names=[i.filename for i in infos]
            if len(set(names))!=len(names):raise ValueError('ZIP contains duplicate member names')
        else:names=[str(p.relative_to(path)).replace(os.sep,'/') for p in path.rglob('*') if p.is_file()]
        for name in names:
            p=PurePosixPath(name.replace('\\','/'))
            if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe source path: '+name)
        self.names=set(names)
    def read(self,name):
        if self.archive:return self.archive.read(name)
        return (self.path/Path(*PurePosixPath(name).parts)).read_bytes()
    def close(self):
        if self.archive:self.archive.close()

def transformed_box(box,orientation,width,height):
    x1,y1,x2,y2=box
    def point(x,y):
        return {1:(x,y),2:(width-x,y),3:(width-x,height-y),4:(x,height-y),
                5:(y,x),6:(height-y,x),7:(height-y,width-x),8:(y,width-x)}[orientation]
    points=[point(x,y) for x in [x1,x2] for y in [y1,y2]]
    return [min(x for x,y in points),min(y for x,y in points),
            max(x for x,y in points),max(y for x,y in points)]

def parse_labels(text,source_mapping,width,height,tolerance=0.0,repairs=None):
    boxes=[]
    for number,line in enumerate(text.splitlines(),1):
        if not line.strip():continue
        fields=line.split()
        if len(fields)!=5:raise ValueError(f'Line {number}: expected YOLO class,cx,cy,w,h, got {len(fields)} fields')
        values=[float(x) for x in fields]
        if not all(math.isfinite(v) for v in values):raise ValueError(f'Line {number}: nonfinite number')
        source_id=int(values[0])
        if source_id!=values[0] or source_id not in source_mapping:raise ValueError(f'Line {number}: unmapped source class {values[0]}')
        cx,cy,w,h=values[1:]
        x1,y1,x2,y2=cx-w/2,cy-h/2,cx+w/2,cy+h/2
        original=[x1,y1,x2,y2]
        if not (x1<x2 and y1<y2) or any(v < -tolerance or v > 1+tolerance for v in original):
            raise ValueError(f'Line {number}: out-of-bounds/zero-area normalized xyxy {original}, tolerance={tolerance}')
        corrected=[min(1.0,max(0.0,v)) for v in original]
        x1,y1,x2,y2=corrected
        if not (x1<x2 and y1<y2):
            raise ValueError(f'Line {number}: zero-area box after boundary repair: {original}')
        repair=None
        if corrected!=original:
            repair={'line':number,'source_class_id':source_id,
                    'original_normalized_xyxy':original,
                    'repaired_normalized_xyxy':corrected,'tolerance':tolerance}
            if repairs is not None:repairs.append(repair)
        entry=source_mapping[source_id]
        box={'class_id':entry['target_id'],'source_class_id':source_id,
             'source_class_name':entry['source_name'],'role':entry.get('role'),
             'bbox':[x1*width,y1*height,x2*width,y2*height]}
        if repair is not None:box['coordinate_repair']=repair
        boxes.append(box)
    return boxes

def main():
    p=argparse.ArgumentParser(description=__doc__)
    source=p.add_mutually_exclusive_group(required=True);source.add_argument('--zip',type=Path);source.add_argument('--root',type=Path)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--mapping',type=Path,required=True)
    p.add_argument('--max-side',type=int,default=1280);p.add_argument('--jpeg-quality',type=int,default=95)
    p.add_argument('--box-tolerance',type=float,default=0.0,
                   help='Explicit normalized-coordinate boundary tolerance; within-tolerance repairs are recorded. Default 0 is strict.')
    p.add_argument('--box-frame',choices=['require-unoriented','raw','display'],default='require-unoriented',
                   help='Reject nonidentity EXIF by default; raw rotates boxes, display assumes boxes already refer to displayed pixels')
    p.add_argument('--invalid-image',choices=['exclude','fail'],default='exclude',help='Whole-image policy; no individual boxes are silently removed')
    args=p.parse_args();out=args.output.expanduser().resolve()
    if out.exists() and any(out.iterdir()):raise ValueError('Output directory must be new or empty; refusing stale or overwritten artifacts')
    out.mkdir(parents=True,exist_ok=True)
    if args.max_side<0 or not 1<=args.jpeg_quality<=100:p.error('Invalid max-side/jpeg-quality')
    if not math.isfinite(args.box_tolerance) or args.box_tolerance<0:p.error('box-tolerance must be finite and nonnegative')
    cfg=json.loads(args.mapping.read_text());classes=cfg['classes'];mapping={}
    ids={int(c['target_id']) for c in classes}
    if ids!=set(range(len(ids))):raise ValueError('Target IDs must be contiguous starting at zero')
    names={c['target_id']:c['target_name'] for c in classes}
    if len(names)!=len(ids):raise ValueError('Inconsistent target names')
    for c in classes:
        sid=int(c['source_id'])
        if sid in mapping:raise ValueError('Repeated source class ID')
        mapping[sid]=c
    src=Source(args.zip or args.root)
    class_files=sorted(n for n in src.names if PurePosixPath(n).name=='classes.txt')
    expected=[mapping[i]['source_name'] for i in range(max(mapping)+1)]
    for name in class_files:
        actual=src.read(name).decode('utf-8-sig').splitlines()
        if actual!=expected:raise ValueError(f'classes.txt differs from configured IDs at {name}: {actual} != {expected}')
    if cfg.get('require_class_files',False) and not class_files:raise ValueError('Required classes.txt is missing')
    sources=sorted(n for n in src.names if PurePosixPath(n).suffix.lower() in IMAGE_SUFFIXES)
    if not sources:raise ValueError('No images found')
    (out/'images'/'test').mkdir(parents=True,exist_ok=True);(out/'labels'/'test').mkdir(parents=True,exist_ok=True)
    manifest=[];excluded=[];box_repairs=[];orientations=collections.Counter();counts=collections.Counter();seen_pixels={};coco_images=[];coco_anns=[]
    for name in sources:
        label_name=str(PurePosixPath(name).with_suffix('.txt'))
        try:
            if label_name not in src.names:raise ValueError('Missing sidecar TXT annotation')
            content=src.read(name);source_sha=hashlib.sha256(content).hexdigest()
            with Image.open(io.BytesIO(content)) as raw:
                raw_size=raw.size;orientation=int(raw.getexif().get(274,1));orientations[str(orientation)]+=1
                if orientation not in range(1,9):raise ValueError(f'Unsupported EXIF orientation {orientation}')
                if orientation!=1 and args.box_frame=='require-unoriented':raise ValueError(f'EXIF orientation {orientation}: declare --box-frame raw or display after visual review')
                display=ImageOps.exif_transpose(raw).convert('RGB');display_size=display.size
                label_size=raw_size if args.box_frame=='raw' else display_size
                local_repairs=[]
                boxes=parse_labels(src.read(label_name).decode('utf-8-sig'),mapping,*label_size,
                                   tolerance=args.box_tolerance,repairs=local_repairs)
                if args.box_frame=='raw' and orientation!=1:
                    for b in boxes:b['bbox']=transformed_box(b['bbox'],orientation,*raw_size)
                pixel_sha=hashlib.sha256(display.width.to_bytes(4,'big')+display.height.to_bytes(4,'big')+display.tobytes()).hexdigest()
                if args.max_side:display.thumbnail((args.max_side,args.max_side),Image.Resampling.LANCZOS)
                width,height=display.size;sx=width/display_size[0];sy=height/display_size[1]
                for box in boxes:
                    box['bbox']=[v*(sx if i%2==0 else sy) for i,v in enumerate(box['bbox'])]
                    x1,y1,x2,y2=box['bbox']
                    if not (0<=x1<x2<=width and 0<=y1<y2<=height):raise ValueError('Transformed box outside displayed image')
                identifier=hashlib.sha256(name.encode()+b'\0'+bytes.fromhex(source_sha)).hexdigest()[:24]
                image_path=out/'images'/'test'/(identifier+'.jpg');display.save(image_path,quality=args.jpeg_quality)
            row={'id':identifier,'image':str(image_path),'split':'test','width':width,'height':height,
                 'source_image':name,'source_label':label_name,'sources':[[str(src.path),name]],
                 'source_sha256':source_sha,'pixelsha':pixel_sha,'boxes':boxes,
                 'source_raw_size':list(raw_size),'source_display_size':list(display_size),
                 'source_exif_orientation':orientation,'box_frame_contract':args.box_frame}
            if pixel_sha in seen_pixels:row['exact_pixel_duplicate_of']=seen_pixels[pixel_sha]
            else:seen_pixels[pixel_sha]=identifier
            manifest.append(row)
            box_repairs.extend({'source_image':name,**repair} for repair in local_repairs)
            lines=[]
            for box in boxes:
                x1,y1,x2,y2=box['bbox'];cid=box['class_id'];counts[names[cid]]+=1
                lines.append(f'{cid} {(x1+x2)/(2*width):.10f} {(y1+y2)/(2*height):.10f} {(x2-x1)/width:.10f} {(y2-y1)/height:.10f}')
                coco_anns.append({'id':len(coco_anns)+1,'image_id':len(manifest),'category_id':cid+1,
                                  'bbox':[x1,y1,x2-x1,y2-y1],'area':(x2-x1)*(y2-y1),'iscrowd':0})
            (out/'labels'/'test'/(identifier+'.txt')).write_text('\n'.join(lines)+'\n')
            coco_images.append({'id':len(manifest),'file_name':str(image_path.relative_to(out)), 'width':width,'height':height})
        except Exception as error:
            excluded.append({'image':name,'label':label_name,'reason':str(error)})
            if args.invalid_image=='fail':raise
    src.close()
    if not manifest:raise ValueError('All images excluded; inspect annotation/EXIF contract')
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    (out/'data.yaml').write_text('path: '+json.dumps(str(out))+'\ntrain: null\nval: images/test\ntest: images/test\nnames:\n'+''.join(f'  {i}: {json.dumps(names[i])}\n' for i in sorted(names)))
    # YAML val aliases the same test files for library compatibility; train is null. Manifest rows
    # remain test-only: never use this YAML to select a checkpoint or threshold.
    coco={'images':coco_images,'annotations':coco_anns,'categories':[{'id':i+1,'name':names[i]} for i in sorted(names)]}
    (out/'instances_test.json').write_text(json.dumps(coco,indent=2)+'\n')
    report={'source':str(args.zip or args.root),'mapping':cfg,'box_frame_contract':args.box_frame,
            'source_images':len(sources),'exported_images':len(manifest),'excluded_images':excluded,
            'box_tolerance_normalized':args.box_tolerance,'repaired_boxes':len(box_repairs),'box_repairs':box_repairs,
            'class_files':class_files,'exif_orientations':dict(orientations),'box_counts':dict(counts),
            'pixel_duplicate_images':len(manifest)-len(seen_pixels),'manifest_sha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest(),
            'evaluation_only':True,'caution':'val YAML path aliases test only for validation-library compatibility; train is null; no fitting or threshold selection on external data'}
    (out/'audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['mapping','class_files','excluded_images','box_repairs']},indent=2));print('Excluded',len(excluded))
if __name__=='__main__':main()
