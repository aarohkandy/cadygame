// WP2: attribution and damage (GAME_DESIGN 4.2, 4.3; BUILD_PLAN 4 WP2 #1, #2, #3, #5).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { attribute, newAttribution, rawDamage, referenceHookDamage } from "../src/game/combat/damage.ts";
import { LOADOUTS, MEASURED_VREF } from "../src/game/combat/tuning.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { OFFLINE_PROFILE } from "../src/game/physics/servo.ts";
import { createKinematics, fkTip } from "../src/game/kinematics/so101-kinematics.ts";
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

const LOADOUT_IDS = ["whip", "pivot", "anvil"];
const of = (events, type) => events.filter((e) => e.type === type);

/* ───────── physical hooks ───────── */

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

/**
 * The canonical hook (pan −0.7 → +0.7, lift 0.14, elbow 0.14) into a stationary blaze whose gripper sits where the
 * atlas tip crosses pan 0. Optional `limp` cuts blaze to Offline 40 ms before release; `rampMs` turns it into a push.
 */
function hook({ preset = "arcade", loadout = "pivot", limp = false, rampMs = 0 } = {}) {
  const mode = preset === "arcade" ? "arcade" : "harness";
  const dt = mode === "arcade" ? 0.0025 : 0.005;
  const rules = createCombatRules(engine.info);
  const loadouts = { atlas: loadout, blaze: "pivot" };
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
  engine.reset({ mode, timestep: dt, seed: 3, loadouts, homePose: { atlas: home, blaze: home }, layout: "lobby" });
  rules.setLive(true);
  const tip = fkTip([0, 0.14, 0.14, 0, 0, 0.04], new Float64Array(3));
  const world = [tip[0] - 0.32, tip[1], tip[2]];
  const blazeQ = new Float64Array(6);
  assert.ok(kin.solveTipEgo([-(world[0] - 0.32), -world[1], world[2]], 0, [0, 0, 0, 0, 0, 0.04], blazeQ).ok);
  blazeQ[5] = 0.04;
  const events = [], intents = { atlas: noIntents(), blaze: noIntents() };
  const start = Float64Array.of(-0.7, 0.14, 0.14, 0, 0, 0.04);
  engine.setTargets("atlas", start);
  engine.setTargets("blaze", blazeQ);
  const stepN = (n, each) => { for (let i = 0; i < n; i++) { each?.(i); engine.step(); rules.step({ frame: engine.frame, intents }, events); } };
  stepN(Math.round(1.2 / dt));
  if (limp) {
    engine.applyServoProfile("blaze", OFFLINE_PROFILE);
    stepN(Math.round(0.04 / dt));
  }
  const through = Float64Array.of(0.7, 0.14, 0.14, 0, 0, 0.04);
  let pushStartT = -1;
  if (rampMs > 0) {
    // A push, not a swing: creep up to the opponent, then lean 0.5 rad through it over rampMs. Only the lean is scored.
    const t = Float64Array.from(start);
    const n = Math.round(rampMs / 1000 / dt);
    stepN(n, (i) => { t[0] = -0.7 + 0.4 * ((i + 1) / n); engine.setTargets("atlas", t); });
    stepN(Math.round(0.4 / dt));
    events.length = 0;
    pushStartT = engine.frame.simTime;
    stepN(n + Math.round(0.3 / dt), (i) => { t[0] = -0.3 + 0.5 * Math.min(1, (i + 1) / n); engine.setTargets("atlas", t); });
  } else {
    engine.setTargets("atlas", through);
    stepN(Math.round(0.4 / dt));
  }
  return { events, rules, contacts: engine.frame.active, pushStartT };
}

