import type {
  AnatomicalSection,
  CoordinateTransform,
  DataLoadProgress,
  GraphNode,
  Population,
  RuntimeGraphData,
} from "./types";
import { mapBiologicalInterface, readRetinalPosition } from "./biological-interface.ts";

/**
 * Supply a fixture-local default URL; the browser explicitly requests its locally installed runtime
 * manifest.
 */
export const DEFAULT_MANIFEST_URL = "http://local/data/runtime/manifest.json";
export const MALE_CNS_SOURCE = "https://male-cns.janelia.org/download/";
export const MALE_CNS_SWCS = "https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/";
const SYNAPSE_CURRENT_MV = 0.0275;

interface RuntimeManifest {
  dataset?: string;
  neurons: number;
  graphEdges?: number;
  metadata: string;
  metadataSha256?: string;
  arrays: Array<{
    name: "offsets" | "sources" | "counts";
    length: number;
    dtype?: string;
    parts: Array<{ file: string; sha256?: string; dtype?: string }>;
  }>;
}

export function validateCsr(offsets: Uint32Array, sources: Uint32Array, counts: Uint32Array, nodeCount: number): void {
  if (nodeCount <= 0) throw new Error("MaleCNS graph has no neurons");
  if (offsets.length !== nodeCount + 1) throw new Error(`CSR offsets length ${offsets.length} != ${nodeCount + 1}`);
  if (sources.length !== counts.length) throw new Error("CSR source and count arrays have different lengths");
  if (offsets[0] !== 0 || offsets[offsets.length - 1] !== sources.length) throw new Error("CSR offsets do not span the edge array");
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (offsets[i] > offsets[i + 1]) throw new Error(`CSR offsets are not monotonic at neuron ${i}`);
    if (offsets[i + 1] > sources.length) throw new Error(`CSR offset ${i + 1} is out of bounds`);
  }
  for (let i = 0; i < sources.length; i += 1) {
    if (sources[i] >= nodeCount) throw new Error(`CSR source ${sources[i]} is out of bounds at edge ${i}`);
    if (counts[i] === 0) throw new Error(`CSR edge ${i} has zero synapse count`);
  }
}

export async function loadMaleCnsGraph(
  onProgress: (progress: DataLoadProgress) => void,
  manifestUrl = DEFAULT_MANIFEST_URL,
  requestTimeoutMs = 60_000,
): Promise<RuntimeGraphData> {
  onProgress({ phase: "manifest", completed: 0, total: 1, message: "Downloading MaleCNS runtime manifest…" });
  const manifestBytes = await download(manifestUrl, requestTimeoutMs);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RuntimeManifest;
  validateManifest(manifest);
  const baseUrl = new URL("./", manifestUrl).toString();
  const total = 1 + manifest.arrays.reduce((sum, array) => sum + array.parts.length, 0);
  let completed = 0;
  const advance = (phase: DataLoadProgress["phase"], message: string) => {
    completed += 1;
    onProgress({ phase, completed, total, message });
  };

  const reportDownload = (phase: DataLoadProgress["phase"], file: string) => (bytes: number) => {
    onProgress({ phase, completed, total, message: `Downloading ${file} · ${(bytes / 1_000_000).toFixed(1)} MB · ${completed}/${total} files complete` });
  };
  const metadataBytes = await fetchBytes(new URL(manifest.metadata, baseUrl).toString(), manifest.metadataSha256, requestTimeoutMs, reportDownload("metadata", manifest.metadata));
  advance("metadata", "MaleCNS metadata downloaded; reading annotations…");
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as unknown;
  const nodeCount = manifest.neurons;
  const nodesAndSign = normalizeMetadata(metadata, nodeCount);

  const arrays: Partial<Record<"offsets" | "sources" | "counts", Uint32Array>> = {};
  for (const definition of manifest.arrays) {
    const values = new Uint32Array(definition.length);
    let offset = 0;
    for (const part of definition.parts) {
      const bytes = await fetchBytes(new URL(part.file, baseUrl).toString(), part.sha256, requestTimeoutMs, reportDownload("graph", part.file));
      const chunk = decodeUint32(bytes, part.dtype ?? definition.dtype);
      if (offset + chunk.length > values.length) throw new Error(`${definition.name} chunk exceeds declared length`);
      values.set(chunk, offset);
      offset += chunk.length;
      advance("graph", `Loaded ${definition.name} chunk ${completed}/${total}`);
    }
    if (offset !== values.length) throw new Error(`${definition.name} length ${offset} != ${values.length}`);
    arrays[definition.name] = values;
  }
  const offsets = arrays.offsets;
  const sources = arrays.sources;
  const counts = arrays.counts;
  if (!offsets || !sources || !counts) throw new Error("MaleCNS manifest must provide offsets, sources, and counts arrays");

  onProgress({ phase: "validating", completed, total, message: "Validating neuron IDs, CSR bounds, and coordinates…" });
  validateCsr(offsets, sources, counts, nodeCount);
  if (nodesAndSign.nodes.length !== nodeCount) throw new Error("Metadata neuron count does not match the graph manifest");
  const biologicalInterface = mapBiologicalInterface(nodesAndSign.nodes);
  const displayEdges = sampleDisplayEdges(offsets, sources, counts, nodesAndSign.nodes, 6000);
  const graphEdgeCount = sources.length;
  onProgress({ phase: "ready", completed: total, total, message: `MaleCNS ready · ${nodeCount.toLocaleString()} neurons · ${graphEdgeCount.toLocaleString()} graph edges` });
  return {
    nodes: nodesAndSign.nodes,
    displayEdges,
    visualInput: biologicalInterface.visualInput,
    visualInputChannels: biologicalInterface.visualInputChannels,
    motorOutputs: biologicalInterface.motorOutputs,
    proprioceptiveInputs: biologicalInterface.proprioceptiveInputs,
    dopamineNeurons: biologicalInterface.dopamineNeurons,
    interfaceAudit: biologicalInterface.audit,
    coordinateTransform: nodesAndSign.transform,
    dataset: manifest.dataset ?? "male-cns:v1.0",
    graphEdgeCount,
    nodeCount,
    edgeCount: graphEdgeCount,
    offsets,
    sources,
    counts,
    sign: nodesAndSign.sign,
  };
}

