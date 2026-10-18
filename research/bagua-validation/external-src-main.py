"""
Main experiment runner for Cocoa Pod Disease Detection.
Trains and evaluates ResNet50, EfficientNet-B0, and MobileNetV3-Small.

Usage:
    python src/main.py
    python src/main.py --epochs 50 --batch_size 64
"""
import sys
import os
import json
import argparse

# ensure src/ is on the path when called from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from dataset import get_dataloaders, load_samples, split_samples, compute_class_weights
from models import MODELS
from train import train_model, get_device
from evaluate import evaluate_model, plot_training_curves, plot_model_comparison


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data_root", default="cocoa_diseases")
    p.add_argument("--results_dir", default="results")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch_size", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--patience", type=int, default=7)
    p.add_argument("--models", nargs="+", default=list(MODELS.keys()),
                   choices=list(MODELS.keys()),
                   help="Which models to train (default: all)")
    return p.parse_args()


def main():
    args = parse_args()
    os.makedirs(args.results_dir, exist_ok=True)

    device = get_device()
    print(f"Running on device: {device}\n")

    print("Loading data...")
    train_dl, val_dl, test_dl = get_dataloaders(
        args.data_root, batch_size=args.batch_size
    )
    import os as _os
    samples = load_samples(_os.path.join(args.data_root, "images"),
                           _os.path.join(args.data_root, "labels"))
    train_s, _, _ = split_samples(samples)
    class_weights = compute_class_weights(train_s)
    print(f"Class weights: {[round(w,3) for w in class_weights.tolist()]}")

    all_histories = {}
    all_metrics = {}

    for model_name in args.models:
        print(f"\n{'='*60}")
        print(f"Training: {model_name}")
        print(f"{'='*60}")

        model = MODELS[model_name]()
        history, best_val_acc = train_model(
            model, train_dl, val_dl,
            model_name=model_name,
            results_dir=args.results_dir,
            num_epochs=args.epochs,
            lr=args.lr,
            patience=args.patience,
            class_weights=class_weights,
        )
        all_histories[model_name] = history

        # reload best checkpoint for evaluation
        import torch
        model.load_state_dict(torch.load(
            f"{args.results_dir}/{model_name}_best.pth",
            map_location=device, weights_only=True
        ))
        metrics = evaluate_model(model, test_dl, model_name, args.results_dir)
        all_metrics[model_name] = metrics

    print(f"\n{'='*60}")
    print("All experiments complete. Generating summary plots...")
    plot_training_curves(all_histories, args.results_dir)
    plot_model_comparison(all_metrics, args.results_dir)

    summary_path = f"{args.results_dir}/all_metrics.json"
    with open(summary_path, "w") as f:
        json.dump(all_metrics, f, indent=2)
    print(f"Summary saved to {summary_path}")

    print("\n=== FINAL SUMMARY ===")
    print(f"{'Model':<20} {'Accuracy':>10} {'F1':>10} {'Inf. Time(ms)':>15} {'Params(M)':>12}")
    print("-" * 70)
    for name, m in all_metrics.items():
        print(f"{name:<20} {m['accuracy']:>10.4f} {m['f1_macro']:>10.4f} "
              f"{m['inference_time_ms']:>15.3f} {m['parameters_M']:>12.2f}")


if __name__ == "__main__":
    main()
