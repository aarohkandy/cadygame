// src/game/physics/contact-scan.ts (WP2)
// Contact onsets and active-contact summaries, read immediately after mj_step while contacts and cvel still describe
// the pre-impulse state (GAME_DESIGN 4.1).
//
// Onset: a geom pair that was not active on the previous step and has not ended within the last 30 ms sim (shorter
// gaps merge into one episode), gated on the normal constraint force. Stock presets score the real geoms. Arcade also
// scores the strike hulls: at 2.5 ms a fast tip crosses the thin jaw geoms between steps and only the hull pair fires,
// while the chunky wrist and forearm boxes are wider than a 9 mm hull and touch before it. Scanning both means neither
// case goes unscored; when both fire for one strike, the rules' 220 ms lockout keeps the harder of the two.
//
// Cost: the embind contact vector copies every contact, so the walk is skipped whenever no scored pair is physically
// possible (arms apart, no cube near an arm, arms clear of the table, no folded arm), judged from body origins that
// the engine already copied this step.
import type { MainModule, MjContact, MjData, MjModel } from "@mujoco/mujoco";
import {
  LINK_IDS,
  type ActiveContacts, type PhysicsFrame, type Seat, type Vec3,
} from "../contracts.ts";
import { tuning } from "../combat/tuning.ts";
import { CUBE_COUNT, type ModelIndex } from "./model-index.ts";

const MERGE_GAP_S = 0.03;
const SEATS_BY_INDEX: readonly Seat[] = ["atlas", "blaze"];
/** Distances (m) under which the pre-check lets the walk run. Generous: link lengths ≤ 0.135, geoms ≤ 0.03 thick. */
const ARM_NEAR_M = 0.24;
const CUBE_NEAR_M = 0.2;
const TABLE_NEAR_Z = 0.09;
const FOLDED_M = 0.11;
/** Pair memory older than this is pruned (it can no longer merge with anything). */
const PRUNE_AFTER_S = 1;

