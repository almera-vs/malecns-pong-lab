import { describe, expect, it } from "vitest";
import { RewardCredit } from "./reward-credit";
import { rewardModulatedStdp } from "./brain";

describe("event-local teaching credit", () => {
  it("keeps each reward sign and its pre-event eligibility across delayed dopamine", () => {
    const credit = new RewardCredit();
    const eligibility = new Float32Array([0.5]);
    credit.enqueue(1, eligibility, true);
    credit.enqueue(-1, eligibility, true);
    eligibility[0] = -1; // Check temporal attribution: activity added after enqueue must not alter the captured eligibility.
    const updates: number[][] = [];
    const apply = (reward: number, trace: Float32Array | null) => updates.push([reward, trace![0]]);
    for (let tick=0;tick<100;tick++) credit.advance(0.1,0,apply);
    expect(updates).toEqual([]);
    credit.advance(0.1,1,apply);
    expect(updates).toEqual([[1,0.5],[-1,0.5]]);
    for (let tick=0;tick<100;tick++) credit.advance(0.1,1,apply);
    expect(updates).toHaveLength(2);
    expect(credit.stats).toEqual({applied:2,expired:0,pending:0});
  });

  it("expires without a dopamine response and clears queued credit on reset", () => {
    const credit = new RewardCredit();
    credit.enqueue(-1,new Float32Array([1]),true);
    for (let tick=0;tick<Math.ceil(RewardCredit.responseWindowMs/0.1)+1;tick++) credit.advance(0.1,0,()=>{throw Error("Ungated update");});
    expect(credit.stats).toEqual({applied:0,expired:1,pending:0});
    credit.enqueue(1,new Float32Array([1]),true);
    credit.reset();
    expect(credit.stats).toEqual({applied:0,expired:0,pending:0});
  });

  it("keeps a teaching event alive through the next interactive batch", () => {
    const credit = new RewardCredit();
    credit.enqueue(-1, new Float32Array([0.5]), true);
    let applied = 0;
    for (let tick = 0; tick < 5; tick++) credit.advance(4, 0, () => { throw Error("Premature update"); });
    credit.advance(4, 1, (reward, trace) => {
      expect(reward).toBe(-1);
      expect(trace?.[0]).toBe(0.5);
      applied++;
    });
    expect(applied).toBe(1);
    expect(credit.stats.pending).toBe(0);
  });

  it("does not retain trainable eligibility in a frozen-learning control", () => {
    const credit = new RewardCredit();
    credit.enqueue(1,new Float32Array([1]),false);
    credit.advance(0.1,1,(_reward,trace)=>expect(trace).toBeNull());
    expect(credit.stats.applied).toBe(0);
  });

  it("applies signed credit consistently across a reward reversal", () => {
    // Verify synaptic event-credit mechanics in isolation; this assay does not measure closed-loop task
    // learning.
    const credit = new RewardCredit();
    let weight=1;
    const apply=(reward:number,trace:Float32Array|null)=>{weight=rewardModulatedStdp(weight,1,trace![0],reward);};
    for(let event=0;event<20;event++) { credit.enqueue(1,new Float32Array([0.5]),true); credit.advance(1,1,apply); }
    const trained=weight;
    expect(trained).toBeGreaterThan(1.09);
    for(let event=0;event<40;event++) { credit.enqueue(-1,new Float32Array([0.5]),true); credit.advance(1,1,apply); }
    expect(weight).toBeLessThan(0.91);
  });

  it("retains side and directional action with delayed credit", () => {
    const credit = new RewardCredit();
    credit.enqueue(1, new Float32Array([0.5]), true, "left", "up");
    const updates: Array<[number, string | null, string | null]> = [];
    credit.advance(4, 1, (reward, _trace, side, action) => updates.push([reward, side, action]));
    expect(updates).toEqual([[1, "left", "up"]]);
  });
});
