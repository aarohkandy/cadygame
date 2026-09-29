// src/game/audio/feedback-audio.ts (WP8)
// AudioControl for the game: the emotion arc of section 7 driven from the bus events and the physics frame.
// Strikes are the impact object (impact.ts) scheduled on the audio clock (6: currentTime + (tContact − tNow) +
// baseLatency, never the next rAF); the beds get near-KO, the siren and the opponent's azimuth; the band gets the
// exchange gate, the momentum stabs, the count-in, the last-3-s cut and the near-KO thinning; the crowd gets its
// model (mood, energy, anticipation, held breath, hush, chant, bored clap); the named ducks (`heavy_hit`, `near_ko`,
// `steal`, `windup`, `last_3s`) sit under the big moments. Zero audio before t₀: the engine only exists after the
// first gesture, and the attract and title phases keep the band off.
//
// Music follows the match phase automatically (off before t₀, the between-rounds bed through the ritual, match on
// FIGHT, victory or defeat at match end, lobby after). A setMusic call from the UI overrides the automation until
// the phase changes.

import type {
  AudioControl, CombatSnapshot, FeedbackContext, GameClock, GameEvent, MatchPhase, MusicState, PhysicsFrame, Seat, Settings, UiCue, UiStore,
} from "../contracts.ts";
import { otherSeat } from "../contracts.ts";
import type { CrowdReaction, HypeModel } from "../feedback/hype.ts";
import type { AudioEngine } from "./audio-engine.ts";
import { KO_ROAR, renderCrowdShout, type CrowdModel } from "./crowd.ts";
import { impactPriority, renderImpact } from "./impact.ts";
import { renderKillConfirm } from "./kill-confirm.ts";
import { SECONDS_PER_BEAT } from "./music-score.ts";
import type { SfxId } from "./sfx.ts";

const UI_SFX: Readonly<Record<UiCue, SfxId>> = {
  hover: "ui_hover", select: "ui_select", back: "ui_back", slam: "ui_slam", stamp: "ui_stamp", sticker: "ui_sticker",
  countdown_beat: "ui_countdown", engage: "engage", tick: "tick", shutter: "ui_shutter",
};
/** 9.4: the slam cue lands 90 ms after the slam animation starts. */
export const SLAM_OFFSET_MS = 90;
export const KO_RELAY_START_MS = 150;
export const KO_RELAY_GAP_MS = 40;
/** 7 G: the crowd's KO roar swells from +0.4 s. */
export const KO_ROAR_DELAY_S = 0.4;
/** 7 A: six relay clicks + chirps 120 ms apart; the opponent's ritual 400 ms after yours. */
export const BOOT_CHIRP_GAP_S = 0.12;
export const BOOT_OPPONENT_DELAY_S = 0.4;
/** 7 C: grippers within this of each other for ≥ 300 ms is an exchange; held 1.5 s after. */
export const EXCHANGE_RANGE_M = 0.3;
export const EXCHANGE_ENTER_S = 0.3;
export const EXCHANGE_HOLD_S = 1.5;
/** 7 E: the last 3 s of a lock strip the drums; 7 F: near-KO below this Integrity. */
export const LAST_SECONDS = 3;
export const NEAR_KO_INTEGRITY = 20;
/** Bored crowd: no event for this long at low energy. */
export const BORED_AFTER_S = 8;
export const HEAVY_HIT_RAW = 20;

const MATCH_PHASES_LIVE: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["fight", "sudden_death", "ko", "lock", "time_up"]);
const BETWEEN: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["match_intro", "rematch_intro", "round_intro", "round_replay", "round_summary", "match_replay", "boot_ritual", "entrance", "count_in"]);
const SILENT: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["boot", "attract", "title"]);

