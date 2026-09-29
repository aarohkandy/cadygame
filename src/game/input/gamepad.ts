// src/game/input/gamepad.ts (WP3)
// Standard-mapping gamepad (GAME_DESIGN 3.4). The right stick is an absolute swing stick: a full-left to full-right
// flick is a 1.8 rad yaw step, the same hook a mouse flick produces. Stick shaping is a radial deadzone followed by a
// 1.5 power response, so diagonals keep their direction and small corrections stay fine.
//
//   curve(v) = sign(v) * ((|v| - dz) / (1 - dz))^1.5   for |v| > dz, else 0       (dz defaults to 0.12)
//
// The analogue frame produced here is the one shape the pilot consumes for every analogue device; touch-input.ts
// fills the same struct.

import type { InputSystem, CommandInput } from "./input-system.ts";

export const STICK_EXPONENT = 1.5;
export const DEFAULT_STICK_DEADZONE = 0.12;
export const TRIGGER_THRESHOLD = 0.35;
/** |LS y| above this for 400 ms creeps the reach stance, like holding W or S (3.1.1). */
export const REACH_CREEP_THRESHOLD = 0.9;

/** Standard Gamepad API button indices. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/** One analogue device's contribution this frame. Axes are already shaped (deadzone + response curve). */
export interface AnalogFrame {
  active: boolean;           // the device is connected and has been touched since it connected
  swingX: number;            // [-1, 1] shaped; right = +yaw
  swingY: number;            // [-1, 1] shaped; up = +elevation
  stanceX: number;           // [-1, 1] shaped; right = +yaw drift
  reachY: number;            // [-1, 1] shaped; + = reach out
  reachMagnitude: number;    // unshaped |reach| in [0, 1] for the creep threshold
  recentre: boolean;         // RS click edge this frame
  toolNotches: number;       // D-pad up / down edges this frame (+ = tool pitch down)
}

export function createAnalogFrame(): AnalogFrame {
  return { active: false, swingX: 0, swingY: 0, stanceX: 0, reachY: 0, reachMagnitude: 0, recentre: false, toolNotches: 0 };
}

export function clearAnalogFrame(f: AnalogFrame): AnalogFrame {
  f.swingX = 0; f.swingY = 0; f.stanceX = 0; f.reachY = 0; f.reachMagnitude = 0; f.recentre = false; f.toolNotches = 0;
  return f;
}

/** Single-axis curve (3.4). */
export function stickCurve(v: number, deadzone = DEFAULT_STICK_DEADZONE): number {
  const a = Math.abs(v);
  if (!(a > deadzone)) return 0;
  const t = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * Math.pow(t, STICK_EXPONENT);
}

/**
 * Radial deadzone plus response curve on the stick vector. Writes shaped x, y into out and returns the unshaped
 * post-deadzone magnitude in [0, 1]. A pure axis sweep equals stickCurve on that axis.
 */
export function shapeStick(x: number, y: number, deadzone: number, out: { x: number; y: number }): number {
  const mag = Math.hypot(x, y);
  if (!(mag > deadzone)) { out.x = 0; out.y = 0; return 0; }
  const t = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const k = Math.pow(t, STICK_EXPONENT) / mag;
  out.x = Math.max(-1, Math.min(1, x * k));
  out.y = Math.max(-1, Math.min(1, y * k));
  return t;
}

type PadLike = Pick<Gamepad, "connected" | "mapping" | "axes" | "buttons" | "index" | "timestamp">;

let activePadIndex = -1;
/** Index of the gamepad that most recently produced input, for haptics. -1 when none. */
export function activeGamepadIndex(): number {
  return activePadIndex;
}

function pressed(pad: PadLike, i: number, threshold = 0.5): boolean {
  const b = pad.buttons[i];
  if (!b) return false;
  return b.pressed || b.value >= threshold;
}

const BUTTON_INPUTS: readonly (readonly [number, CommandInput, number])[] = [
  [PAD.RT, "strike", TRIGGER_THRESHOLD],
  [PAD.LT, "guard", TRIGGER_THRESHOLD],
  [PAD.RB, "grip", 0.5],
  [PAD.LB, "overdrive", 0.5],
  [PAD.Y, "ability", 0.5],
  [PAD.X, "roll_neg", 0.5],
  [PAD.B, "roll_pos", 0.5],
];

