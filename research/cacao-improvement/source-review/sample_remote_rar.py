#!/usr/bin/env python3
"""Sample public non-solid RAR5 images using its Quick Open directory and HTTP ranges.

General contract: single-volume, unencrypted, non-solid RAR5 entries
with complete Quick Open headers. Header CRCs, original selected headers and file
CRC32 are checked. Full-archive SHA256 is explicitly NOT verified by this method.
Labels and capture-group rules are declarative configuration, never folder guesses.
"""
import argparse,collections,hashlib,importlib.util,io,json,os,random,re,struct,sys,time,zlib
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path,PurePosixPath
from urllib.request import Request,urlopen

IMAGE_SUFFIXES={'.jpg','.jpeg','.png','.webp','.bmp','.tiff','.tif'}
SIGNATURE=b'Rar!\x1a\x07\x01\x00'
def vint(b,p):
 value=0
 for shift in range(0,70,7):
  if p>=len(b):raise ValueError('Truncated vint')
  byte=b[p];p+=1;value|=(byte&127)<<shift
  if not byte&128:return value,p
 raise ValueError('Overlong vint')
def extras(b):
 records=[];p=0
 while p<len(b):
  size,q=vint(b,p);end=q+size
  if end>len(b) or end<=q:raise ValueError('Bad RAR extra record size')
  kind,q=vint(b,q);records.append((kind,b[q:end]));p=end
 return records

def header(b,start=0):
 if start+5>len(b):raise ValueError('Truncated RAR header')
 crc=struct.unpack_from('<I',b,start)[0];size,p=vint(b,start+4);end=p+size
 if size>2*1024*1024 or end>len(b):raise ValueError('Incomplete or oversized RAR header')
 if zlib.crc32(b[start+4:end])!=crc:raise ValueError('RAR header CRC32 mismatch')
 kind,p=vint(b,p);flags,p=vint(b,p);extra=0;data=0
 if flags&1:extra,p=vint(b,p)
 if flags&2:data,p=vint(b,p)
 h={'type':kind,'flags':flags,'header_size':end-start,'data_size':data,'crc32':f'{crc:08x}','extra':extras(b[end-extra:end]) if extra else []}
 if flags&(8|16|32):raise ValueError('Split/dependent RAR blocks are unsupported')
 if kind==1:
  archive_flags,p=vint(b,p);h['archive_flags']=archive_flags
  if archive_flags&(1|2|4):raise ValueError('Multivolume/solid RAR is unsupported')
 elif kind in (2,3):
  ff,p=vint(b,p);unpacked,p=vint(b,p);attrs,p=vint(b,p)
  if ff&2:p+=4
  data_crc=None
  if ff&4:data_crc=struct.unpack_from('<I',b,p)[0];p+=4
  compression,p=vint(b,p);host,p=vint(b,p);nl,p=vint(b,p)
  if p+nl>end-extra:raise ValueError('RAR filename outside header')
  name=b[p:p+nl].decode('utf-8');parts=PurePosixPath(name)
  if parts.is_absolute() or '..' in parts.parts:raise ValueError('Unsafe archive member name')
  if any(t in (1,5) for t,_ in h['extra']):raise ValueError('Encrypted/redirected RAR files unsupported')
  h.update(name=name,file_flags=ff,unpacked_size=unpacked,directory=bool(ff&1),method=(compression>>7)&7,solid=bool(compression&64),data_crc32=f'{data_crc:08x}' if data_crc is not None else None,unknown_size=bool(ff&8))
 elif kind==4:raise ValueError('Encrypted archive unsupported')
 return h

def read_range(url,start,end,retries=5):
 for attempt in range(retries):
  try:
   with urlopen(Request(url,headers={'Range':f'bytes={start}-{end}','User-Agent':'public-rar5-range-sampler/1.0'}),timeout=90) as r:
    if r.status!=206 or not r.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/'):raise ValueError('Invalid HTTP range response')
    data=r.read(end-start+1)
   if len(data)!=end-start+1:raise ValueError('Truncated HTTP range')
   return data
  except Exception:
   if attempt+1==retries:raise
   time.sleep(min(20,2**attempt))

