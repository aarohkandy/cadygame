// WP3 assists (GAME_DESIGN 3.1.4): seat frames, pan calibration against WP2's kinematics, the command-space solver,
// range cue, grab target selection, dock magnet, guard line, and aim assist through the pilot.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CORE_CUBE_INDEX, DOCK_CENTER_X, GRIP_CLOSED } from "../src/game/contracts.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import {
  GUARD_BLEND, GUARD_LINE_R_M, blendGuard, computeRangeCue, coreOverOwnDock, createAssistScratch, dockCommand, egoToWorld,
  findGrabCube, foldQuarter, guardCommand, panCalibration, solveRollAxisCommand, worldToEgo, yawToward,
} from "../src/game/input/assists.ts";
import { createPilot } from "../src/game/input/pilot-controller.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const kin = createKinematics();

function frameWithParkedCubes() {
  const frame = fakeFrame();
  for (let i = 0; i < 9; i++) frame.cubes.pos.set([2 + 0.1 * i, 0, 0.02], i * 3);
  return frame;
}

function placeOpponentAt(frame, egoTip) {
  // Opponent hurtbox chain around a tip point given in atlas ego.
  const w = (x, y, z) => egoToWorld("atlas", x, y, z, new Float64Array(3));
  const [x, y, z] = egoTip;
  const opp = frame.arms.blaze;
  opp.eePos.set(w(x, y, z));
  opp.wristPos.set(w(x + 0.05, y, z + 0.02));
  opp.cameraMountPos.set(w(x + 0.06, y, z + 0.04));
  opp.elbowPos.set(w(x + 0.16, y, z + 0.08));
  opp.shoulderPos.set(w(0.6, 0, 0.1));
}

