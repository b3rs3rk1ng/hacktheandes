import {createGroundPlanner} from './ground-planner.mjs';
let planner;
self.onmessage=({data})=>{if(data.type==='init'){planner=createGroundPlanner(data.world);return}try{const result=planner.planVehicle(...data.args);self.postMessage({id:data.id,result})}catch(error){self.postMessage({id:data.id,error:error.message})}};
