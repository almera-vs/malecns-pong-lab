import "./style.css";
import { GamePresentation, PongGame } from "./game";
import { bodyStepSeconds, FlyPaddleEmbodiment, type EmbodimentFrame } from "./fly-embodiment";
import { SpikeRaster, MAX_ACTIVITY_MARKERS } from "./activity-display";
import { probeWebGpu } from "./brain-gpu";
import { drawRetina, encodeBinocularRetina } from "./retina";
import { ConnectomeView, type PopulationFilters } from "./visualization";
import { FlyBodyView } from "./fly-view";
import type { BrainStepOutput, GameEvent, GraphNode, GraphSummary, NeuronSnapshot, PaddleAction, PaddleSide } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing");

app.innerHTML = `
  <header class="topbar">
    <div><span class="eyebrow">CONNECTOME EXPERIMENT</span><h1>MaleCNS Pong Lab</h1><p>One persistent neural network · binocular vision and body feedback · live anatomical activity</p></div>
    <div class="status-pill" id="data-status">Loading normal MaleCNS brain…</div>
  </header>
  <section class="controls" aria-label="Experiment controls">
    <button id="pause">Resume</button>
    <button id="retry-brain" hidden>Retry brain download</button>
    <button id="reset-game">Reset game</button>
    <button id="reset-brain">Reset brain</button>
    <button id="download-log">Download run log</button>
    <span class="mode-badge">dopamine learning + recurrence: always on</span>
    <span id="timing">neural 0 ms · wall 0 ms · ratio 0.00×</span>
  </section>
  <section class="workspace">
    <article class="card game-card">
      <div class="card-heading"><h2>Pong court and retina</h2><span id="score">0 : 0</span></div>
      <canvas id="game" width="800" height="450" aria-label="Rendered Pong court"></canvas>
      <div class="vision-wrap"><div class="vision-label"><span>Binocular camera → receptor map</span><span>Left / right court crops · 64 luminance channels (computer sensor)</span></div><canvas id="retina" width="800" height="340" aria-label="Binocular camera preview"></canvas></div>
      <div class="game-meta"><span id="event">event: none</span><span id="rally">rally: 0</span><span id="reward">reward: 0</span><span id="backend">backend: loading</span></div>
    </article>
    <article class="card brain-card">
      <div class="card-heading"><h2>Persistent 2D brain section</h2><span id="brain-label">Loading annotated MaleCNS soma locations…</span></div>
      <div id="brain-view" aria-label="Persistent 2D MaleCNS anatomical section with region-colored neurons"></div>
      <div class="brain-legend"><span><i class="legend-dot optic"></i>optic lobe</span><span><i class="legend-dot central"></i>central brain</span><span><i class="legend-dot vnc"></i>nerve cord</span><span><i class="legend-dot motor"></i>descending/motor</span><span><i class="legend-dot fired"></i>sampled activity</span></div>
      <div class="filters" aria-label="Population filters"><span>show:</span><label><input data-pop="visual" type="checkbox" checked> optic</label><label><input data-pop="central" type="checkbox" checked> central</label><label><input data-pop="descending" type="checkbox" checked> descending</label><label><input data-pop="other" type="checkbox" checked> other</label></div>
      <div id="neuron" class="inspector-empty">Select a neuron to inspect its identity, activity, connections, and morphology.</div>
      <div class="fly-model-wrap"><div class="fly-model-label"><span>Fruit fly · 3D</span><span>Live forelegs · full joint range</span></div><canvas id="fly-model" width="640" height="320" aria-label="Detailed 3D fruit fly facing the viewer at 45 degrees with front legs driven by neural activity"></canvas></div>
    </article>
  </section>
  <section class="lower-grid">
    <article class="card">
      <div class="card-heading"><h2>Activity inspector</h2><span id="neural-time">t = 0 ms</span></div>
      <div class="metrics"><div><small>optic firing</small><strong id="visual-rate">0.0 Hz</strong></div><div><small>central firing</small><strong id="central-rate">0.0 Hz</strong></div><div><small>descending firing</small><strong id="motor-rate">0.0 Hz</strong></div><div><small>unique spikes</small><strong id="spike-count">0</strong></div></div>
      <canvas id="raster" width="900" height="210" aria-label="Neural spike raster"></canvas>
      <div class="trace-heading"><span>selected membrane/activity trace</span><span id="trace-label">none</span></div>
      <canvas id="trace" width="900" height="130" aria-label="Selected neuron membrane trace"></canvas>
      <p class="muted">Rates include every spike. The raster bins all firing neurons by screen column; the anatomy overlay shows up to 2,048 activity markers. Court animation interpolates completed game states; neural and game time advance only after worker batches.</p>
    </article>
    <article class="card">
      <div class="card-heading"><h2>Run status</h2></div>
      <ul class="status-list"><li id="input-status">Vision: waiting for annotated photoreceptors and retinotopy</li><li id="plastic-status">Learning: dopamine-gated STDP through annotated reward neurons</li><li id="motor-status">Movement: waiting for annotated motor-neuron → muscle paths</li><li id="asset-status">Biological runtime assets: loading MaleCNS v1.0…</li><li id="gpu-status">WebGPU: probing capability…</li><li id="event-status">Reward events: 0</li><li id="log-status">Run log: collecting frame metrics</li></ul>
      <p id="activity-summary" class="activity-summary">Waiting for the first neural batch.</p>
      <a href="https://male-cns.janelia.org/download/" target="_blank" rel="noreferrer">MaleCNS download documentation ↗</a>
    </article>
  </section>
  <footer>Connectome edges and cell annotations are biological observations; retinal field projection and left/right limb-to-paddle mechanics are explicit computer-embodiment assumptions.</footer>`;

