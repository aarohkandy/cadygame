// src/game/policy/opponent/primitives.ts (WP4)
// Motion primitives of the built-in opponent (GAME_DESIGN 5.5.2) as data: task-space keyframes in the ego frame,
// phase durations at tier Contender before noise, intents per phase, and how far attacks lead their path.
// A primitive instance is committed when it starts: its duration scale and aim noise are sampled once, and each
// phase's target is resolved when that phase begins (so a jab aims where the opponent is when it fires, not where
// it was at the wind-up). Paths between keyframes are minimum-jerk in cylindrical coordinates about the pan axis,
// so sweeps arc like a real shoulder instead of cutting chords.

import { INTENT_BITS, GRIP_CLOSED, GRIP_OPEN, type Vec3 } from "../../contracts.ts";
import { gaussian, type Rng } from "../../core/rng.ts";
import type { ActionId } from "./personalities.ts";

export interface Pose { x: number; y: number; z: number; pitch: number; grip: number; roll?: number; }
export type PhaseKind = "windup" | "active" | "follow" | "recover";

export interface PrimitiveContext {
  /** Current guard pose (tracking and sway included). */
  guard: Pose;
  /** Predicted contact point on the opponent (ego). */
  aim: Vec3;
  /** Lateral direction for hooks, parries and circles (+1 toward +y). */
  side: number;
  core: Vec3;
  dockSelf: Vec3;
  dockOpponent: Vec3;
  cube: Vec3;
  throwTarget: Vec3;
  /** Pose when the phase begins (filled by the instance). */
  from: Pose;
}

export interface PhaseDef {
  name: string;
  kind: PhaseKind;
  ms: number;
  to: (c: PrimitiveContext) => Pose;
  intents?: number;
  /** Pulse these intent bits for the first 60 ms of the phase. */
  pulse?: number;
  /** Aim noise applies to this phase's target. */
  noisy?: boolean;
}

/** Reaction and social beats (4.3, 4.5): taunts, hesitation, round-end beats, curiosity, fear, backstage. */
export type BeatId =
  | "BECKON" | "CHATTER" | "SHRUG" | "SLOW_REGUARD" | "WAVE_OFF" | "HESITATE" | "HOVER"
  | "CELEBRATE_BIG" | "CELEBRATE_COOL" | "CELEBRATE_MANIC" | "DEJECT" | "DECK_SLAM" | "SNIFF" | "FEAR" | "BACKSTAGE";
export type PrimitiveId = ActionId | "RATTLED" | "GUARD_HOLD" | BeatId;

export interface PrimitiveDef {
  id: PrimitiveId;
  phases: readonly PhaseDef[];
  cancelable: boolean;
  /** Fraction of the wind-up during which a cancel is allowed. */
  cancelWindow: number;
  leadMs: number;
  attack: boolean;
}

const pose = (x: number, y: number, z: number, pitch: number, grip: number): Pose => ({ x, y, z, pitch, grip });
const withXZ = (p: Pose, dx: number, dz: number): Pose => ({ ...p, x: p.x + dx, z: p.z + dz });
const rolled = (p: Pose, roll: number): Pose => ({ ...p, roll });
/** A fixed-time phase that holds the pose it started from. */
const hold = (name: string, kind: PhaseKind, ms: number, intents?: number): PhaseDef => ({ name, kind, ms, to: (c) => c.from, ...(intents ? { intents } : {}) });

/**
 * Tell floors per primitive (4.2): the total wind-up never runs shorter than this whatever the tier, personality,
 * DDA and timing noise say. SLAM's 300 ms is the floor for any heavy.
 */
export const TELL_MIN_MS: Readonly<Record<string, number>> = { POKE: 0, JAB: 90, HOOK: 150, SLAM: 300, WHIFF_PUNISH: 60, CORE_GRAB: 200, STEAL: 200, GRAB_THROW: 200 };
/** The Kabuki hold at the top of a SLAM (ms); the sparring wind-up stretches it through chargeHoldMs. */
export const SLAM_KABUKI_MS = 40;

