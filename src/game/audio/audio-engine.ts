// src/game/audio/audio-engine.ts (WP8)
// The mix (EMOTION_BIBLE 7, synthesized per SCOPE 3):
//
//   one-shot voices ─► sfxBus (1.0) ─► sfxDuck ─┐
//   servo life beds ─► bedsBus (1.0) ─► bedsDuck ┤   (priority 2: ducked under every voice at p ≥ 8)
//   payoff cues ─────► leadBus (1.0) ────────────┤   (post-duck: the KO duck makes room FOR these, not under them)
//   UI cues ─────────► uiBus (0.63 ≈ -4 dB) ─────┤
//   squelch layer ───► voiceBus (0.9) ─► HP 300 ─► LP 3400 ─► soft drive ─┤
//   music ───────────► musicBus (0.32) ─► musicTone (LP) ─► musicDuck ────┤
//   crowd ───────────► crowdBus (0.30) ─► crowdDuck ──────────────────────┤
//                                                                 master (0.8) ─► compressor ─► ceiling ─► out
//
// The compressor (threshold -10, knee 6, ratio 12, 2 ms / 150 ms) glues the mix; a WaveShaper ceiling after it
// guarantees the output never exceeds -0.5 dBFS. Priorities decide the mix (7): kill confirm and lock 10; ping and
// steal 9; heavy hit, crit tink, host start 8; solid hit, block, deflect 6; jab, servo shock, lock tick 4; servo
// life, crowd bed, music 2; UI 1. A voice at p ≥ 8 ducks the priority-2 buses by −(p − 4) dB with 20 ms attack /
// 200 ms release for its length and drops voices ≤ p − 6 due within 80 ms. Named hold ducks (KO, lock, heavy hit,
// near-KO, steal, wind-up, last 3 s, host speech, match end) combine by taking the deepest cut per bus, and no
// combination takes music past −14 dB. One-shots go through a 24-voice pool that steals the oldest of the lowest
// priority. Zero audio before t₀ (2): the AudioContext is created on the first user gesture; the first successful
// resume is t₀ and plays the 40 ms relay clack at −12 dB. Without WebAudio the engine stays inert.

import type { Settings } from "../contracts.ts";
import { createRng } from "../core/rng.ts";
import { createBeds, type Beds } from "./beds.ts";
import { createCrowd, prepareApplause, type Crowd, type PreparedApplause } from "./crowd.ts";
import { createMusic, type MusicControl } from "./music.ts";
import { SFX, rollSfxParams, type SfxId, type SfxParams } from "./sfx.ts";
import { createNoiseBank, dbToGain, prepareNoise, softClipCurve, type PreparedNoise, type SynthContext } from "./synth.ts";

export const MAX_VOICES = 24;
/** Bus trims. Set so a round through the mixdown lands at −16 LUFS ± 2 (7); the ceiling handles the peaks. */
export const BUS_GAIN = { sfx: 1.0, beds: 1.0, lead: 1.0, ui: 0.63, voice: 0.9, music: 0.55, crowd: 0.5, master: 1.0 } as const;
export const LIMITER_CEILING_DB = -0.5;
/** 7: priorities 1–10. A voice at or above VOICE_DUCK_FROM ducks the priority-2 buses by −(p − 4) dB. */
export const VOICE_DUCK_FROM = 8;
export const VOICE_DUCK_ATTACK_S = 0.02;
export const VOICE_DUCK_RELEASE_S = 0.2;
/** A voice at p ≥ 8 drops voices ≤ p − 6 that are due within this window. */
export const VOICE_DROP_WINDOW_S = 0.08;
/** No combination of hold ducks takes music past this. */
export const MUSIC_DUCK_FLOOR_DB = -14;
/** t₀ (2): the 40 ms relay clack at −12 dB on the first resume. */
export const T0_CLACK_DB = -12;

