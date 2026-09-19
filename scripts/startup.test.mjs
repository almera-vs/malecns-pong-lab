import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as Thread } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { buildNative } from "./build-native.mjs";

// Exercise emitted application code, worker messaging, checksums, decompression, and a neural batch.
// Minimal DOM/canvas substitutes validate startup logic rather than browser appearance.
test("built app automatically loads, advances, and recovers from a failed download", async (t) => {
  const output = mkdtempSync(join(tmpdir(), "malecns-startup-"));
  const outputUrl = pathToFileURL(output + sep);
  buildNative(outputUrl);
  const threads = [];
  t.after(async () => {
    await Promise.all(threads.map((thread) => thread.terminate()));
    assert.ok(resolve(output).startsWith(resolve(tmpdir()) + sep));
    rmSync(output, { recursive: true, force: true });
  });
  const errors = [];
  const messages = [];
  const frames = [];
  const contexts = [];
  const elements = new Map();
  let failNextWorker = false;
  let finiteRects = 0;
  const context = () => {
    const result = new Proxy({}, { get: (target, key) => {
      if (key === "getImageData") return (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(128) });
      if (key === "fillRect") return (...values) => { assert.ok(values.every(Number.isFinite), "canvas receives only finite coordinates"); finiteRects++; };
      return target[key] ?? (() => {});
    }});
    contexts.push(result);
    return result;
  };
  const element = (id = "") => ({
    id, width: 800, height: 450, clientWidth: 600, clientHeight: 450,
    hidden: id === "retry-brain", disabled: false,
    checked: id === "learning" || id === "recurrence", textContent: "", innerHTML: "", style: {},
    handlers: new Map(), children: [], attributes: new Map(),
    getContext() { return this.ctx ??= context(); },
    addEventListener(name, fn) { this.handlers.set(name, fn); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; },
    setAttribute(name, value) { this.attributes.set(name, value); },
  });
  globalThis.document = {
    baseURI: outputUrl.href,
    hidden: false,
    querySelector: () => element("app"),
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener() {},
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.Worker = class {
    constructor(url) {
      const thread = new Thread(new URL("./worker-test-host.mjs", import.meta.url), { workerData: { entry: url.href, failManifest: failNextWorker } });
      failNextWorker = false;
      threads.push(thread);
      this.thread = thread;
      thread.on("message", (data) => {
        messages.push(data);
        try { this.onmessage?.({ data }); } catch (error) { errors.push(error); }
      });
      thread.on("error", (error) => { errors.push(error); this.onerror?.({ message: error.message, preventDefault() {} }); });
    }
    postMessage(data, transfer) { this.thread.postMessage(data, transfer); }
    terminate() { return this.thread.terminate(); }
  };
  const until = async (predicate) => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (Date.now() > deadline) throw new Error(`Startup timed out: ${elements.get("data-status")?.textContent}`);
      await delay(10);
    }
  };
  await import(new URL("app.js", outputUrl));
  await until(() => messages.some((item) => item.type === "ready"));
  assert.match(elements.get("data-status").textContent, /MaleCNS ready/);
  assert.match(elements.get("brain-label").textContent, /78 known soma positions/);
  assert.equal(elements.get("retry-brain").hidden, true);
  assert.equal(elements.get("pause").disabled, false);
  assert.ok(finiteRects > 0);
  await until(() => messages.some((item) => item.type === "step"));
  assert.equal(elements.get("neural-time").textContent, `t = ${messages.find((item) => item.type === "step").output.neuralTimeMs.toFixed(1)} ms`);
  frames.shift()(performance.now());
  const motorProfile = JSON.parse(elements.get("timing").attributes.get("data-profile"));
  assert.ok(motorProfile.jointAnglesRad.every(Number.isFinite));
  motorProfile.jointAnglesRad.forEach((angle, side) => assert.ok(Math.abs(motorProfile.paddleTargets[side] - (180 + Math.sin(angle) * 180)) < 1e-9, "paddle follows measured joint angle"));
  // Verify that neural progress does not depend on whether a display frame has been painted.
  await until(() => messages.filter((item) => item.type === "step").length >= 3);
  assert.equal(frames.length, 1, "one independent animation loop, not one per batch");
  const stepCount = messages.filter((item) => item.type === "step").length;
  for (let i = 0; i < 10; i++) frames.shift()(performance.now() + i * 16);
  assert.equal(messages.filter((item) => item.type === "step").length, stepCount, "animation never advances neural time");
  assert.equal(frames.length, 1);
  elements.get("pause").handlers.get("click")();
  await delay(40);
  const pausedCount = messages.filter((item) => item.type === "step").length;
  await delay(40);
  assert.equal(messages.filter((item) => item.type === "step").length, pausedCount);
  elements.get("pause").handlers.get("click")();
  await until(() => messages.filter((item) => item.type === "step").length > pausedCount);
  elements.get("reset-brain").handlers.get("click")();
  await until(() => messages.some((item) => item.type === "reset"));
  await until(() => messages.slice(messages.findIndex((item) => item.type === "reset") + 1).some((item) => item.type === "step"));
  assert.equal(errors.length, 0);

  // Check recovery through a fresh worker after download failure so a failed acquisition cannot
  // masquerade as a valid loaded experiment.
  failNextWorker = true;
  messages.length = 0;
  frames.length = 0;
  elements.get("retry-brain").handlers.get("click")();
  await until(() => !elements.get("retry-brain").hidden);
  assert.match(elements.get("data-status").textContent, /Download failed \(404\)/);
  assert.equal(elements.get("pause").disabled, true);
  messages.length = 0;
  elements.get("retry-brain").handlers.get("click")();
  await until(() => messages.some((item) => item.type === "ready"));
  assert.equal(elements.get("retry-brain").hidden, true);
  assert.equal(errors.length, 0);
});
