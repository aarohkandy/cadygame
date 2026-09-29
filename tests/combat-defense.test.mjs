// WP2: guard, deflect, late guard, clash (GAME_DESIGN 4.4, 3.5; BUILD_PLAN 4 WP2 #5, #6).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { MEASURED_VREF } from "../src/game/combat/tuning.ts";
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

/** Rules on a scripted frame at 1 ms steps, so press offsets land on exact milliseconds. */
function rig({ preset = "arcade", loadouts = { atlas: "pivot", blaze: "pivot" }, dt = 0.001 } = {}) {
  const frame = fakeFrame({ mode: preset === "arcade" ? "arcade" : "harness", dt });
  const rules = createCombatRules(fakeModelInfo(frame.mode));
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
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
  const run = (ms, onsetsAt = () => []) => { for (let i = 0; i < Math.round(ms / (dt * 1000)); i++) step(onsetsAt(frame.step + 1)); };
  return { frame, rules, intents, events, step, run, s: rules.state.seats };
}

/** An atlas hit on blaze's gripper at normal speed ν·vRef, blaze still. */
function atlasHit(nu, { blazeLink = "gripper", atlasLink = "gripper", bN = 0, loadout = "pivot" } = {}) {
  const vN = nu * (loadout ? MEASURED_VREF[loadout] : MEASURED_VREF.stock);
  return { kind: "arm_arm", atlasLink, blazeLink, aN: vN, bN, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] };
}

const of = (events, type) => events.filter((e) => e.type === type);
const HEAVY = 1.0;        // ν = 1: magnitude 1, hit stop 150 ms
const LIGHT = 0.36;       // ν = 0.36: raw 4.5, magnitude 0.145, hit stop 68 ms (every strike freezes)

/** Blaze presses guard `offsetMs` relative to an atlas strike at t = 300 ms. */
function pressScenario(offsetMs, nu) {
  const r = rig();
  const T = 300;
  const P = T + offsetMs;
  for (let ms = 1; ms <= 700; ms++) {
    r.intents.blaze.guard = ms >= P && ms < P + 80;
    r.step(ms === T ? [atlasHit(nu)] : []);
  }
  return r;
}

describe("deflect window", () => {
  test("−151 ms fails, −150 ms deflects", () => {
    const early = pressScenario(-151, HEAVY);
    assert.equal(of(early.events, "deflect").length, 0);
    assert.equal(of(early.events, "strike").length, 1);
    const edge = pressScenario(-150, HEAVY);
    assert.equal(of(edge.events, "deflect").length, 1);
    assert.equal(of(edge.events, "strike").length, 0);
    assert.equal(edge.s.atlas.servoState, "stun");
  });

  test("a press after onset never deflects, even a light strike: +1 ms and +6 ms are late guards; +31 ms is nothing", () => {
    const plus1 = pressScenario(1, LIGHT);
    assert.equal(of(plus1.events, "deflect").length, 0);
    assert.equal(of(plus1.events, "strike").length, 1);
    assert.equal(of(plus1.events, "late_guard").length, 1);

    const plus6 = pressScenario(6, LIGHT);
    assert.equal(of(plus6.events, "deflect").length, 0);
    const late = of(plus6.events, "late_guard");
    assert.equal(late.length, 1);
    const strike = of(plus6.events, "strike")[0];
    assert.ok(Math.abs(late[0].refund - strike.damage * 0.5) < 1e-9);
    assert.equal(late[0].pressLagMs, 6);
    assert.ok(Math.abs(plus6.s.blaze.integrity - (100 - strike.damage * 0.5)) < 1e-9);

    const plus30 = pressScenario(30, HEAVY);
    assert.equal(of(plus30.events, "late_guard").length, 1);
    const plus31 = pressScenario(31, HEAVY);
    assert.equal(of(plus31.events, "late_guard").length + of(plus31.events, "deflect").length, 0);
  });

  test("a press during the hit stop of the onset never deflects it (it is a late guard at best)", () => {
    const r = pressScenario(2, HEAVY);
    assert.equal(of(r.events, "deflect").length, 0);
    assert.equal(of(r.events, "strike").length, 1);
    assert.equal(of(r.events, "late_guard").length, 1);
  });

  test("deflect outcome: attacker Stunned 650 ms (+20 heat), defender −15 heat; a hard deflect stuns 900 ms", () => {
    const r = rig();
    r.s.blaze.heat = 40;
    for (let ms = 1; ms <= 301; ms++) {
      r.intents.blaze.guard = ms >= 250;
      r.step(ms === 300 ? [atlasHit(HEAVY)] : []);
    }
    const d = of(r.events, "deflect")[0];
    assert.equal(d.hard, false);
    assert.equal(d.pressLeadMs, 50);
    assert.equal(r.s.atlas.servoState, "stun");
    assert.equal(r.s.atlas.servoStateTotalMs, 650);
    // 40 − 15, less idle cooling over the 300 ms (the scripted frame's servos carry no load).
    assert.ok(r.s.blaze.heat <= 25 && r.s.blaze.heat > 22, `defender heat ${r.s.blaze.heat}`);
    assert.ok(r.s.atlas.heat > 19.9);

    const hard = rig();
    for (let ms = 1; ms <= 301; ms++) {
      hard.intents.blaze.guard = ms >= 250;
      hard.step(ms === 300 ? [atlasHit(HEAVY, { bN: 0.25 * MEASURED_VREF.pivot })] : []);
    }
    assert.equal(of(hard.events, "deflect")[0].hard, true);
    assert.equal(hard.s.atlas.servoStateTotalMs, 900);
  });

  test("only camera_mount, moving_jaw, gripper, wrist and lower_arm hits can be deflected", () => {
    const r = rig();
    for (let ms = 1; ms <= 301; ms++) {
      r.intents.blaze.guard = ms >= 250 && ms < 260;
      r.step(ms === 300 ? [atlasHit(HEAVY, { blazeLink: "upper_arm" })] : []);
    }
    assert.equal(of(r.events, "deflect").length, 0);
    assert.equal(of(r.events, "strike").length, 1);
  });

  test("a charge-cancel press opens no window", () => {
    const r = rig();
    for (let ms = 1; ms <= 320; ms++) {
      r.intents.blaze.charge = ms >= 20 && ms < 260;
      r.intents.blaze.guard = ms >= 250 && ms < 270;
      r.step(ms === 300 ? [atlasHit(HEAVY)] : []);
    }
    assert.ok(of(r.events, "charge").some((e) => e.stage === "cancel"));
    assert.equal(of(r.events, "deflect").length, 0);
    assert.equal(of(r.events, "strike").length, 1);
  });

  test("anti-mash: a press that expires without a deflect locks new windows out for 400 ms", () => {
    const r = rig();
    for (let ms = 1; ms <= 401; ms++) {
      r.intents.blaze.guard = (ms >= 10 && ms < 20) || (ms >= 300 && ms < 310);
      r.step(ms === 400 ? [atlasHit(HEAVY)] : []);
    }
    assert.equal(of(r.events, "deflect").length, 0, "second press fell inside the lockout");
    assert.equal(of(r.events, "strike")[0].guarded, false, "the guard was released before the hit");
  });
});

