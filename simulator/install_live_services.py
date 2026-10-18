"""Install only this checkout's Linux user services; no root or shared jobs."""
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
if platform.system()!='Linux':raise SystemExit('Este instalador usa systemd de usuario en Linux')
units=Path.home()/'.config/systemd/user';units.mkdir(parents=True,exist_ok=True)
for name,script in [('cacao-live-host','run_live_host.py'),('cacao-public-tunnel','publish_live.py')]:
    text=f'''[Unit]
Description={name} for {ROOT}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={ROOT}
ExecStart={sys.executable} -u {ROOT/script} --foreground
Restart=on-failure
RestartSec=4
KillMode=control-group
TimeoutStopSec=10

[Install]
WantedBy=default.target
'''
    path=units/(name+'.service')
    if path.exists() and str(ROOT) not in path.read_text():raise SystemExit(f'El servicio {name} pertenece a otro checkout')
    path.write_text(text)
subprocess.run(['systemctl','--user','daemon-reload'],check=True)
subprocess.run(['systemctl','--user','enable','--now','cacao-live-host.service','cacao-public-tunnel.service'],check=True)
print('Host y publicación supervisados por systemd de usuario')
