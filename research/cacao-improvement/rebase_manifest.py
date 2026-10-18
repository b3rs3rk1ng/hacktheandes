#!/usr/bin/env python3
"""Rebase declared manifest path fields between filesystem roots, preserving IDs/labels.

Handles a JSON list of records or --records-key container. Historical provenance
paths remain untouched unless explicitly named with --field. Does not copy files.
"""
import argparse,copy,hashlib,json,os
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True,type=Path);p.add_argument('--source-root',required=True,type=Path);p.add_argument('--target-root',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--field',action='append',default=None);p.add_argument('--records-key');p.add_argument('--verify-target-files',action='store_true');a=p.parse_args()
 if a.output.exists():raise ValueError('Output already exists; refusing overwrite')
 source=a.source_root.expanduser().resolve();target=a.target_root.expanduser().absolute()
 if not source.is_absolute() or not target.is_absolute():raise ValueError('Roots must be absolute')
 content=a.input.read_bytes();data=json.loads(content);rows=data[a.records_key] if a.records_key else data
 if not isinstance(rows,list):raise ValueError('Manifest must contain a record list')
 fields=a.field or ['image'];changed=0
 for i,row in enumerate(rows):
  for field in fields:
   if field not in row:raise ValueError(f'Record {i} lacks declared field {field}')
   value=row[field]
   if not isinstance(value,str):raise ValueError(f'Record {i} field {field} is not a string')
   original=Path(value)
   if not original.is_absolute():raise ValueError(f'Record {i} field {field} must be an absolute source path')
   relative=original.resolve().relative_to(source)
   if '..' in relative.parts:raise ValueError('Unsafe relative path')
   destination=target/relative
   if a.verify_target_files and not destination.is_file():raise ValueError('Missing target file: '+str(destination))
   row[field]=str(destination);changed+=1
 a.output.parent.mkdir(parents=True,exist_ok=True);temporary=a.output.with_name(a.output.name+'.tmp');temporary.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n');os.replace(temporary,a.output)
 print(json.dumps({'records':len(rows),'path_fields_changed':changed,'fields':fields,'source_root':str(source),'target_root':str(target),'input_sha256':hashlib.sha256(content).hexdigest(),'output_sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()},indent=2))
if __name__=='__main__':main()
