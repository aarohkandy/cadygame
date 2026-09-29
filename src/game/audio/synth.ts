// src/game/audio/synth.ts (WP3)
// Synthesis primitives for every sound in the game (SCOPE 3: no audio files). Each primitive schedules a short-lived
// node chain on AudioContext time and returns the time its tail ends, so one-shots, the kill confirm, crowd shouts,
// and the band's instruments are all built from the same small vocabulary:
//   noiseBurst  filtered noise with an attack/decay envelope and an optional filter sweep (transients, bodies, air)
//   toneBurst   an oscillator with pitch glide and envelope (sub thumps, blips, bass, clav)
//   fmBell      two-operator FM with an inharmonic second partial (the bell, pings, tinks)
//   click       a 2-4 ms high-passed noise tick with a tiny sine body (relays, latches, servo ratchets)
// Noise comes from a seeded NoiseBank synthesized once at boot; start offsets are randomized per hit so no two
// transients are sample-identical. All randomness flows through an Rng, so offline renders are reproducible.

import { createRng, type Rng } from "../core/rng.ts";

export type NoiseColor = "white" | "pink" | "brown";

export interface NoiseBank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly lengthS: number;
}

export interface SynthContext {
  readonly ctx: BaseAudioContext;
  readonly noise: NoiseBank;
  readonly rng: Rng;
}

export const NOISE_SECONDS = 2;
const MIN_GAIN = 1e-4;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

export function semitones(st: number): number {
  return Math.pow(2, st / 12);
}

/** Fills three noise colours from a seeded generator (white, Paul Kellet pink, leaky-integrated brown). */
export function fillNoise(white: Float32Array, pink: Float32Array, brown: Float32Array, seed: number): void {
  const rng = createRng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let br = 0;
  for (let i = 0; i < white.length; i++) {
    const w = rng.next() * 2 - 1;
    white[i] = w * 0.9;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    br = (br + 0.02 * w) / 1.02;
    brown[i] = br * 3.5;
  }
  // Short fades at the loop seam so looped beds never click.
  const fade = Math.min(256, Math.floor(white.length / 8));
  for (const buf of [white, pink, brown]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      buf[i] *= k;
      buf[buf.length - 1 - i] *= k;
    }
  }
}

/** Noise synthesized ahead of the AudioContext (boot does the maths; the first gesture only copies it). */
export interface PreparedNoise { sampleRate: number; white: Float32Array; pink: Float32Array; brown: Float32Array }

export const PREPARE_SAMPLE_RATE = 48000;

export function prepareNoise(seed = 0x5eed, sampleRate = PREPARE_SAMPLE_RATE): PreparedNoise {
  const len = Math.max(1, Math.floor(sampleRate * NOISE_SECONDS));
  const white = new Float32Array(len);
  const pink = new Float32Array(len);
  const brown = new Float32Array(len);
  fillNoise(white, pink, brown, seed);
  return { sampleRate, white, pink, brown };
}

export function createNoiseBank(ctx: BaseAudioContext, source: number | PreparedNoise = 0x5eed): NoiseBank {
  const prepared = typeof source === "number" ? prepareNoise(source, ctx.sampleRate) : source;
  const make = (data: Float32Array) => {
    const buf = ctx.createBuffer(1, data.length, prepared.sampleRate);
    buf.getChannelData(0).set(data);
    return buf;
  };
  return { white: make(prepared.white), pink: make(prepared.pink), brown: make(prepared.brown), lengthS: prepared.white.length / prepared.sampleRate };
}

/** Exponential attack then exponential decay to silence. Returns the end time. */
export function adEnvelope(param: AudioParam, t: number, peak: number, attackS: number, decayS: number): number {
  const p = Math.max(MIN_GAIN, peak);
  const a = Math.max(0.0005, attackS);
  const d = Math.max(0.002, decayS);
  param.setValueAtTime(MIN_GAIN, t);
  param.exponentialRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(MIN_GAIN, t + a + d);
  return t + a + d;
}

/** Attack, hold, then exponential release. Returns the end time. */
export function ahrEnvelope(param: AudioParam, t: number, peak: number, attackS: number, holdS: number, releaseS: number): number {
  const p = Math.max(MIN_GAIN, peak);
  const a = Math.max(0.0005, attackS);
  param.setValueAtTime(MIN_GAIN, t);
  param.exponentialRampToValueAtTime(p, t + a);
  param.setValueAtTime(p, t + a + Math.max(0, holdS));
  param.exponentialRampToValueAtTime(MIN_GAIN, t + a + Math.max(0, holdS) + Math.max(0.002, releaseS));
  return t + a + Math.max(0, holdS) + Math.max(0.002, releaseS);
}

export interface NoiseBurstOpts {
  color?: NoiseColor;
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;          // exponential sweep target over the decay
  q?: number;
  gain: number;              // linear peak
  attackS: number;
  decayS: number;
  rate?: number;             // buffer playback rate (brightens or darkens the grain)
  /**
   * Air ceiling: a lowpass after the main filter. A highpassed noise burst is otherwise flat to Nyquist, which reads
   * as digital hiss rather than as a machined surface being struck, and wastes headroom on content above hearing.
   */
  topHz?: number;
}

