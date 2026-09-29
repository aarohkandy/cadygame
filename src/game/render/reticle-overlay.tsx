// src/game/render/reticle-overlay.tsx (WP3)
// The reticle cluster, drawn in WebGL on top of the post stack in the same frame as the world: the projection
// uses the camera matrices the composer just rendered with, so the bracket centre is the projected ghost tip with
// 0 px error (?debug=feel checks it against three's own projection). Everything is one full-screen quad whose
// fragment shader draws signed-distance shapes in device pixels: slanted aim brackets whose fill is the range
// ring (EMOTION_BIBLE: the range cue lives here, from the pilot's ReticleState: the brackets fill through the
// sweet band and notch solid IN RANGE, no text), the physical tip dot and its tether, the heat arc (hazard
// dashes from 70, Cutout blink), the team charge ring (public pulse, full stamp), hit ticks (strike, crit,
// guarded, graze), the guard close-up, deflect/stun dimming, and the KO collapse to an ink-and-paper X. Every
// stroke has an ink core with a 1 px paper outline.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, type Camera, type WebGLRenderer } from "three";
import { TOKEN_HEX, type GameEvent, type ReticleState, type Seat } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { createScreenPoint, projectSimToScreen } from "./camera-math.ts";
import { clamp01 } from "./interpolate.ts";
import { teamHex } from "./robot-materials.ts";
import { linearColor } from "./vfx/sparks.ts";

/** Pixel error between the bracket centre and three's projection of the ghost tip (?debug=feel). */
export const reticleDebug = { errorPx: 0, maxErrorPx: 0, samples: 0 };

/** Whole-reticle size multiplier. At 1 the brackets were ~9 px tall at 720p and vanished on the bright deck. */
export const RETICLE_SIZE = 1.5;
export const BRACKET_GAP_PX = 26;
export const BRACKET_GUARD_GAP_PX = 14;
const NO_RETICLE: ReticleState = { fill: 0, inRange: false, magnetism: 0 };

