// src/game/policy/opponent/dda.ts (WP4)
// Invisible dynamic difficulty (GAME_DESIGN 5.5.5). One scalar k in [−1, 1] (+ harder) nudges reaction time,
// perception lag, punish probability, feint recognition, decision temperature, commit tempo (think interval and
// rest), and heavy wind-up length inside the tier's band. It never touches servos, damage, reach, or IK.
//
//  - Signal: perf = EMA((dealt − taken) / (dealt + taken + 10)) from the AI's side, updated when an exchange ends
//    (≥ 600 ms with no integrity change). k moves at most ±0.1 per exchange toward the tier's target.
//  - Two consecutive player match losses against the same entrant and tier: the next match starts at k − 0.2.
//  - In the round after the player loses a round or a match, k may only move toward easier.
//  - New-player ramp: a profile's first 3 matches start at k ≤ −1, −2/3, −1/3 (ctx.config.matchesPlayed).
//  - Frozen in eval, in stock presets, at Champion, when the seat's config turns DDA off, and in the last 10 s of a
//    deciding round.
//
// The ledger (k and the loss streak per entrant and tier) lives for the realm: the browser keeps one built-in
// Worker per entrant and tier alive between matches (seat-drivers.ts), and Node keeps the module loaded.
// Match results are read from the observation stream: rounds_won at each round's first act, and for the final
// round, the side that stood one round from the win (or, in a decider, the last observed integrity and Core).

import type { Observation, PersonalityId, ResetContext, TierId } from "../../contracts.ts";
import { SPARRING_TIER, TIERS, type TierParams } from "./tiers.ts";

/** The tier the seat actually plays (EMOTION_BIBLE 8.4): the configured one, one down under the LLL rule, or SPARRING. */
export type EffectiveTierId = TierId | "sparring";
const TIER_ORDER: readonly TierId[] = ["rookie", "contender", "pro", "champion"];
/** No tier above Rookie until the profile has played this many matches (or swept one 2–0). */
export const FIRST_SESSION_CAP_MATCHES = 3;

export const DDA_EXCHANGE_GAP_S = 0.6;
export const DDA_MAX_STEP = 0.1;
export const DDA_LOSS_STREAK_STEP = 0.2;
export const DDA_LOSS_STREAK_MATCHES = 2;
/**
 * New-player ramp: a profile's first matches (the same 3 as the onboarding gate, 4.8) start with k no higher than
 * −1, −2/3, −1/3, so the tier opens at the easy edge of its band (slower commits, later reactions, longer heavy
 * wind-ups) and the ordinary exchange signal takes it from there. Only a ceiling at match start: it never makes a
 * match harder, and a live-frozen seat (eval, stock presets, Champion, DDA off) never sees it.
 */
export const NEW_PLAYER_MATCHES = 3;
export function newPlayerStartK(matchesPlayed: number | undefined): number {
  if (matchesPlayed === undefined || !(matchesPlayed >= 0) || matchesPlayed >= NEW_PLAYER_MATCHES) return 1;
  return -(1 - Math.floor(matchesPlayed) / NEW_PLAYER_MATCHES);
}
const EMA_ALPHA = 0.35;
const GAIN = 0.5;
const CLUTCH_WINDOW_S = 10;

interface LedgerEntry {
  k: number;
  playerLossStreak: number;
  episodeId: string | null;
  bestOf: number;
  roundsWon: { self: number; opponent: number };
  last: { selfFrac: number; oppFrac: number; coreSigned: number } | null;
}

const ledger = new Map<string, LedgerEntry>();
/** A 2–0 by the player seen in this realm lifts the first-session cap (8.4). */
let playerSwept = false;

/** Forgets every entrant's history (tests, and a profile reset). */
export function clearDdaLedger(): void { ledger.clear(); playerSwept = false; }

/**
 * Tier rules (8.4), from the ledger and the profile: two straight losses to this entrant → one tier down (SPARRING
 * below Rookie), restored silently after a win; nothing above Rookie in a profile's first matches unless it swept
 * one. Frozen seats (eval, stock presets, DDA off) always play exactly what they were configured.
 */
