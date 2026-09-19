import { readFileSync } from "node:fs";
const files = ["src/main.ts", "src/brain.ts", "src/data-loader.ts", "src/worker.ts", "src/visualization.ts", "src/propagate-sparse.wgsl", "scripts/dev.mjs", "scripts/verify.mjs"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.trim()) throw new Error(`${file} is empty`);
}
const source = files.filter((file) => file.startsWith("src/")).map((file) => readFileSync(file, "utf8")).join("\n");
for (const token of ["retinalFrame", "rewardModulatedStdp", "validateCsr", "2D anatomical section", "visualInput"]) {
  if (!source.includes(token)) throw new Error(`Required source token missing: ${token}`);
}
for (const removed of ["activity-brain", "load-brain", "new SparseBrain", "SensorimotorLoop", "paddlePosition", "motorDrive", "retinalTargets"]) {
  if (source.includes(removed)) throw new Error(`Obsolete source token present: ${removed}`);
}
console.log("Source checks passed.");
