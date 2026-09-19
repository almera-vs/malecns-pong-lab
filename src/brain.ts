import type {
  ActiveEdge,
  BrainStepInput,
  BrainStepOutput,
  TestGraph,
  GraphEdge,
  GraphNode,
  Population,
  PaddleAction,
  RuntimeGraphData,
  PaddleSide,
} from "./types";
import { RewardCredit } from "./reward-credit.ts";

export interface BrainConfig {
  seed: number;
  dtMs: number;
  testStepsPerBatch: number;
  realStepsPerBatch: number;
  membraneDecay: number;
  threshold: number;
  refractorySteps: number;
  /** Refractory duration in integration ticks; physical duration also depends on dtMs. */
  realRefractorySteps: number;
  /** Symmetric numerical bound on the signed synaptic accumulator in phenomenological model units. */
  maxSynapticConductance: number;
  /**
   * Contact-count coefficient in the recurrent release probability 1 - exp(-coefficient * contacts).
   */
  synapticReleasePerContact: number;
  /** Magnitude of accumulated synaptic input required to activate a dormant integration state. */
  minActivationConductance: number;
  /**
   * Transmission gain for sources outside the externally stimulated sensory and teaching populations.
   */
  recurrentSynapseMultiplier: number;
  /**
   * Assumed spontaneous-event rate for the sampled intrinsic population, in events per simulated
   * second.
   */
  intrinsicRateHz: number;
  /** Phenomenological firing-rate set point applied to each annotated motor pool, in Hz. */
  motorHomeostaticRateHz: number;
  /**
   * Threshold adaptation per batch and per Hz of motor-pool rate error; changing batch size changes
   * adaptation speed.
   */
  motorHomeostaticGain: number;
  /** Symmetric limit on motor-neuron threshold adaptation in the model voltage convention. */
  maxMotorThresholdBias: number;
  eligibilityDecay: number;
  preTraceDecay: number;
  postTraceDecay: number;
  aPlus: number;
  aMinus: number;
  learningRate: number;
  minWeightMultiplier: number;
  maxWeightMultiplier: number;
  maxActiveEdgesForDisplay: number;
  synapseCurrentMv: number;
  /**
   * Discrete coupling between synaptic state and membrane voltage; sensitivity depends on the
   * integration step.
   */
  membraneSynapseGain: number;
  visualRateHz: number;
  proprioBaselineHz: number;
  proprioAngleGainHz: number;
  proprioVelocityGainHz: number;
  dopaminePulseHz: number;
  /**
   * Arbitrary display amplitude assigned to a positively gated teaching event; not dopamine
   * concentration.
   */
  dopamineHitBoost: number;
  dopamineDecay: number;
  rewardResponseWindowMs: number;
  /** Retinal filter parameter used with dtMs, although the filter is updated once per batch. */
  retinalAdaptationTauMs: number;
  /** Rate-model gain applied to signed luminance change relative to the adaptive baseline. */
  retinalMotionGain: number;
  /** Constant nonnegative drive in the image-to-spike transducer, independent of luminance. */
  retinalBaselineDrive: number;
  /** Static image-intensity coefficient in the phenomenological photoreceptor drive. */
  retinalLuminanceGain: number;
}

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  seed: 0x5eed1234,
  // A 4 ms step makes the complete retained graph practical to explore. Spike timing and plasticity
  // require a separate timestep-convergence assessment.
  dtMs: 4,
  testStepsPerBatch: 30,
  realStepsPerBatch: 4,
  membraneDecay: 0.985,
  threshold: 1,
  refractorySteps: 2,
  // Two default ticks impose an 8 ms absolute refractory interval, an assumed numerical/physiological
  // constraint.
  realRefractorySteps: 2,
  maxSynapticConductance: 16,
  // Recurrent release increases with contact count; this coefficient is an experimental parameter
  // rather than a measured release probability.
  synapticReleasePerContact: 0.16,
  minActivationConductance: 0.1,
  // Attenuate internally generated transmission relative to externally stimulated sources. This
  // stabilizing assumption changes effective circuit dynamics.
  recurrentSynapseMultiplier: 0.85,
  intrinsicRateHz: 1.5,
  // Use a shared 24 Hz motor-pool set point to study activity under adaptive excitability; it is not
  // fitted motor physiology.
  motorHomeostaticRateHz: 24,
  // Apply the same rate-error gain to all motor pools at each batch boundary; the adaptation is
  // batch-size dependent.
  motorHomeostaticGain: 0.012,
  maxMotorThresholdBias: 7.3,
  // This per-tick decay gives tau = -4/log(0.9995^40), approximately 200 ms. It does not preserve an
  // isolated trace across a multi-second rally.
  eligibilityDecay: Math.pow(0.9995, 40),
  preTraceDecay: Math.pow(0.995, 40),
  postTraceDecay: Math.pow(0.995, 40),
  aPlus: 0.01,
  aMinus: 0.012,
  // Scale event-triggered updates by immutable base weight. Bounded updates demonstrate plasticity
  // mechanics, not behavioral improvement.
  learningRate: 0.08,
  minWeightMultiplier: 0.25,
  maxWeightMultiplier: 2,
  maxActiveEdgesForDisplay: 384,
  // Convert anatomical contact counts to assumed current magnitudes; the scale is not inferred from
  // physiological recordings.
  synapseCurrentMv: 0.0275,
  membraneSynapseGain: 0.8,
  visualRateHz: 220,
  proprioBaselineHz: 25,
  proprioAngleGainHz: 35,
  proprioVelocityGainHz: 25,
  dopaminePulseHz: 120,
  // Keep the positive display pulse separate from signed reward credit so residual display state cannot
  // reverse an event update.
  dopamineHitBoost: 1.5,
  dopamineDecay: Math.pow(0.92, 40),
  rewardResponseWindowMs: 32,
  retinalAdaptationTauMs: 45,
  // Amplify temporal contrast after spatial pooling, which dilutes small objects. This gain is an
  // engineered sensor parameter requiring sensitivity analysis.
  retinalMotionGain: 4,
  retinalBaselineDrive: 0.01,
  retinalLuminanceGain: 0.8,
};

const POPULATIONS: Population[] = ["visual", "central", "descending", "other"];
const RECENT_HISTORY = 200;
const INSPECTOR_TRACE_LENGTH = 120;
const MAX_SENSORY_MOTOR_PATH_HOPS = 8;
// Cap learning-state memory by sampling existing sign-resolved sensory-to-motor edges. Structural
// eligibility does not establish functional transmission or learned control.
const MAX_PLASTIC_SYNAPSES = 100_000;
const INTRINSIC_RESERVOIR_SIZE = 4096;

