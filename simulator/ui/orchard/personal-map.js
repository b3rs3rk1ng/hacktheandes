// Each actor's local map is centered on its own position and assigned route.
export function drawPersonalMap(canvas,{world,sensor,contexts,fleet,drone}){
 const x=canvas.getContext('2d'),selected=contexts.find(c=>c.vehicle.id===sensor.id),radius=selected?27:48,w=canvas.width,h=canvas.height,cx=sensor.position.x,cy=-sensor.position.z;
 const project=p=>[w/2+(p[0]-cx)*w/(2*radius),h/2-(p[1]-cy)*h/(2*radius)];
 x.clearRect(0,0,w,h);x.fillStyle='#203027';x.fillRect(0,0,w,h);x.strokeStyle='#bed1ac18';x.lineWidth=1;
 for(let g=-radius;g<=radius;g+=10){const [a]=project([Math.floor(cx/10)*10+g,cy]),[,b]=project([cx,Math.floor(cy/10)*10+g]);x.beginPath();x.moveTo(a,0);x.lineTo(a,h);x.moveTo(0,b);x.lineTo(w,b);x.stroke()}
 for(const p of world.plants){if(Math.abs(p.position[0]-cx)>radius||Math.abs(p.position[1]-cy)>radius)continue;const [a,b]=project(p.position);x.fillStyle=world.coverage?(fleet.coverage?.inspected?.[sensor.id]?.[p.id]?'#d6ddb4':fleet.coverage?.scouted?.[p.id]?'#8ca56b':'#485a4d'):({cacao:'#71854c',banana:'#8ea673',coffee:'#526e52',maize:'#bdab70'})[p.crop];x.beginPath();x.arc(a,b,p.crop==='maize'?1:2.6,0,Math.PI*2);x.fill()}
 const path=selected?.path|| (drone?.waypoint?[[cx,cy],drone.waypoint]:[]);x.strokeStyle='#e0e8c4bb';x.lineWidth=2;x.setLineDash([5,4]);x.beginPath();path.forEach((p,i)=>{const [a,b]=project(p);i?x.lineTo(a,b):x.moveTo(a,b)});x.stroke();x.setLineDash([]);
 for(const robot of world.config.fleet.robots){const [a,b]=project(robot.station_enu);x.strokeStyle=robot.id===sensor.id?'#e6edcf':'#8faaa0';x.strokeRect(a-5,b-5,10,10);x.fillStyle=x.strokeStyle;x.font='11px sans-serif';x.fillText('⚡',a+7,b+4)}
 if(sensor.id==='drone'){const [a,b]=project(world.config.field.home);x.strokeStyle='#e6edcf';x.strokeRect(a-6,b-6,12,12)}
 for(const task of Object.values(fleet.tasks)){if(sensor.id!=='drone'&&task.robot_id!==sensor.id)continue;const [a,b]=project(task.position);x.fillStyle=task.status==='completed'?'#a5ce84':task.status==='rejected'?'#909c96':'#efbb68';x.beginPath();x.arc(a,b,4,0,Math.PI*2);x.fill();if(task.id===selected?.task?.id){x.strokeStyle='#fbe2ad';x.beginPath();x.arc(a,b,8,0,Math.PI*2);x.stroke()}}
 for(const c of contexts){const [a,b]=project([c.vehicle.position.x,-c.vehicle.position.z]);x.fillStyle=c.vehicle.id===sensor.id?'#f1f5de':'#81acbd';x.fillRect(a-4,b-4,8,8)}
 if(drone?.position){const [a,b]=project(drone.position);x.fillStyle=sensor.id==='drone'?'#f1f5de':'#81acbd';x.beginPath();x.moveTo(a,b-5);x.lineTo(a+5,b+4);x.lineTo(a-5,b+4);x.closePath();x.fill()}
 x.fillStyle='#d6dfcd';x.font='12px sans-serif';x.fillText(`N ↑ · radio ${radius} m`,10,18);const bar=10*w/(2*radius);x.strokeStyle='#d6dfcd';x.beginPath();x.moveTo(w-bar-12,h-15);x.lineTo(w-12,h-15);x.stroke();x.fillText('10 m',w-bar-12,h-22);
}
