import {cp, mkdir, rm, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
execFileSync(process.execPath,[path.join(root,'scripts/build.mjs')],{cwd:root,stdio:'inherit'});
const destination=path.join(root,'ios/Onda/Web');
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
for(const name of ['index.html','styles.css','manifest.webmanifest','src','public']){
  await cp(path.join(root,'dist',name),path.join(destination,name),{recursive:true});
}
// Use the same declarative optional-payload exclusions as the web receiver.
const config=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
for(const asset of config.onda?.offline?.exclude||[]){
  const target=path.resolve(destination,'.'+asset);
  if(!target.startsWith(destination+path.sep))throw new Error('Invalid excluded asset path');
  await rm(target,{force:true});
}
console.log('Recursos del receptor incluidos en ios/Onda/Web. No depende del hosting para abrir.');
