// WP2: the Core objective (GAME_DESIGN 2.4, 2.5): incoming, drop, bias, dock, lock-in, leave, contest, lock, KO.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { MEASURED_VREF } from "../src/game/combat/tuning.ts";
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

const DT = 0.005;
const DOCK_X = 0.11;
const of = (events, type) => events.filter((e) => e.type === type);
const coreEvents = (events, stage) => events.filter((e) => e.type === "core" && (!stage || e.stage === stage));

function coreRig({ preset = "arcade", lockInS = { atlas: 8, blaze: 8 }, comebacks = false, suddenDeath = false, incoming = 12, drop = 15, carry = null } = {}) {
  const frame = fakeFrame({ mode: preset === "arcade" ? "arcade" : "harness", dt: DT });
  frame.docks.set([-DOCK_X, 0, 0, DOCK_X, 0, 0]);
  const rules = createCombatRules(fakeModelInfo(frame.mode));
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: "pivot", blaze: "pivot" }, lockInS, comebacks,
    coreIncomingAtS: suddenDeath ? 0 : incoming, coreDropAtS: suddenDeath ? 0 : drop }, 1, suddenDeath, carry);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [], placements = [];
  const far = [0.3, 0.3, 0.3];
  frame.arms.atlas.eePos.set(far); frame.arms.blaze.eePos.set(far);
  const core = (x, y = 0, z = 0.02) => { frame.cubes.pos[12] = x; frame.cubes.pos[13] = y; frame.cubes.pos[14] = z; };
  core(2.4, 0, 0.02);
  const step = (onsets = []) => {
    frame.step++;
    frame.simTime = frame.step * DT;
    frame.onsets.length = 0;
    frame.onsets.push(...onsets.map((o) => ({ ...o, t: frame.simTime, step: frame.step - 1 })));
    rules.step({ frame, intents }, events);
    rules.requestPlacements(placements);
  };
  const runS = (s) => { for (let i = 0; i < Math.round(s / DT); i++) step(); };
  const untilLive = () => { while (rules.state.core.phase !== "live") step(); };
  return { frame, rules, events, placements, step, runS, untilLive, core, s: rules.state.seats, c: rules.state.core };
}

