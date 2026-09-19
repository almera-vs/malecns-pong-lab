import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadMaleCnsGraph } from "../src/data-loader.ts";
const name=process.argv[2]??"optimized";
const {MaleCnsBrain}=await import(pathToFileURL(resolve(name==="baseline"?"experiments/performance/baseline-brain.ts":"src/brain.ts")));
const root=fileURLToPath(new URL("../public/data/runtime/",import.meta.url));
globalThis.fetch=async url=>new Response(readFileSync(join(root,basename(new URL(url).pathname))));
const graph=await loadMaleCnsGraph(()=>{},"http://local/data/runtime/manifest.json");
const interactive=process.argv.includes("--interactive");
const dt=Number(process.env.MALECNS_DT_MS??4);
const config=interactive?{dtMs:dt,realRefractorySteps:2,eligibilityDecay:Math.pow(0.9999,dt/0.1),preTraceDecay:Math.pow(0.995,dt/0.1),postTraceDecay:Math.pow(0.995,dt/0.1),dopamineDecay:Math.pow(0.92,dt/0.1),membraneSynapseGain:Number(process.env.PSP_GAIN??0.8),retinalMotionGain:Number(process.env.MALECNS_RETINAL_MOTION_GAIN??1.2)}:{};
const brain=new MaleCnsBrain(graph,config);
const hash=createHash("sha256"), timings=[];
let totalSpikes=0,maxMotor=0;
const batches=Number(process.argv[3]??500);
for(let i=0;i<batches;i++) {
  const output=brain.step({retinalFrame:Float32Array.from({length:64},(_,j)=>0.03+((i*7+j*11)%101)/150),bodyFeedback:{jointAnglesRad:[Math.sin(i/50),Math.cos(i/70)],jointVelocityRad:[0.2,-0.1]},reward:i%97===0?(i%194===0?1:-1):0,event:"none",learning:true,recurrence:true,selectedNeuron:null,episodeSeed:17});
  const {wallTimeMs,...deterministic}=output;
  hash.update(JSON.stringify(deterministic));
  totalSpikes+=output.totalSpikes;
  maxMotor=Math.max(maxMotor,...output.motorRatesHz);
  if(i>=100)timings.push(wallTimeMs);
}
for(const field of ["voltages","conductance","eligibility","plasticWeights","motorThresholdBias"]) {
  const array=brain[field]; hash.update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
}
timings.sort((a,b)=>a-b);
const result={name,interactive,batches,nodes:graph.nodeCount,edges:graph.edgeCount,totalSpikes,maxMotor,digest:hash.digest("hex"),meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,medianMs:timings[Math.floor(timings.length/2)],p95Ms:timings[Math.floor(timings.length*0.95)],simulatedMsPerBatch:brain.config.dtMs*brain.batchSteps};
mkdirSync("experiments/performance",{recursive:true});writeFileSync(`experiments/performance/${name}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
