// src/game/render/vfx/lock-pulse.ts (WP5)
// Dock rings (6.8, 8.4): each lock-in tick sends a prize ring expanding 0 → 2 cm out from the dock ring
// (ticks at 1 Hz, 2 Hz under 3 s, 4 Hz under 1 s, matching the audio tick loop); CONTESTED dashes the ring
// edge with hazard stripes; LOCK fills the dock solid prize. Owned rings tint to the owner's team colour.
// One flat quad per dock, one draw.
import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, Vector3, Quaternion,
} from "three";
import {
  type Prewarmable, DOCK_RADIUS, TOKEN_HEX, type CombatSnapshot, type PhysicsFrame } from "../../contracts.ts";
import { teamHex } from "../robot-materials.ts";
import { linearColor } from "./sparks.ts";

export const PULSE_LIFE_S = 0.3;
export const PULSE_GROW_M = 0.02;
const QUAD_HALF = DOCK_RADIUS + PULSE_GROW_M + 0.012;

const VERT = /* glsl */ `
attribute vec4 aDock;    // pulse birth (s), fill 0..1, contested 0/1, owned 0/1
attribute vec3 aTint;
varying vec2 vUv;
varying vec4 vDock;
varying vec3 vTint;
void main() {
  vUv = uv;
  vDock = aDock;
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDockR;
uniform float uHalf;
varying vec2 vUv;
varying vec4 vDock;
varying vec3 vTint;
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * uHalf;
  float r = length(p);
  vec3 prize = vTint;
  float a = 0.0;
  vec3 col = prize;
  // Pulse ring
  float age = uTime - vDock.x;
  if (age >= 0.0 && age < ${PULSE_LIFE_S.toFixed(2)}) {
    float k = age / ${PULSE_LIFE_S.toFixed(2)};
    float rr = uDockR + ${PULSE_GROW_M.toFixed(3)} * (1.0 - pow(1.0 - k, 2.0));
    float ring = 1.0 - smoothstep(0.0015, 0.0035, abs(r - rr));
    a = max(a, ring * (1.0 - k));
  }
  // Lock fill
  if (vDock.y > 0.0) {
    float fill = 1.0 - smoothstep(uDockR - 0.002, uDockR, r);
    a = max(a, fill * vDock.y * 0.92);
  }
  // Contested hazard dashes on the ring edge
  if (vDock.z > 0.5) {
    float edge = 1.0 - smoothstep(0.004, 0.006, abs(r - uDockR - 0.004));
    float ang = atan(p.y, p.x);
    float dash = step(0.5, fract(ang * 6.0 / 3.14159265 + uTime * 1.5));
    float pulse = 0.65 + 0.35 * sin(uTime * 12.57);
    if (edge * pulse > a) { a = edge * pulse; col = mix(vec3(0.0044, 0.0048, 0.007), vec3(0.92, 0.9, 0.84), dash); }
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * (vDock.y > 0.0 ? 1.6 : 2.2), a);
}
`;

export interface LockPulse extends Prewarmable {
  readonly mesh: InstancedMesh;
  /** Reads the Core each frame; `nowS` is VFX time. */
  update(nowS: number, frame: PhysicsFrame, combat: CombatSnapshot | null, colorblind: boolean): void;
  /** Lock event: fill the owner's dock. */
  lock(seatIndex: 0 | 1, nowS: number): void;
  clear(): void;
  dispose(): void;
  readonly pulses: number;
}

export function lockTickInterval(remainingS: number): number {
  return remainingS < 1 ? 0.25 : remainingS < 3 ? 0.5 : 1;
}

export function createLockPulse(): LockPulse {
  const geometry = new PlaneGeometry(QUAD_HALF * 2, QUAD_HALF * 2);
  const aDock = new InstancedBufferAttribute(new Float32Array([-10, 0, 0, 0, -10, 0, 0, 0]), 4);
  const aTint = new InstancedBufferAttribute(new Float32Array(6), 3);
  aDock.setUsage(DynamicDrawUsage);
  aTint.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aDock", aDock);
  geometry.setAttribute("aTint", aTint);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uTime: { value: 0 }, uDockR: { value: DOCK_RADIUS }, uHalf: { value: QUAD_HALF } },
  });
  const mesh = new InstancedMesh(geometry, material, 2);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = "lock-pulse";
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), one = new Vector3(1, 1, 1);
  const prize = new Color(TOKEN_HEX.volt);
  const tint = new Color();
  const lastTickRemaining = new Float64Array([Infinity, Infinity]);
  const fill = new Float32Array(2);
  let pulses = 0;
  let placedX = Number.NaN;
  const self: LockPulse = {
    mesh,
    get pulses() { return pulses; },
    update(nowS, frame, combat, colorblind) {
      material.uniforms.uTime.value = nowS % 10000;
      if (frame.docks[0] !== placedX) {
        for (let i = 0; i < 2; i++) {
          mesh.setMatrixAt(i, m.compose(p.set(frame.docks[i * 3], frame.docks[i * 3 + 1], 0.0016), q, one));
        }
        mesh.instanceMatrix.needsUpdate = true;
        placedX = frame.docks[0];
      }
      const core = combat?.core ?? null;
      mesh.visible = core !== null && core.phase === "live";      // dock rings only while a Core is in play (5.2)
      for (let i = 0; i < 2; i++) {
        const seat = i === 0 ? "atlas" : "blaze";
        const owned = core !== null && core.phase === "live" && core.dockedIn === seat && core.owner === seat && !core.loose;
        if (owned && core) {
          const rem = core.lockInRemainingS;
          const interval = lockTickInterval(rem);
          if (lastTickRemaining[i] === Infinity || lastTickRemaining[i] - rem >= interval) {
            lastTickRemaining[i] = rem;
            aDock.array[i * 4] = nowS % 10000;
            pulses++;
          }
        } else {
          lastTickRemaining[i] = Infinity;
        }
        aDock.array[i * 4 + 2] = core?.contested && core.dockedIn === seat ? 1 : 0;
        aDock.array[i * 4 + 3] = owned ? 1 : 0;
        aDock.array[i * 4 + 1] = fill[i];
        if (owned) tint.copy(linearColor(teamHex(seat, colorblind))).lerp(prize, 0.35);
        else tint.copy(prize);
        aTint.array[i * 3] = tint.r; aTint.array[i * 3 + 1] = tint.g; aTint.array[i * 3 + 2] = tint.b;
      }
      aDock.needsUpdate = true;
      aTint.needsUpdate = true;
    },
    lock(i, nowS) {
      fill[i] = 1;
      aDock.array[i * 4] = nowS % 10000;
      aDock.needsUpdate = true;
    },
    clear() {
      fill[0] = 0; fill[1] = 0; lastTickRemaining[0] = Infinity; lastTickRemaining[1] = Infinity;
      aDock.array[0] = -10; aDock.array[4] = -10; aDock.array[1] = 0; aDock.array[5] = 0;
      aDock.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { mesh.visible = true; aDock.array[0] = 0; aDock.needsUpdate = true; },
  };
  return self;
}