describe("core objective", () => {
  test("incoming at 12.0 s, drop at 15.0 s as a recorded placement at the table centre; parked at reset", () => {
    const r = coreRig();
    assert.deepEqual(r.placements.splice(0), []);
    r.step();
    assert.deepEqual(r.placements.splice(0), [{ cube: 4, pos: null }], "reset parks the Core");
    while (r.frame.simTime < 12 - DT - 1e-9) r.step();
    assert.equal(coreEvents(r.events).length, 0);
    r.step();
    assert.equal(coreEvents(r.events, "incoming").length, 1);
    assert.ok(Math.abs(coreEvents(r.events, "incoming")[0].t - 12) < DT + 1e-9);
    assert.equal(r.c.phase, "incoming");
    r.runS(3);
    assert.equal(coreEvents(r.events, "drop").length, 1);
    assert.deepEqual(r.placements, [{ cube: 4, pos: [0, 0, 0.22] }]);
    assert.equal(r.c.phase, "live");
  });

  test("Core bias: ≥ 15 integrity behind at the drop, the Core lands 3 cm toward the trailing seat (ARCADE comebacks only)", () => {
    const r = coreRig({ comebacks: true });
    r.s.atlas.integrity = 70;
    r.untilLive();
    assert.deepEqual(r.placements.at(-1).pos, [-0.03, 0, 0.22]);
    const even = coreRig({ comebacks: true });
    even.s.blaze.integrity = 86;
    even.untilLive();
    assert.deepEqual(even.placements.at(-1).pos, [0, 0, 0.22]);
    const stock = coreRig({ preset: "harness", comebacks: false });
    stock.s.blaze.integrity = 50;
    stock.untilLive();
    assert.deepEqual(stock.placements.at(-1).pos, [0, 0, 0.22]);
  });

  test("sudden death drops the Core immediately without an incoming beat", () => {
    const r = coreRig({ suddenDeath: true, lockInS: { atlas: 4, blaze: 4 }, carry: { integrity: { atlas: 40, blaze: 42 } } });
    r.step();
    assert.equal(coreEvents(r.events, "incoming").length, 0);
    assert.equal(coreEvents(r.events, "drop").length, 1);
    assert.equal(r.s.atlas.integrity, 40, "integrity carried");
  });

  test("docking needs 250 ms at rest inside the radius and below 35 mm; the first dock starts a fresh lock-in", () => {
    const r = coreRig();
    r.untilLive();
    r.core(-DOCK_X + 0.069, 0);
    r.frame.cubes.linvel[12] = 0.06;
    r.runS(0.5);
    assert.equal(coreEvents(r.events, "lock_in_start").length, 0, "still moving");
    r.frame.cubes.linvel[12] = 0;
    r.core(-DOCK_X, 0, 0.04);
    r.runS(0.5);
    assert.equal(coreEvents(r.events, "lock_in_start").length, 0, "too high");
    r.core(-DOCK_X + 0.069, 0, 0.02);
    r.runS(0.245);
    assert.equal(coreEvents(r.events, "lock_in_start").length, 0);
    r.runS(0.01);
    const start = coreEvents(r.events, "lock_in_start");
    assert.equal(start.length, 1);
    assert.equal(start[0].seat, "atlas");
    assert.equal(start[0].remainingS, 8);
    assert.deepEqual([r.c.owner, r.c.dockedIn, r.c.lockInTotalS], ["atlas", "atlas", 8]);
  });

  test("the countdown runs only while docked; leaving for ≥ 100 ms pauses it and re-docking resumes the same value", () => {
    const r = coreRig();
    r.untilLive();
    r.core(DOCK_X, 0);
    r.runS(0.25 + 3);
    assert.equal(r.c.owner, "blaze");
    assert.ok(Math.abs(r.c.lockInRemainingS - 5) < DT * 2);
    r.core(0, 0);
    r.runS(0.09);
    assert.equal(r.c.dockedIn, "blaze", "a 90 ms excursion is not a leave");
    r.runS(0.02);
    assert.equal(r.c.dockedIn, null);
    const paused = r.c.lockInRemainingS;
    r.runS(2);
    assert.equal(r.c.lockInRemainingS, paused);
    assert.equal(coreEvents(r.events, "steal").length, 0, "no opponent gripper touched it");
    r.core(DOCK_X, 0);
    r.runS(0.26);
    const resume = coreEvents(r.events, "lock_in_resume");
    assert.equal(resume.length, 1);
    assert.equal(resume[0].inherited, false);
    assert.ok(Math.abs(resume[0].remainingS - paused) < 1e-9);
  });

  test("a Core resting in the opponent's dock never starts the owner's clock or changes hands without a steal", () => {
    const r = coreRig();
    r.untilLive();
    r.core(-DOCK_X, 0);
    r.runS(1.25);
    r.core(DOCK_X, 0);
    r.runS(2);
    assert.equal(r.c.owner, "atlas");
    assert.equal(r.c.dockedIn, "blaze");
    assert.equal(coreEvents(r.events, "lock_in_resume").length, 0);
    const remaining = r.c.lockInRemainingS;
    r.runS(1);
    assert.equal(r.c.lockInRemainingS, remaining);
  });

  test("contested while the opponent's gripperframe is within 8 cm of the docked Core", () => {
    const r = coreRig();
    r.untilLive();
    r.core(-DOCK_X, 0);
    r.runS(0.3);
    r.frame.arms.blaze.eePos.set([-DOCK_X + 0.05, 0, 0.07]);
    r.step();
    assert.equal(r.c.contested, true);
    assert.equal(coreEvents(r.events, "contested_on").length, 1);
    r.frame.arms.blaze.eePos.set([0.3, 0, 0.2]);
    r.step();
    assert.equal(r.c.contested, false);
    assert.equal(coreEvents(r.events, "contested_off").length, 1);
  });

  test("lock: the countdown reaching 0 ends the round for the owner", () => {
    const r = coreRig({ lockInS: { atlas: 6, blaze: 8 } });
    r.untilLive();
    const t0 = r.frame.simTime;
    r.core(-DOCK_X, 0);
    while (!r.rules.state.outcome) r.step();
    const lock = coreEvents(r.events, "lock")[0];
    assert.equal(lock.seat, "atlas");
    assert.deepEqual([r.rules.state.outcome.winner, r.rules.state.outcome.reason], ["atlas", "lock"]);
    assert.ok(Math.abs(r.frame.simTime - t0 - (0.25 + 6)) <= 2 * DT + 1e-9, `${r.frame.simTime - t0}`);
  });

  test("KO mid-countdown still ends the round", () => {
    const r = coreRig();
    r.untilLive();
    r.core(-DOCK_X, 0);
    r.runS(4);
    r.s.atlas.integrity = 5;
    const v = MEASURED_VREF.pivot;
    r.step([{ kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: 0, bN: v, vN: v, efcForce: 5, pos: [0, 0, 0.1], normal: [1, 0, 0] }]);
    assert.deepEqual([r.rules.state.outcome.winner, r.rules.state.outcome.reason], ["blaze", "ko"]);
    const remaining = r.c.lockInRemainingS;
    r.runS(1);
    assert.equal(r.c.lockInRemainingS, remaining, "nothing runs after the outcome");
    assert.equal(of(r.events, "ko").length, 1);
  });
});
