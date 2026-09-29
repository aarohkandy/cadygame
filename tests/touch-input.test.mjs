// WP3 touch input (BUILD_PLAN 2.2, 4 WP3.9): swing-stick parity with the gamepad, strike timing, the same command
// fields as the pad, release(), multi-touch, stick geometry, and the show rule.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPilot } from "../src/game/input/pilot-controller.ts";
import { PAD } from "../src/game/input/gamepad.ts";
import { MIN_TARGET_PX, knobOffset, stickFromPointer, touchControlsEnabled, TOUCH_DEADZONE } from "../src/game/input/touch-input.ts";
import { FLICK_DEFAULTS, createFlickDetector, flickHaptic } from "../src/game/ui/touch/gestures.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const RULES = { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: true };
const DT = 1 / 60;

function makePilot(pads = []) {
  const pilot = createPilot(
    { kinematics: createKinematics(), settings: createSettingsStore({ storage: null }), clock: createGameClock(), profileMatchesPlayed: () => 10 },
    { getPads: () => pads },
  );
  pilot.setRules(RULES);
  pilot.setMode("fight");
  const frame = fakeFrame();
  for (let i = 0; i < 9; i++) frame.cubes.pos.set([2 + 0.1 * i, 0, 0.02], i * 3);
  pilot.writeCommand(frame, fakeCombat(), new Float64Array(6));
  pilot.sampleFrame(DT, false);
  return pilot;
}

function pad() {
  return {
    connected: true, mapping: "standard", index: 0, timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}

describe("touch input", () => {
  test("swing parity: a -1 to +1 swing in 50 ms is the same 1.80 rad hook as the gamepad", () => {
    const pilot = makePilot();
    const touch = pilot.touch();
    touch.swing(-1, 0);
    pilot.sampleFrame(DT, false);
    const left = pilot.command.yaw;
    touch.swing(0, 0);
    pilot.sampleFrame(DT, false);
    touch.swing(1, 0);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.yaw - left - 1.8) < 1e-9);
    assert.equal(pilot.device, "touch");
  });

  test("strike: held 150 ms is a jab, held 400 ms is a charge", () => {
    const pilot = makePilot();
    const touch = pilot.touch();
    touch.button("strike", true);
    for (let i = 0; i < 9; i++) pilot.sampleFrame(DT, false);
    touch.button("strike", false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, true);
    for (let i = 0; i < 12; i++) pilot.sampleFrame(DT, false);
    touch.button("strike", true);
    let charged = false;
    for (let i = 0; i < 24; i++) { pilot.sampleFrame(DT, false); charged ||= pilot.intents.charge; }
    assert.equal(charged, true);
    touch.button("strike", false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.charge, false);
  });

  test("guard, grip, stance, and reach land in the same command fields as the gamepad", () => {
    const p1 = pad();
    const viaPad = makePilot([p1]);
    const viaTouch = makePilot();
    const touch = viaTouch.touch();
    // Stick values chosen past the pad deadzone so both devices see the same post-deadzone deflection.
    p1.axes = [0.56, -0.56, 0, 0];
    p1.buttons[PAD.LT] = { pressed: true, value: 1 };
    p1.buttons[PAD.RB] = { pressed: true, value: 1 };
    const post = (0.56 * Math.SQRT2 - 0.12) / 0.88;   // radial deadzone on the combined left stick
    touch.stance(post / Math.SQRT2);
    touch.reach(post / Math.SQRT2);
    touch.button("guard", true);
    touch.button("grip", true);
    for (let i = 0; i < 30; i++) { viaPad.sampleFrame(DT, false); viaTouch.sampleFrame(DT, false); }
    for (const k of ["yaw", "elev", "reach", "tool", "roll", "grip"]) {
      assert.ok(Math.abs(viaPad.command[k] - viaTouch.command[k]) < 1e-9, `${k}: pad ${viaPad.command[k]} touch ${viaTouch.command[k]}`);
    }
    assert.deepEqual({ ...viaPad.intents }, { ...viaTouch.intents });
    assert.equal(viaTouch.intents.guard, true);
    assert.equal(viaTouch.intents.grip, true);
  });

  test("multi-touch: stick, guard, and strike held together; release() clears every held intent", () => {
    const pilot = makePilot();
    const touch = pilot.touch();
    touch.swing(0.5, 0.2);
    touch.button("guard", true);
    touch.button("strike", true);
    touch.button("overdrive", true);
    for (let i = 0; i < 3; i++) pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.guard, true);
    assert.equal(pilot.intents.overdrive, true);
    const swung = pilot.command.yaw;
    touch.release();
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.guard, false);
    assert.equal(pilot.intents.overdrive, false);
    assert.equal(pilot.intents.charge, false);
    assert.ok(pilot.command.yaw < swung, "the swing stick springs back");
  });

  test("stick geometry: radial deadzone in pixels, upward drag is positive y, the knob never leaves the ring", () => {
    const v = { x: 0, y: 0 };
    assert.equal(stickFromPointer(5, 5, 96, v), 0);
    assert.deepEqual(v, { x: 0, y: 0 });
    stickFromPointer(0, -96, 96, v);
    assert.ok(Math.abs(v.y - 1) < 1e-12 && Math.abs(v.x) < 1e-12);
    stickFromPointer(200, 0, 96, v);
    assert.equal(v.x, 1);
    const half = 96 * (TOUCH_DEADZONE + (1 - TOUCH_DEADZONE) * 0.5);
    stickFromPointer(half, 0, 96, v);
    assert.ok(Math.abs(v.x - 0.5) < 1e-12);
    const k = knobOffset(300, 400, 96, { x: 0, y: 0 });
    assert.ok(Math.abs(Math.hypot(k.x, k.y) - 96) < 1e-9);
  });

  test("show rule: 'on' always, 'off' never, 'auto' only on a coarse pointer; targets are at least 44 px", () => {
    assert.equal(touchControlsEnabled("on", false), true);
    assert.equal(touchControlsEnabled("off", true), false);
    assert.equal(touchControlsEnabled("auto", true), true);
    assert.equal(touchControlsEnabled("auto", false), false);
    assert.equal(MIN_TARGET_PX, 44);
  });
});

