import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimDriver, MAX_STEPS_PER_FRAME, LIVE_TIMEOUT_MS } from "../src/game/loop/sim-driver.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { buildMatchConfig, rulesConfigFor } from "../src/game/match/match-config.ts";
import { presetRules } from "../src/game/match/presets.ts";
import {
  createFakeEngine, createFakeRules, createFakeObservationBuilder, createFakeDelayLine, createFakeChunkExecutor,
  createFakeKinematics, createFakePilot, createFakeRecorder, createFakeSeatDriver, fakeEvents, fakeHitstopMsFor,
  createFakeMomentBuffer,
} from "../src/game/testing/fakes.ts";

const NOW = new Date("2026-09-16T12:00:00Z");

/** A configured match with the round reset and control live. */
async function setup(opts = {}) {
  const preset = opts.preset ?? "arcade";
  const controlHz = opts.controlHz ?? 50;
  const pr = presetRules(preset, controlHz);
  const engine = createFakeEngine({ mode: pr.physics, timestep: pr.timestep });
  const rules = createFakeRules();
  const clock = createGameClock();
  const bus = createEventBus();
  const observations = createFakeObservationBuilder();
  const pilot = createFakePilot("atlas");
  const recorder = createFakeRecorder();
  const moments = createFakeMomentBuffer();
  const seatSpecs = opts.seats ?? {
    atlas: { driver: { kind: "module", fileName: "a.mjs", source: "", sha256: "a" } },
    blaze: { driver: { kind: "module", fileName: "b.mjs", source: "", sha256: "b" } },
  };
  const cfg = buildMatchConfig({
    preset, context: "lab", seed: opts.seed ?? 7, controlHz, seats: seatSpecs, now: NOW,
    timing: opts.timing, turbo: opts.turbo, actionDelayTicks: opts.actionDelayTicks ?? 1, fairDelayMs: opts.fairDelayMs,
    strictLimits: opts.strictLimits,
  });
  const drivers = {};
  const bindings = {};
  for (const seat of ["atlas", "blaze"]) {
    const kind = cfg.seats[seat].driver.kind;
    if (kind === "human" || kind === "proxy") { bindings[seat] = { kind: "pilot", proxy: null }; continue; }
    drivers[seat] = createFakeSeatDriver(seat, opts.policy?.[seat] ?? opts.policyAll ?? {});
    bindings[seat] = { kind: "policy", driver: drivers[seat] };
  }
  const faults = [];
  const stepEvents = [];
  const driver = createSimDriver({
    engine, rules, clock, kinematics: createFakeKinematics(), observations,
    createDelayLine: createFakeDelayLine, createChunkExecutor: createFakeChunkExecutor, hitstopMsFor: fakeHitstopMsFor,
    pilot, bus, hardAbortMs: opts.hardAbortMs,
  });
  driver.setListener({
    matchContext: () => ({ round: 1, bestOf: 3, phase: "fight", phaseLengthS: 45, roundsWon: { atlas: 0, blaze: 0 } }),
    onSimStep: (frame, combat, events, firstNew) => { for (let i = firstNew; i < events.length; i++) stepEvents.push(events[i]); },
    onPolicyFault: (seat, kind, detail) => faults.push({ seat, kind, detail }),
  });
  const lockstep = opts.lockstep ?? cfg.timing === "eval";
  rules.reset(rulesConfigFor(cfg, { atlas: 0, blaze: 0 }, false), 1, false, null);
  rules.setLive(true);
  driver.configureMatch({ config: cfg, bindings, recorder, moments, playerSeat: opts.playerSeat ?? null, lockstep });
  driver.resetRound(1, "duel");
  await driver.resetDrivers(1);
  driver.setControlLive(true);
  return { engine, rules, clock, bus, observations, pilot, recorder, moments, drivers, driver, cfg, faults, stepEvents };
}

/** Runs headless until `steps` steps have run, awaiting lockstep replies. */
async function runSteps(driver, steps) {
  let done = 0;
  while (done < steps) {
    done += driver.advance(steps - done);
    if (driver.blocked) await driver.whenUnblocked();
    if (driver.error) break;
  }
  return done;
}

