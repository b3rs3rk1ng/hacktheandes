"""Read-only wall-clock flight audit against the live physics telemetry."""
import argparse
import json
from pathlib import Path
import time
from urllib.request import urlopen


def monitor(url, duration, output, resume=False):
    started=time.monotonic(); airborne_start=None; first_sim=None; samples=[]
    failure=None;last_success=time.monotonic();previous_native=None
    if resume and output.exists():
        previous=json.loads(output.read_text());samples=previous.get('samples',[])
        if samples:
            last=samples[-1];started-=last['wall_elapsed_s'];airborne_start=time.monotonic()-last['continuous_airborne_wall_s'];first_sim=last['simulation_time']-previous['simulation_elapsed_s'];previous_native=last.get('airborne_wall_seconds')
    while True:
        try:
            with urlopen(url,timeout=5) as response:data=json.load(response)
            state=data['physics']; now=time.monotonic()
            if previous_native is not None and state.get('airborne_wall_seconds',0)<previous_native:failure='Airborne clock reset'
            if samples and state['simulation_time']<samples[-1]['simulation_time']:failure='Physics clock reset'
            previous_native=state.get('airborne_wall_seconds');last_success=now
            row={k:state.get(k) for k in ('updated_at','simulation_time','airborne_wall_seconds','phase','position','battery','thrust_n','accelerated','return_cause')}
            row['wall_elapsed_s']=now-started
            if state.get('accelerated'):failure='Accelerated simulation'
            elif time.time()-state['updated_at']>3:failure='Stale physics telemetry'
            elif state['phase'] in ('idle','charging','failed','landing') or state['thrust_n']<1 or state.get('airborne_wall_seconds',1)<=0:
                if airborne_start is not None:failure='Continuous flight ended'
            elif airborne_start is None:
                airborne_start=now;first_sim=state['simulation_time']
            elapsed=now-airborne_start if airborne_start is not None else 0
            row['continuous_airborne_wall_s']=elapsed;samples.append(row)
            complete=elapsed>=duration and failure is None
            result={'required_wall_seconds':duration,'complete':complete,'failure':failure,'continuous_airborne_wall_s':elapsed,
                    'simulation_elapsed_s':state['simulation_time']-first_sim if first_sim is not None else 0,'samples':samples}
            tmp=output.with_suffix('.tmp');tmp.write_text(json.dumps(result));tmp.replace(output)
            if complete or failure:return result
        except Exception as exc:
            # A brief HTTP service restart does not restart native physics.
            # Its independent airborne/physics clocks must stay monotonic.
            if time.monotonic()-last_success>5:
                output.write_text(json.dumps({'complete':False,'failure':str(exc),'samples':samples}));raise
        time.sleep(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:18437/api/live');parser.add_argument('--seconds',type=float,default=1800);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--resume',action='store_true')
    args=parser.parse_args();result=monitor(args.url,args.seconds,args.output,args.resume)
    print(json.dumps({k:v for k,v in result.items() if k!='samples'}),flush=True)
