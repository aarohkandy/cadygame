// WP2: the servo state machine (GAME_DESIGN 4.6; BUILD_PLAN 4 WP2 #4, #9).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { guardAllowed } from "../src/game/combat/servo-states.ts";
import { LOADOUTS } from "../src/game/combat/tuning.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { fakeFrame, fakeModelInfo, fakeSeatCombat } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
const staggers = (events) => events.filter((e) => e.type === "servo_state" && e.state === "stagger");

let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

/** Engine + rules loop with profiles applied, blaze folded out of reach so atlas swings through empty air. */
function sim(preset, loadout) {
  const mode = preset === "arcade" ? "arcade" : "harness";
  const dt = mode === "arcade" ? 0.0025 : 0.005;
  const loadouts = { atlas: loadout, blaze: "pivot" };
  const rules = createCombatRules(engine.info);
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
  engine.reset({ mode, timestep: dt, seed: 2, loadouts, homePose: { atlas: home, blaze: home }, layout: "lobby" });
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  const rev = { atlas: rules.profileRevision("atlas"), blaze: rules.profileRevision("blaze") };
  engine.setTargets("blaze", Float64Array.of(1.9, -1.7, 1.6, 0, 0, 0.04));
  const run = (seconds, each) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      each?.(i * dt);
      for (const seat of ["atlas", "blaze"]) {
        if (rules.profileRevision(seat) !== rev[seat]) { rev[seat] = rules.profileRevision(seat); engine.applyServoProfile(seat, rules.servoProfile(seat)); }
      }
      engine.step();
      rules.step({ frame: engine.frame, intents }, events);
    }
  };
  return { rules, intents, events, run, dt, s: rules.state.seats };
}

const PROFILES = [["arcade", "whip"], ["arcade", "pivot"], ["arcade", "anvil"], ["proving_ground", "pivot"], ["harness", "pivot"]];

describe("no self-stagger", () => {
  test("a 1.4 rad flick through empty air, at every loadout and stock", () => {
    for (const [preset, loadout] of PROFILES) {
      const r = sim(preset, loadout);
      const t = Float64Array.from(home);
      r.run(0.6);
      for (const [from, to] of [[-0.7, 0.7], [0.7, -0.7], [-0.7, 0.7]]) {
        t[0] = from; engine.setTargets("atlas", t); r.run(0.5);
        t[0] = to; engine.setTargets("atlas", t); r.run(0.5);
      }
      assert.deepEqual(staggers(r.events), [], `${preset}/${loadout}`);
      assert.equal(engine.frame.active.lastCrossContactT.atlas, -1, "no contact was made");
    }
  });

  test("guard presses and releases mid-swing", () => {
    for (const [preset, loadout] of PROFILES) {
      const r = sim(preset, loadout);
      const t = Float64Array.from(home);
      r.run(0.5, (s) => {
        t[0] = Math.sin(s * 9) * 0.9; t[1] = home[1] + Math.sin(s * 5) * 0.3;
        engine.setTargets("atlas", t);
        r.intents.atlas.guard = Math.floor(s * 8) % 2 === 1;
      });
      assert.deepEqual(staggers(r.events), [], `${preset}/${loadout}`);
    }
  });

  test("a Stunned or Cutout arm with the command sweeping", () => {
    for (const state of ["stun", "cutout"]) {
      for (const loadout of ["whip", "pivot", "anvil"]) {
        const r = sim("arcade", loadout);
        r.run(0.3);
        Object.assign(r.s.atlas, { servoState: state, servoStateRemainingMs: 900, servoStateTotalMs: 900 });
        const t = Float64Array.from(home);
        r.run(1.6, (s) => { t[0] = Math.sin(s * 14) * 1.2; t[2] = home[2] + Math.sin(s * 11) * 0.4; engine.setTargets("atlas", t); });
        assert.deepEqual(staggers(r.events), [], `${state}/${loadout}`);
      }
    }
  });

  test("a min-jerk hook path with lead (the built-in HOOK primitive's shape)", () => {
    for (const [preset, loadout] of PROFILES) {
      const r = sim(preset, loadout);
      const q = new Float64Array(6);
      const seed = Float64Array.from(home);
      r.run(0.4);
      const duration = 0.18;
      r.run(0.6, (s) => {
        const u = Math.min(1, Math.max(0, (s - 0.1) / duration));
        const m = u * u * u * (10 - 15 * u + 6 * u * u);
        const angle = -0.8 + 1.6 * m;
        const lead = 0.25 * Math.sin(Math.PI * u);                    // the path leads the tip by up to 0.25 rad
        const target = [0.04 + 0.26 * Math.cos(angle + lead), 0.26 * Math.sin(angle + lead), 0.13];
        if (kin.solveTipEgo(target, 0, seed, q).ok) { q[5] = 0.04; engine.setTargets("atlas", q); seed.set(q); }
      });
      assert.deepEqual(staggers(r.events), [], `${preset}/${loadout}`);
    }
  });
});

