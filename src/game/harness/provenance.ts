// src/game/harness/provenance.ts (WP5)
// Provenance for episode meta (GAME_DESIGN 5.8): SHA-256 via Web Crypto (browsers and Node 22 alike),
// a canonical JSON form so the tuning table hashes the same regardless of key order, the servo parameter
// hash of the loaded model, and the EpisodeProvenanceSource the match director stamps into every episode.

import type { PhysicsEngine } from "../contracts.ts";
import type { EpisodeProvenanceSource } from "../match/match-config.ts";

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new Error("Web Crypto (crypto.subtle) is not available; serve the app from localhost or https");
  return s;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/** Lower-case hex SHA-256 of UTF-8 text or raw bytes. */
export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return toHex(await subtle().digest("SHA-256", copy.buffer));
}

/** JSON with object keys sorted at every level; non-finite numbers become strings so they hash distinctly. */
export function canonicalStringify(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (typeof v === "number") return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : String(v);
    if (Array.isArray(v)) return v.map(walk);
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v as unknown as ArrayLike<number>, walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined && typeof x !== "function") out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value)) ?? "null";
}

export function tuningSha256(tuning: unknown): Promise<string> {
  return sha256Hex(canonicalStringify(tuning ?? null));
}

/** Hash of the per-actuator [kp, kv, forcerange] table as loaded (the stock servo parameters of the model). */
export function servoParamsHash(servo: Float64Array): Promise<string> {
  return sha256Hex(new Uint8Array(servo.buffer, servo.byteOffset, servo.byteLength));
}

/**
 * servoParamsHash of the engine's current servo table. Call it on a freshly created (or harness-mode reset) engine
 * so the hash names the stock parameters every Proving Ground and Harness episode runs on.
 */
export async function engineServoParamsHash(engine: PhysicsEngine): Promise<string> {
  return servoParamsHash(engine.saveState().servo);
}

export interface ProvenanceInput {
  tuning: unknown;
  engine: PhysicsEngine | null;
  obsSchemaHash: string;
  harnessCommit: string;
  userAgent: string;
}

/**
 * Everything the director needs to stamp episode meta. Hashes are computed once at boot; the source object
 * is mutable so a caller can create it synchronously and fill the hashes when they resolve.
 */
export async function buildProvenanceSource(input: ProvenanceInput, into?: EpisodeProvenanceSource): Promise<EpisodeProvenanceSource> {
  const out: EpisodeProvenanceSource = into ?? {
    tuning: input.tuning, tuningSha256: "", servoParamsHash: "", obsSchemaHash: input.obsSchemaHash,
    harnessCommit: input.harnessCommit, userAgent: input.userAgent,
  };
  out.tuning = input.tuning;
  out.obsSchemaHash = input.obsSchemaHash;
  out.harnessCommit = input.harnessCommit;
  out.userAgent = input.userAgent;
  // The engine is read first, in this function's synchronous prologue, and only then does anything await.
  // A loadout retunes the actuators - configureLobby does it for the green room arm the moment the lobby
  // opens - so a servo table read a task or two later could name whatever the arm happens to be wearing
  // rather than the stock parameters the episode claims to have run on. Hashing tuning first used to leave
  // exactly that gap. saveState() allocates and copies, so the table this reads is ours.
  if (input.engine) out.servoParamsHash = await engineServoParamsHash(input.engine);
  out.tuningSha256 = await tuningSha256(input.tuning);
  return out;
}

/** SHA-256 of a policy file's text, as registration and episode meta record it. */
export function policySha256(source: string): Promise<string> {
  return sha256Hex(source);
}
