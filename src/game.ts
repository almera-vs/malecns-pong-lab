import type { GameEvent, PaddleAction, PaddleSide } from "./types";

const BALL_HORIZONTAL_SPEED = 230;
// Bound post-point serve angles to provide reachable collision opportunities. This task-design choice
// creates a baseline advantage for centered paddles and needs an explicit control.
const MIN_SERVE_VERTICAL_SPEED = 12;
const MAX_SERVE_VERTICAL_SPEED = 32;
const MIN_BALL_VERTICAL_SPEED = 24;
const MAX_BALL_VERTICAL_SPEED = 180;
const PADDLE_BOUNCE_RETENTION = 0.82;
const PADDLE_BOUNCE_IMPACT_GAIN = 85;
const PADDLE_BOUNCE_JITTER = 16;

export interface GameState {
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  leftY: number;
  rightY: number;
  scoreLeft: number;
  scoreRight: number;
  rally: number;
  hits: number;
  misses: number;
}

/**
 * Integrate the seeded task environment. Scene coordinates remain on the environment side of the
 * interface; the brain receives image channels, joint feedback, and labeled teaching events.
 */
export class PongGame {
  readonly width = 800;
  readonly height = 450;
  readonly paddleHeight = 90;
  readonly paddleWidth = 12;
  /** Paddle side attributed to the current collision or escape event; cleared at each step. */
  eventSide: PaddleSide | null = null;
  /** Sparse outcome reward: +1 for paddle contact, -1 for escape, and zero otherwise. */
  reward = 0;
  /**
   * Engineered miss indicator used to stimulate the teaching gateway; not an anatomical nociceptive
   * measurement.
   */
  pain = 0;
  /** Action label used for structural credit assignment at the current reward event. */
  eventAction: PaddleAction | null = null;
  private serveDirection: 1 | -1 = 1;
  private rngState: number;
  readonly state: GameState = {
    ballX: 400,
    ballY: 225,
    ballVX: BALL_HORIZONTAL_SPEED,
    ballVY: 120,
    leftY: 180,
    rightY: 180,
    scoreLeft: 0,
    scoreRight: 0,
    rally: 0,
    hits: 0,
    misses: 0,
  };

  constructor(seed = 0x5eed1234) {
    this.rngState = seed >>> 0;
  }

  reset(seed = this.rngState): void {
    this.rngState = seed >>> 0;
    this.serveDirection = 1;
    Object.assign(this.state, {
      ballX: 400,
      ballY: 225,
      ballVX: BALL_HORIZONTAL_SPEED * this.serveDirection,
      ballVY: this.nextServeVerticalVelocity(),
      leftY: 180,
      rightY: 180,
      scoreLeft: 0,
      scoreRight: 0,
      rally: 0,
      hits: 0,
      misses: 0,
    });
    this.eventSide = null;
    this.reward = 0;
    this.pain = 0;
    this.eventAction = null;
  }

  step(paddleTargets: [number, number], dt = 0.01, neuralActions: [PaddleAction | null, PaddleAction | null] = [null, null]): GameEvent {
    this.eventSide = null;
    this.reward = 0;
    this.pain = 0;
    this.eventAction = null;
    const previousPaddleCenters: [number, number] = [
      this.state.leftY + this.paddleHeight / 2,
      this.state.rightY + this.paddleHeight / 2,
    ];
    const maxTravel = 330 * dt;
    this.state.leftY = clamp(this.state.leftY + clamp(paddleTargets[0] - this.state.leftY, -maxTravel, maxTravel), 0, this.height - this.paddleHeight);
    this.state.rightY = clamp(this.state.rightY + clamp(paddleTargets[1] - this.state.rightY, -maxTravel, maxTravel), 0, this.height - this.paddleHeight);
    // Prefer the supplied antagonist-action label, with displacement as a fallback. Inertia and passive
    // forces can separate this label from the paddle's instantaneous motion.
    const paddleActions: [PaddleAction | null, PaddleAction | null] = [
      neuralActions[0] ?? actionFor(this.state.leftY - (previousPaddleCenters[0] - this.paddleHeight / 2)),
      neuralActions[1] ?? actionFor(this.state.rightY - (previousPaddleCenters[1] - this.paddleHeight / 2)),
    ];
    this.state.ballX += this.state.ballVX * dt;
    this.state.ballY += this.state.ballVY * dt;

    if (this.state.ballY < 8) {
      this.state.ballY = 8;
      this.state.ballVY = Math.abs(this.state.ballVY);
    } else if (this.state.ballY > this.height - 8) {
      this.state.ballY = this.height - 8;
      this.state.ballVY = -Math.abs(this.state.ballVY);
    }

    if (this.state.ballX < 32 && this.state.ballVX < 0 && this.overlapsPaddle(this.state.leftY)) {
      this.state.ballX = 32;
      this.bounceFromPaddle(this.state.leftY, 1);
      this.state.rally += 1;
      this.state.hits += 1;
      this.eventSide = "left";
      this.eventAction = paddleActions[0];
      this.reward = 1;
      return "paddle_hit";
    }
    if (this.state.ballX > this.width - 32 && this.state.ballVX > 0 && this.overlapsPaddle(this.state.rightY)) {
      this.state.ballX = this.width - 32;
      this.bounceFromPaddle(this.state.rightY, -1);
      this.state.rally += 1;
      this.eventSide = "right";
      this.eventAction = paddleActions[1];
      this.reward = 1;
      return "paddle_hit";
    }
    if (this.state.ballX < -10) {
      this.state.scoreRight += 1;
      this.state.misses += 1;
      this.resetBall();
      this.eventSide = "left";
      this.eventAction = paddleActions[0];
      this.reward = -1;
      this.pain = 1;
      return "miss";
    }
    if (this.state.ballX > this.width + 10) {
      this.state.scoreLeft += 1;
      this.state.misses += 1;
      this.resetBall();
      this.eventSide = "right";
      this.eventAction = paddleActions[1];
      this.reward = -1;
      this.pain = 1;
      return "miss";
    }
    // Emit no teaching reward between collisions and escapes; this implementation contains no
    // continuous alignment-shaping objective.
    return "none";
  }

