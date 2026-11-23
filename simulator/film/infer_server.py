"""Temporary pixels-only inference for film capture, separate from live state."""
from http.server import HTTPServer,BaseHTTPRequestHandler
from pathlib import Path
import json,time,hashlib,argparse
import cv2,numpy as np,torch
from ultralytics import YOLO
parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path.cwd())
parser.add_argument('--port',type=int,default=19439)
parser.add_argument('--device',default='0')
args=parser.parse_args();root=args.root.resolve()
cfg=json.loads((root/'orchard_config.json').read_text());weights=Path(cfg['model']['weights'])
model=YOLO(str(weights));model.predict(np.zeros((384,640,3),dtype=np.uint8),device=args.device,verbose=False)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  data=self.rfile.read(int(self.headers['Content-Length']));img=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
  start=time.perf_counter();r=model.predict(img,conf=cfg['model']['proposal_confidence'],iou=cfg['model']['nms_iou'],agnostic_nms=True,imgsz=640,device=args.device,verbose=False)[0]
  result={'source':'trained_yolo11s_pixels_only','image_sha256':hashlib.sha256(data).hexdigest(),'names':model.names,'width':img.shape[1],'height':img.shape[0],'inference_ms':(time.perf_counter()-start)*1000,'predictions':[{'bbox':b.xyxy[0].cpu().tolist(),'class_id':int(b.cls[0]),'confidence':float(b.conf[0])} for b in r.boxes]}
  body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
print('Film inference ready',flush=True)
HTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
