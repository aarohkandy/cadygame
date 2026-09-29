// src/game/input/haptics.ts (WP3)
// Gamepad rumble on the event frame (EMOTION_BIBLE section 6 haptics column: ms / strong / weak), local player
// only, through the pad that most recently produced input. Haptics are information for the hands, not juice, so
// they are not counted against the feedback budget and they ignore the camera-motion setting. Effects that land
// within 75 ms of each other merge into one pulse (max of each motor, longest duration) so a clash on top of a hit
// never stutters the motors; the KO pulse is the only one over 250 ms.

import type { FeedbackContext, GameEvent } from "../contracts.ts";
import { activeGamepadIndex } from "./gamepad.ts";

export interface RumbleEffect { durationMs: number; strong: number; weak: number }

type PadWithRumble = { vibrationActuator?: { playEffect?: (type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }) => Promise<unknown> } | null };

/** Two effects closer than this merge into one pulse. */
export const RUMBLE_MERGE_MS = 75;
/** The section 6 haptics column for one event from the local player's side; null when the event has no rumble. */
export function rumbleFor(e: GameEvent, ctx: Pick<FeedbackContext, "playerSeat">): RumbleEffect | null {
  const me = ctx.playerSeat;
  if (me === null) return null;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  switch (e.type) {
    case "strike": {
      if (e.tier !== "strike") return null;
      const m = clamp01(e.magnitude);
      if (e.guarded) {
        if (e.attacker === me) return { durationMs: 40, strong: 0.5, weak: 0 };      // thud into their guard
        if (e.victim === me) return { durationMs: 40, strong: 0.3, weak: 0 };        // you blocked
        return null;
      }
      if (e.attacker === me) return m < 0.4 ? { durationMs: 50, strong: 0.15, weak: 0.25 } : { durationMs: 50 + 70 * m, strong: 0.15, weak: clamp01(0.25 + 0.4 * m) };
      if (e.victim === me) return { durationMs: 60 + 80 * m, strong: clamp01(0.4 + 0.5 * m), weak: clamp01(0.3 + 0.4 * m) };
      return null;
    }
    case "whiff":
      return e.seat === me ? { durationMs: 30, strong: 0, weak: 0.2 } : null;         // air pulse
    case "deflect":
      return e.defender === me ? { durationMs: 80, strong: 0.6, weak: 0.6 } : null;
    case "clash":
      return { durationMs: 80, strong: 0.6, weak: 0.6 };
    case "core":
      return e.stage === "steal" ? { durationMs: 60, strong: 0.4, weak: 0.4 } : null;
    case "servo_state":
      return e.seat === me && e.state === "stagger" ? { durationMs: 140, strong: 1, weak: 0.2 } : null;
    case "ko":
      return e.victim === me || e.attacker === me ? { durationMs: 250, strong: 1, weak: 0.6 } : null;
    default:
      return null;
  }
}

/** Merges a new effect into one already playing when they are within the merge window. */
export function mergeRumble(playing: RumbleEffect | null, playingAgeMs: number, next: RumbleEffect): RumbleEffect {
  if (!playing || playingAgeMs > RUMBLE_MERGE_MS) return next;
  return { durationMs: Math.max(playing.durationMs - playingAgeMs, next.durationMs), strong: Math.max(playing.strong, next.strong), weak: Math.max(playing.weak, next.weak) };
}

export const HEAT_PULSE_HZ = 8;
export const HEAT_PULSE_MS = 45;

export interface Haptics {
  onEvents(events: readonly GameEvent[], ctx: FeedbackContext): void;
  /** Heat >= 70 pulses the weak motor at 8 Hz. */
  update(wallDtS: number, ctx: FeedbackContext): void;
  /** Section 6 "Command" row: a 12 ms / 0.15 tick on an aim direction reversal (the pilot calls it). */
  tick(): void;
  readonly lastEffect: RumbleEffect | null;
}

export function createHaptics(getPads?: () => readonly (PadWithRumble | null)[]): Haptics {
  const read = getPads ?? (() => {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    return nav && typeof nav.getGamepads === "function" ? (nav.getGamepads() as unknown as readonly (PadWithRumble | null)[]) : [];
  });
  let lastEffect: RumbleEffect | null = null;
  let lastAtMs = -Infinity;
  let pulseAcc = 0;
  const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

  function play(effect: RumbleEffect): void {
    const index = activeGamepadIndex();
    if (index < 0 && !getPads) return;
    let pads: readonly (PadWithRumble | null)[];
    try { pads = read(); } catch { return; }
    const pad = pads[index >= 0 ? index : 0];
    const act = pad?.vibrationActuator;
    if (!act || typeof act.playEffect !== "function") return;
    const t = now();
    const merged = mergeRumble(lastEffect, t - lastAtMs, effect);
    lastEffect = merged;
    lastAtMs = t;
    void act.playEffect("dual-rumble", { duration: Math.round(merged.durationMs), strongMagnitude: merged.strong, weakMagnitude: merged.weak }).catch(() => undefined);
  }

  return {
    get lastEffect() { return lastEffect; },
    onEvents(events, ctx) {
      let best: RumbleEffect | null = null;
      for (const e of events) {
        const r = rumbleFor(e, ctx);
        if (r && (!best || r.strong + r.weak > best.strong + best.weak)) best = r;
      }
      if (best) play(best);
    },
    tick() { play({ durationMs: 12, strong: 0.15, weak: 0 }); },
    update(wallDtS, ctx) {
      const me = ctx.playerSeat;
      const hot = me !== null && ctx.combat.scoring === "full" && ctx.combat.seats[me].heat >= 70 && (ctx.phase === "fight" || ctx.phase === "sudden_death");
      if (!hot) { pulseAcc = 0; return; }
      pulseAcc += Math.max(0, wallDtS) * HEAT_PULSE_HZ;
      if (pulseAcc >= 1) {
        pulseAcc -= Math.floor(pulseAcc);
        play({ durationMs: HEAT_PULSE_MS, strong: 0, weak: 0.15 });
      }
    },
  };
}
