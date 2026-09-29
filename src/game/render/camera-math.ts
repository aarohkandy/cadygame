// src/game/render/camera-math.ts (WP6)
// Pure pose math for every camera mode (GAME_DESIGN 3.2 "Other camera modes", 2.3 intro path, 8.3/8.6),
// plus the world → screen projection shared by the reticle overlay and the ?debug=feel pixel check.
// Every function writes into a caller-owned CameraPose in **render space** (three.js world, Y up) and
// allocates nothing. camera-director.tsx picks the mode each frame and blends between modes.
import {
  MOUNT_X, RENDER_SCALE,
  type CameraMode, type CameraPose, type Seat, type Vec3,
} from "../contracts.ts";
import { clamp01, easeInOutCubic, lerp, simToRenderPos, slerpWxyz, type NumArray } from "./interpolate.ts";

/** Time and focus inputs for the animated modes. Every field is optional; defaults give the rest pose. */
export interface CameraMathParams {
  /** Wall ms since the mode started (broadcast drift, outro orbit). */
  timeMs?: number;
  /** 0..1 progress through the scripted path (intro, replay clip). */
  progress01?: number;
  /** Fast show intro (2.3 rows marked F only, retimed ×0.4). */
  fast?: boolean;
  /** Sim-space focus point (replay event position). */
  focusSim?: Vec3 | null;
}
export type CameraPoseFn = (seat: Seat, out: CameraPose, params?: CameraMathParams) => CameraPose;

/* ───────────────────────── constants (GAME_DESIGN 3.2) ───────────────────────── */

/** Eye: 10 cm behind the base, 16 cm left (ego +y), 36 cm up. From up-and-left the arm plane projects into the
 *  lower-right quadrant, so the own arm reads as an FPS viewmodel and the opponent sits unoccluded near centre. */
export const COCKPIT_EYE_EGO: Vec3 = [-0.1, 0.16, 0.36];
/** About 12 cm in front of the opponent base at gripper height (about 18 degrees down). */
export const COCKPIT_TARGET_EGO: Vec3 = [0.52, -0.03, 0.15];
/** EMOTION_BIBLE 3.5: 58 degrees, eye and target unchanged. Juice may punch it by at most 6 degrees. */
export const COCKPIT_FOV_DEG = 58;
/** Near plane 0.02 render units = 1 cm (EMOTION_BIBLE 3.1): the own forearm crossing the lens screen-doors only
 *  in the last centimetre (robot-view's OWN_ARM_DITHER_BAND) instead of a translucent band. */
export const COCKPIT_NEAR = 0.02;
export const CAMERA_FAR = 40;
/**
 * Broadcast phone camera. GAME_DESIGN gives (0, 0.95, 0.42) sim; we place it on the side that puts the
 * camera seat on screen left (y = −0.95 for atlas), so the cobalt pilot sits left like the intro's cobalt
 * panel. Mirrored for blaze.
 */
export const BROADCAST_EYE_SIM: Vec3 = [0, -0.95, 0.42];
export const BROADCAST_TARGET_SIM: Vec3 = [0, 0, 0.10];
export const BROADCAST_FOV_DEG = 38;
export const BROADCAST_DRIFT_DEG = 0.3;
export const BROADCAST_DRIFT_HZ = 0.2;
export const LOBBY_EYE_EGO: Vec3 = [0.55, 0.42, 0.34];
export const LOBBY_TARGET_EGO: Vec3 = [0.05, 0.0, 0.14];
export const LOBBY_FOV_DEG = 46;   // 40 clipped WARM UP and SETTINGS off the left edge of the tile arc
export const LAB_ELEVATION_DEG = 60;
export const LAB_FOV_DEG = 45;
export const LAB_DISTANCE_M = 1.25;
export const REPLAY_RADIUS_M = 0.9;
export const REPLAY_START_OFFSET_DEG = 45;
export const REPLAY_ORBIT_DEG = 30;
export const REPLAY_ELEVATION_DEG = 24;
export const REPLAY_FOV_DEG = 34;
export const OUTRO_FOV_DEG = 36;
export const OUTRO_RADIUS_M = 0.52;
export const OUTRO_ORBIT_DEG = 14;
export const OUTRO_ORBIT_MS = 4500;
/** Intro durations (2.3): standard 6000 ms, fast show retimed ×0.4. */
export const INTRO_MS = 6000;
export const INTRO_FAST_MS = 2500;

