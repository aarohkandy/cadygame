// src/game/harness/stats.ts (WP5)
// Episode statistics (GAME_DESIGN 5.10.1 physical block for every preset, 5.10.2 Arcade block). A pure function
// of the recorded episode: damage, deflects, and heat come from recorded events and columns, never from the
// current tuning, so archived numbers never drift. Detectors (attack onset, reaction) run on the recorded
// observation blocks with the tolerance constants written into the episode meta.
// NaN means "no sample" (no attacks received, no decisions, a value the recording does not carry).

import {
  INTENT_BITS, JOINT_LIMITS, OBS_BLOCKS, SEATS, otherSeat,
  type ArcadeSeatStats, type Episode, type EpisodeStats, type GameEvent, type PhysicalSeatStats, type QualityMeta, type Seat, type StatsTolerances,
} from "../contracts.ts";
import { STATS_TOLERANCES } from "../match/match-config.ts";
import { stepsPerControlTick } from "../match/presets.ts";
import { PHASE_CODE, isPilotDriver } from "./recorder.ts";
import { indexEpisode, type EpisodeIndex } from "./determinism.ts";
import { computeEventTimes } from "./replay-player.ts";
import { isPolicySeat, reliabilityCounts, seatVerdict } from "./verdict.ts";

/** Stock servo torque reference (N·m) for saturation (5.10.1). */
export const STOCK_TORQUE_NM = 2.94;
export const TORQUE_SATURATION = 0.98;
/** Guard volume (5.5.3): capsule from own camera_mount origin to own shoulder origin, radius 0.06 m. */
export const SHOULDER_EGO: readonly [number, number, number] = [0.039, 0, 0.062];
export const OPPONENT_BASE_EGO_X = 0.64;
export const GUARD_RADIUS_M = 0.06;
/** A received attack counts as blocked when no strike lands on the defender within this window. */
export const BLOCK_WINDOW_MS = 400;
export const THREAT_HORIZON_S = 0.3;
export const WHIFF_PUNISH_WINDOW_S = 1.0;
export const HEAVY_PARRY_WINDOW_MS = 600;
export const LDLJ_MAX_WINDOW_S = 0.6;

const LIVE = new Set([PHASE_CODE.fight, PHASE_CODE.sudden_death]);

/* ───────────────────────── small numeric helpers ───────────────────────── */

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return quantile(values.slice().sort((a, b) => a - b), 0.5);
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : Number.NaN);

type V3 = [number, number, number];

function closestOnSegment(p: V3, a: V3, b: V3, out: V3): V3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let u = len2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  out[0] = a[0] + abx * u; out[1] = a[1] + aby * u; out[2] = a[2] + abz * u;
  return out;
}

/* ───────────────────────── episode view ───────────────────────── */

export interface SeatView {
  state: Float32Array | null;        // rows × 12
  selfExt: Float32Array | null;      // rows × 32
  opp: Float32Array | null;          // rows × 28
  game: Float32Array | null;         // rows × 16
  action: Float64Array | null;       // rows × 6
  intents: Uint8Array | null;
  compute: Float32Array | null;
}

export interface EpisodeView {
  ep: Episode;
  rows: number;
  hz: number;
  dt: number;
  spt: number;
  tol: StatsTolerances;
  live: Uint8Array;                  // 1 when the row is in fight or sudden death
  /** Row index where a new contiguous run starts (engine reset or phase gap). */
  runStart: Uint8Array;
  seats: Record<Seat, SeatView>;
  eventRow: Int32Array;              // row of each recorded event
  index: EpisodeIndex | null;
}

