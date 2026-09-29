// src/game/announcer/announcer.ts (WP7)
// The hosts' scheduler on caption units (EMOTION_BIBLE 7). The unit of speech is one ROOK reaction (one clause),
// optionally followed by VALE's one number no more than 2 s later. After a unit ends there is a 3 s hard silence,
// and units start no more than one per 6 s; the hosts are silent for at least 45 % of fight time and say 14 to 26
// units over a three-minute match. No two units in a row come from the same host, no line id repeats within the
// last 20 (persisted across matches), the player's name is said at most twice a match, and every VALE number is
// read from an event field. The first 4 s after FIGHT are silent; a KO release line starts 650 ms after the confirm,
// never earlier. VALE in matches 1 to 3 speaks only coaching lines tied to state (one per 8 s, only while the
// opponent's menace is under 0.2); her number lines start at match 4. Menace above 0.7 silences the hosts;
// between 0.4 and 0.7 only the moments that matter (P1, P2) get through. One narrative thread per round (comeback,
// revenge, first blood, the clock) gives the quiet stretches something that refers to this round; the crowd meter
// and momentum stabs fill the rest; the chaos class is ROOK's one caption for the clip that goes on the show.
// Prosody is data (captionProsody): ramp 0..3 and whether the line is a release.

import {
  otherSeat,
  type Caption, type FeedbackContext, type GameEvent, type HostId, type OpponentAffect, type Seat, type SettingsStore,
  type ShowEvent, type UiStore,
} from "../contracts.ts";
import { createRng, type Rng } from "../core/rng.ts";
import {
  COACH_EVENTS, DEEP_CUT_AFTER_LINES, DEEP_CUT_CHANCE, EVENT_PRIORITY, lineTokens, linesFor, wordCount,
  type HostLine, type LineEvent,
} from "./lines.ts";

/** Hard silence after a unit ends, and the cadence between unit starts. */
export const UNIT_SILENCE_MS = 3000;
export const UNIT_CADENCE_MS = 6000;
/** The fight-time share the hosts may fill; the bible's floor is 45 % silence, the scheduler stops at 50 % spoken. */
export const MAX_SPOKEN_FRAC = 0.5;
/** Units allowed by fight time: 2 + t / 7.5 s reaches 26 at three minutes. */
export const UNIT_CAP_BASE = 2;
export const UNIT_CAP_PER_MS = 1 / 7500;
/** A quiet stretch this long invites a thread or crowd line, so a three-minute match reaches the 14-unit floor. */
export const IDLE_FILL_MS = 11000;
/** The hosts say nothing for the first seconds after FIGHT. */
export const OPENING_SILENCE_S = 4;
/** ROOK's KO release line starts this long after the confirm. */
export const KO_RELEASE_MS = 650;
/** VALE's number follows ROOK's clause inside the unit, this long after his line ends. */
export const FOLLOW_UP_GAP_MS = 250;
export const FOLLOW_UP_CHANCE: Readonly<Record<1 | 2, number>> = { 1: 0.5, 2: 0.35 };
export const FOLLOW_UP_MIN_SPARE = 3;
/** Coaching: one line per 8 s, only while menace is under this. */
export const COACH_GAP_MS = 8000;
export const COACH_MENACE_MAX = 0.2;
/** Menace gates (bible 4.5): above 0.7 nothing, above 0.4 no colour. */
export const MENACE_SILENT = 0.7;
export const MENACE_NO_COLOUR = 0.4;
/** The player's name, at most this many times a match. */
export const NAME_USES_PER_MATCH = 2;
/** VALE's number lines start at this many matches played (matches 1 to 3 are coaching only). */
export const VALE_NUMBERS_FROM_MATCHES = 3;
export const STALE_MS: Readonly<Record<1 | 2 | 3, number>> = { 1: 1500, 2: 1200, 3: 800 };
export const NO_REPEAT_WINDOW = 20;
export const INTERRUPT_FADE_MS = 60;
export const STALE_FIGHT_S = 1.5;
export const HISTORY_KEY = "torquelimit.hosts.history";
export const WHIFF_STREAK_AT = 3;
export const TABLE_SLAM_NEWTONS = 12;
export const COMEBACK_INTEGRITY_FRAC = 0.25;
export const CLOSE_CALL_MARGIN = 10;
/** Coaching triggers: seconds without any contact, and seconds with guard held. */
export const COACH_PASSIVE_S = 5;
export const COACH_TURTLE_S = 6;
/** The clock thread starts under this many seconds left. */
export const THREAD_CLOCK_S = 15;

/** Release lines stretch their final word: the endings and the lock. */
const RELEASE_EVENTS: ReadonlySet<LineEvent> = new Set<LineEvent>(["ko", "lock", "late_steal", "match_win", "match_loss", "user_model_wins", "user_model_loses"]);

export interface Prosody { ramp: 0 | 1 | 2 | 3; release: boolean }

/** Prosody as data (bible 7): read from the caption's line id, so the HUD needs nothing but the caption. */
export function captionProsody(cap: Pick<Caption, "lineId" | "priority">): Prosody {
  const event = cap.lineId.split(".")[0] as LineEvent;
  if ((COACH_EVENTS as readonly string[]).includes(event) || cap.lineId.startsWith("prompt.")) return { ramp: 0, release: false };
  const ramp = cap.priority === 1 ? 3 : cap.priority === 2 ? 2 : 1;
  return { ramp, release: RELEASE_EVENTS.has(event) };
}

