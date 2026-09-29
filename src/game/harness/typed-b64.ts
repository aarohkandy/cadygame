// src/game/harness/typed-b64.ts (WP5)
// Typed arrays <-> { dtype, length, b64 } for the torquelimit.episode/3 JSON format (BUILD_PLAN D5).
// The payload is the exact little-endian bytes of the array, so float64 stays float64 and float32 stays
// float32 bit for bit (NaN payloads and -0 included). Works in browsers and Node without dependencies:
// native base64 (Node Buffer or Uint8Array.prototype.toBase64) when present, a table codec otherwise.

import type { EncodedTyped, TypedDtype } from "../contracts.ts";

export type TypedColumn = Float64Array | Float32Array | Uint32Array | Int32Array | Int16Array | Uint8Array;

type TypedCtor = { new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): TypedColumn; readonly BYTES_PER_ELEMENT: number };

export const DTYPE_CTORS: Readonly<Record<TypedDtype, TypedCtor>> = {
  f64: Float64Array, f32: Float32Array, u32: Uint32Array, i32: Int32Array, i16: Int16Array, u8: Uint8Array,
};

export const TYPED_DTYPES: readonly TypedDtype[] = ["f64", "f32", "u32", "i32", "i16", "u8"];

/** Why a typed payload could not be decoded. `episode-format.ts` wraps this with the field path. */
export class TypedDecodeError extends Error {
  readonly code: "unknown_dtype" | "length_mismatch" | "bad_base64" | "bad_shape";
  constructor(code: TypedDecodeError["code"], message: string) {
    super(message);
    this.name = "TypedDecodeError";
    this.code = code;
  }
}

export function dtypeOf(arr: TypedColumn): TypedDtype {
  if (arr instanceof Float64Array) return "f64";
  if (arr instanceof Float32Array) return "f32";
  if (arr instanceof Uint32Array) return "u32";
  if (arr instanceof Int32Array) return "i32";
  if (arr instanceof Int16Array) return "i16";
  if (arr instanceof Uint8Array) return "u8";
  throw new TypeError("unsupported typed array");
}

export function isTypedDtype(v: unknown): v is TypedDtype {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DTYPE_CTORS, v);
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Little-endian bytes of `arr` (a view when the platform is little-endian, a swapped copy otherwise). */
function leBytes(arr: TypedColumn): Uint8Array {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const w = arr.BYTES_PER_ELEMENT;
  if (LITTLE_ENDIAN || w === 1) return bytes;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += w) for (let k = 0; k < w; k++) out[i + k] = bytes[i + w - 1 - k];
  return out;
}

/* ───────────────────────── base64 ───────────────────────── */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ENC = new Uint8Array(64);
const DEC = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) { ENC[i] = ALPHABET.charCodeAt(i); DEC[ALPHABET.charCodeAt(i)] = i; }
const PAD = 61; // "="

interface NodeBufferLike { from(data: Uint8Array | ArrayBufferLike | string, a?: number | string, b?: number): { toString(enc: string): string; length: number; buffer: ArrayBuffer; byteOffset: number; byteLength: number }; }
const NodeBuffer = (globalThis as { Buffer?: NodeBufferLike }).Buffer;
type WithToBase64 = Uint8Array & { toBase64?: () => string };
const nativeToBase64 = typeof (Uint8Array.prototype as WithToBase64).toBase64 === "function";

/** Table encoder: writes ASCII into a byte buffer and decodes it once (fast in every engine). */
export function base64EncodeTable(bytes: Uint8Array): string {
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = ENC[v >>> 18]; out[o++] = ENC[(v >>> 12) & 63]; out[o++] = ENC[(v >>> 6) & 63]; out[o++] = ENC[v & 63];
  }
  if (i < n) {
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const v = (bytes[i] << 16) | (b1 << 8);
    out[o++] = ENC[v >>> 18]; out[o++] = ENC[(v >>> 12) & 63];
    out[o++] = i + 1 < n ? ENC[(v >>> 6) & 63] : PAD;
    out[o++] = PAD;
  }
  // Chunked String.fromCharCode keeps argument lists small for very large columns.
  let s = "";
  const CHUNK = 0x8000;
  for (let k = 0; k < out.length; k += CHUNK) s += String.fromCharCode.apply(null, out.subarray(k, k + CHUNK) as unknown as number[]);
  return s;
}

