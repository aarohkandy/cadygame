// src/game/render/vfx/haze.ts (WP6)
// Two kinds of haze.
// Atmosphere (EMOTION_BIBLE 5.3): `createLightShafts` is every volumetric beam in the room — the two team
// cones aimed behind the arms and the two overhead shafts — as one instanced additive cone mesh in one draw.
// Each beam is brightest where the view looks along the most haze (`pow(1 − |N·V|, 1.4)`, i.e. through the
// middle of the cone, not at its silhouette) and near its lamp (`pow(1 − t, 1.6)`), one octave of value noise
// scrolls down it at 0.15/s, and it depth-fades over the last 4 cm above the deck (render y 0).
// Overheat haze (6.8): while a seat's heat is above 85 or it is in Cutout, a wobbling translucent heat
// shimmer sits on its shoulder servo and grey puffs rise from it. Two sprite instances (one per seat) in one
// draw; the puffs reuse the burst pool.
import {
  AdditiveBlending, ConeGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type Color,
} from "three";
import { RENDER_SCALE } from "../../contracts.ts";
import type { BurstPool } from "./bursts.ts";
import { GLSL_BILLBOARD, RENDER_SCALE_UNIFORM } from "./sparks.ts";

export const HAZE_HEAT_THRESHOLD = 85;
export const HAZE_PUFF_INTERVAL_S = 0.14;

const VERT = /* glsl */ `
attribute vec4 aHaze;   // x, y, z (sim), strength 0..1
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
varying float vSeed;
${GLSL_BILLBOARD}
void main() {
  vStrength = aHaze.w;
  if (aHaze.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 c = aHaze.xyz + vec3(0.0, 0.0, 0.025);
  gl_Position = tlBillboard(c, position.xy * vec2(1.0, 1.6), 0.05, 0.0);
  vUv = position.xy + 0.5;
  vSeed = aHaze.x * 13.0 + aHaze.y * 7.0;
}
`;
const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
varying float vSeed;
float hh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float nn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  if (vStrength <= 0.0) discard;
  vec2 p = vUv;
  float rise = uTime * 1.6;
  float n = nn(vec2(p.x * 5.0 + vSeed, p.y * 4.0 - rise)) * 0.6 + nn(vec2(p.x * 11.0 - vSeed, p.y * 9.0 - rise * 1.7)) * 0.4;
  float shape = (1.0 - smoothstep(0.15, 0.5, abs(p.x - 0.5))) * smoothstep(0.0, 0.25, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y));
  float a = shape * smoothstep(0.35, 0.8, n) * 0.4 * vStrength;
  if (a < 0.01) discard;
  // Hot air, not smoke: a signal-orange core cooling to grey at the edge of the shimmer.
  vec3 col = mix(vec3(0.33, 0.35, 0.38), vec3(1.0, 0.29, 0.11) * 1.6, smoothstep(0.5, 0.9, n) * vStrength);
  gl_FragColor = vec4(col, a);
}
`;

export interface HazeSprites {
  readonly mesh: Mesh;
  /** Sets seat 0/1 haze at the shoulder servo (sim) with strength 0..1; spawns puffs through `bursts`. */
  set(seatIndex: 0 | 1, x: number, y: number, z: number, strength: number, nowS: number, bursts: BurstPool): void;
  update(wallS: number): void;
  clear(): void;
  dispose(): void;
}

export function createHaze(): HazeSprites {
  const base = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  const aHaze = new InstancedBufferAttribute(new Float32Array(8), 4);
  aHaze.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aHaze", aHaze);
  geometry.instanceCount = 2;
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uRenderScale: RENDER_SCALE_UNIFORM },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  mesh.name = "haze";
  const nextPuff = new Float64Array(2);
  return {
    mesh,
    set(i, x, y, z, strength, nowS, bursts) {
      const o = i * 4;
      if (strength <= 0 && aHaze.array[o + 3] <= 0) return;
      aHaze.array[o] = x; aHaze.array[o + 1] = y; aHaze.array[o + 2] = z; aHaze.array[o + 3] = strength;
      aHaze.needsUpdate = true;
      if (strength > 0 && nowS >= nextPuff[i]) {
        nextPuff[i] = nowS + HAZE_PUFF_INTERVAL_S / Math.max(0.35, strength);
        bursts.spawn(nowS, "puff", x + (Math.sin(nowS * 37) * 0.006), y + (Math.cos(nowS * 23) * 0.006), z + 0.02, { driftUp: 0.09, scale: 0.8 + strength * 0.6, lifeScale: 2.6 });
      }
    },
    update(wallS) { material.uniforms.uTime.value = wallS % 1000; },
    clear() { aHaze.array[3] = 0; aHaze.array[7] = 0; aHaze.needsUpdate = true; },
    dispose() { geometry.dispose(); base.dispose(); material.dispose(); },
  };
}

/* ───────────────────────── atmosphere: volumetric light shafts ───────────────────────── */

const SHAFT_VERT = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vRadial;
varying vec2 vCone;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  // The cone is long and thin, so its surface normal is almost radial; the radial part survives the
  // non-uniform instance scale where the true normal would not.
  // Guarded: at the apex normal.xy and position.xy are zero, and normalize(0) / atan(0, 0) are NaN in GLSL.
  // Additive blending would then paint NaN over everything the cone covers.
  vec3 rad = mat3(m) * vec3(normal.xy, 0.0);
  vRadial = rad / max(length(rad), 1e-6);
  vColor = aColor;
  vCone = vec2(atan(position.y, position.x + 1e-6), clamp(position.z, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
/**
 * How far in from the silhouette the beam reaches full strength, in units of |V·N|. See the fragment shader:
 * it exists only to stop the cone terminating on its own polygon boundary.
 */
const EDGE_SOFT = 0.12;

const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vRadial;
varying vec2 vCone;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  // How much beam this ray crosses. |V·N| on the shell's radial normal is 0 at the silhouette and 1 where the
  // ray looks straight down the beam's thickness, so the term below is deliberately NOT the chord length: it
  // is dark where the ray runs along the axis and bright across the body. That is wrong for a camera outside
  // the cone and right for one inside it, and the cockpit eye sits inside the team key-fill cones — swapping
  // it for the physical |V·N| was measured and paints the whole cockpit frame a flat saturated blue, because
  // an enveloping cone is then at full strength over every pixel. Keep the safe sign.
  //
  // Its one real cost is that the beam is at its brightest exactly on its own silhouette, so each cone used to
  // terminate on a hard polygon edge — three straight-sided translucent wedges crossing the frame top to
  // bottom, and the least convincing thing on screen. EDGE_SOFT fades the last sliver back to nothing, which
  // costs nothing anywhere else: at the core the first term is already zero.
  float d = abs(dot(v, vRadial));
  float axis = pow(1.0 - d, 1.4) * smoothstep(0.0, ${EDGE_SOFT.toFixed(3)}, d);
  float along = vCone.y;
  // Falls off down the throw and dies in the last few percent, where the depth fade below takes over. The old
  // 0.82 cut killed the bottom 0.4 m of a 2 m throw, so the shaft never visibly reached the pool it makes.
  float fall = mix(0.35, 1.0, pow(max(1.0 - along, 0.0), 1.6)) * (1.0 - smoothstep(0.94, 1.0, along));
  // One noise octave scrolling down the beam at 0.15/s: the haze drifts, nothing faster than the eye follows.
  float drift = sn(vec2(vCone.x * 2.0 + 3.0, along * 5.0 - uTime * 0.15));
  float haze = 0.55 + 0.45 * drift;
  // Depth-fade over the last 4 cm above the deck so the cone lands in the pool instead of cutting the lacquer.
  float land = smoothstep(0.0, ${(0.04 * RENDER_SCALE).toFixed(3)}, vWorld.y);
  // Haze belongs to the beam, not to the lens (GROUNDING E). Additive haze in the first 30 cm in front of the
  // eye is what greys out the arms and flattens every shell the key is working to round; fade it out there.
  // Both arms sit further away than this, so the beams still read as beams across them.
  float nearFade = smoothstep(0.0, ${(0.3 * RENDER_SCALE).toFixed(3)}, distance(cameraPosition, vWorld));
  gl_FragColor = vec4(vColor * axis * fall * haze * land * nearFade, 1.0);
}
`;

