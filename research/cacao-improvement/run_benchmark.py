#!/usr/bin/env python3
"""Run validation selection, freeze it, then compare one new model and baseline.

All paths, candidate names, mappings and cohort filters are JSON configuration.
No shell is used. --dry-run emits a structured plan without writes, waiting,
model imports, subprocesses or GPU access. The baseline cannot win selection.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value):
        raise ValueError(f"Unsafe/empty operation name: {value!r}")
    return value


def choose_candidate(candidates, selections, policy):
    """Use validation metrics only; never inspect benchmark result files."""
    def nonvacuous(item):
        m = selections[item["name"]]["validation_metrics"]
        return m["tp"] > 0 and (m["recall"] or 0) >= policy["min_recall"] and m["alerts"] >= policy["min_alerts"]
    feasible = [c for c in candidates if nonvacuous(c) and
                (selections[c["name"]]["validation_metrics"]["precision"] or 0) >= policy["precision_target"]]
    constrained = [c for c in candidates if nonvacuous(c)]
    pool = feasible or constrained or candidates
    if feasible:
        order = ["f1", "precision", "recall"]
        status = "validation_target_met_max_f1"
    elif constrained:
        order = ["precision", "f1", "recall"]
        status = "validation_precision_target_unmet_max_precision_with_min_recall_and_alerts"
    else:
        order = ["f1", "precision", "recall"]
        status = "validation_constraints_unmet_exploratory_max_f1"
    chosen = max(pool, key=lambda c: tuple(selections[c["name"]]["validation_metrics"][key] or 0 for key in order))
    return chosen, {"status": status, "target_met_on_validation": bool(feasible),
                    "selected_candidate": chosen["name"], "ranking": order,
                    "tie_break": "earlier candidate in the declared configuration", "policy": policy}


class Benchmark:
    def __init__(self, config_path, dry_run=False):
        self.config_path = Path(config_path).resolve()
        self.cfg = json.loads(self.config_path.read_text())
        root = Path(self.cfg.get("base_directory", self.config_path.parent)).expanduser()
        self.base = root if root.is_absolute() else self.config_path.parent / root
        self.dry_run = dry_run
        self.output = self.path(self.cfg["output"])
        # A venv interpreter is commonly a symlink to the system executable.
        # Preserve that invocation path: resolving it discards pyvenv.cfg lookup.
        executable = Path(self.cfg.get("python", sys.executable)).expanduser()
        self.python = os.path.abspath(str(executable if executable.is_absolute() else self.base / executable))
        self.pipeline = self.path(self.cfg["pipeline_script"])
        self.comparator = self.path(self.cfg["comparison_script"])
        self.manifest = self.path(self.cfg["development_manifest"])
        self.models = [self.cfg["baseline"]] + self.cfg["candidates"]
        if not self.cfg["candidates"]:
            raise ValueError("At least one new candidate is required")
        names = [safe_name(model["name"]) for model in self.models]
        if len(set(names)) != len(names):
            raise ValueError("Baseline/candidate operation names must be unique")
        benchmarks = [safe_name(spec["name"]) for spec in self.cfg["benchmarks"]]
        if len(set(benchmarks)) != len(benchmarks) or not benchmarks:
            raise ValueError("Benchmark names must be nonempty and unique")
        for spec in self.cfg["benchmarks"]:
            if spec["task"] not in {"detection", "image_binary"} or not spec.get("reference_sources"):
                raise ValueError("Every cohort requires an explicit task and reference_sources")
            if not spec.get("variants") or spec["variants"][0] != "clean":
                raise ValueError("Cohort variants must start with clean")
        self.env = dict(os.environ)
        self.env.update({str(k): str(v) for k, v in self.cfg.get("environment", {}).items()})

    def path(self, path):
        value = Path(path).expanduser()
        return value.resolve() if value.is_absolute() else (self.base / value).resolve()

    def pipeline_config(self, model):
        common = self.cfg["pipeline"]
        overrides = model.get("pipeline_overrides", {})
        for field in ["names", "healthy_class", "target_classes", "selection"]:
            if field in overrides and overrides[field] != common[field]:
                raise ValueError(f"Candidate cannot change shared semantics/selection policy: {field}")
        return {**common, **overrides}

    def model_arguments(self, model):
        arguments = ["--weights", str(self.path(model["weights"])),
                     "--config", str(self.output / "configs" / (model["name"] + ".json")),
                     "--device", str(self.cfg.get("device", "0"))]
        if bool(model.get("classifier_weights")) != bool(model.get("classifier_metadata")):
            raise ValueError("Classifier weights and metadata must be declared together")
        if model.get("classifier_weights"):
            arguments += ["--classifier-weights", str(self.path(model["classifier_weights"])),
                          "--classifier-metadata", str(self.path(model["classifier_metadata"]))]
        return arguments

    def fit_arguments(self, model):
        return [self.python, str(self.pipeline), *self.model_arguments(model),
                "--manifest", str(self.manifest), "--task", "detection", "--fit-only",
                "--output", str(self.output / "validation" / model["name"])]

    def actual_inference_fingerprint(self, model):
        return {
            "weights_sha256": file_sha(self.path(model["weights"])),
            "config_sha256": file_sha(self.output / "configs" / (model["name"] + ".json")),
            "classifier_weights_sha256": file_sha(self.path(model["classifier_weights"])) if model.get("classifier_weights") else None,
            "classifier_metadata_sha256": file_sha(self.path(model["classifier_metadata"])) if model.get("classifier_metadata") else None,
        }

    def assert_frozen_components(self, freeze_path, expected_sha):
        """Recheck every calibrated component before opening/inferring a cohort."""
        if file_sha(freeze_path) != expected_sha:
            raise ValueError("Frozen decision changed after calibration")
        frozen = json.loads(freeze_path.read_text())
        if file_sha(self.manifest) != frozen["development_manifest_sha256"]:
            raise ValueError("Calibration manifest changed after selection")
        if file_sha(self.config_path) != frozen["run_config_sha256"]:
            raise ValueError("Benchmark configuration changed after selection")
        for model in self.models:
            name = model["name"]
            record = frozen["models"][name]
            selection_file = self.output / "validation" / name / "selection.json"
            if file_sha(selection_file) != record["selection_sha256"]:
                raise ValueError(f"Frozen selection file changed: {name}")
            selection = json.loads(selection_file.read_text())
            if selection["inference_fingerprint"] != record["inference_fingerprint"]:
                raise ValueError(f"Frozen selection fingerprint changed: {name}")
            if selection["validation_manifest_sha256"] != frozen["development_manifest_sha256"]:
                raise ValueError(f"Selection used a different calibration manifest: {name}")
            actual = self.actual_inference_fingerprint(model)
            if actual != record["inference_fingerprint"]:
                changed = [key for key in actual if actual[key] != record["inference_fingerprint"].get(key)]
                raise ValueError(f"Calibrated model component changed: {name}: {changed}")

    def evaluation_arguments(self, model, spec, references):
        arguments = [self.python, str(self.pipeline), *self.model_arguments(model),
                     "--manifest", str(self.path(spec["manifest"])), "--task", spec["task"],
                     "--split", spec["split"], "--selection-report",
                     str(self.output / "validation" / model["name"] / "selection.json"),
                     "--variants", ",".join(spec["variants"]), "--output",
                     str(self.output / "benchmarks" / spec["name"] / model["name"])]
        for reference in references:
            arguments += ["--reference-manifest", str(reference)]
        return arguments

    def reference_paths(self, spec):
        return [self.output / "references" / f"{spec['name']}-{i}.json" for i in range(len(spec["reference_sources"]))]

    def plan(self):
        for model in self.models:
            self.pipeline_config(model)
        selected = {**self.cfg["candidates"][0], "name": "SELECTED_BY_VALIDATION", "weights": "SELECTED_WEIGHTS"}
        selected.pop("classifier_weights", None)
        selected.pop("classifier_metadata", None)
        return {"dry_run": True, "output": str(self.output),
                "wait_for_files": self.cfg.get("wait_for_files", []),
                "validation_commands": [{"model": m["name"], "argv": self.fit_arguments(m),
                                         "pipeline_config": self.pipeline_config(m)} for m in self.models],
                "selection": "Only new candidates; feasible max F1, otherwise max precision with min recall/alerts, otherwise exploratory max F1",
                "freeze_before_evaluation": str(self.output / "frozen_selection.json"),
                "benchmarks": [{"name": spec["name"], "reference_filters": spec["reference_sources"],
                                "baseline_argv": self.evaluation_arguments(self.cfg["baseline"], spec, self.reference_paths(spec)),
                                "selected_template_argv": self.evaluation_arguments(selected, spec, self.reference_paths(spec))}
                               for spec in self.cfg["benchmarks"]],
                "note": "SELECTED_* are placeholders, not commands to execute. Actual classifier flags/config come from the selected candidate. No benchmark predictions are used for selection."}

    def emit(self, event, stage, **fields):
        item = {"event": event, "stage": stage, "time_utc_epoch": time.time(), **fields}
        encoded = json.dumps(item, allow_nan=False)
        print(encoded, flush=True)
        with (self.output / "progress.jsonl").open("a") as handle:
            handle.write(encoded + "\n")

    def execute(self, argv, stage, operation):
        log = self.output / "logs" / f"{stage}-{operation}.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        self.emit("operation_started", stage, operation=operation, argv=argv, log=str(log))
        with log.open("w") as handle:
            process = subprocess.Popen(argv, cwd=str(self.base), env=self.env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in process.stdout:
                handle.write(line)
                handle.flush()
                try:
                    child = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(child, dict) and "completed" in child and "total" in child:
                    self.emit("progress", stage, operation=operation, completed=child["completed"],
                              total=child["total"], unit="images", child_stage=child.get("stage"), variant=child.get("variant"))
            code = process.wait()
        if code:
            raise RuntimeError(f"Operation {operation} failed with exit {code}; inspect {log}")
        self.emit("operation_completed", stage, operation=operation, exit_code=code)

    def wait_for_inputs(self):
        for spec in self.cfg.get("wait_for_files", []):
            marker = self.path(spec["path"])
            timeout = float(spec.get("timeout_seconds", 10800))
            interval = min(30.0, max(0.01, float(spec.get("poll_seconds", 10))))
            start = time.monotonic()
            while not marker.is_file():
                if time.monotonic() - start >= timeout:
                    raise TimeoutError(f"Completion marker did not arrive: {marker}")
                self.emit("waiting", "training_dependencies", marker=str(marker), elapsed_seconds=time.monotonic() - start)
                time.sleep(interval)
            self.emit("dependency_ready", "training_dependencies", marker=str(marker), sha256=file_sha(marker))

    def references(self, spec):
        benchmark = json.loads(self.path(spec["manifest"]).read_text())
        benchmark = [row for row in benchmark if row["split"] == spec["split"]]
        benchmark_ids = {str(row["id"]) for row in benchmark}
        benchmark_paths = {str(Path(row["image"]).resolve()) for row in benchmark}
        paths = self.reference_paths(spec)
        summaries = []
        for definition, destination in zip(spec["reference_sources"], paths):
            source = self.path(definition["manifest"])
            rows = json.loads(source.read_text())
            filtered = [row for row in rows if row["split"] in definition["splits"] and
                        not any(row.get(field) for field in definition.get("exclude_if_truthy", []))]
            if not filtered:
                raise ValueError(f"Empty reference cohort: {source}")
            overlap = [str(row["id"]) for row in filtered if str(row["id"]) in benchmark_ids or
                       str(Path(row["image"]).resolve()) in benchmark_paths]
            if overlap:
                raise ValueError(f"Reference filter includes benchmark itself: {spec['name']}: {overlap[:3]}")
            write_json(destination, filtered)
            summaries.append({"source": str(source), "source_sha256": file_sha(source), "filter": definition,
                              "rows": len(filtered), "output": str(destination), "sha256": file_sha(destination)})
        write_json(self.output / "references" / (spec["name"] + "-audit.json"), summaries)
        self.emit("references_prepared", "benchmark_references", operation=spec["name"],
                  completed=sum(s["rows"] for s in summaries), unit="reference_images")
        return paths

    def run(self):
        if self.dry_run:
            return self.plan()
        self.output.mkdir(parents=True, exist_ok=False)
        write_json(self.output / "run_config.json", self.cfg)
        self.emit("started", "benchmark", config_sha256=file_sha(self.config_path))
        try:
            self.wait_for_inputs()
            selections, fingerprints = {}, {}
            for model in self.models:
                name = model["name"]
                write_json(self.output / "configs" / (name + ".json"), self.pipeline_config(model))
                self.execute(self.fit_arguments(model), "development_validation", name)
                selection_file = self.output / "validation" / name / "selection.json"
                selection = json.loads(selection_file.read_text())
                if selection["split"] != "val" or selection["task"] != "detection" or selection["policy"] != self.cfg["pipeline"]["selection"]:
                    raise ValueError("Selection must use declared validation task/policy")
                selections[name] = selection
                fingerprints[name] = {"selection_sha256": file_sha(selection_file),
                                      "inference_fingerprint": selection["inference_fingerprint"],
                                      "validation_ids_sha256": selection["validation_ids_sha256"]}
            if len({s["validation_ids_sha256"] for s in selections.values()}) != 1:
                raise ValueError("Models were calibrated on different validation cohorts")
            chosen, decision = choose_candidate(self.cfg["candidates"], selections, self.cfg["pipeline"]["selection"])
            freeze = {"schema_version": 1, "frozen_at_epoch": time.time(), "run_config_sha256": file_sha(self.config_path),
                      "development_manifest_sha256": file_sha(self.manifest), "decision": decision,
                      "baseline": self.cfg["baseline"]["name"], "models": fingerprints,
                      "selection_data": "validation only; benchmark inference has not started",
                      "validation_metrics": {name: selection["validation_metrics"] for name, selection in selections.items()}}
            freeze_path = self.output / "frozen_selection.json"
            write_json(freeze_path, freeze)
            frozen_sha = file_sha(freeze_path)
            self.assert_frozen_components(freeze_path, frozen_sha)
            self.emit("selection_frozen", "selection", selected=chosen["name"], status=decision["status"], sha256=frozen_sha)
            results = []
            for spec in self.cfg["benchmarks"]:
                self.assert_frozen_components(freeze_path, frozen_sha)
                references = self.references(spec)
                reports = []
                for model in [self.cfg["baseline"], chosen]:
                    self.assert_frozen_components(freeze_path, frozen_sha)
                    self.execute(self.evaluation_arguments(model, spec, references), "benchmark_evaluation", spec["name"] + "-" + model["name"])
                    reports.append(self.output / "benchmarks" / spec["name"] / model["name"] / "evaluation.json")
                comparison = self.output / "comparisons" / (spec["name"] + ".json")
                self.execute([self.python, str(self.comparator), *map(str, reports), "--output", str(comparison)],
                             "paired_comparison", spec["name"])
                results.append({"benchmark": spec["name"], "reports": list(map(str, reports)), "comparison": str(comparison)})
            summary = {"status": "complete", "frozen_selection_sha256": frozen_sha, "decision": decision, "results": results,
                       "note": "Regression is development evidence. New held-out image labels provide image metrics only. No benchmark results were used to choose the new model or thresholds."}
            write_json(self.output / "complete.json", summary)
            self.emit("completed", "benchmark", selected=chosen["name"], results=len(results))
            return summary
        except Exception as error:
            self.emit("failed", "benchmark", error_type=type(error).__name__, message=str(error))
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = Benchmark(args.config, args.dry_run).run()
    print(json.dumps(result, indent=2, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
