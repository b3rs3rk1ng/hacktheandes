"""Owned background renderer: one physics/vision session, public views read poses."""
import argparse
import os
from pathlib import Path
import signal
import platform
import shutil
import time
import subprocess
from urllib.parse import urlencode

ROOT=Path(__file__).resolve().parent


def find_chrome():
    if platform.system()=='Darwin':
        path=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        if path.is_file():return str(path)
    for name in ('google-chrome','google-chrome-stable','chromium','chromium-browser'):
        if shutil.which(name):return shutil.which(name)
    candidates=list((Path.home()/'.cache/ms-playwright').glob('chromium-*/chrome-linux*/chrome'))
    if candidates:return str(max(candidates,key=lambda p:p.stat().st_mtime))
    raise SystemExit('No se encontró Chrome/Chromium; especifica --chrome')


def launch(base, chrome, port, backend='auto', probe=False, foreground=False):
    runtime=ROOT/'runtime';runtime.mkdir(exist_ok=True)
    token=(runtime/'operator-token.txt').read_text().strip()
    profile=runtime/('gpu-probe-browser' if probe else 'live-host-browser');pidfile=runtime/('gpu-probe-browser.pid' if probe else 'live-host-browser.pid')
    if pidfile.exists():
        pid=int(pidfile.read_text())
        result=subprocess.run(['ps','-p',str(pid),'-o','args='],capture_output=True,text=True)
        if str(profile) in result.stdout:
            try:os.killpg(pid,signal.SIGTERM)
            except ProcessLookupError:pass
            time.sleep(.6)
    url=base+'/?authority=1#'+urlencode({'host':token})
    if probe:url='about:blank'
    if backend=='auto':backend='metal' if platform.system()=='Darwin' else 'vulkan'
    args=[chrome or find_chrome(),'--headless=new','--enable-gpu','--use-angle='+backend,'--disable-background-timer-throttling',
          '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--no-first-run',
          '--no-default-browser-check','--window-size=1280,720','--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port='+str(port),'--user-data-dir='+str(profile),url]
    if backend=='vulkan':args[1:1]=['--enable-features=Vulkan','--disable-vulkan-surface','--ozone-platform=headless']
    with (runtime/('gpu-probe-browser.log' if probe else 'live-host-browser.log')).open('ab',buffering=0) as log:
        process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    pidfile.write_text(str(process.pid));print({'host_pid':process.pid,'debug_port':port,'role':'GPU probe' if probe else 'authoritative background simulation','backend':backend},flush=True)
    if foreground:raise SystemExit(process.wait())


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:18437');parser.add_argument('--chrome',default=None);parser.add_argument('--port',type=int,default=18438);parser.add_argument('--backend',default='auto');parser.add_argument('--probe',action='store_true');parser.add_argument('--foreground',action='store_true');args=parser.parse_args()
    launch(args.base,args.chrome,args.port,args.backend,args.probe,args.foreground)
