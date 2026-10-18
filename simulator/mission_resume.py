"""Resume a parked mission across a service update without refilling its battery."""
import hashlib
import json
import math


def geometry_key(world):
    return hashlib.sha256(json.dumps({k:world.get(k) for k in ('terrain','plants','pods','route')},sort_keys=True,separators=(',',':')).encode()).hexdigest()


def parked_checkpoint(state,world):
    if not state or state.get('phase') not in ('idle','charging') or state.get('payload_attached'):return None
    if math.dist(state.get('position',[1e6]*3),world['config']['field']['home'])>.2:return None
    return {'geometry_key':geometry_key(world),'state':state}


def restore_parked(checkpoint,world):
    if not checkpoint or checkpoint.get('geometry_key')!=geometry_key(world):return None
    state=checkpoint.get('state',{})
    return state if parked_checkpoint(state,world) else None
