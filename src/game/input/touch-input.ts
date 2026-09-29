// src/game/input/touch-input.ts (WP3)
// TouchInput (BUILD_PLAN 2.2): the virtual controls feed the same analogue frame and the same held-source edge path
// as the gamepad, so a swing-stick sweep from -1 to +1 is the same 1.8 rad hook, a strike touch held 150 ms is a jab
// and 400 ms is a charge, and guard, grip, stance, and reach land in the same command fields. Values arrive already
// past the radial deadzone (ui/touch/touch-layer.tsx applies it in pixel space); this module applies the gamepad's 1.5 power
// response so both devices feel identical under the thumb.

import type { TouchInput } from "../contracts.ts";
import { STICK_EXPONENT, type AnalogFrame } from "./gamepad.ts";
import type { CommandInput, InputSystem } from "./input-system.ts";

/** Minimum touch target edge (px) for every on-screen control. */
export const MIN_TARGET_PX = 44;

/** Whether touch controls show for a settings mode ("auto" follows the `(pointer: coarse)` media query). */
export function touchControlsEnabled(mode: "auto" | "on" | "off", coarse: boolean): boolean {
  return mode === "on" || (mode === "auto" && coarse);
}

/** Radial deadzone of the on-screen sticks, as a fraction of the stick radius. */
export const TOUCH_DEADZONE = 0.12;

const BUTTON_TO_INPUT: Readonly<Record<Parameters<TouchInput["button"]>[0], CommandInput>> = {
  strike: "strike", guard: "guard", grip: "grip", overdrive: "overdrive", ability: "ability",
};

function clamp1(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** The gamepad's response curve applied to the stick vector's length, so diagonals shape exactly like the pad. */
function respond(x: number, y: number, out: { x: number; y: number }): void {
  const mag = Math.hypot(x, y);
  if (mag <= 0) { out.x = 0; out.y = 0; return; }
  const k = Math.pow(Math.min(1, mag), STICK_EXPONENT) / mag;
  out.x = x * k;
  out.y = y * k;
}

/**
 * Pointer offset from a stick's centre (pixels) to a stick value in [-1, 1] per axis with a radial deadzone.
 * Screen y grows downward, so an upward drag gives a positive y. Returns the post-deadzone magnitude in [0, 1].
 */
export function stickFromPointer(dxPx: number, dyPx: number, radiusPx: number, out: { x: number; y: number }, deadzone = TOUCH_DEADZONE): number {
  const r = radiusPx > 0 ? radiusPx : 1;
  const nx = dxPx / r;
  const ny = -dyPx / r;
  const mag = Math.hypot(nx, ny);
  if (!(mag > deadzone)) { out.x = 0; out.y = 0; return 0; }
  const t = Math.min(1, (mag - deadzone) / (1 - deadzone));
  out.x = (nx / mag) * t;
  out.y = (ny / mag) * t;
  return t;
}

/** Knob position in pixels for a pointer offset, clamped to the stick radius (the knob never leaves the ring). */
export function knobOffset(dxPx: number, dyPx: number, radiusPx: number, out: { x: number; y: number }): { x: number; y: number } {
  const mag = Math.hypot(dxPx, dyPx);
  const k = mag > radiusPx && mag > 0 ? radiusPx / mag : 1;
  out.x = dxPx * k;
  out.y = dyPx * k;
  return out;
}

export interface TouchChannel {
  readonly touch: TouchInput;
  /** True while any touch control is held or a stick is off-centre. */
  readonly engaged: boolean;
  /** Copies the shaped analogue state into `out` (the pilot calls this once per sampled frame). */
  read(out: AnalogFrame): boolean;
}

export function createTouchChannel(input: InputSystem): TouchChannel {
  let swingX = 0;
  let swingY = 0;
  let stanceX = 0;
  let reachY = 0;
  const held = new Set<string>();
  const shaped = { x: 0, y: 0 };

  const touch: TouchInput = {
    swing(x, y) {
      swingX = clamp1(x);
      swingY = clamp1(y);
    },
    stance(x) {
      stanceX = clamp1(x);
    },
    reach(y) {
      reachY = clamp1(y);
    },
    button(id, down) {
      const cmd = BUTTON_TO_INPUT[id];
      if (!cmd) return;
      if (down) held.add(id); else held.delete(id);
      input.handleVirtual(cmd, down, "touch");
    },
    release() {
      swingX = 0; swingY = 0; stanceX = 0; reachY = 0;
      held.clear();
      input.releaseDevice("touch");
    },
  };

  return {
    touch,
    get engaged() { return held.size > 0 || swingX !== 0 || swingY !== 0 || stanceX !== 0 || reachY !== 0; },
    read(out) {
      respond(swingX, swingY, shaped);
      out.swingX = shaped.x;
      out.swingY = shaped.y;
      respond(stanceX, reachY, shaped);
      out.stanceX = shaped.x;
      out.reachY = shaped.y;
      out.reachMagnitude = Math.abs(reachY);
      out.recentre = false;
      out.toolNotches = 0;
      out.active = true;
      return true;
    },
  };
}