/** Music state the automation wants for a phase and screen (7: nothing before t₀; the attract and title are silent). */
export function musicForPhase(phase: MatchPhase, screen: string, matchWinnerIsPlayer: boolean | null): MusicState {
  if (SILENT.has(phase) || screen === "title" || screen === "boot") return "off";
  if (phase === "green_room") return "lobby";
  if (MATCH_PHASES_LIVE.has(phase) || phase === "systems_check") return "match";
  if (BETWEEN.has(phase)) return "between_rounds";
  if (phase === "outro" || phase === "post_match" || phase === "verdict") return matchWinnerIsPlayer === false ? "defeat" : "victory";
  if (phase === "replay_viewer" || phase === "lab_run") return "off";
  return "lobby";
}

/** Lock-in tick rate (9.3): 1 Hz, 2 Hz under 3 s, 4 Hz under 1 s. */
export function lockInTickHz(remainingS: number): number {
  return remainingS < 1 ? 4 : remainingS < 3 ? 2 : 1;
}

/** Near-KO u = 1 − i/20 for the seat under 20 Integrity (the lower one when both are). */
export function nearKoOf(combat: CombatSnapshot): { seat: Seat; u: number } | null {
  let best: { seat: Seat; u: number } | null = null;
  for (const seat of ["atlas", "blaze"] as const) {
    const i = combat.seats[seat].integrity;
    if (!(i > 0) || i > NEAR_KO_INTEGRITY) continue;
    const u = 1 - i / NEAR_KO_INTEGRITY;
    if (!best || u > best.u) best = { seat, u };
  }
  return best;
}

/** Azimuth of the opponent's gripper from the player's, in the player's facing frame (sim x along the table). */
export function opponentAzimuth(frame: PhysicsFrame, me: Seat): number {
  const a = frame.arms[me].eePos, b = frame.arms[otherSeat(me)].eePos;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return me === "atlas" ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
}

export interface FeedbackAudio extends AudioControl {
  readonly engine: AudioEngine;
  readonly crowdModel: Readonly<CrowdModel>;
  readonly inExchange: boolean;
  onEvents(events: readonly GameEvent[], ctx: FeedbackContext): void;
  update(wallDtS: number, ctx: FeedbackContext, frame: PhysicsFrame): void;
  /** Log of recent strike onsets for ?debug=feel: sim step and AudioContext time of the scheduled transient. */
  readonly onsetLog: readonly { step: number; audioTime: number; wallMs: number }[];
  dispose(): void;
}

export interface FeedbackAudioDeps {
  engine: AudioEngine;
  hype: HypeModel;
  clock: GameClock;
  ui: UiStore;
  settings: { get(): Readonly<Settings> };
}