const gameCanvas = required<HTMLCanvasElement>("game");
const retinaCanvas = required<HTMLCanvasElement>("retina");
const rasterCanvas = required<HTMLCanvasElement>("raster");
const traceCanvas = required<HTMLCanvasElement>("trace");
let lastEpisodeSeed = -1;
function freshEpisodeSeed(): number {
  const values = new Uint32Array(1);
  let seed = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(values)[0]
    : (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
  if (seed === lastEpisodeSeed) seed = (seed + 1) >>> 0;
  lastEpisodeSeed = seed;
  return seed;
}
let episodeSeed = freshEpisodeSeed();
const game = new PongGame(episodeSeed);
const presentation = new GamePresentation(game.state);
const embodiment = new FlyPaddleEmbodiment();
const flyView = new FlyBodyView(required<HTMLCanvasElement>("fly-model"));
let latestEmbodiment: EmbodimentFrame | null = null;
const sensoryCanvas = document.createElement("canvas");
sensoryCanvas.width = game.width;
sensoryCanvas.height = game.height;
// Sample a dedicated committed-state canvas to keep animation interpolation out of the sensory
// measurement.
sensoryCanvas.getContext("2d", { willReadFrequently: true });
const raster = new SpikeRaster(rasterCanvas);
let worker: Worker;
const emptyGraph: GraphSummary = { nodes: [], displayEdges: [], visualInput: [], visualInputChannels: [], motorOutputs: [[], [], [], []], proprioceptiveInputs: [[], []], dopamineNeurons: [], dataset: "loading" };
const view = new ConnectomeView(required<HTMLElement>("brain-view"), emptyGraph, (id, node) => {
  selectedId = id;
  selectedNode = node;
  worker.postMessage({ type: "select", neuronId: id });
  setSelectedText(null, node);
});

let paused = false;
let pending = false;
let loading = true;
let brainReady = false;
let lastEvent: GameEvent = "none";
let lastEventSide: PaddleSide | null = null;
let lastEventAction: PaddleAction | null = null;
let lastReward = 0;
let appliedEvent: GameEvent = "none";
let appliedEventSide: PaddleSide | null = null;
let appliedEventAction: PaddleAction | null = null;
let appliedReward = 0;
let selectedId: number | null = null;
let selectedNode: GraphNode | null = null;
let selectedSnapshot: NeuronSnapshot | null = null;
let latestFrame: BrainStepOutput | null = null;
let interfaceAudit: GraphSummary["interfaceAudit"] | null = null;
let lastMonitorPaint = -Infinity;
let lastRetinaPaint = -Infinity;
let lastLabelsAt = -Infinity;
let stepSentAt = 0;
let resettingBrain = false;
let discardPendingStep = false;
const profile = { workerMs: 0, viewMs: 0, rasterMs: 0, retinaMs: 0, batchMs: 0, spikes: 0, displayedSpikes: 0, animationFps: 0,
  motorRatesHz: [0, 0, 0, 0], jointAnglesRad: [0, 0], muscleActivation: [0, 0, 0, 0], paddleTargets: [180, 180],
  dopamineLevel: 0,
};
let fpsStarted = performance.now();
let animationFrames = 0;
const runLog = {
  schemaVersion: 5,
  startedAt: new Date().toISOString(),
  seed: `0x${episodeSeed.toString(16).padStart(8, "0")}`,
  userAgent: navigator.userAgent,
  hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
  frames: [] as Array<Record<string, unknown>>,
};

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}