describe("reference hook in MuJoCo", () => {
  test("ARCADE Pivot: attributed to atlas with ν ≥ 0.9 and 31 ± 3 damage", () => {
    const { events } = hook();
    const strikes = of(events, "strike").filter((e) => !e.upgrade);
    assert.equal(strikes.length, 1);
    const e = of(events, "strike").at(-1);
    assert.equal(e.attacker, "atlas");
    assert.ok(e.nu >= 0.9, `ν ${e.nu}`);
    assert.ok(Math.abs(e.damage - 31) <= 3, `damage ${e.damage}`);
  });

  test("stock (PROVING GROUND and HARNESS): 31 ± 3 physical damage", () => {
    for (const preset of ["proving_ground", "harness"]) {
      const e = of(hook({ preset }).events, "strike").at(-1);
      assert.equal(e.attacker, "atlas");
      assert.ok(e.nu >= 0.9, `${preset} ν ${e.nu}`);
      assert.ok(Math.abs(e.physicalDamage - 31) <= 3, `${preset} physical ${e.physicalDamage}`);
      assert.equal(e.damage, e.physicalDamage);
    }
  });

  test("a limp (Offline) victim is still struck by the attacker", () => {
    const e = of(hook({ limp: true }).events, "strike").at(-1);
    assert.ok(e, "the hook landed");
    assert.equal(e.attacker, "atlas");
    assert.equal(e.victim, "blaze");
  });

  test("an 800 ms slow push through the same arm scores nothing", () => {
    const { events, contacts, pushStartT } = hook({ rampMs: 800 });
    assert.ok(contacts.lastCrossContactT.atlas > pushStartT + 0.2, "the lean pressed into the opponent");
    assert.equal(of(events, "strike").reduce((sum, e) => sum + e.damage, 0), 0);
    assert.equal(of(events, "strike").filter((e) => e.tier === "strike").length, 0);
  });
});

describe("damage formula and balance", () => {
  test("raw damage anchors: hook 31, flick 13, lazy 7, graze 3, shove 0", () => {
    assert.ok(Math.abs(rawDamage(1.0) - 31.3) < 0.2);
    assert.ok(Math.abs(rawDamage(0.58) - 13) < 0.6);
    assert.ok(Math.abs(rawDamage(0.43) - 7) < 0.6);
    assert.ok(Math.abs(rawDamage(0.3) - 3) < 0.5);
    assert.equal(rawDamage(0.19), 0);
    assert.ok(Math.abs(rawDamage(5) - 31.2) < 0.2, "clamped at 1.45 → 31.2");
  });

  test("attribution classes: shove, clash window, graze, strike", () => {
    const a = newAttribution();
    assert.equal(attribute(0.5, 0.2, 0.7, 2.9, 2.9, a).kind, "contact");
    assert.equal(attribute(1.5, 1.4, 2.9, 2.9, 2.9, a).kind, "clash");
    assert.equal(attribute(2.9, 0.58, 2.9, 2.9, 2.9, a).kind, "strike");
    assert.equal(attribute(0.9, 0, 0.9, 2.9, 2.9, a).kind, "graze");
    assert.equal(attribute(0, 2.7, 2.7, 2.9, 2.7, a).attacker, "blaze");
  });

  test("reference hook per loadout matches the table (33.7 / 31.2 / 29.3) and hooks-to-kill differ by ≤ 1 for every pair", () => {
    const expected = { whip: 33.7, pivot: 31.2, anvil: 29.3 };
    const hook1 = (l) => Math.min(45, rawDamage(1.0125) * LOADOUTS[l].dmg);
    for (const l of LOADOUT_IDS) {
      assert.ok(Math.abs(referenceHookDamage(l, 1.0125) - expected[l]) < 0.2, `${l}: ${referenceHookDamage(l, 1.0125)}`);
      assert.ok(Math.abs(hook1(l) - 31.2) <= 3);
    }
    for (const victim of LOADOUT_IDS) {
      const counts = LOADOUT_IDS.map((attacker) => Math.ceil(LOADOUTS[victim].integrity / hook1(attacker)));
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${victim}: ${counts}`);
    }
    for (const attacker of LOADOUT_IDS) {
      const counts = LOADOUT_IDS.map((victim) => Math.ceil(LOADOUTS[victim].integrity / hook1(attacker)));
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${attacker}: ${counts}`);
    }
  });
});

/* ───────── scripted rules ───────── */

function rig({ preset = "arcade", loadouts = { atlas: "pivot", blaze: "pivot" }, dt = 0.001, suddenDeath = false } = {}) {
  const frame = fakeFrame({ mode: preset === "arcade" ? "arcade" : "harness", dt });
  const rules = createCombatRules(fakeModelInfo(frame.mode));
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, suddenDeath, suddenDeath ? { integrity: { atlas: 60, blaze: 60 } } : null);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  const step = (onsets = []) => {
    frame.step++;
    frame.simTime = frame.step * dt;
    frame.onsets.length = 0;
    frame.onsets.push(...onsets.map((o) => ({ ...o, t: frame.simTime, step: frame.step - 1 })));
    rules.step({ frame, intents }, events);
  };
  const run = (n) => { for (let i = 0; i < n; i++) step(); };
  return { frame, rules, intents, events, step, run, s: rules.state.seats };
}

