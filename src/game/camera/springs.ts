// src/game/camera/springs.ts (WP3)
// Small, allocation-free motion primitives for the cockpit camera and juice (GAME_DESIGN 3.2, 8.2): an exact
// critically damped spring (closed form, so it is stable at any frame time and during long hitches), one-pole and
// two-pole low-pass filters with frame-rate independent coefficients, and a slew limiter.

export interface Spring1 { x: number; v: number }

export function createSpring(): Spring1 {
  return { x: 0, v: 0 };
}

/**
 * Advances a critically damped spring toward `target` with angular frequency `omega` (rad/s) over `dt` seconds.
 * Exact solution of x'' = -omega^2 (x - target) - 2 omega x', so the result does not depend on how dt is split.
 */
export function stepCritical(s: Spring1, target: number, omega: number, dt: number): number {
  if (!(dt > 0)) return s.x;
  const x0 = s.x - target;
  const e = Math.exp(-omega * dt);
  const c = s.v + omega * x0;
  s.x = target + (x0 + c * dt) * e;
  s.v = (s.v - omega * c * dt) * e;
  if (Math.abs(s.x - target) < 1e-7 && Math.abs(s.v) < 1e-6) { s.x = target; s.v = 0; }
  return s.x;
}

/**
 * Velocity impulse whose resulting critically damped excursion peaks at `peak` (reached 1/omega seconds later).
 * For x(t) = v0 t e^(-omega t), the peak is v0 / (omega e).
 */
export function kickImpulse(s: Spring1, peak: number, omega: number): void {
  s.v += peak * omega * Math.E;
}

export function resetSpring(s: Spring1, x = 0): void {
  s.x = x;
  s.v = 0;
}

/** One-pole low-pass coefficient for time constant tau (s) over dt (s). */
export function onePoleAlpha(dt: number, tau: number): number {
  return dt > 0 && tau > 0 ? 1 - Math.exp(-dt / tau) : dt > 0 ? 1 : 0;
}

export function onePole(prev: number, target: number, dt: number, tau: number): number {
  return prev + (target - prev) * onePoleAlpha(dt, tau);
}

/** One-pole low-pass at a cutoff frequency (Hz). */
export function onePoleHz(prev: number, target: number, dt: number, hz: number): number {
  return onePole(prev, target, dt, 1 / (2 * Math.PI * hz));
}

/** Critically damped two-pole low-pass: two cascaded one-poles sharing tau. */
export interface TwoPole { a: number; b: number }

export function createTwoPole(v = 0): TwoPole {
  return { a: v, b: v };
}

export function stepTwoPole(f: TwoPole, target: number, dt: number, tau: number): number {
  const k = onePoleAlpha(dt, tau);
  f.a += (target - f.a) * k;
  f.b += (f.a - f.b) * k;
  return f.b;
}

export function resetTwoPole(f: TwoPole, v: number): void {
  f.a = v;
  f.b = v;
}

/** Moves `prev` toward `target` by at most maxRate * dt. */
export function slew(prev: number, target: number, maxRate: number, dt: number): number {
  const step = maxRate * Math.max(0, dt);
  const d = target - prev;
  return Math.abs(d) <= step ? target : prev + Math.sign(d) * step;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Exponential decay of a value toward zero with time constant tau. */
export function decay(v: number, dt: number, tau: number): number {
  return tau > 0 ? v * Math.exp(-Math.max(0, dt) / tau) : 0;
}