export function effectiveTier(configured: TierId, playerLossStreak: number, matchesPlayed: number | undefined, frozen: boolean): EffectiveTierId {
  if (frozen) return configured;
  let idx = TIER_ORDER.indexOf(configured);
  const capped = !playerSwept && matchesPlayed !== undefined && matchesPlayed >= 0 && matchesPlayed < FIRST_SESSION_CAP_MATCHES;
  if (capped) idx = Math.min(idx, 0);
  if (playerLossStreak >= DDA_LOSS_STREAK_MATCHES) idx -= 1;
  return idx < 0 ? "sparring" : TIER_ORDER[idx];
}

export function tierParams(id: EffectiveTierId): TierParams { return id === "sparring" ? SPARRING_TIER : TIERS[id]; }

/** Current ledger k for an entrant and tier (0 when unseen). */
export function ledgerK(personality: PersonalityId, tier: TierId): number {
  return ledger.get(`${personality}:${tier}`)?.k ?? 0;
}

export interface DdaScales {
  reactionMul: number; lagMul: number; punishMul: number; recognitionMul: number; tempMul: number; slamWindupMul: number;
  /** Commit tempo: think interval and the breath between actions. */
  thinkMul: number;
  /** Arcade pressure (decision.ts): only ever eased, down to half at k = −1, so a new player is pressed gently. */
  pressureMul: number;
}

/** Which way the previous match went, from the AI's side. null: it did not finish (quit) or cannot be told. */
function inferMatchWinner(e: LedgerEntry): "ai" | "player" | null {
  const need = Math.ceil(e.bestOf / 2);
  const aiAt = e.roundsWon.self === need - 1;
  const plAt = e.roundsWon.opponent === need - 1;
  if (e.roundsWon.self >= need) return "ai";
  if (e.roundsWon.opponent >= need) return "player";
  if (aiAt && !plAt) return "ai";
  if (plAt && !aiAt) return "player";
  if (!aiAt && !plAt) return null;
  const last = e.last;
  if (!last) return null;
  if (last.selfFrac <= 0) return "player";
  if (last.oppFrac <= 0) return "ai";
  if (last.coreSigned > 0 && last.coreSigned < 0.05) return "ai";
  if (last.coreSigned < 0 && last.coreSigned > -0.05) return "player";
  return last.selfFrac >= last.oppFrac ? "ai" : "player";
}

export class Dda {
  k = 0;
  private entry: LedgerEntry | null = null;
  private band = 0;
  private target = 0;
  private configFrozen = true;
  private postLossClamp = false;
  private roundStarted = false;
  private perf = 0;
  private exchangeActive = false;
  private dealt = 0;
  private taken = 0;
  private lastChangeT = 0;
  private prevSelf = -1;
  private prevOpp = -1;
  private liveFrozen = false;
  /** True when this seat reports k (DDA configured on for a tier that has a band). */
  reporting = false;
  /** The tier this seat plays this match (8.4 LLL rule and first-session cap). */
  tierId: EffectiveTierId = "contender";
  tier: TierParams = TIERS.contender;

  reset(ctx: ResetContext): void {
    const personality = ctx.config?.personality ?? "backlash";
    const tierId = ctx.config?.tier ?? "contender";
    const tier = TIERS[tierId];
    const key = `${personality}:${tierId}`;
    this.band = tier.dda?.band ?? 0;
    this.target = tier.dda?.target ?? 0;
    this.reporting = !!ctx.config?.dda && tier.dda !== null && ctx.preset === "arcade";
    this.configFrozen = !this.reporting || ctx.mode === "eval";

    let e = ledger.get(key);
    if (!e) {
      e = { k: 0, playerLossStreak: 0, episodeId: null, bestOf: ctx.rules.best_of, roundsWon: { self: 0, opponent: 0 }, last: null };
      ledger.set(key, e);
    }
    this.entry = e;
    if (e.episodeId !== ctx.episode_id) {
      // A new match: settle the previous one first.
      const winner = e.episodeId !== null ? inferMatchWinner(e) : null;
      this.postLossClamp = false;
      if (winner === "ai") {
        e.playerLossStreak++;
        this.postLossClamp = true;
        if (!this.configFrozen && e.playerLossStreak >= DDA_LOSS_STREAK_MATCHES) e.k = clampK(e.k - DDA_LOSS_STREAK_STEP);
      } else if (winner === "player") {
        e.playerLossStreak = 0;
        if (e.roundsWon.self === 0 && e.roundsWon.opponent >= Math.ceil(e.bestOf / 2)) playerSwept = true;
      }
      if (!this.configFrozen) e.k = Math.min(e.k, clampK(newPlayerStartK(ctx.config?.matchesPlayed)));
      e.episodeId = ctx.episode_id;
      e.bestOf = ctx.rules.best_of;
      e.roundsWon = { self: 0, opponent: 0 };
      e.last = null;
      this.perf = 0;
    }
    this.k = this.configFrozen ? (this.reporting ? e.k : 0) : e.k;
    // The tier rules apply to every live arcade seat with DDA on, Champion included (its k stays frozen).
    const tierFrozen = !ctx.config?.dda || ctx.mode === "eval" || ctx.preset !== "arcade";
    this.tierId = effectiveTier(tierId, e.playerLossStreak, ctx.config?.matchesPlayed, tierFrozen);
    this.tier = tierParams(this.tierId);
    this.roundStarted = false;
    this.exchangeActive = false;
    this.dealt = 0; this.taken = 0;
    this.prevSelf = -1; this.prevOpp = -1;
    this.liveFrozen = false;
  }

