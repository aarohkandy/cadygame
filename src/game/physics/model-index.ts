// src/game/physics/model-index.ts (WP2)
// Name → index tables for a compiled arena model, built once per compile so the hot path only reads integers.
// Link mapping follows GAME_DESIGN 10.4; Arcade strike hulls (4.10) map to the LinkId of the body they sit in.
import type { MainModule, MjModel } from "@mujoco/mujoco";
import { JOINT_NAMES, LINK_IDS, SEATS, type LinkId, type Seat } from "../contracts.ts";

export const SEAT_INDEX: Readonly<Record<Seat, 0 | 1>> = { atlas: 0, blaze: 1 };
export const CUBE_COUNT = 9;
export const ARM_JOINTS = 6;
export const ARM_ACTUATORS = 5;                     // servo-state edits touch the 5 arm actuators, never the gripper

/** Body suffix (after the seat prefix) → LinkId. */
const LINK_OF_SUFFIX: Readonly<Record<string, LinkId>> = {
  base: "base", shoulder: "shoulder", upper_arm: "upper_arm", lower_arm: "lower_arm", wrist: "wrist",
  gripper: "gripper", camera_mount: "camera_mount", moving_jaw_so101_v1: "moving_jaw",
};
export const LINK_INDEX: Readonly<Record<LinkId, number>> =
  Object.fromEntries(LINK_IDS.map((id, i) => [id, i])) as Record<LinkId, number>;

export interface ModelIndex {
  nq: number; nv: number; nu: number; nbody: number; ngeom: number;
  bodyNames: string[];
  bodyId: Record<Seat, Record<LinkId, number>>;
  mountBodyId: Record<Seat, number>;
  cubeBodyIds: number[];
  cubeQposAdr: Int32Array;                          // 9, free-joint qpos address (pos 3 + quat 4)
  cubeDofAdr: Int32Array;                           // 9, free-joint dof address (lin 3 + ang 3)
  armQposAdr: Record<Seat, Int32Array>;             // 6 per seat, in JOINT_NAMES order
  armDofAdr: Record<Seat, Int32Array>;
  actuatorId: Record<Seat, Int32Array>;             // 6 per seat, in JOINT_NAMES order
  gripperSiteId: Record<Seat, number>;
  dockSiteId: Record<Seat, number>;                 // −1 when the model has no dock sites
  /* per geom */
  geomSeat: Int8Array;                              // 0 atlas, 1 blaze, −1 none
  geomLink: Int8Array;                              // LINK_IDS index, −1 none
  geomCube: Int8Array;                              // cube index, −1 none
  geomFloor: Uint8Array;                            // 1 for the table plane
  geomHull: Uint8Array;                             // 1 for Arcade strike hulls
  geomJaw: Int8Array;                               // 0 fixed jaw (gripper body), 1 moving jaw, −1 neither (collision geoms only)
  geomCollides: Uint8Array;                         // contype|conaffinity non-zero, or a hull in an explicit pair
  bodyRootId: Int32Array;
  hullCount: number;
}

function seatOfName(name: string): Seat | null {
  if (name.startsWith("atlas_")) return "atlas";
  if (name.startsWith("blaze_")) return "blaze";
  return null;
}

function requireId(mujoco: MainModule, model: MjModel, type: number, name: string, what: string): number {
  const id = mujoco.mj_name2id(model, type, name);
  if (id < 0) throw new Error(`Arena model is missing ${what} "${name}"`);
  return id;
}

