// WP3 gamepad (GAME_DESIGN 3.4, BUILD_PLAN 4 WP3.8): stick curve with radial deadzone, the absolute swing stick's
// 1.80 rad hook, trigger thresholds, reach creep, re-centre, UI buttons, and disconnect handling.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPilot } from "../src/game/input/pilot-controller.ts";
import { PAD, shapeStick, stickCurve } from "../src/game/input/gamepad.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const RULES = { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: true };
const DT = 1 / 60;

function fakePad() {
  const pad = {
    connected: true, mapping: "standard", index: 0, timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    press(i, v = 1) { this.buttons[i] = { pressed: v >= 0.5, value: v }; },
  };
  return pad;
}

function setup() {
  const pad = fakePad();
  const pads = [pad];
  const pilot = createPilot(
    { kinematics: createKinematics(), settings: createSettingsStore({ storage: null }), clock: createGameClock(), profileMatchesPlayed: () => 10 },
    { getPads: () => pads },
  );
  pilot.setRules(RULES);
  pilot.setMode("fight");
  const frame = fakeFrame();
  for (let i = 0; i < 9; i++) frame.cubes.pos.set([2 + 0.1 * i, 0, 0.02], i * 3);
  pilot.writeCommand(frame, fakeCombat(), new Float64Array(6));
  return { pad, pads, pilot, frame };
}

describe("gamepad", () => {
  test("stick curve: 0.12 deadzone, 1.5 power response, full deflection maps to 1", () => {
    assert.equal(stickCurve(0.1), 0);
    assert.equal(stickCurve(0.12), 0);
    assert.equal(stickCurve(1), 1);
    assert.equal(stickCurve(-1), -1);
    const v = 0.56;
    assert.ok(Math.abs(stickCurve(v) - Math.pow((v - 0.12) / 0.88, 1.5)) < 1e-12);
  });

  test("radial deadzone keeps diagonal direction and zeroes the whole inner circle", () => {
    const out = { x: 0, y: 0 };
    shapeStick(0.08, 0.08, 0.12, out);
    assert.deepEqual(out, { x: 0, y: 0 }, "0.113 magnitude is inside the circle even though each axis is 0.08");
    shapeStick(0.6, 0.6, 0.12, out);
    assert.ok(Math.abs(out.x - out.y) < 1e-12, "diagonal stays diagonal");
    shapeStick(1, 0, 0.12, out);
    assert.equal(out.x, 1);
  });

  test("swing parity: a -1 to +1 right-stick sweep in 50 ms is a 1.80 rad yaw step", () => {
    const { pad, pilot } = setup();
    pad.axes = [0, 0, -1, 0];
    pilot.sampleFrame(DT, false);
    const left = pilot.command.yaw;
    pad.axes = [0, 0, 0, 0];
    pilot.sampleFrame(DT, false);
    pad.axes = [0, 0, 1, 0];
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.yaw - left - 1.8) < 1e-9, `step ${pilot.command.yaw - left}`);
    assert.equal(pilot.device, "gamepad");
  });

  test("right stick up raises elevation by up to 0.5 rad; left stick x drifts the stance at 1.6 rad/s", () => {
    const { pad, pilot } = setup();
    pilot.sampleFrame(DT, false);
    const elev0 = pilot.command.elev;
    const yaw0 = pilot.command.yaw;
    pad.axes = [0, 0, 0, -1];
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.elev - Math.min(0.9, elev0 + 0.5)) < 1e-9);
    pad.axes = [1, 0, 0, 0];
    pilot.sampleFrame(0.1, false);
    assert.ok(Math.abs(pilot.command.yaw - yaw0 - 0.16) < 1e-9);
  });

  test("triggers: RT past 0.35 is strike (tap jab, hold charge), LT is guard; RB grip, LB overdrive, Y ability", () => {
    const { pad, pilot } = setup();
    pad.press(PAD.RT, 0.3);
    pilot.sampleFrame(DT, false);
    pad.press(PAD.RT, 0);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, false, "below threshold is nothing");
    pad.press(PAD.RT, 0.6);
    for (let i = 0; i < 6; i++) pilot.sampleFrame(DT, false);
    pad.press(PAD.RT, 0);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, true, "100 ms tap jabs");
    pad.press(PAD.RT, 1);
    for (let i = 0; i < 20; i++) pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.charge, true, "hold charges");
    pad.press(PAD.LT, 0.5);
    pad.press(PAD.RB, 1);
    pad.press(PAD.LB, 1);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.charge, false, "LT cancels the charge");
    assert.equal(pilot.intents.guard, true);
    assert.equal(pilot.intents.grip, true);
    assert.equal(pilot.intents.overdrive, true);
  });

  test("left stick y springs reach (0.12 out, 0.08 in) and |y| > 0.9 for 400 ms creeps the stance", () => {
    const { pad, pilot } = setup();
    pilot.sampleFrame(DT, false);
    const r0 = pilot.aim.reach;
    pad.axes = [0, -1, 0, 0];
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - r0 - 0.12) < 1e-9);
    for (let i = 0; i < 59; i++) pilot.sampleFrame(DT, false);
    pad.axes = [0, 0, 0, 0];
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - r0 - 0.15) < 1e-6);
    pad.axes = [0, 1, 0, 0];
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - (r0 + 0.15 - 0.08)) < 1e-6);
  });

  test("RS click re-centres the stance on the opponent; Menu pauses and View holds STATS", () => {
    const { pad, pilot, frame } = setup();
    frame.arms.blaze.eePos.set([0.1, -0.15, 0.15]);
    pilot.writeCommand(frame, fakeCombat(), new Float64Array(6));
    pad.axes = [0, 0, 0.3, 0];
    pilot.sampleFrame(DT, false);
    pad.axes = [0, 0, 0, 0];
    pad.press(PAD.RS, 1);
    pad.press(PAD.MENU, 1);
    pad.press(PAD.VIEW, 1);
    pilot.sampleFrame(DT, false);
    assert.ok(pilot.command.yaw > 0.2, "turned right toward the opponent at ego y -0.15");
    assert.equal(pilot.consumeUi("pause"), 1);
    assert.equal(pilot.consumeUi("pause"), 0);
    // VIEW is the pad's STATS button and STATS is a hold, so it stays reported until the button comes up.
    assert.equal(pilot.consumeUi("stats"), 1, "VIEW did not reach the STATS action");
    assert.equal(pilot.isUiHeld("stats"), true);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.isUiHeld("stats"), true, "a held VIEW must not re-trigger or drop");
    assert.equal(pilot.consumeUi("stats"), 0, "a hold counts one press, not one per frame");
    pad.press(PAD.VIEW, 0);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.isUiHeld("stats"), false);
  });

  test("a pad that disconnects mid-hold releases the STATS overlay", () => {
    const { pad, pads, pilot } = setup();
    pad.press(PAD.VIEW, 1);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.isUiHeld("stats"), true);
    pads.length = 0;
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.isUiHeld("stats"), false, "the overlay would have stuck open with the pad gone");
  });

  test("a disconnect releases every held pad input", () => {
    const { pad, pads, pilot } = setup();
    pad.press(PAD.LT, 1);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.guard, true);
    pads.length = 0;
    pilot.sampleFrame(DT, false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.guard, false);
  });
});
