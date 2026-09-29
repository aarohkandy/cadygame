import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { clearDdaLedger, Dda, DDA_MAX_STEP, effectiveTier, FIRST_SESSION_CAP_MATCHES, ledgerK, NEW_PLAYER_MATCHES, tierParams } from "../src/game/policy/opponent/dda.ts";
import { createOpponent } from "../src/game/policy/opponent/index.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

function ctx({ episode = "ep1", round = 1, tier = "contender", mode = "live", preset = "arcade", dda = true, bestOf = 3, matchesPlayed } = {}) {
  const c = registrationContext("blaze", 7);
  return {
    ...c, episode_id: episode, round, mode, preset, physics: preset === "arcade" ? "arcade" : "harness",
    rules: { ...c.rules, best_of: bestOf, scoring: preset === "arcade" ? "full" : "physical" },
    config: { personality: "backlash", tier, dda, ...(matchesPlayed === undefined ? {} : { matchesPlayed }) },
  };
}

function obsAt(t, { self = 100, opp = 100, won = [0, 0], bestOf = 3, remaining = 30 } = {}) {
  const o = emptyObservation("blaze");
  o.t = t; o.preset = "arcade";
  o.self.integrity = self; o.self.integrity_max = 100;
  o.opponent.integrity = opp; o.opponent.integrity_max = 100;
  o.round.phase = "fight"; o.round.best_of = bestOf; o.round.time_remaining = remaining; o.round.phase_length = 45;
  o.round.rounds_won.self = won[0]; o.round.rounds_won.opponent = won[1];
  o.blocks.game[0] = self / 100; o.blocks.game[1] = opp / 100;
  return o;
}

/** An exchange: integrity changes at t0, then 700 ms of calm closes it. Returns whether k changed. */
function exchange(d, t0, before, after, extra = {}) {
  d.observe(obsAt(t0, { ...before, ...extra }), obsAt(t0).blocks.game);
  let o = obsAt(t0 + 0.04, { ...after, ...extra });
  d.observe(o, o.blocks.game);
  let changed = false;
  for (let t = t0 + 0.08; t < t0 + 0.9; t += 0.04) { o = obsAt(t, { ...after, ...extra }); changed = d.observe(o, o.blocks.game) || changed; }
  return changed;
}

beforeEach(() => clearDdaLedger());

