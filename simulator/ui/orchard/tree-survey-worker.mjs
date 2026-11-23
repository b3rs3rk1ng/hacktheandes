import {createSceneClearance} from './scene-clearance.mjs';
import {planTreeSurvey} from './tree-survey.mjs';
self.onmessage=({data})=>{
 try{const field=createSceneClearance(data.world,{obstacles:data.reservations});let previous=data.start;
  for(const {tree,pods} of data.trees){const survey=planTreeSurvey(tree,pods,field,data.world.terrain,{start:previous});previous=survey.stops.at(-1)?.flight||previous;self.postMessage({survey})}
  self.postMessage({done:true});
 }catch(error){self.postMessage({error:error.message})}
};