/**
 * Construct a synthetic software-verification graph; its imposed roles and dynamics are not evidence
 * about the MaleCNS specimen.
 */
export function makeTestGraph(): TestGraph {
  const nodes: GraphNode[] = [];
  const displayEdges: GraphEdge[] = [];
  const sectionFor = (population: Population): GraphNode["section"] =>
    population === "visual" ? "optic" : population === "central" ? "central" : population === "descending" ? "motor" : "other";

  for (let i = 0; i < 160; i += 1) {
    const population: Population = i < 64 ? "visual" : i < 128 ? "central" : "descending";
    const ring = i % 32;
    const angle = (ring / 32) * Math.PI * 2;
    const radius = population === "visual" ? 0.8 : population === "central" ? 1.15 : 1.5;
    nodes.push({
      id: i,
      bodyId: `test-${i.toString().padStart(4, "0")}`,
      type: population === "descending" ? "descending-test" : `${population}-test`,
      population,
      section: sectionFor(population),
      x: Math.cos(angle) * radius,
      y: (Math.floor(i / 32) - 2) * 0.34,
      z: Math.sin(angle) * radius,
    });
  }

  for (let source = 0; source < 64; source += 1) {
    for (let target = 64; target < 128; target += 1) {
      if ((source * 7 + target * 3) % 17 < 2) displayEdges.push({ source, target, weight: 0.55, sign: 1, plastic: false });
    }
    for (let target = 128; target < 160; target += 1) {
      if ((source * 11 + target * 5) % 23 < 2) displayEdges.push({ source, target, weight: 0.75, sign: 1, plastic: true });
    }
  }
  for (let source = 64; source < 128; source += 1) {
    for (let target = 128; target < 160; target += 1) {
      if ((source * 5 + target) % 13 < 2) displayEdges.push({ source, target, weight: 0.6, sign: source % 7 === 0 ? -1 : 1, plastic: false });
    }
  }
  for (let source = 64; source < 160; source += 1) {
    const target = 64 + ((source * 19 + 7) % 96);
    if (target !== source && target < 160) displayEdges.push({ source, target, weight: 0.08, sign: source % 11 === 0 ? -1 : 1, plastic: false });
  }

  return {
    nodes,
    displayEdges,
    visualInput: Array.from({ length: 64 }, (_, i) => i),
    visualInputChannels: Array.from({ length: 64 }, (_, i) => i),
    motorOutputs: [
      [128, 132, 136, 140, 144, 148, 152, 156],
      [129, 133, 137, 141, 145, 149, 153, 157],
      [130, 134, 138, 142, 146, 150, 154, 158],
      [131, 135, 139, 143, 147, 151, 155, 159],
    ],
    proprioceptiveInputs: [[], []],
    dopamineNeurons: [],
    dataset: "test",
    graphEdgeCount: displayEdges.length,
  };
}

export function rewardModulatedStdp(
  weight: number,
  baseWeight: number,
  eligibility: number,
  reward: number,
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): number {
  const updated = weight + baseWeight * config.learningRate * reward * eligibility;
  return Math.min(baseWeight * config.maxWeightMultiplier, Math.max(baseWeight * config.minWeightMultiplier, updated));
}

export class SparseBrain {
  readonly graph: TestGraph;
  readonly voltages: Float32Array;
  readonly eligibility: Float32Array;
  readonly weights: Float32Array;
  readonly lastSpikes: Uint8Array;
  readonly backend: BrainStepOutput["backend"] = "test-cpu";
  readonly dataStatus: BrainStepOutput["dataStatus"] = "test";
  readonly config: BrainConfig;
  tick = 0;

  private readonly baseWeights: Float32Array;
  private readonly incoming: Float32Array;
  private readonly refractoryUntil: Uint32Array;
  private readonly spikeCounts: Uint32Array;
  private readonly preTrace: Float32Array;
  private readonly postTrace: Float32Array;
  private readonly sourceSlots = new Map<number, number[]>();
  private readonly postSlots = new Map<number, number[]>();
  private readonly plasticIndexByEdge = new Map<number, number>();
  private readonly populationIds = new Map<Population, number[]>();
  private readonly history: Array<{ tick: number; ids: number[] }> = [];
  private readonly inspectorTrace: number[] = [];
  private selectedNeuron: number | null = null;
  private rewardEvents = 0;

  constructor(graph = makeTestGraph(), config: Partial<BrainConfig> = {}) {
    this.graph = graph;
    this.config = { ...DEFAULT_BRAIN_CONFIG, ...config };
    this.voltages = new Float32Array(graph.nodes.length);
    this.eligibility = new Float32Array(graph.displayEdges.filter((edge) => edge.plastic).length);
    this.weights = Float32Array.from(graph.displayEdges.map((edge) => edge.weight));
    this.baseWeights = this.weights.slice();
    this.lastSpikes = new Uint8Array(graph.nodes.length);
    this.incoming = new Float32Array(graph.nodes.length);
    this.refractoryUntil = new Uint32Array(graph.nodes.length);
    this.spikeCounts = new Uint32Array(graph.nodes.length);
    this.preTrace = new Float32Array(this.eligibility.length);
    this.postTrace = new Float32Array(this.eligibility.length);
    for (const population of POPULATIONS) this.populationIds.set(population, []);
    for (const node of graph.nodes) this.populationIds.get(node.population)?.push(node.id);
    this.indexPlasticEdges();
  }

  reset(): void {
    this.voltages.fill(0);
    this.incoming.fill(0);
    this.eligibility.fill(0);
    this.weights.set(this.baseWeights);
    this.lastSpikes.fill(0);
    this.refractoryUntil.fill(0);
    this.spikeCounts.fill(0);
    this.preTrace.fill(0);
    this.postTrace.fill(0);
    this.history.length = 0;
    this.inspectorTrace.length = 0;
    this.rewardEvents = 0;
    this.tick = 0;
  }

  setSelectedNeuron(id: number | null): void {
    this.selectedNeuron = id !== null && id >= 0 && id < this.graph.nodes.length ? id : null;
    this.inspectorTrace.length = 0;
  }

  getSelectedSnapshot() {
    return this.snapshotSelected(Math.max(this.config.dtMs / 1000, (this.history.length * this.config.dtMs) / 1000));
  }

