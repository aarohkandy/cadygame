// src/game/audio/kill-confirm.ts (WP3)
// The kill confirm: the Pavlovian payoff when your opponent's arm goes offline (SCOPE 1.1, 3). Our own figure, built
// entirely from synthesis, in a fixed syncopated rhythm that spans sub and treble so it pokes through crowd and
// commentary mids:
//
//   0 ms     SUB THUMP     sine 64 -> 34 Hz with a felt click
//   85 ms    SERVO RATCHET four accelerating relay teeth, pitch walking down
//   235 ms   BELL          a bright two-operator counter bell (D6 with an inharmonic partial)
//   235-470  GAP           silence under the bell tail: the rhythmic hole the ear fills in
//   470 ms   ANSWER        a softer bell a fifth below plus a short sub, closing the phrase
//
// The offsets are exported so tests and ?debug=audio can check the order on rendered audio.

import { click, dbToGain, fmBell, toneBurst, type SynthContext } from "./synth.ts";

export const KILL_CONFIRM_TIMING = {
  thumpS: 0,
  ratchetS: 0.085,
  ratchetTeeth: [0, 0.028, 0.052, 0.073] as readonly number[],
  bellS: 0.235,
  gapStartS: 0.3,
  gapEndS: 0.47,
  answerS: 0.47,
  lengthS: 1.35,
} as const;

/** Renders the kill confirm starting at `t` into `dest`. `pitchSt` shifts the bells slightly per play (±0.5 st). */
export function renderKillConfirm(s: SynthContext, dest: AudioNode, t: number, pitchSt = 0): number {
  const T = KILL_CONFIRM_TIMING;
  const k = Math.pow(2, pitchSt / 12);
  // The rarest cue in the game, and it plays into a hole the KO duck has already cleared on every other bus, so it
  // is mixed to sit right under the ceiling rather than politely among the one-shots.
  const level = dbToGain(-0.5);

  // Sub thump.
  toneBurst(s, dest, t + T.thumpS, { wave: "sine", freq: 64, freqEnd: 34, glideS: 0.16, gain: level * 0.95, attackS: 0.002, decayS: 0.17 });
  click(s, dest, t + T.thumpS, { gain: level * 0.35, highpass: 3800, lenS: 0.003 });

  // Servo ratchet: four teeth, each a little lower and quieter.
  T.ratchetTeeth.forEach((off, i) => {
    click(s, dest, t + T.ratchetS + off, { gain: level * (0.42 - i * 0.05), highpass: 2200 - i * 180, lenS: 0.004, body: 900 - i * 90 });
  });

  // Bell, then silence until the answer.
  fmBell(s, dest, t + T.bellS, { freq: 1174.66 * k, ratio: 3.01, index: 1.6, gain: level * 0.5, decayS: T.gapEndS - T.bellS - 0.02, partial: 2.76 });
  fmBell(s, dest, t + T.bellS, { freq: 2349.32 * k, ratio: 1.5, index: 0.8, gain: level * 0.12, decayS: 0.12 });

  // Answer: a fifth below, a short sub under it.
  toneBurst(s, dest, t + T.answerS, { wave: "sine", freq: 58, freqEnd: 40, glideS: 0.1, gain: level * 0.6, attackS: 0.002, decayS: 0.12 });
  return fmBell(s, dest, t + T.answerS, { freq: 783.99 * k, ratio: 3.01, index: 1.2, gain: level * 0.42, decayS: T.lengthS - T.answerS });
}
