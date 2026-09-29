// src/game/physics/engine.ts (WP2)
// The MuJoCo duel engine behind the PhysicsEngine contract. One engine owns two compiled models, stock (arena.xml)
// and Arcade (arena-arcade.xml, the same model plus strike hulls), because the lobby runs Arcade physics while a
// Proving Ground or Harness match on the same page runs stock; `reset` switches synchronously.
//
// Hot path rules (GAME_DESIGN 10.3): no allocation per step outside contact onsets, WASM views fetched fresh each step
// and copied with .set(), eq_active is never read or written (4.9).
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import {
  JOINT_LIMITS, SEATS,
  type ArmFrame, type CreatePhysicsEngine, type EngineResetOptions, type LoadoutId, type ModelInfo, type PhysicsEngine,
  type PhysicsFrame, type PhysicsMode, type Seat, type ServoProfile, type SimState, type Vec3,
} from "../contracts.ts";
import { createRng } from "../core/rng.ts";
import { createActiveContacts, createContactScanner, resetActiveContacts, type ContactScanner } from "./contact-scan.ts";
import { compileModel, loadModelFiles, loadMujoco, type ModelFiles } from "./mujoco-loader.ts";
import { ARM_JOINTS, buildModelIndex, CUBE_COUNT, type ModelIndex } from "./model-index.ts";
import {
  baseServoFor, isIdentityProfile, isOfflineProfile, writeBaseServo, writeProfile,
} from "./servo.ts";
import { checksumData, restoreSimState, saveSimState } from "./sim-state.ts";

/** Clutter cubes keep their MJCF spots (±6 mm); the rest park off the table (2.5). */
const CLUTTER_JITTER_M = 0.006;
const START_POSE_JITTER_RAD = 0.02;
const PARK_Z = 0.02;
const CUBE_REST_Z = 0.0205;
const MJCF_CUBE_XY: readonly (readonly [number, number])[] = [
  [-0.04878, 0.05366], [0, 0.05366], [0.04878, 0.05366],
  [-0.04878, 0], [0, 0], [0.04878, 0],
  [-0.04878, -0.05366], [0, -0.05366], [0.04878, -0.05366],
];
const CLUTTER = new Set([0, 2, 6, 8]);

export function parkedCubePos(index: number): Vec3 {
  return [2.0 + 0.1 * index, 0, PARK_Z];
}

interface Compiled {
  mode: PhysicsMode; files: ModelFiles; model: MjModel; data: MjData; index: ModelIndex; scanner: ContactScanner;
}

function armFrame(): ArmFrame {
  return {
    q: new Float64Array(6), qd: new Float64Array(6), qacc: new Float64Array(6),
    tau: new Float64Array(6), ctrl: new Float64Array(6), forceRange: new Float64Array(6),
    eePos: new Float64Array(3), eeVel: new Float64Array(3), eeQuat: Float64Array.of(1, 0, 0, 0),
    elbowPos: new Float64Array(3), wristPos: new Float64Array(3),
    shoulderPos: new Float64Array(3), cameraMountPos: new Float64Array(3),
  };
}

/** Row-major rotation matrix → unit quaternion (wxyz), canonical w ≥ 0. */
function matToQuat(m: Float64Array, o: number, out: Float64Array): void {
  const m00 = m[o], m01 = m[o + 1], m02 = m[o + 2], m10 = m[o + 3], m11 = m[o + 4], m12 = m[o + 5];
  const m20 = m[o + 6], m21 = m[o + 7], m22 = m[o + 8];
  const tr = m00 + m11 + m22;
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 - m00 + m11 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 - m00 - m11 + m22);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(w, x, y, z) * (w < 0 ? -1 : 1);
  out[0] = w / n; out[1] = x / n; out[2] = y / n; out[3] = z / n;
}

function clampJoint(j: number, v: number): number {
  const lim = JOINT_LIMITS[j];
  if (!(v === v)) return (lim[0] + lim[1]) / 2;       // NaN guard: never feed NaN into MuJoCo
  return v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
}

export const createPhysicsEngine: CreatePhysicsEngine = async (opts) => {
  const loaderOpts = { modelBaseUrl: opts.modelBaseUrl, nodeFsRoot: opts.nodeFsRoot, onFile: opts.onFile };
  const [mujoco, stockFiles, arcadeFiles] = await Promise.all([
    loadMujoco(loaderOpts), loadModelFiles("harness", loaderOpts), loadModelFiles("arcade", loaderOpts),
  ]);
  return buildEngine(mujoco, stockFiles, arcadeFiles, opts.mode);
};