def atomic_json(path,value):
 temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n');os.replace(temp,path)

def archive_index(declared,out):
 name=declared['name'];cache=out/'indexes';cache.mkdir(parents=True,exist_ok=True);key=hashlib.sha256((name+'\0'+declared['url']+'\0'+str(declared['size'])).encode()).hexdigest()[:20]
 first_path=cache/(key+'.initial.bin')
 if not first_path.exists():first_path.write_bytes(read_range(declared['url'],0,min(16383,declared['size']-1)))
 initial=first_path.read_bytes()
 if initial[:8]!=SIGNATURE:raise ValueError('Only RAR5 archives without SFX are supported')
 main=header(initial,8)
 if main['type']!=1:raise ValueError('RAR main header not found')
 qo=None
 for kind,data in main['extra']:
  if kind==1:
   flags,p=vint(data,0)
   if flags&1:relative,p=vint(data,p);qo=8+relative if relative else None
 if qo is None:raise ValueError('RAR Quick Open locator is absent; no silent expensive fallback')
 tail_path=cache/(key+'.quickopen.bin')
 if not tail_path.exists():tail_path.write_bytes(read_range(declared['url'],qo,declared['size']-1))
 tail=tail_path.read_bytes();qh=header(tail)
 if qh['type']!=3 or qh.get('name')!='QO' or qh['method']!=0:raise ValueError('Invalid Quick Open service record')
 cursor=qh['header_size'];end=cursor+qh['data_size'];entries=[];last_offset=-1
 if end>len(tail):raise ValueError('Truncated Quick Open data')
 while cursor<end:
  crc=struct.unpack_from('<I',tail,cursor)[0];size,p=vint(tail,cursor+4);record_end=p+size
  if record_end>end or zlib.crc32(tail[cursor+4:record_end])!=crc:raise ValueError('Quick Open structure CRC32 mismatch')
  flags,p=vint(tail,p);back,p=vint(tail,p);length,p=vint(tail,p);cached=tail[p:p+length];offset=qo-back
  if flags!=0 or p+length!=record_end or offset<=last_offset:raise ValueError('Unsupported/inconsistent Quick Open record')
  parsed=header(cached);last_offset=offset
  if parsed['type']==2:
   if parsed['header_size']!=len(cached):raise ValueError('Cached file header is incomplete')
   parsed.update(header_offset=offset,data_offset=offset+parsed['header_size'],cached_header_hex=cached.hex(),cached_header_sha256=hashlib.sha256(cached).hexdigest(),quickopen_record_crc32=f'{crc:08x}')
   parsed['extra']=[{'type':t,'hex':b.hex()} for t,b in parsed['extra']]
   if parsed['data_offset']+parsed['data_size']>declared['size']:raise ValueError('File data outside archive')
   entries.append(parsed)
  cursor=record_end
 images=[e for e in entries if not e['directory'] and PurePosixPath(e['name']).suffix.lower() in IMAGE_SUFFIXES]
 for e in images:
  if e['solid'] or e['unknown_size'] or e['data_crc32'] is None:raise ValueError('Selected image cannot be independently extracted as CRC-checked non-solid data')
 if declared.get('expected_images') is not None and len(images)!=declared['expected_images']:raise ValueError('Quick Open image count differs from author declaration')
 result={'archive':name,'url':declared['url'],'archive_size':declared['size'],'archive_sha256_declared':declared['sha256'],'archive_sha256_verified':False,'quickopen_offset':qo,'quickopen_bytes':len(tail),'quickopen_sha256':hashlib.sha256(tail).hexdigest(),'file_count':len(entries),'image_count':len(images),'entries':entries}
 atomic_json(cache/(name+'.index.json'),result);return result

