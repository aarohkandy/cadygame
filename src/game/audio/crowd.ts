// src/game/audio/crowd.ts (WP8)
// The holographic crowd, synthesized (EMOTION_BIBLE 7, section 9 of the audio research). Three beds follow a
// small crowd model, and reactions are shouted over them:
//   murmur     pink noise through vowel formants with a slow swell; anticipation lifts it a minor third and opens
//              its brightness 800 → 1400 Hz (the last 3 s of a lock)
//   cheer      a brighter vowel bed at energy² × −8 dB whose low-pass opens with energy; −10 dB under held breath
//   applause   a pre-rendered stereo clap texture (Poisson claps) at density 20·energy / s; a bored crowd claps
//              sparsely at 3 / s for two seconds
//   one-shots  "ohh" (rise-fall), roar (broad swell; the KO roar swells from +0.4 s, peaks at +1.2 s, holds 2.5 s
//              and decays over 4 s), groan (falling, dark vowels): detuned saw choirs plus breath through moving
//              formants; the chant is six "ohh" voices in two groups a fifth apart on beats 2 and 4
//   hush       every bed −20 dB for a beat (a steal by the AI: groan, then the room holds still)
//   held breath (near-KO) the cheer −10 dB and one cough click every 3–5 s: not silence
// Beds are built once; reactions, coughs and chant voices are one-shots through the crowd bus.

import type { Rng } from "../core/rng.ts";
import { createRng } from "../core/rng.ts";
import type { CrowdReaction } from "../feedback/hype.ts";
import { SFX, rollSfxParams } from "./sfx.ts";
import { dbToGain, noiseBurst, type SynthContext } from "./synth.ts";

export const MURMUR_DB = -22;
export const CHEER_DB = -8;
export const APPLAUSE_DB = -18;
export const REACTION_DB: Readonly<Record<CrowdReaction, number>> = { ohh: -10, roar: -4, groan: -12 };
export const APPLAUSE_SECONDS = 4;
export const HELD_BREATH_DB = -10;
export const HUSH_DB = -20;
export const HUSH_S = 0.5;
export const BORED_CLAPS_PER_S = 3;
export const BORED_CLAP_S = 2;
export const COUGH_GAP_S: readonly [number, number] = [3, 5];
/** A minor third: the murmur's pitch under anticipation. */
export const ANTICIPATION_RATE = Math.pow(2, 3 / 12);
export const CHANT_VOICES = 6;
const SHOUT_MAKEUP = 12;
const APPLAUSE_REF_DENSITY = 20;

/** The crowd model (7): what the room feels, independent of the one number hype gives it. */
export interface CrowdModel {
  mood: number;          // −1 (against you) .. 1 (with you): shifts the murmur's vowel and the cheer's brightness
  energy: number;        // 0..1: replaces hype for the bed levels when given
  anticipation: number;  // 0..1: the last 3 s of a lock, a held tell
  heldBreath: boolean;   // near-KO
  bored: boolean;        // no event for a while at low energy
}

export interface CrowdLevels { murmur: number; cheer: number; applause: number; brightnessHz: number; murmurRate: number; murmurHz: number }

/** Bed levels for a hype value (linear gains). `show` is false in menus and the Lab. */
export function crowdBedLevels(h: number, show: boolean, out: CrowdLevels, model: CrowdModel | null = null): CrowdLevels {
  const hype = Math.max(0, Math.min(1, Number.isFinite(h) ? h : 0));
  const energy = model ? Math.max(0, Math.min(1, model.energy)) : hype;
  const ant = model ? Math.max(0, Math.min(1, model.anticipation)) : 0;
  out.murmur = show ? dbToGain(MURMUR_DB) * (1 + 0.5 * ant) : 0;
  out.cheer = show ? energy * energy * dbToGain(CHEER_DB) * (model?.heldBreath ? dbToGain(HELD_BREATH_DB) : 1) : 0;
  const density = 20 * energy;
  out.applause = show && !model?.heldBreath ? dbToGain(APPLAUSE_DB) * Math.sqrt(density / APPLAUSE_REF_DENSITY) : 0;
  out.brightnessHz = 1400 + 4600 * energy + (model ? 600 * model.mood : 0);
  out.murmurRate = 0.9 * (1 + (ANTICIPATION_RATE - 1) * ant);
  out.murmurHz = 800 + 600 * ant;
  return out;
}

