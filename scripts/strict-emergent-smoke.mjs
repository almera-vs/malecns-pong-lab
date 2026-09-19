import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { loadMaleCnsGraph } from "../src/data-loader.ts";
import { MaleCnsBrain } from "../src/brain.ts";
import { PongGame } from "../src/game.ts";
import { FlyPaddleEmbodiment, bodyStepSeconds } from "../src/fly-embodiment.ts";

const batches = Math.max(1, Number(process.argv[2] ?? 1000));
const learning = !process.argv.includes("--no-learning");
const recurrence = !process.argv.includes("--no-recurrence");
const root = new URL("../public/data/runtime/", import.meta.url);
const localBytes = (name) => readFileSync(join(root.pathname.replace(/^\/(\w):/, "$1:"), name));
globalThis.fetch = async (url) => {
  const name = basename(new URL(url).pathname);
  try { return new Response(localBytes(name)); } catch { return new Response("Not found", { status: 404 }); }
};

const graph = await loadMaleCnsGraph(() => {}, "http://local/data/runtime/manifest.json");
const brainConfig = {
  ...(process.env.MALECNS_DT_MS ? {
    dtMs: Number(process.env.MALECNS_DT_MS),
    eligibilityDecay: Math.pow(0.9999, Number(process.env.MALECNS_DT_MS) / 0.1),
    preTraceDecay: Math.pow(0.995, Number(process.env.MALECNS_DT_MS) / 0.1),
    postTraceDecay: Math.pow(0.995, Number(process.env.MALECNS_DT_MS) / 0.1),
    dopamineDecay: Math.pow(0.92, Number(process.env.MALECNS_DT_MS) / 0.1),
  } : {}),
  ...(process.env.MALECNS_SYNAPSE_MV ? { synapseCurrentMv: Number(process.env.MALECNS_SYNAPSE_MV) } : {}),
  ...(process.env.MALECNS_MIN_ACTIVATION ? { minActivationConductance: Number(process.env.MALECNS_MIN_ACTIVATION) } : {}),
  ...(process.env.MALECNS_REFRACTORY_STEPS ? { realRefractorySteps: Number(process.env.MALECNS_REFRACTORY_STEPS) } : {}),
  ...(process.env.MALECNS_RECURRENT_GAIN ? { recurrentSynapseMultiplier: Number(process.env.MALECNS_RECURRENT_GAIN) } : {}),
  ...(process.env.MALECNS_MEMBRANE_GAIN ? { membraneSynapseGain: Number(process.env.MALECNS_MEMBRANE_GAIN) } : {}),
  ...(process.env.MALECNS_RETINAL_MOTION_GAIN ? { retinalMotionGain: Number(process.env.MALECNS_RETINAL_MOTION_GAIN) } : {}),
};
const brainSeed = Number(process.env.MALECNS_SEED ?? 0x5eed1234) >>> 0;
const brain = new MaleCnsBrain(graph, { seed: brainSeed, ...brainConfig });
const initialWeights = Array.from(brain.plasticWeights ?? []);
const embodiment = new FlyPaddleEmbodiment();
const gameSeed = Number(process.env.PONG_SEED ?? 0x5eed1234) >>> 0;
const game = new PongGame(gameSeed);
const retina = new Float32Array(64);
function sampleRenderedCourt(state) {
  const frame = new Float32Array(64).fill(0.025);
  const cropWidth = 800 * 0.86;
  for (let eye = 0; eye < 2; eye += 1) for (let row = 0; row < 4; row += 1) for (let col = 0; col < 8; col += 1) {
    const x = (eye === 0 ? 0 : 800 - cropWidth) + (col + 0.5) * cropWidth / 8;
    const y = (row + 0.5) * 450 / 4;
    const ball = (x - state.ballX) ** 2 + (y - state.ballY) ** 2 < 12 ** 2;
    const leftPaddle = x >= 20 && x <= 32 && y >= state.leftY - 8 && y <= state.leftY + 98;
    const rightPaddle = x >= 768 && x <= 780 && y >= state.rightY - 8 && y <= state.rightY + 98;
    frame[eye * 32 + row * 8 + col] = ball || leftPaddle || rightPaddle ? 1 : frame[eye * 32 + row * 8 + col];
  }
  return frame;
}
const frames = [];
let body = { jointAnglesRad: [0, 0], jointVelocityRad: [0, 0] };
let pendingEvent = "none";
let pendingEventSide = null;
let pendingEventAction = null;
let pendingReward = 0;
let simulatedMs = 0;
let firstMotorBatch = -1;
let maxMotorRateHz = 0;
const maxMotorByGroup = [0, 0, 0, 0];
const maxPaddleDisplacement = [0, 0];
const eventsBySide = { left: { paddle_hit: 0, miss: 0 }, right: { paddle_hit: 0, miss: 0 } };
for (let batch = 0; batch < batches; batch += 1) {
  // Supply a point-sampled software-camera approximation and committed joint feedback. This runtime
  // smoke assay is not equivalent to the area-pooled learning benchmark.
  retina.set(sampleRenderedCourt(game.state));
  const output = brain.step({ retinalFrame: retina, bodyFeedback: { jointAnglesRad: body.jointAnglesRad, jointVelocityRad: body.jointVelocityRad }, reward: pendingReward, event: pendingEvent, eventSide: pendingEventSide, eventAction: pendingEventAction, learning, recurrence, selectedNeuron: null });
  const dt = bodyStepSeconds(output);
  simulatedMs += output.simulatedDurationMs;
  const batchMaxMotor = Math.max(...output.motorRatesHz);
  output.motorRatesHz.forEach((rate, index) => { maxMotorByGroup[index] = Math.max(maxMotorByGroup[index], rate); });
  if (batchMaxMotor > 0 && firstMotorBatch < 0) firstMotorBatch = batch;
  maxMotorRateHz = Math.max(maxMotorRateHz, batchMaxMotor);
  body = embodiment.step(output.motorRatesHz, dt, game.height, game.paddleHeight);
  maxPaddleDisplacement[0] = Math.max(maxPaddleDisplacement[0], Math.abs(body.paddleTargets[0] - 180));
  maxPaddleDisplacement[1] = Math.max(maxPaddleDisplacement[1], Math.abs(body.paddleTargets[1] - 180));
  const beforeGameStep = { ballX: game.state.ballX, ballY: game.state.ballY, leftY: game.state.leftY, rightY: game.state.rightY };
  const event = game.step(body.paddleTargets, dt, body.paddleActions);
  pendingEvent = event;
  pendingEventSide = game.eventSide;
  pendingEventAction = game.eventAction;
  pendingReward = game.reward;
  if (event !== "none") {
    if (game.eventSide) eventsBySide[game.eventSide][event] += 1;
    frames.push({ batch, event, eventSide: game.eventSide, eventAction: game.eventAction, reward: game.reward, spikes: output.totalSpikes, dopamineLevel: output.dopamineLevel, dopamineSpikes: output.dopamineSpikes, beforeGameStep, paddleTargets: body.paddleTargets, motorRatesHz: output.motorRatesHz });
  }
  if (batch % 100 === 0 || batch === batches - 1) frames.push({ batch, spikes: output.totalSpikes, motorRatesHz: output.motorRatesHz, dopamineLevel: output.dopamineLevel, leftY: game.state.leftY, rightY: game.state.rightY, score: [game.state.scoreLeft, game.state.scoreRight] });
}
const changedWeights = initialWeights.reduce((count, weight, index) => count + (brain.plasticWeights[index] !== weight ? 1 : 0), 0);
const result = { mode: "strict-emergent", camera: "legacy point-sampled smoke; not a learning-performance benchmark", simulatedMs, neuralMs: brain.tick * brain.config.dtMs, batches, learning, recurrence, nodes: graph.nodeCount, edges: graph.edgeCount, audit: graph.interfaceAudit, config: { retinalMotionGain: brain.config.retinalMotionGain, retinalAdaptationTauMs: brain.config.retinalAdaptationTauMs }, firstMotorBatch, maxMotorRateHz, maxMotorByGroup, maxPaddleDisplacement, rewardEvents: brain.rewardEvents ?? 0, eventsBySide, changedWeights, final: frames.at(-1), moved: game.state.leftY !== 180 || game.state.rightY !== 180, score: [game.state.scoreLeft, game.state.scoreRight], frames };
const folder = "experiments/runs";
mkdirSync(folder, { recursive: true });
const path = join(folder, `strict-emergent-${learning ? "learning" : "fixed"}-${recurrence ? "recurrent" : "no-recurrence"}-${Date.now()}.json`);
writeFileSync(path, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, output: path }, null, 2));
