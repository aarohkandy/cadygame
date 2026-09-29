// src/game/render/rigging.tsx (GROUNDING C, D, G)
// Everything in the set that says "somebody installed this", built to one test: what is it made of, what
// holds it up, who put it there. Nothing here glows.
//
//  - Under each SO-101: a 6 mm steel mount plate a little larger than the base footprint, four M6 bolts
//    through it into the deck, and a green/yellow earth strap from the plate's lug to a deck stud.
//  - Out of the back of each base: a braided harness (one 9.5 mm sleeve, one 5 mm flylead) sagging under its
//    own weight into a slotted cable tray, which crosses the deck edge, drops over the apron and runs off the
//    deck on floor feet. studio-floor.tsx gaffer-tapes the rest of the run and puts the floor box at the end.
//  - Around the deck: an 80 mm brushed-aluminium apron extrusion, its top face split by an 18 mm LED channel
//    that led-strips.tsx sits its strip inside (the strip is the fixture; the apron is what holds it).
//    A printed 100 mm caliper bar is inlaid in the apron on the pilot side: the cheapest scale cue there is.
//  - Around the fight area: a 220 mm clear-acrylic safety screen on eight 30 mm aluminium posts, bolted down
//    through flanges, scuffed and finger-marked (it is the one transparent draw and the one thing that
//    catches rim light).
//  - Beyond the barrier, at human scale against a 1.10 × 0.70 m deck: two camera positions on tripods, a
//    floor monitor on a stand, and a rolling case. These are what tell the eye the deck is a metre across.
//
// Budget: every opaque part is merged into ONE draw (`rigging` — a MeshStandardMaterial patched to read
// roughness, metalness and a brushed-streak direction from a per-vertex `aMat`, with vertex colour carrying
// baked dirt and edge wear), plus ONE transparent draw for the acrylic. Nothing animates; nothing allocates.
"use client";

import { useEffect, useMemo, type JSX } from "react";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BoxGeometry, BufferAttribute, CatmullRomCurve3, Color, CylinderGeometry, FrontSide, Mesh, MeshStandardMaterial,
  TubeGeometry, Vector3, type BufferGeometry, type Object3D,
} from "three";
import { MOUNT_X } from "../contracts.ts";
import { DECK_LENGTH_M, DECK_THICKNESS_M, DECK_WIDTH_M } from "./deck-texture.ts";

/* ─────────────────── scale cues: objects with known real sizes (rigging-geometry.test.mjs) ─────────────────── */

/** M6 hex head across the flats, and how proud of the plate it stands. */
export const RIG_BOLT_FLATS_M = 0.010;
export const RIG_BOLT_HEAD_H_M = 0.004;
/** 6 mm steel mount plate, a little larger than the SO-101 base footprint. */
export const RIG_PLATE_THICK_M = 0.006;
export const RIG_PLATE_L_M = 0.165;
export const RIG_PLATE_W_M = 0.135;
/** Braided sleeve over the servo bus, and the thin flylead beside it. */
export const RIG_CABLE_DIA_M = 0.0095;
export const RIG_FLYLEAD_DIA_M = 0.005;
/** Slotted cable tray: 60 mm wide, 25 mm deep. */
export const RIG_TRAY_W_M = 0.060;
export const RIG_TRAY_H_M = 0.025;
/** The apron extrusion: 80 mm out from the deck edge, its top face 2 mm below the deck's own trim, down to
 *  the floor. It starts 2 mm clear of the deck trim's skirt (stage-deck.tsx `trimGeometry`), so the two
 *  extrusions read as the two separate parts they are rather than one welded lump. */
