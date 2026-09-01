import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JOINT_CONTROLS,
  MANUAL_HEIGHTS,
  MANUAL_HOME_TARGET,
  parseTrajectoryPolicy,
  sampleTrajectoryPolicy,
  stepTaskSpaceTarget,
  validatePolicyAction,
} from "../src/lib/arm-participation.mjs";

const HOME = [0, -0.62, 1.08, -0.48, 0, 0.72];

test("joystick motion is normalized, workspace-limited, and height-assisted", () => {
  assert.equal(JOINT_CONTROLS.length, 6);
  const moved = stepTaskSpaceTarget(MANUAL_HOME_TARGET, { x: 1, y: 0 }, 0.1, true);
  assert.ok(moved[0] > MANUAL_HOME_TARGET[0], "right stick motion should move toward the rival");
  assert.equal(moved[1], MANUAL_HOME_TARGET[1]);

  const diagonal = stepTaskSpaceTarget(MANUAL_HOME_TARGET, { x: 1, y: 1 }, 0.1, true);
  assert.ok(Math.abs(Math.hypot(
    diagonal[0] - MANUAL_HOME_TARGET[0],
    diagonal[1] - MANUAL_HOME_TARGET[1],
  ) - 0.0115) < 1e-8, "diagonal joystick input should not exceed axial speed");

  let lowered = [...MANUAL_HOME_TARGET];
  for (let frame = 0; frame < 120; frame += 1) {
    lowered = stepTaskSpaceTarget(lowered, { x: 0, y: 0 }, 1 / 60, false);
  }
  assert.ok(Math.abs(lowered[2] - MANUAL_HEIGHTS.lowered) < 1e-8);

  const saturated = stepTaskSpaceTarget(MANUAL_HOME_TARGET, { x: 100, y: -100 }, 100, true);
  assert.ok(saturated[0] <= 0.035 && saturated[1] >= -0.14);
  assert.ok(Math.hypot(saturated[0] + 0.32, saturated[1]) <= 0.3550001);
});

test("uploaded JSON trajectories are validated and smoothly sampled", () => {
  const policy = parseTrajectoryPolicy({
    name: "Test route",
    fps: 2,
    loop: false,
    actions: [HOME, [0.4, -0.4, 0.8, -0.2, 0.2, 1.2]],
  });
  assert.equal(policy.name, "Test route");
  assert.deepEqual(sampleTrajectoryPolicy(policy, 0), HOME);
  assert.deepEqual(sampleTrajectoryPolicy(policy, 0.25), [0.2, -0.51, 0.9400000000000001, -0.33999999999999997, 0.1, 0.96]);
  assert.deepEqual(sampleTrajectoryPolicy(policy, 20), policy.actions[1]);
});

test("uploaded actions reject unsafe or malformed joint targets", () => {
  assert.throws(() => validatePolicyAction([0, 0]), /exactly six/);
  assert.throws(() => validatePolicyAction([0, 0, 0, 0, Number.NaN, 0]), /non-finite/);
  assert.throws(() => validatePolicyAction([99, 0, 0, 0, 0, 0]), /outside/);
  assert.throws(
    () => parseTrajectoryPolicy({ fps: 0, actions: [HOME] }),
    /between 1 and 240/,
  );
});