function hit(attacker, nu, { zone = "gripper", tool = "gripper", loadout = "pivot" } = {}) {
  const vN = nu * (loadout ? MEASURED_VREF[loadout] : MEASURED_VREF.stock);
  return attacker === "atlas"
    ? { kind: "arm_arm", atlasLink: tool, blazeLink: zone, aN: vN, bN: 0, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] }
    : { kind: "arm_arm", atlasLink: zone, blazeLink: tool, aN: 0, bN: vN, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] };
}

describe("scripted rules", () => {
  test("combo bound: follow-up inside one Stagger ≤ 25, opener + follow-ups ≤ 60, for every loadout pair", () => {
    for (const a of LOADOUT_IDS) for (const b of LOADOUT_IDS) {
      const r = rig({ loadouts: { atlas: a, blaze: b } });
      r.run(10);
      r.step([hit("atlas", 1.45, { zone: "camera_mount", loadout: a })]);
      const opener = of(r.events, "strike")[0];
      assert.equal(r.s.blaze.servoState, "stagger", `${a}→${b} opener staggers`);
      r.run(225);
      r.step([hit("atlas", 1.45, { zone: "camera_mount", loadout: a })]);
      const follow = of(r.events, "strike")[1];
      assert.ok(follow, `${a}→${b} follow-up landed inside the stagger`);
      assert.ok(follow.damage <= 25 + 1e-9, `${a}→${b} follow-up ${follow.damage}`);
      assert.ok(opener.damage + follow.damage <= 60 + 1e-9, `${a}→${b} combo ${opener.damage + follow.damage}`);
      assert.notEqual(r.s.blaze.servoState, "stagger", "a second landed strike ends Stagger");
      assert.ok(r.s.blaze.staggerImmuneMs > 0);
    }
  });

  test("lockout: one strike per 220 ms; a harder onset inside the window upgrades that hit; a softer one is ignored", () => {
    const r = rig();
    r.step([hit("atlas", 0.6)]);
    r.run(50);
    r.step([hit("atlas", 0.5)]);
    assert.equal(of(r.events, "strike").length, 1);
    r.run(50);
    r.step([hit("atlas", 0.9)]);
    const strikes = of(r.events, "strike");
    assert.equal(strikes.length, 2);
    assert.equal(strikes[1].upgrade, true);
    assert.ok(Math.abs(100 - r.s.blaze.integrity - strikes[1].damage) < 1e-9, "integrity reflects the upgraded value only");
    r.run(230);
    r.step([hit("atlas", 0.5)]);
    assert.equal(of(r.events, "strike").at(-1).upgrade, false);
  });

  test("grazes deal formula damage without consuming the lockout or staggering", () => {
    const r = rig();
    r.step([hit("atlas", 0.3)]);
    r.run(5);
    r.step([hit("atlas", 0.9)]);
    const [graze, strike] = of(r.events, "strike");
    assert.equal(graze.tier, "graze");
    assert.ok(graze.damage > 2 && graze.damage < 5);
    assert.equal(strike.tier, "strike");
    assert.equal(strike.upgrade, false);
    assert.equal(of(r.events, "servo_state").filter((e) => e.state === "stagger").length, 1);
  });

  test("thrown cubes: ×0.5 for the last gripper within 1 s, never your own cube, never the Core", () => {
    const r = rig();
    r.frame.active.lastGripperTouch.cube[0] = 1;       // blaze threw cube 0
    r.frame.active.lastGripperTouch.t[0] = 0.0005;
    r.frame.active.lastGripperTouch.cube[4] = 1;
    r.frame.active.lastGripperTouch.t[4] = 0.0005;
    const cube = (index, seat) => ({ kind: "cube_arm", cube: index, seat, link: "camera_mount", vN: 2.7, pos: [0, 0, 0.1], normal: [1, 0, 0] });
    r.step([cube(0, "atlas")]);
    const e = of(r.events, "strike")[0];
    assert.equal(e.attacker, "blaze");
    assert.equal(e.thrownCube, 0);
    assert.ok(Math.abs(e.damage - rawDamage(2.7 / MEASURED_VREF.pivot) * 1.5 * 0.5) < 1e-9);
    assert.equal(of(r.events, "servo_state").length, 0, "cubes never stagger");
    r.run(300);
    r.step([cube(0, "blaze")]);
    r.step([cube(4, "atlas")]);
    assert.equal(of(r.events, "strike").length, 1);
    r.frame.active.lastGripperTouch.t[0] = -5;
    r.run(300);
    r.step([cube(0, "atlas")]);
    assert.equal(of(r.events, "strike").length, 1, "the throw window is 1 s");
  });

  test("KO: lethal strike, Offline servos, ko event and outcome; nothing lands afterwards", () => {
    const r = rig();
    r.s.blaze.integrity = 20;
    r.step([hit("atlas", 1)]);
    const strike = of(r.events, "strike")[0];
    assert.equal(strike.lethal, true);
    assert.equal(r.s.blaze.integrity, 0);
    assert.equal(r.s.blaze.servoState, "offline");
    assert.deepEqual(r.rules.state.outcome, { winner: "atlas", reason: "ko", t: r.frame.simTime });
    assert.equal(of(r.events, "ko")[0].victim, "blaze");
    assert.deepEqual({ ...r.rules.servoProfile("blaze") }, { tauScale: 0.05, kpScale: 0.02, kvScale: 0.2 });
    r.run(300);
    r.step([hit("blaze", 1)]);
    assert.equal(of(r.events, "strike").length, 1);
  });

  test("protected seats take no damage", () => {
    const r = rig();
    r.rules.setProtected("blaze", true);
    r.step([hit("atlas", 1)]);
    assert.equal(of(r.events, "strike")[0].damage, 0);
    assert.equal(r.s.blaze.integrity, 100);
  });

  test("sudden death: an unguarded strike with raw ≥ 16 wins; weaker or guarded ones do not", () => {
    const r = rig({ suddenDeath: true });
    r.step([hit("atlas", 0.65)]);
    assert.equal(r.rules.state.outcome, null, "raw 15.7");
    r.run(300);
    r.intents.atlas.guard = true;
    r.run(5);
    r.step([hit("blaze", 1.2)]);
    assert.equal(r.rules.state.outcome, null, "guarded");
    r.intents.atlas.guard = false;
    r.run(300);
    r.step([hit("blaze", 0.75)]);
    assert.equal(r.rules.state.outcome.reason, "sudden_death_strike");
    assert.equal(r.rules.state.outcome.winner, "blaze");
    assert.equal(r.s.atlas.integrity < 60, true);
  });

  test("time: the higher integrity wins at 45 s; sudden death times out to the tiebreak", () => {
    const r = rig({ dt: 0.005 });
    r.s.atlas.integrity = 70;
    r.run(Math.round(45 / 0.005) + 1);
    assert.deepEqual([r.rules.state.outcome.winner, r.rules.state.outcome.reason], ["blaze", "time"]);
    const sd = rig({ dt: 0.005, suddenDeath: true });
    sd.s.atlas.damageDealtRound = 12;
    sd.run(Math.round(20 / 0.005) + 1);
    assert.deepEqual([sd.rules.state.outcome.winner, sd.rules.state.outcome.reason], ["atlas", "sudden_death_tiebreak"]);
  });

  test("first strike, combo ≥ 3 within 1.2 s, and low integrity are each announced", () => {
    const r = rig();
    for (let k = 0; k < 3; k++) { r.step([hit("atlas", 0.45)]); r.run(600); }
    assert.equal(of(r.events, "first_strike").length, 1);
    assert.deepEqual(of(r.events, "combo").map((e) => e.count), [3]);
    r.s.blaze.integrity = 30;
    r.step([hit("atlas", 0.6)]);
    assert.equal(of(r.events, "low_integrity").length, 1);
  });
});

