// src/game/announcer/lines.ts (WP3)
// The line bank for the two hosts (SCOPE 1.2, BUILD_PLAN D9). ROOK is the hype voice: clipped, loves hardware, never
// quotes a number. DR. VALE is the analyst: dry, and most of her lines carry a real measurement from the event.
// The copy itself lives in bank-fight.ts, bank-core.ts and bank-show.ts; this module assembles and indexes it.
//
// Copy rules, enforced by tests/host-lines.test.mjs:
//   - at most 9 words (a token counts as one word)
//   - no exclamation marks, except at most one in a ROOK line of a P1 event
//   - banned-word list below: broadcast filler that reads as generated
//   - ROOK lines carry no number tokens and no digits; at least 60% of VALE lines carry a real number token
//   - every P1/P2 event has >= 8 variants split across both hosts; every P3 event >= 4
//   - jokes live only in P1 banks; `deep` lines unlock only late in a session
// Tokens resolve from real event fields in announcer.ts; a line whose tokens are unavailable is skipped.

import type { HostId } from "../contracts.ts";
import { FIGHT_BANK } from "./bank-fight.ts";
import { CORE_BANK } from "./bank-core.ts";
import { SHOW_BANK } from "./bank-show.ts";
import { HOSTS_BANK } from "./bank-hosts.ts";
import type { EventBank, HostLine, LineEvent, LineKind } from "./line-types.ts";

export type { EventBank, HostLine, LineEvent, LineKind } from "./line-types.ts";
export { COACH_EVENTS, NO_NUMBER_EVENTS, ONE_HOST_EVENTS } from "./line-types.ts";

/** Scheduler priority per event. P1 interrupts, P2 queues, P3 is filler that is dropped under load. */
export const EVENT_PRIORITY: Readonly<Record<LineEvent, 1 | 2 | 3>> = {
  // P1: the match or the round is decided, or it nearly was
  ko: 1, match_win: 1, match_loss: 1, late_steal: 1, lock: 1, user_model_wins: 1, user_model_loses: 1,
  // P2: worth saying, but never worth cutting someone off for
  steal: 2, inherit: 2, deflect: 2, crit: 2, big_hit: 2, round_start: 2, final_round: 2, sudden_death: 2,
  flaw_patched: 2, flaw_exploited: 2, time_up: 2, comeback: 2, close_call: 2, overheat: 2,
  // P3: colour. Two per round at most.
  first_strike: 3, combo: 3, core_drop: 3, core_incoming: 3, lock_in_start: 3, contested: 3, low_integrity: 3,
  stalemate: 3, user_model_intro: 3, whiff_streak: 3, heat_warning: 3, burst: 3, table_slam: 3, joint_limit: 3,
  late_guard: 3, clash: 3, policy_fault: 3,
  // EMOTION_BIBLE 7 beats: coaching and the narrative threads are the quiet filler; momentum stabs queue
  coach_passive: 3, coach_turtle: 3, coach_whiff: 3, coach_guard: 3,
  momentum_up: 2, momentum_down: 3, crowd: 3, chaos: 2,
  thread_comeback: 3, thread_revenge: 3, thread_first_blood: 3, thread_clock: 3,
};

/**
 * Event classes (EMOTION_BIBLE 7: at least 12 variants per class with a 20-line no-repeat window). A class groups
 * the beats that read as one kind of moment, so the variety rule is measured where a listener hears repetition.
 */
export const EVENT_CLASS: Readonly<Record<LineEvent, string>> = {
  ko: "finish", match_win: "finish", match_loss: "finish", user_model_wins: "finish", user_model_loses: "finish",
  lock: "lock", late_steal: "steal", steal: "steal", inherit: "steal", contested: "steal",
  crit: "big_hit", big_hit: "big_hit", deflect: "guard", late_guard: "guard", clash: "guard",
  round_start: "bell", final_round: "bell", sudden_death: "bell", user_model_intro: "bell",
  time_up: "decision", comeback: "decision", close_call: "decision",
  first_strike: "opening", combo: "momentum", momentum_up: "momentum", momentum_down: "momentum", whiff_streak: "whiff",
  heat_warning: "heat", overheat: "heat", burst: "heat",
  table_slam: "chaos", joint_limit: "chaos", chaos: "chaos", policy_fault: "chaos",
  low_integrity: "danger", stalemate: "stall", crowd: "crowd",
  core_incoming: "core", core_drop: "core", lock_in_start: "core",
  flaw_exploited: "flaw", flaw_patched: "flaw",
  coach_passive: "coach", coach_turtle: "coach", coach_whiff: "coach", coach_guard: "coach",
  thread_comeback: "thread", thread_revenge: "thread", thread_first_blood: "thread", thread_clock: "thread",
};