export const RIG_APRON_W_M = 0.080;
export const RIG_APRON_GAP_M = 0.002;
export const RIG_APRON_TOP_Z_M = -0.002;
/** LED channel milled into the apron top: 18 mm wide, 6 mm deep, starting 30 mm out from the deck edge. */
export const RIG_CHANNEL_U0_M = 0.030;
export const RIG_CHANNEL_U1_M = 0.048;
export const RIG_CHANNEL_DEPTH_M = 0.006;
/** Where led-strips.tsx puts the strip: channel centre line, 1 mm below the apron top. */
export const RIG_LED_U_M = (RIG_CHANNEL_U0_M + RIG_CHANNEL_U1_M) / 2;
export const RIG_LED_Z_M = RIG_APRON_TOP_Z_M - 0.0035;
/** Safety screen: 220 mm of 6 mm acrylic on 30 mm posts, 340 mm out from the deck edge. */
export const RIG_BARRIER_H_M = 0.220;
export const RIG_ACRYLIC_T_M = 0.006;
export const RIG_POST_DIA_M = 0.030;
export const RIG_BARRIER_PAD_M = 0.340;
/** Printed caliper bar on the apron, pilot side: 100 mm long, ticks every 10 mm. */
export const RIG_CALIPER_M = 0.100;
/** Human-scale furniture past the barrier: heights off the studio floor, and where each piece stands.
 *  A 1.22 m tripod head beside a 1.10 m deck is the whole scale argument, so these are checked in the test. */
export const RIG_TRIPOD_HEAD_M = 1.220;
export const RIG_MONITOR_TOP_M = 1.150;
export const RIG_CASE_H_M = 0.600;
export const RIG_CAM_A_X_M = 2.00;
export const RIG_CAM_A_Y_M = -1.45;
export const RIG_CAM_B_X_M = 1.15;
export const RIG_CAM_B_Y_M = 2.05;
export const RIG_MONITOR_X_M = 2.10;
export const RIG_MONITOR_Y_M = 1.30;
export const RIG_CASE_X_M = 0.95;
export const RIG_CASE_Y_M = -2.25;
/** The studio floor plane, the cable runs, and where they end. The floor tray stops short of the safety
 *  screen; from there the harness is gaffer-taped flat (studio-floor.tsx) under the screen's 22 mm gap and
 *  into a floor box. */
export const RIG_FLOOR_Z_M = -DECK_THICKNESS_M;
export const RIG_TRAY_END_Y_M = 0.620;
export const RIG_HARNESS_END_Y_M = 1.950;
export const RIG_TRAY_X_M = 0.478;

const HX = DECK_LENGTH_M / 2;
const HY = DECK_WIDTH_M / 2;
/** Outward y of each seat's cable run: atlas takes −y, blaze +y, so both leave on the same ego side. */
const RUN_Y = { atlas: -1, blaze: 1 } as const;

/* ─────────────────── the part list: geometry + (colour, roughness, metalness, brush) ─────────────────── */

/** Surface classes. `brush` is the streak direction in the deck plane; [0,0] means an unbrushed surface. */
interface Surf { hex: string; rough: number; metal: number; brush?: [number, number]; }

const STEEL: Surf = { hex: "#4A4E54", rough: 0.55, metal: 0.92 };
const STEEL_DIRTY: Surf = { hex: "#31343A", rough: 0.70, metal: 0.86 };
const ALU_X: Surf = { hex: "#6B7076", rough: 0.40, metal: 0.95, brush: [1, 0] };
const ALU_Y: Surf = { hex: "#6B7076", rough: 0.40, metal: 0.95, brush: [0, 1] };
const ALU_DARK: Surf = { hex: "#4C5157", rough: 0.48, metal: 0.94, brush: [1, 0] };
const RUBBER: Surf = { hex: "#17181B", rough: 0.88, metal: 0.0 };
const SLEEVE: Surf = { hex: "#26282D", rough: 0.74, metal: 0.05 };
const EARTH: Surf = { hex: "#7E8A2A", rough: 0.70, metal: 0.10 };
const PAINT_DARK: Surf = { hex: "#101216", rough: 0.46, metal: 0.05 };
const PAINT_CASE: Surf = { hex: "#1C2026", rough: 0.58, metal: 0.05 };
const PRINT: Surf = { hex: "#8E949C", rough: 0.82, metal: 0.0 };
const SCREEN_OFF: Surf = { hex: "#0A0D14", rough: 0.24, metal: 0.0 };

// ponytail: one module-level accumulator, emptied at both ends of the build. The set is static and built
// once; a second arena canvas on the same page would need this passed through instead.
const parts: BufferGeometry[] = [];
const tmpColor = new Color();

