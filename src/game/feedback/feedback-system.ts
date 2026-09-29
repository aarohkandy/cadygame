// src/game/feedback/feedback-system.ts (WP5)
// The one bus subscriber that turns game events into feel (BUILD_PLAN 5: nobody calls feedback directly). The
// factory subscribes itself; each frame's events fan out, in step order, to:
//   juice      camera shake, kick, FOV punch, damage edges, post pulses, victim vibration, KO focus (8.1, 8.2)
//   audio      one-shots, beds, crowd reactions, music, ducking (9.x, synthesized)
//   hype       the crowd model that drives crowd audio, the music arrangement, and the holographic crowd (8.7)
//   announcer  ROOK and DR. VALE captions with the optional synthesized voice (8.5, D9)
//   haptics    gamepad rumble (8.1)
// A subsystem that throws never starves the others; the first error is rethrown after everyone has run.
// It also writes the per-render-frame FeedbackFrame (EMOTION_BIBLE 11.9): render-only link vibration per seat (the
// victim's contact-frame flinch held through the freeze, the pilot's heat tremor), the crit / clash / KO impact frame,
// the lens smear on a heavy hit taken, the striking link's LED flare, the deck edge flash and the hit light pulse, and
// the crowd's lean. WP1 robot-view / post-stack and WP3 juice read it; nobody else writes it.

import { otherSeat, type CreateFeedbackSystem, type FeedbackContext, type FeedbackFrame, type FeedbackSystem, type GameEvent, type PhysicsFrame, type Seat, type ShowEvent } from "../contracts.ts";
import type { PilotControllerExt } from "../input/pilot-controller.ts";
import { createAnnouncer, type Announcer } from "../announcer/announcer.ts";
import { createHostVoice, type HostVoice } from "../announcer/host-voice.ts";
import { createAudioEngine, type AudioEngineOptions } from "../audio/audio-engine.ts";
import { createFeedbackAudio, type FeedbackAudio } from "../audio/feedback-audio.ts";
import { HOSTS } from "../brand/hosts.ts";
import { createJuice, type JuiceSystem } from "../camera/juice.ts";
import { HITSTOP, hitstopMsFor } from "../combat/tuning.ts";
import { createHaptics, type Haptics } from "../input/haptics.ts";
import { createHypeModel, type HypeModel } from "./hype.ts";

export interface FeedbackSystemExt extends FeedbackSystem {
  /** 11.9 FeedbackFrame, rewritten every update(); read by robot-view, post-stack and juice. */
  readonly frame: FeedbackFrame;
  readonly audio: FeedbackAudio;
  readonly juiceSystem: JuiceSystem;
  readonly hypeModel: HypeModel;
  readonly announcer: Announcer;
  readonly hostVoice: HostVoice;
  readonly haptics: Haptics;
}

export interface FeedbackSystemOptions {
  audio?: AudioEngineOptions;
}

type Deps = Parameters<CreateFeedbackSystem>[0];

/** Feel numbers from section 6, in mm and ms. */
export const FEEL = Object.freeze({
  vibLightMm: 0.8, vibHeavyMm: 1.5, vibTauMs: 40,
  tremorHeatFrom: 70, tremorMaxMm: 0.25,
  impactFrames: 2, impactHalfMs: 60, koImpactFrames: 4,
  smearTauS: 6,
  ledFlareMs: 250, ledTickMs: 20,          // one 60 Hz frame, gone by the next
  deckFlashMs: 120, hitLightMs: 120, stealFlashMs: 300, koFlashMs: 700,
});

export function emptyFeedbackFrame(): FeedbackFrame {
  return {
    vibration: { atlas: 0, blaze: 0 }, impactFrame: 0, lensSmear: 0,
    ledFlare: { atlas: null, blaze: null }, deckFlash: { seat: null, ms: 0 },
    hitLight: { on: false, seat: "atlas", ms: 0 }, hypeLean: 0,
  };
}

