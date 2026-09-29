// src/game/match/tutorial-script.ts (WP6)
// Match 1, round 1: the sparring round (EMOTION_BIBLE 2, t₀ + 4 → 44 s). Four steps, each completed only by the
// real event that proves the skill, each with a cap so the round always advances: HIT IT (12 s, passive nudge at
// 5 s) → GUARD · HOLD RMB (3 wind-ups, ~10 s) → GRAB IT (Core drops) → BRING IT HOME / HOLD IT · n (20 s from the
// drop, one re-drop) → LOCKED. The script is pure: the director feeds it each frame's events and the combat
// snapshot and reads back BACKLASH's behaviour cue, the caption, and which skills were skipped (the verdict's goal).
// Also the SYSTEMS CHECK drill after match 2 (bible 9): a 20 s DOCK drill, one task string, SYSTEMS NOMINAL.

import type { CombatSnapshot, GameEvent, JigBehavior, Seat } from "../contracts.ts";
import { DRILL_LENGTH_S, drillTask } from "./match-config.ts";

export type SparStepId = "hit" | "guard" | "grab" | "hold" | "locked";
/** Skills a capped step leaves for the verdict's goal line (8.2). */
export type SkippedSkill = "hit" | "guard" | "dock";

/** HIT IT: the step advances anyway after this long. */
export const HIT_CAP_MS = 12_000;
/** HIT IT: with no contact by then, BACKLASH's gripper drifts 4 cm into yours and VALE coaches. */
export const HIT_NUDGE_MS = 5_000;
export const NUDGE_OFFSET_M = -0.04;
/** GUARD: unguarded SLAMs before the step is skipped. */
export const GUARD_WINDUPS = 3;
export const GUARD_CAP_MS = 10_000;
/** GRAB + dock: from the drop; on cap the Core re-drops once, then VALE coaches. */
export const DOCK_CAP_MS = 20_000;
/** The mouse-glyph captions (the overlay adds the glyph after the dot). */
export const STEP_CAPTION: Readonly<Record<SparStepId, string | null>> = {
  hit: "HIT IT", guard: "GUARD · HOLD RMB", grab: "GRAB IT", hold: "BRING IT HOME", locked: null,
};
/** Coaching fallbacks, each at most once (bible 2 text budget). */
export const COACH_LINE = {
  // Device-neutral on purpose: this line is read by mouse, pad and touch players alike, and the overlay
  // carries the device-specific glyph. "SWING THE MOUSE" told a phone player to use hardware they do not have.
  nudge: "SWING ACROSS IT",
  guardCapped: "WE'LL COME BACK TO THAT",
  dockCapped: "CARRY IT TO YOUR RING",
} as const;

export interface SparStepDef {
  id: SparStepId;
  behavior: JigBehavior;
  /** The Core drops at the start of this step (rules config for the step). */
  coreDrop: boolean;
  capMs: number;
}

export const SPAR_STEPS: readonly SparStepDef[] = [
  { id: "hit", behavior: "parked_in_reach", coreDrop: false, capMs: HIT_CAP_MS },
  { id: "guard", behavior: "slow_heavy", coreDrop: false, capMs: GUARD_CAP_MS },
  { id: "grab", behavior: "idle", coreDrop: true, capMs: DOCK_CAP_MS },
  { id: "hold", behavior: "idle", coreDrop: true, capMs: DOCK_CAP_MS },
  { id: "locked", behavior: "idle", coreDrop: false, capMs: Infinity },
];

export interface TutorialScript {
  readonly step: SparStepDef;
  readonly index: number;
  /** BACKLASH's behaviour cue for this moment (the nudge changes the park offset without changing the step). */
  readonly behavior: JigBehavior;
  readonly parkOffsetM: number;
  /** Bumps whenever behaviour or park offset change: the director re-resets the opponent driver on a bump. */
  readonly revision: number;
  /** The one caption on screen (a step prompt or a coaching line), null when silent. */
  readonly caption: string | null;
  /** True once the pilot's lock ended the round. */
  readonly finished: boolean;
  /** Skills the caps skipped, for the verdict goal. */
  readonly skipped: readonly SkippedSkill[];
  /** Core re-drops asked for (the director resets the rules with the drop on each bump). */
  readonly redrops: number;
  /** Feeds one frame. Returns true when the step changed this frame. */
  update(events: readonly GameEvent[], combat: CombatSnapshot, wallDtS: number): boolean;
  reset(): void;
}

