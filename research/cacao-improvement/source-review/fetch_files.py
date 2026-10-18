#!/usr/bin/env python3
"""Download declared public files via the project's common HTTP-range engine.
Config: {files:[{name,url,size,sha256}]}. No credentials or service required.
"""
import argparse,hashlib,importlib.util,json,os,re,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path,PurePosixPath

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 p.add_argument('--range-engine',type=Path,default=Path(__file__).resolve().parents[2]/'cacao-training/download-review/fetch_parquet.py')
 p.add_argument('--workers',type=int,default=8);p.add_argument('--chunk-mib',type=int,default=32);p.add_argument('--retries',type=int,default=6);p.add_argument('--timeout',type=float,default=120);p.add_argument('--keep-parts',action='store_true');a=p.parse_args()
 if min(a.workers,a.chunk_mib,a.retries)<1:p.error('workers/chunk-mib/retries must be positive')
 spec=importlib.util.spec_from_file_location('shared_range_engine',a.range_engine);engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
 cfg=json.loads(a.config.read_text());out=a.output.expanduser().resolve();out.mkdir(parents=True,exist_ok=True);jobs=[];files=[];results=[];seen_names=set()
 for item in cfg['files']:
  name=PurePosixPath(item['name'])
  if name.is_absolute() or '..' in name.parts:raise ValueError('Unsafe filename')
  if str(name) in seen_names:raise ValueError('Duplicate destination filename')
  seen_names.add(str(name))
  if not re.fullmatch('[0-9a-f]{64}',item['sha256']):raise ValueError('Each file requires a lowercase SHA256')
  destination=out/Path(*name.parts);identity=hashlib.sha256((item['url']+'\0'+item['sha256']).encode()).hexdigest();parts=out/'.download-parts'/identity
  if destination.exists() and destination.stat().st_size==item['size'] and engine.sha256_file(destination)==item['sha256']:
   print('Cached verified',destination,flush=True);results.append({'file':str(destination),'size':destination.stat().st_size,'sha256':item['sha256'],'verified':True,'cached':True});continue
  tasks=[]
  for i,start in enumerate(range(0,item['size'],a.chunk_mib*1024*1024)):
   end=min(item['size']-1,start+a.chunk_mib*1024*1024-1);task=(item['url'],start,end,parts/f'{i:06d}.part');tasks.append(task);jobs.append(task)
  files.append((item,destination,tasks))
 total=sum(end-start+1 for _,start,end,_ in jobs);done=0;started=time.monotonic()
 with ThreadPoolExecutor(max_workers=a.workers) as pool:
  for future in as_completed([pool.submit(engine.fetch_part,t,a) for t in jobs]):
   done+=future.result();print(f'{done/1e6:.1f}/{total/1e6:.1f} MB ({done/max(.001,time.monotonic()-started)/1e6:.2f} MB/s incl. resumed)',flush=True)
 for item,destination,tasks in files:
  destination.parent.mkdir(parents=True,exist_ok=True);temporary=destination.with_name(destination.name+'.assembling');digest=hashlib.sha256()
  with temporary.open('wb') as dst:
   for _,_,_,part in tasks:
    with part.open('rb') as src:
     for block in iter(lambda:src.read(8*1024*1024),b''):dst.write(block);digest.update(block)
  actual=digest.hexdigest()
  if temporary.stat().st_size!=item['size'] or actual!=item['sha256']:
   temporary.unlink(missing_ok=True);raise ValueError('SHA256/size mismatch: '+item['name'])
  os.replace(temporary,destination)
  if not a.keep_parts:
   for _,_,_,part in tasks:part.unlink(missing_ok=True)
  result={'file':str(destination),'size':destination.stat().st_size,'sha256':actual,'verified':True};results.append(result);print(json.dumps(result),flush=True)
 (out/'download-verification.json').write_text(json.dumps({'config':cfg,'verified_files':results},indent=2)+'\n')
if __name__=='__main__':main()
