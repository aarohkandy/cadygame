// src/game/camera/noise.ts (WP3)
// Seeded 1D gradient (Perlin) noise for rotational camera shake (GAME_DESIGN 8.2). Each shake channel reads its own
// lattice offset so yaw, pitch, and roll never move in lockstep. Output is in [-1, 1] with zero crossings on every
// lattice point, which keeps low trauma from drifting the view off-centre.

const PERM = new Uint8Array(512);
const GRAD = new Float32Array(256);

(function init(seed: number) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) GRAD[i] = rand() * 2 - 1;
})(0x70c0_1e5);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient noise at x on channel `channel` (0, 1, 2 …). Range about [-1, 1]. */
export function noise1(x: number, channel = 0): number {
  const xs = x + channel * 57.31;
  const xf = Math.floor(xs);
  const t = xs - xf;
  const i0 = xf & 255;
  const g0 = GRAD[PERM[i0]];
  const g1 = GRAD[PERM[i0 + 1]];
  const n0 = g0 * t;
  const n1 = g1 * (t - 1);
  // Scale so the practical range spans [-1, 1] (1D Perlin peaks at 0.5).
  return Math.max(-1, Math.min(1, (n0 + fade(t) * (n1 - n0)) * 2));
}
