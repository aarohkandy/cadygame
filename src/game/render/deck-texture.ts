// src/game/render/deck-texture.ts (WP2, rebuilt for GROUNDING A)
// The deck is a built object, not a shape: an 18 mm plate, a brushed-aluminium trim extrusion bolted round
// the perimeter (stage-deck.tsx builds that in geometry), and two matte ESD rubber mat panels laid inside the
// trim with a 3 mm seam down the centreline. This module paints the two maps the mat carries:
//   `paintDeck`        — albedo: rubber with fine grain, worn printed graphics (team fields, keylines, seat
//                        gaffer tape, wordmarks, drop X), the milled dock recesses with their painted rings,
//                        the seam groove, and the dirt the mat collects under the arm mounts.
//   `paintDeckSurface` — R = roughness (0.75–0.9 rubber, lower in the scuffed lanes and on the paint),
//                        G = ambient occlusion (mount footprints, dock recess walls, the seam),
//                        B = scuff mask (where play has polished the mat; the only place the mat reflects).
// No self-lit layer: nothing on the mat emits. The dock LED gasket rings are real fixtures drawn analytically
// by the deck shader, gated by the Core's state (5.2).
// THEATRE 2: the mat was one flat rubber value with a film of team colour over each half — muddy, and the
// single largest untextured region in the frame. The rubber value is unchanged (a contact shadow still has
// somewhere to go), but the mat now carries its own range: polished bright where play has worn it, falling
// to near black at the corners the beams never reach, so the frame has a bottom to its histogram whatever
// the key is set to. The team field wash drops by a third; saturation belongs to the printed objects and the
// machines, not to a sheet of rubber.
// `deckLayout` and `deckBoltsM` are pure (tests check them); the painters draw into a canvas.
import { DOCK_CENTER_X, DOCK_RADIUS, MOUNT_X, TOKEN_HEX, type BrandMark } from "../contracts.ts";
import { drawMark } from "./brand-textures.ts";

export const DECK_LENGTH_M = 1.10;   // along x (seat to seat), over the trim
export const DECK_WIDTH_M = 0.70;    // along y, over the trim
export const DECK_THICKNESS_M = 0.018;
/** Brushed-aluminium trim extrusion capping the perimeter: 25 mm of the deck's width on each side. */
export const TRIM_W_M = 0.025;
/** How far the trim's top face stands above the mat (the mat is recessed inside the extrusion). */
export const TRIM_RISE_M = 0.0024;
/** The mat panels inside the trim. */
export const MAT_LENGTH_M = DECK_LENGTH_M - 2 * TRIM_W_M;
export const MAT_WIDTH_M = DECK_WIDTH_M - 2 * TRIM_W_M;
/** The two mat panels butt on the centreline with a 3 mm gap. */
export const MAT_SEAM_M = 0.003;
/** M5 countersunk hex, 8.5 mm across the flats, on the trim's top face. */
export const BOLT_HEAD_M = 0.0085;
/** Nominal bolt spacing along the trim; each side rounds to a whole number so the corners always get one. */
export const BOLT_SPACING_M = 0.25;
export const DECK_TEXTURE_W = 2048;
export const DECK_TEXTURE_H = 1268;
/** The surface map is half resolution: roughness, AO and scuff are all low-frequency plus tiled grain. */
export const DECK_SURFACE_W = 1024;
export const DECK_SURFACE_H = 634;
/** Milled dock recess: 2 mm deep, its painted ring 19 mm wide on the rim. */
export const DOCK_TAPE_M = 0.019;
export const DOCK_RECESS_M = DOCK_RADIUS + 0.014;
/**
 * Worn ink over the mat. Low: an ESD mat is matte black and the print has been walked on all season, so the
 * rubber still dominates each half. THEATRE 2: 0.16 of flat team colour laid over a whole half was a film of
 * cobalt on one side and magenta on the other, which is what made the mat muddy and is exactly the "colour
 * smeared over the room" the brief rules out. The saturation belongs to the paint, the keylines and the
 * tape — printed objects — so the field wash drops and those get their weight back.
 */
