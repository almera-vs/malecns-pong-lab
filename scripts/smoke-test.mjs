import { readFileSync } from "node:fs";
const html = readFileSync("dist/index.html", "utf8");
const js = readFileSync("dist/app.js", "utf8");
const all = `${html}\n${js}`;
for (const alternatives of [["MaleCNS Pong Lab"], ["brain-view"], ["retinalFrame", "image-only input"], ["rewardModulatedStdp", "reward-STDP"], ["Loading normal MaleCNS", "loadMaleCnsGraph"], ["Persistent 2D", "2D anatomical section"]]) {
  if (!alternatives.some((token) => all.includes(token))) throw new Error(`Smoke token missing: ${alternatives.join(" or ")}`);
}
for (const removed of ["activity-brain", "load-brain", "128 neurons"]) {
  if (all.includes(removed)) throw new Error(`Obsolete UI token present: ${removed}`);
}
console.log("Static smoke test passed.");
