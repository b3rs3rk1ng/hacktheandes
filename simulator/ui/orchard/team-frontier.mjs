export function teamFrontier(lanes,indices={},robots={}){
 const active=lanes.filter(l=>!['returning','charging'].includes(robots[l.robot_id]?.phase));
 return Math.min(...(active.length?active:lanes).map(l=>indices[l.robot_id]||0));
}