function compile(mujoco: MainModule, files: ModelFiles, mode: PhysicsMode): Compiled {
  const model = compileModel(mujoco, files);
  const data = new mujoco.MjData(model);
  const index = buildModelIndex(mujoco, model);
  if (index.nu !== 12) throw new Error(`Arena model ${files.file} has ${index.nu} actuators; the duel needs 12`);
  if (mode === "arcade" && index.hullCount === 0) throw new Error(`${files.file} carries no strike hulls; run npm run gen:arcade-model`);
  const scanner = createContactScanner(mujoco, index);
  return { mode, files, model, data, index, scanner };
}

function buildEngine(mujoco: MainModule, stockFiles: ModelFiles, arcadeFiles: ModelFiles, initialMode: PhysicsMode): PhysicsEngine {
  const compiled: Record<PhysicsMode, Compiled> = {
    harness: compile(mujoco, stockFiles, "harness"),
    arcade: compile(mujoco, arcadeFiles, "arcade"),
  };
  const s = compiled.harness.index, a = compiled.arcade.index;
  if (s.nq !== a.nq || s.nv !== a.nv || s.nbody !== a.nbody) {
    throw new Error("arena-arcade.xml and arena.xml disagree on bodies or dofs; regenerate the Arcade model");
  }
  let cur = compiled[initialMode];
  const version = mujoco.mj_versionString();
  const nbody = s.nbody;

  const info: ModelInfo = {
    mujocoVersion: version, modelFile: cur.files.file, modelSha256: cur.files.sha256, so101Sha256: cur.files.so101Sha256,
    nq: s.nq, nv: s.nv, nu: s.nu, nbody,
    bodyNames: s.bodyNames,
    bodyId: s.bodyId,
    cubeBodyIds: s.cubeBodyIds,
    hullScoring: initialMode === "arcade",
  };

  const frame: PhysicsFrame = {
    mode: initialMode, dt: cur.model.opt.timestep, step: 0, simTime: 0,
    arms: { atlas: armFrame(), blaze: armFrame() },
    cubes: { pos: new Float64Array(CUBE_COUNT * 3), quat: new Float64Array(CUBE_COUNT * 4), linvel: new Float64Array(CUBE_COUNT * 3) },
    docks: new Float64Array(6),
    nbody,
    bodyPosPrev: new Float64Array(nbody * 3), bodyPosCurr: new Float64Array(nbody * 3),
    bodyQuatPrev: new Float64Array(nbody * 4), bodyQuatCurr: new Float64Array(nbody * 4),
    onsets: [],
    active: createActiveContacts(),
  };
  const loadouts: Record<Seat, LoadoutId> = { atlas: "pivot", blaze: "pivot" };
  let disposed = false;

  /** `info` as it will read in `mode`: same model, same body layout, only the file-level facts differ. */
  function infoFor(mode: PhysicsMode): ModelInfo {
    const files = compiled[mode].files;
    return { ...info, modelFile: files.file, modelSha256: files.sha256, so101Sha256: files.so101Sha256, hullScoring: mode === "arcade" };
  }

  function selectMode(mode: PhysicsMode): void {
    cur = compiled[mode];
    frame.mode = mode;
    info.modelFile = cur.files.file;
    info.modelSha256 = cur.files.sha256;
    info.hullScoring = mode === "arcade";
  }

  function fillBodies(pos: Float64Array, quat: Float64Array): void {
    pos.set((cur.data.xpos as Float64Array).subarray(0, nbody * 3));
    quat.set((cur.data.xquat as Float64Array).subarray(0, nbody * 4));
  }

  function fillArms(): void {
    const { data, model, index } = cur;
    const qpos = data.qpos as Float64Array, qvel = data.qvel as Float64Array, qacc = data.qacc as Float64Array;
    const force = data.actuator_force as Float64Array, ctrl = data.ctrl as Float64Array;
    const range = model.actuator_forcerange as Float64Array;
    const siteXpos = data.site_xpos as Float64Array, siteXmat = data.site_xmat as Float64Array;
    const xpos = frame.bodyPosCurr;
    const cvel = data.cvel as Float64Array, com = data.subtree_com as Float64Array;
    for (const seat of SEATS) {
      const arm = frame.arms[seat];
      const qa = index.armQposAdr[seat], da = index.armDofAdr[seat], act = index.actuatorId[seat];
      for (let j = 0; j < ARM_JOINTS; j++) {
        arm.q[j] = qpos[qa[j]];
        arm.qd[j] = qvel[da[j]];
        arm.qacc[j] = qacc[da[j]];
        arm.tau[j] = force[act[j]];
        arm.ctrl[j] = ctrl[act[j]];
        arm.forceRange[j] = range[act[j] * 2 + 1];
      }
      const site = index.gripperSiteId[seat];
      const px = siteXpos[site * 3], py = siteXpos[site * 3 + 1], pz = siteXpos[site * 3 + 2];
      arm.eePos[0] = px; arm.eePos[1] = py; arm.eePos[2] = pz;
      matToQuat(siteXmat, site * 9, arm.eeQuat);
      const body = index.bodyId[seat].gripper;
      const root = index.bodyRootId[body] * 3, o = body * 6;
      const rx = px - com[root], ry = py - com[root + 1], rz = pz - com[root + 2];
      const wx = cvel[o], wy = cvel[o + 1], wz = cvel[o + 2];
      arm.eeVel[0] = cvel[o + 3] + wy * rz - wz * ry;
      arm.eeVel[1] = cvel[o + 4] + wz * rx - wx * rz;
      arm.eeVel[2] = cvel[o + 5] + wx * ry - wy * rx;
      const b = index.bodyId[seat];
      for (let k = 0; k < 3; k++) {
        arm.elbowPos[k] = xpos[b.lower_arm * 3 + k];
        arm.wristPos[k] = xpos[b.gripper * 3 + k];
        arm.shoulderPos[k] = xpos[b.shoulder * 3 + k];
        arm.cameraMountPos[k] = xpos[b.camera_mount * 3 + k];
      }
    }
  }

  function fillCubes(): void {
    const { data, index } = cur;
    const qpos = data.qpos as Float64Array, qvel = data.qvel as Float64Array;
    const c = frame.cubes;
    for (let i = 0; i < CUBE_COUNT; i++) {
      const qa = index.cubeQposAdr[i], da = index.cubeDofAdr[i];
      c.pos[i * 3] = qpos[qa]; c.pos[i * 3 + 1] = qpos[qa + 1]; c.pos[i * 3 + 2] = qpos[qa + 2];
      c.quat[i * 4] = qpos[qa + 3]; c.quat[i * 4 + 1] = qpos[qa + 4]; c.quat[i * 4 + 2] = qpos[qa + 5]; c.quat[i * 4 + 3] = qpos[qa + 6];
      c.linvel[i * 3] = qvel[da]; c.linvel[i * 3 + 1] = qvel[da + 1]; c.linvel[i * 3 + 2] = qvel[da + 2];
    }
  }

  function fillDocks(): void {
    const { data, index } = cur;
    const site = data.site_xpos as Float64Array;
    SEATS.forEach((seat, k) => {
      const id = index.dockSiteId[seat];
      if (id >= 0) for (let i = 0; i < 3; i++) frame.docks[k * 3 + i] = site[id * 3 + i];
    });
  }

  function writeCube(i: number, pos: Vec3): void {
    const { data, index } = cur;
    const qpos = data.qpos as Float64Array, qvel = data.qvel as Float64Array;
    const qa = index.cubeQposAdr[i], da = index.cubeDofAdr[i];
    qpos[qa] = pos[0]; qpos[qa + 1] = pos[1]; qpos[qa + 2] = pos[2];
    qpos[qa + 3] = 1; qpos[qa + 4] = 0; qpos[qa + 5] = 0; qpos[qa + 6] = 0;
    for (let k = 0; k < 6; k++) qvel[da + k] = 0;
  }

  function fillAll(slot: "prev" | "curr" | "both"): void {
    if (slot === "prev") { fillBodies(frame.bodyPosPrev, frame.bodyQuatPrev); return; }
    fillBodies(frame.bodyPosCurr, frame.bodyQuatCurr);
    if (slot === "both") { frame.bodyPosPrev.set(frame.bodyPosCurr); frame.bodyQuatPrev.set(frame.bodyQuatCurr); }
    fillArms();
    fillCubes();
  }

  function assertLive(): void {
    if (disposed) throw new Error("PhysicsEngine used after dispose()");
  }

  const engine: PhysicsEngine = {
    info,
    frame,
    infoFor,

    reset(o: EngineResetOptions) {
      assertLive();
      selectMode(o.mode);
      const { model, data, index } = cur;
      mujoco.mj_resetData(model, data);
      model.opt.timestep = o.timestep;
      frame.dt = o.timestep;
      loadouts.atlas = o.loadouts.atlas;
      loadouts.blaze = o.loadouts.blaze;
      writeBaseServo(model, index, o.mode, loadouts);

      const rng = createRng(o.seed >>> 0);
      const qpos = data.qpos as Float64Array, ctrl = data.ctrl as Float64Array;
      for (const seat of SEATS) {
        const home = o.homePose[seat];
        for (let j = 0; j < ARM_JOINTS; j++) {
          const target = clampJoint(j, home[j] ?? 0);
          const jitter = j < 5 ? rng.range(-START_POSE_JITTER_RAD, START_POSE_JITTER_RAD) : 0;
          qpos[index.armQposAdr[seat][j]] = clampJoint(j, target + jitter);
          ctrl[index.actuatorId[seat][j]] = target;
        }
      }
      for (let i = 0; i < CUBE_COUNT; i++) {
        const onTable = o.layout !== "lobby" && CLUTTER.has(i);
        if (onTable) {
          const jx = rng.range(-CLUTTER_JITTER_M, CLUTTER_JITTER_M), jy = rng.range(-CLUTTER_JITTER_M, CLUTTER_JITTER_M);
          writeCube(i, [MJCF_CUBE_XY[i][0] + jx, MJCF_CUBE_XY[i][1] + jy, CUBE_REST_Z]);
        } else {
          writeCube(i, parkedCubePos(i));
        }
      }
      mujoco.mj_forward(model, data);
      cur.scanner.reset();
      resetActiveContacts(frame.active);
      frame.onsets.length = 0;
      frame.step = 0;
      frame.simTime = data.time;
      fillAll("both");
      fillDocks();
    },

    setTargets(seat: Seat, targets: ArrayLike<number>) {
      const ctrl = cur.data.ctrl as Float64Array;
      const act = cur.index.actuatorId[seat];
      const out = frame.arms[seat].ctrl;
      for (let j = 0; j < ARM_JOINTS; j++) {
        const v = clampJoint(j, targets[j] ?? out[j]);
        ctrl[act[j]] = v;
        out[j] = v;
      }
    },

    applyServoProfile(seat: Seat, profile: ServoProfile) {
      if (frame.mode === "harness" && !isOfflineProfile(profile) && !isIdentityProfile(profile)) return;
      writeProfile(cur.model, cur.index, seat, baseServoFor(frame.mode, loadouts[seat]), profile);
      const range = cur.model.actuator_forcerange as Float64Array;
      const act = cur.index.actuatorId[seat];
      for (let j = 0; j < ARM_JOINTS; j++) frame.arms[seat].forceRange[j] = range[act[j] * 2 + 1];
    },

    placeCube(index: number, pos: Vec3 | null) {
      if (index < 0 || index >= CUBE_COUNT) throw new Error(`placeCube: no cube ${index}`);
      const p = pos ?? parkedCubePos(index);
      writeCube(index, p);
      const c = frame.cubes;
      c.pos[index * 3] = p[0]; c.pos[index * 3 + 1] = p[1]; c.pos[index * 3 + 2] = p[2];
      c.quat[index * 4] = 1; c.quat[index * 4 + 1] = 0; c.quat[index * 4 + 2] = 0; c.quat[index * 4 + 3] = 0;
      c.linvel[index * 3] = 0; c.linvel[index * 3 + 1] = 0; c.linvel[index * 3 + 2] = 0;
    },

    step() {
      const { model, data } = cur;
      mujoco.mj_step(model, data);
      frame.step++;
      frame.simTime = data.time;
      frame.bodyPosPrev.set(frame.bodyPosCurr);
      frame.bodyQuatPrev.set(frame.bodyQuatCurr);
      fillBodies(frame.bodyPosCurr, frame.bodyQuatCurr);
      fillArms();
      fillCubes();
      cur.scanner.scan(model, data, frame);
    },

    saveState(out?: SimState) {
      return saveSimState(cur.model, cur.data, out);
    },

    restoreState(state: SimState, slot: "prev" | "curr" | "both") {
      assertLive();
      restoreSimState(mujoco, cur.model, cur.data, state);
      frame.simTime = cur.data.time;
      fillAll(slot);
      const range = cur.model.actuator_forcerange as Float64Array;
      for (const seat of SEATS) {
        const act = cur.index.actuatorId[seat];
        for (let j = 0; j < ARM_JOINTS; j++) frame.arms[seat].forceRange[j] = range[act[j] * 2 + 1];
      }
    },

    checksum() {
      return checksumData(cur.data);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const c of [compiled.harness, compiled.arcade]) {
        c.data.delete();
        c.model.delete();
      }
    },
  };
  internals.set(engine, () => ({
    mujoco, model: cur.model, data: cur.data, index: cur.index, walkedSteps: cur.scanner.walked,
    compileFresh: (mode: PhysicsMode) => compileModel(mujoco, mode === "arcade" ? arcadeFiles : stockFiles),
  }));
  return engine;
}

/** Live MuJoCo handles of an engine made by this module, for tests, the bench and tooling. Never used by the game. */
export interface EngineInternals {
  mujoco: MainModule; model: MjModel; data: MjData; index: ModelIndex; walkedSteps: number;
  compileFresh(mode: PhysicsMode): MjModel;   // caller deletes
}
const internals = new WeakMap<PhysicsEngine, () => EngineInternals>();

export function engineInternals(engine: PhysicsEngine): EngineInternals {
  const get = internals.get(engine);
  if (!get) throw new Error("engineInternals: not a MuJoCo engine from physics/engine.ts");
  return get();
}
