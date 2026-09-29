import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createTutorialScript, createDrillScript, SPAR_STEPS, HIT_CAP_MS, HIT_NUDGE_MS, NUDGE_OFFSET_M, GUARD_WINDUPS, DOCK_CAP_MS, COACH_LINE, STEP_CAPTION,
} from "../src/game/match/tutorial-script.ts";
import {
  firstMatchConfig, nextMatchConfig, systemsCheckConfig, dailyBout, isFirstMatch, roundLengthFor, suddenDeathAllowed, showKitFor,
  rulesConfigFor, FIRST_MATCH_ROUND_LENGTH_S, DRILL_LENGTH_S, drillTask,
} from "../src/game/match/match-config.ts";
import { defaultSettings } from "../src/game/core/settings.ts";
import { fakeCombat, fakeEvents } from "../src/game/testing/fakes.ts";

const F = 1 / 60;
const run = (s, ms, c = fakeCombat()) => { for (let t = 0; t < ms; t += 1000 * F) s.update([], c, F); };

describe("sparring round script (EMOTION_BIBLE 2)", () => {
  test("steps, behaviours and captions in order", () => {
    assert.deepEqual(SPAR_STEPS.map((s) => [s.id, s.behavior, s.coreDrop]), [
      ["hit", "parked_in_reach", false], ["guard", "slow_heavy", false], ["grab", "idle", true], ["hold", "idle", true], ["locked", "idle", false],
    ]);
    assert.deepEqual(Object.values(STEP_CAPTION).filter(Boolean), ["HIT IT", "GUARD · HOLD RMB", "GRAB IT", "BRING IT HOME"]);
  });

  test("each step completes only on its real event; the round ends only by the pilot's lock", () => {
    const s = createTutorialScript("atlas");
    const c = fakeCombat();
    assert.equal(s.caption, "HIT IT");
    assert.equal(s.update([fakeEvents.contact()], c, F), false);
    assert.equal(s.update([fakeEvents.strike({ attacker: "blaze", victim: "atlas" })], c, F), false, "BACKLASH's contact does not count");
    assert.equal(s.update([fakeEvents.strike({ tier: "graze" })], c, F), true, "any contact of the pilot's counts as the first hit");
    assert.equal(s.step.id, "guard");
    assert.equal(s.caption, "GUARD · HOLD RMB");
    assert.equal(s.update([fakeEvents.strike({ attacker: "blaze", victim: "atlas", guarded: false })], c, F), false);
    assert.equal(s.update([fakeEvents.strike({ attacker: "blaze", victim: "atlas", guarded: true })], c, F), true);
    assert.equal(s.step.id, "grab");
    assert.equal(s.step.coreDrop, true);
    c.core.phase = "live"; c.core.lastTouchedBy = "blaze";
    assert.equal(s.update([], c, F), false, "BACKLASH's curiosity sniff is not a grab");
    c.core.lastTouchedBy = "atlas";
    assert.equal(s.update([], c, F), true);
    assert.equal(s.step.id, "hold");
    assert.equal(s.caption, "BRING IT HOME");
    assert.equal(s.update([fakeEvents.core({ stage: "lock_in_start", seat: "atlas" })], c, F), false, "docking is not the lock");
    assert.equal(s.update([fakeEvents.core({ stage: "lock", seat: "blaze" })], c, F), false);
    assert.equal(s.update([fakeEvents.core({ stage: "lock", seat: "atlas" })], c, F), true);
    assert.equal(s.finished, true);
    assert.equal(s.caption, null);
    assert.deepEqual(s.skipped, []);
  });

  test("HIT IT: the nudge at 5 s moves BACKLASH's gripper 4 cm in and coaches once; the cap at 12 s advances anyway", () => {
    const s = createTutorialScript("atlas");
    const rev = s.revision;
    run(s, HIT_NUDGE_MS - 100);
    assert.equal(s.parkOffsetM, 0);
    run(s, 200);
    assert.equal(s.parkOffsetM, NUDGE_OFFSET_M);
    assert.equal(s.revision, rev + 1, "one driver re-reset for the nudge");
    assert.equal(s.caption, COACH_LINE.nudge);
    run(s, 4100);
    assert.equal(s.caption, "HIT IT", "the coaching line yields to the step prompt after 4 s");
    run(s, HIT_CAP_MS);
    assert.equal(s.step.id, "guard");
    assert.deepEqual(s.skipped, ["hit"]);
    assert.equal(s.parkOffsetM, 0, "the nudge does not carry into the next step");
  });

  test("GUARD: three unguarded wind-ups skip the step, name the goal, and VALE says so once", () => {
    const s = createTutorialScript("atlas");
    s.update([fakeEvents.strike()], fakeCombat(), F);
    for (let i = 0; i < GUARD_WINDUPS - 1; i++) assert.equal(s.update([fakeEvents.strike({ attacker: "blaze", victim: "atlas" })], fakeCombat(), F), false);
    assert.equal(s.update([fakeEvents.strike({ attacker: "blaze", victim: "atlas" })], fakeCombat(), F), true);
    assert.equal(s.step.id, "grab");
    assert.deepEqual(s.skipped, ["guard"]);
    assert.equal(s.caption, COACH_LINE.guardCapped);
  });

  test("GRAB + dock: the cap re-drops the Core once, then coaches and marks the dock skill skipped", () => {
    const s = createTutorialScript("atlas");
    s.update([fakeEvents.strike()], fakeCombat(), F);
    s.update([fakeEvents.deflect({ defender: "atlas" })], fakeCombat(), F);
    assert.equal(s.step.id, "grab");
    const rev = s.revision;
    run(s, DOCK_CAP_MS + 50);
    assert.equal(s.redrops, 1);
    assert.equal(s.revision, rev + 1);
    assert.deepEqual(s.skipped, []);
    run(s, DOCK_CAP_MS + 50);
    assert.equal(s.redrops, 1, "only one re-drop");
    assert.deepEqual(s.skipped, ["dock"]);
    assert.equal(s.caption, COACH_LINE.dockCapped);
  });

  test("the dock pair always terminates: a player who never locks still reaches the end of the round", () => {
    // grab -> hold -> grab used to cycle forever once the player could pick the Core up but never lock it,
    // so match 1 had no exit. Every other step caps out; this pair did not.
    const s = createTutorialScript("atlas");
    s.update([fakeEvents.strike()], fakeCombat(), F);
    s.update([fakeEvents.deflect({ defender: "atlas" })], fakeCombat(), F);
    assert.equal(s.step.id, "grab");
    for (let i = 0; i < 12 && s.step.id !== "locked"; i++) run(s, DOCK_CAP_MS + 50);
    assert.equal(s.step.id, "locked", "the sparring round must end even if the Core is never locked");
    assert.deepEqual(s.skipped, ["dock"], "the un-taught skill is carried to the verdict, not lost");
  });

  test("reset returns to HIT IT with nothing skipped", () => {
    const s = createTutorialScript("atlas");
    run(s, HIT_CAP_MS + 100);
    s.reset();
    assert.equal(s.step.id, "hit");
    assert.deepEqual(s.skipped, []);
    assert.equal(s.parkOffsetM, 0);
  });
});