export const ZONE_ALPHA = 0.10;
/** Matte black ESD rubber, about 1.9 % linear: dark, but light enough that a contact shadow reads on it. */
export const DECK_MAT_HEX = "#24262B";
/**
 * Natural unpainted ABS: what the clutter cubes are moulded in (cubes-view.tsx builds them). It lives beside
 * the mat value because the two are one decision — a prop is only visible relative to the surface it lies
 * on, and the previous ink cubes were a quarter of the mat's value, which is why nine of them disappeared.
 * Five times the mat, and well under a lit shell, so the props read without out-shining the machines.
 */
export const CUBE_ABS_HEX = "#565C66";

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Ring { cx: number; cy: number; rOuter: number; rInner: number; }
export interface DeckLayout {
  width: number; height: number; pxPerM: number;
  zones: { atlas: Rect; blaze: Rect; alpha: number };
  keyline: number;
  docks: { atlas: Ring; blaze: Ring };
  /** Milled recess (the ring is painted on its rim), in texture pixels. */
  recess: { atlas: number; blaze: number };
  dropX: { cx: number; cy: number; arm: number; tape: number };
  seatTape: { atlas: Rect; blaze: Rect };
  /** The 3 mm gap between the two mat panels. */
  seam: { x: number; w: number };
  /** Show wordmark boxes at each seat end, turned to read from the far seat's opponent. */
  wordmarks: { atlas: Rect; blaze: Rect };
  /** Where each arm's mount plate sits on the mat: the dirt and AO footprint is painted here. */
  mounts: { atlas: { cx: number; cy: number }; blaze: { cx: number; cy: number }; radius: number };
}

/** Sim (x, y) on the mat → texture pixels (u right = +x, v down = −y). */
export function simToDeckPx(x: number, y: number, layout: Pick<DeckLayout, "width" | "height" | "pxPerM">): [number, number] {
  return [layout.width / 2 + x * layout.pxPerM, layout.height / 2 - y * layout.pxPerM];
}

export function deckLayout(width = DECK_TEXTURE_W, height = DECK_TEXTURE_H): DeckLayout {
  const pxPerM = Math.min(width / MAT_LENGTH_M, height / MAT_WIDTH_M);
  const L = { width, height, pxPerM };
  const dock = (seat: "atlas" | "blaze"): Ring => {
    const [cx, cy] = simToDeckPx(DOCK_CENTER_X[seat], 0, L);
    return { cx, cy, rOuter: (DOCK_RADIUS + DOCK_TAPE_M / 2) * pxPerM, rInner: (DOCK_RADIUS - DOCK_TAPE_M / 2) * pxPerM };
  };
  const tape = 0.024 * pxPerM;
  const seamW = MAT_SEAM_M * pxPerM;
  const half = (width - seamW) / 2;
  // Wordmark: 0.30 m along y, 0.075 m deep in x, centred 0.415 m out from the drop point.
  const wmW = 0.075 * pxPerM, wmH = 0.30 * pxPerM;
  const wm = (sign: -1 | 1): Rect => ({ x: width / 2 + sign * 0.415 * pxPerM - wmW / 2, y: height / 2 - wmH / 2, w: wmW, h: wmH });
  const mount = (seat: "atlas" | "blaze"): { cx: number; cy: number } => {
    const [cx, cy] = simToDeckPx(MOUNT_X[seat], 0, L);
    return { cx, cy };
  };
  return {
    width, height, pxPerM,
    zones: {
      atlas: { x: 0, y: 0, w: half, h: height },
      blaze: { x: width / 2 + seamW / 2, y: 0, w: half, h: height },
      alpha: ZONE_ALPHA,
    },
    keyline: Math.max(2, 0.003 * pxPerM),
    docks: { atlas: dock("atlas"), blaze: dock("blaze") },
    recess: { atlas: DOCK_RECESS_M * pxPerM, blaze: DOCK_RECESS_M * pxPerM },
    dropX: { cx: width / 2, cy: height / 2, arm: 0.026 * pxPerM, tape: 0.012 * pxPerM },
    seatTape: {
      atlas: { x: 0.012 * pxPerM, y: height / 2 - 0.2 * pxPerM, w: tape, h: 0.4 * pxPerM },
      blaze: { x: width - 0.012 * pxPerM - tape, y: height / 2 - 0.2 * pxPerM, w: tape, h: 0.4 * pxPerM },
    },
    seam: { x: width / 2, w: seamW },
    wordmarks: { atlas: wm(-1), blaze: wm(1) },
    mounts: { atlas: mount("atlas"), blaze: mount("blaze"), radius: 0.085 * pxPerM },
  };
}

