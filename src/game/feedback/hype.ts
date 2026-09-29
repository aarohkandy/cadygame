// src/game/feedback/hype.ts (WP5)
// Crowd hype (GAME_DESIGN 8.7, steal and late steal replacing pry per BUILD_PLAN D8). A leaky integrator:
//   h += impulse; h -= 0.12 dt; floor 0.15 during a fight (0.4 while spectating a model match).
// Impulses are gated by a 700 ms refractory per reaction type so a flurry reads as one swell, not a wall. The model
// also decides the crowd's audible reaction: a roar for any impulse >= 0.3, an "ohh" on deflects, and, because the
// room is on the pilot's side, a groan instead of a roar when the pilot is stolen from or knocked out.
// Hype drives crowd layers, the music arrangement, and the holographic crowd (WP6 reads audio.hype).
// EMOTION_BIBLE 7 adds the crowd's side: `lean` (−1..1, τ 4 s) swings toward whoever the room is behind — the pilot on
// a streak, a first strike, a steal or a KO pushes it up; the AI doing the same pulls it down. FeedbackFrame.hypeLean
// carries it to the crowd tint above hype 80.

import type { FeedbackContext, GameEvent, MatchPhase, Seat } from "../contracts.ts";

export const HYPE_DECAY_PER_S = 0.12;
export const HYPE_FLOOR_FIGHT = 0.15;
export const HYPE_FLOOR_SPECTATE = 0.4;
export const HYPE_REFRACTORY_MS = 700;
export const ROAR_THRESHOLD = 0.3;

export type HypeReactionType = "strike" | "crit" | "deflect" | "clash" | "steal" | "late_steal" | "ko" | "lock" | "sudden_death" | "stalemate"
  | "combo" | "first_strike" | "near_ko";
export const LEAN_TAU_S = 4;
export type CrowdReaction = "roar" | "ohh" | "groan";

export interface HypeImpulse {
  type: HypeReactionType;
  amount: number;              // signed; applied after refractory
  reaction: CrowdReaction | null;
  lean?: number;               // −1..1 push on the crowd's side (+ = the pilot's), applied after refractory
}

const LIVE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["fight", "sudden_death", "ko", "lock", "time_up"]);

/** +1 when `seat` is the pilot's side, −1 when it is the opponent's, 0 while spectating. */
function side(seat: Seat | null, playerSeat: Seat | null): number {
  return playerSeat === null || seat === null ? 0 : seat === playerSeat ? 1 : -1;
}

/** Impulses for one event from the pilot's side (8.7, EMOTION_BIBLE 7). Pure; the model applies refractory and floors. */
export function hypeImpulsesFor(e: GameEvent, playerSeat: Seat | null, out: HypeImpulse[]): HypeImpulse[] {
  switch (e.type) {
    case "strike": {
      if (e.tier !== "strike") break;
      const m = Math.max(0, Math.min(1, e.magnitude));
      out.push({ type: "strike", amount: 0.04 + 0.1 * m, reaction: null, lean: 0.12 * m * side(e.attacker, playerSeat) });
      if (e.crit) out.push({ type: "crit", amount: 0.12, reaction: null, lean: 0.15 * side(e.attacker, playerSeat) });
      break;
    }
    case "combo":
      // D Momentum: the chant on the player's streak, the groan-then-dip on the AI's.
      out.push({ type: "combo", amount: side(e.seat, playerSeat) < 0 ? -0.05 : 0.12, reaction: side(e.seat, playerSeat) < 0 ? "groan" : null, lean: 0.4 * side(e.seat, playerSeat) });
      break;
    case "first_strike":
      out.push({ type: "first_strike", amount: 0.08, reaction: null, lean: 0.25 * side(e.seat, playerSeat) });
      break;
    case "low_integrity":
      // F Near-KO: the held breath; the room leans toward the hunter.
      out.push({ type: "near_ko", amount: 0.1, reaction: null, lean: -0.3 * side(e.seat, playerSeat) });
      break;
    case "deflect":
      out.push({ type: "deflect", amount: 0.15, reaction: "ohh" });
      break;
    case "clash":
      out.push({ type: "clash", amount: 0.06, reaction: null });
      break;
    case "core":
      if (e.stage === "steal") {
        const pilotRobbed = playerSeat !== null && e.from === playerSeat;
        if (e.late) out.push({ type: "late_steal", amount: 0.6, reaction: pilotRobbed ? "groan" : "roar", lean: 0.6 * side(e.seat, playerSeat) });
        else out.push({ type: "steal", amount: 0.35, reaction: pilotRobbed ? "groan" : "roar", lean: 0.4 * side(e.seat, playerSeat) });
      } else if (e.stage === "lock") {
        const pilotLost = playerSeat !== null && e.seat !== null && e.seat !== playerSeat;
        out.push({ type: "lock", amount: 0.5, reaction: pilotLost ? "groan" : "roar", lean: 0.5 * side(e.seat, playerSeat) });
      }
      break;
    case "ko": {
      const pilotDown = playerSeat !== null && e.victim === playerSeat;
      out.push({ type: "ko", amount: 0.7, reaction: pilotDown ? "groan" : "roar", lean: 0.8 * side(e.attacker, playerSeat) });
      break;
    }
    case "stalemate":
      out.push({ type: "stalemate", amount: -0.1, reaction: null });
      break;
    case "phase":
      if (e.phase === "sudden_death") out.push({ type: "sudden_death", amount: 0, reaction: null });
      break;
    default:
      break;
  }
  return out;
}

