// src/game/render/stage-deck.tsx (WP2, rebuilt for GROUNDING A + B)
// The deck as a built object. Four draws (the ground itself is studio-floor.tsx):
//   plate  — an 18 mm composite plate, its edge hidden behind the trim.
//   mat    — two matte ESD rubber panels (roughness 0.75–0.9) with a 3 mm seam on the centreline, carrying
//            the worn printed graphics, the milled dock recesses and baked contact AO (deck-texture.ts).
//   trim   — a brushed-aluminium extrusion capping the perimeter, with a 2.8 mm chamfered arris along the top
//            outer edge. That arris is the fine specular line that tells the eye the deck has thickness.
//   bolts  — 14 countersunk M5 hex heads in the trim's top face, corners first, ~0.25 m apart, each with the
//            dirt ring a real bolt collects. One InstancedMesh.
// Nothing on the deck emits except the dock LED gasket rings (real fixtures in the milled recesses), gated by
// the Core's state (5.2). The show pulse and the struck-edge flood arrive as *light from the edge LED strips
// landing on* the mat and the trim, not as glowing paint: GROUNDING E.
//
// Reflection: ours, not drei's <MeshReflectorMaterial>, for the frame-ordering reasons below. The mirrored
// camera renders at useFrame priority 0.45 (after every world component has moved, sharing the frame's one
// shadow update), REFLECTION_LAYER only (arms LOD1, LED line, cubes, hit light), 480 × 270 on DEFAULT, into a
// mip-mapped target; the shader takes a vertical streak of taps down the mips. It lands on the *trim* and on
// the scuffed play lanes only — a matte rubber mat does not mirror (GROUNDING A). LOW skips the pass and
// zeroes the uniform: one program on every tier.
// The two team sweeps are analytic cones projected onto the deck and (at 30 %) the studio floor from the same lamp
// and axis lighting.tsx aims the volumetric cone along (`DECK_SWEEP_UNIFORMS`), 1/d², decaying to nothing
// 0.45 m beyond the deck edge: no SpotLight in the forward shader.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useSyncExternalStore, type JSX } from "react";
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, HalfFloatType,
  InstancedMesh, LinearMipmapLinearFilter, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, PlaneGeometry,
  Quaternion, RingGeometry, SRGBColorSpace, Vector3, Vector4, WebGLRenderTarget,
  type Camera, type Object3D, type Scene, type WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MARKS } from "../brand/marks.ts";
import { DOCK_CENTER_X, DOCK_RADIUS, REFLECTION_LAYER, RENDER_SCALE } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { createCanvas } from "./brand-textures.ts";
import {
  BOLT_HEAD_M, DECK_LENGTH_M, DECK_SURFACE_H, DECK_SURFACE_W, DECK_THICKNESS_M, DECK_WIDTH_M, MAT_LENGTH_M, MAT_WIDTH_M,
  TRIM_RISE_M, TRIM_W_M, deckBoltsM, deckLayout, paintDeck, paintDeckSurface,
} from "./deck-texture.ts";
import { createShowPulse, readShowPulse } from "./led-strips.tsx";
import { teamHex } from "./robot-materials.ts";
import { linearColor } from "./vfx/sparks.ts";

/** Reflection target per tier (16:9 like the main camera); LOW has none. */
export const REFLECTION_SIZE = { high: [960, 540], default: [480, 270] } as const;
/** Strength of the reflection where the surface is smooth enough to carry one (trim, scuffed lanes). */
const REFLECTION_STRENGTH = 0.85;
/**
 * The trim's reflection strength. A polished aluminium extrusion in a dark room is only as bright as what it
 * has to reflect, and at 0.48 the arris — the one fine specular line that tells the eye the deck has
 * thickness — was reflecting an almost black environment and vanishing. Tuned against
 * CALIBRATION.environmentIntensity 0.7; rigging.tsx's apron sits at 0.42 and wants to follow (see handoff),
 * because two parts of the same extruded stock must read as one metal.
 */
