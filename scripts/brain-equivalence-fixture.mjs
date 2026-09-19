import { createHash } from "node:crypto";

/**
 * Verify deterministic numerical state on a synthetic graph spanning sign and contact-count cases. The
 * digest intentionally excludes wall-clock performance.
 */
export function equivalenceDigest(MaleCnsBrain, makeTestGraph) {
  const fixture=makeTestGraph();
  const edges=fixture.displayEdges.slice().sort((a,b)=>a.target-b.target);
  const offsets=new Uint32Array(fixture.nodes.length+1);
  for(const edge of edges)offsets[edge.target+1]++;
  for(let i=1;i<offsets.length;i++)offsets[i]+=offsets[i-1];
  const graph={...fixture,nodeCount:fixture.nodes.length,edgeCount:edges.length,offsets,sources:Uint32Array.from(edges,e=>e.source),counts:Uint32Array.from(edges,(_,i)=>i%13===0?4097:i%11===0?0:100),sign:Int8Array.from(fixture.nodes,(_,i)=>i%7===0?-1:i%11===0?0:1)};
  // Pin the historical fine-step configuration to test propagation equivalence independently of the
  // current interactive timestep.
  const brain=new MaleCnsBrain(graph,{dtMs:0.1,realRefractorySteps:60,eligibilityDecay:0.9999,preTraceDecay:0.995,postTraceDecay:0.995,dopamineDecay:0.92,membraneSynapseGain:0.22,maxMotorThresholdBias:6,motorHomeostaticRateHz:12,motorHomeostaticGain:0.004,minActivationConductance:0.5,rewardResponseWindowMs:20,visualRateHz:180,retinalMotionGain:0,retinalBaselineDrive:0,retinalLuminanceGain:1}),hash=createHash("sha256");
  for(const seed of [17,29,4]) {
    brain.reset(seed);brain.setSelectedNeuron(128);
    for(let i=0;i<120;i++) {
      brain.setBatchSteps([2,4,8][Math.floor(i/40)]);
      brain.config.synapticReleasePerContact=i<60?0.16:0.31;
      const output=brain.step({retinalFrame:Float32Array.from({length:64},(_,j)=>(j+i)%17/17),bodyFeedback:{jointAnglesRad:[0.5,-0.8],jointVelocityRad:[0.1,-0.2]},reward:i%19===0?(i%38===0?1:-1):0,event:"none",learning:i%9!==0,recurrence:i%13!==0,selectedNeuron:128,episodeSeed:seed});
      const {wallTimeMs,painSpikes,painLevel,painEvents,...state}=output;
      // Normalize telemetry fields before hashing so the fixture targets trajectory and numerical state
      // rather than diagnostic schema changes.
      state.learningStats={applied:state.learningStats.applied,expired:state.learningStats.expired,pending:state.learningStats.pending};
      hash.update(JSON.stringify(state));
      for(const name of ["voltages","conductance","eligibility","plasticWeights","motorThresholdBias","refractoryUntil"]) {
        const a=brain[name];hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
      }
    }
  }
  return hash.digest("hex");
}