describe("sim-driver: fixed step, catch-up, alpha", () => {
  for (const [preset, controlHz] of [["arcade", 50], ["proving_ground", 50], ["harness", 50], ["harness", 30], ["harness", 60]]) {
    test(`${preset} @ ${controlHz} Hz: 60 s of 60 fps frames advance sim 60.0 s ± 0.5%`, async () => {
      const s = await setup({ preset, controlHz, timing: "live", lockstep: false });
      for (let f = 0; f < 3600; f++) s.driver.frameTick(1 / 60);
      assert.ok(Math.abs(s.clock.simTime - 60) <= 0.3, `simTime ${s.clock.simTime}`);
      assert.equal(s.engine.frame.simTime, s.clock.simTime);
    });
  }

  test("a 100 ms frame runs at most the catch-up cap and drops the rest (no spiral)", async () => {
    const s = await setup({ timing: "live", lockstep: false });
    s.driver.frameTick(0.25);
    assert.equal(s.engine.frame.step, MAX_STEPS_PER_FRAME.arcade);
    assert.equal(s.clock.acc, 0);
    s.driver.frameTick(1 / 60);
    assert.equal(s.engine.frame.step, MAX_STEPS_PER_FRAME.arcade + 6);
  });

  test("render alpha is the accumulator fraction of a step", async () => {
    const s = await setup({ timing: "live", lockstep: false });
    s.driver.frameTick(0.00375);            // 1.5 arcade steps
    assert.equal(s.engine.frame.step, 1);
    assert.ok(Math.abs(s.clock.alpha - 0.5) < 1e-9, `alpha ${s.clock.alpha}`);
  });
});

describe("sim-driver: hit stop freezes on the impact step", () => {
  test("a strike at step k means no step k+1 runs until the freeze ends", async () => {
    const s = await setup({ timing: "live", lockstep: false, playerSeat: "atlas" });
    const k = 3;
    s.rules.script = (step) => (step === k ? [fakeEvents.strike({ magnitude: 1 })] : null);
    s.driver.frameTick(0.04);               // 16 steps due; must stop right after step k
    assert.equal(s.engine.frame.step, k + 1);
    assert.equal(s.clock.alpha, 1);
    const granted = s.clock.hitstopRemainingMs;
    assert.equal(granted, 120);             // 133 ms trimmed to the 120 ms budget
    let frames = 0;
    while (s.clock.hitstopRemainingMs > 0) {
      s.driver.frameTick(1 / 60);
      if (s.clock.hitstopRemainingMs > 0) assert.equal(s.engine.frame.step, k + 1, "stepped during freeze");
      frames++;
    }
    assert.ok(frames >= 7 && frames <= 8, `freeze lasted ${frames} frames`);
    s.driver.frameTick(1 / 60);
    assert.ok(s.engine.frame.step > k + 1);
  });

  test("the attacker's ghost is released at 60 % of a freeze they dealt; a freeze taken holds it to the end", async () => {
    const seats = { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "module", fileName: "b.mjs", source: "", sha256: "b" } } };
    const dealt = await setup({ timing: "live", lockstep: false, playerSeat: "atlas", seats });
    dealt.rules.script = (step) => (step === 2 ? [fakeEvents.strike({ attacker: "atlas", victim: "blaze", magnitude: 1 })] : null);
    dealt.driver.frameTick(0.01);
    const total = dealt.clock.hitstopTotalMs;
    assert.equal(total, 120);
    const seen = [];
    while (dealt.clock.hitstopRemainingMs > 0) {
      dealt.driver.frameTick(0.01);
      seen.push([dealt.clock.hitstopRemainingMs, dealt.pilot.sampled.at(-1).frozen]);
    }
    for (const [remaining, frozen] of seen) {
      if (remaining > total * 0.4 + 1e-9) assert.equal(frozen, true, `ghost frozen with ${remaining} ms left`);
      else if (remaining > 0) assert.equal(frozen, false, `ghost released with ${remaining} ms left`);
    }
    assert.ok(seen.some(([r, f]) => r > 0 && f === false), "the ghost was let go before the arm");
    assert.equal(dealt.clock.hitstopTotalMs, 0, "total clears with the freeze");

    const taken = await setup({ timing: "live", lockstep: false, playerSeat: "atlas", seats });
    taken.rules.script = (step) => (step === 2 ? [fakeEvents.strike({ attacker: "blaze", victim: "atlas", magnitude: 1 })] : null);
    taken.driver.frameTick(0.01);
    while (taken.clock.hitstopRemainingMs > 0) {
      taken.driver.frameTick(0.01);
      if (taken.clock.hitstopRemainingMs > 0) assert.equal(taken.pilot.sampled.at(-1).frozen, true, "a hit taken freezes the hand to the end");
    }
  });

  test("stock presets never freeze", async () => {
    const s = await setup({ preset: "proving_ground", timing: "live", lockstep: false, playerSeat: "atlas" });
    s.rules.script = (step) => (step === 1 ? [fakeEvents.ko()] : null);
    s.driver.frameTick(0.0401);
    assert.equal(s.clock.hitstopRemainingMs, 0);
    assert.equal(s.engine.frame.step, 8);
  });

  test("ten m = 1 strikes inside 600 ms of wall grant at most 120 ms of freeze in total", async () => {
    const s = await setup({ timing: "live", lockstep: false, playerSeat: "atlas" });
    let strikes = 0;
    s.rules.script = () => (strikes < 10 ? (strikes++, [fakeEvents.strike({ magnitude: 1 })]) : null);
    let granted = 0;
    const request = s.clock.requestHitstop.bind(s.clock);
    s.clock.requestHitstop = (ms) => { const g = request(ms); granted += g; return g; };
    while (strikes < 10) s.driver.frameTick(1 / 60);
    assert.ok(s.clock.wallTime <= 0.6, `ten strikes took ${s.clock.wallTime} s of wall`);
    assert.ok(granted <= 120, `granted ${granted} ms`);
    assert.ok(granted > 0);
  });
});

