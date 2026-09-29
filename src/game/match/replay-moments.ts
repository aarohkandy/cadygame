// src/game/match/replay-moments.ts (WP1)
// Earned replays (GAME_DESIGN 8.6, "pry" read as "steal" per BUILD_PLAN D8). A round or match replay
// plays only when its deciding moment qualifies:
//   1. a KO whose lethal strike had magnitude ≥ 0.8 or was a crit;
//   2. a late steal by the round winner;
//   3. a lock within 3 s after a steal;
//   4. a deflect by the round winner that led to the deciding hit within 2 s.
// Priority 1 > 2 > 3 > 4; nothing qualifying means no replay. Also plans the clip: the window around
// the moment and the speed curve (1× lead-in, eased to 0.25× through the event, then 0.6×) fitted to
// the phase length by trimming the lead-in.

import type { GameEvent, RoundEndReason, Seat } from "../contracts.ts";

export const KO_MAGNITUDE_MIN = 0.8;
export const LOCK_AFTER_STEAL_S = 3;
export const DEFLECT_LEAD_S = 2;
export const CLIP_BEFORE_S = 2.5;
export const CLIP_AFTER_S = 1.2;
export const ROUND_REPLAY_S = 2.5;
export const MATCH_REPLAY_S = 3.5;

export type ReplayReason = "ko_impact" | "late_steal" | "lock_after_steal" | "deflect_punish";
export const REPLAY_PRIORITY: Readonly<Record<ReplayReason, 1 | 2 | 3 | 4>> =
  { ko_impact: 1, late_steal: 2, lock_after_steal: 3, deflect_punish: 4 };

export interface ReplayMoment {
  reason: ReplayReason;
  priority: 1 | 2 | 3 | 4;
  /** Sim time the speed curve centres on. */
  eventT: number;
  /** The one readout shown over the replay, from real event fields. */
  label: string;
}

type Strike = Extract<GameEvent, { type: "strike" }>;
type CoreEv = Extract<GameEvent, { type: "core" }>;

export interface RoundDecision { winner: Seat; reason: RoundEndReason; t: number; }

function impactLabel(s: Strike): string {
  return `IMPACT ${s.vN.toFixed(1)} m/s · ${Math.round(s.damage)}`;
}

/** The hit that decided the round: the lethal strike of a KO, or the strike that won sudden death. */
function decidingStrike(events: readonly GameEvent[], d: RoundDecision): Strike | null {
  let best: Strike | null = null;
  for (const e of events) {
    if (e.type !== "strike" || e.attacker !== d.winner || e.t > d.t + 1e-9) continue;
    if (d.reason === "ko" && !e.lethal) continue;
    if (d.reason !== "ko" && d.reason !== "sudden_death_strike") continue;
    if (e.tier !== "strike") continue;
    if (!best || e.t >= best.t) best = e;
  }
  return best;
}

/**
 * Picks the replay moment for one round from that round's events, or null when nothing earned one.
 * `events` may contain events from other rounds only if they are older than the round start; callers
 * pass the round's slice.
 */
export function selectReplayMoment(events: readonly GameEvent[], decision: RoundDecision): ReplayMoment | null {
  const candidates: ReplayMoment[] = [];
  const hit = decidingStrike(events, decision);

  if (decision.reason === "ko" && hit && (hit.magnitude >= KO_MAGNITUDE_MIN || hit.crit)) {
    candidates.push({ reason: "ko_impact", priority: 1, eventT: hit.t, label: impactLabel(hit) });
  }

  let lastLateSteal: CoreEv | null = null;
  let lastSteal: CoreEv | null = null;
  for (const e of events) {
    if (e.type !== "core" || e.stage !== "steal" || e.t > decision.t + 1e-9) continue;
    lastSteal = e;
    if (e.late && e.seat === decision.winner) lastLateSteal = e;
  }
  if (lastLateSteal) {
    candidates.push({
      reason: "late_steal", priority: 2, eventT: lastLateSteal.t,
      label: `LATE STEAL · ${lastLateSteal.remainingS.toFixed(1)} s LEFT`,
    });
  }

  if (decision.reason === "lock" && lastSteal && decision.t - lastSteal.t <= LOCK_AFTER_STEAL_S + 1e-9) {
    candidates.push({
      reason: "lock_after_steal", priority: 3, eventT: decision.t,
      label: `LOCKED · ${(decision.t - lastSteal.t).toFixed(1)} s AFTER STEAL`,
    });
  }

  if (hit) {
    let deflect: Extract<GameEvent, { type: "deflect" }> | null = null;
    for (const e of events) {
      if (e.type !== "deflect" || e.defender !== decision.winner) continue;
      if (e.t <= hit.t + 1e-9 && hit.t - e.t <= DEFLECT_LEAD_S + 1e-9 && (!deflect || e.t > deflect.t)) deflect = e;
    }
    if (deflect) candidates.push({ reason: "deflect_punish", priority: 4, eventT: hit.t, label: impactLabel(hit) });
  }

  let chosen: ReplayMoment | null = null;
  for (const c of candidates) if (!chosen || c.priority < chosen.priority) chosen = c;
  return chosen;
}

