// WP2: physical scoring ignores intents and heat (GAME_DESIGN 4.4, 4.5, 4.10; BUILD_PLAN 4 WP2 #7).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules, intentsFromBitsInto } from "../src/game/combat/combat-rules.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createRng } from "../src/game/core/rng.ts";
import { noIntents } from "../src/game/contracts.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "harness" }); });
after(() => engine?.dispose());

/**
 * 12 s of seeded brawling in a stock preset: both tips are driven through the contest zone on fresh targets every
 * control tick. `intentMode` decides what the seats "press"; `zeroHeat` wipes heat every step.
 */
function brawl(preset, intentMode, zeroHeat = false) {
  const dt = 0.005;
  const loadouts = { atlas: "whip", blaze: "anvil" };
  const rules = createCombatRules(engine.info);
  rules.reset({ preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 2, coreDropAtS: 3 }, 1, false, null);
  engine.reset({ mode: "harness", timestep: dt, seed: 21, loadouts, homePose: { atlas: home, blaze: home }, layout: "duel" });
  rules.setLive(true);
  const rng = createRng(8);
  const intentRng = createRng(99);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const q = new Float64Array(6);
  const events = [], placements = [];
  const rev = { atlas: rules.profileRevision("atlas"), blaze: rules.profileRevision("blaze") };
  for (let step = 0; step < Math.round(12 / dt); step++) {
    if (step % 4 === 0) {
      for (const seat of ["atlas", "blaze"]) {
        const target = [rng.range(0.2, 0.36), rng.range(-0.1, 0.1), rng.range(0.08, 0.2)];
        if (kin.solveTipEgo(target, rng.range(-0.4, 0.2), home, q).ok) { q[5] = 0.04; engine.setTargets(seat, q); }
        if (intentMode === "toggle") intents[seat].guard = !intents[seat].guard;
        if (intentMode === "spam") intentsFromBitsInto(intentRng.int(64), intents[seat]);
      }
    }
    placements.length = 0;
    rules.requestPlacements(placements);
    for (const p of placements) engine.placeCube(p.cube, p.pos);
    for (const seat of ["atlas", "blaze"]) {
      if (rules.profileRevision(seat) !== rev[seat]) { rev[seat] = rules.profileRevision(seat); engine.applyServoProfile(seat, rules.servoProfile(seat)); }
    }
    engine.step();
    rules.step({ frame: engine.frame, intents }, events);
    if (zeroHeat) { rules.state.seats.atlas.heat = 0; rules.state.seats.blaze.heat = 0; }
  }
  const scored = events
    .filter((e) => ["strike", "ko", "core", "clash", "contact", "servo_state", "late_guard", "deflect"].includes(e.type))
    .map((e) => JSON.stringify(e));
  return { scored, checksum: engine.checksum(), strikes: events.filter((e) => e.type === "strike"), atlas: rules.state.seats.atlas.integrity, blaze: rules.state.seats.blaze.integrity };
}

describe("physical scoring", () => {
  for (const preset of ["proving_ground", "harness"]) {
    test(`${preset}: guard toggled every tick scores exactly like guard never pressed`, () => {
      const base = brawl(preset, "none");
      assert.ok(base.strikes.length >= 3, `the brawl landed ${base.strikes.length} strikes`);
      const toggled = brawl(preset, "toggle");
      assert.equal(toggled.checksum, base.checksum);
      assert.deepEqual(toggled.scored, base.scored);
      assert.ok(base.strikes.every((e) => !e.guarded && e.damage === e.physicalDamage));
    });

    test(`${preset}: every intent spammed and heat forced to 0 change nothing`, () => {
      const base = brawl(preset, "none");
      const spam = brawl(preset, "spam", true);
      assert.equal(spam.checksum, base.checksum);
      assert.deepEqual(spam.scored, base.scored);
      assert.deepEqual([spam.atlas, spam.blaze], [base.atlas, base.blaze]);
    });
  }
});