/** Guard tool pitch and grip (5.5.2 GUARD). */
export const GUARD_PITCH = -0.3;
export const GUARD_Z = 0.15;
/**
 * GAME_DESIGN places the guard by the wrist_roll axis point (HOME_TIP_EGO = (0.20, 0, 0.15)); primitives steer the
 * gripperframe tip. The tip rides a little ahead of the axis point: far enough to present the jaws, short enough
 * that two guards at home keep a hand's width apart instead of shoving (a shove saturates both servos and cooks heat).
 */
export const TIP_FROM_ROLL_AXIS_M = 0.03;
const DOWN = -1.5;
const JAB_REACH_M = 0.11;
/** Rake geometry: hand this far past the Core (m), at this height, stopping this far past our dock centre. */
const RAKE_BEHIND_M = 0.045;
const STEAL_BEHIND_M = 0.03;
const RAKE_Z = 0.022;
const RAKE_HOVER_Z = 0.1;
const RAKE_PITCH = -0.7;
const RAKE_STOP_M = 0.035;
const HOOK_RADIUS_M = 0.32;
const REACH_MAX = 0.47;

function clampReach(p: Pose): Pose {
  const r = Math.hypot(p.x, p.y);
  if (r <= REACH_MAX) return p;
  const k = REACH_MAX / r;
  return { ...p, x: p.x * k, y: p.y * k };
}

/**
 * A straight strike from the guard toward the aim point, extended at most `reach` metres plus a 2 cm punch-through.
 * Amplitudes stay close to a player's jab (+10 cm for 160 ms): a strike that travels farther spends longer with the
 * servos saturated, and saturation is what heat charges for (4.5).
 */
function thrust(c: PrimitiveContext, reach: number): Pose {
  const dx = c.aim[0] - c.guard.x, dy = c.aim[1] - c.guard.y, dz = c.aim[2] - c.guard.z;
  const d = Math.hypot(dx, dy, dz);
  const k = d > 1e-6 ? Math.min(reach, d) / d : 0;
  const through = d > 1e-6 ? 0.02 / d : 0;
  return clampReach(pose(c.guard.x + dx * (k + through), c.guard.y + dy * (k + through), c.guard.z + dz * (k + through), GUARD_PITCH, GRIP_CLOSED));
}

function polar(r: number, psi: number, z: number, pitch: number, grip: number): Pose {
  return pose(r * Math.cos(psi), r * Math.sin(psi), z, pitch, grip);
}

const G = INTENT_BITS.guard;
const C = INTENT_BITS.charge;

