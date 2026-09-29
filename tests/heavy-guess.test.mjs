import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { INTENT_BITS } from "../src/game/contracts.ts";
import { createRng } from "../src/game/core/rng.ts";
import { clearDdaLedger } from "../src/game/policy/opponent/dda.ts";
import { createOpponent } from "../src/game/policy/opponent/index.ts";
import { TIERS } from "../src/game/policy/opponent/tiers.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

// A scripted player that only throws charged heavies (the heavy_mixer pattern, as an observation stream):
// public charge from c = 0.25, full after 450 ms more, a release delay past full, then a lunge at our guard.
// Deflect rule (GAME_DESIGN 4.4): guard press edge P with T − 150 ms ≤ P ≤ T + 5 ms, T = contact onset; a press
// within 400 ms of the previous one is locked out (anti-mash).

const REST = 0.52, HIT = 0.27, LUNGE_SPEED = 1.4, CYCLE_S = 3.2;
const TRAVEL_S = (REST - HIT) / LUNGE_SPEED;

function context(tier, seed) {
  const c = registrationContext("blaze", seed);
  return { ...c, mode: "live", preset: "arcade", physics: "arcade", episode_id: `heavy-${tier}-${seed}`, rules: { ...c.rules, scoring: "full" }, config: { personality: "overshoot", tier, dda: false } };
}

function plan(seed, cycles, delayOf) {
  const rng = createRng(seed ^ 0x5a5a);
  const heavies = [];
  for (let i = 0; i < cycles; i++) {
    const start = 0.8 + i * CYCLE_S;
    const full = start + 0.45;
    const release = full + delayOf(rng) / 1000;
    heavies.push({ start, full, release, impact: release + TRAVEL_S });
  }
  return heavies;
}

function handAt(heavies, t) {
  for (const h of heavies) {
    if (t < h.start || t > h.impact + 0.4) continue;
    if (t < h.release) return { x: REST, vx: 0, charge: Math.min(1, 0.25 + 0.75 * (t - h.start) / 0.45) };
    if (t <= h.impact) return { x: REST - LUNGE_SPEED * (t - h.release), vx: -LUNGE_SPEED, charge: 0 };
    return { x: HIT + (REST - HIT) * (t - h.impact) / 0.4, vx: (REST - HIT) / 0.4, charge: 0 };
  }
  return { x: REST, vx: 0, charge: 0 };
}

function run(tier, seed, delayOf, cycles = 12) {
  clearDdaLedger();
  const heavies = plan(seed, cycles, delayOf);
  const brain = createOpponent();
  brain.reset(context(tier, seed));
  let prevGuard = false;
  const presses = [];
  let guesses = 0;
  let parries = 0, successes = 0;
  const end = heavies.at(-1).impact + 1;
  for (let t = 0.04; t < end; t += 0.04) {
    const o = emptyObservation("blaze");
    o.t = t; o.dt = 0.02; o.preset = "arcade";
    o.self.ee.pos = [0.25, 0, 0.15]; o.self.wrist_pos = [0.22, 0, 0.15]; o.self.integrity = 100; o.self.integrity_max = 100; o.self.heat = 20;
    const hand = handAt(heavies, t);
    o.opponent.ee.pos = [hand.x, 0, 0.15]; o.opponent.ee.linvel = [hand.vx, 0, 0];
    o.opponent.wrist_pos = [hand.x + 0.03, 0, 0.15]; o.opponent.elbow_pos = [hand.x + 0.12, 0, 0.2];
    o.opponent.charge_public = hand.charge; o.opponent.integrity = 100; o.opponent.integrity_max = 100;
    o.round.phase = "fight"; o.round.best_of = 3; o.round.time_remaining = 40; o.round.phase_length = 45;
    o.blocks.game[0] = 1; o.blocks.game[1] = 1;
    // Resolve every heavy whose impact fell since the last observation, using the presses we saw.
    for (const h of heavies) {
      if (h.resolved || h.impact > t) continue;
      h.resolved = true;
      // Anti-mash (4.4): a press within 400 ms of an earlier press opens no deflect window.
      const pressed = presses.some((p, i) => p >= h.impact - 0.15 && p <= h.impact + 0.005 && (i === 0 || p - presses[i - 1] >= 0.4));
      if (h.parried) { parries++; if (pressed) successes++; }
      o.contacts.push(pressed
        ? { kind: "deflect", attacker: "opponent", damage_to_self: 0, damage_to_opponent: 0, normal_speed: 1.4, zone: null, pos: [0.3, 0, 0.15], t: h.impact }
        : { kind: "strike", attacker: "opponent", damage_to_self: 6, damage_to_opponent: 0, normal_speed: 1.4, zone: "gripper", pos: [0.3, 0, 0.15], t: h.impact });
    }
    const a = brain.act(o);
    if (a.debug.parryGuess) {
      guesses++;
      assert.ok(Number.isFinite(a.debug.parryGuess.expectedReleaseT) && Number.isFinite(a.debug.parryGuess.errorMs));
      // Attribute the guess to the heavy being charged now.
      const h = heavies.find((x) => t >= x.start && t <= x.impact);
      if (h) h.parried = true;
    }
    for (let k = 0; k < a.chunk.length - 1; k++) {
      const guard = (a.intentChunk[k] & INTENT_BITS.guard) !== 0;
      if (guard && !prevGuard) presses.push(t + k * 0.02);
      prevGuard = guard;
    }
  }
  return { parries, successes, guesses };
}

describe("heavy guess rule", () => {
  for (const tier of ["pro", "champion"]) {
    const cap = TIERS[tier].heavyParryCap;

    test(`${tier}: random release delays, heavy parry success over 30 seeds ≤ cap + 5 pp, every guess logged`, () => {
      let parries = 0, successes = 0, guesses = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const r = run(tier, seed, (rng) => rng.range(0, 1000));
        parries += r.parries; successes += r.successes; guesses += r.guesses;
      }
      assert.ok(parries >= 60, `only ${parries} heavy parries`);
      assert.equal(guesses, parries, "each heavy parry carries exactly one debug.parryGuess");
      assert.ok(successes / parries <= cap + 0.05, `${tier} success ${(100 * successes / parries).toFixed(1)}% vs cap ${cap * 100}%`);
    });

    test(`${tier}: a predictable release is capped too (the guess gets a deliberate error at the cap)`, () => {
      let parries = 0, successes = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const r = run(tier, seed, () => 250);
        parries += r.parries; successes += r.successes;
      }
      assert.ok(parries >= 60, `only ${parries} heavy parries`);
      const rate = successes / parries;
      assert.ok(rate <= cap + 0.05, `${tier} success ${(100 * rate).toFixed(1)}% vs cap ${cap * 100}%`);
      assert.ok(rate >= cap - 0.25, `${tier} still reads a habit: ${(100 * rate).toFixed(1)}%`);
    });
  }
});
