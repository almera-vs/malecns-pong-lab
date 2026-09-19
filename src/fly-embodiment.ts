/**
 * Define an engineered actuator plant from annotated antagonist motor pools to two paddle coordinates.
 * Its activation and joint parameters are modeling choices, not measurements from the reconstructed
 * fly.
 */
export type ForelegMuscleRates = [leftFlexorHz: number, leftExtensorHz: number, rightFlexorHz: number, rightExtensorHz: number];
/**
 * Convert committed neural duration to the shared body/environment time increment, independent of
 * rendering latency.
 */
export function bodyStepSeconds(output: { simulatedDurationMs: number }): number {
  if (!Number.isFinite(output.simulatedDurationMs) || output.simulatedDurationMs <= 0) throw new Error("Invalid neural batch duration");
  return output.simulatedDurationMs / 1000;
}

export interface EmbodimentFrame {
  paddleTargets: [number, number];
  /**
   * Direction inferred from antagonist activation difference before passive and adaptive mechanical
   * forces.
   */
  paddleActions: ["up" | "down" | null, "up" | "down" | null];
  jointAnglesRad: [number, number];
  jointVelocityRad: [number, number];
  muscleActivation: [number, number, number, number];
}

export class FlyPaddleEmbodiment {
  // Normalize filtered pool-average firing rates by an assumed 45 Hz saturation scale; pool size alone
  // does not determine muscle activation.
  static readonly maxMotorRateHz = 45;
  static readonly activationRiseSeconds = 0.026;
  // Use slower activation decay than rise as a phenomenological muscle-memory approximation; no calcium
  // or cross-bridge states are simulated.
  static readonly activationFallSeconds = 0.11;
  static readonly motorRateSmoothingSeconds = 0.05;
  static readonly maxJointSpeedRadPerSecond = 3.2;
  static readonly jointAcceleration = 58;
  static readonly jointDamping = 2.2;
  /** Passive linear restoring coefficient in the engineered joint plant. */
  static readonly jointStiffness = 0.10;
  /** Joint-angle threshold at which nonlinear endpoint recovery begins, in radians. */
  static readonly jointLimitStartRad = 1.05;
  /** Quadratic endpoint restoring coefficient, expressed in the plant's normalized torque units. */
  static readonly jointLimitStiffness = 1.05;
  /**
   * Time scale for adapting sustained outward drive near a joint limit; this introduces actuator
   * memory.
   */
  static readonly endpointBiasAdaptationSeconds = 0.32;
  static readonly endpointBiasDecaySeconds = 0.65;

  private readonly activation = new Float64Array(4);
  private readonly filteredRate = new Float64Array(4);
  private readonly sideDrive = new Float64Array(2);
  private readonly sideGain = new Float64Array([1, 1]);
  private readonly endpointBias = new Float64Array(2);
  private readonly angle = new Float64Array(2);
  private readonly angularVelocity = new Float64Array(2);

  reset(): void {
    this.activation.fill(0);
    this.filteredRate.fill(0);
    this.sideDrive.fill(0);
    this.sideGain.fill(1);
    this.endpointBias.fill(0);
    this.angle.fill(0);
    this.angularVelocity.fill(0);
  }

