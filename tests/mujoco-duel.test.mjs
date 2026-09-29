// WP2: the MuJoCo duel engine behind the PhysicsEngine contract.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPhysicsEngine, engineInternals, parkedCubePos } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { CLUTTER_CUBES, CORE_CUBE_INDEX, JOINT_LIMITS, LINK_IDS, SEATS } from "../src/game/contracts.ts";
import { OFFLINE_PROFILE } from "../src/game/physics/servo.ts";
import { LOADOUTS, STOCK_SERVO } from "../src/game/combat/tuning.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
let engine;

function reset(mode = "arcade", layout = "duel", seed = 11, loadouts = { atlas: "pivot", blaze: "pivot" }) {
  engine.reset({ mode, timestep: mode === "arcade" ? 0.0025 : 0.005, seed, loadouts, homePose: { atlas: home, blaze: home }, layout });
}

before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

describe("mujoco duel engine", () => {
  test("model info names every seat link, the cubes, and the loaded files", () => {
    reset();
    const info = engine.info;
    assert.equal(info.nu, 12);
    assert.equal(info.nq, 12 + 9 * 7);
    assert.equal(info.nv, 12 + 9 * 6);
    assert.equal(info.cubeBodyIds.length, 9);
    assert.match(info.mujocoVersion, /^3\.12/);
    assert.match(info.modelSha256, /^[0-9a-f]{64}$/);
    assert.match(info.so101Sha256, /^[0-9a-f]{64}$/);
    for (const seat of SEATS) for (const link of LINK_IDS) assert.ok(info.bodyNames[info.bodyId[seat][link]].startsWith(`${seat}_`));
    assert.equal(info.modelFile, "arena-arcade.xml");
    assert.equal(info.hullScoring, true);
  });

  test("reset switches between the Arcade and stock models synchronously", () => {
    reset("harness");
    assert.equal(engine.info.modelFile, "arena.xml");
    assert.equal(engine.info.hullScoring, false);
    assert.equal(engine.frame.mode, "harness");
    assert.equal(engine.frame.dt, 0.005);
    reset("arcade");
    assert.equal(engine.info.modelFile, "arena-arcade.xml");
    assert.equal(engine.frame.dt, 0.0025);
  });

  test("home pose: roll-axis points 0.24 m apart, grippers not touching, jitter stays within 0.02 rad", () => {
    reset("arcade", "duel", 5);
    const a = engine.frame.arms.atlas, b = engine.frame.arms.blaze;
    assert.ok(Math.abs(a.wristPos[0] - b.wristPos[0] - -0.24) < 0.03, `roll-axis gap ${b.wristPos[0] - a.wristPos[0]}`);
    const tipGap = Math.hypot(a.eePos[0] - b.eePos[0], a.eePos[1] - b.eePos[1], a.eePos[2] - b.eePos[2]);
    assert.ok(tipGap > 0.04, `tip gap ${tipGap}`);
    for (const seat of SEATS) {
      const arm = engine.frame.arms[seat];
      for (let j = 0; j < 5; j++) assert.ok(Math.abs(arm.q[j] - home[j]) <= 0.02 + 1e-12);
      for (let j = 0; j < 6; j++) assert.equal(arm.ctrl[j], home[j]);
    }
    for (let i = 0; i < 400; i++) engine.step();
    assert.equal(engine.frame.onsets.filter((o) => o.kind === "arm_arm").length, 0);
    assert.equal(engine.frame.active.armArmTouching, false);
  });

  test("layouts: clutter on the table, the Core and spares parked; lobby parks everything", () => {
    reset("arcade", "duel");
    const pos = engine.frame.cubes.pos;
    for (let c = 0; c < 9; c++) {
      if (CLUTTER_CUBES.includes(c)) assert.ok(Math.abs(pos[c * 3]) < 0.06 && pos[c * 3 + 2] < 0.03, `cube ${c} on table`);
      else assert.deepEqual([pos[c * 3], pos[c * 3 + 1]], parkedCubePos(c).slice(0, 2));
    }
    assert.ok(pos[CORE_CUBE_INDEX * 3] >= 2);
    reset("arcade", "lobby");
    for (let c = 0; c < 9; c++) assert.ok(engine.frame.cubes.pos[c * 3] >= 2);
  });

  test("docks come from the arena sites", () => {
    reset();
    assert.deepEqual(Array.from(engine.frame.docks), [-0.11, 0, 0, 0.11, 0, 0]);
  });

  test("setTargets clamps exactly to JOINT_LIMITS and writes the frame ctrl", () => {
    reset();
    engine.setTargets("blaze", [9, -9, 9, -9, 9, -9]);
    const ctrl = engine.frame.arms.blaze.ctrl;
    for (let j = 0; j < 6; j++) assert.equal(ctrl[j], j % 2 === 0 ? JOINT_LIMITS[j][1] : JOINT_LIMITS[j][0]);
    engine.setTargets("blaze", [NaN, 0, 0, 0, 0, 0]);
    assert.ok(Number.isFinite(engine.frame.arms.blaze.ctrl[0]));
  });

  test("step advances time, swaps body buffers, and fills arm telemetry", () => {
    reset();
    const t0 = engine.frame.simTime;
    const prev = Float64Array.from(engine.frame.bodyPosCurr);
    engine.setTargets("atlas", [0.5, home[1], home[2], home[3], 0, 0.04]);
    engine.step();
    assert.equal(engine.frame.step, 1);
    assert.ok(Math.abs(engine.frame.simTime - t0 - 0.0025) < 1e-12);
    assert.deepEqual(Array.from(engine.frame.bodyPosPrev), Array.from(prev));
    for (let i = 0; i < 40; i++) engine.step();
    const arm = engine.frame.arms.atlas;
    assert.ok(arm.qd[0] !== 0 && Math.abs(arm.tau[0]) > 0);
    assert.ok(Math.abs(Math.hypot(...arm.eeQuat) - 1) < 1e-9 && arm.eeQuat[0] >= 0);
    assert.ok(Math.hypot(...arm.eeVel) > 0.05);
    assert.equal(arm.forceRange[0], LOADOUTS.pivot.tauMax);
  });

  test("placeCube teleports with zero velocity; null parks", () => {
    reset();
    engine.placeCube(CORE_CUBE_INDEX, [0, 0.12, 0.22]);
    assert.deepEqual(Array.from(engine.frame.cubes.pos.slice(12, 15)), [0, 0.12, 0.22]);
    for (let i = 0; i < 400; i++) engine.step();
    assert.ok(engine.frame.cubes.pos[14] < 0.03, "the Core fell to the table");
    engine.placeCube(CORE_CUBE_INDEX, null);
    assert.deepEqual(Array.from(engine.frame.cubes.pos.slice(12, 15)), parkedCubePos(CORE_CUBE_INDEX));
  });

  test("servo profiles: Arcade scales the loadout base with the 8 N·m cap; stock accepts only Offline", () => {
    reset("arcade", "duel", 1, { atlas: "anvil", blaze: "whip" });
    const { model, index } = engineInternals(engine);
    const fr = () => model.actuator_forcerange[index.actuatorId.atlas[0] * 2 + 1];
    assert.equal(fr(), LOADOUTS.anvil.tauMax);
    engine.applyServoProfile("atlas", { tauScale: 1.4 * 1.35, kpScale: 1, kvScale: 2 });
    assert.equal(fr(), 8.0);
    assert.equal(-model.actuator_biasprm[index.actuatorId.atlas[0] * 10 + 2], LOADOUTS.anvil.kv * 2);
    assert.equal(model.actuator_forcerange[index.actuatorId.atlas[5] * 2 + 1], STOCK_SERVO.tauMax, "gripper stays stock");
    reset("harness");
    const stock = engineInternals(engine);
    const frS = () => stock.model.actuator_forcerange[stock.index.actuatorId.atlas[0] * 2 + 1];
    engine.applyServoProfile("atlas", { tauScale: 1.4, kpScale: 1, kvScale: 2 });
    assert.equal(frS(), STOCK_SERVO.tauMax, "non-Offline profile refused in harness mode");
    engine.applyServoProfile("atlas", OFFLINE_PROFILE);
    assert.ok(Math.abs(frS() - STOCK_SERVO.tauMax * 0.05) < 1e-12);
    reset("harness");
    assert.equal(frS(), STOCK_SERVO.tauMax, "reset restores stock");
  });

  test("saveState / restoreState continue bit for bit, including runtime servo edits", () => {
    reset("arcade", "duel", 9);
    engine.setTargets("atlas", [0.9, 0.1, 0.3, 0, 0.5, 1.1]);
    for (let i = 0; i < 120; i++) engine.step();
    engine.applyServoProfile("atlas", { tauScale: 0.5, kpScale: 0.25, kvScale: 0.6 });
    const saved = engine.saveState();
    for (let i = 0; i < 300; i++) engine.step();
    const expected = engine.checksum();
    engine.applyServoProfile("atlas", { tauScale: 1, kpScale: 1, kvScale: 1 });
    for (let i = 0; i < 50; i++) engine.step();
    engine.restoreState(saved, "both");
    assert.equal(engine.frame.simTime, saved.time);
    for (let i = 0; i < 300; i++) engine.step();
    assert.equal(engine.checksum(), expected);
    const reused = engine.saveState(saved);
    assert.equal(reused, saved, "saveState reuses a matching buffer");
  });

  test("restoreState into the prev slot only touches the previous body buffers", () => {
    reset();
    for (let i = 0; i < 10; i++) engine.step();
    const a = engine.saveState();
    for (let i = 0; i < 40; i++) engine.step();
    const b = engine.saveState();
    engine.restoreState(a, "prev");
    const prevA = Float64Array.from(engine.frame.bodyPosPrev);
    engine.restoreState(b, "curr");
    assert.deepEqual(Array.from(engine.frame.bodyPosPrev), Array.from(prevA));
    assert.notDeepEqual(Array.from(engine.frame.bodyPosCurr), Array.from(prevA));
  });

  test("checksum is FNV-1a over qpos ∥ qvel ∥ ctrl and changes with ctrl", () => {
    reset();
    const c0 = engine.checksum();
    assert.ok(Number.isInteger(c0) && c0 >= 0 && c0 < 2 ** 32);
    engine.setTargets("atlas", [0.1, 0, 0, 0, 0, 0.04]);
    assert.notEqual(engine.checksum(), c0);
  });
});
