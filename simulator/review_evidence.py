"""Immutable photographs tied to a particular inference box, not scene labels."""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import uuid


def save_evidence(directory, jpeg, prediction, frame, localization=None):
    from PIL import Image, ImageDraw
    bbox=prediction.get('bbox')
    if not isinstance(bbox,list) or len(bbox)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in bbox):
        raise ValueError('La predicción no tiene una caja válida')
    with Image.open(io.BytesIO(jpeg)) as source:image=source.convert('RGB')
    w,h=image.size
    x1,y1,x2,y2=[max(0,min(w if i%2==0 else h,round(v))) for i,v in enumerate(bbox)]
    if x2<=x1 or y2<=y1:raise ValueError('La caja está fuera de la foto')
    identifier=hashlib.sha256(jpeg+json.dumps([x1,y1,x2,y2]).encode()).hexdigest()
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    dx,dy=max(12,(x2-x1)//3),max(12,(y2-y1)//3)
    crop=image.crop((max(0,x1-dx),max(0,y1-dy),min(w,x2+dx),min(h,y2+dy)))
    annotated=image.copy();ImageDraw.Draw(annotated).rectangle((x1,y1,x2-1,y2-1),outline=(239,187,104),width=3)
    for suffix,pixels in [('',annotated),('-crop',crop)]:
        destination=directory/(identifier+suffix+'.jpg')
        if not destination.exists():
            temporary=directory/(uuid.uuid4().hex+'.tmp')
            pixels.save(temporary,format='JPEG',quality=91);temporary.replace(destination)
    original=directory/(identifier+'-original.jpg')
    if not original.exists():
        temporary=directory/(uuid.uuid4().hex+'.tmp');temporary.write_bytes(jpeg);temporary.replace(original)
    return {'id':identifier,'image_url':f'/api/review/evidence/{identifier}.jpg',
            'crop_url':f'/api/review/evidence/{identifier}-crop.jpg','original_url':f'/api/review/evidence/{identifier}-original.jpg',
            'frame_id':frame['frame_id'],'captured_at':frame['wall_time'],
            'bbox':[x1,y1,x2,y2],'width':w,'height':h,
            'camera':frame.get('camera'),'localization':localization,
            'sha256_original':hashlib.sha256(jpeg).hexdigest()}


def evidence_path(directory, name):
    if not re.fullmatch(r'[a-f0-9]{64}(?:-crop|-original)?\.jpg',name):return None
    path=Path(directory)/name
    return path if path.is_file() else None
