// WP3 cockpit camera (EMOTION_BIBLE 3.5, section 6 Command row): the eye is fixed, flick exchanges barely turn the
// view, held stance does, the command roll follows pan acceleration under a hard 3° clamp, juice and KO focus
// compose on top, and the boot ritual opens the eyes once.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RENDER_SCALE } from "../src/game/contracts.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createJuiceOutput } from "../src/game/core/hud-frame.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPilot } from "../src/game/input/pilot-controller.ts";
import { createCockpitRigWith, COCKPIT_TARGET_EGO } from "../src/game/camera/cockpit-rig.ts";
import { COCKPIT_EYE_EGO } from "../src/game/camera/juice.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const DEG = 180 / Math.PI;

/** Rotates (0, 0, -1) by an xyzw quaternion: the camera's forward in render space. */
function forward(q) {
  const [x, y, z, w] = q;
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}
function rightVec(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
}
const yawOf = (q) => { const f = forward(q); return Math.atan2(-f[0], -f[2]); };      // render: -z is ego +x for atlas
const rollOf = (q) => { const r = rightVec(q); return Math.asin(Math.max(-1, Math.min(1, r[1]))); };

function setup(opts = {}) {
  let nowMs = 0;
  const rig = createCockpitRigWith({ now: () => nowMs });
  const settings = createSettingsStore({ storage: null });
  if (opts.cockpit) settings.set({ camera: { cockpit: opts.cockpit } });
  if (opts.motion !== undefined) settings.set({ camera: { motion01: opts.motion } });
  const pilot = createPilot({ kinematics: createKinematics(), settings, clock: createGameClock(), profileMatchesPlayed: () => 10 }, { getPads: () => [] });
  pilot.setRules({ jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: true });
  pilot.setMode("fight");
  const frame = fakeFrame();
  pilot.writeCommand(frame, fakeCombat(), new Float64Array(6));
  const juice = createJuiceOutput();
  const pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fovDeg: 0 };
  const step = (dtS) => { nowMs += dtS * 1000; pilot.sampleFrame(dtS, false); return rig.compute("atlas", pilot, juice, frame, settings.get(), pose); };
  return { rig, settings, pilot, frame, juice, pose, step };
}