export function buildModelIndex(mujoco: MainModule, model: MjModel): ModelIndex {
  const OBJ = mujoco.mjtObj;
  const bodyNames = Array.from({ length: model.nbody }, (_, i) => mujoco.mj_id2name(model, OBJ.mjOBJ_BODY.value, i) ?? "");
  const bodyLink = new Int8Array(model.nbody).fill(-1);
  const bodySeat = new Int8Array(model.nbody).fill(-1);
  const bodyCube = new Int8Array(model.nbody).fill(-1);
  const bodyId = { atlas: {}, blaze: {} } as Record<Seat, Record<LinkId, number>>;
  const mountBodyId = { atlas: -1, blaze: -1 } as Record<Seat, number>;
  bodyNames.forEach((name, i) => {
    const seat = seatOfName(name);
    if (seat) {
      const suffix = name.slice(seat.length + 1);
      if (suffix === "mount") mountBodyId[seat] = i;
      const link = LINK_OF_SUFFIX[suffix];
      if (link) { bodyId[seat][link] = i; bodyLink[i] = LINK_INDEX[link]; bodySeat[i] = SEAT_INDEX[seat]; }
      else if (suffix !== "mount") bodySeat[i] = SEAT_INDEX[seat];
    }
    const cube = /^cube_(\d)$/.exec(name);
    if (cube) bodyCube[i] = Number(cube[1]);
  });
  for (const seat of SEATS) {
    for (const link of LINK_IDS) if (bodyId[seat][link] === undefined) throw new Error(`Arena model is missing body ${seat}_${link}`);
    if (mountBodyId[seat] < 0) throw new Error(`Arena model is missing body ${seat}_mount`);
  }

  const cubeBodyIds: number[] = [];
  const cubeQposAdr = new Int32Array(CUBE_COUNT);
  const cubeDofAdr = new Int32Array(CUBE_COUNT);
  for (let c = 0; c < CUBE_COUNT; c++) {
    cubeBodyIds.push(requireId(mujoco, model, OBJ.mjOBJ_BODY.value, `cube_${c}`, "body"));
    const j = requireId(mujoco, model, OBJ.mjOBJ_JOINT.value, `cube_${c}_joint`, "joint");
    cubeQposAdr[c] = model.jnt_qposadr[j];
    cubeDofAdr[c] = model.jnt_dofadr[j];
  }

  const armQposAdr = {} as Record<Seat, Int32Array>;
  const armDofAdr = {} as Record<Seat, Int32Array>;
  const actuatorId = {} as Record<Seat, Int32Array>;
  const gripperSiteId = {} as Record<Seat, number>;
  const dockSiteId = {} as Record<Seat, number>;
  for (const seat of SEATS) {
    armQposAdr[seat] = new Int32Array(ARM_JOINTS);
    armDofAdr[seat] = new Int32Array(ARM_JOINTS);
    actuatorId[seat] = new Int32Array(ARM_JOINTS);
    JOINT_NAMES.forEach((jn, k) => {
      const j = requireId(mujoco, model, OBJ.mjOBJ_JOINT.value, `${seat}_${jn}`, "joint");
      armQposAdr[seat][k] = model.jnt_qposadr[j];
      armDofAdr[seat][k] = model.jnt_dofadr[j];
      actuatorId[seat][k] = requireId(mujoco, model, OBJ.mjOBJ_ACTUATOR.value, `${seat}_${jn}`, "actuator");
    });
    gripperSiteId[seat] = requireId(mujoco, model, OBJ.mjOBJ_SITE.value, `${seat}_gripperframe`, "site");
    dockSiteId[seat] = mujoco.mj_name2id(model, OBJ.mjOBJ_SITE.value, `${seat}_dock`);
  }

  const ngeom = model.ngeom;
  const geomSeat = new Int8Array(ngeom).fill(-1);
  const geomLink = new Int8Array(ngeom).fill(-1);
  const geomCube = new Int8Array(ngeom).fill(-1);
  const geomFloor = new Uint8Array(ngeom);
  const geomHull = new Uint8Array(ngeom);
  const geomJaw = new Int8Array(ngeom).fill(-1);
  const geomCollides = new Uint8Array(ngeom);
  const geomBody = model.geom_bodyid;
  const contype = model.geom_contype;
  const conaff = model.geom_conaffinity;
  const gripperLink = LINK_INDEX.gripper, jawLink = LINK_INDEX.moving_jaw;
  let hullCount = 0;
  for (let g = 0; g < ngeom; g++) {
    const b = geomBody[g];
    geomSeat[g] = bodySeat[b];
    geomLink[g] = bodyLink[b];
    geomCube[g] = bodyCube[b];
    const name = mujoco.mj_id2name(model, OBJ.mjOBJ_GEOM.value, g) ?? "";
    if (name === "floor") geomFloor[g] = 1;
    const hull = /_hull_/.test(name);
    if (hull) { geomHull[g] = 1; hullCount++; }
    geomCollides[g] = (contype[g] | conaff[g]) !== 0 || hull ? 1 : 0;
    if (geomCollides[g] && !hull) {
      if (bodyLink[b] === gripperLink) geomJaw[g] = 0;
      else if (bodyLink[b] === jawLink) geomJaw[g] = 1;
    }
  }

  return {
    nq: model.nq, nv: model.nv, nu: model.nu, nbody: model.nbody, ngeom,
    bodyNames, bodyId, mountBodyId, cubeBodyIds, cubeQposAdr, cubeDofAdr, armQposAdr, armDofAdr, actuatorId,
    gripperSiteId, dockSiteId,
    geomSeat, geomLink, geomCube, geomFloor, geomHull, geomJaw, geomCollides,
    bodyRootId: Int32Array.from(model.body_rootid as ArrayLike<number>),
    hullCount,
  };
}
