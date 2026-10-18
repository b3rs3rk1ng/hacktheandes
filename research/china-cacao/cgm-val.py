import warnings
warnings.filterwarnings('ignore')
from ultralytics import YOLO,RTDETR

import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'

if __name__ == '__main__':
    # model = YOLO('runs_outer\\train\exp9\weights\\best.pt')
    model = RTDETR('runs_outer\\train\\exp9\\weights\\best.pt')
    model.val(data=r'D:\RT-DETR\Datasets\COCOA.v6i.yolov8\data.yaml',
              split='val',
              imgsz=640,
              batch=16,
              # rect=False,
              # save_json=True, # 这个保存coco精度指标的开关
              project='runs/val',
              name='exp',
              )