export interface HostSpeaker {
  /** Speaks a caption; resolves when the utterance ends. Only called when the host voice is enabled and available. */
  speak(caption: Caption): Promise<void>;
  /** Cuts the current utterance (P1 interrupt, pause, match exit). */
  cancel(fadeMs: number): void;
  readonly enabled: boolean;
}

export interface AnnouncerDeps {
  ui: UiStore;
  settings: SettingsStore;
  voice?: HostSpeaker | null;
  rng?: Rng;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Crowd hype 0..1 for the crowd-meter lines (WP5 hype.ts); absent means a quiet room. */
  hype?: () => number;
  /** Finished matches of the facing profile; defaults to settings.profile.matchesPlayed at match start. */
  matchesPlayed?: () => number;
}

export interface Announcer {
  readonly current: Caption | null;
  /** Caption units started this match, and the hosts' spoken share of fight time so far. */
  readonly units: number;
  readonly spokenFrac: number;
  readonly history: readonly string[];
  onEvents(events: readonly GameEvent[], ctx: FeedbackContext): void;
  /** Show events (bible 11.9) the hosts react to: cube_off_deck is chaos, near_ko is the one line at the threshold. */
  onShowEvents(events: readonly ShowEvent[], ctx: FeedbackContext): void;
  /** The opponent's affect at 10 Hz (WP4); menace gates the hosts. null means calm. */
  setAffect(affect: OpponentAffect | null): void;
  update(wallDtS: number, ctx: FeedbackContext): void;
  /** Clears the current line and queue (pause, quit). */
  silence(): void;
  dispose(): void;
}

interface Pending {
  event: LineEvent;
  priority: 1 | 2 | 3;
  tokens: Map<string, string>;
  speaker: HostId | null;
  notBeforeMs: number;
  deadlineMs: number;
  followUp: boolean;
  atFightTimeS: number;
}

/**
 * What the hosts remember. `damage`/`fastest` run for the whole match; `roundDamage`, `minIntegrityFrac`, `streak`
 * and `sinceLow` reset each round; `whiffs` counts consecutive misses and resets the moment a seat connects.
 */
export interface MatchTally {
  damage: Record<Seat, number>;
  fastest: Record<Seat, number>;
  roundDamage: Record<Seat, number>;
  whiffs: Record<Seat, number>;
  minIntegrityFrac: Record<Seat, number>;
  /** Unanswered hits per seat (from combo events, reset when that seat is struck). */
  streak: Record<Seat, number>;
  /** Hits landed since the seat dropped under the comeback band. */
  sinceLow: Record<Seat, number>;
  /** Who landed first this round, and when. */
  firstStrike: { seat: Seat; atS: number; vN: number } | null;
}

export function emptyTally(): MatchTally {
  return {
    damage: { atlas: 0, blaze: 0 }, fastest: { atlas: 0, blaze: 0 }, roundDamage: { atlas: 0, blaze: 0 },
    whiffs: { atlas: 0, blaze: 0 }, minIntegrityFrac: { atlas: 1, blaze: 1 }, streak: { atlas: 0, blaze: 0 },
    sinceLow: { atlas: 0, blaze: 0 }, firstStrike: null,
  };
}

function fmt1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function fmtSecs(v: number): string {
  const r = Math.round(v);
  return Math.abs(v - r) < 0.05 ? String(r) : fmt1(v);
}

export function captionDurationMs(text: string): number {
  return Math.max(1400, Math.min(4200, 700 + wordCount(text) * 330));
}

/** Resolves a line's text against a token map; returns null when any token is missing. */
export function renderLine(line: Pick<HostLine, "text">, tokens: ReadonlyMap<string, string>): string | null {
  for (const t of lineTokens(line)) if (!tokens.has(t)) return null;
  return line.text.replace(/\{([a-z]+)\}/g, (_, name: string) => tokens.get(name) ?? "");
}

/**
 * Maps a bus event to a host event and the tokens its real fields support. Returns null for events hosts ignore.
 * `tally` carries match totals (damage, fastest strike) accumulated by the announcer from earlier strike events.
 */