export const PRIMITIVES: Readonly<Record<string, PrimitiveDef>> = {
  POKE: {
    id: "POKE", cancelable: false, cancelWindow: 0, leadMs: 40, attack: true,
    phases: [
      { name: "windup", kind: "windup", ms: 40, to: (c) => withXZ(c.guard, -0.01, 0) },
      { name: "active", kind: "active", ms: 70, to: (c) => clampReach({ ...c.guard, x: c.guard.x + 0.07, y: c.guard.y + (c.aim[1] - c.guard.y) * 0.5 }), noisy: true },
      { name: "follow", kind: "follow", ms: 30, to: (c) => c.from },
      { name: "recover", kind: "recover", ms: 120, to: (c) => c.guard },
    ],
  },
  JAB: {
    id: "JAB", cancelable: true, cancelWindow: 0.7, leadMs: 60, attack: true,
    phases: [
      { name: "windup", kind: "windup", ms: 90, to: (c) => withXZ(c.guard, -0.025, 0.01) },
      { name: "active", kind: "active", ms: 130, to: (c) => thrust(c, JAB_REACH_M), noisy: true },
      { name: "follow", kind: "follow", ms: 75, to: (c) => c.from },
      { name: "recover", kind: "recover", ms: 200, to: (c) => c.guard },
    ],
  },
  WHIFF_PUNISH: {
    id: "WHIFF_PUNISH", cancelable: false, cancelWindow: 0, leadMs: 70, attack: true,
    phases: [
      { name: "windup", kind: "windup", ms: 60, to: (c) => withXZ(c.guard, -0.015, 0.01) },
      { name: "active", kind: "active", ms: 120, to: (c) => thrust(c, JAB_REACH_M), noisy: true },
      { name: "follow", kind: "follow", ms: 70, to: (c) => c.from },
      { name: "recover", kind: "recover", ms: 200, to: (c) => c.guard },
    ],
  },
  HOOK: {
    id: "HOOK", cancelable: true, cancelWindow: 0.6, leadMs: 80, attack: true,
    phases: [
      { name: "windup", kind: "windup", ms: 220, to: (c) => polar(HOOK_RADIUS_M, 0.9 * c.side, 0.10, GUARD_PITCH, GRIP_CLOSED) },
      { name: "active", kind: "active", ms: 180, to: (c) => polar(HOOK_RADIUS_M, -0.4 * c.side, Math.max(0.06, Math.min(0.16, c.aim[2])), GUARD_PITCH, GRIP_CLOSED), noisy: true },
      { name: "follow", kind: "follow", ms: 80, to: (c) => polar(HOOK_RADIUS_M - 0.03, -0.5 * c.side, c.from.z, GUARD_PITCH, GRIP_CLOSED) },
      { name: "recover", kind: "recover", ms: 300, to: (c) => c.guard },
    ],
  },
  SLAM: {
    id: "SLAM", cancelable: true, cancelWindow: 0.8, leadMs: 60, attack: true,
    phases: [
      { name: "windup", kind: "windup", ms: 420, to: (c) => pose(0.20, c.aim[1] * 0.5, 0.26, -0.8, GRIP_CLOSED), intents: C },
      hold("kabuki", "windup", SLAM_KABUKI_MS, C),
      { name: "active", kind: "active", ms: 150, to: (c) => clampReach(pose(c.aim[0], c.aim[1], 0.03, -1.2, GRIP_CLOSED)), noisy: true },
      { name: "follow", kind: "follow", ms: 60, to: (c) => c.from },
      { name: "recover", kind: "recover", ms: 450, to: (c) => c.guard },
    ],
  },
  PARRY: {
    id: "PARRY", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "active", kind: "active", ms: 90, to: (c) => ({ ...c.guard, y: c.guard.y + 0.05 * c.side, z: c.guard.z + 0.02 }) },
      { name: "recover", kind: "recover", ms: 150, to: (c) => c.guard },
    ],
  },
  GUARD_HOLD: {
    id: "GUARD_HOLD", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "hold", kind: "active", ms: 420, to: (c) => ({ ...c.guard, x: c.guard.x - 0.02, z: c.guard.z + 0.01 }), intents: G },
      { name: "recover", kind: "recover", ms: 120, to: (c) => c.guard },
    ],
  },
  RATTLED: {
    id: "RATTLED", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "reel", kind: "active", ms: 250, to: (c) => withXZ(c.guard, -0.06, 0.04), intents: G },
    ],
  },
  // The Core is won by raking, not by grasping: the hand reaches past the Core, drops behind it, and draws it home
  // along the table into our own dock, then lifts clear. A top-down grasp at full reach tips the cube away (the jaws
  // cannot point straight down more than ~30 cm out), while a rake pulls it the way it has to go.
  CORE_GRAB: {
    id: "CORE_GRAB", cancelable: true, cancelWindow: 0.8, leadMs: 0, attack: false,
    phases: [
      { name: "reach_over", kind: "windup", ms: 260, to: (c) => clampReach(pose(c.core[0] + RAKE_BEHIND_M, c.core[1], RAKE_HOVER_Z, RAKE_PITCH, GRIP_CLOSED)) },
      { name: "drop_behind", kind: "active", ms: 160, to: (c) => clampReach(pose(c.core[0] + RAKE_BEHIND_M, c.core[1], RAKE_Z, RAKE_PITCH, GRIP_CLOSED)), noisy: true },
      { name: "draw_home", kind: "follow", ms: 700, to: (c) => pose(c.dockSelf[0] + RAKE_STOP_M, c.dockSelf[1], RAKE_Z, RAKE_PITCH, GRIP_CLOSED) },
      { name: "settle", kind: "follow", ms: 180, to: (c) => c.from },
      { name: "lift_clear", kind: "recover", ms: 260, to: (c) => ({ ...c.from, x: c.from.x + 0.02, z: RAKE_HOVER_Z }) },
    ],
  },
  CORE_DOCK: {
    id: "CORE_DOCK", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "carry", kind: "windup", ms: 300, to: (c) => pose(c.dockSelf[0], c.dockSelf[1], 0.05, DOWN, GRIP_CLOSED) },
      { name: "lower", kind: "active", ms: 250, to: (c) => pose(c.dockSelf[0], c.dockSelf[1], 0.025, DOWN, GRIP_CLOSED) },
      { name: "open", kind: "follow", ms: 120, to: (c) => ({ ...c.from, grip: GRIP_OPEN }) },
      { name: "retreat", kind: "recover", ms: 200, to: (c) => c.guard },
    ],
  },
  // A steal is a rake from behind the opponent's dock: the Core leaves their dock (a steal, D8) and keeps coming home.
  STEAL: {
    id: "STEAL", cancelable: true, cancelWindow: 0.6, leadMs: 0, attack: false,
    phases: [
      { name: "reach_over", kind: "windup", ms: 240, to: (c) => clampReach(pose(c.core[0] + STEAL_BEHIND_M, c.core[1], RAKE_HOVER_Z, RAKE_PITCH, GRIP_CLOSED)) },
      { name: "drop_behind", kind: "active", ms: 150, to: (c) => clampReach(pose(c.core[0] + STEAL_BEHIND_M, c.core[1], RAKE_Z, RAKE_PITCH, GRIP_CLOSED)), noisy: true },
      { name: "drag", kind: "follow", ms: 820, to: (c) => pose(c.dockSelf[0] + RAKE_STOP_M, c.dockSelf[1], RAKE_Z, RAKE_PITCH, GRIP_CLOSED) },
      { name: "settle", kind: "follow", ms: 180, to: (c) => c.from },
      { name: "lift_clear", kind: "recover", ms: 260, to: (c) => ({ ...c.from, x: c.from.x + 0.02, z: RAKE_HOVER_Z }) },
    ],
  },
  GRAB_THROW: {
    id: "GRAB_THROW", cancelable: true, cancelWindow: 0.8, leadMs: 0, attack: false,
    phases: [
      { name: "approach", kind: "windup", ms: 200, to: (c) => pose(c.cube[0], c.cube[1], 0.08, DOWN, GRIP_OPEN) },
      { name: "descend", kind: "windup", ms: 150, to: (c) => pose(c.cube[0], c.cube[1], 0.025, DOWN, GRIP_OPEN) },
      { name: "close", kind: "active", ms: 120, to: (c) => ({ ...c.from, grip: GRIP_CLOSED }) },
      { name: "lift", kind: "active", ms: 130, to: (c) => ({ ...c.from, z: 0.16, grip: GRIP_CLOSED }) },
      { name: "fling", kind: "follow", ms: 120, to: (c) => clampReach(pose(c.throwTarget[0], c.throwTarget[1], 0.14, -0.2, GRIP_CLOSED)) },
      { name: "release", kind: "follow", ms: 80, to: (c) => clampReach({ ...c.from, x: c.from.x + 0.03, grip: GRIP_OPEN }) },
      { name: "recover", kind: "recover", ms: 300, to: (c) => c.guard },
    ],
  },
  ADVANCE: {
    id: "ADVANCE", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [{ name: "step", kind: "recover", ms: 650, to: (c) => clampReach({ ...c.guard, x: c.guard.x + 0.03 }) }],
  },
  RETREAT: {
    id: "RETREAT", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [{ name: "step", kind: "recover", ms: 650, to: (c) => ({ ...c.guard, x: Math.max(0.2, c.guard.x - 0.03) }) }],
  },
  CIRCLE: {
    id: "CIRCLE", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [{
      name: "orbit", kind: "recover", ms: 520,
      to: (c) => { const r = Math.hypot(c.guard.x, c.guard.y); const psi = Math.atan2(c.guard.y, c.guard.x) + 0.22 * c.side; return polar(r, psi, c.guard.z, c.guard.pitch, c.guard.grip); },
    }],
  },
  /* ── taunts (4.3): 400–900 ms of real vulnerability ── */
  BECKON: {
    id: "BECKON", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "up1", kind: "active", ms: 250, to: (c) => ({ ...c.guard, pitch: c.guard.pitch - 0.25, grip: GRIP_OPEN }) },
      { name: "down1", kind: "active", ms: 250, to: (c) => ({ ...c.from, pitch: c.guard.pitch + 0.10, grip: GRIP_CLOSED }) },
      { name: "up2", kind: "active", ms: 250, to: (c) => ({ ...c.from, pitch: c.guard.pitch - 0.25, grip: GRIP_OPEN }) },
      { name: "down2", kind: "active", ms: 250, to: (c) => ({ ...c.from, pitch: c.guard.pitch + 0.10, grip: GRIP_CLOSED }) },
      { name: "reguard", kind: "recover", ms: 150, to: (c) => c.guard },
    ],
  },
  CHATTER: {
    id: "CHATTER", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      ...[0, 1, 2, 3, 4, 5].map((i): PhaseDef => ({ name: `jaw${i}`, kind: "active", ms: 72, to: (c) => ({ ...c.guard, grip: i % 2 === 0 ? GRIP_OPEN : GRIP_CLOSED }) })),
      { name: "reguard", kind: "recover", ms: 120, to: (c) => c.guard },
    ],
  },
  SHRUG: {
    id: "SHRUG", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "lift", kind: "active", ms: 220, to: (c) => ({ ...c.guard, z: c.guard.z + 0.04, pitch: c.guard.pitch + 0.35, grip: GRIP_OPEN }) },
      hold("hold", "active", 300),
      { name: "reguard", kind: "recover", ms: 260, to: (c) => c.guard },
    ],
  },
  SLOW_REGUARD: {
    id: "SLOW_REGUARD", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [{ name: "reguard", kind: "active", ms: 500, to: (c) => c.guard }],
  },
  WAVE_OFF: {
    id: "WAVE_OFF", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "out1", kind: "active", ms: 200, to: (c) => ({ ...c.guard, y: c.guard.y + 0.06, pitch: c.guard.pitch + 0.2, grip: GRIP_OPEN }) },
      { name: "back1", kind: "active", ms: 200, to: (c) => ({ ...c.from, y: c.guard.y - 0.06 }) },
      { name: "out2", kind: "active", ms: 200, to: (c) => ({ ...c.from, y: c.guard.y + 0.06 }) },
      { name: "reguard", kind: "recover", ms: 260, to: (c) => c.guard },
    ],
  },
  /* ── hesitation and hover (4.3): the AI's most punishable states ── */
  HESITATE: {
    id: "HESITATE", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "tell", kind: "windup", ms: 40, to: (c) => withXZ(c.guard, -0.01, 0.004) },
      hold("pause", "active", 220),
      { name: "retreat", kind: "active", ms: 120, to: (c) => ({ ...c.from, x: Math.max(0.2, c.from.x - 0.04) }) },
      { name: "reguard", kind: "recover", ms: 150, to: (c) => c.guard },
    ],
  },
  HOVER: {
    id: "HOVER", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      ...[0, 1, 2, 3].map((i): PhaseDef => ({ name: `hover${i}`, kind: "active", ms: 167, to: (c) => ({ ...c.guard, x: c.guard.x + (i % 2 === 0 ? 0.02 : -0.02) }) })),
      { name: "reguard", kind: "recover", ms: 120, to: (c) => c.guard },
    ],
  },
  /* ── round-end beats (4.3) ── */
  CELEBRATE_BIG: {
    id: "CELEBRATE_BIG", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "stretch", kind: "active", ms: 300, to: (c) => ({ ...c.guard, z: c.guard.z + 0.14, pitch: 0.5, grip: GRIP_OPEN }) },
      ...[0, 1, 2, 3, 4, 5, 6].map((i): PhaseDef => ({ name: `roll${i}`, kind: "active", ms: 167, to: (c) => rolled(c.from, i % 2 === 0 ? 0.6 : -0.6) })),
      { name: "bow1", kind: "follow", ms: 350, to: (c) => rolled({ ...c.from, z: c.from.z - 0.06, pitch: -0.6 }, 0) },
      { name: "up1", kind: "follow", ms: 300, to: (c) => ({ ...c.from, z: c.from.z + 0.06, pitch: 0.3 }) },
      { name: "bow2", kind: "follow", ms: 350, to: (c) => ({ ...c.from, z: c.from.z - 0.06, pitch: -0.6 }) },
      { name: "reguard", kind: "recover", ms: 500, to: (c) => c.guard },
    ],
  },
  CELEBRATE_COOL: {
    id: "CELEBRATE_COOL", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "nod", kind: "active", ms: 450, to: (c) => ({ ...c.guard, pitch: c.guard.pitch - 0.25 }) },
      { name: "nod_back", kind: "active", ms: 450, to: (c) => c.guard },
      { name: "open", kind: "follow", ms: 220, to: (c) => ({ ...c.from, grip: GRIP_OPEN }) },
      { name: "close", kind: "follow", ms: 220, to: (c) => ({ ...c.from, grip: GRIP_CLOSED }) },
      hold("still", "recover", 600),
    ],
  },
  CELEBRATE_MANIC: {
    id: "CELEBRATE_MANIC", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): PhaseDef => ({ name: `hop${i}`, kind: "active", ms: 75, to: (c) => ({ ...c.guard, z: c.guard.z + (i % 2 === 0 ? 0.05 : 0), grip: i % 2 === 0 ? GRIP_OPEN : GRIP_CLOSED }) })),
      { name: "snap_guard", kind: "recover", ms: 120, to: (c) => c.guard },
    ],
  },
  DEJECT: {
    id: "DEJECT", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "sink", kind: "active", ms: 600, to: (c) => ({ ...c.guard, x: c.guard.x - 0.05, z: c.guard.z - 0.08, pitch: 0.6, grip: GRIP_CLOSED }) },
      hold("hold", "active", 1900),
      { name: "pan_away", kind: "follow", ms: 800, to: (c) => ({ ...c.from, y: c.from.y + 0.06 * c.side }) },
      hold("glance_back", "follow", 500),
      { name: "reguard", kind: "recover", ms: 700, to: (c) => c.guard },
    ],
  },
  DECK_SLAM: {
    id: "DECK_SLAM", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "raise", kind: "windup", ms: 200, to: (c) => ({ ...c.guard, z: c.guard.z + 0.08, pitch: -1.0 }) },
      { name: "slam", kind: "active", ms: 120, to: (c) => ({ ...c.from, z: 0.03, pitch: -1.3 }) },
      hold("rest", "follow", 250),
    ],
  },
  /* ── curiosity, fear, backstage (4.3, 4.5) ── */
  SNIFF: {
    id: "SNIFF", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "approach", kind: "windup", ms: 500, to: (c) => clampReach(pose(c.core[0], c.core[1], c.core[2] + 0.09, -1.0, GRIP_CLOSED)) },
      hold("pause1", "windup", 300),
      { name: "lower", kind: "active", ms: 350, to: (c) => clampReach(pose(c.core[0], c.core[1], c.core[2] + 0.035, -1.1, GRIP_OPEN)) },
      { name: "jaw_close", kind: "active", ms: 500, to: (c) => ({ ...c.from, grip: GRIP_CLOSED }) },
      { name: "jaw_open", kind: "active", ms: 500, to: (c) => ({ ...c.from, grip: GRIP_OPEN }) },
      hold("pause2", "active", 300),
      { name: "lift", kind: "follow", ms: 300, to: (c) => ({ ...c.from, z: c.from.z + 0.06, grip: GRIP_CLOSED }) },
      { name: "reguard", kind: "recover", ms: 500, to: (c) => c.guard },
    ],
  },
  FEAR: {
    id: "FEAR", cancelable: false, cancelWindow: 0, leadMs: 0, attack: false,
    phases: [
      { name: "recoil", kind: "active", ms: 120, to: (c) => ({ ...c.guard, x: Math.max(0.2, c.guard.x - 0.06), z: c.guard.z + 0.05, grip: GRIP_CLOSED }), intents: G },
      hold("guard_high", "active", 2600, G),
      { name: "reguard", kind: "recover", ms: 300, to: (c) => c.guard },
    ],
  },
  BACKSTAGE: {
    id: "BACKSTAGE", cancelable: true, cancelWindow: 1, leadMs: 0, attack: false,
    phases: [
      { name: "retreat", kind: "windup", ms: 500, to: (c) => ({ ...c.guard, x: 0.16 + TIP_FROM_ROLL_AXIS_M, z: c.guard.z + 0.01 }) },
      hold("breathe", "active", 1800),
      { name: "return", kind: "recover", ms: 450, to: (c) => c.guard },
    ],
  },
};

