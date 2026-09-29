// WP6: verdict superlatives, gap/goal, bout card (GAME_DESIGN 7.3.7 with steals) and PB ranking against the profile.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COMBO_MIN, CRIT_RATE_MIN_STRIKES, boutCard, computeSuperlatives, extremeness, isNewPb, lossVerdict, rankSuperlatives } from "../src/game/ui/meta/superlatives.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

function match() {
  return [
    fakeEvents.phase({ phase: "round_intro", round: 1 }),
    fakeEvents.strike({ attacker: "atlas", damage: 18, vN: 2.1 }),
    fakeEvents.strike({ attacker: "atlas", damage: 34, vN: 2.7 }),
    fakeEvents.strike({ attacker: "atlas", damage: 12, vN: 3.4, crit: true }),
    fakeEvents.strike({ attacker: "atlas", damage: 9, vN: 1.2, guarded: true }),
    fakeEvents.strike({ attacker: "blaze", victim: "atlas", damage: 40, vN: 4 }),
    fakeEvents.strike({ attacker: "atlas", damage: 21, vN: 2.2 }),
    fakeEvents.deflect({ defender: "atlas", attacker: "blaze", pressLeadMs: 92 }),
    fakeEvents.deflect({ defender: "atlas", attacker: "blaze", pressLeadMs: -41 }),
    { type: "combo", t: 0, step: 0, seat: "atlas", count: 4 },
    fakeEvents.core({ stage: "steal", seat: "atlas", late: true, remainingS: 1.4 }),
    { type: "low_integrity", t: 0, step: 0, seat: "atlas" },
    fakeEvents.roundEnd({ winner: "atlas", reason: "lock" }),
    fakeEvents.phase({ phase: "round_intro", round: 2 }),
    fakeEvents.roundEnd({ winner: "blaze", reason: "ko" }),
  ];
}

describe("superlatives", () => {
  test("every value comes from the player's own events", () => {
    const list = computeSuperlatives(match(), "atlas");
    const by = Object.fromEntries(list.map((s) => [s.id, s]));
    assert.equal(by.hardest_hit.value, 34);
    assert.equal(by.hardest_hit.display, "IMPACT 2.7 m/s · 34");
    assert.equal(by.fastest_strike.value, 3.4);
    assert.equal(by.quickest_deflect.value, 41);
    assert.equal(by.quickest_deflect.better, "lower");
    assert.equal(by.deflects.value, 2);
    assert.equal(by.crit_rate.headline, 25, "1 crit of 4 unguarded strikes");
    assert.equal(by.longest_combo.value, 4);
    assert.equal(by.steals.value, 1);
    assert.equal(by.steals.display, "1 LATE");
    assert.equal(by.clutch_round.value, 1);
  });

  test("gates: crit rate needs enough strikes, combos start at 3, the opponent's numbers never count", () => {
    const few = [fakeEvents.strike({ attacker: "atlas", crit: true }), fakeEvents.strike({ attacker: "blaze", victim: "atlas", damage: 44 })];
    const list = computeSuperlatives(few, "atlas");
    assert.equal(list.some((s) => s.id === "crit_rate"), false);
    assert.ok(CRIT_RATE_MIN_STRIKES >= 3);
    assert.equal(COMBO_MIN, 3);
    assert.equal(list.find((s) => s.id === "hardest_hit").value, 20);
    assert.deepEqual(computeSuperlatives([], "atlas"), []);
  });

  test("ranking prefers new PBs by margin and leads with the best even on a loss", () => {
    const list = computeSuperlatives(match(), "atlas");
    const ranked = rankSuperlatives(list, { hardest_hit: 17, fastest_strike: 5, quickest_deflect: 30, deflects: 2, crit_rate: 0.5, longest_combo: 4, steals: 1, clutch_round: 3 });
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].id, "hardest_hit", "34 against a best of 17 is the most extreme");
    assert.equal(ranked[0].newPb, true);
    assert.equal(ranked[0].previousBest, 17);
    assert.ok(ranked.every((r, i) => i === 0 || extremeness(ranked[i - 1], ranked[i - 1].previousBest) >= extremeness(r, r.previousBest)));
  });

  test("PB rules", () => {
    const hi = { id: "deflects", label: "", value: 3, display: "", headline: 3, unit: "", better: "higher" };
    const lo = { id: "quickest_deflect", label: "", value: 40, display: "", headline: 40, unit: "ms", better: "lower" };
    assert.equal(isNewPb(hi, null), true);
    assert.equal(isNewPb(hi, 3), false);
    assert.equal(isNewPb(hi, 2), true);
    assert.equal(isNewPb(lo, 50), true);
    assert.equal(isNewPb(lo, 40), false);
    assert.equal(extremeness(lo, 80), 2);
  });
});

