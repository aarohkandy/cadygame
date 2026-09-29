// WP6 acceptance 1: α = 0.5 gives the exact lerp/slerp between the last two physics steps, and the
// sim ↔ render mapping matches the world root (render = sim (x·s, z·s, −y·s)).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Quaternion, Vector3, Matrix4 } from "three";
import { RENDER_SCALE } from "../src/game/contracts.ts";
import {
  createPointHistory, hasBody, interpolateBody, lerp3, renderToSimPos, rotateVecXyzw, samplePointHistory, simToRenderPos,
  simToRenderQuat, slerpWxyz, SIM_TO_RENDER_QUAT,
} from "../src/game/render/interpolate.ts";
import { fakeFrame } from "../src/game/testing/fakes.ts";
import { HOUSE_DOWN_LEVEL, KO_FLASH_MS, SLAM_MS, createStageCues } from "../src/game/render/vfx/stage-cues.ts";
import { acesToneMapGrey, CALIBRATION, calibratedGreyLinear, keyCosUpward, predictDisplayValue, srgbEncode } from "../src/game/render/quality.ts";

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

describe("render interpolation", () => {
  test("α = 0.5 is the exact midpoint lerp", () => {
    const out = new Float64Array(3);
    lerp3([0.1, -0.2, 0.3], 0, [0.3, 0.2, 0.1], 0, 0.5, out);
    close(out[0], 0.2); close(out[1], 0); close(out[2], 0.2);
  });

  test("α = 0.5 slerp matches three's Quaternion.slerp and the half-angle rotation", () => {
    const a = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2);
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.4);
    const out = new Float64Array(4);
    slerpWxyz([a.w, a.x, a.y, a.z], 0, [b.w, b.x, b.y, b.z], 0, 0.5, out);
    const ref = a.clone().slerp(b, 0.5);
    close(out[0], ref.w, 1e-12); close(out[1], ref.x, 1e-12); close(out[2], ref.y, 1e-12); close(out[3], ref.z, 1e-12);
    const half = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.8);
    close(out[0], half.w, 1e-12); close(out[3], half.z, 1e-12);
  });

  test("slerp takes the shortest path and returns the endpoints exactly", () => {
    const out = new Float64Array(4);
    // q and −q are the same rotation: the midpoint must stay at identity rather than swing 180°.
    slerpWxyz([1, 0, 0, 0], 0, [-1, 0, 0, 0], 0, 0.5, out);
    close(Math.abs(out[0]), 1);
    slerpWxyz([0.6, 0.8, 0, 0], 0, [1, 0, 0, 0], 0, 0, out);
    assert.deepEqual([...out], [0.6, 0.8, 0, 0]);
    slerpWxyz([0.6, 0.8, 0, 0], 0, [1, 0, 0, 0], 0, 1, out);
    assert.deepEqual([...out], [1, 0, 0, 0]);
  });

  test("interpolateBody reads prev/curr body buffers at α", () => {
    const frame = fakeFrame();
    const id = 3;
    frame.bodyPosPrev.set([0, 0, 0], id * 3);
    frame.bodyPosCurr.set([0.02, -0.04, 0.1], id * 3);
    const qa = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.1);
    const qb = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
    frame.bodyQuatPrev.set([qa.w, qa.x, qa.y, qa.z], id * 4);
    frame.bodyQuatCurr.set([qb.w, qb.x, qb.y, qb.z], id * 4);
    const pos = new Float64Array(3), quat = new Float64Array(4), scratch = new Float64Array(4);
    assert.ok(hasBody(frame, id));
    assert.ok(!hasBody(frame, 0), "world body 0 is never an arm link");
    interpolateBody(frame, id, 0.5, pos, quat, scratch);
    close(pos[0], 0.01); close(pos[1], -0.02); close(pos[2], 0.05);
    const ref = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
    close(quat[0], ref.x, 1e-12); close(quat[3], ref.w, 1e-12);
  });

  test("sim → render position and orientation match the world root group transform", () => {
    const root = new Matrix4().compose(new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), new Vector3(RENDER_SCALE, RENDER_SCALE, RENDER_SCALE));
    const p = new Vector3(0.12, -0.34, 0.056).applyMatrix4(root);
    const out = new Float64Array(3);
    simToRenderPos(0.12, -0.34, 0.056, out);
    close(out[0], p.x, 1e-12); close(out[1], p.y, 1e-12); close(out[2], p.z, 1e-12);
    const back = new Float64Array(3);
    renderToSimPos(out[0], out[1], out[2], back);
    close(back[0], 0.12, 1e-12); close(back[1], -0.34, 1e-12); close(back[2], 0.056, 1e-12);
    const qSim = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    const q = new Float64Array(4);
    simToRenderQuat([qSim.w, qSim.x, qSim.y, qSim.z], 0, q);
    const ref = new Quaternion(...SIM_TO_RENDER_QUAT).multiply(qSim);
    close(q[0], ref.x, 1e-12); close(q[1], ref.y, 1e-12); close(q[2], ref.z, 1e-12); close(q[3], ref.w, 1e-12);
    const v = rotateVecXyzw([qSim.x, qSim.y, qSim.z, qSim.w], 0, [1, 0, 0], 0, new Float64Array(3));
    const vr = new Vector3(1, 0, 0).applyQuaternion(qSim);
    close(v[0], vr.x, 1e-12); close(v[1], vr.y, 1e-12);
  });

  test("point history interpolates across steps and snaps after a teleport", () => {
    const h = createPointHistory();
    const out = new Float64Array(3);
    samplePointHistory(h, [0, 0, 0], 0, 10, 0.5, out);
    samplePointHistory(h, [0.1, 0, 0], 0, 11, 0.5, out);
    close(out[0], 0.05);
    samplePointHistory(h, [1, 0, 0], 0, 50, 0.5, out);
    close(out[0], 1, 1e-12);
  });
});

