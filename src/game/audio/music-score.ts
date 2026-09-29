// src/game/audio/music-score.ts (WP8)
// The TORQUE LIMIT score as data (GAME_DESIGN 9.5). A small synthesized studio band (drums, bass, clav) playing a
// funk-leaning breakbeat in D Dorian at 104 BPM. Signature: the six-note needle motif D F G A B A, whose B natural
// (the raised Dorian sixth) is the colour. Harmony is an i-IV vamp (Dm7 - G7) with a bVII (Cmaj7) turnaround every
// 8 bars; there is no vi-IV-I-V anywhere. Everything here is static data built once at import, so the scheduler
// walks precomputed arrays and allocates nothing per note.

import type { MusicState } from "../contracts.ts";

export const BPM = 104;
export const STEPS_PER_BAR = 16;
export const BARS_PER_LOOP = 8;
export const SECONDS_PER_BEAT = 60 / BPM;
export const SECONDS_PER_STEP = SECONDS_PER_BEAT / 4;
export const SECONDS_PER_BAR = SECONDS_PER_STEP * STEPS_PER_BAR;

/** D Dorian pitch classes: D E F G A B C. */
export const D_DORIAN_PCS: readonly number[] = [2, 4, 5, 7, 9, 11, 0];

export type Instrument =
  | "kick" | "snare" | "rim" | "hat_closed" | "hat_open" | "hat_brush" | "tom_hi" | "tom_lo" | "crash"
  | "bass" | "clav_stab" | "clav_lead" | "clav_pad" | "riser";

export const PITCHED: ReadonlySet<Instrument> = new Set<Instrument>(["bass", "clav_stab", "clav_lead", "clav_pad"]);
/** The drum kit: gated as one group by the exchange gate, the last-3-s cut and the near-KO thinning (7). */
export const DRUMS: ReadonlySet<Instrument> = new Set<Instrument>(["kick", "snare", "rim", "hat_closed", "hat_open", "hat_brush", "tom_hi", "tom_lo", "crash"]);

export interface ScoreNote {
  instrument: Instrument;
  step: number;          // 0..15 within the bar
  midi: number;          // 0 for unpitched
  velocity: number;      // 0..1
  lengthSteps: number;
}

export type Layer = "low" | "mid" | "high" | "final_round" | "sudden_death" | "lobby";
export const LAYERS: readonly Layer[] = ["low", "mid", "high", "final_round", "sudden_death", "lobby"];

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ── harmony ── */

export interface Chord { name: "Dm7" | "G7" | "Cmaj7" | "Dmaj"; root: number; voicing: readonly number[] }
export const CHORDS: Readonly<Record<Chord["name"], Chord>> = {
  Dm7: { name: "Dm7", root: 38, voicing: [62, 65, 69, 72] },       // D4 F4 A4 C5, bass D2
  G7: { name: "G7", root: 43, voicing: [59, 62, 65, 67] },         // B3 D4 F4 G4, bass G2
  Cmaj7: { name: "Cmaj7", root: 36, voicing: [60, 64, 67, 71] },   // C4 E4 G4 B4, bass C2
  Dmaj: { name: "Dmaj", root: 38, voicing: [62, 66, 69, 74] },     // Picardy third for the victory stinger
};

/** Eight-bar vamp: i i IV IV i i IV bVII. */
export const PROGRESSION: readonly Chord["name"][] = ["Dm7", "Dm7", "G7", "G7", "Dm7", "Dm7", "G7", "Cmaj7"];

/** The needle motif (D F G A B A), syncopated across one bar, in the D5 octave. */
export const MOTIF: readonly { step: number; midi: number; lengthSteps: number }[] = [
  { step: 0, midi: 74, lengthSteps: 2 },
  { step: 3, midi: 77, lengthSteps: 2 },
  { step: 6, midi: 79, lengthSteps: 2 },
  { step: 8, midi: 81, lengthSteps: 2 },
  { step: 10, midi: 83, lengthSteps: 2 },
  { step: 13, midi: 81, lengthSteps: 3 },
];

/* ── drum grids (16 steps, velocity; 0 = rest) ── */