describe("cockpit rig", () => {
  test("the eye sits at ego (-0.10, +0.16, 0.36) in render space and looks just in front of the opponent base", () => {
    const { pose, step, settings } = setup();
    step(1 / 60);
    const ex = -0.32 + COCKPIT_EYE_EGO[0], ey = COCKPIT_EYE_EGO[1], ez = COCKPIT_EYE_EGO[2];
    assert.deepEqual(pose.position.map((v) => Math.round(v * 1e9) / 1e9), [ex * RENDER_SCALE, ez * RENDER_SCALE, -ey * RENDER_SCALE].map((v) => Math.round(v * 1e9) / 1e9));
    const f = forward(pose.quaternion);
    const tx = COCKPIT_TARGET_EGO[0] - COCKPIT_EYE_EGO[0], ty = COCKPIT_TARGET_EGO[1] - COCKPIT_EYE_EGO[1], tz = COCKPIT_TARGET_EGO[2] - COCKPIT_EYE_EGO[2];
    const n = Math.hypot(tx, ty, tz);
    const want = [tx / n, tz / n, -ty / n];
    assert.ok(Math.hypot(f[0] - want[0], f[1] - want[1], f[2] - want[2]) < 0.02, `forward ${f} want ${want}`);
    assert.deepEqual([...COCKPIT_EYE_EGO], [-0.1, 0.16, 0.36]);
    assert.deepEqual([...COCKPIT_TARGET_EGO], [0.52, -0.03, 0.15]);
    assert.equal(pose.fovDeg, settings.get().camera.fovDeg);
  });

  test("a 1.4 rad flick exchange at 6 Hz moves camera yaw < 2 degrees peak to peak (Standard); position constant", () => {
    const { pose, pilot, step } = setup();
    const input = pilot.synthetic();
    const counts = 1.4 / 0.0015;
    const dt = 1 / 120;
    let dir = 1;
    let since = 0;
    input.move(-counts / 2, 0);
    let minYaw = Infinity, maxYaw = -Infinity;
    const pos0 = [...step(dt).position];
    for (let i = 0; i < 120 * 4; i++) {
      since += dt;
      if (since >= 1 / 12 - 1e-9) { input.move(dir * counts, 0); dir = -dir; since = 0; }
      step(dt);
      assert.deepEqual(pose.position, pos0);
      if (i > 120) { const y = yawOf(pose.quaternion); minYaw = Math.min(minYaw, y); maxYaw = Math.max(maxYaw, y); }
    }
    assert.ok((maxYaw - minYaw) * DEG < 2, `peak to peak ${(maxYaw - minYaw) * DEG} deg`);
    assert.ok((maxYaw - minYaw) * DEG > 0.1, "the stance still breathes a little");
  });

  test("a held aim turns the view through the stance: tanh-limited to 24 degrees, less in Stable", () => {
    const standard = setup();
    const stable = setup({ cockpit: "stable" });
    for (const s of [standard, stable]) { s.pilot.synthetic().move(1.2 / 0.0015, 0); for (let i = 0; i < 120; i++) s.step(1 / 60); }
    const base = setup();
    base.step(1 / 60);
    const y0 = yawOf(base.pose.quaternion);
    const dStd = (y0 - yawOf(standard.pose.quaternion)) * DEG;
    const dStb = (y0 - yawOf(stable.pose.quaternion)) * DEG;
    assert.ok(dStd > 10 && dStd < 24, `standard look ${dStd}`);
    assert.ok(dStb > 3 && dStb < dStd, `stable look ${dStb}`);
  });

  test("command roll: from pan acceleration, never past 3 degrees, 12 Hz filtered, and off at 0% camera motion", () => {
    const { pose, frame, step, rig } = setup({ motion: 1 });
    let maxRoll = 0;
    let sawRoll = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 30; i++) {
      const t = i * dt;
      const phase = (t * 3) % 1;
      frame.arms.atlas.qd[0] = phase < 0.15 ? (Math.floor(t * 3) % 2 ? 9 : -9) : 0;
      frame.arms.atlas.qd[1] = phase < 0.1 ? 4 : 0;
      if (i === 900) frame.arms.atlas.qd[0] = 400;          // a single contact spike
      step(dt);
      const roll = rig.sway.roll;
      maxRoll = Math.max(maxRoll, Math.abs(roll));
      sawRoll = Math.max(sawRoll, Math.abs(roll));
      assert.ok(Math.abs(rollOf(pose.quaternion)) * DEG <= 3 + 1e-6, "3.5: total roll is clamped to ±3°");
    }
    assert.ok(maxRoll * DEG <= 3 + 1e-9, `max roll ${maxRoll * DEG}`);
    assert.ok(sawRoll * DEG > 0.5, "a hook's acceleration does roll the view (section 6 Command row)");
    // A steady pan speed is no acceleration: the roll settles back to zero (never idles, never bobs).
    frame.arms.atlas.qd[0] = 9; frame.arms.atlas.qd[1] = 0;
    for (let i = 0; i < 60; i++) step(dt);
    assert.ok(Math.abs(rig.sway.roll) * DEG < 0.01, `steady speed leaves ${rig.sway.roll * DEG}°`);
    const still = setup({ motion: 0 });
    for (let i = 0; i < 60; i++) { still.frame.arms.atlas.qd[0] = i % 2 ? 9 : -9; still.step(dt); }
    assert.equal(Math.abs(still.rig.sway.roll), 0);
  });

  test("boot ritual: the eyes open, pitch −12° → 0 over the last 400 ms; outside the ritual nothing is added", () => {
    const { pose, pilot, step } = setup();
    step(1 / 60);
    const q0 = [...pose.quaternion];
    const f0 = forward(q0);
    pilot.setMode("frozen");
    pilot.setRitual(0, 1800);
    step(1 / 60);
    const f1 = forward(pose.quaternion);
    assert.ok(f1[1] < f0[1] - Math.sin(11 / DEG), "eyes shut: the view pitches down about 12°");
    pilot.setRitual(1800, 1800);
    step(1 / 60);
    assert.ok(Math.abs(forward(pose.quaternion)[1] - f0[1]) < 1e-6, "eyes open at the slam to LOWERED");
    pilot.setRitual(null);
    assert.equal(pilot.eyesOpen, 1);
  });

  test("juice composes on top: yaw, pitch, roll offsets and FOV punch", () => {
    const { pose, juice, step, settings } = setup();
    step(1 / 60);
    const y0 = yawOf(pose.quaternion);
    juice.yaw = 2 / DEG;
    juice.fovOffsetDeg = -3;
    step(1 / 60);
    assert.ok(Math.abs((y0 - yawOf(pose.quaternion)) * DEG - 2) < 0.1, "yaw + turns right");
    assert.equal(pose.fovDeg, settings.get().camera.fovDeg - 3);
  });

  test("KO focus leans toward the loser's gripper by at most 4 degrees", () => {
    const { pose, juice, frame, step } = setup();
    step(1 / 60);
    const y0 = yawOf(pose.quaternion);
    frame.arms.blaze.eePos.set([0.3, -0.4, 0.1]);          // far right of the view
    juice.koFocus.seat = "blaze";
    juice.koFocus.weight = 1;
    step(1 / 60);
    const d = (y0 - yawOf(pose.quaternion)) * DEG;
    assert.ok(d > 3.9 && d <= 4.05, `ko focus ${d}`);
  });
});
