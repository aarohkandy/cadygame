// src/game/render/led-strips.tsx (WP2)
// The show's LEDs (EMOTION_BIBLE 5.2, 5.6).
//  - The deck edge: a real fixture, not a drawn-on line (GROUNDING E). A 14 mm LED tape sits inside the 18 mm
//    channel milled into the top of rigging.tsx's aluminium apron, 1 mm below its lip, so from the cockpit it
//    reads as a lit slot in a machined extrusion rather than a neon outline: cobalt on the pilot half, magenta
//    on the AI half, breathing with the show, slammed on at ENGAGE, flashed white along the struck half (a
//    ripple running out from the midline), pulsed in the cue colour on KO, lock and steal. A slow chase runs
//    with no fight on. It sits on REFLECTION_LAYER too: the deck mirrors it.
//  - One dasher ribbon at 30 % brightness ringing the floor, low under the opponent's arm: the sponsor atlas
//    (OHMSTEAD, PULPO POP) under an LED pixel grid. Static during a fight; 40 px/s between rounds and in the
//    attract; a 6 s ±20 % breath; a 120 ms white flood on the struck side; a 1.5 s sponsor panel swap on a
//    crit (OHMSTEAD) or a steal (PULPO POP), no brightness change; chevrons in the cue colour on KO/lock/steal.
//  - Two sponsor boards on the concourse rail at ±90° off the cockpit's sightline: static dim plates
//    (emissive 0.08) that never animate. One draw.
// `readShowPulse` is the one show envelope the deck print and apron glow share with the edge.
// Every write is a uniform or an instance colour; nothing allocates per frame.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  Quaternion, ShaderMaterial, Vector3, type Object3D,
} from "three";
import { MARKS } from "../brand/marks.ts";
import { REFLECTION_LAYER } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { createSponsorRibbon, RIBBON_PANELS } from "./brand-textures.ts";
import { DECK_LENGTH_M, DECK_WIDTH_M } from "./deck-texture.ts";
import { RIG_LED_U_M, RIG_LED_Z_M } from "./rigging.tsx";
import { CONCOURSE_H_M, DASHER_H_M, DASHER_R_M, STAND_BACK_R_M, STAND_FLOOR_Z_M, STAND_TOP_Z_M } from "./holo-crowd-material.ts";
import { clamp01 } from "./interpolate.ts";
import { teamHex } from "./robot-materials.ts";
import { isShowIdlePhase } from "./vfx/stage-cues.ts";
import { linearColor } from "./vfx/sparks.ts";

export const LED_SEGMENT_M = 0.03;
/** No gap: the edge is one continuous line per side (5.2); segments only carry the ripple's colour. */
export const LED_GAP_M = 0;
/** 14 mm of tape inside an 18 mm channel, 5 mm proud of the channel floor: the fixture's real dimensions. */
export const LED_TAPE_W_M = 0.014;
export const LED_TAPE_H_M = 0.005;
/**
 * Resting radiance on the tape, in the same linear units as everything else in the frame — the strip now goes
 * through ACES with the rest of the shot (see the material below), so this is a real exposure value, not a
 * screen colour. 0.55 holds the resting strip *below* the bloom threshold (quality.ts, 0.98) in its hottest
 * channel. That matters more than how bright the line looks: above it, a fully saturated emitter blooms its
 * own hue over the whole frame, and the measured result was a cockpit frame at 0.79 mean saturation with a
 * pink wash across the mat and the concrete. The show's own peaks (breath, hype, deckFlash) still cross it,
 * which is when an LED edge is supposed to flare.
 */
export const LED_INTENSITY = 0.55;

/* ───────────────────────── show envelope ───────────────────────── */

export interface ShowPulse {
  /** Per-half light level (1 = resting show), already carrying breath, hype, sudden-death dim and the slam. */
  levelA: number; levelB: number;
  /** Strike flash per half, 0..1. */
  flashA: number; flashB: number;
  /** KO / lock / steal ring pulse 0..1 and its colour (linear, shared with the cues). */
  pulse: number; pulseColor: Color;
  slam: number;
  idle: boolean;
}

export function createShowPulse(): ShowPulse {
  return { levelA: 1, levelB: 1, flashA: 0, flashB: 0, pulse: 0, pulseColor: new Color(), slam: 0, idle: true };
}