/** Drags the swing pad from `from` to `to` over `ms`, sampling at 16 ms, and returns every flick it fired. */
function drag(det, from, to, ms, t0 = 0) {
  const steps = Math.max(1, Math.round(ms / 16));
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const f = det.sample(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, t0 + (ms * i) / steps);
    if (f) out.push(f);
  }
  return out;
}

describe("flick to strike", () => {
  test("a committed flick fires once; the same sweep taken slowly only aims", () => {
    const fast = drag(createFlickDetector(), [-0.8, 0], [0.8, 0], 64);
    assert.equal(fast.length, 1, "a flick is one strike, not a stream");
    assert.ok(fast[0].dirX > 0.99 && Math.abs(fast[0].dirY) < 0.01, "the strike goes the way the thumb went");
    assert.equal(drag(createFlickDetector(), [-0.8, 0], [0.8, 0], 480).length, 0, "aiming is not punching");
  });

  test("a flick is always a jab and never a charge", () => {
    assert.ok(FLICK_DEFAULTS.maxPressMs < 150, "the jab window is 150 ms; a flick has to land inside it");
    for (const ms of [40, 64, 96, 128]) {
      for (const f of drag(createFlickDetector(), [-1, 0], [1, 0], ms)) {
        assert.ok(f.pressMs >= FLICK_DEFAULTS.minPressMs && f.pressMs <= FLICK_DEFAULTS.maxPressMs, `${ms} ms: ${f.pressMs}`);
      }
    }
  });

  test("harder flicks read harder, and the haptic follows", () => {
    const [hard] = drag(createFlickDetector(), [-1, 0], [1, 0], 48);
    const [soft] = drag(createFlickDetector(), [-0.5, 0], [0.5, 0], 112);
    assert.ok(hard.strength > soft.strength, `${hard.strength} vs ${soft.strength}`);
    assert.ok(hard.pressMs > soft.pressMs);
    assert.ok(flickHaptic(hard) > flickHaptic(soft));
    assert.ok(hard.strength <= 1 && soft.strength >= 0);
  });

  test("it re-arms on a slow-down or on lifting the thumb, not on speed alone", () => {
    const det = createFlickDetector();
    assert.equal(drag(det, [-0.9, 0], [0.9, 0], 64, 0).length, 1);
    assert.equal(det.armed, false);
    // Straight into a second sweep with no pause: still one strike, because the thumb never slowed.
    assert.equal(drag(det, [0.9, 0], [-0.9, 0], 64, 64).length, 0);
    det.end();
    assert.equal(det.armed, true);
    assert.equal(drag(det, [-0.9, 0], [0.9, 0], 64, 400).length, 1);
  });

  test("a repeated timestamp is absorbed instead of reading as infinite speed", () => {
    const det = createFlickDetector();
    det.sample(0, 0, 100);
    assert.equal(det.sample(0.9, 0, 100), null);
    assert.equal(det.sample(-0.9, 0, 100), null);
    assert.equal(det.armed, true);
  });

  test("a flick drives the real pilot to a jab, not a charge", () => {
    const pilot = makePilot();
    const touch = pilot.touch();
    const [f] = drag(createFlickDetector(), [-1, 0], [1, 0], 64);
    touch.button("strike", true);
    for (let i = 0; i < Math.round(f.pressMs / (1000 * DT)); i++) pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.charge, false, "a flick never charges");
    touch.button("strike", false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, true);
  });
});
