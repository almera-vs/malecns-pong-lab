import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadMaleCnsGraph } from "../src/data-loader.ts";
import { mapBiologicalInterface } from "../src/biological-interface.ts";
import { MaleCnsBrain } from "../src/brain.ts";
import { fixtureFetch, runtimeFixture } from "./runtime-fixture.mjs";

test("real-schema graph preserves neurons and edges with missing soma coordinates", async (t) => {
  const { files } = runtimeFixture();
  const requested = [];
  t.mock.method(globalThis, "fetch", fixtureFetch(files, requested));
  const progress = [];
  const graph = await loadMaleCnsGraph((item) => progress.push(item));
  assert.equal(graph.nodeCount, 80);
  assert.equal(graph.edgeCount, 80);
  assert.equal(graph.nodes.filter((node) => node.position8nm).length, 78);
  assert.ok(Number.isNaN(graph.nodes[0].x));
  assert.equal(graph.nodes[0].population, "visual");
  assert.equal(graph.nodes[64].population, "descending", "annotated VNC motor neurons must count toward the motor firing display");
  assert.equal(graph.nodes[64].section, "motor");
  assert.ok(graph.visualInput.includes(0));
  assert.ok(graph.motorOutputs.flat().includes(65));
  assert.deepEqual(graph.interfaceAudit.motor.groups, [4, 4, 4, 4]);
  assert.equal(graph.interfaceAudit.motor.limbScope, "foreleg");
  assert.equal(graph.interfaceAudit.vision.mappingBasis, "explicit-retinotopy");
  assert.equal(graph.interfaceAudit.vision.coveredChannels, 64);
  assert.equal(graph.offsets.at(-1), 80);
  assert.deepEqual(new Set(requested), new Set(files.keys()));
  assert.ok(progress.every((item) => item.completed <= item.total));
  assert.equal(progress.at(-1).phase, "ready");
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  const brain = new MaleCnsBrain(graph);
  const output = brain.step({ retinalFrame: new Float32Array(64).fill(0.5), reward: 0, event: "none", learning: true, recurrence: true, selectedNeuron: null });
  assert.ok(output.neuralTimeMs > 0);
  assert.ok(output.plasticSynapses > 0, "reinforcement must bind to existing visual-to-motor path synapses");
  assert.equal(output.nodeCount, 80);
  assert.ok(output.motorRatesHz.every(Number.isFinite));
});

test("enriched object-form annotations retain receptor, side, retinotopy, and muscle paths", async (t) => {
  const { files } = runtimeFixture();
  const rows = JSON.parse(gunzipSync(files.get("neurons.json.gz")));
  const metadata = rows.map((row) => ({
    bodyId: String(row[0]), type: row[1], superclass: row[2], side: row[3], consensusNT: row[4], sign: row[5],
    position8nm: row[6], class: row[7], subclass: row[8], sensoryModality: row[9], receptorSubtype: row[10],
    exitNerve: row[11], muscleTargets: row[12], retinalPosition: row[13],
  }));
  files.set("neurons.json.gz", gzipSync(JSON.stringify(metadata)));
  t.mock.method(globalThis, "fetch", fixtureFetch(files));
  const graph = await loadMaleCnsGraph(() => {});
  assert.equal(graph.visualInput.length, 64);
  assert.deepEqual(graph.motorOutputs.map((group) => group.length), [4, 4, 4, 4]);
  assert.equal(graph.nodes[64].muscleTargets[0], "tibia flexor");
});

test("published annotation fields map using root side, soma location, exit nerve, and cell type", async (t) => {
  const { files } = runtimeFixture();
  const rows = JSON.parse(gunzipSync(files.get("neurons.json.gz")));
  const metadata = rows.map((row) => ({
    bodyId: String(row[0]), type: row[1], superclass: row[2], side: "", rootSide: row[3],
    consensusNT: row[4], sign: row[5], somaLocation: row[6], class: row[7], subclass: row[8],
    exitNerve: row[11],
  }));
  files.set("neurons.json.gz", gzipSync(JSON.stringify(metadata)));
  t.mock.method(globalThis, "fetch", fixtureFetch(files));
  const graph = await loadMaleCnsGraph(() => {});
  assert.equal(graph.nodes[1].position8nm[0], rows[1][6][0]);
  assert.equal(graph.nodes[64].side, "L");
  assert.deepEqual(graph.motorOutputs.map((group) => group.length), [4, 4, 4, 4]);
  assert.equal(graph.interfaceAudit.motor.limbScope, "foreleg");
  assert.equal(graph.interfaceAudit.vision.mappingBasis, "soma-coordinate-proxy");
});

