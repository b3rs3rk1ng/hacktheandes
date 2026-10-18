import time
import json
import torch
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (classification_report, confusion_matrix,
                             accuracy_score, f1_score, precision_score, recall_score)
from dataset import CLASS_NAMES
from train import get_device


@torch.no_grad()
def predict(model, loader, device):
    model.eval()
    all_preds, all_labels = [], []
    for images, labels in loader:
        images = images.to(device)
        preds = model(images).argmax(1).cpu().numpy()
        all_preds.extend(preds)
        all_labels.extend(labels.numpy())
    return np.array(all_labels), np.array(all_preds)


def measure_inference_time(model, device, n_runs=100, batch_size=1):
    model.eval()
    dummy = torch.randn(batch_size, 3, 224, 224).to(device)
    # warm-up
    for _ in range(10):
        _ = model(dummy)
    if device.type == "mps":
        torch.mps.synchronize()
    elif device.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(n_runs):
        _ = model(dummy)
    if device.type == "mps":
        torch.mps.synchronize()
    elif device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = (time.perf_counter() - t0) / n_runs * 1000  # ms per image
    return elapsed


def count_parameters(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def evaluate_model(model, test_loader, model_name, results_dir):
    device = get_device()
    model = model.to(device)
    labels, preds = predict(model, test_loader, device)

    acc = accuracy_score(labels, preds)
    f1 = f1_score(labels, preds, average="macro", zero_division=0)
    precision = precision_score(labels, preds, average="macro", zero_division=0)
    recall = recall_score(labels, preds, average="macro", zero_division=0)
    inf_time = measure_inference_time(model, device)
    params = count_parameters(model)

    metrics = {
        "accuracy": round(acc, 4),
        "f1_macro": round(f1, 4),
        "precision_macro": round(precision, 4),
        "recall_macro": round(recall, 4),
        "inference_time_ms": round(inf_time, 3),
        "parameters_M": round(params / 1e6, 2),
    }

    print(f"\n  === {model_name} Test Results ===")
    for k, v in metrics.items():
        print(f"  {k}: {v}")
    print("\n" + classification_report(labels, preds, target_names=CLASS_NAMES, zero_division=0))

    with open(f"{results_dir}/{model_name}_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    _plot_confusion_matrix(labels, preds, model_name, results_dir)
    return metrics


def _plot_confusion_matrix(labels, preds, model_name, results_dir):
    cm = confusion_matrix(labels, preds)
    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES, ax=ax)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title(f"Confusion Matrix — {model_name}")
    plt.tight_layout()
    plt.savefig(f"{results_dir}/{model_name}_confusion_matrix.png", dpi=150)
    plt.close()


def plot_training_curves(histories, results_dir):
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    for model_name, h in histories.items():
        axes[0].plot(h["train_loss"], label=f"{model_name} train")
        axes[0].plot(h["val_loss"], linestyle="--", label=f"{model_name} val")
        axes[1].plot(h["train_acc"], label=f"{model_name} train")
        axes[1].plot(h["val_acc"], linestyle="--", label=f"{model_name} val")
    axes[0].set_title("Loss")
    axes[0].set_xlabel("Epoch")
    axes[0].legend()
    axes[1].set_title("Accuracy")
    axes[1].set_xlabel("Epoch")
    axes[1].legend()
    plt.tight_layout()
    plt.savefig(f"{results_dir}/training_curves.png", dpi=150)
    plt.close()
    print(f"Training curves saved to {results_dir}/training_curves.png")


def plot_model_comparison(all_metrics, results_dir):
    import pandas as pd
    df = pd.DataFrame(all_metrics).T
    metrics_to_plot = ["accuracy", "f1_macro", "precision_macro", "recall_macro"]
    df_plot = df[metrics_to_plot].astype(float)
    ax = df_plot.plot(kind="bar", figsize=(10, 6), rot=0)
    ax.set_title("Model Comparison")
    ax.set_ylabel("Score")
    ax.set_ylim(0, 1.05)
    ax.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig(f"{results_dir}/model_comparison.png", dpi=150)
    plt.close()
    print(f"Model comparison saved to {results_dir}/model_comparison.png")

    inf_times = {k: v["inference_time_ms"] for k, v in all_metrics.items()}
    params = {k: v["parameters_M"] for k, v in all_metrics.items()}
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].bar(inf_times.keys(), inf_times.values(), color=["#4C72B0", "#DD8452", "#55A868"])
    axes[0].set_title("Inference Time (ms/image)")
    axes[0].set_ylabel("ms")
    axes[1].bar(params.keys(), params.values(), color=["#4C72B0", "#DD8452", "#55A868"])
    axes[1].set_title("Model Size (M parameters)")
    axes[1].set_ylabel("Millions")
    plt.tight_layout()
    plt.savefig(f"{results_dir}/efficiency_comparison.png", dpi=150)
    plt.close()
