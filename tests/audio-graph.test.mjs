// WP8 audio graph (EMOTION_BIBLE 7): bus topology and ceiling, zero nodes per frame from beds and crowd (one-shots
// only when a servo brakes), the 24-voice pool with 1–10 priorities (stealing, the 80 ms drop, the −(p − 4) dB duck),
// the named ducks and the −14 dB music floor, servo life (measured vs commanded velocity, hold, strain), the impact
// object on the audio clock, near-KO and the last 3 s, music automation (silent before t₀), lock-in ticks, and no
// audio files anywhere.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUS_GAIN, MAX_VOICES, MUSIC_DUCK_FLOOR_DB, buildBusGraph, createAudioEngine } from "../src/game/audio/audio-engine.ts";
import { HARMONIC_DB, HARMONIC_HUNT_DB, servoLifeParams } from "../src/game/audio/beds.ts";
import { createFeedbackAudio, lockInTickHz, musicForPhase, nearKoOf } from "../src/game/audio/feedback-audio.ts";
import { impactPriority } from "../src/game/audio/impact.ts";
import { dbToGain } from "../src/game/audio/synth.ts";
import { createHypeModel } from "../src/game/feedback/hype.ts";
import { createUiStore } from "../src/game/core/ui-store.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { fakeCombat, fakeEvents, fakeFeedbackContext, fakeFrame } from "../src/game/testing/fakes.ts";