describe("guard and clash", () => {
  test("guarded strikes chip 20%, never stagger, and heat both sides", () => {
    for (const nu of [0.6, 1.0, 1.4]) {
      const r = rig();
      r.intents.blaze.guard = true;
      r.run(300);
      r.step([atlasHit(nu)]);
      const e = of(r.events, "strike")[0];
      assert.equal(e.guarded, true);
      assert.ok(Math.abs(e.damage - e.physicalDamage * 0.2) < 1e-9);
      assert.equal(of(r.events, "servo_state").filter((x) => x.state === "stagger").length, 0);
      assert.ok(r.s.atlas.heat >= 9.9);
      assert.ok(r.s.blaze.heat > 0.6 * e.raw - 2);
    }
  });

  test("an unguarded strike with raw ≥ 10 staggers for (180 + 8·dmg) ms, capped at 450", () => {
    const r = rig();
    r.run(50);
    r.step([atlasHit(0.6)]);
    const e = of(r.events, "strike")[0];
    const st = of(r.events, "servo_state").find((x) => x.state === "stagger");
    assert.ok(st);
    assert.ok(Math.abs(st.durationMs - Math.min(450, 180 + 8 * e.damage)) < 1e-9);
  });

  test("clash: no damage, +8 heat and a 150 ms micro-stagger on both sides", () => {
    const r = rig();
    r.run(50);
    const v = MEASURED_VREF.pivot;
    r.step([{ kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: 0.9 * v, bN: 0.85 * v, vN: 1.75 * v, efcForce: 9, pos: [0, 0, 0.15], normal: [1, 0, 0] }]);
    assert.equal(of(r.events, "clash").length, 1);
    assert.equal(of(r.events, "strike").length, 0);
    for (const seat of ["atlas", "blaze"]) {
      assert.equal(r.s[seat].servoState, "micro_stagger");
      assert.equal(r.s[seat].integrity, 100);
      assert.ok(r.s[seat].heat > 7.9);
    }
  });

  test("a heavy-tagged arm wins the clash outright as a strike", () => {
    const r = rig();
    for (let ms = 1; ms <= 700; ms++) {
      r.intents.atlas.charge = ms < 650;
      r.step();
    }
    const v = MEASURED_VREF.pivot;
    r.step([{ kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: 0.9 * v, bN: 0.85 * v, vN: 1.75 * v, efcForce: 9, pos: [0, 0, 0.15], normal: [1, 0, 0] }]);
    const clash = of(r.events, "clash")[0];
    assert.equal(clash.heavyWinner, "atlas");
    const strike = of(r.events, "strike")[0];
    assert.equal(strike.attacker, "atlas");
    assert.ok(strike.heavyC > 0.9);
  });

  test("stock presets have no guard or deflect: the same press scores the full hit", () => {
    const r = rig({ preset: "proving_ground", dt: 0.005 });
    for (let k = 1; k <= 80; k++) {
      r.intents.blaze.guard = k >= 50;
      r.step(k === 60 ? [atlasHit(HEAVY, { loadout: null })] : []);
    }
    assert.equal(of(r.events, "deflect").length, 0);
    const e = of(r.events, "strike")[0];
    assert.equal(e.guarded, false);
    assert.equal(e.damage, e.physicalDamage);
  });
});
