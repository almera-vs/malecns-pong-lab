import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNative } from "./build-native.mjs";

// Build a fresh application fixture to avoid dependence on stale artifacts or Vite filename hashing.
const output = mkdtempSync(join(tmpdir(), "malecns-display-"));
const outputUrl = pathToFileURL(output + sep);
after(() => {
  assert.ok(resolve(output).startsWith(resolve(tmpdir()) + sep));
  rmSync(output, { recursive: true, force: true });
});
buildNative(outputUrl);
const { poolBinocularLuminance, encodeBinocularRetina, drawRetina } = await import(new URL("retina.js", outputUrl));
const { MAX_ACTIVITY_MARKERS, MAX_ACTIVITY_EDGES, sampleActivity, SpikeRaster } = await import(new URL("activity-display.js", outputUrl));
const { ConnectomeView } = await import(new URL("visualization.js", outputUrl));
const { PongGame, GamePresentation } = await import(new URL("game.js", outputUrl));
const { FlyPaddleEmbodiment } = await import(new URL("fly-embodiment.js", outputUrl));
const { MaleCnsBrain, makeTestGraph } = await import(new URL("brain.js", outputUrl));

function pixels(width, height, rgb = [0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return data;
}

test("retina preserves uniform luminance and every sub-channel bright pixel", () => {
  const width = 80, height = 44;
  const white = poolBinocularLuminance(pixels(width, height, [255, 255, 255]), width, height);
  assert.ok(white.every((v) => Math.abs(v - 1) < 1e-6));
  const gray = poolBinocularLuminance(pixels(width, height, [128, 128, 128]), width, height);
  assert.ok(gray.every((v) => Math.abs(v - 128 / 255) < 1e-6));
  const area = width * 0.86 * height / 32;
  for (let x = 0; x < width; x++) {
    const image = pixels(width, height);
    image.set([255, 255, 255, 255], (22 * width + x) * 4);
    const frame = poolBinocularLuminance(image, width, height);
    const sum = (eye) => frame.slice(eye * 32, eye * 32 + 32).reduce((a, b) => a + b, 0) * area;
    const leftCoverage = Math.max(0, Math.min(x + 1, width * 0.86) - x);
    const rightCoverage = Math.max(0, x + 1 - Math.max(x, width * 0.14));
    assert.ok(Math.abs(sum(0) - leftCoverage) < 1e-6, `left eye pixel ${x}`);
    assert.ok(Math.abs(sum(1) - rightCoverage) < 1e-6, `right eye pixel ${x}`);
  }
});

test("retina pooling agrees with independently weighted RGB rectangles", () => {
  const width = 17, height = 13;
  const image = pixels(width, height);
  for (let i = 0; i < image.length; i++) if (i % 4 !== 3) image[i] = (i * 73 + 19) % 256;
  const frame = poolBinocularLuminance(image, width, height);
  for (let eye = 0; eye < 2; eye++) for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
    const cellWidth = width * 0.86 / 8, cellHeight = height / 4;
    const x0 = eye * width * 0.14 + col * cellWidth, y0 = row * cellHeight;
    let expected = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const coverage = Math.max(0, Math.min(x + 1, x0 + cellWidth) - Math.max(x, x0)) * Math.max(0, Math.min(y + 1, y0 + cellHeight) - Math.max(y, y0));
      const p = (y * width + x) * 4;
      expected += coverage * (0.2126 * image[p] + 0.7152 * image[p + 1] + 0.0722 * image[p + 2]) / 255;
    }
    assert.ok(Math.abs(frame[eye * 32 + row * 8 + col] - expected / cellWidth / cellHeight) < 1e-6);
  }
});

test("eye preview draws both actual eye crops without changing neural values", () => {
  let image = pixels(80, 44);
  image.set([255, 255, 255, 255], (22 * 80 + 40) * 4);
  const source = { width: 80, height: 44, getContext: () => ({ getImageData: () => ({ data: image }) }) };
  const frame = encodeBinocularRetina(source);
  const original = frame.slice();
  const draws = [], labels = [];
  const context = { fillRect() {}, fillText: (label) => labels.push(label), drawImage: (...args) => draws.push(args) };
  drawRetina({ width: 800, height: 340, getContext: () => context, setAttribute() {} }, frame, source);
  assert.equal(draws.length, 2);
  assert.equal(draws[0][0], source);
  assert.equal(draws[1][0], source);
  assert.equal(draws[0][1], 0);
  assert.ok(draws[1][1] > 0);
  assert.ok(labels.some((v) => v.startsWith("LEFT")) && labels.some((v) => v.startsWith("RIGHT")));
  assert.deepEqual(frame, original);
  image = pixels(80, 44);
  assert.ok(encodeBinocularRetina(source).every((v) => v === 0), "reused integral does not retain stale pixels");
});

