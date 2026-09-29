// src/game/render/ghost-arm.tsx (WP3)
// The ghost is the hand (EMOTION_BIBLE 3.1): the pilot's commanded pose answers within the frame, the painted arm
// is the muscle that carries it. Below leash stretch 0.15 only a 3 mm ring at the ghost tip (the reticle's world
// twin) plus the jaw outline when it differs from the physical jaw by more than 4°; from 0.15 → 0.35 the wrist,
// gripper and jaw hologram fade in. Edge hue: cobalt at 0 → white at 0.6 → amber at 1.0 (amber = behind the
// command, the same lesson on both bodies). The leash is a tapered ribbon, width proportional to stretch, with
// three beads travelling arm → ghost at the servo's closing speed, drawn only above 0.35. While a contact between
// the own tool link and the opponent is live the drawn tip is clamped to that contact's half-space + 8 mm and
// flushes white: one dot product, the command still goes through, only the picture stops. Same thresholds from
// match 1; there is no tutorial ghost. LOD1 geometry (0.45 M budget). Local only: never shown to the AI, never
// recorded.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, RingGeometry, ShaderMaterial, Vector3,
} from "three";
import { RENDER_SCALE, TOKEN_HEX, type GameEvent, type LinkId, type Seat } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { createLinkPoses, forwardKinematics, linkGeometry, type RobotAssets } from "./robot-assets.ts";
import { useRobotAssets } from "./robot-view.tsx";
import { clamp01, smoothstep } from "./interpolate.ts";
import { LOCAL_LAYER } from "./quality.ts";

/**
 * Solid-body fill of the hologram. The ghost is a projection of the commanded pose, not a second arm: at 0.12
 * over both faces of a double-sided shell it composited to ~0.36 display over the whole wrist-and-gripper
 * silhouette, which on the viewmodel is a large pale shape across the middle of the frame and reads as a
 * rendering artefact. The body is now a hint (0.045, front faces only) and the read is carried by the fresnel
 * edge, the tip ring and the leash — the three parts that say "projection".
 */
export const GHOST_FILL_OPACITY = 0.045;
export const MATCH_GHOST_LINKS: readonly LinkId[] = ["wrist", "gripper", "moving_jaw"];
/** Leash stretch over which the hand hologram fades in (3.1). */
export const GHOST_SHOW_STRETCH: readonly [number, number] = [0.15, 0.35];
export const LEASH_SHOW_STRETCH = 0.35;
export const GHOST_RING_M = 0.003;
export const JAW_OUTLINE_RAD = (4 * Math.PI) / 180;
export const CLIP_OFFSET_M = 0.008;
export const CLIP_LIVE_MS = 300;
export const LEASH_BEADS = 3;
export const GHOST_AMBER = "#FFB020";

const COBALT = new Color(TOKEN_HEX.cobalt);
const WHITE = new Color("#FFFFFF");
const AMBER = new Color(GHOST_AMBER);

/** Ghost edge hue by leash stretch: cobalt at 0 → white at 0.6 → amber at 1.0 (linear rgb). */
export function ghostHue(stretch: number, out: Color): Color {
  const s = clamp01(stretch);
  if (s < 0.6) return out.copy(COBALT).lerp(WHITE, s / 0.6);
  return out.copy(WHITE).lerp(AMBER, (s - 0.6) / 0.4);
}

/**
 * Half-space clip (3.1): with a live contact at `pos` with `normal` (sim world, atlas → blaze), the drawn tip may not
 * pass the plane on the pilot's side by more than 8 mm. Returns the sim-metre offset to add to the ghost (0 when
 * the tip is on the allowed side).
 */
export function clipOffset(seat: Seat, tip: ArrayLike<number>, pos: ArrayLike<number>, normal: ArrayLike<number>, out: Vector3): Vector3 {
  const flip = seat === "atlas" ? -1 : 1;                 // the pilot's side of the contact plane
  const nx = normal[0] * flip, ny = normal[1] * flip, nz = normal[2] * flip;
  const d = (tip[0] - pos[0]) * nx + (tip[1] - pos[1]) * ny + (tip[2] - pos[2]) * nz - CLIP_OFFSET_M;
  if (d >= 0) return out.set(0, 0, 0);
  return out.set(-d * nx, -d * ny, -d * nz);
}