const TRIM_ENV_INTENSITY = 0.62;
/** See the mat's `map_fragment` patch: the one lever that moves the frame's mean into PART 2's 0.12–0.28. */
const MAT_ALBEDO_LIFT = 1.7;
/** Cone half-angles of the deck-projected sweep pools (cosines), and how far past the deck edge they reach. */
// Hand-copied from POOL.angle / POOL.innerAngle in lighting.tsx — these two MUST move together, or the haze
// cone and the pool it lands stop being the same fixture. tests/deck-pool-angles pins that they agree.
const POOL_COS = { outer: Math.cos(0.3), inner: Math.cos(0.18) };
const POOL_REACH_M = 0.45;
/**
 * How far inboard the edge LED strips throw usable light. A 14 mm tape recessed in an 18 mm channel, aimed
 * up, grazes the trim and dies quickly on the mat: 0.13 m put team colour over a third of a 0.70 m deck and
 * was most of why the frame measured 0.79 mean saturation.
 */
const EDGE_REACH_M = 0.07;
/** Dock LED gasket levels (5.2): dark until the Core is in play, full volt while it is loose, carried or docked. */
const DOCK_IDLE = 0.0;
const MAT_Z = 0.0003;

/**
 * The two deck-projected sweep pools, written each frame by lighting.tsx (lamp and axis in render units,
 * colour × strength linear). ponytail: module-level uniforms assume one arena canvas at a time (as CYC_UNIFORMS).
 */
export const DECK_SWEEP_UNIFORMS = {
  uPoolLamp: { value: [new Vector3(), new Vector3()] },
  uPoolAxis: { value: [new Vector3(0, -1, 0), new Vector3(0, -1, 0)] },
  uPoolColor: { value: [new Color(0, 0, 0), new Color(0, 0, 0)] },
};

const HX = (DECK_LENGTH_M / 2 * RENDER_SCALE).toFixed(4);
const HY = (DECK_WIDTH_M / 2 * RENDER_SCALE).toFixed(4);

/** Exported so studio-floor.tsx carries the same par-can pools past the deck edge (one lamp, one pool). */
export const DECK_POOL_GLSL = /* glsl */ `
uniform vec3 uPoolLamp[2];
uniform vec3 uPoolAxis[2];
uniform vec3 uPoolColor[2];
varying vec3 vPoolWorld;
// Analytic cone from the lamp along its axis, smoothstep on the angle, 1/d² in sim metres, fading to nothing
// POOL_REACH_M past the deck edge so the coloured light never reaches the risers or the bowl.
vec3 tlPoolLight() {
  vec3 sum = vec3(0.0);
  vec2 d2 = max(abs(vPoolWorld.xz) - vec2(${HX}, ${HY}), 0.0);
  float past = 1.0 - smoothstep(0.0, ${(POOL_REACH_M * RENDER_SCALE).toFixed(4)}, length(d2));
  for (int i = 0; i < 2; i++) {
    vec3 d = vPoolWorld - uPoolLamp[i];
    float dist = length(d);
    float c = dot(d / max(dist, 1e-4), uPoolAxis[i]);
    float cone = smoothstep(${POOL_COS.outer.toFixed(5)}, ${POOL_COS.inner.toFixed(5)}, c);
    float dm = dist / ${RENDER_SCALE.toFixed(3)};
    sum += uPoolColor[i] * cone / max(dm * dm, 0.25);
  }
  return sum * past;
}
`;
/** Light thrown inboard by the deck-edge LED strips (led-strips.tsx): a real fixture, so this is light, not glow. */
const EDGE_PARS = /* glsl */ `
uniform vec3 uTeamA;
uniform vec3 uTeamB;
uniform float uEdgeA;
uniform float uEdgeB;
vec3 tlEdgeLight() {
  // Signed distance to the strip line running along the deck edge: the light falls off both ways from it.
  vec2 inb = vec2(${HX}, ${HY}) - abs(vPoolWorld.xz);
  float e = 1.0 - smoothstep(0.0, ${(EDGE_REACH_M * RENDER_SCALE).toFixed(4)}, abs(min(inb.x, inb.y)));
  return mix(uTeamA * uEdgeA, uTeamB * uEdgeB, step(0.0, vPoolWorld.x)) * e * e;
}
`;
export const DECK_POOL_VERTEX = "vPoolWorld = (modelMatrix * vec4(position, 1.0)).xyz;";
/** The pools and the edge strips light the surface like lamps: diffuse plus a small sheen. */
const SURFACE_LIGHT = (share: number) => /* glsl */ `
{
  vec3 tlLit = (tlPoolLight() * ${share.toFixed(2)}) + tlEdgeLight();
  reflectedLight.directDiffuse += tlLit * (diffuseColor.rgb + vec3(0.05));
}
`;