/** Stereo clap texture: Poisson claps at 45/s, each a damped resonant noise burst with its own pan and pitch. */
export function fillApplause(left: Float32Array, right: Float32Array, sampleRate: number, seed: number): void {
  const rng = createRng(seed);
  const n = left.length;
  let t = 0;
  while (true) {
    t += -Math.log(1 - rng.next()) / 45;
    const start = Math.floor(t * sampleRate);
    if (start >= n) break;
    const len = Math.floor((0.006 + rng.next() * 0.01) * sampleRate);
    const pan = rng.range(-0.85, 0.85);
    const lg = Math.cos(((pan + 1) * Math.PI) / 4);
    const rg = Math.sin(((pan + 1) * Math.PI) / 4);
    const amp = 0.25 + rng.next() * 0.45;
    const f = (900 + rng.next() * 1600) / sampleRate;
    // Two-pole resonator on white noise gives each clap a hand-sized pitch.
    const r = 0.94;
    const c1 = 2 * r * Math.cos(2 * Math.PI * f);
    const c2 = -r * r;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.exp(-i / (len * 0.28));
      const x = (rng.next() * 2 - 1) * env;
      const y = x + c1 * y1 + c2 * y2;
      y2 = y1; y1 = y;
      const v = y * amp * 0.18;
      left[start + i] += v * lg;
      right[start + i] += v * rg;
    }
  }
  // Normalise to a 0.5 peak so the bed level constants mean what they say.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const norm = peak > 0 ? 0.5 / peak : 1;
  const fade = Math.min(512, Math.floor(n / 8));
  for (let i = 0; i < n; i++) {
    const k = i < fade ? i / fade : i >= n - fade ? (n - 1 - i) / fade : 1;
    left[i] *= norm * k;
    right[i] *= norm * k;
  }
}

const VOWELS = {
  ah: [800, 1150, 2900],
  oh: [450, 800, 2830],
  oo: [325, 700, 2530],
  eh: [530, 1840, 2480],
} as const;

/** Envelope override for a shout: the KO roar (7 G) swells from +0.4 s, peaks +1.0–1.4 s, holds 2.5 s, decays 4 s. */
export interface ShoutShape { attackS: number; holdS: number; decayS: number; voices?: number; pitchMul?: number; db?: number }
export const KO_ROAR: Readonly<ShoutShape> = { attackS: 0.8, holdS: 2.5, decayS: 4, voices: 9, db: -3 };

