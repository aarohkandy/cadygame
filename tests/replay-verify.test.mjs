import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import { createRecorder, SEGMENTS_COLUMN } from "../src/game/harness/recorder.ts";
import { decodeEpisodeText, encodeEpisodeText } from "../src/game/harness/episode-format.ts";
import { VERIFIED_MESSAGE, indexEpisode, verifyEpisode } from "../src/game/harness/determinism.ts";
import { createReplayPlayer } from "../src/game/harness/replay-player.ts";
import {
  createFakeChunkExecutor, createFakeDelayLine, createFakeEngine, createFakeKinematics, createFakeObservationBuilder, createFakePilot,
  createFakeRules, createFakeSeatDriver, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const NOW = new Date("2026-09-16T12:00:00Z");

/* ───────── fakes: a scripted match with every mutation kind ───────── */

/** The fake engine updates frame ctrl only on step; the real engine reflects setTargets at once (what the recorder reads). */
function liveCtrl(engine) {
  const set = engine.setTargets.bind(engine);
  engine.setTargets = (seat, t) => {
    set(seat, t);
    const s = engine.saveState();
    engine.frame.arms[seat].ctrl.set(s.ctrl.subarray(seat === "atlas" ? 0 : 6, seat === "atlas" ? 6 : 12));
  };
  return engine;
}

function scriptedRules() {
  const r = createFakeRules();
  r.script = (step, t, state) => {
    if (step === 1200) r.pendingPlacements.push({ cube: 4, pos: [0, 0, 0.22] });
    if (step === 1600) r.setProfile("blaze", { tauScale: 0, kpScale: 1, kvScale: 1 });
    if (step % 1000 === 500) {
      state.seats.blaze.integrity -= 30;
      return [{ type: "strike", tier: "strike", attacker: "atlas", victim: "blaze", raw: 20, damage: 30, physicalDamage: 20, nu: 1, vN: 2.2, zone: "wrist", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false, pos: [0, 0, 0.1], normal: [1, 0, 0], magnitude: 1, lethal: false, upgrade: false, thrownCube: -1 }];
    }
    if (step === 2600 && !state.outcome) state.outcome = { winner: state.round === 2 ? "blaze" : "atlas", reason: "ko", t };
    return null;
  };
  return r;
}

function fakeRunner({ pilot = false } = {}) {
  return defineHeadlessMatchRunner({ createChunkExecutor: createFakeChunkExecutor, createDelayLine: createFakeDelayLine, hitstopMsFor: fakeHitstopMsFor })({
    createEngine: async ({ mode }) => liveCtrl(createFakeEngine({ mode })),
    createRules: scriptedRules,
    kinematics: createFakeKinematics(), observations: createFakeObservationBuilder(),
    createSeatDriver: async (spec, seat) => createFakeSeatDriver(seat, { kind: spec.kind, act: (_obs, tick) => ({ targets: [Math.sin(tick / 7) * (seat === "atlas" ? 1 : -1), -0.4, 0.9, 0.1, 0, 1] }) }),
    createPilot: pilot ? () => createFakePilot("atlas") : null,
    createProxyBot: pilot ? () => ({ reset() {}, update(obs, p) { p.targets[0] = Math.sin(obs.t * 3); p.targets[2] = 0.8 + 0.1 * Math.cos(obs.t * 5); } }) : null,
    createRecorder,
  });
}

const fakeVerifyDeps = { createEngine: async ({ mode }) => liveCtrl(createFakeEngine({ mode })), createRules: scriptedRules };

const roundTrip = (ep) => decodeEpisodeText(encodeEpisodeText(ep));

/**
 * Mutates one recorded ctrl entry at cumulative physics step `global`. Returns the row the change first acts on and the
 * row of the first checkpoint after it: verify must diverge no earlier than the first and no later than the second
 * (the per-tick joint check usually catches it within a tick or two).
 */
function mutateCtrlAt(ep, global, delta = 0.05) {
  const index = indexEpisode(ep);
  let before = 0;
  for (const seg of index.segments) {
    if (global >= before + seg.steps) { before += seg.steps; continue; }
    const local = seg.resetStep + (global - before);
    let k = seg.ctrlIndex;
    while (k + 1 < seg.ctrlEnd && ep.steps.ctrl.steps[k + 1] <= local) k++;
    ep.steps.ctrl.values[k * 12 + 1] += delta;         // atlas shoulder_lift
    ep.steps.ctrl.values[k * 12 + 7] += delta;         // blaze shoulder_lift (one arm may be slumped Offline)
    const cp = ep.steps.checkpoints.slice(seg.checkpointIndex, seg.checkpointEnd).find((c) => c.step > ep.steps.ctrl.steps[k]);
    const from = seg.firstTick + Math.floor((ep.steps.ctrl.steps[k] - seg.resetStep) / index.spt);
    return { from, checkpoint: cp ? seg.firstTick + (cp.step - seg.resetStep) / index.spt : seg.endTick };
  }
  throw new Error("episode shorter than the mutation step");
}

describe("replay verify on the fake stack", () => {
  const botCfg = (bestOf = 3) => buildMatchConfig({
    preset: "harness", context: "suite", seed: 21, bestOf, now: NOW,
    seats: { atlas: { driver: { kind: "module", fileName: "a.mjs", source: "", sha256: "a" } }, blaze: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } } },
  });

  test("a 3-round bot-vs-bot eval episode verifies bit-exact after JSON export and import", async () => {
    const ep = await fakeRunner().run(botCfg());
    assert.equal(ep.meta.result.rounds.length, 3);
    assert.ok(ep.steps.mutations.some((m) => m.kind === "place_cube"));
    assert.ok(ep.steps.mutations.some((m) => m.kind === "offline"));
    const progress = [];
    const v = await verifyEpisode(roundTrip(ep), fakeVerifyDeps, (f) => progress.push(f));
    assert.equal(v.verdict, "bit_exact", v.message);
    assert.equal(v.message, VERIFIED_MESSAGE);
    assert.equal(v.checkedFrames, ep.columns.frame_index.length);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 1);
  });

  test("changing one ctrl value at step 5,000 diverges at the next checkpoint with the frame set", async () => {
    const ep = roundTrip(await fakeRunner().run(botCfg()));
    const { from, checkpoint } = mutateCtrlAt(ep, 5000);
    const v = await verifyEpisode(ep, fakeVerifyDeps);
    assert.equal(v.verdict, "diverged");
    assert.ok(v.divergedFrame >= from && v.divergedFrame <= checkpoint, `diverged at ${v.divergedFrame}, change at ${from}, checkpoint ${checkpoint}`);
    assert.ok(Number.isFinite(v.divergedT));
    assert.match(v.message, /^DIVERGED AT t = \d+\.\d\d s \(frame \d+\)/);
  });

  test("a recorded rules event that the rules no longer produce is reported", async () => {
    const ep = roundTrip(await fakeRunner().run(botCfg(1)));
    const strike = ep.events.find((e) => e.type === "strike");
    strike.damage = 31;
    const v = await verifyEpisode(ep, fakeVerifyDeps);
    assert.equal(v.verdict, "diverged");
    assert.match(v.eventMismatch, /"damage":31/);
  });

  test("an episode with a human (proxy) seat verifies too: ctrl is recorded per step", async () => {
    const cfg = buildMatchConfig({
      preset: "proving_ground", context: "lab", seed: 8, bestOf: 1, now: NOW,
      seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
    });
    const ep = await fakeRunner({ pilot: true }).run(cfg);
    assert.ok(ep.columns["human.command.atlas"], "human columns recorded");
    assert.ok(ep.steps.ctrl.steps.length > 100, "per-step ctrl stream recorded");
    const v = await verifyEpisode(roundTrip(ep), fakeVerifyDeps);
    assert.equal(v.verdict, "bit_exact", v.message);
  });

  test("damaged or foreign episodes are an error, not a verdict", async () => {
    const ep = roundTrip(await fakeRunner().run(botCfg(1)));
    delete ep.sparse[SEGMENTS_COLUMN];
    assert.equal((await verifyEpisode(ep, fakeVerifyDeps)).verdict, "error");
    const other = roundTrip(await fakeRunner().run(botCfg(1)));
    other.meta.provenance.modelSha256 = "f".repeat(64);
    const v = await verifyEpisode(other, fakeVerifyDeps);
    assert.equal(v.verdict, "error");
    assert.match(v.message, /MODEL CHANGED/);
  });
});

