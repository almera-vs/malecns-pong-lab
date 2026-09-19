import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// Mirror the runtime schema with synthetic annotations, including valid neurons lacking soma positions,
// to test retention and loading.
export function runtimeFixture() {
  const count = 80;
  const rows = Array.from({ length: count }, (_, id) => {
    if (id < 64) {
      const local = id % 32;
      const col = local % 8;
      const row = Math.floor(local / 8);
      return [10001 + id, "R1-R6", "ol_sensory", id < 32 ? "L" : "R", "acetylcholine", 1,
        id === 0 ? null : [id * 100 + 1, id * 200 + 1, id * 300 + 1], "photoreceptor", "compound-eye", "visual", "R1-R6", "", [], [col / 7, row / 3]];
    }
    const channel = Math.floor((id - 64) / 4);
    const action = channel % 2 ? "extensor" : "flexor";
    const side = channel < 2 ? "L" : "R";
    return [10001 + id, `Ti ${action} MN`, "vnc_motor", side, "acetylcholine", 1,
      id === 65 ? null : [id * 100 + 1, id * 200 + 1, id * 300 + 1], "motor neuron", "fl", "", "", "ProLN", [`tibia ${action}`], null];
  });
  const files = new Map([["neurons.json.gz", gzipSync(JSON.stringify(rows))]]);
  const arrays = {
    offsets: Uint32Array.from({ length: count + 1 }, (_, id) => id),
    sources: Uint32Array.from({ length: count }, (_, id) => (id + 1) % count),
    counts: new Uint32Array(count).fill(2),
  };
  const manifest = { dataset: "test-fixture", neurons: count, metadata: "neurons.json.gz", arrays: [] };
  for (const [name, values] of Object.entries(arrays)) {
    const file = `${name}-000.bin.gz`;
    const bytes = gzipSync(new Uint8Array(values.buffer));
    files.set(file, bytes);
    manifest.arrays.push({ name, length: values.length, parts: [{ file, sha256: createHash("sha256").update(bytes).digest("hex") }] });
  }
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { files, rows, manifest };
}

export function fixtureFetch(files, requested = []) {
  return async (url) => {
    const name = new URL(url).pathname.split("/").pop();
    requested.push(name);
    const bytes = files.get(name);
    return bytes ? new Response(bytes) : new Response("Not found", { status: 404 });
  };
}
