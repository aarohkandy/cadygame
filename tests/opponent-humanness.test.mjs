// Built-in opponent humanness: reaction medians per tier (GAME_DESIGN 5.5.3), chatter, and the character
// acceptance of EMOTION_BIBLE WP4: the life metric in idle, gaze leading every strike, tells above their floors,
// the commanded flinch within two decision ticks of a contact, overlapped primitive boundaries, the action-jerk
// bound with every layer on, and no hesitation at Champion.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { INTENT_BITS } from "../src/game/contracts.ts";
import { actionChatter, actionJerk } from "../src/game/harness/stats.ts";
import { clearDdaLedger } from "../src/game/policy/opponent/dda.ts";
import { createOpponent } from "../src/game/policy/opponent/index.ts";
import { TELL_MIN_MS } from "../src/game/policy/opponent/primitives.ts";
import { TIERS } from "../src/game/policy/opponent/tiers.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

const DECISION_S = 0.04;

// DEADBAND carries no personality reaction offset (BACKLASH adds 15 ms), so medians compare to the tier table directly.
function context(tier, seed, personality = "deadband") {
  const c = registrationContext("blaze", seed);
  return { ...c, mode: "live", preset: "arcade", physics: "arcade", episode_id: `human-${tier}-${seed}`, rules: { ...c.rules, scoring: "full" }, config: { personality, tier, dda: false } };
}

/** A scripted opponent: a hand at rest out of reach that lunges at our guard every `period` seconds. */
function lungeWorld(period, offset = 0.6) {
  const rest = [0.52, 0, 0.15], strike = [0.27, 0, 0.15];
  const speed = 1.4;
  const outS = (rest[0] - strike[0]) / speed;
  return (t) => {
    const local = (t - offset) % period;
    const onset = t - local;
    let x = rest[0], vx = 0;
    if (t >= offset && local < outS) { x = rest[0] - speed * local; vx = -speed; }
    else if (t >= offset && local < outS + 0.35) { const k = (local - outS) / 0.35; x = strike[0] + (rest[0] - strike[0]) * k; vx = (rest[0] - strike[0]) / 0.35; }
    return { pos: [x, rest[1], rest[2]], vel: [vx, 0, 0], onset: t >= offset ? onset : -1 };
  };
}

function observe(t, hand) {
  const o = emptyObservation("blaze");
  o.t = t; o.dt = 0.02; o.preset = "arcade"; o.tick = Math.round(t / 0.02); o.frame_index = o.tick;
  o.self.ee.pos = [0.25, 0, 0.15]; o.self.wrist_pos = [0.22, 0, 0.15]; o.self.integrity = 100; o.self.integrity_max = 100;
  o.opponent.ee.pos = [...hand.pos]; o.opponent.ee.linvel = [...hand.vel];
  o.opponent.wrist_pos = [hand.pos[0] + 0.03, hand.pos[1], hand.pos[2]];
  o.opponent.elbow_pos = [hand.pos[0] + 0.12, hand.pos[1], hand.pos[2] + 0.05];
  o.opponent.integrity = 100; o.opponent.integrity_max = 100;
  o.round.phase = "fight"; o.round.best_of = 3; o.round.time_remaining = 40; o.round.phase_length = 45;
  o.blocks.game[0] = 1; o.blocks.game[1] = 1;
  return o;
}

/** Runs the policy against the lunges; returns net reactions (onset → first defensive intent edge), in ms. */
function measure(tier, seed, seconds = 60, period = 1.7) {
  clearDdaLedger();
  const brain = createOpponent();
  brain.reset(context(tier, seed));
  const world = lungeWorld(period);
  const reactions = [];
  let prevGuard = false;
  let answeredOnset = -1;
  // Chatter exactly as the harness grades it (stats.ts actionChatter, GAME_DESIGN 5.10.1): sign changes of the
  // per-step Δ on the 20 ms committed series, counting only steps above StatsTolerances.chatterMin (0.01 rad).
  const series = [];
  for (let t = 0.04; t < seconds; t += DECISION_S) {
    const hand = world(t);
    const a = brain.act(observe(t, hand));
    for (let k = 0; k < a.chunk.length - 1; k++) {
      const tk = t + k * 0.02;
      const bits = a.intentChunk[k];
      const guard = (bits & INTENT_BITS.guard) !== 0;
      const on = world(tk).onset;
      // Edges within 100 ms of onset are anticipations (StatsTolerances.anticipationMarginMs), not reactions.
      if (guard && !prevGuard && on > 0 && on !== answeredOnset && tk - on < 0.8) {
        // Count only edges from a committed reaction (a guard hold or parry started by a released event).
        const reacting = a.debug.state === "COMMITTED" && (a.debug.primitive === "GUARD_HOLD" || a.debug.primitive === "PARRY") && String(a.debug.intent).startsWith("react:");
        if (tk - on >= 0.1 && reacting) reactions.push((tk - on) * 1000);
        answeredOnset = on;
      }
      prevGuard = guard;
      series.push(...a.chunk[k]);
    }
  }
  return { reactions, chatterPerJointPerS: actionChatter([Float64Array.from(series)], 0.02, 0.01) };
}

