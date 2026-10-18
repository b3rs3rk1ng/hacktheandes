"""Launch this scene's isolated services; leave the original lab and other jobs alone."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from mission_resume import parked_checkpoint
ROOT=Path(__file__).resolve().parent;RUNTIME=ROOT/'runtime';RUNTIME.mkdir(exist_ok=True)
try:checkpoint=parked_checkpoint(json.loads((RUNTIME/'mission-status.json').read_text()),json.loads((RUNTIME/'orchard.json').read_text()))
except (FileNotFoundError,ValueError,KeyError):checkpoint=None
subprocess.run([sys.executable,'generate_orchard.py'],cwd=ROOT,check=True)
config=json.loads((ROOT/'orchard_config.json').read_text())
webots=Path.home()/'.local/opt/onda-webots/webots/webots'
env=os.environ.copy();env['LIBGL_ALWAYS_SOFTWARE']='true';env['OMP_NUM_THREADS']='4';env['OPENBLAS_NUM_THREADS']='2';env['YOLO_CONFIG_DIR']=str(RUNTIME/'yolo')
commands={
 'orchard-webots':['xvfb-run','-a','--server-args=-screen 0 1024x768x24',str(webots),'--batch','--mode=realtime','--no-rendering','--stdout','--stderr','--port='+str(config['server']['physics_port']),str(ROOT/'worlds/orchard.wbt')],
 'orchard-server':[sys.executable,'-u','orchard_server.py']}
for name,command in commands.items():
    pid_file=RUNTIME/(name+'.pid')
    if pid_file.exists():
        try:
            pid=int(pid_file.read_text());args=Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode()
            cwd=os.readlink(f'/proc/{pid}/cwd')
            owned=(str(ROOT/'worlds/orchard.wbt') in args or (cwd==str(ROOT) and 'orchard_server.py' in args))
            if owned:os.killpg(pid,signal.SIGTERM);time.sleep(.4)
        except (FileNotFoundError,ProcessLookupError):pass
    if name=='orchard-webots':
        (RUNTIME/'mission-restart.json').write_text(json.dumps(checkpoint))
        for queued in (RUNTIME/'mission-commands').glob('*.json'):queued.unlink()
        for file in ['mission-command.json','mission-vision.json','mission-status.json','mission-last-inference.json']:
            (RUNTIME/file).unlink(missing_ok=True)
    with (RUNTIME/(name+'.log')).open('wb',buffering=0) as log:
        process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
    pid_file.write_text(str(process.pid));print(json.dumps({'service':name,'pid':process.pid}),flush=True)
