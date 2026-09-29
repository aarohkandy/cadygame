// src/game/core/rng.ts (WP1)
// Deterministic randomness for the whole game: sfc32 generators seeded through SplitMix64,
// and named substreams derived from the match seed (GAME_DESIGN 5.2 "Seeds", 11.4 WP1).
// Pure integer math, identical in Node and every browser. No Math.random anywhere.

const MASK64 = (1n << 64n) - 1n;

/** One SplitMix64 step: advances `state` and returns [nextState, output]. */
function splitmix64(state: bigint): [bigint, bigint] {
  const s = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return [s, z ^ (z >> 31n)];
}

/** FNV-1a 64 over UTF-16 code units, used to fold substream labels into the seed. */
function fnv1a64(text: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/** Coerces any finite number to a uint32 seed (negative and fractional values wrap deterministically). */
export function toSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new RangeError(`seed must be finite, got ${seed}`);
  return Math.trunc(seed) >>> 0;
}

/**
 * Derives an independent uint32 seed from a parent seed and a label path, e.g.
 * `substream(matchSeed, "seat", "atlas", round)` or `substream(matchSeed, "physicsInit", round)`.
 * Different paths give statistically independent streams; the same path always gives the same seed.
 */
export function substream(seed: number, ...path: readonly (string | number)[]): number {
  let key = BigInt(toSeed(seed));
  for (const part of path) {
    const label = typeof part === "number" ? `#${toSeed(part)}` : `$${part}`;
    const [next, out] = splitmix64(key ^ fnv1a64(label));
    key = next ^ out;
  }
  const [, out] = splitmix64(key);
  return Number(out & 0xffffffffn) >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1) with 32 bits of resolution. */
  next(): number;
  /** Uniform uint32. */
  nextU32(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Copies the four sfc32 state words into `out` (allocates when omitted). */
  getState(out?: Uint32Array): Uint32Array;
  /** Restores a state captured by getState. */
  setState(state: ArrayLike<number>): void;
}

/** sfc32 (Chris Doty-Humphrey's Small Fast Counting generator), state seeded by SplitMix64. */
export function createRng(seed: number): Rng {
  let a = 0, b = 0, c = 0, d = 0;
  {
    let s = BigInt(toSeed(seed));
    let out: bigint;
    [s, out] = splitmix64(s);
    a = Number(out & 0xffffffffn) | 0; b = Number((out >> 32n) & 0xffffffffn) | 0;
    [s, out] = splitmix64(s);
    c = Number(out & 0xffffffffn) | 0; d = Number((out >> 32n) & 0xffffffffn) | 0;
    if ((a | b | c | d) === 0) d = 1;
  }

  function nextU32(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  // Warm-up: decorrelate states that differ in few bits.
  for (let i = 0; i < 12; i++) nextU32();

  return {
    next: () => nextU32() / 4294967296,
    nextU32,
    int(n: number): number {
      if (!(n >= 1)) throw new RangeError(`int(n) needs n ≥ 1, got ${n}`);
      return Math.floor((nextU32() / 4294967296) * Math.floor(n));
    },
    range: (lo: number, hi: number) => lo + (nextU32() / 4294967296) * (hi - lo),
    getState(out?: Uint32Array): Uint32Array {
      const s = out ?? new Uint32Array(4);
      s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0;
      return s;
    },
    setState(state: ArrayLike<number>): void {
      if (state.length !== 4) throw new RangeError(`rng state needs 4 words, got ${state.length}`);
      a = state[0] | 0; b = state[1] | 0; c = state[2] | 0; d = state[3] | 0;
    },
  };
}

/** Standard normal via Box–Muller (two uniform draws per sample, no cached spare, so state restores are exact). */
export function gaussian(rng: Rng, mean = 0, sd = 1): number {
  const u1 = 1 - rng.next();            // (0, 1]
  const u2 = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Default floor for human-like reaction delays (GAME_DESIGN 5.5.3). */
export const EX_GAUSSIAN_FLOOR_MS = 120;

/**
 * Ex-Gaussian sample (normal μ, σ plus exponential with mean τ), the standard model of human reaction
 * times. Values are in the caller's units (milliseconds for perception) and never below `floor`.
 */
export function exGaussian(rng: Rng, mu: number, sigma: number, tau: number, floor = EX_GAUSSIAN_FLOOR_MS): number {
  const normal = gaussian(rng, mu, sigma);
  const expo = tau > 0 ? -tau * Math.log(1 - rng.next()) : 0;
  return Math.max(floor, normal + expo);
}
