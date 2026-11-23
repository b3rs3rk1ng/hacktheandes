"""Isolated film asset server; it never sends commands to the live mission."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import json, mimetypes, urllib.request, argparse
parser=argparse.ArgumentParser()
parser.add_argument('--project',type=Path,help='Saved project folder containing scene/ and director.mjs')
parser.add_argument('--port',type=int,default=19441)
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1]
FILM=args.project.resolve() if args.project else Path(__file__).resolve().parent
OUT=FILM.parent if args.project else ROOT.parent/'output/video/cacao'
SNAPSHOT=(FILM/'scene') if args.project else OUT/'proyecto/scene'
if not SNAPSHOT.is_dir():SNAPSHOT=ROOT.parent/'tmp/cacao-film/scene'
ASSETS=SNAPSHOT if SNAPSHOT.is_dir() else ROOT
class FilmServer(ThreadingHTTPServer):
    request_queue_size=256
    daemon_threads=True
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        route=unquote(urlparse(self.path).path)
        if route=='/film/studio-main.mjs':
            return self.reply((SNAPSHOT/'studio-entry.mjs').read_bytes(),'text/javascript')
        if route=='/':
            source=(ASSETS/'ui/orchard/index.html').read_text().replace('src="/orchard/main.js"','src="/film/studio-main.mjs"')
            return self.reply(source.encode(),'text/html')
        if route=='/api/world': path=ASSETS/'runtime/orchard.json'
        elif route=='/api/session': return self.reply(b'{"operator":false,"shared":true}','application/json')
        elif route=='/api/model-card': path=ASSETS/'assets/cacao-model-card.json'
        else:
            paths={'/':ROOT/'ui/orchard/index.html'}
            path=paths.get(route)
            for prefix,base in {'/ui/':ASSETS/'ui','/assets/':ASSETS/'assets','/vendor/':ASSETS/'ui/vendor','/orchard/':ASSETS/'ui/orchard','/robotics/':ASSETS/'ui/robotics','/film/':FILM,'/output/':OUT}.items():
                if route.startswith(prefix):
                    candidate=(base/route[len(prefix):]).resolve()
                    if candidate.is_relative_to(base.resolve()):path=candidate
                    break
        if not path or not path.is_file():self.send_error(404);return
        self.reply(path.read_bytes(),mimetypes.guess_type(path)[0] or 'application/octet-stream')
    def reply(self,data,kind='application/json'):
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_POST(self):
        route=urlparse(self.path).path
        data=self.rfile.read(int(self.headers.get('Content-Length',0)))
        if route=='/film/infer':
            try:
                request=urllib.request.Request('http://127.0.0.1:19439/infer',data=data,headers={'Content-Type':'image/jpeg'})
                with urllib.request.urlopen(request,timeout=40) as r: result=r.read()
                self.reply(result)
            except Exception as e:self.send_error(502,str(e))
        elif route.startswith('/film/save/'):
            name=Path(route).name
            if name!=route.removeprefix('/film/save/'):self.send_error(400);return
            OUT.mkdir(parents=True,exist_ok=True);(OUT/name).write_bytes(data);self.reply(b'{"ok":true}')
        else:self.send_error(404)
if __name__=='__main__':
    print(f'Film studio: http://127.0.0.1:{args.port}/',flush=True)
    FilmServer(('127.0.0.1',args.port),Handler).serve_forever()