export function viewEpisode(ep: Episode): EpisodeView {
  const rows = ep.columns.frame_index.length;
  const hz = ep.meta.controlHz;
  const phase = ep.columns.phase as Uint8Array | undefined;
  const disc = ep.columns.discontinuity as Uint8Array | undefined;
  const live = new Uint8Array(rows);
  const runStart = new Uint8Array(rows);
  for (let i = 0; i < rows; i++) {
    live[i] = phase && LIVE.has(phase[i]) ? 1 : 0;
    runStart[i] = i === 0 || !live[i - 1] || (disc ? (disc[i] & 1) !== 0 : false) ? 1 : 0;
  }
  const seats = {} as Record<Seat, SeatView>;
  for (const s of SEATS) {
    seats[s] = {
      state: (ep.columns[`observation.state.${s}`] as Float32Array | undefined) ?? null,
      selfExt: (ep.columns[`observation.self_ext.${s}`] as Float32Array | undefined) ?? null,
      opp: (ep.columns[`observation.opponent_state.${s}`] as Float32Array | undefined) ?? null,
      game: (ep.columns[`observation.game.${s}`] as Float32Array | undefined) ?? null,
      action: (ep.columns[`action.${s}`] as Float64Array | undefined) ?? null,
      intents: (ep.columns[`intents.${s}`] as Uint8Array | undefined) ?? null,
      compute: (ep.columns[`policy.compute_ms.${s}`] as Float32Array | undefined) ?? null,
    };
  }
  let index: EpisodeIndex | null = null;
  try { index = indexEpisode(ep); } catch { index = null; }
  const spt = stepsPerControlTick(ep.meta.timestep, hz);
  const eventRow = new Int32Array(ep.events.length);
  if (index) {
    const times = computeEventTimes(ep, index);
    for (let i = 0; i < times.length; i++) eventRow[i] = Math.min(rows - 1, Math.round(times[i] * hz));
  } else {
    for (let i = 0; i < ep.events.length; i++) eventRow[i] = Math.min(rows - 1, Math.floor(ep.events[i].step / spt));
  }
  const tol = { ...STATS_TOLERANCES, ...(ep.meta.tolerances ?? {}) } as StatsTolerances;
  return { ep, rows, hz, dt: 1 / hz, spt, tol, live, runStart, seats, eventRow, index };
}

/* ───────────────────────── attack onset (5.5.3 / 5.10.1) ───────────────────────── */

export interface AttackOnset { attacker: Seat; row: number; endRow: number; }

/** Attacker EE speed toward the nearest point of the victim's guard volume, in the attacker's ego frame. */
export function speedTowardGuard(v: EpisodeView, attacker: Seat, row: number, tmp: { p: V3; a: V3; b: V3; n: V3 }): number {
  const se = v.seats[attacker].selfExt, op = v.seats[attacker].opp;
  if (!se || !op) return 0;
  const o = row * OBS_BLOCKS.self_ext, q = row * OBS_BLOCKS.opponent_state;
  tmp.p[0] = se[o]; tmp.p[1] = se[o + 1]; tmp.p[2] = se[o + 2];
  tmp.a[0] = op[q + 25]; tmp.a[1] = op[q + 26]; tmp.a[2] = op[q + 27];
  tmp.b[0] = OPPONENT_BASE_EGO_X - SHOULDER_EGO[0]; tmp.b[1] = -SHOULDER_EGO[1]; tmp.b[2] = SHOULDER_EGO[2];
  closestOnSegment(tmp.p, tmp.a, tmp.b, tmp.n);
  const dx = tmp.n[0] - tmp.p[0], dy = tmp.n[1] - tmp.p[1], dz = tmp.n[2] - tmp.p[2];
  const d = Math.hypot(dx, dy, dz);
  const vx = se[o + 7], vy = se[o + 8], vz = se[o + 9];
  if (d < 1e-9) return Math.hypot(vx, vy, vz);
  return (vx * dx + vy * dy + vz * dz) / d;
}

export function detectAttackOnsets(v: EpisodeView, attacker: Seat): AttackOnset[] {
  const out: AttackOnset[] = [];
  const minRows = Math.max(1, Math.ceil((v.tol.attackOnsetMs / 1000) * v.hz - 1e-9));
  const debounceRows = (v.tol.debounceMs / 1000) * v.hz;
  const tmp = { p: [0, 0, 0] as V3, a: [0, 0, 0] as V3, b: [0, 0, 0] as V3, n: [0, 0, 0] as V3 };
  let runFrom = -1;
  let counted = false;
  let lastOnset = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < v.rows; i++) {
    const fast = v.live[i] === 1 && speedTowardGuard(v, attacker, i, tmp) > v.tol.attackOnsetSpeed;
    if (v.runStart[i] && runFrom >= 0) { runFrom = -1; counted = false; }
    if (fast) {
      if (runFrom < 0) { runFrom = i; counted = false; }
      if (!counted && i - runFrom + 1 >= minRows && runFrom - lastOnset >= debounceRows) {
        out.push({ attacker, row: runFrom, endRow: i });
        lastOnset = runFrom;
        counted = true;
      } else if (counted) {
        out[out.length - 1].endRow = i;
      }
    } else {
      runFrom = -1;
      counted = false;
    }
  }
  return out;
}

/* ───────────────────────── reaction latency ───────────────────────── */