const KICK_LOW = [1, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.9, 0, 0, 0, 0, 0];
const KICK_TURN = [1, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.9, 0, 0, 0.6, 0, 0];
const RIM_GHOST = [0, 0, 0, 0.35, 0, 0, 0.25, 0, 0, 0.3, 0, 0, 0, 0, 0.25, 0];
const HAT_8THS = [0.8, 0, 0.5, 0, 0.75, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.75, 0, 0.55, 0];
const SNARE_BACK = [0, 0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0, 0, 1, 0, 0, 0.22];
const HAT_OPEN_OFF = [0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0];
const HALF_KICK = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0];
const HALF_SNARE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const SD_KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const BRUSH = [0.5, 0, 0.3, 0.2, 0.45, 0, 0.3, 0.2, 0.5, 0, 0.3, 0.2, 0.45, 0, 0.3, 0.25];

/** Bass figure: root and fifth on the vamp (scale degrees in semitones above the chord root). */
const BASS_FIGURE: readonly [number, number, number, number][] = [
  // step, semitones, velocity, length
  [0, 0, 1, 3], [3, 0, 0.6, 1], [6, 7, 0.85, 2], [8, 12, 0.7, 2], [10, 7, 0.8, 2], [13, 10, 0.65, 2],
];
/** Muted clav stabs (16ths) on the chord. */
const CLAV_STABS = [0, 0, 0.8, 0, 0, 0.55, 0, 0.7, 0, 0, 0.8, 0, 0, 0.55, 0.45, 0];

function grid(inst: Instrument, pattern: readonly number[], out: ScoreNote[], lengthSteps = 1): void {
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    const v = pattern[s];
    if (v > 0) out.push({ instrument: inst, step: s, midi: 0, velocity: v, lengthSteps });
  }
}

function bassBar(chord: Chord, out: ScoreNote[]): void {
  // The figure's seventh is the chord's own (C over Dm7, F over G7, B over Cmaj7), so the bass never leaves the mode.
  const seventh = chord.name === "Cmaj7" ? 11 : 10;
  for (const [step, semis, vel, len] of BASS_FIGURE) {
    out.push({ instrument: "bass", step, midi: chord.root + (semis === 10 ? seventh : semis), velocity: vel, lengthSteps: len });
  }
}

function clavBar(chord: Chord, pattern: readonly number[], out: ScoreNote[]): void {
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    const v = pattern[s];
    if (v <= 0) continue;
    for (const m of chord.voicing) out.push({ instrument: "clav_stab", step: s, midi: m, velocity: v, lengthSteps: 1 });
  }
}

function motifBar(octave: number, out: ScoreNote[], velocity = 0.9): void {
  for (const n of MOTIF) out.push({ instrument: "clav_lead", step: n.step, midi: n.midi + 12 * octave, velocity, lengthSteps: n.lengthSteps });
}

function tomFill(out: ScoreNote[]): void {
  out.push({ instrument: "tom_hi", step: 12, midi: 0, velocity: 0.8, lengthSteps: 1 });
  out.push({ instrument: "tom_hi", step: 13, midi: 0, velocity: 0.7, lengthSteps: 1 });
  out.push({ instrument: "tom_lo", step: 14, midi: 0, velocity: 0.85, lengthSteps: 1 });
  out.push({ instrument: "tom_lo", step: 15, midi: 0, velocity: 0.95, lengthSteps: 1 });
}

