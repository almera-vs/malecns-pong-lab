// Compare trained and original weights under paired held-out seeds using the full local graph. A
// software raster feeds the application area-pooling adapter; browser antialiasing is not reproduced.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadMaleCnsGraph } from "../src/data-loader.ts";
import { MaleCnsBrain } from "../src/brain.ts";
import { PongGame } from "../src/game.ts";
import { FlyPaddleEmbodiment, bodyStepSeconds } from "../src/fly-embodiment.ts";
import { poolBinocularLuminance } from "../src/retina.ts";

const option=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.split("=")[1]??fallback;
const seeds=String(option("seeds","11,29,47")).split(",").map(Number);
const trainSeconds=Number(option("train-seconds",30)), evalSeconds=Number(option("eval-seconds",10));
if([...seeds,trainSeconds,evalSeconds].some(v=>!Number.isFinite(v)||v<0)||evalSeconds===0) throw Error("Invalid evaluation arguments");
const root=fileURLToPath(new URL("../public/data/runtime/",import.meta.url));
globalThis.fetch=async url=>{try{return new Response(readFileSync(join(root,basename(new URL(url).pathname))));}catch{return new Response("Not found",{status:404});}};
const graph=await loadMaleCnsGraph(()=>{},"http://local/data/runtime/manifest.json");
const pixels=new Uint8ClampedArray(800*450*4), background=new Uint8ClampedArray(pixels.length), integral=new Float64Array(801*451);
for(let i=0;i<background.length;i+=4) background.set([8,17,31,255],i);
for(let y=0;y<450;y++) if(y%20<8) background.set([35,54,83,255],(y*800+400)*4);
function camera(state) {
  pixels.set(background);
  const rect=(x,y,w,h,c)=>{for(let yy=Math.max(0,Math.floor(y));yy<Math.min(450,Math.ceil(y+h));yy++) for(let xx=x;xx<x+w;xx++) pixels.set(c,(yy*800+xx)*4);};
  rect(20,state.leftY,12,90,[103,232,249,255]); rect(768,state.rightY,12,90,[240,171,252,255]);
  for(let y=Math.max(0,Math.floor(state.ballY-8));y<Math.min(450,Math.ceil(state.ballY+8));y++) for(let x=Math.max(0,Math.floor(state.ballX-8));x<Math.min(800,Math.ceil(state.ballX+8));x++) if((x+0.5-state.ballX)**2+(y+0.5-state.ballY)**2<64) pixels.set([248,250,252,255],(y*800+x)*4);
  return poolBinocularLuminance(pixels,800,450,integral);
}
function run(brain,seed,seconds,learning,label,weights) {
  const game=new PongGame(seed),body=new FlyPaddleEmbodiment();
  brain.reset(seed);
  if(weights) brain.plasticWeights.set(weights);
  let state={jointAnglesRad:[0,0],jointVelocityRad:[0,0]},event="none",eventSide=null,eventAction=null,reward=0,elapsedMs=0,hits=0,misses=0,output;
  const started=performance.now(); let lastReport=started;
  while(elapsedMs<seconds*1000) {
    output=brain.step({retinalFrame:camera(game.state),bodyFeedback:state,reward,event,eventSide,eventAction,learning,recurrence:true,selectedNeuron:null,episodeSeed:seed});
    const dt=bodyStepSeconds(output);
    state=body.step(output.motorRatesHz,dt);
    event=game.step(state.paddleTargets,dt,state.paddleActions);
    eventSide=game.eventSide;
    eventAction=game.eventAction;
    reward=game.reward;
    hits+=event==="paddle_hit"?1:0; misses+=event==="miss"?1:0;
    elapsedMs+=output.simulatedDurationMs;
    if(performance.now()-lastReport>15000) {console.log(`${label}: ${(elapsedMs/1000).toFixed(2)}/${seconds}s simulated`);lastReport=performance.now();}
  }
  if(Math.abs(elapsedMs-brain.tick*brain.config.dtMs)>1e-6) throw Error("Simulation clocks diverged");
  return {hits,misses,hitRate:hits+misses?hits/(hits+misses):null,simulatedMs:elapsedMs,wallMs:performance.now()-started,learningStats:output?.learningStats};
}
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const provenance={
  runtimeManifestSha256:hash(readFileSync(join(root,"manifest.json"))),
  sourceHashes:Object.fromEntries(["src/brain.ts","src/reward-credit.ts","src/fly-embodiment.ts","src/game.ts","src/retina.ts"].map(path=>[path,hash(readFileSync(path))])),
  nodeVersion:process.version,
};
const results=[];
for(const seed of seeds) {
  const brain=new MaleCnsBrain(graph,{seed});
  const training=run(brain,seed,trainSeconds,true,`Seed ${seed} training`);
  const trained=brain.plasticWeights.slice();
  const changedWeights=trained.reduce((n,w,i)=>n+(w!==brain.baseWeights[i]?1:0),0);
  // Reset neural, actuator, and game state for paired evaluation; replace only plastic weights in the
  // trained arm. Rate homeostasis remains active in both arms.
  const evaluationSeed=(seed^0x9e3779b9)>>>0;
  const learned=run(brain,evaluationSeed,evalSeconds,false,`Seed ${seed} learned evaluation`,trained);
  const frozen=run(brain,evaluationSeed,evalSeconds,false,`Seed ${seed} frozen evaluation`);
  const result={seed,evaluationSeed,config:brain.config,training,changedWeights,learned,frozen,hitRateDifference:learned.hitRate===null||frozen.hitRate===null?null:learned.hitRate-frozen.hitRate};
  results.push(result);console.log(JSON.stringify(result));
}
const enough=results.length>=3&&results.every(r=>r.training.hits+r.training.misses>=20&&r.learned.hits+r.learned.misses>=20&&r.frozen.hits+r.frozen.misses>=20);
const differences=results.map(r=>r.hitRateDifference).filter(v=>v!==null);
const report={provenance,camera:"software raster without antialiasing; application area-pooling",trainSeconds,evalSeconds,seeds,results,evidence:enough?"Descriptive paired results; statistical confidence not established":"Insufficient training/evaluation events to establish learning efficacy",meanHitRateDifference:differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:null};
mkdirSync("experiments/runs",{recursive:true});
const path=`experiments/runs/learning-evaluation-${Date.now()}.json`;
writeFileSync(path,JSON.stringify(report,null,2));console.log(`Report: ${path}\n${report.evidence}`);
