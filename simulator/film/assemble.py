"""Reassemble saved scene clips with the original continuous score."""
from pathlib import Path
import json,subprocess,html,hashlib,os
root=Path(__file__).resolve().parents[2];out=Path(os.environ.get('FILM_OUTPUT',root/'output/video/cacao-v3'));project=json.loads((out/'proyecto.json').read_text())
missing=[s['file'] for s in project['scenes'] if not (out/s['file']).is_file()]
if missing:raise SystemExit('Missing scenes: '+', '.join(missing))
# Audio comes from its continuous master, so AAC boundaries in scene clips cannot introduce gaps.
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',str(out/'montaje.txt'),'-i',str(out/'score-original.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-ar','48000','-b:a','256k','-t','72','-movflags','+faststart','-metadata','title=CACAO | Robótica agrícola','-metadata','comment=Secuencia dirigida en simulación. Música original. Sin voz.',str(out/'CACAO-Vertical-v3.mp4')],check=True)
from PIL import Image,ImageDraw
board=Image.new('RGB',(1200,1200),'#0b1711');draw=ImageDraw.Draw(board);cards=[]
for i,s in enumerate(project['scenes']):
 clip=out/s['file'];preview=out/'escenas'/f'{s["id"]:02}-preview.jpg'
 subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str((s['e']-s['s'])/2),'-i',str(clip),'-frames:v','1','-q:v','2',str(preview)],check=True)
 image=Image.open(preview);image.thumbnail((280,350));x=(i%4)*300+10;y=(i//4)*400+22;board.paste(image,(x,y));draw.text((x,y+354),f'{s["id"]:02} | {s["s"]:02}–{s["e"]:02} s',fill='white')
 cards.append(f'<article><h2>{s["id"]:02} · {html.escape(s["k"])}</h2><p>{s["s"]}–{s["e"]} s</p><video controls preload="none" poster="escenas/{s["id"]:02}-preview.jpg" src="{html.escape(s["file"])}"></video><p>{html.escape(s["t"]).replace(chr(10)," ")}</p></article>')
board.save(out/'contacto.jpg',quality=93)
review='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CACAO · Revisión de escenas</title><style>body{margin:0;background:#0a1710;color:#eff5ed;font:16px system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:36px 24px}h1{font-size:40px;font-weight:500}p{color:#c1cfbe}a{color:#b9e7c2}.master{max-width:520px;width:100%;display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:25px;margin-top:40px}article{background:#14241a;padding:18px;border-radius:10px}h2{font-size:18px}video{width:100%;border-radius:6px}small{color:#a0b49d}</style><main><small>CACAO / VERSIÓN 3</small><h1>Video y escenas guardadas</h1><p>72 segundos · 1080 × 1920 · sin voz · música original.</p><video class="master" controls preload="metadata" poster="escenas/12-preview.jpg" src="CACAO-Vertical-v3.mp4"></video><p><a href="CACAO-Vertical-v3.mp4" download>Descargar video completo</a> · <a href="contacto.jpg">Ver todas las tomas</a> · <a href="LEEME.md">Archivos del proyecto</a></p><p>Para corregir, indica el número de escena y el cambio. Ejemplo: «Escena 4: acerca la detección» o «Escena 12: sostén la bandera dos segundos más».</p><div class="grid">'''+''.join(cards)+'''</div><p><small>Rodaje dirigido en el entorno de simulación del proyecto. La caja del detector proviene de una inferencia auténtica de YOLO11s. El izado de la bandera es una coreografía para el cierre.</small></p></main></html>'''
(out/'revision.html').write_text(review)
report={'file':'CACAO-Vertical-v3.mp4','sha256':hashlib.sha256((out/'CACAO-Vertical-v3.mp4').read_bytes()).hexdigest(),'clips':len(project['scenes']),'detection_confidence':json.loads((out/'detection.json').read_text())['selected']['confidence']}
(out/'entrega.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
