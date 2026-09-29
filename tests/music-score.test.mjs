// WP3 score (GAME_DESIGN 9.5, BUILD_PLAN 4 WP3.12): D Dorian at 104 BPM, the needle motif, the i-IV vamp with the
// bVII turnaround and no vi-IV-I-V, percussion + bass + stabs, stingers, and the arrangement rules per state and hype.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BPM, CHORDS, D_DORIAN_PCS, LAYERS, LAYER_LOOPS, MOTIF, PROGRESSION, SECONDS_PER_STEP, STINGERS, TITLE_MOTIF_BAR,
  layerMix, midiToHz, stingerLengthS,
} from "../src/game/audio/music-score.ts";

const mix = () => ({ low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 0, lobby: 0 });
const instruments = (layer) => new Set(LAYER_LOOPS[layer].flat().map((n) => n.instrument));

describe("music score", () => {
  test("104 BPM, sixteenth grid, A4 = 440 Hz", () => {
    assert.equal(BPM, 104);
    assert.ok(Math.abs(SECONDS_PER_STEP - 60 / 104 / 4) < 1e-12);
    assert.equal(midiToHz(69), 440);
    assert.ok(Math.abs(midiToHz(62) - 293.66) < 0.01);
  });

  test("the needle motif is D F G A B A with the raised Dorian sixth", () => {
    assert.deepEqual(MOTIF.map((n) => n.midi % 12), [2, 5, 7, 9, 11, 9]);
    assert.deepEqual(TITLE_MOTIF_BAR.map((n) => n.midi % 12), [2, 5, 7, 9, 11, 9]);
  });

  test("harmony: Dm7 - G7 vamp with a Cmaj7 turnaround every 8 bars; no vi-IV-I-V anywhere", () => {
    assert.deepEqual([...new Set(PROGRESSION)].sort(), ["Cmaj7", "Dm7", "G7"]);
    assert.equal(PROGRESSION[7], "Cmaj7");
    assert.equal(PROGRESSION.length, 8);
    // vi-IV-I-V in D would be Bm G D A; in any key it is a minor chord followed by major chords a 3rd down, 4th up, 5th up.
    const roots = PROGRESSION.map((c) => CHORDS[c].root % 12);
    for (let i = 0; i + 3 < roots.length; i++) {
      const seq = [roots[i], roots[i + 1], roots[i + 2], roots[i + 3]].map((r) => (r - roots[i] + 12) % 12);
      assert.notDeepEqual(seq, [0, 8, 3, 10], "vi-IV-I-V shape");
    }
  });

  test("every pitched note of the loops stays in D Dorian", () => {
    for (const layer of LAYERS) {
      for (const bar of LAYER_LOOPS[layer]) {
        for (const n of bar) {
          if (n.midi === 0) continue;
          assert.ok(D_DORIAN_PCS.includes(n.midi % 12), `${layer} ${n.instrument} midi ${n.midi}`);
        }
      }
    }
  });

  test("the bed has percussion, bass, and stabs; high adds the motif, open hats, and a fill; sudden death is kick, pedal, beat-4 stabs", () => {
    const low = instruments("low");
    for (const i of ["kick", "rim", "hat_closed", "bass"]) assert.ok(low.has(i), `low has ${i}`);
    const mid = instruments("mid");
    assert.ok(mid.has("snare") && mid.has("clav_stab"));
    const high = instruments("high");
    for (const i of ["clav_lead", "hat_open", "tom_hi", "tom_lo"]) assert.ok(high.has(i), `high has ${i}`);
    const sd = LAYER_LOOPS.sudden_death[0];
    assert.deepEqual(sd.filter((n) => n.instrument === "kick").map((n) => n.step), [0, 4, 8, 12]);
    assert.ok(sd.filter((n) => n.instrument === "bass").every((n) => n.midi === 38));
    assert.ok(sd.filter((n) => n.instrument === "clav_stab").every((n) => n.step === 12));
    const finalLeads = LAYER_LOOPS.final_round.flat().filter((n) => n.instrument === "clav_lead").map((n) => n.midi);
    assert.ok(finalLeads.includes(74) && finalLeads.includes(86), "final round doubles the motif an octave up");
  });

  test("arrangement: mid fades in over hype 0.35-0.45, high over 0.70-0.80; the final round forces mid and swaps high", () => {
    const f = { finalRound: false, suddenDeath: false };
    assert.equal(layerMix("match", 0.2, f, mix()).mid, 0);
    assert.equal(layerMix("match", 0.5, f, mix()).mid, 1);
    const m = layerMix("match", 0.75, f, mix());
    assert.ok(m.high > 0.4 && m.high < 0.6);
    assert.equal(layerMix("match", 0.9, f, mix()).high, 1);
    const fr = layerMix("match", 0.1, { finalRound: true, suddenDeath: false }, mix());
    assert.equal(fr.mid, 1);
    assert.equal(fr.high, 0);
    assert.ok(fr.final_round > 0);
    const sd = layerMix("match", 0.9, { finalRound: true, suddenDeath: true }, mix());
    assert.deepEqual(sd, { low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 1, lobby: 0 });
    assert.equal(layerMix("between_rounds", 1, f, mix()).low, 0.5, "-6 dB");
    assert.deepEqual(layerMix("lobby", 1, f, mix()), { low: 0, mid: 0, high: 0, final_round: 0, sudden_death: 0, lobby: 1 });
    const title = layerMix("title", 0, f, mix());
    assert.ok(title.low === 1 && title.mid === 1);
  });

  test("stingers: ENGAGE hit, victory resolves to D major in 3.0 s, defeat stops on A with the bass falling to C", () => {
    assert.ok(STINGERS.engage.some((n) => n.instrument === "crash") && STINGERS.engage.some((n) => n.instrument === "snare"));
    assert.ok(Math.abs(stingerLengthS("victory") - 3.0) < 1e-9);
    assert.ok(Math.abs(stingerLengthS("defeat") - 3.0) < 1e-9);
    const victoryPcs = new Set(STINGERS.victory.filter((n) => n.instrument === "clav_pad").map((n) => n.midi % 12));
    assert.ok(victoryPcs.has(6), "Picardy F sharp");
    const defeatLead = STINGERS.defeat.filter((n) => n.instrument === "clav_lead").map((n) => n.midi % 12);
    assert.deepEqual(defeatLead, [2, 5, 7, 9], "first four notes, stopping on A");
    const bass = STINGERS.defeat.filter((n) => n.instrument === "bass").sort((a, b) => a.atS - b.atS);
    assert.equal(bass[bass.length - 1].midi % 12, 0, "bass falls to C");
    assert.ok(STINGERS.final_round.length > 0 && STINGERS.sudden_death.every((n) => ["kick", "snare", "tom_lo", "crash", "riser"].includes(n.instrument)), "sudden death cue is percussion and its riser only");
    assert.ok(STINGERS.sudden_death.some((n) => n.instrument === "riser"), "7: the sudden-death riser");
    // 7 D: momentum stabs up a fourth (D -> G) on the player's streak, down a fourth (D -> A) when it breaks.
    const up = STINGERS.momentum_up.filter((n) => n.instrument === "clav_stab").map((n) => n.midi % 12);
    const down = STINGERS.momentum_down.filter((n) => n.instrument === "clav_stab").map((n) => n.midi % 12);
    assert.deepEqual([up[0], up[up.length - 1]], [2, 7]);
    assert.deepEqual([down[0], down[down.length - 1]], [2, 9]);
    // 7 A: three muted kicks at eighth notes, 0.87 s at 104 BPM.
    const kicks = STINGERS.count_in.filter((n) => n.instrument === "kick").map((n) => n.atS);
    assert.equal(kicks.length, 3);
    assert.ok(Math.abs((kicks[1] - kicks[0]) - 60 / 104 / 2) < 1e-9, "eighth notes");
    assert.ok(Math.abs(kicks[2] + 60 / 104 / 2 - 0.865) < 0.01, "the third lands with the slam at 0.87 s");
  });
});
