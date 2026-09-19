export type GameEvent = "none" | "paddle_hit" | "miss";
export type PaddleSide = "left" | "right";
/**
 * Directional credit label derived from neural antagonist activation or fallback paddle displacement.
 */
export type PaddleAction = "up" | "down";

export type BrainBackend = "test-cpu" | "malecns-cpu" | "malecns-webgpu";
export type DataStatus = "test" | "loading" | "malecns-runtime" | "error";
export type Population = "visual" | "central" | "descending" | "other";
export type AnatomicalSection = "optic" | "central" | "vnc" | "motor" | "other";

export interface BrainStepInput {
  /** Rendered-image luminance channels constitute the external visual observation. */
  retinalFrame: Float32Array;
  /**
   * Previous committed joint state provides proprioceptive feedback without exposing object
   * coordinates.
   */
  bodyFeedback?: BodyFeedback;
  reward: number;
  event: GameEvent;
  /** Paddle side assigned to a sparse teaching event; used to select structurally eligible routes. */
  eventSide?: PaddleSide | null;
  /** Directional event label; null leaves credit at the side level when a side is supplied. */
  eventAction?: PaddleAction | null;
  /**
   * Optional engineered aversive drive, supplied on misses during gameplay. The field denotes task
   * stimulation rather than a reconstructed nociceptor signal.
   */
  pain?: number;
  learning: boolean;
  recurrence: boolean;
  selectedNeuron: number | null;
  /**
   * Seed for episode-dependent stochastic state; omission uses the configured seed rather than new
   * entropy.
   */
  episodeSeed?: number;
}

export interface BodyFeedback {
  jointAnglesRad: [number, number];
  jointVelocityRad: [number, number];
}

export interface ActiveEdge {
  source: number;
  target: number;
  plastic: boolean;
}

export interface NeuronSnapshot {
  id: number;
  bodyId: string;
  type: string;
  population: Population;
  section: AnatomicalSection;
  position: [number, number, number];
  positionUnit: "normalized";
  position8nm?: [number, number, number];
  recentSpikes: number[];
  firingRateHz: number;
  membraneTrace: number[];
  incomingConnections: number;
  outgoingConnections: number;
  morphologyAvailable: boolean;
}

export interface VisualizationFrame {
  neuralTimeMs: number;
  spikes: number[];
  /** Number of distinct firing cells in the full batch before worker display subsampling. */
  uniqueSpikes?: number;
  activeEdges: ActiveEdge[];
  populationRatesHz: [number, number, number, number];
  motorRatesHz: [number, number, number, number];
  selectedNeuron: NeuronSnapshot | null;
  totalSpikes: number;
  neuralSteps: number;
  rewardEvents: number;
  plasticSynapses: number;
}

export interface BrainStepOutput extends VisualizationFrame {
  /** Committed neural duration used to advance the body and court on the same simulation clock. */
  simulatedDurationMs: number;
  learningStats?: {
    applied: number;
    expired: number;
    pending: number;
    changedWeights: number;
    absoluteWeightDelta: number;
    positiveUpdates: number;
    negativeUpdates: number;
  };
  /**
   * Spikes in the reused teaching population during a miss-stimulated batch; not distinct nociceptor
   * spikes.
   */
  painSpikes: number;
  /**
   * Arbitrary decaying visualization of miss stimulation, with no physiological concentration units.
   */
  painLevel: number;
  /** Number of batches receiving positive aversive drive since reset; normally one per miss. */
  painEvents: number;
  /**
   * Arbitrary positive display pulse reset by gated hit events; separate from signed plasticity
   * credit.
   */
  dopamineLevel: number;
  dopamineSpikes: number;
  wallTimeMs: number;
  backend: BrainBackend;
  nodeCount: number;
  edgeCount: number;
  dataStatus: DataStatus;
}

