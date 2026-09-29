// src/game/policy/action-validation.ts (WP4)
// Validates what a policy returned (GAME_DESIGN 5.6) before anything reaches ctrl. Shared by every driver
// (Worker, in-process, trajectory, bridge) and by registration, so each transport judges actions identically.
//
//  - Legacy arrays of 6 numbers and PolicyAction objects are accepted; a chunk without targets uses chunk[0].
//  - Wrong shapes and NaN/Infinity are `error` (strict fails the seat, lenient holds the last action; sim-driver).
//  - Targets and chunk entries are clamped exactly to JOINT_LIMITS. A clamp is a violation (`clamped`) only when
//    the overshoot exceeds VIOLATION_TOLERANCE_RAD, so float32 policies that sit on a limit never fault.
//  - intents.grip is dropped (grip is targets[5] for policies, 4.9). There is no smoothing of any kind.

import {
  INTENT_BITS, JOINT_LIMITS, JOINT_NAMES, VIOLATION_TOLERANCE_RAD,
  type ActionStatus, type Intents, type PolicyAction, type PolicyDebug,
} from "../contracts.ts";

/** Longest chunk accepted from any transport (bridge hello advertises max_chunk up to this). */
export const MAX_CHUNK_LENGTH = 1000;
/** Per-step `info` payload cap (5.7), measured as JSON characters. */
export const MAX_INFO_BYTES = 4096;
const MAX_CHUNK_HZ = 1000;
const INTENT_MASK = 63;

export interface JointViolation { joint: number; overshoot: number; }

export interface ValidatedAction {
  status: Extract<ActionStatus, "ok" | "clamped" | "error">;
  /** Clamped, copied action; `null` when status is error. */
  action: PolicyAction | null;
  error: string | null;
  /** Largest overshoot seen across targets and chunk (recorded even under tolerance). */
  maxOvershoot: number;
  /** Violations beyond tolerance, one per joint (largest overshoot kept). */
  violations: JointViolation[];
}

export interface ValidateOptions {
  /** Chunk rate assumed when a chunk arrives without chunkHz (the seat's control rate). */
  defaultChunkHz: number;
}

const INTENT_KEYS = Object.keys(INTENT_BITS) as (keyof Intents)[];

function fail(error: string): ValidatedAction {
  return { status: "error", action: null, error, maxOvershoot: 0, violations: [] };
}

function describeNumber(v: unknown): string {
  if (typeof v !== "number") return v === null ? "null" : typeof v;
  return Number.isNaN(v) ? "NaN" : v > 0 ? "+Infinity" : "-Infinity";
}

/** Reads a 6-vector; returns an error string or null and writes finite values into out. */
function readTargets(raw: unknown, out: number[], where: string): string | null {
  if (!Array.isArray(raw) && !ArrayBuffer.isView(raw)) return `${where} is not an array`;
  const arr = raw as ArrayLike<unknown>;
  if (arr.length !== 6) return `${where} has ${arr.length} numbers, expected 6`;
  for (let j = 0; j < 6; j++) {
    const v = arr[j];
    if (typeof v !== "number" || !Number.isFinite(v)) return `${describeNumber(v)} at ${where}[${j}] (${JOINT_NAMES[j]})`;
    out[j] = v;
  }
  return null;
}

function clampInto(values: number[], track: { max: number; per: number[] }): void {
  for (let j = 0; j < 6; j++) {
    const [lo, hi] = JOINT_LIMITS[j];
    const v = values[j];
    const over = v > hi ? v - hi : v < lo ? lo - v : 0;
    if (over > 0) {
      values[j] = v > hi ? hi : lo;
      if (over > track.max) track.max = over;
      if (over > track.per[j]) track.per[j] = over;
    }
  }
}

function readIntents(raw: unknown): Partial<Intents> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Intents> = {};
  for (const k of INTENT_KEYS) {
    if (k === "grip") continue;
    if (src[k] === true) out[k] = true;
  }
  return out;
}

function readDebug(raw: unknown): PolicyDebug | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as PolicyDebug;
}

function readInfo(raw: unknown): unknown {
  if (raw === undefined) return undefined;
  let text: string | undefined;
  try { text = JSON.stringify(raw); } catch { return { unserializable: true }; }
  if (text === undefined) return undefined;
  if (text.length > MAX_INFO_BYTES) return { truncated: true, bytes: text.length };
  return raw;
}

/** Intent bits for a PolicyAction's `intents` (grip excluded). */
export function intentBitsOf(intents: Partial<Intents> | undefined): number {
  if (!intents) return 0;
  let bits = 0;
  for (const k of INTENT_KEYS) if (k !== "grip" && intents[k]) bits |= INTENT_BITS[k];
  return bits;
}