describe("SYSTEMS CHECK drill (bible 9)", () => {
  test("the pilot's lock is NOMINAL; the cap is a TIMEOUT; nothing changes after the result", () => {
    const d = createDrillScript("atlas", 5);
    assert.equal(d.result, null);
    assert.match(d.task, /^dock the core from pose [1-8] zone [A-D]$/);
    assert.ok(d.task.length >= 25 && d.task.length <= 50, "task strings are 25–50 chars");
    d.update([fakeEvents.core({ stage: "lock_in_start", seat: "atlas" }), fakeEvents.core({ stage: "lock", seat: "blaze" })], F);
    assert.equal(d.result, null);
    d.update([fakeEvents.core({ stage: "lock", seat: "atlas" })], F);
    assert.equal(d.result, "NOMINAL");
    const t = createDrillScript("atlas", 5);
    for (let s = 0; s <= DRILL_LENGTH_S; s += F) t.update([], F);
    assert.equal(t.result, "TIMEOUT");
    t.update([fakeEvents.core({ stage: "lock", seat: "atlas" })], F);
    assert.equal(t.result, "TIMEOUT");
    assert.equal(drillTask(5), drillTask(5));
    assert.notEqual(drillTask(1), drillTask(2));
  });
});

describe("match 1, the daily bout and the drill configs", () => {
  test("match 1 is a best-of-3 vs BACKLASH Rookie with 30 s rounds, no Sudden Death, no kit", () => {
    const settings = defaultSettings();
    const m1 = firstMatchConfig(9, settings);
    assert.equal(isFirstMatch(m1), true);
    assert.equal(m1.context, "quick", "it counts as a played match");
    assert.equal(m1.bestOf, 3);
    assert.deepEqual([m1.seats.blaze.driver.personality, m1.seats.blaze.driver.tier], ["backlash", "rookie"]);
    assert.equal(m1.showKit, false);
    assert.equal(roundLengthFor(m1), FIRST_MATCH_ROUND_LENGTH_S);
    assert.equal(rulesConfigFor(m1, { atlas: 0, blaze: 0 }, false).roundLengthS, FIRST_MATCH_ROUND_LENGTH_S);
    assert.equal(suddenDeathAllowed(m1), false);
    assert.equal(nextMatchConfig(9, settings, { w: 0, l: 0 }, new Date("2026-09-26T10:00:00Z")).tutorial, true, "a fresh profile's click is match 1");
  });

  test("after match 1 the click starts today's bout: same seed and opponent for everyone, tier by record", () => {
    const settings = { ...defaultSettings(), profile: { ...defaultSettings().profile, matchesPlayed: 1 } };
    const day = new Date("2026-09-26T10:00:00Z");
    const a = nextMatchConfig(1, settings, { w: 0, l: 0 }, day);
    const b = nextMatchConfig(2, settings, { w: 0, l: 0 }, new Date("2026-09-26T23:59:00Z"));
    assert.equal(a.tutorial, false);
    assert.equal(a.seed, b.seed);
    assert.equal(a.seats.blaze.driver.personality, b.seats.blaze.driver.personality);
    assert.notEqual(a.seed, nextMatchConfig(1, settings, { w: 0, l: 0 }, new Date("2026-09-27T10:00:00Z")).seed);
    assert.equal(dailyBout(day, { w: 0, l: 0 }).tier, "rookie");
    assert.equal(dailyBout(day, { w: 7, l: 1 }).tier, "champion");
    assert.ok(dailyBout(day, { w: 0, l: 0 }).number < 10_000);
    assert.equal(suddenDeathAllowed(a), true);
  });

  test("the drill is stock physics, unrecorded as a match, BACKLASH parked", () => {
    const d = systemsCheckConfig(3, defaultSettings());
    assert.equal(d.preset, "proving_ground");
    assert.equal(d.context, "warmup");
    assert.equal(d.seats.blaze.driver.behavior, "parked_in_reach");
    assert.equal(isFirstMatch(d), false);
  });

  test("the showKit gate table (bible 2)", () => {
    const m1 = showKitFor(0), m2 = showKitFor(1), m3 = showKitFor(2), m4 = showKitFor(3);
    assert.deepEqual([m1.timer, m1.tags, m1.suddenDeath, m1.heat, m1.abilities, m1.pbStamps, m1.share, m1.stableHint], [false, false, false, false, false, false, false, true]);
    assert.deepEqual([m2.timer, m2.tags, m2.suddenDeath, m2.pbStamps, m2.medals, m2.heat, m2.share], [true, true, true, true, true, false, false]);
    assert.deepEqual([m3.heat, m3.share, m3.abilities, m3.numbers], [true, true, false, false]);
    assert.deepEqual([m4.abilities, m4.numbers, m4.stableHint], [true, true, false]);
  });
});