/** The planar reflection tap: a vertical streak down the mips, Schlick fresnel, scaled by the caller's mask. */
const REFL_PARS = /* glsl */ `
uniform sampler2D uRefl;
uniform float uReflStrength;
uniform float uReflSpread;
varying vec4 vReflUv;
vec3 tlReflection() {
  vec2 ruv = vReflUv.xy / max(vReflUv.w, 1e-4);
  vec3 refl = texture2D(uRefl, ruv, 1.0).rgb * 0.24;
  for (int i = 1; i <= 3; i++) {
    float fi = float(i);
    vec2 o = vec2(0.0, uReflSpread * fi);
    refl += (texture2D(uRefl, ruv + o, 1.0 + fi * 0.6).rgb + texture2D(uRefl, ruv - o, 1.0 + fi * 0.6).rgb) * (0.19 - 0.05 * fi);
  }
  vec2 ox = vec2(uReflSpread * 0.6, 0.0);
  refl += (texture2D(uRefl, ruv + ox, 1.5).rgb + texture2D(uRefl, ruv - ox, 1.5).rgb) * 0.11;
  return refl * uReflStrength;
}
`;

interface Patchable { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }

/** Adds the world-position varying, the pool/edge lighting and the shared show uniforms to a lit material. */
function patchSurface(shader: Patchable, share: number, u: Record<string, unknown>): void {
  Object.assign(shader.uniforms, DECK_SWEEP_UNIFORMS, u);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
varying vec3 vPoolWorld;
uniform mat4 uReflMatrix;
varying vec4 vReflUv;
attribute vec2 aDeckUv;
varying vec2 vDeckUv;`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${DECK_POOL_VERTEX}\nvDeckUv = aDeckUv;\nvReflUv = uReflMatrix * vec4(vPoolWorld, 1.0);`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying vec2 vDeckUv;\n${DECK_POOL_GLSL}\n${EDGE_PARS}\n${REFL_PARS}`)
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${SURFACE_LIGHT(share)}`);
}

function useColorblind(rt: StageRuntime): boolean {
  return useSyncExternalStore(rt.game.settings.subscribe, () => rt.game.settings.get().access.colorblind, () => false);
}

function canvasTexture(w: number, h: number, srgb: boolean): { canvas: HTMLCanvasElement | null; texture: CanvasTexture | null } {
  const canvas = createCanvas(w, h);
  const texture = canvas ? new CanvasTexture(canvas) : null;
  if (texture) { if (srgb) texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8; }
  return { canvas, texture };
}

/**
 * The trim extrusion: one closed rectangular loop, mitred at the corners (an axis-aligned rectangle mitres by
 * offsetting each corner diagonally, which is what adding the profile offset to both half-extents does).
 * Profile runs inner lip → top face → chamfered arris → outer skirt; uv.x is the profile parameter, uv.y the
 * distance along the run in metres, so the brushed grain can follow the extrusion.
 */