export function validateAction(raw: unknown, opts: ValidateOptions): ValidatedAction {
  if (raw === null || raw === undefined) return fail(`act() returned ${raw === null ? "null" : "nothing"}`);
  const obj: Record<string, unknown> = Array.isArray(raw) || ArrayBuffer.isView(raw) ? { targets: raw } : (typeof raw === "object" ? raw as Record<string, unknown> : {});
  if (typeof raw !== "object") return fail(`act() returned a ${typeof raw}`);

  const track = { max: 0, per: [0, 0, 0, 0, 0, 0] };
  const action: PolicyAction = { targets: [0, 0, 0, 0, 0, 0] };

  // Chunk first: targets may come from it.
  let chunk: number[][] | undefined;
  if (obj.chunk !== undefined) {
    if (!Array.isArray(obj.chunk)) return fail("chunk is not an array");
    if (obj.chunk.length === 0) return fail("chunk is empty");
    if (obj.chunk.length > MAX_CHUNK_LENGTH) return fail(`chunk has ${obj.chunk.length} entries, max ${MAX_CHUNK_LENGTH}`);
    chunk = new Array<number[]>(obj.chunk.length);
    for (let i = 0; i < obj.chunk.length; i++) {
      const row = [0, 0, 0, 0, 0, 0];
      const err = readTargets(obj.chunk[i], row, `chunk[${i}]`);
      if (err) return fail(err);
      clampInto(row, track);
      chunk[i] = row;
    }
    let hz = opts.defaultChunkHz;
    if (obj.chunkHz !== undefined) {
      if (typeof obj.chunkHz !== "number" || !Number.isFinite(obj.chunkHz) || obj.chunkHz <= 0 || obj.chunkHz > MAX_CHUNK_HZ) {
        return fail(`chunkHz ${describeValue(obj.chunkHz)} is outside (0, ${MAX_CHUNK_HZ}]`);
      }
      hz = obj.chunkHz;
    }
    action.chunk = chunk;
    action.chunkHz = hz;
    if (obj.chunkStartT !== undefined) {
      if (typeof obj.chunkStartT !== "number" || !Number.isFinite(obj.chunkStartT)) return fail(`chunkStartT ${describeValue(obj.chunkStartT)} is not finite`);
      action.chunkStartT = obj.chunkStartT;
    }
    if (obj.intentChunk !== undefined) {
      if (!Array.isArray(obj.intentChunk)) return fail("intentChunk is not an array");
      if (obj.intentChunk.length !== chunk.length) return fail(`intentChunk has ${obj.intentChunk.length} entries, chunk has ${chunk.length}`);
      const bits = new Array<number>(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const b = obj.intentChunk[i];
        if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > INTENT_MASK) return fail(`intentChunk[${i}] ${describeValue(b)} is not an intent bitfield`);
        bits[i] = b & ~INTENT_BITS.grip;
      }
      action.intentChunk = bits;
    }
  }

  if (obj.targets !== undefined) {
    const err = readTargets(obj.targets, action.targets, "targets");
    if (err) return fail(err);
    clampInto(action.targets, track);
  } else if (chunk) {
    for (let j = 0; j < 6; j++) action.targets[j] = chunk[0][j];
  } else {
    return fail("act() returned no targets");
  }

  const intents = readIntents(obj.intents);
  if (intents) action.intents = intents;
  const debug = readDebug(obj.debug);
  if (debug) action.debug = debug;
  const info = readInfo(obj.info);
  if (info !== undefined) action.info = info;

  const violations: JointViolation[] = [];
  for (let j = 0; j < 6; j++) if (track.per[j] > VIOLATION_TOLERANCE_RAD) violations.push({ joint: j, overshoot: track.per[j] });
  return {
    status: violations.length > 0 ? "clamped" : "ok",
    action, error: violations.length > 0 ? describeViolations(violations) : null,
    maxOvershoot: track.max, violations,
  };
}

function describeValue(v: unknown): string {
  return typeof v === "number" ? String(v) : v === null ? "null" : typeof v;
}

export function describeViolations(v: readonly JointViolation[]): string {
  return v.map((x) => `${JOINT_NAMES[x.joint]} +${x.overshoot.toFixed(4)} rad`).join(", ");
}

/** Clamps a 6-vector in place to JOINT_LIMITS shrunk by `margin` (the built-in AI uses 0.01 rad). */
export function clampToLimits(values: number[] | Float64Array, margin = 0): void {
  for (let j = 0; j < 6; j++) {
    const lo = JOINT_LIMITS[j][0] + margin, hi = JOINT_LIMITS[j][1] - margin;
    const v = values[j];
    values[j] = v > hi ? hi : v < lo ? lo : v;
  }
}