/** Strike-like primitives the selector can choose. */
export const ATTACK_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(["POKE", "JAB", "HOOK", "SLAM", "WHIFF_PUNISH"]);

export interface InstancePhase {
  def: PhaseDef;
  startT: number;
  endT: number;
  from: Pose | null;
  target: Pose | null;
}

export interface InstanceOptions {
  durationScale: number;
  /** Extra scale on wind-up phases (personality, DDA, tier). */
  windupScale: number;
  recoverScale: number;
  /** Aim noise (ego metres), sampled once. */
  noise: Vec3;
  /** Absolute guard-press time (PARRY) or −1. */
  pressT: number;
  /** SLAM: extra hold past full charge before release (ms), spent at the Kabuki top. */
  chargeHoldMs: number;
  /** Time-warp exponent on every phase (4.4 ease): < 1 snappy ease-out, 1 min-jerk, > 1 lazy ease-in. */
  easeExp?: number;
  /** Amplitude jitter (4.4): scale on the displacement of noisy phases from the guard. */
  ampScale?: number;
}

/** Samples noise once per primitive: σ = (base + k·speed)·(1.4 − 0.6·composure), duration log-normal with CV. */
export function samplePrimitiveNoise(rng: Rng, posBaseMm: number, posPerMpsMm: number, demandedSpeed: number, composure: number, noiseMul: number, timingCv: number): { noise: Vec3; durationScale: number } {
  const sigma = ((posBaseMm + posPerMpsMm * demandedSpeed) / 1000) * (1.4 - 0.6 * composure) * noiseMul;
  const noise: Vec3 = [gaussian(rng, 0, sigma), gaussian(rng, 0, sigma), gaussian(rng, 0, sigma * 0.6)];
  const durationScale = Math.exp(gaussian(rng, 0, timingCv));
  return { noise, durationScale };
}