/** The five measurements a VALE line may quote (BUILD_PLAN D9). Nothing else is a number. */
export const NUMBER_TOKENS: readonly string[] = ["speed", "ms", "dmg", "secs", "newtons"];

/** Broadcast filler and slop tells. A line containing any of these is a test failure, not a style note. */
export const BANNED_WORDS: readonly string[] = [
  "chill", "energy", "literally", "textbook", "not today", "insane", "epic", "vibes", "banked", "larceny",
  "absolutely", "unbelievable", "game changer", "next level", "for the ages", "buckle up", "here we go folks",
  "ladies and gentlemen", "world class", "elite level", "one for the books",
];

/** A `deep` line is only offered after this many lines in the session, and then only sometimes. */
export const DEEP_CUT_AFTER_LINES = 40;
export const DEEP_CUT_CHANCE = 0.18;

const BANK: Readonly<Record<LineEvent, EventBank>> = {
  ...FIGHT_BANK, ...CORE_BANK, ...SHOW_BANK, ...HOSTS_BANK,
} as Readonly<Record<LineEvent, EventBank>>;

function tokensOf(text: string): string[] {
  const out: string[] = [];
  const re = /\{([a-z]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

export function lineTokens(line: Pick<HostLine, "text">): string[] {
  return tokensOf(line.text);
}

export function hasNumberToken(text: string): boolean {
  return tokensOf(text).some((t) => NUMBER_TOKENS.includes(t));
}

function build(): readonly HostLine[] {
  const lines: HostLine[] = [];
  const push = (event: LineEvent, speaker: HostId, text: string, suffix: string, kind: LineKind) =>
    lines.push({ id: `${event}.${speaker}.${suffix}`, event, speaker, text, kind });
  for (const event of Object.keys(BANK) as LineEvent[]) {
    const b = BANK[event];
    b.rook.forEach((text, i) => push(event, "rook", text, String(i + 1), "call"));
    b.vale.forEach((text, i) => push(event, "vale", text, String(i + 1), hasNumberToken(text) ? "number" : "call"));
    b.jokes?.forEach((text, i) => push(event, "rook", text, `joke${i + 1}`, "joke"));
    b.deepRook?.forEach((text, i) => push(event, "rook", text, `deep${i + 1}`, "deep"));
    b.deepVale?.forEach((text, i) => push(event, "vale", text, `deep${i + 1}`, "deep"));
  }
  return lines;
}

export const HOST_LINES: readonly HostLine[] = build();

const BY_EVENT: ReadonlyMap<LineEvent, readonly HostLine[]> = (() => {
  const m = new Map<LineEvent, HostLine[]>();
  for (const l of HOST_LINES) {
    const list = m.get(l.event) ?? [];
    list.push(l);
    m.set(l.event, list);
  }
  return m;
})();

const BY_EVENT_SPEAKER: ReadonlyMap<string, readonly HostLine[]> = (() => {
  const m = new Map<string, HostLine[]>();
  for (const l of HOST_LINES) {
    const key = `${l.event}|${l.speaker}`;
    const list = m.get(key) ?? [];
    list.push(l);
    m.set(key, list);
  }
  return m;
})();

export function linesFor(event: LineEvent, speaker?: HostId): readonly HostLine[] {
  if (speaker) return BY_EVENT_SPEAKER.get(`${event}|${speaker}`) ?? [];
  return BY_EVENT.get(event) ?? [];
}

/** Every event the hosts have copy for, in bank order. */
export const LINE_EVENTS: readonly LineEvent[] = Object.keys(BANK) as LineEvent[];

/** Word count with each {token} counted as one word. */
export function wordCount(text: string): number {
  return text.replace(/\{[a-z]+\}/g, "X").trim().split(/\s+/).filter((w) => w.length > 0).length;
}