describe("sim-driver: decisions and action delay", () => {
  for (const delay of [0, 1, 2, 3]) {
    test(`live: an instant policy's action applies exactly ${delay} tick(s) after the request`, async () => {
      const s = await setup({
        timing: "live", lockstep: false, actionDelayTicks: delay,
        seats: {
          atlas: { driver: { kind: "module", fileName: "a.mjs", source: "", sha256: "a" }, decisionHz: 50 },
          blaze: { driver: { kind: "module", fileName: "b.mjs", source: "", sha256: "b" }, decisionHz: 50 },
        },
        policyAll: { act: (obs, tick) => ({ targets: [0.001 * (tick + 1), 0, 0, 0, 0, 0] }) },
      });
      for (let f = 0; f < 30; f++) s.driver.frameTick(1 / 50);
      const rows = s.recorder.rows;
      assert.ok(rows.length >= 20);
      for (const r of rows.slice(0, 20)) {
        const expected = r.frameIndex - delay >= 0 ? 0.001 * (r.frameIndex - delay + 1) : 0;
        assert.ok(Math.abs(r.applied.atlas[0] - expected) < 1e-12, `row ${r.frameIndex}: ${r.applied.atlas[0]} vs ${expected}`);
        if (r.frameIndex - delay >= 0) assert.equal(r.obsFrameIndex.atlas, r.frameIndex - delay);
        assert.equal(r.requestFrameIndex.atlas, r.frameIndex, "reply arrives on its request row");
        assert.ok(r.raw.atlas);
      }
    });
  }

  test("decimation 2: requests go out every other tick and hold in between", async () => {
    const s = await setup({ timing: "live", lockstep: false });
    for (let f = 0; f < 10; f++) s.driver.frameTick(1 / 50);
    const ticks = s.drivers.atlas.requests.map((r) => r.tick);
    assert.deepEqual(ticks.slice(0, 4), [0, 2, 4, 6]);
    assert.ok(Number.isNaN(s.recorder.rows[1].computeMs.atlas));
    assert.equal(s.recorder.rows[2].computeMs.atlas, 1);
  });

  test("eval: a 25 ms-per-act policy produces the same trajectory as an instant one", async () => {
    const act = (obs, tick) => ({ targets: [Math.sin(tick * 0.1), -0.5, 1, 0, 0, 0.5] });
    const fast = await setup({ timing: "eval", policyAll: { act } });
    const slow = await setup({ timing: "eval", policyAll: { act, waitMs: 25 } });
    await runSteps(fast.driver, 120);
    await runSteps(slow.driver, 120);
    assert.equal(fast.engine.checksum(), slow.engine.checksum());
    assert.equal(fast.engine.frame.step, 120);
    assert.equal(slow.engine.frame.step, 120);
  });

  test("eval: a policy that never answers errors the episode with policy_hang", async () => {
    const s = await setup({ timing: "eval", policy: { blaze: { hang: true } }, hardAbortMs: 60 });
    await runSteps(s.driver, 80);
    assert.equal(s.driver.error, "policy_hang");
    assert.deepEqual(s.faults.map((f) => [f.seat, f.kind]), [["blaze", "hang"]]);
    s.driver.flushEvents();
    assert.ok(s.recorder.recordedEvents.some((e) => e.type === "policy_fault" && e.status === "hang"));
  });

  test("live: 500 ms without a reply is a timeout, three in a row disconnect the seat", async () => {
    const s = await setup({ timing: "live", lockstep: false, policy: { blaze: { hang: true } } });
    for (let f = 0; f < Math.ceil((LIVE_TIMEOUT_MS * 3.4) / 20); f++) s.driver.frameTick(1 / 50);
    s.driver.flushEvents();
    const faults = s.recorder.recordedEvents.filter((e) => e.type === "policy_fault" && e.seat === "blaze");
    assert.deepEqual(faults.map((e) => e.status), ["timeout", "timeout", "timeout", "disconnect"]);
    assert.deepEqual(s.faults, [{ seat: "blaze", kind: "disconnect", detail: "3 timeouts in a row" }]);
    assert.equal(s.driver.policy.blaze.faults, 4);
  });

  test("strict limits: a clamped action faults the seat", async () => {
    const s = await setup({
      timing: "eval", strictLimits: true,
      policy: { blaze: { act: () => ({ targets: [9, 0, 0, 0, 0, 0] }) } },
    });
    s.drivers.blaze.poll = s.drivers.blaze.poll;  // keep the fake
    const original = s.drivers.blaze.waitForResult.bind(s.drivers.blaze);
    s.drivers.blaze.waitForResult = async (ms) => ({ ...(await original(ms)), status: "clamped" });
    await runSteps(s.driver, 16);
    assert.deepEqual(s.faults.map((f) => [f.seat, f.kind]), [["blaze", "strict"]]);
  });
});

