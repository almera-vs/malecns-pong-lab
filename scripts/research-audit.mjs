/** Record the installed structural resource and implementation for reproducible methods reporting. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { loadMaleCnsGraph } from "../src/data-loader.ts";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain.ts";
import { FlyPaddleEmbodiment } from "../src/fly-embodiment.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = join(root, "public/data/runtime");
const destination = process.argv[2] ?? join(root, "paper/evidence/runtime-audit.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = readFileSync(join(runtime, "manifest.json"));
const manifest = JSON.parse(manifestBytes);
const originalFetch = globalThis.fetch;
let graph;
try {
  globalThis.fetch = async (url) => {
    try { return new Response(readFileSync(join(runtime, basename(new URL(url).pathname)))); }
    catch { return new Response("Not found", { status: 404 }); }
  };
  graph = await loadMaleCnsGraph(() => {}, "http://local/data/runtime/manifest.json");
} finally {
  globalThis.fetch = originalFetch;
}
let revision = null;
try { revision = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
catch { /* An unpublished working tree can be identified by source hashes before its first commit. */ }
const sourceFiles = ["package.json", "package-lock.json", "vite.config.ts", ...["src", "scripts"].flatMap((directory) =>
  readdirSync(join(root, directory)).filter((name) => /\.(ts|mjs|py|wgsl|css)$/.test(name)).map((name) => `${directory}/${name}`))];
const signs = { positive: 0, negative: 0, unresolved: 0 };
const outgoingEdges = { positive: 0, negative: 0, unresolved: 0 };
const category = (sign) => sign > 0 ? "positive" : sign < 0 ? "negative" : "unresolved";
for (const sign of graph.sign) signs[category(sign)]++;
for (const source of graph.sources) outgoingEdges[category(graph.sign[source])]++;
const compressedBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
let contactCount = 0;
for (const count of graph.counts) contactCount += count;
const embodiment = Object.fromEntries(Object.entries(FlyPaddleEmbodiment).filter(([, value]) => typeof value === "number"));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: "Structural and implementation audit; no behavioral efficacy inference",
  revision,
  sourceHashes: Object.fromEntries(sourceFiles.sort().map((file) => [file, hash(readFileSync(join(root, file)))])),
  environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, systemMemoryBytes: os.totalmem() },
  dataset: manifest.dataset,
  runtimeManifestSha256: hash(manifestBytes),
  sourceFiles: manifest.sourceFiles,
  graph: { neurons: graph.nodeCount, directedEdges: graph.edgeCount, contactCount, knownSomaPositions: graph.nodes.filter((node) => node.position8nm).length, signs, outgoingEdgesBySourceSign: outgoingEdges, compressedBytes },
  interfaceAudit: graph.interfaceAudit,
  brainDefaults: DEFAULT_BRAIN_CONFIG,
  embodimentConstants: embodiment,
  derived: {
    neuralBatchMs: DEFAULT_BRAIN_CONFIG.dtMs * DEFAULT_BRAIN_CONFIG.realStepsPerBatch,
    eligibilityTimeConstantMs: -DEFAULT_BRAIN_CONFIG.dtMs / Math.log(DEFAULT_BRAIN_CONFIG.eligibilityDecay),
    timingTraceTimeConstantMs: -DEFAULT_BRAIN_CONFIG.dtMs / Math.log(DEFAULT_BRAIN_CONFIG.preTraceDecay),
    effectiveRetinalTimeConstantMs: DEFAULT_BRAIN_CONFIG.retinalAdaptationTauMs * DEFAULT_BRAIN_CONFIG.realStepsPerBatch,
  },
};
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ destination, graph: report.graph, interfaceAudit: report.interfaceAudit, derived: report.derived }, null, 2));
