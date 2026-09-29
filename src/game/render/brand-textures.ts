// src/game/render/brand-textures.ts (WP6)
// Brand marks → WebGL textures (BUILD_PLAN 5): WP7's MARKS are rasterized through Path2D into canvases for
// the deck print, the robot decals, the jumbotron frame, the LED sponsor ribbons, and the confetti BIT sticker. No text is ever baked
// into an image; wordmarks are the marks' own path data. Geometry helpers are pure; canvas work runs only
// in the browser and returns null elsewhere.
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
import { TOKEN_HEX, type BrandMark, type BrandMarkId, type TokenColor } from "../contracts.ts";

export interface ViewBox { x: number; y: number; w: number; h: number; }

export function parseViewBox(viewBox: string): ViewBox {
  const v = viewBox.trim().split(/[\s,]+/).map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[2] <= 0 || v[3] <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

/** Fit a mark's viewBox into a box (contain), returning scale and offset for the canvas transform. */
export function fitMark(vb: ViewBox, boxW: number, boxH: number): { scale: number; dx: number; dy: number; w: number; h: number } {
  const scale = Math.min(boxW / vb.w, boxH / vb.h);
  const w = vb.w * scale, h = vb.h * scale;
  return { scale, dx: (boxW - w) / 2 - vb.x * scale, dy: (boxH - h) / 2 - vb.y * scale, w, h };
}

export type CanvasLike = { getContext(id: "2d"): CanvasRenderingContext2D | null; width: number; height: number };

export function canDraw(): boolean {
  return typeof document !== "undefined" && typeof Path2D !== "undefined";
}

export function createCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

const pathCache = new WeakMap<BrandMark, Path2D[]>();
function pathsOf(mark: BrandMark): Path2D[] {
  let p = pathCache.get(mark);
  if (!p) { p = mark.paths.map((d) => new Path2D(d.d)); pathCache.set(mark, p); }
  return p;
}

export interface DrawMarkOptions {
  /** Recolour every fill to one token (e.g. an ink knockout on a volt plate). */
  mono?: TokenColor;
  /** Replace specific tokens (e.g. paper → ink on a light surface). */
  remap?: Partial<Record<TokenColor, string>>;
  alpha?: number;
}

/** Draws a mark contained in the box (x, y, w, h) with optional rotation (radians about the box centre). */
export function drawMark(ctx: CanvasRenderingContext2D, mark: BrandMark, x: number, y: number, w: number, h: number, rotation = 0, opts: DrawMarkOptions = {}): void {
  if (mark.paths.length === 0) return;
  const vb = parseViewBox(mark.viewBox);
  const paths = pathsOf(mark);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rotation) ctx.rotate(rotation);
  const bw = Math.abs(Math.cos(rotation)) > 0.5 ? w : h;
  const bh = Math.abs(Math.cos(rotation)) > 0.5 ? h : w;
  const f = fitMark(vb, bw, bh);
  ctx.translate(-bw / 2 + f.dx, -bh / 2 + f.dy);
  ctx.scale(f.scale, f.scale);
  ctx.globalAlpha = opts.alpha ?? 1;
  mark.paths.forEach((p, i) => {
    const fill = opts.mono ? TOKEN_HEX[opts.mono] : opts.remap?.[p.fill] ?? TOKEN_HEX[p.fill];
    ctx.fillStyle = fill;
    ctx.fill(paths[i], "nonzero");
    if (p.stroke && p.strokeWidth) {
      ctx.strokeStyle = opts.mono ? TOKEN_HEX[opts.mono] : opts.remap?.[p.stroke] ?? TOKEN_HEX[p.stroke];
      ctx.lineWidth = p.strokeWidth;
      ctx.stroke(paths[i]);
    }
  });
  ctx.restore();
}