export interface GraphNode {
  id: number;
  bodyId: string;
  type: string;
  superclass?: string;
  class?: string;
  subclass?: string;
  sensoryModality?: string;
  receptorSubtype?: string;
  neurotransmitter?: string;
  motorExitNerve?: string;
  muscleTargets?: string[];
  /**
   * Normalized sensor-mapping coordinates derived from annotations or optic-column lattice, without
   * angular calibration.
   */
  retinalPosition?: [number, number];
  retinalPositionSource?: "annotation" | "optic-column-lattice";
  /** Eye laterality retained from source annotations using the supported word or letter conventions. */
  retinalEyeSide?: "left" | "right" | "L" | "R";
  population: Population;
  section: AnatomicalSection;
  side?: string;
  /**
   * Display x coordinate after centering and uniform scaling of available 8 nm source positions; y and
   * z share that transform.
   */
  x: number;
  y: number;
  z: number;
  /** Unnormalized source location retained for coordinate provenance and skeleton registration. */
  position8nm?: [number, number, number];
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
  sign?: 1 | -1;
  plastic: boolean;
}

export interface CoordinateTransform {
  sourceUnit: "8nm";
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  scale: number;
}

export interface GraphSummary {
  nodes: GraphNode[];
  displayEdges: GraphEdge[];
  visualInput: number[];
  /** Annotated motor groups ordered as left flexor, left extensor, right flexor, right extensor. */
  motorOutputs: [number[], number[], number[], number[]];
  /**
   * Annotation-matched proprioceptors pooled by side; individual receptor tuning is not reconstructed.
   */
  proprioceptiveInputs: [number[], number[]];
  /**
   * Annotation-matched dopamine cells receiving experimental teaching stimulation; graph propagation
   * still follows their assigned sign.
   */
  dopamineNeurons: number[];
  /**
   * Channel index for each mapped photoreceptor, parallel to visualInput and bounded to the binocular
   * 64-channel frame.
   */
  visualInputChannels: number[];
  interfaceAudit?: BiologicalInterfaceAudit;
  coordinateTransform?: CoordinateTransform;
  dataset?: string;
  graphEdgeCount?: number;
}

export interface TestGraph extends GraphSummary {
  nodes: GraphNode[];
  displayEdges: GraphEdge[];
  visualInput: number[];
  motorOutputs: [number[], number[], number[], number[]];
  visualInputChannels: number[];
}

export interface RuntimeGraphData extends GraphSummary {
  nodeCount: number;
  edgeCount: number;
  offsets: Uint32Array;
  sources: Uint32Array;
  counts: Uint32Array;
  /** Assumed presynaptic current polarity: positive, negative, or zero for unresolved transmission. */
  sign: Int8Array;
}

export interface BiologicalInterfaceAudit {
  vision: {
    receptorCandidates: number;
    mappedReceptors: number;
    coveredChannels: number;
    mappingBasis: "explicit-retinotopy" | "optic-column-lattice" | "soma-coordinate-proxy" | "mixed" | "unmapped";
  };
  motor: {
    annotatedMotorNeurons: number;
    mappedTibiaMotorNeurons: number;
    unmappedMotorNeurons: number;
    groups: [number, number, number, number];
    limbScope: "foreleg" | "side-tibia-pool" | "unmapped";
  };
  proprioception: {
    candidateNeurons: number;
    mappedNeurons: number;
    groups: [number, number];
  };
  reward: {
    dopamineCandidates: number;
    mappedDopamineNeurons: number;
  };
  embodiment: "left/right tibia muscle pairs → paddle vertical position";
}

export interface DataLoadProgress {
  phase: "manifest" | "metadata" | "graph" | "validating" | "ready";
  completed: number;
  total: number;
  message: string;
}

export interface WorkerStepMessage {
  type: "step";
  input: BrainStepInput;
}

export interface WorkerLoadMessage {
  type: "load";
  manifestUrl?: string;
}

export interface WorkerSelectMessage {
  type: "select";
  neuronId: number | null;
}

export interface WorkerResetMessage {
  type: "reset";
  episodeSeed?: number;
}

export type WorkerMessage = WorkerStepMessage | WorkerLoadMessage | WorkerSelectMessage | WorkerResetMessage;
