// src/game/render/vfx/confetti.ts (WP6)
// Celebration confetti (6.8 with SCOPE 1.2: BIT cubes, volt, signal, paper): hole-punch dots, strips, and
// BIT stickers, falling with drag toward a terminal velocity while they flutter and sway. Two throws: the
// match win drops a handful in from above the camera, and the KO fires cannons from the stage corners
// (`cannon`). Pieces glint HDR as they flip face-on to the lights, so bloom makes them sparkle.
// Evaluated on the GPU from spawn attributes, pool 300 (tier-scaled), one draw.
import {
  DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial,
  type Texture,
} from "three";
import {
  type Prewarmable, TOKEN_HEX } from "../../contracts.ts";
import { RENDER_SCALE_UNIFORM, createRingPool, createVfxRandom, writeColor, type RingPool } from "./sparks.ts";

export const CONFETTI_POOL = 300;
export const CONFETTI_LIFE_S = 2.5;
const PALETTE: readonly string[] = [TOKEN_HEX.volt, TOKEN_HEX.signal, TOKEN_HEX.paper, TOKEN_HEX.volt, TOKEN_HEX.paper];

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aTime;     // birth, life, kind (0 dot, 1 strip, 2 BIT), seed
attribute vec3 aColor;
uniform float uTime;
uniform float uRenderScale;
varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vShade;
varying float vFade;
void main() {
  float age = uTime - aTime.x;
  if (age < 0.0 || age > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; }
  float tau = 0.32;
  vec3 vt = vec3(0.0, 0.0, -0.32 - 0.12 * fract(aTime.w * 7.13));
  float e = 1.0 - exp(-age / tau);
  vec3 c = aPos + vt * age + (aVel - vt) * tau * e;
  c.x += 0.028 * sin(age * 4.3 + aTime.w * 21.0);
  c.y += 0.028 * cos(age * 3.7 + aTime.w * 13.0);
  float spin = age * (5.0 + 7.0 * fract(aTime.w * 3.1)) + aTime.w * 40.0;
  float flip = cos(age * (6.0 + 5.0 * fract(aTime.w * 5.7)) + aTime.w * 9.0);
  vec2 size = aTime.z < 0.5 ? vec2(0.007) : (aTime.z < 1.5 ? vec2(0.004, 0.014) : vec2(0.012));
  vec2 corner = position.xy * size;
  corner.y *= flip;
  float cs = cos(spin), sn = sin(spin);
  corner = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += corner * uRenderScale;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vColor = aColor;
  vKind = aTime.z;
  vShade = 0.55 + 0.45 * abs(flip);
  vFade = 1.0 - smoothstep(0.8, 1.0, age / aTime.y);
}
`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uHasAtlas;
varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vShade;
varying float vFade;
void main() {
  if (vFade <= 0.0) discard;
  vec3 col = vColor * vShade;
  float glint = pow(vShade, 24.0);
  float a = vFade;
  if (vKind < 0.5) {
    if (length(vUv - 0.5) > 0.5) discard;
  } else if (vKind > 1.5) {
    if (uHasAtlas > 0.5) {
      vec4 t = texture2D(uAtlas, vUv);
      if (t.a < 0.4) discard;
      col = t.rgb * vShade;
    }
  }
  gl_FragColor = vec4(col * (1.0 + 3.0 * glint), a);
}
`;

export interface ConfettiPool extends Prewarmable {
  readonly mesh: Mesh;
  readonly pool: RingPool;
  /**
   * Throws `count` pieces from above the camera toward the view: `origin` is the sim-space camera position,
   * `forward` the sim-space view direction (unit).
   */
  burst(nowS: number, count: number, ox: number, oy: number, oz: number, fx: number, fy: number, fz: number): void;
  /**
   * A cannon at sim (x, y, z) firing `count` pieces up and along (dx, dy, dz) (unit) in the given colours.
   * The KO fires one from each stage corner.
   */
  cannon(nowS: number, count: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, palette: readonly string[]): void;
  /** Sets the BIT sticker texture (brand-textures.ts). */
  setAtlas(texture: Texture | null): void;
  update(nowS: number): void;
  clear(): void;
  dispose(): void;
}