export class PrimitiveInstance {
  readonly def: PrimitiveDef;
  readonly phases: InstancePhase[];
  readonly startT: number;
  readonly endT: number;
  readonly opts: InstanceOptions;
  /** Set when the primitive was cancelled back to guard. */
  cancelledAt = -1;

  constructor(def: PrimitiveDef, startT: number, opts: InstanceOptions) {
    this.def = def;
    this.startT = startT;
    this.opts = opts;
    // Tell floor (4.2): the wind-up phases scale up together when noise or a tier would cut them short.
    let windMs = 0;
    for (const p of def.phases) if (p.kind === "windup") windMs += p.ms * opts.durationScale * opts.windupScale;
    const floor = TELL_MIN_MS[def.id] ?? 0;
    const windFix = windMs > 0 && windMs < floor ? floor / windMs : 1;
    let t = startT;
    this.phases = def.phases.map((p) => {
      let ms = p.ms * opts.durationScale;
      if (p.kind === "windup") ms *= opts.windupScale * windFix;
      if (p.kind === "recover") ms *= opts.recoverScale;
      if (def.id === "SLAM" && p.name === "kabuki") ms += opts.chargeHoldMs;
      const ph: InstancePhase = { def: p, startT: t, endT: t + ms / 1000, from: null, target: null };
      t = ph.endT;
      return ph;
    });
    this.endT = t;
  }

