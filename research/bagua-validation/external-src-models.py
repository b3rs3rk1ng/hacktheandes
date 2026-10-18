import torch.nn as nn
from torchvision import models

NUM_CLASSES = 5


def build_resnet50(num_classes=NUM_CLASSES, pretrained=True):
    weights = models.ResNet50_Weights.IMAGENET1K_V2 if pretrained else None
    model = models.resnet50(weights=weights)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model


def build_efficientnet_b0(num_classes=NUM_CLASSES, pretrained=True):
    weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
    model = models.efficientnet_b0(weights=weights)
    in_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(in_features, num_classes)
    return model


def build_mobilenet_v3(num_classes=NUM_CLASSES, pretrained=True):
    weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
    model = models.mobilenet_v3_small(weights=weights)
    in_features = model.classifier[3].in_features
    model.classifier[3] = nn.Linear(in_features, num_classes)
    return model


MODELS = {
    "ResNet50": build_resnet50,
    "EfficientNet-B0": build_efficientnet_b0,
    "MobileNetV3-Small": build_mobilenet_v3,
}
