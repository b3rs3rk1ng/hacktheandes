"""Train a generic ROI classifier with the exact inference crop contract.

Input ROI manifest: list[{id,image:absolute,bbox:pixel_xyxy,class_id,split}].
All source-group splits must be frozen by the dataset builder beforehand.
Image arrays are cached once as uint8, not re-decoded every epoch.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import time

import cv2
import numpy as np
from PIL import Image
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from evaluate_pipeline import roi_image


def log(stage, **values):
    print(json.dumps({'stage': stage, **values}, allow_nan=False), flush=True)


def seed_worker(worker_id):
    value=torch.initial_seed() % (2**32)
    random.seed(value);np.random.seed(value);torch.set_num_threads(1);cv2.setNumThreads(1)


class MotionBlur:
    def __init__(self, probability, kernels): self.probability=probability; self.kernels=kernels
    def __call__(self, image):
        if random.random() >= self.probability:return image
        k=random.choice(self.kernels); kernel=np.zeros((k,k),dtype=np.float32)
        kernel[k//2,:]=1
        angle=random.uniform(0,180)
        matrix=cv2.getRotationMatrix2D(((k-1)/2,(k-1)/2),angle,1)
        kernel=cv2.warpAffine(kernel,matrix,(k,k));kernel/=kernel.sum()
        return Image.fromarray(cv2.filter2D(np.asarray(image),-1,kernel,borderType=cv2.BORDER_REFLECT_101))


class CachedCrops(Dataset):
    def __init__(self, rows, metadata, training):
        cfg=metadata['training'];self.images=[];self.targets=[];self.ids=[];self.excluded=[]
        for i,row in enumerate(rows):
            with Image.open(row['image']) as im:
                crop=roi_image(im.convert('RGB'),row['bbox'],metadata)
            if crop is None:
                self.excluded.append(row['id']);continue
            self.images.append(np.asarray(crop,dtype=np.uint8).copy())
            self.targets.append(int(row['class_id']));self.ids.append(row['id'])
            if (i+1)%100==0:log('cache_crops',completed=i+1,total=len(rows),training=training)
        augment=[]
        if training:
            augment=[transforms.RandomHorizontalFlip(),
                     transforms.RandomAffine(degrees=7,translate=(.04,.04),scale=(.9,1.05),fill=tuple(metadata['preprocessing']['rgb_fill'])),
                     transforms.ColorJitter(brightness=cfg['brightness'],contrast=cfg['contrast'],saturation=cfg['saturation']),
                     MotionBlur(cfg['motion_probability'],cfg['motion_kernels'])]
        self.transform=transforms.Compose(augment+[transforms.ToTensor(),transforms.Normalize(metadata['preprocessing']['mean'],metadata['preprocessing']['std'])])
    def __len__(self):return len(self.targets)
    def __getitem__(self,index):return self.transform(Image.fromarray(self.images[index])),self.targets[index]


def replace_head(model, dotted_path, classes):
    parts=dotted_path.split('.');parent=model
    for part in parts[:-1]:parent=getattr(parent,part)
    old=getattr(parent,parts[-1])
    if not isinstance(old,nn.Linear):raise ValueError('Configured classifier head must be a Linear module')
    setattr(parent,parts[-1],nn.Linear(old.in_features,classes))


def score_predictions(targets,predictions,classes):
    confusion=np.zeros((classes,classes),dtype=int)
    for target,pred in zip(targets,predictions):confusion[target,pred]+=1
    metrics=[]
    for c in range(classes):
        tp=int(confusion[c,c]);fp=int(confusion[:,c].sum()-tp);fn=int(confusion[c,:].sum()-tp)
        metrics.append({'class_id':c,'tp':tp,'fp':fp,'fn':fn,'f1':2*tp/max(1,2*tp+fp+fn)})
    return {'macro_f1':float(np.mean([x['f1'] for x in metrics])),
            'accuracy':float(np.trace(confusion)/max(1,confusion.sum())),
            'confusion':confusion.tolist(),'per_class':metrics}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--wait-for',type=Path,help='Cache crops on CPU, then wait for this upstream completion marker before using the GPU')
    args=p.parse_args()
    if args.output.exists() and any(args.output.iterdir()):raise ValueError('Training output must be new or empty')
    args.output.mkdir(parents=True,exist_ok=True)
    metadata=json.loads(args.config.read_text());cfg=metadata['training'];seed=cfg['seed']
    torch.manual_seed(seed);np.random.seed(seed);random.seed(seed)
    torch.set_num_threads(4);cv2.setNumThreads(2);device=torch.device(cfg['device'])
    if device.type=='cuda' and not torch.cuda.is_available():raise RuntimeError('Configured CUDA device unavailable')
    rows=json.loads(args.manifest.read_text())
    if isinstance(rows,dict):rows=rows['rows']
    seen={};groups={}
    for row in rows:
        if row['id'] in seen:raise ValueError('Duplicate ROI id')
        seen[row['id']]=row['split']
        if isinstance(row['class_id'],bool) or not isinstance(row['class_id'],int) or not 0 <= row['class_id'] < len(metadata['class_names']):raise ValueError('Invalid crop class')
        key=row.get('group',row['image'])
        if key in groups and groups[key]!=row['split']:raise ValueError('A crop group crosses dataset partitions')
        groups[key]=row['split']
    train=CachedCrops([r for r in rows if r['split']=='train'],metadata,True)
    val=CachedCrops([r for r in rows if r['split']=='val'],metadata,False)
    classes=len(metadata['class_names']);counts=np.bincount(train.targets,minlength=classes)
    if not len(val) or np.any(counts==0):raise ValueError('Every training class and validation images are required')
    generator=torch.Generator().manual_seed(seed)
    common={'batch_size':cfg['batch'],'num_workers':cfg['workers'],'pin_memory':device.type=='cuda',
            'worker_init_fn':seed_worker,'persistent_workers':cfg['workers']>0}
    train_loader=DataLoader(train,shuffle=True,generator=generator,**common)
    val_loader=DataLoader(val,shuffle=False,**common)
    while args.wait_for and not args.wait_for.exists():
        log('waiting_for_upstream',marker=str(args.wait_for),cached_train_crops=len(train),cached_val_crops=len(val))
        time.sleep(30)
    model=models.get_model(metadata['architecture'],weights='DEFAULT')
    replace_head(model,metadata['head_path'],classes);model.to(device)
    weights=np.ones(classes,dtype=float)
    if cfg['class_weighting']=='sqrt_inverse':weights=1/np.sqrt(counts);weights/=weights.mean()
    elif cfg['class_weighting']!='none':raise ValueError('Unknown class weighting policy')
    criterion=nn.CrossEntropyLoss(weight=torch.tensor(weights,dtype=torch.float32,device=device),label_smoothing=cfg['label_smoothing'])
    optimizer=torch.optim.AdamW(model.parameters(),lr=cfg['lr'],weight_decay=cfg['weight_decay'])
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg['epochs'],eta_min=cfg['lr']*.05)
    scaler=torch.amp.GradScaler('cuda',enabled=device.type=='cuda')
    metadata.update({'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
                     'train_counts':counts.tolist(),'train_crops':len(train),'val_crops':len(val),
                     'excluded_too_small':{'train':train.excluded,'val':val.excluded},
                     'selection_metric':'validation macro F1 only','torch_version':str(torch.__version__)})
    (args.output/'metadata.json').write_text(json.dumps(metadata,indent=2))
    best=-1;best_epoch=-1;stale=0;started=time.monotonic()
    with (args.output/'history.jsonl').open('w') as history:
        for epoch in range(cfg['epochs']):
            model.train();loss_sum=0;total=0
            for images,targets in train_loader:
                images=images.to(device,non_blocking=True);targets=targets.to(device,non_blocking=True)
                optimizer.zero_grad(set_to_none=True)
                with torch.amp.autocast(device.type,enabled=device.type=='cuda'):
                    loss=criterion(model(images),targets)
                scaler.scale(loss).backward();scaler.step(optimizer);scaler.update()
                loss_sum+=float(loss.detach())*len(targets);total+=len(targets)
            model.eval();targets_all=[];predicted_all=[]
            with torch.inference_mode():
                for images,targets in val_loader:
                    logits=model(images.to(device,non_blocking=True));predicted_all.extend(logits.argmax(1).cpu().tolist());targets_all.extend(targets.tolist())
            metrics=score_predictions(targets_all,predicted_all,classes)
            record={'epoch':epoch+1,'training_loss':loss_sum/max(1,total),**metrics,'elapsed_seconds':time.monotonic()-started}
            history.write(json.dumps(record)+'\n');history.flush();log('classifier_epoch',**record)
            if metrics['macro_f1']>best:
                best=metrics['macro_f1'];best_epoch=epoch+1;stale=0
                state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
                temp=args.output/'best.pt.tmp';torch.save({'state_dict':state,'metadata':metadata,'epoch':best_epoch},temp);os.replace(temp,args.output/'best.pt')
            else:stale+=1
            scheduler.step()
            if stale>=cfg['patience']:break
    weights_path=args.output/'best.pt'
    summary={'best_epoch':best_epoch,'best_validation_macro_f1':best,'best':str(weights_path.resolve()),
             'weights_sha256':hashlib.sha256(weights_path.read_bytes()).hexdigest(),'elapsed_seconds':time.monotonic()-started}
    (args.output/'complete.json').write_text(json.dumps(summary,indent=2));log('classifier_complete',**summary)


if __name__=='__main__':main()