/* ───────── match-1 rules (EMOTION_BIBLE 6, 11 WP5): sparring, the no-Sudden-Death tiebreak, the WHIP carry ───────── */

import { sparringMul } from "../src/game/combat/damage.ts";
import { fakeModelInfo as fakeInfo, fakeFrame as scriptedFrame } from "../src/game/testing/fakes.ts";

/** Rules on a scripted 1 ms frame; `extra` rides on the RulesConfig (ShowRulesConfig). */
function scripted(extra = {}) {
  const dt = 0.001;
  const frame = scriptedFrame({ mode: "arcade", dt });
  const rules = createCombatRules(fakeInfo("arcade"));
  rules.reset({ preset: "arcade", roundLengthS: 30, suddenDeathLengthS: 20, loadouts: { atlas: "pivot", blaze: "pivot" }, lockInS: { atlas: 8, blaze: 8 },
    comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99, ...extra }, 2, false, null);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  const step = (onsets = []) => {
    frame.step++;
    frame.simTime = frame.step * dt;
    frame.onsets.length = 0;
    frame.onsets.push(...onsets.map((o) => ({ ...o, t: frame.simTime, step: frame.step - 1 })));
    rules.step({ frame, intents }, events);
  };
  const hit = (attacker, nu = 1) => {
    const vN = nu * MEASURED_VREF.pivot;
    return attacker === "atlas"
      ? { kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: vN, bN: 0, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] }
      : { kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: 0, bN: vN, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] };
  };
  const runMs = (ms) => { for (let i = 0; i < ms; i++) step(); };
  return { frame, rules, events, step, hit, runMs, s: rules.state.seats };
}

