import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { copyLocalRuntime } from "./copy-local-runtime.mjs";

/**
 * Compile the same source and worker through Node's TypeScript transform when Vite is unavailable,
 * preserving one implementation for reproducibility.
 */
export function buildNative(destination = new URL("../dist/", import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const dist = destination;
  mkdirSync(dist, { recursive: true });
  const modules = readdirSync(new URL("src/", root)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  const outputName = (name) => name === "main.ts" ? "app.js" : name.replace(/\.ts$/, ".js");
  for (const name of modules) {
    const input = new URL(`src/${name}`, root);
    let source = readFileSync(input, "utf8").replace(/^import\s+["']\.\/style\.css["'];?\s*$/m, "");
    source = stripTypeScriptTypes(source, { mode: "transform", sourceUrl: input.href });
    source = source.replace(/(\bfrom\s+["'])(\.\/[^"']+)(["'])/g, (_, prefix, path, quote) => {
      const dependency = path.slice(2).replace(/\.ts$/, "") + ".ts";
      if (!modules.includes(dependency)) throw new Error(`Unresolved module in ${name}: ${path}`);
      return `${prefix}./${outputName(dependency)}${quote}`;
    });
    source = source.replace(/new URL\((["'])\.\/worker\.ts\1,\s*import\.meta\.url\)/g, 'new URL("./worker.js", import.meta.url)');
    writeFileSync(new URL(outputName(name), dist), source);
  }
  const html = readFileSync(new URL("index.html", root), "utf8")
    .replace('/src/main.ts', './app.js').replace('/src/style.css', './style.css');
  writeFileSync(new URL("index.html", dist), html);
  copyFileSync(new URL("src/style.css", root), new URL("style.css", dist));
  const runtimeFiles = copyLocalRuntime(destination instanceof URL ? fileURLToPath(destination) : destination);
  if (runtimeFiles) console.log(`Packaged ${runtimeFiles} local connectome runtime files; raw tables remain unbundled.`);
  console.log(`Built ${modules.length} browser modules from src/ using Node's TypeScript transform.`);
}
