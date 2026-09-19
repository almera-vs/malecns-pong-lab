import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const vite = ["node_modules/vite/bin/vite.js"].find((candidate) => existsSync(candidate));
if (vite) {
  const result = spawnSync(process.execPath, [vite, "build", "--configLoader", "native"], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const { buildNative } = await import("./build-native.mjs");
  buildNative();
}
const verify = spawnSync(process.execPath, ["scripts/verify.mjs"], { stdio: "inherit" });
process.exit(verify.status ?? 1);