/* ───────── the knockback detector on a scripted frame ───────── */

function pushRig(loadout = "pivot") {
  const dt = 0.0025;
  const frame = fakeFrame({ mode: "arcade", dt });
  const rules = createCombatRules(fakeModelInfo("arcade"));
  rules.reset({ preset: "arcade", roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: loadout, blaze: "pivot" }, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 99, coreDropAtS: 99 }, 1, false, null);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  const arm = frame.arms.atlas;
  arm.forceRange.fill(5.88);
  const step = () => { frame.step++; frame.simTime = frame.step * dt; rules.step({ frame, intents }, events); };
  return { frame, rules, events, arm, step, dt, intents, s: rules.state.seats };
}

describe("knockback", () => {
  test("a pinned arm driven away from its target under contact for 150 ms staggers (300 ms × staggerRecv)", () => {
    for (const loadout of ["whip", "pivot", "anvil"]) {
      const r = pushRig(loadout);
      r.arm.ctrl[0] = 0.2;
      for (let i = 0; i < 200; i++) r.step();                         // quiet: no command step in the last 250 ms
      let pushedMs = 0;
      while (pushedMs < 150) {
        r.frame.active.lastCrossContactT.atlas = r.frame.simTime;
        r.arm.q[0] -= 0.5 * r.dt;                                      // pushed the other way at 0.5 rad/s
        r.arm.qd[0] = -0.5;
        if (0.2 - r.arm.q[0] < 0.36) r.arm.q[0] = 0.2 - 0.36;
        r.step();
        pushedMs += r.dt * 1000;
      }
      const st = staggers(r.events);
      assert.equal(st.length, 1, loadout);
      assert.equal(st[0].cause, "knockback");
      assert.ok(Math.abs(st[0].durationMs - 300 * LOADOUTS[loadout].staggerRecv) < 1e-9);
    }
  });

  test("no knockback when merely slow, still tracking, just commanded, or guarding", () => {
    const run = (each) => {
      const r = pushRig();
      r.arm.ctrl[0] = 0.8;                                             // 0.8 rad of error, held
      for (let i = 0; i < 400; i++) { r.arm.qd[0] = 0; each(r, i); r.step(); }
      return staggers(r.events).length;
    };
    assert.equal(run(() => {}), 0, "no contact: merely slow");
    const contact = (r) => { r.frame.active.lastCrossContactT.atlas = r.frame.simTime; };
    assert.equal(run((r) => { contact(r); r.arm.qd[0] = 8; }), 0, "under contact but still driving toward the target at free speed");
    assert.equal(run((r, i) => { contact(r); if (i % 80 === 40) r.arm.ctrl[0] = i % 160 === 40 ? 1.1 : 0.8; }), 0, "a fresh command step every 200 ms (the first at 100 ms)");
    assert.equal(run((r, i) => { contact(r); r.intents.atlas.guard = Math.floor(i / 60) % 2 === 1; }), 0, "guard edges every 150 ms");
    assert.equal(run((r) => { contact(r); }), 1, "control: the same hold under contact does stagger");
  });
});

