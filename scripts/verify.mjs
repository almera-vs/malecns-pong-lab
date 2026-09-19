import { existsSync, readFileSync } from "node:fs";
const required = ["dist/index.html", "dist/app.js", "README.md", "docs/ARCHITECTURE.md", "paper/main.tex"];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) { console.error(`Missing required files: ${missing.join(", ")}`); process.exit(1); }
const html = readFileSync("dist/index.html", "utf8");
if (!html.includes("app.js")) { console.error("dist/index.html does not load app.js"); process.exit(1); }
if (existsSync("public/data/runtime/manifest.json")) {
  const manifest = JSON.parse(readFileSync("public/data/runtime/manifest.json", "utf8"));
  const runtimeFiles = [manifest.metadata, ...(manifest.arrays ?? []).flatMap((array) => (array.parts ?? []).map((part) => part.file))];
  const missingRuntime = ["manifest.json", ...runtimeFiles].filter((file) => !existsSync(`dist/data/runtime/${file}`));
  if (missingRuntime.length) { console.error(`Local connectome assets are missing from dist: ${missingRuntime.slice(0, 5).join(", ")}`); process.exit(1); }
}
console.log(`Verified ${required.length} repository entrypoints.`);