export function hostEventFor(e: GameEvent, ctx: FeedbackContext & { matchesPlayed?: number }, tally: MatchTally, lethal: Extract<GameEvent, { type: "strike" }> | null): { event: LineEvent; tokens: Map<string, string> } | null {
  const tokens = new Map<string, string>();
  const name = (s: Seat) => ctx.names[s] ?? s.toUpperCase();
  const combat = ctx.combat;
  const physical = combat.scoring === "physical";
  switch (e.type) {
    case "phase": {
      tokens.set("round", String(e.round));
      if (e.phase === "round_intro") {
        tokens.set("secs", fmtSecs(combat.roundLengthS));
        return { event: e.finalRound ? "final_round" : "round_start", tokens };
      }
      if (e.phase === "sudden_death") {
        if (combat.suddenDeath) tokens.set("secs", fmtSecs(combat.core.lockInTotalS));
        return { event: "sudden_death", tokens };
      }
      if (e.phase === "match_intro" && ctx.opponentIsUserModel && ctx.playerSeat) {
        tokens.set("file", name(otherSeat(ctx.playerSeat)));
        tokens.set("secs", fmtSecs(combat.roundLengthS));
        return { event: "user_model_intro", tokens };
      }
      return null;
    }
    case "strike": {
      if (e.tier !== "strike" || e.guarded) return null;
      const dmg = physical ? e.physicalDamage : e.damage;
      if (dmg < 30) return null;
      tokens.set("actor", name(e.attacker));
      tokens.set("target", name(e.victim));
      tokens.set("speed", fmt1(e.vN));
      tokens.set("dmg", String(Math.round(dmg)));
      return { event: e.crit ? "crit" : "big_hit", tokens };
    }
    case "first_strike":
      // Matches 1 to 3: the receipt under the crosshair is the whole reaction to the first hit (bible 2).
      if (ctx.matchesPlayed !== undefined && ctx.matchesPlayed < VALE_NUMBERS_FROM_MATCHES) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "first_strike", tokens };
    case "deflect":
      tokens.set("actor", name(e.defender));
      tokens.set("target", name(e.attacker));
      if (e.pressLeadMs > 0) tokens.set("ms", String(Math.round(e.pressLeadMs)));
      return { event: "deflect", tokens };
    case "combo":
      // Three unanswered is the momentum stab; five and every four after is the run itself.
      if (e.count !== 3 && (e.count < 5 || (e.count - 5) % 4 !== 0)) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      tokens.set("count", String(e.count));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      if (tally.roundDamage[e.seat] > 0) tokens.set("dmg", String(Math.round(tally.roundDamage[e.seat])));
      return { event: e.count === 3 ? "momentum_up" : "combo", tokens };
    case "whiff": {
      // Counting happens in onEvents; a call only fires on every third consecutive miss.
      const n = tally.whiffs[e.seat];
      if (n < WHIFF_STREAK_AT || n % WHIFF_STREAK_AT !== 0) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      tokens.set("count", String(n));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "whiff_streak", tokens };
    }
    case "late_guard":
      tokens.set("actor", name(e.defender));
      tokens.set("target", name(e.attacker));
      if (e.pressLagMs > 0) tokens.set("ms", String(Math.round(e.pressLagMs)));
      return { event: "late_guard", tokens };
    case "clash":
      if (e.heavyWinner) {
        tokens.set("actor", name(e.heavyWinner));
        tokens.set("target", name(otherSeat(e.heavyWinner)));
      }
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "clash", tokens };
    case "heat_warning":
      if (!e.on) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "heat_warning", tokens };
    case "overheat":
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "overheat", tokens };
    case "burst":
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "burst", tokens };
    case "table_hit":
      if (e.force < TABLE_SLAM_NEWTONS) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      tokens.set("newtons", String(Math.round(e.force)));
      return { event: "table_slam", tokens };
    case "joint_limit_violation":
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "joint_limit", tokens };
    case "policy_fault":
      // A human pilot cannot fault; saying so about the player's own seat would be nonsense.
      if (ctx.playerSeat !== null && e.seat === ctx.playerSeat) return null;
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(otherSeat(e.seat)));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "policy_fault", tokens };
    case "round_end": {
      const winner = e.winner;
      const loser = otherSeat(winner);
      tokens.set("actor", name(winner));
      tokens.set("target", name(loser));
      tokens.set("round", String(combat.round));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      const wSeat = combat.seats[winner];
      const lSeat = combat.seats[loser];
      const margin = Math.abs(wSeat.integrity - lSeat.integrity);
      const frac = (x: typeof wSeat) => x.integrity / Math.max(1, x.integrityMax);
      const bothSpent = frac(wSeat) <= COMEBACK_INTEGRITY_FRAC && frac(lSeat) <= COMEBACK_INTEGRITY_FRAC;
      // The winner was written off this round and still took it: the best line of the night.
      if (tally.minIntegrityFrac[winner] <= COMEBACK_INTEGRITY_FRAC && tally.roundDamage[loser] > 0) {
        tokens.set("dmg", String(Math.round(tally.roundDamage[loser])));
        return { event: "comeback", tokens };
      }
      if (margin <= CLOSE_CALL_MARGIN || bothSpent) {
        tokens.set("dmg", String(Math.round(margin)));
        return { event: "close_call", tokens };
      }
      if (e.reason === "time") {
        tokens.set("dmg", String(Math.round(margin)));
        return { event: "time_up", tokens };
      }
      return null;
    }
    case "stalemate":
      tokens.set("secs", fmtSecs(e.seconds));
      return { event: "stalemate", tokens };
    case "core": {
      if (e.seat) { tokens.set("actor", name(e.seat)); tokens.set("target", name(otherSeat(e.seat))); }
      if (e.stage === "incoming") {
        tokens.set("secs", fmtSecs(e.remainingS));
        return { event: "core_incoming", tokens };
      }
      if (e.stage === "contested_on") {
        tokens.set("secs", fmtSecs(e.remainingS));
        return { event: "contested", tokens };
      }
      if (e.stage === "drop") {
        tokens.set("secs", fmtSecs(combat.core.lockInTotalS));
        return { event: "core_drop", tokens };
      }
      if (e.stage === "lock_in_start") {
        tokens.set("secs", fmtSecs(e.remainingS));
        return e.seat ? { event: "lock_in_start", tokens } : null;
      }
      if (e.stage === "lock_in_resume") {
        if (!e.inherited || !e.seat) return null;
        tokens.set("secs", fmtSecs(e.remainingS));
        if (e.from) tokens.set("target", name(e.from));
        return { event: "inherit", tokens };
      }
      if (e.stage === "steal") {
        if (!e.seat) return null;
        tokens.set("secs", fmtSecs(e.remainingS));
        if (e.from) tokens.set("target", name(e.from));
        return { event: e.late ? "late_steal" : "steal", tokens };
      }
      if (e.stage === "lock") {
        if (!e.seat) return null;
        tokens.set("secs", fmtSecs(combat.core.lockInTotalS));
        return { event: "lock", tokens };
      }
      return null;
    }
    case "low_integrity":
      if (ctx.playerSeat === null || e.seat !== ctx.playerSeat) return null;
      tokens.set("actor", name(e.seat));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      return { event: "low_integrity", tokens };
    case "ko":
      tokens.set("actor", name(e.attacker));
      tokens.set("target", name(e.victim));
      if (lethal && lethal.victim === e.victim) {
        tokens.set("speed", fmt1(lethal.vN));
        tokens.set("dmg", String(Math.round(physical ? lethal.physicalDamage : lethal.damage)));
      }
      return { event: "ko", tokens };
    case "match_end": {
      const winner = e.winner;
      const loser = otherSeat(winner);
      tokens.set("actor", name(winner));
      tokens.set("target", name(loser));
      if (tally.damage[winner] > 0) tokens.set("dmg", String(Math.round(tally.damage[winner])));
      if (tally.fastest[winner] > 0) tokens.set("speed", fmt1(tally.fastest[winner]));
      const me = ctx.playerSeat;
      if (me && ctx.opponentIsUserModel) {
        const model = otherSeat(me);
        tokens.set("file", name(model));
        tokens.set("dmg", String(Math.round(tally.damage[model])));
        return { event: winner === me ? "user_model_loses" : "user_model_wins", tokens };
      }
      return { event: me === null || winner === me ? "match_win" : "match_loss", tokens };
    }
    case "flaw": {
      // `seat` is the arm that owns the habit: it exploits the other's, and patches its own.
      const other = otherSeat(e.seat);
      tokens.set("count", String(e.count));
      if (combat.fightTimeS > 0) tokens.set("secs", fmtSecs(combat.fightTimeS));
      if (e.stage === "exploited") {
        tokens.set("actor", name(other));
        tokens.set("target", name(e.seat));
        if (e.count < 2) return null;
        return { event: "flaw_exploited", tokens };
      }
      tokens.set("actor", name(e.seat));
      tokens.set("target", name(other));
      return { event: "flaw_patched", tokens };
    }
    default:
      return null;
  }
}