/** Stamps one geometry with its surface and queues it for the merge. */
function add(geo: BufferGeometry, s: Surf, at?: [number, number, number]): void {
  if (at) geo.translate(at[0], at[1], at[2]);
  geo.deleteAttribute("uv");
  geo.deleteAttribute("uv1");
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const mat = new Float32Array(n * 4);
  tmpColor.set(s.hex);
  const [bx, by] = s.brush ?? [0, 0];
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b;
    mat[i * 4] = s.rough; mat[i * 4 + 1] = s.metal; mat[i * 4 + 2] = bx; mat[i * 4 + 3] = by;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.setAttribute("aMat", new BufferAttribute(mat, 4));
  parts.push(geo);
}

/** Axis-aligned box by its centre and size. */
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, s: Surf): void {
  add(new BoxGeometry(sx, sy, sz), s, [cx, cy, cz]);
}

/** Upright cylinder (z is up in sim space), `sides` facets. */
function post(cx: number, cy: number, z0: number, z1: number, r: number, sides: number, s: Surf): void {
  const g = new CylinderGeometry(r, r, z1 - z0, sides, 1, false);
  g.rotateX(Math.PI / 2);
  add(g, s, [cx, cy, (z0 + z1) / 2]);
}

/** An M6 hex head with its washer, sitting on a surface at `z`. */
function bolt(cx: number, cy: number, z: number): void {
  const r = RIG_BOLT_FLATS_M / Math.sqrt(3);
  post(cx, cy, z, z + RIG_BOLT_HEAD_H_M, r, 6, STEEL);
  post(cx, cy, z - 0.0006, z + 0.0004, r * 1.45, 8, STEEL_DIRTY);
}

/** A rectangular ring of four straight boxes (corners butt-jointed, as a trim run is). */
function ring(hx: number, hy: number, u0: number, u1: number, z0: number, z1: number, s: Surf): void {
  const mid = (u0 + u1) / 2, d = u1 - u0, cz = (z0 + z1) / 2, h = z1 - z0;
  for (const sy of [-1, 1]) box(0, sy * (hy + mid), cz, 2 * (hx + u1), d, h, { ...s, brush: [1, 0] });
  for (const sx of [-1, 1]) box(sx * (hx + mid), 0, cz, d, 2 * (hy + u0), h, { ...s, brush: [0, 1] });
}

/* ─────────────────── C. the hardware that says "installed" ─────────────────── */

function buildMounts(): void {
  for (const seat of ["atlas", "blaze"] as const) {
    const mx = MOUNT_X[seat], ox = Math.sign(mx), sy = RUN_Y[seat];
    // The plate is let into a routed recess in the mat so the arm still stands on the physics plane: 6 mm of
    // steel, standing 0.8 mm proud, with the dirt line of the recess around it.
    const top = 0.0008;
    box(mx, 0, top - RIG_PLATE_THICK_M / 2, RIG_PLATE_L_M, RIG_PLATE_W_M, RIG_PLATE_THICK_M, STEEL_DIRTY);
    // The clean machined face stands 0.2 mm proud of the weathered plate around it. It used to be flush to
    // the micron, which put two faces of different steel on exactly the same plane: the depth buffer picked
    // per pixel and the plate came out stippled, which read from the cockpit as a speckled patch of rot
    // across its face. 0.2 mm is a real machining step and it is also more depth than the buffer can confuse.
    box(mx, 0, top - 0.0009, RIG_PLATE_L_M - 0.010, RIG_PLATE_W_M - 0.010, 0.0022, STEEL);
    ring(RIG_PLATE_L_M / 2, RIG_PLATE_W_M / 2, 0, 0.0022, -0.0004, 0.0002, STEEL_DIRTY);
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      bolt(mx + dx * (RIG_PLATE_L_M / 2 - 0.013), dy * (RIG_PLATE_W_M / 2 - 0.013), top);
    }
    // Earth strap: a lug on the plate's outer corner, a braid to a stud in the deck.
    const lug: [number, number, number] = [mx + ox * (RIG_PLATE_L_M / 2 - 0.006), -sy * (RIG_PLATE_W_M / 2 - 0.010), top];
    const stud: [number, number, number] = [lug[0] + ox * 0.055, lug[1] - sy * 0.022, 0.001];
    bolt(stud[0], stud[1], 0);
    add(new TubeGeometry(new CatmullRomCurve3([
      new Vector3(...lug),
      new Vector3((lug[0] + stud[0]) / 2 + ox * 0.004, (lug[1] + stud[1]) / 2, top + 0.016),
      new Vector3(stud[0], stud[1], 0.004),
    ]), 10, 0.0022, 5, false), EARTH);
    box(lug[0], lug[1], top + 0.0015, 0.014, 0.010, 0.0016, EARTH);
  }
}

