// Shared kinematics in metres/radians. The preview does not claim dynamics,
// force control, collision avoidance or hardware calibration.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function solveArm(target,pitch,spec){
  const [x,y,z]=target,[a,b]=spec.links_m;
  const tool=spec.wrist_length_m+spec.roll_link_m+spec.tool_tcp_m;
  const radial=Math.hypot(x,z)-tool*Math.cos(pitch);
  const vertical=y-spec.shoulder_height_m-tool*Math.sin(pitch);
  const cosine=(radial*radial+vertical*vertical-a*a-b*b)/(2*a*b);
  const elbow=-Math.acos(clamp(cosine,-1,1));
  const shoulder=Math.atan2(vertical,radial)-Math.atan2(b*Math.sin(elbow),a+b*Math.cos(elbow));
  const angles=[-Math.atan2(z,x),shoulder,elbow,pitch-shoulder-elbow,0,0];
  const withinLimits=angles.every((q,i)=>q>=spec.limits_rad[i][0]&&q<=spec.limits_rad[i][1]);
  return {angles,reachable:cosine>=-1&&cosine<=1&&withinLimits};
}
export function armTip(angles,spec){
  const [yaw,shoulder,elbow,wrist,roll,tilt]=angles,[a,b]=spec.links_m;
  const pitch=shoulder+elbow+wrist,w=spec.wrist_length_m+spec.roll_link_m;
  const radial=a*Math.cos(shoulder)+b*Math.cos(shoulder+elbow)+w*Math.cos(pitch);
  const y=spec.shoulder_height_m+a*Math.sin(shoulder)+b*Math.sin(shoulder+elbow)+w*Math.sin(pitch);
  const tx=spec.tool_tcp_m*(Math.cos(pitch)*Math.cos(tilt)-Math.sin(pitch)*Math.sin(roll)*Math.sin(tilt));
  const ty=spec.tool_tcp_m*(Math.sin(pitch)*Math.cos(tilt)+Math.cos(pitch)*Math.sin(roll)*Math.sin(tilt));
  const tz=-spec.tool_tcp_m*Math.cos(roll)*Math.sin(tilt);
  return [(radial+tx)*Math.cos(yaw)+tz*Math.sin(yaw),y+ty,-(radial+tx)*Math.sin(yaw)+tz*Math.cos(yaw)];
}
export const smoothStep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
