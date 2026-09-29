// src/game/ui/meta/profile.ts (WP6)
// The local profile: W–L per entrant and tier, personal bests for the verdict's superlatives, the loss streak per
// entrant (the LLL guard, 8.4), medal stamps per opponent (8.3), the once-ever STABLE hint, and the opponent memory
// (4.5, 11.9) the director passes through ResetContext. localStorage key torquelimit.profile.v3; every storage
// access is guarded (blocked storage, quota, corrupt JSON) and falls back to memory. A match updates the profile
// exactly once per match id, and which PBs it set is remembered so re-opening the verdict shows the same stamps.

import { EMPTY_OPPONENT_MEMORY, type DriverSpec, type GameEvent, type OpponentMemory, type Seat, type TierId } from "../../contracts.ts";
import { SUPERLATIVE_LABEL, isNewPb, type Superlative, type SuperlativeId } from "./superlatives.ts";

export const PROFILE_KEY = "torquelimit.profile.v3";
export type Medal = "bronze" | "silver" | "gold";
export const MEDAL_ORDER: readonly Medal[] = ["bronze", "silver", "gold"];
/** Match ids remembered for idempotent updates. */
export const APPLIED_MATCH_MEMORY = 40;

export type ProfileStorage = Pick<Storage, "getItem" | "setItem">;

export interface WinLoss { w: number; l: number }

export interface ProfileData {
  version: 3;
  /** entrant key → tier key ("rookie" … or "-" for tierless entrants) → record. */
  records: Record<string, Record<string, WinLoss>>;
  bests: Partial<Record<SuperlativeId, number>>;
  /** Most recent first: match id → the PB ids that match set. */
  applied: { id: string; newPbs: SuperlativeId[] }[];
  /** entrant key → straight losses (reset by a win). */
  streaks: Record<string, number>;
  /** entrant key → medals stamped on its card (8.3). */
  medals: Record<string, Medal[]>;
  /** entrant key → what it remembers of this pilot (4.5). */
  memory: Record<string, OpponentMemory>;
  /** The 8-word STABLE camera line has been shown (once ever, 8.2). */
  stableHintShown: boolean;
}

export interface MatchOutcomeInput {
  matchId: string;
  opponent: DriverSpec;
  won: boolean;
  superlatives: readonly Superlative[];
  /** Round score, for the medal ladder (2–0 = SILVER; 2–0 with a lock or a clutch steal = GOLD). */
  roundsWon?: { player: number; opponent: number };
  lockOrClutch?: boolean;
  /** Medals count from match 2 (showKit table); match 1's win still counts for BRONZE. */
  medalsOn?: boolean;
}

export interface ProfileStore {
  get(): Readonly<ProfileData>;
  subscribe(fn: () => void): () => void;
  /** Applies a finished match once; returns the PB ids it set (the same list on repeat calls). */
  applyMatch(input: MatchOutcomeInput): SuperlativeId[];
  record(opponent: DriverSpec, tier?: TierId | null): WinLoss;
  /** Total W–L against every entrant and tier. */
  totals(): WinLoss;
  /** PBs as they were before `matchId` was applied (for ranking post-match tiles). */
  bestsBefore(matchId: string): Partial<Record<SuperlativeId, number>>;
  /** Straight losses to this entrant (LLL rule). */
  lossStreak(opponent: DriverSpec): number;
  medals(opponent: DriverSpec): readonly Medal[];
  /** The medal `applyMatch` stamped for this match id, if any. */
  medalFor(matchId: string): Medal | null;
  memory(opponent: DriverSpec): OpponentMemory;
  remember(opponent: DriverSpec, mem: OpponentMemory): void;
  /** Returns true the first time only: the caller shows the STABLE hint. */
  claimStableHint(): boolean;
  reset(): void;
}

export function emptyProfile(): ProfileData {
  return { version: 3, records: {}, bests: {}, applied: [], streaks: {}, medals: {}, memory: {}, stableHintShown: false };
}

