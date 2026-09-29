// WP2: the Arcade kit (GAME_DESIGN 4.6 Burst, 4.7 charge, 4.8 SNAP / RECOIL COIL / BULWARK / Overdrive; BUILD_PLAN 4 WP2 #17).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { rawDamage } from "../src/game/combat/damage.ts";
import { MEASURED_VREF, tuning } from "../src/game/combat/tuning.ts";

/** Read from the tuning table, not written as a literal, so raising the threshold re-points the test with it. */
const ARMOUR_RAW_MAX = tuning.arcade.charge.armourRawMax;
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

const DT = 0.001;
function rig({ preset = "arcade", loadouts = { atlas: "pivot", blaze: "pivot" } } = {}) {
  const frame = fakeFrame({ mode: preset === "arcade" ? "arcade" : "harness", dt: DT });
  const rules = createCombatRules(fakeModelInfo(frame.mode));
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  const step = (onsets = []) => {
    frame.step++;
    frame.simTime = frame.step * DT;
    frame.onsets.length = 0;
    frame.onsets.push(...onsets.map((o) => ({ ...o, t: frame.simTime, step: frame.step - 1 })));
    rules.step({ frame, intents }, events);
  };
  const ms = (n, each) => { for (let i = 0; i < n; i++) { each?.(i); step(); } };
  const tap = (seat, key) => { intents[seat][key] = true; step(); intents[seat][key] = false; step(); };
  const profile = (seat) => ({ ...rules.servoProfile(seat) });
  return { frame, rules, intents, events, step, ms, tap, profile, s: rules.state.seats };
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const of = (events, type) => events.filter((e) => e.type === type);
function hit(attacker, nu, loadout = "pivot", zone = "gripper") {
  const vN = nu * MEASURED_VREF[loadout];
  return attacker === "atlas"
    ? { kind: "arm_arm", atlasLink: "gripper", blazeLink: zone, aN: vN, bN: 0, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] }
    : { kind: "arm_arm", atlasLink: zone, blazeLink: "gripper", aN: 0, bN: vN, vN, efcForce: 5, pos: [0, 0, 0.15], normal: [1, 0, 0] };
}

describe("SNAP (WHIP)", () => {
  test("180 ms of τ × 1.6, kv × 0.5; two charges; +12 heat each; one charge back every 5 s", () => {
    const r = rig({ loadouts: { atlas: "whip", blaze: "pivot" } });
    r.tap("atlas", "ability");
    assert.deepEqual(r.profile("atlas"), { tauScale: 1.6, kpScale: 1, kvScale: 0.5 });
    assert.equal(r.s.atlas.ability.charges, 1);
    assert.ok(r.s.atlas.heat > 11.9);
    r.ms(179);
    assert.deepEqual(r.profile("atlas"), { tauScale: 1, kpScale: 1, kvScale: 1 });
    assert.deepEqual(of(r.events, "ability").map((e) => e.phase), ["start", "end"]);
    r.tap("atlas", "ability");
    r.ms(200);
    assert.equal(r.s.atlas.ability.charges, 0);
    r.tap("atlas", "ability");
    assert.equal(of(r.events, "ability").filter((e) => e.phase === "start").length, 2, "no charge left");
    r.ms(5000 - 200 - 180 - 4);
    assert.equal(r.s.atlas.ability.charges, 1);
    r.ms(5000);
    assert.equal(r.s.atlas.ability.charges, 2);
  });
});

