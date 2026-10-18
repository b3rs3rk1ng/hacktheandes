#!/usr/bin/env python3
"""Stream configured archives into a frozen image-classification test set.

No raw archive extraction. Labels are explicit per-archive metadata, never inferred
from member folders. Images have no invented object bounding boxes.
Dependencies: Pillow numpy scipy libarchive-c, plus system libarchive with format support.
"""
import argparse,collections,hashlib,io,json,math,re,sys
from pathlib import Path,PurePosixPath
import numpy as np
from PIL import Image,ImageOps
from scipy.fft import dctn
import libarchive

IMAGE_SUFFIXES={'.jpg','.jpeg','.png','.bmp','.tif','.tiff','.webp'}
def sha_file(path):
 h=hashlib.sha256()
 with path.open('rb') as src:
  for block in iter(lambda:src.read(8*1024*1024),b''):h.update(block)
 return h.hexdigest()
def phash(image):
 arr=np.asarray(image.convert('L').resize((32,32)),dtype=float)
 coef=dctn(arr,type=2,norm='ortho')[:8,:8].ravel();bits=coef>np.median(coef[1:])
 return f'{sum(int(v)<<i for i,v in enumerate(bits)):016x}'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True,type=Path);p.add_argument('--archives',required=True,type=Path);p.add_argument('--output',required=True,type=Path)
 p.add_argument('--max-side',type=int,default=1280);p.add_argument('--jpeg-quality',type=int,default=95);p.add_argument('--max-member-mib',type=int,default=128)
 p.add_argument('--skip-archive-hash-check',action='store_true',help='Only for inputs already verified separately; records this exception')
 a=p.parse_args();out=a.output.expanduser().resolve()
 if out.exists() and any(out.iterdir()):raise ValueError('Output must be new or empty')
 if a.max_side<0 or not 1<=a.jpeg_quality<=100 or a.max_member_mib<1:p.error('Invalid image size/quality/limit')
 cfg=json.loads(a.config.read_text());classes=cfg['classes'];group_regex=re.compile(cfg['capture_group_regex']) if cfg.get('capture_group_regex') else None
 out.mkdir(parents=True,exist_ok=True);(out/'images'/'test').mkdir(parents=True,exist_ok=True)
 rows=[];archives_audit=[];nonimage_members=[];orientations=collections.Counter();counts=collections.Counter();pixel_seen={};duplicates=[]
 for declared in cfg['files']:
  name=declared['name'];local=a.archives/Path(*PurePosixPath(name).parts)
  if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:raise ValueError('Unsafe archive name')
  label=declared['label_class_id']
  if isinstance(label,bool) or not isinstance(label,int) or not 0<=label<len(classes):raise ValueError('Invalid declared archive label')
  if not declared.get('label_source'):raise ValueError('Archive labels require explicit provenance')
  if local.stat().st_size!=declared['size']:raise ValueError('Archive size differs from manifest: '+name)
  actual_sha=declared['sha256'] if a.skip_archive_hash_check else sha_file(local)
  if actual_sha!=declared['sha256']:raise ValueError('Archive SHA256 mismatch: '+name)
  archive_count=0;member_names=set()
  with libarchive.file_reader(str(local)) as archive:
   for entry in archive:
    member=str(entry.pathname).replace('\\','/');parts=PurePosixPath(member)
    if parts.is_absolute() or '..' in parts.parts:raise ValueError('Unsafe archive member: '+member)
    if not entry.isfile:continue
    if member in member_names:raise ValueError('Repeated archive image path: '+member)
    member_names.add(member)
    if parts.suffix.lower() not in IMAGE_SUFFIXES:
     nonimage_members.append({'archive':name,'member':member,'size':entry.size});continue
    if entry.size>a.max_member_mib*1024*1024:raise ValueError('Image exceeds memory limit: '+member)
    payload=bytearray()
    for block in entry.get_blocks():
     payload.extend(block)
     if len(payload)>a.max_member_mib*1024*1024:raise ValueError('Decoded archive member exceeds memory limit')
    if len(payload)!=entry.size:raise ValueError('Truncated archive member: '+member)
    source_sha=hashlib.sha256(payload).hexdigest()
    with Image.open(io.BytesIO(payload)) as raw:
     orientation=int(raw.getexif().get(274,1));orientations[str(orientation)]+=1;raw_size=raw.size
     image=ImageOps.exif_transpose(raw).convert('RGB');source_size=image.size
     pixelsha=hashlib.sha256(image.tobytes()+str(image.size).encode()).hexdigest();perceptual=phash(image)
     identifier=hashlib.sha256((name+'\0'+member+'\0'+source_sha).encode()).hexdigest()[:24]
     match=group_regex.search(member) if group_regex else None
     capture_group=match.group(1) if match else 'archive:'+name
     if a.max_side:image.thumbnail((a.max_side,a.max_side),Image.Resampling.LANCZOS)
     destination=out/'images'/'test'/(identifier+'.jpg');image.save(destination,quality=a.jpeg_quality)
     row={'id':identifier,'image':str(destination),'split':'test','label_class_id':label,'label_name':classes[label],
          'label_source':declared['label_source'],'source_archive':name,'source_image':member,
          'source_sha256':source_sha,'pixelsha':pixelsha,'phash':perceptual,
          'phash_algorithm':'dctn_type2_ortho_32x32_low8x8_median_excluding_dc_little_bit_order',
          'capture_group':capture_group,'group':capture_group,'width':image.width,'height':image.height,
          'source_raw_size':list(raw_size),'source_display_size':list(source_size),'source_exif_orientation':orientation,
          'annotation_type':'author_archive_image_classification','has_object_boxes':False}
    if pixelsha in pixel_seen:
     row['exact_pixel_duplicate_of']=pixel_seen[pixelsha];duplicates.append({'id':identifier,'duplicate_of':pixel_seen[pixelsha],'same_label':next(r['label_class_id'] for r in rows if r['id']==pixel_seen[pixelsha])==label})
    else:pixel_seen[pixelsha]=identifier
    rows.append(row);archive_count+=1;counts[classes[label]]+=1
    if archive_count%100==0:print(f'{name}: {archive_count} images; total {len(rows)}',flush=True)
  expected=declared.get('expected_images')
  archives_audit.append({'archive':name,'sha256':actual_sha,'sha256_verified':not a.skip_archive_hash_check,'images':archive_count,'expected_images':expected})
  if expected is not None and archive_count!=expected:raise ValueError(f'Archive image count differs from author metadata: {name} {archive_count} != {expected}')
 (out/'manifest.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
 (out/'classes.json').write_text(json.dumps({'classes':classes,'evaluation_only':True},indent=2)+'\n')
 audit={'source':cfg,'archives':archives_audit,'image_count':len(rows),'class_counts':dict(counts),'exif_orientations':dict(orientations),
        'capture_group_counts':dict(collections.Counter(r['capture_group'] for r in rows)),'exact_pixel_duplicates':duplicates,'nonimage_members':nonimage_members,
        'manifest_sha256':sha_file(out/'manifest.json'),'evaluation_only':True,
        'limits':'Author-provided image labels, no object boxes, no independently verified pathogen tests or source provenance; do not report object mAP/recall from this manifest. Compare hashes and pHashes against all development sources before evaluation.'}
 (out/'audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({k:audit[k] for k in ['image_count','class_counts','exif_orientations','capture_group_counts','manifest_sha256']},indent=2),flush=True)
if __name__=='__main__':main()
