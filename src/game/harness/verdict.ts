// src/game/harness/verdict.ts (WP5)
// CLEARED FOR BROADCAST / POLICY FAULT (GAME_DESIGN 5.10.3). Stock presets only: every policy seat is
// cleared when it had 0 errors, 0 disconnects, 0 timeouts (live) or 0 hangs (eval), a late fraction under 2%, 0 joint-limit
// violations (overshoot > 1e-5 rad), fewer than 5 table hits over 3 N, and no diverged determinism check.
// Otherwise the first failing reason is the stamp. Arcade reports always carry the Arcade sticker.
// Counts come straight from recorded columns and events, so the store can stamp a summary cheaply.
//
// The table-hit check is the one bar that is scoped to the seat under test (see `isSeatUnderTest`). Every
// other check asks whether the seat honoured the policy contract - it replied, it replied in time, it
// returned finite targets inside the joint limits, it reproduced on replay - and the built-in opponents are
// held to all of those, because a built-in that errors or leaves a joint limit is our bug and we want the
// stamp to say so. Table hits are not a contract question: they ask whether this controller would beat a
// real arm against the bench, which is a question about a model somebody is thinking of running on
// hardware. The built-ins are the house opposition. They are aggressive by design (a Contender swinging for
// the Core lands on the deck several times a match - measured at 7), they never run on a physical arm, and
// nothing a user does changes their behaviour, so faulting them taught the reader to distrust a stamp that
// is supposed to mean something. The count is still recorded and still shown in the report's metric table
// for every seat; for a built-in it is telemetry rather than a verdict.

import {
  ACTION_STATUS_CODE, JOINT_LIMITS, SEATS, VIOLATION_TOLERANCE_RAD,
  type Episode, type EpisodeStats, type Seat,
} from "../contracts.ts";

export const CLEARED_STAMP = "CLEARED FOR BROADCAST";
export const FAULT_STAMP = "POLICY FAULT";
export const ARCADE_STICKER = "ARCADE PHYSICS · NOT VERIFICATION";

export const LATE_FRACTION_LIMIT = 0.02;
export const TABLE_HIT_FORCE_N = 3;
export const TABLE_HIT_LIMIT = 5;

export type Stamp = EpisodeStats["verdict"][Seat];

export interface SeatReliabilityCounts {
  /** Decision ticks: arrivals plus requests that went late or timed out. */
  decisions: number;
  arrivals: number;
  late: number;
  timeouts: number;
  errors: number;
  clamped: number;
  slow: number;
  hangs: number;
  disconnects: number;
  /** Arrivals with any joint overshooting its limit by more than the tolerance. */
  violations: number;
  violationsPerJoint: number[];
  maxOvershoot: number;
  tableHits: number;
}

export function isPolicySeat(ep: Episode, seat: Seat): boolean {
  const d = ep.meta.seats[seat].driver;
  return d !== "human" && d !== "proxy";
}

/**
 * A policy seat that carries something the user brought: an uploaded module, a recorded trajectory, or a
 * local bridge. The built-in opponents run through the same interface but are the show's own opposition,
 * not a submission under verification.
 */
export function isSeatUnderTest(ep: Episode, seat: Seat): boolean {
  return isPolicySeat(ep, seat) && ep.meta.seats[seat].driver !== "builtin";
}

function emptyCounts(): SeatReliabilityCounts {
  return {
    decisions: 0, arrivals: 0, late: 0, timeouts: 0, errors: 0, clamped: 0, slow: 0, hangs: 0, disconnects: 0,
    violations: 0, violationsPerJoint: [0, 0, 0, 0, 0, 0], maxOvershoot: 0, tableHits: 0,
  };
}

/** Joint overshoot of a returned target beyond JOINT_LIMITS (0 inside the limits). */
export function overshoot(joint: number, target: number): number {
  const [lo, hi] = JOINT_LIMITS[joint];
  if (!Number.isFinite(target)) return 0;
  return target < lo ? lo - target : target > hi ? target - hi : 0;
}