export interface LightShafts {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  /**
   * Aims beam `i` from its lamp (ax, ay, az) to the point it lands on (tx, ty, tz), render space, with the
   * cone radius at that point and a linear colour × strength (0 hides it).
   */
  set(i: number, ax: number, ay: number, az: number, tx: number, ty: number, tz: number, radius: number, color: Color, strength: number): void;
  setCount(n: number): void;
  update(wallS: number): void;
  dispose(): void;
}

export function createLightShafts(capacity: number): LightShafts {
  const geometry = new ConeGeometry(1, 1, 28, 1, true);
  // Apex at the origin, opening along +z to radius 1 at z = 1.
  geometry.translate(0, -0.5, 0);
  geometry.rotateX(-Math.PI / 2);
  const aColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  aColor.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aColor", aColor);
  const material = new ShaderMaterial({
    vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.name = "light-shafts";
  const apex = new Vector3(), dir = new Vector3(), scale = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const q = new Quaternion();
  const m = new Matrix4();
  return {
    mesh,
    capacity,
    set(i, ax, ay, az, tx, ty, tz, radius, color, strength) {
      apex.set(ax, ay, az);
      dir.set(tx - ax, ty - ay, tz - az);
      const len = dir.length();
      q.setFromUnitVectors(zAxis, dir.multiplyScalar(1 / Math.max(1e-6, len)));
      scale.set(radius, radius, len);
      mesh.setMatrixAt(i, m.compose(apex, q, scale));
      const a = aColor.array as Float32Array;
      a[i * 3] = color.r * strength; a[i * 3 + 1] = color.g * strength; a[i * 3 + 2] = color.b * strength;
      mesh.instanceMatrix.needsUpdate = true;
      aColor.needsUpdate = true;
    },
    setCount(n) { mesh.count = Math.max(0, Math.min(capacity, n)); mesh.visible = mesh.count > 0; },
    update(wallS) { material.uniforms.uTime.value = wallS % 1000; },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