/** The timers behind FeedbackFrame. Pure over events and wall time, so the harness can drive it without a renderer. */
export function createFeelFrame(hitstopRemainingMs: () => number) {
  const frame = emptyFeedbackFrame();
  const vibPeak: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const vibHoldMs: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const flareMs: Record<Seat, number> = { atlas: 0, blaze: 0 };
  let impactFramesLeft = 0, impactHalfMs = 0;

  const flinch = (seat: Seat, mm: number, holdMs: number) => {
    vibPeak[seat] = Math.max(vibPeak[seat], mm);
    vibHoldMs[seat] = Math.max(vibHoldMs[seat], holdMs);
  };
  const impact = (frames: number) => { impactFramesLeft = Math.max(impactFramesLeft, frames); impactHalfMs = FEEL.impactHalfMs; };

  return {
    frame,
    onEvents(events: readonly GameEvent[], ctx: FeedbackContext): void {
      for (const e of events) {
        const hs = hitstopMsFor(e, ctx.preset, ctx.playerSeat);
        switch (e.type) {
          case "strike": {
            if (e.tier !== "strike" || e.guarded) break;
            const heavy = e.magnitude >= HITSTOP.heavyM;
            flinch(e.victim, heavy ? FEEL.vibHeavyMm : FEEL.vibLightMm, hs);
            if (heavy) {
              frame.ledFlare[e.attacker] = e.tool; flareMs[e.attacker] = FEEL.ledFlareMs;
              frame.deckFlash.seat = e.victim; frame.deckFlash.ms = FEEL.deckFlashMs;
              frame.hitLight.on = true; frame.hitLight.seat = e.victim; frame.hitLight.ms = FEEL.hitLightMs;
            } else {
              frame.ledFlare[e.victim] = e.zone; flareMs[e.victim] = FEEL.ledTickMs;
            }
            if (e.crit) impact(FEEL.impactFrames);
            if (e.victim === ctx.playerSeat && heavy) frame.lensSmear = 1;
            break;
          }
          case "clash":
            impact(FEEL.impactFrames);
            flinch("atlas", FEEL.vibLightMm, hs); flinch("blaze", FEEL.vibLightMm, hs);
            break;
          case "ko":
            impact(FEEL.koImpactFrames);
            flinch(e.victim, FEEL.vibHeavyMm, hs);
            frame.deckFlash.seat = e.attacker; frame.deckFlash.ms = FEEL.koFlashMs;
            break;
          case "core":
            if (e.stage === "steal" && e.from) { frame.deckFlash.seat = e.from; frame.deckFlash.ms = FEEL.stealFlashMs; }
            break;
          default: break;
        }
      }
    },
    update(wallDtS: number, ctx: FeedbackContext, hypeLean: number, pilotTremorMm = 0): void {
      const dtMs = Math.max(0, Math.min(250, wallDtS * 1000));
      const frozen = hitstopRemainingMs() > 0;
      for (const seat of ["atlas", "blaze"] as const) {
        // The flinch holds for the hit's own freeze length and for as long as the clock is actually frozen, then decays.
        if (vibHoldMs[seat] > 0) vibHoldMs[seat] = Math.max(0, vibHoldMs[seat] - dtMs);
        else if (!frozen) vibPeak[seat] *= Math.exp(-dtMs / FEEL.vibTauMs);
        if (vibPeak[seat] < 0.01) vibPeak[seat] = 0;
        // The pilot's own housing carries a heat tremor above 70 (3.2 render-only life).
        const heat = seat === ctx.playerSeat ? ctx.combat.seats[seat].heat : 0;
        const tremor = heat > FEEL.tremorHeatFrom ? FEEL.tremorMaxMm * Math.min(1, (heat - FEEL.tremorHeatFrom) / (100 - FEEL.tremorHeatFrom)) : 0;
        frame.vibration[seat] = Math.min(1.5, Math.max(vibPeak[seat], tremor, seat === ctx.playerSeat ? pilotTremorMm : 0));
        if (flareMs[seat] > 0) { flareMs[seat] -= dtMs; if (flareMs[seat] <= 0) { flareMs[seat] = 0; frame.ledFlare[seat] = null; } }
      }
      if (impactFramesLeft > 0) { impactFramesLeft--; frame.impactFrame = 1; }
      else if (impactHalfMs > 0) { impactHalfMs = Math.max(0, impactHalfMs - dtMs); frame.impactFrame = 0.5; }
      else frame.impactFrame = 0;
      frame.lensSmear *= Math.exp(-wallDtS / FEEL.smearTauS);
      if (frame.lensSmear < 0.005) frame.lensSmear = 0;
      if (frame.deckFlash.ms > 0) { frame.deckFlash.ms = Math.max(0, frame.deckFlash.ms - dtMs); if (frame.deckFlash.ms === 0) frame.deckFlash.seat = null; }
      if (frame.hitLight.ms > 0) { frame.hitLight.ms = Math.max(0, frame.hitLight.ms - dtMs); if (frame.hitLight.ms === 0) frame.hitLight.on = false; }
      frame.hypeLean = hypeLean;
    },
  };
}

