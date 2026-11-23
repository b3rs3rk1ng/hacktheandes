"""Bounded, read-only HTTP viewer load test; never sends operator commands.

This simulates live polling, not WebGL rendering or every initial asset request.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import gzip
import http.client
import json
from pathlib import Path
import random
import time
from urllib.parse import urlparse


def run(base,users,duration,interval):
    url=urlparse(base);started=time.monotonic()
    def viewer(index):
        samples=[];statuses=Counter();errors=Counter();total=0;fresh=[]
        cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
        client=cls(url.hostname,url.port,timeout=5)
        # Stagger arrival, as in a link being opened by an audience.
        time.sleep(random.uniform(0,2))
        end=time.monotonic()+duration
        while time.monotonic()<end:
            at=time.monotonic()
            try:
                client.request('GET','/api/live',headers={'Accept-Encoding':'gzip','User-Agent':'owned-demo-capacity-test/1'})
                response=client.getresponse();body=response.read();total+=len(body);statuses[response.status]+=1
                samples.append((time.monotonic()-at)*1000)
                if response.status==200:
                    value=json.loads(gzip.decompress(body) if response.getheader('Content-Encoding')=='gzip' else body)
                    fresh.append(time.time()-value.get('physics',{}).get('updated_at',time.time()))
            except Exception as error:
                errors[type(error).__name__]+=1;client.close();client=cls(url.hostname,url.port,timeout=5)
            time.sleep(interval+random.uniform(0,.1))
        client.close();return samples,statuses,errors,total,fresh
    with ThreadPoolExecutor(max_workers=users) as pool:results=list(pool.map(viewer,range(users)))
    samples=sorted(s for r in results for s in r[0]);statuses=Counter();errors=Counter()
    for r in results:statuses.update(r[1]);errors.update(r[2])
    def percentile(p):return round(samples[min(len(samples)-1,int(len(samples)*p))],2) if samples else None
    return {'url':base,'simulated_viewers':users,'duration_per_viewer_s':duration,'elapsed_s':round(time.monotonic()-started,2),
            'scope':'live polling only; excludes browser rendering and initial asset burst',
            'statuses':dict(statuses),'errors':dict(errors),'latency_ms':{'p50':percentile(.5),'p95':percentile(.95),'max':max(samples,default=0)},
            'received_bytes':sum(r[3] for r in results),'maximum_physics_age_s':round(max((v for r in results for v in r[4]),default=0),3)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--users',type=int,default=200)
    parser.add_argument('--duration',type=float,default=20);parser.add_argument('--interval',type=float,default=.5);parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=run(args.url,args.users,args.duration,args.interval)
    text=json.dumps(result,indent=2);print(text)
    if args.output:args.output.write_text(text+'\n')
