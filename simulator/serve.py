"""Loopback-only controls and telemetry for a private Webots workbench."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
from pathlib import Path
import time
import uuid

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT/'runtime'
RUNTIME.mkdir(exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?',1)[0]
        mapping = {'/':('ui/index.html','text/html; charset=utf-8'),
                   '/api/status':('runtime/status.json','application/json'),
                   '/camera.jpg':('runtime/camera.jpg','image/jpeg')}
        if route not in mapping:
            self.send_error(404)
            return
        path, mime = mapping[route]
        try:
            data = (ROOT/path).read_bytes()
        except FileNotFoundError:
            self.send_error(503,'Simulator is starting')
            return
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != '/api/start':
            self.send_error(404)
            return
        # Cross-origin forms cannot trigger a trial through this loopback service.
        if self.headers.get('Content-Type') != 'application/json':
            self.send_error(415)
            return
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            self.send_error(403)
            return
        command = {'id':str(uuid.uuid4()),'action':'start','created_at':time.time()}
        temporary = RUNTIME/'command.tmp'
        temporary.write_text(json.dumps(command))
        temporary.replace(RUNTIME/'command.json')
        self.send_response(202)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(json.dumps(command).encode())

    def log_message(self,format,*args):
        if args and str(args[1]) not in ('200','202'):
            super().log_message(format,*args)


if __name__ == '__main__':
    print('Workbench: http://127.0.0.1:18435',flush=True)
    ThreadingHTTPServer(('127.0.0.1',18435),Handler).serve_forever()
