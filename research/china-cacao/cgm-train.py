import warnings
warnings.filterwarnings('ignore')
from ultralytics import RTDETR , YOLO

import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'

if __name__ == '__main__':
    model = RTDETR('runs_outer\\train\\exp9\\weights\\best.pt')
    # model = YOLO("/mnt/workspace/RT-DETR/ultralytics/cfg/models/ours/yolov5m.yaml")
    # # model.load('') # loading pretrain weights

    model.train(data='Datasets\COCOA.v6i.yolov8\data.yaml',
                cache=False,
                imgsz=640,
                epochs=1,
                batch=2,
                workers=0,
                device='0',
                # resume='', # last.pt path
                project='runs/train',
                name='exp',
                # amp=True/
                patience=30
                )


