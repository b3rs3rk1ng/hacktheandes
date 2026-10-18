"""Render QA using recorded physics. No inference, robot control or accuracy claims.

Run with a validate_orchard.py trace. /qa/restart restarts its wall-clock playback.
This separate loopback service never controls or substitutes the live simulator.
"""
import argparse
import json
import time
from pathlib import Path
import orchard_server as server


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace',type=Path)
    parser.add_argument('--port',type=int,default=18438)
    args=parser.parse_args()
    trace=json.loads(args.trace.read_text())['samples']
    origin=trace[0]['physics']['updated_at']
    clock={'start':time.monotonic(),'wall':time.time()}

    class Replay(server.Handler):
        def do_GET(self):
            route=self.path.split('?')[0]
            if route=='/qa/restart':
                clock.update(start=time.monotonic(),wall=time.time())
                self.send(200,{'mode':'recorded_telemetry_only'});return
            if route in ('/api/status','/api/telemetry'):
                elapsed=time.monotonic()-clock['start']
                state=next((row['physics'] for row in reversed(trace) if row['physics']['updated_at']-origin<=elapsed),trace[0]['physics'])
                state={**state,'updated_at':clock['wall']+state['updated_at']-origin,
                    'counts':{'alerts':sum(o.get('target_score',0)>=server.CFG['inspection']['alert_threshold'] for o in state.get('observed',{}).values())}}
                self.send(200,{'physics':state,'model':{'actual_inference':False},
                    'model_error':'QA LOCAL: telemetría grabada; inferencia y control desactivados'})
                return
            super().do_GET()

        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length','0')))
            self.send(503,{'error':'QA local: sólo reproducción; sin inferencia ni control'})

    print(f'Replay QA only: http://127.0.0.1:{args.port}',flush=True)
    server.ThreadingHTTPServer(('127.0.0.1',args.port),Replay).serve_forever()


if __name__=='__main__':main()
