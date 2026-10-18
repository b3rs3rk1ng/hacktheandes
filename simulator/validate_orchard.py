"""Record actual end-to-end mission telemetry through the public loopback API.

The browser must be producing RGB for inspection/manipulation. No test bypasses
the detector or supplies a fabricated visual candidate. Initial charge is an
explicit scenario condition; simulated time acceleration is recorded.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request,urlopen


def main():
    p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:18437');p.add_argument('--initial-soc',type=float,default=1);p.add_argument('--harvest',action='store_true');p.add_argument('--accelerated',action='store_true');p.add_argument('--timeout',type=float,default=180);p.add_argument('--output',type=Path,required=True);p.add_argument('--stop-phase',default='charging');p.add_argument('--min-visited',type=int,default=0);a=p.parse_args()
    def get():
        with urlopen(a.url+'/api/status',timeout=10) as r:return json.load(r)
    def command(action,**values):
        request=Request(a.url+'/api/command',data=json.dumps({'action':action,**values}).encode(),headers={'Content-Type':'application/json'})
        with urlopen(request,timeout=10) as r:ack=json.load(r)
        until=time.monotonic()+10
        while time.monotonic()<until:
            if get()['physics'].get('last_command_id')==ack['id']:return
            time.sleep(.1)
        raise RuntimeError('Command was not acknowledged: '+action)
    command('reset',soc=a.initial_soc);command('harvest',enabled=a.harvest);command('speed',fast=a.accelerated);command('start')
    started=time.monotonic();samples=[];last_phase=None;complete=False;charge_start=None
    while time.monotonic()-started<a.timeout:
        data=get();s=data['physics'];samples.append(data)
        if s['phase']!=last_phase:
            print(json.dumps({'phase':s['phase'],'sim_time':s['simulation_time'],'soc':s['battery']['soc'],'position':s['position']}),flush=True);last_phase=s['phase']
        if s['phase']==a.stop_phase:
            if charge_start is None:charge_start=s['battery']['soc']
            # Confirm genuine battery gain, rather than merely entering a state.
            if (a.stop_phase!='charging' or s['battery']['soc']>charge_start+.0001) and len(s['visited'])>=a.min_visited and (not a.harvest or any(outcome['deposited'] for outcome in s['outcomes'])):complete=True;break
        time.sleep(.3)
    with urlopen(a.url+'/api/world',timeout=10) as r:world=json.load(r)
    result={'config':world['config'],'scene_sha256':hashlib.sha256(json.dumps(world,sort_keys=True).encode()).hexdigest(),'completed':complete,'elapsed_wall_s':time.monotonic()-started,'initial_soc':a.initial_soc,'harvest_enabled':a.harvest,'accelerated':a.accelerated,'stop_phase':a.stop_phase,'samples':samples,'final':samples[-1] if samples else None}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2,allow_nan=False))
    print(json.dumps({'completed':complete,'output':str(a.output),'samples':len(samples)}),flush=True)
    if not complete:raise SystemExit(1)


if __name__=='__main__':main()