def image_job(selected,args,engine,extractor):
 from PIL import Image,ImageOps
 item=selected['entry'];declared=selected['archive'];identifier=selected['id'];record_path=args.output/'records'/(identifier+'.json');image_path=args.output/'images'/'test'/(identifier+'.jpg')
 if record_path.exists() and image_path.exists():return json.loads(record_path.read_text())
 cached=bytes.fromhex(item['cached_header_hex']);start=item['header_offset'];end=item['data_offset']+item['data_size']-1;target=args.output/'range-cache'/(identifier+'.part')
 engine.fetch_part((declared['url'],start,end,target),args)
 payload=target.read_bytes()
 if payload[:len(cached)]!=cached:raise ValueError('Original selected header differs from Quick Open cache')
 original=payload[len(cached):]
 if item['method']!=0:
  import libarchive
  def block(body):
   size=bytearray();n=len(body)
   while n>=128:size.append((n&127)|128);n>>=7
   size.append(n);data=bytes(size)+body
   return struct.pack('<I',zlib.crc32(data))+data
  virtual=SIGNATURE+block(b'\x01\x00\x00')+payload+block(b'\x05\x04\x00')
  with libarchive.memory_reader(virtual) as archive:
   entry=next(iter(archive))
   if str(entry.pathname)!=item['name'] or entry.size!=item['unpacked_size']:raise ValueError('Isolated RAR extraction metadata differs')
   original=b''.join(entry.get_blocks())
 if len(original)!=item['unpacked_size'] or f'{zlib.crc32(original):08x}'!=item['data_crc32']:raise ValueError('Selected JPEG CRC32/length mismatch')
 source_sha=hashlib.sha256(original).hexdigest()
 with Image.open(io.BytesIO(original)) as raw:
  orientation=int(raw.getexif().get(274,1));raw_size=raw.size;image=ImageOps.exif_transpose(raw).convert('RGB');display_size=image.size
  pixelsha=hashlib.sha256(image.tobytes()+str(image.size).encode()).hexdigest();perceptual=extractor.phash(image)
  if args.max_side:image.thumbnail((args.max_side,args.max_side),Image.Resampling.LANCZOS)
  image.save(image_path,quality=95)
  record={'id':identifier,'image':str(image_path),'image_relative':str(image_path.relative_to(args.output)),'split':'test','label_class_id':declared['label_class_id'],'label_name':args.classes[declared['label_class_id']],'label_source':declared['label_source'],'source_archive':declared['name'],'source_image':item['name'],'source_sha256':source_sha,'pixelsha':pixelsha,'phash':perceptual,'capture_group':selected['capture_group'],'group':selected['capture_group'],'width':image.width,'height':image.height,'source_raw_size':list(raw_size),'source_display_size':list(display_size),'source_exif_orientation':orientation,'annotation_type':'author_archive_image_classification','has_object_boxes':False,'source_header_crc32':item['crc32'],'source_data_crc32':item['data_crc32'],'source_data_crc32_verified':True,'source_header_matches_quickopen':True,'full_archive_sha256_verified':False,'derived_sha256':hashlib.sha256(image_path.read_bytes()).hexdigest()}
 atomic_json(record_path,record);target.unlink();return record

