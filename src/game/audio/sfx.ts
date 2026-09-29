// src/game/audio/sfx.ts (WP8)
// One-shot recipes (GAME_DESIGN 9.4 rebuilt as synthesis per SCOPE 3; EMOTION_BIBLE 7 priorities and the new
// cues). Strikes themselves are the impact object in impact.ts; the recipes here are everything else: guards,
// deflects, the Core drama, the boot ritual (relay clicks and 400 → 1400 Hz chirps), the count-in kick, the dock
// clunk with its C5–G5 rise, the gripper's three stages, the t₀ clack, the crowd's cough and late whistle, and the UI.
// Pitch and filter are re-rolled on every call inside each recipe's range so repeats never machine-gun. Priorities
// follow section 7 (lock 10; steal 9; heavy, crit, engage 8; solid, block, deflect, clash 6; jab, servo shock,
// ticks 4; cube taps 2; UI 1).

import type { Rng } from "../core/rng.ts";
import { click, dbToGain, fmBell, noiseBurst, semitones, toneBurst, type SynthContext } from "./synth.ts";

export const SFX_IDS = [
  "thunk", "tap_soft", "tok", "crack", "tink", "crunch_light", "crunch", "thock", "clang", "ting", "stun_down", "clash",
  "whiff", "charge_ping", "release", "cancel", "stagger_zap", "burst", "power_down", "snap", "coil", "bulwark",
  "cube_tap", "latch", "riser", "steal", "lock", "engage", "tick", "lockin_tick", "buzzer", "fault_blip", "relay_click",
  "spin_down", "heat_ping",
  "t0_clack", "boot_chirp", "count_kick", "dock_clunk", "late_guard_ticks", "gripper_roll", "gripper_lock", "gripper_contact",
  "stop_click", "cough", "whistle", "stomp",
  "ui_hover", "ui_select", "ui_back", "ui_slam", "ui_stamp", "ui_sticker", "ui_countdown", "ui_shutter",
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export interface SfxParams {
  intensity: number;   // 0..1 (strike magnitude, tick urgency)
  pitchSt: number;     // semitone offset rolled for this call
  filterMul: number;   // filter frequency multiplier rolled for this call
}

export interface SfxRecipe {
  id: SfxId;
  bus: "sfx" | "ui";
  /** Voice priority 1–10 (EMOTION_BIBLE 7): kill confirm / lock 10, steal 9, heavy 8, solid / block / deflect 6, jab / ticks 4, beds 2, UI 1. */
  priority: number;
  pitchRangeSt: readonly [number, number];
  filterRange: readonly [number, number];
  render(s: SynthContext, dest: AudioNode, t: number, p: SfxParams): number;
}

/** Rolls this call's pitch and filter inside the recipe's range. `pitchOffsetSt` is added (e.g. +3 m for tok). */
export function rollSfxParams(recipe: SfxRecipe, rng: Rng, intensity: number, pitchOffsetSt = 0): SfxParams {
  return {
    intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0)),
    pitchSt: rng.range(recipe.pitchRangeSt[0], recipe.pitchRangeSt[1]) + pitchOffsetSt,
    filterMul: rng.range(recipe.filterRange[0], recipe.filterRange[1]),
  };
}

const NONE: readonly [number, number] = [0, 0];
const UNITY: readonly [number, number] = [1, 1];

/** Two-note clav pluck used by the steal and lock stings (motif fragments). */
function pluck(s: SynthContext, dest: AudioNode, t: number, hz: number, gain: number, len = 0.22): number {
  toneBurst(s, dest, t, { wave: "square", freq: hz, gain: gain * 0.5, attackS: 0.002, decayS: len, filter: { type: "lowpass", freq: hz * 6, freqEnd: hz * 1.5, q: 2.5 } });
  return toneBurst(s, dest, t, { wave: "triangle", freq: hz * 2, gain: gain * 0.2, attackS: 0.001, decayS: len * 0.5 });
}

function subThump(s: SynthContext, dest: AudioNode, t: number, hz: number, gain: number, decayS: number): number {
  return toneBurst(s, dest, t, { wave: "sine", freq: hz, freqEnd: hz * 0.55, glideS: decayS, gain, attackS: 0.002, decayS });
}