/* ───────────────────────── frames ───────────────────────── */

/** Seat ego frame → sim world: atlas faces +x from its mount, blaze is rotated π about Z. */
export function egoToSim(seat: Seat, ex: number, ey: number, ez: number, out: NumArray, oo = 0): NumArray {
  if (seat === "atlas") { out[oo] = MOUNT_X.atlas + ex; out[oo + 1] = ey; }
  else { out[oo] = MOUNT_X.blaze - ex; out[oo + 1] = -ey; }
  out[oo + 2] = ez;
  return out;
}

/** Sim world → seat ego frame (inverse of egoToSim). */
export function simToEgo(seat: Seat, x: number, y: number, z: number, out: NumArray, oo = 0): NumArray {
  if (seat === "atlas") { out[oo] = x - MOUNT_X.atlas; out[oo + 1] = y; }
  else { out[oo] = MOUNT_X.blaze - x; out[oo + 1] = -y; }
  out[oo + 2] = z;
  return out;
}

const eyeS = new Float64Array(3);
const tgtS = new Float64Array(3);
const eyeR = new Float64Array(3);
const tgtR = new Float64Array(3);
const qa = new Float64Array(4);
const qb = new Float64Array(4);

/**
 * Orientation (xyzw) of a camera at `eye` looking at `target` (both render space) with world up +Y and an
 * optional roll about the view axis. Degenerate straight-down views fall back to −Z as the up hint.
 */
export function lookAtQuat(eye: NumArray, target: NumArray, rollRad: number, out: NumArray, oo = 0): NumArray {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let n = Math.hypot(zx, zy, zz) || 1;
  zx /= n; zy /= n; zz /= n;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(zy) > 0.9999) { ux = 0; uy = 0; uz = -1; }
  // x = up × z
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  n = Math.hypot(xx, xy, xz) || 1;
  xx /= n; xy /= n; xz /= n;
  // y = z × x
  let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  if (rollRad !== 0) {
    const c = Math.cos(rollRad), s = Math.sin(rollRad);
    const nxx = xx * c + yx * s, nxy = xy * c + yy * s, nxz = xz * c + yz * s;
    const nyx = yx * c - xx * s, nyy = yy * c - xy * s, nyz = yz * c - xz * s;
    xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz;
  }
  // rotation matrix columns x, y, z → quaternion
  const m00 = xx, m01 = yx, m02 = zx, m10 = xy, m11 = yy, m12 = zy, m20 = xz, m21 = yz, m22 = zz;
  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s; qx = (m21 - m12) * s; qy = (m02 - m20) * s; qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 - m00 + m11 - m22);
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 - m00 - m11 + m22);
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s;
  }
  out[oo] = qx; out[oo + 1] = qy; out[oo + 2] = qz; out[oo + 3] = qw;
  return out;
}

/** Writes a pose from sim-space eye and target. */
export function poseFromSim(eye: NumArray, target: NumArray, fovDeg: number, rollRad: number, out: CameraPose): CameraPose {
  simToRenderPos(eye[0], eye[1], eye[2], eyeR);
  simToRenderPos(target[0], target[1], target[2], tgtR);
  out.position[0] = eyeR[0]; out.position[1] = eyeR[1]; out.position[2] = eyeR[2];
  lookAtQuat(eyeR, tgtR, rollRad, out.quaternion);
  out.fovDeg = fovDeg;
  return out;
}

function poseFromEgo(seat: Seat, eye: Vec3, target: Vec3, fovDeg: number, out: CameraPose): CameraPose {
  egoToSim(seat, eye[0], eye[1], eye[2], eyeS);
  egoToSim(seat, target[0], target[1], target[2], tgtS);
  return poseFromSim(eyeS, tgtS, fovDeg, 0, out);
}