describe("invisible DDA", () => {
  test("the AI winning exchanges makes it easier, at most 0.1 per exchange", () => {
    const d = new Dda();
    d.reset(ctx());
    assert.equal(d.k, 0);
    assert.equal(exchange(d, 1, { self: 100, opp: 100 }, { self: 100, opp: 70 }), true);
    assert.ok(d.k < 0 && d.k >= -DDA_MAX_STEP - 1e-9, `k ${d.k}`);
    const k1 = d.k;
    exchange(d, 3, { self: 100, opp: 70 }, { self: 100, opp: 40 });
    assert.ok(d.k < k1 && k1 - d.k <= DDA_MAX_STEP + 1e-9);
  });

  test("the player winning exchanges makes it harder", () => {
    const d = new Dda();
    d.reset(ctx({ tier: "pro" }));
    exchange(d, 1, { self: 100, opp: 100 }, { self: 60, opp: 100 });
    assert.ok(d.k > 0);
  });

  test("after two player match losses the next match starts at k - 0.2", () => {
    for (const ep of ["m1", "m2"]) {
      const d = new Dda();
      d.reset(ctx({ episode: ep, round: 1 }));
      let o = obsAt(1); d.observe(o, o.blocks.game);
      d.reset(ctx({ episode: ep, round: 2 }));
      o = obsAt(50, { won: [1, 0] }); d.observe(o, o.blocks.game);   // AI one round from the win
      o = obsAt(60, { won: [1, 0], opp: 0 }); d.observe(o, o.blocks.game);
    }
    const d = new Dda();
    d.reset(ctx({ episode: "m3", round: 1 }));
    assert.ok(Math.abs(d.k - -0.2) < 1e-9, `k ${d.k}`);
    assert.ok(Math.abs(ledgerK("backlash", "contender") - -0.2) < 1e-9);
    assert.equal(d.clampedAfterLoss, true, "the round after a player match loss only eases");
  });

  test("k never increases in the round after a player round loss", () => {
    const d = new Dda();
    d.reset(ctx({ round: 1 }));
    let o = obsAt(1); d.observe(o, o.blocks.game);
    d.reset(ctx({ round: 2 }));
    o = obsAt(0, { won: [1, 0] }); d.observe(o, o.blocks.game);     // the AI took round 1: a player round loss
    assert.equal(d.clampedAfterLoss, true);
    const k0 = d.k;
    exchange(d, 1, { self: 100, opp: 100 }, { self: 50, opp: 100 }, { won: [1, 0] });   // player dominating
    assert.equal(d.k, k0, "clamped: no harder");
    exchange(d, 3, { self: 50, opp: 100 }, { self: 50, opp: 60 }, { won: [1, 0] });
    assert.ok(d.k < k0, "easier is still allowed");
  });

  test("frozen in eval, stock presets, at Champion, with dda off, and in the last 10 s of a deciding round", () => {
    const frozen = [ctx({ mode: "eval" }), ctx({ preset: "proving_ground" }), ctx({ tier: "champion" }), ctx({ dda: false })];
    for (const c of frozen) {
      const d = new Dda();
      d.reset(c);
      exchange(d, 1, { self: 100, opp: 100 }, { self: 100, opp: 50 });
      assert.equal(d.k, 0, JSON.stringify(c.config) + c.mode + c.preset);
    }
    const d = new Dda();
    d.reset(ctx({ round: 3 }));
    exchange(d, 40, { self: 100, opp: 100 }, { self: 100, opp: 50 }, { won: [1, 1], remaining: 5 });
    assert.equal(d.k, 0, "deciding round, last 10 s");
    exchange(d, 42, { self: 100, opp: 50 }, { self: 100, opp: 20 }, { won: [1, 1], remaining: 20 });
    assert.ok(d.k < 0, "earlier in the decider it moves");
  });

  test("new-player ramp: a profile's first matches open at the easy edge, fading over the onboarding matches", () => {
    const starts = [];
    for (let m = 0; m <= NEW_PLAYER_MATCHES; m++) {
      clearDdaLedger();
      const d = new Dda();
      d.reset(ctx({ episode: `m${m}`, matchesPlayed: m }));
      starts.push(d.k);
    }
    assert.deepEqual(starts.map((k) => Math.round(k * 1000) / 1000), [-1, -0.667, -0.333, 0]);
    const s = new Dda().scales({});
    assert.equal(s.thinkMul, 1, "k = 0 leaves the tier untouched");
    const d = new Dda();
    clearDdaLedger();
    d.reset(ctx({ matchesPlayed: 0 }));
    const slow = d.scales({});
    assert.ok(slow.reactionMul > 1 && slow.thinkMul > 1 && slow.slamWindupMul > 1, "slower reactions, commits, and heavies");
  });

  test("the ramp is a ceiling only: it never raises a lower k, and frozen seats never see it", () => {
    clearDdaLedger();
    const d = new Dda();
    d.reset(ctx({ episode: "a", matchesPlayed: 0 }));
    assert.equal(d.k, -1);
    d.reset(ctx({ episode: "b", matchesPlayed: 2 }));            // a later match: the ledger's −1 stays
    assert.equal(d.k, -1);
    for (const c of [ctx({ mode: "eval", matchesPlayed: 0 }), ctx({ preset: "proving_ground", matchesPlayed: 0 }), ctx({ tier: "champion", matchesPlayed: 0 }), ctx({ dda: false, matchesPlayed: 0 })]) {
      clearDdaLedger();
      const f = new Dda();
      f.reset(c);
      assert.equal(f.k, 0, JSON.stringify(c.config) + c.mode + c.preset);
    }
  });

  test("the built-in policy reports k in debug only when DDA is on, and it scales perception", () => {
    const brain = createOpponent();
    brain.reset({ ...ctx({ tier: "pro" }), seed: 3 });
    const o = obsAt(0.04);
    assert.equal(typeof brain.act(o).debug.dda, "number");
    brain.reset({ ...ctx({ tier: "pro", dda: false }), seed: 3 });
    assert.equal(brain.act(obsAt(0.04)).debug.dda, undefined);
  });
});

