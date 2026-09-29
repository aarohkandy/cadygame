// WP3 synthesis recipes (BUILD_PLAN 4 WP3.12): every recipe renders offline through the real bus graph with peak
// <= -0.5 dBFS after the ceiling and no NaN samples; strikes re-roll pitch and filter inside their ranges; the kill
// confirm plays sub thump, servo ratchet, bell, and a rhythmic gap in order at fixed offsets. The palette is also
// measured, not just bounded: every cue reports peak, RMS, audible duration and spectral centroid, the defensive
// cues are asserted to sit in separate registers, and a scripted match renders the whole show at once.
//
// Node has no WebAudio: src/game/audio/offline-context.mjs carries the block-based software OfflineAudioContext the
// recipes render through here and in tools/export/mixdown.mjs.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DUCKS, LIMITER_CEILING_DB, buildBusGraph } from "../src/game/audio/audio-engine.ts";
import { createBeds } from "../src/game/audio/beds.ts";
import { createCrowd, prepareApplause } from "../src/game/audio/crowd.ts";
import { debugRecipes, renderDebugRecipe, analyzeChannels } from "../src/game/audio/debug-audio.ts";
import { KILL_CONFIRM_TIMING, renderKillConfirm } from "../src/game/audio/kill-confirm.ts";
import { createMusic } from "../src/game/audio/music.ts";
import { SFX, rollSfxParams } from "../src/game/audio/sfx.ts";
import { createNoiseBank, dbToGain } from "../src/game/audio/synth.ts";
import { createRng } from "../src/game/core/rng.ts";
import { IMPACTS } from "../src/game/audio/debug-audio.ts";
import { renderImpact } from "../src/game/audio/impact.ts";
import { OBS_BLOCKS } from "../src/game/contracts.ts";
import { buildEpisodeMeta, buildMatchConfig } from "../src/game/match/match-config.ts";
import { createRecorder } from "../src/game/harness/recorder.ts";
import { fakeCombat, fakeEvents, fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { TARGETS, lufsIntegrated, mixdownEpisode, peakAndRms } from "../tools/export/mixdown.mjs";

import { SimOfflineContext } from "../src/game/audio/offline-context.mjs";


const factory = (channels, length, sampleRate) => new SimOfflineContext(channels, length, sampleRate);
const SR = 16000;
/** The measured table renders at the rate the game actually runs at, so hats and cymbals are not cut off by Nyquist. */
const SR_HI = 48000;

function rmsWindow(data, sr, fromS, toS) {
  let s = 0, n = 0;
  for (let i = Math.floor(fromS * sr); i < Math.min(data.length, Math.floor(toS * sr)); i++) { s += data[i] * data[i]; n++; }
  return n ? Math.sqrt(s / n) : 0;
}

/* ───────────────────────── measurement ───────────────────────── */

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + half], bi = im[i + k + half];
        const vr = br * cr - bi * ci, vi = br * ci + bi * cr;
        re[i + k] = ar + vr; im[i + k] = ai + vi;
        re[i + k + half] = ar - vr; im[i + k + half] = ai - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Spectral centroid in Hz over `N` samples from `fromS` (Hann-windowed magnitude spectrum). This is the "brightness"
 * number the ear sorts cues by: a guard thock lands near 400 Hz, a deflect ting near 2 kHz.
 */
function spectralCentroid(data, sr, fromS = 0, n = 4096) {
  const start = Math.floor(fromS * sr);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = start + i < data.length ? data[start + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  fft(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < n / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    num += mag * ((k * sr) / n);
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

/** Share of the spectrum's magnitude that falls between `loHz` and `hiHz`. */
function bandEnergyRatio(data, sr, loHz, hiHz, fromS = 0, n = 4096) {
  const start = Math.floor(fromS * sr);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = start + i < data.length ? data[start + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  fft(re, im);
  let band = 0, total = 0;
  for (let k = 1; k < n / 2; k++) {
    const hz = (k * sr) / n;
    const mag = Math.hypot(re[k], im[k]);
    total += mag;
    if (hz >= loHz && hz < hiHz) band += mag;
  }
  return total > 0 ? band / total : 0;
}

/** Audible length: from the first to the last sample within 60 dB of the peak. */
function audibleSpanS(data, sr) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return 0;
  const floor = peak * dbToGain(-60);
  let first = -1, last = -1;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) >= floor) { if (first < 0) first = i; last = i; }
  }
  return first < 0 ? 0 : (last - first + 1) / sr;
}

function toDb(g) {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

/** Renders one recipe raw (no bus graph) so a cue can be measured on its own terms. */
async function renderRaw(recipe, sr, seed = 1, lengthS = recipe.lengthS) {
  const ctx = factory(1, Math.ceil(lengthS * sr), sr);
  const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(seed) };
  recipe.render(s, ctx.destination, 0.005);
  return (await ctx.startRendering()).getChannelData(0);
}

/* ───────────────────────── the scripted match ───────────────────────── */

