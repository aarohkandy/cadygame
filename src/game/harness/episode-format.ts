// src/game/harness/episode-format.ts (WP5)
// The torquelimit.episode/4 JSON codec (BUILD_PLAN D5, EMOTION_BIBLE 9): one JSON document, extension .tlep.json.
// /4 is additive over /3 (meta.session, opponentMemory, rounds, quality, the human.raw / active / gaze_hint and
// dda.k columns); a /3 document imports unchanged and is stamped /4 on the way in.
// Every typed column, RLE stream, SimState, and checkpoint is { dtype, length, b64 } holding the exact
// little-endian bytes, so export -> import is bit-identical. IndexedDB keeps the in-memory Episode by
// structured clone; this codec runs only on export and import.

import {
  EPISODE_FORMAT, EPISODE_FORMATS_READABLE,
  type CreateEpisodeCodec, type EncodedSimState, type EncodedTyped, type Episode, type EpisodeCodec, type EpisodeJson,
  type RleStream, type SimMutation, type SimState,
} from "../contracts.ts";
import { TypedDecodeError, decodeTyped, dtypeOf, encodeTyped, type TypedColumn } from "./typed-b64.ts";

export const EPISODE_FILE_EXTENSION = ".tlep.json";
export const EPISODE_MIME = "application/json";

export type EpisodeFormatErrorCode = "not_json" | "wrong_format" | "unknown_dtype" | "length_mismatch" | "malformed";

/** Import failures, named so the Replays screen can show exactly what is wrong with a file. */
export class EpisodeFormatError extends Error {
  readonly code: EpisodeFormatErrorCode;
  /** Dotted path of the offending field, e.g. `columns.action.atlas`; null for whole-document problems. */
  readonly path: string | null;
  constructor(code: EpisodeFormatErrorCode, message: string, path: string | null = null) {
    super(path ? `${message} (${path})` : message);
    this.name = "EpisodeFormatError";
    this.code = code;
    this.path = path;
  }
  /** Short broadcast-style label, e.g. `LENGTH MISMATCH · columns.action.atlas`. */
  get label(): string {
    const head = {
      not_json: "NOT AN EPISODE FILE", wrong_format: "WRONG FORMAT", unknown_dtype: "UNKNOWN DTYPE",
      length_mismatch: "LENGTH MISMATCH", malformed: "DAMAGED EPISODE",
    }[this.code];
    return this.path ? `${head} · ${this.path}` : head;
  }
}

function fail(code: EpisodeFormatErrorCode, message: string, path: string | null = null): never {
  throw new EpisodeFormatError(code, message, path);
}

function typedAt(enc: unknown, path: string, expect?: readonly string[]): TypedColumn {
  try {
    const arr = decodeTyped(enc);
    if (expect && !expect.includes(dtypeOf(arr))) fail("malformed", `expected ${expect.join(" or ")}, got ${dtypeOf(arr)}`, path);
    return arr;
  } catch (err) {
    if (err instanceof EpisodeFormatError) throw err;
    if (err instanceof TypedDecodeError) {
      const code: EpisodeFormatErrorCode = err.code === "unknown_dtype" ? "unknown_dtype" : err.code === "length_mismatch" ? "length_mismatch" : "malformed";
      fail(code, err.message, path);
    }
    throw err;
  }
}

/* ───────────────────────── SimState ───────────────────────── */

export function encodeSimState(s: SimState): EncodedSimState {
  return {
    time: s.time, qpos: encodeTyped(s.qpos), qvel: encodeTyped(s.qvel), ctrl: encodeTyped(s.ctrl),
    qacc_warmstart: encodeTyped(s.qacc_warmstart), servo: encodeTyped(s.servo),
  };
}

export function decodeSimState(e: unknown, path: string): SimState {
  if (!e || typeof e !== "object") fail("malformed", "expected a SimState", path);
  const o = e as Partial<EncodedSimState>;
  if (typeof o.time !== "number") fail("malformed", "SimState.time must be a number", `${path}.time`);
  const f64 = ["f64"] as const;
  return {
    time: o.time,
    qpos: typedAt(o.qpos, `${path}.qpos`, f64) as Float64Array,
    qvel: typedAt(o.qvel, `${path}.qvel`, f64) as Float64Array,
    ctrl: typedAt(o.ctrl, `${path}.ctrl`, f64) as Float64Array,
    qacc_warmstart: typedAt(o.qacc_warmstart, `${path}.qacc_warmstart`, f64) as Float64Array,
    servo: typedAt(o.servo, `${path}.servo`, f64) as Float64Array,
  };
}