/** A crowd shout: 7 detuned saw voices plus breath noise through three moving formants. Returns the end time. */
export function renderCrowdShout(s: SynthContext, dest: AudioNode, t: number, kind: CrowdReaction, rng: Rng = s.rng, shape?: ShoutShape): number {
  const { ctx } = s;
  const base = kind === "roar"
    ? { dur: 1.7, attack: 0.18, from: VOWELS.eh, to: VOWELS.ah, pitchFrom: 1.0, pitchPeak: 1.35, pitchTo: 1.1, bright: 5200, db: REACTION_DB.roar }
    : kind === "ohh"
      ? { dur: 1.15, attack: 0.12, from: VOWELS.oo, to: VOWELS.oh, pitchFrom: 0.95, pitchPeak: 1.3, pitchTo: 0.85, bright: 3000, db: REACTION_DB.ohh }
      : { dur: 1.3, attack: 0.1, from: VOWELS.oh, to: VOWELS.oo, pitchFrom: 1.15, pitchPeak: 1.05, pitchTo: 0.7, bright: 1900, db: REACTION_DB.groan };
  const attack = shape ? shape.attackS : base.attack;
  const dur = shape ? shape.attackS + shape.holdS + shape.decayS : base.dur;
  const db = shape?.db ?? base.db;
  const end = t + dur;
  const out = ctx.createGain();
  // Makeup: formant band-passes throw away most of the voices' energy; this lands the shout's peak at its dB target.
  const level = dbToGain(db) * SHOUT_MAKEUP;
  out.gain.setValueAtTime(1e-4, t);
  out.gain.exponentialRampToValueAtTime(level, t + attack);
  if (shape) {
    out.gain.setValueAtTime(level, t + attack + shape.holdS);
    out.gain.exponentialRampToValueAtTime(1e-4, end);
  } else {
    out.gain.setTargetAtTime(level * 0.7, t + attack, dur * 0.35);
    out.gain.exponentialRampToValueAtTime(1e-4, end);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(base.bright * 0.6, t);
  lp.frequency.exponentialRampToValueAtTime(base.bright, t + attack * 2);
  lp.frequency.exponentialRampToValueAtTime(base.bright * 0.5, end);
  lp.connect(out);
  out.connect(dest);

  const formants: BiquadFilterNode[] = [];
  const formantGains = [1, 0.55, 0.22];
  for (let i = 0; i < 3; i++) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = i === 0 ? 4 : 6;
    f.frequency.setValueAtTime(base.from[i], t);
    f.frequency.linearRampToValueAtTime(base.to[i], t + dur * 0.45);
    const g = ctx.createGain();
    g.gain.value = formantGains[i];
    f.connect(g);
    g.connect(lp);
    formants.push(f);
  }

  const voices = shape?.voices ?? 7;
  const pitchMul = shape?.pitchMul ?? 1;
  for (let v = 0; v < voices; v++) {
    const hz = rng.range(120, 260) * pitchMul;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const delay = rng.range(0, Math.min(0.09, attack * 0.5));
    osc.frequency.setValueAtTime(hz * base.pitchFrom, t + delay);
    osc.frequency.linearRampToValueAtTime(hz * base.pitchPeak, t + delay + Math.max(attack, dur * 0.3));
    osc.frequency.linearRampToValueAtTime(hz * base.pitchTo, end);
    osc.detune.value = rng.range(-35, 35);
    const vg = ctx.createGain();
    vg.gain.value = 0.05 * (7 / voices);
    osc.connect(vg);
    for (const f of formants) vg.connect(f);
    osc.start(t + delay);
    osc.stop(end + 0.02);
  }
  // Breath and hiss: the room is many mouths, not a choir.
  for (const f of formants) {
    noiseBurst(s, f, t, { color: "pink", filter: "highpass", freq: 180, gain: 0.5, attackS: attack, decayS: dur - attack });
  }
  return end;
}

export interface Crowd {
  readonly nodeCount: number;
  update(now: number, hype: number, show: boolean, model?: CrowdModel | null): void;
  react(kind: CrowdReaction, when: number, shape?: ShoutShape): number;
  /** Six "ohh" voices in two groups a fifth apart (7 D), on one beat. */
  chantBeat(when: number): number;
  /** Every bed −20 dB for `seconds` (a steal by the AI: groan then hush). */
  hush(when: number, seconds?: number): void;
  /** One late whistle in the applause (7 H). */
  whistle(when: number): number;
  dispose(): void;
}

export interface PreparedApplause { sampleRate: number; left: Float32Array; right: Float32Array }

export function prepareApplause(seed = 0xc1a9, sampleRate = 48000): PreparedApplause {
  const len = Math.max(1, Math.floor(sampleRate * APPLAUSE_SECONDS));
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  fillApplause(left, right, sampleRate, seed);
  return { sampleRate, left, right };
}