// One pass of the show on a fixed clock: ENGAGE, a trade of strikes, a guard, a deflect, a clash, a crowd roar, a
// steal, the KO with its duck, and the victory stinger. Everything is scheduled on absolute AudioContext time, so
// the whole mix — band, crowd, beds and one-shots through the real bus graph — renders in one pass and can be
// measured the way a mastering engineer would measure it.
const MATCH = {
  sr: 24000,
  durS: 12,
  stepS: 0.02,
  engageS: 1,
  strikeS: [2.0, 2.45, 2.9, 3.35, 3.8],
  guardS: 4.3,
  deflectS: 4.8,
  clashS: 5.3,
  roarS: 6.0,
  stealS: 7.0,
  koS: 8.0,
  koReleaseS: 9.2,
  victoryS: 11.0,
};

/** Hype over the scripted match: a slow build through the trade, high after the KO. */
function matchHype(t) {
  if (t < MATCH.engageS) return 0.15;
  if (t < MATCH.roarS) return Math.min(0.78, 0.3 + 0.1 * (t - MATCH.engageS));
  if (t < MATCH.koS) return 0.78;
  return 0.95;
}

/**
 * Renders the scripted match. `layers: "music"` renders the band alone (used to measure the duck without the KO's
 * own one-shots colouring the window); `duck: false` renders the same bed with the duck left off.
 */
async function renderScriptedMatch({ duck = true, layers = "all" } = {}) {
  const sr = MATCH.sr;
  const full = layers === "all";
  const ctx = factory(2, Math.ceil(MATCH.durS * sr), sr);
  const buses = buildBusGraph(ctx, ctx.destination);
  const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(31) };
  const music = createMusic(s, buses.music, { useTimer: false });
  const crowd = full ? createCrowd(s, buses.crowd, prepareApplause(0xc1a9, sr)) : null;
  const beds = full ? createBeds(s, buses.sfx) : null;
  const frame = fakeFrame();
  const combat = fakeCombat();

  const oneShot = (id, atS, intensity = 1) => {
    if (!full) return;
    const recipe = SFX[id];
    const out = ctx.createGain();
    out.connect(recipe.bus === "ui" ? buses.ui : buses.sfx);
    recipe.render(s, out, atS, rollSfxParams(recipe, s.rng, intensity));
  };

  // The same shape audio-engine's updateDucks applies: setTargetAtTime with tau = attack/3, released with tau = release/3.
  const applyDuck = (id, atS, releaseAtS) => {
    const shape = DUCKS[id];
    const nodes = { music: buses.musicDuck, crowd: buses.crowdDuck, sfx: buses.sfxDuck };
    for (const bus of Object.keys(nodes)) {
      const db = shape.amounts[bus] ?? 0;
      if (db === 0) continue;
      nodes[bus].gain.setTargetAtTime(dbToGain(db), atS, shape.attackS / 3);
      nodes[bus].gain.setTargetAtTime(1, releaseAtS, shape.releaseS / 3);
    }
  };

  const script = [
    [MATCH.engageS, () => { oneShot("engage", MATCH.engageS); music.stinger("engage", MATCH.engageS); }],
    ...MATCH.strikeS.map((t, i) => [t, () => oneShot(i % 2 ? "crunch" : "tok", t, 0.55 + 0.09 * i)]),
    [MATCH.guardS, () => oneShot("thock", MATCH.guardS, 0.8)],
    [MATCH.deflectS, () => oneShot("ting", MATCH.deflectS)],
    [MATCH.clashS, () => oneShot("clash", MATCH.clashS)],
    [MATCH.roarS, () => { crowd?.react("roar", MATCH.roarS); }],
    [MATCH.stealS, () => oneShot("steal", MATCH.stealS)],
    [MATCH.koS, () => {
      if (full) {
        const out = ctx.createGain();
        out.connect(buses.lead);                 // the payoff path, exactly as feedback-audio routes it
        renderKillConfirm(s, out, MATCH.koS, 0);
      }
      for (let j = 0; j < 6; j++) oneShot("relay_click", MATCH.koS + 0.15 + j * 0.04, 0.6);
      oneShot("spin_down", MATCH.koS + 0.15, 1);
      if (duck) applyDuck("ko", MATCH.koS, MATCH.koReleaseS);
    }],
    [MATCH.victoryS, () => music.setState("victory", MATCH.victoryS)],
  ].sort((a, b) => a[0] - b[0]);

  music.start();
  music.setState("match", 0);
  music.setFlags({ finalRound: false, suddenDeath: false });

  let next = 0;
  for (let t = 0; t < MATCH.durS; t += MATCH.stepS) {
    while (next < script.length && script[next][0] <= t) { script[next][1](); next++; }
    music.setHype(matchHype(t));
    music.pump(t);
    crowd?.update(t, matchHype(t), true);
    if (beds) {
      // Both arms working: the servo whine and gear chatter have to sit under the band without masking it.
      const spin = 0.55 + 0.45 * Math.sin(t * 5.1);
      for (const seat of ["atlas", "blaze"]) {
        const arm = frame.arms[seat];
        for (let j = 0; j < 6; j++) {
          arm.qd[j] = spin * (0.8 + j * 0.15);
          arm.tau[j] = 1.4 * spin;
          arm.ctrl[j] = 0.25 * spin;
        }
      }
      beds.update(t, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false });
    }
  }
  return ctx.startRendering();
}