describe("assists", () => {
  test("seat frames: blaze is a 180 degree turn about z, and the round trip is exact", () => {
    const out = new Float64Array(3);
    worldToEgo("blaze", 0.32, 0, 0.1, out);
    assert.ok(Math.abs(out[0]) < 1e-12 && Math.abs(out[1]) < 1e-12 && out[2] === 0.1);
    worldToEgo("blaze", 0, 0.05, 0.1, out);
    assert.ok(Math.abs(out[0] - 0.32) < 1e-12 && Math.abs(out[1] + 0.05) < 1e-12);
    for (const seat of ["atlas", "blaze"]) {
      egoToWorld(seat, 0.21, -0.07, 0.3, out);
      worldToEgo(seat, out[0], out[1], out[2], out);
      assert.ok(Math.hypot(out[0] - 0.21, out[1] + 0.07, out[2] - 0.3) < 1e-12);
    }
  });

  test("pan calibration finds the pan axis and the yaw sign from FK (so101: +pan turns right)", () => {
    const cal = panCalibration(kin);
    assert.equal(cal.sign, -1);
    const home = kin.homeCommand();
    for (const yaw of [-1.2, -0.4, 0.3, 1.0]) {
      const c = { ...home, yaw };
      const j = kin.commandToJoints(c, new Float64Array(6));
      const p = kin.fkRollAxisEgo(j, new Float64Array(3));
      assert.ok(Math.abs(yawToward(kin, p[0], p[1]) - yaw) < 1e-6, `yaw ${yaw}`);
    }
  });

  test("the command solver puts the roll axis on reachable targets within 1 mm", () => {
    const s = createAssistScratch();
    for (const target of [[0.25, 0.05, 0.05], [0.18, 0.12, 0.2], [0.3, -0.08, 0.12], [0.22, 0, 0.26]]) {
      const c = kin.homeCommand();
      const err = solveRollAxisCommand(kin, target, c, s);
      assert.ok(err < 0.001, `target ${target} err ${err}`);
    }
  });

  test("foldQuarter folds any angle into [-pi/4, pi/4] with quarter-turn symmetry", () => {
    for (const a of [-3, -1.2, -0.5, 0, 0.3, 0.9, 2.2, 6.5]) {
      const f = foldQuarter(a);
      assert.ok(f >= -Math.PI / 4 - 1e-12 && f <= Math.PI / 4 + 1e-12);
      const k = Math.round((a - f) / (Math.PI / 2));
      assert.ok(Math.abs(a - f - k * Math.PI / 2) < 1e-9);
    }
  });

  test("range cue: lit when a flick sample reaches the opponent hurtbox, dark when out of reach", () => {
    const s = createAssistScratch();
    const aim = kin.homeCommand();
    const cue = { flick: false, jab: false, nearestM: 0, flickArcRadiusM: 0, jabArcRadiusM: 0 };
    const frame = frameWithParkedCubes();
    const j = kin.commandToJoints(aim, new Float64Array(6));
    const tip = kin.fkTipEgo(j, new Float64Array(3));
    placeOpponentAt(frame, [tip[0] + 0.02, tip[1], tip[2]]);
    computeRangeCue(kin, "atlas", aim, frame, cue, s);
    assert.equal(cue.flick, true);
    assert.ok(cue.nearestM < 0.015);
    assert.ok(cue.jabArcRadiusM > cue.flickArcRadiusM, "jab arc is farther out");
    placeOpponentAt(frame, [0.62, 0, 0.14]);
    computeRangeCue(kin, "atlas", aim, frame, cue, s);
    assert.equal(cue.flick, false);
    assert.equal(cue.jab, false);
    assert.ok(cue.nearestM > 0.05);
  });

  test("grab target: nearest un-parked cube within 5 cm of the physical gripperframe", () => {
    const frame = frameWithParkedCubes();
    frame.arms.atlas.eePos.set([-0.1, 0, 0.05]);
    assert.equal(findGrabCube("atlas", frame), -1, "parked cubes are never grabbed");
    frame.cubes.pos.set([-0.07, 0.01, 0.04], 6 * 3);
    frame.cubes.pos.set([-0.08, 0.0, 0.05], 2 * 3);
    assert.equal(findGrabCube("atlas", frame), 2);
    frame.cubes.pos.set([-0.2, 0.0, 0.05], 2 * 3);
    assert.equal(findGrabCube("atlas", frame), 6);
  });

  test("dock magnet: only while holding the Core over the own dock; the target puts the Core over the dock centre", () => {
    const frame = frameWithParkedCubes();
    frame.docks.set([DOCK_CENTER_X.atlas, 0, 0, DOCK_CENTER_X.blaze, 0, 0]);
    frame.cubes.pos.set([DOCK_CENTER_X.atlas + 0.03, 0.01, 0.06], CORE_CUBE_INDEX * 3);
    assert.equal(coreOverOwnDock("atlas", frame), false, "not holding it");
    frame.active.bothJawsOnCube.atlas = CORE_CUBE_INDEX;
    assert.equal(coreOverOwnDock("atlas", frame), true);
    frame.cubes.pos.set([DOCK_CENTER_X.atlas + 0.05, 0, 0.06], CORE_CUBE_INDEX * 3);
    assert.equal(coreOverOwnDock("atlas", frame), false, "outside 4 cm");
    const s = createAssistScratch();
    const out = kin.homeCommand();
    dockCommand(kin, "atlas", frame, kin.homeCommand(), out, s);
    const j = kin.commandToJoints(out, new Float64Array(6));
    const tip = kin.fkTipEgo(j, new Float64Array(3));
    const dock = worldToEgo("atlas", DOCK_CENTER_X.atlas, 0, 0, new Float64Array(3));
    assert.ok(Math.hypot(tip[0] - dock[0], tip[1] - dock[1]) < 0.002);
    assert.ok(Math.abs(tip[2] - 0.03) < 0.002);
  });

  test("guard line: roll axis 0.24 m from the shoulder toward the opponent gripper; the blend goes 60% of the way", () => {
    const frame = frameWithParkedCubes();
    frame.arms.atlas.shoulderPos.set(egoToWorld("atlas", 0.04, 0, 0.12, new Float64Array(3)));
    placeOpponentAt(frame, [0.45, 0.06, 0.16]);
    const s = createAssistScratch();
    const aim = kin.homeCommand();
    const guard = kin.homeCommand();
    guardCommand(kin, "atlas", frame, aim, guard, s);
    const j = kin.commandToJoints(guard, new Float64Array(6));
    const p = kin.fkRollAxisEgo(j, new Float64Array(3));
    assert.ok(Math.abs(Math.hypot(p[0] - 0.04, p[1], p[2] - 0.12) - GUARD_LINE_R_M) < 0.002);
    const blended = blendGuard(aim, guard, { ...aim });
    assert.ok(Math.abs(blended.yaw - (aim.yaw + GUARD_BLEND * (guard.yaw - aim.yaw))) < 1e-12);
    assert.equal(blended.tool, aim.tool + GUARD_BLEND * (guard.tool - aim.tool));
  });

  test("aim assist (gamepad, vs AI): with the stance stick idle, yaw drifts toward the opponent at 0.6 rad/s", () => {
    let axes = [0, 0, 0, 0];
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const pad = { connected: true, mapping: "standard", index: 0, timestamp: 0, get axes() { return axes; }, buttons };
    const pilot = createPilot(
      { kinematics: kin, settings: createSettingsStore({ storage: null }), clock: createGameClock(), profileMatchesPlayed: () => 10 },
      { getPads: () => [pad] },
    );
    pilot.setRules({ jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: true, showKit: true });
    pilot.setMode("fight");
    const frame = frameWithParkedCubes();
    placeOpponentAt(frame, [0.4, -0.12, 0.15]);
    const out = new Float64Array(6);
    pilot.writeCommand(frame, fakeCombat(), out);
    axes = [0, 0, 0.5, 0];                   // touch the right stick so the pad engages, then let go
    pilot.sampleFrame(1 / 60, false);
    axes = [0, 0, 0, 0];
    pilot.sampleFrame(1 / 60, false);        // the swing stick springs back to the stance yaw
    const y0 = pilot.aim.yaw;
    pilot.sampleFrame(0.1, false);
    assert.equal(pilot.device, "gamepad");
    const target = yawToward(kin, 0.4, -0.12);
    assert.ok(Math.sign(target - y0) === Math.sign(pilot.aim.yaw - y0), "drifts toward the opponent");
    assert.ok(Math.abs(Math.abs(pilot.aim.yaw - y0) - 0.06) < 1e-6, "at 0.6 rad/s");
    assert.equal(pilot.shaping.aimAssist, true);
  });
});

