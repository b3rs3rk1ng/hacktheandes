"""Bounded, shared HTTP representations for read-heavy live dashboards."""
from collections import OrderedDict
import gzip
import hashlib
import threading
import time


class RepresentationCache:
    def __init__(self, max_bytes=64*1024*1024, max_entries=256):
        self.max_bytes=max_bytes;self.max_entries=max_entries
        self.entries=OrderedDict();self.size=0;self.lock=threading.Lock()

    def get(self,key,build,ttl=60,compress=True):
        # Build under the lock so a burst of viewers cannot duplicate work.
        with self.lock:
            now=time.monotonic();entry=self.entries.get(key)
            if entry and now<entry[0]:
                self.entries.move_to_end(key);return entry[1]
            if entry:self.size-=self.entries.pop(key)[2]
            raw=build();packed=gzip.compress(raw,compresslevel=6) if compress and len(raw)>1024 else None
            if packed and len(packed)>=len(raw):packed=None
            value=(raw,packed,'"'+hashlib.sha256(raw).hexdigest()+'"')
            size=len(raw)+len(packed or b'')
            if size<=self.max_bytes:
                self.entries[key]=(time.monotonic()+ttl,value,size);self.size+=size
                while self.size>self.max_bytes or len(self.entries)>self.max_entries:
                    _,old=self.entries.popitem(last=False);self.size-=old[2]
            return value


def viewer_fleet(fleet):
    """Project history into the map flags and recent activity used by viewers.

    Full evidence and inspection records remain on the operator API and disk.
    """
    result={**fleet,'events':fleet.get('events',[])[-20:]}
    result.pop('host_lease',None)
    coverage=dict(fleet.get('coverage',{}));coverage.pop('completed',None)
    coverage['scouted']={key:bool(value) for key,value in coverage.get('scouted',{}).items()}
    coverage['inspected']={robot:{key:bool(value) for key,value in trees.items()} for robot,trees in coverage.get('inspected',{}).items()}
    result['coverage']=coverage
    return result
