// src/game/render/vfx/derez.ts (WP6)
// The KO de-rez timeline (SCOPE 1.2, acceptance 12) built around the servo brownout slump (GAME_DESIGN 8.3):
//   t = 0          lethal hit (the ko event): a white flash (KO_FLASH_MS) and the slow-motion window (the VFX
//                  clock runs at KO_SLOWMO_RATE for KO_SLOWMO_HOLD_MS, then eases back over KO_SLOWMO_RAMP_MS)
//   150 ms         the loser's servo LEDs die base → gripper, 40 ms apart
//   settle         first of: loser joint speed < 0.05 rad/s (once the droop has begun, ≥ 400 ms), or 1100 ms
//   settle → +900  the shell dissolves: world-space voxel threshold sweep with a team-colour burning edge,
//                  plus the team-colour shatter and confetti cannons at the start
//   round_intro    the re-render scan (400 ms signal-orange sweep) restores both arms pristine
// The slump itself is never hidden: the dissolve cannot start before settle. During an earned replay the
// replayed arm is shown intact (the replay re-plays the slump) and the dissolve state returns afterwards.
// Pure and wall-clock driven so tests can step it without a renderer.
import type { MatchPhase, Seat } from "../../contracts.ts";

export const LED_START_MS = 150;
export const LED_STEP_MS = 40;
export const LED_COUNT = 6;
export const SETTLE_SPEED_RAD_S = 0.05;
export const SETTLE_MIN_MS = 400;
export const SETTLE_MAX_MS = 1100;
export const DEREZ_MS = 900;
export const SCAN_MS = 400;
export const KO_FLASH_MS = 240;
export const KO_SLOWMO_RATE = 0.25;
export const KO_SLOWMO_HOLD_MS = 550;
export const KO_SLOWMO_RAMP_MS = 400;

/** KO white flash 0..1 at `tMs` after the lethal hit: instant peak, eased out. */
export function koFlashAt(tMs: number): number {
  if (tMs < 0 || tMs >= KO_FLASH_MS) return 0;
  const k = 1 - tMs / KO_FLASH_MS;
  return k * k;
}

/** VFX clock rate at `tMs` after the lethal hit (1 outside the window). */
export function koTimeScaleAt(tMs: number): number {
  if (tMs < 0) return 1;
  if (tMs < KO_SLOWMO_HOLD_MS) return KO_SLOWMO_RATE;
  const k = (tMs - KO_SLOWMO_HOLD_MS) / KO_SLOWMO_RAMP_MS;
  return k >= 1 ? 1 : KO_SLOWMO_RATE + (1 - KO_SLOWMO_RATE) * k * k;
}

interface SeatTimeline {
  koAtMs: number;       // −1 none
  settledAtMs: number;  // −1 not yet
  burstPending: boolean;
}

export interface DerezTimeline {
  /** A `ko` event arrived for `victim` at wall time `nowMs`. */
  onKo(victim: Seat, nowMs: number): void;
  /** A phase change: round_intro starts the re-render scan and clears KO state; replays hide the dissolve. */
  onPhase(phase: MatchPhase, nowMs: number): void;
  /** Per frame: settle detection from the loser's largest absolute joint speed (rad/s). */
  update(nowMs: number, jointSpeed: (seat: Seat) => number): void;
  /** Dissolve progress 0..1 for a seat. */
  derez(seat: Seat, nowMs: number): number;
  /** Number of dead servo LEDs (0..6) counted from the base. */
  ledsDead(seat: Seat, nowMs: number): number;
  /** Re-render scan progress 0..1, or −1 when idle. */
  scan(nowMs: number): number;
  /** KO white flash 0..1 (post stack / hit light read it). Replays never flash. */
  koFlash(nowMs: number): number;
  /** Slow-motion window: the rate the VFX clock runs at (1 outside a KO). */
  timeScale(nowMs: number): number;
  /** Returns a seat whose de-rez just began (the shatter), once. */
  takeBurst(): Seat | null;
  settledAtMs(seat: Seat): number;
  koAtMs(seat: Seat): number;
  reset(): void;
}