function trimGeometry(): BufferGeometry {
  const hx = DECK_LENGTH_M / 2, hy = DECK_WIDTH_M / 2;
  const prof: readonly (readonly [number, number])[] = [
    [-TRIM_W_M - 0.002, 0.0006],          // inner lip, clamping the mat edge
    [-TRIM_W_M + 0.0015, TRIM_RISE_M],    // rise to the top face
    [-0.0028, TRIM_RISE_M],               // top face out to the arris
    [0.0008, 0.0011],                     // the chamfer: the deck's specular line
    [0.0008, -DECK_THICKNESS_M - 0.001],  // outer skirt, past the plate
  ];
  const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (c: number, i: number): [number, number, number] => {
    const [sx, sy] = corners[c], [u, z] = prof[i];
    return [sx * (hx + u), sy * (hy + u), z];
  };
  const pos: number[] = [], uvs: number[] = [];
  let run = 0;
  for (let c = 0; c < 4; c++) {
    const n = (c + 1) % 4;
    const a = at(c, 0), b = at(n, 0);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i < prof.length - 1; i++) {
      const p00 = at(c, i), p01 = at(c, i + 1), p10 = at(n, i), p11 = at(n, i + 1);
      const u0 = i / (prof.length - 1), u1 = (i + 1) / (prof.length - 1);
      pos.push(...p00, ...p11, ...p10, ...p00, ...p01, ...p11);
      uvs.push(u0, run, u1, run + len, u0, run + len, u0, run, u1, run, u1, run + len);
    }
    run += len;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aDeckUv", new BufferAttribute(new Float32Array(uvs), 2));
  g.computeVertexNormals();
  return g;
}

/**
 * One countersunk M5 hex head, flush in the trim's top face (z = 0 is that face): the countersink wall, the
 * sunk head, and the dirt ring round it. Vertex colour separates the steel from the grime so all 14 bolts are
 * a single instanced draw.
 */
function boltGeometry(): BufferGeometry {
  const r = BOLT_HEAD_M / 2 / Math.cos(Math.PI / 6);
  const depth = 0.0013;
  const wall = new CylinderGeometry(r, r * 0.55, depth, 6, 1, true);
  wall.rotateX(Math.PI / 2);
  wall.translate(0, 0, -depth / 2);
  const head = new CircleGeometry(r * 0.55, 6);
  head.translate(0, 0, -depth);
  const dirt = new RingGeometry(r * 1.02, r * 1.75, 12);
  const parts = [wall, head, dirt];
  const tint = [[0.74, 0.76, 0.80], [0.30, 0.31, 0.34], [0.20, 0.18, 0.15]];
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i].attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { c[v * 3] = tint[i][0]; c[v * 3 + 1] = tint[i][1]; c[v * 3 + 2] = tint[i][2]; }
    parts[i].setAttribute("color", new BufferAttribute(c, 3));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? wall;
}

export interface StageDeckView {
  readonly objects: readonly Object3D[];
  repaint(colorblind: boolean): void;
  update(rt: StageRuntime): void;
  reflect(rt: StageRuntime, gl: WebGLRenderer, scene: Scene, camera: Camera): void;
  dispose(): void;
}

