import { expect, it } from "vitest";
import { MaleCnsBrain } from "./brain";
import { bodyStepSeconds, FlyPaddleEmbodiment } from "./fly-embodiment";
import { PongGame } from "./game";
import type { RuntimeGraphData } from "./types";

it("advances court and body by precisely the neural duration across batch sizes", () => {
  const graph: RuntimeGraphData = {nodes:[],displayEdges:[],visualInput:[],visualInputChannels:[],motorOutputs:[[],[],[],[]],proprioceptiveInputs:[[],[]],dopamineNeurons:[],nodeCount:0,edgeCount:0,offsets:new Uint32Array([0]),sources:new Uint32Array(),counts:new Uint32Array(),sign:new Int8Array()};
  const brain=new MaleCnsBrain(graph), body=new FlyPaddleEmbodiment(), game=new PongGame();
  let elapsed=0;
  for (const size of [2,8,4,8,2,4]) {
    brain.setBatchSteps(size);
    const output=brain.step({retinalFrame:new Float32Array(64),reward:0,event:"none",learning:true,recurrence:true,selectedNeuron:null});
    const dt=bodyStepSeconds(output);
    elapsed+=dt;
    game.step(body.step(output.motorRatesHz,dt).paddleTargets,dt);
    expect(elapsed*1000).toBeCloseTo(output.neuralTimeMs,10);
    expect(game.state.ballX).toBeCloseTo(400+230*elapsed,10);
  }
  for(const simulatedDurationMs of [0,-1,NaN,Infinity]) expect(()=>bodyStepSeconds({simulatedDurationMs})).toThrow();
});
