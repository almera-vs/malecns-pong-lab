import { parentPort, workerData } from "node:worker_threads";
import { fixtureFetch, runtimeFixture } from "./runtime-fixture.mjs";

const { files } = runtimeFixture();
if (workerData.failManifest) files.delete("manifest.json");
globalThis.fetch = fixtureFetch(files);
globalThis.self = { postMessage: (data) => parentPort.postMessage(data), onmessage: null };
parentPort.on("message", (data) => self.onmessage?.({ data }));
await import(workerData.entry);