import { REACH_TRACK_CORE_M, targetReachDelta } from "../src/game/input/assists.ts";

describe("match-1 reach tracking", () => {
  test("the delta is the radial gap between the tip and the nearest target: the opponent's gripper, or a Core near the tip", () => {
    const kin = createKinematics();
    const s = createAssistScratch();
    const frame = fakeFrame();
    for (let i = 0; i < 9; i++) { frame.cubes.pos[i * 3] = 2 + 0.1 * i; frame.cubes.pos[i * 3 + 2] = 0.02; }
    const aim = { ...kin.homeCommand(), grip: GRIP_CLOSED };
    kin.commandToJoints(aim, s.joints);
    const tip = new Float64Array(3);
    kin.fkTipEgo(s.joints, tip);
    const r = Math.hypot(tip[0], tip[1]);
    const put = (target, radius) => egoToWorld("atlas", tip[0] * radius / r, tip[1] * radius / r, tip[2], target);
    put(frame.arms.blaze.eePos, r + 0.05);
    assert.ok(Math.abs(targetReachDelta(kin, "atlas", aim, frame, s) - 0.05) < 1e-9, "5 cm out");
    put(frame.arms.blaze.eePos, r - 0.03);
    assert.ok(Math.abs(targetReachDelta(kin, "atlas", aim, frame, s) + 0.03) < 1e-9, "3 cm in");
    const c = CORE_CUBE_INDEX * 3;
    const core = new Float64Array(3);
    put(core, r + 0.02);
    frame.cubes.pos[c] = core[0]; frame.cubes.pos[c + 1] = core[1]; frame.cubes.pos[c + 2] = core[2];
    assert.ok(Math.abs(targetReachDelta(kin, "atlas", aim, frame, s) - 0.02) < 1e-9, "a Core within reach wins");
    put(core, r + REACH_TRACK_CORE_M + 0.1);
    frame.cubes.pos[c] = core[0]; frame.cubes.pos[c + 1] = core[1]; frame.cubes.pos[c + 2] = core[2];
    assert.ok(Math.abs(targetReachDelta(kin, "atlas", aim, frame, s) + 0.03) < 1e-9, "a far Core is ignored");
  });
});