function buildHarness(): void {
  for (const seat of ["atlas", "blaze"] as const) {
    const mx = MOUNT_X[seat], ox = Math.sign(mx), sy = RUN_Y[seat];
    const trayX = ox * RIG_TRAY_X_M;
    // Gland on the back of the base, a sag under its own weight, then the tray, the apron and the floor.
    const pts = [
      new Vector3(mx + ox * 0.046, sy * 0.014, 0.048),
      new Vector3(mx + ox * 0.088, sy * 0.058, 0.054),
      new Vector3(mx + ox * 0.138, sy * 0.124, 0.026),
      new Vector3(trayX, sy * 0.200, 0.0135),
      new Vector3(trayX, sy * 0.320, 0.0135),
      new Vector3(trayX, sy * (HY + 0.030), 0.006),
      new Vector3(trayX, sy * (HY + 0.105), RIG_FLOOR_Z_M + 0.018),
      new Vector3(trayX, sy * RIG_TRAY_END_Y_M, RIG_FLOOR_Z_M + 0.014),
      new Vector3(trayX, sy * (RIG_TRAY_END_Y_M + 0.12), RIG_FLOOR_Z_M + 0.006),
      new Vector3(trayX, sy * RIG_HARNESS_END_Y_M, RIG_FLOOR_Z_M + 0.005),
    ];
    const spine = new CatmullRomCurve3(pts);
    add(new TubeGeometry(spine, 36, RIG_CABLE_DIA_M / 2, 7, false), SLEEVE);
    const fly = new CatmullRomCurve3(pts.map((p, i) => p.clone().add(new Vector3(ox * 0.010, 0, i > 2 ? -0.0025 : 0.008))));
    add(new TubeGeometry(fly, 30, RIG_FLYLEAD_DIA_M / 2, 5, false), RUBBER);
    // Tray bolted to the mat behind the arm (it stops at the deck trim; the cable crosses on its own), and
    // its continuation on the floor past the apron.
    trayRun(trayX, sy * 0.150, sy * 0.320, 0.0, ALU_Y);
    for (const t of [0.20, 0.80]) bolt(trayX, sy * (0.150 + 0.170 * t), 0.003);
    trayRun(trayX, sy * (HY + 0.120), sy * RIG_TRAY_END_Y_M, RIG_FLOOR_Z_M + 0.006, ALU_DARK);
    for (const t of [0.30, 0.75]) {
      const y = sy * (HY + 0.120) + (sy * RIG_TRAY_END_Y_M - sy * (HY + 0.120)) * t;
      box(trayX, y, RIG_FLOOR_Z_M + 0.003, RIG_TRAY_W_M, 0.016, 0.006, STEEL_DIRTY);
    }
  }
}

/** A slotted U-channel tray from y0 to y1 with its base at `z`. */
function trayRun(x: number, y0: number, y1: number, z: number, s: Surf): void {
  const len = Math.abs(y1 - y0), cy = (y0 + y1) / 2, w = RIG_TRAY_W_M, h = RIG_TRAY_H_M;
  box(x, cy, z + 0.0015, w, len, 0.003, s);
  for (const sx of [-1, 1]) box(x + sx * (w / 2 - 0.0015), cy, z + h / 2, 0.003, len, h, s);
}

/* ─────────────────── D. the apron, and G. the caliper printed on it ─────────────────── */

