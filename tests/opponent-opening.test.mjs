// Opening grace (EMOTION_BIBLE 4.5 "tough = smart", GAME_DESIGN 2.2 ENGAGE): after the fight starts the built-in
// opponent commits no attack for the tier's grace (3 s; 5 s in the SPARRING tier), so the opponent lives long
// enough to have a mood and a player's first input always lands before they can be hit. Also the scripted
// behaviours (the tutorial's sparring cues): parked in reach, the held SLAM released by the player's guard, no POKE.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { INTENT_BITS } from "../src/game/contracts.ts";
import { clearDdaLedger } from "../src/game/policy/opponent/dda.ts";
import { OPENING_GRACE_S } from "../src/game/policy/opponent/decision.ts";
import { createOpponent } from "../src/game/policy/opponent/index.ts";
import { SPARRING_TIER, TIERS } from "../src/game/policy/opponent/tiers.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

const ATTACKS = new Set(["POKE", "JAB", "HOOK", "SLAM", "WHIFF_PUNISH", "GRAB_THROW"]);
const INTRO_S = 1.2;
const AFTER_S = 2.5;

function context(personality, tier, seed, behavior) {
  const c = registrationContext("blaze", seed);
  return {
    ...c, mode: "live", preset: "arcade", physics: "arcade", episode_id: `open-${personality}-${tier}-${seed}`,
    rules: { ...c.rules, scoring: "full" }, config: { personality, tier, dda: false, ...(behavior ? { behavior } : {}) },
  };
}

/** The opponent's hand parked well inside reach, extended past the guard line: the most tempting target there is. */
function observe(t, phase, guard = false) {
  const o = emptyObservation("blaze");
  o.opponent.guard = guard;
  o.t = t; o.dt = 0.02; o.preset = "arcade"; o.tick = Math.round(t / 0.02); o.frame_index = o.tick;
  o.self.ee.pos = [0.25, 0, 0.15]; o.self.wrist_pos = [0.22, 0, 0.15]; o.self.integrity = 100; o.self.integrity_max = 100;
  const hand = [0.33, 0.04, 0.14];
  o.opponent.ee.pos = hand; o.opponent.wrist_pos = [hand[0] + 0.03, hand[1], hand[2]];
  o.opponent.elbow_pos = [hand[0] + 0.12, hand[1], hand[2] + 0.05];
  o.opponent.integrity = 100; o.opponent.integrity_max = 100;
  o.round.phase = phase; o.round.best_of = 3; o.round.time_remaining = 45; o.round.phase_length = 45;
  o.blocks.game[0] = 1; o.blocks.game[1] = 1;
  return o;
}

/** Sim time after the fight start of the first attack the policy commits to (Infinity if none in 4 s). */
function firstAttackAfterEngage(personality, tier, seed, behavior) {
  clearDdaLedger();
  const brain = createOpponent();
  brain.reset(context(personality, tier, seed, behavior));
  for (let t = 0.04; t < INTRO_S + OPENING_GRACE_S + AFTER_S; t += 0.04) {
    const phase = t < INTRO_S ? "round_intro" : "fight";
    const a = brain.act(observe(t, phase));
    // A feint runs JAB or SLAM, so the primitive in flight names every attack.
    if (phase === "fight" && ATTACKS.has(a.debug?.primitive)) return t - INTRO_S;
  }
  return Infinity;
}

describe("opening grace", () => {
  test("the grace is the bible's 3 s at every tier and 5 s in the SPARRING tier", () => {
    assert.equal(OPENING_GRACE_S, 3);
    for (const t of Object.values(TIERS)) assert.equal(t.openingGraceS, 3);
    assert.equal(SPARRING_TIER.openingGraceS, 5);
    assert.equal(SPARRING_TIER.noSlam, true);
  });

  test("no personality or tier commits an attack inside the grace, and each still attacks soon after", () => {
    const late = [];
    for (const personality of ["overshoot", "backlash", "deadband"]) {
      for (const tier of ["rookie", "contender", "pro", "champion"]) {
        for (let seed = 1; seed <= 8; seed++) {
          const at = firstAttackAfterEngage(personality, tier, seed);
          assert.ok(at >= OPENING_GRACE_S - 1e-9, `${personality}:${tier} seed ${seed} attacked ${at.toFixed(2)} s after ENGAGE`);
          late.push(at);
        }
      }
    }
    // Not vacuous: with a hand parked in reach, most entrants go on the attack within 2 s of the grace ending.
    const soon = late.filter((x) => x < OPENING_GRACE_S + 2).length;
    assert.ok(soon / late.length >= 0.5, `${soon}/${late.length} attacked within 2 s of the grace`);
  });

  test("scripted wind-ups count from ENGAGE, not from the intro; sparring and parked never strike", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const at = firstAttackAfterEngage("backlash", "rookie", seed, "slow_heavy");
      assert.ok(at >= OPENING_GRACE_S - 1e-9 && at < OPENING_GRACE_S + 0.5, `slow_heavy seed ${seed} struck ${at.toFixed(2)} s after ENGAGE`);
      for (const behavior of ["sparring", "parked_in_reach", "idle", "hold_guard"]) {
        assert.equal(firstAttackAfterEngage("backlash", "rookie", seed, behavior), Infinity, `${behavior} seed ${seed} struck`);
      }
    }
  });
});