const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

describe("built-in opponent humanness", () => {
  for (const tier of ["rookie", "contender", "pro", "champion"]) {
    test(`${tier}: net reaction median within mu + tau ± 40 ms, p10 ≥ 150 ms`, () => {
      const all = [];
      for (const seed of [11, 12, 13, 14]) all.push(...measure(tier, seed).reactions);
      assert.ok(all.length >= 40, `only ${all.length} reactions`);
      const r = TIERS[tier].reaction;
      const median = quantile(all, 0.5);
      assert.ok(Math.abs(median - (r.mu + r.tau)) <= 40, `${tier} median ${median.toFixed(0)} vs ${r.mu + r.tau}`);
      assert.ok(quantile(all, 0.1) >= 150, `${tier} p10 ${quantile(all, 0.1).toFixed(0)}`);
    });
  }

  test("pro: target chatter at most 2 sign changes per second per joint (the harness metric)", () => {
    const { chatterPerJointPerS } = measure("pro", 21, 40);
    assert.ok(chatterPerJointPerS <= 2, `chatter ${chatterPerJointPerS.toFixed(2)}/s`);
  });
});

/* ───────────────────────── character (EMOTION_BIBLE 4, WP4 acceptance) ───────────────────────── */

const ATTACKS = new Set(["POKE", "JAB", "HOOK", "SLAM", "WHIFF_PUNISH"]);

/** Runs a policy over a hand function for `seconds`; returns the per-act actions with their sim times. */
function record(personality, tier, seed, handAt, seconds, contactsAt = () => []) {
  clearDdaLedger();
  const brain = createOpponent();
  brain.reset(context(tier, seed, personality));
  const acts = [];
  for (let t = 0.04; t < seconds; t += DECISION_S) {
    const o = observe(t, handAt(t));
    for (const c of contactsAt(t)) o.contacts.push(c);
    acts.push({ t, a: brain.act(o) });
  }
  return acts;
}

const stillHand = () => ({ pos: [0.50, 0.02, 0.15], vel: [0, 0, 0], onset: -1 });
const parkedHand = () => ({ pos: [0.33, 0.04, 0.14], vel: [0, 0, 0], onset: -1 });