export type BusId = "sfx" | "beds" | "lead" | "ui" | "voice" | "music" | "crowd";
export type DuckId = "speech" | "ko" | "lock" | "match_end" | "replay" | "heavy_hit" | "near_ko" | "steal" | "windup" | "last_3s";
export interface DuckAmounts { music?: number; crowd?: number; sfx?: number; beds?: number }   // dB (negative)

/** The named duck shapes (7: `heavy_hit`, `near_ko`, `steal`, `windup`, `last_3s`; 8.3, 8.5, 9.1 for the rest). */
export const DUCKS: Readonly<Record<DuckId, { amounts: DuckAmounts; attackS: number; releaseS: number; holdMs: number | null }>> = {
  speech: { amounts: { music: -8, crowd: -5 }, attackS: 0.04, releaseS: 0.3, holdMs: null },
  // The room drops out too. Without it the crowd runs full through the confirm and the hole is only half a hole;
  // the roar that follows (hype spikes +0.7 on a KO) then reads as a swell instead of a continuation.
  ko: { amounts: { music: -12, sfx: -6, beds: -6, crowd: -4 }, attackS: 0.02, releaseS: 0.4, holdMs: 1200 },
  lock: { amounts: { music: -8, crowd: -2 }, attackS: 0.03, releaseS: 0.4, holdMs: 900 },
  match_end: { amounts: { music: -6, sfx: -4, beds: -4 }, attackS: 0.05, releaseS: 0.6, holdMs: 1800 },
  replay: { amounts: { music: -10, sfx: -3, beds: -3 }, attackS: 0.1, releaseS: 0.5, holdMs: null },
  heavy_hit: { amounts: { music: -4 }, attackS: 0.02, releaseS: 0.25, holdMs: 220 },
  near_ko: { amounts: { music: -3, crowd: -6, beds: -2 }, attackS: 0.3, releaseS: 0.8, holdMs: null },
  steal: { amounts: { music: -6, crowd: -3 }, attackS: 0.02, releaseS: 0.4, holdMs: 800 },
  windup: { amounts: { music: -3, crowd: -2 }, attackS: 0.15, releaseS: 0.3, holdMs: null },
  last_3s: { amounts: { crowd: -3, beds: -2 }, attackS: 0.2, releaseS: 0.5, holdMs: null },
};

export interface AudioBuses {
  sfx: GainNode; beds: GainNode; lead: GainNode; ui: GainNode; voice: GainNode; music: GainNode; crowd: GainNode;
  sfxDuck: GainNode; bedsDuck: GainNode; musicDuck: GainNode; crowdDuck: GainNode; musicTone: BiquadFilterNode;
  master: GainNode; compressor: DynamicsCompressorNode; ceiling: WaveShaperNode;
}

/** Builds the bus graph into `destination`. Pure graph construction; testable with any BaseAudioContext. */
export function buildBusGraph(ctx: BaseAudioContext, destination: AudioNode): AudioBuses {
  const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const master = gain(BUS_GAIN.master);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.15;
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = softClipCurve(LIMITER_CEILING_DB) as Float32Array<ArrayBuffer>;
  ceiling.oversample = "4x";
  master.connect(compressor);
  compressor.connect(ceiling);
  ceiling.connect(destination);

  const sfx = gain(BUS_GAIN.sfx);
  const sfxDuck = gain(1);
  sfx.connect(sfxDuck);
  sfxDuck.connect(master);

  // Servo life, on its own duck: a heavy hit ducks the arms under it without ducking itself.
  const beds = gain(BUS_GAIN.beds);
  const bedsDuck = gain(1);
  beds.connect(bedsDuck);
  bedsDuck.connect(master);

  // The payoff path. A KO ducks music and SFX to clear a hole; the kill confirm is what goes in the hole, so it
  // hangs off master directly. Anything routed here is loud on purpose and must be rare.
  const lead = gain(BUS_GAIN.lead);
  lead.connect(master);

  const ui = gain(BUS_GAIN.ui);
  ui.connect(master);

  const voice = gain(BUS_GAIN.voice);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.707;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.707;
  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.02) / Math.tanh(1.02);           // soft 2% drive: the PA speaker
  }
  drive.curve = curve as Float32Array<ArrayBuffer>;
  voice.connect(hp); hp.connect(lp); lp.connect(drive); drive.connect(master);

  const music = gain(BUS_GAIN.music);
  const musicTone = ctx.createBiquadFilter();
  musicTone.type = "lowpass"; musicTone.frequency.value = 20000; musicTone.Q.value = 0.707;
  const musicDuck = gain(1);
  music.connect(musicTone); musicTone.connect(musicDuck); musicDuck.connect(master);

  const crowd = gain(BUS_GAIN.crowd);
  const crowdDuck = gain(1);
  crowd.connect(crowdDuck); crowdDuck.connect(master);

  return { sfx, beds, lead, ui, voice, music, crowd, sfxDuck, bedsDuck, musicDuck, crowdDuck, musicTone, master, compressor, ceiling };
}

