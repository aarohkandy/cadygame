#!/usr/bin/env node
// tools/export/mixdown.mjs (WP8)
// Offline match mixdown from an episode (EMOTION_BIBLE 7, 11 WP8): the music scheduler, crowd, servo life and SFX
// rendered on the episode's wall clock through the same feedback-audio code path the live game runs, into an
// OfflineAudioContext (the platform's in a browser; src/game/audio/offline-context.mjs in Node). Used for the demo
// (12.2) and for the LUFS tests: −16 LUFS ± 2 integrated over a round, crest ≥ 12 dB, drums < 0.3 for ≥ 20 % of
// fight time, near_ko active ≥ 1.5 s before any KO confirm. Hosts are captions in the game; a voice needs Web Speech,
// so the mixdown reports `hosts: captions` rather than pretending.
//
//   node tools/export/mixdown.mjs episode.tlep.json --out mix.wav [--report mix.json] [--sr 24000] [--seat atlas]
//
// Nothing here plays audio: the render goes to a file.

import { readFile, writeFile } from "node:fs/promises";
import { MATCH_PHASES, OBS_BLOCKS, SEATS, otherSeat } from "../../src/game/contracts.ts";
import { createAudioEngine } from "../../src/game/audio/audio-engine.ts";
import { createFeedbackAudio } from "../../src/game/audio/feedback-audio.ts";
import { offlineFactory } from "../../src/game/audio/offline-context.mjs";
import { createUiStore } from "../../src/game/core/ui-store.ts";
import { createHypeModel } from "../../src/game/feedback/hype.ts";
import { decodeEpisodeText } from "../../src/game/harness/episode-format.ts";
import { isPilotDriver } from "../../src/game/harness/recorder.ts";
import { viewEpisode } from "../../src/game/harness/stats.ts";
import { fakeCombat, fakeFrame } from "../../src/game/testing/fakes.ts";

export const DEFAULT_SR = 24000;
/** Section 7 test targets. */
export const TARGETS = { lufs: -16, lufsTol: 2, crestDb: 12, drumsQuietFrac: 0.2, nearKoLeadS: 1.5 };

/* ───────────────────────── BS.1770 integrated loudness ───────────────────────── */

function rbj(kind, fs, f0, q, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (kind === "highshelf") {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cos + s); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s);
    a0 = (A + 1) - (A - 1) * cos + s; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s;
  } else {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function filterInPlace(x, [b0, b1, b2, a1, a2]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    x[i] = yn;
  }
}

/** Integrated loudness (LUFS) per ITU-R BS.1770-4: K-weighting, 400 ms blocks at 75 % overlap, −70 abs / −10 rel gates. */
export function lufsIntegrated(channels, sampleRate) {
  const shelf = rbj("highshelf", sampleRate, 1681.974450955533, 0.7071752369554196, 3.999843853973347);
  const hp = rbj("highpass", sampleRate, 38.13547087602444, 0.5003270373238773);
  const weighted = channels.map((c) => { const x = Float64Array.from(c); filterInPlace(x, shelf); filterInPlace(x, hp); return x; });
  const block = Math.round(0.4 * sampleRate), hop = Math.round(0.1 * sampleRate);
  const n = weighted[0].length;
  const blocks = [];
  for (let start = 0; start + block <= n; start += hop) {
    let ms = 0;
    for (const x of weighted) { let s = 0; for (let i = start; i < start + block; i++) s += x[i] * x[i]; ms += s / block; }
    blocks.push(ms);
  }
  if (blocks.length === 0) return -Infinity;
  const lk = (ms) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-20));
  const abs = blocks.filter((ms) => lk(ms) > -70);
  if (abs.length === 0) return -Infinity;
  const relGate = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((ms) => lk(ms) > relGate);
  if (kept.length === 0) return -Infinity;
  return lk(kept.reduce((a, b) => a + b, 0) / kept.length);
}

export function peakAndRms(channels) {
  let peak = 0, sum = 0, n = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; sum += c[i] * c[i]; n++; }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0;
  const db = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
  return { peakDb: db(peak), rmsDb: db(rms), crestDb: db(peak) - db(rms) };
}

/* ───────────────────────── episode → context / frame ───────────────────────── */

function phaseName(code) {
  return MATCH_PHASES[code] ?? "fight";
}