/** Table decoder. Rejects characters outside the standard alphabet and misplaced padding. */
export function base64DecodeTable(s: string): Uint8Array {
  const len = s.length;
  if (len % 4 !== 0) throw new TypedDecodeError("bad_base64", `base64 length ${len} is not a multiple of 4`);
  let pad = 0;
  if (len > 0 && s.charCodeAt(len - 1) === PAD) pad++;
  if (len > 1 && s.charCodeAt(len - 2) === PAD) pad++;
  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const last = i + 4 === len;
    const c0 = DEC[s.charCodeAt(i) & 0xff], c1 = DEC[s.charCodeAt(i + 1) & 0xff];
    const ch2 = s.charCodeAt(i + 2), ch3 = s.charCodeAt(i + 3);
    const c2 = last && ch2 === PAD ? 0 : DEC[ch2 & 0xff];
    const c3 = last && ch3 === PAD ? 0 : DEC[ch3 & 0xff];
    const badPad = last && ch2 === PAD && ch3 !== PAD;
    if (badPad || (c0 | c1 | c2 | c3) < 0 || s.charCodeAt(i) > 127 || s.charCodeAt(i + 1) > 127 || ch2 > 127 || ch3 > 127) {
      throw new TypedDecodeError("bad_base64", `invalid base64 at character ${i}`);
    }
    const v = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[o++] = v >>> 16;
    if (o < out.length) out[o++] = (v >>> 8) & 0xff;
    if (o < out.length) out[o++] = v & 0xff;
  }
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  if (nativeToBase64) return (bytes as WithToBase64).toBase64!();
  if (NodeBuffer) return NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  return base64EncodeTable(bytes);
}

const NON_ALPHABET = /[^A-Za-z0-9+/=]/;

export function base64Decode(s: string): Uint8Array {
  if (NodeBuffer) {
    // Buffer skips characters it does not understand, so check the alphabet and the exact decoded length.
    if (s.length % 4 !== 0 || NON_ALPHABET.test(s)) throw new TypedDecodeError("bad_base64", "invalid base64 payload");
    const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    if (s.indexOf("=") !== -1 && s.indexOf("=") < s.length - pad) throw new TypedDecodeError("bad_base64", "misplaced base64 padding");
    const b = NodeBuffer.from(s, "base64");
    if (b.length !== (s.length / 4) * 3 - pad) throw new TypedDecodeError("bad_base64", "invalid base64 payload");
    const out = new Uint8Array(b.length);
    out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    return out;
  }
  return base64DecodeTable(s);
}

/* ───────────────────────── typed arrays ───────────────────────── */

export function encodeTyped(arr: TypedColumn): EncodedTyped {
  return { dtype: dtypeOf(arr), length: arr.length, b64: base64Encode(leBytes(arr)) };
}

/** Decodes into a fresh, aligned array. Throws TypedDecodeError on an unknown dtype, bad base64, or a length mismatch. */
export function decodeTyped(enc: unknown): TypedColumn {
  if (!enc || typeof enc !== "object") throw new TypedDecodeError("bad_shape", "expected { dtype, length, b64 }");
  const { dtype, length, b64 } = enc as Partial<EncodedTyped>;
  if (!isTypedDtype(dtype)) throw new TypedDecodeError("unknown_dtype", `unknown dtype ${JSON.stringify(dtype)}`);
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) throw new TypedDecodeError("bad_shape", "length must be a non-negative integer");
  if (typeof b64 !== "string") throw new TypedDecodeError("bad_shape", "b64 must be a string");
  const Ctor = DTYPE_CTORS[dtype];
  const bytes = base64Decode(b64);
  if (bytes.length !== length * Ctor.BYTES_PER_ELEMENT) {
    throw new TypedDecodeError("length_mismatch", `${dtype} length ${length} needs ${length * Ctor.BYTES_PER_ELEMENT} bytes, payload has ${bytes.length}`);
  }
  const w = Ctor.BYTES_PER_ELEMENT;
  if (!LITTLE_ENDIAN && w > 1) {
    for (let i = 0; i < bytes.length; i += w) for (let a = i, b = i + w - 1; a < b; a++, b--) { const t = bytes[a]; bytes[a] = bytes[b]; bytes[b] = t; }
  }
  return new Ctor(bytes.buffer, 0, length);
}

export function decodeTypedAs<T extends TypedColumn>(enc: unknown, expect: TypedDtype | readonly TypedDtype[]): T {
  const arr = decodeTyped(enc);
  const dt = dtypeOf(arr);
  const ok = typeof expect === "string" ? dt === expect : expect.includes(dt);
  if (!ok) throw new TypedDecodeError("bad_shape", `expected dtype ${String(expect)}, got ${dt}`);
  return arr as T;
}

/** Byte-level equality (NaN payloads and signed zeros compare exactly). */
export function bytesEqual(a: TypedColumn, b: TypedColumn): boolean {
  if (dtypeOf(a) !== dtypeOf(b) || a.length !== b.length) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
