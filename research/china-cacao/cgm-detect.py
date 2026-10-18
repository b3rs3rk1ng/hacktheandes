import warnings
warnings.filterwarnings('ignore')
from ultralytics import RTDETR,YOLO

if __name__ == '__main__':
    model = YOLO('runs\\train\\yolom\\weights\\best.pt') # select your model.pt path
    model.predict(source='Datasets\\COCOA.v6i.yolov8\\valid\\images',
                  conf=0.1,
                  project='runs/detect',
                  name='YOLO01',
                  save=True,
                #   visualize=True # visualize model features maps
                  )