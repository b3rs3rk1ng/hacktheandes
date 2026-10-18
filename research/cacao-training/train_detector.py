"""Train a compact configurable Ultralytics baseline on a frozen dataset."""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

import torch
import ultralytics
from ultralytics import YOLO


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    cfg = json.loads(args.config.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    environment = {'python':platform.python_version(),'torch':torch.__version__,
                   'ultralytics':ultralytics.__version__,
                   'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                   'cuda':torch.version.cuda,'config':cfg,
                   'manifest_sha256':hashlib.sha256((args.data.parent/'manifest.json').read_bytes()).hexdigest()}
    (args.output/'environment.json').write_text(json.dumps(environment,indent=2))
    freeze=subprocess.run([sys.executable,'-m','pip','freeze'],capture_output=True,text=True)
    (args.output/'pip-freeze.txt').write_text(freeze.stdout)
    params=cfg['training'].copy(); model_name=params.pop('model')
    model=YOLO(model_name)
    result=model.train(data=str(args.data.resolve()),project=str(args.output.resolve()),name='baseline',
                      seed=cfg['seed'],deterministic=True,exist_ok=False,cache=False,
                      amp=True,plots=True,save=True,verbose=False,**params)
    best=Path(model.trainer.best)
    (args.output/'training_complete.json').write_text(json.dumps({
        'best':str(best),'best_sha256':hashlib.sha256(best.read_bytes()).hexdigest(),
        'save_dir':str(model.trainer.save_dir),'epochs_requested':params['epochs'],
        'metrics':result.results_dict if result else None},indent=2))


if __name__=='__main__': main()