/** Reads the show's light envelope for this frame into `out`. */
export function readShowPulse(rt: StageRuntime, now: number, out: ShowPulse): ShowPulse {
  const cues = rt.vfx.cues;
  const t = now / 1000;
  const hype = clamp01(rt.game.feedback.audio.hype);
  // A slow breath (0.45 Hz) that quickens and deepens with hype.
  const breath = 0.86 + (0.1 + 0.08 * hype) * Math.sin(t * Math.PI * 2 * (0.45 + 0.5 * hype));
  const slam = cues.slam(now);
  const base = cues.lampLevel * breath * (1 + 0.25 * hype) + slam * 1.6;
  const ring = cues.ledPulse(now), pylon = cues.pylonFlash(now);
  out.pulse = Math.max(ring, pylon);
  out.pulseColor = pylon > ring ? cues.pylonColor : cues.pulseColor;
  // ENGAGE also stamps both edges' strike flash in the cues, so the slam reads as a white-out.
  out.flashA = cues.ledFlash("atlas", now);
  out.flashB = cues.ledFlash("blaze", now);
  out.levelA = base * (1 + 0.6 * out.pulse);
  out.levelB = base * (1 + 0.6 * out.pulse);
  out.slam = slam;
  out.idle = isShowIdlePhase(rt.game.director.phase);
  return out;
}

/* ───────────────────────── deck edge ───────────────────────── */

export interface StripSegment { x: number; y: number; yaw: number; side: -1 | 1; along: number; }

/** Segments around the deck perimeter; `side` is −1 on the atlas half, +1 on the blaze half. */
export function stripLayout(): StripSegment[] {
  const out: StripSegment[] = [];
  const hx = DECK_LENGTH_M / 2 + RIG_LED_U_M, hy = DECK_WIDTH_M / 2 + RIG_LED_U_M;
  const pitch = LED_SEGMENT_M + LED_GAP_M;
  const perimeter = 4 * (hx + hy);
  let along = 0;
  const run = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / pitch);
    const yaw = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      out.push({ x, y, yaw, side: x < 0 ? -1 : 1, along: (along + len * t) / perimeter });
    }
    along += len;
  };
  run(-hx, -hy, hx, -hy);
  run(hx, -hy, hx, hy);
  run(hx, hy, -hx, hy);
  run(-hx, hy, -hx, -hy);
  return out;
}

/* ───────────────────────── stadium ribbon and boards ───────────────────────── */

/** Sponsor panel on the ribbon (sim metres): the atlas panel is 4:1, and the ribbon band is 0.55 m tall on a
 *  13 m ring, so a panel is 2.2 m wide. Everything here moved out with the crowd rake (GROUNDING part 2). */
const RIBBON_PANEL_M = 2.20;
/** The lit band on the dasher board's face: 0.55 m of it, set 0.10 m below the board's cap. */
const RIBBON_BAND_H_M = 0.55;
const RIBBON_BAND_DROP_M = 0.10;
/** Ribbon brightness relative to the deck edge's show level: 30 %, an LED strip in the dark, not a light source. */
const RIBBON_LEVEL = 0.30;
/** Ribbon breath (5.6): 6 s, ±20 %. */
const RIBBON_BREATH_S = 6;

export interface RibbonSpec { name: string; radius: number; z0: number; z1: number; speed: number; }

/**
 * The one ribbon band, a thin strip along the top of the dasher board (holo-crowd.tsx leaves the face).
 * `speed` is panels per second between rounds and in the attract: 40 px/s over a 512 px panel; 0 in a fight.
 */
export function ribbonSpec(): RibbonSpec {
  const top = STAND_FLOOR_Z_M + DASHER_H_M;
  const z1 = top - RIBBON_BAND_DROP_M;
  return { name: "ribbon-dasher", radius: DASHER_R_M - 0.004, z0: z1 - RIBBON_BAND_H_M, z1, speed: 40 / 512 };
}

/** Sponsor board size (sim metres) and where the two hang: on the concourse rail at ±90° from the long axis. */
export const BOARD_W_M = 4.8;
export const BOARD_H_M = 1.2;
export const BOARD_AZIMUTHS = [Math.PI / 2, -Math.PI / 2] as const;

/**
 * Both boards in one geometry: a quad each, facing the stage, its UVs cut to atlas panel `i`
 * (OHMSTEAD, then PULPO POP), so one draw shows two different boards.
 */
