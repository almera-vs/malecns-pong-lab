import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const viteCandidates = [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url))];
const vite = viteCandidates.find((candidate) => existsSync(candidate));
if (vite) {
  const child = spawn(process.execPath, [vite, ...process.argv.slice(2), "--configLoader", "native"], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  const { buildNative } = await import("./build-native.mjs");
  buildNative();
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url || "/").split("?")[0]);
    const requested = normalize(join(root, raw === "/" ? "index.html" : raw));
    const safe = requested.startsWith(root) ? requested : join(root, "index.html");
    import("node:fs").then(({ readFile }) => readFile(safe, (error, data) => {
      if (error) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "content-type": types[extname(safe)] || "application/octet-stream", "cache-control": "no-store" }); res.end(data);
    }));
  });
  server.listen(5173, "127.0.0.1", () => console.log("MaleCNS Pong Lab: http://127.0.0.1:5173"));
}
