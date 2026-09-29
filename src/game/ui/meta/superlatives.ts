// src/game/ui/meta/superlatives.ts (WP6)
// Post-match bragging stats (GAME_DESIGN 7.3.7 with "pries" read as steals, BUILD_PLAN D7). Every value comes from
// the match's real GameEvents for the player's seat; nothing is estimated. rankSuperlatives picks the three most
// extreme against the local personal bests in profile.ts, so the strip leads with the best line even on a loss.

import type { GameEvent, RoundEndReason, Seat } from "../../contracts.ts";
import { SEP, formatInt, formatMs, formatPercent, formatSpeed } from "../hud/format.ts";

export type SuperlativeId =
  | "hardest_hit" | "fastest_strike" | "quickest_deflect" | "deflects" | "crit_rate" | "longest_combo" | "steals" | "clutch_round";

export interface Superlative {
  id: SuperlativeId;
  label: string;
  /** Comparable value for personal bests. */
  value: number;
  /** What the tile prints, e.g. `IMPACT 2.7 m/s · 34`. */
  display: string;
  /** Main count-up number on the tile. */
  headline: number;
  /** Suffix printed after the headline (unit), may be empty. */
  unit: string;
  better: "higher" | "lower";
}

export const SUPERLATIVE_LABEL: Readonly<Record<SuperlativeId, string>> = {
  hardest_hit: "HARDEST HIT",
  fastest_strike: "FASTEST STRIKE",
  quickest_deflect: "QUICKEST DEFLECT",
  deflects: "DEFLECTS",
  crit_rate: "CRIT RATE",
  longest_combo: "LONGEST COMBO",
  steals: "STEALS",
  clutch_round: "CLUTCH ROUND",
};

/** Crit rate needs this many landed strikes before it can be a bragging stat. */
export const CRIT_RATE_MIN_STRIKES = 4;
/** Combos shorter than this are not worth a tile (the combo event starts at 3). */
export const COMBO_MIN = 3;

function damageOf(e: Extract<GameEvent, { type: "strike" }>): number {
  // Stock presets score physically; Arcade scores full. Whichever the rules produced is the one that counted.
  return e.damage > 0 ? e.damage : e.physicalDamage;
}

/** Every superlative the player earned this match (only the ones with a real value). */
export function computeSuperlatives(events: readonly GameEvent[], player: Seat): Superlative[] {
  let hardest: Extract<GameEvent, { type: "strike" }> | null = null;
  let fastest: Extract<GameEvent, { type: "strike" }> | null = null;
  let landed = 0, crits = 0, deflects = 0, steals = 0, lateSteals = 0, combo = 0;
  let quickestDeflectMs = Infinity;
  let clutchRounds = 0;
  let lowThisRound = false;

  for (const e of events) {
    switch (e.type) {
      case "strike":
        if (e.attacker !== player || e.tier !== "strike" || e.guarded) break;
        landed++;
        if (e.crit) crits++;
        if (!hardest || damageOf(e) > damageOf(hardest)) hardest = e;
        if (!fastest || e.vN > fastest.vN) fastest = e;
        break;
      case "deflect":
        if (e.defender !== player) break;
        deflects++;
        if (Number.isFinite(e.pressLeadMs) && Math.abs(e.pressLeadMs) < quickestDeflectMs) quickestDeflectMs = Math.abs(e.pressLeadMs);
        break;
      case "combo":
        if (e.seat === player && e.count > combo) combo = e.count;
        break;
      case "core":
        if (e.stage === "steal" && e.seat === player) { steals++; if (e.late) lateSteals++; }
        break;
      case "low_integrity":
        if (e.seat === player) lowThisRound = true;
        break;
      case "round_end":
        if (e.winner === player && lowThisRound) clutchRounds++;
        lowThisRound = false;
        break;
      case "phase":
        if (e.phase === "round_intro") lowThisRound = false;
        break;
      default:
        break;
    }
  }

  const out: Superlative[] = [];
  if (hardest && damageOf(hardest) > 0) {
    const dmg = Math.round(damageOf(hardest));
    out.push({
      id: "hardest_hit", label: SUPERLATIVE_LABEL.hardest_hit, value: dmg, headline: dmg, unit: "",
      display: `IMPACT ${formatSpeed(hardest.vN)}${SEP}${formatInt(dmg)}`, better: "higher",
    });
  }
  if (fastest && fastest.vN > 0) {
    const v = Math.round(fastest.vN * 100) / 100;
    out.push({
      id: "fastest_strike", label: SUPERLATIVE_LABEL.fastest_strike, value: v, headline: v, unit: "m/s",
      display: formatSpeed(v), better: "higher",
    });
  }
  if (quickestDeflectMs < Infinity) {
    const ms = Math.round(quickestDeflectMs);
    out.push({
      id: "quickest_deflect", label: SUPERLATIVE_LABEL.quickest_deflect, value: ms, headline: ms, unit: "ms",
      display: `${formatMs(ms)} FROM CONTACT`, better: "lower",
    });
  }
  if (deflects > 0) {
    out.push({ id: "deflects", label: SUPERLATIVE_LABEL.deflects, value: deflects, headline: deflects, unit: "", display: `${deflects} TURNED AWAY`, better: "higher" });
  }
  if (landed >= CRIT_RATE_MIN_STRIKES && crits > 0) {
    const rate = crits / landed;
    out.push({
      id: "crit_rate", label: SUPERLATIVE_LABEL.crit_rate, value: Math.round(rate * 1000) / 1000, headline: Math.round(rate * 100), unit: "%",
      display: `${crits} OF ${landed}${SEP}${formatPercent(rate)}`, better: "higher",
    });
  }
  if (combo >= COMBO_MIN) {
    out.push({ id: "longest_combo", label: SUPERLATIVE_LABEL.longest_combo, value: combo, headline: combo, unit: "", display: `${combo} UNANSWERED`, better: "higher" });
  }
  if (steals > 0) {
    out.push({
      id: "steals", label: SUPERLATIVE_LABEL.steals, value: steals, headline: steals, unit: "",
      display: lateSteals > 0 ? `${lateSteals} LATE` : "CORE TAKEN", better: "higher",
    });
  }
  if (clutchRounds > 0) {
    out.push({
      id: "clutch_round", label: SUPERLATIVE_LABEL.clutch_round, value: clutchRounds, headline: clutchRounds, unit: "",
      display: "WON ON LOW INTEGRITY", better: "higher",
    });
  }
  return out;
}

