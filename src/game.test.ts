import { describe, expect, it } from "vitest";
import { PongGame } from "./game";

describe("Pong environment", () => {
  it("keeps game state outside the neural input contract", () => {
    const game = new PongGame(42);
    const before = { ...game.state };
    game.step([140, 220], 0.01);
    expect(game.state.leftY).not.toBe(before.leftY);
    expect(game.state.rightY).not.toBe(before.rightY);
    expect(game.state.ballX).not.toBe(before.ballX);
  });

  it("does not reward centering or ball-following before a collision", () => {
    const game = new PongGame(42);
    game.state.ballX = 120;
    game.state.ballY = 250;
    game.state.ballVX = -230;
    game.state.ballVY = 0;
    game.state.leftY = 180;
    expect(game.step([190, 180], 0.01)).toBe("none");
    expect(game.eventSide).toBeNull();
    expect(game.eventAction).toBeNull();
    expect(game.reward).toBe(0);
  });

  it("alternates serve direction after each point", () => {
    const game = new PongGame(42);
    game.state.ballX = game.width + 11;
    game.state.ballY = 0;
    game.state.ballVX = 230;
    expect(game.step([180, 180], 0.01)).toBe("miss");
    expect(game.eventSide).toBe("right");
    expect(game.pain).toBe(1);
    expect(game.state.ballVX).toBe(-230);

    game.state.ballX = -11;
    game.state.ballY = 0;
    game.state.ballVX = -230;
    expect(game.step([180, 180], 0.01)).toBe("miss");
    expect(game.eventSide).toBe("left");
    expect(game.pain).toBe(1);
    expect(game.state.ballVX).toBe(230);
  });

  it("resets deterministically", () => {
    const first = new PongGame(42);
    const second = new PongGame(42);
    for (let i = 0; i < 100; i += 1) {
      first.step([180, 180], 0.01);
      second.step([180, 180], 0.01);
    }
    expect(first.state).toEqual(second.state);
  });

  it("allows a centered paddle to receive a serve", () => {
    const game = new PongGame(123);
    let hits = 0;
    for (let step = 0; step < 6250; step += 1) {
      if (game.step([180, 180], 0.016) === "paddle_hit") hits += 1;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it("gives serves and paddle hits a non-horizontal, impact-sensitive trajectory", () => {
    const serve = new PongGame(42);
    serve.reset(42);
    expect(Math.abs(serve.state.ballVY)).toBeGreaterThanOrEqual(12);

    const centered = new PongGame(9);
    centered.state.ballX = 40;
    centered.state.ballY = 225;
    centered.state.ballVX = -230;
    centered.state.ballVY = 0;
    centered.state.leftY = 180;
    expect(centered.step([180, 180], 0.05)).toBe("paddle_hit");
    expect(centered.eventSide).toBe("left");
    expect(Math.abs(centered.state.ballVY)).toBeGreaterThanOrEqual(24);

    const highImpact = new PongGame(9);
    highImpact.state.ballX = 40;
    highImpact.state.ballY = 190;
    highImpact.state.ballVX = -230;
    highImpact.state.ballVY = 0;
    highImpact.state.leftY = 180;
    expect(highImpact.step([180, 180], 0.05)).toBe("paddle_hit");
    expect(highImpact.state.ballVY).toBeLessThan(centered.state.ballVY);

    const right = new PongGame(9);
    right.state.ballX = 760;
    right.state.ballY = 225;
    right.state.ballVX = 230;
    right.state.ballVY = 0;
    right.state.rightY = 180;
    expect(right.step([180, 180], 0.05)).toBe("paddle_hit");
    expect(right.eventSide).toBe("right");
  });
});
