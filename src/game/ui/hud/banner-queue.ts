// src/game/ui/hud/banner-queue.ts (WP7)
// Full-screen banner arbitration (GAME_DESIGN 7.1.3): at most one banner at a time, a 250 ms gap between
// banners, and a queued banner older than 1.5 s is dropped. Celebration banners (KNOCKOUT, LOCKED, VICTORY)
// outrank impact banners: pushing one ends a lower-rank banner on screen at once (its exit still plays, so
// the gap still applies) and jumps the queue. Pure and clock-injected; hud-runtime drives it each frame.

export type BannerKind =
  | "round" | "final_round" | "engage" | "sudden_death" | "time" | "knockout" | "locked" | "stolen" | "late_steal"
  | "round_to" | "victory" | "defeat" | "calibrated";

export type BannerTier = "impact" | "celebration";

export interface Banner {
  kind: BannerKind;
  /** Main word(s), Anton display type. */
  title: string;
  /** Optional line under the title (plate type), e.g. the winner's name. */
  sub: string | null;
  /** Optional sticker slapped on the band, e.g. SHORTED OUT. */
  sticker: string | null;
  tier: BannerTier;
  /** Seat colour for the band lip, or null for the show's neutral band. */
  team: "atlas" | "blaze" | null;
  holdMs: number;
  /** Set by the queue when pushed. */
  queuedAtMs?: number;
}

/** Letter slots in the banner title; the last slot takes any remainder of a longer title. */
export const BANNER_LETTERS = 24;
export const BANNER_GAP_MS = 250;
export const BANNER_STALE_MS = 1500;
/** Exit animation length (broadcast tier exit). */
export const BANNER_EXIT_MS = 140;

const TIER_RANK: Readonly<Record<BannerTier, number>> = { impact: 1, celebration: 2 };

export interface BannerQueueState {
  /** Banner on screen (entering or holding), null when none. */
  current: Banner | null;
  /** Banner playing its exit, null when none. */
  exiting: Banner | null;
  /** Increments whenever `current` changes, so a renderer can restart animations cheaply. */
  revision: number;
}

export interface BannerQueue extends Readonly<BannerQueueState> {
  push(banner: Banner, nowMs: number): void;
  /** Advances timers; returns true when current or exiting changed. */
  update(nowMs: number): boolean;
  clear(): void;
  readonly pending: number;
}

export function createBannerQueue(opts: { gapMs?: number; staleMs?: number; exitMs?: number } = {}): BannerQueue {
  const gapMs = opts.gapMs ?? BANNER_GAP_MS;
  const staleMs = opts.staleMs ?? BANNER_STALE_MS;
  const exitMs = opts.exitMs ?? BANNER_EXIT_MS;

  let current: Banner | null = null;
  let currentStart = 0;
  let exiting: Banner | null = null;
  let exitStart = 0;
  /** Earliest time the next banner may start. */
  let freeAt = -Infinity;
  let revision = 0;
  const queue: Banner[] = [];

  function endCurrent(nowMs: number): void {
    if (!current) return;
    exiting = current;
    exitStart = nowMs;
    current = null;
    freeAt = nowMs + gapMs;
    revision++;
  }

  const api: BannerQueue = {
    get current() { return current; },
    get exiting() { return exiting; },
    get revision() { return revision; },
    get pending() { return queue.length; },

    push(banner: Banner, nowMs: number): void {
      const b: Banner = { ...banner, queuedAtMs: nowMs };
      if (current && TIER_RANK[b.tier] > TIER_RANK[current.tier]) {
        endCurrent(nowMs);
        // Outranking banners skip the queue and the gap: the exit and the slam overlap by design.
        freeAt = nowMs;
        queue.unshift(b);
        return;
      }
      // Keep rank order among queued banners, stable within a rank.
      let i = queue.length;
      while (i > 0 && TIER_RANK[queue[i - 1].tier] < TIER_RANK[b.tier]) i--;
      queue.splice(i, 0, b);
    },

    update(nowMs: number): boolean {
      const before = revision;
      let changed = false;
      if (exiting && nowMs - exitStart >= exitMs) { exiting = null; changed = true; }
      if (current && nowMs - currentStart >= current.holdMs) endCurrent(nowMs);
      if (!current) {
        while (queue.length > 0 && nowMs - (queue[0].queuedAtMs ?? nowMs) > staleMs) queue.shift();
        if (queue.length > 0 && nowMs >= freeAt) {
          current = queue.shift() as Banner;
          currentStart = nowMs;
          revision++;
        }
      }
      return changed || revision !== before;
    },

    clear(): void {
      queue.length = 0;
      if (current || exiting) revision++;
      current = null;
      exiting = null;
      freeAt = -Infinity;
    },
  };
  return api;
}

/* ───────────────────────── kinetic callouts ───────────────────────── */

// The callout slams (EMOTION_BIBLE 5.7: FIRST BLOOD, CRIT, DEFLECT, STREAK, STEAL). One on screen at a time, like
// the banners, but they never queue: a callout that cannot show now is stale by the time it could. A new one
// replaces the one up once that has been read (CALLOUT_READ_MS), or at once when it outranks it. The slam is
// 240 ms in, a hold, 180 ms out (CSS tl-callout-life); the hold is the only part longer than the in-match cap.

export type CalloutKind = "first_strike" | "crit" | "deflect" | "streak" | "steal";
export type CalloutTone = "team-atlas" | "team-blaze" | "crit" | "block" | "neutral";

export interface Callout {
  kind: CalloutKind;
  word: string;
  sub: string | null;
  tone: CalloutTone;
}

/** 240 ms slam in, 530 ms hold, 180 ms out. */
export const CALLOUT_IN_MS = 240;
export const CALLOUT_OUT_MS = 180;
export const CALLOUT_HOLD_MS = 950;
export const CALLOUT_READ_MS = 380;
/** Longest word the letter pool holds; the last letter slot takes any remainder. */
export const CALLOUT_LETTERS = 14;

const CALLOUT_RANK: Readonly<Record<CalloutKind, number>> = { steal: 1, crit: 1, deflect: 2, streak: 2, first_strike: 3 };

export interface CalloutSlot {
  readonly current: Callout | null;
  /** Increments whenever `current` changes. */
  readonly revision: number;
  /** Returns true when the callout went on screen. */
  push(c: Callout, nowMs: number): boolean;
  /** Returns true when the callout on screen timed out. */
  update(nowMs: number): boolean;
  clear(): void;
}

export function createCalloutSlot(holdMs = CALLOUT_HOLD_MS, readMs = CALLOUT_READ_MS): CalloutSlot {
  let current: Callout | null = null;
  let since = 0;
  let revision = 0;
  return {
    get current() { return current; },
    get revision() { return revision; },
    push(c, nowMs) {
      if (current && nowMs - since < readMs && CALLOUT_RANK[c.kind] <= CALLOUT_RANK[current.kind]) return false;
      current = c; since = nowMs; revision++;
      return true;
    },
    update(nowMs) {
      if (!current || nowMs - since < holdMs) return false;
      current = null; revision++;
      return true;
    },
    clear() { if (current) revision++; current = null; },
  };
}