function fakeCanvas() {
  const calls = { fillRect: 0, drawImage: 0, arc: 0, stroke: 0 };
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => {
    if (key in calls) calls[key]++;
    if (key === "fillRect") assert.ok(args.every(Number.isFinite));
  }) });
  return { width: 900, height: 210, style: {}, calls, context, getContext: () => context, addEventListener() {}, setAttribute() {} };
}

test("166,700 spike bursts have bounded drawing cost and preserve all anatomy", (t) => {
  const nodes = Array.from({ length: 166700 }, (_, id) => ({ id, bodyId: String(id), type: "fixture", x: id % 100 / 100, y: 0, z: id % 90 / 90, population: "visual", section: "optic" }));
  const spikes = nodes.map((node) => node.id);
  const sample = sampleActivity(spikes, MAX_ACTIVITY_MARKERS);
  assert.equal(sample.length, MAX_ACTIVITY_MARKERS);
  assert.ok(sample.at(-1) > spikes.length - 100);
  const canvas = fakeCanvas();
  const raster = new SpikeRaster(canvas);
  raster.setGraph(nodes);
  for (let batch = 0; batch < 75; batch++) {
    const before = canvas.calls.fillRect;
    raster.append(spikes, nodes.length);
    assert.ok(canvas.calls.fillRect - before <= 1 + canvas.width * 5);
  }
  assert.equal(canvas.calls.drawImage, 75, "history is copied once per batch");
  globalThis.document = { createElement: () => fakeCanvas() };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.ResizeObserver; });
  const host = { clientWidth: 600, clientHeight: 450, replaceChildren() {}, appendChild(child) { this.canvas = child; } };
  const view = new ConnectomeView(host, { nodes, displayEdges: [], visualInput: [], motorOutputs: [[], [], [], []] }, () => {});
  const before = { ...host.canvas.calls };
  const frame = { spikes, activeEdges: Array.from({ length: 25000 }, (_, i) => ({ source: i, target: i + 1, plastic: false })) };
  view.update(frame);
  assert.equal(view.renderIds.length, nodes.length, "every soma remains in the cached anatomy");
  assert.ok(host.canvas.calls.fillRect - before.fillRect <= MAX_ACTIVITY_MARKERS * 2);
  assert.ok(host.canvas.calls.stroke - before.stroke <= MAX_ACTIVITY_EDGES);
  assert.equal(host.canvas.calls.arc - before.arc, 0, "no per-spike arcs or blurred halos");
  assert.equal(frame.spikes.length, nodes.length, "display sampling does not mutate the simulation frame");
});

test("display budgets never change full-graph neural dynamics, rewards, or muscle readouts", () => {
  const fixture = makeTestGraph();
  const edges = fixture.displayEdges.slice().sort((a, b) => a.target - b.target);
  const offsets = new Uint32Array(fixture.nodes.length + 1);
  for (const edge of edges) offsets[edge.target + 1]++;
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
  const graph = { ...fixture, nodeCount: fixture.nodes.length, edgeCount: edges.length, offsets, sources: Uint32Array.from(edges, (edge) => edge.source), counts: new Uint32Array(edges.length).fill(100), sign: Int8Array.from(fixture.nodes, (_, i) => i % 7 === 0 ? -1 : i % 11 === 0 ? 0 : 1) };
  const limited = new MaleCnsBrain(graph, { maxActiveEdgesForDisplay: 0 });
  const full = new MaleCnsBrain(graph, { maxActiveEdgesForDisplay: 100000 });
  limited.setSelectedNeuron(128); full.setSelectedNeuron(128);
  let totalSpikes = 0, totalEdges = 0;
  for (let i = 0; i < 250; i++) {
    const input = { retinalFrame: new Float32Array(64).fill(0.9), learning: true, recurrence: i % 13 !== 0, reward: i % 9 === 0 ? (i % 2 ? -1 : 1) : 0, event: "none", selectedNeuron: 128 };
    const a = limited.step(input), b = full.step(input);
    totalSpikes += b.totalSpikes; totalEdges += b.activeEdges.length;
    const { wallTimeMs: aw, activeEdges: ae, ...am } = a;
    const { wallTimeMs: bw, activeEdges: be, ...bm } = b;
    assert.deepEqual(am, bm);
    assert.deepEqual(limited.voltages, full.voltages);
    assert.deepEqual(limited.eligibility, full.eligibility);
    assert.deepEqual(limited.plasticWeights, full.plasticWeights);
    assert.equal(a.activeEdges.length, 0);
  }
  assert.ok(totalSpikes > 100 && totalEdges > 100 && full.eligibility.length > 0);
});

