// WP2: heat (GAME_DESIGN 4.5; BUILD_PLAN 4 WP2 #8).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { integrateHeat, createHeatRuntime, ARCADE_HEAT, STOCK_HEAT, NO_HEAT_DRIVERS } from "../src/game/combat/heat.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

/** Atlas alternates pan ±amp every `period` seconds in free air for `seconds`; returns the first Cutout time. */
function rhythm(preset, period, amp, seconds, loadout = "pivot") {
  const mode = preset === "arcade" ? "arcade" : "harness";
  const dt = mode === "arcade" ? 0.0025 : 0.005;
  const loadouts = { atlas: loadout, blaze: "pivot" };
  const rules = createCombatRules(engine.info);
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
  engine.reset({ mode, timestep: dt, seed: 1, loadouts, homePose: { atlas: home, blaze: home }, layout: "lobby" });
  rules.setLive(true);
  engine.setTargets("blaze", Float64Array.of(1.9, -1.7, 1.6, 0, 0, 0.04));
  const events = [], intents = { atlas: noIntents(), blaze: noIntents() };
  const t = Float64Array.from(home);
  let rev = rules.profileRevision("atlas"), cutoutAt = -1, maxHeat = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const s = i * dt;
    t[0] = (Math.floor(s / period) % 2 ? -1 : 1) * amp;
    engine.setTargets("atlas", t);
    if (rules.profileRevision("atlas") !== rev) { rev = rules.profileRevision("atlas"); engine.applyServoProfile("atlas", rules.servoProfile("atlas")); }
    engine.step();
    rules.step({ frame: engine.frame, intents }, events);
    maxHeat = Math.max(maxHeat, rules.state.seats.atlas.heat);
    if (cutoutAt < 0 && rules.state.seats.atlas.servoState === "cutout") cutoutAt = s;
  }
  return { cutoutAt, maxHeat, events, rules };
}

describe("heat in MuJoCo", () => {
  test("ARCADE: flick spam every 250 ms reaches Cutout within 4–8 s", () => {
    const { cutoutAt, events } = rhythm("arcade", 0.25, 0.3, 10);
    assert.ok(cutoutAt >= 4 && cutoutAt <= 8, `cutout at ${cutoutAt}`);
    assert.equal(events.filter((e) => e.type === "overheat").length >= 1, true);
    assert.equal(events.filter((e) => e.type === "heat_warning" && e.on).length >= 1, true);
  });

  test("ARCADE: a full hook every 1.5 s never overheats over 30 s", () => {
    const { cutoutAt, maxHeat } = rhythm("arcade", 1.5, 0.7, 30);
    assert.equal(cutoutAt, -1);
    assert.ok(maxHeat < 70, `max heat ${maxHeat}`);
  });

  test("stock presets compute heat as telemetry and never act on it", () => {
    const { cutoutAt, maxHeat, events } = rhythm("harness", 0.25, 0.3, 12);
    assert.equal(cutoutAt, -1);
    assert.ok(maxHeat > 10, `telemetry moves (${maxHeat})`);
    assert.equal(events.filter((e) => ["overheat", "heat_warning", "servo_state"].includes(e.type)).length, 0);
  });
});

describe("heat model", () => {
  test("idle cools at 5/s, then 20/s after 0.8 s of quiet servos", () => {
    const rt = createHeatRuntime();
    let h = 100;
    for (let i = 0; i < 400; i++) h = integrateHeat(h, rt, 0, 0.001, ARCADE_HEAT, 1, NO_HEAT_DRIVERS);
    assert.ok(Math.abs(h - 98) < 1e-9);
    for (let i = 0; i < 400; i++) h = integrateHeat(h, rt, 0, 0.001, ARCADE_HEAT, 1, NO_HEAT_DRIVERS);
    for (let i = 0; i < 1000; i++) h = integrateHeat(h, rt, 0, 0.001, ARCADE_HEAT, 1, NO_HEAT_DRIVERS);
    assert.ok(Math.abs(h - (100 - 4 - 20)) < 0.05, `${h}`);
  });

  test("holds: guard +6/s (doubled under RECOIL COIL), charge +8/s, Overdrive +25/s; loadout scales the servo term", () => {
    const rate = (d, q = 0, loadoutHeat = 1, model = ARCADE_HEAT) => {
      const rt = createHeatRuntime();
      return (integrateHeat(50, rt, q, 0.5, model, loadoutHeat, { ...NO_HEAT_DRIVERS, ...d }) - 50) / 0.5;   // per s, before the 0.8 s extra cooling
    };
    assert.equal(rate({ guarding: true }), 1);
    assert.equal(rate({ guarding: true, guardMul: 2 }), 7);
    assert.equal(rate({ charging: true }), 3);
    assert.equal(rate({ overdrive: true }), 20);
    assert.ok(Math.abs(rate({}, 0.1, 1.15) - (120 * 0.1 * 1.15 - 5)) < 1e-9);
    assert.ok(Math.abs(rate({ guarding: true, overdrive: true }, 0.1, 1, STOCK_HEAT) - (60 * 0.1 - 5)) < 1e-9, "stock ignores intents");
  });

  test("guard break: reaching 100 while guarding staggers 400 ms, then Thermal Cutout follows", () => {
    const frame = fakeFrame({ mode: "arcade", dt: 0.001 });
    const rules = createCombatRules(fakeModelInfo("arcade"));
    rules.reset({ preset: "arcade", roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: "pivot", blaze: "pivot" }, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
    rules.setLive(true);
    const intents = { atlas: noIntents(), blaze: noIntents() };
    intents.atlas.guard = true;
    const events = [];
    const step = () => { frame.step++; frame.simTime = frame.step * 0.001; rules.step({ frame, intents }, events); };
    step();
    rules.state.seats.atlas.heat = 99.999;
    frame.arms.atlas.forceRange.fill(1); frame.arms.atlas.tau.fill(1);
    step();
    const states = () => events.filter((e) => e.type === "servo_state").map((e) => [e.state, e.cause]);
    assert.deepEqual(states(), [["stagger", "guard_break"]]);
    assert.equal(rules.state.seats.atlas.servoStateTotalMs, 400);
    for (let i = 0; i < 400; i++) step();
    assert.deepEqual(states(), [["stagger", "guard_break"], ["normal", "end"], ["cutout", "heat"]]);
    assert.equal(rules.state.seats.atlas.servoStateTotalMs, 2000);
  });
});
