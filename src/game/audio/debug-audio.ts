// src/game/audio/debug-audio.ts (WP8)
// ?debug=audio: renders every recipe offline through the real bus graph (voice -> sfx or ui bus -> master ->
// compressor -> ceiling) and reports peak, RMS, and NaN counts, so the mix can be checked without playing a sound.
// Acceptance (BUILD_PLAN WP3.12): every recipe peaks at or below -0.5 dBFS after the ceiling and has no NaN samples.
// The renderer takes an OfflineAudioContext factory; the browser default uses the platform's own.

import { createRng } from "../core/rng.ts";
import { renderSquelchIn, renderSquelchOut } from "../announcer/host-voice.ts";
import { buildBusGraph, LIMITER_CEILING_DB } from "./audio-engine.ts";
import { KO_ROAR, renderCrowdShout } from "./crowd.ts";
import { renderImpact, type ImpactOpts } from "./impact.ts";
import { KILL_CONFIRM_TIMING, renderKillConfirm } from "./kill-confirm.ts";
import { playInstrument } from "./music.ts";
import { STINGERS, stingerLengthS, type Instrument, type StingerId } from "./music-score.ts";
import { SFX, SFX_IDS, rollSfxParams } from "./sfx.ts";
import { createNoiseBank, type SynthContext } from "./synth.ts";

export type OfflineFactory = (channels: number, length: number, sampleRate: number) => BaseAudioContext & { startRendering(): Promise<AudioBuffer> };

export interface DebugRecipe {
  id: string;
  bus: "sfx" | "ui" | "music" | "crowd" | "voice";
  lengthS: number;
  render(s: SynthContext, dest: AudioNode, t: number): number;
}

const INSTRUMENTS: readonly [Instrument, number][] = [
  ["kick", 0], ["snare", 0], ["rim", 0], ["hat_closed", 0], ["hat_open", 0], ["hat_brush", 0], ["tom_hi", 0], ["tom_lo", 0],
  ["crash", 0], ["bass", 38], ["clav_stab", 62], ["clav_lead", 74], ["clav_pad", 62],
];

/** Section 7 test targets: jab, solid, heavy, crit, ping (monotonic in peak) and the taken heavy. */
export const IMPACTS: readonly [string, ImpactOpts][] = [
  ["jab", { m: 0.1, raw: 4, crit: false, taken: false }],
  ["solid", { m: 0.3, raw: 12, crit: false, taken: false }],
  ["heavy", { m: 0.7, raw: 22, crit: false, taken: false }],
  ["crit", { m: 0.7, raw: 22, crit: true, taken: false }],
  ["ping", { m: 0.9, raw: 30, crit: true, taken: false }],
  ["taken_heavy", { m: 0.7, raw: 22, crit: false, taken: true }],
];

/** Every sound the game can make, as offline-renderable recipes. */
export function debugRecipes(): DebugRecipe[] {
  const list: DebugRecipe[] = [];
  for (const id of SFX_IDS) {
    const recipe = SFX[id];
    list.push({
      id: `sfx.${id}`, bus: recipe.bus, lengthS: id === "riser" ? 3.4 : id === "power_down" ? 1.2 : id === "spin_down" ? 1.3 : 1.2,
      render: (s, d, t) => recipe.render(s, d, t, rollSfxParams(recipe, s.rng, 1)),
    });
  }
  // The impact object (impact.ts): the five one-shots of section 7's test targets, plus the taken variant.
  for (const [id, o] of IMPACTS) list.push({ id: `impact.${id}`, bus: "sfx", lengthS: 1.0, render: (s, d, t) => renderImpact(s, d, t, o) });
  list.push({ id: "kill_confirm", bus: "sfx", lengthS: KILL_CONFIRM_TIMING.lengthS + 0.2, render: (s, d, t) => renderKillConfirm(s, d, t, 0) });
  for (const kind of ["ohh", "roar", "groan"] as const) {
    list.push({ id: `crowd.${kind}`, bus: "crowd", lengthS: 2, render: (s, d, t) => renderCrowdShout(s, d, t, kind) });
  }
  list.push({ id: "crowd.ko_roar", bus: "crowd", lengthS: 8, render: (s, d, t) => renderCrowdShout(s, d, t, "roar", s.rng, KO_ROAR) });
  for (const [inst, midi] of INSTRUMENTS) {
    list.push({ id: `band.${inst}`, bus: "music", lengthS: 1.2, render: (s, d, t) => playInstrument(s, d, t, inst, midi, 1, 0.4) });
  }
  for (const id of Object.keys(STINGERS) as StingerId[]) {
    list.push({
      id: `stinger.${id}`, bus: "music", lengthS: stingerLengthS(id) + 0.6,
      render: (s, d, t) => {
        let end = t;
        for (const n of STINGERS[id]) end = Math.max(end, playInstrument(s, d, t + n.atS, n.instrument, n.midi, n.velocity, n.durS));
        return end;
      },
    });
  }
  list.push({ id: "voice.squelch_in", bus: "voice", lengthS: 0.4, render: renderSquelchIn });
  list.push({ id: "voice.squelch_out", bus: "voice", lengthS: 0.4, render: renderSquelchOut });
  return list;
}

export interface BufferStats { peak: number; peakDb: number; rms: number; rmsDb: number; nanCount: number }

export function analyzeChannels(channels: readonly Float32Array[]): BufferStats {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let nanCount = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) { nanCount++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
    }
  }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0;
  const toDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
  return { peak, peakDb: toDb(peak), rms, rmsDb: toDb(rms), nanCount };
}

export interface RecipeReport extends BufferStats { id: string; lengthS: number; pass: boolean; buffer: AudioBuffer }

/** Renders one recipe through the bus graph at `sampleRate` with a fixed seed. */
export async function renderDebugRecipe(recipe: DebugRecipe, factory: OfflineFactory, sampleRate = 48000, seed = 1): Promise<RecipeReport> {
  const length = Math.ceil(recipe.lengthS * sampleRate);
  const ctx = factory(2, length, sampleRate);
  const buses = buildBusGraph(ctx, ctx.destination);
  const s: SynthContext = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(seed) };
  const voice = ctx.createGain();
  voice.connect(buses[recipe.bus]);
  recipe.render(s, voice, 0.01);
  const buffer = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const stats = analyzeChannels(channels);
  return { id: recipe.id, lengthS: recipe.lengthS, ...stats, pass: stats.nanCount === 0 && stats.peakDb <= LIMITER_CEILING_DB + 1e-6 && stats.peak > 0, buffer };
}

function defaultFactory(): OfflineFactory | null {
  const g = globalThis as { OfflineAudioContext?: typeof OfflineAudioContext };
  const Ctor = g.OfflineAudioContext;
  return Ctor ? (channels, length, sampleRate) => new Ctor(channels, length, sampleRate) : null;
}

/** Renders every recipe (the ?debug=audio table). Resolves an empty list where offline rendering is unavailable. */
export async function renderAudioReport(factory: OfflineFactory | null = defaultFactory(), onProgress?: (done: number, total: number) => void): Promise<Omit<RecipeReport, "buffer">[]> {
  if (!factory) return [];
  const recipes = debugRecipes();
  const out: Omit<RecipeReport, "buffer">[] = [];
  for (let i = 0; i < recipes.length; i++) {
    const r = await renderDebugRecipe(recipes[i], factory);
    const { buffer: _buffer, ...rest } = r;
    void _buffer;
    out.push(rest);
    onProgress?.(i + 1, recipes.length);
  }
  return out;
}