function setStatus(message: string): void {
  required<HTMLElement>("data-status").textContent = message;
}

function setPauseLabel(): void {
  const button = required<HTMLButtonElement>("pause");
  button.textContent = loading ? "Loading brain…" : paused ? "Resume" : "Pause";
  button.disabled = !brainReady;
  required<HTMLButtonElement>("reset-brain").disabled = !brainReady;
}

/** Update presentation without advancing the neural, body, or environment clocks. */
function renderScene(now: number): void {
  game.render(gameCanvas, presentation.sample(now));
  animationFrames++;
  if (now - fpsStarted >= 1000) {
    profile.animationFps = Math.round(animationFrames * 1000 / (now - fpsStarted));
    animationFrames = 0;
    fpsStarted = now;
  }
  if (latestFrame && now - lastMonitorPaint >= 1000 / 30) {
    const started = performance.now();
    view.update(latestFrame);
    profile.viewMs = performance.now() - started;
    profile.displayedSpikes = Math.min(latestFrame.spikes.length, MAX_ACTIVITY_MARKERS);
    latestFrame = null;
    lastMonitorPaint = now;
  }
  if (!paused && !document.hidden) flyView.render(now);
  required<HTMLElement>("timing").setAttribute("data-profile", JSON.stringify(profile));
  requestAnimationFrame(renderScene);
}

