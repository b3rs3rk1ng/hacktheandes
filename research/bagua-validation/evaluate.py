"""External baseline on folder-labelled Bagua photos. No training or threshold tuning."""
import argparse, hashlib, json, pathlib, statistics, time
import torch
from PIL import Image, ImageOps, ImageDraw
from torchvision import models, transforms

ROOT=pathlib.Path(__file__).resolve().parent
CLASSES=['Healthy','Carmenta foraseminis','Moniliophthora perniciosa','Moniliophthora roreri','Phytophthora palmivora']
TRANSFORM=transforms.Compose([transforms.Resize((224,224)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])

def build(name):
 if name=='MobileNetV3-Small':
  m=models.mobilenet_v3_small(weights=None);m.classifier[3]=torch.nn.Linear(m.classifier[3].in_features,5)
 elif name=='EfficientNet-B0':
  m=models.efficientnet_b0(weights=None);m.classifier[1]=torch.nn.Linear(m.classifier[1].in_features,5)
 elif name=='ResNet50':
  m=models.resnet50(weights=None);m.fc=torch.nn.Linear(m.fc.in_features,5)
 else: raise ValueError(name)
 return m

def binary(rows,predicate):
 tp=sum(r['label']=='enfermos' and predicate(r) for r in rows);fn=sum(r['label']=='enfermos' and not predicate(r) for r in rows)
 fp=sum(r['label']=='sanos' and predicate(r) for r in rows);tn=sum(r['label']=='sanos' and not predicate(r) for r in rows)
 return dict(confusion_rows_actual_healthy_diseased_cols_negative_positive=[[tn,fp],[fn,tp]],sensitivity=tp/(tp+fn),specificity=tn/(tn+fp),accuracy=(tp+tn)/len(rows),precision=tp/(tp+fp) if tp+fp else None)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--device',default='cuda');args=parser.parse_args()
 torch.set_num_threads(2);torch.manual_seed(20261018)
 manifest=json.loads((ROOT/'manifest-downloaded.json').read_text())
 label_by_hash={}
 for row in manifest:
  previous=label_by_hash.setdefault(row['sha256'],row['label'])
  if previous!=row['label']: raise ValueError('Conflicting labels for identical image '+row['sha256'])
 device=torch.device(args.device);out={}
 for name in ['MobileNetV3-Small','EfficientNet-B0','ResNet50']:
  path=ROOT/'weights'/(name+'_best.pth');state=torch.load(path,map_location='cpu',weights_only=True)
  if not isinstance(state,dict) or not all(isinstance(k,str) and torch.is_tensor(v) for k,v in state.items()): raise ValueError('Expected plain tensor state dict')
  model=build(name);model.load_state_dict(state,strict=True);model=model.to(device).eval()
  dummy=torch.zeros(1,3,224,224,device=device)
  with torch.inference_mode():
   for _ in range(10):model(dummy)
   torch.cuda.synchronize();t=time.perf_counter()
   for _ in range(100):model(dummy)
   torch.cuda.synchronize();latency=(time.perf_counter()-t)*1000/100
   rows=[]
   for row in manifest:
    t=time.perf_counter();im=Image.open(ROOT/row['path']).convert('RGB');x=TRANSFORM(im).unsqueeze(0).to(device);probs=model(x).softmax(1)[0].cpu().tolist();elapsed=(time.perf_counter()-t)*1000
    pred=max(range(5),key=probs.__getitem__);rows.append(dict(row,width=im.width,height=im.height,pred=pred,pred_name=CLASSES[pred],probabilities=probs,total_decode_transform_inference_ms=elapsed))
  matrix=[[sum(r['label']==lab and r['pred']==i for r in rows) for i in range(5)] for lab in ['sanos','enfermos']]
  unique={r['sha256']:r for r in rows};unique_rows=list(unique.values())
  result=dict(unique_exact_bytes=len(unique_rows), unique_counts={lab:sum(r['label']==lab for r in unique_rows) for lab in ['sanos','enfermos']},deduplicated_monilia_top1=binary(unique_rows,lambda r:r['pred']==3),deduplicated_any_disease_top1=binary(unique_rows,lambda r:r['pred']!=0),model=name,classes=CLASSES,weights_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),device=str(device),gpu=torch.cuda.get_device_name(),inference_only_mean_ms=latency,pipeline_median_ms=statistics.median(r['total_decode_transform_inference_ms'] for r in rows),matrix_rows_healthy_diseased_cols_five_model_classes=matrix,monilia_top1=binary(rows,lambda r:r['pred']==3),any_disease_top1=binary(rows,lambda r:r['pred']!=0),rows=rows)
  out[name]=result;(ROOT/'results.json').write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='rows'},indent=2),flush=True)
  # Every evaluated image appears; sorted by declared label and filename, not result quality.
  sorted_rows=sorted(rows,key=lambda r:(r['label'],r['name']))
  sheet=Image.new('RGB',(5*240,((len(rows)+4)//5)*215),'#f3f2ed');draw=ImageDraw.Draw(sheet)
  for i,r in enumerate(sorted_rows):
   col=i%5;rr=i//5;im=Image.open(ROOT/r['path']).convert('RGB');im.thumbnail((230,165));sheet.paste(im,(col*240+(240-im.width)//2,rr*215));draw.text((col*240+4,rr*215+167),r['label']+' | '+r['name'],fill='black');draw.text((col*240+4,rr*215+185),str(r['pred'])+' '+r['pred_name'][:26]+' '+str(round(max(r['probabilities']),2)),fill='black')
  sheet.save(ROOT/(name+'-all-samples.jpg'))
 print('Finished all models',flush=True)
if __name__=='__main__':main()
