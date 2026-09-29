import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACTION_STATUS_CODE, MATCH_PHASES, OBS_BLOCKS } from "../src/game/contracts.ts";
import { defineHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { buildEpisodeMeta, buildMatchConfig } from "../src/game/match/match-config.ts";
import { SEGMENTS_COLUMN, createRecorder } from "../src/game/harness/recorder.ts";
import { encodeEpisodeText } from "../src/game/harness/episode-format.ts";
import { createEpisodeStoreOn } from "../src/game/harness/episode-store.ts";
import { createMemoryBackend } from "../src/game/harness/idb.ts";
import {
  createFakeChunkExecutor, createFakeDelayLine, createFakeEngine, createFakeKinematics, createFakeObservationBuilder, createFakePilot,
  createFakeRules, createFakeSeatDriver, fakeFrame, fakeHitstopMsFor, fakeModelInfo,
} from "../src/game/testing/fakes.ts";

const NOW = new Date("2026-09-16T12:00:00Z");
const PROV = { tuning: null, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "", harnessCommit: "dev", userAgent: "test" };

function metaFor(cfg, pilotSeat = null) {
  const fact = (name, input) => ({ name, sha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", inputDevice: input });
  return buildEpisodeMeta(cfg, fakeModelInfo(), { atlas: fact("A", pilotSeat === "atlas" ? "keyboard_mouse" : null), blaze: fact("B", null) }, { atlas: null, blaze: null }, PROV, NOW);
}

function randomBlocks(seed) {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const out = {};
  for (const [name, n] of Object.entries(OBS_BLOCKS)) out[name] = new Float32Array(n).map(() => rnd() * 2 - 1);
  return out;
}

function humanVsBuiltinConfig(preset = "arcade") {
  return buildMatchConfig({
    preset, context: "quick", seed: 7, bestOf: 3, now: NOW,
    seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } } },
  });
}

function row(tick, round, phase, obs, applied) {
  return {
    frameIndex: tick, t: tick / 50, round, phase, discontinuity: 0, obs, delivered: { atlas: null, blaze: null }, applied, raw: { atlas: null, blaze: tick % 2 ? applied.blaze : null },
    requestFrameIndex: { atlas: -1, blaze: tick % 2 ? tick - 1 : -1 }, obsFrameIndex: { atlas: -1, blaze: tick - 1 }, chunkId: { atlas: -1, blaze: tick >> 1 }, chunkIndex: { atlas: -1, blaze: -1 },
    intents: { atlas: 1, blaze: 0 }, status: { atlas: "ok", blaze: "ok" }, computeMs: { atlas: NaN, blaze: tick % 2 ? 0.8 : NaN },
    human: { atlas: { command: new Float32Array(6).fill(tick), shaping: 3 }, blaze: null }, displayLatencyMs: 14,
  };
}