export interface RankedSuperlative extends Superlative {
  newPb: boolean;
  previousBest: number | null;
}

/** How far a value sits beyond the previous best (≥ 1 means a new PB; no history counts as a PB). */
export function extremeness(s: Superlative, previousBest: number | null): number {
  if (previousBest === null || !Number.isFinite(previousBest)) return 1.5;
  if (s.better === "higher") return previousBest > 0 ? s.value / previousBest : s.value > 0 ? 2 : 0;
  return s.value > 0 ? previousBest / s.value : 2;
}

export function isNewPb(s: Superlative, previousBest: number | null): boolean {
  if (previousBest === null || !Number.isFinite(previousBest)) return true;
  return s.better === "higher" ? s.value > previousBest : s.value < previousBest;
}

/** The top `count` superlatives by extremeness against personal bests; ties keep the SuperlativeId order. */
export function rankSuperlatives(
  list: readonly Superlative[], bests: Readonly<Partial<Record<SuperlativeId, number>>>, count = 3,
): RankedSuperlative[] {
  return list
    .map((s, i) => {
      const prev = bests[s.id] ?? null;
      return { s: { ...s, newPb: isNewPb(s, prev), previousBest: prev }, score: extremeness(s, prev), i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, count)
    .map((x) => x.s);
}

/* ───────────────────────── the verdict's gap and goal (EMOTION_BIBLE 8.2) ───────────────────────── */

export type GoalId = "block_3" | "dock_first" | "land_3" | "one_more_hit" | "one_hard_hook";
export const GOAL_LABEL: Readonly<Record<GoalId, string>> = {
  block_3: "BLOCK 3 STRIKES", dock_first: "DOCK FIRST", land_3: "LAND 3 HITS", one_more_hit: "ONE MORE HIT", one_hard_hook: "ONE HARD HOOK",
};
/** The coaching caption REMATCH re-arms once when the goal line was the hint (8.2). */
export const GOAL_SKILL: Readonly<Record<GoalId, "guard" | "dock" | "hit">> = {
  block_3: "guard", dock_first: "dock", land_3: "hit", one_more_hit: "hit", one_hard_hook: "hit",
};

export interface LossVerdict {
  /** One named number: `2 UNGUARDED HOOKS`, `LOCK 6.8 / 8.0 s`, `INTEGRITY 4 LEFT`. */
  gap: string;
  goal: GoalId;
}

/**
 * The gap and the 30-second goal from the loss cause or a skipped tutorial step. Order (8.2): ≥ 2 unguarded hooks
 * or GUARD skipped → BLOCK 3 STRIKES; lost by lock → DOCK FIRST; KO with < 3 landed → LAND 3 HITS; lost by ≤ 5
 * Integrity → ONE MORE HIT; no hook ≥ 0.8 m/s → ONE HARD HOOK. Always names a gap, even when nothing fits.
 */
export function lossVerdict(
  events: readonly GameEvent[], player: Seat, reason: RoundEndReason | null,
  skipped: readonly ("hit" | "guard" | "dock")[], integrityLeft: { player: number; opponent: number }, lockHeldS: { player: number; total: number } | null,
): LossVerdict {
  let unguardedHooks = 0, landed = 0, hardHook = false;
  for (const e of events) {
    if (e.type !== "strike" || e.tier !== "strike") continue;
    if (e.attacker === player && !e.guarded) { landed++; if (e.vN >= 0.8) hardHook = true; }
    if (e.victim === player && !e.guarded && e.nu >= 0.8) unguardedHooks++;
  }
  const margin = Math.round(integrityLeft.opponent - integrityLeft.player);
  if (unguardedHooks >= 2 || skipped.includes("guard")) {
    return { gap: `${unguardedHooks} UNGUARDED HOOK${unguardedHooks === 1 ? "" : "S"}`, goal: "block_3" };
  }
  if (reason === "lock" || skipped.includes("dock")) {
    const gap = lockHeldS ? `LOCK ${lockHeldS.player.toFixed(1)} / ${lockHeldS.total.toFixed(1)} s` : "LOCK 0.0 s";
    return { gap, goal: "dock_first" };
  }
  if ((reason === "ko" || reason === "sudden_death_strike") && landed < 3) return { gap: `${landed} HIT${landed === 1 ? "" : "S"} LANDED`, goal: "land_3" };
  if (margin > 0 && margin <= 5) return { gap: `INTEGRITY ${margin} SHORT`, goal: "one_more_hit" };
  if (!hardHook) return { gap: "NO HOOK OVER 0.8 m/s", goal: "one_hard_hook" };
  return { gap: `INTEGRITY ${Math.max(0, Math.round(integrityLeft.opponent))} LEFT`, goal: "one_more_hit" };
}

/* ───────────────────────── the Bout Card (8.3) ───────────────────────── */

export interface BoutCardInput {
  boutNumber: number;
  callsign: string;
  opponent: string;
  score: { player: number; opponent: number };
  /** Round pips, player's wins as 🟦, losses ⬛, in order. */
  rounds: readonly ("win" | "loss")[];
  events: readonly GameEvent[];
  player: Seat;
}

/** Two lines, copied by COPY BOUT only. Same date, same seed, same scatter for everyone: the numbers compare. */
export function boutCard(i: BoutCardInput): string {
  let top = 0, hookV = 0, cubes = 0, reflexMs: number | null = null;
  for (const e of i.events) {
    if (e.type === "strike" && e.attacker === i.player && !e.guarded) { top = Math.max(top, e.vN); if (e.nu >= 0.8) hookV = Math.max(hookV, e.vN); if (e.thrownCube >= 0) cubes++; }
    if (e.type === "deflect" && e.defender === i.player) { const ms = Math.abs(e.pressLeadMs); if (reflexMs === null || ms < reflexMs) reflexMs = ms; }
  }
  const pips = i.rounds.map((r) => (r === "win" ? "🟦" : "⬛")).join("");
  const facts: string[] = [];
  if (hookV > 0) facts.push(`${hookV.toFixed(2)} m/s hook`); else if (top > 0) facts.push(`${top.toFixed(2)} m/s strike`);
  if (reflexMs !== null) facts.push(`${Math.round(reflexMs)} ms reflex`);
  if (cubes > 0) facts.push(`${cubes} cube${cubes === 1 ? "" : "s"} launched`);
  const line2 = `${pips}   ${facts.join(" · ")}`.trimEnd();
  return `TORQUE LIMIT #${String(i.boutNumber).padStart(4, "0")}  ${i.callsign} ${i.score.player}–${i.score.opponent} ${i.opponent}\n${line2}`;
}
