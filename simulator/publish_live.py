"""Publish this owned session; foreground mode supports a service supervisor."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT=Path(__file__).resolve().parent


def launch(base=None,foreground=False):
    runtime=ROOT/'runtime';runtime.mkdir(exist_ok=True)
    if not (runtime/'operator-token.txt').is_file():raise SystemExit('Falta la credencial privada del operador')
    if base is None:
        cfg=json.loads((ROOT/'orchard_config.json').read_text())['server'];base=f'http://127.0.0.1:{cfg["port"]}'
    binary=shutil.which('cloudflared')
    if not binary:raise SystemExit('No se encontró cloudflared')
    logpath=runtime/'public-tunnel.log';pidpath=runtime/'public-tunnel.pid';urlpath=runtime/'public-url.txt'
    if pidpath.exists():
        pid=int(pidpath.read_text());args=subprocess.run(['ps','-p',str(pid),'-o','args='],capture_output=True,text=True).stdout
        if 'cloudflared' in args and base in args:
            if urlpath.exists():print(urlpath.read_text().strip(),flush=True);return
            raise SystemExit('Ya existe un túnel de este huerto; revisa su registro')
    urlpath.unlink(missing_ok=True)
    (runtime/'public-tunnel.yml').write_text('no-autoupdate: true\n')
    with logpath.open('wb',buffering=0) as log:
        process=subprocess.Popen([binary,'tunnel','--config',str(runtime/'public-tunnel.yml'),'--no-autoupdate','--url',base],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    pidpath.write_text(str(process.pid))
    if shutil.which('caffeinate'):
        with (runtime/'keepawake.log').open('ab') as log:
            awake=subprocess.Popen(['caffeinate','-i','-s','-w',str(process.pid)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        (runtime/'keepawake.pid').write_text(str(awake.pid))
    for _ in range(150):
        match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',logpath.read_text())
        if match:urlpath.write_text(match.group(0)+'\n');print(match.group(0),flush=True);break
        if process.poll() is not None:raise SystemExit('El túnel no inició; revisa runtime/public-tunnel.log')
        time.sleep(.2)
    else:raise SystemExit('El túnel sigue iniciando; revisa runtime/public-tunnel.log')
    if foreground:raise SystemExit(process.wait())


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--base');parser.add_argument('--foreground',action='store_true');args=parser.parse_args();launch(args.base,args.foreground)