describe("RECOIL COIL (PIVOT)", () => {
  test("for 2.5 s the first strike landing on a held guard is a deflect, whatever the press timing; 14 s cooldown", () => {
    const r = rig();
    r.intents.blaze.guard = true;
    r.ms(900);                                                       // the guard was pressed long ago
    r.tap("blaze", "ability");
    r.intents.blaze.guard = true;
    r.ms(1000);
    r.step([hit("atlas", 1)]);
    assert.equal(of(r.events, "deflect").length, 1);
    assert.equal(of(r.events, "strike").length, 0);
    assert.equal(r.s.atlas.servoState, "stun");
    assert.equal(r.s.blaze.ability.activeMs, 0, "consumed");
    assert.ok(r.s.blaze.ability.cooldownMs > 12900);
    r.ms(14000);
    assert.equal(r.s.blaze.ability.charges, 1);
  });

  test("guard heat is doubled while it is active", () => {
    const a = rig(), b = rig();
    b.tap("atlas", "ability");
    a.ms(2);
    for (const r of [a, b]) { r.intents.atlas.guard = true; r.ms(500); }
    // Idle cooling is identical; the guard term is 6/s vs 12/s over 0.5 s.
    assert.ok(close(b.s.atlas.heat - a.s.atlas.heat, 3, 0.05), `${b.s.atlas.heat - a.s.atlas.heat}`);
  });
});

describe("BULWARK (ANVIL)", () => {
  test("3 s braced guard: τ × 1.5, kv × 3, chip 0, +20 attacker heat per block, no charge; 16 s cooldown from the end", () => {
    const r = rig({ loadouts: { atlas: "pivot", blaze: "anvil" } });
    r.tap("blaze", "ability");
    assert.deepEqual(r.profile("blaze"), { tauScale: 1.5, kpScale: 1, kvScale: 3 });
    r.step([hit("atlas", 0.9)]);
    const e = of(r.events, "strike")[0];
    assert.deepEqual([e.guarded, e.damage], [true, 0]);
    assert.ok(r.s.atlas.heat > 19.9);
    r.intents.blaze.charge = true;
    r.ms(100);
    assert.equal(r.s.blaze.charging, false);
    r.intents.blaze.charge = false;
    r.ms(2900);
    assert.equal(r.s.blaze.ability.activeMs, 0);
    assert.ok(r.s.blaze.ability.cooldownMs > 15900, `${r.s.blaze.ability.cooldownMs}`);
  });

  test("taking 60 total raw ends it early", () => {
    const r = rig({ loadouts: { atlas: "pivot", blaze: "anvil" } });
    r.tap("blaze", "ability");
    const perHit = rawDamage(1.2);
    let hits = 0;
    while (r.s.blaze.ability.activeMs > 0 && hits < 10) { r.step([hit("atlas", 1.2)]); r.ms(230); hits++; }
    assert.equal(hits, Math.ceil(60 / perHit));
    assert.equal(of(r.events, "ability").at(-1).phase, "end");
  });
});

describe("Overdrive and Burst", () => {
  test("Overdrive: τ × 1.35 while held and +25 heat/s", () => {
    const r = rig();
    r.intents.atlas.overdrive = true;
    r.ms(400);
    assert.deepEqual(r.profile("atlas"), { tauScale: 1.35, kpScale: 1, kvScale: 1 });
    assert.ok(close(r.s.atlas.heat, 0.4 * 20, 0.05), `${r.s.atlas.heat}`);
  });

  test("Burst: from a Stagger at ≤ 65 heat ends it, +35 heat, τ × 1.3 for 150 ms, 900 ms immunity, once per round", () => {
    const r = rig();
    r.step([hit("blaze", 0.9)]);
    assert.equal(r.s.atlas.servoState, "stagger");
    r.tap("atlas", "burst");
    assert.equal(r.s.atlas.servoState, "normal");
    assert.equal(of(r.events, "burst").length, 1);
    assert.ok(r.s.atlas.heat > 34.9);
    assert.ok(r.s.atlas.staggerImmuneMs > 890);
    assert.equal(r.profile("atlas").tauScale, 1.3);
    r.ms(150);
    assert.equal(r.profile("atlas").tauScale, 1);
    r.ms(1000);
    r.step([hit("blaze", 0.9)]);
    assert.equal(r.s.atlas.servoState, "stagger");
    r.tap("atlas", "burst");
    assert.equal(r.s.atlas.servoState, "stagger", "used once this round");

    const hot = rig();
    hot.s.atlas.heat = 66;
    hot.step([hit("blaze", 0.9)]);
    hot.tap("atlas", "burst");
    assert.equal(hot.s.atlas.servoState, "stagger", "too hot to burst");
  });
});

