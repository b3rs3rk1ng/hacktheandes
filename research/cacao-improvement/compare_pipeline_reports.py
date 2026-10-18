#!/usr/bin/env python3
"""Compare frozen pipeline reports only when image pixels and GT agree."""
import argparse
import json
from pathlib import Path


def compare(paths):
    reports = [(str(Path(p).resolve()), json.loads(Path(p).read_text())) for p in paths]
    first = reports[0][1]
    def identity(report):
        config = report["config"]
        return {
            "task": report["task"], "split": report["split"],
            "target_names": [config["names"][i] for i in config["target_classes"]],
            "healthy_name": config["names"][config["healthy_class"]],
            "eligible_benchmark_sha256": report["eligible_benchmark_sha256"],
            "eligible_pixels_sha256": report["duplicate_audit"]["eligible_pixels_sha256"],
        }
    expected = identity(first)
    for path, report in reports[1:]:
        actual = identity(report)
        if actual != expected:
            differences = [key for key in expected if actual[key] != expected[key]]
            raise ValueError(f"Cannot compare different benchmark/task/labels/pixels: {path}: {differences}")
    common = sorted(set.intersection(*(set(report["variants"]) for _, report in reports)))
    if not common:
        raise ValueError("No identical evaluation variants to compare")
    comparison = {"benchmark": expected, "rows": [],
                  "note": "Paired frozen evaluations on identical eligible pixels and labels. Differences are point estimates, not significance tests. Regression data is development evidence, not a new independent test."}
    for variant in common:
        baseline = first["variants"][variant]["target_metrics"]
        for path, report in reports:
            entry = report["variants"][variant]
            metrics = entry["target_metrics"]
            healthy = metrics["negative_classes"].get(str(report["config"]["healthy_class"]), {})
            comparison["rows"].append({
                "report": path, "variant": variant, "unit": metrics["unit"],
                "selection_status": report["selection"]["status"], "threshold": report["selection"]["threshold"],
                **{key: metrics[key] for key in ["precision", "recall", "f1", "tp", "fp", "fn", "alerts", "images"]},
                "healthy_false_actions_or_alarms": healthy,
                "delta_percentage_points_vs_first": {key: 100 * (metrics[key] - baseline[key]) if metrics[key] is not None and baseline[key] is not None else None for key in ["precision", "recall", "f1"]},
                "p50_ms": entry["latency"]["p50_ms"], "p95_ms": entry["latency"]["p95_ms"],
            })
    return comparison


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if len(args.reports) < 2:
        parser.error("Supply at least two frozen evaluation reports")
    comparison = compare(args.reports)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(comparison, indent=2, allow_nan=False) + "\n")
    print(json.dumps(comparison, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