/**
 * Bolt heads on the trim's top face, in sim metres: one at each mitred corner and the rest spread along each
 * side at whole divisions of ~`BOLT_SPACING_M`, so the corners always land on a bolt (a real fabricator
 * drills the corners first and divides the run).
 */
export function deckBoltsM(): { x: number; y: number }[] {
  const hx = DECK_LENGTH_M / 2 - TRIM_W_M / 2;
  const hy = DECK_WIDTH_M / 2 - TRIM_W_M / 2;
  const out: { x: number; y: number }[] = [];
  const run = (n: number, at: (t: number) => { x: number; y: number }): void => {
    for (let i = 0; i < n; i++) out.push(at(i / n));
  };
  const nx = Math.max(1, Math.round((2 * hx) / BOLT_SPACING_M));
  const ny = Math.max(1, Math.round((2 * hy) / BOLT_SPACING_M));
  // Once round the rectangle, each side excluding its end corner (the next side supplies it).
  run(nx, (t) => ({ x: -hx + 2 * hx * t, y: -hy }));
  run(ny, (t) => ({ x: hx, y: -hy + 2 * hy * t }));
  run(nx, (t) => ({ x: hx - 2 * hx * t, y: hy }));
  run(ny, (t) => ({ x: -hx, y: hy - 2 * hy * t }));
  return out;
}