/** The next stamp on an opponent's card, or null when the ladder is complete or the result earns none. */
export function medalEarned(have: readonly Medal[], won: boolean, score: { player: number; opponent: number } | undefined, lockOrClutch: boolean): Medal | null {
  if (!won) return null;
  const sweep = score !== undefined && score.opponent === 0 && score.player >= 2;
  const ladder: Medal[] = ["bronze"];
  if (sweep) ladder.push("silver");
  if (sweep && lockOrClutch) ladder.push("gold");
  for (const m of ladder) if (!have.includes(m)) return m;
  return null;
}

/**
 * What the opponent remembers of a match (bible 4.5): the pilot's best move, the side it got hurt on, how long the
 * pilot took to attack, feints that worked (a whiff of the pilot's inside 600 ms of an opponent tell counts), and a
 * grudge that grows on the opponent's losses and shrinks on its wins. Pure, so the recorder can re-derive it.
 */
export function memoryFrom(events: readonly GameEvent[], player: Seat, won: boolean, prev: OpponentMemory): OpponentMemory {
  let best: Extract<GameEvent, { type: "strike" }> | null = null;
  let hurtLeft = 0, hurtRight = 0, feints = 0;
  let roundStart: number | null = null;
  let firstAttack: number | null = null;
  let lastOppWhiffT = -Infinity;
  for (const e of events) {
    if (e.type === "phase" && e.phase === "round_intro" && roundStart === null) roundStart = e.t;
    if (e.type === "strike" && e.attacker === player && e.tier === "strike") {
      if (firstAttack === null) firstAttack = e.t;
      if (!e.guarded) {
        if (!best || e.vN > best.vN) best = e;
        if (e.normal[1] < -0.2) hurtRight++; else if (e.normal[1] > 0.2) hurtLeft++;
      }
    }
    if (e.type === "whiff" && e.seat !== player) lastOppWhiffT = e.t;
    if (e.type === "strike" && e.attacker === player && e.t - lastOppWhiffT <= 0.6) feints++;
  }
  const bestMove = best ? (best.nu >= 0.8 ? "hook" : best.crit ? "crit" : "jab") : prev.bestMove;
  const hurtSide: OpponentMemory["hurtSide"] = hurtLeft > hurtRight ? -1 : hurtRight > hurtLeft ? 1 : best ? 0 : prev.hurtSide;
  const t0 = roundStart ?? 0;
  return {
    bestMove,
    hurtSide,
    timeToFirstAttackS: firstAttack !== null ? Math.round((firstAttack - t0) * 10) / 10 : prev.timeToFirstAttackS,
    feintsWorked: prev.feintsWorked + feints,
    grudge: Math.max(0, Math.min(3, prev.grudge + (won ? 1 : -1))),
  };
}

/** Stable key per entrant: built-ins by personality, user models by content hash, bridges by URL. */
export function entrantKey(spec: DriverSpec): string {
  switch (spec.kind) {
    case "builtin": return `builtin:${spec.personality}`;
    case "module": case "trajectory": return `${spec.kind}:${spec.sha256}`;
    case "bridge": return `bridge:${spec.url}`;
    case "proxy": return `proxy:${spec.bot}`;
    case "human": return "human";
  }
}

export function tierKey(spec: DriverSpec): string {
  return spec.kind === "builtin" ? spec.tier : "-";
}

const SUPERLATIVE_IDS = Object.keys(SUPERLATIVE_LABEL) as SuperlativeId[];

function count(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function cleanMemory(raw: unknown): OpponentMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
  return {
    bestMove: typeof m.bestMove === "string" && m.bestMove.length <= 24 ? m.bestMove : null,
    hurtSide: m.hurtSide === -1 || m.hurtSide === 1 ? m.hurtSide : 0,
    timeToFirstAttackS: typeof m.timeToFirstAttackS === "number" && Number.isFinite(m.timeToFirstAttackS) ? m.timeToFirstAttackS : null,
    feintsWorked: num(m.feintsWorked, 0, 999, 0),
    grudge: num(m.grudge, 0, 3, 0),
  };
}