function loadHistory(storage: AnnouncerDeps["storage"]): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-NO_REPEAT_WINDOW) : [];
  } catch {
    return [];
  }
}

function defaultStorage(): AnnouncerDeps["storage"] {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

type Thread = "comeback" | "revenge" | "first_blood" | "clock";
const THREAD_EVENT: Readonly<Record<Thread, LineEvent>> = {
  comeback: "thread_comeback", revenge: "thread_revenge", first_blood: "thread_first_blood", clock: "thread_clock",
};
/** Comeback outranks revenge outranks first blood outranks the clock (bible 7). */
const THREAD_RANK: Readonly<Record<Thread, number>> = { comeback: 4, revenge: 3, first_blood: 2, clock: 1 };
/** A thread says its 4 to 6 lines over a round, never two inside this window. */
const THREAD_GAP_MS = 14000;
const THREAD_MAX_PER_ROUND = 3;

export function createAnnouncer(deps: AnnouncerDeps): Announcer {
  const rng = deps.rng ?? createRng(0x40057 ^ (Date.now() >>> 0));
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const history: string[] = loadHistory(storage);
  const bags = new Map<string, string[]>();
  const queue: Pending[] = [];
  const tally: MatchTally = emptyTally();
  let nowMs = 0;
  let fightTimeS = 0;
  let inFight = false;
  /** Fight wall time and the hosts' spoken share of it, for the silence budget and the unit cap. */
  let fightMs = 0;
  let spokenMs = 0;
  let lethal: Extract<GameEvent, { type: "strike" }> | null = null;
  let current: (Caption & { startMs: number; endMs: number; event: LineEvent; priority: 1 | 2 | 3 }) | null = null;
  /** The unit on air: its lead, when it ends (the follow-up extends it), and who spoke last. */
  let unitEndMs = -Infinity;
  let unitStartMs = -Infinity;
  let lastSpeaker: HostId | null = null;
  let units = 0;
  let speechToken = 0;
  let sessionLines = 0;
  let matchesPlayed = 0;
  let playerName: string | null = null;
  let nameUses = 0;
  let affect: OpponentAffect | null = null;
  /* coaching and threads */
  let lastCoachMs = -Infinity;
  let lastContactS = 0;
  let guardHeldSinceS: number | null = null;
  let coachedTurtle = false;
  let coachedPassive = false;
  let coachedGuard = false;
  let thread: Thread | null = null;
  let threadLines = 0;
  let lastThreadMs = -Infinity;
  let lastRoundLoser: Seat | null = null;
  let lastIdleFillMs = 0;
  let roundIndex = 0;

  function saveHistory(): void {
    if (!storage) return;
    try { storage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-NO_REPEAT_WINDOW))); } catch { /* storage full or blocked */ }
  }

  const captionsMode = () => deps.settings.get().audio.captions;
  const voiceOn = (): boolean => !!deps.voice && deps.voice.enabled && deps.settings.get().audio.hostVoice;
  const menace = (): number => affect?.menace ?? 0;
  const valeNumbers = (): boolean => matchesPlayed >= VALE_NUMBERS_FROM_MATCHES;
  const isCoach = (e: LineEvent): boolean => (COACH_EVENTS as readonly string[]).includes(e);

  function muted(): boolean {
    // The attract match runs silent for the hosts; with captions off and no voice there is nobody to talk to.
    if (deps.ui.get().screen === "title") return true;
    return captionsMode() === "off" && !voiceOn();
  }

  function readMatchesPlayed(): void {
    matchesPlayed = deps.matchesPlayed ? deps.matchesPlayed() : deps.settings.get().profile.matchesPlayed;
  }

  function pickLine(event: LineEvent, speaker: HostId, tokens: ReadonlyMap<string, string>): { line: HostLine; text: string } | null {
    const key = `${event}|${speaker}`;
    const candidates = linesFor(event, speaker);
    if (candidates.length === 0) return null;
    const deepOk = sessionLines >= DEEP_CUT_AFTER_LINES && rng.next() < DEEP_CUT_CHANCE;
    const nameSpent = nameUses >= NAME_USES_PER_MATCH && playerName !== null;
    const usable = (l: HostLine): string | null => {
      if (l.kind === "deep" && !deepOk) return null;
      if (history.includes(l.id)) return null;
      // VALE's numbers are telemetry, and they start at match 4; before that she coaches.
      if (speaker === "vale" && l.kind === "number" && !valeNumbers()) return null;
      const text = renderLine(l, tokens);
      if (text === null) return null;
      if (nameSpent && playerName && text.includes(playerName)) return null;
      return text;
    };
    let bag = bags.get(key);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!bag || bag.length === 0) {
        bag = candidates.map((l) => l.id);
        for (let i = bag.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
        bags.set(key, bag);
      }
      for (let i = 0; i < bag.length; i++) {
        const line = candidates.find((l) => l.id === (bag as string[])[i]);
        const text = line ? usable(line) : null;
        if (line && text !== null) {
          bag.splice(i, 1);
          return { line, text };
        }
      }
      bag = [];
    }
    return null;
  }

  function spareLines(event: LineEvent, speaker: HostId): number {
    const bag = bags.get(`${event}|${speaker}`);
    return bag === undefined ? linesFor(event, speaker).length : bag.length;
  }

  /** Who leads this unit: the host who did not speak last, when both may; VALE only coaches before match 4. */
  function leadFor(p: Pending): HostId {
    if (p.speaker) return p.speaker;
    if (isCoach(p.event)) return "vale";
    if (!valeNumbers()) return "rook";
    if (lastSpeaker === "rook") return "vale";
    if (lastSpeaker === "vale") return "rook";
    return rng.next() < 0.6 ? "rook" : "vale";
  }

  function unitCap(): number {
    return Math.floor(UNIT_CAP_BASE + fightMs * UNIT_CAP_PER_MS);
  }

  /** The gates a unit has to pass to start now. P1 skips the cadence: the release line is the moment itself. */
  function canStartUnit(p: Pending): boolean {
    if (p.followUp) return true;
    if (inFight && fightTimeS < OPENING_SILENCE_S && p.priority > 1) return false;
    // A fresh profile's first round is sparring (bible 2): the receipts are the commentary, only coaching speaks.
    if (matchesPlayed === 0 && roundIndex <= 1 && !isCoach(p.event)) return false;
    if (p.priority === 1) return true;
    // Match 1 keeps the word count down: no colour beyond coaching until the profile has a match behind it.
    if (matchesPlayed === 0 && p.priority === 3 && !isCoach(p.event)) return false;
    if (menace() > MENACE_SILENT) return false;
    if (p.priority === 3 && menace() > MENACE_NO_COLOUR) return false;
    if (isCoach(p.event) && (menace() > COACH_MENACE_MAX || nowMs - lastCoachMs < COACH_GAP_MS)) return false;
    if (nowMs < unitEndMs + UNIT_SILENCE_MS) return false;
    if (nowMs < unitStartMs + UNIT_CADENCE_MS) return false;
    if (inFight && fightMs > 20000 && spokenMs / fightMs > MAX_SPOKEN_FRAC) return false;
    if (inFight && units >= unitCap()) return false;
    return true;
  }

  function endCurrent(cut: boolean): void {
    if (!current) return;
    current = null;
    speechToken++;
    if (cut) deps.voice?.cancel(INTERRUPT_FADE_MS);
    if (deps.ui.get().captions !== null) deps.ui.set({ captions: null });
  }

  function start(p: Pending): boolean {
    const lead = leadFor(p);
    let chosen = pickLine(p.event, lead, p.tokens);
    let speaker = lead;
    if (!chosen && !p.followUp && !isCoach(p.event) && (valeNumbers() || lead === "vale")) {
      speaker = lead === "rook" ? "vale" : "rook";
      chosen = pickLine(p.event, speaker, p.tokens);
    }
    if (!chosen) return false;
    const durationMs = captionDurationMs(chosen.text);
    const caption: Caption = { speaker, lineId: chosen.line.id, text: chosen.text, priority: p.priority, durationMs };
    current = { ...caption, startMs: nowMs, endMs: nowMs + durationMs, event: p.event, priority: p.priority };
    if (!p.followUp) { units++; unitStartMs = nowMs; }
    unitEndMs = current.endMs;
    lastSpeaker = speaker;
    sessionLines++;
    if (inFight) spokenMs += durationMs;
    if (isCoach(p.event)) lastCoachMs = nowMs;
    if (playerName && chosen.text.includes(playerName)) nameUses++;
    history.push(chosen.line.id);
    while (history.length > NO_REPEAT_WINDOW) history.shift();
    saveHistory();
    const mode = captionsMode();
    if (mode === "full" || (mode === "big" && p.priority <= 2)) deps.ui.set({ captions: caption });
    if (voiceOn() && deps.voice) {
      const token = ++speechToken;
      const started = nowMs;
      void deps.voice.speak(caption).then(() => {
        if (token === speechToken && current && current.lineId === caption.lineId && nowMs - started >= durationMs) endCurrent(false);
      });
      current.endMs = nowMs + Math.min(6000, durationMs + 600);
      unitEndMs = current.endMs;
    }
    // The unit's second half: VALE's number inside 2 s of ROOK's clause, only once her numbers are unlocked.
    if (!p.followUp && speaker === "rook" && p.priority <= 2 && valeNumbers() && queue.length === 0 && rng.next() < FOLLOW_UP_CHANCE[p.priority as 1 | 2]) {
      if (spareLines(p.event, "vale") >= FOLLOW_UP_MIN_SPARE
        && linesFor(p.event, "vale").some((l) => l.kind === "number" && renderLine(l, p.tokens) !== null && !history.includes(l.id))) {
        const at = current.endMs + FOLLOW_UP_GAP_MS;
        queue.push({
          event: p.event, priority: p.priority, tokens: p.tokens, speaker: "vale", notBeforeMs: at,
          deadlineMs: at + STALE_MS[p.priority], followUp: true, atFightTimeS: fightTimeS,
        });
      }
    }
    return true;
  }

  function enqueue(event: LineEvent, tokens: Map<string, string>, notBeforeMs = nowMs): void {
    const priority = EVENT_PRIORITY[event];
    const mode = captionsMode();
    if (!voiceOn() && (mode === "off" || (mode === "big" && priority === 3))) return;
    const p: Pending = {
      event, priority, tokens, speaker: null, notBeforeMs, deadlineMs: notBeforeMs + STALE_MS[priority],
      followUp: false, atFightTimeS: fightTimeS,
    };
    if (priority === 1) {
      // The release line owns the queue: everything waiting is dropped and the line on air is cut. It still
      // passes the gates in pump (the sparring round, the opening silence), and the KO waits its 650 ms.
      queue.length = 0;
      if (current) endCurrent(true);
      queue.push(p);
      return;
    }
    const dup = queue.findIndex((q) => q.event === event && !q.followUp);
    if (dup >= 0) queue.splice(dup, 1);
    queue.push(p);
    queue.sort((a, b) => a.priority - b.priority || a.notBeforeMs - b.notBeforeMs);
  }

  function pump(): void {
    if (current && nowMs >= current.endMs) endCurrent(false);
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      const moved = fightTimeS < q.atFightTimeS || fightTimeS - q.atFightTimeS > STALE_FIGHT_S;
      if (nowMs > q.deadlineMs || (moved && q.priority > 1)) queue.splice(i, 1);
    }
    if (current || queue.length === 0) return;
    const next = queue[0];
    if (nowMs < next.notBeforeMs) return;
    if (!canStartUnit(next)) { if (next.priority === 3 && nowMs > next.deadlineMs) queue.shift(); return; }
    queue.shift();
    start(next);
  }

  /* ── state-tied colour: coaching, threads, the crowd meter ── */

  function sampleState(ctx: FeedbackContext): void {
    fightTimeS = ctx.combat.fightTimeS;
    inFight = ctx.phase === "fight" || ctx.phase === "sudden_death";
    for (const seat of ["atlas", "blaze"] as const) {
      const st = ctx.combat.seats[seat];
      if (!st || st.integrityMax <= 0) continue;
      const frac = st.integrity / st.integrityMax;
      if (frac < tally.minIntegrityFrac[seat]) tally.minIntegrityFrac[seat] = frac;
    }
    const me = ctx.playerSeat;
    if (me) {
      const held = ctx.combat.seats[me]?.guardHeld ?? false;
      if (held && guardHeldSinceS === null) guardHeldSinceS = fightTimeS;
      if (!held) guardHeldSinceS = null;
    }
  }

  function pickThread(ctx: FeedbackContext): void {
    const me = ctx.playerSeat;
    let next: Thread | null = null;
    if (me && tally.minIntegrityFrac[me] <= COMEBACK_INTEGRITY_FRAC && tally.sinceLow[me] >= 2) next = "comeback";
    else if (me && lastRoundLoser === me && tally.roundDamage[me] > 0) next = "revenge";
    else if (tally.firstStrike) next = "first_blood";
    else if (ctx.combat.roundLengthS - fightTimeS <= THREAD_CLOCK_S) next = "clock";
    if (next && (thread === null || THREAD_RANK[next] > THREAD_RANK[thread])) { thread = next; threadLines = 0; }
  }

  function threadTokens(ctx: FeedbackContext): Map<string, string> {
    const tokens = new Map<string, string>();
    const me = ctx.playerSeat ?? "atlas";
    const name = (s: Seat) => ctx.names[s] ?? s.toUpperCase();
    const actor = thread === "first_blood" && tally.firstStrike ? tally.firstStrike.seat : me;
    tokens.set("actor", name(actor));
    tokens.set("target", name(otherSeat(actor)));
    tokens.set("round", String(Math.max(1, ctx.combat.round - 1)));
    if (tally.roundDamage[actor] > 0) tokens.set("dmg", String(Math.round(tally.roundDamage[actor])));
    if (thread === "comeback" && tally.sinceLow[actor] > 0) tokens.set("count", String(tally.sinceLow[actor]));
    if (thread === "clock") {
      tokens.set("secs", fmtSecs(Math.max(0, ctx.combat.roundLengthS - fightTimeS)));
      const margin = Math.abs((ctx.combat.seats.atlas?.integrity ?? 0) - (ctx.combat.seats.blaze?.integrity ?? 0));
      tokens.set("dmg", String(Math.round(margin)));
    } else if (tally.firstStrike) {
      tokens.set("secs", fmtSecs(tally.firstStrike.atS));
      tokens.set("speed", fmt1(tally.firstStrike.vN));
    }
    return tokens;
  }

  /** The quiet stretches: a coaching line when the state asks for one, else the round's thread, else the crowd. */
  function fillIdle(ctx: FeedbackContext): void {
    if (!inFight || current || queue.length > 0 || muted()) return;
    const me = ctx.playerSeat;
    if (me && !valeNumbers() && menace() <= COACH_MENACE_MAX && nowMs - lastCoachMs >= COACH_GAP_MS) {
      if (!coachedPassive && fightTimeS - lastContactS >= COACH_PASSIVE_S && tally.roundDamage[me] === 0 && fightTimeS >= OPENING_SILENCE_S) {
        coachedPassive = true; enqueue("coach_passive", new Map()); return;
      }
      if (!coachedTurtle && guardHeldSinceS !== null && fightTimeS - guardHeldSinceS >= COACH_TURTLE_S) {
        coachedTurtle = true; enqueue("coach_turtle", new Map()); return;
      }
    }
    if (nowMs - Math.max(unitEndMs, lastIdleFillMs) < IDLE_FILL_MS || menace() > MENACE_NO_COLOUR) return;
    lastIdleFillMs = nowMs;
    pickThread(ctx);
    if (thread && threadLines < THREAD_MAX_PER_ROUND && nowMs - lastThreadMs >= THREAD_GAP_MS) {
      threadLines++; lastThreadMs = nowMs;
      enqueue(THREAD_EVENT[thread], threadTokens(ctx));
      return;
    }
    const hype = deps.hype ? deps.hype() : 0;
    if (hype >= 0.35 || rng.next() < 0.5) enqueue("crowd", new Map());
  }

  function resetRoundTally(): void {
    lethal = null;
    tally.roundDamage.atlas = 0; tally.roundDamage.blaze = 0;
    tally.whiffs.atlas = 0; tally.whiffs.blaze = 0;
    tally.minIntegrityFrac.atlas = 1; tally.minIntegrityFrac.blaze = 1;
    tally.streak.atlas = 0; tally.streak.blaze = 0;
    tally.sinceLow.atlas = 0; tally.sinceLow.blaze = 0;
    tally.firstStrike = null;
    thread = null; threadLines = 0; lastThreadMs = -Infinity;
    coachedPassive = false; coachedTurtle = false; coachedGuard = false;
    lastContactS = 0; guardHeldSinceS = null; lastIdleFillMs = 0;
  }

  function resetMatch(ctx: FeedbackContext): void {
    tally.damage.atlas = 0; tally.damage.blaze = 0; tally.fastest.atlas = 0; tally.fastest.blaze = 0;
    resetRoundTally();
    units = 0; fightMs = 0; spokenMs = 0; nameUses = 0; lastSpeaker = null; lastRoundLoser = null; roundIndex = 0;
    unitEndMs = -Infinity; unitStartMs = -Infinity; lastCoachMs = -Infinity;
    readMatchesPlayed();
    playerName = ctx.playerSeat ? (ctx.names[ctx.playerSeat] ?? null) : null;
  }

  const announcer: Announcer = {
    get current() { return current; },
    get units() { return units; },
    get spokenFrac() { return fightMs > 0 ? spokenMs / fightMs : 0; },
    get history() { return history; },

    onEvents(events, ctx) {
      sampleState(ctx);
      const me = ctx.playerSeat;
      for (const e of events) {
        if (e.type === "phase") {
          if (e.phase === "match_intro" || e.phase === "rematch_intro") resetMatch(ctx);
          if (e.phase === "round_intro") roundIndex = e.round;
          if (e.phase === "round_intro" || e.phase === "sudden_death") { queue.length = 0; resetRoundTally(); }
          if (e.phase === "title" || e.phase === "green_room" || e.phase === "post_match" || e.phase === "verdict") queue.length = 0;
        }
        if (e.type === "strike" && e.tier === "strike") {
          const dmg = ctx.combat.scoring === "physical" ? e.physicalDamage : e.damage;
          if (!e.guarded) {
            tally.damage[e.attacker] += Math.max(0, dmg);
            tally.roundDamage[e.attacker] += Math.max(0, dmg);
            if (tally.minIntegrityFrac[e.attacker] <= COMEBACK_INTEGRITY_FRAC) tally.sinceLow[e.attacker]++;
          }
          tally.fastest[e.attacker] = Math.max(tally.fastest[e.attacker], e.vN);
          if (e.lethal) lethal = e;
          lastContactS = fightTimeS;
          // The victim's run is over. A run of three or more that breaks is the momentum stab down.
          const broken = tally.streak[e.victim];
          tally.streak[e.victim] = 0;
          if (broken >= 3 && !e.guarded && !muted()) {
            const tokens = new Map<string, string>();
            tokens.set("actor", ctx.names[e.attacker] ?? e.attacker);
            tokens.set("target", ctx.names[e.victim] ?? e.victim);
            tokens.set("count", String(broken));
            if (fightTimeS > 0) tokens.set("secs", fmtSecs(fightTimeS));
            enqueue("momentum_down", tokens);
          }
          // The first heavy that lands unguarded on a fresh pilot earns one guard coaching line.
          if (me && e.victim === me && !e.guarded && e.magnitude >= 0.4 && !coachedGuard && !valeNumbers() && menace() <= COACH_MENACE_MAX) {
            coachedGuard = true;
            enqueue("coach_guard", new Map());
          }
        }
        if (e.type === "first_strike") tally.firstStrike = { seat: e.seat, atS: fightTimeS, vN: tally.fastest[e.seat] };
        if (e.type === "combo") tally.streak[e.seat] = Math.max(tally.streak[e.seat], e.count);
        if (e.type === "whiff") {
          tally.whiffs[e.seat]++;
          if (me && e.seat === me && tally.whiffs[me] % WHIFF_STREAK_AT === 0 && !valeNumbers() && menace() <= COACH_MENACE_MAX) {
            enqueue("coach_whiff", new Map());
          }
        }
        if (e.type === "strike") tally.whiffs[e.attacker] = 0;
        if (e.type === "clash") { tally.whiffs.atlas = 0; tally.whiffs.blaze = 0; lastContactS = fightTimeS; }
        if (e.type === "deflect") { tally.whiffs[e.attacker] = 0; lastContactS = fightTimeS; }
        if (e.type === "round_end") lastRoundLoser = otherSeat(e.winner);
        if (muted()) continue;
        const mapped = hostEventFor(e, { ...ctx, matchesPlayed }, tally, lethal);
        if (!mapped) continue;
        // ROOK's release line lands 650 ms after the confirm, never earlier (bible 6, 7).
        enqueue(mapped.event, mapped.tokens, mapped.event === "ko" ? nowMs + KO_RELEASE_MS : nowMs);
      }
      pump();
    },

    onShowEvents(events, ctx) {
      if (muted()) return;
      for (const e of events) {
        if (e.kind === "cube_off_deck") {
          const tokens = new Map<string, string>();
          tokens.set("count", String(e.count));
          if (fightTimeS > 0) tokens.set("secs", fmtSecs(fightTimeS));
          enqueue("chaos", tokens);
        } else if (e.kind === "near_ko" && ctx.playerSeat !== null && e.seat === ctx.playerSeat) {
          const tokens = new Map<string, string>();
          tokens.set("actor", ctx.names[e.seat] ?? e.seat);
          if (fightTimeS > 0) tokens.set("secs", fmtSecs(fightTimeS));
          enqueue("low_integrity", tokens);
        }
      }
      pump();
    },

    setAffect(a) { affect = a; },

    update(wallDtS, ctx) {
      const dt = Number.isFinite(wallDtS) ? Math.max(0, Math.min(0.25, wallDtS)) : 0;
      nowMs += dt * 1000;
      sampleState(ctx);
      if (inFight) fightMs += dt * 1000;
      if (ctx.phase === "paused" && current) announcer.silence();
      fillIdle(ctx);
      pump();
    },

    silence() {
      queue.length = 0;
      if (current) endCurrent(true);
    },

    dispose() {
      announcer.silence();
    },
  };
  readMatchesPlayed();
  return announcer;
}