const R: Record<SfxId, SfxRecipe> = {
  thunk: {
    id: "thunk", bus: "sfx", priority: 4, pitchRangeSt: [-2, 2], filterRange: [0.85, 1.15],
    render(s, d, t, p) {
      const g = dbToGain(-12) * (0.6 + 0.4 * p.intensity);
      noiseBurst(s, d, t, { color: "pink", filter: "lowpass", freq: 400 * p.filterMul, q: 1.1, gain: g * 1.2, attackS: 0.002, decayS: 0.07 });
      return subThump(s, d, t, 95 * semitones(p.pitchSt), g, 0.08);
    },
  },
  tap_soft: {
    id: "tap_soft", bus: "sfx", priority: 4, pitchRangeSt: [-1.5, 1.5], filterRange: [0.85, 1.2],
    render(s, d, t, p) {
      const g = dbToGain(-10);
      click(s, d, t, { gain: g * 0.9, highpass: 3200 * p.filterMul, lenS: 0.003 });
      return noiseBurst(s, d, t, { filter: "bandpass", freq: 1900 * p.filterMul * semitones(p.pitchSt), q: 3, gain: g * 0.7, attackS: 0.001, decayS: 0.03 });
    },
  },
  tok: {
    id: "tok", bus: "sfx", priority: 6, pitchRangeSt: [-1.2, 1.2], filterRange: [0.86, 1.16],
    render(s, d, t, p) {
      const m = p.intensity;
      const k = semitones(p.pitchSt);
      const g = 0.55 + 0.35 * m;
      // sub thump (weight) + mid body (printed shell) + high tick (transient) + servo tick layer at -10 dB
      subThump(s, d, t, 78 * k, g * 0.7, 0.07 + 0.05 * m);
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 880 * p.filterMul * k, q: 1.6, gain: g * 0.9, attackS: 0.0015, decayS: 0.05 + 0.04 * m, rate: 0.95 });
      toneBurst(s, d, t, { wave: "triangle", freq: 540 * k, freqEnd: 470 * k, gain: g * 0.22, attackS: 0.001, decayS: 0.045 });
      click(s, d, t, { gain: g * 0.55, highpass: 4600 * p.filterMul, lenS: 0.004 });
      return click(s, d, t + 0.008, { gain: dbToGain(-10) * g, highpass: 2000, lenS: 0.003, body: 1400 * k });
    },
  },
  crack: {
    id: "crack", bus: "sfx", priority: 8, pitchRangeSt: [-1, 1], filterRange: [0.85, 1.2],
    render(s, d, t, p) {
      const g = dbToGain(-6) * (0.7 + 0.3 * p.intensity);
      click(s, d, t, { gain: g * 0.7, highpass: 5200 * p.filterMul, lenS: 0.003 });
      // Shell splitting, not hiss: uncapped this spreads half its energy above 12 kHz, where it costs headroom on
      // every heavy hit and buys nothing but fizz on small speakers.
      return noiseBurst(s, d, t, { filter: "highpass", freq: 6000 * p.filterMul, freqEnd: 1500, q: 0.8, topHz: 12000, gain: g * 0.8, attackS: 0.001, decayS: 0.08, rate: 1.2 * semitones(p.pitchSt) });
    },
  },
  tink: {
    id: "tink", bus: "sfx", priority: 8, pitchRangeSt: [5.5, 8.5], filterRange: UNITY,
    render(s, d, t, p) {
      return fmBell(s, d, t, { freq: 1760 * semitones(p.pitchSt - 7), ratio: 1.41, index: 1.3, gain: dbToGain(-8) * 0.9, decayS: 0.38 });
    },
  },
  crunch_light: {
    id: "crunch_light", bus: "sfx", priority: 6, pitchRangeSt: [-1.5, 1.5], filterRange: [0.85, 1.15],
    render(s, d, t, p) {
      const g = 0.5 + 0.2 * p.intensity;
      for (let i = 0; i < 3; i++) noiseBurst(s, d, t + i * 0.009, { color: "pink", filter: "lowpass", freq: 900 * p.filterMul, q: 1.4, gain: g * (0.9 - i * 0.2), attackS: 0.001, decayS: 0.025 });
      return subThump(s, d, t, 70 * semitones(p.pitchSt), dbToGain(-8) * g * 1.4, 0.18);
    },
  },
  crunch: {
    id: "crunch", bus: "sfx", priority: 8, pitchRangeSt: [-1.5, 1], filterRange: [0.85, 1.15],
    render(s, d, t, p) {
      const g = 0.6 + 0.3 * p.intensity;
      for (let i = 0; i < 5; i++) {
        noiseBurst(s, d, t + i * 0.011 + s.rng.range(0, 0.003), { color: i % 2 ? "brown" : "pink", filter: "lowpass", freq: 900 * p.filterMul * (1 - i * 0.08), q: 1.8, gain: g * (1 - i * 0.15), attackS: 0.001, decayS: 0.035 });
      }
      click(s, d, t, { gain: g * 0.5, highpass: 3000 * p.filterMul, lenS: 0.004 });
      return subThump(s, d, t, 70 * semitones(p.pitchSt), dbToGain(-8) * g * 1.8, 0.2);
    },
  },
  thock: {
    id: "thock", bus: "sfx", priority: 6, pitchRangeSt: [-1, 1], filterRange: [0.88, 1.12],
    render(s, d, t, p) {
      const g = dbToGain(-6);
      const k = semitones(p.pitchSt);
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 400 * p.filterMul * k, q: 2.2, gain: g * 1.1, attackS: 0.002, decayS: 0.08 });
      return toneBurst(s, d, t, { wave: "sine", freq: 150 * k, freqEnd: 95 * k, gain: g * 0.6, attackS: 0.002, decayS: 0.09 });
    },
  },
  clang: {
    id: "clang", bus: "sfx", priority: 6, pitchRangeSt: [-1, 1], filterRange: UNITY,
    render(s, d, t, p) {
      return fmBell(s, d, t, { freq: 620 * semitones(p.pitchSt), ratio: 2.76, index: 3, gain: dbToGain(-9) * 0.9, decayS: 0.42, partial: 2.41 });
    },
  },
  ting: {
    id: "ting", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: UNITY,
    render(s, d, t, p) {
      const g = dbToGain(-4) * 0.55;
      const k = semitones(p.pitchSt);
      click(s, d, t, { gain: g * 0.6, highpass: 6000, lenS: 0.002 });
      fmBell(s, d, t, { freq: 1760 * k, ratio: 1.41, index: 1.8, gain: g, decayS: 0.3 });
      return fmBell(s, d, t + 0.07, { freq: 1760 * k * semitones(7), ratio: 1.41, index: 1.5, gain: g * 0.9, decayS: 0.45 });
    },
  },
  stun_down: {
    id: "stun_down", bus: "sfx", priority: 6, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const k = semitones(p.pitchSt);
      toneBurst(s, d, t, { wave: "sawtooth", freq: 900 * k, freqEnd: 110 * k, glideS: 0.25, gain: dbToGain(-8) * 0.5, attackS: 0.003, decayS: 0.25, filter: { type: "bandpass", freq: 1200 * p.filterMul, freqEnd: 300, q: 2 } });
      return click(s, d, t, { gain: dbToGain(-8) * 0.6, highpass: 2400, lenS: 0.004, body: 700 });
    },
  },
  clash: {
    id: "clash", bus: "sfx", priority: 6, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.12],
    render(s, d, t, p) {
      const g = dbToGain(-3);
      const k = semitones(p.pitchSt);
      // Two arms meeting at full torque: a heavy low bell that rings, with an edge on top. It must not read as a
      // cymbal, or it lands in the deflect's register and the ear stops telling the two apart.
      fmBell(s, d, t, { freq: 330 * k, ratio: 2.4, index: 4, gain: g * 0.44, decayS: 0.95, partial: 2.92 });
      fmBell(s, d, t, { freq: 660 * k, ratio: 1.41, index: 2.2, gain: g * 0.2, decayS: 0.4, partial: 2.41 });
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 2300 * p.filterMul, freqEnd: 850, q: 1.1, topHz: 8000, gain: g * 0.42, attackS: 0.001, decayS: 0.085 });
      return subThump(s, d, t, 64 * k, g * 0.62, 0.17);
    },
  },
  whiff: {
    id: "whiff", bus: "sfx", priority: 4, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.12],
    render(s, d, t, p) {
      // A swung arm displacing air. The old single narrow band lost ~18 dB in the filter and vanished under the
      // crowd; this is a wider swish with a low body under it, so a miss is something you hear, not something you
      // infer from the damage not arriving.
      const g = dbToGain(-14) * 4.2;
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 2000 * p.filterMul, freqEnd: 620 * p.filterMul, q: 0.9, topHz: 11000, gain: g, attackS: 0.035, decayS: 0.15 });
      return noiseBurst(s, d, t + 0.012, { color: "brown", filter: "lowpass", freq: 760 * p.filterMul, q: 0.8, gain: g * 0.5, attackS: 0.045, decayS: 0.13 });
    },
  },
  charge_ping: {
    id: "charge_ping", bus: "sfx", priority: 6, pitchRangeSt: [-0.3, 0.3], filterRange: UNITY,
    render(s, d, t, p) {
      const g = dbToGain(-10);
      click(s, d, t, { gain: g, highpass: 2600, lenS: 0.003, body: 1300 });
      return toneBurst(s, d, t + 0.012, { wave: "sine", freq: 2093 * semitones(p.pitchSt), gain: g * 0.6, attackS: 0.002, decayS: 0.12 });
    },
  },
  release: {
    id: "release", bus: "sfx", priority: 4, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-6) * 0.8;
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 1300 * p.filterMul, freqEnd: 700, q: 1.2, gain: g * 0.7, attackS: 0.005, decayS: 0.115 });
      return toneBurst(s, d, t, { wave: "sine", freq: 62 * semitones(p.pitchSt), freqEnd: 42, gain: g * 0.8, attackS: 0.003, decayS: 0.2 });
    },
  },
  cancel: {
    id: "cancel", bus: "sfx", priority: 2, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      return click(s, d, t, { gain: dbToGain(-10) * 1.2, highpass: 1800 * p.filterMul, lenS: 0.005, body: 420 * semitones(p.pitchSt) });
    },
  },
  stagger_zap: {
    id: "stagger_zap", bus: "sfx", priority: 4, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-8) * 0.6;
      let end = t;
      for (let i = 0; i < 9; i++) {
        const at = t + i * 0.033 + s.rng.range(0, 0.006);
        end = toneBurst(s, d, at, { wave: "square", freq: 210 * semitones(p.pitchSt + (i % 3) - 1), gain: g * (1 - i * 0.07), attackS: 0.002, decayS: 0.018, filter: { type: "lowpass", freq: 1800 * p.filterMul, q: 1.5 } });
      }
      return end;
    },
  },
  burst: {
    id: "burst", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-6);
      click(s, d, t, { gain: g * 0.9, highpass: 1600, lenS: 0.006, body: 300 });
      return toneBurst(s, d, t + 0.01, { wave: "sawtooth", freq: 320 * semitones(p.pitchSt), freqEnd: 1600, glideS: 0.2, gain: g * 0.35, attackS: 0.01, decayS: 0.2, filter: { type: "bandpass", freq: 1400 * p.filterMul, q: 1.4 } });
    },
  },
  power_down: {
    id: "power_down", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-6);
      click(s, d, t, { gain: g * 0.8, highpass: 1800, lenS: 0.005, body: 380 });
      toneBurst(s, d, t, { wave: "sawtooth", freq: 720 * semitones(p.pitchSt), freqEnd: 55, glideS: 0.9, gain: g * 0.35, attackS: 0.005, decayS: 0.9, filter: { type: "lowpass", freq: 2400 * p.filterMul, freqEnd: 300, q: 1.2 } });
      return click(s, d, t + 0.7, { gain: g * 0.6, highpass: 1800, lenS: 0.005, body: 360 });
    },
  },
  snap: {
    id: "snap", bus: "sfx", priority: 6, pitchRangeSt: [2, 4], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-8);
      noiseBurst(s, d, t, { filter: "bandpass", freq: 3000 * p.filterMul, q: 2.5, gain: g, attackS: 0.001, decayS: 0.018 });
      return click(s, d, t + 0.004, { gain: g * 0.8, highpass: 2600, lenS: 0.003, body: 1500 * semitones(p.pitchSt) });
    },
  },
  coil: {
    id: "coil", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const { ctx } = s;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200 * semitones(p.pitchSt), t);
      osc.frequency.exponentialRampToValueAtTime(700, t + 0.4);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 12;
      const depth = ctx.createGain();
      depth.gain.value = 18;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 900 * p.filterMul; f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(dbToGain(-10) * 0.6, t + 0.05);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.42);
      osc.connect(f); f.connect(g); g.connect(d);
      osc.start(t); lfo.start(t); osc.stop(t + 0.44); lfo.stop(t + 0.44);
      return t + 0.44;
    },
  },
  bulwark: {
    id: "bulwark", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-9);
      noiseBurst(s, d, t, { color: "brown", filter: "lowpass", freq: 200 * p.filterMul, gain: g * 1.4, attackS: 0.003, decayS: 0.16 });
      return toneBurst(s, d, t + 0.02, { wave: "sawtooth", freq: 480 * semitones(p.pitchSt), freqEnd: 560, glideS: 0.5, gain: g * 0.25, attackS: 0.04, decayS: 0.48, filter: { type: "bandpass", freq: 900, q: 2 } });
    },
  },
  cube_tap: {
    id: "cube_tap", bus: "sfx", priority: 2, pitchRangeSt: [-2, 2], filterRange: [0.85, 1.2],
    render(s, d, t, p) {
      const g = 0.25 + 0.45 * p.intensity;
      noiseBurst(s, d, t, { filter: "bandpass", freq: 1150 * p.filterMul, q: 3.2, gain: g * 0.7, attackS: 0.001, decayS: 0.05 });
      return toneBurst(s, d, t, { wave: "triangle", freq: 560 * semitones(p.pitchSt), gain: g * 0.3, attackS: 0.001, decayS: 0.04 });
    },
  },
  latch: {
    id: "latch", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-4) * 0.8;
      click(s, d, t, { gain: g, highpass: 2200 * p.filterMul, lenS: 0.004, body: 520 * semitones(p.pitchSt) });
      return click(s, d, t + 0.026, { gain: g * 0.75, highpass: 1600 * p.filterMul, lenS: 0.006, body: 330 * semitones(p.pitchSt) });
    },
  },
  riser: {
    id: "riser", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const { ctx } = s;
      const src = ctx.createBufferSource();
      src.buffer = s.noise.pink; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.Q.value = 2.2;
      f.frequency.setValueAtTime(400 * p.filterMul, t);
      f.frequency.exponentialRampToValueAtTime(5200 * p.filterMul, t + 2.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 2.8);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 3.05);
      src.connect(f); f.connect(g); g.connect(d);
      src.start(t, s.rng.range(0, 1)); src.stop(t + 3.1);
      // Hopper rattle: clicks accelerating toward the drop.
      let at = t + 0.15;
      let gap = 0.16;
      while (at < t + 2.95) {
        click(s, d, at, { gain: 0.08 + 0.14 * ((at - t) / 3), highpass: 2800 * semitones(p.pitchSt), lenS: 0.003 });
        at += gap * s.rng.range(0.7, 1.3);
        gap = Math.max(0.03, gap * 0.93);
      }
      return t + 3.1;
    },
  },
  steal: {
    id: "steal", bus: "sfx", priority: 9, pitchRangeSt: [-0.3, 0.3], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = 0.5;
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 900 * p.filterMul, freqEnd: 1700, q: 1.6, gain: g * 0.8, attackS: 0.02, decayS: 0.28 });
      pluck(s, d, t + 0.05, 587.33 * semitones(p.pitchSt), g);           // D5
      return pluck(s, d, t + 0.05 + 0.144, 698.46 * semitones(p.pitchSt), g, 0.35);   // F5
    },
  },
  lock: {
    id: "lock", bus: "sfx", priority: 10, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t, p) {
      const g = dbToGain(-4) * 0.75;
      click(s, d, t, { gain: g, highpass: 2000, lenS: 0.005, body: 480 });
      click(s, d, t + 0.024, { gain: g * 0.8, highpass: 1500, lenS: 0.006, body: 300 });
      subThump(s, d, t, 60, g * 0.8, 0.2);
      pluck(s, d, t + 0.12, 587.33 * semitones(p.pitchSt), 0.55, 0.25);   // D5
      return pluck(s, d, t + 0.12 + 0.288, 880 * semitones(p.pitchSt), 0.6, 0.6);  // A5
    },
  },
  engage: {
    id: "engage", bus: "sfx", priority: 8, pitchRangeSt: NONE, filterRange: [0.95, 1.05],
    render(s, d, t, p) {
      const g = 0.7;
      subThump(s, d, t, 110, g * 0.9, 0.14);
      noiseBurst(s, d, t, { filter: "bandpass", freq: 1800 * p.filterMul, q: 0.9, gain: g * 0.7, attackS: 0.001, decayS: 0.16 });
      toneBurst(s, d, t, { wave: "triangle", freq: 190, freqEnd: 160, gain: g * 0.35, attackS: 0.001, decayS: 0.1 });
      return noiseBurst(s, d, t + 0.005, { filter: "highpass", freq: 5500, q: 0.6, gain: g * 0.45, attackS: 0.002, decayS: 1.2 });
    },
  },
  tick: {
    id: "tick", bus: "sfx", priority: 4, pitchRangeSt: [-0.2, 0.2], filterRange: [0.95, 1.05],
    render(s, d, t, p) {
      return click(s, d, t, { gain: dbToGain(-16 + 6 * p.intensity) * 1.5, highpass: 2400 * p.filterMul, lenS: 0.004, body: 900 * semitones(p.pitchSt) });
    },
  },
  lockin_tick: {
    id: "lockin_tick", bus: "sfx", priority: 4, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t, p) {
      const g = 0.18 + 0.1 * p.intensity;
      noiseBurst(s, d, t, { filter: "highpass", freq: 2000, gain: g, attackS: 0.0005, decayS: 0.003 });
      return toneBurst(s, d, t, { wave: "sine", freq: 1600 * semitones(p.pitchSt), gain: g * 0.8, attackS: 0.001, decayS: 0.02 });
    },
  },
  buzzer: {
    id: "buzzer", bus: "sfx", priority: 6, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      const g = 0.16;
      toneBurst(s, d, t, { wave: "square", freq: 440, gain: g, attackS: 0.004, holdS: 0.56, decayS: 0.04, filter: { type: "bandpass", freq: 1300, q: 1.1 } });
      return toneBurst(s, d, t, { wave: "square", freq: 466.16, gain: g * 0.8, attackS: 0.004, holdS: 0.56, decayS: 0.04, filter: { type: "bandpass", freq: 1300, q: 1.1 } });
    },
  },
  fault_blip: {
    id: "fault_blip", bus: "ui", priority: 1, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      const g = dbToGain(-12) * 1.4;
      toneBurst(s, d, t, { wave: "square", freq: 330, gain: g * 0.5, attackS: 0.002, holdS: 0.05, decayS: 0.01 });
      return toneBurst(s, d, t + 0.09, { wave: "square", freq: 330, gain: g * 0.5, attackS: 0.002, holdS: 0.05, decayS: 0.01 });
    },
  },
  relay_click: {
    id: "relay_click", bus: "sfx", priority: 8, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      return click(s, d, t, { gain: 0.45, highpass: 1900 * p.filterMul, lenS: 0.005, body: 420 * semitones(p.pitchSt) });
    },
  },
  spin_down: {
    id: "spin_down", bus: "sfx", priority: 8, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const k = semitones(p.pitchSt);
      toneBurst(s, d, t, { wave: "sawtooth", freq: 540 * k, freqEnd: 38, glideS: 1.1, gain: 0.22, attackS: 0.01, decayS: 1.1, filter: { type: "lowpass", freq: 2200 * p.filterMul, freqEnd: 180, q: 1.6 } });
      return toneBurst(s, d, t, { wave: "square", freq: 270 * k, freqEnd: 30, glideS: 1.0, gain: 0.06, attackS: 0.01, decayS: 1.0, filter: { type: "lowpass", freq: 900, q: 0.8 } });
    },
  },
  heat_ping: {
    id: "heat_ping", bus: "sfx", priority: 4, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      return toneBurst(s, d, t, { wave: "sine", freq: 2200, gain: 0.08, attackS: 0.004, decayS: 0.08 });
    },
  },
  t0_clack: {
    // 2: the click that is t₀. 40 ms, −12 dB, confirmation and nothing else.
    id: "t0_clack", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.95, 1.05],
    render(s, d, t, p) {
      const g = dbToGain(-12);
      click(s, d, t, { gain: g * 1.6, highpass: 1800 * p.filterMul, lenS: 0.006, body: 420 * semitones(p.pitchSt) });
      return click(s, d, t + 0.022, { gain: g * 1.1, highpass: 1400, lenS: 0.008, body: 300 * semitones(p.pitchSt) });
    },
  },
  boot_chirp: {
    // 7 A: one joint self-testing: a relay click and a 400 → 1400 Hz chirp, 120 ms. Six of them, base → gripper.
    id: "boot_chirp", bus: "sfx", priority: 6, pitchRangeSt: [-0.5, 0.5], filterRange: [0.95, 1.05],
    render(s, d, t, p) {
      const k = semitones(p.pitchSt + 2 * p.intensity);          // intensity = joint index / 5: the ticks rise base → gripper
      click(s, d, t, { gain: 0.4, highpass: 1900 * p.filterMul, lenS: 0.005, body: 420 * k });
      return toneBurst(s, d, t + 0.01, { wave: "triangle", freq: 400 * k, freqEnd: 1400 * k, glideS: 0.1, gain: dbToGain(-14) * 1.6, attackS: 0.004, decayS: 0.11, filter: { type: "bandpass", freq: 900 * p.filterMul, freqEnd: 2200, q: 1.1 } });
    },
  },
  count_kick: {
    // 7 A: a muted count-in kick, three at eighth notes in the last 0.87 s of the ritual.
    id: "count_kick", bus: "sfx", priority: 6, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t, p) {
      const g = 0.5 + 0.3 * p.intensity;
      click(s, d, t, { gain: g * 0.12, highpass: 2500, lenS: 0.002 });
      return toneBurst(s, d, t, { wave: "sine", freq: 120, freqEnd: 42, glideS: 0.07, gain: g, attackS: 0.001, decayS: 0.16, filter: { type: "lowpass", freq: 320, q: 0.9 } });
    },
  },
  dock_clunk: {
    // 6: dock = 140 Hz magnet clunk + a rising C5 → G5 two-note.
    id: "dock_clunk", bus: "sfx", priority: 6, pitchRangeSt: [-0.3, 0.3], filterRange: [0.95, 1.05],
    render(s, d, t, p) {
      const k = semitones(p.pitchSt);
      noiseBurst(s, d, t, { color: "brown", filter: "lowpass", freq: 300 * p.filterMul, q: 1, gain: 0.9, attackS: 0.002, decayS: 0.09 });
      toneBurst(s, d, t, { wave: "sine", freq: 140 * k, freqEnd: 90 * k, glideS: 0.1, gain: 0.7, attackS: 0.002, decayS: 0.14 });
      pluck(s, d, t + 0.09, 523.25 * k, 0.45, 0.16);            // C5
      return pluck(s, d, t + 0.09 + 0.13, 783.99 * k, 0.5, 0.3);   // G5
    },
  },
  late_guard_ticks: {
    // 6: a late guard is two upward ticks (C6, E6) at +80 ms after the thock.
    id: "late_guard_ticks", bus: "sfx", priority: 4, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      const g = dbToGain(-12) * 1.4;
      toneBurst(s, d, t, { wave: "sine", freq: 1046.5, gain: g, attackS: 0.002, decayS: 0.05 });
      return toneBurst(s, d, t + 0.07, { wave: "sine", freq: 1318.51, gain: g, attackS: 0.002, decayS: 0.08 });
    },
  },
  gripper_roll: {
    // 3.4 stage 1: the rollover tick as the jaws start to close.
    id: "gripper_roll", bus: "sfx", priority: 4, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      return click(s, d, t, { gain: 0.3, highpass: 2600 * p.filterMul, lenS: 0.004, body: 1100 * semitones(p.pitchSt) });
    },
  },
  gripper_lock: {
    // 3.4 stage 2: the lock click.
    id: "gripper_lock", bus: "sfx", priority: 4, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      click(s, d, t, { gain: 0.42, highpass: 2000 * p.filterMul, lenS: 0.005, body: 520 * semitones(p.pitchSt) });
      return click(s, d, t + 0.02, { gain: 0.3, highpass: 1500, lenS: 0.006, body: 330 * semitones(p.pitchSt) });
    },
  },
  gripper_contact: {
    // 3.4 stage 3: the contact thump when the jaws meet the object.
    id: "gripper_contact", bus: "sfx", priority: 4, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      noiseBurst(s, d, t, { color: "pink", filter: "lowpass", freq: 500 * p.filterMul, q: 1, gain: 0.5, attackS: 0.002, decayS: 0.05 });
      return subThump(s, d, t, 110 * semitones(p.pitchSt), 0.45, 0.07);
    },
  },
  stop_click: {
    // 7: a servo brakes, it does not fade. One tick when a joint comes to rest after moving.
    id: "stop_click", bus: "sfx", priority: 4, pitchRangeSt: [-1.5, 1.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      return click(s, d, t, { gain: dbToGain(-18) * (1.5 + p.intensity), highpass: 2200 * p.filterMul, lenS: 0.004, body: 700 * semitones(p.pitchSt) });
    },
  },
  cough: {
    // 7 F: held breath is not silence: one cough click in the crowd every 3–5 s.
    id: "cough", bus: "sfx", priority: 2, pitchRangeSt: [-2, 2], filterRange: [0.8, 1.2],
    render(s, d, t, p) {
      const g = dbToGain(-24) * 2.2;
      noiseBurst(s, d, t, { color: "pink", filter: "bandpass", freq: 700 * p.filterMul, q: 1.4, gain: g, attackS: 0.006, decayS: 0.07 });
      return noiseBurst(s, d, t + 0.09, { color: "pink", filter: "bandpass", freq: 620 * p.filterMul * semitones(p.pitchSt), q: 1.4, gain: g * 0.7, attackS: 0.005, decayS: 0.09 });
    },
  },
  whistle: {
    // 7 H: one late whistle in the applause.
    id: "whistle", bus: "sfx", priority: 2, pitchRangeSt: [-1, 1], filterRange: UNITY,
    render(s, d, t, p) {
      const k = semitones(p.pitchSt);
      const g = dbToGain(-16);
      toneBurst(s, d, t, { wave: "sine", freq: 2200 * k, freqEnd: 2900 * k, glideS: 0.12, gain: g, attackS: 0.02, decayS: 0.3 });
      return toneBurst(s, d, t + 0.32, { wave: "sine", freq: 2900 * k, freqEnd: 2000 * k, glideS: 0.25, gain: g * 0.9, attackS: 0.02, decayS: 0.4 });
    },
  },
  stomp: {
    // 6 (last 3 s): the crowd stomps in time with the tick.
    id: "stomp", bus: "sfx", priority: 2, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-14) * (1 + 0.5 * p.intensity);
      noiseBurst(s, d, t, { color: "brown", filter: "lowpass", freq: 160 * p.filterMul, q: 0.8, gain: g * 1.4, attackS: 0.004, decayS: 0.1 });
      return toneBurst(s, d, t, { wave: "sine", freq: 62 * semitones(p.pitchSt), freqEnd: 40, glideS: 0.09, gain: g, attackS: 0.003, decayS: 0.12 });
    },
  },
  ui_hover: {
    id: "ui_hover", bus: "ui", priority: 1, pitchRangeSt: [-0.4, 0.4], filterRange: UNITY,
    render(s, d, t, p) {
      return toneBurst(s, d, t, { wave: "sine", freq: 1200 * semitones(p.pitchSt), gain: dbToGain(-20) * 1.4, attackS: 0.002, decayS: 0.025 });
    },
  },
  ui_select: {
    id: "ui_select", bus: "ui", priority: 1, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      const g = dbToGain(-14) * 1.3;
      toneBurst(s, d, t, { wave: "sine", freq: 660, gain: g, attackS: 0.002, holdS: 0.03, decayS: 0.02 });
      return toneBurst(s, d, t + 0.05, { wave: "sine", freq: 990, gain: g, attackS: 0.002, holdS: 0.03, decayS: 0.06 });
    },
  },
  ui_back: {
    id: "ui_back", bus: "ui", priority: 1, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t) {
      const g = dbToGain(-16) * 1.3;
      toneBurst(s, d, t, { wave: "sine", freq: 990, gain: g, attackS: 0.002, holdS: 0.03, decayS: 0.02 });
      return toneBurst(s, d, t + 0.05, { wave: "sine", freq: 660, gain: g, attackS: 0.002, holdS: 0.03, decayS: 0.06 });
    },
  },
  ui_slam: {
    id: "ui_slam", bus: "ui", priority: 1, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-12) * 2.2;
      click(s, d, t, { gain: g * 0.4, highpass: 3500 * p.filterMul, lenS: 0.003 });
      return toneBurst(s, d, t, { wave: "sine", freq: 120 * semitones(p.pitchSt), freqEnd: 48, glideS: 0.12, gain: g, attackS: 0.002, decayS: 0.16 });
    },
  },
  ui_stamp: {
    id: "ui_stamp", bus: "ui", priority: 1, pitchRangeSt: [-1, 1], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = dbToGain(-10) * 1.5;
      noiseBurst(s, d, t, { color: "pink", filter: "lowpass", freq: 2000 * p.filterMul, q: 1, gain: g, attackS: 0.001, decayS: 0.04 });
      return toneBurst(s, d, t, { wave: "triangle", freq: 240 * semitones(p.pitchSt), freqEnd: 150, gain: g * 0.4, attackS: 0.001, decayS: 0.06 });
    },
  },
  ui_sticker: {
    id: "ui_sticker", bus: "ui", priority: 1, pitchRangeSt: [-1, 1], filterRange: UNITY,
    render(s, d, t, p) {
      const g = dbToGain(-14) * 1.5;
      noiseBurst(s, d, t, { filter: "highpass", freq: 3000, gain: g * 0.5, attackS: 0.001, decayS: 0.01 });
      return toneBurst(s, d, t, { wave: "sine", freq: 880 * semitones(p.pitchSt), freqEnd: 1480, glideS: 0.04, gain: g, attackS: 0.002, decayS: 0.05 });
    },
  },
  ui_countdown: {
    id: "ui_countdown", bus: "ui", priority: 1, pitchRangeSt: NONE, filterRange: UNITY,
    render(s, d, t, p) {
      const g = dbToGain(-12) * 2;
      click(s, d, t, { gain: g * 0.35, highpass: 3000, lenS: 0.003 });
      return toneBurst(s, d, t, { wave: "sine", freq: 196 * semitones(p.pitchSt), freqEnd: 150, gain: g, attackS: 0.002, decayS: 0.14 });
    },
  },
  ui_shutter: {
    id: "ui_shutter", bus: "ui", priority: 1, pitchRangeSt: [-0.5, 0.5], filterRange: [0.9, 1.1],
    render(s, d, t, p) {
      const g = 0.25;
      click(s, d, t, { gain: g, highpass: 2600 * p.filterMul, lenS: 0.006, body: 900 * semitones(p.pitchSt) });
      return click(s, d, t + 0.065, { gain: g * 0.8, highpass: 2000 * p.filterMul, lenS: 0.008, body: 700 * semitones(p.pitchSt) });
    },
  },
};

export const SFX: Readonly<Record<SfxId, SfxRecipe>> = R;
