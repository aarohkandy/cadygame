// WP2: stock presets never edit the model, except the recorded Offline profile at KO (BUILD_PLAN 4 WP2 #12).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules, intentsFromBitsInto } from "../src/game/combat/combat-rules.ts";
import { createPhysicsEngine, engineInternals } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createRng } from "../src/game/core/rng.ts";
import { noIntents } from "../src/game/contracts.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

/** Every readable actuator_* / dof_* array. MuJoCo 3.12's bindings cannot read bool arrays (memory_view<bool>). */
const MODEL_ARRAYS = (model) => Object.keys(Object.getPrototypeOf(model))
  .filter((k) => /^(actuator_|dof_)/.test(k))
  .filter((k) => { try { return ArrayBuffer.isView(model[k]); } catch { return false; } });

/** A stock match on the same engine that also ran Arcade: seeded brawls, every intent spammed, rounds until a KO. */
function stockMatch(preset) {
  const dt = 0.005;
  const loadouts = { atlas: "anvil", blaze: "whip" };
  const rng = createRng(5), bits = createRng(6);
  const q = new Float64Array(6);
  const offline = new Set();
  // Arcade first, so any leaked Arcade edit would show up in the stock model's arrays.
  engine.reset({ mode: "arcade", timestep: 0.0025, seed: 1, loadouts, homePose: { atlas: home, blaze: home }, layout: "duel" });
  engine.applyServoProfile("atlas", { tauScale: 1.4, kpScale: 0.25, kvScale: 3 });
  for (let i = 0; i < 100; i++) engine.step();
  for (let round = 1; round <= 3 && offline.size === 0; round++) {
    const rules = createCombatRules(engine.info);
    rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 1, coreDropAtS: 2 }, round, false, null);
    engine.reset({ mode: "harness", timestep: dt, seed: round, loadouts, homePose: { atlas: home, blaze: home }, layout: "duel" });
    rules.setLive(true);
    rules.state.seats.blaze.integrity = 12;                          // make the KO (and its Offline profile) happen
    const intents = { atlas: noIntents(), blaze: noIntents() };
    const rev = { atlas: rules.profileRevision("atlas"), blaze: rules.profileRevision("blaze") };
    const events = [], placements = [];
    // Like the sim-driver, keep stepping a moment past the outcome so the KO's profile revision reaches the engine.
    let tail = 20;
    for (let step = 0; step < Math.round(45 / dt) && tail > 0; step++) {
      if (rules.state.outcome) tail--;
      if (step % 4 === 0) {
        for (const seat of ["atlas", "blaze"]) {
          if (kin.solveTipEgo([rng.range(0.2, 0.38), rng.range(-0.1, 0.1), rng.range(0.08, 0.2)], rng.range(-0.4, 0.2), home, q).ok) { q[5] = rng.range(0.04, 1.15); engine.setTargets(seat, q); }
        }
      }
      for (const seat of ["atlas", "blaze"]) intentsFromBitsInto(bits.int(64), intents[seat]);
      placements.length = 0;
      rules.requestPlacements(placements);
      for (const p of placements) engine.placeCube(p.cube, p.pos);
      for (const seat of ["atlas", "blaze"]) {
        if (rules.profileRevision(seat) !== rev[seat]) {
          rev[seat] = rules.profileRevision(seat);
          const profile = rules.servoProfile(seat);
          engine.applyServoProfile(seat, profile);
          if (rules.state.seats[seat].servoState === "offline") offline.add(seat);
          // Any Arcade-looking profile reaching the engine would be a rules bug; the engine must refuse it anyway.
          engine.applyServoProfile(seat === "atlas" ? "blaze" : "atlas", { tauScale: 1.35, kpScale: 1, kvScale: 2 });
        }
      }
      engine.step();
      rules.step({ frame: engine.frame, intents }, events);
    }
  }
  return offline;
}

describe("harness model immutability", () => {
  for (const preset of ["proving_ground", "harness"]) {
    test(`${preset}: every actuator_* and dof_* array equals a fresh compile, except the recorded Offline profile`, () => {
      const offline = stockMatch(preset);
      assert.equal(offline.size, 1, "the match ended in a KO");
      const { model, index, compileFresh } = engineInternals(engine);
      assert.equal(engine.info.modelFile, "arena.xml");
      const fresh = compileFresh("harness");
      try {
        const keys = MODEL_ARRAYS(model);
        assert.ok(keys.includes("actuator_gainprm") && keys.includes("dof_damping") && keys.length > 10, `${keys.length} arrays`);
        const allowed = new Set();
        for (const seat of offline) {
          for (let j = 0; j < 5; j++) {
            const a = index.actuatorId[seat][j];
            allowed.add(`actuator_gainprm:${a * 10}`);
            allowed.add(`actuator_biasprm:${a * 10 + 1}`);
            allowed.add(`actuator_biasprm:${a * 10 + 2}`);
            allowed.add(`actuator_forcerange:${a * 2}`);
            allowed.add(`actuator_forcerange:${a * 2 + 1}`);
          }
        }
        const diffs = [];
        for (const k of keys) {
          const got = model[k], want = fresh[k];
          assert.equal(got.length, want.length, k);
          for (let i = 0; i < got.length; i++) {
            if (!Object.is(got[i], want[i]) && !(Number.isNaN(got[i]) && Number.isNaN(want[i])) && !allowed.has(`${k}:${i}`)) diffs.push(`${k}[${i}] ${got[i]} ≠ ${want[i]}`);
          }
        }
        assert.deepEqual(diffs, []);
        const seat = [...offline][0];
        const a = index.actuatorId[seat][0];
        assert.ok(Math.abs(model.actuator_forcerange[a * 2 + 1] - 2.94 * 0.05) < 1e-12, "the Offline profile is what changed");
      } finally {
        fresh.delete();
      }
    });
  }
});