  render(canvas: HTMLCanvasElement, state: GameState = this.state): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");
    ctx.fillStyle = "#08111f";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = "#233653";
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2, this.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#67e8f9";
    ctx.fillRect(20, state.leftY, this.paddleWidth, this.paddleHeight);
    ctx.fillStyle = "#f0abfc";
    ctx.fillRect(this.width - 32, state.rightY, this.paddleWidth, this.paddleHeight);
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  private overlapsPaddle(paddleY: number): boolean {
    return this.state.ballY > paddleY - 8 && this.state.ballY < paddleY + this.paddleHeight + 8;
  }

  private resetBall(): void {
    this.state.ballX = this.width / 2;
    this.state.ballY = this.height / 2;
    this.serveDirection = this.serveDirection === 1 ? -1 : 1;
    this.state.ballVX = BALL_HORIZONTAL_SPEED * this.serveDirection;
    this.state.ballVY = this.nextServeVerticalVelocity();
    this.state.rally = 0;
  }

  private bounceFromPaddle(paddleY: number, direction: number): void {
    const paddleCenter = paddleY + this.paddleHeight / 2;
    const impact = clamp((this.state.ballY - paddleCenter) / (this.paddleHeight / 2), -1, 1);
    const jitter = (this.nextRandom() - 0.5) * 2 * PADDLE_BOUNCE_JITTER;
    const vertical = this.state.ballVY * PADDLE_BOUNCE_RETENTION + impact * PADDLE_BOUNCE_IMPACT_GAIN + jitter;
    const minimum = Math.abs(vertical) >= MIN_BALL_VERTICAL_SPEED
      ? vertical
      : (vertical < 0 ? -MIN_BALL_VERTICAL_SPEED : MIN_BALL_VERTICAL_SPEED);
    this.state.ballVY = clamp(minimum, -MAX_BALL_VERTICAL_SPEED, MAX_BALL_VERTICAL_SPEED);
    this.state.ballVX = Math.abs(this.state.ballVX) * direction * 1.02;
  }

  private nextServeVerticalVelocity(): number {
    const signed = this.nextRandom() * 2 - 1;
    const sign = signed < 0 ? -1 : 1;
    return sign * (MIN_SERVE_VERTICAL_SPEED + Math.abs(signed) * (MAX_SERVE_VERTICAL_SPEED - MIN_SERVE_VERTICAL_SPEED));
  }

  private nextRandom(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }
}

/**
 * Interpolate committed states for presentation while preserving the discrete states used for physics
 * and retinal input.
 */
export class GamePresentation {
  private from: GameState;
  private target: GameState;
  private started = 0;
  private duration = 1;

  constructor(state: GameState) { this.from = { ...state }; this.target = { ...state }; }

  reset(state: GameState): void {
    this.from = { ...state }; this.target = { ...state };
    this.started = 0; this.duration = 1;
  }

  commit(state: GameState, now: number, durationMs: number): void {
    // Treat serves as discontinuities so display interpolation does not imply an unobserved ball
    // trajectory.
    if (state.scoreLeft !== this.target.scoreLeft || state.scoreRight !== this.target.scoreRight) {
      this.reset(state);
      return;
    }
    this.from = this.sample(now);
    this.target = { ...state };
    this.started = now;
    this.duration = Math.max(16, Math.min(250, durationMs));
  }

  sample(now: number): GameState {
    const alpha = Math.max(0, Math.min(1, (now - this.started) / this.duration));
    const state = { ...this.target };
    for (const key of ["ballX", "ballY", "leftY", "rightY"] as const) {
      state[key] = this.from[key] + (this.target[key] - this.from[key]) * alpha;
    }
    return state;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function actionFor(delta: number): PaddleAction | null {
  if (delta < -0.01) return "up";
  if (delta > 0.01) return "down";
  return null;
}
