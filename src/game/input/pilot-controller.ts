// src/game/input/pilot-controller.ts (WP3)
// The human command layer (GAME_DESIGN 3.1–3.5). The player never moves the arm: they move a massless COMMAND
// (yaw, elevation, reach, tool, roll, grip) that the servos chase. Mouse, gamepad, touch, and synthetic input all
// land in one command path:
//
//   raw input (deltas, held sources, edges) ──► sampleFrame: aim + macros, same frame ──► ghost, reticle, range cue
//                                            └─ 250 ms low-pass of aim yaw/elev ──► stance ──► look (camera)
//   every physics step: writeCommand ──► guard blend / grab assist / dock magnet ──► commandToJoints ──► leash ──► ctrl
//
// There is no smoothing, rate limit, or acceleration on any fight axis; the servo is the smoother. The only filter
// is the camera stance. The input clock stops during a hit stop, so deltas and edges queued in a freeze apply on the
// first post-freeze frame and a guard press made in a freeze carries the post-freeze step's sim time.
//
// EMOTION_BIBLE section 3: `command` is the recorded human.command and is captured before any life layer. The
// command-side life (breath, idle break, action break: 3.2), the boot ritual pose (3.4), the section 6
// streamlining (reticle magnetism, aim-brake, the 150 ms buffer across a freeze) and the match-1 assists (reach
// depth tracking, auto-grip on Core contact) all shape the written ctrl after it, flagged in `shaping`. The LED
// state machine (3.3) and the reticle range state (ReticleState) are published from here; tremor is render-only.

import {
  CORE_CUBE_INDEX, GRIP_CLOSED, GRIP_OPEN, JOINT_LIMITS, LINK_IDS, TOKEN_HEX, noIntents,
  type CombatSnapshot, type CommandState, type CreatePilotController, type GameEvent, type GhostPose, type InputDevice,
  type InputShapingFlags, type Intents, type LedFrame, type LedState, type PhysicsFrame, type PilotController, type PilotMode,
  type PilotRules, type RangeCue, type ReticleState, type Seat, type SettingsStore, type So101Kinematics, type GameClock,
  type SyntheticInput, type TouchInput, type Vec3,
} from "../contracts.ts";
import {
  ELEV_MAX, ELEV_MIN, RANGE_TOLERANCE_M, REACH_MAX, REACH_MIN, YAW_LIMIT,
  blendGuard, clampAssistCommand, clampCommand, computeRangeCue, copyCommand, coreOverOwnDock, createAssistScratch, dockCommand,
  egoToWorld, findGrabCube, grabCommand, guardCommand, opponentYaw, solveRollAxisCommand, targetReachDelta, wrapPi,
} from "./assists.ts";
import { createAnalogFrame, createGamepadReader, REACH_CREEP_THRESHOLD, type AnalogFrame, type GamepadReader } from "./gamepad.ts";
import { createInputSystem, type InputSystem, type RawEdge, type UiInput } from "./input-system.ts";
import { createSyntheticInput } from "./synthetic-input.ts";
import { createTwoPole, resetTwoPole, stepTwoPole } from "../camera/springs.ts";
import { createTouchChannel } from "./touch-input.ts";

/* ── tuning (3.1.1, 3.1.2, 3.2, 3.3, 3.4, 3.5) ── */
export const MOUSE_RAD_PER_COUNT = 0.0015;
/**
 * Camera stance filter (3.2 "250 ms low-pass"). Realised as a critically damped two-pole, 2 x 140 ms: a held aim
 * settles to 63% in about 0.3 s like the nominal 250 ms one-pole, but a 6 Hz flick exchange leaks 3x less camera yaw
 * (a single 250 ms pole moves the view about 4 degrees peak to peak on a 1.4 rad exchange; the two-pole stays under 2).
 */
export const STANCE_POLE_TAU_S = 0.14;
export const STANCE_DRIFT_RAD_S = 1.6;
export const SWING_YAW_RAD = 0.9;
export const SWING_ELEV_RAD = 0.5;
export const REACH_OUT_M = 0.12;
export const REACH_IN_M = -0.08;
export const REACH_CREEP_DELAY_S = 0.4;
export const REACH_CREEP_M_S = 0.25;
export const R_STANCE_MIN = 0.14;
export const R_STANCE_MAX = 0.36;
export const JAB_TAP_MAX_MS = 180;
export const JAB_OFFSET_M = 0.1;
export const JAB_MS = 160;
export const CHARGE_RAMP_MS = 600;
export const CHARGE_HOLD_MAX_MS = 1000;
export const CHARGE_SENSITIVITY = 0.75;
export const WINDUP_REACH_M = -0.06;
export const WINDUP_TOOL = -0.5;
export const WINDUP_YAW = 0.45;
export const WINDUP_HISTORY_MS = 150;
export const HEAVY_TOOL = 0.5;
export const HEAVY_MS = 250;
export const GUARD_YAW_RATE = 2.0;
export const ROLL_RATE = 5.0;
export const TOOL_NOTCH = 0.15;
export const EDGE_BUFFER_MS = 100;
export const ENGAGE_REPLAY_MS = 150;
export const LEASH_RAD = 0.6;
export const GRAB_OPEN_MS = 120;
export const RELEASE_OPEN_MS = 250;
export const DOCK_MAGNET_MS = 150;
export const LOOK_YAW_MAX = (24 * Math.PI) / 180;
export const LOOK_PITCH_MAX = (10 * Math.PI) / 180;
/**
 * Share of the settled stance the view turns by. Kept well under half so the arm visibly sweeps across a steady
 * view (moving the mouse swings the arm, it does not turn your head); at 0.45 the world swung with the aim.
 */
export const LOOK_GAIN = { standard: { yaw: 0.32, pitch: 0.22 }, stable: { yaw: 0.15, pitch: 0.09 } } as const;
export const LOBBY_IDLE_MS = 3000;
const MAX_SAMPLE_DT = 0.1;

/* ── life without moving the hitbox (3.2), LED faces (3.3), rituals (3.4), streamlining (section 6) ── */
const DEG = Math.PI / 180;
export const BREATH_HZ = 0.28;
export const BREATH_WRIST_RAD = 0.15 * DEG;
export const BREATH_JAW_RAD = 1.5 * DEG;
export const BREATH_JAW_LAG_S = 0.35;
export const BREATH_VEL_GATE_RAD_S = 0.6;
export const IDLE_BREAK_MIN_S = 6;
export const IDLE_BREAK_MAX_S = 14;
export const IDLE_BREAK_MS = 700;
export const IDLE_BREAK_NO_INPUT_S = 2.5;
export const IDLE_BREAK_RANGE_K = 1.3;
export const IDLE_BREAK_CORE_M = 0.4;
export const ACTION_BREAK_DELAY_MS = 250;
export const ACTION_BREAK_RAD = 2.5 * DEG;
export const ACTION_BREAK_TAU_S = 0.22 / 4;   // critically damped bump that has settled by 220 ms
export const TREMOR_ERR_RAD = 0.02;
export const TREMOR_MM = { base: 0.1, hot: 0.6 } as const;
export const MAGNET_MAX_RAD = 3 * DEG;
export const MAGNET_CONE_RAD = 12 * DEG;
export const MAGNET_TAU_S = 0.12;
export const MAGNET_MOUSE_COUNTS_S = 200;
export const FREEZE_EDGE_BUFFER_MS = 150;
export const REACH_TRACK_TAU_S = 0.15;
export const AUTO_GRIP_RELEASE_MS = 300;
export const RITUAL_JOINT_MS = 110;
export const RITUAL_JOINT_BUMP_RAD = 0.25;
export const RITUAL_EYES_MS = 400;
export const LED_COMMIT_FLARE_MS = 60;
export const LED_COMMIT_RAMP_MS = 300;
export const LED_WHIFF_MS = 250;
export const LED_STAGGER_MS = 400;
export const LED_SHORT_MS = 150;
export const LED_SHORT_BLIP_MS = 900;
export const LED_HOT_HEAT = 80;
/** Gripper "target" stage (3.4): jaws open +8° while a cube is inside the grab radius and the LED tints toward volt. */
export const GRIP_TARGET_OPEN_RAD = (8 * Math.PI) / 180;
export type GripStage = "none" | "target" | "lock" | "contact";
export const LED_DROPOUT_HZ = 0.5;