export function createTutorialScript(playerSeat: Seat): TutorialScript {
  let index = 0;
  let stepMs = 0;
  let windups = 0;
  let nudged = false;
  let coach: string | null = null;
  let coachMs = 0;
  let redrops = 0;
  let dockMs = 0;
  let revision = 0;
  let parkOffsetM = 0;
  const skipped: SkippedSkill[] = [];

  function say(line: string): void { coach = line; coachMs = 4000; }

  function advance(): void {
    index = Math.min(SPAR_STEPS.length - 1, index + 1);
    stepMs = 0;
    windups = 0;
    if (parkOffsetM !== 0) { parkOffsetM = 0; }
    revision++;
  }

  const script: TutorialScript = {
    get step() { return SPAR_STEPS[index]; },
    get index() { return index; },
    get behavior() { return SPAR_STEPS[index].behavior; },
    get parkOffsetM() { return parkOffsetM; },
    get revision() { return revision; },
    get caption() { return coach ?? STEP_CAPTION[SPAR_STEPS[index].id]; },
    get finished() { return SPAR_STEPS[index].id === "locked"; },
    get skipped() { return skipped; },
    get redrops() { return redrops; },

    update(events, combat, wallDtS): boolean {
      const ms = Math.max(0, wallDtS) * 1000;
      stepMs += ms;
      if (coach) { coachMs -= ms; if (coachMs <= 0) coach = null; }
      const id = SPAR_STEPS[index].id;
      let done = false;
      switch (id) {
        case "hit":
          done = events.some((e) => e.type === "strike" && e.attacker === playerSeat);
          if (!done && !nudged && stepMs >= HIT_NUDGE_MS) {
            nudged = true;
            parkOffsetM = NUDGE_OFFSET_M;
            revision++;
            say(COACH_LINE.nudge);
          }
          if (!done && stepMs >= HIT_CAP_MS) { skipped.push("hit"); done = true; }
          break;
        case "guard":
          for (const e of events) {
            if (e.type === "strike" && e.victim === playerSeat) { if (e.guarded) done = true; else windups++; }
            if (e.type === "deflect" && e.defender === playerSeat) done = true;
          }
          if (!done && (windups >= GUARD_WINDUPS || stepMs >= GUARD_CAP_MS)) {
            skipped.push("guard");
            say(COACH_LINE.guardCapped);
            done = true;
          }
          break;
        case "grab":
          dockMs += ms;
          done = combat.core.phase === "live" && combat.core.lastTouchedBy === playerSeat;
          break;
        case "hold":
          dockMs += ms;
          done = events.some((e) => e.type === "core" && e.stage === "lock" && e.seat === playerSeat);
          break;
        case "locked":
          return false;
      }
      if (!done && (id === "grab" || id === "hold") && dockMs >= DOCK_CAP_MS) {
        dockMs = 0;
        if (redrops === 0) { redrops++; revision++; }
        else if (!skipped.includes("dock")) { skipped.push("dock"); say(COACH_LINE.dockCapped); }
        // Once the dock has been given up on, finish the round instead of dropping the core again. Sending
        // `hold` back to `grab` unconditionally meant a player who could pick the core up but never lock it
        // bounced grab -> hold -> grab forever, with no way out of match 1 — every other step has a cap that
        // ends it, and this pair did not. The skill is carried to the verdict as skipped, not lost.
        if (skipped.includes("dock")) { index = SPAR_STEPS.length - 1; stepMs = 0; return true; }
        if (id === "hold") { index = 2; stepMs = 0; return true; }
      }
      if (done) advance();
      return done;
    },

    reset(): void {
      index = 0; stepMs = 0; windups = 0; nudged = false; coach = null; coachMs = 0;
      redrops = 0; dockMs = 0; parkOffsetM = 0; revision++; skipped.length = 0;
    },
  };
  return script;
}

/* ───────────────────────── SYSTEMS CHECK drill ───────────────────────── */

export interface DrillScript {
  /** The task string the episode carries (`dock the core from pose 3 zone B`). */
  readonly task: string;
  readonly elapsedS: number;
  /** "NOMINAL" on the pilot's lock, "TIMEOUT" at the cap, null while live. */
  readonly result: "NOMINAL" | "TIMEOUT" | null;
  update(events: readonly GameEvent[], wallDtS: number): void;
}

export function createDrillScript(playerSeat: Seat, seed: number): DrillScript {
  let elapsedS = 0;
  let result: DrillScript["result"] = null;
  return {
    task: drillTask(seed),
    get elapsedS() { return elapsedS; },
    get result() { return result; },
    update(events, wallDtS) {
      if (result) return;
      elapsedS += Math.max(0, wallDtS);
      if (events.some((e) => e.type === "core" && e.stage === "lock" && e.seat === playerSeat)) result = "NOMINAL";
      else if (elapsedS >= DRILL_LENGTH_S) result = "TIMEOUT";
    },
  };
}