test("screen interpolation is continuous, bounded, and does not advance game physics", () => {
  const game = new PongGame();
  const start = { ...game.state };
  const presentation = new GamePresentation(game.state);
    game.step([0, 360]);
  const committed = { ...game.state };
  presentation.commit(game.state, 100, 80);
  assert.equal(presentation.sample(100).ballX, start.ballX);
  assert.equal(presentation.sample(140).ballX, (start.ballX + committed.ballX) / 2);
  assert.equal(presentation.sample(1000).ballX, committed.ballX);
  assert.deepEqual(game.state, committed);
  const halfway = presentation.sample(140);
  game.step([0, 360]);
  presentation.commit(game.state, 140, 80);
  assert.equal(presentation.sample(140).ballX, halfway.ballX);
  assert.equal(presentation.sample(1000).ballX, game.state.ballX);
  game.state.scoreLeft++;
  game.state.ballX = 400;
  presentation.commit(game.state, 200, 80);
  assert.equal(presentation.sample(200).ballX, 400, "serve snaps instead of sweeping across the court");
  presentation.reset(start);
  assert.deepEqual(presentation.sample(1000), start);
});

test("annotated foreleg flexor/extensor activity drives a smooth joint-to-paddle embodiment", () => {
  const body = new FlyPaddleEmbodiment();
  const game = new PongGame();
  const neutral = body.step([0, 0, 0, 0], 0.01);
  assert.deepEqual(neutral.paddleTargets, [180, 180]);
  const before = neutral.paddleTargets[0];
  let frame;
  for (let i = 0; i < 100; i++) frame = body.step([0, 120, 0, 0], 0.01);
  assert.ok(frame.jointAnglesRad[0] > 0, "left tibia extensor pool creates joint extension");
  assert.equal(frame.jointAnglesRad[1], 0, "left leg activity cannot move the right paddle");
  assert.ok(frame.paddleTargets[0] > before, "leg endpoint maps to downward paddle displacement");
  assert.equal(frame.paddleTargets[1], 180);
  game.step(frame.paddleTargets, 0.01);
  assert.ok(game.state.leftY > 180 && game.state.rightY === 180);

  body.reset();
  assert.deepEqual(body.step([0, 0, 0, 0], 0.01).jointAnglesRad, [0, 0]);
});

test("paddle mechanics follow limb position while respecting the velocity limit", () => {
  const game = new PongGame();
  for (let i = 0; i < 12; i++) game.step([0, 360], 0.01);
  assert.ok(game.state.leftY < 180 && game.state.rightY > 180);
  const previousLeft = game.state.leftY;
  game.step([360, 0], 0.01);
  assert.ok(Math.abs(game.state.leftY - previousLeft) <= 3.300001);
  game.reset();
  assert.equal(game.state.leftY, 180);
});

test("left and right actuator mechanics are mirror-symmetric", () => {
  const left = new FlyPaddleEmbodiment();
  const right = new FlyPaddleEmbodiment();
  let leftFrame;
  let rightFrame;
  for (let i = 0; i < 100; i++) {
    leftFrame = left.step([0, 120, 0, 0], 0.01);
    rightFrame = right.step([0, 0, 0, 120], 0.01);
  }
  assert.ok(Math.abs(leftFrame.jointAnglesRad[0] - rightFrame.jointAnglesRad[1]) < 1e-12);
  assert.ok(Math.abs(leftFrame.paddleTargets[0] - rightFrame.paddleTargets[1]) < 1e-12);
  assert.equal(leftFrame.jointAnglesRad[1], 0);
  assert.equal(rightFrame.jointAnglesRad[0], 0);
});

test("a sustained endpoint command cannot pin a paddle at the hard stop", () => {
  const body = new FlyPaddleEmbodiment();
  let frame;
  for (let i = 0; i < 600; i++) frame = body.step([0, 0, 0, 120], 0.01);
  assert.ok(frame.jointAnglesRad[1] < Math.PI / 2 - 0.05, `right joint pinned at ${frame.jointAnglesRad[1]}`);
  assert.ok(frame.paddleTargets[1] < 350, `right paddle pinned at ${frame.paddleTargets[1]}`);
});