export function createFeedbackAudio(deps: FeedbackAudioDeps): FeedbackAudio {
  const { engine, hype, clock, ui } = deps;
  let manualMusic: MusicState | null = null;
  let manualPhase: MatchPhase | null = null;
  let lastPhase: MatchPhase | null = null;
  let matchWinnerIsPlayer: boolean | null = null;
  let lastContactMs = -Infinity;
  let lastEventMs = 0;
  let wallMs = 0;
  let lockTickAccS = 0;
  let clockTickSecond = -1;
  let toneHz = 20000;
  let koToneUntilMs = -Infinity;
  let firstStrike = false;
  let exchangeS = 0;
  let exchangeHoldS = 0;
  let inExchange = false;
  let streakHolder: Seat | null = null;
  let chantBar = -1;
  let siren: "off" | "dock" | "steal" = "off";
  let sirenStealUntilMs = -Infinity;
  let windupSeat: Seat | null = null;
  const crowdModel: CrowdModel = { mood: 0, energy: 0, anticipation: 0, heldBreath: false, bored: false };
  const onsetLog: { step: number; audioTime: number; wallMs: number }[] = [];
  const pendingReaction: { kind: CrowdReaction | null } = { kind: null };

  const matchesPlayed = () => deps.settings.get().profile.matchesPlayed;
  /** The dock siren is a match-2+ element (2, gate table). */
  const sirenAllowed = () => matchesPlayed() >= 1;

  function sfx(id: SfxId, intensity = 0, pitchOffsetSt = 0, delayS = 0) {
    return engine.playSfx(id, intensity, { pitchOffsetSt, delayS });
  }
  /** 6: schedule on the audio clock from the event's sim time. */
  function atEvent(e: { t: number }): number {
    return engine.scheduleAt(e.t - clock.simTime);
  }

  function crowdReact(kind: CrowdReaction, delayS = 0): void {
    engine.playVoice("crowd", kind === "roar" ? 6 : 4, (s, dest, t) => renderCrowdShout(s, dest, t, kind), delayS);
  }

  function strikeSounds(e: Extract<GameEvent, { type: "strike" }>, ctx: FeedbackContext): void {
    const me = ctx.playerSeat;
    const m = Math.max(0, Math.min(1, e.magnitude));
    const at = atEvent(e);
    if (e.tier === "graze") { engine.playSfx("tap_soft", m, { at }); return; }
    if (e.guarded) {
      engine.playSfx("thock", m, { at });
      if (e.raw >= HEAVY_HIT_RAW) engine.playSfx("clang", m, { at });
      return;
    }
    const taken = me !== null && e.victim === me;
    const o = { m, raw: e.raw, crit: e.crit, taken };
    const ok = engine.playVoice("sfx", impactPriority(o), (s, dest, t) => renderImpact(s, dest, t, { ...o, pitchSt: s.rng.range(-0.7, 0.7), filterMul: s.rng.range(0.9, 1.1) }), 0, at);
    if (ok && !taken) {
      onsetLog.push({ step: e.step, audioTime: at, wallMs });
      if (onsetLog.length > 32) onsetLog.shift();
    }
    if (e.raw >= HEAVY_HIT_RAW) engine.duck("heavy_hit");
    if (!firstStrike) { firstStrike = true; crowdReact("ohh"); }
    // Momentum (7 D): the streak holder losing a hit is the break.
    if (streakHolder !== null && e.victim === streakHolder) {
      if (streakHolder === me) { engine.music?.stinger("momentum_down", engine.now()); crowdModel.mood -= 0.2; }
      else { crowdReact("groan"); crowdModel.energy = Math.max(0, crowdModel.energy - 0.15); }
      streakHolder = null;
    }
  }

  function koSounds(e: Extract<GameEvent, { type: "ko" }>, ctx: FeedbackContext): void {
    const me = ctx.playerSeat;
    engine.duck("ko");
    engine.setMusicTone(800, 0.05);
    koToneUntilMs = wallMs + 1200;
    const at = atEvent(e);
    if (me !== null && e.victim === me) {
      engine.playVoice("sfx", 8, (s, dest, t) => renderImpact(s, dest, t, { m: 1, raw: 40, crit: false, taken: true }), 0, at);
    } else {
      // The kill confirm is the winner's payoff; spectators hear it too. It goes out on the lead bus, past the KO
      // duck, because the duck exists to clear a hole for exactly this sound.
      engine.playVoice("lead", 10, (s, dest, t) => renderKillConfirm(s, dest, t, s.rng.range(-0.5, 0.5)), 0, at);
    }
    // 7 G: brownout from +150 ms per joint with relay clicks, the slump whine, then that arm is silent (beds).
    for (let j = 0; j < 6; j++) sfx("relay_click", 0.6, -j * 0.7, (KO_RELAY_START_MS + j * KO_RELAY_GAP_MS) / 1000);
    sfx("spin_down", 1, 0, KO_RELAY_START_MS / 1000);
    sfx("stop_click", 1, -2, (KO_RELAY_START_MS + 6 * KO_RELAY_GAP_MS + 1100) / 1000);
    // The roar swells from +0.4 s, peaks +1.0–1.4 s, holds 2.5 s, decays 4 s.
    // Priority 6: a crowd voice must not trigger the p ≥ 8 duck on its own bus for eight seconds.
    engine.playVoice("crowd", 6, (s, dest, t) => renderCrowdShout(s, dest, t, "roar", s.rng, KO_ROAR), KO_ROAR_DELAY_S);
    pendingReaction.kind = null;
    crowdModel.energy = 1;
    crowdModel.heldBreath = false;
    streakHolder = null;
  }

  function coreSounds(e: Extract<GameEvent, { type: "core" }>, ctx: FeedbackContext): void {
    const me = ctx.playerSeat;
    switch (e.stage) {
      case "incoming": sfx("riser"); break;
      case "drop": sfx("latch", 0.6); engine.music?.setFlags({ coreLive: true }); break;
      case "lock_in_start":
      case "lock_in_resume":
        lockTickAccS = 1;
        sfx("dock_clunk", 0.8);
        sfx("lockin_tick", 0.5, 0, 0.12);
        crowdModel.mood += e.seat === me ? 0.5 : -0.5;
        if (sirenAllowed()) siren = "dock";
        break;
      case "contested_on": if (sirenAllowed()) siren = "steal"; break;
      case "contested_off": if (siren === "steal") siren = "dock"; break;
      case "steal":
        sfx("steal", e.late ? 1 : 0.6);
        engine.duck("steal");
        if (sirenAllowed()) { siren = "steal"; sirenStealUntilMs = wallMs + 600; }
        if (me === null || e.seat === me) crowdReact("roar");
        else { crowdReact("groan"); engine.crowd?.hush(engine.now() + 0.9); }
        crowdModel.mood += e.seat === me ? 0.4 : -0.4;
        break;
      case "lock":
        sfx("lock", 1); engine.duck("lock");
        siren = "off";
        engine.music?.setFlags({ coreLive: false });
        break;
      default: break;
    }
  }

  function bootRitual(ctx: FeedbackContext): void {
    // 7 A: six relay clicks + chirps 120 ms apart, base → gripper; the opponent 400 ms after you.
    for (let j = 0; j < 6; j++) {
      sfx("boot_chirp", j / 5, 0, j * BOOT_CHIRP_GAP_S);
      if (ctx.playerSeat !== null) sfx("boot_chirp", j / 5, -3, BOOT_OPPONENT_DELAY_S + j * BOOT_CHIRP_GAP_S);
    }
  }

  function onPhase(e: Extract<GameEvent, { type: "phase" }>, ctx: FeedbackContext): void {
    const music = engine.music;
    switch (e.phase) {
      case "boot_ritual": bootRitual(ctx); break;
      case "count_in": music?.stinger("count_in", engine.now()); break;
      case "fight":
        sfx("engage", 1);
        music?.stinger("engage", engine.now());
        music?.setDrums(0, engine.now(), 0.01);            // the drums wait for the first exchange (7 C)
        firstStrike = false; inExchange = false; exchangeS = 0; exchangeHoldS = 0; streakHolder = null;
        crowdModel.energy = Math.max(crowdModel.energy, 0.6);   // 7 B: applause for the opening, ~1.5 s before it decays
        break;
      case "round_intro":
        music?.setFlags({ finalRound: e.finalRound, suddenDeath: false, coreLive: false });
        if (e.finalRound) music?.stinger("final_round", engine.now() + 0.3);
        break;
      case "sudden_death":
        music?.setFlags({ suddenDeath: true });
        music?.stinger("sudden_death", engine.now());
        break;
      case "time_up": sfx("buzzer", 1); break;
      case "round_replay":
      case "match_replay": engine.duck("replay", null); break;
      case "match_intro":
      case "rematch_intro":
      case "entrance":
        matchWinnerIsPlayer = null;
        music?.setFlags({ finalRound: false, suddenDeath: false, coreLive: false });
        crowdModel.anticipation = 0.7; crowdModel.energy = 0.3;
        break;
      case "post_match":
      case "verdict": {
        // 7 H: applause and one late whistle (win) or murmur then a "come on" chant (loss).
        const now = engine.now();
        if (matchWinnerIsPlayer !== false) engine.crowd?.whistle(now + 2.4);
        else if (music) { const bar = music.nextBar(now) + SECONDS_PER_BEAT; for (let b = 0; b < 4; b++) engine.crowd?.chantBeat(bar + b * 2 * SECONDS_PER_BEAT); }
        break;
      }
      default: break;
    }
    if (e.phase !== "round_replay" && e.phase !== "match_replay") engine.releaseDuck("replay");
    if (e.phase !== "fight" && e.phase !== "sudden_death") { siren = "off"; engine.releaseDuck("last_3s"); engine.releaseDuck("windup"); windupSeat = null; }
  }

  function onEvent(e: GameEvent, ctx: FeedbackContext): void {
    const me = ctx.playerSeat;
    lastEventMs = wallMs;
    switch (e.type) {
      case "contact":
        if (wallMs - lastContactMs > 60) { engine.playSfx("thunk", Math.min(1, e.magnitude), { at: atEvent(e) }); lastContactMs = wallMs; }
        break;
      case "strike": strikeSounds(e, ctx); break;
      case "late_guard": sfx("thock", 0.5, -3); sfx("late_guard_ticks", 1, 0, 0.08); break;
      case "deflect":
        engine.playSfx("ting", 1, { at: atEvent(e) });
        if (me !== null && e.attacker === me) sfx("stun_down", 1);
        crowdReact("ohh", 0.08);
        break;
      case "clash": engine.playSfx("clash", Math.min(1, e.magnitude), { at: atEvent(e) }); break;
      case "whiff": if (me === null || e.seat === me) sfx("whiff", 0.5); break;
      case "charge":
        if (e.stage === "full" && e.seat === me) sfx("charge_ping", 1);
        else if (e.stage === "release") { sfx("release", e.c); if (windupSeat === e.seat) { engine.releaseDuck("windup"); windupSeat = null; } }
        else if (e.stage === "cancel") { if (e.seat === me) sfx("cancel", 0.5); if (windupSeat === e.seat) { engine.releaseDuck("windup"); windupSeat = null; } }
        else if (e.stage === "public" && e.seat !== me) { engine.duck("windup", null); windupSeat = e.seat; crowdModel.anticipation = Math.max(crowdModel.anticipation, 0.5); }
        break;
      case "servo_state":
        if (e.state === "stagger") sfx("stagger_zap", 1);
        else if (e.state === "cutout") sfx("power_down", 1);
        break;
      case "burst": sfx("burst", 1); break;
      case "overheat": if (e.seat === me) sfx("power_down", 1); break;
      case "heat_warning": if (e.on && e.seat === me) sfx("heat_ping", 0.5); break;
      case "ability":
        if (e.phase === "start") sfx(e.ability === "snap" ? "snap" : e.ability === "recoil_coil" ? "coil" : "bulwark", 1);
        break;
      case "table_hit": sfx("thunk", Math.min(1, e.force / 20), -4); break;
      case "combo":
        // 7 D: a 3-hit streak. The player's gets the stab up a fourth and the chant; the AI's a groan then a dip.
        if (e.count === 3 && streakHolder !== e.seat) {
          streakHolder = e.seat;
          if (me === null || e.seat === me) { engine.music?.stinger("momentum_up", engine.now()); crowdModel.mood += 0.2; }
          else { crowdReact("groan"); crowdModel.energy = Math.max(0, crowdModel.energy - 0.1); }
        }
        break;
      case "core": coreSounds(e, ctx); break;
      case "ko": koSounds(e, ctx); break;
      case "policy_fault": sfx("fault_blip"); break;
      case "phase": onPhase(e, ctx); break;
      case "round_end":
        if (me === null) pendingReaction.kind = pendingReaction.kind ?? "roar";
        else pendingReaction.kind = e.winner === me ? "roar" : "groan";
        siren = "off";
        break;
      case "match_end":
        matchWinnerIsPlayer = me === null ? null : e.winner === me;
        engine.duck("match_end");
        break;
      default:
        break;
    }
  }

  function updateExchange(dt: number, frame: PhysicsFrame, live: boolean): void {
    const a = frame.arms.atlas.eePos, b = frame.arms.blaze.eePos;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const close = live && d < EXCHANGE_RANGE_M;
    exchangeS = close ? exchangeS + dt : 0;
    if (close && exchangeS >= EXCHANGE_ENTER_S) { inExchange = true; exchangeHoldS = EXCHANGE_HOLD_S; }
    else if (inExchange) { exchangeHoldS -= dt; if (exchangeHoldS <= 0) inExchange = false; }
  }

  function updateTicks(dt: number, combat: CombatSnapshot, ctx: FeedbackContext, frame: PhysicsFrame): void {
    const live = ctx.phase === "fight" || ctx.phase === "sudden_death";
    const core = combat.core;
    const me = ctx.playerSeat;
    const now = engine.now();
    const music = engine.music;
    updateExchange(dt, frame, live);
    const docked = live && core.phase === "live" && core.owner !== null && core.dockedIn === core.owner && core.lockInRemainingS > 0;
    const lastSeconds = docked && core.lockInRemainingS <= LAST_SECONDS;
    if (docked) {
      const hz = lockInTickHz(core.lockInRemainingS);
      lockTickAccS += dt * hz;
      if (lockTickAccS >= 1) {
        lockTickAccS -= Math.floor(lockTickAccS);
        // 6: the tick's pitch rises per second inside the last 3 s; the crowd stomps in time.
        const rise = lastSeconds ? (LAST_SECONDS - core.lockInRemainingS) * 2 : 0;
        sfx("lockin_tick", core.lockInRemainingS < 3 ? 0.8 : 0.4, (core.contested ? 1 : 0) + rise);
        if (lastSeconds) sfx("stomp", 0.6);
      }
      if (sirenAllowed() && siren === "off") siren = "dock";
    } else {
      lockTickAccS = 0;
      if (siren === "dock") siren = "off";
    }
    if (siren === "steal" && wallMs > sirenStealUntilMs && !core.contested) siren = docked && sirenAllowed() ? "dock" : "off";
    if (lastSeconds) engine.duck("last_3s", null); else engine.releaseDuck("last_3s");
    crowdModel.anticipation = lastSeconds ? 1 : Math.max(0, crowdModel.anticipation - dt * 0.5);

    // Match clock ticks in the last 10 s.
    const left = combat.roundLengthS - combat.fightTimeS;
    if (live && !combat.suddenDeath && left <= 10 && left > 0) {
      const sec = Math.ceil(left);
      if (sec !== clockTickSecond) {
        if (clockTickSecond !== -1) sfx("tick", left <= 5 ? 1 : 0);
        clockTickSecond = sec;
      }
    } else {
      clockTickSecond = -1;
    }

    // Near-KO (7 F): drums × (1 − 0.7u), lowpass 12 kHz → 1.2 kHz, held breath, the victim's stutter.
    const nearKo = live ? nearKoOf(combat) : null;
    crowdModel.heldBreath = nearKo !== null;
    if (nearKo) engine.duck("near_ko", null); else engine.releaseDuck("near_ko");
    // The drum group: out until the first exchange, gated by it, cut for the last 3 s, thinned under near-KO.
    if (music && live) {
      let drums = firstStrike ? (inExchange ? 1 : 0) : 0;
      if (lastSeconds) drums = 0;
      if (nearKo) drums *= 1 - 0.7 * nearKo.u;
      music.setDrums(drums, now);
    }
    // Music tone: the KO's own 800 Hz hold owns the tone for 1.2 s; near-KO sweeps it down; otherwise open.
    if (wallMs < koToneUntilMs) return;
    const want = nearKo ? 12000 - 10800 * nearKo.u : 20000;
    if (koToneUntilMs > -Infinity) { koToneUntilMs = -Infinity; toneHz = want; engine.setMusicTone(want, 0.6); }
    else if (Math.abs(want - toneHz) > 50) { toneHz = want; engine.setMusicTone(want, nearKo ? 0.4 : 0.6); }

    // 7 D: the chant on beats 2 and 4 of every bar while the player holds a streak.
    if (music && live && streakHolder !== null && streakHolder === me && engine.crowd) {
      const bar = music.bar;
      if (bar !== chantBar) {
        chantBar = bar;
        const down = music.nextBar(now);
        engine.crowd.chantBeat(down + SECONDS_PER_BEAT);
        engine.crowd.chantBeat(down + 3 * SECONDS_PER_BEAT);
      }
    }
  }

  const audio: FeedbackAudio = {
    engine,
    get hype() { return hype.h; },
    get latencyMs() { return engine.latencyMs; },
    get activeVoices() { return engine.activeVoices; },
    get onsetLog() { return onsetLog; },
    get crowdModel() { return crowdModel; },
    get inExchange() { return inExchange; },

    unlock() { return engine.unlock(); },
    prepare(onProgress) { return engine.prepare(onProgress); },

    setMusic(state) {
      manualMusic = state;
      manualPhase = lastPhase;
      engine.music?.setState(state, engine.now());
    },

    playUi(cue, whenMs) {
      const delay = Math.max(0, whenMs ?? 0) / 1000 + (cue === "slam" ? SLAM_OFFSET_MS / 1000 : 0);
      engine.playSfx(UI_SFX[cue], cue === "tick" ? 0 : 0.5, { delayS: delay });
    },

    setVolumes(v) { engine.setVolumes(v); },

    onEvents(events, ctx) {
      for (const e of events) onEvent(e, ctx);
      const reaction = hype.onEvents(events, ctx, wallMs);
      const kind = reaction ?? pendingReaction.kind;
      pendingReaction.kind = null;
      if (kind) crowdReact(kind);
    },

    update(wallDtS, ctx, frame) {
      const dt = Number.isFinite(wallDtS) ? Math.max(0, Math.min(0.25, wallDtS)) : 0;
      wallMs += dt * 1000;
      hype.update(dt, ctx);
      engine.update();
      if (!engine.ready) { lastPhase = ctx.phase; return; }
      const now = engine.now();
      const screen = ui.get().screen;
      if (manualMusic !== null && manualPhase !== ctx.phase) manualMusic = null;
      const wanted = manualMusic ?? musicForPhase(ctx.phase, screen, matchWinnerIsPlayer);
      const music = engine.music;
      if (music) {
        if (music.state !== wanted) music.setState(wanted, now);
        music.setHype(hype.h);
      }
      const show = !SILENT.has(ctx.phase) && (screen === "match" || screen === "tutorial" || screen === "post_match" || MATCH_PHASES_LIVE.has(ctx.phase) || BETWEEN.has(ctx.phase) || ctx.phase === "verdict" || ctx.phase === "systems_check");
      // The crowd model: energy tracks hype and decays with it; the mood settles; boredom after 8 quiet seconds.
      crowdModel.energy = Math.max(hype.h, crowdModel.energy - dt * 0.15);
      crowdModel.mood = Math.max(-1, Math.min(1, crowdModel.mood * Math.exp(-dt / 12)));
      crowdModel.bored = MATCH_PHASES_LIVE.has(ctx.phase) && crowdModel.energy < 0.2 && wallMs - lastEventMs > BORED_AFTER_S * 1000;
      engine.crowd?.update(now, hype.h, show && ctx.phase !== "paused", crowdModel);
      // 7: servo life from the first relay click of the boot ritual; silent in menus, replays and the verdict.
      const powered = !SILENT.has(ctx.phase) && ctx.phase !== "paused" && ctx.phase !== "replay_viewer" && ctx.phase !== "post_match" && ctx.phase !== "verdict";
      const live = ctx.phase === "fight" || ctx.phase === "sudden_death";
      engine.beds?.update(now, {
        frame, combat: ctx.combat, playerSeat: ctx.playerSeat, active: powered,
        timeScale: clock.timeScale, frozen: clock.hitstopRemainingMs > 0,
        nearKo: live ? nearKoOf(ctx.combat) : null, siren: live ? siren : "off",
        opponentAzimuth: ctx.playerSeat !== null ? opponentAzimuth(frame, ctx.playerSeat) : 0,
      });
      updateTicks(dt, ctx.combat, ctx, frame);
      lastPhase = ctx.phase;
    },

    dispose() { engine.dispose(); },
  };
  return audio;
}