interface Voice { priority: number; startedAt: number; endAt: number; out: GainNode }
interface ActiveDuck { id: DuckId | "voice"; amounts: DuckAmounts; untilS: number | null; attackS: number; releaseS: number }

export interface AudioEngineOptions {
  /** Context factory (tests pass a mock). Default: new AudioContext({ latencyHint: "interactive" }) when available. */
  createContext?: () => BaseAudioContext | null;
  /** Install first-gesture resume listeners on the document (default true in a browser). */
  unlockOnGesture?: boolean;
  /** Seed for noise and parameter randomisation. */
  seed?: number;
  /** Music scheduler uses its own 25 ms timer (default true). */
  musicTimer?: boolean;
}

export interface AudioEngine {
  readonly ctx: BaseAudioContext | null;
  readonly synth: SynthContext | null;
  readonly buses: AudioBuses | null;
  readonly beds: Beds | null;
  readonly crowd: Crowd | null;
  readonly music: MusicControl | null;
  readonly ready: boolean;
  readonly running: boolean;
  readonly activeVoices: number;
  readonly latencyMs: number;
  /** AudioContext time of t₀ (the first successful resume); NaN before it. Nothing is scheduled earlier. */
  readonly t0: number;
  prepare(onProgress: (done: number, total: number) => void): Promise<void>;
  /** Creates (first gesture) and resumes the context. */
  unlock(): Promise<void>;
  /** Called once when the graph exists (first gesture in a browser, prepare with an injected context in tests). */
  onReady(fn: () => void): void;
  now(): number;
  /**
   * 6: audio is scheduled at `ctx.currentTime + (tContact − tNow) + baseLatency`, never on the next rAF.
   * `leadS` is (tContact − tNow) in seconds; negative leads (the contact already happened) clamp to now.
   */
  scheduleAt(leadS: number): number;
  playSfx(id: SfxId, intensity: number, opts?: { pitchOffsetSt?: number; delayS?: number; at?: number }): SfxParams | null;
  /** Plays a custom render (impact object, kill confirm, crowd shout) as a pooled voice at now + delayS, or at `at`. Returns false when dropped. */
  playVoice(bus: BusId, priority: number, render: (s: SynthContext, dest: AudioNode, t: number) => number, delayS?: number, at?: number): boolean;
  duck(id: DuckId, holdMs?: number | null): void;
  releaseDuck(id: DuckId): void;
  setMusicTone(hz: number, tauS: number): void;
  setVolumes(v: Settings["audio"]): void;
  /** Per-frame: expires voices and ducks. */
  update(): void;
  dispose(): void;
}

function defaultContext(): BaseAudioContext | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