const Kind = { ArmArm: 0, CubeArm: 1, ArmTable: 2, Self: 3, Other: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

interface Slot {
  kind: Kind; g1: number; g2: number; force: number;
  px: number; py: number; pz: number; nx: number; ny: number; nz: number;
}

export interface ContactScanner {
  reset(): void;
  /** Fills frame.onsets (cleared first) and frame.active for the step that just ran. */
  scan(model: MjModel, data: MjData, frame: PhysicsFrame): void;
  readonly walked: number;                        // steps whose contacts were walked (bench and tests)
}

export function createActiveContacts(): ActiveContacts {
  return {
    armArmTouching: false, maxArmForce: 0,
    lastCrossContactT: { atlas: -1, blaze: -1 },
    gripperOnCube: { atlas: -1, blaze: -1 },
    bothJawsOnCube: { atlas: -1, blaze: -1 },
    lastGripperTouch: { cube: new Int32Array(CUBE_COUNT).fill(-1), t: new Float64Array(CUBE_COUNT) },
    opticsImpulse: { atlas: 0, blaze: 0 },
  };
}

export function resetActiveContacts(a: ActiveContacts): void {
  a.armArmTouching = false; a.maxArmForce = 0;
  a.lastCrossContactT.atlas = -1; a.lastCrossContactT.blaze = -1;
  a.gripperOnCube.atlas = -1; a.gripperOnCube.blaze = -1;
  a.bothJawsOnCube.atlas = -1; a.bothJawsOnCube.blaze = -1;
  a.lastGripperTouch.cube.fill(-1); a.lastGripperTouch.t.fill(0);
  a.opticsImpulse.atlas = 0; a.opticsImpulse.blaze = 0;
}

/** Sample bodies per seat for the pre-check: upper_arm, lower_arm, wrist, gripper, moving jaw. */
function sampleBodies(index: ModelIndex, seat: Seat): Int32Array {
  const b = index.bodyId[seat];
  return Int32Array.of(b.upper_arm, b.lower_arm, b.wrist, b.gripper, b.moving_jaw);
}

export function createContactScanner(mujoco: MainModule, index: ModelIndex): ContactScanner {
  void mujoco;
  const pairLast = new Map<number, number>();     // pair key → sim time the pair was last active
  const slots: Slot[] = [];
  const slotOfKey = new Map<number, number>();
  const samples = [sampleBodies(index, "atlas"), sampleBodies(index, "blaze")];
  const shoulder = [index.bodyId.atlas.shoulder, index.bodyId.blaze.shoulder];
  const cameraLink = LINK_IDS.indexOf("camera_mount");
  const jawFixed = [new Int8Array(CUBE_COUNT), new Int8Array(CUBE_COUNT)];
  const jawMoving = [new Int8Array(CUBE_COUNT), new Int8Array(CUBE_COUNT)];
  const va = new Float64Array(3), vb = new Float64Array(3);
  let walked = 0;
  let lastPruneT = 0;
  const gate = tuning.arcade.scoring.armArmGateN;
  const tableGate = tuning.arcade.scoring.tableGateN;

  function slotFor(kind: Kind, g1: number, g2: number): Slot {
    const key = g1 * index.ngeom + g2;
    const at = slotOfKey.get(key);
    if (at !== undefined) return slots[at];
    const i = slotOfKey.size;
    slotOfKey.set(key, i);
    if (i === slots.length) slots.push({ kind, g1, g2, force: -1, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0 });
    const s = slots[i];
    s.kind = kind; s.g1 = g1; s.g2 = g2; s.force = -1;
    return s;
  }

  function mayTouch(frame: PhysicsFrame): boolean {
    const p = frame.bodyPosCurr;
    const sa = samples[0], sb = samples[1];
    for (let i = 0; i < sa.length; i++) {
      const ax = p[sa[i] * 3], ay = p[sa[i] * 3 + 1], az = p[sa[i] * 3 + 2];
      if (az < TABLE_NEAR_Z) return true;
      for (let j = 0; j < sb.length; j++) {
        const dx = ax - p[sb[j] * 3], dy = ay - p[sb[j] * 3 + 1], dz = az - p[sb[j] * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < ARM_NEAR_M * ARM_NEAR_M) return true;
      }
    }
    for (let s = 0; s < 2; s++) {
      const set = samples[s];
      for (let i = 0; i < set.length; i++) {
        const b = set[i] * 3;
        if (p[b + 2] < TABLE_NEAR_Z) return true;
        for (let c = 0; c < CUBE_COUNT; c++) {
          const cp = frame.cubes.pos;
          if (cp[c * 3] > 1.5) continue;                // parked
          const dx = p[b] - cp[c * 3], dy = p[b + 1] - cp[c * 3 + 1], dz = p[b + 2] - cp[c * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < CUBE_NEAR_M * CUBE_NEAR_M) return true;
        }
      }
      const g = set[3] * 3, sh = shoulder[s] * 3;
      const dx = p[g] - p[sh], dy = p[g + 1] - p[sh + 1], dz = p[g + 2] - p[sh + 2];
      if (dx * dx + dy * dy + dz * dz < FOLDED_M * FOLDED_M) return true;
    }
    return false;
  }

  /** World velocity of `body` at point (px, py, pz): cvel is [ω; v] about subtree_com of the body's root. */
  function pointVelocity(cvel: Float64Array, com: Float64Array, body: number, px: number, py: number, pz: number, out: Float64Array): void {
    const root = index.bodyRootId[body] * 3;
    const rx = px - com[root], ry = py - com[root + 1], rz = pz - com[root + 2];
    const o = body * 6;
    const wx = cvel[o], wy = cvel[o + 1], wz = cvel[o + 2];
    out[0] = cvel[o + 3] + wy * rz - wz * ry;
    out[1] = cvel[o + 4] + wz * rx - wx * rz;
    out[2] = cvel[o + 5] + wx * ry - wy * rx;
  }

  function isOnset(key: number, t: number): boolean {
    const last = pairLast.get(key);
    pairLast.set(key, t);
    return last === undefined || t - last > MERGE_GAP_S + 1e-9;
  }

  return {
    get walked() { return walked; },
    reset() {
      pairLast.clear();
      lastPruneT = 0;
    },
    scan(model, data, frame) {
      const onsets = frame.onsets;
      onsets.length = 0;
      const active = frame.active;
      const t = frame.simTime, dt = frame.dt, step = frame.step - 1;
      active.armArmTouching = false;
      active.maxArmForce = 0;
      active.gripperOnCube.atlas = -1; active.gripperOnCube.blaze = -1;
      active.bothJawsOnCube.atlas = -1; active.bothJawsOnCube.blaze = -1;
      active.opticsImpulse.atlas = 0; active.opticsImpulse.blaze = 0;

      if (t - lastPruneT > PRUNE_AFTER_S) {
        for (const [k, v] of pairLast) if (t - v > PRUNE_AFTER_S) pairLast.delete(k);
        lastPruneT = t;
      }
      if (data.ncon === 0 || !mayTouch(frame)) return;
      walked++;

      const geomBody = model.geom_bodyid as Int32Array;
      const efc = data.efc_force as Float64Array;
      slotOfKey.clear();
      for (let s = 0; s < 2; s++) { jawFixed[s].fill(0); jawMoving[s].fill(0); }

      const contacts = data.contact;
      try {
        const n = contacts.size();
        for (let i = 0; i < n; i++) {
          const c = contacts.get(i) as MjContact;
          try {
            const adr = c.efc_address;
            if (adr < 0) continue;
            let g1 = c.geom1, g2 = c.geom2;
            const s1 = index.geomSeat[g1], s2 = index.geomSeat[g2];
            if (s1 < 0 && s2 < 0) continue;              // cube–cube, cube–table
            const force = efc[adr];
            if (!(force > 0)) continue;
            const cube1 = index.geomCube[g1], cube2 = index.geomCube[g2];
            let kind: Kind;
            if (s1 >= 0 && s2 >= 0) {
              if (s1 !== s2) {
                kind = Kind.ArmArm;
                active.armArmTouching = true;
                if (force > active.maxArmForce) active.maxArmForce = force;
                active.lastCrossContactT.atlas = t;
                active.lastCrossContactT.blaze = t;
              } else {
                kind = index.geomLink[g1] !== index.geomLink[g2] && !index.geomHull[g1] && !index.geomHull[g2] ? Kind.Self : Kind.Other;
              }
            } else if (cube1 >= 0 || cube2 >= 0) {
              kind = Kind.CubeArm;
              const armG = s1 >= 0 ? g1 : g2;
              const seatI = s1 >= 0 ? s1 : s2;
              const cube = cube1 >= 0 ? cube1 : cube2;
              active.lastCrossContactT[SEATS_BY_INDEX[seatI]] = t;
              const jaw = index.geomJaw[armG];
              if (jaw >= 0) {
                if (jaw === 0) jawFixed[seatI][cube] = 1; else jawMoving[seatI][cube] = 1;
                const seat = SEATS_BY_INDEX[seatI];
                if (active.gripperOnCube[seat] < 0) active.gripperOnCube[seat] = cube;
                active.lastGripperTouch.cube[cube] = seatI;
                active.lastGripperTouch.t[cube] = t;
              }
            } else if (index.geomFloor[g1] || index.geomFloor[g2]) {
              kind = Kind.ArmTable;
            } else {
              continue;
            }
            // Optics impulse: any contact force on a seat's camera_mount geoms from something that is not that seat.
            if (s1 >= 0 && index.geomLink[g1] === cameraLink && s2 !== s1) active.opticsImpulse[SEATS_BY_INDEX[s1]] += force * dt;
            if (s2 >= 0 && index.geomLink[g2] === cameraLink && s1 !== s2) active.opticsImpulse[SEATS_BY_INDEX[s2]] += force * dt;
            if (kind === Kind.Other) continue;
            if (g1 > g2) { const tmp = g1; g1 = g2; g2 = tmp; }
            const slot = slotFor(kind, g1, g2);
            if (force > slot.force) {
              slot.force = force;
              const pos = c.pos as Float64Array, fr = c.frame as Float64Array;
              slot.px = pos[0]; slot.py = pos[1]; slot.pz = pos[2];
              // frame[0..2] points from contact.geom1 to contact.geom2; re-express for the sorted pair.
              const flip = c.geom1 !== g1 ? -1 : 1;
              slot.nx = fr[0] * flip; slot.ny = fr[1] * flip; slot.nz = fr[2] * flip;
            }
          } finally {
            c.delete();
          }
        }
      } finally {
        contacts.delete();
      }

      for (let s = 0; s < 2; s++) {
        for (let c = 0; c < CUBE_COUNT; c++) {
          if (jawFixed[s][c] && jawMoving[s][c]) { active.bothJawsOnCube[SEATS_BY_INDEX[s]] = c; break; }
        }
      }

      const nSlots = slotOfKey.size;
      if (nSlots === 0) return;
      const cvel = data.cvel as Float64Array;
      const com = data.subtree_com as Float64Array;
      for (let i = 0; i < nSlots; i++) {
        const sl = slots[i];
        const kindGate = sl.kind === Kind.ArmTable ? tableGate : gate;
        if (sl.force <= kindGate) continue;               // below the gate the pair is not active at all
        if (!isOnset(sl.g1 * index.ngeom + sl.g2, t)) continue;
        const b1 = geomBody[sl.g1], b2 = geomBody[sl.g2];
        const pos: Vec3 = [sl.px, sl.py, sl.pz];
        switch (sl.kind) {
          case Kind.ArmArm: {
            // Orient atlas → blaze.
            const atlasFirst = index.geomSeat[sl.g1] === 0;
            const ga = atlasFirst ? sl.g1 : sl.g2, gb = atlasFirst ? sl.g2 : sl.g1;
            const ba = atlasFirst ? b1 : b2, bb = atlasFirst ? b2 : b1;
            const sgn = atlasFirst ? 1 : -1;
            const nx = sl.nx * sgn, ny = sl.ny * sgn, nz = sl.nz * sgn;
            pointVelocity(cvel, com, ba, sl.px, sl.py, sl.pz, va);
            pointVelocity(cvel, com, bb, sl.px, sl.py, sl.pz, vb);
            const vaN = va[0] * nx + va[1] * ny + va[2] * nz;
            const vbN = vb[0] * nx + vb[1] * ny + vb[2] * nz;
            onsets.push({
              kind: "arm_arm", t, step,
              atlasLink: LINK_IDS[index.geomLink[ga]], blazeLink: LINK_IDS[index.geomLink[gb]],
              aN: Math.max(0, vaN), bN: Math.max(0, -vbN), vN: Math.abs(vaN - vbN),
              efcForce: sl.force, pos, normal: [nx, ny, nz],
            });
            break;
          }
          case Kind.CubeArm: {
            const cubeFirst = index.geomCube[sl.g1] >= 0;
            const gArm = cubeFirst ? sl.g2 : sl.g1;
            const bCube = cubeFirst ? b1 : b2, bArm = cubeFirst ? b2 : b1;
            // Normal from cube toward arm.
            const sgn = cubeFirst ? 1 : -1;
            const nx = sl.nx * sgn, ny = sl.ny * sgn, nz = sl.nz * sgn;
            pointVelocity(cvel, com, bCube, sl.px, sl.py, sl.pz, va);
            pointVelocity(cvel, com, bArm, sl.px, sl.py, sl.pz, vb);
            const vN = Math.abs((va[0] - vb[0]) * nx + (va[1] - vb[1]) * ny + (va[2] - vb[2]) * nz);
            onsets.push({
              kind: "cube_arm", t, step, cube: index.geomCube[cubeFirst ? sl.g1 : sl.g2],
              seat: SEATS_BY_INDEX[index.geomSeat[gArm]], link: LINK_IDS[index.geomLink[gArm]],
              vN, pos, normal: [nx, ny, nz],
            });
            break;
          }
          case Kind.ArmTable: {
            const gArm = index.geomSeat[sl.g1] >= 0 ? sl.g1 : sl.g2;
            pointVelocity(cvel, com, geomBody[gArm], sl.px, sl.py, sl.pz, va);
            const vN = Math.abs(va[0] * sl.nx + va[1] * sl.ny + va[2] * sl.nz);
            onsets.push({
              kind: "arm_table", t, step, seat: SEATS_BY_INDEX[index.geomSeat[gArm]], link: LINK_IDS[index.geomLink[gArm]],
              vN, efcForce: sl.force, pos,
            });
            break;
          }
          case Kind.Self: {
            onsets.push({
              kind: "self", t, step, seat: SEATS_BY_INDEX[index.geomSeat[sl.g1]],
              linkA: LINK_IDS[index.geomLink[sl.g1]], linkB: LINK_IDS[index.geomLink[sl.g2]],
            });
            break;
          }
        }
      }
    },
  };
}