/** Predicted minimum distance over the horizon between the attacker EE ray and the defender's guard volume moved by `vel`. */
function threatDistance(v: EpisodeView, defender: Seat, row: number, vel: V3, tmp: { p: V3; a: V3; b: V3; n: V3 }): number {
  const se = v.seats[defender].selfExt, op = v.seats[defender].opp;
  if (!se || !op) return Number.POSITIVE_INFINITY;
  const o = row * OBS_BLOCKS.self_ext, q = row * OBS_BLOCKS.opponent_state;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= 6; k++) {
    const tau = (THREAT_HORIZON_S * k) / 6;
    tmp.p[0] = op[q + 12] + op[q + 19] * tau; tmp.p[1] = op[q + 13] + op[q + 20] * tau; tmp.p[2] = op[q + 14] + op[q + 21] * tau;
    tmp.a[0] = se[o + 10] + vel[0] * tau; tmp.a[1] = se[o + 11] + vel[1] * tau; tmp.a[2] = se[o + 12] + vel[2] * tau;
    tmp.b[0] = SHOULDER_EGO[0]; tmp.b[1] = SHOULDER_EGO[1]; tmp.b[2] = SHOULDER_EGO[2];
    closestOnSegment(tmp.p, tmp.a, tmp.b, tmp.n);
    const d = Math.hypot(tmp.n[0] - tmp.p[0], tmp.n[1] - tmp.p[1], tmp.n[2] - tmp.p[2]) - GUARD_RADIUS_M;
    if (d < best) best = d;
  }
  return best;
}

export interface ReactionSample { onsetRow: number; rawMs: number | null; }

export function reactionSamples(v: EpisodeView, defender: Seat, onsets: readonly AttackOnset[]): ReactionSample[] {
  const se = v.seats[defender].selfExt;
  if (!se) return [];
  const windowRows = Math.floor((v.tol.reactionWindowMs / 1000) * v.hz + 1e-9);
  const tmp = { p: [0, 0, 0] as V3, a: [0, 0, 0] as V3, b: [0, 0, 0] as V3, n: [0, 0, 0] as V3 };
  const v0: V3 = [0, 0, 0];
  const vr: V3 = [0, 0, 0];
  const out: ReactionSample[] = [];
  for (const on of onsets) {
    const r0 = on.row;
    const o0 = r0 * OBS_BLOCKS.self_ext;
    v0[0] = se[o0 + 7]; v0[1] = se[o0 + 8]; v0[2] = se[o0 + 9];
    let raw: number | null = null;
    for (let r = r0 + 1; r <= r0 + windowRows && r < v.rows; r++) {
      if (v.runStart[r]) break;
      const o = r * OBS_BLOCKS.self_ext;
      vr[0] = se[o + 7]; vr[1] = se[o + 8]; vr[2] = se[o + 9];
      if (Math.hypot(vr[0] - v0[0], vr[1] - v0[1], vr[2] - v0[2]) <= v.tol.reactionDv) continue;
      if (threatDistance(v, defender, r, vr, tmp) > threatDistance(v, defender, r, v0, tmp)) {
        raw = ((r - r0) / v.hz) * 1000;
        break;
      }
    }
    out.push({ onsetRow: r0, rawMs: raw });
  }
  return out;
}

/** Structural latency a seat cannot react faster than (5.10.1). */
export function structuralLatencyMs(v: EpisodeView, seat: Seat): number {
  const meta = v.ep.meta;
  const sm = meta.seats[seat];
  if (!isPolicySeat(v.ep, seat)) {
    const lat = v.ep.columns["human.display_latency_ms"] as Float32Array | undefined;
    if (!lat) return 0;
    const finite: number[] = [];
    for (let i = 0; i < lat.length; i++) if (Number.isFinite(lat[i])) finite.push(lat[i]);
    const m = median(finite);
    return Number.isFinite(m) ? m : 0;
  }
  let ms = sm.decisionHz > 0 ? 1000 / sm.decisionHz : 0;
  ms += meta.actionDelayTicks * (1000 / meta.controlHz);
  const opp = meta.seats[otherSeat(seat)].driver;
  const external = sm.driver === "module" || sm.driver === "trajectory" || sm.driver === "bridge";
  if (external && (opp === "human" || opp === "proxy")) ms += meta.fairDelayMs;
  const lag = (sm.provenance as { perceptionLagMs?: unknown } | null)?.perceptionLagMs;
  if (sm.driver === "builtin" && typeof lag === "number" && Number.isFinite(lag)) ms += lag;
  return ms;
}

/* ───────────────────────── applied control series ───────────────────────── */

/**
 * Applied ctrl per row for a seat: the action column for policy seats (constant over the tick), the mean of the
 * recorded per-step ctrl over the tick for pilot seats (whose ctrl changes every physics step).
 */