describe("replay player controls and the harness facade (fake stack)", () => {
  const cfg = () => buildMatchConfig({
    preset: "harness", context: "lab", seed: 5, bestOf: 1, now: NOW,
    seats: { atlas: { driver: { kind: "module", fileName: "a.mjs", source: "", sha256: "a" } }, blaze: { driver: { kind: "builtin", personality: "jig", tier: "rookie", dda: false } } },
  });

  test("seek, play at a rate, frame step, target ghost from recorded ctrl, brain panel from sparse debug, event times", async () => {
    const ep = roundTrip(await fakeRunner().run(cfg()));
    ep.sparse["policy.debug.blaze"] = [{ frame_index: 10, value: { state: "NEUTRAL" } }, { frame_index: 400, value: { state: "COMMIT", dda: 0.8 } }];
    const engine = liveCtrl(createFakeEngine({ mode: "harness" }));
    const clock = createGameClock();
    const player = createReplayPlayer({ engine, clock, rules: scriptedRules() });
    player.load(ep);
    const rows = ep.columns.frame_index.length;
    assert.equal(player.durationS, rows / 50);
    assert.ok(player.cached < 1);
    player.precomputeAll();
    assert.equal(player.cached, 1);

    player.seek(3.0);
    assert.equal(player.frame, 150);
    const ghost = player.targetGhost("atlas", new Float64Array(6));
    const index = indexEpisode(ep);
    const seg = index.segments[0];
    const step = seg.resetStep + 150 * index.spt;
    let k = seg.ctrlIndex;
    while (k + 1 < seg.ctrlEnd && ep.steps.ctrl.steps[k + 1] <= step) k++;
    assert.deepEqual(Array.from(ghost), Array.from(ep.steps.ctrl.values.subarray(k * 12, k * 12 + 6)));
    assert.equal(player.debugAt("blaze").state, "NEUTRAL");
    assert.equal(player.debugAt("atlas"), null);

    player.setRate(2);
    player.play();
    player.update(0.5);
    assert.ok(Math.abs(player.t - 4.0) < 1e-9);
    player.setRate(3);                       // not an offered rate: ignored
    assert.equal(player.rate, 2);
    player.stepFrames(-10);
    assert.equal(player.playing, false);
    assert.equal(player.frame, 190);
    player.seek(1e9);
    assert.equal(player.t, player.durationS);
    player.play();
    assert.equal(player.t, 0, "play at the end restarts");
    assert.equal(player.debugAt("blaze"), null, "no debug recorded before frame 10");

    const times = ep.events.map((_e, i) => player.eventTime(i));
    for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1] - 0.02, "event markers run forward");
  });

  test("verify from the player and HarnessApi.checkDeterminism record the outcome on the stored episode", async () => {
    const { createHarnessApiWith } = await import("../src/game/harness/harness-api.ts");
    const { createEpisodeStoreOn } = await import("../src/game/harness/episode-store.ts");
    const { createMemoryBackend } = await import("../src/game/harness/idb.ts");
    const store = createEpisodeStoreOn(createMemoryBackend());
    const api = createHarnessApiWith({
      createEngine: fakeVerifyDeps.createEngine, createRules: scriptedRules, createSeatDriver: async () => null,
      observations: createFakeObservationBuilder(), runner: fakeRunner(), store, entrants: null,
    });
    const ep = await fakeRunner().run(cfg());
    await store.save(ep);
    const player = api.createReplayPlayer(liveCtrl(createFakeEngine()), createGameClock(), scriptedRules());
    assert.equal((await player.verify(() => {})).verdict, "error", "nothing loaded");
    player.load(await store.load(ep.meta.episodeId));
    const v = await player.verify(() => {});
    assert.equal(v.verdict, "bit_exact");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await store.load(ep.meta.episodeId)).meta.result.determinism, "bit_exact");

    const bad = roundTrip(ep);
    mutateCtrlAt(bad, 2000);
    await store.save(bad);
    const d = await api.checkDeterminism(bad);
    assert.equal(d.verdict, "diverged");
    await new Promise((r) => setTimeout(r, 20));
    const stored = await store.load(ep.meta.episodeId);
    assert.equal(stored.meta.result.determinism, "diverged");
    assert.equal(api.computeStats(stored).verdict.atlas.reason, "REPLAY DIVERGED");
  });
});

