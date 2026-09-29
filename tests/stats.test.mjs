import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { INTENT_BITS, JOINT_LIMITS, MATCH_PHASES } from "../src/game/contracts.ts";
import {
  QUALITY_VERSION, actionChatter, actionJerk, computeStats, detectAttackOnsets, ldlj, quantile, resampledRuns, structuralLatencyMs, viewEpisode,
} from "../src/game/harness/stats.ts";

const ROWS = 400;
const HZ = 50;
const FIGHT = MATCH_PHASES.indexOf("fight");
const close = (a, b, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);

function seatMeta(driver, extra = {}) {
  return { driver, name: driver, loadout: "pivot", policySha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", decisionHz: 25, chunkExecute: "until_next_decision", temporalEnsembleM: null, inputDevice: null, ...extra };
}

/** Hand-built episode: atlas (builtin) attacks twice, blaze (module) reacts once and is struck once. */
function fixture({ preset = "harness", atlasDriver = "builtin" } = {}) {
  const col = (n, w = 1, ctor = Float32Array) => new ctor(n * w);
  const c = {
    timestamp: new Float64Array(ROWS).map((_, i) => i / HZ), frame_index: new Uint32Array(ROWS).map((_, i) => i),
    phase: new Uint8Array(ROWS).fill(FIGHT), discontinuity: new Uint8Array(ROWS), round: new Uint8Array(ROWS).fill(1),
  };
  c.discontinuity[0] = 1;
  for (const s of ["atlas", "blaze"]) {
    c[`observation.state.${s}`] = col(ROWS, 12);
    c[`observation.self_ext.${s}`] = col(ROWS, 32);
    c[`observation.opponent_state.${s}`] = col(ROWS, 28);
    c[`observation.game.${s}`] = col(ROWS, 16);
    c[`action.${s}`] = col(ROWS, 6, Float64Array);
    c[`intents.${s}`] = col(ROWS, 1, Uint8Array);
  }
  const A = c["observation.self_ext.atlas"], AO = c["observation.opponent_state.atlas"];
  const B = c["observation.self_ext.blaze"], BO = c["observation.opponent_state.blaze"];
  for (let i = 0; i < ROWS; i++) {
    A.set([0.3, 0, 0.1], i * 32);                 // atlas EE (atlas ego)
    AO.set([0.44, 0, 0.15], i * 28 + 25);          // blaze wrist in atlas ego
    B.set([0.2, 0, 0.15], i * 32);                 // blaze EE (blaze ego)
    B.set([0.2, 0, 0.15], i * 32 + 10);            // blaze wrist (blaze ego)
    BO.set([0.4, 0, 0.15], i * 28 + 25);           // atlas wrist in blaze ego
    BO.set([0.34, 0, 0.1], i * 28 + 12);           // atlas EE in blaze ego
  }
  for (const [start, len] of [[50, 30], [200, 4]]) {
    for (let i = start; i < start + len; i++) {
      A[i * 32 + 7] = 0.5;                         // toward blaze's guard volume
      BO[i * 28 + 19] = -0.5;                      // the same motion seen from blaze
    }
  }
  for (let i = 60; i < 70; i++) B[i * 32 + 7] = -0.5; // blaze pulls back 200 ms after the first onset
  // Blaze policy columns: decides every other row.
  const status = new Uint8Array(ROWS), compute = new Float32Array(ROWS).fill(NaN), raw = new Float64Array(ROWS * 6).fill(NaN), req = new Int32Array(ROWS).fill(-1);
  for (let i = 0; i < ROWS; i += 2) { compute[i] = i < 100 ? 1 : 3; req[i] = i; raw.set([0, 0, 0, 0, 0, 1], i * 6); }
  Object.assign(c, { "policy.status.blaze": status, "policy.compute_ms.blaze": compute, "action_raw.blaze": raw, "policy.request_frame_index.blaze": req });
  // Joint, torque, energy, Core hold on blaze.
  const S = c["observation.state.blaze"], G = c["observation.game.blaze"];
  for (let i = 0; i < ROWS; i++) {
    B[i * 32 + 13] = 1; S[i * 12 + 6] = 2;                              // tau 1 N·m at qd 2 rad/s on joint 0
    if (i < 40) B[i * 32 + 14] = 2.95;                                  // saturated joint 1 for 40 rows
    if (i >= 300) S[i * 12 + 3] = JOINT_LIMITS[3][1] - 0.01;             // wrist_flex near its limit
    if (i >= 100 && i < 150) { G[i * 16 + 6] = (8 - (i - 100) * 0.02) / 8; G[i * 16 + 7] = 1; }
  }
  const seats = { atlas: seatMeta(atlasDriver, atlasDriver === "builtin" ? { personality: "backlash", tier: "pro" } : {}), blaze: seatMeta("module") };
  const ev = (type, step, extra) => ({ type, t: step * 0.005, step, ...extra });
  const strike = (step, attacker, victim, extra = {}) => ev("strike", step, { tier: "strike", attacker, victim, raw: 20, damage: 25, physicalDamage: 12, nu: 1, vN: 2, zone: "wrist", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false, pos: [0, 0, 0], normal: [1, 0, 0], magnitude: 1, lethal: false, upgrade: false, thrownCube: -1, ...extra });
  const events = [
    strike(808, "atlas", "blaze", { vN: 2.0 }),                                   // row 202: inside 400 ms of the onset at 200
    strike(1200, "atlas", "blaze", { tier: "graze", physicalDamage: 3, damage: 4 }),
    strike(1300, "blaze", "atlas", { crit: true, zone: "camera_mount", vN: 3.0 }),
    ev("core", 500, { stage: "steal", seat: "blaze", from: "atlas", remainingS: 5, late: false, inherited: false }),
    ev("core", 900, { stage: "steal", seat: "blaze", from: "atlas", remainingS: 1.5, late: true, inherited: false }),
    ev("core", 950, { stage: "lock", seat: "blaze", from: null, remainingS: 0, late: false, inherited: false }),
    ev("table_hit", 1000, { seat: "blaze", force: 4, pos: [0, 0, 0] }),
    ev("table_hit", 1004, { seat: "blaze", force: 2, pos: [0, 0, 0] }),
  ];
  return {
    meta: {
      format: "torquelimit.episode/3", episodeId: "stats", created: "", controlHz: HZ, timestep: 0.005, seed: 1, seedStreams: {},
      preset, physics: preset === "arcade" ? "arcade" : "harness", scoring: preset === "arcade" ? "full" : "physical", timing: "eval",
      actionDelayTicks: 1, fairDelayMs: 0, strictLimits: false, seats, inputShaping: { atlas: null, blaze: null }, rules: { roundLengthS: 45, bestOf: 1 },
      tuning: null, tuningSha256: "", servoParamsHash: "", tolerances: {}, provenance: {},
      result: { winner: "blaze", roundsWon: { atlas: 0, blaze: 1 }, rounds: [{ round: 1, winner: "blaze", reason: "lock", tEnd: 8 }], forfeit: null, determinism: "unchecked", error: null },
    },
    columns: c, shapes: {}, steps: { ctrl: { steps: new Uint32Array(0), values: new Float64Array(0), width: 12 }, intents: { steps: new Uint32Array(0), values: new Uint8Array(0), width: 2 }, mutations: [], checkpoints: [] },
    sparse: {}, events,
  };
}

describe("stats: quality tier (EMOTION_BIBLE 9, frozen v1)", () => {
  test("a duel with a pilot who landed a strike is B (table hits) or A; an AFK pilot is D; the stamp lands on meta.quality once", () => {
    const ep = fixture({ atlasDriver: "human" });
    ep.meta.seats.atlas.inputDevice = "keyboard_mouse";
    const S = ep.columns["observation.state.atlas"];
    for (let i = 0; i < ROWS; i++) S[i * 12] = Math.sin(i / 5);           // a pilot who moves
    const st = computeStats(ep);
    assert.equal(st.quality.version, QUALITY_VERSION);
    // The fixture's attacks are velocity steps: LDLJ −8.3 misses the > −8 bar by design, so this duel is a B.
    assert.equal(st.quality.tier, "B", st.quality.reasons.join(", "));
    assert.ok(st.quality.reasons.some((r) => r.startsWith("LDLJ")));
    assert.equal(st.quality.clean, true);
    assert.deepEqual(ep.meta.quality, st.quality, "stamped at match end");
    // The same fight with bell-shaped swings is an A.
    const smooth = fixture({ atlasDriver: "human" });
    smooth.meta.seats.atlas.inputDevice = "keyboard_mouse";
    const SS = smooth.columns["observation.state.atlas"], SA = smooth.columns["observation.self_ext.atlas"];
    for (let i = 0; i < ROWS; i++) SS[i * 12] = Math.sin(i / 5);
    for (let i = 50; i < 80; i++) SA[i * 32 + 7] = 0.5 * Math.pow(Math.sin((Math.PI * (i - 50)) / 30), 2);
    for (let i = 200; i < 204; i++) SA[i * 32 + 7] = 0;
    const sq = computeStats(smooth).quality;
    assert.equal(sq.tier, "A", sq.reasons.join(", "));
    ep.meta.quality = { ...st.quality, tier: "C" };
    assert.equal(computeStats(ep).quality.tier, "C", "an existing stamp is kept: the version names its rules");
    const afk = fixture({ atlasDriver: "human" });
    afk.meta.seats.atlas.inputDevice = "keyboard_mouse";
    const q = computeStats(afk).quality;
    assert.equal(q.tier, "D");
    assert.ok(q.reasons.includes("idle"));
    assert.equal(q.clean, false);
  });

  test("drill rounds: success in the duration window with 0 table hits is A, success outside it is B, a grasp that failed is C", () => {
    const base = fixture({ atlasDriver: "human" });
    base.meta.seats.atlas.inputDevice = "keyboard_mouse";
    const S = base.columns["observation.state.atlas"], SA = base.columns["observation.self_ext.atlas"];
    for (let i = 0; i < ROWS; i++) { S[i * 12] = Math.sin(i / 5); SA[i * 32 + 7] = 0; }   // a drill: no attacks, so no attack LDLJ to judge
    const seg = (label) => [{ label, firstTick: 0, endTick: ROWS }];
    base.meta.rounds = [{ round: 1, task: "dock the core from pose 3 zone B", physics: "harness", preset: "harness", outcome: "success", durationS: 8, segments: seg("grasp") }];
    assert.equal(computeStats({ ...base, meta: { ...base.meta } }).quality.tier, "A");
    base.meta.quality = undefined;
    base.meta.rounds[0].durationS = 20;
    let q = computeStats({ ...base, meta: { ...base.meta, quality: undefined } }).quality;
    assert.equal(q.tier, "B");
    assert.ok(q.reasons.some((r) => r.includes("duration")));
    base.meta.rounds[0] = { ...base.meta.rounds[0], outcome: "fail", durationS: 8 };
    q = computeStats({ ...base, meta: { ...base.meta, quality: undefined } }).quality;
    assert.equal(q.tier, "C");
    base.meta.rounds[0] = { ...base.meta.rounds[0], outcome: "fail", segments: seg("approach") };
    q = computeStats({ ...base, meta: { ...base.meta, quality: undefined } }).quality;
    assert.equal(q.tier, "D", "a slow smooth arm that docks nothing is a D");
  });
});

describe("stats: physical block (5.10.1)", () => {
  const ep = fixture();
  const st = computeStats(ep);
  const atlas = st.seats.atlas.physical;
  const blaze = st.seats.blaze.physical;

  test("attack onsets: > 0.35 m/s toward the guard volume for >= 40 ms, debounced", () => {
    const v = viewEpisode(ep);
    assert.deepEqual(detectAttackOnsets(v, "atlas").map((o) => o.row), [50, 200]);
    assert.deepEqual(detectAttackOnsets(v, "blaze"), []);
    assert.equal(atlas.attackAttempts, 2);
    assert.equal(atlas.accuracy, 0.5);
  });

  test("physical block rate: attacks received with no strike within 400 ms", () => {
    assert.equal(blaze.physicalBlockRate, 0.5);
    assert.ok(Number.isNaN(atlas.physicalBlockRate), "no attacks received is no sample");
  });

  test("reaction latency raw and net of structural latency, with anticipations and no-reactions", () => {
    assert.equal(structuralLatencyMs(viewEpisode(ep), "blaze"), 40 + 20);   // 25 Hz decisions + 1 tick delay
    assert.equal(blaze.reactionMs.n, 1);
    close(blaze.reactionMs.rawMedian, 200);
    close(blaze.reactionMs.netMedian, 140);
    assert.equal(blaze.reactionMs.anticipations, 0);
    assert.equal(blaze.reactionMs.noReaction, 1);
    assert.equal(blaze.reactionMs.structuralMs, 60);
  });

  test("damage, strikes, grazes, crits, approach speed", () => {
    assert.equal(atlas.physicalDamageDealt, 15);
    assert.equal(blaze.physicalDamageTaken, 15);
    assert.equal(atlas.strikesLanded, 1);
    assert.equal(atlas.grazesLanded, 1);
    assert.equal(blaze.strikesTaken, 1);
    assert.equal(blaze.crits, 1);
    assert.deepEqual(atlas.approachSpeed, { median: 2, p90: 2 });
    assert.ok(Number.isNaN(atlas.opticsImpulse), "not recorded, not invented");
  });

  test("Core: steals, late steals, locks, lock-in held from the game block", () => {
    assert.equal(blaze.steals, 2);
    assert.equal(blaze.lateSteals, 1);
    assert.equal(blaze.locks, 1);
    close(blaze.lockInHeldS, 0.98, 1e-6);
    assert.equal(atlas.steals, 0);
  });

  test("decisions, reliability, compute percentiles", () => {
    assert.equal(blaze.reliability, 1);
    assert.equal(blaze.lateFrac, 0);
    assert.equal(blaze.computeMs.median, 3);
    assert.equal(blaze.computeMs.max, 3);
    close(blaze.computeMs.p99, 3);
    assert.equal(blaze.tableHits, 1);
  });

  test("energy, torque saturation, near-limit dwell", () => {
    close(blaze.energyJ, 400 * 2 * 0.02, 1e-6);
    close(blaze.torqueSaturationFrac, 0.1);
    close(blaze.nearLimitDwell, 0.25);
  });
});

describe("stats: smoothness on the 20 ms applied-action series", () => {
  test("jerk: a cubic ramp has a constant third difference", () => {
    const ep = fixture();
    const A = 1e-9;
    const act = ep.columns["action.blaze"];
    for (let k = 0; k < ROWS; k++) for (let j = 0; j < 6; j++) act[k * 6 + j] = A * k ** 3;
    const st = computeStats(ep);
    close(st.seats.blaze.physical.actionJerk, (Math.sqrt(6) * 6 * A) / 0.02 ** 3, 1e-6);
    assert.equal(st.seats.atlas.physical.actionJerk, 0);
  });

  test("chatter: sign changes per joint per second, ignoring moves under 0.01 rad", () => {
    const ep = fixture();
    const act = ep.columns["action.atlas"];
    for (let k = 0; k < ROWS; k++) { act[k * 6] = k % 2 ? 0.02 : 0; act[k * 6 + 1] = k % 2 ? 0.005 : 0; }
    const st = computeStats(ep);
    close(st.seats.atlas.physical.actionChatter, (ROWS - 2) / (6 * (ROWS - 1) * 0.02), 1e-9);
  });

  test("resampling: a 60 Hz series is interpolated onto 20 ms without dropping runs", () => {
    const ep = fixture();
    ep.meta.controlHz = 60;
    ep.meta.timestep = 1 / 600;
    const v = viewEpisode(ep);
    const series = new Float64Array(ROWS * 6).map((_, i) => (i % 6 === 0 ? (i / 6) / 60 : 0));   // joint 0 = time
    const runs = resampledRuns(v, series, 0.02);
    assert.equal(runs.length, 1);
    const run = runs[0];
    for (let k = 0; k < run.length / 6; k++) close(run[k * 6], k * 0.02, 1e-9);
    assert.ok(actionJerk(runs, 0.02) < 1e-6, "a linear ramp has no jerk beyond rounding");
    assert.equal(actionChatter(runs, 0.02, 0.01), 0);
  });

  test("LDLJ of a known velocity profile", () => {
    const dt = 0.02, n = 11;
    const vel = new Float64Array(n * 3);
    for (let k = 0; k < n; k++) vel[k * 3] = (k * dt) ** 2;
    close(ldlj(vel, dt), -Math.log((4 * (n - 2) * dt) / ((n - 1) * dt)), 1e-9);
    assert.ok(Number.isNaN(ldlj(new Float64Array(9), dt)));
  });

  test("quantiles interpolate", () => {
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.ok(Number.isNaN(quantile([], 0.5)));
  });
});

describe("stats: Arcade block (5.10.2)", () => {
  test("counts from recorded events, heat from the game block, AI heavy parries from intents", () => {
    const ep = fixture({ preset: "arcade" });
    const ev = (type, step, extra) => ({ type, t: step * 0.005, step, ...extra });
    ep.events.push(
      ev("deflect", 400, { defender: "atlas", attacker: "blaze", hard: true, pressLeadMs: 40, pos: [0, 0, 0], normal: [1, 0, 0] }),
      ev("late_guard", 410, { defender: "atlas", attacker: "blaze", refund: 3, pressLagMs: 20 }),
      ev("whiff", 1240, { seat: "blaze" }),                                   // row 310; atlas strikes at row 325 below
      ev("strike", 1300 , { tier: "strike", attacker: "atlas", victim: "blaze", raw: 30, damage: 40, physicalDamage: 20, nu: 1, vN: 2, zone: "wrist", tool: "gripper", crit: false, guarded: false, heavyC: 0.8, armoured: false, pos: [0, 0, 0], normal: [1, 0, 0], magnitude: 1, lethal: false, upgrade: false, thrownCube: -1 }),
      ev("strike", 1310, { tier: "strike", attacker: "blaze", victim: "atlas", raw: 10, damage: 5, physicalDamage: 4, nu: 1, vN: 1, zone: "wrist", tool: "gripper", crit: false, guarded: true, heavyC: 0, armoured: false, pos: [0, 0, 0], normal: [1, 0, 0], magnitude: 1, lethal: false, upgrade: false, thrownCube: -1 }),
      ev("servo_state", 1320, { seat: "blaze", state: "stagger", durationMs: 300, cause: "strike" }),
      ev("servo_state", 1330, { seat: "atlas", state: "cutout", durationMs: 900, cause: "heat" }),
      ev("burst", 1340, { seat: "atlas" }),
      ev("charge", 1400, { seat: "atlas", stage: "release", c: 1 }),
      ev("charge", 1440, { seat: "blaze", stage: "release", c: 0.9 }),        // row 360: atlas (builtin) guards and deflects
      ev("deflect", 1460, { defender: "atlas", attacker: "blaze", hard: false, pressLeadMs: 10, pos: [0, 0, 0], normal: [1, 0, 0] }),
    );
    ep.columns["intents.atlas"][358] = INTENT_BITS.guard;
    const G = ep.columns["observation.game.atlas"];
    for (let i = 0; i < ROWS; i++) G[i * 16 + 10] = i < 200 ? 0.2 : 0.6;
    const a = computeStats(ep).seats.atlas.arcade;
    assert.equal(a.deflects, 2);
    assert.equal(a.hardDeflects, 1);
    assert.equal(a.lateGuards, 1);
    assert.equal(a.whiffPunishes, 1);
    assert.equal(a.damageDealt, 25 + 4 + 40);
    assert.equal(a.damageTaken, 25 + 5);
    assert.equal(a.guardedChips, 1);
    assert.equal(a.staggersDealt, 1);
    assert.equal(a.cutouts, 1);
    assert.equal(a.bursts, 1);
    assert.equal(a.heavyAttempts, 1);
    assert.equal(a.heavySuccesses, 1);
    assert.equal(a.aiHeavyParryAttempts, 1);
    assert.equal(a.aiHeavyParrySuccesses, 1);
    close(a.meanHeat, 40, 1e-6);
    assert.equal(computeStats(fixture()).seats.atlas.arcade, null, "stock presets have no Arcade block");
  });
});
