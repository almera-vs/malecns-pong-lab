import { defineConfig } from "vite";
import { createReadStream, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { copyLocalRuntime } from "./scripts/copy-local-runtime.mjs";

const localRuntimeRoot = resolve("public/data/runtime");

function localConnectomeRuntime() {
  let outputDirectory = resolve("dist");
  let isProductionBuild = false;
  return {
    name: "local-connectome-runtime",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const prefix = "/data/runtime/";
        if (!pathname.startsWith(prefix)) return next();
        let relativePath;
        try {
          relativePath = decodeURIComponent(pathname.slice(prefix.length));
        } catch {
          response.writeHead(400).end("Invalid runtime path");
          return;
        }
        const file = resolve(localRuntimeRoot, relativePath);
        if (!file.startsWith(`${localRuntimeRoot}${sep}`) || !existsSync(file)) {
          response.writeHead(404).end("Local runtime asset not found");
          return;
        }
        response.writeHead(200, {
          "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
          "cache-control": "no-store",
        });
        createReadStream(file).on("error", () => response.destroy()).pipe(response);
      });
    },
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
      isProductionBuild = config.command === "build";
    },
    closeBundle() {
      if (!isProductionBuild) return;
      const runtimeFiles = copyLocalRuntime(outputDirectory);
      if (runtimeFiles) console.log(`Packaged ${runtimeFiles} local connectome runtime files; raw tables remain unbundled.`);
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [localConnectomeRuntime()],
  worker: { format: "es" },
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => assetInfo.name === "style.css" ? "style.css" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