/** Idle break choices (3.2): one of jaw-check / roll-settle / knuckle; never pan or lift. */
export type IdleBreakKind = "jaw" | "roll" | "knuckle";
const IDLE_BREAKS: readonly IdleBreakKind[] = ["jaw", "roll", "knuckle"];

/** sRGB hex → linear rgb, for LED colours (WP2's uniform takes linear). */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
/** One colour, one meaning (3.3). */
export const LED_HEX = {
  team: TOKEN_HEX.cobalt, amber: "#FFB020", cyan: TOKEN_HEX.block, volt: TOKEN_HEX.volt, orange: TOKEN_HEX.signal,
  red: "#FF2A2A", white: "#FFFFFF",
} as const;
const LED_RGB: Record<keyof typeof LED_HEX, [number, number, number]> = {
  team: hexToLinear(LED_HEX.team), amber: hexToLinear(LED_HEX.amber), cyan: hexToLinear(LED_HEX.cyan), volt: hexToLinear(LED_HEX.volt),
  orange: hexToLinear(LED_HEX.orange), red: hexToLinear(LED_HEX.red), white: hexToLinear(LED_HEX.white),
};
const GRIPPER_LINKS = new Set<number>([LINK_IDS.indexOf("gripper"), LINK_IDS.indexOf("moving_jaw")]);
const BASE_LINK = LINK_IDS.indexOf("base");

export interface LedInputs {
  /** Wall ms on the pilot clock. */
  nowMs: number;
  /** null = no match / powered down; "boot" during the ritual; "lowered" between phases; "ready" live. */
  power: "off" | "boot" | "lowered" | "ready";
  bootSteady: boolean;                 // ritual self-test finished: steady amber instead of the 3 Hz blink
  guard: boolean; grip: boolean; gripForce01: number; gripTarget: boolean;
  heat01: number; integrity01: number;
  inStrikeRange: boolean;              // stillness = tension: no breathing inside range
  commitAtMs: number; whiffAtMs: number; staggerAtMs: number; shortAtMs: number;   // -Infinity when never
}

/** The pilot LED state machine (3.3): resolves the state and writes the per-link (r, g, b, i) rows. */
export function computeLed(inp: LedInputs, out: LedFrame): LedFrame {
  const t = inp.nowMs;
  const since = (at: number) => t - at;
  let state: LedState;
  let colour: [number, number, number] = LED_RGB.team;
  let intensity = 1;
  const breath = inp.inStrikeRange ? 1 : 0.875 + 0.125 * Math.sin(2 * Math.PI * BREATH_HZ * (t / 1000));
  if (since(inp.shortAtMs) >= 0 && since(inp.shortAtMs) < 4000) {
    state = "shorted";
    const u = since(inp.shortAtMs);
    intensity = u < LED_SHORT_MS ? 1 - u / LED_SHORT_MS : Math.abs(u - LED_SHORT_BLIP_MS) < 60 ? 0.6 : 0;
    colour = u < LED_SHORT_MS ? LED_RGB.team : LED_RGB.amber;
  } else if (inp.power === "off") {
    state = "off";
    colour = LED_RGB.amber;
    intensity = ((t / 1000) % 2) < 0.08 ? 0.6 : 0;      // one 0.5 Hz amber blip on the base only (below)
  } else if (inp.power === "boot") {
    state = "boot";
    colour = LED_RGB.amber;
    intensity = inp.bootSteady ? 1 : (Math.floor(t / (1000 / 3 / 2)) % 2 === 0 ? 1 : 0.1);
  } else if (since(inp.staggerAtMs) >= 0 && since(inp.staggerAtMs) < LED_STAGGER_MS + 600) {
    state = "stagger";
    const u = since(inp.staggerAtMs);
    colour = LED_RGB.red;
    intensity = u < LED_STAGGER_MS ? (Math.floor(u / (1000 / 12 / 2)) % 2 === 0 ? 1 : 0.15) : 0.2;
  } else if (inp.power === "lowered") {
    state = "lowered";
    intensity = 0.4 * breath;
  } else if (inp.heat01 * 100 > LED_HOT_HEAT) {
    state = "hot";
    const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * (t / 1000));
    colour = [LED_RGB.team[0] + (LED_RGB.orange[0] - LED_RGB.team[0]) * k, LED_RGB.team[1] + (LED_RGB.orange[1] - LED_RGB.team[1]) * k, LED_RGB.team[2] + (LED_RGB.orange[2] - LED_RGB.team[2]) * k];
  } else if (inp.grip) {
    state = "grip";
    const hz = 1 + 3 * Math.max(0, Math.min(1, inp.gripForce01));
    intensity = 0.7 + 0.3 * Math.sin(2 * Math.PI * hz * (t / 1000));
  } else if (inp.guard) {
    state = "guard";
    colour = LED_RGB.cyan;
  } else if (since(inp.commitAtMs) >= 0 && since(inp.commitAtMs) < LED_COMMIT_FLARE_MS + LED_COMMIT_RAMP_MS) {
    state = "commit";
    const u = since(inp.commitAtMs);
    const w = u < LED_COMMIT_FLARE_MS ? 1 : 1 - (u - LED_COMMIT_FLARE_MS) / LED_COMMIT_RAMP_MS;
    colour = [LED_RGB.team[0] + (1 - LED_RGB.team[0]) * w, LED_RGB.team[1] + (1 - LED_RGB.team[1]) * w, LED_RGB.team[2] + (1 - LED_RGB.team[2]) * w];
    intensity = 1 + 0.6 * w;
  } else if (since(inp.whiffAtMs) >= 0 && since(inp.whiffAtMs) < LED_WHIFF_MS) {
    state = "ready";                                     // amber = behind the command, 250 ms
    colour = LED_RGB.amber;
  } else {
    state = "ready";
    intensity = breath;
  }
  out.state = state;
  out.colour = colour;
  out.intensity = intensity;
  const p = out.perLink;
  for (let l = 0; l < LINK_IDS.length; l++) {
    let c = colour;
    let i = intensity;
    if (state === "off" && l !== BASE_LINK) i = 0;
    if (state === "grip") {
      if (GRIPPER_LINKS.has(l)) c = LED_RGB.volt; else i = breath;
    } else if (state === "ready" && inp.gripTarget && GRIPPER_LINKS.has(l)) {
      c = [(c[0] + LED_RGB.volt[0]) * 0.5, (c[1] + LED_RGB.volt[1]) * 0.5, (c[2] + LED_RGB.volt[2]) * 0.5];
    }
    // Damage worn on the body (3.4): below 40 % one link drops out at random, below 20 % two (30–90 ms at 0.5 Hz).
    if (inp.integrity01 < 0.4 && state !== "off" && state !== "shorted") {
      const slot = Math.floor(t / (1000 / LED_DROPOUT_HZ));
      const r = hash01(slot * 7 + 1);
      const drop1 = Math.floor(r * LINK_IDS.length);
      const drop2 = Math.floor(hash01(slot * 7 + 3) * LINK_IDS.length);
      const phase = t - slot * (1000 / LED_DROPOUT_HZ);
      const dur = 30 + 60 * hash01(slot * 7 + 5);
      if (phase < dur && (l === drop1 || (inp.integrity01 < 0.2 && l === drop2))) i = 0;
    }
    p[l * 4] = c[0]; p[l * 4 + 1] = c[1]; p[l * 4 + 2] = c[2]; p[l * 4 + 3] = i;
  }
  return out;
}