  step(input: BrainStepInput): BrainStepOutput {
    const started = performance.now();
    this.spikeCounts.fill(0);
    const batchSpikes = new Set<number>();
    const activeEdges: ActiveEdge[] = [];
    let totalSpikes = 0;
    const steps = this.config.testStepsPerBatch;

    for (let step = 0; step < steps; step += 1) {
      const fired: number[] = [];
      this.lastSpikes.fill(0);
      for (let id = 0; id < this.voltages.length; id += 1) {
        this.voltages[id] *= this.config.membraneDecay;
        if (this.refractoryUntil[id] > this.tick) continue;
        this.voltages[id] += this.incoming[id];
        this.incoming[id] = 0;
      }
      for (let i = 0; i < this.graph.visualInput.length; i += 1) {
        const node = this.graph.visualInput[i];
        const channel = this.graph.visualInputChannels[i];
        this.voltages[node] += Math.max(0, input.retinalFrame[channel] ?? 0) * 0.18;
      }
      for (let id = 0; id < this.voltages.length; id += 1) {
        if (this.refractoryUntil[id] <= this.tick && this.voltages[id] >= this.config.threshold) fired.push(id);
      }
      for (const id of fired) {
        this.lastSpikes[id] = 1;
        this.spikeCounts[id] += 1;
        batchSpikes.add(id);
        this.voltages[id] = 0;
        this.refractoryUntil[id] = this.tick + this.config.refractorySteps;
      }

      this.decayPlasticTraces();
      for (const source of fired) {
        for (const slot of this.sourceSlots.get(source) ?? []) {
          // Subtract post-trace overlap at a presynaptic event to implement the assumed anti-causal
          // STDP term.
          this.eligibility[slot] = clamp(this.eligibility[slot] - this.config.aMinus * this.postTrace[slot], -1, 1);
          this.preTrace[slot] = Math.min(1, this.preTrace[slot] + 1);
        }
        for (let edgeIndex = 0; edgeIndex < this.graph.displayEdges.length; edgeIndex += 1) {
          const edge = this.graph.displayEdges[edgeIndex];
          if (edge.source !== source || (!input.recurrence && this.graph.nodes[edge.source]?.population !== "visual")) continue;
          this.incoming[edge.target] += this.weights[edgeIndex] * (edge.sign ?? 1) * 0.12;
          if (activeEdges.length < this.config.maxActiveEdgesForDisplay) activeEdges.push({ source, target: edge.target, plastic: edge.plastic });
        }
      }
      for (const target of fired) {
        for (const slot of this.postSlots.get(target) ?? []) {
          // Add pre-trace overlap at a postsynaptic event; same-tick updates follow the explicit
          // pre-before-post loop order.
          this.eligibility[slot] = clamp(this.eligibility[slot] + this.config.aPlus * this.preTrace[slot], -1, 1);
          this.postTrace[slot] = Math.min(1, this.postTrace[slot] + 1);
        }
      }
      this.history.push({ tick: this.tick, ids: fired.slice() });
      if (this.history.length > RECENT_HISTORY) this.history.shift();
      if (this.selectedNeuron !== null) {
        this.inspectorTrace.push(this.voltages[this.selectedNeuron]);
        if (this.inspectorTrace.length > INSPECTOR_TRACE_LENGTH) this.inspectorTrace.shift();
      }
      this.tick += 1;
      totalSpikes += fired.length;
    }

    const seconds = (steps * this.config.dtMs) / 1000;
    const populationRatesHz = POPULATIONS.map((population) => populationRate(this.spikeCounts, this.populationIds.get(population) ?? [], seconds)) as [number, number, number, number];
    const motorRatesHz = this.graph.motorOutputs.map((group) => populationRate(this.spikeCounts, group, seconds)) as [number, number, number, number];
    return {
      neuralTimeMs: this.tick * this.config.dtMs,
      simulatedDurationMs: steps * this.config.dtMs,
      spikes: [...batchSpikes],
      uniqueSpikes: batchSpikes.size,
      activeEdges,
      populationRatesHz,
      motorRatesHz,
      selectedNeuron: this.snapshotSelected(seconds),
      totalSpikes,
      neuralSteps: steps,
      rewardEvents: this.rewardEvents,
      plasticSynapses: this.eligibility.length,
      dopamineLevel: 0,
      dopamineSpikes: 0,
      painSpikes: 0,
      painLevel: 0,
      painEvents: 0,
      wallTimeMs: performance.now() - started,
      backend: this.backend,
      nodeCount: this.graph.nodes.length,
      edgeCount: this.graph.displayEdges.length,
      dataStatus: this.dataStatus,
    };
  }

  private indexPlasticEdges(): void {
    let slot = 0;
    this.graph.displayEdges.forEach((edge, edgeIndex) => {
      if (!edge.plastic) return;
      this.plasticIndexByEdge.set(edgeIndex, slot);
      this.sourceSlots.set(edge.source, [...(this.sourceSlots.get(edge.source) ?? []), slot]);
      this.postSlots.set(edge.target, [...(this.postSlots.get(edge.target) ?? []), slot]);
      slot += 1;
    });
  }

  private decayPlasticTraces(): void {
    for (let i = 0; i < this.eligibility.length; i += 1) {
      this.eligibility[i] *= this.config.eligibilityDecay;
      this.preTrace[i] *= this.config.preTraceDecay;
      this.postTrace[i] *= this.config.postTraceDecay;
    }
  }

  private snapshotSelected(seconds: number) {
    if (this.selectedNeuron === null) return null;
    const node = this.graph.nodes[this.selectedNeuron];
    if (!node) return null;
    return {
      id: node.id,
      bodyId: node.bodyId,
      type: node.type,
      population: node.population,
      section: node.section,
      position: [node.x, node.y, node.z] as [number, number, number],
      positionUnit: "normalized" as const,
      position8nm: node.position8nm,
      recentSpikes: this.history.filter((batch) => batch.ids.includes(node.id)).map((batch) => batch.tick),
      firingRateHz: populationRate(this.spikeCounts, [node.id], seconds),
      membraneTrace: [...this.inspectorTrace],
      incomingConnections: this.graph.displayEdges.filter((edge) => edge.target === node.id).length,
      outgoingConnections: this.graph.displayEdges.filter((edge) => edge.source === node.id).length,
      morphologyAvailable: false,
    };
  }
}

