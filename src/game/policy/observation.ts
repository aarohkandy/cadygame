// src/game/policy/observation.ts (WP4)
// torquelimit.obs/3 (GAME_DESIGN 5.4): builds one seat's observation in its own ego frame from the physics
// frame, the combat snapshot, and the events drained from that seat's ring, filling the dict and the six
// float32 blocks from the same numbers. Blaze's ego frame is a 180° rotation about the table-centre z axis
// (not a mirror), so one policy plays either seat. Also the fair-delay line (1.5 s, nearest older).
//
// Allocation: with `out` the builder reuses every array and object in it (pilot seats); without `out` it
// returns a fresh observation that drivers, Workers, and delay lines may keep.

import {
  CORE_CUBE_INDEX, GRIP_CLOSED, GRIP_OPEN, LINK_IDS, MOUNT_X, OBS_BLOCKS, OBS_SCHEMA, SERVO_STATE_CODE, otherSeat,
  type ArmFrame, type ArmObservation, type CombatSnapshot, type GameEvent, type LinkId, type ModelInfo, type ObsBlockName,
  type ObsContactEvent, type Observation, type ObservationBuilder, type ObservationDelayLine, type PhysicsFrame,
  type QuatWxyz, type Seat, type SeatCombatState, type Vec3,
} from "../contracts.ts";
import { OBS_CONTACT_KIND, OBS_CONTACT_SLOTS, OBS_CONTACT_WIDTH, OBS_CUBE_COUNT, OBS_CUBE_WIDTH } from "./obs-schema.ts";

/** Cubes parked off the table sit at x = 2.0 + 0.1 · index (PhysicsEngine.placeCube). */
const PARKED_X = 1.5;
/** game[9]: arms count as touching above this constraint force (N). */
const TOUCH_FORCE_N = 0.3;
/** charge c is public from this value (4.7). */
const CHARGE_PUBLIC_MIN = 0.25;
/** Fair-delay history kept per seat. */
export const DELAY_LINE_SECONDS = 1.5;
const LOCK_IN_NORM_S = 8;

/* ───────────────────────── ego transforms ───────────────────────── */

/** World point → seat ego point. Atlas: translate by its mount. Blaze: 180° about z through the table centre, then translate. */
export function worldToEgoPoint(seat: Seat, x: number, y: number, z: number, out: Vec3): Vec3 {
  if (seat === "atlas") { out[0] = x - MOUNT_X.atlas; out[1] = y; out[2] = z; }
  else { out[0] = -(x - MOUNT_X.blaze); out[1] = -y; out[2] = z; }
  return out;
}

/** World vector (velocity, normal) → ego vector: identity for atlas, 180° about z for blaze. */
export function worldToEgoVector(seat: Seat, x: number, y: number, z: number, out: Vec3): Vec3 {
  if (seat === "atlas") { out[0] = x; out[1] = y; out[2] = z; }
  else { out[0] = -x; out[1] = -y; out[2] = z; }
  return out;
}

/** World orientation (wxyz) → ego orientation, canonicalised to w ≥ 0. Blaze: q_ego = Rz(π) ⊗ q = (−z, −y, x, w). */
export function worldToEgoQuat(seat: Seat, w: number, x: number, y: number, z: number, out: QuatWxyz): QuatWxyz {
  let qw = w, qx = x, qy = y, qz = z;
  if (seat === "blaze") { qw = -z; qx = -y; qy = x; qz = w; }
  if (qw < 0 || (qw === 0 && (qx < 0 || (qx === 0 && (qy < 0 || (qy === 0 && qz < 0)))))) { qw = -qw; qx = -qx; qy = -qy; qz = -qz; }
  out[0] = qw + 0; out[1] = qx + 0; out[2] = qy + 0; out[3] = qz + 0;   // + 0 folds −0 to 0
  return out;
}

/* ───────────────────────── allocation ───────────────────────── */

function zeros(n: number): number[] { return new Array<number>(n).fill(0); }

function emptyArm(): ArmObservation {
  return {
    q: zeros(6), qd: zeros(6), tau: zeros(6), ctrl: zeros(6),
    ee: { pos: [0, 0, 0], quat: [1, 0, 0, 0], linvel: [0, 0, 0] },
    elbow_pos: [0, 0, 0], wrist_pos: [0, 0, 0], gripper_opening: 0,
    integrity: 0, integrity_max: 0, heat: 0, servo_state: "normal", servo_state_remaining_ms: 0,
    charge_public: 0, guard: false, loadout: null,
  };
}