/* ───────── the real stack (MuJoCo, combat rules, built-in AI, pilot + human proxy) ───────── */

const real = await (async () => {
  try {
    const mods = await Promise.all([
      import("../src/game/physics/engine.ts"), import("../src/game/combat/combat-rules.ts"), import("../src/game/combat/tuning.ts"),
      import("../src/game/kinematics/so101-kinematics.ts"), import("../src/game/policy/observation.ts"), import("../src/game/policy/in-process-driver.ts"),
      import("../src/game/input/pilot-controller.ts"), import("../src/game/policy/proxy-bots/index.ts"), import("../src/game/policy/chunk-executor.ts"),
      import("../src/game/policy/opponent/index.ts"),
    ]);
    if (mods.some((m) => "__STUB__" in m)) return null;
    const [engine, combat, tuning, kin, obs, inproc, pilot, proxy, chunk] = mods;
    return { engine, combat, tuning, kin, obs, inproc, pilot, proxy, chunk };
  } catch {
    return null;
  }
})();

describe("replay verify on the real engine", { skip: real ? false : "physics, rules, or policy runtime still stubbed" }, () => {
  async function realRunner(onRecorder) {
    const probe = await real.engine.createPhysicsEngine({ mode: "harness" });
    const observations = real.obs.createObservationBuilder(probe.info);
    probe.dispose();
    return defineHeadlessMatchRunner({ createChunkExecutor: real.chunk.createChunkExecutor, createDelayLine: real.obs.createObservationDelayLine, hitstopMsFor: real.tuning.hitstopMsFor })({
      createEngine: async (o) => { const e = await real.engine.createPhysicsEngine(o); onRecorder?.engine(e); return e; },
      createRules: real.combat.createCombatRules, kinematics: real.kin.createKinematics(), observations,
      createSeatDriver: real.inproc.createInProcessSeatDriver, createPilot: real.pilot.createPilotController, createProxyBot: real.proxy.createProxyBot,
      createRecorder: () => (onRecorder ? onRecorder.recorder(createRecorder()) : createRecorder()),
    });
  }
  const deps = () => ({ createEngine: real.engine.createPhysicsEngine, createRules: real.combat.createCombatRules });

  test("bot vs bot, 3 rounds, eval: bit-exact after export and import; a ctrl change at step 5,000 diverges", async () => {
    const runner = await realRunner();
    let ep = null;
    for (let seed = 1; seed <= 8 && !(ep && ep.meta.result.rounds.length >= 3); seed++) {
      ep = await runner.run(buildMatchConfig({
        preset: "harness", context: "suite", seed, bestOf: 3, now: NOW,
        seats: { atlas: { driver: { kind: "builtin", personality: "deadband", tier: "contender", dda: false } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
      }));
    }
    assert.equal(ep.meta.result.rounds.length, 3, "found a 3-round match");
    const back = roundTrip(ep);
    const v = await verifyEpisode(back, deps());
    assert.equal(v.verdict, "bit_exact", v.message);
    const { from, checkpoint } = mutateCtrlAt(back, 5000);
    const bad = await verifyEpisode(back, deps());
    assert.equal(bad.verdict, "diverged");
    assert.ok(bad.divergedFrame >= from && bad.divergedFrame <= checkpoint, `diverged at ${bad.divergedFrame}, change at ${from}, checkpoint ${checkpoint}`);
  });

  test("human (proxy) vs built-in, Proving Ground: bit-exact after export and import; kinematic replay matches live poses", async () => {
    let liveEngine = null;
    const live = [];
    const runner = await realRunner({
      engine: (e) => { liveEngine = e; },
      recorder: (rec) => {
        const tick = rec.tick.bind(rec);
        rec.tick = (row) => { tick(row); const s = liveEngine.saveState(); live.push({ qpos: s.qpos.slice(), qvel: s.qvel.slice() }); };
        return rec;
      },
    });
    const ep = await runner.run(buildMatchConfig({
      preset: "proving_ground", context: "lab", seed: 77, bestOf: 3, now: NOW,
      seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
    }));
    const back = roundTrip(ep);
    const v = await verifyEpisode(back, deps());
    assert.equal(v.verdict, "bit_exact", v.message);

    // Kinematic replay: every cached tick state equals the live state recorded at that row (placements happen after the
    // row is written, so rows with a Core drop at their first step are compared at the next row instead).
    const engine = await real.engine.createPhysicsEngine({ mode: back.meta.physics });
    const player = createReplayPlayer({ engine, clock: createGameClock(), rules: real.combat.createCombatRules(engine.info) });
    player.load(back);
    player.precomputeAll();
    assert.equal(player.cached, 1);
    const index = indexEpisode(back);
    const placementRows = new Set();
    for (const seg of index.segments) {
      for (let m = seg.mutationIndex; m < seg.mutationEnd; m++) {
        const mu = back.steps.mutations[m];
        if (mu.kind === "place_cube") placementRows.add(seg.firstTick + Math.floor((mu.step - seg.resetStep) / index.spt));
      }
    }
    const reference = await real.engine.createPhysicsEngine({ mode: back.meta.physics });
    reference.reset({ mode: back.meta.physics, timestep: back.meta.timestep, seed: 0, loadouts: { atlas: "pivot", blaze: "pivot" }, homePose: { atlas: new Float64Array(6), blaze: new Float64Array(6) }, layout: "duel" });
    const probeState = reference.saveState();
    let compared = 0;
    for (let k = 0; k < 40; k++) {
      const t = ((k * 7919) % 1000) / 1000 * (player.durationS - 0.05);
      player.seek(t);
      const f = player.frame;
      if (placementRows.has(f)) continue;
      probeState.qpos.set(live[f].qpos);
      probeState.qvel.set(live[f].qvel);
      reference.restoreState(probeState, "prev");
      const a = engine.frame.bodyPosPrev, b = reference.frame.bodyPosPrev;
      for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1e-9, `frame ${f} body coordinate ${i}: ${a[i]} vs ${b[i]}`);
      compared++;
    }
    assert.ok(compared >= 30);
    engine.dispose();
    reference.dispose();
  });
});