/* ───────────────────────── clip plan ───────────────────────── */

export interface ReplayPlan {
  /** Clip window in sim time (inside the available buffer). */
  startT: number;
  endT: number;
  eventT: number;
  /** Wall length the plan fills, seconds. */
  durationS: number;
  /** Clip sim time at a wall offset into the replay (clamped to the window). */
  clipTimeAt(wallS: number): number;
}

function smooth(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}

/** Playback speed at clip time t for an event at eventT (8.6 speed curve). */
export function replaySpeedAt(t: number, eventT: number): number {
  const d = t - eventT;
  if (d < -0.4) return 1;
  if (d < -0.15) return 1 + (0.25 - 1) * smooth((d + 0.4) / 0.25);
  if (d <= 0.15) return 0.25;
  if (d < 0.3) return 0.25 + (0.6 - 0.25) * smooth((d - 0.15) / 0.15);
  return 0.6;
}

const PLAN_DT = 0.002;

/** Wall seconds needed to play [a, b] at the curve's speeds. */
function wallLength(a: number, b: number, eventT: number): number {
  let w = 0;
  for (let t = a; t < b; t += PLAN_DT) w += Math.min(PLAN_DT, b - t) / replaySpeedAt(t, eventT);
  return w;
}

/**
 * Fits a clip of [eventT − 2.5, eventT + 1.2] (clamped to the buffered range) to `durationS` of wall
 * time: the lead-in is trimmed first; if the event and tail alone are still too long, the tail is trimmed.
 */
export function planReplay(eventT: number, bufferStartT: number, bufferEndT: number, durationS: number): ReplayPlan {
  let endT = Math.min(bufferEndT, eventT + CLIP_AFTER_S);
  let startT = Math.max(bufferStartT, eventT - CLIP_BEFORE_S);
  const tail = wallLength(eventT, endT, eventT);
  if (tail >= durationS) {
    startT = eventT;
    while (endT > eventT && wallLength(eventT, endT, eventT) > durationS) endT -= PLAN_DT;
  } else if (wallLength(startT, eventT, eventT) + tail > durationS) {
    // Walk back from the event until the lead-in fills the remaining wall time.
    const budget = durationS - tail;
    const earliest = startT;
    let lead = 0;
    let t = eventT;
    while (t > earliest) {
      const step = Math.min(PLAN_DT, t - earliest);
      const cost = step / replaySpeedAt(t - step, eventT);
      if (lead + cost > budget) break;
      lead += cost;
      t -= step;
    }
    startT = t;
  }
  // Wall → clip-time table at PLAN_DT resolution for allocation-free lookups during playback.
  const walls: number[] = [0];
  const times: number[] = [startT];
  let w = 0;
  for (let t = startT; t < endT - 1e-12; t += PLAN_DT) {
    const step = Math.min(PLAN_DT, endT - t);
    w += step / replaySpeedAt(t, eventT);
    walls.push(w);
    times.push(t + step);
  }
  return {
    startT, endT, eventT, durationS,
    clipTimeAt(wallS: number): number {
      if (wallS <= 0) return startT;
      if (wallS >= walls[walls.length - 1]) return endT;
      let lo = 0, hi = walls.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (walls[mid] <= wallS) lo = mid; else hi = mid; }
      const u = (wallS - walls[lo]) / (walls[hi] - walls[lo]);
      return times[lo] + u * (times[hi] - times[lo]);
    },
  };
}
