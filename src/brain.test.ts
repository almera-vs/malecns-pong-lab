import { describe, expect, it } from "vitest";
import { DEFAULT_BRAIN_CONFIG, makeTestGraph, rewardModulatedStdp, SparseBrain, MaleCnsBrain } from "./brain";
import type { RuntimeGraphData } from "./types";

const input = (reward = 0) => ({
  retinalFrame: new Float32Array(64).fill(1),
  reward,
  event: "none" as const,
  learning: true,
  recurrence: true,
  selectedNeuron: 132,
});

describe("reward-modulated STDP", () => {
  it("clips updates against immutable base weights", () => {
    expect(rewardModulatedStdp(1, 1, 1000, 1)).toBe(2);
    expect(rewardModulatedStdp(1, 1, -1000, -1)).toBe(2);
    expect(rewardModulatedStdp(1, 1, 1000, -1)).toBe(0.25);
  });

  it("keeps the test plastic mask visual-to-descending only", () => {
    const graph = makeTestGraph();
    expect(graph.displayEdges.filter((edge) => edge.plastic).every((edge) => edge.source < 64 && edge.target >= 128)).toBe(true);
  });
});

describe("deterministic sparse brain", () => {
  it("produces repeatable neural frames for a fixed seed and input", () => {
    const left = new SparseBrain(makeTestGraph(), DEFAULT_BRAIN_CONFIG);
    const right = new SparseBrain(makeTestGraph(), DEFAULT_BRAIN_CONFIG);
    const a = left.step(input());
    const b = right.step(input());
    expect(a.spikes).toEqual(b.spikes);
    expect(a.motorRatesHz).toEqual(b.motorRatesHz);
  });

  it("records a selected-neuron trace without advancing on selection", () => {
    const brain = new SparseBrain();
    brain.setSelectedNeuron(132);
    const before = brain.tick;
    const snapshot = brain.getSelectedSnapshot();
    expect(brain.tick).toBe(before);
    expect(snapshot?.id).toBe(132);
    brain.step(input());
    expect(brain.getSelectedSnapshot()?.membraneTrace.length).toBeGreaterThan(0);
  });
});