export function reliabilityCounts(ep: Episode, seat: Seat): SeatReliabilityCounts {
  const c = emptyCounts();
  const status = ep.columns[`policy.status.${seat}`] as Uint8Array | undefined;
  const compute = ep.columns[`policy.compute_ms.${seat}`] as Float32Array | undefined;
  const raw = ep.columns[`action_raw.${seat}`] as Float64Array | undefined;
  if (status && compute) {
    for (let i = 0; i < status.length; i++) {
      const st = status[i];
      const arrived = Number.isFinite(compute[i]);
      if (arrived) c.arrivals++;
      if (st === ACTION_STATUS_CODE.late) c.late++;
      else if (st === ACTION_STATUS_CODE.timeout) c.timeouts++;
      else if (st === ACTION_STATUS_CODE.error) c.errors++;
      else if (st === ACTION_STATUS_CODE.clamped) c.clamped++;
      else if (st === ACTION_STATUS_CODE.slow) c.slow++;
      if (arrived || st === ACTION_STATUS_CODE.late || st === ACTION_STATUS_CODE.timeout) c.decisions++;
      if (arrived && raw) {
        let any = false;
        for (let j = 0; j < 6; j++) {
          const o = overshoot(j, raw[i * 6 + j]);
          if (o > c.maxOvershoot) c.maxOvershoot = o;
          if (o > VIOLATION_TOLERANCE_RAD) { c.violationsPerJoint[j]++; any = true; }
        }
        if (any) c.violations++;
      }
    }
  }
  for (const e of ep.events) {
    if (e.type === "policy_fault" && e.seat === seat) {
      if (e.status === "hang") c.hangs++;
      else if (e.status === "disconnect") c.disconnects++;
    } else if (e.type === "table_hit" && e.seat === seat && e.force > TABLE_HIT_FORCE_N) {
      c.tableHits++;
    } else if (e.type === "joint_limit_violation" && e.seat === seat && e.overshoot > VIOLATION_TOLERANCE_RAD && !raw) {
      // Only when the returned targets were not recorded (action_raw is the authoritative source).
      c.violations++;
      c.violationsPerJoint[e.joint] = (c.violationsPerJoint[e.joint] ?? 0) + 1;
      if (e.overshoot > c.maxOvershoot) c.maxOvershoot = e.overshoot;
    }
  }
  const r = ep.meta.result;
  if (r.error === "policy_hang" && r.forfeit === seat && c.hangs === 0) c.hangs = 1;
  return c;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface FaultReasonOptions {
  /** false for a built-in seat: table hits stay telemetry instead of becoming a fault (see the file header). */
  tableHitsFault?: boolean;
}

/** The first failing 5.10.3 reason, or null when every check holds. */
export function faultReason(
  c: SeatReliabilityCounts,
  timing: "live" | "eval",
  determinism: Episode["meta"]["result"]["determinism"],
  opts: FaultReasonOptions = {},
): string | null {
  if (c.errors > 0) return plural(c.errors, "ERROR", "ERRORS");
  if (timing === "eval" && c.hangs > 0) return "POLICY HANG";
  if (timing === "live" && (c.timeouts > 0 || c.disconnects > 0)) {
    return c.disconnects > 0 && c.timeouts === 0 ? "DISCONNECTED" : plural(c.timeouts, "TIMEOUT", "TIMEOUTS");
  }
  if (c.hangs > 0) return "POLICY HANG";
  // A seat whose process went away never finished the episode, whatever the timing. Eval waits for a reply
  // indefinitely and so records no timeouts, which left a disconnected policy - one that played a whole match
  // as a dead seat, or never connected at all - passing every other check and stamping CLEARED FOR BROADCAST.
  if (c.disconnects > 0) return "DISCONNECTED";
  const lateFrac = c.decisions > 0 ? c.late / c.decisions : 0;
  if (lateFrac >= LATE_FRACTION_LIMIT) return `LATE ${(lateFrac * 100).toFixed(1)}%`;
  if (c.violations > 0) return plural(c.violations, "LIMIT VIOLATION", "LIMIT VIOLATIONS");
  if ((opts.tableHitsFault ?? true) && c.tableHits >= TABLE_HIT_LIMIT) return plural(c.tableHits, "TABLE HIT", "TABLE HITS");
  if (determinism === "diverged") return "REPLAY DIVERGED";
  return null;
}

export function seatVerdict(ep: Episode, seat: Seat, counts?: SeatReliabilityCounts): Stamp {
  if (!isPolicySeat(ep, seat)) return { stamp: "none", reason: null };
  if (ep.meta.physics === "arcade") return { stamp: "arcade", reason: ARCADE_STICKER };
  const reason = faultReason(counts ?? reliabilityCounts(ep, seat), ep.meta.timing, ep.meta.result.determinism, {
    tableHitsFault: isSeatUnderTest(ep, seat),
  });
  return reason ? { stamp: "fault", reason } : { stamp: "cleared", reason: null };
}

export function episodeVerdicts(ep: Episode): Record<Seat, Stamp> {
  return { atlas: seatVerdict(ep, "atlas"), blaze: seatVerdict(ep, "blaze") };
}

/** One stamp for a Replays row: Arcade, any policy fault, cleared when a policy took part, else none. */
export function summaryVerdict(verdicts: Record<Seat, Stamp>): "cleared" | "fault" | "arcade" | "none" {
  const stamps = SEATS.map((s) => verdicts[s].stamp);
  if (stamps.includes("arcade")) return "arcade";
  if (stamps.includes("fault")) return "fault";
  if (stamps.includes("cleared")) return "cleared";
  return "none";
}

/** Display line for a stamp: `CLEARED FOR BROADCAST`, `POLICY FAULT: 3 ERRORS`, or the Arcade sticker. */
export function stampLabel(v: Stamp): string | null {
  switch (v.stamp) {
    case "cleared": return CLEARED_STAMP;
    case "fault": return `${FAULT_STAMP}: ${v.reason ?? "UNKNOWN"}`;
    case "arcade": return ARCADE_STICKER;
    case "none": return null;
  }
}
