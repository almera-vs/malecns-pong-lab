import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const build = spawnSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const core = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/core-test.mjs"], { stdio: "inherit" });
if (core.status !== 0) process.exit(core.status ?? 1);
const startup = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "scripts/loader.test.mjs", "scripts/startup.test.mjs", "scripts/display.test.mjs", "scripts/brain-equivalence.test.mjs"], { stdio: "inherit" });
if (startup.status !== 0) process.exit(startup.status ?? 1);
const vitest = existsSync("node_modules/vitest/vitest.mjs") ? "node_modules/vitest/vitest.mjs" : null;
if (vitest) {
  const result = spawnSync(process.execPath, [vitest, "run", "--configLoader", "native", "--exclude", "scripts/**"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
const smoke = spawnSync(process.execPath, ["scripts/smoke-test.mjs"], { stdio: "inherit" });
if (smoke.status !== 0) process.exit(smoke.status ?? 1);
