// src/game/audio/music.ts (WP8)
// The band and its conductor (GAME_DESIGN 9.5). A lookahead scheduler (25 ms tick, 100 ms horizon) walks the
// precomputed loops in music-score.ts and schedules every note on AudioContext time, so timing never depends on
// frame rate. Layers change on bar boundaries: each layer has a persistent GainNode ramped over one bar toward the
// arrangement's target (hype crossfades, the final-round arrangement, sudden death). Stingers (ENGAGE, FINAL ROUND,
// SUDDEN DEATH, VICTORY, DEFEAT) play over the bed on their own bus and duck it while they sound.
// Instruments are small synth voices: kick, snare, rim, hats, brush, toms, crash, bass, and a clavinet built from a
// pulse wave through a resonant band-pass with a fast pluck envelope.

import type { MusicState } from "../contracts.ts";
import {
  BARS_PER_LOOP, DRUMS, LAYERS, LAYER_LOOPS, SECONDS_PER_BAR, SECONDS_PER_STEP, STEPS_PER_BAR, STINGERS, TITLE_MOTIF_BAR,
  layerMix, midiToHz, stingerLengthS,
  type ArrangementFlags, type Instrument, type Layer, type LayerMix, type StingerId,
} from "./music-score.ts";
import { click, dbToGain, noiseBurst, toneBurst, type SynthContext } from "./synth.ts";

export const LOOKAHEAD_S = 0.1;
export const SCHEDULER_TICK_MS = 25;

/** Plays one instrument hit. Exposed for the offline renders in ?debug=audio. Returns the end time. */
export function playInstrument(s: SynthContext, dest: AudioNode, t: number, inst: Instrument, midi: number, velocity: number, durS: number): number {
  const v = Math.max(0.05, Math.min(1, velocity));
  switch (inst) {
    case "kick":
      click(s, dest, t, { gain: 0.25 * v, highpass: 3000, lenS: 0.002 });
      return toneBurst(s, dest, t, { wave: "sine", freq: 150, freqEnd: 44, glideS: 0.09, gain: 0.95 * v, attackS: 0.001, decayS: 0.28 });
    case "snare":
      toneBurst(s, dest, t, { wave: "triangle", freq: 210, freqEnd: 170, gain: 0.35 * v, attackS: 0.001, decayS: 0.09 });
      return noiseBurst(s, dest, t, { filter: "bandpass", freq: 2400, q: 0.7, gain: 0.6 * v, attackS: 0.001, decayS: 0.17 });
    case "rim":
      // A cross-stick is wood on wood: a short resonant knock, not a tick of hiss. Capping the click at 5.2 kHz and
      // giving it a body is the difference.
      click(s, dest, t, { gain: 0.34 * v, highpass: 1500, topHz: 5200, lenS: 0.003, body: 780 });
      return noiseBurst(s, dest, t, { filter: "bandpass", freq: 1900, q: 5, gain: 0.62 * v, attackS: 0.0008, decayS: 0.035 });
    case "hat_closed":
      // Hats roll off; a highpass alone runs flat to Nyquist and reads as white noise on a 48 kHz context.
      return noiseBurst(s, dest, t, { filter: "highpass", freq: 7000, q: 0.8, topHz: 12000, gain: 0.3 * v, attackS: 0.0008, decayS: 0.035 });
    case "hat_open":
      return noiseBurst(s, dest, t, { filter: "highpass", freq: 6400, q: 0.7, topHz: 11000, gain: 0.26 * v, attackS: 0.001, decayS: Math.max(0.12, durS) });
    case "hat_brush":
      // The lobby bed is brush and bass and nothing else, so the brush has to actually be there.
      return noiseBurst(s, dest, t, { color: "pink", filter: "bandpass", freq: 4200, q: 0.5, topHz: 10000, gain: 0.85 * v, attackS: 0.012, decayS: 0.1 });
    case "tom_hi":
      return toneBurst(s, dest, t, { wave: "sine", freq: 220, freqEnd: 140, gain: 0.6 * v, attackS: 0.001, decayS: 0.22 });
    case "tom_lo":
      return toneBurst(s, dest, t, { wave: "sine", freq: 150, freqEnd: 90, gain: 0.7 * v, attackS: 0.001, decayS: 0.28 });
    case "crash":
      return noiseBurst(s, dest, t, { filter: "highpass", freq: 4500, freqEnd: 3000, q: 0.5, gain: 0.3 * v, attackS: 0.002, decayS: Math.max(0.6, durS) });
    case "riser":
      // A band-passed noise sweep climbing over the note's length (the sudden-death riser).
      return noiseBurst(s, dest, t, { color: "pink", filter: "bandpass", freq: 300, freqEnd: 4800, q: 2, gain: 0.45 * v, attackS: Math.max(0.05, durS * 0.85), decayS: Math.max(0.05, durS * 0.15) });
    case "bass": {
      const hz = midiToHz(midi);
      toneBurst(s, dest, t, { wave: "sine", freq: hz, gain: 0.55 * v, attackS: 0.004, holdS: Math.max(0.02, durS * 0.6), decayS: durS * 0.4 + 0.04 });
      return toneBurst(s, dest, t, { wave: "sawtooth", freq: hz, gain: 0.28 * v, attackS: 0.003, holdS: Math.max(0.01, durS * 0.4), decayS: durS * 0.5 + 0.03, filter: { type: "lowpass", freq: hz * 7, freqEnd: hz * 2.2, q: 3 } });
    }
    case "clav_stab":
    case "clav_lead":
    case "clav_pad": {
      const hz = midiToHz(midi);
      const lead = inst === "clav_lead";
      const pad = inst === "clav_pad";
      const decay = pad ? Math.max(0.4, durS) : lead ? Math.max(0.12, durS * 0.9) : 0.07;
      const gain = (pad ? 0.28 : lead ? 0.62 : 0.34) * v;
      toneBurst(s, dest, t, { wave: "square", freq: hz, gain, attackS: 0.0015, decayS: decay, detuneCents: lead ? 4 : 0, filter: { type: "bandpass", freq: hz * (lead ? 3.2 : 2.6), freqEnd: hz * 1.4, q: pad ? 0.9 : 1.6 } });
      return toneBurst(s, dest, t, { wave: "sawtooth", freq: hz * 1.003, gain: gain * 0.35, attackS: 0.001, decayS: decay * 0.6, filter: { type: "lowpass", freq: hz * 5, freqEnd: hz * 1.5, q: 1 } });
    }
  }
}

