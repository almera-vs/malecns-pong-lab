import type { PaddleAction, PaddleSide } from "./types";

/**
 * Snapshot eligibility before reward stimulation and gate each event once on a subsequent teaching
 * spike. The default 32 ms response window limits gating latency, separately from eligibility decay;
 * display dopamine does not determine reward sign.
 */
export class RewardCredit {
  static readonly responseWindowMs = 32;
  private readonly responseWindowMs: number;
  constructor(responseWindowMs = RewardCredit.responseWindowMs) { this.responseWindowMs = responseWindowMs; }
  private events: Array<{ reward: number; side: PaddleSide | null; action: PaddleAction | null; remainingMs: number; eligibility: Float32Array | null }> = [];
  private applied = 0;
  private expired = 0;

  get pending(): number { return this.events.length; }
  get stats() { return { applied: this.applied, expired: this.expired, pending: this.pending }; }

  enqueue(reward: number, eligibility: Float32Array, learning: boolean, side: PaddleSide | null = null, action: PaddleAction | null = null): void {
    if (!Number.isFinite(reward)) throw new Error("Reward must be finite");
    if (reward === 0) return;
    this.events.push({ reward: Math.max(-1, Math.min(1, reward)), side, action, remainingMs: this.responseWindowMs, eligibility: learning ? eligibility.slice() : null });
  }

  advance(dtMs: number, dopamineSpikes: number, apply: (reward: number, eligibility: Float32Array | null, side: PaddleSide | null, action: PaddleAction | null) => void): void {
    this.events = this.events.filter((event) => {
      if (dopamineSpikes > 0) {
        apply(event.reward, event.eligibility, event.side, event.action);
        if (event.eligibility) this.applied++;
        return false;
      }
      event.remainingMs -= dtMs;
      if (event.remainingMs <= 1e-9) { if (event.eligibility) this.expired++; return false; }
      return true;
    });
  }

  reset(): void { this.events = []; this.applied = 0; this.expired = 0; }
}
