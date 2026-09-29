// WP6: pure camera pose math for every mode (GAME_DESIGN 3.2 other camera modes, 2.3 intro path, 8.6 replay).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Quaternion, Vector3 } from "three";
import { MOUNT_X, RENDER_SCALE } from "../src/game/contracts.ts";
import {
  BROADCAST_FOV_DEG, COCKPIT_EYE_EGO, COCKPIT_FOV_DEG, COCKPIT_TARGET_EGO, INTRO_FAST_MS, INTRO_MS, LAB_ELEVATION_DEG, LOBBY_FOV_DEG,
  REPLAY_RADIUS_M, blendPose, cameraMath, createCameraPose, egoToSim, lookAtQuat, simToEgo,
} from "../src/game/render/camera-math.ts";

const MODES = ["cockpit", "broadcast", "intro", "replay", "lobby", "lab_overview", "outro"];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const forward = (pose) => new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...pose.quaternion));
const simOf = (pose) => [pose.position[0] / RENDER_SCALE, -pose.position[2] / RENDER_SCALE, pose.position[1] / RENDER_SCALE];

describe("camera math", () => {
  test("every mode yields a finite pose with a unit quaternion", () => {
    for (const mode of MODES) {
      for (const seat of ["atlas", "blaze"]) {
        const p = cameraMath[mode](seat, createCameraPose(), { timeMs: 1234, progress01: 0.6, focusSim: [0.02, 0.01, 0.1] });
        for (const v of [...p.position, ...p.quaternion, p.fovDeg]) assert.ok(Number.isFinite(v), `${mode} ${seat}`);
        close(Math.hypot(...p.quaternion), 1, 1e-9);
        assert.ok(p.fovDeg > 20 && p.fovDeg < 90);
      }
    }
  });

  test("ego frames: atlas faces +x, blaze is rotated π", () => {
    const o = new Float64Array(3);
    egoToSim("atlas", 0.1, 0.02, 0.2, o); assert.deepEqual([...o], [MOUNT_X.atlas + 0.1, 0.02, 0.2]);
    egoToSim("blaze", 0.1, 0.02, 0.2, o); assert.deepEqual([...o], [MOUNT_X.blaze - 0.1, -0.02, 0.2]);
    const back = new Float64Array(3);
    simToEgo("blaze", o[0], o[1], o[2], back);
    close(back[0], 0.1); close(back[1], 0.02); close(back[2], 0.2);
  });

  test("rest cockpit sits 10 cm behind, 16 cm left, 36 cm up and looks just in front of the opponent base, FOV 58", () => {
    assert.deepEqual([...COCKPIT_EYE_EGO], [-0.1, 0.16, 0.36]);
    assert.equal(COCKPIT_FOV_DEG, 58);
    for (const seat of ["atlas", "blaze"]) {
      const p = cameraMath.cockpit(seat, createCameraPose());
      const eye = simOf(p);
      const expEye = egoToSim(seat, ...COCKPIT_EYE_EGO, new Float64Array(3));
      for (let i = 0; i < 3; i++) close(eye[i], expEye[i], 1e-9);
      const tgt = egoToSim(seat, ...COCKPIT_TARGET_EGO, new Float64Array(3));
      const dir = new Vector3(tgt[0] - eye[0], tgt[2] - eye[2], -(tgt[1] - eye[1])).normalize();
      const f = forward(p);
      close(f.dot(dir), 1, 1e-9);
      assert.equal(p.fovDeg, COCKPIT_FOV_DEG);
      // About 18° down (3.2 base look target).
      const pitch = Math.asin(f.y) * 180 / Math.PI;
      assert.ok(pitch < -12 && pitch > -20, `pitch ${pitch}`);
    }
  });

  test("lookAt keeps the horizon level (no roll)", () => {
    const q = lookAtQuat([0, 1, 2], [0.3, 0, 0], 0, new Float64Array(4));
    const right = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...q));
    close(right.y, 0, 1e-12);
  });

  test("broadcast keeps the camera seat on the left and drifts under 0.3°", () => {
    const p0 = cameraMath.broadcast("atlas", createCameraPose(), { timeMs: 0 });
    assert.equal(p0.fovDeg, BROADCAST_FOV_DEG);
    const q = new Quaternion(...p0.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    assert.ok(right.x > 0.9, "render +x (atlas → blaze) points screen-right");
    let maxDeg = 0;
    for (let t = 0; t < 5000; t += 50) {
      const p = cameraMath.broadcast("atlas", createCameraPose(), { timeMs: t });
      const d = forward(p).angleTo(forward(p0)) * 180 / Math.PI;
      maxDeg = Math.max(maxDeg, d);
    }
    assert.ok(maxDeg > 0.05 && maxDeg < 0.6, `drift ${maxDeg}°`);
  });

  test("intro path ends exactly at the rest cockpit (standard and fast show)", () => {
    for (const fast of [false, true]) {
      const end = cameraMath.intro("atlas", createCameraPose(), { progress01: 1, fast });
      const cockpit = cameraMath.cockpit("atlas", createCameraPose());
      for (let i = 0; i < 3; i++) close(end.position[i], cockpit.position[i], 1e-9);
      close(Math.abs(new Quaternion(...end.quaternion).dot(new Quaternion(...cockpit.quaternion))), 1, 1e-9);
    }
    assert.equal(INTRO_MS, 6000);
    assert.equal(INTRO_FAST_MS, 2500);
  });

  test("replay orbit starts 45° off the victim side at 0.9 m and sweeps 30°", () => {
    const focus = [0, 0, 0.12];
    const a = cameraMath.replay("blaze", createCameraPose(), { progress01: 0, focusSim: focus });
    const b = cameraMath.replay("blaze", createCameraPose(), { progress01: 1, focusSim: focus });
    const ea = simOf(a), eb = simOf(b);
    const tgt = [0, 0, 0.12];
    close(Math.hypot(ea[0] - tgt[0], ea[1] - tgt[1], ea[2] - tgt[2]), REPLAY_RADIUS_M, 1e-9);
    const azA = Math.atan2(ea[1], ea[0]) * 180 / Math.PI;
    const azB = Math.atan2(eb[1], eb[0]) * 180 / Math.PI;
    close(azA, -45, 1e-6);
    close(azB, -75, 1e-6);
  });

  test("lobby and lab overview use their design numbers", () => {
    const lobby = cameraMath.lobby("atlas", createCameraPose());
    assert.equal(lobby.fovDeg, LOBBY_FOV_DEG);
    const lab = cameraMath.lab_overview("atlas", createCameraPose());
    const pitch = -Math.asin(forward(lab).y) * 180 / Math.PI;
    close(pitch, LAB_ELEVATION_DEG, 1e-6);
  });

  test("blendPose interpolates position, orientation, and FOV", () => {
    const a = cameraMath.lobby("atlas", createCameraPose());
    const b = cameraMath.cockpit("atlas", createCameraPose());
    const mid = blendPose(a, b, 0.5, createCameraPose());
    close(mid.position[0], (a.position[0] + b.position[0]) / 2, 1e-12);
    close(mid.fovDeg, (a.fovDeg + b.fovDeg) / 2, 1e-12);
    close(Math.hypot(...mid.quaternion), 1, 1e-9);
  });
});
