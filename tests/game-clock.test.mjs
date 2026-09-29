import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createGameClock, HITSTOP_SINGLE_CAP_MS } from "../src/game/loop/game-clock.ts";

/** The fixed-step accumulator exactly as sim-driver runs it (GAME_DESIGN 10.3), without physics. */
function runFrames(clock, { frames, wallDt, dt, maxSteps = 16, onStep }) {
  let steps = 0;
  for (let f = 0; f < frames; f++) {
    const wall = Math.min(wallDt, 0.1);
    clock.advanceWall(wall);
    const frozen = clock.hitstopRemainingMs > 0;
    if (!clock.paused && !clock.externalDrive && !frozen) clock.acc += wall * clock.timeScale;
    let n = 0;
    while (clock.acc >= dt && n < maxSteps) {
      clock.acc -= dt;
      clock.setSimTime(clock.simTime + dt);
      n++; steps++;
      if (onStep?.(steps)) { clock.acc = 0; break; }
    }
    if (n === maxSteps) clock.acc = 0;
    clock.setRenderAlpha(clock.hitstopRemainingMs > 0 ? 1 : clock.acc / dt);
  }
  return steps;
}

describe("game clock: accumulator and real-time factor", () => {
  for (const [preset, dt] of [["arcade", 0.0025], ["proving_ground", 0.005], ["harness 600 Hz", 1 / 600]]) {
    test(`${preset}: 60 s of wall time advances sim time 60.0 s ± 0.5%`, () => {
      const clock = createGameClock({ hitstop: false, dilation: false });
      runFrames(clock, { frames: 3600, wallDt: 1 / 60, dt });
      assert.ok(Math.abs(clock.simTime - 60) <= 0.3, `simTime ${clock.simTime}`);
      assert.ok(Math.abs(clock.wallTime - 60) < 1e-9);
    });
  }

  test("uneven frame times (display jitter) still track wall time", () => {
    const clock = createGameClock({ hitstop: false, dilation: false });
    const pattern = [0.012, 0.021, 0.0167, 0.009, 0.025];
    let wall = 0;
    for (let i = 0; i < 3000; i++) { const w = pattern[i % pattern.length]; wall += w; runFrames(clock, { frames: 1, wallDt: w, dt: 0.0025 }); }
    assert.ok(Math.abs(clock.simTime - wall) <= wall * 0.005, `sim ${clock.simTime} wall ${wall}`);
  });

  test("render alpha is the leftover fraction of a step, clamped to [0, 1]", () => {
    const clock = createGameClock();
    runFrames(clock, { frames: 1, wallDt: 0.006, dt: 0.0025 });
    assert.ok(Math.abs(clock.alpha - 0.4) < 1e-9, `alpha ${clock.alpha}`);
    clock.setRenderAlpha(4); assert.equal(clock.alpha, 1);
    clock.setRenderAlpha(-1); assert.equal(clock.alpha, 0);
  });

  test("a long frame is clamped to 100 ms and catch-up is capped (no spiral of death)", () => {
    const clock = createGameClock({ hitstop: false, dilation: false });
    const steps = runFrames(clock, { frames: 1, wallDt: 2.0, dt: 0.0025, maxSteps: 16 });
    assert.equal(steps, 16);
    assert.equal(clock.acc, 0, "time beyond the cap is dropped");
  });

  test("pause stops sim time and holds the freeze countdown; wall time keeps going", () => {
    const clock = createGameClock();
    clock.requestHitstop(60);
    clock.paused = true;
    runFrames(clock, { frames: 30, wallDt: 1 / 60, dt: 0.0025 });
    assert.equal(clock.simTime, 0);
    assert.equal(clock.hitstopRemainingMs, 60);
    assert.ok(clock.wallTime > 0.49);
    clock.paused = false;
    runFrames(clock, { frames: 30, wallDt: 1 / 60, dt: 0.0025 });
    assert.equal(clock.hitstopRemainingMs, 0);
    assert.ok(clock.simTime > 0.4);
  });

  test("external drive (replay player) stops stepping and clears the accumulator", () => {
    const clock = createGameClock();
    clock.acc = 0.002;
    clock.setExternalDrive(true);
    assert.equal(clock.acc, 0);
    runFrames(clock, { frames: 60, wallDt: 1 / 60, dt: 0.0025 });
    assert.equal(clock.simTime, 0);
    assert.equal(clock.externalDrive, true);
    clock.setExternalDrive(false);
    runFrames(clock, { frames: 60, wallDt: 1 / 60, dt: 0.0025 });
    assert.ok(Math.abs(clock.simTime - 1) < 0.01);
  });
});