export class MaleCnsBrain {
  readonly graph: RuntimeGraphData;
  readonly backend: BrainStepOutput["backend"] = "malecns-cpu";
  readonly dataStatus: BrainStepOutput["dataStatus"] = "malecns-runtime";
  readonly config: BrainConfig;
  readonly voltages: Float32Array;
  readonly eligibility: Float32Array;
  tick = 0;
  batchSteps: number;
  private dopamineLevel = 0;
  private dopamineSpikes = 0;
  private painLevel = 0;
  private painSpikes = 0;
  private painEvents = 0;
  private episodeSeed = 0;
  private episodeSeedInitialized = false;
  private readonly conductance: Float32Array;
  private readonly refractoryUntil: Uint32Array;
  private readonly spikeCounts: Uint32Array;
  private readonly outOffsets: Uint32Array;
  private readonly outTargets: Uint32Array;
  private readonly outCounts: Uint32Array;
  // Encode a fixed edge as zero and a plastic slot as index + 1. Uint32 preserves the identity of all
  // 100,000 possible plastic edges.
  private readonly plasticSlotByEdge: Uint32Array;
  /**
   * Reachability bits encode left flexor, left extensor, right flexor, and right extensor,
   * respectively.
   */
  private readonly plasticActionMask: Uint8Array;
  private readonly releaseByContactCount = new Float64Array(4096);
  private releaseCacheParameter = NaN;
  private readonly sourceSlots = new Map<number, number[]>();
  private readonly postSlots = new Map<number, number[]>();
  private readonly baseWeights: Float32Array;
  private readonly plasticWeights: Float32Array;
  private readonly preTrace: Float32Array;
  private readonly postTrace: Float32Array;
  private readonly history: Array<{ tick: number; ids: number[] }> = [];
  private readonly inspectorTrace: number[] = [];
  private readonly populationIds = new Map<Population, number[]>();
  private selectedNeuron: number | null = null;
  private rewardEvents = 0;
  private changedWeights = 0;
  private absoluteWeightDelta = 0;
  private positiveUpdates = 0;
  private negativeUpdates = 0;
  private readonly activeNodes: number[] = [];
  private readonly present: Uint8Array;
  private readonly pendingNodes: number[] = [];
  private readonly pending: Uint8Array;
  private readonly externalSource: Uint8Array;
  private readonly intrinsicNodes: Uint32Array;
  private readonly motorThresholdBias: Float32Array;
  private readonly rewardCredit: RewardCredit;
  private readonly dopamineIds: Set<number>;
  /**
   * Reuse annotated dopamine cells as an engineered miss-triggered teaching gateway. No nociceptor
   * identity or pain experience is inferred; an empty teaching population cannot gate learning.
   */
  private readonly nociceptiveGatewayIds: Set<number>;
  private readonly neuronRandomKey: Int32Array;
  private readonly sensoryIds: Uint32Array;
  private readonly sensoryProbability: Float64Array;
  private readonly ordinarySensoryCount: number;
  private readonly populationByNeuron: Int8Array;
  private readonly retinalAdaptation: Float32Array;
  private readonly retinalDrive: Float64Array;
  private retinalInitialized = false;

  constructor(graph: RuntimeGraphData, config: Partial<BrainConfig> = {}) {
    this.graph = graph;
    this.dopamineIds = new Set(graph.dopamineNeurons);
    this.nociceptiveGatewayIds = new Set(graph.dopamineNeurons);
    this.sensoryIds = Uint32Array.from([...graph.visualInput, ...graph.proprioceptiveInputs.flat(), ...graph.dopamineNeurons]);
    this.sensoryProbability = new Float64Array(this.sensoryIds.length);
    this.ordinarySensoryCount = this.sensoryIds.length - graph.dopamineNeurons.length;
    this.populationByNeuron = new Int8Array(graph.nodeCount).fill(-1);
    for (const node of graph.nodes) this.populationByNeuron[node.id] = POPULATIONS.indexOf(node.population);
    this.config = { ...DEFAULT_BRAIN_CONFIG, ...config };
    this.rewardCredit = new RewardCredit(this.config.rewardResponseWindowMs);
    this.retinalAdaptation = new Float32Array(64);
    this.retinalDrive = new Float64Array(64);
    this.episodeSeed = this.config.seed >>> 0;
    this.batchSteps = this.config.realStepsPerBatch;
    this.voltages = new Float32Array(graph.nodeCount).fill(-52);
    this.neuronRandomKey = Int32Array.from({ length: graph.nodeCount }, (_, id) => Math.imul(id + 1, 747796405));
    this.conductance = new Float32Array(graph.nodeCount);
    this.refractoryUntil = new Uint32Array(graph.nodeCount);
    this.spikeCounts = new Uint32Array(graph.nodeCount);
    this.present = new Uint8Array(graph.nodeCount);
    this.pending = new Uint8Array(graph.nodeCount);
    this.externalSource = new Uint8Array(graph.nodeCount);
    for (const id of [...graph.visualInput, ...graph.proprioceptiveInputs.flat(), ...graph.dopamineNeurons]) this.externalSource[id] = 1;
    // Sample intrinsic-drive recipients from non-external cells with resolved transmitter sign. The
    // reservoir depends on graph order and configuration seed, but assigns no sensor or muscle labels.
    const intrinsicCandidates: number[] = [];
    for (const node of graph.nodes) if (!this.externalSource[node.id] && graph.sign[node.id] !== 0) intrinsicCandidates.push(node.id);
    const reservoir: number[] = [];
    let reservoirSeen = 0;
    let reservoirState = this.config.seed >>> 0;
    for (const id of intrinsicCandidates) {
      reservoirSeen += 1;
      if (reservoir.length < INTRINSIC_RESERVOIR_SIZE) reservoir.push(id);
      else {
        reservoirState ^= reservoirState << 13; reservoirState ^= reservoirState >>> 17; reservoirState ^= reservoirState << 5;
        const replacement = (reservoirState >>> 0) % reservoirSeen;
        if (replacement < INTRINSIC_RESERVOIR_SIZE) reservoir[replacement] = id;
      }
    }
    this.intrinsicNodes = Uint32Array.from(reservoir);
    this.motorThresholdBias = new Float32Array(graph.nodeCount);
    this.outOffsets = new Uint32Array(graph.nodeCount + 1);
    for (const source of graph.sources) this.outOffsets[source + 1] += 1;
    for (let i = 0; i < graph.nodeCount; i += 1) this.outOffsets[i + 1] += this.outOffsets[i];
    this.outTargets = new Uint32Array(graph.edgeCount);
    this.outCounts = new Uint32Array(graph.edgeCount);
    this.plasticSlotByEdge = new Uint32Array(graph.edgeCount);
    const cursor = this.outOffsets.slice();
    for (let target = 0; target < graph.nodeCount; target += 1) {
      for (let edge = graph.offsets[target]; edge < graph.offsets[target + 1]; edge += 1) {
        const source = graph.sources[edge];
        const outgoing = cursor[source]++;
        this.outTargets[outgoing] = target;
        this.outCounts[outgoing] = graph.counts[edge];
      }
    }
    for (const population of POPULATIONS) this.populationIds.set(population, []);
    for (const node of graph.nodes) this.populationIds.get(node.population)?.push(node.id);
    const plasticSlots = selectSensoryMotorPlasticEdges(graph, this.outOffsets, this.outTargets, this.outCounts, this.config.synapseCurrentMv);
    this.baseWeights = Float32Array.from(plasticSlots.map((slot) => slot.weight));
    this.plasticWeights = this.baseWeights.slice();
    this.eligibility = new Float32Array(plasticSlots.length);
    this.preTrace = new Float32Array(plasticSlots.length);
    this.postTrace = new Float32Array(plasticSlots.length);
    this.plasticActionMask = Uint8Array.from(plasticSlots, (slot) => slot.actionMask);
    plasticSlots.forEach((slot, index) => {
      this.plasticSlotByEdge[slot.outgoingEdge] = index + 1;
      this.sourceSlots.set(slot.source, [...(this.sourceSlots.get(slot.source) ?? []), index]);
      this.postSlots.set(slot.target, [...(this.postSlots.get(slot.target) ?? []), index]);
    });
  }

