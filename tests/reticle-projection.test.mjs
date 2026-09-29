// WP6 acceptance 2: the reticle bracket sits on the projected ghost tip with 0 px error, on the same frame.
// The overlay's projection (camera-math.ts) must agree with three's PerspectiveCamera projection exactly.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { RENDER_SCALE } from "../src/game/contracts.ts";
import {
  COCKPIT_TARGET_EGO, cameraMath, createCameraPose, egoToSim, createScreenPoint, perspectiveMatrix, projectSimToScreen, projectToScreen, viewMatrixFromPose,
} from "../src/game/render/camera-math.ts";

function threeCamera(pose, aspect) {
  const cam = new PerspectiveCamera(pose.fovDeg, aspect, 0.004, 40);
  cam.position.set(...pose.position);
  cam.quaternion.copy(new Quaternion(...pose.quaternion));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

describe("reticle projection", () => {
  const W = 1920, H = 1080;

  test("matches three's Vector3.project to sub-micro-pixel precision for every camera mode", () => {
    for (const mode of ["cockpit", "broadcast", "lobby", "replay", "outro"]) {
      const pose = cameraMath[mode]("atlas", createCameraPose(), { timeMs: 800, progress01: 0.3 });
      const cam = threeCamera(pose, W / H);
      const sp = createScreenPoint();
      let max = 0;
      for (let i = 0; i < 200; i++) {
        const sim = [-0.1 + (i % 10) * 0.03, -0.1 + ((i * 7) % 10) * 0.02, 0.05 + ((i * 3) % 10) * 0.02];
        projectSimToScreen(sim, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, W, H, sp);
        const v = new Vector3(sim[0] * RENDER_SCALE, sim[2] * RENDER_SCALE, -sim[1] * RENDER_SCALE).project(cam);
        if (v.z < -1 || v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * W, y = (1 - (v.y * 0.5 + 0.5)) * H;
        max = Math.max(max, Math.hypot(x - sp.x, y - sp.y));
      }
      assert.ok(max < 1e-6, `${mode}: ${max} px`);
    }
  });

  test("pose-built matrices equal the camera's own", () => {
    const pose = cameraMath.cockpit("blaze", createCameraPose());
    const cam = threeCamera(pose, W / H);
    const view = viewMatrixFromPose(pose, new Float64Array(16));
    const proj = perspectiveMatrix(pose.fovDeg, W / H, 0.004, 40, new Float64Array(16));
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(view[i] - cam.matrixWorldInverse.elements[i]) < 1e-12, `view ${i}`);
      assert.ok(Math.abs(proj[i] - cam.projectionMatrix.elements[i]) < 1e-9, `proj ${i}`);
    }
  });

  test("the cockpit look target lands at the screen centre", () => {
    const pose = cameraMath.cockpit("atlas", createCameraPose());
    const view = viewMatrixFromPose(pose, new Float64Array(16));
    const proj = perspectiveMatrix(pose.fovDeg, W / H, 0.004, 40, new Float64Array(16));
    const sp = createScreenPoint();
    projectSimToScreen(egoToSim("atlas", ...COCKPIT_TARGET_EGO, new Float64Array(3)), view, proj, W, H, sp);
    assert.ok(Math.abs(sp.x - W / 2) < 1e-6 && Math.abs(sp.y - H / 2) < 1e-6, `${sp.x}, ${sp.y}`);
    assert.equal(sp.visible, true);
  });

  test("points behind the camera are reported invisible", () => {
    const pose = cameraMath.cockpit("atlas", createCameraPose());
    const view = viewMatrixFromPose(pose, new Float64Array(16));
    const proj = perspectiveMatrix(pose.fovDeg, W / H, 0.004, 40, new Float64Array(16));
    const sp = createScreenPoint();
    projectToScreen(pose.position[0] - 5, pose.position[1], pose.position[2], view, proj, W, H, sp);
    assert.equal(sp.visible, false);
  });
});