export interface MusicControl {
  readonly state: MusicState;
  readonly bar: number;
  readonly layerGains: Readonly<LayerMix>;
  /** The drum group's current target (0..1): the exchange gate, the last-3-s cut and the near-KO thinning. */
  readonly drums: number;
  setState(state: MusicState, now: number): void;
  setHype(h: number): void;
  setFlags(flags: Partial<ArrangementFlags>): void;
  /**
   * 7: the drums gate on `in_exchange` and come out for the last 3 s of a lock and under near-KO (× (1 − 0.7u)).
   * Level 0..1; ramped over `tauS` (default one beat).
   */
  setDrums(level: number, now: number, tauS?: number): void;
  stinger(id: StingerId, when: number): void;
  /** AudioContext time of the next bar's downbeat (or now + 10 ms when the grid is not running). */
  nextBar(now: number): number;
  /** Schedules notes up to now + lookahead; call from the 25 ms timer and from the frame loop. */
  pump(now: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

const STATE_LOOP: Partial<Record<MusicState, true>> = { title: true, lobby: true, match: true, between_rounds: true };

export function createMusic(s: SynthContext, dest: AudioNode, opts: { useTimer?: boolean } = {}): MusicControl {
  const { ctx } = s;
  const bed = ctx.createGain();
  bed.gain.value = 1;
  bed.connect(dest);
  const stingBus = ctx.createGain();
  stingBus.gain.value = dbToGain(-2);
  stingBus.connect(dest);
  const layerGain = {} as Record<Layer, GainNode>;
  const drumGain = {} as Record<Layer, GainNode>;   // the drum group inside each layer, gated as one
  for (const l of LAYERS) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(bed);
    layerGain[l] = g;
    const d = ctx.createGain();
    d.gain.value = 1;
    d.connect(g);
    drumGain[l] = d;
  }
  let drums = 1;

  let state: MusicState = "off";
  let hype = 0;
  const flags: ArrangementFlags = { finalRound: false, suddenDeath: false };
  const current: LayerMix = { low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 0, lobby: 0 };
  const target: LayerMix = { low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 0, lobby: 0 };
  const previous: LayerMix = { low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 0, lobby: 0 };
  let nextStepTime = 0;
  let step = 0;
  let bar = 0;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stingerUntil = 0;
  let pendingEntry: number | null = null;

  function applyBarMix(at: number): void {
    layerMix(state, hype, flags, target);
    for (const l of LAYERS) {
      previous[l] = current[l];
      if (Math.abs(target[l] - current[l]) < 1e-3) continue;
      const g = layerGain[l].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(current[l], at);
      // One-bar crossfade; entering from silence is quicker so ENGAGE lands on the downbeat.
      g.linearRampToValueAtTime(target[l], at + (current[l] === 0 ? 0.05 : SECONDS_PER_BAR));
      current[l] = target[l];
    }
  }

  function scheduleStep(at: number): void {
    if (step === 0) applyBarMix(at);
    const loopBar = bar % BARS_PER_LOOP;
    for (const l of LAYERS) {
      if (current[l] <= 0 && previous[l] <= 0) continue;     // a fading layer keeps playing through its crossfade bar
      const notes = LAYER_LOOPS[l][loopBar];
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.step !== step) continue;
        playInstrument(s, DRUMS.has(n.instrument) ? drumGain[l] : layerGain[l], at, n.instrument, n.midi, n.velocity, n.lengthSteps * SECONDS_PER_STEP);
      }
    }
    if (state === "title" && bar % 8 === 7) {
      for (const n of TITLE_MOTIF_BAR) if (n.step === step) playInstrument(s, layerGain.mid, at, n.instrument, n.midi, n.velocity, n.lengthSteps * SECONDS_PER_STEP);
    }
  }

  const music: MusicControl = {
    get state() { return state; },
    get bar() { return bar; },
    get layerGains() { return current; },
    get drums() { return drums; },

    setState(next, now) {
      if (next === state) return;
      const prev = state;
      state = next;
      if (next === "victory" || next === "defeat") {
        music.stinger(next, now + 0.02);
        for (const l of LAYERS) {
          const g = layerGain[l].gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(current[l], now);
          g.linearRampToValueAtTime(0, now + 0.25);
          current[l] = 0;
        }
        return;
      }
      if (next === "off") {
        for (const l of LAYERS) {
          const g = layerGain[l].gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(current[l], now);
          g.linearRampToValueAtTime(0, now + 0.6);
          current[l] = 0;
        }
        return;
      }
      if (next === "match" && prev !== "match") {
        // The match layers enter on the ENGAGE downbeat: restart the bar grid now.
        pendingEntry = now;
      }
      if (STATE_LOOP[next] && !STATE_LOOP[prev]) pendingEntry = now;
    },

    setHype(h) { hype = Math.max(0, Math.min(1, Number.isFinite(h) ? h : 0)); },

    setFlags(f) {
      if (f.finalRound !== undefined) flags.finalRound = f.finalRound;
      if (f.suddenDeath !== undefined) flags.suddenDeath = f.suddenDeath;
      if (f.coreLive !== undefined) flags.coreLive = f.coreLive;
    },

    setDrums(level, now, tauS = SECONDS_PER_BAR / 4) {
      const v = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 1));
      if (Math.abs(v - drums) < 1e-3) return;
      drums = v;
      for (const l of LAYERS) drumGain[l].gain.setTargetAtTime(v, now, Math.max(0.005, tauS) / 3);
    },

    nextBar(now) {
      if (!playing || !STATE_LOOP[state] || nextStepTime <= 0) return now + 0.01;
      const remaining = (STEPS_PER_BAR - step) % STEPS_PER_BAR;
      const t = nextStepTime + remaining * SECONDS_PER_STEP;
      return t > now ? t : now + 0.01;
    },

    stinger(id, when) {
      const t = Math.max(when, ctx.currentTime);
      for (const n of STINGERS[id]) playInstrument(s, stingBus, t + n.atS, n.instrument, n.midi, n.velocity, n.durS);
      const len = stingerLengthS(id);
      stingerUntil = Math.max(stingerUntil, t + len);
      // Duck the bed under the stinger, back over half a second after it ends.
      bed.gain.cancelScheduledValues(t);
      bed.gain.setValueAtTime(bed.gain.value, t);
      bed.gain.linearRampToValueAtTime(dbToGain(-9), t + 0.04);
      bed.gain.setValueAtTime(dbToGain(-9), stingerUntil);
      bed.gain.linearRampToValueAtTime(1, stingerUntil + 0.5);
    },

    pump(now) {
      if (!playing) return;
      if (pendingEntry !== null) {
        nextStepTime = Math.max(now, pendingEntry) + 0.01;
        step = 0;
        bar = 0;
        pendingEntry = null;
      }
      if (!STATE_LOOP[state]) return;
      if (nextStepTime < now - 0.25) {
        // The tab slept: realign to the next bar instead of machine-gunning missed notes.
        nextStepTime = now + 0.01;
        step = 0;
        bar++;
      }
      while (nextStepTime < now + LOOKAHEAD_S) {
        scheduleStep(nextStepTime);
        nextStepTime += SECONDS_PER_STEP;
        step++;
        if (step >= STEPS_PER_BAR) { step = 0; bar++; }
      }
    },

    start() {
      if (playing) return;
      playing = true;
      if (opts.useTimer !== false && typeof setInterval === "function") {
        timer = setInterval(() => music.pump(ctx.currentTime), SCHEDULER_TICK_MS);
      }
    },

    stop() {
      playing = false;
      if (timer) { clearInterval(timer); timer = null; }
    },

    dispose() {
      music.stop();
      bed.disconnect();
      stingBus.disconnect();
    },
  };
  return music;
}
