// src/game/ui/touch/gestures.ts (Area J - phone and tablet)
// Flick-to-strike. On a pad the swing stick is an aim device, and asking a thumb to sweep the arm and then leave
// the stick to press STRIKE costs the whole exchange. So the swing pad reads its own motion: a fast, committed drag
// IS the strike, and it fires at the moment the thumb is moving fastest, which is where a real swing connects.
// A slow sweep of the same distance only aims, so you can still line up a grip without throwing a punch.
//
// The detector is a pure state machine over (x, y, t) samples in stick units, so the timing is unit-tested rather
// than eyeballed on a phone. It has to re-arm before it can fire again: one flick per commitment, never a stream.

/** A flick the pad recognised. `strength` is 0 at the trigger speed and 1 at a full-speed sweep. */
export interface Flick {
  /** Unit direction of the swing at the moment it fired. */
  dirX: number;
  dirY: number;
  /** Peak speed, in stick units per second. */
  speed: number;
  strength: number;
  /** How long to hold the strike input down, in ms. Always inside the jab window, never a charge. */
  pressMs: number;
}

export interface FlickOptions {
  /** Speed a drag has to beat to count as a strike, in stick units per second. */
  triggerSpeed: number;
  /** Speed of a sweep that scores `strength` 1. */
  fullSpeed: number;
  /** Distance the thumb has to have travelled inside the window before a flick can fire. */
  minTravel: number;
  /** Window the speed is measured over, in ms. */
  windowMs: number;
  /** The thumb has to drop below this to arm the next flick. */
  rearmSpeed: number;
  /** Shortest and longest strike press a flick produces; both are inside the jab window. */
  minPressMs: number;
  maxPressMs: number;
}

// Tuned against the swing stick's own units, where a full edge-to-edge sweep is 2.0. A deliberate aim sweep takes
// 300 ms or so and scores about 5, under the trigger; a committed flick crosses in 90 ms and scores about 18. The
// press it produces always lands inside the pilot's jab window, so a flick is a jab and a charge is still a held
// STRIKE - the gesture never steals the heavy.
export const FLICK_DEFAULTS: Readonly<FlickOptions> = {
  triggerSpeed: 6,
  fullSpeed: 18,
  minTravel: 0.42,
  windowMs: 90,
  rearmSpeed: 3,
  minPressMs: 70,
  maxPressMs: 130,
};

export interface FlickDetector {
  /** Feeds one pad sample. Returns a flick on the frame it fires, otherwise null. */
  sample(x: number, y: number, tMs: number): Flick | null;
  /** The thumb left the pad. */
  end(): void;
  /** True while the detector is waiting for the thumb to slow down before it can fire again. */
  readonly armed: boolean;
}

interface Sample { x: number; y: number; t: number }

export function createFlickDetector(options: Partial<FlickOptions> = {}): FlickDetector {
  const o: FlickOptions = { ...FLICK_DEFAULTS, ...options };
  const trail: Sample[] = [];
  let armed = true;

  function reset(): void {
    trail.length = 0;
    armed = true;
  }

  return {
    get armed() { return armed; },
    end: reset,
    sample(x, y, tMs) {
      const last = trail[trail.length - 1];
      // A repeated timestamp carries no motion; keeping it would divide by zero and read as infinite speed.
      if (last && tMs <= last.t) { last.x = x; last.y = y; return null; }
      trail.push({ x, y, t: tMs });
      while (trail.length > 2 && tMs - trail[0].t > o.windowMs) trail.shift();

      const first = trail[0];
      const dt = (tMs - first.t) / 1000;
      if (dt <= 0) return null;
      const dx = x - first.x;
      const dy = y - first.y;
      const travel = Math.hypot(dx, dy);
      const speed = travel / dt;

      if (!armed) {
        if (speed < o.rearmSpeed) armed = true;
        return null;
      }
      if (speed < o.triggerSpeed || travel < o.minTravel) return null;

      armed = false;
      const strength = Math.min(1, Math.max(0, (speed - o.triggerSpeed) / Math.max(1e-6, o.fullSpeed - o.triggerSpeed)));
      return {
        dirX: dx / travel,
        dirY: dy / travel,
        speed,
        strength,
        pressMs: Math.round(o.minPressMs + (o.maxPressMs - o.minPressMs) * strength),
      };
    },
  };
}

/**
 * Haptic weight for a flick, in the `navigator.vibrate` millisecond form. A grazing flick is a tick and a committed
 * one is a thump, so the hand can tell how hard it just swung without reading the screen.
 */
export function flickHaptic(f: Flick): number {
  return Math.round(8 + 14 * f.strength);
}