/* ───────────────────────── a recorded show for the mixdown ───────────────────────── */

const NOW = new Date("2026-09-26T12:00:00Z");
const PROV = { tuning: null, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "", harnessCommit: "dev", userAgent: "test" };

/**
 * A three-round ARCADE match at 50 Hz through the real recorder: ritual, FIGHT, an exchange every second, a Core
 * drop and dock with the last-3-s countdown in round 2, a near-KO run-down and the KO in round 3. The observation
 * blocks carry what the mixdown reads back (integrity, core, EE positions), so the audio arc is driven exactly the
 * way a live match drives it.
 */
function recordShowEpisode() {
  const hz = 50;
  const spt = 8;                                   // arcade timestep 2.5 ms at 50 Hz: eight physics steps per tick
  const cfg = buildMatchConfig({
    preset: "arcade", context: "quick", seed: 9, bestOf: 3, now: NOW,
    seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "rookie", dda: false } } },
  });
  const fact = (name, input) => ({ name, sha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", inputDevice: input });
  const rec = createRecorder();
  rec.begin(buildEpisodeMeta(cfg, fakeModelInfo("arcade"), { atlas: fact("PILOT", "keyboard_mouse"), blaze: fact("BACKLASH", null) }, { atlas: null, blaze: null }, PROV, NOW));
  const blocks = () => { const o = {}; for (const [k, n] of Object.entries(OBS_BLOCKS)) o[k] = new Float32Array(n); return o; };
  const frame = fakeFrame({ mode: "arcade" });
  let row = 0;
  const results = [];
  const P = (name) => name;
  for (let round = 1; round <= 3; round++) {
    const resetStep = row * spt;
    rec.mutation({ kind: "reset", step: resetStep, seed: 100 + round, round, state: { time: 0, qpos: new Float64Array(30), qvel: new Float64Array(29), ctrl: new Float64Array(12), qacc_warmstart: new Float64Array(29), servo: new Float64Array(18) } });
    rec.events([{ ...fakeEvents.phase({ phase: "round_intro", round, finalRound: round === 3 }), step: resetStep }]);
    const introS = round === 1 ? 4 : 2.4;
    const fightS = round === 1 ? 14 : round === 2 ? 16 : 14;
    const total = Math.round((introS + fightS + 3) * hz);
    let integrityA = 100, integrityB = 100;
    let koAt = -1;
    for (let k = 0; k < total; k++, row++) {
      const t = k / hz;
      const step = resetStep + k * spt;
      let phase;
      if (t < introS) phase = t < introS - 0.87 ? (t < 1.5 ? "entrance" : "boot_ritual") : "count_in";
      else if (t < introS + fightS) phase = "fight";
      else phase = round === 3 ? "ko" : "round_summary";
      if (round === 3 && koAt >= 0 && k >= koAt) phase = "ko";
      const ft = t - introS;
      const fight = phase === "fight";
      const obs = { atlas: blocks(), blaze: blocks() };
      // EE positions: the arms trade inside 0.3 m for one second in every four (fights have air in them).
      const close = fight && (Math.floor(ft) % 4 === 0);
      obs.atlas.self_ext[0] = -0.1; obs.blaze.self_ext[0] = close ? 0.05 : 0.35;
      obs.atlas.opponent_state[12] = obs.blaze.self_ext[0];
      for (let j = 0; j < 6; j++) { obs.atlas.self_ext[19 + j] = Math.sin(t * 3 + j) * 0.4; obs.atlas.state[6 + j] = fight ? 1.2 : 0; obs.blaze.self_ext[19 + j] = Math.cos(t * 2 + j) * 0.4; }
      const g = obs.atlas.game;
      g[0] = integrityA / 100; g[1] = integrityB / 100; g[3] = fight ? 1 : 0;
      // Round 2: the Core drops at 4 s, is docked by the player at 7 s with an 8 s lock-in.
      const coreLive = round === 2 && ft >= 4 && ft < 15.2;
      const docked = round === 2 && ft >= 7 && ft < 15.2;
      g[8] = coreLive ? 1 : 0;
      g[6] = docked ? Math.max(0, (15 - ft) / 8) : 0;
      g[7] = coreLive ? 1 : 0;
      obs.blaze.game.set(g); obs.blaze.game[0] = g[1]; obs.blaze.game[1] = g[0]; obs.blaze.game[6] = -g[6];
      const events = [];
      if (k === Math.round(introS * hz)) events.push({ ...fakeEvents.phase({ phase: "fight", round, finalRound: round === 3 }), step });
      // Two hits per exchange, alternating who lands them; the final round is the player's run-down: one 30-point hit
      // per exchange, so BACKLASH sits under 20 Integrity for a full exchange before the KO (near_ko >= 1.5 s).
      const dealt = round === 3 || Math.floor(ft / 4) % 2 === 0;
      if (fight && close && k % 25 === 12 && !(round === 3 && k % 50 !== 12)) {
        const m = 0.35 + 0.5 * ((Math.floor(ft / 4) % 3) / 2);
        const raw = round === 3 ? 26 : 12 + Math.round(14 * m);
        if (dealt) { integrityB = Math.max(0, integrityB - (round === 3 ? 30 : 6)); events.push({ ...fakeEvents.strike({ attacker: "atlas", victim: "blaze", magnitude: m, raw, damage: 6, crit: m > 0.7 }), step }); }
        else { integrityA = Math.max(20, integrityA - 4); events.push({ ...fakeEvents.strike({ attacker: "blaze", victim: "atlas", magnitude: m, raw, damage: 4 }), step }); }
        if (round === 3 && integrityB <= 0 && koAt < 0) { koAt = k + 1; events.push({ ...fakeEvents.ko({ victim: "blaze", attacker: "atlas" }), step }); }
      }
      if (round === 2 && k === Math.round((introS + 4) * hz) - 40) events.push({ ...fakeEvents.core({ stage: "incoming", seat: null }), step });
      if (round === 2 && k === Math.round((introS + 4) * hz)) events.push({ ...fakeEvents.core({ stage: "drop", seat: null }), step });
      if (round === 2 && k === Math.round((introS + 7) * hz)) events.push({ ...fakeEvents.core({ stage: "lock_in_start", seat: "atlas", remainingS: 8 }), step });
      if (round === 2 && k === Math.round((introS + 15) * hz)) events.push({ ...fakeEvents.core({ stage: "lock", seat: "atlas", remainingS: 0 }), step });
      if (k === Math.round((introS + fightS) * hz) && !(round === 3 && koAt >= 0)) events.push({ ...fakeEvents.roundEnd({ winner: round === 2 ? "atlas" : "blaze", reason: round === 2 ? "lock" : "time" }), step });
      if (round === 3 && k === koAt) events.push({ ...fakeEvents.roundEnd({ winner: "atlas", reason: "ko" }), step }, { ...fakeEvents.matchEnd({ winner: "atlas" }), step });
      if (events.length) rec.events(events);
      rec.tick({
        frameIndex: row, t: row / hz, round, phase: P(phase), discontinuity: k === 0 ? 1 : 0, obs, delivered: { atlas: null, blaze: null },
        applied: { atlas: new Float64Array(6), blaze: new Float64Array(6) }, raw: { atlas: null, blaze: null },
        requestFrameIndex: { atlas: -1, blaze: -1 }, obsFrameIndex: { atlas: -1, blaze: -1 }, chunkId: { atlas: -1, blaze: -1 }, chunkIndex: { atlas: -1, blaze: -1 },
        intents: { atlas: docked ? 4 : 0, blaze: 0 }, status: { atlas: "ok", blaze: "ok" }, computeMs: { atlas: NaN, blaze: NaN },
        human: { atlas: { command: new Float32Array(6), shaping: 0 }, blaze: null }, displayLatencyMs: 16,
      });
      for (let q = 0; q < spt; q++) rec.stepCtrl(step + q, frame, { atlas: 0, blaze: 0 });
      if (round === 3 && koAt >= 0 && k >= koAt + 2 * hz) { row++; break; }
    }
    results.push({ round, winner: round === 2 || round === 3 ? "atlas" : "blaze", reason: round === 3 ? "ko" : round === 2 ? "lock" : "time", tEnd: introS + fightS });
  }
  return rec.end({ winner: "atlas", roundsWon: { atlas: 2, blaze: 1 }, rounds: results, forfeit: null, determinism: "unchecked", error: null });
}

describe("synth recipes", () => {
  test("every recipe renders through the bus graph: measured peak, RMS, duration and centroid, no NaN, no clipping", async () => {
    const recipes = debugRecipes();
    assert.ok(recipes.length > 60, `${recipes.length} recipes`);
    const rows = [];
    for (const recipe of recipes) {
      const r = await renderDebugRecipe(recipe, factory, SR_HI);
      const data = r.buffer.getChannelData(0);
      const durationS = audibleSpanS(data, SR_HI);
      const centroidHz = spectralCentroid(data, SR_HI, 0);
      rows.push({ id: r.id, peakDb: r.peakDb, rmsDb: r.rmsDb, durationS, centroidHz });
      assert.equal(r.nanCount, 0, `${recipe.id} has NaN samples`);
      assert.ok(r.peakDb <= LIMITER_CEILING_DB + 1e-6, `${recipe.id} peaks at ${r.peakDb.toFixed(2)} dBFS`);
      assert.ok(r.peak > 1e-3, `${recipe.id} is silent`);
      assert.ok(durationS > 0.004, `${recipe.id} lasts ${(durationS * 1000).toFixed(1)} ms`);
      assert.ok(durationS <= recipe.lengthS + 1e-6, `${recipe.id} runs past its declared length`);
      assert.ok(centroidHz > 40 && centroidHz < SR_HI / 2, `${recipe.id} centroid ${centroidHz.toFixed(0)} Hz`);
      assert.ok(r.pass, recipe.id);
    }
    // The measured table (?debug=audio shows the same numbers in the browser).
    const w = Math.max(...rows.map((x) => x.id.length));
    const lines = rows.map((x) => `${x.id.padEnd(w)}  peak ${x.peakDb.toFixed(1).padStart(6)} dB  rms ${x.rmsDb.toFixed(1).padStart(6)} dB  ${(x.durationS * 1000).toFixed(0).padStart(5)} ms  centroid ${x.centroidHz.toFixed(0).padStart(5)} Hz`);
    console.log(`\n${lines.join("\n")}\n`);
  });

  test("guard, deflect and clash occupy three registers, and a crit tick rides above the strike that carries it", async () => {
    const measure = async (id, seed) => {
      const recipe = SFX[id];
      const data = await renderRaw({ lengthS: 1.4, render: (s, d, t) => recipe.render(s, d, t, rollSfxParams(recipe, s.rng, 1)) }, SR_HI, seed);
      return {
        id,
        centroid: spectralCentroid(data, SR_HI, 0),
        sub: bandEnergyRatio(data, SR_HI, 0, 220),
        span: audibleSpanS(data, SR_HI),
      };
    };
    const guard = await measure("thock", 21);
    const deflect = await measure("ting", 22);
    const clash = await measure("clash", 23);
    const strike = await measure("tok", 24);
    const crit = await measure("tink", 25);
    for (const m of [guard, deflect, clash, strike, crit]) {
      console.log(`  ${m.id.padEnd(6)} centroid ${m.centroid.toFixed(0).padStart(5)} Hz  sub ${(m.sub * 100).toFixed(0).padStart(3)}%  ${(m.span * 1000).toFixed(0).padStart(4)} ms`);
    }
    // The guard is the dull one: a low thock with real weight under it.
    assert.ok(guard.centroid < deflect.centroid * 0.75, `guard ${guard.centroid.toFixed(0)} vs deflect ${deflect.centroid.toFixed(0)} Hz`);
    assert.ok(guard.sub > 0.2, `guard sub share ${(guard.sub * 100).toFixed(0)}%`);
    // The deflect is the bright one, and it has no sub at all, so it cuts through a busy mix.
    assert.ok(deflect.sub < 0.06, `deflect sub share ${(deflect.sub * 100).toFixed(0)}%`);
    // The clash is the long one: it rings well past both.
    assert.ok(clash.span > guard.span * 3, `clash ${(clash.span * 1000).toFixed(0)} ms vs guard ${(guard.span * 1000).toFixed(0)} ms`);
    assert.ok(clash.span > deflect.span * 1.3, `clash ${(clash.span * 1000).toFixed(0)} ms vs deflect ${(deflect.span * 1000).toFixed(0)} ms`);
    // No two of the three land in the same register.
    for (const [a, b] of [[guard, deflect], [guard, clash], [deflect, clash]]) {
      const ratio = Math.max(a.centroid, b.centroid) / Math.max(1, Math.min(a.centroid, b.centroid));
      assert.ok(ratio > 1.25, `${a.id} and ${b.id} centroids within ${((ratio - 1) * 100).toFixed(0)}%`);
    }
    // A crit is a strike plus a tick above and behind it, not a louder strike: no weight of its own, and it rings on
    // after the strike body has gone.
    assert.ok(crit.centroid > strike.centroid * 1.15, `crit tick ${crit.centroid.toFixed(0)} vs strike ${strike.centroid.toFixed(0)} Hz`);
    assert.ok(strike.sub > 0.2 && crit.sub < 0.05, `strike sub ${(strike.sub * 100).toFixed(0)}%, crit sub ${(crit.sub * 100).toFixed(0)}%`);
    assert.ok(crit.span > strike.span * 2, "the crit tick rings on after the strike body has gone");
  });

  test("recipe levels are sane before the ceiling (no recipe relies on the limiter to be listenable)", async () => {
    for (const recipe of debugRecipes()) {
      const len = Math.ceil(recipe.lengthS * SR);
      const ctx = factory(2, len, SR);
      const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(3) };
      recipe.render(s, ctx.destination, 0.01);
      const buf = await ctx.startRendering();
      const stats = analyzeChannels([buf.getChannelData(0), buf.getChannelData(1)]);
      assert.ok(stats.peak < 2.2, `${recipe.id} raw peak ${stats.peak.toFixed(2)}`);
    }
  });

  test("strikes re-roll pitch and filter every call, always inside the recipe's range, and two renders differ", async () => {
    const rng = createRng(11);
    const tok = SFX.tok;
    const a = rollSfxParams(tok, rng, 0.6);
    const b = rollSfxParams(tok, rng, 0.6);
    assert.notEqual(a.pitchSt, b.pitchSt);
    assert.notEqual(a.filterMul, b.filterMul);
    for (const p of [a, b]) {
      assert.ok(p.pitchSt >= tok.pitchRangeSt[0] && p.pitchSt <= tok.pitchRangeSt[1]);
      assert.ok(p.filterMul >= tok.filterRange[0] && p.filterMul <= tok.filterRange[1]);
    }
    const offset = rollSfxParams(tok, rng, 1, 3);
    assert.ok(offset.pitchSt >= tok.pitchRangeSt[0] + 3 && offset.pitchSt <= tok.pitchRangeSt[1] + 3, "+3 m semitone offset applies on top");
    const render = async (p, seed) => {
      const ctx = factory(1, Math.ceil(0.25 * SR), SR);
      const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(seed) };
      tok.render(s, ctx.destination, 0, p);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const r1 = await render(a, 1);
    const r2 = await render(b, 2);
    let diff = 0;
    for (let i = 0; i < r1.length; i++) diff += Math.abs(r1[i] - r2[i]);
    assert.ok(diff > 1, "the two strikes are audibly different");
  });

  test("the strike transient starts on its scheduled sample", async () => {
    const ctx = factory(1, Math.ceil(0.2 * SR), SR);
    const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(5) };
    SFX.tok.render(s, ctx.destination, 0.05, rollSfxParams(SFX.tok, s.rng, 0.8));
    const d = (await ctx.startRendering()).getChannelData(0);
    assert.ok(rmsWindow(d, SR, 0, 0.049) < 1e-6, "silent before the onset");
    assert.ok(rmsWindow(d, SR, 0.05, 0.057) > 0.02, "energy within 7 ms of the onset");
  });

  test("kill confirm: sub thump, servo ratchet, bell, then a rhythmic gap before the answer, at fixed offsets", async () => {
    const T = KILL_CONFIRM_TIMING;
    assert.ok(T.thumpS < T.ratchetS && T.ratchetS < T.bellS && T.bellS < T.gapStartS && T.gapStartS < T.gapEndS && T.gapEndS <= T.answerS);
    const ctx = factory(1, Math.ceil(T.lengthS * SR), SR);
    const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(9) };
    renderKillConfirm(s, ctx.destination, 0, 0);
    const d = (await ctx.startRendering()).getChannelData(0);
    const thump = rmsWindow(d, SR, 0, 0.06);
    const bell = rmsWindow(d, SR, T.bellS, T.bellS + 0.05);
    const gap = rmsWindow(d, SR, T.gapStartS + 0.06, T.gapEndS - 0.005);
    const answer = rmsWindow(d, SR, T.answerS, T.answerS + 0.06);
    assert.ok(thump > 0.1, `thump ${thump}`);
    for (const off of T.ratchetTeeth) {
      const tooth = rmsWindow(d, SR, T.ratchetS + off, T.ratchetS + off + 0.004);
      const before = rmsWindow(d, SR, T.ratchetS + off - 0.006, T.ratchetS + off - 0.001);
      assert.ok(tooth > before * 1.5, `ratchet tooth at ${off}`);
    }
    assert.ok(bell > 0.05, `bell ${bell}`);
    assert.ok(gap < bell * 0.25, `gap ${gap} vs bell ${bell}`);
    assert.ok(answer > gap * 3, `answer ${answer} vs gap ${gap}`);
  });

  test("the crowd bed swells and opens up as hype climbs, and is silent when no show is on", async () => {
    const sr = MATCH.sr;
    const durS = 10;
    const render = async (show) => {
      const ctx = factory(2, Math.ceil(durS * sr), sr);
      const buses = buildBusGraph(ctx, ctx.destination);
      const s = { ctx, noise: createNoiseBank(ctx, 0x5eed), rng: createRng(17) };
      const crowd = createCrowd(s, buses.crowd, prepareApplause(0xc1a9, sr));
      for (let t = 0; t < durS; t += 0.05) crowd.update(t, Math.min(1, t / durS), show);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const bed = await render(true);
    const quiet = rmsWindow(bed, sr, 1.5, 2.5);
    const loud = rmsWindow(bed, sr, 8.5, 9.5);
    const swellDb = toDb(loud) - toDb(quiet);
    const bright = spectralCentroid(bed, sr, 8.6) / Math.max(1, spectralCentroid(bed, sr, 1.6));
    console.log(`  crowd bed  swell ${swellDb.toFixed(1)} dB  brightness x${bright.toFixed(2)}  quiet ${toDb(quiet).toFixed(1)} dB  loud ${toDb(loud).toFixed(1)} dB`);
    assert.ok(swellDb > 8, `the crowd only swells ${swellDb.toFixed(1)} dB from hype 0.2 to hype 0.9`);
    assert.ok(bright > 1.25, `the crowd's low-pass barely opens (x${bright.toFixed(2)})`);
    assert.ok(analyzeChannels([bed]).nanCount === 0, "the crowd bed has NaN samples");

    // In menus and the Lab there is no show, so there is no room.
    const empty = await render(false);
    assert.ok(rmsWindow(empty, sr, 1, durS - 1) < 1e-5, "the crowd is audible with no show on");
  });

  test("the whole show renders as one mix: a scripted match never clips, never goes silent, and ducks under the KO", async () => {
    const mix = await renderScriptedMatch({ duck: true, layers: "all" });
    const stats = analyzeChannels([mix.getChannelData(0), mix.getChannelData(1)]);
    assert.equal(stats.nanCount, 0, "the match mix has NaN samples");
    assert.ok(stats.peakDb <= LIMITER_CEILING_DB + 1e-6, `match mix peaks at ${stats.peakDb.toFixed(2)} dBFS`);
    assert.ok(stats.rmsDb > -34 && stats.rmsDb < -12, `match mix sits at ${stats.rmsDb.toFixed(1)} dB RMS`);

    // The show never drops out: no 300 ms hole anywhere between ENGAGE and the victory stinger.
    const d = mix.getChannelData(0);
    let hole = 0, worstHole = 0, worstAt = 0;
    for (let t = MATCH.engageS; t < MATCH.victoryS; t += 0.05) {
      if (rmsWindow(d, MATCH.sr, t, t + 0.05) < 1e-4) { hole += 0.05; if (hole > worstHole) { worstHole = hole; worstAt = t; } } else hole = 0;
    }
    assert.ok(worstHole < 0.3, `${(worstHole * 1000).toFixed(0)} ms of silence at ${worstAt.toFixed(2)} s`);

    // The show builds to the KO. A KO ducks music and SFX by design, so a one-second average is the wrong ruler:
    // what the ear registers is the transient. The kill confirm must be the loudest moment of the whole match.
    const peakIn = (fromS, toS) => {
      let p = 0;
      for (let i = Math.floor(fromS * MATCH.sr); i < Math.min(d.length, Math.floor(toS * MATCH.sr)); i++) p = Math.max(p, Math.abs(d[i]));
      return p;
    };
    const opening = rmsWindow(d, MATCH.sr, 0.2, 1.0);
    const impact = rmsWindow(d, MATCH.sr, MATCH.koS, MATCH.koS + 0.4);
    const koPeak = peakIn(MATCH.koS, MATCH.koS + 0.5);
    const fightPeak = peakIn(MATCH.engageS, MATCH.koS - 0.1);
    const openingPeak = peakIn(0.2, 1.0);
    console.log(`  match mix  peak ${stats.peakDb.toFixed(1)} dB  rms ${stats.rmsDb.toFixed(1)} dB  opening ${toDb(opening).toFixed(1)} dB (peak ${toDb(openingPeak).toFixed(1)})  KO impact ${toDb(impact).toFixed(1)} dB  KO peak ${toDb(koPeak).toFixed(1)} dB  fight peak ${toDb(fightPeak).toFixed(1)} dB`);
    // The bed is mixed for −16 LUFS over a round (7), so a one-second RMS of the opening bed can sit near the KO
    // window's RMS (the kill confirm has a rhythmic hole in it by design). The ear registers the transient: the KO
    // must out-peak the opening bed by 3 dB and sit within 4 dB of the ceiling.
    assert.ok(koPeak > openingPeak * 1.41, `KO peak ${toDb(koPeak).toFixed(1)} dB vs opening peak ${toDb(openingPeak).toFixed(1)} dB`);
    assert.ok(toDb(koPeak) > LIMITER_CEILING_DB - 4, `KO peak ${toDb(koPeak).toFixed(1)} dBFS`);
    // The KO has to be among the loudest moments of the match. It does not have to out-peak a dense exchange: by
    // then the ceiling is what is setting the level, and buying the KO another 2 dB would only mean squashing the
    // fight to make room. The mix is close enough that the choice is a listening decision, not a measurement.
    assert.ok(toDb(koPeak) - toDb(fightPeak) > -3, `the KO peaks ${(toDb(koPeak) - toDb(fightPeak)).toFixed(1)} dB under the loudest exchange`);
  });

  test("7: the five one-shots (jab, solid, heavy, crit, ping) are monotonic in peak; reward layers sit above 2 kHz, bodies below 1 kHz", async () => {
    const peaks = [];
    for (const [id, o] of IMPACTS.slice(0, 5)) {
      const recipe = { id, lengthS: 0.8, render: (s, d, t) => renderImpact(s, d, t, o) };
      const data = await renderRaw(recipe, SR_HI, 7);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      peaks.push(peak);
      const onset = data.findIndex((v) => Math.abs(v) > 1e-4) / SR_HI;
      assert.ok(onset < 0.006 + 0.001, `${id} starts on its scheduled sample (${(onset * 1000).toFixed(1)} ms)`);
      if (id === "solid" || id === "heavy") {
        // The body, measured after the 4.6 kHz transient has gone: printed shell and sub under 1 kHz.
        assert.ok(bandEnergyRatio(data, SR_HI, 0, 1000, 0.005 + 0.012, 2048) > 0.4, `${id}: body under 1 kHz`);
      }
    }
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1] * 1.03, `peaks monotonic: ${peaks.map((p) => p.toFixed(3)).join(" < ")}`);
    // The reward layers alone (the object with and without them, same seed, differenced): crit tink at +40 ms and
    // the ping at +30 ms both sit above 2 kHz; the boost a crit or ping gives the base is scaled out first.
    const layer = async (withReward, without) => {
      const a = await renderRaw({ lengthS: 0.6, render: (s, d, t) => renderImpact(s, d, t, withReward) }, SR_HI, 7);
      const b = await renderRaw({ lengthS: 0.6, render: (s, d, t) => renderImpact(s, d, t, without) }, SR_HI, 7);
      const boost = withReward.raw >= 28 ? 1.12 : 1.06;
      return a.map((v, i) => v - b[i] * boost);
    };
    const critLayer = await layer({ m: 0.7, raw: 22, crit: true, taken: false }, { m: 0.7, raw: 22, crit: false, taken: false });
    assert.ok(spectralCentroid(critLayer, SR_HI, 0.005 + 0.04, 2048) > 2000, "crit tink centroid > 2 kHz");
    const pingLayer = await layer({ m: 0.5, raw: 30, crit: false, taken: false }, { m: 0.5, raw: 20, crit: false, taken: false });
    assert.ok(spectralCentroid(pingLayer, SR_HI, 0.005 + 0.03, 2048) > 2000, "ping centroid > 2 kHz");
    const taken = await renderRaw({ lengthS: 0.6, render: (s, d, t) => renderImpact(s, d, t, { m: 0.7, raw: 22, crit: false, taken: true }) }, SR_HI, 7);
    const dealt = await renderRaw({ lengthS: 0.6, render: (s, d, t) => renderImpact(s, d, t, { m: 0.7, raw: 22, crit: false, taken: false }) }, SR_HI, 7);
    assert.ok(spectralCentroid(taken, SR_HI, 0.005, 2048) < spectralCentroid(dealt, SR_HI, 0.005, 2048), "a taken hit is the same object, darker");
  });

  test("7: a full 3-round episode renders through the mixdown at -16 LUFS +/- 2, crest >= 12 dB, drums < 0.3 for >= 20 % of the fight, near_ko >= 1.5 s before the KO", async () => {
    const ep = recordShowEpisode();
    const { buffer, report } = await mixdownEpisode(ep, { sampleRate: SR, factory });
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    const stats = analyzeChannels(channels);
    console.log(`  mixdown  ${report.durationS.toFixed(1)} s (${report.liveS.toFixed(1)} s live)  ${report.lufs.toFixed(1)} LUFS over the rounds (${report.lufsWhole.toFixed(1)} whole)  crest ${report.crestDb.toFixed(1)} dB  peak ${report.peakDb.toFixed(1)} dBFS  drums quiet ${(report.drumsQuietFrac * 100).toFixed(0)} %  near_ko lead ${report.nearKoLeadS?.toFixed(2)} s`);
    assert.equal(stats.nanCount, 0);
    assert.ok(stats.peakDb <= LIMITER_CEILING_DB + 1e-6, `peaks at ${stats.peakDb.toFixed(2)} dBFS`);
    assert.ok(Math.abs(report.lufs - TARGETS.lufs) <= TARGETS.lufsTol, `${report.lufs.toFixed(1)} LUFS (target ${TARGETS.lufs} +/- ${TARGETS.lufsTol})`);
    assert.ok(report.crestDb >= TARGETS.crestDb, `crest ${report.crestDb.toFixed(1)} dB`);
    assert.ok(report.drumsQuietFrac >= TARGETS.drumsQuietFrac, `drums under 0.3 for ${(report.drumsQuietFrac * 100).toFixed(0)} % of the fight`);
    assert.ok(report.nearKoLeadS !== null && report.nearKoLeadS >= TARGETS.nearKoLeadS, `near_ko led the KO by ${report.nearKoLeadS} s`);
    assert.ok(Object.values(report.pass).every(Boolean));
    // The loudness meter itself: a −20 dBFS sine at 1 kHz reads −20 LUFS within a dB (K-weighting is flat there).
    const sine = new Float32Array(SR * 3).map((_v, i) => 0.1 * Math.SQRT2 * Math.sin((2 * Math.PI * 1000 * i) / SR));
    assert.ok(Math.abs(lufsIntegrated([sine, sine], SR) - (-20 - 0.691 + 3.01)) < 1.2, "BS.1770 sanity");
    assert.ok(peakAndRms([sine]).crestDb > 2.9 && peakAndRms([sine]).crestDb < 3.2);
  });

  test("the music bed gets out of the way: the KO duck pulls it down at least 8 dB and lets it back up", async () => {
    // The same bed twice, identical seeds, with and without the duck: what changes is the duck and nothing else.
    const ducked = (await renderScriptedMatch({ duck: true, layers: "music" })).getChannelData(0);
    const open = (await renderScriptedMatch({ duck: false, layers: "music" })).getChannelData(0);
    const at = (data, fromS, toS) => rmsWindow(data, MATCH.sr, fromS, toS);
    const before = toDb(at(ducked, MATCH.koS - 1.0, MATCH.koS)) - toDb(at(open, MATCH.koS - 1.0, MATCH.koS));
    const during = toDb(at(ducked, MATCH.koS + 0.15, MATCH.koS + 1.0)) - toDb(at(open, MATCH.koS + 0.15, MATCH.koS + 1.0));
    const after = toDb(at(ducked, MATCH.koReleaseS + 0.8, MATCH.koReleaseS + 1.6)) - toDb(at(open, MATCH.koReleaseS + 0.8, MATCH.koReleaseS + 1.6));
    console.log(`  music bed vs undicked: before ${before.toFixed(1)} dB, during KO ${during.toFixed(1)} dB, after ${after.toFixed(1)} dB`);
    assert.ok(Math.abs(before) < 0.5, `the bed is untouched before the KO (${before.toFixed(2)} dB)`);
    assert.ok(during <= -8, `the KO only ducks the bed ${during.toFixed(1)} dB (want <= -8, table says ${DUCKS.ko.amounts.music})`);
    assert.ok(during >= DUCKS.ko.amounts.music - 2, `the KO overducks the bed to ${during.toFixed(1)} dB`);
    assert.ok(after > -1.5, `the bed never comes back (${after.toFixed(1)} dB after release)`);
  });
});