export function appliedSeries(v: EpisodeView, seat: Seat): Float64Array {
  const out = new Float64Array(v.rows * 6).fill(Number.NaN);
  const action = v.seats[seat].action;
  if (action) out.set(action.subarray(0, out.length));
  if (isPolicySeat(v.ep, seat) || !v.index) return out;
  const ctrl = v.ep.steps.ctrl;
  const base = seat === "atlas" ? 0 : 6;
  for (const seg of v.index.segments) {
    let p = seg.ctrlIndex - 1;
    for (let row = seg.firstTick; row < seg.endTick; row++) {
      const first = seg.resetStep + (row - seg.firstTick) * v.spt;
      let n = 0;
      const sum = [0, 0, 0, 0, 0, 0];
      for (let step = first; step < first + v.spt && step - seg.resetStep < seg.steps; step++) {
        while (p + 1 < seg.ctrlEnd && ctrl.steps[p + 1] <= step) p++;
        if (p < seg.ctrlIndex) continue;
        for (let j = 0; j < 6; j++) sum[j] += ctrl.values[p * ctrl.width + base + j];
        n++;
      }
      if (n > 0) for (let j = 0; j < 6; j++) out[row * 6 + j] = sum[j] / n;
    }
  }
  return out;
}

/** Contiguous live runs of the series resampled to h (linear interpolation in row time). */
export function resampledRuns(v: EpisodeView, series: Float64Array, h: number): Float64Array[] {
  const runs: Float64Array[] = [];
  let i = 0;
  while (i < v.rows) {
    if (!v.live[i]) { i++; continue; }
    let j = i + 1;
    while (j < v.rows && v.live[j] && !v.runStart[j]) j++;
    const n = j - i;
    const duration = (n - 1) * v.dt;
    const m = Math.floor(duration / h + 1e-9) + 1;
    if (n >= 2 && m >= 2) {
      const run = new Float64Array(m * 6);
      for (let k = 0; k < m; k++) {
        const pos = (k * h) / v.dt;
        const a = Math.min(n - 1, Math.floor(pos + 1e-9));
        const b = Math.min(n - 1, a + 1);
        const f = pos - a;
        for (let q = 0; q < 6; q++) {
          const va = series[(i + a) * 6 + q], vb = series[(i + b) * 6 + q];
          run[k * 6 + q] = f < 1e-12 ? va : va + (vb - va) * f;
        }
      }
      runs.push(run);
    }
    i = j;
  }
  return runs;
}