export function createFeedbackSystemWith(deps: Deps, opts: FeedbackSystemOptions = {}): FeedbackSystemExt {
  const { clock, ui, settings, bus } = deps;
  const hypeModel = createHypeModel();
  const engine = createAudioEngine(opts.audio);
  const audio = createFeedbackAudio({ engine, hype: hypeModel, clock, ui, settings });
  const juiceSystem = createJuice(hitstopMsFor);
  const hostVoice = createHostVoice({ settings, engine, hosts: HOSTS });
  const announcer = createAnnouncer({ ui, settings, voice: hostVoice, hype: () => hypeModel.h / 100 });
  const haptics = createHaptics();
  const feel = createFeelFrame(() => clock.hitstopRemainingMs);
  const pilot = deps.pilot as PilotControllerExt | undefined;
  // 3.4 / section 6: an aim reversal is a 12 ms tick in the hand, inside the pointer event.
  const unsubMotion = pilot?.onMotion ? pilot.onMotion((_counts, reversed) => { if (reversed) haptics.tick(); }) : null;
  const shows: ShowEvent[] = [];
  // 3.4 gripper stages and the ghost leash crossings (0.6 tick, 1.0 buzz) are the pilot's, sounded here (WP8 recipes).
  let lastGrip = pilot?.gripStage ?? "none";
  let lastLeash = 0;
  function pilotSounds(ctx: FeedbackContext): void {
    if (!pilot || ctx.playerSeat === null) return;
    const g = pilot.gripStage;
    if (g !== lastGrip) {
      if (g === "target") engine.playSfx("gripper_roll", 0.6);
      else if (g === "lock") engine.playSfx("gripper_lock", 0.8);
      else if (g === "contact") engine.playSfx("gripper_contact", 1);
      lastGrip = g;
    }
    const ls = pilot.ghost.leashStretch;
    if (lastLeash < 0.6 && ls >= 0.6) engine.playSfx("tick", 0.35);
    if (lastLeash < 1 && ls >= 1) engine.playSfx("buzzer", 0.25);
    lastLeash = ls;
  }

  function guarded(run: (() => void)[]): void {
    let first: unknown = null;
    for (const fn of run) {
      try { fn(); } catch (err) { if (first === null) first = err; }
    }
    if (first !== null) throw first;
  }

  const unsubscribe = bus.subscribe((events: readonly GameEvent[], ctx: FeedbackContext) => {
    guarded([
      () => feel.onEvents(events, ctx),
      () => juiceSystem.onEvents(events, ctx),
      () => audio.onEvents(events, ctx),
      () => announcer.onEvents(events, ctx),
      () => { shows.length = 0; for (const e of events) if (e.type === "show") shows.push(e.show); if (shows.length) announcer.onShowEvents(shows, ctx); },
      () => haptics.onEvents(events, ctx),
    ]);
  });

  const system: FeedbackSystemExt = {
    frame: feel.frame,
    juice: juiceSystem.out,
    audio,
    juiceSystem,
    hypeModel,
    announcer,
    hostVoice,
    haptics,

    update(wallDtS: number, ctx: FeedbackContext, frame: PhysicsFrame) {
      guarded([
        () => feel.update(wallDtS, ctx, hypeModel.lean, pilot?.tremorMm ?? 0),
        () => { const opp = ctx.playerSeat ? deps.policy?.()[otherSeat(ctx.playerSeat)] : null; announcer.setAffect(opp?.affect ?? null); },
        () => pilotSounds(ctx),
        () => juiceSystem.update(wallDtS, ctx, settings.get()),
        () => audio.update(wallDtS, ctx, frame),
        () => announcer.update(wallDtS, ctx),
        () => haptics.update(wallDtS, ctx),
      ]);
    },

    dispose() {
      unsubscribe();
      unsubMotion?.();
      announcer.dispose();
      hostVoice.dispose();
      audio.dispose();
    },
  };
  return system;
}

export const createFeedbackSystem: CreateFeedbackSystem = (deps) => createFeedbackSystemWith(deps);
