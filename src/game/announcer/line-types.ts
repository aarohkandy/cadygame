// src/game/announcer/line-types.ts (WP3)
// Shared shapes for the host line banks. Kept apart from lines.ts so the three bank modules can import them
// without a cycle.

import type { HostId } from "../contracts.ts";

/** Every beat the hosts have an opinion about. Priority for each lives in EVENT_PRIORITY (lines.ts). */
export type LineEvent =
  // show and round beats
  | "round_start" | "final_round" | "sudden_death" | "time_up" | "comeback" | "close_call"
  // the exchange
  | "first_strike" | "crit" | "big_hit" | "deflect" | "late_guard" | "clash" | "combo" | "whiff_streak"
  | "heat_warning" | "overheat" | "burst" | "table_slam" | "joint_limit" | "low_integrity" | "stalemate"
  | "policy_fault"
  // the Core
  | "core_incoming" | "core_drop" | "lock_in_start" | "contested" | "steal" | "inherit" | "late_steal" | "lock"
  // endings and entrants
  | "ko" | "match_win" | "match_loss" | "flaw_exploited" | "flaw_patched"
  | "user_model_intro" | "user_model_wins" | "user_model_loses"
  // EMOTION_BIBLE 7: coaching (VALE, matches 1 to 3), momentum, the crowd meter, chaos, narrative threads
  | "coach_passive" | "coach_turtle" | "coach_whiff" | "coach_guard"
  | "momentum_up" | "momentum_down" | "crowd" | "chaos"
  | "thread_comeback" | "thread_revenge" | "thread_first_blood" | "thread_clock";

/** Events one host owns by design: coaching is VALE's, chaos is ROOK's. The bank tests exempt them from the split. */
export const ONE_HOST_EVENTS: readonly LineEvent[] = ["coach_passive", "coach_turtle", "coach_whiff", "coach_guard", "chaos"];

/** Beats whose VALE lines carry no number by design: coaching is state, the crowd meter is the room. */
export const NO_NUMBER_EVENTS: readonly LineEvent[] = ["coach_passive", "coach_turtle", "coach_whiff", "coach_guard", "crowd"];

/** Coaching beats: VALE only, matches 1 to 3, one per 8 s, only while menace is low. Never a number. */
export const COACH_EVENTS: readonly LineEvent[] = ["coach_passive", "coach_turtle", "coach_whiff", "coach_guard"];

/**
 * `call`   the ordinary line for that beat
 * `number` a VALE line that carries a measurement
 * `joke`   a punchline; P1 banks only, and rationed by the scheduler
 * `deep`   a rare payoff that only becomes eligible once a session has been running a while
 */
export type LineKind = "call" | "number" | "joke" | "deep";

export interface HostLine {
  id: string;
  event: LineEvent;
  speaker: HostId;
  text: string;
  kind: LineKind;
}

/** One event's copy. `deepRook`/`deepVale` hold the rare lines; `jokes` are ROOK punchlines on P1 beats. */
export interface EventBank {
  rook: readonly string[];
  vale: readonly string[];
  jokes?: readonly string[];
  deepRook?: readonly string[];
  deepVale?: readonly string[];
}