export function createAudioEngine(opts: AudioEngineOptions = {}): AudioEngine {
  let ctx: BaseAudioContext | null = null;
  let synth: SynthContext | null = null;
  let buses: AudioBuses | null = null;
  let beds: Beds | null = null;
  let crowd: Crowd | null = null;
  let music: MusicControl | null = null;
  let ready = false;
  let preparing: Promise<void> | null = null;
  const voices: Voice[] = [];
  const ducks: ActiveDuck[] = [];
  const duckLevel = { music: 0, crowd: 0, sfx: 0, beds: 0 };
  let volumes: Settings["audio"] | null = null;
  let t0 = Number.NaN;
  const rng = createRng(opts.seed ?? 0x7a11);
  const unlockCleanup: (() => void)[] = [];
  const prepared: { noise: PreparedNoise | null; applause: PreparedApplause | null } = { noise: null, applause: null };
  let buildFailed = false;

  function build(): void {
    if (ctx || buildFailed) return;
    const make = opts.createContext ?? defaultContext;
    ctx = make();
    if (!ctx) { buildFailed = true; return; }
    const noise = createNoiseBank(ctx, prepared.noise ?? (opts.seed ?? 0x5eed));
    synth = { ctx, noise, rng };
    buses = buildBusGraph(ctx, ctx.destination);
    applyVolumes();
    beds = createBeds(synth, buses.beds);
    crowd = createCrowd(synth, buses.crowd, prepared.applause ?? undefined);
    music = createMusic(synth, buses.music, { useTimer: opts.musicTimer });
    music.start();
    ready = true;
    for (const fn of readyListeners) fn();
  }
  const readyListeners: (() => void)[] = [];

  function applyVolumes(): void {
    if (!buses || !volumes || !ctx) return;
    const t = ctx.currentTime;
    const v = volumes;
    buses.master.gain.setTargetAtTime(BUS_GAIN.master * clamp01(v.master), t, 0.03);
    buses.sfx.gain.setTargetAtTime(BUS_GAIN.sfx * clamp01(v.sfx), t, 0.03);
    buses.beds.gain.setTargetAtTime(BUS_GAIN.beds * clamp01(v.sfx), t, 0.03);
    buses.lead.gain.setTargetAtTime(BUS_GAIN.lead * clamp01(v.sfx), t, 0.03);
    buses.ui.gain.setTargetAtTime(BUS_GAIN.ui * clamp01(v.sfx), t, 0.03);
    buses.music.gain.setTargetAtTime(BUS_GAIN.music * clamp01(v.music), t, 0.03);
    buses.crowd.gain.setTargetAtTime(BUS_GAIN.crowd * clamp01(v.crowd), t, 0.03);
    buses.voice.gain.setTargetAtTime(BUS_GAIN.voice * clamp01(v.voice), t, 0.03);
  }

  function installUnlock(): void {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || opts.unlockOnGesture === false) return;
    const handler = () => { void engine.unlock(); };
    for (const type of ["pointerdown", "keydown", "touchend"]) {
      doc.addEventListener(type, handler, { capture: true, passive: true });
      unlockCleanup.push(() => doc.removeEventListener(type, handler, { capture: true }));
    }
  }

  function pruneVoices(now: number): void {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].endAt <= now) {
        try { voices[i].out.disconnect(); } catch { /* already gone */ }
        voices.splice(i, 1);
      }
    }
  }

  function fadeOut(v: Voice, now: number): void {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.008);
    const out = v.out;
    setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, 80);
  }

  function admit(priority: number, now: number): boolean {
    pruneVoices(now);
    if (priority >= VOICE_DUCK_FROM) {
      // 7: a big voice drops the small ones due in the same 80 ms, so a jab never smears the heavy hit's transient.
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i];
        if (v.priority <= priority - 6 && v.startedAt >= now - 0.001 && v.startedAt <= now + VOICE_DROP_WINDOW_S) { fadeOut(v, now); voices.splice(i, 1); }
      }
    }
    if (voices.length < MAX_VOICES) return true;
    let victim = -1;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.priority > priority) continue;
      if (victim < 0 || v.priority < voices[victim].priority || (v.priority === voices[victim].priority && v.startedAt < voices[victim].startedAt)) victim = i;
    }
    if (victim < 0) return false;
    fadeOut(voices[victim], now);
    voices.splice(victim, 1);
    return true;
  }

  /** The per-voice duck (7): −(p − 4) dB on the priority-2 buses for the voice's length, 20 ms in, 200 ms out. */
  function voiceDuck(priority: number, endAt: number): void {
    if (priority < VOICE_DUCK_FROM) return;
    const db = -(priority - 4);
    const existing = ducks.find((d) => d.id === "voice");
    if (existing) {
      existing.untilS = Math.max(existing.untilS ?? 0, endAt);
      existing.amounts = { music: Math.min(existing.amounts.music ?? 0, db), crowd: Math.min(existing.amounts.crowd ?? 0, db), beds: Math.min(existing.amounts.beds ?? 0, db) };
    } else {
      ducks.push({ id: "voice", amounts: { music: db, crowd: db, beds: db }, untilS: endAt, attackS: VOICE_DUCK_ATTACK_S, releaseS: VOICE_DUCK_RELEASE_S });
    }
  }

  function updateDucks(now: number): void {
    for (let i = ducks.length - 1; i >= 0; i--) {
      const d = ducks[i];
      if (d.untilS !== null && d.untilS <= now) ducks.splice(i, 1);
    }
    if (!buses) return;
    for (const bus of ["music", "crowd", "sfx", "beds"] as const) {
      let db = 0;
      let attack = 0.3;
      let release = 0.3;
      for (const d of ducks) {
        const amt = d.amounts[bus] ?? 0;
        if (amt < db) { db = amt; attack = d.attackS; release = d.releaseS; }
      }
      if (bus === "music" && db < MUSIC_DUCK_FLOOR_DB) db = MUSIC_DUCK_FLOOR_DB;
      if (db === duckLevel[bus]) continue;
      const deeper = db < duckLevel[bus];
      if (!deeper) {
        release = VOICE_DUCK_RELEASE_S;
        for (const d of Object.values(DUCKS)) if ((d.amounts[bus] ?? 0) === duckLevel[bus]) release = d.releaseS;
      }
      duckLevel[bus] = db;
      const node = bus === "music" ? buses.musicDuck : bus === "crowd" ? buses.crowdDuck : bus === "beds" ? buses.bedsDuck : buses.sfxDuck;
      node.gain.setTargetAtTime(dbToGain(db), now, (deeper ? attack : release) / 3);
    }
  }

  const engine: AudioEngine = {
    get ctx() { return ctx; },
    get synth() { return synth; },
    get buses() { return buses; },
    get beds() { return beds; },
    get crowd() { return crowd; },
    get music() { return music; },
    get ready() { return ready; },
    get running() { return !!ctx && (ctx as AudioContext).state === "running"; },
    get activeVoices() {
      if (ctx) pruneVoices(ctx.currentTime);
      return voices.length;
    },
    get latencyMs() {
      const c = ctx as (AudioContext & { outputLatency?: number }) | null;
      if (!c) return 0;
      return ((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000;
    },
    get t0() { return t0; },

    prepare(onProgress) {
      if (preparing) return preparing;
      const total = 4;
      preparing = (async () => {
        // Boot does the maths (noise colours, the applause texture). The AudioContext itself is created on the first
        // user gesture, so the browser's autoplay policy never has anything to complain about.
        onProgress(0, total);
        const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
        if (!opts.createContext && !g.AudioContext && !g.webkitAudioContext) { onProgress(total, total); return; }
        await tick();
        prepared.noise = prepareNoise(opts.seed ?? 0x5eed);
        onProgress(1, total);
        await tick();
        prepared.applause = prepareApplause(0xc1a9);
        onProgress(2, total);
        await tick();
        const eager = opts.createContext !== undefined;
        if (eager) build();
        onProgress(3, total);
        if (!eager) installUnlock();
        onProgress(4, total);
      })();
      return preparing;
    },

    async unlock() {
      if (preparing) await preparing;
      if (!ctx) build();
      const c = ctx as AudioContext | null;
      if (!c || typeof c.resume !== "function") return;
      if (c.state !== "running") {
        try {
          await c.resume();
        } catch {
          return;
        }
      }
      if ((c.state as AudioContextState) === "running") {
        for (const fn of unlockCleanup) fn();
        unlockCleanup.length = 0;
        if (!Number.isFinite(t0)) {
          // t₀: the click that owns the first pixel of motion also owns the first sample. Confirmation, −12 dB.
          t0 = c.currentTime;
          engine.playSfx("t0_clack", 1);
        }
      }
    },

    onReady(fn) {
      if (ready) fn(); else readyListeners.push(fn);
    },

    now() { return ctx ? ctx.currentTime : 0; },

    scheduleAt(leadS) {
      const c = ctx as (AudioContext & { baseLatency?: number }) | null;
      if (!c) return 0;
      return c.currentTime + Math.max(0, Number.isFinite(leadS) ? leadS : 0) + (c.baseLatency ?? 0);
    },

    playSfx(id, intensity, o = {}) {
      if (!ready || !ctx || !synth || !buses) return null;
      const recipe = SFX[id];
      const now = ctx.currentTime;
      if (!admit(recipe.priority, now)) return null;
      const params = rollSfxParams(recipe, rng, intensity, o.pitchOffsetSt ?? 0);
      const at = o.at !== undefined ? Math.max(now, o.at) : now + Math.max(0, o.delayS ?? 0);
      const out = ctx.createGain();
      out.connect(recipe.bus === "ui" ? buses.ui : buses.sfx);
      const end = recipe.render(synth, out, at, params);
      voices.push({ priority: recipe.priority, startedAt: at, endAt: end + 0.05, out });
      voiceDuck(recipe.priority, end);
      updateDucks(now);
      return params;
    },

    playVoice(bus, priority, render, delayS = 0, atTime) {
      if (!ready || !ctx || !synth || !buses) return false;
      const now = ctx.currentTime;
      if (!admit(priority, now)) return false;
      const out = ctx.createGain();
      out.connect(buses[bus]);
      const at = atTime !== undefined ? Math.max(now, atTime) : now + Math.max(0, delayS);
      const end = render(synth, out, at);
      voices.push({ priority, startedAt: at, endAt: end + 0.05, out });
      voiceDuck(priority, end);
      updateDucks(now);
      return true;
    },

    duck(id, holdMs) {
      const shape = DUCKS[id];
      const now = ctx ? ctx.currentTime : 0;
      const hold = holdMs === undefined ? shape.holdMs : holdMs;
      const existing = ducks.find((d) => d.id === id);
      const untilS = hold === null ? null : now + hold / 1000;
      if (existing) existing.untilS = existing.untilS === null || untilS === null ? null : Math.max(existing.untilS, untilS);
      else ducks.push({ id, amounts: shape.amounts, untilS, attackS: shape.attackS, releaseS: shape.releaseS });
      updateDucks(now);
    },

    releaseDuck(id) {
      const i = ducks.findIndex((d) => d.id === id);
      if (i >= 0) ducks.splice(i, 1);
      updateDucks(ctx ? ctx.currentTime : 0);
    },

    setMusicTone(hz, tauS) {
      if (!buses || !ctx) return;
      buses.musicTone.frequency.setTargetAtTime(Math.max(200, Math.min(20000, hz)), ctx.currentTime, Math.max(0.005, tauS));
    },

    setVolumes(v) {
      volumes = v;
      applyVolumes();
    },

    update() {
      if (!ctx) return;
      const now = ctx.currentTime;
      pruneVoices(now);
      updateDucks(now);
      music?.pump(now);
    },

    dispose() {
      for (const fn of unlockCleanup) fn();
      unlockCleanup.length = 0;
      music?.dispose();
      beds?.dispose();
      crowd?.dispose();
      const c = ctx as AudioContext | null;
      if (c && typeof c.close === "function") void c.close().catch(() => undefined);
      ready = false;
    },
  };
  return engine;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