/* A recording BaseAudioContext: builds real-shaped node objects, counts creations, and logs param automation. */
class Param {
  constructor(v) { this.value = v; this.log = []; }
  setValueAtTime(v, t) { this.log.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.log.push(["lin", v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.log.push(["exp", v, t]); return this; }
  setTargetAtTime(v, t, tau) { this.log.push(["target", v, t, tau]); this.target = v; return this; }
  cancelScheduledValues(t) { this.log.push(["cancel", t]); return this; }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; ctx.created.push(this); }
  connect(dest) { this.outs.push(dest); return dest; }
  disconnect() { this.outs = []; }
}
class RecordingContext {
  constructor() { this.created = []; this.currentTime = 0; this.sampleRate = 48000; this.state = "running"; this.baseLatency = 0.005; this.outputLatency = 0.01; this.destination = new Node(this, "destination"); }
  createGain() { const n = new Node(this, "gain"); n.gain = new Param(1); return n; }
  createOscillator() { const n = new Node(this, "osc"); n.type = "sine"; n.frequency = new Param(440); n.detune = new Param(0); n.start = (t) => { n.startT = t; }; n.stop = (t) => { n.stopT = t; }; return n; }
  createBufferSource() { const n = new Node(this, "buffer"); n.playbackRate = new Param(1); n.loop = false; n.start = (t) => { n.startT = t; }; n.stop = (t) => { n.stopT = t; }; return n; }
  createBiquadFilter() { const n = new Node(this, "biquad"); n.type = "lowpass"; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; }
  createWaveShaper() { const n = new Node(this, "shaper"); n.curve = null; return n; }
  createDynamicsCompressor() { const n = new Node(this, "compressor"); for (const k of ["threshold", "knee", "ratio", "attack", "release"]) n[k] = new Param(0); return n; }
  createStereoPanner() { const n = new Node(this, "panner"); n.pan = new Param(0); return n; }
  createBuffer(ch, len, sr) { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: (c) => data[c] }; }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

async function readyEngine() {
  const ctx = new RecordingContext();
  const engine = createAudioEngine({ createContext: () => ctx, unlockOnGesture: false, musicTimer: false, seed: 1 });
  await engine.prepare(() => undefined);
  return { ctx, engine };
}


describe("audio graph", () => {
  test("bus topology, bus gains, compressor settings, and a ceiling curve that never exceeds -0.5 dBFS", () => {
    const ctx = new RecordingContext();
    const b = buildBusGraph(ctx, ctx.destination);
    assert.deepEqual(b.sfx.outs, [b.sfxDuck]);
    assert.deepEqual(b.sfxDuck.outs, [b.master]);
    assert.deepEqual(b.beds.outs, [b.bedsDuck], "servo life has its own duck");
    assert.deepEqual(b.bedsDuck.outs, [b.master]);
    // The lead bus hangs off master directly: the KO duck must clear a hole for the kill confirm, not sit on it.
    assert.deepEqual(b.lead.outs, [b.master]);
    assert.equal(b.lead.gain.value, BUS_GAIN.lead);
    assert.deepEqual(b.music.outs, [b.musicTone]);
    assert.deepEqual(b.musicTone.outs, [b.musicDuck]);
    assert.deepEqual(b.crowd.outs, [b.crowdDuck]);
    assert.deepEqual(b.master.outs, [b.compressor]);
    assert.deepEqual(b.compressor.outs, [b.ceiling]);
    assert.deepEqual(b.ceiling.outs, [ctx.destination]);
    const hp = b.voice.outs[0], lp = hp.outs[0];
    assert.equal(hp.type, "highpass"); assert.equal(hp.frequency.value, 300);
    assert.equal(lp.type, "lowpass"); assert.equal(lp.frequency.value, 3400);
    assert.equal(b.ui.gain.value, BUS_GAIN.ui);
    assert.equal(b.music.gain.value, BUS_GAIN.music);
    assert.equal(b.crowd.gain.value, BUS_GAIN.crowd);
    assert.equal(b.master.gain.value, BUS_GAIN.master);
    assert.deepEqual([b.compressor.threshold.value, b.compressor.knee.value, b.compressor.ratio.value, b.compressor.attack.value, b.compressor.release.value], [-10, 6, 12, 0.002, 0.15]);
    const ceiling = dbToGain(-0.5);
    for (const v of b.ceiling.curve) assert.ok(Math.abs(v) < ceiling);
    const mid = b.ceiling.curve[Math.floor(b.ceiling.curve.length * 0.6)];
    assert.ok(Math.abs(mid - 0.2) < 0.01, "linear below the knee");
  });

  test("beds and crowd create zero AudioNodes per frame; a servo that brakes clicks once", async () => {
    const { ctx, engine } = await readyEngine();
    const frame = fakeFrame();
    const combat = fakeCombat();
    for (let j = 0; j < 5; j++) { frame.arms.atlas.qd[j] = 1.2; frame.arms.atlas.forceRange[j] = 3; }
    engine.beds.update(0, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false });
    const before = ctx.created.length;
    for (let i = 1; i < 600; i++) {
      ctx.currentTime = i / 60;
      for (let j = 0; j < 5; j++) { frame.arms.atlas.qd[j] = 1.2 + Math.sin(i * 0.1 + j); frame.arms.atlas.tau[j] = Math.cos(i * 0.07) * 2; }
      frame.active.armArmTouching = i % 50 < 10;
      frame.active.maxArmForce = 3;
      combat.seats.atlas.heat = (i / 6) % 100;
      combat.seats.atlas.integrity = 100 - (i % 100);
      engine.beds.update(ctx.currentTime, { frame, combat, playerSeat: "atlas", active: true, timeScale: i % 90 < 10 ? 0.35 : 1, frozen: i % 45 === 0, siren: i % 100 < 50 ? "dock" : "steal" });
      engine.crowd.update(ctx.currentTime, (i % 100) / 100, true, { mood: 0.2, energy: (i % 100) / 100, anticipation: i % 200 < 100 ? 1 : 0, heldBreath: false, bored: false });
    }
    assert.equal(ctx.created.length, before, "a moving arm allocates nothing per frame");
    assert.ok(engine.beds.nodeCount > 30 && engine.crowd.nodeCount > 10);
    // The arm comes to rest: one stop click (a servo brakes, it does not fade), then nothing.
    for (let j = 0; j < 5; j++) frame.arms.atlas.qd[j] = 0;
    ctx.currentTime += 1 / 60;
    engine.beds.update(ctx.currentTime, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false });
    assert.equal(engine.beds.lastOneShots, 1);
    const afterClick = ctx.created.length;
    ctx.currentTime += 1 / 60;
    engine.beds.update(ctx.currentTime, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false });
    assert.equal(ctx.created.length, afterClick);
  });

  test("the voice pool holds 24 one-shots, steals the oldest of the lowest priority, and drops what it cannot place", async () => {
    const { ctx, engine } = await readyEngine();
    for (let i = 0; i < 30; i++) { ctx.currentTime = i * 0.001; engine.playSfx("tok", 0.5); }
    assert.equal(engine.activeVoices, MAX_VOICES);
    assert.equal(engine.playSfx("ui_hover", 0), null, "a priority-1 cue cannot steal strikes");
    assert.ok(engine.playSfx("relay_click", 1), "a KO relay (8) steals a solid hit (6)");
    assert.equal(engine.activeVoices, MAX_VOICES);
    ctx.currentTime = 10;
    assert.equal(engine.activeVoices, 0, "voices expire when their tails end");
  });

  test("7: a voice at p >= 8 ducks the priority-2 buses by -(p - 4) dB for its length and drops voices <= p - 6 due within 80 ms", async () => {
    const { ctx, engine } = await readyEngine();
    const b = engine.buses;
    ctx.currentTime = 1;
    engine.playSfx("cube_tap", 0.5);                       // priority 2, due now
    engine.playSfx("tok", 0.5);                            // priority 6: survives
    const before = engine.activeVoices;
    assert.ok(engine.playSfx("steal", 1), "priority 9");
    assert.equal(engine.activeVoices, before, "the cube tap (2 <= 9 - 6) was dropped, the tok kept, the steal added");
    assert.ok(Math.abs(b.bedsDuck.gain.target - dbToGain(-5)) < 1e-12, "beds -5 dB under a p9 voice");
    assert.ok(Math.abs(b.musicDuck.gain.target - dbToGain(-5)) < 1e-12);
    assert.ok(Math.abs(b.crowdDuck.gain.target - dbToGain(-5)) < 1e-12);
    const [, , , tau] = b.bedsDuck.gain.log.at(-1);
    assert.ok(Math.abs(tau - 0.02 / 3) < 1e-9, "20 ms attack");
    ctx.currentTime = 3;
    engine.update();
    assert.equal(b.bedsDuck.gain.target, 1, "released after the voice ends");
    assert.ok(Math.abs(b.bedsDuck.gain.log.at(-1)[3] - 0.2 / 3) < 1e-9, "200 ms release");
  });

  test("ducking: KO cuts music -12 dB, SFX -6 and crowd -4, speech cuts music -8 and crowd -5, the deepest cut wins, both release, and music never passes -14 dB", async () => {
    const { ctx, engine } = await readyEngine();
    const b = engine.buses;
    engine.duck("speech", null);
    assert.ok(Math.abs(b.musicDuck.gain.target - dbToGain(-8)) < 1e-12);
    assert.ok(Math.abs(b.crowdDuck.gain.target - dbToGain(-5)) < 1e-12);
    engine.duck("ko");
    assert.ok(Math.abs(b.musicDuck.gain.target - dbToGain(-12)) < 1e-12);
    assert.ok(Math.abs(b.sfxDuck.gain.target - dbToGain(-6)) < 1e-12);
    assert.ok(Math.abs(b.crowdDuck.gain.target - dbToGain(-5)) < 1e-12, "speech -5 still beats the KO's -4 on the crowd");
    engine.duck("steal"); engine.duck("heavy_hit"); engine.duck("near_ko", null); engine.duck("last_3s", null); engine.duck("windup", null);
    assert.ok(b.musicDuck.gain.target >= dbToGain(MUSIC_DUCK_FLOOR_DB) - 1e-12, "the music floor holds under every duck at once");
    ctx.currentTime = 1.3;
    engine.update();
    engine.releaseDuck("near_ko"); engine.releaseDuck("last_3s"); engine.releaseDuck("windup");
    assert.ok(Math.abs(b.musicDuck.gain.target - dbToGain(-8)) < 1e-12, "KO hold ends, speech remains");
    assert.equal(b.sfxDuck.gain.target, 1);
    engine.releaseDuck("speech");
    assert.equal(b.musicDuck.gain.target, 1);
    assert.equal(b.crowdDuck.gain.target, 1);
  });

  test("servo life: whine 600 + 2400 v/vmax Hz from speed, hold buzz -38 -> -26 dB from error, strain only when erring and still", () => {
    const arm = fakeFrame().arms.atlas;
    const p = { speed: 0, error: 0, load: 0, freq: 0, whineGain: 0, holdGain: 0, strain: 0, jitterRate: 0 };
    arm.forceRange.fill(3);
    servoLifeParams(arm, 0, p);
    assert.equal(p.freq, 600);
    assert.equal(p.whineGain, 0);
    assert.ok(Math.abs(p.holdGain - dbToGain(-38)) < 1e-12, "hold buzz at -38 dB at zero error");
    assert.equal(p.strain, 0);
    assert.equal(p.jitterRate, 0);
    servoLifeParams(arm, 3, p);
    assert.equal(p.freq, 600 + 2400 * 0.5);
    assert.ok(p.whineGain > 0);
    servoLifeParams(arm, 12, p);
    assert.equal(p.freq, 3000, "vmax caps the whine");
    for (let j = 0; j < 5; j++) arm.tau[j] = 3;
    servoLifeParams(arm, 0, p);
    assert.ok(Math.abs(p.holdGain - dbToGain(-26)) < 1e-12, "saturated: -26 dB");
    for (let j = 0; j < 5; j++) arm.ctrl[j] = arm.q[j] + 0.3;
    servoLifeParams(arm, 0, p);
    assert.ok(p.strain > 0, "1.5 rad of error while still: the stall growl");
    assert.ok(p.jitterRate >= 0.5 && p.jitterRate <= 3);
    servoLifeParams(arm, 2, p);
    assert.equal(p.strain, 0, "moving: no strain");
    assert.ok(HARMONIC_HUNT_DB > HARMONIC_DB);
  });

  test("the opponent's whine follows its commanded velocity and pans by azimuth at -4 dB", async () => {
    const { ctx, engine } = await readyEngine();
    const frame = fakeFrame();
    const combat = fakeCombat();
    const blaze = engine.beds; void blaze;
    const sawOf = (idx) => ctx.created.filter((n) => n.kind === "osc" && n.type === "sawtooth")[idx];
    // Two arm beds: the first sawtooth of each is its whine. atlas = player (measured), blaze = opponent (commanded).
    const oppWhine = sawOf(3);
    engine.beds.update(0, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false, opponentAzimuth: 0.6 });
    frame.arms.blaze.ctrl.fill(0.5);                              // a command, not yet a motion
    engine.beds.update(1 / 60, { frame, combat, playerSeat: "atlas", active: true, timeScale: 1, frozen: false, opponentAzimuth: 0.6 });
    assert.ok(oppWhine.frequency.target > 600, "the whine rose on the command alone");
    const panner = ctx.created.filter((n) => n.kind === "panner")[1];
    assert.ok(Math.abs(panner.pan.target - Math.sin(0.6)) < 1e-9, "panned by azimuth");
    const levels = ctx.created.filter((n) => n.kind === "gain" && n.gain.target !== undefined && Math.abs(n.gain.target - dbToGain(-4)) < 1e-12);
    assert.ok(levels.length >= 1, "the opponent's layer sits at -4 dB");
  });

  test("events map to the impact object on the audio clock: jab 4, solid 6, heavy 8, crit 8, ping 9; taken keeps the object; guarded is thock", async () => {
    const { ctx, engine } = await readyEngine();
    const played = [];
    const voices = [];
    const playSfx = engine.playSfx.bind(engine);
    const playVoice = engine.playVoice.bind(engine);
    engine.playSfx = (id, i, o) => { played.push([id, o?.delayS ?? 0, o?.pitchOffsetSt ?? 0, o?.at]); return playSfx(id, i, o); };
    engine.playVoice = (bus, prio, render, d, at) => { voices.push([bus, prio, render, at]); return playVoice(bus, prio, render, d, at); };
    const clock = createGameClock();
    const audio = createFeedbackAudio({ engine, hype: createHypeModel(), clock, ui: createUiStore(), settings: createSettingsStore({ storage: null }) });
    const fctx = fakeFeedbackContext();
    assert.equal(impactPriority({ m: 0.1, raw: 4, crit: false, taken: false }), 4);
    assert.equal(impactPriority({ m: 0.3, raw: 12, crit: false, taken: false }), 6);
    assert.equal(impactPriority({ m: 0.8, raw: 22, crit: false, taken: false }), 8);
    assert.equal(impactPriority({ m: 0.3, raw: 12, crit: true, taken: false }), 8);
    assert.equal(impactPriority({ m: 0.8, raw: 30, crit: false, taken: false }), 9);
    ctx.currentTime = 2;
    audio.onEvents([fakeEvents.strike({ attacker: "atlas", victim: "blaze", magnitude: 0.3, raw: 12, t: 0.01 })], fctx);
    assert.deepEqual(voices.filter((v) => v[0] === "sfx").map((v) => [v[0], v[1]]), [["sfx", 6]]);
    assert.ok(voices.some((v) => v[0] === "crowd"), "first contact: the crowd's first ohh");
    assert.ok(Math.abs(voices[0][3] - (2 + 0.01 + ctx.baseLatency)) < 1e-9, "scheduled at currentTime + (tContact - tNow) + baseLatency");
    assert.equal(played.length, 0, "no legacy tok/crack/tink one-shots");
    voices.length = 0;
    audio.onEvents([fakeEvents.strike({ attacker: "atlas", victim: "blaze", magnitude: 0.8, raw: 22, crit: true })], fctx);
    assert.deepEqual(voices.filter((v) => v[0] === "sfx").map((v) => v[1]), [8]);
    assert.ok(Math.abs(engine.buses.musicDuck.gain.target - dbToGain(-4)) < 1e-12, "heavy_hit ducks music -4 dB");
    voices.length = 0;
    audio.onEvents([fakeEvents.strike({ attacker: "blaze", victim: "atlas", magnitude: 0.8, raw: 30 })], fctx);
    assert.deepEqual(voices.filter((v) => v[0] === "sfx").map((v) => v[1]), [9], "taken ping tier is the same object");
    voices.length = 0; played.length = 0;
    audio.onEvents([fakeEvents.strike({ guarded: true, raw: 25 })], fctx);
    assert.deepEqual(played.map((p) => p[0]), ["thock", "clang"]);
    assert.equal(voices.length, 0);
    played.length = 0; voices.length = 0;
    audio.onEvents([fakeEvents.ko({ victim: "blaze", attacker: "atlas" })], fctx);
    assert.ok(voices.some(([bus, prio]) => bus === "lead" && prio === 10), "the kill confirm goes out on the lead bus at priority 10");
    assert.ok(voices.some(([bus, prio]) => bus === "crowd" && prio === 6), "the KO roar (no self-duck)");
    const relays = played.filter((p) => p[0] === "relay_click");
    assert.equal(relays.length, 6);
    assert.deepEqual(relays.map((r) => Math.round(r[1] * 1000)), [150, 190, 230, 270, 310, 350]);
    assert.ok(played.some((p) => p[0] === "stop_click"), "the final stop click");
    assert.ok(Math.abs(engine.buses.musicDuck.gain.target - dbToGain(-12)) < 1e-12);
  });

  test("music follows the show: silent before t0, between-rounds bed through the ritual, match on FIGHT, victory or defeat, lobby after", () => {
    assert.equal(musicForPhase("attract", "title", null), "off", "the attract sells the game silently");
    assert.equal(musicForPhase("title", "title", null), "off");
    assert.equal(musicForPhase("boot", "boot", null), "off");
    assert.equal(musicForPhase("green_room", "green_room", null), "lobby");
    assert.equal(musicForPhase("boot_ritual", "match", null), "between_rounds");
    assert.equal(musicForPhase("count_in", "match", null), "between_rounds");
    assert.equal(musicForPhase("round_intro", "match", null), "between_rounds");
    assert.equal(musicForPhase("fight", "match", null), "match");
    assert.equal(musicForPhase("sudden_death", "match", null), "match");
    assert.equal(musicForPhase("systems_check", "match", null), "match");
    assert.equal(musicForPhase("verdict", "match", true), "victory");
    assert.equal(musicForPhase("outro", "match", false), "defeat");
  });

  test("t0: nothing plays before the first resume; the first resume plays the 40 ms relay clack at -12 dB", async () => {
    const ctx = new RecordingContext();
    ctx.state = "suspended";
    const engine = createAudioEngine({ createContext: () => ctx, unlockOnGesture: false, musicTimer: false, seed: 1 });
    await engine.prepare(() => undefined);
    assert.ok(Number.isNaN(engine.t0));
    const started = ctx.created.filter((n) => n.kind === "buffer" && n.startT !== undefined);
    assert.equal(started.filter((n) => n.stopT !== undefined && n.stopT < 5).length, 0, "no one-shot is scheduled before t0 (beds and crowd loops only)");
    ctx.currentTime = 4.2;
    const played = [];
    const playSfx = engine.playSfx.bind(engine);
    engine.playSfx = (id, i, o) => { played.push(id); return playSfx(id, i, o); };
    await engine.unlock();
    assert.equal(engine.t0, 4.2);
    assert.deepEqual(played, ["t0_clack"]);
    await engine.unlock();
    assert.deepEqual(played, ["t0_clack"], "once");
  });

  test("near-KO thins the drums by (1 - 0.7u), sweeps the tone 12 kHz -> 1.2 kHz, holds the crowd's breath and ducks near_ko", async () => {
    const { engine } = await readyEngine();
    const audio = createFeedbackAudio({ engine, hype: createHypeModel(), clock: createGameClock(), ui: createUiStore(), settings: createSettingsStore({ storage: null }) });
    const combat = fakeCombat();
    combat.seats.blaze.integrity = 10;
    assert.deepEqual(nearKoOf(combat), { seat: "blaze", u: 0.5 });
    const fctx = fakeFeedbackContext({ phase: "fight", combat });
    const frame = fakeFrame();
    audio.onEvents([fakeEvents.phase({ phase: "fight" }), fakeEvents.strike({ raw: 12, magnitude: 0.3 })], fctx);
    frame.arms.blaze.eePos[0] = frame.arms.atlas.eePos[0] + 0.1;      // in exchange range
    for (let i = 0; i < 40; i++) audio.update(1 / 60, fctx, frame);
    assert.ok(audio.inExchange, "grippers within 0.3 m for >= 300 ms");
    assert.ok(Math.abs(engine.music.drums - (1 - 0.7 * 0.5)) < 1e-9, "drums x (1 - 0.7u) inside the exchange");
    assert.ok(Math.abs(engine.buses.musicTone.frequency.target - (12000 - 10800 * 0.5)) < 1e-6);
    assert.equal(audio.crowdModel.heldBreath, true);
    assert.ok(engine.buses.crowdDuck.gain.target < 1, "near_ko ducks the crowd");
    combat.seats.blaze.integrity = 80;
    for (let i = 0; i < 10; i++) audio.update(1 / 60, fctx, frame);
    assert.equal(audio.crowdModel.heldBreath, false);
    assert.equal(engine.music.drums, 1);
  });

  test("the last 3 s of a lock strip the drums, duck last_3s and lift the crowd's anticipation; the tick pitch rises", async () => {
    const { engine } = await readyEngine();
    const ticks = [];
    const playSfx = engine.playSfx.bind(engine);
    engine.playSfx = (id, i, o) => { if (id === "lockin_tick") ticks.push(o?.pitchOffsetSt ?? 0); return playSfx(id, i, o); };
    const settings = createSettingsStore({ storage: null });
    settings.set({ profile: { matchesPlayed: 2 } });
    const audio = createFeedbackAudio({ engine, hype: createHypeModel(), clock: createGameClock(), ui: createUiStore(), settings });
    const combat = fakeCombat("arcade", { core: { phase: "live", owner: "atlas", dockedIn: "atlas", lockInRemainingS: 2.5, lockInTotalS: 8, contested: false, loose: false, stolenFrom: null, lastTouchedBy: "atlas" } });
    const fctx = fakeFeedbackContext({ phase: "fight", combat });
    const frame = fakeFrame();
    audio.onEvents([fakeEvents.phase({ phase: "fight" }), fakeEvents.core({ stage: "lock_in_start" })], fctx);
    for (let i = 0; i < 60; i++) { combat.core.lockInRemainingS -= 1 / 60; audio.update(1 / 60, fctx, frame); }
    assert.equal(engine.music.drums, 0, "drums out");
    assert.equal(audio.crowdModel.anticipation, 1);
    assert.ok(engine.buses.crowdDuck.gain.target < 1, "last_3s duck");
    assert.ok(ticks.length >= 2 && ticks[ticks.length - 1] > ticks[0], `tick pitch rises (${ticks.join(", ")})`);
  });

  test("lock-in ticks at 1 Hz, 2 Hz under 3 s, 4 Hz under 1 s", async () => {
    assert.equal(lockInTickHz(6), 1);
    assert.equal(lockInTickHz(2.5), 2);
    assert.equal(lockInTickHz(0.4), 4);
    const { engine } = await readyEngine();
    const ticks = [];
    const playSfx = engine.playSfx.bind(engine);
    engine.playSfx = (id, i, o) => { if (id === "lockin_tick") ticks.push(id); return playSfx(id, i, o); };
    const audio = createFeedbackAudio({ engine, hype: createHypeModel(), clock: createGameClock(), ui: createUiStore(), settings: createSettingsStore({ storage: null }) });
    const combat = fakeCombat("arcade", { core: { phase: "live", owner: "atlas", dockedIn: "atlas", lockInRemainingS: 2.5, lockInTotalS: 8, contested: false, loose: false, stolenFrom: null, lastTouchedBy: "atlas" } });
    const ctx = fakeFeedbackContext({ phase: "fight", combat });
    const frame = fakeFrame();
    for (let i = 0; i < 60; i++) audio.update(1 / 60, ctx, frame);
    assert.ok(ticks.length >= 1 && ticks.length <= 3, `${ticks.length} ticks in 1 s at 2 Hz`);
  });

  test("no audio file is fetched or decoded anywhere in the feel package", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "game");
    const files = [];
    for (const dir of ["audio", "announcer", "feedback", "input", "camera"]) {
      for (const name of readdirSync(path.join(root, dir))) {
        const full = path.join(root, dir, name);
        if (statSync(full).isFile()) files.push(full);
      }
    }
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/\bfetch\s*\(|decodeAudioData|new Audio\s*\(|\.(ogg|mp3|wav|m4a|flac)\b/.test(src), `${path.basename(f)} loads audio`);
    }
  });
});
