import assert from "node:assert/strict";
import { test } from "node:test";
import { createRng } from "../src/game/core/rng.ts";
import { clearDdaLedger } from "../src/game/policy/opponent/dda.ts";
import * as builtin from "../src/game/policy/opponent/index.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

/** A busy scripted fight: a wandering hand, lunges, charges, hits both ways, a Core that drops and gets docked. */
function stream(n, worldSeed = 99) {
  const rng = createRng(worldSeed);
  const out = [];
  let hand = [0.44, 0, 0.15];
  for (let i = 0; i < n; i++) {
    const t = 0.04 * (i + 1);
    const o = emptyObservation("blaze");
    o.t = t; o.dt = 0.02; o.tick = 2 * (i + 1); o.frame_index = o.tick; o.preset = "arcade";
    const lunge = i % 45 > 38;
    const vel = lunge ? [-1.2, rng.range(-0.3, 0.3), 0] : [rng.range(-0.2, 0.2), rng.range(-0.2, 0.2), 0];
    hand = [Math.min(0.55, Math.max(0.25, hand[0] + vel[0] * 0.04 + (lunge ? 0 : (0.44 - hand[0]) * 0.1))), hand[1] * 0.9 + vel[1] * 0.04, 0.15];
    o.opponent.ee.pos = hand; o.opponent.ee.linvel = vel;
    o.opponent.wrist_pos = [hand[0] + 0.03, hand[1], hand[2]]; o.opponent.elbow_pos = [hand[0] + 0.12, hand[1], 0.2];
    o.opponent.charge_public = i % 150 > 130 ? 0.5 : 0; o.opponent.guard = i % 90 < 20;
    o.self.ee.pos = [0.26, 0.01, 0.15]; o.self.wrist_pos = [0.23, 0, 0.15];
    o.self.integrity = 100 - Math.floor(i / 200) * 7; o.self.integrity_max = 100; o.self.heat = (i * 7) % 90;
    o.opponent.integrity = 100 - Math.floor(i / 170) * 9; o.opponent.integrity_max = 100;
    o.round.phase = "fight"; o.round.best_of = 3; o.round.phase_length = 45; o.round.time_remaining = Math.max(0, 45 - (t % 45));
    if (t % 45 > 15) { o.core.phase = "live"; o.cubes[4].pos = [0.32, 0.01, 0.02]; o.cubes[4].parked = false; }
    if (i % 60 === 0) o.contacts.push({ kind: "strike", attacker: i % 120 === 0 ? "opponent" : "self", damage_to_self: 12, damage_to_opponent: 9, normal_speed: 1.6, zone: "wrist", pos: [0.3, 0, 0.15], t: t - 0.01 });
    if (i % 97 === 0) o.contacts.push({ kind: "deflect", attacker: "self", damage_to_self: 0, damage_to_opponent: 0, normal_speed: 1, zone: null, pos: [0.3, 0, 0.15], t: t - 0.02 });
    o.blocks.game[0] = o.self.integrity / 100; o.blocks.game[1] = o.opponent.integrity / 100; o.blocks.game[8] = o.core.phase === "live" ? 1 : 0;
    out.push(o);
  }
  return out;
}

function ctx(seed, personality, tier, opponentMemory) {
  const c = registrationContext("blaze", seed);
  return {
    ...c, mode: "eval", preset: "arcade", physics: "arcade", episode_id: `det-${personality}-${tier}`, rules: { ...c.rules, scoring: "full" },
    config: { personality, tier, dda: true }, ...(opponentMemory ? { opponentMemory } : {}),
  };
}

function runAll(policy, seed, personality, tier, obs, memory) {
  clearDdaLedger();
  policy.reset(ctx(seed, personality, tier, memory));
  return obs.map((o) => JSON.stringify(policy.act(o)));
}

test("identical built-in actions over 3,000 acts from the same seed (every personality)", () => {
  const obs = stream(3000);
  for (const [personality, tier] of [["overshoot", "pro"], ["backlash", "champion"], ["deadband", "rookie"], ["jig", "contender"]]) {
    const a = runAll(builtin.createOpponent(), 4242, personality, tier, obs);
    const b = runAll(builtin.createOpponent(), 4242, personality, tier, obs);
    for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i], `${personality} act ${i} differs`);
  }
});

