// WP6: local profile: W–L per entrant and tier, personal bests, loss streaks, medals, opponent memory, the STABLE hint.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPLIED_MATCH_MEMORY, PROFILE_KEY, createProfileStore, entrantKey, medalEarned, memoryFrom, sanitizeProfile, tierKey } from "../src/game/ui/meta/profile.ts";
import { EMPTY_OPPONENT_MEMORY } from "../src/game/contracts.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
}

const backlash = (tier) => ({ kind: "builtin", personality: "backlash", tier, dda: true });
const sup = (id, value, better = "higher") => ({ id, label: id.toUpperCase(), value, display: "", headline: value, unit: "", better });

describe("profile", () => {
  test("entrant keys: built-ins by personality, user models by hash", () => {
    assert.equal(entrantKey(backlash("pro")), "builtin:backlash");
    assert.equal(tierKey(backlash("pro")), "pro");
    assert.equal(entrantKey({ kind: "module", fileName: "a.mjs", source: "", sha256: "abc" }), "module:abc");
    assert.equal(tierKey({ kind: "module", fileName: "a.mjs", source: "", sha256: "abc" }), "-");
  });

  test("records W–L per entrant and tier, once per match id", () => {
    const storage = memoryStorage();
    const p = createProfileStore({ storage });
    p.applyMatch({ matchId: "m1", opponent: backlash("rookie"), won: true, superlatives: [] });
    p.applyMatch({ matchId: "m1", opponent: backlash("rookie"), won: true, superlatives: [] });
    p.applyMatch({ matchId: "m2", opponent: backlash("pro"), won: false, superlatives: [] });
    assert.deepEqual(p.record(backlash("rookie")), { w: 1, l: 0 });
    assert.deepEqual(p.record(backlash("pro")), { w: 0, l: 1 });
    assert.deepEqual(p.record(backlash("pro"), null), { w: 1, l: 1 }, "null tier sums every tier");
    assert.deepEqual(p.totals(), { w: 1, l: 1 });
    const reloaded = createProfileStore({ storage });
    assert.deepEqual(reloaded.totals(), { w: 1, l: 1 }, "persists");
    assert.ok(storage.map.has(PROFILE_KEY));
  });

  test("personal bests respect better-is-higher and better-is-lower and remember which match set them", () => {
    const p = createProfileStore({ storage: memoryStorage() });
    const first = p.applyMatch({ matchId: "a", opponent: backlash("pro"), won: true, superlatives: [sup("hardest_hit", 31), sup("quickest_deflect", 80, "lower")] });
    assert.deepEqual(first, ["hardest_hit", "quickest_deflect"]);
    assert.deepEqual(p.bestsBefore("a"), {});
    const second = p.applyMatch({ matchId: "b", opponent: backlash("pro"), won: false, superlatives: [sup("hardest_hit", 28), sup("quickest_deflect", 45, "lower")] });
    assert.deepEqual(second, ["quickest_deflect"]);
    assert.equal(p.get().bests.hardest_hit, 31);
    assert.equal(p.get().bests.quickest_deflect, 45);
    assert.deepEqual(p.bestsBefore("b"), { hardest_hit: 31, quickest_deflect: 80 });
    assert.deepEqual(p.applyMatch({ matchId: "b", opponent: backlash("pro"), won: false, superlatives: [] }), ["quickest_deflect"], "repeat returns the same PBs");
  });

  test("a match applied in an earlier session ranks without its own PBs", () => {
    const storage = memoryStorage();
    createProfileStore({ storage }).applyMatch({ matchId: "x", opponent: backlash("pro"), won: true, superlatives: [sup("steals", 2)] });
    const later = createProfileStore({ storage });
    assert.deepEqual(later.bestsBefore("x"), {});
  });

  test("corrupt, hostile, or blocked storage falls back to memory", () => {
    const corrupt = createProfileStore({ storage: memoryStorage({ [PROFILE_KEY]: "{not json" }) });
    assert.deepEqual(corrupt.totals(), { w: 0, l: 0 });
    const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
    const p = createProfileStore({ storage: throwing });
    p.applyMatch({ matchId: "m", opponent: backlash("pro"), won: true, superlatives: [] });
    assert.deepEqual(p.totals(), { w: 1, l: 0 });
    const clean = sanitizeProfile({ records: { "builtin:x": { pro: { w: -3, l: "7" } } }, bests: { hardest_hit: "big", steals: 3, rep: 900 }, rep: 400, medals: [] });
    assert.deepEqual(clean.records["builtin:x"].pro, { w: 0, l: 0 });
    assert.deepEqual(clean.bests, { steals: 3 });
    assert.equal("rep" in clean, false);
    assert.deepEqual(clean.medals, {}, "a hostile medals shape sanitizes to none");
    const hostile = sanitizeProfile({ medals: { "builtin:x": ["gold", "platinum", 3] }, streaks: { "builtin:x": "9" }, memory: { "builtin:x": { bestMove: 12, hurtSide: 5, grudge: 99, feintsWorked: -2 } }, stableHintShown: "yes" });
    assert.deepEqual(hostile.medals["builtin:x"], ["gold"]);
    assert.deepEqual(hostile.streaks, { "builtin:x": 0 });
    assert.deepEqual(hostile.memory["builtin:x"], { bestMove: null, hurtSide: 0, timeToFirstAttackS: null, feintsWorked: 0, grudge: 3 });
    assert.equal(hostile.stableHintShown, false);
  });

  test("loss streaks per entrant reset on a win (the LLL rule reads them)", () => {
    const p = createProfileStore({ storage: memoryStorage() });
    p.applyMatch({ matchId: "a", opponent: backlash("pro"), won: false, superlatives: [] });
    p.applyMatch({ matchId: "b", opponent: backlash("pro"), won: false, superlatives: [] });
    assert.equal(p.lossStreak(backlash("pro")), 2);
    assert.equal(p.lossStreak(backlash("rookie")), 2, "the streak is per entrant, not per tier");
    p.applyMatch({ matchId: "c", opponent: backlash("pro"), won: true, superlatives: [] });
    assert.equal(p.lossStreak(backlash("pro")), 0);
  });

  test("medal ladder (8.3): BRONZE for a win, SILVER for 2–0, GOLD for 2–0 with a lock or clutch steal; one stamp per match", () => {
    assert.equal(medalEarned([], false, { player: 0, opponent: 2 }, false), null);
    assert.equal(medalEarned([], true, { player: 2, opponent: 1 }, true), "bronze");
    assert.equal(medalEarned(["bronze"], true, { player: 2, opponent: 1 }, true), null, "another 2–1 earns nothing new");
    assert.equal(medalEarned(["bronze"], true, { player: 2, opponent: 0 }, false), "silver");
    assert.equal(medalEarned(["bronze", "silver"], true, { player: 2, opponent: 0 }, false), null);
    assert.equal(medalEarned(["bronze", "silver"], true, { player: 2, opponent: 0 }, true), "gold");
    assert.equal(medalEarned([], true, { player: 2, opponent: 0 }, true), "bronze", "the ladder climbs one stamp per match");
    const p = createProfileStore({ storage: memoryStorage() });
    p.applyMatch({ matchId: "a", opponent: backlash("pro"), won: true, superlatives: [], roundsWon: { player: 2, opponent: 0 }, lockOrClutch: true });
    assert.deepEqual(p.medals(backlash("pro")), ["bronze"]);
    assert.equal(p.medalFor("a"), "bronze");
    assert.equal(p.medalFor("zzz"), null);
    p.applyMatch({ matchId: "a", opponent: backlash("pro"), won: true, superlatives: [], roundsWon: { player: 2, opponent: 0 } });
    assert.deepEqual(p.medals(backlash("pro")), ["bronze"], "idempotent per match id");
  });

  test("opponent memory (4.5): derived from the match's events, kept per entrant, empty for a stranger", () => {
    const p = createProfileStore({ storage: memoryStorage() });
    assert.deepEqual(p.memory(backlash("pro")), EMPTY_OPPONENT_MEMORY);
    const events = [
      fakeEvents.phase({ phase: "round_intro", t: 1 }),
      fakeEvents.strike({ t: 4.5, nu: 0.9, vN: 1.7, normal: [0, 0.8, 0] }),
      fakeEvents.strike({ t: 6, nu: 0.3, vN: 0.6, normal: [0, -0.9, 0] }),
      fakeEvents.whiff({ seat: "blaze", t: 7 }),
      fakeEvents.strike({ t: 7.4, nu: 0.5, vN: 0.9, normal: [0, 0.5, 0] }),
      fakeEvents.roundEnd({ winner: "atlas" }),
    ];
    const m = memoryFrom(events, "atlas", true, EMPTY_OPPONENT_MEMORY);
    assert.deepEqual(m, { bestMove: "hook", hurtSide: -1, timeToFirstAttackS: 3.5, feintsWorked: 1, grudge: 1 });
    p.remember(backlash("pro"), m);
    assert.deepEqual(p.memory(backlash("rookie")), m, "memory is per entrant across tiers");
    const again = memoryFrom([], "atlas", false, m);
    assert.deepEqual(again, { ...m, grudge: 0 }, "nothing new keeps the old facts; a loss for the pilot eases the grudge");
    assert.equal(memoryFrom([], "atlas", true, { ...m, grudge: 3 }).grudge, 3, "the grudge caps at 3");
  });

  test("the STABLE hint is claimed once ever", () => {
    const p = createProfileStore({ storage: memoryStorage() });
    assert.equal(p.claimStableHint(), true);
    assert.equal(p.claimStableHint(), false);
    const reopened = createProfileStore({ storage: memoryStorage({ [PROFILE_KEY]: JSON.stringify(p.get()) }) });
    assert.equal(reopened.claimStableHint(), false);
  });

  test("remembers a bounded number of applied matches and notifies subscribers", () => {
    const p = createProfileStore({ storage: memoryStorage() });
    let calls = 0;
    const off = p.subscribe(() => calls++);
    for (let i = 0; i < APPLIED_MATCH_MEMORY + 5; i++) p.applyMatch({ matchId: `m${i}`, opponent: backlash("pro"), won: i % 2 === 0, superlatives: [] });
    off();
    p.reset();
    assert.equal(calls, APPLIED_MATCH_MEMORY + 5);
    assert.deepEqual(p.totals(), { w: 0, l: 0 });
  });
});
