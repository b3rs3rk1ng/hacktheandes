/** Frame-by-frame film export. A scene can be replaced without recapturing others. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connect} from './cdp.mjs';
const root=process.cwd(),out=path.resolve(root,process.env.FILM_OUTPUT||'output/video/cacao-v3'),fps=24;
const requested=process.argv.find(a=>a.startsWith('--scene='))?.split('=')[1];
const force=process.argv.includes('--force');
const names=['base','despegue','reconocimiento','deteccion','salida-terrestres','coordinacion','retirada','deposito','equipo','regreso','estaciones','bandera-peru'];
await fs.mkdir(path.join(out,'escenas'),{recursive:true});
const c=await connect();
const {width,height}=await c.evaluate('({width:film.width,height:film.height})');
await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
await c.evaluate('window.film.stop();fetch("/output/detection.json").then(r=>r.json()).then(d=>window.film.restoreDetection(d))');
const chapters=await c.evaluate('window.film.chapters');
const manifest={title:'CACAO',version:3,duration:72,width,height,fps,format:'9:16',directed:true,voice:false,score:'score-original.wav',detection:'detection.json',scenes:chapters.map((ch,i)=>({...ch,id:i+1,file:`escenas/${String(i+1).padStart(2,'0')}-${names[i]}.mp4`,cameraTrack:`escenas/${String(i+1).padStart(2,'0')}-${names[i]}-camera.json`}))};
await fs.writeFile(path.join(out,'proyecto.json'),JSON.stringify(manifest,null,2));
for(const shot of manifest.scenes){
 if(requested&&shot.id!==Number(requested))continue;
 const destination=path.join(out,shot.file);
 try{if(!force&&(await fs.stat(destination)).size>10000){console.log(`KEEP ${shot.id} ${shot.file}`);continue}}catch{}
 const frames=Math.round((shot.e-shot.s)*fps),tmp=destination.replace('.mp4','.partial.mp4');
 const args=['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-ss',String(shot.s),'-t',String(shot.e-shot.s),'-i',path.join(out,'score-original.wav'),'-map','0:v','-map','1:a','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-frames:v',String(frames),'-movflags','+faststart',tmp];
 const encoder=spawn('ffmpeg',args,{stdio:['pipe','ignore','pipe']});let stderr='';encoder.stderr.on('data',d=>stderr+=d);const done=new Promise((resolve,reject)=>encoder.on('close',code=>code===0?resolve():reject(Error(stderr))));
 const track=[];console.log(`START ${shot.id} ${shot.file} ${frames} frames`);
 for(let frame=0;frame<frames;frame++){
  const t=shot.s+frame/fps;
  const pose=await c.evaluate(`window.film.render(${t});({time:${t},camera:{position:window.film.camera.position.toArray(),quaternion:window.film.camera.quaternion.toArray(),fov:window.film.camera.fov}})`);track.push(pose);
  const screenshot=await c.call('Page.captureScreenshot',{format:'jpeg',quality:94,captureBeyondViewport:false,optimizeForSpeed:true});
  if(!encoder.stdin.write(Buffer.from(screenshot.data,'base64')))await once(encoder.stdin,'drain');
  if(frame%48===0)console.log(`PROGRESS ${shot.id} ${frame}/${frames}`);
 }
 encoder.stdin.end();await done;await fs.rename(tmp,destination);await fs.writeFile(path.join(out,shot.cameraTrack),JSON.stringify(track));console.log(`DONE ${shot.id} ${shot.file}`);
}
c.close();
const lines=manifest.scenes.map(s=>`file '${path.join(out,s.file).replaceAll("'","'\\''")}'`).join('\n');await fs.writeFile(path.join(out,'montaje.txt'),lines+'\n');
console.log('Scenes saved. Rebuild one scene: node simulator/film/capture.mjs --scene=4 --force');