export function createBoardsGeometry(): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const r = STAND_BACK_R_M + 0.05;
  const zc = STAND_TOP_Z_M + CONCOURSE_H_M + BOARD_H_M * 0.5 + 0.30;
  BOARD_AZIMUTHS.forEach((az, i) => {
    const cx = Math.cos(az) * r, cy = Math.sin(az) * r;
    // Tangent along the ring; the quad's front faces the stage (normal toward the origin).
    const tx = -Math.sin(az) * BOARD_W_M / 2, ty = Math.cos(az) * BOARD_W_M / 2;
    const base = i * 4;
    pos.push(cx + tx, cy + ty, zc - BOARD_H_M / 2, cx - tx, cy - ty, zc - BOARD_H_M / 2, cx - tx, cy - ty, zc + BOARD_H_M / 2, cx + tx, cy + ty, zc + BOARD_H_M / 2);
    const u0 = i / RIBBON_PANELS, u1 = (i + 1) / RIBBON_PANELS;
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

/** Panels on a ring of `radius`: the nearest multiple of the atlas so the seam never shows. */
export function ribbonRepeat(radius: number): number {
  return Math.max(RIBBON_PANELS, Math.round((Math.PI * 2 * radius) / RIBBON_PANEL_M / RIBBON_PANELS) * RIBBON_PANELS);
}

const RIBBON_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RIBBON_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uHasAtlas;
uniform float uTime;
uniform float uRepeat;
uniform float uScroll;
uniform float uLevel;
uniform float uTakeover;
uniform vec3 uTakeColor;
uniform float uFlashA;
uniform float uFlashB;
uniform float uSwap;
uniform float uSwapPanel;
varying vec2 vUv;
void main() {
  // Seen from inside the ring, so u runs mirrored; uScroll only advances between rounds.
  float u = (1.0 - vUv.x) * uRepeat + uScroll;
  float panel = mod(floor(u), ${RIBBON_PANELS}.0);
  vec2 a = vec2((panel + fract(u)) / ${RIBBON_PANELS}.0, vUv.y);
  vec3 col = uHasAtlas > 0.5 ? texture2D(uAtlas, a).rgb : vec3(0.02, 0.03, 0.08);
  // Sponsor reaction: every panel swaps to the sponsor's for 1.5 s (OHMSTEAD on a crit, PULPO POP on a steal).
  if (uSwap > 0.0) col = mix(col, texture2D(uAtlas, vec2((uSwapPanel + fract(u)) / ${RIBBON_PANELS}.0, vUv.y)).rgb, uSwap * uHasAtlas);
  // Takeover: chevrons racing round the ring in the cue colour.
  float chev = step(0.5, fract(u * 3.0 - abs(vUv.y - 0.5) * 1.2 - uTime * 2.5));
  col = mix(col, uTakeColor * (0.25 + 0.75 * chev), uTakeover);
  // LED pixel grid (square pixels: 14 down the 40 mm strip).
  // Faded out once a pixel is smaller than a screen pixel, or the far ring shimmers with moire.
  vec2 grid = vec2(u * 144.0, vUv.y * 14.0);
  vec2 cell = fract(grid);
  float led = smoothstep(0.0, 0.2, cell.x) * smoothstep(1.0, 0.8, cell.x) * smoothstep(0.0, 0.2, cell.y) * smoothstep(1.0, 0.8, cell.y);
  float resolved = clamp(1.6 - max(fwidth(grid.x), fwidth(grid.y)) * 2.0, 0.0, 1.0);
  col *= mix(0.72, 0.5 + 0.5 * led, resolved);
  // White flood on the struck side: the cylinder's u past 0.5 is the x < 0 (atlas) half.
  col += vec3(mix(uFlashB, uFlashA, step(0.5, vUv.x)) * 0.6);
  gl_FragColor = vec4(col * uLevel, 1.0);
}
`;

/* ───────────────────────── view ───────────────────────── */

export interface LedStripsView { readonly objects: readonly Object3D[]; update(rt: StageRuntime, dtS: number): void; dispose(): void; }

export function createLedStripsView(): LedStripsView {
  const segs = stripLayout();
  const geometry = new BoxGeometry(LED_SEGMENT_M, LED_TAPE_W_M, LED_TAPE_H_M);
  // Tone-mapped, unlike every other emitter that came before it. `toneMapped: false` was the whole
  // cheap-neon read (GROUNDING E): it took the strip out of the photographic pipeline, so it rendered as
  // flat, fully saturated team colour with no highlight rolloff while everything around it went through
  // ACES. A real LED strip on a real camera clips to a near-white core with the colour in its falloff.
  const material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, segs.length);
  const m = new Matrix4(), q = new Quaternion(), z = new Vector3(0, 0, 1), one = new Vector3(1, 1, 1), p = new Vector3();
  const black = new Color(0, 0, 0);
  segs.forEach((s, i) => {
    mesh.setMatrixAt(i, m.compose(p.set(s.x, s.y, RIG_LED_Z_M), q.setFromAxisAngle(z, s.yaw), one));
    mesh.setColorAt(i, black);
  });
  mesh.name = "led-strips";
  mesh.layers.enable(REFLECTION_LAYER);

  const atlas = createSponsorRibbon(MARKS);
  const spec = ribbonSpec();
  const ribbonGeo = new CylinderGeometry(spec.radius, spec.radius, spec.z1 - spec.z0, 192, 1, true);
  ribbonGeo.rotateX(Math.PI / 2);
  const ribbonMat = new ShaderMaterial({
    vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, side: BackSide,
    uniforms: {
      uAtlas: { value: atlas }, uHasAtlas: { value: atlas ? 1 : 0 }, uTime: { value: 0 }, uRepeat: { value: ribbonRepeat(spec.radius) },
      uScroll: { value: 0 }, uLevel: { value: 1 }, uTakeover: { value: 0 }, uTakeColor: { value: new Color() },
      uFlashA: { value: 0 }, uFlashB: { value: 0 }, uSwap: { value: 0 }, uSwapPanel: { value: 0 },
    },
  });
  const ribbon = new Mesh(ribbonGeo, ribbonMat);
  ribbon.position.z = (spec.z0 + spec.z1) / 2;
  ribbon.frustumCulled = false;
  ribbon.name = spec.name;
  const boardsGeo = createBoardsGeometry();
  // Static dim plates: emissive ≤ 0.08, never animated (5.2).
  // fog: false — FOG.far stops 3.4 m from the deck and these hang 15 m out on the concourse wall.
  const boardsMat = new MeshBasicMaterial({ map: atlas, color: new Color(0.08, 0.08, 0.08), toneMapped: false, fog: false });
  const boards = new Mesh(boardsGeo, boardsMat);
  boards.name = "sponsor-boards";

  const pulse = createShowPulse();
  const c = new Color(), white = new Color(1, 1, 1);
  return {
    objects: [mesh, ribbon, boards],
    update(rt, dtS) {
      const now = rt.wallMs();
      const s = readShowPulse(rt, now, pulse);
      const cb = rt.colorblind();
      const cobalt = linearColor(teamHex("atlas", cb));
      const magenta = linearColor(teamHex("blaze", cb));
      const t = now / 1000;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        c.copy(seg.side < 0 ? cobalt : magenta);
        let k = LED_INTENSITY * (seg.side < 0 ? s.levelA : s.levelB);
        if (s.idle) {
          const chase = 0.5 + 0.5 * Math.cos((seg.along * 6 - t * 0.6) * Math.PI * 2);
          k *= 0.62 + 0.5 * chase * chase;
        }
        c.multiplyScalar(k);
        if (s.pulse > 0) c.lerp(s.pulseColor, s.pulse * 0.85).multiplyScalar(1 + s.pulse * 1.2);
        const f = seg.side < 0 ? s.flashA : s.flashB;
        if (f > 0) {
          // The flash rides out from the midline to the struck seat's end.
          const reach = Math.abs(seg.x) / (DECK_LENGTH_M / 2);
          const wave = clamp01(1.4 * f - Math.abs(reach - (1 - f)) * 1.6);
          const w = Math.max(f * 0.6, wave);
          c.lerp(white, w).multiplyScalar(1 + w * 2.8);
        }
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const level = 0.5 * (s.levelA + s.levelB);
      const u = ribbonMat.uniforms;
      u.uTime.value = t % 3600;
      u.uScroll.value = (u.uScroll.value + (s.idle ? spec.speed * dtS : 0)) % RIBBON_PANELS;
      u.uLevel.value = RIBBON_LEVEL * level * (1 + 0.2 * Math.sin((t / RIBBON_BREATH_S) * Math.PI * 2));
      u.uTakeover.value = Math.min(1, s.pulse * 1.3);
      if (s.pulse > 0) (u.uTakeColor.value as Color).copy(s.pulseColor).multiplyScalar(1.6);
      // 11.9 FeedbackFrame.deckFlash: the struck seat's edge floods white for 120 ms (steal 300 ms, KO 700 ms).
      const flood = rt.game.feedback.frame.deckFlash;
      const fl = flood.seat ? Math.min(1, flood.ms / 120) : 0;
      u.uFlashA.value = Math.max(s.flashA, flood.seat === "atlas" ? fl : 0) * 0.5;
      u.uFlashB.value = Math.max(s.flashB, flood.seat === "blaze" ? fl : 0) * 0.5;
      const swap = rt.vfx.cues.sponsorSwap(now);
      u.uSwap.value = swap.amount;
      if (swap.panel >= 0) u.uSwapPanel.value = swap.panel;
    },
    dispose() {
      geometry.dispose(); material.dispose(); atlas?.dispose();
      ribbonGeo.dispose(); ribbonMat.dispose(); boardsGeo.dispose(); boardsMat.dispose();
    },
  };
}

export function LedStrips(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const view = useMemo(() => createLedStripsView(), []);
  useEffect(() => () => view.dispose(), [view]);
  useFrame((_, dt) => view.update(rt, Math.min(dt, 0.1)), 0);
  return <>{view.objects.map((o) => <primitive key={o.name} object={o} />)}</>;
}