export function createDerezTimeline(): DerezTimeline {
  const seats: Record<Seat, SeatTimeline> = {
    atlas: { koAtMs: -1, settledAtMs: -1, burstPending: false },
    blaze: { koAtMs: -1, settledAtMs: -1, burstPending: false },
  };
  let scanStartMs = -1;
  let inReplay = false;
  const clearSeat = (s: SeatTimeline) => { s.koAtMs = -1; s.settledAtMs = -1; s.burstPending = false; };
  return {
    onKo(victim, nowMs) {
      const s = seats[victim];
      if (inReplay || s.koAtMs >= 0) return;         // one KO per seat per round; replays never restart it
      s.koAtMs = nowMs;
      s.settledAtMs = -1;
      s.burstPending = false;
    },
    onPhase(phase, nowMs) {
      if (phase === "round_intro" || phase === "rematch_intro" || phase === "match_intro") {
        scanStartMs = nowMs;
        clearSeat(seats.atlas);
        clearSeat(seats.blaze);
        inReplay = false;
      } else if (phase === "round_replay" || phase === "match_replay" || phase === "replay_viewer") {
        inReplay = true;
      } else if (phase === "green_room" || phase === "title") {
        clearSeat(seats.atlas);
        clearSeat(seats.blaze);
        inReplay = false;
      } else {
        inReplay = false;
      }
    },
    update(nowMs, jointSpeed) {
      for (const seat of ["atlas", "blaze"] as const) {
        const s = seats[seat];
        if (s.koAtMs < 0 || s.settledAtMs >= 0) continue;
        const t = nowMs - s.koAtMs;
        if (t >= SETTLE_MAX_MS || (t >= SETTLE_MIN_MS && jointSpeed(seat) < SETTLE_SPEED_RAD_S)) {
          s.settledAtMs = s.koAtMs + Math.min(t, SETTLE_MAX_MS);
          s.burstPending = true;
        }
      }
    },
    derez(seat, nowMs) {
      const s = seats[seat];
      if (s.settledAtMs < 0 || inReplay) return 0;
      const k = (nowMs - s.settledAtMs) / DEREZ_MS;
      return k <= 0 ? 0 : k >= 1 ? 1 : k;
    },
    ledsDead(seat, nowMs) {
      const s = seats[seat];
      if (s.koAtMs < 0 || inReplay) return 0;
      const t = nowMs - s.koAtMs - LED_START_MS;
      if (t < 0) return 0;
      return Math.min(LED_COUNT, Math.floor(t / LED_STEP_MS) + 1);
    },
    scan(nowMs) {
      if (scanStartMs < 0) return -1;
      const k = (nowMs - scanStartMs) / SCAN_MS;
      if (k >= 1) { scanStartMs = -1; return -1; }
      return k < 0 ? 0 : k;
    },
    koFlash(nowMs) {
      if (inReplay) return 0;
      let f = 0;
      for (const seat of ["atlas", "blaze"] as const) if (seats[seat].koAtMs >= 0) f = Math.max(f, koFlashAt(nowMs - seats[seat].koAtMs));
      return f;
    },
    timeScale(nowMs) {
      let r = 1;
      for (const seat of ["atlas", "blaze"] as const) if (seats[seat].koAtMs >= 0) r = Math.min(r, koTimeScaleAt(nowMs - seats[seat].koAtMs));
      return r;
    },
    takeBurst() {
      for (const seat of ["atlas", "blaze"] as const) {
        if (seats[seat].burstPending && !inReplay) { seats[seat].burstPending = false; return seat; }
      }
      return null;
    },
    settledAtMs(seat) { return seats[seat].settledAtMs; },
    koAtMs(seat) { return seats[seat].koAtMs; },
    reset() { clearSeat(seats.atlas); clearSeat(seats.blaze); scanStartMs = -1; inReplay = false; },
  };
}