/** Validates stored JSON into ProfileData, dropping anything malformed (and every cut v1 field: rep, league…). */
export function sanitizeProfile(raw: unknown): ProfileData {
  const out = emptyProfile();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.streaks && typeof r.streaks === "object") {
    for (const [key, n] of Object.entries(r.streaks as Record<string, unknown>)) if (key.length <= 200) out.streaks[key] = count(n);
  }
  if (r.medals && typeof r.medals === "object") {
    for (const [key, list] of Object.entries(r.medals as Record<string, unknown>)) {
      if (key.length > 200 || !Array.isArray(list)) continue;
      out.medals[key] = MEDAL_ORDER.filter((m) => list.includes(m));
    }
  }
  if (r.memory && typeof r.memory === "object") {
    for (const [key, m] of Object.entries(r.memory as Record<string, unknown>)) {
      const clean = key.length <= 200 ? cleanMemory(m) : null;
      if (clean) out.memory[key] = clean;
    }
  }
  out.stableHintShown = r.stableHintShown === true;
  if (r.records && typeof r.records === "object") {
    for (const [key, tiers] of Object.entries(r.records as Record<string, unknown>)) {
      if (!tiers || typeof tiers !== "object" || key.length > 200) continue;
      const clean: Record<string, WinLoss> = {};
      for (const [tier, wl] of Object.entries(tiers as Record<string, unknown>)) {
        if (!wl || typeof wl !== "object") continue;
        const v = wl as Record<string, unknown>;
        clean[tier] = { w: count(v.w), l: count(v.l) };
      }
      out.records[key] = clean;
    }
  }
  if (r.bests && typeof r.bests === "object") {
    for (const id of SUPERLATIVE_IDS) {
      const v = (r.bests as Record<string, unknown>)[id];
      if (typeof v === "number" && Number.isFinite(v)) out.bests[id] = v;
    }
  }
  if (Array.isArray(r.applied)) {
    for (const a of r.applied.slice(0, APPLIED_MATCH_MEMORY)) {
      if (!a || typeof a !== "object" || typeof (a as { id?: unknown }).id !== "string") continue;
      const pbs = Array.isArray((a as { newPbs?: unknown }).newPbs) ? (a as { newPbs: unknown[] }).newPbs : [];
      out.applied.push({
        id: (a as { id: string }).id,
        newPbs: pbs.filter((p): p is SuperlativeId => typeof p === "string" && (SUPERLATIVE_IDS as string[]).includes(p)),
      });
    }
  }
  return out;
}

interface AppliedSnapshot { bestsBefore: Partial<Record<SuperlativeId, number>>; medal: Medal | null }

/**
 * The W-L against one entrant, read out of a profile snapshot. Pure, so a component that already
 * holds the snapshot (via useSyncExternalStore) can derive the line without going through the store
 * and without the store's identity becoming a hidden dependency. `tier` null totals every tier.
 */
export function recordIn(data: Readonly<ProfileData>, opponent: DriverSpec, tier?: TierId | null): WinLoss {
  const byTier = data.records[entrantKey(opponent)];
  if (!byTier) return { w: 0, l: 0 };
  if (tier === null) {
    let w = 0, l = 0;
    for (const r of Object.values(byTier)) { w += r.w; l += r.l; }
    return { w, l };
  }
  const r = byTier[tier ?? tierKey(opponent)];
  return r ? { w: r.w, l: r.l } : { w: 0, l: 0 };
}