/* ───────────────────────── document ───────────────────────── */

function encodeRle(r: RleStream): { steps: EncodedTyped; values: EncodedTyped; width: number } {
  return { steps: encodeTyped(r.steps), values: encodeTyped(r.values), width: r.width };
}

function decodeRle(e: unknown, path: string, valueDtype: "f64" | "u8"): RleStream {
  if (!e || typeof e !== "object") fail("malformed", "expected an RLE stream", path);
  const o = e as { steps?: unknown; values?: unknown; width?: unknown };
  if (typeof o.width !== "number" || !Number.isInteger(o.width) || o.width < 1) fail("malformed", "width must be a positive integer", `${path}.width`);
  const steps = typedAt(o.steps, `${path}.steps`, ["u32"]) as Uint32Array;
  const values = typedAt(o.values, `${path}.values`, [valueDtype]) as Float64Array | Uint8Array;
  if (values.length !== steps.length * o.width) {
    fail("length_mismatch", `${steps.length} entries × width ${o.width} needs ${steps.length * o.width} values, found ${values.length}`, `${path}.values`);
  }
  return { steps, values, width: o.width };
}

/** The in-memory episode as the EpisodeJson object (no stringify). */
export function episodeToJson(ep: Episode): EpisodeJson {
  const columns: Record<string, EncodedTyped> = {};
  for (const name of Object.keys(ep.columns)) columns[name] = encodeTyped(ep.columns[name]);
  const mutations: EpisodeJson["steps"]["mutations"] = ep.steps.mutations.map((m) =>
    m.kind === "reset" ? { kind: "reset", step: m.step, seed: m.seed, round: m.round, state: encodeSimState(m.state) } : m,
  );
  return {
    format: EPISODE_FORMAT,
    meta: ep.meta,
    columns,
    shapes: ep.shapes,
    steps: {
      ctrl: encodeRle(ep.steps.ctrl),
      intents: encodeRle(ep.steps.intents),
      mutations,
      checkpoints: ep.steps.checkpoints.map((c) => ({ step: c.step, state: encodeSimState(c.state), checksum: c.checksum })),
    },
    sparse: ep.sparse,
    events: ep.events,
  };
}

/** Rows per column: the shape's element count divides the column length. */
function rowWidth(shape: readonly number[] | undefined): number {
  if (!shape || shape.length === 0) return 1;
  let w = 1;
  for (const d of shape) w *= d;
  return w;
}