export interface GamepadReader {
  /** Polls the pads, pushes button edges into the input system, and fills `out`. Returns true when a pad was read. */
  poll(input: InputSystem, deadzone: number, out: AnalogFrame): boolean;
  readonly connected: boolean;
  reset(): void;
}

function anyInput(pad: PadLike, deadzone: number): boolean {
  for (let i = 0; i < Math.min(4, pad.axes.length); i++) if (Math.abs(pad.axes[i] ?? 0) > Math.max(0.2, deadzone)) return true;
  for (let i = 0; i < pad.buttons.length; i++) if (pressed(pad, i, TRIGGER_THRESHOLD)) return true;
  return false;
}

/**
 * Reads the first connected standard-mapping pad that has produced input (or the pad that was already active).
 * `getPads` is injectable for tests; the default reads navigator.getGamepads().
 */
export function createGamepadReader(getPads?: () => readonly (PadLike | null)[]): GamepadReader {
  const read = getPads ?? (() => {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    return nav && typeof nav.getGamepads === "function" ? (nav.getGamepads() as readonly (Gamepad | null)[]) : [];
  });
  let padIndex = -1;
  let engaged = false;
  const prev = new Uint8Array(17);
  const stick = { x: 0, y: 0 };

  function disconnect(input: InputSystem): void {
    if (engaged) input.releaseDevice("gamepad");
    padIndex = -1;
    engaged = false;
    prev.fill(0);
    if (activePadIndex >= 0) activePadIndex = -1;
  }

  return {
    get connected() { return padIndex >= 0; },
    reset() { padIndex = -1; engaged = false; prev.fill(0); },

    poll(input, deadzone, out) {
      clearAnalogFrame(out);
      out.active = false;
      let pads: readonly (PadLike | null)[];
      try { pads = read(); } catch { pads = []; }
      let pad: PadLike | null = padIndex >= 0 ? pads[padIndex] ?? null : null;
      if (!pad || !pad.connected) {
        if (padIndex >= 0) disconnect(input);
        pad = null;
        for (const p of pads) {
          if (p && p.connected && (p.mapping === "standard" || p.axes.length >= 4) && anyInput(p, deadzone)) { pad = p; break; }
        }
        if (!pad) return false;
        padIndex = pad.index;
        engaged = false;
      }
      const dz = Number.isFinite(deadzone) ? Math.min(0.5, Math.max(0, deadzone)) : DEFAULT_STICK_DEADZONE;
      if (!engaged && !anyInput(pad, dz)) return false;
      engaged = true;
      activePadIndex = pad.index;
      out.active = true;

      const ax = pad.axes;
      shapeStick(ax[0] ?? 0, ax[1] ?? 0, dz, stick);
      out.stanceX = stick.x;
      out.reachY = -stick.y;                       // stick up (negative y) = reach out
      shapeStick(ax[2] ?? 0, ax[3] ?? 0, dz, stick);
      out.swingX = stick.x;
      out.swingY = -stick.y;                       // stick up = elevation up
      const ly = Math.abs(ax[1] ?? 0);
      out.reachMagnitude = ly > dz ? Math.min(1, (ly - dz) / (1 - dz)) : 0;

      for (const [index, cmd, threshold] of BUTTON_INPUTS) {
        const down = pressed(pad, index, threshold);
        if (down !== (prev[index] === 1)) input.handleVirtual(cmd, down, "gamepad");
        prev[index] = down ? 1 : 0;
      }
      const edge = (index: number): boolean => {
        const down = pressed(pad as PadLike, index);
        const was = prev[index] === 1;
        prev[index] = down ? 1 : 0;
        return down && !was;
      };
      if (edge(PAD.RS)) out.recentre = true;
      if (edge(PAD.UP)) out.toolNotches -= 1;
      if (edge(PAD.DOWN)) out.toolNotches += 1;
      if (edge(PAD.MENU)) input.handleUi("pause");
      // VIEW is the pad's STATS button, held exactly like the STATS key: the overlay is up while the button
      // is down. It used to raise "optics", which nothing consumes, so on a pad the scoreboard had no button
      // at all. Tracked as a level rather than an edge, and released with the device when the pad goes away.
      const view = pressed(pad, PAD.VIEW);
      if (view !== (prev[PAD.VIEW] === 1)) {
        prev[PAD.VIEW] = view ? 1 : 0;
        input.handleUiHold("stats", view, "gamepad");
      }
      return true;
    },
  };
}