const HIT_KIND = { strike: 0, crit: 1, guarded: 2, graze: 3 } as const;
const HIT_LIFE_MS = [180, 260, 220, 150];

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform vec2 uBracket;      // device px, origin bottom-left
uniform vec2 uTip;
uniform float uScale;       // device px per reference px
uniform float uVisible;
uniform float uGap;
uniform float uDim;
uniform float uRangeFill;
uniform float uNotch;       // 0 none, 1 hollow (jab), 2 solid (flick)
uniform float uHeat;        // 0..1
uniform float uHeatVis;
uniform float uHazard;
uniform float uCutoutBlink;
uniform float uCharge;
uniform float uChargeVis;
uniform float uChargePulse;
uniform float uChargeFull;
uniform vec3 uTeam;
uniform vec4 uHit;          // kind, magnitude, age01, active
uniform float uKo;          // 0..1 KO X blend
uniform float uTipVis;
const vec3 INK = vec3(0.0044, 0.0048, 0.007);
const vec3 PAPER = vec3(0.913, 0.896, 0.831);
const vec3 HIT = vec3(1.0);
const vec3 INK500 = vec3(0.041, 0.048, 0.072);
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// Composite a stroke: ink core of half-width w, 1 px paper outline (or swapped).
void stroke(inout vec4 acc, float d, float w, vec3 core, vec3 outline, float alpha) {
  float s = uScale;
  float cCore = 1.0 - smoothstep(w * s - 0.5, w * s + 0.5, d);
  float cOut = 1.0 - smoothstep((w + 1.0) * s - 0.5, (w + 1.0) * s + 0.5, d);
  vec3 col = mix(outline, core, cCore);
  float a = cOut * alpha;
  acc.rgb = mix(acc.rgb, col, a);
  acc.a = max(acc.a, a);
}
void main() {
  if (uVisible <= 0.0) discard;
  vec4 acc = vec4(0.0);
  vec2 p = gl_FragCoord.xy;
  float s = uScale;
  vec2 c = uBracket;
  float slant = 0.21256;   // tan 12°
  // Aim brackets or the KO X.
  if (uKo < 1.0) {
    float gap = uGap * s * (1.0 - uKo);
    float h = 9.0 * s;
    float foot = 6.0 * s;
    vec2 q = p - c;
    float dL = 1e9, dR = 1e9;
    // left bracket "[" slanted: x shifts with y
    vec2 lt = vec2(-gap * 0.5 + h * slant, h), lb = vec2(-gap * 0.5 - h * slant, -h);
    dL = min(sdSeg(q, lt, lb), min(sdSeg(q, lt, lt + vec2(foot, 0.0)), sdSeg(q, lb, lb + vec2(foot, 0.0))));
    vec2 rt = vec2(gap * 0.5 + h * slant, h), rb = vec2(gap * 0.5 - h * slant, -h);
    dR = min(sdSeg(q, rt, rb), min(sdSeg(q, rt, rt - vec2(foot, 0.0)), sdSeg(q, rb, rb - vec2(foot, 0.0))));
    vec3 core = mix(INK, PAPER, uRangeFill);
    vec3 outl = mix(PAPER, INK, uRangeFill);
    stroke(acc, min(dL, dR), 1.5, core, outl, uDim * (1.0 - uKo));
    if (uNotch > 0.5) {
      vec2 n0 = vec2(0.0, -h - 4.0 * s);
      float tri = max(abs(q.x - n0.x) * 1.2 + (q.y - n0.y), -(q.y - n0.y) - 6.0 * s);
      float triD = max(tri, 0.0);
      if (uNotch > 1.5) stroke(acc, triD, 0.0, PAPER, INK, uDim);
      else stroke(acc, abs(tri), 0.5, INK, PAPER, uDim);
    }
  }
  if (uKo > 0.0) {
    vec2 q = p - c;
    float arm = 7.0 * s * uKo;
    float d = min(sdSeg(q, vec2(-arm), vec2(arm)), sdSeg(q, vec2(-arm, arm), vec2(arm, -arm)));
    stroke(acc, d, 1.5, INK, PAPER, uKo);
  }
  // Physical tip dot and tether.
  if (uTipVis > 0.0 && uKo < 1.0) {
    float sep = length(uTip - c);
    if (sep > 12.0 * s) {
      // A real ink-and-paper stroke, not a hairline: when the arm lags or is blocked the tether is what
      // tells the pilot where the gripper actually is, and on the bright deck a pale hairline vanished.
      stroke(acc, sdSeg(p, c, uTip), 0.75, INK, PAPER, 0.85 * smoothstep(12.0 * s, 24.0 * s, sep));
    }
    float dd = length(p - uTip);
    float dotF = 1.0 - smoothstep(2.5 * s - 0.5, 2.5 * s + 0.5, dd);
    float ring = 1.0 - smoothstep(3.5 * s - 0.5, 3.5 * s + 0.5, dd);
    acc.rgb = mix(acc.rgb, mix(INK, PAPER, dotF), ring * uTipVis);
    acc.a = max(acc.a, ring * uTipVis);
  }
  vec2 q = p - c;
  float r = length(q);
  float ang = atan(q.x, -q.y);        // 0 at the bottom, ±π at the top
  // Charge ring (priority ring): radius 28, 4 px, team colour.
  if (uChargeVis > 0.0) {
    float w = uChargeFull > 0.5 ? 3.0 : 2.0;
    float d = abs(r - 28.0 * s);
    float frac = (ang + 3.14159265) / 6.2831853;
    float filled = step(frac, uCharge);
    float track = 1.0 - smoothstep(w * s - 0.5, w * s + 0.5, d);
    float outl = 1.0 - smoothstep((w + 1.0) * s - 0.5, (w + 1.0) * s + 0.5, d);
    vec3 col = mix(INK, uTeam * (1.0 + uChargePulse), filled);
    float a = max(track * mix(0.35, 1.0, filled), (outl - track) * 0.9) * uChargeVis;
    acc.rgb = mix(acc.rgb, mix(PAPER, col, track), a);
    acc.a = max(acc.a, a);
  }
  // Heat arc: radius 36, 2 px, 220° opening at the bottom.
  if (uHeatVis > 0.0) {
    float hArc = radians(110.0);
    float fromTop = abs(atan(q.x, q.y));          // 0 at top
    float inArc = step(fromTop, hArc);
    float t = (atan(q.x, q.y) + hArc) / (2.0 * hArc);   // left end 0 → right end 1
    float d = abs(r - 36.0 * s);
    float filled = step(t, uHeat);
    float dashes = mix(1.0, step(0.5, fract(t * 22.0)), uHazard);
    vec3 col = mix(INK, mix(PAPER, INK, 1.0 - dashes), filled);
    float track = (1.0 - smoothstep(1.0 * s - 0.5, 1.0 * s + 0.5, d)) * inArc;
    float outl = (1.0 - smoothstep(2.0 * s - 0.5, 2.0 * s + 0.5, d)) * inArc;
    float a = max(track * mix(0.3, 1.0, filled), (outl - track) * 0.8 * filled) * uHeatVis * uCutoutBlink;
    acc.rgb = mix(acc.rgb, mix(PAPER, col, track), a);
    acc.a = max(acc.a, a);
  }
  // Hit ticks.
  if (uHit.w > 0.0) {
    int kind = int(uHit.x + 0.5);
    float m = uHit.y;
    float k = uHit.z;
    float pop = 1.0 + 0.4 * (1.0 - smoothstep(0.0, 0.3, k));
    float fade = 1.0 - smoothstep(0.6, 1.0, k);
    float len = (kind == 1 ? 28.0 : kind == 2 ? 6.0 : kind == 3 ? 5.0 : 8.0 + 8.0 * m) * s * pop;
    float r0 = (kind == 3 ? 10.0 : 14.0) * s;
    float d = 1e9;
    for (int i = 0; i < 4; i++) {
      if (kind == 3 && (i == 1 || i == 3)) continue;
      float a = 0.7853982 + float(i) * 1.5707963;
      vec2 dir = vec2(cos(a), sin(a));
      d = min(d, sdSeg(q, dir * r0, dir * (r0 + len)));
    }
    if (kind == 1) {
      for (int i = 0; i < 4; i++) {
        float a = float(i) * 1.5707963;
        vec2 dir = vec2(cos(a), sin(a));
        d = min(d, sdSeg(q, dir * (r0 + 12.0 * s), dir * (r0 + 20.0 * s)));
      }
    }
    vec3 core = kind == 2 ? INK500 : kind == 3 ? vec3(0.35) : HIT;
    vec3 outl = kind == 2 ? PAPER : INK;
    stroke(acc, d, kind == 3 ? 1.0 : 1.5, core, outl, fade);
  }
  if (acc.a < 0.003) discard;
  gl_FragColor = vec4(acc.rgb, acc.a * uVisible);
}
`;

export interface ReticleView {
  readonly scene: Scene;
  /** The overlay's own orthographic camera; arena-canvas hands (scene, camera) to the prewarm so the ring's program links at boot. */
  readonly camera: Camera;
  onEvents(rt: StageRuntime, events: readonly GameEvent[], playerSeat: Seat | null): void;
  /** Projects, updates uniforms, and draws the overlay on top of the composited frame. */
  render(rt: StageRuntime, gl: WebGLRenderer, camera: Camera, widthPx: number, heightPx: number): void;
  dispose(): void;
}

export function createReticleView(): ReticleView {
  const scene = new Scene();
  const ortho = new OrthographicCamera(0, 1, 1, 0, -10, 10);
  const geometry = new PlaneGeometry(1, 1);
  const hitArr = new Float32Array(4);
  const uniforms = {
    uBracket: { value: new Vector2() }, uTip: { value: new Vector2() }, uScale: { value: 1 }, uVisible: { value: 0 },
    uGap: { value: BRACKET_GAP_PX }, uDim: { value: 1 }, uRangeFill: { value: 0 }, uNotch: { value: 0 },
    uHeat: { value: 0 }, uHeatVis: { value: 0 }, uHazard: { value: 0 }, uCutoutBlink: { value: 1 },
    uCharge: { value: 0 }, uChargeVis: { value: 0 }, uChargePulse: { value: 0 }, uChargeFull: { value: 0 },
    uTeam: { value: new Color(TOKEN_HEX.cobalt) }, uHit: { value: hitArr }, uKo: { value: 0 }, uTipVis: { value: 1 },
  };
  // toneMapped false: the overlay writes final colours, and three keys a tone-mapped program on the render target, so the
  // boot prewarm (scratch target) and the live draw (canvas) must not want two variants (10.2: zero compiles after prewarm).
  const material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const sp = createScreenPoint(), tp = createScreenPoint(), v3 = new Vector3();
  const hit = { atMs: -1, kind: 0, magnitude: 0 };
  let koAt = -1;
  const u = uniforms;
  return {
    scene,
    camera: ortho,
    onEvents(rt, events, player) {
      const now = rt.wallMs();
      for (const e of events) {
        if (e.type === "strike" && player !== null && e.attacker === player) {
          hit.atMs = now;
          hit.kind = e.tier === "graze" ? HIT_KIND.graze : e.guarded ? HIT_KIND.guarded : e.crit ? HIT_KIND.crit : HIT_KIND.strike;
          hit.magnitude = e.magnitude;
        } else if (e.type === "ko") {
          koAt = now;
        } else if (e.type === "phase" && (e.phase === "round_intro" || e.phase === "green_room" || e.phase === "title")) {
          koAt = -1;
        }
      }
    },
    render(rt, gl, camera, W, H) {
      const game = rt.game;
      const hud = game.hud;
      const r = hud.reticle;
      const visible = r.visible && game.director.cameraMode === "cockpit" && hud.playerSeat !== null;
      u.uVisible.value += ((visible ? 1 : 0) - u.uVisible.value) * 0.35;
      if (u.uVisible.value < 0.01 && !visible) {
        u.uVisible.value = 0;
        return;
      }
      const dpr = gl.getPixelRatio();
      camera.updateMatrixWorld();
      const view = camera.matrixWorldInverse.elements;
      const proj = camera.projectionMatrix.elements;
      projectSimToScreen(r.ghostTipWorld, view, proj, W, H, sp);
      projectSimToScreen(r.physicalTipWorld, view, proj, W, H, tp);
      // Same-frame check against three's own projection.
      v3.set(r.ghostTipWorld[0] * 2.05, r.ghostTipWorld[2] * 2.05, -r.ghostTipWorld[1] * 2.05).project(camera);
      const ex = (v3.x * 0.5 + 0.5) * W - sp.x;
      const ey = (1 - (v3.y * 0.5 + 0.5)) * H - sp.y;
      reticleDebug.errorPx = Math.hypot(ex, ey);
      reticleDebug.maxErrorPx = Math.max(reticleDebug.maxErrorPx, reticleDebug.errorPx);
      reticleDebug.samples++;

      const scale = dpr * RETICLE_SIZE * Math.min(1.6, Math.max(0.75, H / 1080));
      u.uScale.value = scale;
      u.uBracket.value.set(sp.x * dpr, (H - sp.y) * dpr);
      u.uTip.value.set(tp.x * dpr, (H - tp.y) * dpr);
      u.uTipVis.value = tp.visible ? 1 : 0;
      const now = rt.wallMs();
      const seat = hud.playerSeat ?? "atlas";
      const hs = hud.seats[seat];
      u.uGap.value += ((r.guard ? BRACKET_GUARD_GAP_PX : BRACKET_GAP_PX) - u.uGap.value) * 0.45;
      u.uDim.value = r.deflectLocked || hs.servoState === "stun" ? 0.5 : 1;
      // Range ring (ReticleState from the pilot): the bracket fill rises through the sweet band, solid IN RANGE.
      const rs = "reticle" in game.pilot ? (game.pilot as { reticle: ReticleState }).reticle : NO_RETICLE;
      u.uRangeFill.value = rs.inRange ? 1 : 0.85 * rs.fill;
      u.uNotch.value = rs.inRange ? 2 : r.rangeCue.jab ? 1 : 0;
      // Rings: the charge ring has priority; the heat arc shows from 40 heat (at most two rings).
      u.uChargeVis.value = hs.charging || hs.charge > 0.001 ? 1 : 0;
      u.uCharge.value = hs.charge;
      u.uChargeFull.value = hs.charge >= 1 ? 1 : 0;
      u.uChargePulse.value = hs.charge >= 0.25 && hs.charge < 1 ? 0.35 + 0.35 * Math.sin((now / 1000) * Math.PI * 8) : hs.charge >= 1 ? 0.8 : 0;
      u.uTeam.value.copy(linearColor(teamHex(seat, rt.colorblind())));
      u.uHeatVis.value = hud.preset === "arcade" && hs.heat >= 40 ? 1 : 0;
      u.uHeat.value = clamp01(hs.heat / 100);
      u.uHazard.value = hs.heat >= 70 || hs.servoState === "cutout" ? 1 : 0;
      u.uCutoutBlink.value = hs.servoState === "cutout" ? (Math.floor(now / 125) % 2 === 0 ? 1 : 0.25) : 1;
      // Hit ticks.
      if (hit.atMs >= 0) {
        const age = (now - hit.atMs) / HIT_LIFE_MS[hit.kind];
        if (age >= 1) { hit.atMs = -1; hitArr[3] = 0; }
        else { hitArr[0] = hit.kind; hitArr[1] = hit.magnitude; hitArr[2] = age; hitArr[3] = 1; }
      } else hitArr[3] = 0;
      u.uKo.value = koAt >= 0 ? clamp01((now - koAt) / 90) : 0;

      // Draw on top of the composited frame.
      ortho.left = 0; ortho.right = W; ortho.top = H; ortho.bottom = 0;
      ortho.updateProjectionMatrix();
      const autoClear = gl.autoClear;
      gl.autoClear = false;
      gl.setRenderTarget(null);
      gl.render(scene, ortho);
      gl.autoClear = autoClear;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export function ReticleOverlay(props: { rt: StageRuntime }): null {
  const { rt } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const view = useMemo(() => createReticleView(), []);
  useEffect(() => () => view.dispose(), [view]);
  // The overlay draws in its own scene, so the boot prewarm only sees it through this registration (10.2: zero compiles after prewarm).
  useEffect(() => {
    const entry = { scene: view.scene, camera: view.camera };
    rt.prewarmExtra.push(entry);
    return () => { const i = rt.prewarmExtra.indexOf(entry); if (i >= 0) rt.prewarmExtra.splice(i, 1); };
  }, [rt, view]);
  useEffect(() => rt.game.bus.subscribe((events, ctx) => view.onEvents(rt, events, ctx.playerSeat)), [rt, view]);
  useFrame(() => view.render(rt, gl, camera, size.width, size.height), 1.5);
  return null;
}