test("the module-level reset/act (Worker entry) matches a fresh instance, and seeds matter", () => {
  const obs = stream(600, 7);
  const viaModule = runAll({ reset: builtin.reset, act: builtin.act }, 99, "deadband", "pro", obs);
  const viaInstance = runAll(builtin.createOpponent(), 99, "deadband", "pro", obs);
  assert.deepEqual(viaModule, viaInstance);
  const other = runAll(builtin.createOpponent(), 100, "deadband", "pro", obs);
  assert.notDeepEqual(other, viaInstance);
});

test("the same opponentMemory replays bit-exact; a different one does not (EMOTION_BIBLE 4.5)", async () => {
  const { EMPTY_OPPONENT_MEMORY } = await import("../src/game/contracts.ts");
  const obs = stream(800, 5);
  const remembered = { bestMove: "JAB", hurtSide: 1, timeToFirstAttackS: 1.2, feintsWorked: 2, grudge: 1 };
  const a = runAll(builtin.createOpponent(), 77, "backlash", "contender", obs, remembered);
  const b = runAll(builtin.createOpponent(), 77, "backlash", "contender", obs, { ...remembered });
  assert.deepEqual(a, b);
  const empty = runAll(builtin.createOpponent(), 77, "backlash", "contender", obs, EMPTY_OPPONENT_MEMORY);
  assert.notDeepEqual(a, empty);
  const absent = runAll(builtin.createOpponent(), 77, "backlash", "contender", obs);
  assert.deepEqual(absent, empty, "an absent record is the empty record (HARNESS)");
});

test("the status channel carries affect at 10 Hz, show events and gaze events (11.9)", () => {
  const obs = stream(600, 9);
  const brain = builtin.createOpponent();
  clearDdaLedger();
  brain.reset(ctx(3, "overshoot", "pro"));
  let affects = 0, shows = 0, gazes = 0;
  for (const o of obs) {
    const d = brain.act(o).debug;
    if (d.affect) { affects++; for (const k of ["arousal", "valence", "stance", "composure", "menace"]) assert.ok(Number.isFinite(d.affect[k]), k); }
    if (d.show) shows += d.show.length;
    if (d.gaze) gazes += d.gaze.length;
    assert.equal(d.tier, "pro");
  }
  // 600 acts at 25 Hz = 24 s: about 240 affect samples at 10 Hz.
  assert.ok(affects >= 200 && affects <= 260, `affect samples ${affects}`);
  assert.ok(shows > 0 && gazes > 0, `shows ${shows} gazes ${gazes}`);
});

test("never calls Math.random or reads the wall clock", () => {
  const obs = stream(400, 3);
  const random = Math.random, now = Date.now, perf = performance.now;
  Math.random = () => { throw new Error("Math.random used"); };
  Date.now = () => { throw new Error("Date.now used"); };
  performance.now = () => { throw new Error("performance.now used"); };
  try {
    runAll(builtin.createOpponent(), 1, "overshoot", "champion", obs);
  } finally {
    Math.random = random; Date.now = now; performance.now = perf;
  }
});

test("outputs stay 0.01 rad inside the joint limits, finite, as a 50 Hz chunk", async () => {
  const { JOINT_LIMITS } = await import("../src/game/contracts.ts");
  const brain = builtin.createOpponent();
  clearDdaLedger();
  brain.reset(ctx(5, "overshoot", "rookie"));
  for (const o of stream(1500, 11)) {
    const a = brain.act(o);
    assert.equal(a.chunkHz, 50);
    assert.equal(a.chunkStartT, o.t);
    assert.equal(a.chunk.length, a.intentChunk.length);
    for (const row of a.chunk) {
      for (let j = 0; j < 6; j++) {
        assert.ok(Number.isFinite(row[j]));
        assert.ok(row[j] >= JOINT_LIMITS[j][0] + 0.01 - 1e-12 && row[j] <= JOINT_LIMITS[j][1] - 0.01 + 1e-12, `joint ${j} = ${row[j]}`);
      }
    }
  }
});