function validateManifest(manifest: RuntimeManifest): void {
  if (!Number.isInteger(manifest.neurons) || manifest.neurons <= 0) throw new Error("Invalid MaleCNS neuron count in manifest");
  if (!manifest.metadata || !Array.isArray(manifest.arrays) || !manifest.arrays.length) throw new Error("MaleCNS manifest is missing metadata or arrays");
  const names = new Set(manifest.arrays.map((array) => array.name));
  for (const name of ["offsets", "sources", "counts"] as const) if (!names.has(name)) throw new Error(`MaleCNS manifest is missing ${name}`);
  for (const array of manifest.arrays) {
    if (!Number.isInteger(array.length) || array.length < 0 || !array.parts?.length) throw new Error(`Invalid ${array.name} array declaration`);
    for (const part of array.parts) if (!part.file) throw new Error(`Invalid ${array.name} chunk declaration`);
  }
}

async function download(url: string, timeoutMs: number, onBytes?: (bytes: number) => void): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const file = new URL(url).pathname.split("/").pop();
  onBytes?.(0);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${file}`);
    if (!response.body) return await response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let lastReported = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
      if (performance.now() - lastReported > 150) {
        onBytes?.(length);
        lastReported = performance.now();
      }
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    onBytes?.(length);
    return result.buffer;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Download timed out: ${file}. Check your connection and retry.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url: string, expectedSha256: string | undefined, timeoutMs: number, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
  const compressed = await download(url, timeoutMs, onBytes);
  if (expectedSha256) {
    const actual = await sha256(compressed);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) throw new Error(`Checksum failed for ${url}: expected ${expectedSha256}, got ${actual}`);
  }
  return decompressGzip(compressed);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function decompressGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (header[0] !== 0x1f || header[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === "undefined") throw new Error("This browser does not support gzip decompression for the MaleCNS runtime");
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

function decodeUint32(bytes: ArrayBuffer, dtype = "uint32"): Uint32Array {
  if (dtype && !/u?int32|uint32/i.test(dtype)) throw new Error(`Unsupported runtime array dtype ${dtype}; expected uint32`);
  if (bytes.byteLength % 4 !== 0) throw new Error("Runtime uint32 chunk is not 4-byte aligned");
  return new Uint32Array(bytes);
}

function normalizeMetadata(metadata: unknown, expected: number): { nodes: GraphNode[]; sign: Int8Array; transform: CoordinateTransform } {
  const rows = Array.isArray(metadata) ? metadata : isRecord(metadata) && Array.isArray(metadata.records) ? metadata.records : isRecord(metadata) && Array.isArray(metadata.nodes) ? metadata.nodes : null;
  if (!rows) throw new Error("MaleCNS metadata is not a neuron record array");
  if (rows.length !== expected) throw new Error(`MaleCNS metadata has ${rows.length} records; manifest declares ${expected}`);
  const rawPositions: Array<[number, number, number]> = [];
  const sign = new Int8Array(expected);
  const nodes: GraphNode[] = rows.map((row, id) => {
    const record = asRecord(row);
    const bodyId = String(record?.bodyId ?? record?.body_id ?? record?.body ?? arrayValue(row, 0) ?? "unknown");
    const type = String(record?.type ?? record?.cellType ?? record?.cell_type ?? arrayValue(row, 1) ?? "unknown");
    const superclass = String(record?.superclass ?? record?.super_class ?? arrayValue(row, 2) ?? "unknown");
    const side = optionalString(record?.side || record?.hemisphere || record?.somaSide || record?.rootSide || arrayValue(row, 3));
    const nested = isRecord(record?.annotations) ? record.annotations : {};
    const positionalAnnotations: Record<string, unknown> = {
      class: arrayValue(row, 7),
      subclass: arrayValue(row, 8),
      sensoryModality: arrayValue(row, 9),
      receptorSubtype: arrayValue(row, 10),
      consensusNT: arrayValue(row, 4),
      exitNerve: arrayValue(row, 11),
      muscleTargets: arrayValue(row, 12),
      retinalPosition: arrayValue(row, 13),
    };
    const annotationValue = (...names: string[]): unknown => {
      for (const name of names) {
        const value = record?.[name] ?? nested[name] ?? record?.[snakeCase(name)] ?? nested[snakeCase(name)] ?? positionalAnnotations[name] ?? positionalAnnotations[snakeCase(name)];
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    };
    const className = optionalString(annotationValue("class", "cellClass"));
    const subclass = optionalString(annotationValue("subclass", "subClass", "cellSubclass"));
    const sensoryModality = optionalString(annotationValue("sensoryModality", "modality", "sensoryClass"));
    const receptorSubtype = optionalString(annotationValue("receptorSubtype", "receptorType", "sensorySubtype"));
    const neurotransmitter = optionalString(annotationValue("consensusNT", "neurotransmitter", "nt", "transmitter"));
    const motorExitNerve = optionalString(annotationValue("exitNerve", "motorExitNerve", "peripheralNerve", "nerve"));
    const muscleTargets = readStringList(annotationValue("muscleTargets", "muscleTarget", "muscleInnervation", "innervatedMuscle", "muscle"));
    const retinalPosition = readRetinalPosition(annotationValue("retinalPosition", "retinotopy", "visualFieldPosition", "receptiveFieldPosition", "ommatidiumPosition"));
    const retinalPositionSource = optionalString(annotationValue("retinalPositionSource")) as GraphNode["retinalPositionSource"];
    const retinalEyeSide = optionalString(annotationValue("retinalEyeSide", "opticColumnSide")) as GraphNode["retinalEyeSide"];
    const text = `${type} ${superclass} ${className ?? ""} ${String(record?.primaryNeuropil ?? "")}`;
    const classification = classifyNode(text);
    const xyzFields = record && [record.x, record.y, record.z].every((value) => value !== undefined) ? [record.x, record.y, record.z] : undefined;
    const position = readPosition(record?.position8nm ?? record?.position ?? record?.xyz ?? record?.soma ?? record?.somaLocation8nm ?? record?.somaLocation ?? xyzFields ?? arrayValue(row, 6));
    // Preserve neurons and connectivity when soma coordinates are absent. Missing anatomy affects
    // rendering rather than the retained simulation graph.
    if (position) rawPositions.push(position);
    sign[id] = readSign(record?.sign ?? record?.fastSign ?? record?.ntSign ?? record?.neurotransmitter ?? record?.consensusNT ?? arrayValue(row, 5), record?.superclass, type);
    return {
      id, bodyId, type, superclass, side, class: className, subclass, sensoryModality, receptorSubtype,
      motorExitNerve, muscleTargets, retinalPosition, neurotransmitter,
      retinalPositionSource: retinalPositionSource ?? (retinalPosition ? "annotation" : undefined), retinalEyeSide, ...classification,
      x: position?.[0] ?? NaN, y: position?.[1] ?? NaN, z: position?.[2] ?? NaN,
      position8nm: position ?? undefined,
    };
  });
  const transform = makeTransform(rawPositions);
  if (rawPositions.every((position) => position[0] === 0 && position[1] === 0 && position[2] === 0)) throw new Error("MaleCNS metadata has no usable soma coordinates");
  for (const node of nodes) {
    const position = node.position8nm;
    if (!position) continue;
    node.x = (position[0] - transform.center[0]) / transform.scale;
    node.y = (position[1] - transform.center[1]) / transform.scale;
    node.z = (position[2] - transform.center[2]) / transform.scale;
  }
  return { nodes, sign, transform };
}

function classifyNode(text: string): { population: Population; section: AnatomicalSection } {
  const normalized = text.toLowerCase();
  // Prefer released anatomical superclass labels before broader name-based display categories.
  if (/\bol_(?:intrinsic|sensory)\b/.test(normalized)) return { population: "visual", section: "optic" };
  if (/\bvnc_motor\b/.test(normalized)) return { population: "descending", section: "motor" };
  if (/\bvnc_/.test(normalized)) return { population: "other", section: "vnc" };
  if (/\bcb_/.test(normalized)) return { population: "central", section: "central" };
  if (/photoreceptor|optic|lamina|medulla|lobula|visual|columnar|transmedullary/.test(normalized)) return { population: "visual", section: "optic" };
  if (/descending|motor|dnp|dna|dng|premotor/.test(normalized)) return { population: "descending", section: "motor" };
  if (/vnc|nerve cord|ascending/.test(normalized)) return { population: "other", section: "vnc" };
  if (/central|mushroom|fan-shaped|bridge|complex|ellipsoid|protocerebral|central-complex/.test(normalized)) return { population: "central", section: "central" };
  return { population: "other", section: "other" };
}

function sampleDisplayEdges(offsets: Uint32Array, sources: Uint32Array, counts: Uint32Array, nodes: GraphNode[], limit: number) {
  const edges = [] as Array<{ source: number; target: number; weight: number; plastic: boolean }>;
  const stride = Math.max(1, Math.ceil(sources.length / limit));
  for (let target = 0; target < nodes.length; target += 1) {
    for (let edge = offsets[target]; edge < offsets[target + 1]; edge += stride) {
      const source = sources[edge];
      edges.push({ source, target, weight: counts[edge] * SYNAPSE_CURRENT_MV, plastic: nodes[source]?.population === "visual" && nodes[target]?.population === "descending" });
      if (edges.length >= limit) return edges;
    }
  }
  return edges;
}

function makeTransform(positions: Array<[number, number, number]>): CoordinateTransform {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const position of positions) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], position[axis]);
    max[axis] = Math.max(max[axis], position[axis]);
  }
  const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const scale = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
  return { sourceUnit: "8nm", min, max, center, scale };
}

function readPosition(value: unknown): [number, number, number] | null {
  const values = Array.isArray(value) && value.length >= 3 ? value.slice(0, 3) : isRecord(value) ? [value.x, value.y, value.z] : null;
  if (!values || values.length < 3) return null;
  if (values.some((entry) => entry === null || entry === undefined || entry === "")) return null;
  const position = values.map(Number);
  return position.every(Number.isFinite) ? [position[0], position[1], position[2]] : null;
}

function readSign(value: unknown, superclass?: unknown, cellType?: string): -1 | 0 | 1 {
  if (typeof value === "number") return value > 0 ? 1 : value < 0 ? -1 : 0;
  const text = String(value ?? "").toLowerCase();
  // Treat transmitter sign as an explicit approximation. Unresolved receptor-dependent effects,
  // including glutamate, contribute no outgoing current.
  if (/inhib|gaba/.test(text)) return -1;
  if (/histamine/.test(text) && superclass === "ol_sensory" && /photoreceptor|retinula|\br[1-8]/i.test(cellType ?? "")) return -1;
  if (/excit|acetylcholine|\bach\b/.test(text)) return 1;
  return 0;
}

function arrayValue(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function readStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const values = Array.isArray(value) ? value : [value];
  const strings = values.map((item) => String(item).trim()).filter(Boolean);
  return strings.length ? [...new Set(strings)] : undefined;
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