  /** Releases a SLAM held at the Kabuki top (the sparring cue): the hold ends at t and the strike follows. */
  releaseHold(t: number): void {
    const i = this.phases.findIndex((ph) => ph.def.name === "kabuki");
    if (i < 0) return;
    const ph = this.phases[i];
    if (t < ph.startT || t >= ph.endT - 1e-9) return;
    const shift = ph.endT - t;
    ph.endT = t;
    for (let k = i + 1; k < this.phases.length; k++) { this.phases[k].startT -= shift; this.phases[k].endT -= shift; }
    (this as { endT: number }).endT -= shift;
  }

  /** When the strike phase begins (the first "active" phase), or the end when there is none. */
  get activeStartT(): number {
    for (const ph of this.phases) if (ph.def.kind === "active") return ph.startT;
    return this.endT;
  }

  phaseIndexAt(t: number): number {
    for (let i = 0; i < this.phases.length; i++) if (t < this.phases[i].endT - 1e-9) return i;
    return this.phases.length;
  }

  /** Resolves every phase target that has begun by t (in order). */
  resolve(t: number, ctx: PrimitiveContext, current: Pose): void {
    for (let i = 0; i < this.phases.length; i++) {
      const ph = this.phases[i];
      if (ph.startT > t + 1e-9) break;
      if (ph.target) continue;
      ph.from = i === 0 ? { ...current } : { ...(this.phases[i - 1].target as Pose) };
      ctx.from = ph.from;
      const target = ph.def.to(ctx);
      if (ph.def.noisy) {
        const k = this.opts.ampScale ?? 1;
        if (k !== 1) {
          target.x = ctx.guard.x + (target.x - ctx.guard.x) * k; target.y = ctx.guard.y + (target.y - ctx.guard.y) * k;
          target.z = ctx.guard.z + (target.z - ctx.guard.z) * k;
        }
        target.x += this.opts.noise[0]; target.y += this.opts.noise[1]; target.z = Math.max(0.02, target.z + this.opts.noise[2]);
      }
      ph.target = target;
    }
  }