def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--seed',type=int,required=True);p.add_argument('--per-class',type=int,default=200);p.add_argument('--workers',type=int,default=8);p.add_argument('--max-side',type=int,default=1280);p.add_argument('--max-download-bytes',type=int,default=2000000000);p.add_argument('--index-only',action='store_true');p.add_argument('--retries',type=int,default=6);p.add_argument('--timeout',type=float,default=120);p.add_argument('--range-engine',type=Path,default=Path(__file__).resolve().parents[2]/'cacao-training/download-review/fetch_parquet.py');a=p.parse_args();a.output=a.output.expanduser().resolve();a.output.mkdir(parents=True,exist_ok=True)
 if min(a.per_class,a.workers)<1 or a.max_side<0:p.error('Invalid sampling/image parameters')
 cfg=json.loads(a.config.read_text());a.classes=cfg['classes'];configsha=hashlib.sha256(a.config.read_bytes()).hexdigest()
 with ThreadPoolExecutor(max_workers=min(2,len(cfg['files']))) as pool:indexes=list(pool.map(lambda f:archive_index(f,a.output),cfg['files']))
 index_by_name={i['archive']:i for i in indexes};rng=random.Random(a.seed);groups=collections.defaultdict(list);regex=re.compile(cfg['capture_group_regex']) if cfg.get('capture_group_regex') else None
 for declared in cfg['files']:
  for item in index_by_name[declared['name']]['entries']:
   if item['directory'] or PurePosixPath(item['name']).suffix.lower() not in IMAGE_SUFFIXES:continue
   group=regex.search(item['name']) if regex else None;identifier=hashlib.sha256((declared['name']+'\0'+item['name']+'\0'+item['data_crc32']).encode()).hexdigest()[:24]
   groups[declared['label_class_id']].append({'id':identifier,'archive':declared,'entry':item,'capture_group':group.group(1) if group else 'archive:'+declared['name']})
 selected=[]
 for label in sorted(groups):
  candidates=sorted(groups[label],key=lambda e:(e['archive']['name'],e['entry']['name']))
  if len(candidates)<a.per_class:raise ValueError('Insufficient images in declared class')
  selected.extend(rng.sample(candidates,a.per_class))
 selected=sorted(selected,key=lambda e:e['id']);planned_bytes=sum(e['entry']['header_size']+e['entry']['data_size'] for e in selected)
 if planned_bytes>a.max_download_bytes:raise ValueError('Sample exceeds authorized byte budget')
 plan={'schema_version':1,'seed':a.seed,'sampling':'uniform random without replacement within author-declared image classes; no model results used','per_class':a.per_class,'selected_count':len(selected),'config_sha256':configsha,'full_archive_sha256_verified':False,'whole_source_cohort_role':'external test only','planned_source_range_bytes':planned_bytes,'population_images':{str(k):len(v) for k,v in groups.items()},'capture_groups':dict(collections.Counter(str(e['archive']['label_class_id'])+':'+e['capture_group'] for e in selected)),'selected':selected}
 plan_path=a.output/'sampling-plan.json'
 if plan_path.exists() and json.loads(plan_path.read_text())!=plan:raise ValueError('Existing frozen sampling plan differs; choose a new output')
 atomic_json(plan_path,plan);print(json.dumps({k:v for k,v in plan.items() if k!='selected'},indent=2),flush=True)
 if a.index_only:return
 for sub in ['records','range-cache','images/test']:(a.output/sub).mkdir(parents=True,exist_ok=True)
 engine=load_module('shared_range_engine',a.range_engine);extractor=load_module('shared_archive_image_contract',Path(__file__).with_name('extract_image_archives.py'));rows=[];start=time.monotonic();done_bytes=0
 with ThreadPoolExecutor(max_workers=a.workers) as pool:
  futures={pool.submit(image_job,e,a,engine,extractor):e for e in selected}
  for future in as_completed(futures):
   row=future.result();rows.append(row);entry=futures[future]['entry'];done_bytes+=entry['header_size']+entry['data_size'];print(f'{len(rows)}/{len(selected)} images; {done_bytes/1e6:.1f}/{planned_bytes/1e6:.1f} MB; {done_bytes/max(.001,time.monotonic()-start)/1e6:.2f} MB/s',flush=True)
 rows.sort(key=lambda r:r['id']);atomic_json(a.output/'manifest.json',rows);audit={'selected_images':len(rows),'class_counts':dict(collections.Counter(r['label_name'] for r in rows)),'source_range_bytes':planned_bytes,'derived_bytes':sum(Path(r['image']).stat().st_size for r in rows),'manifest_sha256':hashlib.sha256((a.output/'manifest.json').read_bytes()).hexdigest(),'sampling_plan_sha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'full_archive_sha256_verified':False,'all_selected_header_and_data_crcs_verified':True,'evaluation_only':True,'limits':'Stratified image sample, not independent pods/farms/flights; image labels only, no boxes. Class/background confounding remains possible; complete source held out from training.'};atomic_json(a.output/'audit.json',audit);print(json.dumps(audit,indent=2),flush=True)
if __name__=='__main__':main()