describe("strict biological runtime boundary", () => {
  it("turns a luminance transition into a transient photoreceptor drive", () => {
    const graph: RuntimeGraphData = {
      nodes: [{ id: 0, bodyId: "visual", type: "photoreceptor", population: "visual", section: "optic", x: 0, y: 0, z: 0 }],
      displayEdges: [], visualInput: [0], visualInputChannels: [0], motorOutputs: [[], [], [], []],
      proprioceptiveInputs: [[], []], dopamineNeurons: [], offsets: new Uint32Array([0, 0]), sources: new Uint32Array(), counts: new Uint32Array(), sign: new Int8Array([1]), nodeCount: 1, edgeCount: 0,
    };
    const brain = new MaleCnsBrain(graph, { intrinsicRateHz: 0 });
    const internals = brain as unknown as { retinalDrive: Float64Array };
    const dark = new Float32Array(64).fill(0.03);
    const bright = new Float32Array(64).fill(0.03); bright[0] = 1;
    brain.step({ retinalFrame: dark, reward: 0, event: "none", learning: false, recurrence: true, selectedNeuron: null });
    brain.step({ retinalFrame: bright, reward: 0, event: "none", learning: false, recurrence: true, selectedNeuron: null });
    const transient = internals.retinalDrive[0];
    for (let i = 0; i < 40; i++) brain.step({ retinalFrame: bright, reward: 0, event: "none", learning: false, recurrence: true, selectedNeuron: null });
    expect(transient).toBeGreaterThan(internals.retinalDrive[0]);
  });

  it("turns a miss into a deterministic pain pulse without leaving positive dopamine", () => {
    const graph: RuntimeGraphData = {
      nodes: [0,1,2].map(id=>({id,bodyId:String(id),type:"fixture",population:"central" as const,section:"central" as const,x:0,y:0,z:0})),
      displayEdges:[],visualInput:[0],visualInputChannels:[0],motorOutputs:[[1],[],[],[]],proprioceptiveInputs:[[],[]],dopamineNeurons:[2],
      offsets:new Uint32Array([0,0,1,1]),sources:new Uint32Array([0]),counts:new Uint32Array([1]),sign:new Int8Array([1,1,0]),nodeCount:3,edgeCount:1,
    };
    const brain=new MaleCnsBrain(graph,{intrinsicRateHz:0,dopaminePulseHz:0});
    const internals=brain as unknown as {dopamineLevel:number;plasticWeights:Float32Array};
    internals.dopamineLevel=0.5;
    brain.eligibility.fill(0.5);
    const before=internals.plasticWeights[0];
    const frame={retinalFrame:new Float32Array(64),reward:-1,event:"miss" as const,eventSide:"left" as const,eventAction:"up" as const,pain:1,learning:true,recurrence:true,selectedNeuron:null};
    const applied=brain.step(frame);
    expect(applied.painSpikes).toBeGreaterThan(0);
    expect(applied.dopamineSpikes).toBeGreaterThan(0);
    expect(applied.painLevel).toBeGreaterThan(0);
    expect(applied.painEvents).toBe(1);
    expect(applied.dopamineLevel).toBe(0);
    expect(internals.plasticWeights[0]).toBeLessThan(before);
    expect(applied.learningStats?.pending).toBe(0);
    expect(applied.learningStats?.applied).toBe(1);
  });

  it("routes reward through annotated dopamine spikes before changing an eligible edge", () => {
    const graph: RuntimeGraphData = {
      nodes: [
        { id: 0, bodyId: "visual", type: "photoreceptor", population: "visual", section: "optic", x: 0, y: 0, z: 0 },
        { id: 1, bodyId: "proprio", type: "chordotonal proprioceptor", side: "L", population: "other", section: "vnc", x: 0, y: 0, z: 0 },
        { id: 2, bodyId: "dan", type: "DAN", neurotransmitter: "dopamine", population: "central", section: "central", x: 0, y: 0, z: 0 },
        { id: 3, bodyId: "motor", type: "tibia flexor MN", population: "descending", section: "motor", x: 0, y: 0, z: 0 },
      ],
      displayEdges: [{ source: 0, target: 3, weight: 1, sign: 1, plastic: true }],
      visualInput: [0], visualInputChannels: [0], motorOutputs: [[3], [], [], []],
      proprioceptiveInputs: [[1], []], dopamineNeurons: [2],
      offsets: new Uint32Array([0, 0, 0, 0, 1]), sources: new Uint32Array([0]), counts: new Uint32Array([1]), sign: new Int8Array([1, 1, 0, 1]),
      nodeCount: 4, edgeCount: 1,
    };
    const brain = new MaleCnsBrain(graph, { realStepsPerBatch: 30, visualRateHz: 10_000, proprioBaselineHz: 10_000, dopaminePulseHz: 10_000, synapseCurrentMv: 40, dopamineDecay: 1 });
    const input = { retinalFrame: new Float32Array([1]), bodyFeedback: { jointAnglesRad: [0, 0] as [number, number], jointVelocityRad: [0, 0] as [number, number] }, event: "none" as const, learning: true, recurrence: true, selectedNeuron: null };
    const fixed = brain.step({ ...input, reward: 0 });
    const before = Array.from((brain as any).plasticWeights as Float32Array);
    expect(fixed.dopamineLevel).toBe(0);
    const reinforced = brain.step({ ...input, reward: 1, event: "paddle_hit" });
    const after = Array.from((brain as any).plasticWeights as Float32Array);
    expect(reinforced.dopamineSpikes).toBeGreaterThan(0);
    expect(reinforced.dopamineLevel).toBeGreaterThan(1);
    expect(after.some((weight, index) => weight !== before[index])).toBe(true);
  });

  it("credits only the paddle side that caused a reward", () => {
    const graph: RuntimeGraphData = {
      nodes: [
        { id: 0, bodyId: "visual", type: "photoreceptor", population: "visual", section: "optic", x: 0, y: 0, z: 0 },
        { id: 1, bodyId: "dan", type: "DAN", neurotransmitter: "dopamine", population: "central", section: "central", x: 0, y: 0, z: 0 },
        { id: 2, bodyId: "left-motor", type: "tibia flexor MN", population: "descending", section: "motor", x: 0, y: 0, z: 0 },
        { id: 3, bodyId: "right-motor", type: "tibia flexor MN", population: "descending", section: "motor", x: 0, y: 0, z: 0 },
      ],
      displayEdges: [], visualInput: [0], visualInputChannels: [0], motorOutputs: [[2], [], [3], []],
      proprioceptiveInputs: [[], []], dopamineNeurons: [1],
      offsets: new Uint32Array([0, 0, 0, 1, 2]), sources: new Uint32Array([0, 0]), counts: new Uint32Array([1, 1]),
      sign: new Int8Array([1, 0, 1, 1]), nodeCount: 4, edgeCount: 2,
    };
    const brain = new MaleCnsBrain(graph, { realStepsPerBatch: 8, visualRateHz: 10_000, dopaminePulseHz: 10_000, synapseCurrentMv: 40, intrinsicRateHz: 0 });
    brain.eligibility.fill(1);
    const before = Array.from((brain as any).plasticWeights as Float32Array);
    const output = brain.step({ retinalFrame: new Float32Array([1]), reward: 1, event: "paddle_hit", eventSide: "left", eventAction: "up", learning: true, recurrence: true, selectedNeuron: null });
    const after = Array.from((brain as any).plasticWeights as Float32Array);
    expect(output.learningStats?.applied).toBe(1);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);

    brain.reset(17);
    brain.eligibility.fill(1);
    const beforeMiss = Array.from((brain as any).plasticWeights as Float32Array);
    const missed = brain.step({ retinalFrame: new Float32Array([1]), reward: -1, event: "miss", eventSide: "left", eventAction: "up", pain: 1, learning: true, recurrence: true, selectedNeuron: null });
    const afterMiss = Array.from((brain as any).plasticWeights as Float32Array);
    expect(missed.painSpikes).toBeGreaterThan(0);
    expect(missed.learningStats?.applied).toBe(1);
    expect(afterMiss[0]).toBeLessThan(beforeMiss[0]);
    expect(afterMiss[1]).toBe(beforeMiss[1]);
  });

  it("changes the stochastic internal state when an episode seed changes", () => {
    const graph: RuntimeGraphData = {
      nodes: [{ id: 0, bodyId: "visual", type: "photoreceptor", population: "visual", section: "optic", x: 0, y: 0, z: 0 }],
      displayEdges: [], visualInput: [0], visualInputChannels: [0], motorOutputs: [[], [], [], []],
      proprioceptiveInputs: [[], []], dopamineNeurons: [], offsets: new Uint32Array([0, 0]), sources: new Uint32Array(), counts: new Uint32Array(), sign: new Int8Array([1]), nodeCount: 1, edgeCount: 0,
    };
    const brain = new MaleCnsBrain(graph);
    brain.setEpisodeSeed(1);
    const first = brain.voltages[0];
    brain.setEpisodeSeed(2);
    expect(brain.voltages[0]).not.toBe(first);
  });
});