export function noiseBurst(s: SynthContext, dest: AudioNode, t: number, o: NoiseBurstOpts): number {
  const { ctx, noise, rng } = s;
  const src = ctx.createBufferSource();
  src.buffer = noise[o.color ?? "white"];
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(clampHz(ctx, o.freq), t);
  if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(clampHz(ctx, o.freqEnd), t + o.attackS + o.decayS);
  f.Q.value = o.q ?? 0.707;
  const g = ctx.createGain();
  const end = adEnvelope(g.gain, t, o.gain, o.attackS, o.decayS);
  src.connect(f);
  let tail: AudioNode = f;
  if (o.topHz !== undefined) {
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = clampHz(ctx, o.topHz);
    top.Q.value = 0.707;
    f.connect(top);
    tail = top;
  }
  tail.connect(g);
  g.connect(dest);
  src.start(t, rng.range(0, noise.lengthS * 0.9));
  src.stop(end + 0.01);
  return end;
}

export interface ToneBurstOpts {
  wave: OscillatorType;
  freq: number;
  freqEnd?: number;
  glideS?: number;
  gain: number;
  attackS: number;
  decayS: number;
  holdS?: number;
  detuneCents?: number;
  filter?: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number };
}

export function toneBurst(s: SynthContext, dest: AudioNode, t: number, o: ToneBurstOpts): number {
  const { ctx } = s;
  const osc = ctx.createOscillator();
  osc.type = o.wave;
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glideS ?? o.decayS));
  if (o.detuneCents) osc.detune.value = o.detuneCents;
  const g = ctx.createGain();
  const end = o.holdS !== undefined
    ? ahrEnvelope(g.gain, t, o.gain, o.attackS, o.holdS, o.decayS)
    : adEnvelope(g.gain, t, o.gain, o.attackS, o.decayS);
  let head: AudioNode = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(clampHz(ctx, o.filter.freq), t);
    if (o.filter.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(clampHz(ctx, o.filter.freqEnd), end);
    f.Q.value = o.filter.q ?? 0.707;
    osc.connect(f);
    head = f;
  }
  head.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(end + 0.01);
  return end;
}

export interface BellOpts { freq: number; gain: number; decayS: number; ratio?: number; index?: number; partial?: number }

/** Two-operator FM bell with a quieter inharmonic partial: bright strike, long shimmering tail. */
export function fmBell(s: SynthContext, dest: AudioNode, t: number, o: BellOpts): number {
  const { ctx } = s;
  const ratio = o.ratio ?? 3.5;
  const index = o.index ?? 2.2;
  const out = ctx.createGain();
  const end = adEnvelope(out.gain, t, o.gain, 0.001, o.decayS);
  out.connect(dest);
  const partials: [number, number][] = [[1, 1], [o.partial ?? 2.76, 0.32]];
  for (const [mul, level] of partials) {
    const car = ctx.createOscillator();
    car.type = "sine";
    car.frequency.value = o.freq * mul;
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = o.freq * mul * ratio;
    const modGain = ctx.createGain();
    // Modulation index decays faster than the amplitude: the strike is metallic, the tail is pure.
    modGain.gain.setValueAtTime(o.freq * mul * index, t);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, o.freq * mul * index * 0.02), t + o.decayS * 0.5);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    const lvl = ctx.createGain();
    lvl.gain.value = level;
    car.connect(lvl);
    lvl.connect(out);
    car.start(t); mod.start(t);
    car.stop(end + 0.01); mod.stop(end + 0.01);
  }
  return end;
}

export interface ClickOpts { gain: number; highpass?: number; lenS?: number; body?: number; topHz?: number }

export const CLICK_TOP_HZ = 9000;

/**
 * A relay or ratchet tick: a few milliseconds of band-limited noise plus an optional tiny sine body. The default
 * 9 kHz ceiling is what separates a machined click from a hiss — plastic and aluminium roll off, white noise does not.
 */
export function click(s: SynthContext, dest: AudioNode, t: number, o: ClickOpts): number {
  let end = noiseBurst(s, dest, t, { filter: "highpass", freq: o.highpass ?? 2400, q: 0.7, topHz: o.topHz ?? CLICK_TOP_HZ, gain: o.gain, attackS: 0.0005, decayS: o.lenS ?? 0.004 });
  if (o.body) {
    end = Math.max(end, toneBurst(s, dest, t, { wave: "sine", freq: o.body, freqEnd: o.body * 0.7, gain: o.gain * 0.45, attackS: 0.0008, decayS: 0.02 }));
  }
  return end;
}

/** Soft-knee ceiling curve for a WaveShaper limiter: linear up to the knee, then a tanh approach to the ceiling. */
export function softClipCurve(ceilingDb = -0.5, knee = 0.8, samples = 4097): Float32Array {
  const ceiling = dbToGain(ceilingDb);
  const k = Math.min(knee, ceiling * 0.95);
  const span = ceiling - k;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= k ? a : k + span * Math.tanh((a - k) / span);
    curve[i] = Math.sign(x) * Math.min(y, ceiling * 0.999);
  }
  return curve;
}

function clampHz(ctx: BaseAudioContext, hz: number): number {
  const nyq = ctx.sampleRate / 2;
  return Math.max(10, Math.min(nyq * 0.98, Number.isFinite(hz) ? hz : 1000));
}

/** Uniform jitter in [base * (1 - spread), base * (1 + spread)]. */
export function jitter(rng: Rng, base: number, spread: number): number {
  return base * (1 + rng.range(-spread, spread));
}
