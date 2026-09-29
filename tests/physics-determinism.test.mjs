// WP2: same seed, same per-step ctrl → same checksum, in every preset and timestep (BUILD_PLAN 4 WP2 #15).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createRng } from "../src/game/core/rng.ts";
import { INTENT_BITS, noIntents } from "../src/game/contracts.ts";
import { intentsFromBitsInto } from "../src/game/combat/combat-rules.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
const engines = [];
before(async () => { engines.push(await createPhysicsEngine({ mode: "arcade" }), await createPhysicsEngine({ mode: "arcade" })); });
after(() => engines.forEach((e) => e.dispose()));

const CASES = [
  { preset: "arcade", mode: "arcade", dt: 0.0025 },
  { preset: "proving_ground", mode: "harness", dt: 0.005 },
  { preset: "harness", mode: "harness", dt: 0.005 },
  { preset: "harness", mode: "harness", dt: 1 / 600 },
];

/** 2,000 steps of seeded ctrl and intents through engine and rules, with profiles and placements applied. */
function run(engine, c, seed) {
  const rules = createCombatRules(engine.info);
  const cfg = { preset: c.preset, roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: "whip", blaze: "anvil" },
    lockInS: { atlas: 8, blaze: 8 }, comebacks: c.preset === "arcade", coreIncomingAtS: 1, coreDropAtS: 2 };
  rules.reset(cfg, 1, false, null);
  engine.reset({ mode: c.mode, timestep: c.dt, seed, loadouts: cfg.loadouts, homePose: { atlas: home, blaze: home }, layout: "duel" });
  rules.setLive(true);
  const rng = createRng(seed ^ 0x5eed);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const targets = { atlas: Float64Array.from(home), blaze: Float64Array.from(home) };
  const rev = { atlas: rules.profileRevision("atlas"), blaze: rules.profileRevision("blaze") };
  const events = [], placements = [];
  for (let step = 0; step < 2000; step++) {
    if (step % 8 === 0) {
      for (const seat of ["atlas", "blaze"]) {
        const t = targets[seat];
        t[0] = rng.range(-0.8, 0.8); t[1] = home[1] + rng.range(-0.3, 0.4); t[2] = home[2] + rng.range(-0.3, 0.2);
        t[3] = rng.range(-0.8, 0.8); t[4] = rng.range(-1, 1); t[5] = rng.range(0.04, 1.15);
        intentsFromBitsInto(rng.int(64) & ~INTENT_BITS.grip, intents[seat]);
      }
    }
    placements.length = 0;
    rules.requestPlacements(placements);
    for (const p of placements) engine.placeCube(p.cube, p.pos);
    for (const seat of ["atlas", "blaze"]) {
      if (rules.profileRevision(seat) !== rev[seat]) { rev[seat] = rules.profileRevision(seat); engine.applyServoProfile(seat, rules.servoProfile(seat)); }
      engine.setTargets(seat, targets[seat]);
    }
    engine.step();
    rules.step({ frame: engine.frame, intents }, events);
  }
  return { checksum: engine.checksum(), events: JSON.stringify(events), state: engine.saveState() };
}

describe("physics determinism", () => {
  for (const c of CASES) {
    test(`${c.preset} at ${(c.dt * 1000).toFixed(2)} ms: identical checksum and events after 2,000 steps on two engines`, () => {
      const a = run(engines[0], c, 1234);
      const b = run(engines[1], c, 1234);
      assert.equal(a.checksum, b.checksum);
      assert.equal(a.events, b.events);
      const other = run(engines[1], c, 99);
      assert.notEqual(other.checksum, a.checksum, "a different seed diverges");
    });
  }

  test("reset with the same seed after a long run reproduces the run exactly (no hidden engine state)", () => {
    const c = CASES[0];
    const first = run(engines[0], c, 77);
    run(engines[0], CASES[2], 5);
    const again = run(engines[0], c, 77);
    assert.equal(again.checksum, first.checksum);
    assert.equal(again.events, first.events);
  });
});