/** The mat's base albedo in sRGB (the grey-card debug scene shows it next to the calibration cards). */
export function deckBaseHex(): string {
  return DECK_MAT_HEX;
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fill(ctx: CanvasRenderingContext2D, r: Rect): void { ctx.fillRect(r.x, r.y, r.w, r.h); }

/**
 * A deterministic grey-noise tile, tiled as a pattern to grain a whole map in one fill (a per-pixel pass over
 * a 2048 × 1268 canvas at boot is not worth the frame). `amp` is the ± swing around mid grey.
 */
function grainPattern(ctx: CanvasRenderingContext2D, amp: number, size = 128): CanvasPattern | null {
  const tile = ctx.canvas.ownerDocument?.createElement("canvas");
  if (!tile) return null;
  tile.width = size; tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  const img = tctx.createImageData(size, size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 128 + Math.round(((seed >>> 16) / 65535 - 0.5) * 2 * amp);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  return ctx.createPattern(tile, "repeat");
}

/** Overlays the grain tile over the whole map: the fine texture of moulded rubber. */
function grain(ctx: CanvasRenderingContext2D, layout: DeckLayout, amp: number, alpha: number): void {
  const p = grainPattern(ctx, amp);
  if (!p) return;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();
}

/** Wears printed ink back: the grain tile punched out of whatever was just drawn. */
function wear(ctx: CanvasRenderingContext2D, layout: DeckLayout, alpha: number): void {
  const p = grainPattern(ctx, 120, 64);
  if (!p) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();
}

/**
 * The mat's own dynamic range. A single flat rubber value over 1 m of deck is the definition of muddy: a real
 * mat under a hard key is bright where the beam lands and near black at the corners the beam never reaches.
 * This is painted into the albedo rather than left to the light, because the corners have to reach true black
 * for the frame's histogram to have a bottom (Part 2 acceptance 1) whatever the key ends up at.
 */
function matFalloff(ctx: CanvasRenderingContext2D, layout: DeckLayout): void {
  const { width: W, height: H } = layout;
  const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.10, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, 1.42);
  ctx.translate(-W / 2, -H / 2);
  ctx.fillStyle = g;
  ctx.fillRect(-W, -H, W * 3, H * 3);
  ctx.restore();
}

/** The elliptical band of mat the cubes and grippers have polished, centred on the play area. */
function scuffLane(ctx: CanvasRenderingContext2D, layout: DeckLayout, inner: string, outer: string): void {
  const { width: W, height: H, pxPerM } = layout;
  const g = ctx.createRadialGradient(W / 2, H / 2, 0.04 * pxPerM, W / 2, H / 2, 0.30 * pxPerM);
  g.addColorStop(0, inner);
  g.addColorStop(0.62, inner);
  g.addColorStop(1, outer);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, 0.62);
  ctx.translate(-W / 2, -H / 2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function dropX(ctx: CanvasRenderingContext2D, layout: DeckLayout, color: string, grow: number): void {
  const x = layout.dropX;
  ctx.save();
  ctx.translate(x.cx, x.cy);
  ctx.fillStyle = color;
  for (const r of [Math.PI / 4, -Math.PI / 4]) {
    ctx.save();
    ctx.rotate(r);
    ctx.fillRect(-x.arm - grow, -x.tape / 2 - grow, (x.arm + grow) * 2, x.tape + grow * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** A team keyline just inside a half's outer edges (the seam side is left to the seam). */
function keyline(ctx: CanvasRenderingContext2D, z: Rect, k: number, seamAtRight: boolean): void {
  const inset = k * 3;
  ctx.fillRect(z.x + (seamAtRight ? inset : 0), z.y + inset, z.w - inset, k);
  ctx.fillRect(z.x + (seamAtRight ? inset : 0), z.y + z.h - inset - k, z.w - inset, k);
  ctx.fillRect(seamAtRight ? z.x + inset : z.x + z.w - inset - k, z.y + inset, k, z.h - 2 * inset);
}

/** Paints the mat's albedo. `teamB` is the AI team colour (magenta, or the colourblind yellow). */
export function paintDeck(ctx: CanvasRenderingContext2D, layout: DeckLayout, teamB: string, wordmark: BrandMark | null): void {
  const { width: W, height: H, pxPerM } = layout;
  ctx.fillStyle = DECK_MAT_HEX;
  ctx.fillRect(0, 0, W, H);
  // Play has polished the centre of the mat lighter than the untouched corners; the corners in turn fall
  // away to black. Together these are the mat's range, and they are what stops it reading as one grey sheet.
  scuffLane(ctx, layout, "rgba(255,255,255,0.085)", "rgba(255,255,255,0)");
  matFalloff(ctx, layout);
  const teams = [[layout.zones.atlas, TOKEN_HEX.cobalt, false], [layout.zones.blaze, teamB, true]] as const;
  for (const [zone, color, atRight] of teams) {
    // Team field, fading toward the seam so the contest centre stays bare rubber.
    const g = ctx.createLinearGradient(atRight ? zone.x + zone.w : zone.x, 0, atRight ? zone.x : zone.x + zone.w, 0);
    g.addColorStop(0, hexAlpha(color, layout.zones.alpha));
    g.addColorStop(1, hexAlpha(color, layout.zones.alpha * 0.2));
    ctx.fillStyle = g;
    fill(ctx, zone);
  }
  // Printed graphics, laid down together and then worn back as one pass.
  ctx.save();
  ctx.globalAlpha = 0.95;
  for (const [zone, color, atRight] of teams) {
    ctx.fillStyle = color;
    keyline(ctx, zone, layout.keyline, !atRight);
  }
  if (wordmark) {
    // Each wordmark's top points at the far seat, so the one past the opponent reads upright from the cockpit.
    const a = layout.wordmarks.atlas, b = layout.wordmarks.blaze;
    drawMark(ctx, wordmark, a.x, a.y, a.w, a.h, -Math.PI / 2, { alpha: 0.38 });
    drawMark(ctx, wordmark, b.x, b.y, b.w, b.h, Math.PI / 2, { alpha: 0.38 });
  }
  dropX(ctx, layout, hexAlpha(TOKEN_HEX.paper, 0.8), 0);
  // The painted ring on each dock recess rim: safety yellow, chipped where the Core lands on it.
  ctx.lineWidth = DOCK_TAPE_M * pxPerM;
  ctx.strokeStyle = hexAlpha(TOKEN_HEX.volt, 0.5);
  for (const d of [layout.docks.atlas, layout.docks.blaze]) {
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, (d.rOuter + d.rInner) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  wear(ctx, layout, 0.5);
  ctx.restore();
  // Gaffer tape at each seat: a known 24 mm width, the cheapest scale cue on the deck.
  ctx.fillStyle = hexAlpha(TOKEN_HEX.cobalt, 0.9);
  fill(ctx, layout.seatTape.atlas);
  ctx.fillStyle = hexAlpha(teamB, 0.9);
  fill(ctx, layout.seatTape.blaze);
  // The milled dock recesses: their floor sits 2 mm down, so it is darker and the far wall catches the key.
  for (const seat of ["atlas", "blaze"] as const) {
    const d = layout.docks[seat];
    const r = layout.recess[seat];
    const g = ctx.createRadialGradient(d.cx, d.cy - r * 0.2, r * 0.2, d.cx, d.cy, r);
    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(0.86, "rgba(0,0,0,0.5)");
    g.addColorStop(0.97, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dirt that has collected round each mount plate's footprint.
  for (const seat of ["atlas", "blaze"] as const) {
    const m = layout.mounts[seat];
    const g = ctx.createRadialGradient(m.cx, m.cy, layout.mounts.radius * 0.5, m.cx, m.cy, layout.mounts.radius * 1.9);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(m.cx - layout.mounts.radius * 2, m.cy - layout.mounts.radius * 2, layout.mounts.radius * 4, layout.mounts.radius * 4);
  }
  grain(ctx, layout, 34, 0.42);
  // The 3 mm seam between the two mat panels: a dark gap with the far lip catching a little light.
  const s = layout.seam;
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(s.x - s.w / 2, 0, s.w, H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(s.x + s.w / 2, 0, Math.max(1, s.w * 0.35), H);
}

/**
 * Paints the mat's surface map: R roughness, G ambient occlusion, B scuff (where the mat reflects at all).
 * Lay it out with `deckLayout(DECK_SURFACE_W, DECK_SURFACE_H)`.
 */
export function paintDeckSurface(ctx: CanvasRenderingContext2D, layout: DeckLayout): void {
  const { width: W, height: H, pxPerM } = layout;
  // Base: rough rubber (R 0.88), unoccluded (G 1), no scuff (B 0).
  ctx.fillStyle = "rgb(224,255,0)";
  ctx.fillRect(0, 0, W, H);
  // The polished play lanes: smoother and reflective, strongest at the drop point.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  scuffLane(ctx, layout, "rgba(0,0,190,1)", "rgba(0,0,0,1)");
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  scuffLane(ctx, layout, "rgba(178,255,255,1)", "rgba(255,255,255,1)");
  // Contact AO: the mount footprints, the dock recess walls and the seam.
  for (const seat of ["atlas", "blaze"] as const) {
    const m = layout.mounts[seat];
    const g = ctx.createRadialGradient(m.cx, m.cy, layout.mounts.radius * 0.6, m.cx, m.cy, layout.mounts.radius * 1.7);
    g.addColorStop(0, "rgb(255,70,255)");
    g.addColorStop(1, "rgb(255,255,255)");
    ctx.fillStyle = g;
    ctx.fillRect(m.cx - layout.mounts.radius * 2, m.cy - layout.mounts.radius * 2, layout.mounts.radius * 4, layout.mounts.radius * 4);
    const d = layout.docks[seat];
    const r = layout.recess[seat];
    const rg = ctx.createRadialGradient(d.cx, d.cy, r * 0.55, d.cx, d.cy, r);
    rg.addColorStop(0, "rgb(255,150,255)");
    rg.addColorStop(0.9, "rgb(255,95,255)");
    rg.addColorStop(1, "rgb(255,255,255)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Painted ring and tape are smoother than the rubber they sit on.
  ctx.lineWidth = DOCK_TAPE_M * pxPerM;
  ctx.strokeStyle = "rgb(150,255,255)";
  for (const d of [layout.docks.atlas, layout.docks.blaze]) {
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, (d.rOuter + d.rInner) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  grain(ctx, layout, 40, 0.7);
  const s = layout.seam;
  ctx.fillStyle = "rgb(255,40,0)";
  ctx.fillRect(s.x - s.w / 2, 0, s.w, H);
}