  /** Scales applied to the tier's knobs this act. */
  scales(out: DdaScales): DdaScales {
    const bk = this.band * this.k;
    out.reactionMul = 1 - bk; out.lagMul = 1 - bk; out.punishMul = 1 + bk; out.recognitionMul = 1 + bk;
    out.tempMul = 1 - bk; out.slamWindupMul = 1 - bk; out.thinkMul = 1 - bk;
    out.pressureMul = this.band > 0 ? 1 - 0.5 * Math.max(0, -this.k) : 1;
    return out;
  }

  /** Feeds one observation; returns true when k changed. */
  observe(obs: Observation, g: Float32Array): boolean {
    const e = this.entry;
    if (!e) return false;
    const r = obs.round;
    if (!this.roundStarted) {
      this.roundStarted = true;
      if (r.rounds_won.self > e.roundsWon.self) this.postLossClamp = true;              // the player lost the last round
      else if (r.rounds_won.opponent > e.roundsWon.opponent) this.postLossClamp = false;
      e.roundsWon = { self: r.rounds_won.self, opponent: r.rounds_won.opponent };
    }
    e.last = { selfFrac: g[0], oppFrac: g[1], coreSigned: g[6] };

    const need = Math.ceil(r.best_of / 2);
    const deciding = r.rounds_won.self === need - 1 && r.rounds_won.opponent === need - 1;
    this.liveFrozen = deciding && r.time_remaining <= CLUTCH_WINDOW_S && (r.phase === "fight" || r.phase === "sudden_death");

    const self = obs.self.integrity, opp = obs.opponent.integrity;
    if (this.prevSelf < 0) { this.prevSelf = self; this.prevOpp = opp; this.lastChangeT = obs.t; return false; }
    const taken = Math.max(0, this.prevSelf - self);
    const dealt = Math.max(0, this.prevOpp - opp);
    this.prevSelf = self; this.prevOpp = opp;
    if (taken > 0 || dealt > 0) {
      this.exchangeActive = true;
      this.taken += taken; this.dealt += dealt;
      this.lastChangeT = obs.t;
      return false;
    }
    if (!this.exchangeActive || obs.t - this.lastChangeT < DDA_EXCHANGE_GAP_S) return false;

    // Exchange over.
    const x = (this.dealt - this.taken) / (this.dealt + this.taken + 10);
    this.perf += EMA_ALPHA * (x - this.perf);
    this.exchangeActive = false;
    this.dealt = 0; this.taken = 0;
    if (this.configFrozen || this.liveFrozen) return false;
    let dk = -(this.perf - this.target) * GAIN;
    dk = Math.max(-DDA_MAX_STEP, Math.min(DDA_MAX_STEP, dk));
    if (this.postLossClamp && dk > 0) dk = 0;
    const next = clampK(e.k + dk);
    if (Math.abs(next - e.k) < 1e-4) return false;
    e.k = next;
    this.k = next;
    return true;
  }

  get frozen(): boolean { return this.configFrozen || this.liveFrozen; }
  get clampedAfterLoss(): boolean { return this.postLossClamp; }
}

function clampK(k: number): number {
  const r = Math.round(k * 1e6) / 1e6;
  return r < -1 ? -1 : r > 1 ? 1 : r;
}
