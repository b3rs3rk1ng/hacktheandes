"""Start only this workbench's isolated remote processes."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parent
runtime = ROOT/'runtime'
runtime.mkdir(exist_ok=True)
subprocess.run(['python3','generate_world.py'],cwd=ROOT,check=True)
webots = Path.home()/'.local/opt/onda-webots/webots/webots'
env = os.environ.copy()
env['LIBGL_ALWAYS_SOFTWARE'] = 'true'
commands = {
    'webots':['xvfb-run','-a','--server-args=-screen 0 1280x800x24',str(webots),'--batch','--mode=realtime','--no-rendering','--stdout','--stderr','--port=18434','--stream=w3d',str(ROOT/'worlds/cacao.wbt')],
    'ui':['python3','serve.py']
}
for name, command in commands.items():
    pid_file = runtime/(name+'.pid')
    if pid_file.exists():
        pid = int(pid_file.read_text())
        try:
            # A PID file alone is insufficient authority to kill a reused PID.
            cmdline = Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode()
            cwd = os.readlink(f'/proc/{pid}/cwd')
            if str(ROOT) in cmdline or (cwd == str(ROOT) and 'serve.py' in cmdline):
                os.killpg(pid,signal.SIGTERM)
                time.sleep(.4)
        except (ProcessLookupError,FileNotFoundError):
            pass
    if name == 'webots':
        (runtime/'command.json').unlink(missing_ok=True)
        (runtime/'status.json').unlink(missing_ok=True)
    with (runtime/(name+'.log')).open('wb',buffering=0) as log:
        process = subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
    pid_file.write_text(str(process.pid))
    print(json.dumps({'service':name,'pid':process.pid}),flush=True)