/** Fills a CombatSnapshot and PhysicsFrame for row `r` from the recorded observation blocks of `seat`. */
function fillRow(view, seat, r, combat, frame, roundStartT) {
  const ep = view.ep;
  const sv = view.seats[seat];
  const ov = view.seats[otherSeat(seat)];
  const G = OBS_BLOCKS.game, S = OBS_BLOCKS.state, X = OBS_BLOCKS.self_ext, O = OBS_BLOCKS.opponent_state;
  const g = sv.game;
  combat.round = ep.columns.round ? ep.columns.round[r] : 1;
  combat.fightTimeS = Math.max(0, ep.columns.timestamp[r] - roundStartT);
  combat.roundLengthS = ep.meta.rules.roundLengthS;
  if (g) {
    combat.seats[seat].integrity = g[r * G] * combat.seats[seat].integrityMax;
    combat.seats[otherSeat(seat)].integrity = g[r * G + 1] * combat.seats[otherSeat(seat)].integrityMax;
    combat.suddenDeath = g[r * G + 4] > 0.5;
    const own = g[r * G + 6];
    const live = g[r * G + 8] > 0.5;
    const full = g[r * G + 7] * 8;
    combat.core.phase = live ? "live" : "dormant";
    combat.core.owner = own > 0 ? seat : own < 0 ? otherSeat(seat) : null;
    combat.core.dockedIn = combat.core.owner;
    combat.core.lockInRemainingS = Math.abs(own) * full;
    combat.core.lockInTotalS = full || 8;
    combat.seats[seat].heat = g[r * G + 10] * 100;
    combat.seats[seat].guardHeld = g[r * G + 15] > 0.5;
  }
  for (const s of SEATS) {
    const v = s === seat ? sv : ov;
    const arm = frame.arms[s];
    if (v.state) { for (let j = 0; j < 6; j++) { arm.q[j] = v.state[r * S + j]; arm.qd[j] = v.state[r * S + 6 + j]; } }
    if (v.selfExt) {
      for (let j = 0; j < 3; j++) { arm.eePos[j] = v.selfExt[r * X + j]; arm.eeVel[j] = v.selfExt[r * X + 7 + j]; }
      for (let j = 0; j < 6; j++) { arm.tau[j] = v.selfExt[r * X + 13 + j]; arm.ctrl[j] = v.selfExt[r * X + 19 + j]; }
    } else if (s !== seat && sv.opp) {
      for (let j = 0; j < 6; j++) { arm.q[j] = sv.opp[r * O + j]; arm.qd[j] = sv.opp[r * O + 6 + j]; arm.ctrl[j] = arm.q[j]; }
      for (let j = 0; j < 3; j++) { arm.eePos[j] = sv.opp[r * O + 12 + j]; arm.eeVel[j] = sv.opp[r * O + 19 + j]; }
    }
    for (let j = 0; j < 6; j++) if (!(arm.forceRange[j] > 0)) arm.forceRange[j] = 3;
  }
  frame.active.armArmTouching = g ? g[r * G + 9] > 0.5 : false;
  frame.active.maxArmForce = frame.active.armArmTouching ? 3 : 0;
}

/**
 * Renders the episode through the live audio path. Returns the rendered buffer and the section 7 report.
 * `factory(channels, length, sampleRate)` builds the OfflineAudioContext (defaults to the software one).
 */