export function createConfettiPool(capacity = CONFETTI_POOL): ConfettiPool {
  const base = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  const aPos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aVel = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aTime = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-10), 4);
  const aColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  for (const a of [aPos, aVel, aTime, aColor]) a.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aPos", aPos);
  geometry.setAttribute("aVel", aVel);
  geometry.setAttribute("aTime", aTime);
  geometry.setAttribute("aColor", aColor);
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide, transparent: true, depthWrite: true, alphaTest: 0.01,
    uniforms: { uTime: { value: 0 }, uRenderScale: RENDER_SCALE_UNIFORM, uAtlas: { value: null }, uHasAtlas: { value: 0 } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.name = "confetti";
  const pool = createRingPool(capacity);
  const rand = createVfxRandom(0xc0ffee);
  let dirty = false;
  let epoch = 0;
  const self: ConfettiPool = {
    mesh, pool,
    burst(nowS, count, ox, oy, oz, fx, fy, fz) {
      // Side vector (horizontal) for the spread.
      let sx = -fy, sy = fx;
      const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
      for (let n = 0; n < count; n++) {
        const i = pool.alloc(nowS, CONFETTI_LIFE_S + 0.25);
        const ahead = 0.08 + rand() * 0.35;
        const side = (rand() - 0.5) * 0.55;
        aPos.array[i * 3] = ox + fx * ahead + sx * side;
        aPos.array[i * 3 + 1] = oy + fy * ahead + sy * side;
        aPos.array[i * 3 + 2] = oz + 0.12 + rand() * 0.18;
        const out = 0.2 + rand() * 0.5;
        aVel.array[i * 3] = fx * out + sx * (rand() - 0.5) * 0.6;
        aVel.array[i * 3 + 1] = fy * out + sy * (rand() - 0.5) * 0.6;
        aVel.array[i * 3 + 2] = 0.2 + rand() * 0.7 + fz * out * 0.3;
        const r = rand();
        const kind = r < 0.62 ? 0 : r < 0.9 ? 1 : 2;
        aTime.array[i * 4] = nowS - epoch + rand() * 0.25;
        aTime.array[i * 4 + 1] = CONFETTI_LIFE_S * (0.8 + rand() * 0.2);
        aTime.array[i * 4 + 2] = kind;
        aTime.array[i * 4 + 3] = rand();
        const hex = kind === 2 ? TOKEN_HEX.volt : PALETTE[Math.floor(rand() * PALETTE.length)];
        writeColor(aColor.array as Float32Array, i * 3, hex, hex === TOKEN_HEX.paper ? 0.9 : 1.15);
      }
      dirty = true;
    },
    cannon(nowS, count, x, y, z, dx, dy, dz, palette) {
      for (let n = 0; n < count; n++) {
        const i = pool.alloc(nowS, CONFETTI_LIFE_S + 0.1);
        aPos.array[i * 3] = x; aPos.array[i * 3 + 1] = y; aPos.array[i * 3 + 2] = z;
        const sp = 1.6 + rand() * 1.4;
        aVel.array[i * 3] = (dx + (rand() - 0.5) * 0.5) * sp;
        aVel.array[i * 3 + 1] = (dy + (rand() - 0.5) * 0.5) * sp;
        aVel.array[i * 3 + 2] = (dz + (rand() - 0.5) * 0.3) * sp;
        const r = rand();
        const kind = r < 0.5 ? 0 : r < 0.92 ? 1 : 2;
        aTime.array[i * 4] = nowS - epoch + rand() * 0.12;
        aTime.array[i * 4 + 1] = CONFETTI_LIFE_S * (0.85 + rand() * 0.15);
        aTime.array[i * 4 + 2] = kind;
        aTime.array[i * 4 + 3] = rand();
        writeColor(aColor.array as Float32Array, i * 3, palette[Math.floor(rand() * palette.length)], 1.2);
      }
      dirty = true;
    },
    setAtlas(texture) {
      material.uniforms.uAtlas.value = texture;
      material.uniforms.uHasAtlas.value = texture ? 1 : 0;
    },
    update(nowS) {
      // A pool with nothing in it must not cost a draw call: the dead instances are parked at a zero
      // scale, but the InstancedMesh still issues drawElementsInstanced for the whole capacity.
      mesh.visible = pool.active(nowS) > 0;
      if (nowS - epoch > 600 && pool.active(nowS) === 0) {
        epoch = nowS;
        (aTime.array as Float32Array).fill(-10);
        dirty = true;
      }
      material.uniforms.uTime.value = nowS - epoch;
      if (dirty) {
        aPos.needsUpdate = true; aVel.needsUpdate = true; aTime.needsUpdate = true; aColor.needsUpdate = true;
        dirty = false;
      }
    },
    clear() {
      pool.clear();
      (aTime.array as Float32Array).fill(-10);
      aTime.needsUpdate = true;
    },
    dispose() { geometry.dispose(); base.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.cannon(0, 1, 0, 0, 0.01, 0, 0, 1, ["#FFFFFF"]); self.update(0); },
  };
  return self;
}