  get phaseCount(): number { return this.phases.length; }

  /** Pose at time t; phases not yet resolved hold the last resolved target. */
  sample(t: number, out: Pose): Pose {
    let i = this.phaseIndexAt(t);
    if (i >= this.phases.length) i = this.phases.length - 1;
    let ph = this.phases[i];
    while (!ph.target && i > 0) { i--; ph = this.phases[i]; t = ph.endT; }
    if (!ph.target || !ph.from) return out;
    const dur = ph.endT - ph.startT;
    let tau = dur > 0 ? Math.min(1, Math.max(0, (t - ph.startT) / dur)) : 1;
    const e = this.opts.easeExp ?? 1;
    if (e !== 1) tau = Math.pow(tau, e);
    minJerkCylindrical(ph.from, ph.target, tau, out);
    return out;
  }

  intentsAt(t: number): number {
    const i = this.phaseIndexAt(t);
    if (i >= this.phases.length) return 0;
    const ph = this.phases[i];
    let bits = ph.def.intents ?? 0;
    if (ph.def.pulse && t - ph.startT < 0.06) bits |= ph.def.pulse;
    if (this.opts.pressT >= 0 && t >= this.opts.pressT && t < this.opts.pressT + 0.2) bits |= G;
    return bits;
  }

  kindAt(t: number): PhaseKind | "done" {
    const i = this.phaseIndexAt(t);
    return i >= this.phases.length ? "done" : this.phases[i].def.kind;
  }

