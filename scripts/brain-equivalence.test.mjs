import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MaleCnsBrain, makeTestGraph } from "../src/brain.ts";
import { equivalenceDigest } from "./brain-equivalence-fixture.mjs";

test("optimized propagation preserves the original high-resolution trajectory", () => {
  assert.equal(
    equivalenceDigest(MaleCnsBrain, makeTestGraph),
    "7400748adec0137f9e500295cf7236b3ccc402550607e0e811e35a1139cbb076",
  );
});