export function createProfileStore(opts: { storage?: ProfileStorage | null } = {}): ProfileStore {
  const storage: ProfileStorage | null = opts.storage !== undefined
    ? opts.storage
    : (() => {
      try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
    })();

  let data: ProfileData = emptyProfile();
  try {
    const text = storage?.getItem(PROFILE_KEY);
    if (text) data = sanitizeProfile(JSON.parse(text));
  } catch {
    data = emptyProfile();
  }
  const listeners = new Set<() => void>();
  // In-memory only: the bests each match was ranked against, for this session.
  const snapshots = new Map<string, AppliedSnapshot>();

  function commit(next: ProfileData): void {
    data = next;
    try { storage?.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: memory keeps working */ }
    for (const fn of Array.from(listeners)) fn();
  }

  const api: ProfileStore = {
    get: () => data,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    applyMatch(input) {
      const prior = data.applied.find((a) => a.id === input.matchId);
      if (prior) return prior.newPbs.slice();
      const key = entrantKey(input.opponent);
      const tier = tierKey(input.opponent);
      const records = { ...data.records, [key]: { ...(data.records[key] ?? {}) } };
      const wl = records[key][tier] ?? { w: 0, l: 0 };
      records[key][tier] = input.won ? { w: wl.w + 1, l: wl.l } : { w: wl.w, l: wl.l + 1 };

      const bestsBefore = { ...data.bests };
      const bests = { ...data.bests };
      const newPbs: SuperlativeId[] = [];
      for (const s of input.superlatives) {
        const prev = bests[s.id] ?? null;
        if (isNewPb(s, prev)) { bests[s.id] = s.value; newPbs.push(s.id); }
      }
      const streaks = { ...data.streaks, [key]: input.won ? 0 : (data.streaks[key] ?? 0) + 1 };
      const medals = { ...data.medals };
      let medal: Medal | null = null;
      if (input.medalsOn !== false) {
        medal = medalEarned(data.medals[key] ?? [], input.won, input.roundsWon, input.lockOrClutch === true);
        if (medal) medals[key] = [...(data.medals[key] ?? []), medal];
      }
      snapshots.set(input.matchId, { bestsBefore, medal });
      commit({
        ...data, records, bests, streaks, medals,
        applied: [{ id: input.matchId, newPbs }, ...data.applied].slice(0, APPLIED_MATCH_MEMORY),
      });
      return newPbs.slice();
    },

    lossStreak: (opponent) => data.streaks[entrantKey(opponent)] ?? 0,
    medals: (opponent) => data.medals[entrantKey(opponent)] ?? [],
    medalFor: (matchId) => snapshots.get(matchId)?.medal ?? null,
    memory: (opponent) => data.memory[entrantKey(opponent)] ?? EMPTY_OPPONENT_MEMORY,
    remember(opponent, mem) {
      commit({ ...data, memory: { ...data.memory, [entrantKey(opponent)]: mem } });
    },
    claimStableHint() {
      if (data.stableHintShown) return false;
      commit({ ...data, stableHintShown: true });
      return true;
    },

    record: (opponent, tier) => recordIn(data, opponent, tier),

    totals() {
      let w = 0, l = 0;
      for (const byTier of Object.values(data.records)) for (const r of Object.values(byTier)) { w += r.w; l += r.l; }
      return { w, l };
    },

    bestsBefore(matchId) {
      const snap = snapshots.get(matchId);
      if (snap) return snap.bestsBefore;
      const applied = data.applied.find((a) => a.id === matchId);
      if (!applied) return data.bests;
      // A match applied in an earlier session: its own PBs are the current bests, so rank as if they were not held yet.
      const before = { ...data.bests };
      for (const id of applied.newPbs) delete before[id];
      return before;
    },

    reset() { snapshots.clear(); commit(emptyProfile()); },
  };
  return api;
}

let shared: ProfileStore | null = null;
/** The page-wide profile store (created lazily so importing this module in Node touches no storage). */
export function sharedProfile(): ProfileStore {
  if (!shared) shared = createProfileStore();
  return shared;
}