describe("tier rules (EMOTION_BIBLE 8.4): LLL, SPARRING, first-session cap", () => {
  test("two straight losses drop one tier; below Rookie is SPARRING; a win restores; frozen seats never move", () => {
    assert.equal(effectiveTier("pro", 0, 10, false), "pro");
    assert.equal(effectiveTier("pro", 1, 10, false), "pro");
    assert.equal(effectiveTier("pro", 2, 10, false), "contender");
    assert.equal(effectiveTier("rookie", 2, 10, false), "sparring");
    assert.equal(effectiveTier("rookie", 3, 10, false), "sparring");
    assert.equal(effectiveTier("champion", 2, 10, true), "champion");
    assert.equal(tierParams("sparring").noSlam, true);
    assert.equal(tierParams("sparring").openingGraceS, 5);
    assert.equal(tierParams("pro").id, "pro");
  });

  test("no tier above Rookie until matchesPlayed ≥ 3 (unknown matchesPlayed is not capped)", () => {
    assert.equal(effectiveTier("champion", 0, 0, false), "rookie");
    assert.equal(effectiveTier("pro", 0, FIRST_SESSION_CAP_MATCHES - 1, false), "rookie");
    assert.equal(effectiveTier("pro", 0, FIRST_SESSION_CAP_MATCHES, false), "pro");
    assert.equal(effectiveTier("pro", 0, undefined, false), "pro");
    assert.equal(effectiveTier("contender", 2, 0, false), "sparring", "capped to Rookie, then one down");
  });

  test("the seat plays the effective tier: two match losses to BACKLASH Rookie make the third match SPARRING, a win restores it", () => {
    for (const ep of ["l1", "l2"]) {
      const d = new Dda();
      d.reset(ctx({ episode: ep, round: 1, tier: "rookie", matchesPlayed: 5 }));
      assert.equal(d.tierId, "rookie");
      let o = obsAt(1); d.observe(o, o.blocks.game);
      d.reset(ctx({ episode: ep, round: 2, tier: "rookie", matchesPlayed: 5 }));
      o = obsAt(50, { won: [1, 0] }); d.observe(o, o.blocks.game);
      o = obsAt(60, { won: [1, 0], opp: 0 }); d.observe(o, o.blocks.game);
    }
    const d = new Dda();
    d.reset(ctx({ episode: "l3", round: 1, tier: "rookie", matchesPlayed: 7 }));
    assert.equal(d.tierId, "sparring");
    // The player takes this one 2–0.
    let o = obsAt(1); d.observe(o, o.blocks.game);
    d.reset(ctx({ episode: "l3", round: 2, tier: "rookie", matchesPlayed: 7 }));
    o = obsAt(40, { won: [0, 1] }); d.observe(o, o.blocks.game);
    o = obsAt(50, { won: [0, 1], self: 0 }); d.observe(o, o.blocks.game);
    const e = new Dda();
    e.reset(ctx({ episode: "l4", round: 1, tier: "rookie", matchesPlayed: 8 }));
    assert.equal(e.tierId, "rookie", "restored silently after a win");
    // Frozen seats (eval, DDA off) always play what they were configured.
    const f = new Dda();
    f.reset(ctx({ episode: "l5", round: 1, tier: "champion", matchesPlayed: 0, dda: false }));
    assert.equal(f.tierId, "champion");
  });
});