test("MaleCNS R7/R8 subtype labels and optic-column coordinates map to the correct eye channels", () => {
  const nodes = [
    { id: 14, bodyId: "r7", type: "R7y", superclass: "ol_sensory", side: "R", retinalEyeSide: "R", retinalPosition: [1, 0], retinalPositionSource: "optic-column-lattice", population: "visual", section: "optic", x: 0, y: 0, z: 0 },
    { id: 7, bodyId: "r8", type: "R8_unclear", superclass: "ol_sensory", side: "L", retinalEyeSide: "left", retinalPosition: [0, 1], retinalPositionSource: "optic-column-lattice", population: "visual", section: "optic", x: 0, y: 0, z: 0 },
  ];
  const mapping = mapBiologicalInterface(nodes);
  assert.deepEqual(mapping.visualInput, [14, 7]);
  assert.deepEqual(mapping.visualInputChannels, [39, 24]);
  assert.equal(mapping.audit.vision.receptorCandidates, 2);
  assert.equal(mapping.audit.vision.coveredChannels, 2);
  assert.equal(mapping.audit.vision.mappingBasis, "optic-column-lattice");
});

test("visual histamine sign is inhibitory while receptor-ambiguous glutamate stays unknown", async (t) => {
  const { files } = runtimeFixture();
  const rows = JSON.parse(gunzipSync(files.get("neurons.json.gz")));
  const metadata = rows.map((row, id) => ({
    bodyId: String(row[0]), type: row[1], superclass: row[2], side: row[3],
    consensusNT: id < 64 ? "histamine" : id === 65 ? "glutamate" : row[4],
    position8nm: row[6], class: row[7], subclass: row[8], sensoryModality: row[9],
    receptorSubtype: row[10], exitNerve: row[11], muscleTargets: row[12], retinalPosition: row[13],
  }));
  files.set("neurons.json.gz", gzipSync(JSON.stringify(metadata)));
  t.mock.method(globalThis, "fetch", fixtureFetch(files));
  const graph = await loadMaleCnsGraph(() => {});
  assert.equal(graph.sign[0], -1);
  assert.equal(graph.sign[64], 1);
  assert.equal(graph.sign[65], 0);
});

test("motor type labels form explicit side pools without inventing a leg segment", async (t) => {
  const { files } = runtimeFixture();
  const rows = JSON.parse(gunzipSync(files.get("neurons.json.gz")));
  const reduced = rows.map((row) => row.slice(0, 7));
  files.set("neurons.json.gz", gzipSync(JSON.stringify(reduced)));
  t.mock.method(globalThis, "fetch", fixtureFetch(files));
  const graph = await loadMaleCnsGraph(() => {});
  assert.deepEqual(graph.motorOutputs.map((group) => group.length), [4, 4, 4, 4]);
  assert.equal(graph.interfaceAudit.motor.annotatedMotorNeurons, 16);
  assert.equal(graph.interfaceAudit.motor.mappedTibiaMotorNeurons, 16);
  assert.equal(graph.interfaceAudit.motor.limbScope, "side-tibia-pool");
});

test("neuron IDs and ordering cannot change biological sensor or muscle assignments", () => {
  const nodes = [
    { id: 91, bodyId: "right-ext", type: "Ti extensor MN", superclass: "vnc_motor", side: "R", subclass: "fl", population: "other", section: "motor", x: 0, y: 0, z: 0 },
    { id: 8, bodyId: "left-flex", type: "Ti flexor MN", superclass: "vnc_motor", side: "L", subclass: "fl", population: "other", section: "motor", x: 0, y: 0, z: 0 },
    { id: 72, bodyId: "right-flex", type: "Ti flexor MN", superclass: "vnc_motor", side: "R", subclass: "fl", population: "other", section: "motor", x: 0, y: 0, z: 0 },
    { id: 3, bodyId: "left-ext", type: "Ti extensor MN", superclass: "vnc_motor", side: "L", subclass: "fl", population: "other", section: "motor", x: 0, y: 0, z: 0 },
  ];
  const mapping = mapBiologicalInterface(nodes);
  assert.deepEqual(mapping.motorOutputs, [[8], [3], [72], [91]]);
  assert.deepEqual(mapping.audit.motor.groups, [1, 1, 1, 1]);
});

test("a corrupt graph chunk fails checksum validation", async (t) => {
  const { files } = runtimeFixture();
  files.get("sources-000.bin.gz")[12] ^= 1;
  t.mock.method(globalThis, "fetch", fixtureFetch(files));
  await assert.rejects(loadMaleCnsGraph(() => {}), /Checksum failed/);
});

test("a stalled download times out and a subsequent attempt succeeds", async (t) => {
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  await assert.rejects(loadMaleCnsGraph(() => {}, undefined, 15), /Download timed out: manifest.json/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", fixtureFetch(runtimeFixture().files));
  assert.equal((await loadMaleCnsGraph(() => {})).nodeCount, 80);
});
