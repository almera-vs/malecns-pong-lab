import { describe, expect, it } from "vitest";
import { buildFlyAnatomy, buildFlyLegs, forelegPose } from "./fly-mesh";

describe("fly display kinematics", () => {
  it("lifts the foot visibly with flexion while keeping each segment rigid and sides mirrored", () => {
    const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v,i)=>v-b[i]));
    const rest=forelegPose(1,0);
    for(const angle of [-1.57,-0.7,0,0.7,1.57]) {
      const right=forelegPose(1,angle),left=forelegPose(-1,angle);
      right.forEach((p,i)=>{ expect(left[i][0]).toBe(-p[0]); expect(left[i].slice(1)).toEqual(p.slice(1)); });
      for(let i=0;i<rest.length-1;i++) expect(distance(right[i],right[i+1])).toBeCloseTo(distance(rest[i],rest[i+1]),6);
    }
    expect(forelegPose(1,-0.7)[4][1]-forelegPose(1,0.7)[4][1]).toBeGreaterThan(0.6);
  });
  it("does not flatten either end of the physical joint range", () => {
    for(const side of [-1,1]) {
      let previous=forelegPose(side,-Math.PI/2)[3];
      for(let angle=-Math.PI/2+0.01;angle<=Math.PI/2;angle+=0.01) {
        const ankle=forelegPose(side,angle)[3];
        expect(Math.hypot(...ankle.map((v,i)=>v-previous[i]))).toBeGreaterThan(0.006);
        previous=ankle;
      }
      expect(forelegPose(side,0.8)).not.toEqual(forelegPose(side,1.5));
      expect(forelegPose(side,-0.8)).not.toEqual(forelegPose(side,-1.5));
    }
  });
  it("produces finite triangle buffers and does not invent motion with zero activity", () => {
    const {body,wings}=buildFlyAnatomy();
    const legs=buildFlyLegs([0,0],[0,0,0,0]);
    for(const mesh of [body,wings,legs]) { expect(mesh.length%27).toBe(0); expect(mesh.every(Number.isFinite)).toBe(true); }
    expect(buildFlyLegs([0,0],[0,0,0,0])).toEqual(legs);
    expect(buildFlyLegs([-0.7,0.7],[1,0,0,1])).not.toEqual(legs);
  });
});