describe("game clock: hit stop", () => {
  test("freezes sim steps for the granted wall time, then resumes", () => {
    const clock = createGameClock();
    let frozenFrames = 0;
    let hit = false;
    runFrames(clock, {
      frames: 1, wallDt: 1 / 60, dt: 0.0025,
      onStep: (s) => { if (s === 3 && !hit) { hit = true; return clock.requestHitstop(48) > 0; } return false; },
    });
    const simAtImpact = clock.simTime;
    assert.ok(Math.abs(simAtImpact - 0.0075) < 1e-12, "no step after the impact step in that frame");
    assert.equal(clock.alpha, 1, "render holds the impact step");
    for (let f = 0; f < 10 && clock.hitstopRemainingMs > 0; f++) {
      runFrames(clock, { frames: 1, wallDt: 1 / 60, dt: 0.0025 });
      if (clock.simTime === simAtImpact) frozenFrames++;
    }
    assert.equal(frozenFrames, 2, "48 ms at 60 fps: the impact frame plus two held frames show the impact step");
    runFrames(clock, { frames: 1, wallDt: 1 / 60, dt: 0.0025 });
    assert.ok(clock.simTime > simAtImpact);
  });

  test("hitstopTotalMs is the length of the current freeze and clears with it", () => {
    const clock = createGameClock();
    assert.equal(clock.hitstopTotalMs, 0);
    assert.equal(clock.requestHitstop(80), 80);
    assert.equal(clock.hitstopTotalMs, 80);
    clock.advanceWall(0.03);
    assert.equal(clock.hitstopTotalMs, 80, "total holds while the freeze counts down");
    assert.equal(clock.requestHitstop(100), 40, "max-merge extends by the part beyond the remaining 50, trimmed to the 120 ms budget");
    assert.equal(clock.hitstopTotalMs, 90, "a re-grant restarts the fraction from the new length");
    clock.advanceWall(0.2);
    assert.equal(clock.hitstopRemainingMs, 0);
    assert.equal(clock.hitstopTotalMs, 0);
  });

  test("single cap 150 ms and max-merge (extension only)", () => {
    const clock = createGameClock();
    assert.equal(HITSTOP_SINGLE_CAP_MS, 150);
    assert.equal(clock.requestHitstop(400), 120, "cap 150, then trimmed to the 120 ms budget of a fresh window");
    const c2 = createGameClock();
    assert.equal(c2.requestHitstop(40), 40);
    assert.equal(c2.requestHitstop(30), 0, "shorter request inside a longer freeze adds nothing");
    assert.equal(c2.requestHitstop(70), 30, "longer request extends to its own length");
    assert.equal(c2.hitstopRemainingMs, 70);
    c2.advanceWall(1);                                         // let the window roll past
    assert.equal(c2.hitstopRemainingMs, 0);
    assert.equal(c2.requestHitstop(149.5), 120);
    c2.advanceWall(1);
    assert.equal(c2.hitstopBudgetUsedMs, 0);
  });

  test("zero, negative, and NaN requests grant nothing", () => {
    const clock = createGameClock();
    for (const v of [0, -5, Number.NaN]) assert.equal(clock.requestHitstop(v), 0);
    assert.equal(clock.hitstopRemainingMs, 0);
  });

  test("Proving Ground and Harness: hit stop and dilation are inert", () => {
    const clock = createGameClock({ hitstop: false, dilation: false });
    assert.equal(clock.requestHitstop(90), 0);
    clock.requestDilation(0.35, 400, 500);
    assert.equal(clock.timeScale, 1);
    assert.equal(clock.hitstopRemainingMs, 0);
  });

  test("configure switches features per match and clears anything in flight", () => {
    const clock = createGameClock();
    clock.requestHitstop(50);
    clock.requestDilation(0.5, 100, 100);
    clock.configure({ hitstop: false, dilation: false });
    assert.equal(clock.hitstopRemainingMs, 0);
    assert.equal(clock.timeScale, 1);
    clock.configure({ hitstop: true, dilation: true });
    assert.equal(clock.requestHitstop(21), 21);
  });
});

describe("game clock: dilation (Arcade KO: 0.35× for 400 ms, back to 1.0 by 900 ms)", () => {
  test("holds, eases smoothly, and ends at exactly 1", () => {
    const clock = createGameClock();
    clock.requestDilation(0.35, 400, 500);
    assert.equal(clock.timeScale, 0.35);
    clock.advanceWall(0.4);
    assert.equal(clock.timeScale, 0.35);
    clock.advanceWall(0.25);
    assert.ok(Math.abs(clock.timeScale - 0.675) < 1e-9, `midpoint ${clock.timeScale}`);
    let prev = clock.timeScale;
    for (let i = 0; i < 25; i++) { clock.advanceWall(0.01); assert.ok(clock.timeScale >= prev); prev = clock.timeScale; }
    assert.equal(clock.timeScale, 1);
  });

  test("sim time under dilation is the integral of the time scale", () => {
    const clock = createGameClock();
    clock.requestDilation(0.35, 400, 500);
    runFrames(clock, { frames: 120, wallDt: 1 / 120, dt: 0.0025 });   // 1.0 s wall
    // hold 0.4·0.35 + ease ∫ over 0.5 s (mean of smoothstep = 0.5 → 0.675) + 0.1 at 1.0
    const expected = 0.4 * 0.35 + 0.5 * 0.675 + 0.1;
    assert.ok(Math.abs(clock.simTime - expected) < 0.01, `sim ${clock.simTime} expected ${expected}`);
  });

  test("scale is clamped and a non-slowing request is ignored", () => {
    const clock = createGameClock();
    clock.requestDilation(1.5, 100, 100);
    assert.equal(clock.timeScale, 1);
    clock.requestDilation(0, 100, 0);
    assert.equal(clock.timeScale, 0.05);
    clock.advanceWall(0.1001);
    assert.equal(clock.timeScale, 1);
  });

  test("reset clears freeze, dilation, budget, accumulator, and sim time", () => {
    const clock = createGameClock();
    clock.requestHitstop(100); clock.requestDilation(0.35, 400, 500);
    clock.acc = 0.002; clock.setSimTime(12);
    clock.reset();
    assert.deepEqual(
      [clock.simTime, clock.acc, clock.hitstopRemainingMs, clock.hitstopBudgetUsedMs, clock.timeScale],
      [0, 0, 0, 0, 1],
    );
    assert.equal(clock.requestHitstop(100), 100);
  });
});
