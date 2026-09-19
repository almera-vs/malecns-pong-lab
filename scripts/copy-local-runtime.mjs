import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

/**
 * Package manifest-referenced browser artifacts while excluding raw source tables from the served
 * distribution.
 */
export function copyLocalRuntime(outputDirectory) {
  const sourceDirectory = resolve("public/data/runtime");
  const sourceManifest = resolve(sourceDirectory, "manifest.json");
  if (!existsSync(sourceManifest)) return 0;

  const manifest = JSON.parse(readFileSync(sourceManifest, "utf8"));
  const files = [manifest.metadata, ...(manifest.arrays ?? []).flatMap((array) => (array.parts ?? []).map((part) => part.file))];
  const names = [...new Set(files)];
  if (names.some((name) => typeof name !== "string" || basename(name) !== name || name === "." || name === "..")) {
    throw new Error("Local runtime manifest contains an unsafe browser asset path");
  }

  const destinationDirectory = resolve(outputDirectory, "data/runtime");
  mkdirSync(destinationDirectory, { recursive: true });
  for (const name of names) {
    const source = resolve(sourceDirectory, name);
    if (!source.startsWith(`${sourceDirectory}${sep}`) || !existsSync(source)) {
      throw new Error(`Local runtime asset is missing: ${name}`);
    }
    copyFileSync(source, resolve(destinationDirectory, name));
  }
  copyFileSync(sourceManifest, resolve(destinationDirectory, "manifest.json"));
  return names.length + 1;
}
