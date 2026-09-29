// src/game/audio/impact.ts (WP8)
// The hit as one object (EMOTION_BIBLE 7, 6): every strike renders the same layer stack scaled by impulse, and a
// heavier hit adds channels rather than turning the light one up. Priorities (7): jab 4, solid 6, heavy and the crit
// tink 8, the ping tier 9. Reward layers sit on fixed offsets after the transient so the ear learns the grammar in a
// minute: crit `tink` 3.2 kHz at +40 ms, ping (raw ≥ 28) rising 1.8 → 3.6 kHz at +30 ms. Taken hits keep the same
// object with the body low-passed to 900 Hz, the sub +2 dB and a 120 ms camera-side rumble at 40–120 Hz.
//
//   0 ms   transient   4.6 kHz click (and a 2 kHz servo tick under it)
//   0 ms   body        band-passed pink noise around 880 Hz: printed shell (jab, solid, heavy)
//   0 ms   sub         70 → 38 Hz sine (heavy only, m ≥ 0.4)
//   0 ms   ring tail   short inharmonic bell (heavy only)
//   0 ms   servo shock 60 ms saw burst on the victim's servo (heavy only)
//  +30 ms  ping        rising sine (raw ≥ 28)
//  +40 ms  crit tink   FM bell at 3.2 kHz

import { click, dbToGain, fmBell, noiseBurst, semitones, toneBurst, type SynthContext } from "./synth.ts";

export type ImpactTier = "jab" | "solid" | "heavy";
/** Section 6: the light/heavy channel split. */
export const HEAVY_M = 0.4;
/** Section 6: raw damage at which the ping tier fires. */
export const PING_RAW = 28;
export const CRIT_OFFSET_S = 0.04;
export const PING_OFFSET_S = 0.03;
export const IMPACT_PRIORITY: Readonly<Record<ImpactTier, number>> = { jab: 4, solid: 6, heavy: 8 };
export const PING_PRIORITY = 9;
export const CRIT_PRIORITY = 8;

export interface ImpactOpts {
  m: number;           // normalized impact magnitude 0..1
  raw: number;         // raw damage (ping tier at ≥ 28)
  crit: boolean;
  taken: boolean;      // the player is the victim
  pitchSt?: number;    // per-call re-roll from the caller's rng
  filterMul?: number;
}

export function impactTier(m: number, raw: number): ImpactTier {
  if (m >= HEAVY_M) return "heavy";
  return m < 0.15 && raw < 8 ? "jab" : "solid";
}

/** Voice priority of the whole object: the loudest reward layer decides. */
export function impactPriority(o: ImpactOpts): number {
  if (o.raw >= PING_RAW) return PING_PRIORITY;
  if (o.crit) return CRIT_PRIORITY;
  return IMPACT_PRIORITY[impactTier(o.m, o.raw)];
}

/** Renders the impact object at `t`; returns the end of its tail. */
export function renderImpact(s: SynthContext, dest: AudioNode, t: number, o: ImpactOpts): number {
  const m = Math.max(0, Math.min(1, Number.isFinite(o.m) ? o.m : 0));
  const tier = impactTier(m, o.raw);
  const k = semitones(o.pitchSt ?? 0);
  const f = o.filterMul ?? 1;
  // The five one-shots are monotonic in peak (7): a crit and a ping are bigger hits, not just decorated ones.
  const boost = o.raw >= PING_RAW ? 1.12 : o.crit ? 1.06 : 1;
  const g = (tier === "jab" ? 0.5 : tier === "solid" ? 0.66 + 0.15 * m : 0.82 + 0.18 * m) * boost;
  const bodyHz = 880 * f * k;
  let end = t;
  // Transient + servo tick.
  end = Math.max(end, click(s, dest, t, { gain: g * 0.55, highpass: 4600 * f, lenS: 0.004 }));
  click(s, dest, t + 0.008, { gain: dbToGain(-10) * g, highpass: 2000, lenS: 0.003, body: 1400 * k });
  // Body: printed shell. A taken hit keeps the object, low-passed to 900 Hz (you are inside the housing).
  if (o.taken) {
    end = Math.max(end, noiseBurst(s, dest, t, { color: "pink", filter: "lowpass", freq: 900, q: 1.2, gain: g * 1.0, attackS: 0.0015, decayS: 0.06 + 0.05 * m, rate: 0.9 }));
  } else {
    end = Math.max(end, noiseBurst(s, dest, t, { color: "pink", filter: "bandpass", freq: bodyHz, q: 1.6, gain: g * 0.9, attackS: 0.0015, decayS: 0.05 + 0.04 * m, rate: 0.95 }));
  }
  toneBurst(s, dest, t, { wave: "triangle", freq: 540 * k, freqEnd: 470 * k, gain: g * 0.22, attackS: 0.001, decayS: 0.045 });
  if (tier === "heavy") {
    // Sub 70 → 38 Hz, ring tail, servo shock: the channels a heavy hit adds.
    const subGain = g * 0.8 * (o.taken ? dbToGain(2) : 1);
    end = Math.max(end, toneBurst(s, dest, t, { wave: "sine", freq: 70, freqEnd: 38, glideS: 0.14, gain: subGain, attackS: 0.002, decayS: 0.16 }));
    end = Math.max(end, fmBell(s, dest, t, { freq: 330 * k, ratio: 2.4, index: 2, gain: g * 0.16, decayS: 0.28, partial: 2.92 }));
    end = Math.max(end, toneBurst(s, dest, t + 0.004, { wave: "sawtooth", freq: 210 * k, freqEnd: 140 * k, gain: g * 0.14, attackS: 0.002, decayS: 0.06, filter: { type: "lowpass", freq: 1800 * f, q: 1.4 } }));
  } else if (tier === "solid") {
    end = Math.max(end, toneBurst(s, dest, t, { wave: "sine", freq: 78 * k, freqEnd: 50, glideS: 0.08, gain: g * 0.55, attackS: 0.002, decayS: 0.09 }));
  }
  if (o.taken) {
    // Camera-side rumble, 40–120 Hz for 120 ms.
    end = Math.max(end, noiseBurst(s, dest, t, { color: "brown", filter: "lowpass", freq: 120, q: 0.9, gain: g * 0.9, attackS: 0.004, decayS: 0.12 }));
  }
  if (o.raw >= PING_RAW) {
    // The ping tier: reward layer centroid above 2 kHz.
    end = Math.max(end, toneBurst(s, dest, t + PING_OFFSET_S, { wave: "sine", freq: 1800 * k, freqEnd: 3600 * k, glideS: 0.11, gain: 0.5, attackS: 0.003, decayS: 0.16 }));
    click(s, dest, t + PING_OFFSET_S, { gain: 0.3, highpass: 5000, lenS: 0.002 });
  }
  if (o.crit) {
    end = Math.max(end, fmBell(s, dest, t + CRIT_OFFSET_S, { freq: 3200 * k, ratio: 1.41, index: 1.3, gain: 0.42, decayS: 0.36 }));
  }
  return end;
}