describe("state machine", () => {
  test("stagger ends into 900 ms immunity; guard returns after 60% of a stagger", () => {
    const s = fakeSeatCombat({ servoState: "stagger", servoStateTotalMs: 400, servoStateRemainingMs: 400 });
    assert.equal(guardAllowed(s), false);
    s.servoStateRemainingMs = 161;
    assert.equal(guardAllowed(s), false);
    s.servoStateRemainingMs = 160;
    assert.equal(guardAllowed(s), true);
    assert.equal(guardAllowed(fakeSeatCombat({ servoState: "stun", servoStateTotalMs: 650, servoStateRemainingMs: 10 })), false);

    const r = pushRig();
    Object.assign(r.s.atlas, { servoState: "stagger", servoStateTotalMs: 100, servoStateRemainingMs: 100 });
    for (let i = 0; i < 41; i++) r.step();
    assert.equal(r.s.atlas.servoState, "normal");
    assert.ok(r.s.atlas.staggerImmuneMs > 890);
    assert.deepEqual(r.events.filter((e) => e.type === "servo_state").map((e) => [e.state, e.cause]), [["normal", "end"]]);
  });

  test("Cutout ends with heat set to 40", () => {
    const r = pushRig();
    Object.assign(r.s.atlas, { servoState: "cutout", servoStateTotalMs: 20, servoStateRemainingMs: 20, heat: 100 });
    for (let i = 0; i < 10; i++) r.step();
    assert.equal(r.s.atlas.servoState, "normal");
    assert.ok(Math.abs(r.s.atlas.heat - 40) < 0.1);
  });

  test("profiles compose state × guard × overdrive and cap nothing below the engine", () => {
    const r = pushRig();
    assert.deepEqual({ ...r.rules.servoProfile("atlas") }, { tauScale: 1, kpScale: 1, kvScale: 1 });
    Object.assign(r.s.atlas, { servoState: "stagger", servoStateTotalMs: 400, servoStateRemainingMs: 400 });
    const rev = r.rules.profileRevision("atlas");
    r.step();
    assert.deepEqual({ ...r.rules.servoProfile("atlas") }, { tauScale: 0.5, kpScale: 0.25, kvScale: 0.6 });
    assert.equal(r.rules.profileRevision("atlas"), rev + 1);
  });
});

describe("offline droop", () => {
  test("a KO'd arm droops ≥ 5 cm within 1 s under real gravity, in every preset", () => {
    for (const [preset, loadout] of [["arcade", "pivot"], ["proving_ground", "pivot"], ["harness", "pivot"]]) {
      const r = sim(preset, loadout);
      const reach = kin.commandToJoints({ ...kin.homeCommand(), reach: 0.3, elev: 0.3 }, new Float64Array(6));
      engine.setTargets("atlas", reach);
      r.run(1.0);
      const z0 = engine.frame.arms.atlas.eePos[2];
      r.s.atlas.integrity = 1;
      const hitStep = { kind: "arm_arm", atlasLink: "gripper", blazeLink: "gripper", aN: 0, bN: 3, vN: 3, efcForce: 5, pos: [0, 0, 0.1], normal: [1, 0, 0] };
      engine.frame.onsets.push({ ...hitStep, t: engine.frame.simTime, step: engine.frame.step - 1 });
      r.rules.step({ frame: engine.frame, intents: r.intents }, r.events);
      assert.equal(r.s.atlas.servoState, "offline", preset);
      r.run(1.0);
      const drop = z0 - engine.frame.arms.atlas.eePos[2];
      assert.ok(drop >= 0.05, `${preset}: drooped ${(drop * 100).toFixed(1)} cm`);
    }
  });
});
