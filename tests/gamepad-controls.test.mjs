import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GAMEPAD_DEADZONE,
  PRECISION_SPEED_SCALE,
  STANDARD_GAMEPAD,
  applyRadialDeadzone,
  readStandardGamepad,
} from "../src/lib/gamepad-controls.mjs";

function pad({ axes = [0, 0, 0, 0], pressed = [] } = {}) {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
}

test("standard mapping matches the browser gamepad layout", () => {
  assert.deepEqual(STANDARD_GAMEPAD.axes, { leftX: 0, leftY: 1, rightX: 2, rightY: 3 });
  assert.equal(STANDARD_GAMEPAD.buttons.a, 0);
  assert.equal(STANDARD_GAMEPAD.buttons.menu, 9);
  assert.equal(STANDARD_GAMEPAD.buttons.dpadRight, 15);
  assert.equal(PRECISION_SPEED_SCALE, 0.35);
});

test("radial deadzone rejects drift and preserves circular full-scale motion", () => {
  assert.deepEqual(applyRadialDeadzone(GAMEPAD_DEADZONE / 2, 0), { x: 0, y: 0 });
  assert.deepEqual(applyRadialDeadzone(1, 0), { x: 1, y: 0 });
  const diagonal = applyRadialDeadzone(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-12);
});

test("gamepad reads both sticks and emits button rising edges once", () => {
  const first = readStandardGamepad(pad({
    axes: [0.75, -0.25, -0.5, 0.9],
    pressed: [STANDARD_GAMEPAD.buttons.a, STANDARD_GAMEPAD.buttons.dpadUp],
  }));
  assert.ok(first.move.x > 0 && first.move.y < 0);
  assert.ok(first.look.x < 0 && first.look.y > 0);
  assert.equal(first.justPressed[STANDARD_GAMEPAD.buttons.a], true);

  const held = readStandardGamepad(pad({ pressed: [STANDARD_GAMEPAD.buttons.a] }), first.buttons);
  assert.equal(held.justPressed[STANDARD_GAMEPAD.buttons.a], false);
});