function emptyBlocks(): Observation["blocks"] {
  const out = {} as Record<ObsBlockName, Float32Array>;
  for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) out[name] = new Float32Array(OBS_BLOCKS[name]);
  return out;
}

/** A zeroed observation with every array at its schema length. */
export function emptyObservation(seat: Seat = "atlas"): Observation {
  const cubes: Observation["cubes"] = [];
  for (let i = 0; i < OBS_CUBE_COUNT; i++) {
    cubes.push({ pos: [0, 0, 0], quat: [1, 0, 0, 0], linvel: [0, 0, 0], is_core: i === CORE_CUBE_INDEX, parked: false, held_by: null });
  }
  return {
    schema: OBS_SCHEMA, tick: 0, frame_index: 0, t: 0, dt: 0, side: seat, preset: "arcade",
    self: emptyArm(), opponent: emptyArm(), cubes,
    core: { phase: "dormant", owner: null, docked_in: null, lock_in_remaining: 0, lock_in_full: 0, contested: false, loose: false },
    contacts: [],
    round: { index: 0, best_of: 1, phase: "boot", time_remaining: 0, phase_length: 0, rounds_won: { self: 0, opponent: 0 }, sudden_death: false },
    last_action: zeros(6),
    status: { late_steps: 0, clamped_steps: 0, timeouts: 0 },
    blocks: emptyBlocks(),
  };
}

/* ───────────────────────── arm ───────────────────────── */

function fillArm(
  seat: Seat, arm: ArmFrame, combat: SeatCombatState, arcade: boolean, opponentView: boolean, out: ArmObservation,
): void {
  for (let j = 0; j < 6; j++) {
    out.q[j] = arm.q[j];
    out.qd[j] = arm.qd[j];
    const fr = Math.abs(arm.forceRange[j]);
    const tau = arm.tau[j];
    out.tau[j] = fr > 0 ? Math.min(fr, Math.max(-fr, tau)) : tau;
    out.ctrl[j] = opponentView ? 0 : arm.ctrl[j];
  }
  worldToEgoPoint(seat, arm.eePos[0], arm.eePos[1], arm.eePos[2], out.ee.pos);
  worldToEgoQuat(seat, arm.eeQuat[0], arm.eeQuat[1], arm.eeQuat[2], arm.eeQuat[3], out.ee.quat);
  worldToEgoVector(seat, arm.eeVel[0], arm.eeVel[1], arm.eeVel[2], out.ee.linvel);
  worldToEgoPoint(seat, arm.elbowPos[0], arm.elbowPos[1], arm.elbowPos[2], out.elbow_pos);
  worldToEgoPoint(seat, arm.wristPos[0], arm.wristPos[1], arm.wristPos[2], out.wrist_pos);
  out.gripper_opening = (arm.q[5] - GRIP_CLOSED) / (GRIP_OPEN - GRIP_CLOSED);
  out.integrity = combat.integrity;
  out.integrity_max = combat.integrityMax;
  out.heat = arcade ? combat.heat : 0;
  out.servo_state = arcade || combat.servoState === "offline" ? combat.servoState : "normal";
  out.servo_state_remaining_ms = arcade ? combat.servoStateRemainingMs : 0;
  out.charge_public = arcade && combat.charging && combat.charge >= CHARGE_PUBLIC_MIN ? combat.charge : 0;
  out.guard = arcade && combat.guardHeld;
  out.loadout = arcade ? combat.loadout : null;
}

/* ───────────────────────── contacts ───────────────────────── */

const LINK_INDEX: Readonly<Record<LinkId, number>> = Object.fromEntries(LINK_IDS.map((l, i) => [l, i])) as Record<LinkId, number>;

type ContactKind = ObsContactEvent["kind"];

function contactKindOf(e: GameEvent): ContactKind | null {
  switch (e.type) {
    case "strike": return e.thrownCube >= 0 ? "cube_hit" : e.tier;
    case "deflect": return "deflect";
    case "clash": return "clash";
    case "contact": return "contact";
    case "table_hit": return "table_hit";
    default: return null;
  }
}