function buildLoop(layer: Layer): readonly (readonly ScoreNote[])[] {
  const bars: ScoreNote[][] = [];
  for (let bar = 0; bar < BARS_PER_LOOP; bar++) {
    const chord = CHORDS[PROGRESSION[bar]];
    const notes: ScoreNote[] = [];
    switch (layer) {
      case "low":
        grid("kick", bar === 7 ? KICK_TURN : KICK_LOW, notes);
        grid("rim", RIM_GHOST, notes);
        grid("hat_closed", HAT_8THS, notes);
        bassBar(chord, notes);
        break;
      case "mid":
        grid("snare", SNARE_BACK, notes);
        clavBar(chord, CLAV_STABS, notes);
        break;
      case "high":
        if (bar % 4 === 3) motifBar(0, notes);
        grid("hat_open", HAT_OPEN_OFF, notes, 2);
        if (bar === 7) tomFill(notes);
        break;
      case "final_round":
        // The motif doubled an octave up over half-time drums; replaces "high" in the final round.
        if (bar % 2 === 1) { motifBar(0, notes, 0.85); motifBar(1, notes, 0.6); }
        grid("kick", HALF_KICK, notes);
        grid("snare", HALF_SNARE, notes);
        grid("hat_open", HAT_OPEN_OFF, notes, 2);
        if (bar === 7) tomFill(notes);
        break;
      case "sudden_death":
        grid("kick", SD_KICK, notes);
        for (const s of [0, 4, 8, 12]) notes.push({ instrument: "bass", step: s, midi: 38, velocity: 0.9, lengthSteps: 2 });
        for (const m of CHORDS.Dm7.voicing) notes.push({ instrument: "clav_stab", step: 12, midi: m, velocity: 0.85, lengthSteps: 1 });
        break;
      case "lobby":
        grid("hat_brush", BRUSH, notes);
        bassBar(chord, notes);
        break;
    }
    notes.sort((a, b) => a.step - b.step);
    bars.push(notes);
  }
  return bars;
}

/** Precomputed 8-bar loops per layer; index with bar % 8. */
export const LAYER_LOOPS: Readonly<Record<Layer, readonly (readonly ScoreNote[])[]>> = {
  low: buildLoop("low"), mid: buildLoop("mid"), high: buildLoop("high"),
  final_round: buildLoop("final_round"), sudden_death: buildLoop("sudden_death"), lobby: buildLoop("lobby"),
};

/** The title state plays the motif every 8 bars on top of low + mid. */
export const TITLE_MOTIF_BAR: readonly ScoreNote[] = (() => { const n: ScoreNote[] = []; motifBar(0, n, 0.8); return n; })();

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface ArrangementFlags { finalRound: boolean; suddenDeath: boolean; coreLive?: boolean }
export type LayerMix = Record<Layer, number>;

/** Target gain (0..1) of each layer for a music state and hype (9.5 tables). Applied on bar boundaries. */
export function layerMix(state: MusicState, hype: number, flags: ArrangementFlags, out: LayerMix): LayerMix {
  for (const l of LAYERS) out[l] = 0;
  switch (state) {
    case "title":
      out.low = 1; out.mid = 1;
      break;
    case "lobby":
      out.lobby = 1;
      break;
    case "match":
      if (flags.suddenDeath) { out.sudden_death = 1; break; }
      out.low = 1;
      out.mid = flags.finalRound ? 1 : smoothstep(0.35, 0.45, hype);
      // 7 E: a Core drop puts `high` on after its riser, whatever the hype.
      if (flags.finalRound) out.final_round = smoothstep(0.35, 0.8, Math.max(hype, 0.5));
      else out.high = flags.coreLive ? 1 : smoothstep(0.7, 0.8, hype);
      break;
    case "between_rounds":
      out.low = 0.5;                                  // -6 dB
      break;
    default:
      break;
  }
  return out;
}

/* ── stingers ── */

export type StingerId = "engage" | "final_round" | "sudden_death" | "victory" | "defeat" | "momentum_up" | "momentum_down" | "count_in";

export interface StingerNote { atS: number; instrument: Instrument; midi: number; velocity: number; durS: number }

const st = SECONDS_PER_STEP;

function motifStinger(count: number, startS: number, stepScale: number): StingerNote[] {
  return MOTIF.slice(0, count).map((n) => ({ atS: startS + n.step * st * stepScale, instrument: "clav_lead" as const, midi: n.midi, velocity: 0.95, durS: n.lengthSteps * st * stepScale }));
}

function chordNotes(chord: Chord, atS: number, durS: number, velocity: number): StingerNote[] {
  return [
    ...chord.voicing.map((m) => ({ atS, instrument: "clav_pad" as const, midi: m, velocity, durS })),
    { atS, instrument: "bass", midi: chord.root, velocity, durS },
  ];
}

