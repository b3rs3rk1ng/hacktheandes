import os
import random
from pathlib import Path
from PIL import Image
import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms

CLASS_NAMES = [
    "Healthy",
    "Carmenta foraseminis",
    "Moniliophthora perniciosa",
    "Moniliophthora roreri",
    "Phytophthora palmivora",
]

TRAIN_TRANSFORMS = transforms.Compose([
    transforms.Resize((256, 256)),
    transforms.RandomCrop(224),
    transforms.RandomHorizontalFlip(),
    transforms.RandomVerticalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

EVAL_TRANSFORMS = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def parse_yolo_label(label_path):
    """Return list of (class_id, x_c, y_c, w, h) from a YOLO label file."""
    annotations = []
    with open(label_path) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 5:
                cls = int(parts[0])
                x_c, y_c, w, h = map(float, parts[1:])
                annotations.append((cls, x_c, y_c, w, h))
    return annotations


def crop_from_yolo(image: Image.Image, x_c, y_c, w, h, padding=0.05):
    """Crop a PIL image using YOLO normalised coordinates with optional padding."""
    iw, ih = image.size
    x1 = max(0, int((x_c - w / 2 - padding) * iw))
    y1 = max(0, int((y_c - h / 2 - padding) * ih))
    x2 = min(iw, int((x_c + w / 2 + padding) * iw))
    y2 = min(ih, int((y_c + h / 2 + padding) * ih))
    if x2 <= x1 or y2 <= y1:
        return image
    return image.crop((x1, y1, x2, y2))


def load_samples(images_dir, labels_dir):
    """Expand each bounding box annotation into its own (image_path, label, bbox) sample."""
    samples = []
    images_dir = Path(images_dir)
    labels_dir = Path(labels_dir)
    for img_file in images_dir.glob("*.jpg"):
        label_file = labels_dir / (img_file.stem + ".txt")
        if not label_file.exists():
            continue
        annotations = parse_yolo_label(label_file)
        for ann in annotations:
            cls, x_c, y_c, w, h = ann
            samples.append((str(img_file), cls, x_c, y_c, w, h))
    return samples


def split_samples(samples, train_ratio=0.70, val_ratio=0.15, seed=42):
    random.seed(seed)
    shuffled = samples[:]
    random.shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)
    return shuffled[:n_train], shuffled[n_train:n_train + n_val], shuffled[n_train + n_val:]


class CocoaDiseaseDataset(Dataset):
    def __init__(self, samples, transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img_path, cls, x_c, y_c, w, h = self.samples[idx]
        image = Image.open(img_path).convert("RGB")
        image = crop_from_yolo(image, x_c, y_c, w, h)
        if self.transform:
            image = self.transform(image)
        return image, cls


def get_dataloaders(data_root, batch_size=32, num_workers=2):
    images_dir = os.path.join(data_root, "images")
    labels_dir = os.path.join(data_root, "labels")
    samples = load_samples(images_dir, labels_dir)
    print(f"Total annotated crops: {len(samples)}")

    train_s, val_s, test_s = split_samples(samples)
    print(f"Split → train: {len(train_s)}  val: {len(val_s)}  test: {len(test_s)}")

    train_ds = CocoaDiseaseDataset(train_s, TRAIN_TRANSFORMS)
    val_ds = CocoaDiseaseDataset(val_s, EVAL_TRANSFORMS)
    test_ds = CocoaDiseaseDataset(test_s, EVAL_TRANSFORMS)

    pin = False  # MPS does not support pin_memory
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers, pin_memory=pin)
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers, pin_memory=pin)
    test_dl = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers, pin_memory=pin)
    return train_dl, val_dl, test_dl


def compute_class_weights(samples, num_classes=5):
    """Inverse-frequency class weights for imbalanced training."""
    import torch
    counts = [0] * num_classes
    for _, cls, *_ in samples:
        counts[cls] += 1
    total = sum(counts)
    weights = [total / (num_classes * c) if c > 0 else 0.0 for c in counts]
    return torch.tensor(weights, dtype=torch.float32)
