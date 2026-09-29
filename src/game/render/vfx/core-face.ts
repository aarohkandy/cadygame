// src/game/render/vfx/core-face.ts (WP5)
// The Core's countdown face (EMOTION_BIBLE 6, grab / dock row): once the Core is owned, its top face carries the
// lock-in seconds as a seven-segment digit in volt, riding the physical cube's pose so it turns with the cube. It
// pulses in step with the dock ticks (1 Hz, 2 Hz under 3 s, 4 Hz under 1 s), turns hazard-white while contested
// and dims while the Core is loose after a steal. One quad, one boot-time program, drawn nowhere else.
import { DoubleSide, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from "three";
import { CORE_CUBE_INDEX, TOKEN_HEX, type CombatSnapshot, type PhysicsFrame, type Prewarmable } from "../../contracts.ts";
import { lockTickInterval } from "./lock-pulse.ts";
import { linearColor } from "./sparks.ts";

/** Matches cubes-view's CUBE_SIZE_M without importing WP2's file. */
const CUBE_HALF_M = 0.02;
const FACE_LIFT_M = 0.0006;
const FACE_SIZE_M = 0.03;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Segments (a..g) in the classic order; bit i of uMask lights segment i.
const FRAG = /* glsl */ `
uniform float uMask;
uniform float uPulse;
uniform vec3 uColor;
varying vec2 vUv;
float seg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(w * 0.6, w, length(pa - ba * h));
}
float on(float bit) { return step(0.5, mod(floor(uMask / pow(2.0, bit)), 2.0)); }
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.0);
  float w = 0.075;
  float x0 = -0.17, x1 = 0.17, y0 = -0.32, y1 = 0.0, y2 = 0.32;
  float d = 0.0;
  d = max(d, on(0.0) * seg(p, vec2(x0, y2), vec2(x1, y2), w));   // a top
  d = max(d, on(1.0) * seg(p, vec2(x1, y2), vec2(x1, y1), w));   // b top-right
  d = max(d, on(2.0) * seg(p, vec2(x1, y1), vec2(x1, y0), w));   // c bottom-right
  d = max(d, on(3.0) * seg(p, vec2(x0, y0), vec2(x1, y0), w));   // d bottom
  d = max(d, on(4.0) * seg(p, vec2(x0, y1), vec2(x0, y0), w));   // e bottom-left
  d = max(d, on(5.0) * seg(p, vec2(x0, y2), vec2(x0, y1), w));   // f top-left
  d = max(d, on(6.0) * seg(p, vec2(x0, y1), vec2(x1, y1), w));   // g middle
  float glow = d * 0.5 + smoothstep(0.0, 1.0, d) * 0.5;
  if (glow < 0.02) discard;
  gl_FragColor = vec4(uColor * (1.4 + 1.2 * uPulse), glow);
}
`;

/** Seven-segment masks for 0–9 (bits a..g). */
export const SEVEN_SEGMENT: readonly number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** The digit shown for a countdown: whole seconds remaining, ceilinged, 9 at most (lock-ins are 8 / 6 / 4 s). */
export function countdownDigit(remainingS: number): number {
  const n = Math.ceil(remainingS - 1e-6);
  return n <= 0 ? 0 : n > 9 ? 9 : n;
}

export interface CoreFace extends Prewarmable {
  readonly mesh: Mesh;
  /** Per render frame: follows the Core, shows its countdown, hides when nothing is owned. */
  update(nowS: number, frame: PhysicsFrame, combat: CombatSnapshot | null, colorblind: boolean): void;
  dispose(): void;
}

export function createCoreFace(): CoreFace {
  const geometry = new PlaneGeometry(FACE_SIZE_M, FACE_SIZE_M);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uMask: { value: 0 }, uPulse: { value: 0 }, uColor: { value: linearColor(TOKEN_HEX.volt).clone() } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "core-face";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;
  const q = new Quaternion(), up = new Vector3();
  const self: CoreFace = {
    mesh,
    update(nowS, frame, combat, colorblind) {
      void colorblind;
      const core = combat?.core ?? null;
      const show = core !== null && core.phase === "live" && core.owner !== null;
      mesh.visible = show;
      if (!show || !core) return;
      const i3 = CORE_CUBE_INDEX * 3, i4 = CORE_CUBE_INDEX * 4;
      const qa = frame.cubes.quat;
      q.set(qa[i4 + 1], qa[i4 + 2], qa[i4 + 3], qa[i4]);
      up.set(0, 0, CUBE_HALF_M + FACE_LIFT_M).applyQuaternion(q);
      mesh.position.set(frame.cubes.pos[i3] + up.x, frame.cubes.pos[i3 + 1] + up.y, frame.cubes.pos[i3 + 2] + up.z);
      mesh.quaternion.copy(q);
      const rem = core.lockInRemainingS;
      material.uniforms.uMask.value = SEVEN_SEGMENT[countdownDigit(rem)];
      const running = core.dockedIn === core.owner && !core.loose;
      const hz = 1 / lockTickInterval(rem);
      material.uniforms.uPulse.value = running ? 0.5 + 0.5 * Math.cos(nowS * hz * Math.PI * 2) : 0;
      const c = material.uniforms.uColor.value;
      if (core.contested) c.setRGB(1, 1, 1);
      else c.copy(linearColor(TOKEN_HEX.volt)).multiplyScalar(core.loose ? 0.35 : 1);
    },
    prewarmDraw() { mesh.visible = true; material.uniforms.uMask.value = SEVEN_SEGMENT[8]; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
  return self;
}