function buildApron(): void {
  const top = RIG_APRON_TOP_Z_M, floor = RIG_FLOOR_Z_M;
  const chFloor = top - RIG_CHANNEL_DEPTH_M;
  // Top face, split by the LED channel; then the body down to the floor.
  ring(HX, HY, RIG_APRON_GAP_M, RIG_CHANNEL_U0_M, chFloor, top, ALU_X);
  ring(HX, HY, RIG_CHANNEL_U1_M, RIG_APRON_W_M, chFloor, top, ALU_X);
  ring(HX, HY, RIG_APRON_GAP_M, RIG_APRON_W_M, floor, chFloor, ALU_DARK);
  // Countersunk fixings every 250 mm along the trim, in the outer band.
  const u = (RIG_CHANNEL_U1_M + RIG_APRON_W_M) / 2;
  for (let x = -HX + 0.08; x <= HX - 0.079; x += 0.25) for (const sy of [-1, 1]) bolt(x, sy * (HY + u), top);
  for (let y = -HY + 0.09; y <= HY - 0.089; y += 0.25) for (const sx of [-1, 1]) bolt(sx * (HX + u), y, top);
  // 100 mm caliper bar printed into the apron on the pilot side: 11 ticks, the ends and middle full height.
  const y0 = -(HY + RIG_CHANNEL_U1_M + 0.006);
  for (let i = 0; i <= 10; i++) {
    const long = i === 0 || i === 5 || i === 10;
    box(MOUNT_X.atlas - RIG_CALIPER_M / 2 + (i * RIG_CALIPER_M) / 10, y0 - (long ? 0.006 : 0.0035), top + 0.0002,
      0.0012, long ? 0.012 : 0.007, 0.0004, PRINT);
  }
  box(MOUNT_X.atlas, y0 - 0.0135, top + 0.0002, RIG_CALIPER_M, 0.0010, 0.0004, PRINT);
}

/* ─────────────────── D. the safety screen ─────────────────── */

const BX = HX + RIG_BARRIER_PAD_M;
const BY = HY + RIG_BARRIER_PAD_M;
/** Post centres: the four corners, one mid-way along each long run, two along each short run. Deliberately
 *  none on the x axis — a post there would stand directly behind the opponent in the cockpit's sightline. */
export const RIG_POST_XY: readonly (readonly [number, number])[] = [
  [-BX, -BY], [0, -BY], [BX, -BY], [BX, BY], [0, BY], [-BX, BY],
  [BX, -BY / 2], [BX, BY / 2], [-BX, -BY / 2], [-BX, BY / 2],
];

function buildBarrierPosts(): void {
  const floor = RIG_FLOOR_Z_M, r = RIG_POST_DIA_M / 2;
  for (const [x, y] of RIG_POST_XY) {
    post(x, y, floor, floor + RIG_BARRIER_H_M + 0.012, r, 10, ALU_X);
    post(x, y, floor, floor + 0.005, 0.038, 12, ALU_DARK);           // bolted-down base flange
    post(x, y, floor + RIG_BARRIER_H_M + 0.012, floor + RIG_BARRIER_H_M + 0.018, r * 1.2, 10, ALU_DARK);
    for (const d of [-1, 1]) bolt(x + d * 0.027, y, floor + 0.005);
  }
}

/** The acrylic panels: the one transparent draw, built separately from the opaque merge. */
function buildAcrylic(): BufferGeometry | null {
  const floor = RIG_FLOOR_Z_M, z0 = floor + 0.022, z1 = floor + RIG_BARRIER_H_M;
  const panes: BufferGeometry[] = [];
  const pane = (cx: number, cy: number, sx: number, sy: number) => {
    const g = new BoxGeometry(sx, sy, z1 - z0);
    g.translate(cx, cy, (z0 + z1) / 2);
    g.deleteAttribute("uv");
    g.deleteAttribute("uv1");
    panes.push(g);
  };
  for (const sy of [-1, 1]) pane(0, sy * BY, 2 * BX, RIG_ACRYLIC_T_M);
  for (const sx of [-1, 1]) pane(sx * BX, 0, RIG_ACRYLIC_T_M, 2 * BY - 2 * RIG_POST_DIA_M);
  return mergeGeometries(panes, false);
}

