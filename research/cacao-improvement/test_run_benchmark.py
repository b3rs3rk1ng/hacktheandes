"""Stub orchestration test: no ML imports, real inference, GPU or remote access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import venv

SPEC = importlib.util.spec_from_file_location("run_benchmark", Path(__file__).with_name("run_benchmark.py"))
ORCHESTRATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ORCHESTRATOR)


class StubBenchmark(ORCHESTRATOR.Benchmark):
    def execute(self, argv, stage, operation):
        self.calls.append((stage, operation, argv))
        output = Path(argv[argv.index("--output") + 1])
        if stage == "development_validation":
            # The baseline is deliberately best; it must never win the new
            # candidate decision. A perfect but low-recall candidate also loses.
            metrics = {
                "prior": {"tp": 40, "fp": 0, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "alerts": 40},
                "candidate_a": {"tp": 24, "fp": 1, "fn": 16, "precision": 0.96, "recall": 0.6, "f1": 48 / 65, "alerts": 25},
                "candidate_b": {"tp": 19, "fp": 0, "fn": 31, "precision": 1.0, "recall": 0.38, "f1": 38 / 69, "alerts": 19},
            }[operation]
            ORCHESTRATOR.write_json(output / "selection.json", {
                "split": "val", "task": "detection", "policy": self.cfg["pipeline"]["selection"],
                "threshold": 0.5, "validation_metrics": metrics,
                "inference_fingerprint": self.actual_inference_fingerprint(next(m for m in self.models if m["name"] == operation)),
                "validation_ids_sha256": "identical-validation-cohort",
                "validation_manifest_sha256": ORCHESTRATOR.file_sha(self.manifest),
            })
        else:
            freeze = json.loads((self.output / "frozen_selection.json").read_text())
            assert freeze["decision"]["selected_candidate"] == "candidate_a"
            if stage == "benchmark_evaluation":
                assert "candidate_b" not in operation
                references = [Path(argv[i + 1]) for i, value in enumerate(argv) if value == "--reference-manifest"]
                for reference in references:
                    assert all(not row.get("augmentation") for row in json.loads(reference.read_text()))
                ORCHESTRATOR.write_json(output / "evaluation.json", {"stub": True})
            else:
                ORCHESTRATOR.write_json(output, {"stub": True})


class TamperingBenchmark(StubBenchmark):
    def execute(self, argv, stage, operation):
        super().execute(argv, stage, operation)
        if stage == "benchmark_evaluation" and operation == "regression-prior":
            # Mutate a DISCARDED candidate: all calibration inputs still need
            # to remain frozen, not just the model whose inference comes next.
            if self.tamper_component == "selection":
                path = self.output / "validation" / "candidate_b" / "selection.json"
                data = json.loads(path.read_text())
                data["threshold"] = 0.99
                ORCHESTRATOR.write_json(path, data)
            else:
                self.path("b.pt").write_bytes(b"changed checkpoint")


class BenchmarkTests(unittest.TestCase):
    def fixture(self, folder):
        root = Path(folder)
        for name in ["prior.pt", "a.pt", "b.pt"]:
            (root / name).write_bytes(("stub-checkpoint-" + name).encode())
        development = [
            {"id": "train", "image": str(root / "train.jpg"), "split": "train"},
            {"id": "train-augmented", "image": str(root / "augmented.jpg"), "split": "train", "augmentation": {"blur": 3}},
            {"id": "val", "image": str(root / "val.jpg"), "split": "val"},
            {"id": "regression", "image": str(root / "regression.jpg"), "split": "regression"},
        ]
        ORCHESTRATOR.write_json(root / "development.json", development)
        ORCHESTRATOR.write_json(root / "new.json", [{"id": "new", "image": str(root / "new.jpg"), "split": "test", "label_class_id": 0, "label_source": "author annotation"}])
        config = {
            "base_directory": str(root), "python": "/usr/bin/python3", "pipeline_script": "stub.py", "comparison_script": "compare-stub.py",
            "development_manifest": "development.json", "output": "benchmark", "pipeline": {
                "names": ["healthy", "target", "other"], "healthy_class": 0, "target_classes": [1],
                "selection": {"precision_target": 0.95, "min_recall": 0.5, "min_alerts": 20}},
            "baseline": {"name": "prior", "weights": "prior.pt"},
            "candidates": [{"name": "candidate_a", "weights": "a.pt"}, {"name": "candidate_b", "weights": "b.pt"}],
            "benchmarks": [
                {"name": "regression", "manifest": "development.json", "task": "detection", "split": "regression", "variants": ["clean"],
                 "reference_sources": [{"manifest": "development.json", "splits": ["train", "val"], "exclude_if_truthy": ["augmentation"]}]},
                {"name": "new_test", "manifest": "new.json", "task": "image_binary", "split": "test", "variants": ["clean"],
                 "reference_sources": [{"manifest": "development.json", "splits": ["train", "val", "regression"], "exclude_if_truthy": ["augmentation"]}]},
            ],
        }
        ORCHESTRATOR.write_json(root / "config.json", config)
        return root / "config.json"

    def test_only_validation_selects_then_freeze_precedes_benchmark_and_loser_is_not_evaluated(self):
        with tempfile.TemporaryDirectory() as folder:
            config = self.fixture(folder)
            run = StubBenchmark(config)
            run.calls = []
            with contextlib.redirect_stdout(io.StringIO()):
                result = run.run()
            self.assertEqual(result["decision"]["selected_candidate"], "candidate_a")
            self.assertEqual([name for stage, name, _ in run.calls if stage == "development_validation"], ["prior", "candidate_a", "candidate_b"])
            evaluations = [name for stage, name, _ in run.calls if stage == "benchmark_evaluation"]
            self.assertEqual(evaluations, ["regression-prior", "regression-candidate_a", "new_test-prior", "new_test-candidate_a"])
            self.assertEqual(len([1 for stage, _, _ in run.calls if stage == "paired_comparison"]), 2)

    def test_dry_run_never_creates_output_or_runs_child(self):
        with tempfile.TemporaryDirectory() as folder:
            run = StubBenchmark(self.fixture(folder), dry_run=True)
            run.calls = []
            plan = run.run()
            self.assertTrue(plan["dry_run"])
            self.assertEqual(run.calls, [])
            self.assertFalse(run.output.exists())

    def test_reference_filter_cannot_include_benchmark_itself(self):
        with tempfile.TemporaryDirectory() as folder:
            run = StubBenchmark(self.fixture(folder))
            run.output.mkdir()
            spec = run.cfg["benchmarks"][0]
            spec["reference_sources"][0]["splits"].append("regression")
            with self.assertRaisesRegex(ValueError, "includes benchmark itself"):
                run.references(spec)

    def test_venv_interpreter_symlink_is_preserved_in_actual_child_invocation(self):
        with tempfile.TemporaryDirectory() as folder:
            config_path = self.fixture(folder)
            executable = Path(folder) / ".venv" / "bin" / "python"
            venv.EnvBuilder(with_pip=False, symlinks=True).create(executable.parent.parent)
            self.assertTrue(executable.is_symlink())
            config = json.loads(config_path.read_text())
            config["python"] = ".venv/bin/python"
            ORCHESTRATOR.write_json(config_path, config)
            run = StubBenchmark(config_path)
            self.assertEqual(run.python, str(executable))
            self.assertNotEqual(run.python, str(executable.resolve()))
            reported = json.loads(subprocess.check_output(
                [run.python, "-c", "import json,sys; print(json.dumps({'executable':sys.executable,'prefix':sys.prefix}))"], text=True))
            # macOS may canonicalize /var to /private/var in sys.executable;
            # the important invariant is the venv directory, not its alias.
            self.assertEqual(Path(reported["executable"]).parent.resolve(), executable.parent.resolve())
            self.assertEqual(Path(reported["prefix"]).resolve(), executable.parent.parent.resolve())

    def test_modified_selection_or_weights_are_rejected_before_next_model_inference(self):
        for component in ["selection", "weights"]:
            with self.subTest(component=component), tempfile.TemporaryDirectory() as folder:
                run = TamperingBenchmark(self.fixture(folder))
                run.calls = []
                run.tamper_component = component
                pattern = "Frozen selection file changed" if component == "selection" else "Calibrated model component changed"
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, pattern):
                    run.run()
                evaluations = [name for stage, name, _ in run.calls if stage == "benchmark_evaluation"]
                self.assertEqual(evaluations, ["regression-prior"])


if __name__ == "__main__":
    unittest.main()