describe("the opponent as a character", () => {
  test("life metric: Σ|Δq|/dt over six joints never < 0.02 rad/s for > 400 ms in idle (every entrant)", () => {
    for (const personality of ["overshoot", "backlash", "deadband"]) {
      const acts = record(personality, "contender", 31, stillHand, 30);
      let prev = null, lowSince = -1, worst = 0;
      for (const { t, a } of acts) {
        for (let k = 0; k < a.chunk.length - 1; k++) {
          const row = a.chunk[k], tk = t + k * 0.02;
          if (prev) {
            let v = 0;
            for (let j = 0; j < 6; j++) v += Math.abs(row[j] - prev[j]) / 0.02;
            if (v < 0.02) { if (lowSince < 0) lowSince = tk; worst = Math.max(worst, tk - lowSince); }
            else lowSince = -1;
          }
          prev = row;
        }
      }
      assert.ok(worst <= 0.4 + 1e-9, `${personality}: still for ${(worst * 1000).toFixed(0)} ms`);
    }
  });

  test("every strike has a gaze-on-target event 150–400 ms before it (except POKE) and a tell above its floor", () => {
    let strikes = 0;
    for (const personality of ["overshoot", "backlash", "deadband"]) {
      for (const seed of [41, 42]) {
        const acts = record(personality, "pro", seed, parkedHand, 40);
        const gaze = [], tells = [];
        let inActive = false;
        for (const { t, a } of acts) {
          for (const g of a.debug.gaze ?? []) gaze.push(g);
          for (const e of a.debug.show ?? []) if (e.kind === "tell") tells.push({ t, e });
          const active = ATTACKS.has(a.debug.primitive) && a.debug.phase === "active";
          if (active && !inActive) {
            const prim = a.debug.primitive;
            if (prim !== "POKE") {
              strikes++;
              // Act granularity: `phase` is read one tick in and acts are 40 ms apart.
              const lead = gaze.filter((g) => g.onAim && t - g.t >= 0.15 - 0.045 && t - g.t <= 0.40 + 0.045);
              assert.ok(lead.length > 0, `${personality} seed ${seed}: ${prim} at ${t.toFixed(2)} had no gaze snap 150–400 ms earlier (last gaze ${JSON.stringify(gaze.at(-1))})`);
            }
          }
          inActive = active;
        }
        for (const { e } of tells) {
          const floor = e.primitive === "slam" ? 300 : e.primitive === "hook" ? 150 : e.primitive === "jab" ? 90 : e.primitive === "grab" ? 200 : 0;
          assert.ok(e.ms >= floor - 1, `${personality}: ${e.primitive} tell ${e.ms} ms < ${floor}`);
        }
        assert.ok(tells.length > 0, `${personality} seed ${seed}: no tells`);
      }
    }
    assert.ok(strikes >= 12, `only ${strikes} strikes observed`);
    assert.equal(TELL_MIN_MS.SLAM, 300);
  });

  test("commanded recoil within two decision ticks of every contact above threshold", () => {
    const hits = [4.0, 9.0, 14.0];
    const contact = (t) => hits.filter((h) => Math.abs(t - h) < 0.02).map((h) => ({ kind: "strike", attacker: "opponent", damage_to_self: 14, damage_to_opponent: 0, normal_speed: 1.6, zone: "wrist", pos: [0.3, 0.03, 0.15], t: h - 0.01 }));
    const calm = record("backlash", "contender", 77, stillHand, 16);
    const hit = record("backlash", "contender", 77, stillHand, 16, contact);
    for (const h of hits) {
      const i = hit.findIndex((x) => Math.abs(x.t - h) < 0.02);
      assert.ok(i >= 0);
      const flinch = (hit[i].a.debug.show ?? []).some((e) => e.kind === "flinch");
      assert.ok(flinch, `no flinch event on the contact act at ${h}`);
      let moved = 0;
      for (let k = i; k <= i + 1; k++) for (let j = 0; j < 5; j++) moved = Math.max(moved, Math.abs(hit[k].a.chunk[0][j] - calm[k].a.chunk[0][j]));
      assert.ok(moved > 0.05, `recoil within two ticks of ${h}: max joint delta ${moved.toFixed(3)} rad`);
    }
  });

  test("< 10 % of strike boundaries fully settle (the recover overlaps the next move), and the action-jerk bound holds with every layer on", () => {
    let boundaries = 0, settled = 0;
    const runs = [];
    for (const personality of ["overshoot", "backlash", "deadband"]) {
      const acts = record(personality, "pro", 55, parkedHand, 40);
      const series = [];
      let prevPrim = null, gapSince = -1, afterAttack = false;
      for (const { t, a } of acts) {
        series.push(...a.chunk[0]);
        const prim = a.debug.primitive;
        const inPrimitive = prim !== "GUARD" && prim !== "PARK" && a.debug.phase !== "neutral";
        if (!inPrimitive) { if (gapSince < 0) gapSince = t; }
        else {
          if (prevPrim !== null && prim !== prevPrim && afterAttack) {
            boundaries++;
            if (gapSince >= 0 && t - gapSince >= 0.06) settled++;
          }
          gapSince = -1; prevPrim = prim; afterAttack = ATTACKS.has(prim);
        }
      }
      runs.push(Float64Array.from(series));
    }
    assert.ok(boundaries >= 30, `only ${boundaries} strike boundaries`);
    assert.ok(settled / boundaries < 0.10, `${settled}/${boundaries} strike boundaries settled`);
    // ponytail: regression guard frozen at 1.5× the first measured value (9.9 k rad/s³ at h = 40 ms); the bible names no number.
    const jerk = actionJerk(runs, 0.04);
    assert.ok(Number.isFinite(jerk) && jerk < 15000, `action jerk ${jerk.toFixed(0)} rad/s³`);
  });

  test("hesitation never happens at Champion; it does at Rookie", () => {
    const count = (tier, seed) => record("deadband", tier, seed, parkedHand, 40).filter((x) => x.a.debug.primitive === "HESITATE" || x.a.debug.primitive === "HOVER").length;
    assert.equal(count("champion", 5) + count("champion", 6), 0);
    assert.ok(count("rookie", 5) + count("rookie", 6) > 0, "no hesitation at Rookie");
  });
});