describe("sim-driver: observations, fair delay, recording", () => {
  test("events after a seat's last control tick of frame N reach its observation at tick N+1", async () => {
    const s = await setup({ timing: "eval" });
    // Tick 0 covers steps 0..7; a strike on step 5 must appear in tick 1's build, not tick 0's.
    s.rules.script = (step) => (step === 5 ? [fakeEvents.strike({ magnitude: 0.1 })] : null);
    await runSteps(s.driver, 17);
    const live = s.observations.builds.slice(16);          // the first 16 builds are the warm-up fixtures (8 per seat)
    const atlas = live.filter((b) => b.seat === "atlas");
    assert.equal(atlas[0].events.length, 0);
    assert.equal(atlas[1].events.length, 1);
    assert.equal(atlas[1].events[0].step, 5);
    assert.equal(atlas[2].events.length, 0);
    const blaze = live.filter((b) => b.seat === "blaze");
    assert.equal(blaze[1].events.length, 1, "each seat drains its own copy");
  });

  test("a module facing a human sees observations 120 ms old; the human row records none", async () => {
    const s = await setup({
      timing: "live", lockstep: false, fairDelayMs: 120,
      seats: {
        atlas: { driver: { kind: "human" } },
        blaze: { driver: { kind: "module", fileName: "b.mjs", source: "", sha256: "b" }, decisionHz: 50 },
      },
    });
    for (let f = 0; f < 20; f++) s.driver.frameTick(1 / 50);
    const r = s.recorder.rows[15];
    assert.equal(r.deliveredTick.blaze, 15 - 6);          // 120 ms at 50 Hz = 6 ticks
    assert.equal(r.deliveredTick.atlas, null);
    assert.ok(s.pilot.writes >= 15 * 8, "human ctrl written every physics step");
    assert.equal(s.drivers.blaze.requests[15].frameIndex, 9);
  });

  test("placements, servo profiles, and resets are recorded as mutations with discontinuity bits", async () => {
    const s = await setup({ timing: "eval" });
    s.rules.pendingPlacements.push({ cube: 4, pos: [0, 0, 0.22] });
    await runSteps(s.driver, 3);
    s.rules.setProfile("blaze", { tauScale: 0, kpScale: 1, kvScale: 1 });
    await runSteps(s.driver, 12);
    const kinds = s.recorder.mutations.map((m) => m.kind);
    assert.deepEqual(kinds, ["timestep", "reset", "place_cube", "servo_profile"]);
    assert.equal(s.recorder.rows[0].discontinuity, 1 | 2);   // reset, then the placement applied on step 0
    assert.equal(s.recorder.rows[1].discontinuity, 4);
    assert.deepEqual(s.engine.placements.map((p) => p.index), [4]);
  });

  test("stock presets record Offline as an `offline` mutation", async () => {
    const s = await setup({ preset: "harness", timing: "eval" });
    await runSteps(s.driver, 2);
    s.rules.setProfile("atlas", { tauScale: 0, kpScale: 1, kvScale: 1 });
    await runSteps(s.driver, 4);
    assert.deepEqual(s.recorder.mutations.map((m) => m.kind), ["timestep", "reset", "offline"]);
    assert.equal(s.engine.rejectedProfiles, 0);
  });

  test("checkpoints every 50 control ticks and 50 Hz moment samples", async () => {
    const s = await setup({ timing: "eval" });
    await runSteps(s.driver, 101 * 8);
    assert.deepEqual(s.recorder.checkpoints.map((c) => c.step), [0, 400, 800]);
    assert.equal(s.moments.size, 101);
    assert.equal(s.recorder.steps.length, 808);
  });

  test("policy debug flaw and dda changes become events", async () => {
    let k = 1;
    const s = await setup({
      timing: "eval",
      policy: { blaze: { act: (obs, tick) => ({ targets: [0, 0, 0, 0, 0, 0], debug: { dda: tick >= 4 ? (k = 0.9) : k, flaw: tick >= 6 ? { flaw: "panics", stage: "exploited", count: 1 } : undefined } }) } },
    });
    await runSteps(s.driver, 80);
    s.driver.flushEvents();
    const ev = s.recorder.recordedEvents;
    assert.equal(ev.filter((e) => e.type === "dda").length, 1);
    assert.equal(ev.find((e) => e.type === "dda").k, 0.9);
    assert.equal(ev.filter((e) => e.type === "flaw").length, 1);
  });

  test("control off: policy seats hold home and no requests go out", async () => {
    const s = await setup({ timing: "eval" });
    s.driver.setControlLive(false);
    await runSteps(s.driver, 40);
    assert.equal(s.drivers.atlas.requests.length, 0);
    assert.deepEqual(s.recorder.rows[3].applied.atlas, Array.from(createFakeKinematics().commandToJoints(createFakeKinematics().homeCommand(), new Float64Array(6))));
  });
});