  reset(episodeSeed?: number): void {
    this.rewardCredit.reset();
    this.voltages.fill(-52); this.conductance.fill(0); this.refractoryUntil.fill(0);
    this.spikeCounts.fill(0); this.present.fill(0); this.pending.fill(0); this.activeNodes.length = 0; this.pendingNodes.length = 0;
    this.motorThresholdBias.fill(0);
    this.eligibility.fill(0); this.plasticWeights.set(this.baseWeights); this.preTrace.fill(0); this.postTrace.fill(0);
    this.history.length = 0; this.inspectorTrace.length = 0; this.rewardEvents = 0; this.changedWeights = 0; this.absoluteWeightDelta = 0; this.positiveUpdates = 0; this.negativeUpdates = 0; this.dopamineLevel = 0; this.dopamineSpikes = 0; this.painLevel = 0; this.painSpikes = 0; this.painEvents = 0; this.tick = 0;
    this.retinalAdaptation.fill(0); this.retinalDrive.fill(0); this.retinalInitialized = false;
    this.episodeSeedInitialized = false;
    if (episodeSeed !== undefined) this.episodeSeed = episodeSeed >>> 0;
    this.setEpisodeSeed(this.episodeSeed);
  }
  setEpisodeSeed(episodeSeed: number): void {
    this.episodeSeed = Number.isFinite(episodeSeed) ? episodeSeed >>> 0 : this.config.seed >>> 0;
    this.episodeSeedInitialized = true;
    for (let id = 0; id < this.voltages.length; id += 1) this.voltages[id] = -52 + (deterministicUniform(id, 0, this.episodeSeed) - 0.5) * 0.2;
  }
  setSelectedNeuron(id: number | null): void { this.selectedNeuron = id !== null && id >= 0 && id < this.graph.nodeCount ? id : null; this.inspectorTrace.length = 0; }
  getSelectedSnapshot() { return this.snapshotSelected(Math.max(this.config.dtMs / 1000, (this.history.length * this.config.dtMs) / 1000)); }
  setBatchSteps(steps: number): void { this.batchSteps = Math.max(2, Math.min(8, Math.round(steps))); }

