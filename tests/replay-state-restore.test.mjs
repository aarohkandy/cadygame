import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimDriver } from "../src/game/loop/sim-driver.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { createUiStore } from "../src/game/core/ui-store.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createMatchDirector, PHASE_MS } from "../src/game/match/match-director.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import {
  createFakeEngine, createFakeRules, createFakeObservationBuilder, createFakeDelayLine, createFakeChunkExecutor,
  createFakeKinematics, createFakePilot, createFakeRecorder, createFakeSeatDriver, createFakeMomentBuffer,
  fakeEvents, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const DT = 1 / 60;

function game() {
  const engine = createFakeEngine();
  const rules = createFakeRules();
  const clock = createGameClock();
  const bus = createEventBus();
  const ui = createUiStore();
  const settings = createSettingsStore({ storage: null });
  const pilot = createFakePilot("atlas");
  const episodes = new Map();
  const viewer = {
    durationS: 0, t: 0, playing: false, rate: 1, loaded: null, updates: 0,
    load(ep) { viewer.loaded = ep; engine.qpos.fill(0.123); engine.restoreState(engine.saveState(), "both"); },
    seek() {}, play() {}, pause() {}, setRate() {}, stepFrames() {},
    update() { viewer.updates++; engine.qpos[0] += 0.01; },
    targetGhost(_s, out) { return out; }, debugAt() { return null; },
    async verify() { return { verdict: "error", divergedFrame: null, divergedT: null, eventMismatch: null, checkedFrames: 0, message: "" }; },
  };
  const sim = createSimDriver({
    engine, rules, clock, kinematics: createFakeKinematics(), observations: createFakeObservationBuilder(),
    createDelayLine: createFakeDelayLine, createChunkExecutor: createFakeChunkExecutor, hitstopMsFor: fakeHitstopMsFor, pilot, bus,
  });
  const director = createMatchDirector({
    sim, engine, rules, clock, ui, settings, pilot,
    seats: {
      async create() {
        return { atlas: { kind: "pilot", proxy: null }, blaze: { kind: "policy", driver: createFakeSeatDriver("blaze", { act: (o, tick) => ({ targets: [Math.sin(tick / 5), -0.5, 1, 0, 0, 1] }) }) } };
      },
      dispose() {},
    },
    harness: {
      createRecorder: createFakeRecorder, moments: createFakeMomentBuffer(),
      store: { async save(ep) { episodes.set(ep.meta.episodeId, ep); return ep.meta.episodeId; }, async load(id) { return episodes.get(id); } },
      computeStats: null,
    },
    replay: viewer, provenance: { tuning: {}, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "", harnessCommit: "", userAgent: "node" },
    nextSeed: () => 42, now: () => new Date("2026-09-16T12:00:00Z"),
  });
  return { engine, rules, clock, sim, director, ui, viewer, episodes, pilot };
}

function bytesOf(state) {
  return [state.time, ...state.qpos, ...state.qvel, ...state.ctrl, ...state.qacc_warmstart, ...state.servo];
}

describe("replay state restore (WP1 acceptance 7)", () => {
  test("after an earned round replay the engine state equals the pre-replay state bit for bit", async () => {
    const g = game();
    g.pilot.targets.set([0.7, -0.3, 0.9, 0.2, 0.1, 0.4]);
    await g.director.startMatch(buildMatchConfig({
      preset: "arcade", context: "quick", seed: 3, fastShow: false, now: new Date("2026-09-16T12:00:00Z"),
      seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } } },
    }));
    while (g.director.phase !== "fight") { g.sim.frameTick(DT); g.director.update(DT); }
    for (let i = 0; i < 240; i++) { g.sim.frameTick(DT); g.director.update(DT); }   // 4 s of fight fills the moment buffer
    g.rules.script = (step, t, state) => {
      state.outcome = { winner: "atlas", reason: "ko", t };
      g.rules.script = null;
      return [fakeEvents.strike({ magnitude: 0.95, lethal: true, vN: 3.1, damage: 34 }), fakeEvents.ko()];
    };
    g.rules.setProfile("blaze", { tauScale: 0, kpScale: 1, kvScale: 1 });   // Offline slump must survive the replay

    let before = null;
    while (g.director.phase !== "round_replay") {
      g.sim.frameTick(DT);
      const snapshot = g.engine.saveState();
      g.director.update(DT);
      if (g.director.phase === "round_replay") before = snapshot;
      assert.notEqual(g.director.phase, "round_summary", "a KO at m 0.95 must earn a replay");
    }
    assert.equal(g.clock.externalDrive, true);
    assert.equal(g.ui.get().replayMomentLabel, "IMPACT 3.1 m/s · 34");
    const stepAtReplay = g.engine.frame.step;
    let drove = false;
    let ms = 0;
    while (g.director.phase === "round_replay") {
      g.sim.frameTick(DT);
      if (bytesOf(g.engine.saveState()).some((v, i) => v !== bytesOf(before)[i])) drove = true;
      g.director.update(DT);
      ms += DT * 1000;
    }
    assert.ok(drove, "the replay moved the engine");
    assert.ok(Math.abs(ms - PHASE_MS.roundReplay) <= 1000 / 60 + 1e-6, `replay lasted ${ms} ms`);
    assert.equal(g.clock.externalDrive, false);
    assert.deepEqual(bytesOf(g.engine.saveState()), bytesOf(before));
    assert.equal(g.ui.get().replayMomentLabel, null);
    assert.ok(g.engine.frame.step >= stepAtReplay);
  });

  test("closing the replay viewer restores the live state and phase", async () => {
    const g = game();
    g.director.enterGreenRoom();
    for (let i = 0; i < 30; i++) { g.sim.frameTick(DT); g.director.update(DT); }
    g.episodes.set("ep-1", { meta: { episodeId: "ep-1" } });
    const before = bytesOf(g.engine.saveState());
    await g.director.openReplay("ep-1");
    assert.equal(g.director.phase, "replay_viewer");
    assert.equal(g.director.cameraMode, "replay");
    for (let i = 0; i < 20; i++) { g.sim.frameTick(DT); g.director.update(DT); }
    assert.equal(g.viewer.updates, 20);
    assert.notDeepEqual(bytesOf(g.engine.saveState()), before);
    g.director.closeReplay();
    assert.deepEqual(bytesOf(g.engine.saveState()), before);
    assert.equal(g.director.phase, "green_room");
    assert.equal(g.clock.externalDrive, false);
    assert.equal(g.ui.get().screen, "replays");
  });
});