export async function mixdownEpisode(ep, { sampleRate = DEFAULT_SR, seat = null, factory = offlineFactory, padS = 3 } = {}) {
  const view = viewEpisode(ep);
  const rows = view.rows;
  if (rows === 0) throw new Error("the episode has no rows");
  const pilot = seat ?? SEATS.find((s) => isPilotDriver(ep.meta.seats[s].driver)) ?? "atlas";
  const t = ep.columns.timestamp;
  const durS = t[rows - 1] - t[0] + padS;
  const ctx = factory(2, Math.ceil(durS * sampleRate), sampleRate);
  ctx.currentTime = 0;
  const engine = createAudioEngine({ createContext: () => ctx, unlockOnGesture: false, musicTimer: false, seed: 0x5eed });
  await engine.prepare(() => undefined);
  const hype = createHypeModel();
  const clockState = { simTime: 0, wallTime: 0, alpha: 0, timeScale: 1, hitstopRemainingMs: 0, hitstopBudgetUsedMs: 0, externalDrive: false, paused: false };
  const clock = { ...clockState, requestHitstop: () => 0, requestDilation() {}, setRenderAlpha() {}, setExternalDrive() {} };
  const ui = createUiStore();
  ui.set({ screen: "match" });
  const settings = { get: () => ({ profile: { matchesPlayed: ep.meta.session?.matchIndexInSession ?? 2 } }) };
  const audio = createFeedbackAudio({ engine, hype, clock, ui, settings });
  const combat = fakeCombat(ep.meta.preset);
  const frame = fakeFrame({ mode: ep.meta.physics });
  const names = { atlas: ep.meta.seats.atlas.name, blaze: ep.meta.seats.blaze.name };
  const ctxBase = { playerSeat: pilot, preset: ep.meta.preset, names, opponentIsUserModel: false, camera: null, fastShow: false };
  const eventRow = view.eventRow;
  const byRow = new Map();
  for (let i = 0; i < ep.events.length; i++) { const r = eventRow[i]; if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(ep.events[i]); }
  const phaseCol = ep.columns.phase;
  const drumsSamples = [];
  const liveSpans = [];                                     // [fromS, toS) of fight / sudden-death time: the LUFS ruler is "over a round"
  let nearKoFirstT = null, koT = null, started = false, roundStartT = t[0];
  let lastPhase = null;
  for (let r = 0; r < rows; r++) {
    const now = t[r] - t[0];
    ctx.currentTime = now;
    clock.simTime = t[r]; clock.wallTime = now;
    const phase = phaseName(phaseCol ? phaseCol[r] : MATCH_PHASES.indexOf("fight"));
    if (phase !== lastPhase && (phase === "fight" || phase === "round_intro")) roundStartT = t[r];
    lastPhase = phase;
    if (!started && phase !== "boot" && phase !== "attract" && phase !== "title") { started = true; engine.playSfx("t0_clack", 1); }
    fillRow(view, pilot, r, combat, frame, roundStartT);
    const fctx = { ...ctxBase, phase, combat };
    const events = byRow.get(r);
    if (events) {
      // The recorder stamps sim time on events; the mixdown's audio clock is the wall clock, so leads are zero.
      audio.onEvents(events.map((e) => ({ ...e, t: t[r] })), fctx);
      if (koT === null && events.some((e) => e.type === "ko")) koT = now;
    }
    audio.update(r === 0 ? 0 : t[r] - t[r - 1], fctx, frame);
    if (phase === "fight" || phase === "sudden_death") {
      const last = liveSpans[liveSpans.length - 1];
      if (last && Math.abs(last[1] - now) < 0.1) last[1] = now + (r + 1 < rows ? t[r + 1] - t[r] : 0); else liveSpans.push([now, now + (r + 1 < rows ? t[r + 1] - t[r] : 0)]);
      drumsSamples.push(engine.music.drums);
      if (nearKoFirstT === null && audio.crowdModel.heldBreath) nearKoFirstT = now;
    }
  }
  // Let the tails ring out.
  for (let k = 1; k <= padS * 20; k++) { ctx.currentTime = t[rows - 1] - t[0] + k / 20; engine.update(); }
  const buffer = await ctx.startRendering();
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const { peakDb, rmsDb, crestDb } = peakAndRms(channels);
  // Integrated loudness over the rounds (7: "−16 LUFS ± 2 integrated over a round"): the live spans concatenated.
  const live = channels.map((c) => {
    const parts = liveSpans.map(([a, b]) => c.subarray(Math.floor(a * sampleRate), Math.min(c.length, Math.floor(b * sampleRate))));
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  });
  const lufs = lufsIntegrated(live[0].length > sampleRate ? live : channels, sampleRate);
  const lufsWhole = lufsIntegrated(channels, sampleRate);
  const drumsQuietFrac = drumsSamples.length ? drumsSamples.filter((d) => d < 0.3).length / drumsSamples.length : 0;
  const nearKoLeadS = koT !== null && nearKoFirstT !== null ? koT - nearKoFirstT : null;
  const report = {
    episodeId: ep.meta.episodeId, seat: pilot, sampleRate, durationS: durS, lufs, lufsWhole, liveS: liveSpans.reduce((n, [a, b]) => n + b - a, 0),
    peakDb, rmsDb, crestDb, drumsQuietFrac, nearKoLeadS, koAtS: koT,
    hosts: "captions",
    pass: {
      lufs: Math.abs(lufs - TARGETS.lufs) <= TARGETS.lufsTol,
      crest: crestDb >= TARGETS.crestDb,
      drums: drumsQuietFrac >= TARGETS.drumsQuietFrac,
      nearKo: koT === null || (nearKoLeadS !== null && nearKoLeadS >= TARGETS.nearKoLeadS),
    },
  };
  return { buffer, report };
}

/* ───────────────────────── WAV ───────────────────────── */

/** 16-bit PCM WAV bytes for an AudioBuffer-like (numberOfChannels, sampleRate, getChannelData). */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const n = buffer.length;
  const bytes = 44 + n * channels * 2;
  const out = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, bytes - 8, true); str(8, "WAVE");
  str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * channels * 2, true); out.setUint16(32, channels * 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, n * channels * 2, true);
  let o = 44;
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 32768 : v * 32767, true); o += 2; }
  return new Uint8Array(out.buffer);
}

async function main(argv) {
  const args = { sr: DEFAULT_SR, out: null, report: null, seat: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--sr") args.sr = Number(argv[++i]);
    else if (a === "--seat") args.seat = argv[++i];
    else args.file = a;
  }
  if (!args.file || !args.out) {
    console.error("usage: node tools/export/mixdown.mjs episode.tlep.json --out mix.wav [--report mix.json] [--sr 24000] [--seat atlas|blaze]");
    return 2;
  }
  const ep = decodeEpisodeText(await readFile(args.file, "utf8"));
  const { buffer, report } = await mixdownEpisode(ep, { sampleRate: args.sr, seat: args.seat });
  await writeFile(args.out, encodeWav(buffer));
  if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2));
  const f = (v) => (typeof v === "number" ? v.toFixed(1) : String(v));
  console.log(`mixdown: ${args.out} ${f(report.durationS)} s  ${f(report.lufs)} LUFS over the rounds (${f(report.lufsWhole)} whole)  crest ${f(report.crestDb)} dB  peak ${f(report.peakDb)} dBFS  drums quiet ${(report.drumsQuietFrac * 100).toFixed(0)} %  near_ko lead ${f(report.nearKoLeadS)} s  hosts: ${report.hosts}`);
  return Object.values(report.pass).every(Boolean) ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