export function createStageDeckView(): StageDeckView {
  const layout = deckLayout();
  const surfaceLayout = deckLayout(DECK_SURFACE_W, DECK_SURFACE_H);
  const print = canvasTexture(layout.width, layout.height, true);
  const surf = canvasTexture(surfaceLayout.width, surfaceLayout.height, false);
  const [rw, rh] = REFLECTION_SIZE.default;
  const target = new WebGLRenderTarget(rw, rh, {
    type: HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: LinearMipmapLinearFilter,
  });
  const u = {
    uRefl: { value: target.texture }, uReflMatrix: { value: new Matrix4() }, uReflStrength: { value: 0 },
    uReflSpread: { value: 0.006 },
    uTeamA: { value: new Color() }, uTeamB: { value: new Color() }, uEdgeA: { value: 0 }, uEdgeB: { value: 0 },
  };
  const dockU = { uSurface: { value: surf.texture }, uDockA: { value: DOCK_IDLE }, uDockB: { value: DOCK_IDLE },
    uContestedA: { value: 0 }, uContestedB: { value: 0 } };

  // --- the mat -----------------------------------------------------------------------------------------
  const mat = new MeshStandardMaterial({ map: print.texture, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    patchSurface(shader, 1, { ...u, ...dockU });
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uSurface;
uniform float uDockA;
uniform float uDockB;
uniform float uContestedA;
uniform float uContestedB;
vec3 tlSurf;
// The LED gasket ring seated in each milled dock recess: 2 mm of real strip, dashed while contested (5.2).
float tlDockLed(vec2 mm, float cx, float level, float contested) {
  vec2 d = mm - vec2(cx, 0.0);
  float rr = length(d);
  float band = smoothstep(0.0022, 0.0009, abs(rr - ${(DOCK_RADIUS + 0.0055).toFixed(4)}));
  float dash = mix(1.0, step(0.5, fract(atan(d.y, d.x) * ${(8 / Math.PI).toFixed(4)})), contested);
  return band * dash * level;
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
tlSurf = texture2D(uSurface, vDeckUv).rgb;
// PART 2 acceptance 1. The mat is the largest object in a cockpit frame and it was grading to a mean of
// 0.027 display with 88 % of it under 0.06 — every midtone the histogram asks for was missing from the mat,
// not from the room behind it, and raising the studio floor twice moved the frame mean by 0.0008. This lifts
// the mat's albedo only: the key, the grade, the exposure and the room are untouched, the rubber stays
// matte (roughnessFactor is set below from tlSurf, not from here) and it still sits four to six stops under
// the opponent, so the squint order and the 8× back-wall gate are unaffected.
diffuseColor.rgb *= ${MAT_ALBEDO_LIFT.toFixed(2)};`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
// Matte ESD rubber (0.75–0.9), dropping only where play has polished the mat or paint has been laid on it.
roughnessFactor = clamp(tlSurf.r * 1.02, 0.42, 0.93);`)
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>
{
  // Baked contact AO: the mount footprints, the dock recess walls, the seam. Ambient only, so the key still
  // models the surface; the tight contact shadows are the blob pass and the shadow map.
  float tlAo = clamp(tlSurf.g, 0.0, 1.0);
  reflectedLight.indirectDiffuse *= tlAo;
  reflectedLight.indirectSpecular *= mix(1.0, tlAo, 0.7);
}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{
  vec2 mm = vec2((vDeckUv.x - 0.5) * ${MAT_LENGTH_M.toFixed(3)}, (vDeckUv.y - 0.5) * ${MAT_WIDTH_M.toFixed(3)});
  float led = tlDockLed(mm, ${DOCK_CENTER_X.atlas.toFixed(3)}, uDockA, uContestedA)
    + tlDockLed(mm, ${DOCK_CENTER_X.blaze.toFixed(3)}, uDockB, uContestedB);
  totalEmissiveRadiance = vec3(1.0, 0.84, 0.05) * led * 1.0;
}`)
      .replace("#include <opaque_fragment>", `
{
  // The mat reflects only where it is scuffed smooth, and even then weakly: GROUNDING A.
  float scuff = tlSurf.b * (1.0 - smoothstep(0.45, 0.8, roughnessFactor));
  if (uReflStrength > 0.0 && scuff > 0.002) {
    float ndv = saturate(dot(geometryNormal, geometryViewDir));
    outgoingLight += tlReflection() * (0.04 + 0.96 * pow(1.0 - ndv, 5.0)) * scuff * 0.3;
  }
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "tl-deck-mat";

  // --- the trim ----------------------------------------------------------------------------------------
  // Same aluminium as rigging.tsx's apron (ALU_X #6B7076 @ envMapIntensity 0.42), which sits 2 mm away:
  // two parts of the same extruded stock must read as one metal. A shade lighter and a touch smoother because
  // the deck's own trim is the newer, hand-polished part, and its arris is the frame's fine specular line.
  const trim = new MeshStandardMaterial({ color: "#7A8087", roughness: 0.34, metalness: 0.95, envMapIntensity: TRIM_ENV_INTENSITY });
  trim.onBeforeCompile = (shader) => {
    patchSurface(shader, 1, u);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
{
  // Brushed: the grain varies across the profile and not along the run, so it reads as lines running the
  // length of the extrusion. Isotropic noise here just sparkles and the trim turns into gravel.
  // ~1 streak per mm across the face: finer than that aliases into sparkle at the grazing cockpit angle.
  float brush = fract(sin(vDeckUv.x * 64.0) * 43758.5453) * 0.65 + fract(sin(vDeckUv.x * 17.0) * 12345.678) * 0.35;
  roughnessFactor = clamp(roughnessFactor + (brush - 0.5) * 0.09 + smoothstep(0.18, 0.0, vDeckUv.x) * 0.3, 0.12, 0.85);
  diffuseColor.rgb *= 1.0 - smoothstep(0.16, 0.0, vDeckUv.x) * 0.45;
}`)
      .replace("#include <opaque_fragment>", `
if (uReflStrength > 0.0) {
  // Only the up-facing top face and the arris mirror the stage; the outer skirt faces the wrong way.
  float face = 1.0 - smoothstep(0.42, 0.62, vDeckUv.x);
  float ndv = saturate(dot(geometryNormal, geometryViewDir));
  outgoingLight += tlReflection() * (0.12 + 0.88 * pow(1.0 - ndv, 4.0)) * face * (1.0 - roughnessFactor * 0.8);
}
#include <opaque_fragment>`);
  };
  trim.customProgramCacheKey = () => "tl-deck-trim";

  const bolt = new MeshStandardMaterial({ color: "#FFFFFF", vertexColors: true, roughness: 0.52, metalness: 0.85 });

  const plateGeometry = new BoxGeometry(DECK_LENGTH_M, DECK_WIDTH_M, DECK_THICKNESS_M);
  const matGeometry = new PlaneGeometry(MAT_LENGTH_M, MAT_WIDTH_M);
  const trimGeo = trimGeometry();
  const boltGeo = boltGeometry();
  // Every deck surface feeds the shared shader the same attribute: the mat's is its texture uv, the trim's is
  // (profile, run in metres).
  matGeometry.setAttribute("aDeckUv", matGeometry.getAttribute("uv"));
  const plateMat = new MeshStandardMaterial({ color: "#191B21", roughness: 0.55, metalness: 0.3 });

  const plate = new Mesh(plateGeometry, plateMat);
  plate.position.set(0, 0, -DECK_THICKNESS_M / 2 - 0.0002);
  plate.receiveShadow = true;
  plate.name = "deck-plate";
  const deckTop = new Mesh(matGeometry, mat);
  deckTop.position.z = MAT_Z;
  deckTop.receiveShadow = true;
  deckTop.name = "deck-top";
  const trimMesh = new Mesh(trimGeo, trim);
  trimMesh.receiveShadow = true;
  trimMesh.castShadow = false;
  trimMesh.name = "deck-trim";
  const boltPositions = deckBoltsM();
  const bolts = new InstancedMesh(boltGeo, bolt, boltPositions.length);
  bolts.name = "deck-bolts";
  bolts.frustumCulled = false;
  {
    const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3(1, 1, 1);
    boltPositions.forEach((b, i) => {
      p.set(b.x, b.y, TRIM_RISE_M + 0.00015);
      q.setFromAxisAngle(new Vector3(0, 0, 1), (i % 3) * 0.37);
      bolts.setMatrixAt(i, m.compose(p, q, s));
    });
    bolts.instanceMatrix.needsUpdate = true;
  }

  // Mirror camera state, allocated once. REFLECTION_LAYER only (5.4): the arms' LOD1 shells, the LED line,
  // the cubes and the hit light; the lights are on it too (lighting.tsx).
  const vcam = new PerspectiveCamera();
  vcam.layers.set(REFLECTION_LAYER);
  const normal = new Vector3(), planePos = new Vector3(), camPos = new Vector3(), view = new Vector3();
  const lookAt = new Vector3(), tgt = new Vector3(), rot = new Matrix4();
  const plane = new Plane(), clip = new Vector4(), qv = new Vector4();
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const pulse = createShowPulse();
  let size: readonly number[] = REFLECTION_SIZE.default;

  /** Mirrors `camera` in the deck plane; false when the camera is under the deck. */
  function mirror(camera: Camera): boolean {
    const mw = deckTop.matrixWorld;
    planePos.setFromMatrixPosition(mw);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(mw);
    normal.set(0, 0, 1).applyMatrix4(rot);
    view.subVectors(planePos, camPos);
    if (view.dot(normal) > 0) return false;
    view.reflect(normal).negate().add(planePos);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.subVectors(planePos, lookAt).reflect(normal).negate().add(planePos);
    vcam.position.copy(view);
    vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vcam.lookAt(tgt);
    vcam.far = (camera as PerspectiveCamera).far ?? 100;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    // World space, so the trim and the mat (different model matrices) share one uniform.
    u.uReflMatrix.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    // Oblique near plane at the deck (Lengyel), so nothing under the deck leaks into the mirror.
    plane.setFromNormalAndCoplanarPoint(normal, planePos).applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = vcam.projectionMatrix.elements;
    qv.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(qv));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    return true;
  }

  return {
    objects: [plate, deckTop, trimMesh, bolts],
    repaint(colorblind) {
      const teamB = teamHex("blaze", colorblind);
      const pctx = print.canvas?.getContext("2d");
      if (pctx && print.texture) { paintDeck(pctx, layout, teamB, MARKS.torqueLimit); print.texture.needsUpdate = true; }
      const sctx = surf.canvas?.getContext("2d");
      if (sctx && surf.texture) { paintDeckSurface(sctx, surfaceLayout); surf.texture.needsUpdate = true; }
    },
    update(rt) {
      const p = readShowPulse(rt, rt.wallMs(), pulse);
      const cb = rt.colorblind();
      u.uTeamA.value.copy(linearColor(teamHex("atlas", cb)));
      u.uTeamB.value.copy(linearColor(teamHex("blaze", cb)));
      // The edge strips idle low and flood on a strike: light landing on the mat, not paint that glows.
      u.uEdgeA.value = 0.028 * p.levelA + 1.5 * p.flashA;
      u.uEdgeB.value = 0.028 * p.levelB + 1.5 * p.flashB;
      // Dock LED gaskets: dim standby until the Core is in play; volt, pulsing at 2 Hz, while it sits there.
      const core = rt.game.rules.state.core;
      const t = rt.wallMs() / 1000;
      const live = 0.8 + 0.2 * Math.sin(t * Math.PI * 4);
      const inPlay = core.phase !== "dormant" ? 0.4 : DOCK_IDLE;
      dockU.uDockA.value = core.dockedIn === "atlas" ? live : inPlay;
      dockU.uDockB.value = core.dockedIn === "blaze" ? live : inPlay;
      dockU.uContestedA.value = core.contested && core.dockedIn === "atlas" ? 1 : 0;
      dockU.uContestedB.value = core.contested && core.dockedIn === "blaze" ? 1 : 0;
    },
    reflect(rt, gl, scene, camera) {
      const tier = rt.quality.tier.id;
      if (tier === "low" || !mirror(camera)) { u.uReflStrength.value = 0; return; }
      const want = REFLECTION_SIZE[tier];
      if (want !== size) { size = want; target.setSize(want[0], want[1]); }
      u.uReflStrength.value = REFLECTION_STRENGTH;
      const prev = gl.getRenderTarget();
      deckTop.visible = false;
      gl.setRenderTarget(target);
      gl.clear();
      gl.render(scene, vcam);
      gl.setRenderTarget(prev);
      deckTop.visible = true;
    },
    dispose() {
      print.texture?.dispose(); surf.texture?.dispose(); target.dispose();
      mat.dispose(); trim.dispose(); bolt.dispose(); plateMat.dispose();
      plateGeometry.dispose(); matGeometry.dispose(); trimGeo.dispose(); boltGeo.dispose();
    },
  };
}

export function StageDeck(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const colorblind = useColorblind(rt);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const view = useMemo(() => createStageDeckView(), []);
  useEffect(() => view.repaint(colorblind), [view, colorblind]);
  useEffect(() => () => view.dispose(), [view]);
  useFrame(() => view.update(rt), 0);
  // After the shadow maps are marked (0.4) and before the jumbotron feed (0.5) and the composer (1).
  useFrame(() => view.reflect(rt, gl, scene, camera), 0.45);
  return <>{view.objects.map((o) => <primitive key={o.name} object={o} />)}</>;
}