describe("recorder", () => {
  test("writes every 5.8 column with the right dtype and shape, only for the seats they describe", () => {
    const cfg = humanVsBuiltinConfig();
    const rec = createRecorder();
    rec.begin(metaFor(cfg, "atlas"));
    assert.equal(rec.recording, true);
    const engine = createFakeEngine();
    rec.mutation({ kind: "reset", step: 0, seed: 1, round: 1, state: engine.saveState() });
    const obs = { atlas: randomBlocks(1), blaze: randomBlocks(2) };
    for (let t = 0; t < 30; t++) rec.tick(row(t, 1, t < 20 ? "fight" : "ko", obs, { atlas: new Float64Array(6).fill(t), blaze: new Float64Array(6).fill(-t) }));
    const ep = rec.end({ winner: "atlas", roundsWon: { atlas: 2, blaze: 0 }, rounds: [], forfeit: null, determinism: "unchecked", error: null });
    assert.equal(rec.recording, false);
    const c = ep.columns;
    const expect = {
      timestamp: Float64Array, frame_index: Uint32Array, episode_index: Uint32Array, index: Uint32Array, round: Uint8Array, phase: Uint8Array, discontinuity: Uint8Array,
      "human.display_latency_ms": Float32Array, "action.atlas": Float64Array, "action.blaze": Float64Array, "intents.atlas": Uint8Array,
      "action_raw.blaze": Float64Array, "policy.request_frame_index.blaze": Int32Array, "policy.obs_frame_index.blaze": Int32Array,
      "policy.chunk_id.blaze": Int32Array, "policy.chunk_index.blaze": Int16Array, "policy.status.blaze": Uint8Array, "policy.compute_ms.blaze": Float32Array,
      "human.command.atlas": Float32Array, "human.shaping.atlas": Uint8Array,
      "human.raw.atlas": Float32Array, "human.active.atlas": Uint8Array, "human.gaze_hint.atlas": Float32Array, "dda.k.atlas": Float32Array, "dda.k.blaze": Float32Array,
    };
    for (const [name, ctor] of Object.entries(expect)) assert.ok(c[name] instanceof ctor, name);
    for (const [block, n] of Object.entries(OBS_BLOCKS)) {
      for (const seat of ["atlas", "blaze"]) {
        assert.ok(c[`observation.${block}.${seat}`] instanceof Float32Array);
        assert.equal(c[`observation.${block}.${seat}`].length, 30 * n);
        assert.deepEqual(ep.shapes[`observation.${block}.${seat}`], [n]);
      }
    }
    assert.equal(c["action_raw.atlas"], undefined, "no policy columns for a human seat");
    assert.equal(c["human.command.blaze"], undefined, "no human columns for a policy seat");
    assert.equal(c["human.raw.blaze"], undefined);
    assert.deepEqual(ep.shapes["human.raw.atlas"], [8]);
    assert.deepEqual(ep.shapes["human.gaze_hint.atlas"], [2]);
    assert.ok(Number.isNaN(c["human.raw.atlas"][0]) && Number.isNaN(c["dda.k.blaze"][0]), "absent columns are NaN, never a made-up 0");
    assert.equal(c["human.active.atlas"][0], 0);
    assert.equal(c["observation.delivered.state.blaze"], undefined, "delivered only with a fair delay");
    assert.equal(c.phase[25], MATCH_PHASES.indexOf("ko"));
    assert.equal(c.index[29], 29);
    assert.ok(Number.isNaN(c["action_raw.blaze"][0]) && c["action_raw.blaze"][6] === -1);
    assert.equal(c["policy.request_frame_index.blaze"][0], -1);
    assert.equal(c["policy.status.blaze"][3], ACTION_STATUS_CODE.ok);
    assert.equal(c["human.shaping.atlas"][5], 3);
    assert.deepEqual(Array.from(c["observation.game.blaze"].subarray(16, 32)), Array.from(obs.blaze.game));
    assert.equal(ep.meta.format, "torquelimit.episode/4");
  });

  test("episode /4: raw input, active, gaze and dda.k columns; annotate() stamps the session block, memory and tasks; meta.rounds is built", () => {
    const cfg = humanVsBuiltinConfig();
    const rec = createRecorder();
    rec.begin(metaFor(cfg, "atlas"));
    const engine = createFakeEngine();
    const obs = { atlas: randomBlocks(3), blaze: randomBlocks(4) };
    const session = {
      pilotId: "a".repeat(32), callsign: "PILOT-AAAA",
      consent: { version: "1", grantedAt: null, scope: "local", decisionMs: null, inputMethod: null },
      device: { input: "mouse", pointerLock: true, viewportBucket: "1080p", dpr: 1.5, fpsP50: 60, fpsP95: 70, gpuTier: "apple", mouseSensitivity: 1, invertY: false, gamepadDeadzone: 0.12 },
      build: { gitSha: "abc", appVersion: "0.1.0", form: "web", inputMappingSha: "m" }, sessionIndex: 1, matchIndexInSession: 2, skillPrior: null,
    };
    rec.annotate({ session, opponentMemory: { bestMove: "hook", hurtSide: 1, timeToFirstAttackS: 3.2, feintsWorked: 1, grudge: 0.4 }, tasks: { 2: "dock the core from pose 3 zone B" } });
    for (let round = 1; round <= 2; round++) {
      rec.mutation({ kind: "reset", step: (round - 1) * 120, seed: round, round, state: engine.saveState() });
      for (let t = 0; t < 30; t++) {
        const r = row((round - 1) * 30 + t, round, t < 25 ? "fight" : "ko", obs, { atlas: new Float64Array(6), blaze: new Float64Array(6) });
        r.human.atlas.raw = new Float32Array([t, -t, t > 0 ? 1 : 0, 0, 0, 0, 0, 0]);
        r.human.atlas.gazeHint = new Float32Array([0.1, 0.2]);
        if (t === 10) rec.events([{ type: "dda", t: 0, step: (round - 1) * 120 + t * 4, seat: "blaze", k: 0.7 * round, reason: "exchange" }]);
        if (round === 2 && t === 20) rec.events([{ type: "task_success", t: 0, step: 120 + t * 4, seat: "atlas", task: "dock the core from pose 3 zone B" }]);
        rec.tick(r);
        rec.stepCtrl((round - 1) * 120 + t * 4, fakeFrame(), { atlas: 0, blaze: 0 });
      }
    }
    const ep = rec.end({ winner: "atlas", roundsWon: { atlas: 2, blaze: 0 }, rounds: [{ round: 1, winner: "atlas", reason: "ko", tEnd: 1 }, { round: 2, winner: "atlas", reason: "lock", tEnd: 1 }], forfeit: null, determinism: "unchecked", error: null });
    const c = ep.columns;
    assert.deepEqual(Array.from(c["human.raw.atlas"].subarray(8 * 5, 8 * 6)), [5, -5, 1, 0, 0, 0, 0, 0]);
    assert.equal(c["human.active.atlas"][5], 1, "active is derived from the raw row when the driver does not say");
    assert.equal(c["human.active.atlas"][0], 0, "no motion on the first row");
    assert.deepEqual(Array.from(c["human.gaze_hint.atlas"].subarray(2, 4)), [0.1, 0.2].map((v) => Math.fround(v)));
    assert.ok(Number.isNaN(c["dda.k.blaze"][9]) && Math.abs(c["dda.k.blaze"][10] - 0.7) < 1e-6 && Math.abs(c["dda.k.blaze"][45] - 1.4) < 1e-6, "dda.k holds the last dda event's k");
    assert.deepEqual(ep.meta.session, session);
    assert.deepEqual(ep.meta.opponentMemory, { bestMove: "hook", hurtSide: 1, timeToFirstAttackS: 3.2, feintsWorked: 1, grudge: 0.4 });
    assert.equal(ep.meta.rounds.length, 2);
    assert.equal(ep.meta.rounds[0].task, "duel vs B Pro · arcade");
    assert.equal(ep.meta.rounds[0].outcome, null);
    assert.equal(ep.meta.rounds[1].task, "dock the core from pose 3 zone B");
    assert.equal(ep.meta.rounds[1].outcome, "success");
    assert.equal(ep.meta.rounds[1].physics, "arcade");
    assert.ok(ep.meta.rounds[1].durationS > 0.5);
    assert.ok(ep.meta.rounds[1].segments.length >= 1 && ep.meta.rounds[1].segments[0].firstTick === 30);
    assert.ok(ep.meta.rounds[0].segments.every((g) => ["carry", "contest", "guard", "attack", "idle"].includes(g.label)));
    assert.equal(ep.meta.rounds[0].segments[0].label, "guard", "intent bit 1 held: a guard segment");
  });

  test("copies: the driver reuses its row and block buffers", () => {
    const rec = createRecorder();
    rec.begin(metaFor(humanVsBuiltinConfig(), "atlas"));
    const obs = { atlas: randomBlocks(3), blaze: randomBlocks(4) };
    const applied = { atlas: new Float64Array(6), blaze: new Float64Array(6) };
    for (let t = 0; t < 5; t++) {
      obs.atlas.state[0] = t;
      applied.atlas[0] = t * 10;
      rec.tick(row(t, 1, "fight", obs, applied));
    }
    const ep = rec.end({ winner: null, roundsWon: { atlas: 0, blaze: 0 }, rounds: [], forfeit: null, determinism: "unchecked", error: null });
    assert.deepEqual(Array.from({ length: 5 }, (_, t) => ep.columns["observation.state.atlas"][t * 12]), [0, 1, 2, 3, 4]);
    assert.deepEqual(Array.from({ length: 5 }, (_, t) => ep.columns["action.atlas"][t * 6]), [0, 10, 20, 30, 40]);
  });

  test("per-step ctrl and intents are run-length encoded and restart at every reset", () => {
    const rec = createRecorder();
    rec.begin(metaFor(humanVsBuiltinConfig(), "atlas"));
    const frame = fakeFrame();
    const engine = createFakeEngine();
    for (let round = 1; round <= 2; round++) {
      rec.mutation({ kind: "reset", step: 0, seed: round, round, state: engine.saveState() });
      frame.arms.atlas.ctrl.fill(0.5);
      for (let step = 0; step < 100; step++) {
        if (step === 40) frame.arms.blaze.ctrl[2] = round;
        if (step === 70) frame.arms.atlas.ctrl[0] = -0;          // -0 differs from +0 bit-wise
        rec.stepCtrl(step, frame, { atlas: step >= 50 ? 1 : 0, blaze: 0 });
      }
    }
    const ep = rec.end({ winner: null, roundsWon: { atlas: 0, blaze: 0 }, rounds: [], forfeit: null, determinism: "unchecked", error: null });
    assert.equal(ep.steps.ctrl.width, 12);
    const ctrlSteps = Array.from(ep.steps.ctrl.steps);
    assert.deepEqual(ctrlSteps.slice(0, 3), [0, 40, 70]);
    assert.ok(ctrlSteps.length >= 5);
    assert.deepEqual(Array.from(ep.steps.intents.steps), [0, 50, 0, 50]);
    const seg = ep.sparse[SEGMENTS_COLUMN].map((e) => e.value);
    assert.equal(seg.length, 2);
    assert.equal(seg[0].steps, 100);
    assert.equal(seg[1].ctrlIndex, 3);
    assert.equal(seg[1].intentsIndex, 2);
    assert.equal(seg[1].lastStep, 99);
  });

  test("alignment: delay 1, decimation 2, fair delay 120 ms — every action_raw row points at the delivered observation its policy saw", async () => {
    let rec = null;
    const runner = defineHeadlessMatchRunner({ createChunkExecutor: createFakeChunkExecutor, createDelayLine: createFakeDelayLine, hitstopMsFor: fakeHitstopMsFor })({
      createEngine: async ({ mode }) => createFakeEngine({ mode }),
      createRules: () => createFakeRules(),
      kinematics: createFakeKinematics(), observations: createFakeObservationBuilder(),
      // Echo policy: returns the tick stamp (game[0]) of the observation it was handed.
      createSeatDriver: async (spec, seat) => createFakeSeatDriver(seat, { kind: spec.kind, act: (obs) => ({ targets: [obs.blocks.game[0], 0, 0, 0, 0, 1] }) }),
      createPilot: () => createFakePilot("atlas"),
      createProxyBot: () => ({ reset() {}, update() {} }),
      createRecorder: () => (rec = createRecorder()),
    });
    const cfg = buildMatchConfig({
      preset: "proving_ground", context: "lab", seed: 3, bestOf: 1, now: NOW, actionDelayTicks: 1, fairDelayMs: 120,
      seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "module", fileName: "echo.mjs", source: "", sha256: "e" }, decisionHz: 25 } },
    });
    const ep = await runner.run(cfg);
    assert.ok(rec);
    const c = ep.columns;
    const req = c["policy.request_frame_index.blaze"];
    const raw = c["action_raw.blaze"];
    const deliveredGame = c["observation.delivered.game.blaze"];
    const obsGame = c["observation.game.blaze"];
    assert.ok(deliveredGame, "delivered observations recorded under a fair delay");
    let arrivals = 0;
    let delayedRows = 0;
    for (let i = 0; i < req.length; i++) {
      if (req[i] < 0) continue;
      arrivals++;
      const r = req[i];
      assert.ok(r <= i, "a reply is never recorded before its request");
      assert.equal(raw[i * 6], deliveredGame[r * 16], `row ${i}: policy saw the delivered observation of row ${r}`);
      if (deliveredGame[r * 16] < obsGame[r * 16]) delayedRows++;
    }
    assert.ok(arrivals > 100, `${arrivals} arrivals`);
    assert.ok(delayedRows > arrivals * 0.9, "the delivered observation is the delayed one");
    const decisions = Array.from(req).filter((r) => r >= 0);
    assert.ok(decisions.every((r) => r % 2 === 0), "decision ticks every 2 control ticks");
  });

  test("speed and size: a 3 x 45 s Arcade match with a human seat", async (t) => {
    const cfg = humanVsBuiltinConfig("arcade");
    const rec = createRecorder();
    rec.begin(metaFor(cfg, "atlas"));
    const engine = createFakeEngine();
    const frame = fakeFrame();
    const obs = { atlas: randomBlocks(5), blaze: randomBlocks(6) };
    const applied = { atlas: new Float64Array(6), blaze: new Float64Array(6) };
    const r = row(0, 1, "fight", obs, applied);
    const SPT = 8;                               // 400 Hz physics, 50 Hz control
    const OVERHEAD_ROWS = 300;                   // round intro 2.4 s + KO 1.8 s + summary 1 s per round
    let ticks = 0;
    let t0 = performance.now();
    for (let round = 1; round <= 3; round++) {
      rec.mutation({ kind: "reset", step: 0, seed: round, round, state: engine.saveState() });
      for (let tick = 0; tick < 45 * 50 + OVERHEAD_ROWS; tick++) {
        const live = tick < 45 * 50;
        for (const s of ["atlas", "blaze"]) for (const b of Object.values(obs[s])) b[tick % b.length] = Math.sin(tick + b.length);
        applied.atlas[0] = live ? Math.sin(tick / 7) : 0;
        applied.blaze[1] = live ? Math.floor(tick / 2) / 100 : 0;
        r.frameIndex = ticks; r.t = tick / 50; r.round = round; r.phase = live ? "fight" : "ko";
        if (tick % 50 === 0) rec.checkpoint(tick * SPT, engine.saveState(), tick);
        rec.tick(r);
        for (let k = 0; k < SPT; k++) {
          if (live) frame.arms.atlas.ctrl[0] = Math.sin((tick * SPT + k) / 23);   // a human's ctrl changes every step
          frame.arms.blaze.ctrl[1] = applied.blaze[1];
          rec.stepCtrl(tick * SPT + k, frame, { atlas: 0, blaze: 0 });
        }
        ticks++;
      }
    }
    const perTickMs = (performance.now() - t0) / ticks;
    const ep = rec.end({ winner: "atlas", roundsWon: { atlas: 2, blaze: 1 }, rounds: [], forfeit: null, determinism: "unchecked", error: null });
    assert.ok(perTickMs <= 0.3, `recorder ${perTickMs.toFixed(4)} ms per control tick`);

    const store = createEpisodeStoreOn(createMemoryBackend());
    // Best of three: the first save warms the clone path, and a loaded test runner adds scheduling noise.
    let saveMs = Infinity;
    for (let i = 0; i < 3; i++) {
      t0 = performance.now();
      await store.save(ep);
      saveMs = Math.min(saveMs, performance.now() - t0);
    }
    assert.ok(saveMs <= 50, `store.save ${saveMs.toFixed(1)} ms`);

    const bytes = encodeEpisodeText(ep).length;
    // BUILD_PLAN 4 WP5.7 targets 17 MB. The D5 format (every column base64, per-step float64 ctrl) measures larger;
    // the exact figure is reported in the WP5 handoff and guarded here so it cannot grow unnoticed.
    assert.ok(bytes <= 26e6, `JSON export ${(bytes / 1e6).toFixed(2)} MB`);
    t.diagnostic(`recorder ${perTickMs.toFixed(4)} ms/tick · store.save ${saveMs.toFixed(1)} ms · export ${(bytes / 1e6).toFixed(2)} MB for ${ticks} rows`);
  });

  test("end before begin throws; calls while not recording are ignored", () => {
    const rec = createRecorder();
    assert.throws(() => rec.end({ winner: null, roundsWon: { atlas: 0, blaze: 0 }, rounds: [], forfeit: null, determinism: "unchecked", error: null }), /before begin/);
    rec.tick(row(0, 1, "fight", { atlas: randomBlocks(1), blaze: randomBlocks(1) }, { atlas: new Float64Array(6), blaze: new Float64Array(6) }));
    rec.events([{ type: "whiff", t: 0, step: 0, seat: "atlas" }]);
    assert.equal(rec.recording, false);
  });
});
