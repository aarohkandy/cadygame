// src/game/audio/prosody.ts (WP8)
// Prosody as data (EMOTION_BIBLE 7, hosts): a caption unit carries `ramp 0..3`; this maps it to what the caption
// renderer (WP7 captions.tsx) and the Web Speech voice (WP7 host-voice.ts, behind the HOST VOICE toggle) do with it.
// Nothing here plays audio; it is the one table both consumers read so a ROOK release line looks and sounds like one.

export interface Prosody {
  /** Caption font weight, 500 → 900. */
  weight: number;
  /** Caption size multiplier, 1.0 → 1.35. */
  size: number;
  /** Caption reveal speed, 28 → 60 characters per second. */
  revealCps: number;
  /** SpeechSynthesisUtterance.rate multiplier over the host's base rate (0.5..2). */
  rate: number;
  /** SpeechSynthesisUtterance.pitch offset over the host's base pitch (−0.2 .. +0.25). */
  pitch: number;
  /** Release lines stretch the final word: hold multiplier for the last word's reveal and a trailing pause (ms). */
  finalWordHold: number;
  trailingPauseMs: number;
}

export const RAMP_MAX = 3;

/** ramp 0..3 → weight 500 → 900, size 1.0 → 1.35, reveal 28 → 60 cps; a release line stretches its final word. */
export function prosodyFor(ramp: number, release = false): Prosody {
  const r = Math.max(0, Math.min(RAMP_MAX, Number.isFinite(ramp) ? ramp : 0)) / RAMP_MAX;
  return {
    weight: Math.round(500 + 400 * r),
    size: 1 + 0.35 * r,
    revealCps: 28 + 32 * r,
    rate: 0.95 + 0.25 * r,
    pitch: -0.05 + 0.3 * r,
    finalWordHold: release ? 2.2 : 1,
    trailingPauseMs: release ? 380 : 120 + 80 * r,
  };
}

/**
 * Speech parameters for a caption unit, clamped to what Web Speech accepts. `base` is the host's profile
 * (brand/hosts.ts speech pitch and rate). Dry, near-field, PA band-pass is the bus (audio-engine voice bus), not a
 * voice setting.
 */
export function speechFor(base: { pitch: number; rate: number }, ramp: number, release = false): { pitch: number; rate: number } {
  const p = prosodyFor(ramp, release);
  return {
    pitch: Math.max(0, Math.min(2, base.pitch + p.pitch)),
    rate: Math.max(0.5, Math.min(2, base.rate * p.rate * (release ? 0.9 : 1))),
  };
}
