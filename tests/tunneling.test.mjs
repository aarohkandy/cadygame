// WP2: strike hulls stop fast tips from tunnelling (GAME_DESIGN 4.10; BUILD_PLAN 4 WP2 #13).
// A max-speed WHIP hook aimed through the opponent's camera_mount registers an arm-arm onset in 100 of 100 seeded
// trials (start-pose jitter, sub-step phase, and target placement all vary with the seed).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createRng } from "../src/game/core/rng.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

const toEgo = (seat, p) => (seat === "atlas" ? [p[0] + 0.32, p[1], p[2]] : [-(p[0] - 0.32), -p[1], p[2]]);

describe("tunneling", () => {
  test("100/100 max-speed WHIP hooks at the camera_mount register an onset", () => {
    let hits = 0, fastest = 0;
    const misses = [];
    for (let trial = 0; trial < 100; trial++) {
      const rng = createRng(1000 + trial);
      engine.reset({ mode: "arcade", timestep: 0.0025, seed: trial, loadouts: { atlas: "whip", blaze: "pivot" }, homePose: { atlas: home, blaze: home }, layout: "lobby" });
      // Blaze holds a guard pose that varies with the seed; aim atlas's tip through its camera_mount body origin.
      const blazeQ = Float64Array.from(home);
      blazeQ[0] += rng.range(-0.15, 0.15); blazeQ[1] += rng.range(-0.1, 0.1); blazeQ[4] = rng.range(-0.5, 0.5);
      engine.setTargets("blaze", blazeQ);
      engine.setTargets("atlas", home);
      for (let i = 0; i < 240; i++) engine.step();
      const cam = engine.frame.arms.blaze.cameraMountPos;
      const aim = toEgo("atlas", [cam[0], cam[1], cam[2]]);
      const hitQ = new Float64Array(6);
      const pitch = rng.range(-0.3, 0.3);
      const solved = kin.solveTipEgo(aim, pitch, [0, 0, 0, 0, 0, 0.04], hitQ);
      assert.ok(solved.ok, `trial ${trial}: IK to the camera mount`);
      hitQ[5] = 0.04;
      const side = trial % 2 === 0 ? 1 : -1;
      const start = Float64Array.from(hitQ); start[0] = hitQ[0] - side * 1.0;
      const through = Float64Array.from(hitQ); through[0] = hitQ[0] + side * 1.0;
      engine.setTargets("atlas", start);
      for (let i = 0; i < 320; i++) engine.step();
      engine.setTargets("atlas", through);
      let onset = false;
      for (let i = 0; i < 160 && !onset; i++) {
        engine.step();
        const arm = engine.frame.arms.atlas;
        fastest = Math.max(fastest, Math.hypot(arm.eeVel[0], arm.eeVel[1], arm.eeVel[2]));
        onset = engine.frame.onsets.some((o) => o.kind === "arm_arm");
      }
      if (onset) hits++; else misses.push(trial);
    }
    assert.equal(hits, 100, `missed trials ${misses.join(", ")}`);
    assert.ok(fastest > 2.5, `the hook reached ${fastest.toFixed(2)} m/s`);
  });
});