/* ─────────────────── D. human-scale furniture past the barrier ─────────────────── */

function tripod(cx: number, cy: number, head: number, aimX: number, aimY: number): void {
  const floor = RIG_FLOOR_Z_M;
  for (let i = 0; i < 3; i++) {
    // Each leg runs from its foot up to the spider under the head.
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const foot = new Vector3(cx + Math.cos(a) * 0.46, cy + Math.sin(a) * 0.46, floor);
    const spider = new Vector3(cx, cy, floor + head - 0.28);
    add(new TubeGeometry(new CatmullRomCurve3([foot, spider]), 1, 0.018, 5, false), ALU_DARK);
    post(foot.x, foot.y, floor, floor + 0.014, 0.030, 8, RUBBER);   // rubber foot
  }
  post(cx, cy, floor + head - 0.28, floor + head - 0.02, 0.026, 8, ALU_X);   // centre column
  post(cx, cy, floor + head - 0.02, floor + head + 0.012, 0.055, 10, PAINT_DARK);  // fluid head
  // Camera body and lens, aimed at the deck.
  const a = Math.atan2(aimY - cy, aimX - cx);
  const body = new BoxGeometry(0.26, 0.15, 0.17);
  body.rotateZ(a);
  add(body, PAINT_DARK, [cx, cy, floor + head + 0.10]);
  const lens = new CylinderGeometry(0.048, 0.055, 0.20, 10, 1, false);
  lens.rotateZ(Math.PI / 2);
  lens.rotateZ(a);
  add(lens, PAINT_DARK, [cx + Math.cos(a) * 0.20, cy + Math.sin(a) * 0.20, floor + head + 0.10]);
  const hood = new BoxGeometry(0.02, 0.11, 0.09);
  hood.rotateZ(a);
  add(hood, SCREEN_OFF, [cx - Math.cos(a) * 0.14, cy - Math.sin(a) * 0.14, floor + head + 0.14]);
}

function buildFurniture(): void {
  const floor = RIG_FLOOR_Z_M;
  tripod(RIG_CAM_A_X_M, RIG_CAM_A_Y_M, RIG_TRIPOD_HEAD_M, 0, 0);
  tripod(RIG_CAM_B_X_M, RIG_CAM_B_Y_M, RIG_TRIPOD_HEAD_M - 0.09, 0, 0);
  // Floor monitor on a weighted stand, facing the deck.
  const mx = RIG_MONITOR_X_M, my = RIG_MONITOR_Y_M, a = Math.atan2(-my, -mx);
  post(mx, my, floor, floor + 0.022, 0.16, 12, PAINT_DARK);
  post(mx, my, floor + 0.022, floor + RIG_MONITOR_TOP_M - 0.30, 0.022, 8, ALU_DARK);
  const shell = new BoxGeometry(0.06, 0.54, 0.34);
  shell.rotateZ(a);
  add(shell, PAINT_DARK, [mx, my, floor + RIG_MONITOR_TOP_M - 0.17]);
  const face = new BoxGeometry(0.008, 0.50, 0.30);
  face.rotateZ(a);
  add(face, SCREEN_OFF, [mx - Math.cos(a) * 0.033, my - Math.sin(a) * 0.033, floor + RIG_MONITOR_TOP_M - 0.17]);
  // Rolling equipment case on castors, lid latched.
  const cx = RIG_CASE_X_M, cy = RIG_CASE_Y_M;
  box(cx, cy, floor + 0.05 + RIG_CASE_H_M / 2, 0.84, 0.52, RIG_CASE_H_M, PAINT_CASE);
  for (const dx of [-1, 1]) box(cx + dx * 0.415, cy, floor + 0.05 + RIG_CASE_H_M / 2, 0.016, 0.50, RIG_CASE_H_M - 0.03, ALU_DARK);
  box(cx, cy, floor + 0.05 + RIG_CASE_H_M * 0.62, 0.84, 0.53, 0.012, ALU_DARK);
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) post(cx + dx * 0.33, cy + dy * 0.19, floor, floor + 0.05, 0.026, 8, RUBBER);
}