  /** Progress through the wind-up (0..1), or 1 once past it. */
  windupProgress(t: number): number {
    let start = -1, end = -1;
    for (const ph of this.phases) {
      if (ph.def.kind !== "windup") continue;
      if (start < 0) start = ph.startT;
      end = ph.endT;
    }
    if (start < 0) return 1;
    return Math.min(1, Math.max(0, (t - start) / Math.max(1e-6, end - start)));
  }
}

function minJerk(tau: number): number {
  return tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);
}

/** Minimum-jerk blend a → b with position interpolated in (r, ψ, z) about the base. */
export function minJerkCylindrical(a: Pose, b: Pose, tau: number, out: Pose): Pose {
  const s = minJerk(tau);
  const ra = Math.hypot(a.x, a.y), rb = Math.hypot(b.x, b.y);
  const pa = Math.atan2(a.y, a.x), pb = Math.atan2(b.y, b.x);
  let dp = pb - pa;
  if (dp > Math.PI) dp -= 2 * Math.PI; else if (dp < -Math.PI) dp += 2 * Math.PI;
  const r = ra + (rb - ra) * s;
  const psi = pa + dp * s;
  out.x = r * Math.cos(psi); out.y = r * Math.sin(psi);
  out.z = a.z + (b.z - a.z) * s;
  out.pitch = a.pitch + (b.pitch - a.pitch) * s;
  const ra0 = a.roll ?? 0, rb0 = b.roll ?? 0;
  out.roll = ra0 + (rb0 - ra0) * s;
  // Jaws snap like a servo command, not a blend: the target switches at the phase midpoint.
  out.grip = tau < 0.5 ? a.grip : b.grip;
  return out;
}

/** Guard pose for a roll-axis x (the design's guard numbers), as a tip target. */
export function guardPose(rollAxisX: number, y: number): Pose {
  return pose(rollAxisX + TIP_FROM_ROLL_AXIS_M, y, GUARD_Z, GUARD_PITCH, GRIP_CLOSED);
}
