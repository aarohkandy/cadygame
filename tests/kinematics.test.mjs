// WP2: analytic SO-101 kinematics against MuJoCo (GAME_DESIGN 3.1.1; BUILD_PLAN 4 WP2 #14).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createKinematics, ELEVATION_MAX, ELEVATION_MIN, TOOL_MAX, TOOL_MIN } from "../src/game/kinematics/so101-kinematics.ts";
import { createPhysicsEngine, engineInternals } from "../src/game/physics/engine.ts";
import { HOME_TIP_EGO, JOINT_LIMITS, SEATS } from "../src/game/contracts.ts";
import { createRng } from "../src/game/core/rng.ts";

const kin = createKinematics();
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "harness" }); });
after(() => engine?.dispose());

const toEgo = (seat, p) => (seat === "atlas" ? [p[0] + 0.32, p[1], p[2]] : [-(p[0] - 0.32), -p[1], p[2]]);
const inLimits = (q) => q.every((v, j) => v >= JOINT_LIMITS[j][0] - 1e-12 && v <= JOINT_LIMITS[j][1] + 1e-12);

describe("so101 kinematics", () => {
  test("FK gripperframe and roll-axis point match MuJoCo within 1e-6 m over 1,000 samples at random roll, both seats", () => {
    const { mujoco, model, data, index } = engineInternals(engine);
    const rng = createRng(42);
    let worst = 0, worstRoll = 0;
    for (let n = 0; n < 1000; n++) {
      const seat = SEATS[n % 2];
      const q = JOINT_LIMITS.map(([lo, hi]) => rng.range(lo, hi));
      for (let j = 0; j < 6; j++) data.qpos[index.armQposAdr[seat][j]] = q[j];
      mujoco.mj_kinematics(model, data);
      const s = index.gripperSiteId[seat];
      const site = toEgo(seat, [data.site_xpos[s * 3], data.site_xpos[s * 3 + 1], data.site_xpos[s * 3 + 2]]);
      const tip = kin.fkTipEgo(q, new Float64Array(3));
      worst = Math.max(worst, Math.hypot(tip[0] - site[0], tip[1] - site[1], tip[2] - site[2]));
      const g = index.bodyId[seat].gripper;
      const body = toEgo(seat, [data.xpos[g * 3], data.xpos[g * 3 + 1], data.xpos[g * 3 + 2]]);
      const roll = kin.fkRollAxisEgo(q, new Float64Array(3));
      worstRoll = Math.max(worstRoll, Math.hypot(roll[0] - body[0], roll[1] - body[1], roll[2] - body[2]));
    }
    assert.ok(worst < 1e-6, `tip error ${worst}`);
    assert.ok(worstRoll < 1e-6, `roll-axis error ${worstRoll}`);
  });

  test("command IK puts the roll-axis point on target: RMS < 1 mm over 2,000 reachable targets", () => {
    const rng = createRng(7);
    let sq = 0, n = 0;
    const q2 = new Float64Array(6), p1 = new Float64Array(3), p2 = new Float64Array(3);
    const cmd = { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 };
    while (n < 2000) {
      // A reachable target is one a legal arm pose produces; its command is read back, then solved again.
      const q1 = [rng.range(-1.9, 1.9), rng.range(-1.2, 1.2), rng.range(0.2, 1.65), rng.range(-1.6, 1.6), rng.range(-2.7, 2.7), 0.04];
      kin.jointsToCommand(q1, cmd);
      kin.commandToJoints(cmd, q2);
      if (JOINT_LIMITS.some(([lo, hi], j) => q2[j] <= lo + 1e-9 || q2[j] >= hi - 1e-9)) continue;
      kin.fkRollAxisEgo(q1, p1);
      kin.fkRollAxisEgo(q2, p2);
      sq += (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2 + (p1[2] - p2[2]) ** 2;
      n++;
    }
    const rms = Math.sqrt(sq / n);
    assert.ok(rms < 1e-3, `rms ${rms}`);
  });

  test("home command puts the roll-axis point at HOME_TIP_EGO with closed jaws", () => {
    const home = kin.homeCommand();
    const q = kin.commandToJoints(home, new Float64Array(6));
    const p = kin.fkRollAxisEgo(q, new Float64Array(3));
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(p[k] - HOME_TIP_EGO[k]) < 1e-9, `axis ${k}: ${p[k]}`);
    assert.equal(home.grip, 0.04);
    assert.ok(inLimits(Array.from(q)));
    assert.notEqual(kin.homeCommand(), kin.homeCommand(), "a fresh object every call");
  });

  test("commandToJoints clamps unreachable and out-of-range commands to legal joints", () => {
    const q = kin.commandToJoints({ yaw: 5, elev: 3, reach: 2, tool: 4, roll: -9, grip: 9 }, new Float64Array(6));
    assert.ok(Array.from(q).every(Number.isFinite));
    assert.ok(inLimits(Array.from(q)));
  });

  test("solveTipEgo reaches every reachable tip target at its pitch and reports unreachable ones", () => {
    const rng = createRng(3);
    const q = new Float64Array(6), tip = new Float64Array(3), target = new Float64Array(3);
    const cmd = { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 };
    let n = 0;
    while (n < 300) {
      const q1 = [rng.range(-1.2, 1.2), rng.range(-1.0, 1.0), rng.range(0.3, 1.6), rng.range(-1.5, 1.5), rng.range(-2.5, 2.5), 0.04];
      kin.jointsToCommand(q1, cmd);
      if (cmd.tool < TOOL_MIN || cmd.tool > TOOL_MAX || cmd.elev < ELEVATION_MIN || cmd.elev > ELEVATION_MAX) continue;
      kin.fkTipEgo(q1, target);
      if (target[2] < 0.02 || target[0] < 0.08) continue;                // above the table, in front of the mount
      const r = kin.solveTipEgo([target[0], target[1], target[2]], cmd.elev + cmd.tool, q1, q);
      assert.ok(r.ok, `target ${Array.from(target)} pitch ${cmd.elev + cmd.tool} error ${r.errorM}`);
      kin.fkTipEgo(q, tip);
      assert.ok(Math.hypot(tip[0] - target[0], tip[1] - target[1], tip[2] - target[2]) < 1e-3);
      assert.ok(inLimits(Array.from(q)));
      n++;
    }
    const far = kin.solveTipEgo([0.9, 0, 0.1], 0, [0, 0, 0, 0, 0, 0.04], q);
    assert.equal(far.ok, false);
    assert.ok(far.errorM > 0.2);
  });
});
