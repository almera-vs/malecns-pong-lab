import { strict as assert } from "node:assert";
import { makeTestGraph, rewardModulatedStdp, SparseBrain } from "../src/brain.ts";
import { validateCsr } from "../src/data-loader.ts";

const graph = makeTestGraph();
assert.equal(graph.nodes.length, 160);
assert.ok(graph.displayEdges.filter((edge) => edge.plastic).every((edge) => edge.source < 64 && edge.target >= 128));
assert.equal(rewardModulatedStdp(1, 1, 1000, 1), 2);
assert.equal(rewardModulatedStdp(1, 1, 1000, -1), 0.25);
const input = { retinalFrame: new Float32Array(64).fill(1), reward: 0, event: "none", learning: true, recurrence: true, selectedNeuron: 132 };
const left = new SparseBrain(graph);
const right = new SparseBrain(makeTestGraph());
const a = left.step(input);
const b = right.step(input);
assert.deepEqual(a.spikes, b.spikes);
assert.deepEqual(a.motorRatesHz, b.motorRatesHz);
validateCsr(new Uint32Array([0, 1, 2]), new Uint32Array([1, 0]), new Uint32Array([1, 1]), 2);
assert.throws(() => validateCsr(new Uint32Array([0, 2, 1, 2]), new Uint32Array([1, 0]), new Uint32Array([1, 1]), 3), /monotonic/);
console.log(`Core checks passed: ${a.totalSpikes} test spikes, ${a.plasticSynapses} plastic edges.`);