describe("the verdict's gap and goal (EMOTION_BIBLE 8.2)", () => {
  const left = { player: 30, opponent: 60 };
  test("two unguarded hooks or a skipped GUARD → BLOCK 3 STRIKES, ahead of every other cause", () => {
    const hooks = [fakeEvents.strike({ attacker: "blaze", victim: "atlas", nu: 0.9 }), fakeEvents.strike({ attacker: "blaze", victim: "atlas", nu: 0.85 })];
    assert.deepEqual(lossVerdict(hooks, "atlas", "lock", [], left, null), { gap: "2 UNGUARDED HOOKS", goal: "block_3" });
    assert.deepEqual(lossVerdict([], "atlas", "ko", ["guard"], left, null), { gap: "0 UNGUARDED HOOKS", goal: "block_3" });
    const guarded = [fakeEvents.strike({ attacker: "blaze", victim: "atlas", nu: 0.9, guarded: true })];
    assert.notEqual(lossVerdict(guarded, "atlas", "ko", [], left, null).goal, "block_3", "a guarded hook is not a gap");
  });
  test("lost by lock → DOCK FIRST with the lock held; KO with < 3 landed → LAND 3 HITS; ≤ 5 short → ONE MORE HIT; no hard hook → ONE HARD HOOK", () => {
    assert.deepEqual(lossVerdict([], "atlas", "lock", [], left, { player: 6.8, total: 8 }), { gap: "LOCK 6.8 / 8.0 s", goal: "dock_first" });
    assert.deepEqual(lossVerdict([fakeEvents.strike()], "atlas", "ko", [], left, null), { gap: "1 HIT LANDED", goal: "land_3" });
    const three = [fakeEvents.strike({ nu: 0.5, vN: 0.5 }), fakeEvents.strike({ nu: 0.5, vN: 0.5 }), fakeEvents.strike({ nu: 0.5, vN: 0.5 })];
    assert.deepEqual(lossVerdict(three, "atlas", "time", [], { player: 40, opponent: 44 }, null), { gap: "INTEGRITY 4 SHORT", goal: "one_more_hit" });
    assert.deepEqual(lossVerdict(three, "atlas", "time", [], { player: 10, opponent: 44 }, null), { gap: "NO HOOK OVER 0.8 m/s", goal: "one_hard_hook" });
    const hard = [...three, fakeEvents.strike({ nu: 0.9, vN: 1.2 })];
    assert.deepEqual(lossVerdict(hard, "atlas", "time", [], { player: 10, opponent: 44 }, null), { gap: "INTEGRITY 44 LEFT", goal: "one_more_hit" }, "always a named gap");
  });
});

describe("the Bout Card (8.3)", () => {
  test("two lines: number, score, pips, then the numbers that compare", () => {
    const events = [fakeEvents.strike({ nu: 0.9, vN: 1.62, thrownCube: 2 }), fakeEvents.deflect({ defender: "atlas", pressLeadMs: -94 }), fakeEvents.strike({ nu: 0.4, vN: 2.4, thrownCube: 0 })];
    const card = boutCard({ boutNumber: 412, callsign: "PILOT", opponent: "BACKLASH", score: { player: 2, opponent: 1 }, rounds: ["win", "loss", "win"], events, player: "atlas" });
    assert.deepEqual(card.split("\n"), ["TORQUE LIMIT #0412  PILOT 2–1 BACKLASH", "🟦⬛🟦   1.62 m/s hook · 94 ms reflex · 2 cubes launched"]);
    const quiet = boutCard({ boutNumber: 7, callsign: "PILOT", opponent: "OVERSHOOT", score: { player: 0, opponent: 2 }, rounds: ["loss", "loss"], events: [], player: "atlas" });
    assert.equal(quiet, "TORQUE LIMIT #0007  PILOT 0–2 OVERSHOOT\n⬛⬛");
  });
});
