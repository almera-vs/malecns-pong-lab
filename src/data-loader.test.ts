import { describe, expect, it } from "vitest";
import { validateCsr } from "./data-loader";

describe("CSR validation", () => {
  it("accepts bounded target-oriented CSR arrays", () => {
    expect(() => validateCsr(new Uint32Array([0, 1, 2]), new Uint32Array([1, 0]), new Uint32Array([2, 1]), 2)).not.toThrow();
  });

  it("rejects non-monotonic offsets and out-of-range IDs", () => {
    expect(() => validateCsr(new Uint32Array([0, 2, 1, 2]), new Uint32Array([1, 0]), new Uint32Array([2, 1]), 3)).toThrow(/monotonic/);
    expect(() => validateCsr(new Uint32Array([0, 1, 2]), new Uint32Array([2, 0]), new Uint32Array([2, 1]), 2)).toThrow(/out of bounds/);
  });
});