  step(input: BrainStepInput): BrainStepOutput {
    const started = performance.now();
    const episodeSeed = input.episodeSeed === undefined ? this.config.seed >>> 0 : input.episodeSeed >>> 0;
    if (!this.episodeSeedInitialized || episodeSeed !== this.episodeSeed) this.setEpisodeSeed(episodeSeed);
    this.spikeCounts.fill(0); this.dopamineSpikes = 0; this.painSpikes = 0;
    // Normal gameplay supplies miss-only stimulation; callers omitting pain derive it from the miss
    // label. The optional input remains an experimental intervention.
    const pain = clamp(input.pain ?? (input.event === "miss" ? 1 : 0), 0, 1);
    if (pain > 0) { this.painLevel = Math.max(this.painLevel, pain); this.painEvents += 1; }
    const rewardPolarity = Math.sign(input.reward);
    if (rewardPolarity !== 0) this.rewardEvents += 1;
    // Clear the positive display trace for negative rewards while retaining the event sign in
    // RewardCredit.
    if (rewardPolarity < 0) this.dopamineLevel = 0;
    this.rewardCredit.enqueue(input.reward, this.eligibility, input.learning, input.eventSide ?? null, input.eventAction ?? null);
    if (this.releaseCacheParameter !== this.config.synapticReleasePerContact) {
      this.releaseCacheParameter = this.config.synapticReleasePerContact;
      for (let contacts = 0; contacts < this.releaseByContactCount.length; contacts++) {
        this.releaseByContactCount[contacts] = 1 - Math.exp(-this.releaseCacheParameter * contacts);
      }
    }
    const batchSpikes = new Set<number>(); const activeEdges: ActiveEdge[] = []; let totalSpikes = 0;
    const populationSpikeCounts = [0, 0, 0, 0];
    const adaptationAlpha = 1 - Math.exp(-this.config.dtMs / Math.max(1, this.config.retinalAdaptationTauMs));
    for (let channel = 0; channel < this.retinalDrive.length; channel += 1) {
      const luminance = clamp(input.retinalFrame[channel] ?? 0, 0, 1);
      if (!this.retinalInitialized) this.retinalAdaptation[channel] = luminance;
      else this.retinalAdaptation[channel] += (luminance - this.retinalAdaptation[channel]) * adaptationAlpha;
      const temporalContrast = luminance - this.retinalAdaptation[channel];
      // Combine baseline, luminance, and signed temporal contrast, then clip to a valid drive. The
      // neural input contains image channels rather than object coordinates.
      this.retinalDrive[channel] = clamp(this.config.retinalBaselineDrive + this.config.retinalLuminanceGain * luminance + this.config.retinalMotionGain * temporalContrast, 0, 1);
    }
    this.retinalInitialized = true;
    let sensoryIndex = 0;
    for (let index = 0; index < this.graph.visualInput.length; index++) {
      const rate = this.retinalDrive[this.graph.visualInputChannels[index]] * this.config.visualRateHz;
      this.sensoryProbability[sensoryIndex++] = (rate * this.config.dtMs) / 1000;
    }
    const feedback = input.bodyFeedback ?? { jointAnglesRad: [0, 0] as [number, number], jointVelocityRad: [0, 0] as [number, number] };
    for (let side = 0; side < this.graph.proprioceptiveInputs.length; side++) {
      const rate = clamp(this.config.proprioBaselineHz + this.config.proprioAngleGainHz * (feedback.jointAnglesRad[side] / (Math.PI / 2)) + this.config.proprioVelocityGainHz * (feedback.jointVelocityRad[side] / 2.2), 0, 180);
      for (let i = 0; i < this.graph.proprioceptiveInputs[side].length; i++) this.sensoryProbability[sensoryIndex++] = (rate * this.config.dtMs) / 1000;
    }
    // During a miss, set teaching-cell injection probability to one for this batch. Gating still
    // requires an actual teaching spike and a nonempty annotated population.
    this.sensoryProbability.fill(pain > 0 ? 1 : (this.config.dopaminePulseHz * this.config.dtMs) / 1000, sensoryIndex);
    for (let step = 0; step < this.batchSteps; step += 1) {
      // Advance display decay per neural tick using the fixed default-batch normalization in the
      // exponent.
      this.dopamineLevel *= Math.pow(this.config.dopamineDecay, this.config.dtMs / (DEFAULT_BRAIN_CONFIG.dtMs * DEFAULT_BRAIN_CONFIG.realStepsPerBatch));
      this.painLevel *= Math.pow(this.config.dopamineDecay, this.config.dtMs / (DEFAULT_BRAIN_CONFIG.dtMs * DEFAULT_BRAIN_CONFIG.realStepsPerBatch));
      const fired = this.advance(this.rewardCredit.pending > 0 ? this.sensoryIds.length : this.ordinarySensoryCount, input.recurrence, activeEdges);
      let teachingSpikes = 0;
      for (const id of fired) {
        batchSpikes.add(id); this.spikeCounts[id] += 1;
        const population = this.populationByNeuron[id];
        if (population >= 0) populationSpikeCounts[population]++;
        if (this.dopamineIds.has(id)) teachingSpikes += 1;
        if (pain > 0 && this.nociceptiveGatewayIds.has(id)) this.painSpikes += 1;
      }
      this.dopamineSpikes += teachingSpikes;
      this.rewardCredit.advance(this.config.dtMs, teachingSpikes, (reward, eligibility, side, action) => {
        // A gated positive reward resets the display pulse; negative credit is represented by the
        // update sign rather than a negative concentration.
        this.dopamineLevel = reward > 0 ? this.config.dopamineHitBoost : 0;
        if (input.learning && eligibility) this.applyDopaminePlasticity(reward, eligibility, side, action);
      });
      totalSpikes += fired.length;
    }
    const seconds = (this.batchSteps * this.config.dtMs) / 1000;
    const populationRatesHz = POPULATIONS.map((population, i) => {
      const count = this.populationIds.get(population)?.length ?? 0;
      return count ? populationSpikeCounts[i] / count / seconds : 0;
    }) as [number, number, number, number];
    const motorRatesHz = this.graph.motorOutputs.map((group) => populationRate(this.spikeCounts, group, seconds)) as [number, number, number, number];
    this.updateMotorHomeostasis(motorRatesHz);
    return { neuralTimeMs: this.tick * this.config.dtMs, simulatedDurationMs: seconds * 1000, learningStats: { ...this.rewardCredit.stats, changedWeights: this.changedWeights, absoluteWeightDelta: this.absoluteWeightDelta, positiveUpdates: this.positiveUpdates, negativeUpdates: this.negativeUpdates }, spikes: [...batchSpikes], uniqueSpikes: batchSpikes.size, activeEdges, populationRatesHz, motorRatesHz, selectedNeuron: this.snapshotSelected(seconds), totalSpikes, neuralSteps: this.batchSteps, rewardEvents: this.rewardEvents, plasticSynapses: this.plasticWeights.length, dopamineLevel: this.dopamineLevel, dopamineSpikes: this.dopamineSpikes, painSpikes: this.painSpikes, painLevel: this.painLevel, painEvents: this.painEvents, wallTimeMs: performance.now() - started, backend: this.backend, nodeCount: this.graph.nodeCount, edgeCount: this.graph.edgeCount, dataStatus: this.dataStatus };
  }

