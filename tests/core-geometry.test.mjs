// WP2: the dock geometry gate (GAME_DESIGN 2.5) on the committed dock values.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { committedDocks, probe } from "../scripts/probe-dock-geometry.mjs";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { DOCK_RADIUS } from "../src/game/contracts.ts";
import { tuning } from "../src/game/combat/tuning.ts";

let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "harness" }); });
after(() => engine?.dispose());

describe("core geometry", () => {
  test("the committed docks pass (a) owner reach, (b) opponent reach past centre, (c) opponent grasp, at stock and every loadout", async () => {
    const { x, r } = await committedDocks();
    const result = await probe(x, r);
    const failed = result.rows.filter((row) => !row.pass);
    assert.deepEqual(failed, []);
    assert.equal(result.rows.filter((row) => row.check === "c").length, 8);
  });

  test("the docks sit inside the gate's allowed envelope and the rules use the site radius", async () => {
    const { x, r } = await committedDocks();
    assert.ok(x >= 0.09 - 1e-9 && x <= 0.12 + 1e-9, `dock |x| ${x}`);
    assert.ok(r >= 0.07 - 1e-9 && r <= 0.08 + 1e-9, `radius ${r}`);
    assert.equal(tuning.core.dockRadius, DOCK_RADIUS);
    assert.equal(r, DOCK_RADIUS);
  });

  test("the engine publishes the same dock centres on the table plane in both models", async () => {
    const { x } = await committedDocks();
    const kin = createKinematics();
    const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
    for (const mode of ["harness", "arcade"]) {
      engine.reset({ mode, timestep: mode === "arcade" ? 0.0025 : 0.005, seed: 0, loadouts: { atlas: "pivot", blaze: "pivot" }, homePose: { atlas: home, blaze: home }, layout: "duel" });
      assert.deepEqual(Array.from(engine.frame.docks), [-x, 0, 0, x, 0, 0]);
    }
  });
});