export function createCrowd(s: SynthContext, dest: AudioNode, applause: PreparedApplause = prepareApplause(0xc1a9, s.ctx.sampleRate)): Crowd {
  const { ctx } = s;
  let nodes = 0;
  const n = <T extends AudioNode>(node: T): T => { nodes++; return node; };
  const sources: AudioScheduledSourceNode[] = [];
  const bus = n(ctx.createGain());
  const hushGain = n(ctx.createGain());
  hushGain.gain.value = 1;
  bus.connect(hushGain);
  hushGain.connect(dest);

  // Murmur.
  const murmurSrc = n(ctx.createBufferSource());
  murmurSrc.buffer = s.noise.pink; murmurSrc.loop = true; murmurSrc.playbackRate.value = 0.9;
  sources.push(murmurSrc);
  const murmurBand = n(ctx.createBiquadFilter());
  murmurBand.type = "bandpass"; murmurBand.frequency.value = 520; murmurBand.Q.value = 0.8;
  const murmurFormant = n(ctx.createBiquadFilter());
  murmurFormant.type = "peaking"; murmurFormant.frequency.value = 1150; murmurFormant.Q.value = 2; murmurFormant.gain.value = 6;
  const murmurSwell = n(ctx.createGain());
  murmurSwell.gain.value = 0.8;
  const swellLfo = n(ctx.createOscillator());
  swellLfo.frequency.value = 0.13;
  sources.push(swellLfo);
  const swellDepth = n(ctx.createGain());
  swellDepth.gain.value = 0.2;
  swellLfo.connect(swellDepth); swellDepth.connect(murmurSwell.gain);
  const murmurGain = n(ctx.createGain());
  murmurGain.gain.value = 0;
  murmurSrc.connect(murmurBand); murmurBand.connect(murmurFormant); murmurFormant.connect(murmurSwell); murmurSwell.connect(murmurGain); murmurGain.connect(bus);

  // Cheer.
  const cheerSrc = n(ctx.createBufferSource());
  cheerSrc.buffer = s.noise.white; cheerSrc.loop = true;
  sources.push(cheerSrc);
  const cheerLp = n(ctx.createBiquadFilter());
  cheerLp.type = "lowpass"; cheerLp.frequency.value = 1400; cheerLp.Q.value = 0.6;
  const cheerGain = n(ctx.createGain());
  cheerGain.gain.value = 0;
  for (const [hz, q, g] of [[800, 3, 1], [1150, 4, 0.6], [2900, 5, 0.25]] as const) {
    const f = n(ctx.createBiquadFilter());
    f.type = "bandpass"; f.frequency.value = hz; f.Q.value = q;
    const fg = n(ctx.createGain());
    fg.gain.value = g;
    cheerSrc.connect(f); f.connect(fg); fg.connect(cheerLp);
  }
  cheerLp.connect(cheerGain); cheerGain.connect(bus);

  // Applause.
  const clapBuf = ctx.createBuffer(2, applause.left.length, applause.sampleRate);
  clapBuf.getChannelData(0).set(applause.left);
  clapBuf.getChannelData(1).set(applause.right);
  const clapSrc = n(ctx.createBufferSource());
  clapSrc.buffer = clapBuf; clapSrc.loop = true;
  sources.push(clapSrc);
  const clapGain = n(ctx.createGain());
  clapGain.gain.value = 0;
  clapSrc.connect(clapGain); clapGain.connect(bus);

  const t0 = ctx.currentTime;
  for (const src of sources) src.start(t0);
  const levels: CrowdLevels = { murmur: 0, cheer: 0, applause: 0, brightnessHz: 1400, murmurRate: 0.9, murmurHz: 800 };
  const last = { murmur: -1, cheer: -1, applause: -1, rate: -1, hz: -1 };
  let nextCough = Number.NaN;
  let boredUntil = -Infinity;
  let boredNext = -Infinity;

  return {
    get nodeCount() { return nodes; },
    update(now, hype, show, model = null) {
      crowdBedLevels(hype, show, levels, model);
      // Bored clap (7): sparse claps at 3/s for two seconds, then quiet again for a while.
      if (model?.bored && show) {
        if (now >= boredNext) { boredUntil = now + BORED_CLAP_S; boredNext = now + 10 + s.rng.range(0, 4); }
        if (now < boredUntil) levels.applause = Math.max(levels.applause, dbToGain(APPLAUSE_DB) * Math.sqrt(BORED_CLAPS_PER_S / APPLAUSE_REF_DENSITY));
      }
      // Held breath: one cough every 3–5 s, so the room is quiet, not gone.
      if (model?.heldBreath && show) {
        if (!Number.isFinite(nextCough)) nextCough = now + s.rng.range(COUGH_GAP_S[0], COUGH_GAP_S[1]);
        if (now >= nextCough) {
          const r = SFX.cough;
          r.render(s, bus, now, rollSfxParams(r, s.rng, 0.5));
          nextCough = now + s.rng.range(COUGH_GAP_S[0], COUGH_GAP_S[1]);
        }
      } else nextCough = Number.NaN;
      if (Math.abs(levels.murmurRate - last.rate) > 1e-3) { murmurSrc.playbackRate.setTargetAtTime(levels.murmurRate, now, 0.3); last.rate = levels.murmurRate; }
      if (Math.abs(levels.murmurHz - last.hz) > 1) { murmurBand.frequency.setTargetAtTime(levels.murmurHz * 0.65, now, 0.3); murmurFormant.frequency.setTargetAtTime(levels.murmurHz * 1.4, now, 0.3); last.hz = levels.murmurHz; }
      if (Math.abs(levels.murmur - last.murmur) < 1e-4 && Math.abs(levels.cheer - last.cheer) < 1e-4 && Math.abs(levels.applause - last.applause) < 1e-4) return;
      last.murmur = levels.murmur; last.cheer = levels.cheer; last.applause = levels.applause;
      murmurGain.gain.setTargetAtTime(levels.murmur, now, 0.4);
      cheerGain.gain.setTargetAtTime(levels.cheer, now, 0.25);
      clapGain.gain.setTargetAtTime(levels.applause, now, 0.3);
      cheerLp.frequency.setTargetAtTime(levels.brightnessHz, now, 0.3);
    },
    react(kind, when, shape) {
      return renderCrowdShout(s, bus, when, kind, s.rng, shape);
    },
    chantBeat(when) {
      // Two groups of three, a fifth apart, short "ohh"s on the beat.
      const lo: ShoutShape = { attackS: 0.06, holdS: 0.1, decayS: 0.22, voices: 3, pitchMul: 1, db: REACTION_DB.ohh - 2 };
      const hi: ShoutShape = { ...lo, pitchMul: 1.5, db: REACTION_DB.ohh - 4 };
      renderCrowdShout(s, bus, when, "ohh", s.rng, lo);
      return renderCrowdShout(s, bus, when + 0.012, "ohh", s.rng, hi);
    },
    hush(when, seconds = HUSH_S) {
      const g = hushGain.gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(1, when);
      g.linearRampToValueAtTime(dbToGain(HUSH_DB), when + 0.06);
      g.setValueAtTime(dbToGain(HUSH_DB), when + seconds);
      g.linearRampToValueAtTime(1, when + seconds + 0.4);
    },
    whistle(when) {
      const r = SFX.whistle;
      return r.render(s, bus, when, rollSfxParams(r, s.rng, 1));
    },
    dispose() {
      const t = ctx.currentTime;
      for (const src of sources) { try { src.stop(t + 0.05); } catch { /* stopped */ } }
      bus.disconnect();
      hushGain.disconnect();
    },
  };
}