  private advance(sensoryCount: number, recurrence: boolean, activeEdges: ActiveEdge[]): number[] {
    const rest = -52, threshold = -45, membraneDecay = Math.exp(-this.config.dtMs / 20), conductanceDecay = Math.exp(-this.config.dtMs / 5);
    const synapticIntegrationGain = this.config.membraneSynapseGain;
    const fired: number[] = []; let kept = 0;
    // Retain Float32 write boundaries while caching array references; deterministic trajectory fixtures
    // constrain numerical changes.
    const { conductance, voltages, present, pending, activeNodes, pendingNodes, refractoryUntil, motorThresholdBias, neuronRandomKey } = this;
    const tick = this.tick;
    const episodeKey = Math.imul(this.episodeSeed + 1, 277803737) ^ 1;
    const noiseKey = Math.imul(tick + 0x9e3779b9 + 1, 2891336453) ^ episodeKey;
    // Decay dormant subthreshold synaptic accumulators in a pending list. This sparse approximation
    // retains summation without integrating every membrane each tick.
    let pendingKept = 0;
    for (let index = 0; index < pendingNodes.length; index++) {
      const id = pendingNodes[index];
      if (present[id]) { pending[id] = 0; continue; }
      const current = Math.fround(conductance[id] * conductanceDecay);
      if (Math.abs(current) < 0.01) { conductance[id] = 0; pending[id] = 0; continue; }
      conductance[id] = current;
      pendingNodes[pendingKept++] = id;
    }
    pendingNodes.length = pendingKept;
    for (let index = 0; index < activeNodes.length; index++) {
      const id = activeNodes[index];
      if (!present[id]) continue;
      const current = Math.fround(conductance[id] * conductanceDecay);
      conductance[id] = current;
      if (refractoryUntil[id] > tick) { activeNodes[kept++] = id; continue; }
      const membraneNoise = (uniformFromHash(neuronRandomKey[id] ^ noiseKey) - 0.5) * 0.03;
      const voltage = Math.fround(Math.max(-80, rest + (voltages[id] - rest) * membraneDecay + current * synapticIntegrationGain + membraneNoise));
      voltages[id] = voltage;
      if (voltage > threshold - motorThresholdBias[id]) fired.push(id);
      // Remove near-rest cells using finite tolerances; dormant cells consequently omit ongoing
      // membrane noise and full membrane integration.
      if (Math.abs(voltage - rest) < 0.1 && Math.abs(current) < 0.01) present[id] = 0;
      if (present[id]) activeNodes[kept++] = id;
    }
    this.activeNodes.length = kept; this.decayPlasticTraces();
    const { outOffsets, outTargets, outCounts, externalSource, plasticSlotByEdge, plasticWeights, releaseByContactCount } = this;
    const releaseKey = Math.imul((this.episodeSeed ^ tick) + 1, 277803737) ^ 1;
    const synapseCurrent = this.config.synapseCurrentMv, maxConductance = this.config.maxSynapticConductance;
    const wakeThreshold = this.config.minActivationConductance;
    for (const source of fired) {
      const sourceSlots = this.sourceSlots.get(source);
      for (const slot of sourceSlots ?? []) { this.eligibility[slot] = clamp(this.eligibility[slot] - this.config.aMinus * this.postTrace[slot], -1, 1); this.preTrace[slot] = Math.min(1, this.preTrace[slot] + 1); }
      const external = externalSource[source] !== 0;
      const sign = this.graph.sign[source] || 0;
      if (sign === 0 || (!recurrence && !external)) continue;
      const recurrentGain = external ? 1 : this.config.recurrentSynapseMultiplier;
      const sourceKey = neuronRandomKey[source] ^ releaseKey;
      for (let outgoing = outOffsets[source], end = outOffsets[source + 1]; outgoing < end; outgoing += 1) {
        const target = outTargets[outgoing]; if (refractoryUntil[target] > tick) continue;
        const contacts = outCounts[outgoing];
        // Externally stimulated sources bypass recurrent release sampling. Their input events use
        // Bernoulli draws per tick, a discrete rate approximation.
        if (!external) {
          const probability = contacts < releaseByContactCount.length ? releaseByContactCount[contacts] : 1 - Math.exp(-this.config.synapticReleasePerContact * contacts);
          if (uniformFromHash(sourceKey ^ Math.imul(outgoing + 1, 2891336453)) >= probability) continue;
        }
        const slot = plasticSlotByEdge[outgoing]; const magnitude = slot === 0 ? contacts * synapseCurrent : plasticWeights[slot - 1];
        const current = Math.fround(clamp(conductance[target] + magnitude * sign * recurrentGain, -maxConductance, maxConductance));
        conductance[target] = current;
        // Accumulate weak inputs before activating membrane integration; the wake threshold is part of
        // the numerical model and should be varied in sensitivity studies.
        if (!present[target]) {
          if (Math.abs(current) >= wakeThreshold) { present[target] = 1; pending[target] = 0; activeNodes.push(target); }
          else if (!pending[target]) { pending[target] = 1; pendingNodes.push(target); }
        }
        if (activeEdges.length < this.config.maxActiveEdgesForDisplay) activeEdges.push({ source, target, plastic: slot !== 0 });
      }
    }
    for (const target of fired) { for (const slot of this.postSlots.get(target) ?? []) { this.eligibility[slot] = clamp(this.eligibility[slot] + this.config.aPlus * this.preTrace[slot], -1, 1); this.postTrace[slot] = Math.min(1, this.postTrace[slot] + 1); } this.voltages[target] = rest; this.conductance[target] = 0; this.refractoryUntil[target] = this.tick + this.config.realRefractorySteps; }
    const sensoryKey = Math.imul(tick + 1, 2891336453) ^ episodeKey;
    for (let index = 0; index < sensoryCount; index++) {
      const id = this.sensoryIds[index], probability = this.sensoryProbability[index];
      if (probability > 0 && refractoryUntil[id] <= tick && uniformFromHash(neuronRandomKey[id] ^ sensoryKey) < probability) { voltages[id] += 68.75; this.activate(id); }
    }
    const intrinsicProbability = Math.max(0, this.config.intrinsicRateHz * this.config.dtMs / 1000);
    if (intrinsicProbability > 0) for (const id of this.intrinsicNodes) {
      if (this.refractoryUntil[id] > this.tick || deterministicUniform(id, this.tick + 0x51ed270b, this.episodeSeed) >= intrinsicProbability) continue;
      this.voltages[id] += 68.75;
      this.activate(id);
    }
    this.history.push({ tick: this.tick, ids: fired.slice() }); if (this.history.length > RECENT_HISTORY) this.history.shift();
    if (this.selectedNeuron !== null) { this.inspectorTrace.push(this.voltages[this.selectedNeuron]); if (this.inspectorTrace.length > INSPECTOR_TRACE_LENGTH) this.inspectorTrace.shift(); }
    this.tick += 1; return fired;
  }
  private activate(id: number): void { if (!this.present[id]) { this.present[id] = 1; this.pending[id] = 0; this.activeNodes.push(id); } }
  private decayPlasticTraces(): void { for (let i = 0; i < this.eligibility.length; i += 1) { this.eligibility[i] *= this.config.eligibilityDecay; this.preTrace[i] *= this.config.preTraceDecay; this.postTrace[i] *= this.config.postTraceDecay; } }
  private applyDopaminePlasticity(reward: number, eligibility: Float32Array, side: PaddleSide | null, action: PaddleAction | null): void {
    const sideBit = side === "left" ? 1 : side === "right" ? 2 : 0;
    const actionBit = side === "left"
      ? action === "up" ? 1 : action === "down" ? 2 : 0
      : side === "right"
        ? action === "up" ? 4 : action === "down" ? 8 : 0
        : 0;
    for (let i = 0; i < this.plasticWeights.length; i += 1) {
      // Restrict credit by structural reachability to the labeled side/action. Shared upstream edges
      // may belong to multiple masks; this is not proof of exclusive causal attribution.
      const mask = this.plasticActionMask[i];
      if (actionBit !== 0 ? (mask & actionBit) === 0 : sideBit !== 0 && (mask & (sideBit === 1 ? 3 : 12)) === 0) continue;
      const previous = this.plasticWeights[i];
      // Rectify eligibility for side-labeled Pong events so negative reward cannot potentiate an
      // anti-causal trace. Unlabeled experimental callers retain signed eligibility.
      const causalEligibility = side !== null ? Math.max(0, eligibility[i]) : eligibility[i];
      const updated = rewardModulatedStdp(previous, this.baseWeights[i], causalEligibility, reward, this.config);
      this.plasticWeights[i] = updated;
      const delta = updated - previous;
      if (delta !== 0) {
        this.changedWeights += 1;
        this.absoluteWeightDelta += Math.abs(delta);
        if (delta > 0) this.positiveUpdates += 1;
        else this.negativeUpdates += 1;
      }
    }
  }
  private updateMotorHomeostasis(ratesHz: [number, number, number, number]): void {
    const target = this.config.motorHomeostaticRateHz;
    for (let groupIndex = 0; groupIndex < this.graph.motorOutputs.length; groupIndex += 1) {
      const error = clamp(target - ratesHz[groupIndex], -target * 4, target);
      const delta = error * this.config.motorHomeostaticGain;
      for (const id of this.graph.motorOutputs[groupIndex]) this.motorThresholdBias[id] = clamp(this.motorThresholdBias[id] + delta, -this.config.maxMotorThresholdBias, this.config.maxMotorThresholdBias);
    }
  }
  private snapshotSelected(seconds: number) {
    if (this.selectedNeuron === null) return null; const node = this.graph.nodes[this.selectedNeuron]; if (!node) return null;
    return { id: node.id, bodyId: node.bodyId, type: node.type, population: node.population, section: node.section, position: [node.x, node.y, node.z] as [number, number, number], positionUnit: "normalized" as const, position8nm: node.position8nm, recentSpikes: this.history.filter((batch) => batch.ids.includes(node.id)).map((batch) => batch.tick), firingRateHz: populationRate(this.spikeCounts, [node.id], seconds), membraneTrace: [...this.inspectorTrace], incomingConnections: this.graph.offsets[node.id + 1] - this.graph.offsets[node.id], outgoingConnections: this.outOffsets[node.id + 1] - this.outOffsets[node.id], morphologyAvailable: node.bodyId !== "unknown" };
  }
}