/** 12° hazard stripes (ink/`colour`) filling a rect, clipped. */
export function drawHazard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stripe: number, a: string, b: string, angleDeg = 12): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b;
  const k = Math.tan(((90 - angleDeg) * Math.PI) / 180);
  const run = h / k;
  for (let sx = x - run - stripe * 2; sx < x + w + stripe * 2; sx += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + stripe, y + h);
    ctx.lineTo(sx + stripe + run, y);
    ctx.lineTo(sx + run, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Ages a printed area in place (GROUNDING F): grime gathering at the border of anything stuck to a machine,
 * and scratches rubbing the ink back to the substrate. Composited `source-atop`, so it never touches alpha —
 * the decal atlas is drawn with `alphaTest`, and a soft alpha fade there would cut a hard hole instead.
 * Deterministic in `seed`; `amount` 0 leaves the print factory-fresh.
 */
export function drawWear(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, amount = 0.5): void {
  if (amount <= 0 || w <= 0 || h <= 0) return;
  let s = (seed >>> 0) || 1;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.34, cx, cy, Math.hypot(w, h) / 2);
  g.addColorStop(0, "rgba(18,20,26,0)");
  g.addColorStop(1, `rgba(18,20,26,${(0.52 * amount).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#D6D1C6";
  const n = Math.round(w * h * 0.004 * amount);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.45;
    ctx.beginPath();
    ctx.arc(x + rnd() * w, y + rnd() * h, 0.4 + rnd() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* ───────────────────────── textures ───────────────────────── */

/** The BIT sticker: the mascot mark on a paper sticker with an ink outline, 256². Confetti uses it. */
export function createBitSticker(marks: Readonly<Record<BrandMarkId, BrandMark>>): Texture | null {
  const c = createCanvas(256, 256);
  const ctx = c?.getContext("2d");
  if (!c || !ctx || !canDraw()) return null;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = TOKEN_HEX.ink;
  ctx.fillRect(20, 20, 216, 216);
  ctx.fillStyle = TOKEN_HEX.volt;
  ctx.fillRect(30, 30, 196, 196);
  drawMark(ctx, marks.bit, 44, 44, 168, 168);
  return texture(c);
}

/** Jumbotron bezel: ink frame with a signal lip and the wordmark in the top bar, 1024 × 640 (alpha centre). */
export function createJumbotronFrame(marks: Readonly<Record<BrandMarkId, BrandMark>>): Texture | null {
  const W = 1024, H = 640;
  const c = createCanvas(W, H);
  const ctx = c?.getContext("2d");
  if (!c || !ctx || !canDraw()) return null;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = TOKEN_HEX.ink;
  ctx.fillRect(0, 0, W, 72);
  ctx.fillRect(0, H - 40, W, 40);
  ctx.fillRect(0, 0, 28, H);
  ctx.fillRect(W - 28, 0, 28, H);
  ctx.fillStyle = TOKEN_HEX.signal;
  ctx.fillRect(0, 64, W, 8);
  drawHazard(ctx, W - 300, H - 34, 272, 28, 14, TOKEN_HEX.ink, TOKEN_HEX.volt);
  drawMark(ctx, marks.torqueLimit, 36, 10, 300, 50);
  drawMark(ctx, marks.pulpoPop, W - 170, 8, 130, 54);
  drawMark(ctx, marks.ohmstead, 40, H - 38, 200, 34);
  return texture(c);
}

/** Sponsor ribbon panels, left to right in the atlas: OHMSTEAD, PULPO POP (the wordmark and BIT panels went: 5.2). */
export const RIBBON_PANELS = 2;
export const RIBBON_PANEL_W = 512;
export const RIBBON_PANEL_H = 128;
/** Symbols repeated across one panel (see `createSponsorRibbon`). */
export const RIBBON_SYMBOLS_PER_PANEL = 3;

/**
 * A sponsor lockup's symbol without its wordmark, in a square box. Every sponsor mark in `marks.ts` is a
 * symbol followed by its set text, and the text is always the last path.
 */
export function markSymbol(mark: BrandMark): BrandMark {
  const vb = parseViewBox(mark.viewBox);
  return { viewBox: `${vb.x} ${vb.y} ${vb.h} ${vb.h}`, paths: mark.paths.slice(0, -1) };
}

/**
 * The LED ribbon atlas (1024 × 128): OHMSTEAD on night cobalt and PULPO POP on magenta.
 *
 * Symbols only, repeated across the panel. A panel is 2.2 m wide on a 13 m ring, so from the cockpit the
 * whole panel is ~120 px of screen and a set wordmark on it is ~15 px per letter — the director read the
 * band as "EAD", "PULP", garbage, which is worse than no text. A symbol filling the band's 0.55 m height
 * is ~26 px of shape at the same distance and reads as a mark. Repeating it also means a panel cut by the
 * frame edge or by the concourse still shows whole symbols instead of a fragment, which is where the
 * truncated letters came from.
 * The boards on the concourse rail (led-strips.tsx) share this atlas and get the same treatment.
 */
export function createSponsorRibbon(marks: Readonly<Record<BrandMarkId, BrandMark>>): Texture | null {
  const W = RIBBON_PANEL_W, H = RIBBON_PANEL_H;
  const c = createCanvas(W * RIBBON_PANELS, H);
  const ctx = c?.getContext("2d");
  if (!c || !ctx || !canDraw()) return null;
  const n = RIBBON_SYMBOLS_PER_PANEL;
  // Height is the binding constraint, not the count: the symbol takes all of the 0.55 m band that the
  // 12 px lip and a 3 px margin leave it.
  const size = H - 12 - 6, pitch = W / n;
  const row = (x0: number, mark: BrandMark, opts: DrawMarkOptions) => {
    const sym = markSymbol(mark);
    for (let i = 0; i < n; i++) drawMark(ctx, sym, x0 + pitch * (i + 0.5) - size / 2, 3, size, size, 0, opts);
  };
  // 0: the OHMSTEAD arch and ground, paper on night cobalt with a cobalt lip.
  ctx.fillStyle = "#0A1A4F";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = TOKEN_HEX.cobalt;
  ctx.fillRect(0, H - 12, W, 12);
  row(0, marks.ohmstead, { remap: { ink: TOKEN_HEX.paper } });
  // 1: the PULPO POP badge on magenta, with an ink lip so the two panels still read apart at a glance.
  ctx.fillStyle = TOKEN_HEX.magenta;
  ctx.fillRect(W, 0, W, H);
  ctx.fillStyle = TOKEN_HEX.ink;
  ctx.fillRect(W, H - 12, W, 12);
  row(W, marks.pulpoPop, {});
  return texture(c);
}

/** The jumbotron's live-info strip canvas (drawn over the bottom of the feed). */
export const INFO_STRIP_W = 1024;
export const INFO_STRIP_H = 128;

export interface InfoStripState {
  nameA: string; nameB: string; integrityA: number; integrityB: number; winsA: number; winsB: number;
  round: number; bestOf: number; timeLeftS: number; suddenDeath: boolean; teamB: string;
}

/** A HUD font face from the page's CSS variables (set live; nothing is baked into an image). */
export function cssFont(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

/**
 * Paints the live-info strip: each seat's name and integrity bar on a slanted team plate, round pips, and
 * the clock in volt (signal in sudden death). Text is the HUD faces, set live; nothing is baked.
 */
export function paintInfoStrip(ctx: CanvasRenderingContext2D, st: InfoStripState): void {
  const W = INFO_STRIP_W, H = INFO_STRIP_H;
  const k = Math.tan((12 * Math.PI) / 180) * H;
  const barlow = cssFont("--font-barlow", "'Arial Narrow', sans-serif");
  const chivo = cssFont("--font-chivo", "ui-monospace, monospace");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(14,15,20,0.88)";
  ctx.fillRect(0, 24, W, H - 24);
  const plate = (x0: number, x1: number, color: string, name: string, integ: number, wins: number, right: boolean) => {
    ctx.fillStyle = color;
    // One 12° slant on the inner edge: the top leans toward the centre on the left plate, away on the right.
    ctx.beginPath();
    ctx.moveTo(x0, 24); ctx.lineTo(x1, 24);
    ctx.lineTo(right ? x1 : x1 - k, H); ctx.lineTo(right ? x0 - k : x0, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = TOKEN_HEX.paper;
    ctx.font = `italic 800 40px ${barlow}`;
    ctx.textAlign = right ? "right" : "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(name.toUpperCase().slice(0, 16), right ? x1 - 34 : x0 + 24, 70);
    // Integrity bar.
    const bx = x0 + 24, bw = x1 - x0 - 58, by = 86, bh = 20;
    ctx.fillStyle = "rgba(14,15,20,0.7)";
    ctx.fillRect(bx, by, bw, bh);
    const f = Math.max(0, Math.min(1, integ));
    ctx.fillStyle = f < 0.25 ? TOKEN_HEX.signal : TOKEN_HEX.paper;
    ctx.fillRect(right ? bx + bw * (1 - f) : bx, by, bw * f, bh);
    for (let i = 0; i < wins; i++) {
      ctx.fillStyle = TOKEN_HEX.volt;
      const px = right ? x0 + 30 + i * 30 : x1 - 50 - i * 30;
      ctx.fillRect(px, 40, 20, 20);
    }
  };
  plate(0, 380, TOKEN_HEX.cobalt, st.nameA, st.integrityA, st.winsA, false);
  plate(W - 380, W, st.teamB, st.nameB, st.integrityB, st.winsB, true);
  const s = Math.max(0, Math.ceil(st.timeLeftS));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  ctx.textAlign = "center";
  ctx.fillStyle = st.suddenDeath ? TOKEN_HEX.signal : TOKEN_HEX.volt;
  ctx.font = `700 64px ${chivo}`;
  ctx.fillText(st.suddenDeath ? "SD" : clock, W / 2, 96);
  ctx.fillStyle = TOKEN_HEX.paper;
  ctx.font = `italic 700 26px ${barlow}`;
  ctx.fillText(`ROUND ${st.round} / ${st.bestOf}`, W / 2, 124);
}

/* ───────────────────────── SDF fonts (public/fonts from sync-fonts.mjs) ───────────────────────── */

/** WebGL SDF text faces (troika-three-text reads .woff). Display is Anton; HUD is Barlow Condensed; numbers Chivo Mono. */
export const SDF_FONTS = {
  display: "/fonts/anton-latin-400-normal.woff",
  plate: "/fonts/barlow-condensed-latin-800-italic.woff",
  label: "/fonts/barlow-condensed-latin-700-normal.woff",
  mono: "/fonts/chivo-mono-latin-500-normal.woff",
} as const;

/** The imperative surface of a troika text mesh (drei `<Text ref>`), used to update text without React. */
export type SdfTextMesh = import("three").Mesh & {
  text: string;
  fontSize: number;
  fillOpacity: number;
  outlineOpacity: number;
  color: string | number | import("three").Color;
  sync(callback?: () => void): void;
};