/** Runs a scripted BACKLASH for `seconds` of fight; `guardFrom` turns the player's guard on from that time. */
function scripted(behavior, seed, seconds, guardFrom = Infinity, parkOffsetM) {
  clearDdaLedger();
  const brain = createOpponent();
  const c = context("backlash", "rookie", seed, behavior);
  if (parkOffsetM !== undefined) c.config.parkOffsetM = parkOffsetM;
  brain.reset(c);
  const acts = [];
  for (let t = 0.04; t < seconds; t += 0.04) acts.push({ t, a: brain.act(observe(t, "fight", t >= guardFrom)) });
  return acts;
}

describe("sparring mode (EMOTION_BIBLE 4.3, bible 2 round 1)", () => {
  test("parked_in_reach: the gripper sits inside the pilot's reach from the first frames and never POKEs", () => {
    const acts = scripted("parked_in_reach", 3, 12);
    assert.ok(acts.every(({ a }) => a.debug.primitive !== "POKE" && !ATTACKS.has(a.debug.primitive)));
    assert.ok(acts.some(({ a }) => a.debug.primitive === "PARK"));
    // A negative park offset (the tutorial's nudge) moves the hand toward the player: the pan/lift targets shift.
    const nudged = scripted("parked_in_reach", 3, 12, Infinity, -0.04);
    const a0 = acts.at(-1).a.chunk[0], a1 = nudged.at(-1).a.chunk[0];
    assert.ok(Math.abs(a0[1] - a1[1]) + Math.abs(a0[2] - a1[2]) > 0.02, "nudge did not move the hand");
  });

  test("slow_heavy: a SLAM tell of ≥ 300 ms held at the top up to 3 s, released early when the player guards, repeated 1.5 s later", () => {
    const held = scripted("slow_heavy", 4, 12);
    const tells = held.flatMap(({ a }) => (a.debug.show ?? []).filter((e) => e.kind === "tell"));
    assert.ok(tells.length >= 2, `tells ${tells.length}`);
    assert.ok(tells.every((e) => e.primitive === "slam" && e.ms >= 300), JSON.stringify(tells[0]));
    assert.ok(tells.every((e) => e.ms <= 3000 + 1), "the hold outlasts 3 s");
    const strikes = held.filter(({ a }) => a.debug.primitive === "SLAM" && a.debug.phase === "active").map(({ t }) => t);
    const firstWind = held.find(({ a }) => a.debug.primitive === "SLAM").t;
    assert.ok(strikes[0] - firstWind >= 2.4, `struck ${(strikes[0] - firstWind).toFixed(2)} s after the wind-up began`);
    // The guard intent is charged (public) during the hold.
    assert.ok(held.some(({ a }) => (a.intentChunk[0] & INTENT_BITS.charge) !== 0), "no public charge during the hold");
    // Guard from 4.0 s: the strike releases well before the 3 s hold runs out.
    const guarded = scripted("slow_heavy", 4, 12, 4.0);
    const gWind = guarded.find(({ a }) => a.debug.primitive === "SLAM").t;
    const gStrike = guarded.find(({ a }) => a.debug.primitive === "SLAM" && a.debug.phase === "active").t;
    assert.ok(gStrike - gWind < 1.6, `guarded release took ${(gStrike - gWind).toFixed(2)} s`);
  });

  test("a flinch is commanded on the contact tick in sparring, and the hand re-approaches after 1.5 s", () => {
    clearDdaLedger();
    const brain = createOpponent();
    brain.reset(context("backlash", "rookie", 5, "parked_in_reach"));
    let flinchAt = -1, x = [];
    for (let t = 0.04; t < 8; t += 0.04) {
      const o = observe(t, "fight");
      if (Math.abs(t - 4) < 0.02) o.contacts.push({ kind: "strike", attacker: "opponent", damage_to_self: 0, damage_to_opponent: 0, normal_speed: 1.4, zone: "wrist", pos: [0.3, 0.04, 0.15], t: t - 0.01 });
      const a = brain.act(o);
      if ((a.debug.show ?? []).some((e) => e.kind === "flinch") && flinchAt < 0) flinchAt = t;
      x.push({ t, primitive: a.debug.primitive });
    }
    assert.ok(Math.abs(flinchAt - 4) < 0.05, `flinch at ${flinchAt}`);
    assert.ok(x.every((r) => !ATTACKS.has(r.primitive)), "sparring struck back");
  });
});