/** Deterministic 0..1 hash of an integer (idle-break and dropout scheduling; no Math.random on the input path). */
export function hash01(n: number): number {
  let x = (n | 0) * 2654435761;
  x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; x = Math.imul(x, 3266489917); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function createLedFrame(): LedFrame {
  return { state: "off", intensity: 0, colour: [0, 0, 0], perLink: new Float32Array(LINK_IDS.length * 4) };
}

/** Critically damped bump: 0 at t = 0, peaks near tau, settled by ~4 tau. Unit peak. */
export function bump(tS: number, tauS: number): number {
  if (tS <= 0) return 0;
  return (tS / tauS) * Math.exp(1 - tS / tauS);
}

export interface LifeState {
  tS: number;                          // life clock (s), stops in a freeze
  cmdVel: number;                      // |command joint velocity| rad/s, gates the breath
  lastInputMs: number;
  nextIdleBreakS: number;
  idleBreak: { kind: IdleBreakKind; startS: number } | null;
  actionBreakAtMs: number;             // -Infinity when none pending
}

export function createLifeState(): LifeState {
  return { tS: 0, cmdVel: 0, lastInputMs: 0, nextIdleBreakS: IDLE_BREAK_MIN_S, idleBreak: null, actionBreakAtMs: -Infinity };
}

/**
 * Adds the command-side life (3.2) to a joint vector in place: breath on wrist_flex and the jaw, one idle break,
 * the post-strike action break. Sub-millimetre at the tip; never pan or lift; never while gripping (jaw).
 */
export function applyLife(life: LifeState, nowMs: number, gripping: boolean, q: Float64Array): void {
  const gate = 1 - Math.min(1, Math.abs(life.cmdVel) / BREATH_VEL_GATE_RAD_S);
  const w = 2 * Math.PI * BREATH_HZ;
  q[3] += BREATH_WRIST_RAD * Math.sin(w * life.tS) * gate;
  if (!gripping) q[5] += BREATH_JAW_RAD * Math.sin(w * (life.tS - BREATH_JAW_LAG_S)) * gate;
  const ib = life.idleBreak;
  if (ib) {
    const u = (life.tS - ib.startS) / (IDLE_BREAK_MS / 1000);
    if (u >= 1) life.idleBreak = null;
    else {
      const env = Math.sin(Math.PI * u);
      if (ib.kind === "jaw" && !gripping) q[5] += 20 * DEG * env;
      else if (ib.kind === "roll") q[4] += 8 * DEG * env * (hash01(Math.floor(ib.startS * 1000)) < 0.5 ? 1 : -1);
      else if (ib.kind === "knuckle") q[3] -= 5 * DEG * env;
    }
  }
  const ab = nowMs - life.actionBreakAtMs;
  if (ab >= ACTION_BREAK_DELAY_MS) {
    const tS = (ab - ACTION_BREAK_DELAY_MS) / 1000;
    if (tS > ACTION_BREAK_TAU_S * 6) life.actionBreakAtMs = -Infinity;
    else q[3] += ACTION_BREAK_RAD * bump(tS, ACTION_BREAK_TAU_S);
  }
  for (let j = 0; j < 6; j++) {
    const lim = JOINT_LIMITS[j];
    if (q[j] < lim[0]) q[j] = lim[0]; else if (q[j] > lim[1]) q[j] = lim[1];
  }
}

/** Picks the next idle break when its window has passed and the gate allows one; the schedule is 6–14 s, hashed. */
export function scheduleIdleBreak(life: LifeState, nowMs: number, allowed: boolean): void {
  if (life.idleBreak || life.tS < life.nextIdleBreakS) return;
  const seed = Math.floor(life.tS * 10);
  life.nextIdleBreakS = life.tS + IDLE_BREAK_MIN_S + (IDLE_BREAK_MAX_S - IDLE_BREAK_MIN_S) * hash01(seed);
  if (!allowed || nowMs - life.lastInputMs < IDLE_BREAK_NO_INPUT_S * 1000) return;
  life.idleBreak = { kind: IDLE_BREAKS[Math.floor(hash01(seed + 11) * IDLE_BREAKS.length)], startS: life.tS };
}

/** Hold tremor amplitude (mm, render-only): 0.1 base → 0.6 at heat 100 %, only while a servo error is open. */
export function tremorMm(maxServoErrRad: number, heat01: number): number {
  if (!(maxServoErrRad > TREMOR_ERR_RAD)) return 0;
  return TREMOR_MM.base + (TREMOR_MM.hot - TREMOR_MM.base) * Math.max(0, Math.min(1, heat01));
}

/**
 * Boot ritual pose (3.4): six joints self-test base → gripper (RITUAL_JOINT_MS each, scaled for the short
 * version), then the arm slams to LOWERED (home). Returns the joint vector and whether the self-test is over.
 */
export function ritualJoints(elapsedMs: number, totalMs: number, home: ArrayLike<number>, out: Float64Array): boolean {
  const perJoint = Math.min(RITUAL_JOINT_MS, (totalMs * 0.55) / 6);
  const testMs = perJoint * 6;
  for (let j = 0; j < 6; j++) out[j] = home[j];
  if (elapsedMs < testMs) {
    const j = Math.min(5, Math.floor(elapsedMs / perJoint));
    const u = (elapsedMs - j * perJoint) / perJoint;
    const lim = JOINT_LIMITS[j];
    const dir = home[j] + RITUAL_JOINT_BUMP_RAD <= lim[1] ? 1 : -1;
    out[j] = home[j] + dir * RITUAL_JOINT_BUMP_RAD * Math.sin(Math.PI * u);
    return false;
  }
  return true;
}

export interface PilotDeps {
  kinematics: So101Kinematics;
  settings: SettingsStore;
  clock: GameClock;
  profileMatchesPlayed: () => number;
}

export interface PilotOptions {
  /** Injectable pad source (tests); defaults to navigator.getGamepads(). */
  getPads?: () => readonly (Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons" | "index" | "timestamp"> | null)[];
}

/** PilotController plus the extras WP1/WP7 wire (seat choice, UI presses) and read-only views for tests and debug. */
export interface PilotControllerExt extends PilotController {
  /** Seat the human drives (default atlas). The director sets it when a Lab config seats the human in blaze. */
  setSeat(seat: Seat): void;
  /** UI presses from keyboard or pad since the last call (Esc / Menu, Tab / View, Enter / R). */
  consumeUi(input: UiInput): number;
  /**
   * True while a UI input is held down on any device. STATS is a hold: the HUD reads this instead of
   * listening for one hard-coded key, so the pad's VIEW button and a rebound STATS key behave alike.
   */
  isUiHeld(input: UiInput): boolean;
  /** Un-wound aim: what the reticle anchor and camera stance follow. */
  readonly aim: Readonly<CommandState>;
  /** The shaped command last written (or previewed): wind-up, jab, guard blend, and assists applied, before the leash. */
  readonly shaped: Readonly<CommandState>;
  readonly mode: PilotMode;
  /** Charge level the pilot is running locally (0..1), for the reticle before rules confirm it. */
  readonly charge01: number;
  /** Pilot LED state machine (3.3) → WP2's per-link LED uniform. Linear rgb, 8 × (r, g, b, i). */
  readonly led: Readonly<LedFrame>;
  /** Range cue for the crosshair (ReticleState, WP7 reads): sweet-band fill, in-range, magnetism. */
  readonly reticle: Readonly<ReticleState>;
  /** Hold tremor + heat, mm of render-only vibration (3.2); WP5 folds it into FeedbackFrame.vibration[seat]. */
  readonly tremorMm: number;
  /** Gripper stages (3.4): target (cube in the grab radius) → lock (pressed) → contact (both jaws on it). WP8 plays them. */
  readonly gripStage: GripStage;
  /** 0 → 1 over the last 400 ms of the boot ritual (camera pitch −12° → 0, "eyes opening"); 1 outside it. */
  readonly eyesOpen: number;
  /**
   * Boot ritual (3.4): WP6's director calls this every frame of `boot_ritual` with the phase's elapsed and total
   * ms (1800 first time in a session, 600 after), and once with null when the phase ends. The written ctrl is the
   * ritual pose (six-joint self-test, then the slam to LOWERED) and the LED plays BOOT.
   */
  setRitual(elapsedMs: number | null, totalMs?: number): void;
  /** Bus events for the body: strikes and clashes (action break, COMMIT flare), whiffs, stagger, short-out. */
  onEvents(events: readonly GameEvent[]): void;
  /**
   * Raw pointer motion, called inside the input event (≤ 5 ms): WP8 starts the whine here; `reversed` is an aim
   * direction reversal for the 12 ms haptic tick.
   */
  onMotion(fn: (counts: number, reversed: boolean) => void): () => void;
}

interface HistorySample { atMs: number; yaw: number }

export function createPilot(deps: PilotDeps, opts: PilotOptions = {}): PilotControllerExt {
  const kin = deps.kinematics;
  const settings = deps.settings;
  const input: InputSystem = createInputSystem(settings.get().controls.bindings);
  const pads: GamepadReader = createGamepadReader(opts.getPads);
  const touchChannel = createTouchChannel(input);
  const synthetic: SyntheticInput = createSyntheticInput(input);
  const scratch = createAssistScratch();
  const move = { dx: 0, dy: 0 };
  const padFrame: AnalogFrame = createAnalogFrame();
  const touchFrame: AnalogFrame = createAnalogFrame();
  const edgesIn: RawEdge[] = [];
  const pending: RawEdge[] = [];

  let seat: Seat = "atlas";
  let mode: PilotMode = "frozen";
  let rules: PilotRules = { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: false };
  let device: InputDevice = "keyboard_mouse";
  let bindingsRef = settings.get().controls.bindings;
  const unsubscribeSettings = settings.subscribe(() => {
    const next = settings.get().controls.bindings;
    if (next !== bindingsRef) { bindingsRef = next; input.setBindings(next); }
  });

  /* ── command state ── */
  const home = kin.homeCommand();
  let yawBase = home.yaw;
  let elevBase = home.elev;
  // The creep window never excludes the home pose, whatever reach the kinematics fit gives it.
  const stanceMin = Math.min(R_STANCE_MIN, home.reach);
  const stanceMax = Math.max(R_STANCE_MAX, home.reach);
  let rStance = home.reach;
  let tool = home.tool;
  let roll = home.roll;
  let swingYaw = 0;
  let swingElev = 0;
  let rOffset = 0;
  const aim: CommandState = { ...home, grip: GRIP_CLOSED };
  const command: CommandState = { ...home, grip: GRIP_CLOSED };
  const shaped: CommandState = { ...home, grip: GRIP_CLOSED };
  const guardScratch: CommandState = { ...home };
  const jointsCmd = new Float64Array(6);
  const anchorJoints = new Float64Array(6);
  const tmp3 = new Float64Array(3);

  /* ── timers and macro state (input clock, ms) ── */
  let nowMs = 0;
  let strikeHeld = false;
  let strikePressMs = 0;
  let strikeSpent = false;          // cancelled or auto-released: ignore until released
  let charging = false;
  let chargeStartMs = 0;
  let windDir = 0;                  // -1, 0, +1: yaw wind-up direction (0 = straight retract)
  let jabUntilMs = -1;
  let heavyUntilMs = -1;
  let heavyC = 0;
  let abilityPressMs = -Infinity;
  let burstPressMs = -Infinity;
  let gripPressMs = -Infinity;
  let gripReleaseMs = -Infinity;
  let magnetUntilMs = -Infinity;
  let grabCube = -1;
  let creepMs = 0;
  let creepDir = 0;
  let pendingGuardStamp = false;
  let replayOnNextSample = false;
  const history: HistorySample[] = Array.from({ length: 24 }, () => ({ atMs: -Infinity, yaw: 0 }));
  let historyHead = 0;

  /* ── lobby ── */
  let cursorTarget: Vec3 | null = null;
  let cursorMovedMs = -Infinity;
  let lobbyTimeS = 0;
  let swayWeight = 0;

  /* ── published ── */
  const intents: Intents = noIntents();
  const stance = { yaw: home.yaw, elev: home.elev };
  const stanceYawFilter = createTwoPole(home.yaw);
  const stanceElevFilter = createTwoPole(home.elev);
  const look = { yawOffset: 0, pitchOffset: 0 };
  const rangeCue: RangeCue = { flick: false, jab: false, nearestM: 0, flickArcRadiusM: 0, jabArcRadiusM: 0 };
  const shaping: InputShapingFlags = { leash: false, guardBlend: false, jabMacro: false, chargeWindup: false, grabAssist: false, dockMagnet: false, aimAssist: false };
  const ghost: GhostPose = { joints: new Float64Array(6), tipWorld: new Float64Array(3), rollAxisWorld: new Float64Array(3), leashStretch: 0 };
  const edgeSimTimes = { guardPress: -1 };
  let lastFrame: PhysicsFrame | null = null;
  let lastCombat: CombatSnapshot | null = null;
  let aimAssistActive = false;
  let reach01 = 0;

  /* ── life (3.2), LED (3.3), ritual (3.4), streamlining (section 6), match-1 assists (2) ── */
  const life = createLifeState();
  const led: LedFrame = createLedFrame();
  const ledAt = { commit: -Infinity, whiff: -Infinity, stagger: -Infinity, short: -Infinity };
  let power: LedInputs["power"] = "off";
  const reticle: ReticleState = { fill: 0, inRange: false, magnetism: 0 };
  let ritual: { elapsedMs: number; totalMs: number } | null = null;
  let ritualSteady = false;
  let eyesOpen = 1;
  const ritualQ = new Float64Array(6);
  const homeJoints = kin.commandToJoints({ ...home, grip: GRIP_CLOSED }, new Float64Array(6));
  let magnetRad = 0;
  let mouseCountsS = 0;
  let stoppedMs = 0;
  let reachAssist = 0;
  let autoGrip = false;
  let autoGripDockMs = -Infinity;
  let wasFrozen = false;
  let tremor = 0;
  let gripStage: GripStage = "none";
  let prevAimYaw = home.yaw, prevAimElev = home.elev, prevAimReach = home.reach;

  function clampRange(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function combatSeat() {
    return lastCombat ? lastCombat.seats[seat] : null;
  }

  function bulwarkActive(): boolean {
    const c = combatSeat();
    return !!c && c.ability.id === "bulwark" && c.ability.activeMs > 0;
  }

  function pushHistory(yaw: number): void {
    const h = history[historyHead];
    h.atMs = nowMs;
    h.yaw = yaw;
    historyHead = (historyHead + 1) % history.length;
  }

  /** Sign of yaw motion over the last 150 ms (0 when the aim was still). */
  function recentYawDirection(): number {
    let oldest: HistorySample | null = null;
    for (const h of history) if (nowMs - h.atMs <= WINDUP_HISTORY_MS && (!oldest || h.atMs < oldest.atMs)) oldest = h;
    if (!oldest) return 0;
    const d = aim.yaw - oldest.yaw;
    return Math.abs(d) < 0.02 ? 0 : Math.sign(d);
  }

  function clearMacros(): void {
    if (charging) { charging = false; strikeSpent = true; }
    jabUntilMs = -1;
    heavyUntilMs = -1;
    abilityPressMs = -Infinity;
    burstPressMs = -Infinity;
    magnetUntilMs = -Infinity;
  }

  function resetAimToHome(): void {
    const h = kin.homeCommand();
    yawBase = h.yaw; elevBase = h.elev; rStance = clampRange(h.reach, stanceMin, stanceMax);
    tool = h.tool; roll = h.roll; swingYaw = 0; swingElev = 0; rOffset = 0;
    creepMs = 0; creepDir = 0;
    copyCommand(h, aim);
    aim.grip = GRIP_CLOSED;
    stance.yaw = h.yaw; stance.elev = h.elev;
    resetTwoPole(stanceYawFilter, h.yaw);
    resetTwoPole(stanceElevFilter, h.elev);
  }

  /* ── edges ── */

  function processEdge(e: RawEdge, maxAgeMs: number): void {
    const age = nowMs - e.atMs;
    const fresh = age <= maxAgeMs;
    switch (e.input) {
      case "strike":
        if (e.down) {
          if (!fresh) return;
          strikeHeld = true;
          strikePressMs = e.atMs;
          strikeSpent = bulwarkActive() || (!rules.jabMacro && !rules.chargeMacro);
        } else {
          if (!strikeHeld) return;
          strikeHeld = false;
          if (strikeSpent) { strikeSpent = false; return; }
          if (charging) {
            charging = false;
            heavyC = charge01();
            heavyUntilMs = nowMs + HEAVY_MS;
            ledAt.commit = nowMs;
          } else if (rules.jabMacro && e.atMs - strikePressMs < JAB_TAP_MAX_MS) {
            jabUntilMs = nowMs + JAB_MS;
            ledAt.commit = nowMs;
          }
        }
        return;
      case "guard":
        if (!e.down || !fresh) return;
        if (charging) {
          // 3.1.2: a guard press while charging cancels the charge and never opens a deflect window.
          charging = false;
          strikeSpent = true;
          return;
        }
        pendingGuardStamp = true;
        return;
      case "grip":
        if (e.down) {
          if (!fresh) return;
          gripPressMs = e.atMs;
          grabCube = -1;
        } else {
          gripReleaseMs = nowMs;
          grabCube = -1;
          magnetUntilMs = rules.assists && lastFrame && coreOverOwnDock(seat, lastFrame) ? nowMs + DOCK_MAGNET_MS : -Infinity;
        }
        return;
      case "ability":
        if (e.down && fresh) abilityPressMs = e.atMs;
        return;
      case "overdrive":
        if (e.down && fresh) burstPressMs = e.atMs;
        return;
      default:
        return;
    }
  }

  function charge01(): number {
    return charging ? Math.min(1, Math.max(0, (nowMs - chargeStartMs) / CHARGE_RAMP_MS)) : 0;
  }

  function gripValue(): number {
    if (autoGrip) return GRIP_CLOSED;
    if (gripStage === "target") return GRIP_CLOSED + GRIP_TARGET_OPEN_RAD;
    if (input.isHeld("grip")) return nowMs - gripPressMs < GRAB_OPEN_MS ? GRIP_OPEN : GRIP_CLOSED;
    if (nowMs < magnetUntilMs) return GRIP_CLOSED;
    const openFrom = magnetUntilMs > gripReleaseMs ? magnetUntilMs : gripReleaseMs;
    if (nowMs - openFrom < RELEASE_OPEN_MS) return GRIP_OPEN;
    // Stay open while hovering over a just-dropped cube so the fist never re-grabs it (closes once clear).
    if (lastFrame && nowMs - gripReleaseMs < 2000 && findGrabCube(seat, lastFrame) >= 0) return GRIP_OPEN;
    return GRIP_CLOSED;
  }

  /* ── per-frame sampling ── */

  function pollDevices(): AnalogFrame | null {
    const s = settings.get().controls;
    const padRead = pads.poll(input, s.padDeadzone, padFrame);
    const padMoving = padRead && (padFrame.swingX !== 0 || padFrame.swingY !== 0 || padFrame.stanceX !== 0 || padFrame.reachY !== 0);
    if (touchChannel.engaged) {
      touchChannel.read(touchFrame);
      device = "touch";
      return touchFrame;
    }
    if (padMoving) device = "gamepad";
    return padRead ? padFrame : null;
  }

  function updateStance(dt: number): void {
    stance.yaw = stepTwoPole(stanceYawFilter, aim.yaw, dt, STANCE_POLE_TAU_S);
    stance.elev = stepTwoPole(stanceElevFilter, aim.elev, dt, STANCE_POLE_TAU_S);
    const gains = LOOK_GAIN[settings.get().camera.cockpit] ?? LOOK_GAIN.standard;
    look.yawOffset = LOOK_YAW_MAX * Math.tanh((gains.yaw * stance.yaw) / LOOK_YAW_MAX);
    look.pitchOffset = LOOK_PITCH_MAX * Math.tanh((gains.pitch * (stance.elev - home.elev)) / LOOK_PITCH_MAX);
  }

  function sampleFight(dt: number, analog: AnalogFrame | null, replayAllowanceMs: number): void {
    const dtMs = dt * 1000;
    input.drainEdges(edgesIn);
    if (edgesIn.length > 0) device = edgesIn[edgesIn.length - 1].device;
    for (const e of edgesIn) pending.push(e);
    edgesIn.length = 0;
    for (const e of pending) processEdge(e, replayAllowanceMs);
    pending.length = 0;

    const c = settings.get().controls;
    input.takeMove(move);
    if (move.dx !== 0 || move.dy !== 0) device = input.lastDevice;
    const counts = Math.abs(move.dx) + Math.abs(move.dy);
    if (counts > 0 || edgesIn.length > 0 || (analog && (analog.swingX !== 0 || analog.swingY !== 0))) life.lastInputMs = nowMs;
    mouseCountsS += ((dt > 0 ? counts / dt : 0) - mouseCountsS) * (1 - Math.exp(-dt / 0.05));
    stoppedMs = counts > 0 ? 0 : stoppedMs + dtMs;
    const k = MOUSE_RAD_PER_COUNT * c.sensitivity * (charging ? CHARGE_SENSITIVITY : 1);
    yawBase += k * move.dx;
    elevBase -= k * move.dy * c.verticalMul * (c.invertY ? -1 : 1);
    const notches = input.takeWheel() + (analog ? analog.toolNotches : 0);
    tool = clampRange(tool + notches * TOOL_NOTCH, -0.8, 0.8);

    swingYaw = analog ? SWING_YAW_RAD * analog.swingX : 0;
    swingElev = analog ? SWING_ELEV_RAD * analog.swingY : 0;

    const left = input.isHeld("stance_left") ? 1 : 0;
    const right = input.isHeld("stance_right") ? 1 : 0;
    const stanceX = analog ? analog.stanceX : 0;
    yawBase += ((right - left) + stanceX) * STANCE_DRIFT_RAD_S * dt;

    aimAssistActive = false;
    if (analog && analog.recentre && lastFrame) yawBase = opponentYaw(kin, seat, lastFrame, scratch);
    if (rules.aimAssist && lastFrame && (device === "gamepad" || device === "touch") && stanceX === 0 && left === 0 && right === 0) {
      const target = opponentYaw(kin, seat, lastFrame, scratch);
      const d = wrapPi(target - yawBase);
      const stepRad = 0.6 * dt;
      if (Math.abs(d) > 0.005) {
        yawBase += Math.abs(d) <= stepRad ? d : Math.sign(d) * stepRad;
        aimAssistActive = true;
      }
    }
    yawBase = clampRange(yawBase, -YAW_LIMIT, YAW_LIMIT);
    elevBase = clampRange(elevBase, ELEV_MIN, ELEV_MAX);

    const rollDir = (input.isHeld("roll_pos") ? 1 : 0) - (input.isHeld("roll_neg") ? 1 : 0);
    roll = clampRange(roll + rollDir * ROLL_RATE * dt, -2.74385, 2.74385);

    const out = input.isHeld("reach_out");
    const inn = input.isHeld("reach_in");
    let dir = 0;
    if (out || inn) {
      rOffset = out && inn ? 0 : out ? REACH_OUT_M : REACH_IN_M;
      dir = out && inn ? 0 : out ? 1 : -1;
    } else if (analog && analog.reachY !== 0) {
      rOffset = analog.reachY > 0 ? analog.reachY * REACH_OUT_M : analog.reachY * -REACH_IN_M;
      dir = analog.reachMagnitude > REACH_CREEP_THRESHOLD ? Math.sign(analog.reachY) : 0;
    } else {
      rOffset = 0;
    }
    if (dir !== 0 && dir === creepDir) {
      const before = creepMs;
      creepMs += dtMs;
      const activeS = Math.max(0, creepMs - Math.max(before, REACH_CREEP_DELAY_S * 1000)) / 1000;
      rStance = clampRange(rStance + dir * REACH_CREEP_M_S * activeS, stanceMin, stanceMax);
    } else {
      creepDir = dir;
      creepMs = dir !== 0 ? dtMs : 0;
      const activeS = Math.max(0, creepMs - REACH_CREEP_DELAY_S * 1000) / 1000;
      if (activeS > 0) rStance = clampRange(rStance + dir * REACH_CREEP_M_S * activeS, stanceMin, stanceMax);
    }

    // Reticle magnetism (section 6 streamlining, ARCADE only): ≤ 3° toward the opponent's gripper within 12° while
    // the mouse is under 200 counts/s, τ 120 ms. The aim-brake holds it once the mouse has stopped ≥ 40 ms and the
    // arm is within 0.15 rad of the command, so a settled aim never creeps.
    let magnetTarget = 0;
    if (rules.aimAssist && lastFrame && device !== "gamepad" && device !== "touch" && mouseCountsS < MAGNET_MOUSE_COUNTS_S) {
      const d = wrapPi(opponentYaw(kin, seat, lastFrame, scratch) - yawBase);
      if (Math.abs(d) < MAGNET_CONE_RAD) magnetTarget = clampRange(d, -MAGNET_MAX_RAD, MAGNET_MAX_RAD);
      if (stoppedMs >= 40 && ghost.leashStretch * LEASH_RAD < 0.15) magnetTarget = magnetRad;
    }
    magnetRad += (magnetTarget - magnetRad) * (1 - Math.exp(-dt / MAGNET_TAU_S));
    if (Math.abs(magnetRad) < 1e-5) magnetRad = 0;
    if (magnetRad !== 0) aimAssistActive = true;

    let nextYaw = clampRange(yawBase + swingYaw + magnetRad, -YAW_LIMIT, YAW_LIMIT);
    const capped = (input.isHeld("guard") && rules.guardBlend) || bulwarkActive();
    if (capped) {
      const maxStep = GUARD_YAW_RATE * dt;
      const d = nextYaw - aim.yaw;
      if (Math.abs(d) > maxStep) {
        nextYaw = aim.yaw + Math.sign(d) * maxStep;
        yawBase = clampRange(nextYaw - swingYaw - magnetRad, -YAW_LIMIT, YAW_LIMIT);
      }
    }
    aim.yaw = nextYaw;
    aim.elev = clampRange(elevBase + swingElev, ELEV_MIN, ELEV_MAX);
    aim.reach = clampRange(rStance + rOffset, REACH_MIN, REACH_MAX);
    // Match-1 assists (EMOTION_BIBLE 2): reach auto-tracks the nearest target's depth (τ 150 ms) and the gripper
    // auto-locks on Core contact; both flagged per tick in human.shaping (aimAssist / grabAssist).
    const match1 = rules.assists && deps.profileMatchesPlayed() === 0;
    let reachTarget = 0;
    if (match1 && lastFrame) reachTarget = targetReachDelta(kin, seat, aim, lastFrame, scratch) ?? 0;
    reachAssist += (reachTarget - reachAssist) * (1 - Math.exp(-dt / REACH_TRACK_TAU_S));
    if (Math.abs(reachAssist) > 1e-4) {
      aim.reach = clampRange(aim.reach + reachAssist, REACH_MIN, REACH_MAX);
      aimAssistActive = true;
    }
    if (match1 && lastFrame) {
      const act = lastFrame.active;
      const onCore = act.gripperOnCube[seat] === CORE_CUBE_INDEX || act.bothJawsOnCube[seat] === CORE_CUBE_INDEX;
      // Latch on contact; never re-latch inside the 2 s hover window after a release (the fist stays open).
      if (onCore && !autoGrip && !input.isHeld("grip") && nowMs - gripReleaseMs > 2000) { autoGrip = true; grabCube = CORE_CUBE_INDEX; autoGripDockMs = -Infinity; }
      if (autoGrip) {
        // Over the own dock: hold 300 ms then release exactly like a Space release (magnet, then open).
        if (coreOverOwnDock(seat, lastFrame)) { if (autoGripDockMs < 0) autoGripDockMs = nowMs; } else autoGripDockMs = -Infinity;
        if (autoGripDockMs >= 0 && nowMs - autoGripDockMs >= AUTO_GRIP_RELEASE_MS) {
          autoGrip = false; grabCube = -1; gripReleaseMs = nowMs; magnetUntilMs = nowMs + DOCK_MAGNET_MS;
        }
      }
    } else autoGrip = false;
    aim.tool = tool;
    aim.roll = roll;

    // Charge: held >= 180 ms starts it; wind-up direction is set once, away from the last 150 ms of yaw motion.
    if (strikeHeld && !strikeSpent && !charging && rules.chargeMacro && !bulwarkActive() && nowMs - strikePressMs >= JAB_TAP_MAX_MS) {
      charging = true;
      chargeStartMs = strikePressMs + JAB_TAP_MAX_MS;
      windDir = -recentYawDirection();
    }
    if (charging && nowMs - chargeStartMs >= CHARGE_RAMP_MS + CHARGE_HOLD_MAX_MS) {
      // Held past full for the maximum: the heavy releases on its own (4.7); the button must come up before another.
      charging = false;
      strikeSpent = true;
      heavyC = 1;
      heavyUntilMs = nowMs + HEAVY_MS;
      ledAt.commit = nowMs;
    }
    pushHistory(aim.yaw);

    const showKit = rules.showKit;
    const cs = combatSeat();
    intents.guard = input.isHeld("guard");
    intents.charge = charging;
    intents.grip = input.isHeld("grip") || autoGrip;
    intents.overdrive = showKit && input.isHeld("overdrive");
    intents.ability = showKit && nowMs - abilityPressMs <= EDGE_BUFFER_MS;
    intents.burst = showKit && !!cs && cs.servoState === "stagger" && nowMs - burstPressMs <= EDGE_BUFFER_MS;
    // Gripper stages (3.4): the target stage is silent geometry (a cube inside the grab radius), lock is the press.
    const holding = !!lastFrame && lastFrame.active.bothJawsOnCube[seat] >= 0;
    gripStage = intents.grip ? (holding ? "contact" : "lock")
      : rules.assists && lastFrame && nowMs - gripReleaseMs > RELEASE_OPEN_MS && findGrabCube(seat, lastFrame) >= 0 ? "target" : "none";
    aim.grip = gripValue();
  }

  function sampleLobby(dt: number): void {
    input.drainEdges(edgesIn);
    edgesIn.length = 0;
    pending.length = 0;
    input.discardMotion();
    lobbyTimeS += dt;
    const idle = !cursorTarget || nowMs - cursorMovedMs >= LOBBY_IDLE_MS;
    swayWeight = clampRange(swayWeight + (idle ? dt / 0.8 : -dt / 0.4), 0, 1);
    const desired = guardScratch;
    copyCommand(home, desired);
    if (cursorTarget) {
      const cal = scratch.p;
      cal[0] = clampRange(cursorTarget[0], 0.1, 0.36);
      cal[1] = clampRange(cursorTarget[1], -0.22, 0.22);
      cal[2] = clampRange(cursorTarget[2], 0.08, 0.3);
      copyCommand(aim, desired);
      solveRollAxisCommand(kin, cal, desired, scratch, false);
    }
    const t = lobbyTimeS * 2 * Math.PI;
    const swayYaw = home.yaw + 0.22 * Math.sin(0.16 * t);
    const swayElev = home.elev + 0.05 * Math.sin(0.23 * t + 1.1);
    const swayTool = home.tool + 0.12 * Math.sin(0.19 * t + 0.4);
    const w = swayWeight * swayWeight * (3 - 2 * swayWeight);
    const gy = desired.yaw + (swayYaw - desired.yaw) * w;
    const ge = desired.elev + (swayElev - desired.elev) * w;
    const gr = desired.reach + (home.reach - desired.reach) * w;
    const gt = desired.tool + (swayTool - desired.tool) * w;
    const a = 1 - Math.exp(-dt / 0.09);
    aim.yaw += (gy - aim.yaw) * a;
    aim.elev += (ge - aim.elev) * a;
    aim.reach += (gr - aim.reach) * a;
    aim.tool += (gt - aim.tool) * a;
    aim.roll += (home.roll - aim.roll) * a;
    aim.grip = GRIP_CLOSED;
    yawBase = aim.yaw; elevBase = aim.elev; tool = aim.tool; roll = aim.roll;
    rStance = clampRange(aim.reach, stanceMin, stanceMax);
    Object.assign(intents, noIntents());
  }

  function sampleIdle(): void {
    // frozen (between phases, paused) and hold_guard: keep edges for the ENGAGE replay, drop pointer motion.
    input.drainEdges(edgesIn);
    for (const e of edgesIn) pending.push(e);
    edgesIn.length = 0;
    let keep = 0;
    for (const e of pending) if (nowMs - e.atMs <= ENGAGE_REPLAY_MS) pending[keep++] = e;
    pending.length = keep;
    input.discardMotion();
    input.takeWheel();
    Object.assign(intents, noIntents());
    if (mode === "hold_guard") {
      resetAimToHome();
      clearMacros();
    }
    aim.grip = GRIP_CLOSED;
  }

  function publishCommand(): void {
    command.yaw = aim.yaw;
    command.elev = aim.elev;
    command.reach = aim.reach;
    command.tool = aim.tool;
    command.roll = aim.roll;
    command.grip = aim.grip;
    reach01 = (aim.reach - REACH_MIN) / (REACH_MAX - REACH_MIN);
  }

  /* ── shaping (per physics step and for the ghost preview) ── */

  function shape(frame: PhysicsFrame | null): void {
    copyCommand(aim, shaped);
    shaping.leash = false;
    shaping.guardBlend = false;
    shaping.jabMacro = false;
    shaping.chargeWindup = false;
    shaping.grabAssist = false;
    shaping.dockMagnet = false;
    shaping.aimAssist = aimAssistActive;

    if (mode === "hold_guard") {
      copyCommand(home, shaped);
      shaped.grip = GRIP_CLOSED;
      return;
    }
    if (nowMs < jabUntilMs) {
      shaped.reach += JAB_OFFSET_M;
      shaping.jabMacro = true;
    }
    if (mode !== "fight") {
      clampCommand(shaped);
      return;
    }
    if (nowMs < heavyUntilMs) {
      shaped.tool += HEAVY_TOOL;
      shaped.reach = rStance + Math.min(REACH_MAX - rStance, 0.05 + 0.05 * heavyC);
      shaping.chargeWindup = true;
    } else if (charging) {
      shaped.reach += WINDUP_REACH_M;
      shaped.tool += WINDUP_TOOL;
      shaped.yaw += windDir * WINDUP_YAW;
      shaping.chargeWindup = true;
    }
    clampCommand(shaped);
    if (!frame) return;

    if (intents.guard && rules.guardBlend) {
      guardCommand(kin, seat, frame, shaped, guardScratch, scratch);
      blendGuard(shaped, guardScratch, shaped);
      shaping.guardBlend = true;
    } else if (rules.assists && (input.isHeld("grip") || autoGrip)) {
      const found = autoGrip ? CORE_CUBE_INDEX : findGrabCube(seat, frame);
      if (found >= 0) grabCube = found;
      else if (grabCube >= 0 && frame.active.bothJawsOnCube[seat] !== grabCube) grabCube = -1;
      if (grabCube >= 0) {
        const lifted = frame.active.bothJawsOnCube[seat] === grabCube;
        grabCommand(kin, seat, frame, grabCube, shaped, lifted, shaped, scratch);
        shaping.grabAssist = true;
      }
    } else if (rules.assists && nowMs < magnetUntilMs) {
      dockCommand(kin, seat, frame, shaped, shaped, scratch);
      shaping.dockMagnet = true;
    }
    shaped.grip = aim.grip;
    if (shaping.guardBlend || shaping.grabAssist || shaping.dockMagnet) clampAssistCommand(shaped);
    else clampCommand(shaped);
  }

  function gripping(): boolean {
    return autoGrip || (!!lastFrame && lastFrame.active.bothJawsOnCube[seat] >= 0 && aim.grip === GRIP_CLOSED);
  }

  /** The joint target the servos chase: the shaped command, plus the ritual pose or the command-side life. */
  function commandJoints(): void {
    if (ritual) { jointsCmd.set(ritualQ); return; }
    kin.commandToJoints(shaped, jointsCmd);
    // HARNESS zeroes all of it (3.2): it is the one preset with the leash off.
    if (rules.leash && mode === "fight") applyLife(life, nowMs, gripping(), jointsCmd);
  }

  function updateLed(): void {
    const cs = combatSeat();
    const arm = lastFrame ? lastFrame.arms[seat] : null;
    const force = arm && arm.forceRange[5] > 0 ? Math.abs(arm.tau[5]) / arm.forceRange[5] : 0;
    computeLed({
      nowMs, power, bootSteady: ritualSteady,
      guard: intents.guard && mode === "fight", grip: gripping(), gripForce01: force, gripTarget: gripStage === "target",
      heat01: cs ? cs.heat / 100 : 0, integrity01: cs && cs.integrityMax > 0 ? cs.integrity / cs.integrityMax : 1,
      inStrikeRange: rangeCue.flick,
      commitAtMs: ledAt.commit, whiffAtMs: ledAt.whiff, staggerAtMs: ledAt.stagger, shortAtMs: ledAt.short,
    }, led);
  }

  function updateGhost(frame: PhysicsFrame | null): void {
    commandJoints();
    ghost.joints.set(jointsCmd);
    // The reticle anchors on the ghost tip. During a charge the ghost visibly winds up, but the anchor keeps the
    // un-wound aim so the reticle stays where the heavy will land (3.1.2).
    const anchor = charging && shaping.chargeWindup ? kin.commandToJoints(aim, anchorJoints) : jointsCmd;
    kin.fkTipEgo(anchor, tmp3);
    egoToWorld(seat, tmp3[0], tmp3[1], tmp3[2], ghost.tipWorld);
    kin.fkRollAxisEgo(anchor, tmp3);
    egoToWorld(seat, tmp3[0], tmp3[1], tmp3[2], ghost.rollAxisWorld);
    if (frame) {
      const q = frame.arms[seat].q;
      let stretch = 0;
      for (let j = 0; j < 5; j++) stretch = Math.max(stretch, Math.abs(jointsCmd[j] - q[j]) / LEASH_RAD);
      ghost.leashStretch = Number.isFinite(stretch) ? stretch : 0;
    }
  }

  function refreshPreview(): void {
    publishCommand();
    shape(lastFrame);
    updateGhost(lastFrame);
    if (mode === "fight" && lastFrame) computeRangeCue(kin, seat, aim, lastFrame, rangeCue, scratch);
    else { rangeCue.flick = false; rangeCue.jab = false; }
    // Range cue lives in the reticle (ReticleState): the ring fills through the sweet band into IN RANGE.
    reticle.inRange = rangeCue.flick;
    reticle.fill = mode === "fight" && lastFrame ? clampRange(1 - (rangeCue.nearestM - RANGE_TOLERANCE_M) / 0.065, 0, 1) : 0;
    reticle.magnetism = magnetRad / MAGNET_MAX_RAD;
    updateLed();
  }

  /** Idle-break gate (3.2): no input > 2.5 s, opponent tip beyond 1.3× range, no Core within 0.4 m of the tip. */
  function idleBreakAllowed(): boolean {
    if (mode !== "fight" || !lastFrame || !rules.leash) return false;
    const opp = lastFrame.arms[seat === "atlas" ? "blaze" : "atlas"].eePos;
    const mine = lastFrame.arms[seat].eePos;
    const mountX = seat === "atlas" ? -0.32 : 0.32;
    const oppR = Math.hypot(opp[0] - mountX, opp[1]);
    if (oppR <= IDLE_BREAK_RANGE_K * Math.max(rangeCue.flickArcRadiusM, 0.1)) return false;
    if (lastCombat && lastCombat.core.phase !== "dormant") {
      const c = CORE_CUBE_INDEX * 3;
      const cp = lastFrame.cubes.pos;
      if (Math.hypot(cp[c] - mine[0], cp[c + 1] - mine[1], cp[c + 2] - mine[2]) < IDLE_BREAK_CORE_M) return false;
    }
    return true;
  }

  const pilot: PilotControllerExt = {
    get seat() { return seat; },
    command,
    ghost,
    intents,
    stance,
    look,
    rangeCue,
    shaping,
    get reach01() { return reach01; },
    get device() { return device; },
    get locked() { return input.locked; },
    get rearming() { return input.rearming; },
    edgeSimTimes,
    aim,
    shaped,
    get mode() { return mode; },
    get charge01() { return charge01(); },
    led,
    reticle,
    get tremorMm() { return tremor; },
    get gripStage() { return gripStage; },
    get eyesOpen() { return eyesOpen; },

    setRitual(elapsedMs, totalMs = 1800) {
      if (elapsedMs === null) {
        if (ritual) { ritual = null; ritualSteady = false; eyesOpen = 1; if (power === "boot") power = "lowered"; refreshPreview(); }
        return;
      }
      ritual = { elapsedMs, totalMs };
      power = "boot";
      ledAt.short = -Infinity;
      ritualSteady = ritualJoints(elapsedMs, totalMs, homeJoints, ritualQ);
      eyesOpen = clampRange((elapsedMs - (totalMs - RITUAL_EYES_MS)) / RITUAL_EYES_MS, 0, 1);
      refreshPreview();
    },

    onEvents(events) {
      for (const e of events) {
        switch (e.type) {
          case "strike":
            if (e.attacker === seat && e.tier === "strike") life.actionBreakAtMs = nowMs;
            break;
          case "clash":
            life.actionBreakAtMs = nowMs;
            break;
          case "whiff":
            if (e.seat === seat) ledAt.whiff = nowMs;
            break;
          case "servo_state":
            if (e.seat !== seat) break;
            if (e.state === "stagger") ledAt.stagger = nowMs;
            else if (e.state === "cutout" || e.state === "offline") ledAt.short = nowMs;
            break;
          case "ko":
            if (e.victim === seat) ledAt.short = nowMs;
            break;
          case "phase":
            if (e.phase === "round_intro" || e.phase === "boot_ritual" || e.phase === "rematch_intro") ledAt.short = -Infinity;
            break;
          default:
            break;
        }
      }
    },

    onMotion(fn) { return input.onMotion(fn); },

    attach(target) { input.attach(target); },
    detach() { input.detach(); touchChannel.touch.release(); },
    requestLock() { return input.requestLock(); },

    setSeat(next) {
      if (next === seat) return;
      seat = next;
      grabCube = -1;
    },

    consumeUi(which) { return input.consumeUi(which); },

    isUiHeld(which) { return input.isUiHeld(which); },

    setMode(next) {
      if (next === mode) return;
      const prev = mode;
      mode = next;
      if (next === "fight") {
        // ENGAGE: edges from the last 150 ms replay; a strike already held from before must be pressed again.
        strikeHeld = false;
        strikeSpent = false;
        charging = false;
        input.discardMotion();
        replayOnNextSample = true;
        power = "ready";
        life.lastInputMs = nowMs;
        return;
      }
      if (prev === "fight") {
        clearMacros();
        strikeHeld = false;
        strikeSpent = false;
        grabCube = -1;
        autoGrip = false;
        gripStage = "none";
        magnetRad = 0; reachAssist = 0;
        if (power === "ready") power = "lowered";
      }
      if (next === "lobby_cursor" && power === "off") power = "lowered";
      if (next === "lobby_cursor") {
        swayWeight = cursorTarget ? 0 : 1;
        touchChannel.touch.release();
      }
      if (next === "hold_guard") resetAimToHome();
      Object.assign(intents, noIntents());
    },

    setRules(next) {
      rules = { ...next };
      if (!rules.chargeMacro && charging) { charging = false; strikeSpent = true; }
      if (!rules.aimAssist) magnetRad = 0;
    },

    setCursorTarget(egoPoint) {
      cursorTarget = egoPoint ? [egoPoint[0], egoPoint[1], egoPoint[2]] : null;
      if (egoPoint) cursorMovedMs = nowMs;
    },

    triggerJab() {
      jabUntilMs = nowMs + JAB_MS;
    },

    resetCommand() {
      resetAimToHome();
      clearMacros();
      strikeHeld = false;
      strikeSpent = input.isHeld("strike");
      grabCube = -1;
      gripReleaseMs = -Infinity;
      pending.length = 0;
      input.discardMotion();
      Object.assign(intents, noIntents());
      refreshPreview();
    },

    synthetic() { return synthetic; },
    touch(): TouchInput { return touchChannel.touch; },

    sampleFrame(wallDtS, frozen) {
      const dt = Number.isFinite(wallDtS) ? clampRange(wallDtS, 0, MAX_SAMPLE_DT) : 0;
      input.nowMs = nowMs;
      const analog = pollDevices();
      if (mode === "fight" && frozen) {
        // Hit stop: the command and ghost hold; deltas and edges wait for the first post-freeze frame.
        wasFrozen = true;
        updateStance(dt);
        return;
      }
      nowMs += dt * 1000;
      input.nowMs = nowMs;
      if (mode === "fight") {
        // Strike buffer 100 ms, 150 ms across a freeze (section 6 streamlining).
        const allowance = replayOnNextSample ? ENGAGE_REPLAY_MS : wasFrozen ? FREEZE_EDGE_BUFFER_MS : EDGE_BUFFER_MS;
        replayOnNextSample = false;
        wasFrozen = false;
        sampleFight(dt, analog, allowance);
        life.tS += dt;
        life.cmdVel = dt > 0 ? Math.hypot(aim.yaw - prevAimYaw, aim.elev - prevAimElev, (aim.reach - prevAimReach) * 5) / dt : 0;
        scheduleIdleBreak(life, nowMs, idleBreakAllowed());
      } else if (mode === "lobby_cursor") {
        sampleLobby(dt);
      } else {
        sampleIdle();
      }
      prevAimYaw = aim.yaw; prevAimElev = aim.elev; prevAimReach = aim.reach;
      updateStance(dt);
      refreshPreview();
    },

    writeCommand(frame, combat, out) {
      lastFrame = frame;
      lastCombat = combat;
      if (pendingGuardStamp) {
        edgeSimTimes.guardPress = frame.simTime + frame.dt;
        pendingGuardStamp = false;
      }
      shape(frame);
      commandJoints();
      const q = frame.arms[seat].q;
      let stretch = 0;
      let leashed = false;
      let maxErr = 0;
      const leashOn = rules.leash && mode === "fight";
      for (let j = 0; j < 5; j++) {
        const cmd = jointsCmd[j];
        const e = cmd - q[j];
        const ae = Math.abs(e);
        if (ae > maxErr) maxErr = ae;
        if (ae / LEASH_RAD > stretch) stretch = ae / LEASH_RAD;
        if (leashOn && ae > LEASH_RAD) {
          out[j] = q[j] + Math.sign(e) * LEASH_RAD;
          leashed = true;
        } else {
          out[j] = cmd;
        }
      }
      out[5] = jointsCmd[5];
      shaping.leash = leashed;
      ghost.leashStretch = Number.isFinite(stretch) ? stretch : 0;
      // Render-only tremor (3.2): never touches ctrl, never recorded.
      const cs = combat.seats[seat];
      tremor = leashOn ? tremorMm(maxErr, cs ? cs.heat / 100 : 0) : 0;
    },

    dispose() {
      unsubscribeSettings();
      input.detach();
      pads.reset();
    },
  };

  refreshPreview();
  return pilot;
}

export const createPilotController: CreatePilotController = (deps) => createPilot(deps);