export interface HypeModel {
  readonly h: number;
  /** The crowd's side, −1 (the opponent's) .. 1 (the pilot's), τ 4 s; FeedbackFrame.hypeLean. */
  readonly lean: number;
  /** Applies one frame's events; returns the strongest crowd reaction triggered (or null). */
  onEvents(events: readonly GameEvent[], ctx: FeedbackContext, nowMs: number): CrowdReaction | null;
  update(wallDtS: number, ctx: FeedbackContext): void;
  /** The floor that applies in this context. */
  floorFor(ctx: FeedbackContext): number;
  reset(h?: number): void;
}

const REACTION_RANK: Readonly<Record<CrowdReaction, number>> = { ohh: 1, roar: 2, groan: 3 };

export function createHypeModel(): HypeModel {
  let h = 0;
  let lean = 0;
  const lastMs = new Map<HypeReactionType, number>();
  const scratch: HypeImpulse[] = [];

  function floorFor(ctx: FeedbackContext): number {
    if (!LIVE_PHASES.has(ctx.phase)) return 0;
    return ctx.playerSeat === null ? HYPE_FLOOR_SPECTATE : HYPE_FLOOR_FIGHT;
  }

  return {
    get h() { return h; },
    get lean() { return lean; },
    floorFor,

    onEvents(events, ctx, nowMs) {
      let best: CrowdReaction | null = null;
      for (const e of events) {
        scratch.length = 0;
        hypeImpulsesFor(e, ctx.playerSeat, scratch);
        for (const imp of scratch) {
          const last = lastMs.get(imp.type);
          if (last !== undefined && nowMs - last < HYPE_REFRACTORY_MS) continue;
          lastMs.set(imp.type, nowMs);
          if (imp.type === "sudden_death") h = Math.max(h, 0.6);
          else h = Math.max(0, Math.min(1, h + imp.amount));
          if (imp.lean) lean = Math.max(-1, Math.min(1, lean + imp.lean));
          let reaction = imp.reaction;
          if (!reaction && imp.amount >= ROAR_THRESHOLD) reaction = "roar";
          if (reaction && (!best || REACTION_RANK[reaction] > REACTION_RANK[best])) best = reaction;
        }
      }
      return best;
    },

    update(wallDtS, ctx) {
      const dt = Math.max(0, Math.min(0.25, Number.isFinite(wallDtS) ? wallDtS : 0));
      h = Math.max(floorFor(ctx), Math.max(0, h - HYPE_DECAY_PER_S * dt));
      if (h > 1) h = 1;
      lean *= Math.exp(-dt / LEAN_TAU_S);
      if (Math.abs(lean) < 1e-4) lean = 0;
    },

    reset(value = 0) {
      h = Math.max(0, Math.min(1, value));
      lean = 0;
      lastMs.clear();
    },
  };
}