  step(ratesHz: ForelegMuscleRates, dtSeconds: number, courtHeight = 450, paddleHeight = 90): EmbodimentFrame {
    if (!(dtSeconds > 0) || ratesHz.some((rate) => !Number.isFinite(rate) || rate < 0)) throw new Error("Invalid motor activity or embodiment timestep");
    for (let index = 0; index < 4; index += 1) {
      // Filter rates before saturation to reduce bias from unequal spike-sampling variance in
      // differently sized motor pools.
      this.filteredRate[index] += (ratesHz[index] - this.filteredRate[index]) * (1 - Math.exp(-dtSeconds / FlyPaddleEmbodiment.motorRateSmoothingSeconds));
      const target = Math.min(1, this.filteredRate[index] / FlyPaddleEmbodiment.maxMotorRateHz);
      const tau = target > this.activation[index] ? FlyPaddleEmbodiment.activationRiseSeconds : FlyPaddleEmbodiment.activationFallSeconds;
      this.activation[index] += (target - this.activation[index]) * (1 - Math.exp(-dtSeconds / tau));
    }

    // Adapt bilateral torque gain from recent antagonist drive. This mechanical normalization couples
    // the two actuators and must be controlled in behavioral comparisons.
    const sideDriveAlpha = 1 - Math.exp(-dtSeconds / 0.24);
    for (let side = 0; side < 2; side += 1) {
      const flexor = this.activation[side * 2];
      const extensor = this.activation[side * 2 + 1];
      this.sideDrive[side] += (Math.abs(extensor - flexor) - this.sideDrive[side]) * sideDriveAlpha;
    }
    const referenceDrive = (this.sideDrive[0] + this.sideDrive[1]) / 2;
    const sideGainAlpha = 1 - Math.exp(-dtSeconds / 0.24);
    for (let side = 0; side < 2; side += 1) {
      const flexor = this.activation[side * 2];
      const extensor = this.activation[side * 2 + 1];
      const desiredGain = referenceDrive > 0.02 ? clamp(referenceDrive / Math.max(0.02, this.sideDrive[side]), 0.65, 1.35) : 1;
      this.sideGain[side] += (desiredGain - this.sideGain[side]) * sideGainAlpha;
      // Combine active muscle drive with learned endpoint bias and passive restoring forces. Paddle
      // motion therefore reflects both neural output and engineered mechanics.
      const muscleTorque = (extensor - flexor) * this.sideGain[side];
      const endpointFactor = endpointFactorFor(this.angle[side]);
      const outwardDrive = muscleTorque * Math.sign(this.angle[side]);
      if (endpointFactor > 0 && outwardDrive > 0) {
        const alpha = 1 - Math.exp(-dtSeconds / FlyPaddleEmbodiment.endpointBiasAdaptationSeconds);
        this.endpointBias[side] += (outwardDrive - this.endpointBias[side]) * alpha * endpointFactor;
      } else {
        this.endpointBias[side] *= Math.exp(-dtSeconds / FlyPaddleEmbodiment.endpointBiasDecaySeconds);
      }
      const biasTorque = Math.sign(this.angle[side]) * this.endpointBias[side];
      const limitTorque = Math.sign(this.angle[side]) * FlyPaddleEmbodiment.jointLimitStiffness * endpointFactor * endpointFactor;
      const torque = muscleTorque - biasTorque - this.angle[side] * FlyPaddleEmbodiment.jointStiffness - limitTorque;
      this.angularVelocity[side] = clamp(
        this.angularVelocity[side] + (torque * FlyPaddleEmbodiment.jointAcceleration - this.angularVelocity[side] * FlyPaddleEmbodiment.jointDamping) * dtSeconds,
        -FlyPaddleEmbodiment.maxJointSpeedRadPerSecond,
        FlyPaddleEmbodiment.maxJointSpeedRadPerSecond,
      );
      const nextAngle = this.angle[side] + this.angularVelocity[side] * dtSeconds;
      if (nextAngle >= Math.PI / 2) {
        this.angle[side] = Math.PI / 2;
        // Remove outward velocity at hard contact to enforce the unilateral joint constraint.
        this.angularVelocity[side] = Math.min(0, this.angularVelocity[side]);
      } else if (nextAngle <= -Math.PI / 2) {
        this.angle[side] = -Math.PI / 2;
        this.angularVelocity[side] = Math.max(0, this.angularVelocity[side]);
      } else {
        this.angle[side] = nextAngle;
      }
    }

    const center = (courtHeight - paddleHeight) / 2;
    const travel = center;
    return {
      paddleTargets: [center + Math.sin(this.angle[0]) * travel, center + Math.sin(this.angle[1]) * travel],
      paddleActions: [actionFor(this.activation[1] - this.activation[0]), actionFor(this.activation[3] - this.activation[2])],
      jointAnglesRad: [this.angle[0], this.angle[1]],
      jointVelocityRad: [this.angularVelocity[0], this.angularVelocity[1]],
      muscleActivation: [...this.activation] as [number, number, number, number],
    };
  }
}

function actionFor(torque: number): "up" | "down" | null {
  if (torque < -0.015) return "up";
  if (torque > 0.015) return "down";
  return null;
}

function endpointFactorFor(angle: number): number {
  const magnitude = Math.abs(angle);
  const range = Math.PI / 2 - FlyPaddleEmbodiment.jointLimitStartRad;
  if (magnitude <= FlyPaddleEmbodiment.jointLimitStartRad || range <= 0) return 0;
  return clamp((magnitude - FlyPaddleEmbodiment.jointLimitStartRad) / range, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
