#!/usr/bin/env python3
"""Read ZIP directory and small metadata entries through bounded HTTP ranges."""
import argparse,io,json,zipfile
from pathlib import Path
from urllib.request import Request,urlopen
class RemoteZip(io.RawIOBase):
    def __init__(self,url):
        self.url=url;self.pos=0;self.requests=0;self.bytes=0
        with urlopen(Request(url,headers={'Range':'bytes=0-0'}),timeout=40) as r:
            if r.status!=206:raise ValueError('Server does not support HTTP ranges')
            self.size=int(r.headers['Content-Range'].split('/')[-1]);r.read()
    def seekable(self):return True
    def readable(self):return True
    def tell(self):return self.pos
    def seek(self,offset,whence=0):
        self.pos=offset if whence==0 else self.pos+offset if whence==1 else self.size+offset
        return self.pos
    def read(self,n=-1):
        n=min(n if n>=0 else self.size-self.pos,self.size-self.pos)
        if n<=0:return b''
        if n>2*1024*1024:raise ValueError(f'Refusing inspection read of {n} bytes')
        start=self.pos;end=self.pos+n-1
        with urlopen(Request(self.url,headers={'Range':f'bytes={start}-{end}'}),timeout=40) as r:
            if r.status!=206 or not r.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/'):
                raise ValueError('Invalid range response')
            data=r.read(n)
        if len(data)!=n:raise IOError('Short read')
        self.pos+=len(data);self.bytes+=len(data);self.requests+=1
        return data

def main():
 p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('--output',required=True,type=Path);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 f=RemoteZip(args.url)
 with zipfile.ZipFile(f) as z:
  index=[{'name':i.filename,'size':i.file_size,'compressed':i.compress_size,'offset':i.header_offset,'crc32':f'{i.CRC:08x}'} for i in z.infolist()]
  (args.output/'original-zip-index.json').write_text(json.dumps(index,indent=2))
  for item in z.infolist():
   if item.file_size<=10000 and item.filename.lower().endswith(('.names','.yaml','.yml','.json','.csv','.data')):
    value=z.read(item);name=item.filename.replace('/','_');(args.output/('source_'+name)).write_bytes(value);print(item.filename,value.decode(errors='replace')[:2000])
  print(json.dumps({'archive_bytes':f.size,'entries':len(index),'images':sum(i['name'].lower().endswith(('.jpg','.jpeg','.png')) for i in index),'requests':f.requests,'bytes_read':f.bytes},indent=2))
if __name__=='__main__':main()