/** Blends two poses (position lerp, orientation slerp, FOV lerp) into out. `out` may alias `a`. */
export function blendPose(a: CameraPose, b: CameraPose, t: number, out: CameraPose): CameraPose {
  const k = clamp01(t);
  out.position[0] = lerp(a.position[0], b.position[0], k);
  out.position[1] = lerp(a.position[1], b.position[1], k);
  out.position[2] = lerp(a.position[2], b.position[2], k);
  qa[0] = a.quaternion[3]; qa[1] = a.quaternion[0]; qa[2] = a.quaternion[1]; qa[3] = a.quaternion[2];
  qb[0] = b.quaternion[3]; qb[1] = b.quaternion[0]; qb[2] = b.quaternion[1]; qb[3] = b.quaternion[2];
  slerpWxyz(qa, 0, qb, 0, k, qa, 0);
  out.quaternion[0] = qa[1]; out.quaternion[1] = qa[2]; out.quaternion[2] = qa[3]; out.quaternion[3] = qa[0];
  out.fovDeg = lerp(a.fovDeg, b.fovDeg, k);
  return out;
}

export function createCameraPose(): CameraPose {
  return { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fovDeg: COCKPIT_FOV_DEG };
}

export function copyPose(src: CameraPose, out: CameraPose): CameraPose {
  out.position[0] = src.position[0]; out.position[1] = src.position[1]; out.position[2] = src.position[2];
  out.quaternion[0] = src.quaternion[0]; out.quaternion[1] = src.quaternion[1];
  out.quaternion[2] = src.quaternion[2]; out.quaternion[3] = src.quaternion[3];
  out.fovDeg = src.fovDeg;
  return out;
}

/* ───────────────────────── modes ───────────────────────── */

/** Rest cockpit pose (no stance, no juice). The live cockpit comes from WP3's CockpitRig. */
const cockpit: CameraPoseFn = (seat, out) => poseFromEgo(seat, COCKPIT_EYE_EGO, COCKPIT_TARGET_EGO, COCKPIT_FOV_DEG, out);

/** Phone on a tripod with a slow handheld drift (0.3° at 0.2 Hz, two incommensurate sines). */
const broadcast: CameraPoseFn = (seat, out, p) => {
  const t = (p?.timeMs ?? 0) / 1000;
  const mirror = seat === "atlas" ? 1 : -1;
  eyeS[0] = BROADCAST_EYE_SIM[0]; eyeS[1] = BROADCAST_EYE_SIM[1] * mirror; eyeS[2] = BROADCAST_EYE_SIM[2];
  const drift = (BROADCAST_DRIFT_DEG * Math.PI) / 180;
  const w = 2 * Math.PI * BROADCAST_DRIFT_HZ;
  const yaw = drift * Math.sin(w * t);
  const pitch = drift * 0.7 * Math.sin(w * 0.73 * t + 1.3);
  const dist = Math.hypot(eyeS[1] - BROADCAST_TARGET_SIM[1], eyeS[2] - BROADCAST_TARGET_SIM[2]);
  tgtS[0] = BROADCAST_TARGET_SIM[0] + Math.tan(yaw) * dist * mirror;
  tgtS[1] = BROADCAST_TARGET_SIM[1];
  tgtS[2] = BROADCAST_TARGET_SIM[2] + Math.tan(pitch) * dist;
  return poseFromSim(eyeS, tgtS, BROADCAST_FOV_DEG, drift * 0.35 * Math.sin(w * 0.51 * t + 0.4), out);
};

const lobby: CameraPoseFn = (seat, out) => poseFromEgo(seat, LOBBY_EYE_EGO, LOBBY_TARGET_EGO, LOBBY_FOV_DEG, out);

const labOverview: CameraPoseFn = (seat, out) => {
  const el = (LAB_ELEVATION_DEG * Math.PI) / 180;
  const mirror = seat === "atlas" ? 1 : -1;
  tgtS[0] = 0; tgtS[1] = 0; tgtS[2] = 0.06;
  eyeS[0] = 0; eyeS[1] = -Math.cos(el) * LAB_DISTANCE_M * mirror; eyeS[2] = tgtS[2] + Math.sin(el) * LAB_DISTANCE_M;
  return poseFromSim(eyeS, tgtS, LAB_FOV_DEG, 0, out);
};