/**
 * Select existing edges on sign-resolved paths from mapped photoreceptors or proprioceptors to
 * annotated motor pools.
 */
function selectSensoryMotorPlasticEdges(
  graph: RuntimeGraphData,
  outOffsets: Uint32Array,
  outTargets: Uint32Array,
  outCounts: Uint32Array,
  synapseCurrentMv = DEFAULT_BRAIN_CONFIG.synapseCurrentMv,
): Array<{ outgoingEdge: number; source: number; target: number; weight: number; actionMask: number }> {
  const sensoryDistance = boundedPathDistances(
    [...graph.visualInput, ...graph.proprioceptiveInputs.flat()], outOffsets, outTargets, graph.sign, graph.nodeCount, MAX_SENSORY_MOTOR_PATH_HOPS, false,
  );
  const motorDistances = graph.motorOutputs.map((group) => boundedPathDistances(
    group, graph.offsets, graph.sources, graph.sign, graph.nodeCount, MAX_SENSORY_MOTOR_PATH_HOPS, true,
  ));
  const selected: Array<{ outgoingEdge: number; source: number; target: number; weight: number; actionMask: number }> = [];
  let candidatesSeen = 0;
  let randomState = 0x6d2b79f5;

  // Use a deterministic reservoir to reduce prefix-selection bias under a fixed memory budget;
  // membership remains graph-order dependent.
  for (let source = 0; source < graph.nodeCount; source += 1) {
    const fromVisual = sensoryDistance[source];
    if (fromVisual < 0 || fromVisual >= MAX_SENSORY_MOTOR_PATH_HOPS || graph.sign[source] === 0) continue;
    for (let outgoing = outOffsets[source]; outgoing < outOffsets[source + 1]; outgoing += 1) {
      const target = outTargets[outgoing];
      let actionMask = 0;
      for (let group = 0; group < motorDistances.length; group += 1) {
        const toMotor = motorDistances[group][target];
        if (toMotor >= 0 && fromVisual + 1 + toMotor <= MAX_SENSORY_MOTOR_PATH_HOPS) actionMask |= 1 << group;
      }
      if (actionMask === 0) continue;
      candidatesSeen += 1;
      const candidate = {
        outgoingEdge: outgoing,
        source,
        target,
        weight: outCounts[outgoing] * synapseCurrentMv,
        actionMask,
      };
      if (selected.length < MAX_PLASTIC_SYNAPSES) {
        selected.push(candidate);
      } else {
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        const replacement = (randomState >>> 0) % candidatesSeen;
        if (replacement < MAX_PLASTIC_SYNAPSES) selected[replacement] = candidate;
      }
    }
  }
  return selected;
}

/**
 * Compute bounded directed reachability, excluding propagation from cells whose transmitter sign is
 * unresolved.
 */
function boundedPathDistances(
  starts: number[],
  offsets: Uint32Array,
  neighbors: Uint32Array,
  signs: Int8Array,
  nodeCount: number,
  maxHops: number,
  reverse: boolean,
): Int16Array {
  const distance = new Int16Array(nodeCount).fill(-1);
  const queue = new Uint32Array(nodeCount);
  let tail = 0;
  for (const start of starts) {
    if (start < 0 || start >= nodeCount || distance[start] !== -1) continue;
    distance[start] = 0;
    queue[tail++] = start;
  }
  for (let head = 0; head < tail; head += 1) {
    const node = queue[head];
    const nextDistance = distance[node] + 1;
    if (nextDistance > maxHops) continue;
    for (let edge = offsets[node]; edge < offsets[node + 1]; edge += 1) {
      const neighbor = neighbors[edge];
      const presynaptic = reverse ? neighbor : node;
      if (signs[presynaptic] === 0 || distance[neighbor] !== -1) continue;
      distance[neighbor] = nextDistance;
      queue[tail++] = neighbor;
    }
  }
  return distance;
}

function populationRate(counts: Uint32Array, ids: number[], seconds: number): number {
  if (!ids.length || seconds <= 0) return 0;
  let spikes = 0;
  for (const id of ids) spikes += counts[id] ?? 0;
  return spikes / ids.length / seconds;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicUniform(a: number, b: number, seed = 0): number {
  return uniformFromHash(Math.imul(a + 1, 747796405) ^ Math.imul(b + 1, 2891336453) ^ Math.imul(seed + 1, 277803737) ^ 1);
}

function uniformFromHash(hash: number): number {
  let value = hash >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2246822519) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}
