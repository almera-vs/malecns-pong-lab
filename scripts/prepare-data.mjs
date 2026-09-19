import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, resolve } from "node:path";

const manifestPath = process.argv[2] || "data/manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outDir = resolve("public/data/runtime");
await mkdir(outDir, { recursive: true });
const preparedFiles = [];

for (const item of manifest.files || []) {
  if (!item.url || !item.filename) throw new Error("Each manifest file needs url and filename");
  if (item.url.includes("PASTE_") || item.sha256?.includes("PASTE_")) throw new Error(`Replace the placeholder URL and hash for ${item.filename} before downloading`);
  const destination = resolve(outDir, basename(item.filename));
  const expectedHash = item.sha256?.toLowerCase();
  try {
    const existing = await stat(destination);
    if (existing.isFile()) {
      const hash = await hashFile(destination);
      if (expectedHash && hash !== expectedHash) throw new Error(`${item.filename}: existing file has the wrong hash (${hash}); preserving it`);
      preparedFiles.push({ filename: basename(item.filename), bytes: existing.size, sha256: hash, reused: true });
      console.log(`Verified existing ${item.filename} · ${(existing.size / 1_000_000).toFixed(1)} MB`);
      continue;
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  console.log(`Downloading ${item.filename}`);
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`${item.url}: ${response.status}`);
  if (!response.body) throw new Error(`${item.filename}: download response had no body`);
  const partial = `${destination}.partial`;
  const digest = createHash("sha256");
  let bytes = 0;
  let lastReported = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      bytes += chunk.length;
      if (bytes - lastReported >= 100_000_000) {
        console.log(`  ${(bytes / 1_000_000).toFixed(0)} MB received`);
        lastReported = bytes;
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial));
  const hash = digest.digest("hex");
  if (expectedHash && expectedHash !== hash) throw new Error(`${item.filename}: hash mismatch (${hash}); downloaded file retained as .partial for inspection`);
  await rename(partial, destination);
  preparedFiles.push({ filename: basename(item.filename), bytes, sha256: hash, reused: false });
  console.log(`  ${bytes} bytes sha256=${hash}`);
}

await writeFile(resolve(outDir, "manifest.json"), JSON.stringify({
  ...manifest,
  preparedFiles,
}, null, 2));

console.log(`Runtime data ready in ${outDir}`);

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