/* ─────────────────── materials ─────────────────── */

const RIG_PARS = /* glsl */ `
varying vec4 vMat;
varying vec3 vRig;
`;
const RIG_FRAG = /* glsl */ `
  // Brushed metal: fine streaks along aMat.ba, plus a slow roughness drift so the sheen is never uniform.
  float grunge = fract(sin(dot(floor(vRig.xy * 900.0), vec2(12.99, 78.23))) * 43758.5);
  float drift = sin(vRig.x * 7.3 + vRig.y * 5.1) * sin(vRig.y * 11.7 - vRig.z * 9.3);
  float brush = 0.0;
  if (dot(vMat.ba, vMat.ba) > 0.001) {
    vec2 across = vec2(-vMat.a, vMat.b);
    float s = dot(vRig.xy, across) * 2600.0;
    brush = (fract(sin(floor(s)) * 43758.5) - 0.5);
  }
  roughnessFactor = clamp(vMat.r + brush * 0.09 + drift * 0.05 + grunge * 0.02, 0.05, 1.0);
  metalnessFactor = vMat.g;
  // Dirt settles in the crevices (low z) and wears off the edges that get handled.
  float low = 1.0 - smoothstep(${RIG_FLOOR_Z_M.toFixed(4)}, 0.06, vRig.z);
  diffuseColor.rgb *= 1.0 - 0.18 * low * (0.5 + 0.5 * grunge);
  diffuseColor.rgb *= 0.97 + 0.06 * grunge;
`;

function rigMaterial(): MeshStandardMaterial {
  // Metals in a dark studio reflect a dark studio: the environment rig is dialled right back here, or the
  // apron reads as a white frame around the fight (it did, on the first pass).
  // 0.62 matches stage-deck's TRIM_ENV_INTENSITY: the apron extrusion and the deck trim are two parts of the
  // same stock sitting 2 mm apart and must reflect the room by the same amount or they read as two alloys.
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5, envMapIntensity: 0.62, dithering: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec4 aMat;\n${RIG_PARS}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMat = aMat;\nvRig = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${RIG_PARS}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${RIG_FRAG}`);
  };
  m.customProgramCacheKey = () => "tl-rigging";
  return m;
}

/** Scuffed, finger-marked acrylic. A standard dielectric is already the right material here: F0 0.04 is
 *  acrylic's own IOR 1.49, so it stays faintly visible head-on and flares on the rim light at grazing angles,
 *  which is the whole reason the barrier is in the frame. No physical material, and so no extra program. */
function acrylicMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color("#8FA3B8"), transparent: true, opacity: 0.18, roughness: 0.14, metalness: 0,
    side: FrontSide, depthWrite: false, envMapIntensity: 1.5, dithering: true,
  });
}

/* ─────────────────── view ─────────────────── */

export interface RiggingView { readonly objects: readonly Object3D[]; dispose(): void; }

export function createRiggingView(): RiggingView {
  parts.length = 0;
  buildMounts();
  buildHarness();
  buildApron();
  buildBarrierPosts();
  buildFurniture();
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  parts.length = 0;
  const objects: Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  if (merged) {
    merged.computeBoundingSphere();
    const mat = rigMaterial();
    const mesh = new Mesh(merged, mat);
    mesh.name = "rigging";
    mesh.receiveShadow = true;
    objects.push(mesh);
    disposables.push(merged, mat);
  }
  const acrylic = buildAcrylic();
  if (acrylic) {
    const mat = acrylicMaterial();
    const mesh = new Mesh(acrylic, mat);
    mesh.name = "safety-screen";
    mesh.renderOrder = 6;
    objects.push(mesh);
    disposables.push(acrylic, mat);
  }
  return { objects, dispose() { for (const d of disposables) d.dispose(); } };
}

export function Rigging(): JSX.Element {
  const view = useMemo(() => createRiggingView(), []);
  useEffect(() => () => view.dispose(), [view]);
  return <>{view.objects.map((o) => <primitive key={o.name} object={o} />)}</>;
}