describe("sparring damage rules", () => {
  test("sparringMul: round 1 deals nothing, the SPARRING tier ×0.6, otherwise 1", () => {
    assert.equal(sparringMul("round1"), 0);
    assert.equal(sparringMul("tier"), 0.6);
    assert.equal(sparringMul(null), 1);
  });

  test("match-1 round 1: a full-speed hook lands as a strike event but changes no Integrity either way", () => {
    const r = scripted({ sparring: "round1" });
    r.runMs(300);
    r.step([r.hit("atlas")]);
    r.runMs(300);
    r.step([r.hit("blaze")]);
    r.runMs(50);
    const strikes = of(r.events, "strike");
    assert.equal(strikes.length, 2);
    assert.ok(strikes.every((e) => e.damage === 0 && e.physicalDamage > 0), "scored physically, dealt nothing");
    assert.deepEqual([r.s.atlas.integrity, r.s.blaze.integrity], [100, 100]);
    assert.deepEqual([r.s.atlas.damageDealtRound, r.s.blaze.damageDealtRound], [0, 0]);
  });

  test("the SPARRING tier lands at 60 % of the same hit; a HARNESS preset ignores the flag", () => {
    const full = scripted();
    full.runMs(300); full.step([full.hit("atlas")]); full.runMs(20);
    const tier = scripted({ sparring: "tier" });
    tier.runMs(300); tier.step([tier.hit("atlas")]); tier.runMs(20);
    const a = of(full.events, "strike")[0].damage, b = of(tier.events, "strike")[0].damage;
    assert.ok(a > 5 && Math.abs(b - 0.6 * a) < 1e-9, `${a} vs ${b}`);
  });
});

describe("match 1 has no Sudden Death: the round-2/3 tiebreak", () => {
  test("a round within the tie margin goes to the first strike, even against more damage", () => {
    const r = scripted({ noSuddenDeath: true });
    r.runMs(300);
    r.step([r.hit("blaze", 0.45)]);              // blaze strikes first, lightly
    r.runMs(1000);
    r.step([r.hit("atlas", 0.55)]);              // atlas answers a little harder
    r.runMs(30000);
    const o = r.rules.state.outcome;
    assert.ok(o && o.reason === "time");
    assert.ok(Math.abs(r.s.atlas.integrity - r.s.blaze.integrity) <= 10, "inside the margin");
    assert.equal(o.winner, "blaze", "first strike wins the tiebreak");
  });

  test("outside the margin Integrity still decides; without the flag equal Integrity falls back to damage", () => {
    const r = scripted({ noSuddenDeath: true });
    r.runMs(300);
    r.step([r.hit("blaze", 0.45)]);
    r.runMs(1000);
    r.step([r.hit("atlas", 1)]);
    r.runMs(30000);
    assert.equal(r.rules.state.outcome.winner, "atlas");
    const plain = scripted();
    plain.runMs(300);
    plain.step([plain.hit("blaze", 0.45)]);
    plain.runMs(1000);
    plain.step([plain.hit("atlas", 0.55)]);
    plain.runMs(30000);
    assert.equal(plain.rules.state.outcome.winner, "atlas", "no flag: higher Integrity wins outright");
  });
});

describe("WHIP carry: +10 % inside 300 ms of a reversal at speed", () => {
  /** Swing atlas's tip +x for 100 ms at 1 m/s, reverse to −x for `afterMs`, then land the hook. */
  function swingThenHit(afterMs) {
    const r = scripted();
    const ee = r.frame.arms.atlas.eePos;
    r.runMs(200);
    for (let i = 0; i < 100; i++) { ee[0] += 0.001; r.step(); }
    for (let i = 0; i < afterMs; i++) { ee[0] -= 0.001; r.step(); }
    r.step([r.hit("atlas")]);
    r.runMs(20);
    return of(r.events, "strike")[0].damage;
  }
  test("a hook 200 ms after the reversal carries the tag; 400 ms after it does not", () => {
    const plain = swingThenHit(400);
    const whipped = swingThenHit(200);
    assert.ok(plain > 5, `plain ${plain}`);
    assert.ok(Math.abs(whipped - plain * 1.1) < 1e-9, `${whipped} vs ${plain}`);
  });
});