describe("sim-driver: turbo survives a pause", () => {
  /** Mean physics steps per frameTick, awaiting lockstep replies between frames as the browser pump does. */
  async function stepsPerFrame(s, frames) {
    const before = s.engine.frame.step;
    for (let f = 0; f < frames; f++) {
      s.driver.frameTick(1 / 60);
      if (s.driver.blocked) await s.driver.whenUnblocked();
    }
    return (s.engine.frame.step - before) / frames;
  }

  const turboSetup = () => setup({
    timing: "eval", turbo: true,
    policyAll: { act: () => ({ targets: [0, -0.5, 0.9, -0.3, 0, 1] }) },
  });

  test("a pause and resume leaves a turbo match stepping at the rate it had", async () => {
    const s = await turboSetup();
    assert.equal(s.cfg.turbo, true);
    const before = await stepsPerFrame(s, 24);
    assert.ok(before > 0, "the turbo match was not stepping before the pause");

    s.clock.paused = true;
    const frozenStep = s.engine.frame.step;
    const frozenSim = s.clock.simTime;
    for (let f = 0; f < 24; f++) s.driver.frameTick(1 / 60);
    assert.equal(s.engine.frame.step, frozenStep, "a paused turbo match must not step");
    assert.equal(s.clock.simTime, frozenSim);

    s.clock.paused = false;
    const after = await stepsPerFrame(s, 24);
    // The regression this guards: the run came back from the pause at a fraction of its rate and stayed there.
    assert.ok(after >= before * 0.9, `turbo did not recover: ${before} steps/frame before, ${after} after`);
    assert.equal(s.driver.blocked, false, "the driver was left blocked by the pause");
    assert.equal(s.clock.acc, 0, "turbo leaves no accumulator behind");
    assert.equal(s.driver.error, null);
  });

  test("turbo steps past the frame-rate catch-up cap, before and after a pause", async () => {
    // Lockstep gates a turbo frame at one control tick, so the 12 ms step budget is measured with the
    // live poll path: this is the branch that must not be pinned to MAX_STEPS_PER_FRAME.
    const s = await setup({
      timing: "eval", turbo: true, lockstep: false,
      policyAll: { act: () => ({ targets: [0, -0.5, 0.9, -0.3, 0, 1] }) },
    });
    const before = await stepsPerFrame(s, 4);
    assert.ok(before > MAX_STEPS_PER_FRAME.arcade, `turbo ran ${before} steps/frame, no better than the cap`);
    s.clock.paused = true;
    s.driver.frameTick(1 / 60);
    s.clock.paused = false;
    const after = await stepsPerFrame(s, 4);
    assert.ok(after > MAX_STEPS_PER_FRAME.arcade, `after the pause turbo ran ${after} steps/frame`);
  });
});