const GHOST_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = -mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;
const GHOST_FRAG = /* glsl */ `
uniform vec3 uHue;
uniform float uFill;
uniform float uFade;
uniform float uFlush;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec3 n = normalize(vNormalV);
  float e = 1.0 - clamp(dot(n, normalize(vViewPos)), 0.0, 1.0);
  // A tighter, stronger rim than the old 2.5 / 0.6: the edge is what the eye should find, not the fill.
  float fres = pow(e, 3.2) * 0.85;
  // Hologram inner line: a thin white-hot band just inside the hue rim. It was not thin — the old band ran
  // from e 0.30 to 0.62, which on a near-field shell is most of the visible surface, so the "line" was a
  // broad white wash at alpha 0.45 and that, not the fill, is what made the ghost read as a solid pale arm.
  float inner = smoothstep(0.46, 0.54, e) * (1.0 - smoothstep(0.58, 0.66, e));
  vec3 col = mix(uHue * 1.6, vec3(1.6), max(inner * 0.6, uFlush));
  float a = max(uFill + 0.3 * uFlush, max(fres, inner * 0.32)) * uFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const LEASH_SEGMENTS = 16;
const LEASH_VERT = /* glsl */ `
attribute float aSide;
attribute float aAlong;
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
varying float vSide;
varying float vAlong;
void main() {
  vec4 a = modelViewMatrix * vec4(uA, 1.0);
  vec4 b = modelViewMatrix * vec4(uB, 1.0);
  vec2 d = b.xy - a.xy;
  float l = length(d);
  d = l > 1e-7 ? d / l : vec2(1.0, 0.0);
  vec4 p = mix(a, b, aAlong);
  // Tapered ribbon: full width at the arm, a third of it at the ghost.
  p.xy += vec2(-d.y, d.x) * aSide * uWidth * (1.0 - 0.66 * aAlong);
  gl_Position = projectionMatrix * p;
  vSide = aSide;
  vAlong = aAlong;
}
`;
const LEASH_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uBead;
uniform vec3 uHue;
varying float vSide;
varying float vAlong;
void main() {
  if (uAlpha <= 0.0) discard;
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.55, 0.8, x);
  // Three beads travelling arm -> ghost at the servo's closing speed.
  float bead = 0.0;
  for (int i = 0; i < ${LEASH_BEADS}; i++) {
    float c = fract(uBead + float(i) / ${LEASH_BEADS}.0);
    bead = max(bead, 1.0 - smoothstep(0.0, 0.05, abs(vAlong - c)));
  }
  vec3 ink = vec3(0.0044, 0.0048, 0.007);
  vec3 col = mix(ink, mix(uHue * 1.4, vec3(1.8), bead), core);
  float a = (core * (0.55 + 0.45 * bead) + (1.0 - core) * 0.6) * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface GhostRig {
  group: Group; meshes: { link: LinkId; index: number; mesh: Mesh }[]; material: ShaderMaterial; jawMaterial: ShaderMaterial;
  ring: Mesh; ringMaterial: ShaderMaterial; leash: Mesh; leashMaterial: ShaderMaterial; owned: BufferGeometry[];
}

function ghostMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    // Front faces only: a double-sided shell composites its fill twice and turns the projection into a solid.
    vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG, transparent: true, depthWrite: false,
    uniforms: { uHue: { value: new Color(TOKEN_HEX.cobalt) }, uFill: { value: GHOST_FILL_OPACITY }, uFade: { value: 0 }, uFlush: { value: 0 } },
  });
}

function buildGhost(assets: RobotAssets): GhostRig {
  const material = ghostMaterial();
  const jawMaterial = ghostMaterial();
  const group = new Group();
  group.name = "ghost-arm";
  const meshes: GhostRig["meshes"] = [];
  const owned: BufferGeometry[] = [];
  assets.model.links.forEach((l, index) => {
    if (!MATCH_GHOST_LINKS.includes(l.link)) return;
    const g0 = linkGeometry(assets, l.link);
    if (!g0) return;
    const g = g0;   // linkGeometry() already returns the per-link LOD1 merge (robot-assets); no second decimation
    if (g !== g0) owned.push(g);
    const mesh = new Mesh(g, l.link === "moving_jaw" ? jawMaterial : material);
    mesh.renderOrder = 6;
    mesh.layers.set(LOCAL_LAYER);
    mesh.name = `ghost_${l.link}`;
    group.add(mesh);
    meshes.push({ link: l.link, index, mesh });
  });
  // The 3 mm ring at the ghost tip: the reticle's world twin, always drawn while live.
  const ringGeometry = new RingGeometry(GHOST_RING_M * 0.8 * RENDER_SCALE, GHOST_RING_M * 1.2 * RENDER_SCALE, 24);
  owned.push(ringGeometry);
  const ringMaterial = ghostMaterial();          // same GLSL, same program; its own fade (always 1) and fill
  ringMaterial.uniforms.uFade.value = 1;
  ringMaterial.uniforms.uFill.value = 0.9;
  ringMaterial.depthTest = false;
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 7;
  ring.layers.set(LOCAL_LAYER);
  ring.name = "ghost_ring";
  group.add(ring);

  const leashGeometry = new BufferGeometry();
  const n = LEASH_SEGMENTS + 1;
  const side = new Float32Array(n * 2);
  const along = new Float32Array(n * 2);
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    side[i * 2] = -1; side[i * 2 + 1] = 1;
    along[i * 2] = i / LEASH_SEGMENTS; along[i * 2 + 1] = i / LEASH_SEGMENTS;
    if (i < LEASH_SEGMENTS) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  leashGeometry.setAttribute("position", new BufferAttribute(new Float32Array(n * 2 * 3), 3));
  leashGeometry.setAttribute("aSide", new BufferAttribute(side, 1));
  leashGeometry.setAttribute("aAlong", new BufferAttribute(along, 1));
  leashGeometry.setIndex(index);
  owned.push(leashGeometry);
  const leashMaterial = new ShaderMaterial({
    vertexShader: LEASH_VERT, fragmentShader: LEASH_FRAG, transparent: true, depthWrite: false, depthTest: false,
    uniforms: {
      uA: { value: new Vector3() }, uB: { value: new Vector3() }, uWidth: { value: 0.002 * RENDER_SCALE },
      uAlpha: { value: 0 }, uBead: { value: 0 }, uHue: { value: new Color(TOKEN_HEX.cobalt) },
    },
  });
  const leash = new Mesh(leashGeometry, leashMaterial);
  leash.frustumCulled = false;
  leash.renderOrder = 20;
  leash.layers.set(LOCAL_LAYER);
  leash.name = "leash";
  group.add(leash);
  return { group, meshes, material, jawMaterial, ring, ringMaterial, leash, leashMaterial, owned };
}

export interface GhostArmView {
  readonly group: Group;
  onEvents(events: readonly GameEvent[], playerSeat: Seat | null, nowMs: number): void;
  update(rt: StageRuntime, dtS: number): void;
  dispose(): void;
}

export function createGhostArmView(assets: RobotAssets): GhostArmView {
  const rig = buildGhost(assets);
  const poses = createLinkPoses(assets.model);
  const u = rig.material.uniforms;
  const ju = rig.jawMaterial.uniforms;
  const lu = rig.leashMaterial.uniforms;
  const ru = rig.ringMaterial.uniforms;
  const hue = new Color();
  const offset = new Vector3();
  const contact = { atMs: -Infinity, pos: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };
  const jawIndex = assets.model.links.findIndex((l) => l.link === "moving_jaw");
  let flush = 0;
  let bead = 0;
  return {
    group: rig.group,
    onEvents(events, playerSeat, nowMs) {
      for (const e of events) {
        if ((e.type === "strike" && e.attacker === playerSeat && e.tier === "strike") || e.type === "clash") {
          contact.atMs = nowMs;
          contact.pos[0] = e.pos[0]; contact.pos[1] = e.pos[1]; contact.pos[2] = e.pos[2];
          contact.normal[0] = e.normal[0]; contact.normal[1] = e.normal[1]; contact.normal[2] = e.normal[2];
        }
      }
    },
    update(rt, dt) {
      const game = rt.game;
      const director = game.director;
      const hud = game.hud;
      const seat = game.pilot.seat;
      const phase = director.phase;
      const live = hud.playerSeat === seat && director.cameraMode === "cockpit"
        && (phase === "fight" || phase === "sudden_death" || phase === "round_intro");
      const stretch = hud.reticle.leashStretch;
      const want = live ? smoothstep(GHOST_SHOW_STRETCH[0], GHOST_SHOW_STRETCH[1], stretch) : 0;
      u.uFade.value += (want - u.uFade.value) * clamp01(dt * 12);
      rig.group.visible = live;
      if (!live) return;
      const fill = GHOST_FILL_OPACITY * (game.settings.get().camera.ghostOpacity01 / 0.5);
      ghostHue(stretch, hue);
      (u.uHue.value as Color).copy(hue);
      (ju.uHue.value as Color).copy(hue);
      (lu.uHue.value as Color).copy(hue);
      (ru.uHue.value as Color).copy(hue);
      ru.uFlush.value = flush;
      u.uFill.value = fill;
      ju.uFill.value = fill;
      forwardKinematics(assets.model, seat, game.pilot.ghost.joints, poses);
      const q = game.engine.frame.arms[seat].q;
      const jawDiff = jawIndex >= 0 ? Math.abs(game.pilot.ghost.joints[5] - q[5]) : 0;
      // The jaw outline shows on its own when it differs from the physical jaw by more than 4°.
      ju.uFade.value = Math.max(u.uFade.value, jawDiff > JAW_OUTLINE_RAD ? 1 : 0);
      for (const m of rig.meshes) {
        m.mesh.visible = m.link === "moving_jaw" ? ju.uFade.value > 0.01 : u.uFade.value > 0.01;
        if (!m.mesh.visible) continue;
        const i = m.index;
        m.mesh.position.set(poses.pos[i * 3], poses.pos[i * 3 + 1], poses.pos[i * 3 + 2]);
        m.mesh.quaternion.set(poses.quat[i * 4 + 1], poses.quat[i * 4 + 2], poses.quat[i * 4 + 3], poses.quat[i * 4]);
      }
      const r = hud.reticle;
      // Half-space clip while the contact is live (300 ms, held while the arm is still behind its command).
      const age = rt.wallMs() - contact.atMs;
      const clipLive = age < CLIP_LIVE_MS || (age < 4 * CLIP_LIVE_MS && stretch > LEASH_SHOW_STRETCH);
      if (clipLive) clipOffset(seat, r.ghostTipWorld, contact.pos, contact.normal, offset); else offset.set(0, 0, 0);
      const clipped = offset.lengthSq() > 0;
      rig.group.position.copy(offset);
      flush += ((clipped ? 1 : 0) - flush) * clamp01(dt * (clipped ? 40 : 8));
      u.uFlush.value = flush;
      ju.uFlush.value = flush;
      // The 3 mm ring at the ghost tip faces the camera and is always drawn while live.
      rig.ring.position.set(r.ghostTipWorld[0] + offset.x, r.ghostTipWorld[1] + offset.y, r.ghostTipWorld[2] + offset.z);
      const cam = game.view.camera;
      if (cam) rig.ring.quaternion.copy(cam.quaternion);
      rig.ring.visible = true;
      // Leash ribbon from the physical tip to the ghost tip, beads at the servo's closing speed.
      (lu.uA.value as Vector3).set(r.physicalTipWorld[0], r.physicalTipWorld[1], r.physicalTipWorld[2]);
      (lu.uB.value as Vector3).set(r.ghostTipWorld[0] + offset.x, r.ghostTipWorld[1] + offset.y, r.ghostTipWorld[2] + offset.z);
      const len = Math.max(0.01, (lu.uA.value as Vector3).distanceTo(lu.uB.value as Vector3));
      const v = game.engine.frame.arms[seat].eeVel;
      const speed = Math.hypot(v[0], v[1], v[2]);
      bead = (bead + (speed / len) * dt) % 1;
      lu.uBead.value = bead;
      lu.uAlpha.value = smoothstep(LEASH_SHOW_STRETCH, LEASH_SHOW_STRETCH + 0.08, stretch);
      lu.uWidth.value = (0.0008 + 0.0028 * clamp01(stretch)) * RENDER_SCALE;
    },
    dispose() {
      rig.material.dispose(); rig.jawMaterial.dispose(); rig.ringMaterial.dispose(); rig.leashMaterial.dispose();
      for (const g of rig.owned) g.dispose();
    },
  };
}

export function GhostArm(props: { rt: StageRuntime }): JSX.Element | null {
  const { rt } = props;
  const assets = useRobotAssets(rt.game);
  const view = useMemo(() => (assets ? createGhostArmView(assets) : null), [assets]);
  useEffect(() => () => view?.dispose(), [view]);
  useEffect(() => (view ? rt.game.bus.subscribe((events, ctx) => view.onEvents(events, ctx.playerSeat, rt.wallMs())) : undefined), [view, rt]);
  useFrame((_, dt) => view?.update(rt, dt), 0);
  if (!view) return null;
  return <primitive object={view.group} />;
}
