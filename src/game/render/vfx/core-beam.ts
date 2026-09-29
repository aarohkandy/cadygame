// src/game/render/vfx/core-beam.ts
// The Core's arrival (GAME_DESIGN 8.1 `core` incoming / drop): a column of volt light from above frame down to
// the drop point, and a target ring on the deck under it. It replaces the render-only hopper as the telegraph:
//   incoming   a thin column fades in over 400 ms; bright bands stream DOWN it and the deck ring pulses faster
//              as the drop nears (2 Hz → 5 Hz over the 3 s count)
//   drop       the column flares wide and pale for 60 ms, then collapses to nothing over 700 ms while the
//              Core falls through it under physics
// The landing shockwave is fired by the VFX system when the physical Core first touches the mat.
// The column exists only ABOVE the pilot's sightline: it fades to nothing below BEAM_FLOOR_M, so it can never
// stand between the cockpit eye (ego z 0.36 m) and the opponent. Low down, the deck ring and the HUD Core marker
// carry the telegraph. Both draws use normal alpha blending at display brightness: on the high-key arena an
// additive HDR column blooms to a white slab (playtest: it hid the whole fight during DROP).
// Two draws (column, ring), no allocation after construction. The envelope is a pure function of wall time so
// tests can step it.
import { CylinderGeometry, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import {
  type Prewarmable, TOKEN_HEX } from "../../contracts.ts";
import { linearColor } from "./sparks.ts";

export const BEAM_FADE_IN_MS = 400;
export const BEAM_INCOMING_MS = 3000;
/** The incoming column never outlives this, even if the drop never comes (round ended mid-count). */
export const BEAM_INCOMING_MAX_MS = BEAM_INCOMING_MS + 1500;
export const BEAM_FLARE_HOLD_MS = 60;
export const BEAM_FLARE_MS = 700;
export const BEAM_HEIGHT_M = 1.4;
/** The column is fully transparent below this height and full strength from BEAM_FLOOR_M + 0.25 m up. */
export const BEAM_FLOOR_M = 0.55;
export const BEAM_RADIUS_IDLE_M = 0.014;
export const BEAM_RADIUS_FLARE_M = 0.05;
const INCOMING_ALPHA = 0.4;

export interface BeamEnvelope { alpha: number; radius: number; ring: number; ringHz: number; flare: number; }

/**
 * Beam state at wall time `nowMs` given the last incoming and drop stamps (−1 = none). The newer stamp wins, so a
 * sudden-death incoming after an earlier drop starts a fresh telegraph.
 */
export function coreBeamEnvelope(nowMs: number, incomingAtMs: number, dropAtMs: number, out: BeamEnvelope): BeamEnvelope {
  out.alpha = 0; out.radius = BEAM_RADIUS_IDLE_M; out.ring = 0; out.ringHz = 2; out.flare = 0;
  if (dropAtMs >= 0 && dropAtMs >= incomingAtMs) {
    const t = nowMs - dropAtMs;
    if (t < 0 || t >= BEAM_FLARE_MS) return out;
    const k = t / BEAM_FLARE_MS;
    const decay = t < BEAM_FLARE_HOLD_MS ? 1 : (1 - k) * (1 - k);
    out.alpha = decay;
    out.flare = decay;
    // Wide on the flash, then the column pinches shut as it fades.
    out.radius = BEAM_RADIUS_FLARE_M * (t < BEAM_FLARE_HOLD_MS ? 1 : 1 - 0.8 * Math.sqrt(k));
    out.ring = decay;
    out.ringHz = 0;
    return out;
  }
  if (incomingAtMs >= 0) {
    const t = nowMs - incomingAtMs;
    if (t < 0 || t >= BEAM_INCOMING_MAX_MS) return out;
    const fadeIn = Math.min(1, t / BEAM_FADE_IN_MS);
    const fadeOut = t > BEAM_INCOMING_MS ? 1 - (t - BEAM_INCOMING_MS) / (BEAM_INCOMING_MAX_MS - BEAM_INCOMING_MS) : 1;
    const urgency = Math.min(1, t / BEAM_INCOMING_MS);
    out.alpha = INCOMING_ALPHA * fadeIn * fadeOut * (0.75 + 0.25 * urgency);
    out.ringHz = 2 + 3 * urgency;
    out.ring = fadeIn * fadeOut * (0.5 + 0.5 * urgency);
  }
  return out;
}

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const COLUMN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFlare;
uniform float uTime;
uniform float uFloor;
varying vec2 vUv;
varying float vFacing;
void main() {
  // uv.y: 0 at the deck, 1 at the top (uFloor is the sightline cutoff in uv). Fades in above the cutoff and
  // thins out toward the top.
  float fall = smoothstep(uFloor, uFloor + 0.18, vUv.y) * (1.0 - 0.6 * vUv.y);
  float bands = 0.65 + 0.35 * smoothstep(0.55, 0.95, fract(vUv.y * 9.0 + uTime * 2.6));
  float core = pow(vFacing, 1.6);
  float a = uAlpha * fall * mix(bands, 1.0, uFlare) * core;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), uFlare * 0.5), min(a, 0.85));
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = 1.0 - smoothstep(0.035, 0.07, abs(r - 0.78));
  float inner = (1.0 - smoothstep(0.0, 0.5, r)) * 0.35;
  float a = uAlpha * (ring * (0.55 + 0.45 * uPulse) + inner);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, min(a, 0.9));
}
`;
const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export interface CoreBeam extends Prewarmable {
  readonly column: Mesh;
  readonly ring: Mesh;
  readonly envelope: BeamEnvelope;
  /** Per frame: wall time, the cue stamps, and the sim XY of the drop point. */
  update(nowMs: number, incomingAtMs: number, dropAtMs: number, x: number, y: number): void;
  dispose(): void;
}

const RING_RADIUS_M = 0.05;

export function createCoreBeam(): CoreBeam {
  const colGeo = new CylinderGeometry(1, 1, 1, 24, 1, true);
  colGeo.rotateX(Math.PI / 2);          // axis along sim +z; uv.y still runs bottom → top
  colGeo.translate(0, 0, 0.5);          // base on the deck
  const colMat = new ShaderMaterial({
    vertexShader: COLUMN_VERT, fragmentShader: COLUMN_FRAG, transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: {
      uColor: { value: linearColor(TOKEN_HEX.volt).clone() }, uAlpha: { value: 0 }, uFlare: { value: 0 }, uTime: { value: 0 },
      uFloor: { value: BEAM_FLOOR_M / BEAM_HEIGHT_M },
    },
  });
  const column = new Mesh(colGeo, colMat);
  column.name = "core-beam";
  column.frustumCulled = false;
  column.visible = false;
  column.renderOrder = 13;

  const ringGeo = new PlaneGeometry(RING_RADIUS_M * 2, RING_RADIUS_M * 2);
  const ringMat = new ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: linearColor(TOKEN_HEX.volt).clone() }, uAlpha: { value: 0 }, uPulse: { value: 0 } },
  });
  const ring = new Mesh(ringGeo, ringMat);
  ring.name = "core-beam-ring";
  ring.frustumCulled = false;
  ring.visible = false;
  ring.renderOrder = 12;

  const envelope: BeamEnvelope = { alpha: 0, radius: BEAM_RADIUS_IDLE_M, ring: 0, ringHz: 2, flare: 0 };
  let pulsePhase = 0;
  let lastMs = -1;

  const self: CoreBeam = {
    column, ring, envelope,
    update(nowMs, incomingAtMs, dropAtMs, x, y) {
      coreBeamEnvelope(nowMs, incomingAtMs, dropAtMs, envelope);
      const dt = lastMs < 0 ? 0 : Math.max(0, Math.min(0.1, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      pulsePhase = (pulsePhase + dt * envelope.ringHz) % 1;
      column.visible = envelope.alpha > 0.002;
      ring.visible = envelope.ring > 0.002;
      if (column.visible) {
        column.position.set(x, y, 0);
        column.scale.set(envelope.radius, envelope.radius, BEAM_HEIGHT_M);
        colMat.uniforms.uAlpha.value = envelope.alpha;
        colMat.uniforms.uFlare.value = envelope.flare;
        colMat.uniforms.uTime.value = nowMs / 1000;
      }
      if (ring.visible) {
        ring.position.set(x, y, 0.0015);
        const s = 1 + 0.6 * envelope.flare;
        ring.scale.set(s, s, 1);
        ringMat.uniforms.uAlpha.value = envelope.ring;
        ringMat.uniforms.uPulse.value = envelope.ringHz > 0 ? 0.5 + 0.5 * Math.cos(pulsePhase * Math.PI * 2) : 1;
      }
    },
    dispose() { colGeo.dispose(); colMat.dispose(); ringGeo.dispose(); ringMat.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { column.visible = true; ring.visible = true; colMat.uniforms.uAlpha.value = 0.01; ringMat.uniforms.uAlpha.value = 0.01; },
  };
  return self;
}