describe("prime-time house lights", () => {
  const phase = (p, t) => ({ type: "phase", phase: p, round: 1, finalRound: false, t, step: 0 });

  test("the house is down through the intro, slams past full at ENGAGE, then settles at full", () => {
    const cues = createStageCues();
    assert.equal(cues.houseLevel(0), 1, "idle house is up");
    cues.handle(phase("round_intro", 0), "atlas", 100);
    assert.equal(cues.houseLevel(200), HOUSE_DOWN_LEVEL);
    cues.handle(phase("fight", 1), "atlas", 1000);
    assert.ok(cues.houseLevel(1010) > 1.5, "slam overdrives the house");
    assert.equal(cues.houseLevel(1000 + SLAM_MS), 1);
  });

  test("a KO fires one white flash that decays to nothing", () => {
    const cues = createStageCues();
    assert.equal(cues.koFlash(0), 0);
    cues.handle({ type: "ko", victim: "blaze", attacker: "atlas", pos: [0, 0, 0], t: 1, step: 0 }, "atlas", 500);
    assert.equal(cues.koFlash(500), 1);
    assert.ok(cues.koFlash(600) < 1 && cues.koFlash(600) > 0);
    assert.equal(cues.koFlash(500 + KO_FLASH_MS), 0);
  });

  test("ACES grey curve: black stays black, mid grey lands near 0.18, highlights roll off below 1", () => {
    assert.ok(acesToneMapGrey(0) <= 0);
    close(acesToneMapGrey(0.158), 0.18, 0.005);
    assert.ok(acesToneMapGrey(4) < 1 && acesToneMapGrey(4) > 0.9);
  });

  test("the 5.3 calibration triple: an 18 % card under the 48° key predicts 0.35, inside the 0.34 ± 0.03 grey-card gate", () => {
    assert.equal(CALIBRATION.exposure, 0.7);
    assert.equal(CALIBRATION.key.intensity, 3.2);
    assert.equal(CALIBRATION.key.elevationDeg, 48);
    assert.equal(CALIBRATION.hemisphere.intensity, 0.12);
    assert.equal(CALIBRATION.environmentIntensity * CALIBRATION.environmentIrradianceEstimate, 0.7 * 0.1);
    close(keyCosUpward(), Math.sin((48 * Math.PI) / 180), 1e-12);
    const predicted = predictDisplayValue(0.18, keyCosUpward());
    close(predicted, 0.35, 0.005);
    assert.ok(Math.abs(predicted - CALIBRATION.greycard.target) <= CALIBRATION.greycard.tolerance, `predicted ${predicted} vs ${CALIBRATION.greycard.target}`);
    // The grade's S-curve pivots on the card's tone-mapped value, so the card is a fixed point of the grade.
    const pivot = Math.sqrt(calibratedGreyLinear());
    const graded = ((Math.sqrt(calibratedGreyLinear()) - pivot) * CALIBRATION.grade.contrast + pivot) ** 2;
    close(srgbEncode(graded), predicted, 1e-12);
    // Bowl blacks stay under 0.03 display and the bloom threshold sits under the rim's silhouette value (≈ 1.0 linear).
    assert.ok(predictDisplayValue(0.02, 0) < 0.03);
    assert.ok(CALIBRATION.bloom.threshold < 1.0 && CALIBRATION.bloom.threshold > 0.6);
  });
});