function fillContact(seat: Seat, e: GameEvent, kind: ContactKind, physical: boolean, out: ObsContactEvent): void {
  const side = (s: Seat | null): "self" | "opponent" | null => (s === null ? null : s === seat ? "self" : "opponent");
  out.kind = kind;
  out.attacker = null; out.damage_to_self = 0; out.damage_to_opponent = 0; out.normal_speed = 0; out.zone = null;
  out.t = e.t;
  let pos: Vec3 | null = null;
  switch (e.type) {
    case "strike": {
      out.attacker = side(e.attacker);
      const dmg = physical ? e.physicalDamage : e.damage;
      if (e.victim === seat) out.damage_to_self = dmg; else out.damage_to_opponent = dmg;
      out.normal_speed = e.vN; out.zone = e.zone; pos = e.pos;
      break;
    }
    case "deflect": out.attacker = side(e.attacker); pos = e.pos; break;
    case "clash": out.normal_speed = e.magnitude; pos = e.pos; break;
    case "contact": out.normal_speed = e.magnitude; pos = e.pos; break;
    case "table_hit": out.attacker = side(e.seat); pos = e.pos; break;
    default: break;
  }
  if (pos) worldToEgoPoint(seat, pos[0], pos[1], pos[2], out.pos); else { out.pos[0] = 0; out.pos[1] = 0; out.pos[2] = 0; }
}

/* ───────────────────────── builder ───────────────────────── */

const FIGHT_PHASES = new Set(["fight", "sudden_death"]);

export function createObservationBuilder(info: ModelInfo): ObservationBuilder {
  const cubeCount = Math.min(OBS_CUBE_COUNT, info.cubeBodyIds.length || OBS_CUBE_COUNT);
  const lastSeen: Record<Seat, { tick: number; t: number; dt: number }> = {
    atlas: { tick: -1, t: -1, dt: 0 }, blaze: { tick: -1, t: -1, dt: 0 },
  };

  return {
    build(seat, frame: PhysicsFrame, combat: CombatSnapshot, match, lastApplied, status, tick, frameIndex, events, out) {
      const obs = out ?? emptyObservation(seat);
      const opp = otherSeat(seat);
      const arcade = combat.scoring === "full";
      const physical = !arcade;

      obs.schema = OBS_SCHEMA;
      obs.tick = tick; obs.frame_index = frameIndex; obs.t = frame.simTime;
      obs.side = seat; obs.preset = combat.preset;

      fillArm(seat, frame.arms[seat], combat.seats[seat], arcade, false, obs.self);
      fillArm(seat, frame.arms[opp], combat.seats[opp], arcade, true, obs.opponent);

      // Cubes
      for (let i = 0; i < OBS_CUBE_COUNT; i++) {
        const c = obs.cubes[i];
        if (i >= cubeCount) { c.pos.fill(0); c.quat[0] = 1; c.quat[1] = 0; c.quat[2] = 0; c.quat[3] = 0; c.linvel.fill(0); c.parked = true; c.held_by = null; continue; }
        const p = frame.cubes.pos, q = frame.cubes.quat, v = frame.cubes.linvel;
        worldToEgoPoint(seat, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], c.pos);
        worldToEgoQuat(seat, q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3], c.quat);
        worldToEgoVector(seat, v[i * 3], v[i * 3 + 1], v[i * 3 + 2], c.linvel);
        c.is_core = i === CORE_CUBE_INDEX;
        c.parked = p[i * 3] > PARKED_X;
        const selfHold = frame.active.bothJawsOnCube[seat] === i;
        const oppHold = frame.active.bothJawsOnCube[opp] === i;
        c.held_by = selfHold ? "self" : oppHold ? "opponent" : null;
      }

      // Core
      const core = combat.core;
      const rel = (s: Seat | null): "self" | "opponent" | null => (s === null ? null : s === seat ? "self" : "opponent");
      obs.core.phase = core.phase;
      obs.core.owner = rel(core.owner);
      obs.core.docked_in = rel(core.dockedIn);
      obs.core.lock_in_remaining = core.owner ? core.lockInRemainingS : 0;
      obs.core.lock_in_full = core.owner ? core.lockInTotalS : 0;
      obs.core.contested = core.contested;
      obs.core.loose = core.loose;

      // Round
      const inFight = FIGHT_PHASES.has(match.phase);
      obs.round.index = match.round;
      obs.round.best_of = match.bestOf;
      obs.round.phase = match.phase;
      obs.round.phase_length = match.phaseLengthS;
      obs.round.time_remaining = inFight ? Math.max(0, combat.roundLengthS - combat.fightTimeS) : 0;
      obs.round.rounds_won.self = match.roundsWon[seat];
      obs.round.rounds_won.opponent = match.roundsWon[opp];
      obs.round.sudden_death = combat.suddenDeath;

      for (let j = 0; j < 6; j++) obs.last_action[j] = lastApplied[j];
      obs.status.late_steps = status.late_steps;
      obs.status.clamped_steps = status.clamped_steps;
      obs.status.timeouts = status.timeouts;

      // Contacts since the previous observation (ring order is step order: oldest first).
      let n = 0;
      for (let i = 0; i < events.length; i++) if (contactKindOf(events[i]) !== null) n++;
      while (obs.contacts.length > n) obs.contacts.pop();
      while (obs.contacts.length < n) obs.contacts.push({ kind: "contact", attacker: null, damage_to_self: 0, damage_to_opponent: 0, normal_speed: 0, zone: null, pos: [0, 0, 0], t: 0 });
      let k = 0;
      for (let i = 0; i < events.length; i++) {
        const kind = contactKindOf(events[i]);
        if (kind !== null) fillContact(seat, events[i], kind, physical, obs.contacts[k++]);
      }

      // dt: the control period, measured from this seat's previous observation; before one exists, the
      // 50 Hz default rounded to whole physics steps.
      const last = lastSeen[seat];
      if (tick > last.tick && frame.simTime > last.t && last.tick >= 0) last.dt = (frame.simTime - last.t) / (tick - last.tick);
      else if (tick <= last.tick || frame.simTime < last.t) last.dt = 0;
      last.tick = tick; last.t = frame.simTime;
      obs.dt = last.dt > 0 ? last.dt : inferControlDt(frame);

      fillBlocks(obs, frame);
      return obs;
    },
  };
}