export const STINGERS: Readonly<Record<StingerId, readonly StingerNote[]>> = {
  engage: [
    { atS: 0, instrument: "snare", midi: 0, velocity: 1, durS: 0.2 },
    { atS: 0, instrument: "crash", midi: 0, velocity: 0.9, durS: 1.4 },
    { atS: 0, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 0, instrument: "bass", midi: 38, velocity: 0.9, durS: 0.45 },
  ],
  final_round: [
    ...motifStinger(4, 0, 1),
    { atS: 0, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 8 * st, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 8 * st, instrument: "crash", midi: 0, velocity: 0.8, durS: 1.2 },
    ...chordNotes(CHORDS.Dm7, 12 * st, 0.9, 0.6),
  ],
  // 7 D: a one-bar clav stab up a fourth on the player's streak (D → G), down a fourth when it breaks (D → A).
  momentum_up: [
    { atS: 0, instrument: "clav_stab", midi: 74, velocity: 0.9, durS: 0.12 },
    { atS: 2 * st, instrument: "clav_stab", midi: 74, velocity: 0.7, durS: 0.1 },
    { atS: 4 * st, instrument: "clav_stab", midi: 79, velocity: 1, durS: 0.3 },
    { atS: 4 * st, instrument: "bass", midi: 43, velocity: 0.8, durS: 0.5 },
  ],
  momentum_down: [
    { atS: 0, instrument: "clav_stab", midi: 74, velocity: 0.9, durS: 0.12 },
    { atS: 2 * st, instrument: "clav_stab", midi: 74, velocity: 0.7, durS: 0.1 },
    { atS: 4 * st, instrument: "clav_stab", midi: 69, velocity: 0.85, durS: 0.3 },
    { atS: 4 * st, instrument: "bass", midi: 33, velocity: 0.8, durS: 0.5 },
  ],
  // 7 A: three muted kicks at eighth notes (0.87 s at 104 BPM); the slam to LOWERED is the third.
  count_in: [
    { atS: 0, instrument: "kick", midi: 0, velocity: 0.55, durS: 0.2 },
    { atS: 2 * st, instrument: "kick", midi: 0, velocity: 0.65, durS: 0.2 },
    { atS: 4 * st, instrument: "kick", midi: 0, velocity: 0.8, durS: 0.2 },
  ],
  sudden_death: [
    // 7: the riser under the four kicks.
    { atS: 0, instrument: "riser", midi: 0, velocity: 0.8, durS: 12 * st },
    { atS: 0, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 4 * st, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 8 * st, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 10 * st, instrument: "tom_lo", midi: 0, velocity: 0.9, durS: 0.3 },
    { atS: 12 * st, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 12 * st, instrument: "snare", midi: 0, velocity: 1, durS: 0.3 },
    { atS: 12 * st, instrument: "crash", midi: 0, velocity: 0.9, durS: 1.0 },
  ],
  victory: [
    ...motifStinger(6, 0, 1),
    ...chordNotes(CHORDS.Dmaj, 16 * st, 3.0 - 16 * st, 0.85),
    { atS: 12 * st, instrument: "tom_hi", midi: 0, velocity: 0.8, durS: 0.2 },
    { atS: 13 * st, instrument: "tom_hi", midi: 0, velocity: 0.8, durS: 0.2 },
    { atS: 14 * st, instrument: "tom_lo", midi: 0, velocity: 0.9, durS: 0.2 },
    { atS: 15 * st, instrument: "tom_lo", midi: 0, velocity: 1, durS: 0.2 },
    { atS: 16 * st, instrument: "crash", midi: 0, velocity: 1, durS: 3.0 - 16 * st },
    { atS: 16 * st, instrument: "kick", midi: 0, velocity: 1, durS: 0.3 },
  ],
  defeat: [
    ...motifStinger(4, 0, 1.25),
    ...CHORDS.Dm7.voicing.slice(0, 3).map((m) => ({ atS: 10 * st * 1.25, instrument: "clav_pad" as const, midi: m, velocity: 0.55, durS: 3.0 - 10 * st * 1.25 })),
    { atS: 0, instrument: "bass", midi: 38, velocity: 0.8, durS: 10 * st * 1.25 },
    { atS: 10 * st * 1.25, instrument: "bass", midi: 36, velocity: 0.75, durS: 3.0 - 10 * st * 1.25 },
  ],
};

/** Total length of a stinger in seconds (last note end). */
export function stingerLengthS(id: StingerId): number {
  let end = 0;
  for (const n of STINGERS[id]) end = Math.max(end, n.atS + n.durS);
  return end;
}