/**
 * Replay orbit (8.6): starts 45° off the victim's side at 0.9 m, orbits 30° across the clip. `seat` is the
 * victim; `focusSim` the deciding moment's position (defaults to the contest centre).
 */
const replay: CameraPoseFn = (seat, out, p) => {
  const f = p?.focusSim;
  tgtS[0] = f ? f[0] * 0.6 : 0; tgtS[1] = f ? f[1] * 0.6 : 0; tgtS[2] = f ? Math.max(0.06, f[2]) : 0.12;
  const side = seat === "atlas" ? Math.PI : 0;              // azimuth pointing out of the victim's end
  const dir = seat === "atlas" ? 1 : -1;                    // rotate toward the front (−y) half
  const k = easeInOutCubic(p?.progress01 ?? 0);
  const az = side + dir * (((REPLAY_START_OFFSET_DEG + REPLAY_ORBIT_DEG * k) * Math.PI) / 180);
  const el = (REPLAY_ELEVATION_DEG * Math.PI) / 180;
  const r = REPLAY_RADIUS_M;
  eyeS[0] = tgtS[0] + Math.cos(az) * Math.cos(el) * r;
  eyeS[1] = tgtS[1] + Math.sin(az) * Math.cos(el) * r;
  eyeS[2] = tgtS[2] + Math.sin(el) * r;
  return poseFromSim(eyeS, tgtS, REPLAY_FOV_DEG, 0, out);
};

/** Winner hero shot: low three-quarter front view of the winner's arm with a slow 14° orbit. */
const outro: CameraPoseFn = (seat, out, p) => {
  const t = clamp01((p?.timeMs ?? 0) / OUTRO_ORBIT_MS);
  const orbit = (OUTRO_ORBIT_DEG * Math.PI) / 180;
  const az = -0.62 + orbit * easeInOutCubic(t);             // ego azimuth, right-front of the arm
  const ex = 0.06 + Math.cos(az) * OUTRO_RADIUS_M;
  const ey = Math.sin(az) * OUTRO_RADIUS_M;
  const eye: Vec3 = [ex, ey, 0.2 - 0.03 * t];
  const target: Vec3 = [0.08, 0, 0.15];
  egoToSim(seat, eye[0], eye[1], eye[2], eyeS);
  egoToSim(seat, target[0], target[1], target[2], tgtS);
  return poseFromSim(eyeS, tgtS, OUTRO_FOV_DEG, 0, out);
};

const introA = createCameraPose();
const introB = createCameraPose();

/**
 * Match intro path (2.3). Standard (6000 ms): 0–3200 the phone wide shot slowly pushing toward the
 * opponent side; 3200–4800 cut to the player side; 4800–6000 ease-in-out push into the cockpit mount.
 * Fast show (2400 ms): wide shot until 1920, then the same push. `seat` is the player seat.
 */
const intro: CameraPoseFn = (seat, out, p) => {
  const fast = p?.fast ?? false;
  const total = fast ? INTRO_FAST_MS : INTRO_MS;
  const ms = clamp01(p?.progress01 ?? 0) * total;
  const pushStart = fast ? 1920 : 4800;
  const opp = seat === "atlas" ? "blaze" : "atlas";
  if (ms >= pushStart) {
    const k = easeInOutCubic((ms - pushStart) / (total - pushStart));
    if (fast) broadcast(seat, introA, { timeMs: ms });
    else playerSide(seat, introA, 1);
    cockpit(seat, introB);
    return blendPose(introA, introB, k, out);
  }
  if (!fast && ms >= 3200) return playerSide(seat, out, (ms - 3200) / 1600);
  if (fast) return broadcast(seat, out, { timeMs: ms });
  // Wide on the opponent: phone shot drifting 35% of the way toward a three-quarter view of the opponent.
  const k = easeInOutCubic(ms / 3200);
  broadcast(seat, introA, { timeMs: ms });
  opponentHero(opp, introB);
  return blendPose(introA, introB, 0.15 + 0.2 * k, out);
};