/** RMS of the third difference over h³ (rad/s³) across every run (5.10.1 action jerk). */
export function actionJerk(runs: readonly Float64Array[], h: number): number {
  let sum = 0;
  let count = 0;
  const h3 = h * h * h;
  for (const run of runs) {
    const m = run.length / 6;
    for (let k = 2; k < m - 1; k++) {
      let norm2 = 0;
      for (let q = 0; q < 6; q++) {
        const d = (run[(k + 1) * 6 + q] - 3 * run[k * 6 + q] + 3 * run[(k - 1) * 6 + q] - run[(k - 2) * 6 + q]) / h3;
        norm2 += d * d;
      }
      if (Number.isFinite(norm2)) { sum += norm2; count++; }
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : Number.NaN;
}

/** Sign changes of Δa per joint per second, counting only |Δa| above the threshold (5.10.1 action chatter). */
export function actionChatter(runs: readonly Float64Array[], h: number, minDelta: number): number {
  let changes = 0;
  let seconds = 0;
  for (const run of runs) {
    const m = run.length / 6;
    if (m < 2) continue;
    seconds += (m - 1) * h;
    for (let q = 0; q < 6; q++) {
      let lastSign = 0;
      for (let k = 1; k < m; k++) {
        const d = run[k * 6 + q] - run[(k - 1) * 6 + q];
        if (!(Math.abs(d) > minDelta)) continue;
        const sign = d > 0 ? 1 : -1;
        if (lastSign !== 0 && sign !== lastSign) changes++;
        lastSign = sign;
      }
    }
  }
  return seconds > 0 ? changes / (6 * seconds) : Number.NaN;
}

/** Log dimensionless jerk of one EE velocity profile sampled at dt: −ln((T³ / v_peak²) ∫‖d²v/dt²‖² dt). */
export function ldlj(vel: Float64Array, dt: number): number {
  const n = vel.length / 3;
  if (n < 4) return Number.NaN;
  const T = (n - 1) * dt;
  let vPeak = 0;
  for (let k = 0; k < n; k++) vPeak = Math.max(vPeak, Math.hypot(vel[k * 3], vel[k * 3 + 1], vel[k * 3 + 2]));
  let integral = 0;
  for (let k = 1; k < n - 1; k++) {
    let s = 0;
    for (let q = 0; q < 3; q++) {
      const a = (vel[(k + 1) * 3 + q] - 2 * vel[k * 3 + q] + vel[(k - 1) * 3 + q]) / (dt * dt);
      s += a * a;
    }
    integral += s * dt;
  }
  if (!(vPeak > 0) || !(integral > 0)) return Number.NaN;
  return -Math.log(((T * T * T) / (vPeak * vPeak)) * integral);
}

function attackLdlj(v: EpisodeView, seat: Seat, onsets: readonly AttackOnset[]): number {
  const se = v.seats[seat].selfExt;
  if (!se) return Number.NaN;
  const maxRows = Math.round(LDLJ_MAX_WINDOW_S * v.hz);
  const values: number[] = [];
  for (const on of onsets) {
    const from = Math.max(0, on.row - 1);
    let to = Math.min(v.rows - 1, on.endRow + 1, on.row + maxRows);
    for (let r = from + 1; r <= to; r++) if (v.runStart[r]) { to = r - 1; break; }
    const n = to - from + 1;
    if (n < 4) continue;
    const vel = new Float64Array(n * 3);
    for (let k = 0; k < n; k++) {
      const o = (from + k) * OBS_BLOCKS.self_ext;
      vel[k * 3] = se[o + 7]; vel[k * 3 + 1] = se[o + 8]; vel[k * 3 + 2] = se[o + 9];
    }
    const x = ldlj(vel, v.dt);
    if (Number.isFinite(x)) values.push(x);
  }
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
}

/* ───────────────────────── per-seat stats ───────────────────────── */

type Ev<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

function physicalFor(v: EpisodeView, seat: Seat, onsets: Record<Seat, AttackOnset[]>): PhysicalSeatStats {
  const ep = v.ep;
  const opp = otherSeat(seat);
  const sv = v.seats[seat];
  let physicalDamageDealt = 0, physicalDamageTaken = 0, strikesLanded = 0, strikesTaken = 0, grazesLanded = 0, grazesTaken = 0, crits = 0;
  let steals = 0, lateSteals = 0, locks = 0;
  const approach: number[] = [];
  const strikeRowsOnSeat: number[] = [];
  for (let i = 0; i < ep.events.length; i++) {
    const e = ep.events[i];
    if (e.type === "strike") {
      const s = e as Ev<"strike">;
      if (s.attacker === seat) {
        physicalDamageDealt += s.physicalDamage;
        if (s.tier === "strike") { strikesLanded++; approach.push(s.vN); if (s.crit) crits++; } else grazesLanded++;
      }
      if (s.victim === seat) {
        physicalDamageTaken += s.physicalDamage;
        if (s.tier === "strike") { strikesTaken++; strikeRowsOnSeat.push(v.eventRow[i]); } else grazesTaken++;
      }
    } else if (e.type === "core") {
      if (e.stage === "steal" && e.seat === seat) { steals++; if (e.late) lateSteals++; }
      if (e.stage === "lock" && e.seat === seat) locks++;
    }
  }
  approach.sort((a, b) => a - b);

  // Blocks and reactions against the opponent's attacks.
  const received = onsets[opp];
  const blockRows = (BLOCK_WINDOW_MS / 1000) * v.hz;
  let blocked = 0;
  for (const on of received) {
    if (!strikeRowsOnSeat.some((r) => r >= on.row && r <= on.row + blockRows)) blocked++;
  }
  const structural = structuralLatencyMs(v, seat);
  const samples = reactionSamples(v, seat, received);
  const raws = samples.filter((s) => s.rawMs !== null).map((s) => s.rawMs as number).sort((a, b) => a - b);
  const rawMedian = quantile(raws, 0.5);

  // Decisions and reliability.
  const counts = reliabilityCounts(ep, seat);
  const computeVals: number[] = [];
  if (sv.compute) for (let i = 0; i < sv.compute.length; i++) if (Number.isFinite(sv.compute[i])) computeVals.push(sv.compute[i]);
  computeVals.sort((a, b) => a - b);
  const dec = counts.decisions;
  const failures = counts.late + counts.timeouts + counts.errors + counts.clamped;

  // Joint, torque, energy, Core hold over live rows.
  let liveRows = 0, nearLimit = 0, saturated = 0, energy = 0, heldS = 0;
  const satLimit = TORQUE_SATURATION * STOCK_TORQUE_NM;
  let prevRemaining = Number.NaN;
  for (let i = 0; i < v.rows; i++) {
    if (!v.live[i]) { prevRemaining = Number.NaN; continue; }
    liveRows++;
    if (sv.state) {
      const o = i * OBS_BLOCKS.state;
      let near = false;
      for (let j = 0; j < 6; j++) {
        const q = sv.state[o + j];
        if (Math.abs(q - JOINT_LIMITS[j][0]) < v.tol.nearLimit || Math.abs(q - JOINT_LIMITS[j][1]) < v.tol.nearLimit) near = true;
        if (sv.selfExt) {
          const tau = sv.selfExt[i * OBS_BLOCKS.self_ext + 13 + j];
          energy += Math.abs(tau * sv.state[o + 6 + j]) * v.dt;
        }
      }
      if (near) nearLimit++;
    }
    if (sv.selfExt) {
      const o = i * OBS_BLOCKS.self_ext;
      for (let j = 0; j < 6; j++) if (Math.abs(sv.selfExt[o + 13 + j]) >= satLimit) { saturated++; break; }
    }
    if (sv.game) {
      const g = i * OBS_BLOCKS.game;
      const remaining = sv.game[g + 6] > 0 ? sv.game[g + 6] * sv.game[g + 7] * 8 : Number.NaN;
      if (v.runStart[i]) prevRemaining = Number.NaN;
      if (Number.isFinite(remaining) && Number.isFinite(prevRemaining) && prevRemaining > remaining) heldS += prevRemaining - remaining;
      prevRemaining = remaining;
    }
  }

  const h = v.tol.jerkH;
  const runs = resampledRuns(v, appliedSeries(v, seat), h);

  return {
    physicalDamageDealt, physicalDamageTaken,
    opticsImpulse: opticsImpulseFor(ep, seat),
    approachSpeed: { median: quantile(approach, 0.5), p90: quantile(approach, 0.9) },
    strikesLanded, strikesTaken, grazesLanded, grazesTaken, crits,
    attackAttempts: onsets[seat].length,
    accuracy: ratio(strikesLanded, onsets[seat].length),
    physicalBlockRate: ratio(blocked, received.length),
    reactionMs: {
      rawMedian,
      netMedian: Number.isFinite(rawMedian) ? rawMedian - structural : Number.NaN,
      p10: quantile(raws, 0.1), p90: quantile(raws, 0.9), n: raws.length,
      anticipations: raws.filter((r) => r < structural + v.tol.anticipationMarginMs).length,
      noReaction: samples.length - raws.length,
      structuralMs: structural,
    },
    lockInHeldS: heldS, steals, lateSteals, locks,
    computeMs: { median: quantile(computeVals, 0.5), p99: quantile(computeVals, 0.99), max: computeVals.length ? computeVals[computeVals.length - 1] : Number.NaN },
    slowDecisions: counts.slow,
    lateFrac: dec > 0 ? counts.late / dec : 0,
    timeoutFrac: dec > 0 ? counts.timeouts / dec : 0,
    errorFrac: dec > 0 ? counts.errors / dec : 0,
    clampedFrac: dec > 0 ? counts.clamped / dec : 0,
    reliability: dec > 0 ? 1 - failures / dec : 1,
    violationsPerJoint: counts.violationsPerJoint.slice(),
    maxOvershoot: counts.maxOvershoot,
    nearLimitDwell: ratio(nearLimit, liveRows),
    torqueSaturationFrac: ratio(saturated, liveRows),
    actionJerk: actionJerk(runs, h),
    actionChatter: actionChatter(runs, h, v.tol.chatterMin),
    ldlj: attackLdlj(v, seat, onsets[seat]),
    energyJ: energy,
    tableHits: counts.tableHits,
    selfCollisions: sparseCount(ep, `physics.self_contacts.${seat}`),
  };
}

/**
 * Σ normal impulse this seat delivered to the opponent's camera mount, from the sparse column the sim driver
 * writes (it opens the column with a zero at the first step, so a recorded episode with no optics contact sums
 * to 0). An episode that carries no column at all was recorded without the measurement: NaN, never a made-up 0.
 */
function opticsImpulseFor(ep: Episode, seat: Seat): number {
  const list = ep.sparse[`physics.optics_impulse.${otherSeat(seat)}`];
  if (!Array.isArray(list)) return Number.NaN;
  let sum = 0;
  for (const e of list) if (typeof e.value === "number" && Number.isFinite(e.value)) sum += e.value;
  return sum;
}

function sparseCount(ep: Episode, column: string): number {
  const list = ep.sparse[column];
  return Array.isArray(list) ? list.length : Number.NaN;
}

function arcadeFor(v: EpisodeView, seat: Seat): ArcadeSeatStats {
  const ep = v.ep;
  const opp = otherSeat(seat);
  const s: ArcadeSeatStats = {
    damageDealt: 0, damageTaken: 0, guardedChips: 0, deflects: 0, hardDeflects: 0, lateGuards: 0,
    whiffs: 0, whiffPunishes: 0, meanHeat: Number.NaN, cutouts: 0, staggersDealt: 0, staggersTaken: 0, bursts: 0,
    heavyAttempts: 0, heavySuccesses: 0, aiHeavyParryAttempts: 0, aiHeavyParrySuccesses: 0,
  };
  const oppWhiffRows: number[] = [];
  const myStrikeRows: number[] = [];
  const oppHeavyRows: number[] = [];
  const myDeflectRows: number[] = [];
  for (let i = 0; i < ep.events.length; i++) {
    const e = ep.events[i];
    const row = v.eventRow[i];
    switch (e.type) {
      case "strike":
        if (e.attacker === seat) {
          s.damageDealt += e.damage;
          myStrikeRows.push(row);
          if (e.heavyC > 0 && !e.guarded) s.heavySuccesses++;
        }
        if (e.victim === seat) { s.damageTaken += e.damage; if (e.guarded) s.guardedChips++; }
        break;
      case "deflect":
        if (e.defender === seat) { s.deflects++; if (e.hard) s.hardDeflects++; myDeflectRows.push(row); }
        break;
      case "late_guard": if (e.defender === seat) s.lateGuards++; break;
      case "whiff":
        if (e.seat === seat) s.whiffs++;
        else oppWhiffRows.push(row);
        break;
      case "servo_state":
        if (e.state === "cutout" && e.seat === seat) s.cutouts++;
        if (e.state === "stagger") { if (e.seat === opp) s.staggersDealt++; else s.staggersTaken++; }
        break;
      case "burst": if (e.seat === seat) s.bursts++; break;
      case "charge":
        if (e.stage === "release") { if (e.seat === seat) s.heavyAttempts++; else oppHeavyRows.push(row); }
        break;
      default: break;
    }
  }
  const punishRows = WHIFF_PUNISH_WINDOW_S * v.hz;
  for (const w of oppWhiffRows) if (myStrikeRows.some((r) => r > w && r <= w + punishRows)) s.whiffPunishes++;

  const game = v.seats[seat].game;
  if (game) {
    let sum = 0, n = 0;
    for (let i = 0; i < v.rows; i++) if (v.live[i]) { sum += game[i * OBS_BLOCKS.game + 10] * 100; n++; }
    s.meanHeat = n > 0 ? sum / n : Number.NaN;
  }

  if (ep.meta.seats[seat].driver === "builtin") {
    const intents = v.seats[seat].intents;
    const win = (HEAVY_PARRY_WINDOW_MS / 1000) * v.hz;
    for (const release of oppHeavyRows) {
      let pressed = false;
      if (intents) {
        for (let r = Math.max(1, Math.floor(release - win)); r <= Math.min(v.rows - 1, release + win); r++) {
          if ((intents[r] & INTENT_BITS.guard) && !(intents[r - 1] & INTENT_BITS.guard)) { pressed = true; break; }
        }
      }
      const deflected = myDeflectRows.some((r) => r >= release && r <= release + win);
      if (pressed || deflected) {
        s.aiHeavyParryAttempts++;
        if (deflected) s.aiHeavyParrySuccesses++;
      }
    }
  }
  return s;
}

/* ───────────────────────── entry point ───────────────────────── */

export function computeStats(ep: Episode): EpisodeStats {
  const v = viewEpisode(ep);
  const onsets: Record<Seat, AttackOnset[]> = { atlas: detectAttackOnsets(v, "atlas"), blaze: detectAttackOnsets(v, "blaze") };
  const seats = {} as EpisodeStats["seats"];
  const verdict = {} as EpisodeStats["verdict"];
  for (const s of SEATS) {
    seats[s] = { physical: physicalFor(v, s, onsets), arcade: ep.meta.preset === "arcade" ? arcadeFor(v, s) : null };
    verdict[s] = seatVerdict(ep, s);
  }
  const quality = qualityMeta(ep, seats, verdict);
  // 9: the tier is computed at match end. The director calls computeStats(ep) on the finished episode before it is
  // saved, so stamping it here is what puts meta.quality into every stored /4 episode. An episode that already
  // carries a stamp (imported, or a re-simulation) keeps it: the version names the rules it was scored under.
  if (!ep.meta.quality) ep.meta.quality = quality;
  return { seats, result: ep.meta.result, durationS: v.hz > 0 ? v.rows / v.hz : 0, verdict, quality: ep.meta.quality };
}

/* ───────────────────────── quality tier (9, frozen at dataset v1) ───────────────────────── */

/** Bumped only with a dataset release; the CONTRIBUTORS board shows it. */
export const QUALITY_VERSION = 1;
/** Reference drill duration window for an A (seconds): [p10, p60] of the v1 reference distribution. */
export const DRILL_DURATION_REF_S: Readonly<{ p10: number; p60: number }> = { p10: 6, p60: 14 };
export const QUALITY_LDLJ_MIN = -8;
/** Below this much pilot motion over the live rows the episode is AFK (rad summed over six joints per live second). */
export const AFK_MOTION_RAD_PER_S = 0.02;

/**
 * A = success, duration in [p10, p60], 0 table hits, LDLJ > −8; B = success with any of those missed; C = attempted
 * (≥ 1 grasp segment, or an attack that landed nothing in a duel) but failed; D = idle / AFK. A duel round has no
 * task success: it is A when the pilot landed a strike cleanly (0 table hits, LDLJ > −8), B when it landed at all,
 * C when it attacked and landed nothing. `clean` = no policy fault, no forfeit, not diverged, not AFK.
 */
export function qualityMeta(ep: Episode, seats: EpisodeStats["seats"], verdict: EpisodeStats["verdict"]): QualityMeta {
  const pilot = SEATS.find((s) => isPilotDriver(ep.meta.seats[s].driver)) ?? null;
  const reasons: string[] = [];
  if (!pilot) {
    return { clean: verdict.atlas.stamp !== "fault" && verdict.blaze.stamp !== "fault", tier: "D", version: QUALITY_VERSION, reasons: ["no pilot seat"] };
  }
  const phys = seats[pilot].physical;
  const motion = pilotMotion(ep, pilot);
  const afk = !(motion > AFK_MOTION_RAD_PER_S);
  if (afk) reasons.push("idle");
  const drills = (ep.meta.rounds ?? []).filter((r) => r.outcome !== null);
  let tier: QualityMeta["tier"];
  if (drills.length > 0) {
    const success = drills.filter((r) => r.outcome === "success");
    const attempted = drills.some((r) => r.segments.some((g) => g.label === "grasp" || g.label === "lift" || g.label === "transport" || g.label === "place"));
    if (afk) tier = "D";
    else if (success.length === 0) { tier = attempted ? "C" : "D"; reasons.push(attempted ? "no drill succeeded" : "no grasp"); }
    else {
      const inWindow = success.every((r) => r.durationS >= DRILL_DURATION_REF_S.p10 && r.durationS <= DRILL_DURATION_REF_S.p60);
      if (!inWindow) reasons.push("duration outside [p10, p60]");
      if (!(phys.tableHits === 0)) reasons.push(`${Number.isFinite(phys.tableHits) ? phys.tableHits : "?"} table hits`);
      if (phys.ldlj <= QUALITY_LDLJ_MIN) reasons.push(`LDLJ ${phys.ldlj.toFixed(1)}`);     // NaN = no attack profile to judge: not a miss
      tier = reasons.length === 0 ? "A" : "B";
    }
  } else if (afk) {
    tier = "D";
  } else if (phys.strikesLanded > 0) {
    if (!(phys.tableHits === 0)) reasons.push(`${phys.tableHits} table hits`);
    if (phys.ldlj <= QUALITY_LDLJ_MIN) reasons.push(`LDLJ ${phys.ldlj.toFixed(1)}`);
    tier = reasons.length === 0 ? "A" : "B";
  } else if (phys.attackAttempts > 0) {
    tier = "C"; reasons.push("no strike landed");
  } else {
    tier = "D"; reasons.push("no attack");
  }
  const faulted = SEATS.some((s) => verdict[s].stamp === "fault");
  if (faulted) reasons.push("policy fault");
  if (ep.meta.result.forfeit) reasons.push("forfeit");
  if (ep.meta.result.determinism === "diverged") reasons.push("diverged");
  const clean = !faulted && !ep.meta.result.forfeit && ep.meta.result.determinism !== "diverged" && !afk;
  return { clean, tier, version: QUALITY_VERSION, reasons };
}

/** Σ|Δq| over six joints per live second for the pilot seat, from the recorded state block. */
function pilotMotion(ep: Episode, seat: Seat): number {
  const state = ep.columns[`observation.state.${seat}`] as Float32Array | undefined;
  const phase = ep.columns.phase as Uint8Array | undefined;
  if (!state || !phase) return 0;
  const rows = ep.columns.frame_index.length;
  let sum = 0, live = 0;
  for (let i = 1; i < rows; i++) {
    if (!LIVE.has(phase[i]) || !LIVE.has(phase[i - 1])) continue;
    live++;
    for (let j = 0; j < 6; j++) sum += Math.abs(state[i * OBS_BLOCKS.state + j] - state[(i - 1) * OBS_BLOCKS.state + j]);
  }
  return live > 0 ? sum * ep.meta.controlHz / live : 0;
}