describe("charge, release, whiff", () => {
  test("c ramps over 600 ms (public at 0.25, full at 1), auto-releases 1000 ms after full with τ × (1 + 0.5c) for 250 ms", () => {
    const r = rig();
    r.intents.atlas.charge = true;
    r.ms(150);
    assert.ok(close(r.s.atlas.charge, 0.25, 0.002));
    r.ms(450);
    assert.equal(r.s.atlas.charge, 1);
    const stages = () => of(r.events, "charge").map((e) => e.stage);
    assert.deepEqual(stages(), ["start", "public", "full"]);
    assert.ok(close(r.s.atlas.heat, 0.6 * (8 - 5), 0.02), `+8/s while charging, less idle cooling: ${r.s.atlas.heat}`);
    r.ms(1001);
    assert.deepEqual(stages(), ["start", "public", "full", "release"]);
    assert.equal(r.profile("atlas").tauScale, 1.5);
    r.ms(250);
    assert.equal(r.profile("atlas").tauScale, 1);
    r.ms(500);
    assert.equal(r.s.atlas.charging, false, "holding after an auto-release does not start a new charge");
  });

  test("a heavy release tags the next strike within 400 ms: damage × (1 + 0.3c)", () => {
    const r = rig();
    r.intents.atlas.charge = true;
    r.ms(600);
    r.intents.atlas.charge = false;
    r.ms(100);
    r.step([hit("atlas", 1)]);
    const e = of(r.events, "strike")[0];
    assert.ok(close(e.heavyC, 1));
    assert.ok(close(e.damage, Math.min(45, e.physicalDamage * 1.3)));
    r.ms(500);
    assert.equal(of(r.events, "whiff").length, 0);
  });

  test("a release that lands nothing in 400 ms whiffs: +10 heat and τ × 0.8 for 250 ms", () => {
    const r = rig();
    r.intents.atlas.charge = true;
    r.ms(300);
    r.intents.atlas.charge = false;
    r.ms(260);
    const before = r.s.atlas.heat;
    r.ms(145);
    assert.equal(of(r.events, "whiff").length, 1);
    assert.ok(r.s.atlas.heat > before + 9);
    assert.equal(r.profile("atlas").tauScale, 0.8);
    r.ms(250);
    assert.equal(r.profile("atlas").tauScale, 1);
  });

  test("heavy armour from c ≥ 0.667: unguarded strikes under the armour threshold deal × 0.5, never stagger, never cancel the charge", () => {
    const r = rig();
    r.intents.blaze.charge = true;
    r.ms(420);
    assert.equal(r.s.blaze.armoured, true);
    r.step([hit("atlas", 0.62)]);
    const e = of(r.events, "strike")[0];
    assert.ok(e.raw < ARMOUR_RAW_MAX && e.armoured, `raw ${e.raw} must sit under the armour threshold ${ARMOUR_RAW_MAX}`);
    assert.ok(close(e.damage, e.physicalDamage * 0.5));
    assert.equal(r.s.blaze.servoState, "normal");
    assert.equal(r.s.blaze.charging, true);
    r.ms(230);
    r.step([hit("atlas", 1)]);
    assert.equal(r.s.blaze.servoState, "stagger", `raw ≥ ${ARMOUR_RAW_MAX} breaks through armour`);
    assert.equal(r.s.blaze.charging, false);
  });
});

describe("stock presets ignore the kit", () => {
  test("ability, overdrive, burst and charge intents change nothing", () => {
    const r = rig({ preset: "harness" });
    r.intents.atlas.overdrive = true;
    r.intents.atlas.charge = true;
    r.tap("atlas", "ability");
    r.tap("atlas", "burst");
    r.ms(800);
    assert.deepEqual(r.profile("atlas"), { tauScale: 1, kpScale: 1, kvScale: 1 });
    assert.equal(r.s.atlas.charging, false);
    assert.equal(r.events.filter((e) => ["ability", "charge", "burst", "servo_state"].includes(e.type)).length, 0);
  });
});
