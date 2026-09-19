import { MaleCnsBrain } from "./brain";
import { loadMaleCnsGraph } from "./data-loader";
import type { BrainStepInput, BrainStepOutput, DataLoadProgress, GraphSummary, WorkerMessage } from "./types";

let brain: MaleCnsBrain | null = null;
let loadPromise: Promise<void> | null = null;
// Transmit at most 512 display spike IDs while retaining complete batch counts and internal learning
// state. The browser raster is therefore a sampled activity view.
const MAX_DISPLAY_SPIKES = 512;

function displaySpikes(spikes: readonly number[]): number[] {
  if (spikes.length <= MAX_DISPLAY_SPIKES) return [...spikes];
  const stride = spikes.length / MAX_DISPLAY_SPIKES;
  return Array.from({ length: MAX_DISPLAY_SPIKES }, (_, index) => spikes[Math.floor(index * stride)]);
}

async function loadBrain(manifestUrl?: string): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    self.postMessage({ type: "progress", progress: { phase: "manifest", completed: 0, total: 1, message: "Starting strict local MaleCNS loader…" } });
    const onProgress = (progress: DataLoadProgress) => self.postMessage({ type: "progress", progress });
    const runtime = await loadMaleCnsGraph(onProgress, manifestUrl);
    brain = new MaleCnsBrain(runtime);
    const graph: GraphSummary = {
      nodes: runtime.nodes,
      displayEdges: runtime.displayEdges,
      visualInput: runtime.visualInput,
      visualInputChannels: runtime.visualInputChannels,
      motorOutputs: runtime.motorOutputs,
      proprioceptiveInputs: runtime.proprioceptiveInputs,
      dopamineNeurons: runtime.dopamineNeurons,
      interfaceAudit: runtime.interfaceAudit,
      coordinateTransform: runtime.coordinateTransform,
      dataset: runtime.dataset,
      graphEdgeCount: runtime.graphEdgeCount,
    };
    self.postMessage({ type: "ready", graph, backend: brain.backend, nodeCount: runtime.nodeCount, edgeCount: runtime.edgeCount, plasticSynapses: brain.eligibility.length });
  })();
  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    throw error;
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === "reset") {
      if (!brain) return;
      brain.reset(event.data.episodeSeed);
      self.postMessage({ type: "reset", nodeCount: brain.graph.nodes.length, dataStatus: brain.dataStatus });
      return;
    }
    if (event.data.type === "select") {
      if (!brain) return;
      brain.setSelectedNeuron(event.data.neuronId);
      self.postMessage({ type: "selected", inspector: brain.getSelectedSnapshot() });
      return;
    }
    if (event.data.type === "load") {
      await loadBrain(event.data.manifestUrl);
      return;
    }
    if (!brain) return;
    const input: BrainStepInput = event.data.input;
    const output: BrainStepOutput = brain.step(input);
    self.postMessage({ type: "step", output: { ...output, spikes: displaySpikes(output.spikes) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: "error", message });
  }
};