/** Validates and decodes an EpisodeJson object. Throws EpisodeFormatError with the offending path. */
export function episodeFromJson(doc: unknown): Episode {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("not_json", "expected a JSON object");
  const d = doc as Partial<EpisodeJson> & { format?: unknown };
  if (typeof d.format !== "string" || !EPISODE_FORMATS_READABLE.includes(d.format)) {
    fail("wrong_format", `expected ${EPISODE_FORMAT}, found ${typeof d.format === "string" ? d.format : "no format string"}`, "format");
  }
  if (!d.meta || typeof d.meta !== "object") fail("malformed", "missing meta", "meta");
  if (typeof d.meta.format !== "string" || !EPISODE_FORMATS_READABLE.includes(d.meta.format)) fail("wrong_format", `meta.format is ${String(d.meta.format)}`, "meta.format");
  if (!d.meta.result || typeof d.meta.result !== "object") fail("malformed", "missing match result", "meta.result");
  if (!d.columns || typeof d.columns !== "object") fail("malformed", "missing columns", "columns");
  if (!d.steps || typeof d.steps !== "object") fail("malformed", "missing per-step streams", "steps");
  const shapes = (d.shapes && typeof d.shapes === "object" ? d.shapes : {}) as Record<string, number[]>;

  const columns = {} as Episode["columns"];
  for (const name of Object.keys(d.columns)) columns[name] = typedAt(d.columns[name], `columns.${name}`);
  if (!(columns.timestamp instanceof Float64Array)) fail("malformed", "timestamp must be a float64 column", "columns.timestamp");
  if (!(columns.frame_index instanceof Uint32Array)) fail("malformed", "frame_index must be a uint32 column", "columns.frame_index");
  const rows = columns.frame_index.length;
  for (const name of Object.keys(columns)) {
    const expected = rows * rowWidth(shapes[name]);
    if (columns[name].length !== expected) {
      fail("length_mismatch", `${rows} rows × ${rowWidth(shapes[name])} needs ${expected} values, found ${columns[name].length}`, `columns.${name}`);
    }
  }

  const s = d.steps as Partial<EpisodeJson["steps"]>;
  if (!Array.isArray(s.mutations)) fail("malformed", "mutations must be an array", "steps.mutations");
  if (!Array.isArray(s.checkpoints)) fail("malformed", "checkpoints must be an array", "steps.checkpoints");
  const mutations: SimMutation[] = s.mutations.map((m, i) => {
    if (!m || typeof m !== "object" || typeof (m as { kind?: unknown }).kind !== "string") fail("malformed", "bad mutation", `steps.mutations.${i}`);
    if (m.kind === "reset") return { kind: "reset", step: m.step, seed: m.seed, round: m.round, state: decodeSimState(m.state, `steps.mutations.${i}.state`) };
    return m;
  });
  const checkpoints = s.checkpoints.map((c, i) => {
    if (!c || typeof c.step !== "number" || typeof c.checksum !== "number") fail("malformed", "bad checkpoint", `steps.checkpoints.${i}`);
    return { step: c.step, state: decodeSimState(c.state, `steps.checkpoints.${i}.state`), checksum: c.checksum };
  });
  if (d.events !== undefined && !Array.isArray(d.events)) fail("malformed", "events must be an array", "events");

  return {
    meta: { ...d.meta, format: EPISODE_FORMAT },
    columns,
    shapes,
    steps: {
      ctrl: decodeRle(s.ctrl, "steps.ctrl", "f64"),
      intents: decodeRle(s.intents, "steps.intents", "u8"),
      mutations,
      checkpoints,
    },
    sparse: (d.sparse && typeof d.sparse === "object" ? d.sparse : {}) as Episode["sparse"],
    events: d.events ?? [],
  };
}

/**
 * JSON has no NaN, Infinity, or -0. Plain-number fields (meta, events, mutations, sparse) keep them exactly
 * as a tagged object `{ "$num": "NaN" | "Infinity" | "-Infinity" | "-0" }`, restored on import.
 */
const NUM_TAG = "$num";

function exactNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "number") return value;
  if (Number.isFinite(value)) return Object.is(value, -0) ? { [NUM_TAG]: "-0" } : value;
  return { [NUM_TAG]: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity" };
}

function exactNumberReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tag = (value as Record<string, unknown>)[NUM_TAG];
    if (typeof tag === "string" && Object.keys(value).length === 1) {
      if (tag === "NaN") return Number.NaN;
      if (tag === "Infinity") return Number.POSITIVE_INFINITY;
      if (tag === "-Infinity") return Number.NEGATIVE_INFINITY;
      if (tag === "-0") return -0;
    }
  }
  return value;
}

export function encodeEpisodeText(ep: Episode): string {
  return JSON.stringify(episodeToJson(ep), exactNumberReplacer);
}

export function decodeEpisodeText(text: string): Episode {
  let doc: unknown;
  try {
    doc = JSON.parse(text, exactNumberReviver);
  } catch (err) {
    fail("not_json", `not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return episodeFromJson(doc);
}

/** File name for an export: the episode id with characters that file systems dislike replaced. */
export function episodeFileName(episodeId: string): string {
  return `${episodeId.replace(/[^A-Za-z0-9._-]/g, "-")}${EPISODE_FILE_EXTENSION}`;
}

export const createEpisodeCodec: CreateEpisodeCodec = () => {
  const codec: EpisodeCodec = {
    encode(ep: Episode): Blob {
      return new Blob([encodeEpisodeText(ep)], { type: EPISODE_MIME });
    },
    decode(text: string): Episode {
      return decodeEpisodeText(text);
    },
  };
  return codec;
};