function drawTrace(values: number[]): void {
  const context = traceCanvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#07101d";
  context.fillRect(0, 0, traceCanvas.width, traceCanvas.height);
  context.strokeStyle = "#67e8f9";
  context.lineWidth = 1.5;
  context.beginPath();
  values.forEach((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * traceCanvas.width;
    const normalized = Math.max(0, Math.min(1, (value + 70) / 72));
    const y = traceCanvas.height - normalized * (traceCanvas.height - 12) - 6;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

function setSelectedText(snapshot: NeuronSnapshot | null, node: GraphNode | null): void {
  const target = required<HTMLElement>("neuron");
  if (!snapshot && !node) {
    target.textContent = "Select a neuron to inspect its identity, activity, connections, and morphology.";
    required<HTMLElement>("trace-label").textContent = "none";
    drawTrace([]);
    return;
  }
  const data = snapshot;
  const source = node ?? selectedNode;
  if (!source) return;
  const position = data?.position ?? [source.x, source.y, source.z];
  const rawPosition = data?.position8nm ? ` · EM position 8nm (${data.position8nm.map((value) => value.toFixed(1)).join(", ")})` : "";
  target.innerHTML = `<strong>${escapeHtml(data?.bodyId ?? source.bodyId)}</strong> · ${escapeHtml(data?.type ?? source.type)} · ${source.section}<br>normalized position (${position.map((value) => value.toFixed(3)).join(", ")})${rawPosition} · firing ${(data?.firingRateHz ?? 0).toFixed(1)} Hz · recent spikes ${(data?.recentSpikes.length ?? 0)}<br>incoming ${data?.incomingConnections ?? "…"} · outgoing ${data?.outgoingConnections ?? "…"} · ${data?.morphologyAvailable ? "SWC available" : "SWC unavailable"}`;
  required<HTMLElement>("trace-label").textContent = data ? `${data.bodyId} · ${data.membraneTrace.length} samples` : "waiting for neural sample";
  drawTrace(data?.membraneTrace ?? []);
}

function updateLabels(output: BrainStepOutput): void {
  const uniqueSpikes = output.uniqueSpikes ?? output.spikes.length;
  runLog.frames.push({ episodeSeed, neuralTimeMs: output.neuralTimeMs, wallTimeMs: output.wallTimeMs, neuralSteps: output.neuralSteps, scoreLeft: game.state.scoreLeft, scoreRight: game.state.scoreRight, rally: game.state.rally, hits: game.state.hits, misses: game.state.misses, eventApplied: appliedEvent, eventSideApplied: appliedEventSide, eventActionApplied: appliedEventAction, rewardApplied: appliedReward, nextGameEvent: lastEvent, nextGameEventSide: lastEventSide, nextGameEventAction: lastEventAction, totalSpikes: output.totalSpikes, uniqueSpikes, motorRatesHz: output.motorRatesHz, muscleActivation: latestEmbodiment?.muscleActivation ?? null, jointAnglesRad: latestEmbodiment?.jointAnglesRad ?? null, paddleTargets: latestEmbodiment?.paddleTargets ?? null, backend: output.backend, learning: true, recurrence: true });
  // Record each committed batch before throttling labels, preserving temporal observations
  // independently of UI refresh rate.
  Object.assign(runLog.frames[runLog.frames.length - 1], { simulatedDurationMs: output.simulatedDurationMs, bodyStepMs: output.simulatedDurationMs, learningStats: output.learningStats, dopamineLevel: output.dopamineLevel, dopamineSpikes: output.dopamineSpikes, painLevel: output.painLevel, painSpikes: output.painSpikes, painEvents: output.painEvents, jointVelocityRad: latestEmbodiment?.jointVelocityRad ?? null });
  const now = performance.now();
  if (now - lastLabelsAt < 150 && lastEvent === "none" && !paused && !document.hidden) return;
  lastLabelsAt = now;
  const ratio = output.wallTimeMs > 0 ? output.simulatedDurationMs / output.wallTimeMs : 0;
  required<HTMLElement>("score").textContent = `${game.state.scoreLeft} : ${game.state.scoreRight}`;
  required<HTMLElement>("rally").textContent = `rally: ${game.state.rally}`;
  required<HTMLElement>("event").textContent = `event: ${lastEvent}`;
  required<HTMLElement>("reward").textContent = `reward next batch: ${lastReward >= 0 ? "+" : ""}${lastReward.toFixed(2)}`;
  required<HTMLElement>("timing").textContent = `neural ${output.neuralTimeMs.toFixed(1)} ms · wall ${output.wallTimeMs.toFixed(1)} ms · ratio ${ratio.toFixed(2)}× · ${output.simulatedDurationMs / output.neuralSteps} ms/tick`;
  required<HTMLElement>("neural-time").textContent = `t = ${output.neuralTimeMs.toFixed(1)} ms`;
  required<HTMLElement>("backend").textContent = `backend: ${output.backend}`;
  required<HTMLElement>("spike-count").textContent = uniqueSpikes.toLocaleString();
  required<HTMLElement>("visual-rate").textContent = `${output.populationRatesHz[0].toFixed(1)} Hz`;
  required<HTMLElement>("central-rate").textContent = `${output.populationRatesHz[1].toFixed(1)} Hz`;
  required<HTMLElement>("motor-rate").textContent = `${output.populationRatesHz[2].toFixed(1)} Hz`;
  required<HTMLElement>("event-status").textContent = `Contacts: ${game.state.hits} · misses: ${game.state.misses} · pain events: ${output.painEvents} · current pulse: ${output.painSpikes} · reward events: ${output.rewardEvents} · plastic mask: ${output.plasticSynapses.toLocaleString()} synapses`;
  const learning = output.learningStats;
  required<HTMLElement>("plastic-status").textContent = `Dopamine-gated STDP · events ${learning?.applied ?? 0} · changed synapses ${learning?.changedWeights ?? 0} · |Δw| ${(learning?.absoluteWeightDelta ?? 0).toFixed(3)} · +${learning?.positiveUpdates ?? 0}/-${learning?.negativeUpdates ?? 0} · pending ${learning?.pending ?? 0}`;
  const jointAngles = latestEmbodiment?.jointAnglesRad.map((angle) => `${(angle * 180 / Math.PI).toFixed(1)}°`).join("/") ?? "—";
  required<HTMLElement>("activity-summary").textContent = `${output.totalSpikes.toLocaleString()} spikes in ${output.neuralSteps} neural steps · ${uniqueSpikes.toLocaleString()} unique neurons · tibia muscle rates L-flex/ext, R-flex/ext: ${output.motorRatesHz.map((rate) => rate.toFixed(1)).join("/")} Hz · joint angles ${jointAngles}`;
  required<HTMLElement>("log-status").textContent = `Run log: ${runLog.frames.length.toLocaleString()} frames · download JSON for reproducibility`;
  if (interfaceAudit?.motor.mappedTibiaMotorNeurons) {
    const scope = interfaceAudit.motor.limbScope === "foreleg" ? "foreleg" : "side-specific tibia pools (limb segment unavailable)";
    required<HTMLElement>("motor-status").textContent = `Annotated ${scope} → muscle activation → joint angle → paddle · pools L-flex/ext, R-flex/ext ${interfaceAudit?.motor.groups.join("/") ?? "—"} · L/R angles ${latestEmbodiment?.jointAnglesRad.map((angle) => `${(angle * 180 / Math.PI).toFixed(1)}°`).join("/")}`;
  } else {
    required<HTMLElement>("motor-status").textContent = "Paddles held at neutral: this runtime has no annotated left/right tibia flexor/extensor motor units";
  }
  if (output.selectedNeuron) {
    selectedSnapshot = output.selectedNeuron;
    setSelectedText(output.selectedNeuron, selectedNode);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function sendStep(): void {
  if (paused || pending || resettingBrain || loading || !brainReady || document.hidden) return;
  pending = true;
  const started = performance.now();
  game.render(sensoryCanvas);
  const retina = encodeBinocularRetina(sensoryCanvas);
  const now = performance.now();
  if (now - lastRetinaPaint >= 1000 / 30) {
    drawRetina(retinaCanvas, retina, sensoryCanvas);
    lastRetinaPaint = now;
  }
  profile.retinaMs = performance.now() - started;
  stepSentAt = performance.now();
  const reward = lastReward;
  appliedEvent = lastEvent;
  appliedEventSide = lastEventSide;
  appliedEventAction = lastEventAction;
  appliedReward = reward;
  worker.postMessage({
    type: "step",
    input: {
      retinalFrame: retina,
      bodyFeedback: {
        jointAnglesRad: latestEmbodiment?.jointAnglesRad ?? [0, 0],
        jointVelocityRad: latestEmbodiment?.jointVelocityRad ?? [0, 0],
      },
      reward,
      event: lastEvent,
      eventSide: lastEventSide,
      eventAction: lastEventAction,
      // Transmit an explicit miss consequence to the teaching gateway. Its action label is an
      // experimental attribution rule, not a measured causal neural pathway.
      pain: game.pain,
      // Keep recurrence and plasticity active in the interactive condition; controlled ablations are
      // performed by offline runners.
      learning: true,
      recurrence: true,
      selectedNeuron: selectedId,
      episodeSeed,
    },
  }, [retina.buffer]);
  lastEvent = "none";
  lastEventSide = null;
  lastEventAction = null;
  lastReward = 0;
}

function handleReady(data: { graph: GraphSummary; nodeCount: number; edgeCount: number; plasticSynapses: number; backend: string }): void {
  view.setGraph(data.graph);
  raster.setGraph(data.graph.nodes);
  const located = data.graph.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.z)).length;
  setStatus(`MaleCNS ready · ${data.nodeCount.toLocaleString()} neurons · strict emergent mode`);
  required<HTMLElement>("brain-label").textContent = `${data.nodeCount.toLocaleString()} neurons · ${located.toLocaleString()} known soma positions · click a soma`;
  required<HTMLElement>("asset-status").textContent = `MaleCNS v1.0 runtime loaded · ${data.edgeCount.toLocaleString()} edges · STDP mask ${data.plasticSynapses.toLocaleString()}`;
  required<HTMLElement>("backend").textContent = `backend: ${data.backend}`;
  const audit = data.graph.interfaceAudit;
  interfaceAudit = audit ?? null;
  if (audit) {
    const basis = audit.vision.mappingBasis === "soma-coordinate-proxy" ? "soma-coordinate retinotopy proxy" : audit.vision.mappingBasis === "mixed" ? "explicit fields + soma-coordinate proxy" : audit.vision.mappingBasis;
    required<HTMLElement>("input-status").textContent = `Vision map: ${audit.vision.mappedReceptors.toLocaleString()}/${audit.vision.receptorCandidates.toLocaleString()} annotated photoreceptors · ${audit.vision.coveredChannels}/64 channels · ${basis} · proprioceptors L/R ${audit.proprioception.groups.join("/")}`;
    const scope = audit.motor.limbScope === "foreleg" ? "foreleg" : audit.motor.limbScope === "side-tibia-pool" ? "side-specific tibia pools; limb segment unavailable" : "no resolvable limb";
    required<HTMLElement>("motor-status").textContent = `Motor map: ${audit.motor.mappedTibiaMotorNeurons.toLocaleString()} tibia MNs (${scope}) → flexor/extensor groups · ${audit.motor.unmappedMotorNeurons.toLocaleString()} other motor cells remain unmapped · dopamine ${audit.reward.mappedDopamineNeurons.toLocaleString()}`;
  } else {
    required<HTMLElement>("input-status").textContent = "Vision map unavailable: runtime lacks photoreceptor annotations";
    required<HTMLElement>("motor-status").textContent = "Motor map unavailable: runtime lacks motor-neuron muscle-target annotations";
  }
  loading = false;
  brainReady = true;
  setPauseLabel();
  sendStep();
}

function handleWorkerMessage(event: MessageEvent<any>): void {
  const data = event.data;
  if (data.type === "progress") {
    const progress = data.progress;
    setStatus(progress.message);
    required<HTMLElement>("asset-status").textContent = progress.message;
    return;
  }
  if (data.type === "ready") {
    handleReady(data);
    return;
  }
  if (data.type === "selected") {
    selectedSnapshot = data.inspector;
    setSelectedText(selectedSnapshot, selectedNode);
    return;
  }
  if (data.type === "error") {
    failBrain(data.message);
    return;
  }
  if (data.type === "reset") {
    pending = false;
    resettingBrain = false;
    lastLabelsAt = -Infinity;
    latestFrame = null;
    embodiment.reset();
    flyView.reset();
    latestEmbodiment = null;
    raster.clear();
    selectedSnapshot = null;
    setSelectedText(null, selectedNode);
    setStatus("MaleCNS brain reset");
    sendStep();
    return;
  }
  if (data.type !== "step") return;
  pending = false;
  if (resettingBrain) return;
  if (discardPendingStep) {
    discardPendingStep = false;
    sendStep();
    return;
  }
  const output = data.output as BrainStepOutput;
  const now = performance.now();
  profile.batchMs = now - stepSentAt;
  profile.workerMs = output.wallTimeMs;
  profile.spikes = output.uniqueSpikes ?? output.spikes.length;
  profile.motorRatesHz = output.motorRatesHz;
  profile.dopamineLevel = output.dopamineLevel;
  const dtSeconds = bodyStepSeconds(output);
  latestEmbodiment = embodiment.step(output.motorRatesHz, dtSeconds, game.height, game.paddleHeight);
  flyView.update(output.motorRatesHz, latestEmbodiment);
  profile.jointAnglesRad = latestEmbodiment.jointAnglesRad;
  profile.muscleActivation = latestEmbodiment.muscleActivation;
  profile.paddleTargets = latestEmbodiment.paddleTargets;
  lastEvent = game.step(latestEmbodiment.paddleTargets, dtSeconds, latestEmbodiment.paddleActions);
  lastEventSide = game.eventSide;
  lastEventAction = game.eventAction;
  lastReward = game.reward;
  if (paused || document.hidden) presentation.reset(game.state);
  else presentation.commit(game.state, now, profile.batchMs);
  latestFrame = output;
  const rasterStart = performance.now();
  raster.append(output.spikes, output.nodeCount);
  profile.rasterMs = performance.now() - rasterStart;
  updateLabels(output);
  // Request the next neural batch independently of display refresh to separate computation throughput
  // from presentation timing.
  sendStep();
}

function failBrain(message: string): void {
  worker?.terminate();
  pending = false;
  loading = false;
  brainReady = false;
  paused = true;
  setPauseLabel();
  setStatus(`Brain unavailable · ${message}`);
  required<HTMLElement>("asset-status").textContent = message;
  required<HTMLButtonElement>("retry-brain").hidden = false;
}

function startBrain(): void {
  worker?.terminate();
  embodiment.reset();
  flyView.reset();
  latestEmbodiment = null;
  pending = false;
  loading = true;
  brainReady = false;
  paused = false;
  selectedId = null;
  selectedNode = null;
  selectedSnapshot = null;
  lastEvent = "none";
  lastEventSide = null;
  lastEventAction = null;
  lastReward = 0;
  resettingBrain = false;
  discardPendingStep = false;
  latestFrame = null;
  lastLabelsAt = -Infinity;
  raster.clear();
  presentation.reset(game.state);
  view.setGraph(emptyGraph);
  setSelectedText(null, null);
  required<HTMLButtonElement>("retry-brain").hidden = true;
  setPauseLabel();
  setStatus("Loading strict local MaleCNS brain…");
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      event.preventDefault();
      failBrain(event.message || "The brain worker failed to start. Retry the download.");
    };
    worker.onmessageerror = () => failBrain("Could not read the brain worker response. Retry the download.");
    worker.postMessage({ type: "load", manifestUrl: new URL("./data/runtime/manifest.json", document.baseURI).toString() });
  } catch (error) {
    failBrain(error instanceof Error ? error.message : String(error));
  }
}

required<HTMLButtonElement>("pause").addEventListener("click", () => {
  paused = !paused;
  setPauseLabel();
  if (!paused) sendStep();
  else presentation.reset(game.state);
});
required<HTMLButtonElement>("retry-brain").addEventListener("click", startBrain);
required<HTMLButtonElement>("reset-game").addEventListener("click", () => {
  episodeSeed = freshEpisodeSeed();
  game.reset(episodeSeed);
  embodiment.reset();
  flyView.reset();
  latestEmbodiment = null;
  presentation.reset(game.state);
  discardPendingStep = pending;
  lastEvent = "none";
  lastEventSide = null;
  lastEventAction = null;
  lastReward = 0;
  game.render(sensoryCanvas);
  drawRetina(retinaCanvas, encodeBinocularRetina(sensoryCanvas), sensoryCanvas);
});
required<HTMLButtonElement>("reset-brain").addEventListener("click", () => {
  episodeSeed = freshEpisodeSeed();
  game.reset(episodeSeed);
  embodiment.reset();
  flyView.reset();
  latestEmbodiment = null;
  presentation.reset(game.state);
  resettingBrain = true;
  discardPendingStep = false;
  worker.postMessage({ type: "reset", episodeSeed });
});
required<HTMLButtonElement>("download-log").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(runLog, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `malecns-pong-run-${runLog.startedAt.replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});
document.querySelectorAll<HTMLInputElement>("input[data-pop]").forEach((input) => input.addEventListener("change", () => {
  const filters: Partial<PopulationFilters> = { [input.dataset.pop as keyof PopulationFilters]: input.checked };
  view.setFilters(filters);
}));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) sendStep();
});

probeWebGpu().then((status) => { required<HTMLElement>("gpu-status").textContent = `WebGPU: ${status.message}`; });
drawTrace([]);
game.render(gameCanvas);
game.render(sensoryCanvas);
drawRetina(retinaCanvas, encodeBinocularRetina(sensoryCanvas), sensoryCanvas);
requestAnimationFrame(renderScene);
startBrain();