/** The default 50 Hz control period rounded to whole physics steps. */
function inferControlDt(frame: PhysicsFrame): number {
  const stepsPerTick = Math.max(1, Math.round(0.02 / frame.dt));
  return stepsPerTick * frame.dt;
}

function fillBlocks(obs: Observation, frame: PhysicsFrame): void {
  const b = obs.blocks;
  const s = obs.self, o = obs.opponent;

  const state = b.state;
  for (let j = 0; j < 6; j++) { state[j] = s.q[j]; state[6 + j] = s.qd[j]; }

  const se = b.self_ext;
  se[0] = s.ee.pos[0]; se[1] = s.ee.pos[1]; se[2] = s.ee.pos[2];
  se[3] = s.ee.quat[0]; se[4] = s.ee.quat[1]; se[5] = s.ee.quat[2]; se[6] = s.ee.quat[3];
  se[7] = s.ee.linvel[0]; se[8] = s.ee.linvel[1]; se[9] = s.ee.linvel[2];
  se[10] = s.wrist_pos[0]; se[11] = s.wrist_pos[1]; se[12] = s.wrist_pos[2];
  for (let j = 0; j < 6; j++) { se[13 + j] = s.tau[j]; se[19 + j] = s.ctrl[j]; se[25 + j] = obs.last_action[j]; }
  se[31] = s.gripper_opening;

  const os = b.opponent_state;
  for (let j = 0; j < 6; j++) { os[j] = o.q[j]; os[6 + j] = o.qd[j]; }
  os[12] = o.ee.pos[0]; os[13] = o.ee.pos[1]; os[14] = o.ee.pos[2];
  os[15] = o.ee.quat[0]; os[16] = o.ee.quat[1]; os[17] = o.ee.quat[2]; os[18] = o.ee.quat[3];
  os[19] = o.ee.linvel[0]; os[20] = o.ee.linvel[1]; os[21] = o.ee.linvel[2];
  os[22] = o.elbow_pos[0]; os[23] = o.elbow_pos[1]; os[24] = o.elbow_pos[2];
  os[25] = o.wrist_pos[0]; os[26] = o.wrist_pos[1]; os[27] = o.wrist_pos[2];

  const g = b.game;
  const arcade = obs.preset === "arcade";
  const r = obs.round;
  g[0] = s.integrity_max > 0 ? s.integrity / s.integrity_max : 0;
  g[1] = o.integrity_max > 0 ? o.integrity / o.integrity_max : 0;
  const fight = r.phase === "fight" || r.phase === "sudden_death";
  g[2] = fight && r.phase_length > 0 ? r.time_remaining / r.phase_length : 0;
  g[3] = fight ? 1 : 0;
  g[4] = r.sudden_death ? 1 : 0;
  g[5] = (r.rounds_won.self - r.rounds_won.opponent) / Math.max(1, Math.ceil(r.best_of / 2));
  const c = obs.core;
  const frac = c.lock_in_full > 0 ? c.lock_in_remaining / c.lock_in_full : 0;
  g[6] = c.owner === "self" ? frac : c.owner === "opponent" ? -frac : 0;
  g[7] = c.owner ? c.lock_in_full / LOCK_IN_NORM_S : 0;
  g[8] = c.phase === "live" ? 1 : 0;
  g[9] = frame.active.armArmTouching && frame.active.maxArmForce > TOUCH_FORCE_N ? 1 : 0;
  g[10] = arcade ? s.heat / 100 : 0;
  g[11] = arcade ? o.charge_public : 0;
  g[12] = SERVO_STATE_CODE[s.servo_state] / 5;
  g[13] = SERVO_STATE_CODE[o.servo_state] / 5;
  g[14] = arcade ? s.servo_state_remaining_ms / 1000 : 0;
  g[15] = arcade && s.guard ? 1 : 0;

  const env = b.environment_state;
  for (let i = 0; i < OBS_CUBE_COUNT; i++) {
    const cube = obs.cubes[i];
    const at = i * OBS_CUBE_WIDTH;
    env[at] = cube.pos[0]; env[at + 1] = cube.pos[1]; env[at + 2] = cube.pos[2];
    env[at + 3] = cube.quat[0]; env[at + 4] = cube.quat[1]; env[at + 5] = cube.quat[2]; env[at + 6] = cube.quat[3];
    env[at + 7] = cube.parked ? 1 : 0;
    env[at + 8] = cube.held_by === "self" ? 1 : cube.held_by === "opponent" ? -1 : 0;
  }

  const ct = b.contacts;
  ct.fill(0);
  const n = obs.contacts.length;
  for (let slot = 0; slot < OBS_CONTACT_SLOTS && slot < n; slot++) {
    const e = obs.contacts[n - 1 - slot];          // newest first
    const at = slot * OBS_CONTACT_WIDTH;
    ct[at] = OBS_CONTACT_KIND[e.kind];
    ct[at + 1] = e.attacker === "self" ? 1 : e.attacker === "opponent" ? -1 : 0;
    ct[at + 2] = e.zone ? LINK_INDEX[e.zone] + 1 : 0;
    ct[at + 3] = e.normal_speed;
    ct[at + 4] = Math.max(0, obs.t - e.t);
  }
}

/* ───────────────────────── fair-delay line ───────────────────────── */

/**
 * Keeps 1.5 s of observations (by sim time) and returns the newest one at least `delayMs` old
 * ("nearest older"). Before enough history exists it returns the oldest it has.
 */
export function createObservationDelayLine(): ObservationDelayLine {
  const buf: Observation[] = [];
  return {
    push(obs) {
      if (buf.length > 0 && obs.t < buf[buf.length - 1].t) buf.length = 0;   // time went backwards: a new round
      buf.push(obs);
      const horizon = obs.t - DELAY_LINE_SECONDS;
      let drop = 0;
      // Keep one entry at or before the horizon so a full 1.5 s delay still has a nearest-older answer.
      while (drop + 1 < buf.length && buf[drop + 1].t <= horizon) drop++;
      if (drop > 0) buf.splice(0, drop);
    },
    read(delayMs) {
      if (buf.length === 0) return emptyObservation();
      const newest = buf[buf.length - 1];
      const target = newest.t - Math.max(0, delayMs) / 1000 + 1e-9;
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= target) return buf[i];
      return buf[0];
    },
    clear() { buf.length = 0; },
  };
}