function opponentHero(opp: Seat, out: CameraPose): CameraPose {
  egoToSim(opp, 0.46, -0.24, 0.24, eyeS);
  egoToSim(opp, 0.02, 0, 0.13, tgtS);
  return poseFromSim(eyeS, tgtS, 40, 0, out);
}

/** Over-the-shoulder view behind the player arm, creeping forward over the segment. */
function playerSide(seat: Seat, out: CameraPose, k01: number): CameraPose {
  const k = easeInOutCubic(k01);
  egoToSim(seat, lerp(-0.34, -0.26, k), lerp(-0.22, -0.16, k), lerp(0.30, 0.28, k), eyeS);
  egoToSim(seat, 0.22, 0, 0.12, tgtS);
  return poseFromSim(eyeS, tgtS, lerp(48, 56, k), 0, out);
}

export const cameraMath: Readonly<Record<CameraMode, CameraPoseFn>> = {
  cockpit, broadcast, intro, replay, lobby, lab_overview: labOverview, outro,
};

/* ───────────────────────── projection ───────────────────────── */

export interface ScreenPoint { x: number; y: number; depth: number; visible: boolean; }
export function createScreenPoint(): ScreenPoint { return { x: 0, y: 0, depth: 0, visible: false }; }

/**
 * Projects a render-space point through column-major view (world → camera) and projection matrices
 * (three's `matrixWorldInverse.elements` and `projectionMatrix.elements`) to CSS pixels with the origin at
 * the top-left. `visible` is false behind the camera or outside the clip volume depth range.
 */
export function projectToScreen(
  x: number, y: number, z: number, view: NumArray, proj: NumArray, widthPx: number, heightPx: number, out: ScreenPoint,
): ScreenPoint {
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
  const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12] * vw;
  const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13] * vw;
  const cz = proj[2] * vx + proj[6] * vy + proj[10] * vz + proj[14] * vw;
  const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15] * vw;
  if (cw <= 1e-9) { out.visible = false; out.x = 0; out.y = 0; out.depth = 1; return out; }
  const nx = cx / cw, ny = cy / cw, nz = cz / cw;
  out.x = (nx * 0.5 + 0.5) * widthPx;
  out.y = (1 - (ny * 0.5 + 0.5)) * heightPx;
  out.depth = nz;
  out.visible = nz >= -1 && nz <= 1;
  return out;
}

/** Projects a **sim-space** point (HudFrame positions) through the camera matrices. */
export function projectSimToScreen(
  p: NumArray, view: NumArray, proj: NumArray, widthPx: number, heightPx: number, out: ScreenPoint,
): ScreenPoint {
  return projectToScreen(p[0] * RENDER_SCALE, p[2] * RENDER_SCALE, -p[1] * RENDER_SCALE, view, proj, widthPx, heightPx, out);
}

/** Column-major view matrix (inverse of the camera world transform) from a CameraPose. */
export function viewMatrixFromPose(pose: CameraPose, out: NumArray): NumArray {
  const [qx, qy, qz, qw] = pose.quaternion;
  // Rotation matrix R of the camera; view = [Rᵀ | −Rᵀ·p]
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
  const [px, py, pz] = pose.position;
  out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
  out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
  out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
  out[12] = -(r00 * px + r10 * py + r20 * pz);
  out[13] = -(r01 * px + r11 * py + r21 * pz);
  out[14] = -(r02 * px + r12 * py + r22 * pz);
  out[15] = 1;
  return out;
}

/** Column-major perspective projection matching three's PerspectiveCamera (vertical FOV, no zoom, no view offset). */
export function perspectiveMatrix(fovDeg: number, aspect: number, near: number, far: number, out: NumArray): NumArray {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  for (let i = 0; i < 16; i++) out[i] = 0;
  out[0] = f / aspect;
  out[5] = f;
  out[10] = -(far + near) / (far - near);
  out[11] = -1;
  out[14] = (-2 * far * near) / (far - near);
  return out;
}
