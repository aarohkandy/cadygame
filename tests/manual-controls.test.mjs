import assert from "node:assert/strict";
import { test } from "node:test";
import { JOINT_CONTROLS, MANUAL_HEIGHTS } from "../src/lib/arm-participation.mjs";
import { PRECISION_SPEED_SCALE } from "../src/lib/gamepad-controls.mjs";
import {
  HAND_KEY_CODES,
  JOINT_KEY_CODES,
  gripperLooksClosed,
  handKeyboardAxes,
  keyCodesForMode,
  stepGripper,
  stepHandHeight,
  stepJointTargets,
  stepWristRoll,
} from "../src/lib/manual-controls.mjs";

test("hand and joint key maps expose distinct action codes for shared physical keys", () => {
  assert.equal(keyCodesForMode("hand"), HAND_KEY_CODES);
  assert.equal(keyCodesForMode("joint"), JOINT_KEY_CODES);
  assert.equal(HAND_KEY_CODES.KeyW, "forward");
  assert.equal(JOINT_KEY_CODES.KeyW, "joint:1:pos");
  assert.equal(HAND_KEY_CODES.KeyG, "gripClose");
  assert.equal(JOINT_KEY_CODES.KeyG, "joint:5:neg");
  assert.notEqual(HAND_KEY_CODES.KeyA, JOINT_KEY_CODES.KeyA);
});

test("joint stepping respects limits and precision scale", () => {
  const home = [0, -0.62, 1.08, -0.48, 0, 0.72];
  const full = stepJointTargets(home, new Set(["joint:0:pos"]), 0.1, 1);
  const precise = stepJointTargets(home, new Set(["joint:0:pos"]), 0.1, PRECISION_SPEED_SCALE);
  assert.ok(full[0] > home[0]);
  assert.ok(Math.abs(full[0] - home[0] - JOINT_CONTROLS[0].speed * 0.1) < 1e-9);
  assert.ok(Math.abs(precise[0] - home[0] - JOINT_CONTROLS[0].speed * PRECISION_SPEED_SCALE * 0.1) < 1e-9);

  const saturated = stepJointTargets(
    [JOINT_CONTROLS[0].max, ...home.slice(1)],
    new Set(["joint:0:pos"]),
    1,
    1,
  );
  assert.equal(saturated[0], JOINT_CONTROLS[0].max);
});

test("hand height and gripper move continuously inside their envelopes", () => {
  const mid = (MANUAL_HEIGHTS.lowered + MANUAL_HEIGHTS.lifted) / 2;
  const raised = stepHandHeight(mid, true, false, 0.1, 1);
  const lowered = stepHandHeight(mid, false, true, 0.1, 1);
  assert.ok(raised > mid && raised <= MANUAL_HEIGHTS.lifted);
  assert.ok(lowered < mid && lowered >= MANUAL_HEIGHTS.lowered);
  assert.equal(stepHandHeight(MANUAL_HEIGHTS.lifted, true, false, 1, 1), MANUAL_HEIGHTS.lifted);

  const grip = stepGripper(0.6, true, false, 0.1, 1);
  assert.ok(grip < 0.6);
  const open = stepGripper(0.6, false, true, 0.1, 1);
  assert.ok(open > 0.6);
  assert.equal(gripperLooksClosed(0.1), true);
  assert.equal(gripperLooksClosed(1.0), false);
});

test("hand keyboard axes and wrist roll honor precision", () => {
  const full = handKeyboardAxes(new Set(["right", "forward"]), 1);
  const precise = handKeyboardAxes(new Set(["right", "forward"]), PRECISION_SPEED_SCALE);
  assert.deepEqual(full, { x: 1, y: -1 });
  assert.deepEqual(precise, { x: PRECISION_SPEED_SCALE, y: -PRECISION_SPEED_SCALE });

  const rolled = stepWristRoll(0, false, true, 0.1, 1);
  assert.ok(rolled > 0);
});
