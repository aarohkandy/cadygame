// src/game/render/holo-crowd-material.ts (WP2)
// The holographic crowd (EMOTION_BIBLE 5.2): a witness, not wallpaper. ≤ 160 instanced billboards on two low
// tiers set well back, one draw, ≤ 18 % of frame height from the cockpit eye. Each figure is a procedural
// silhouette (four builds, three poses, clapping) rendered as a dim desaturated-indigo hologram sunk into the
// fog: an outline over a sparsely dithered body, scanlines, a 2–4 Hz flicker per seat, a 5 s lean cycle of
// 1–2 cm. No team tint below hype 80; above it the leaning side's stand strobes its team colour, the only time
// the bowl is pink or blue. Strikes make that side's near rows jump 250 ms, KOs throw arms up. Phone flashes
// (Poisson ≈ 1/s over the crowd, ×4 with hype, a burst on a KO) are the cheapest "people". `layoutCrowd` is
// pure so tests can check the instancing.
import {
  Color, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial, type IUniform,
} from "three";
import { RENDER_SCALE } from "../contracts.ts";
import { CALIBRATION } from "./quality.ts";

/** The most figures ever drawn (5.2: 380 → 160 on DEFAULT); tiers may draw fewer. */
export const CROWD_MAX = 160;
// ONE WORLD, ONE SCALE (GROUNDING part 2, item 4). These were a 21 cm doll ring 3 m from a 1.10 m deck while
// the studio furniture next to them was a 1.22 m tripod. They are now people: 1.70 m tall, standing on a two-
// row rake 14 m back, which is where a 1.70 m person has to be for the stand to stay the thin band behind the
// opponent that 5.2 asks for (crowd-instancing.test.mjs checks the ≤ 18 % of frame height from the cockpit eye).
export const CROWD_TIERS = 2;
export const CROWD_INNER_RADIUS_M = 14.00;
export const CROWD_TIER_DEPTH_M = 0.95;
export const CROWD_TIER_RISE_M = 0.42;
/**
 * The rake is not a continuous ring: it is eight seating blocks with a service bay between each pair — the
 * vomitories, camera platforms and doorways that GROUNDING part 2 wants the back of the room to be made of.
 * The gaps are also what makes the drawn 160 read as a full house instead of a picket line: 160 figures spread
 * over 208° of two rows is 77 % occupancy, where the same 160 spread over the whole ring was 47 %.
 * Blocks are centred on k·45°, so a full block sits behind the opponent and the bays fall to the sides, and
 * the layout stays symmetric under a quarter turn (the even-quadrant check in the test depends on that).
 */
export const CROWD_BLOCKS = 8;
export const CROWD_BLOCK_ARC_RAD = (26 * Math.PI) / 180;
/** Height of the dasher board that rings the stand in front of the first row (sim metres): a rink board. */
export const DASHER_H_M = 1.05;
/** The back wall that closes the stand above the top row: chest-high rail plus solid infill. */
export const CONCOURSE_H_M = 1.30;
/** Stand floor: the studio floor under the deck. */
export const STAND_FLOOR_Z_M = -0.018;
/** Radius where the first tier starts, the dasher board's face, the back of the top tier, and its height. */
export const STAND_FRONT_R_M = CROWD_INNER_RADIUS_M - CROWD_TIER_DEPTH_M * 0.5;
export const DASHER_R_M = STAND_FRONT_R_M - 0.55;
export const STAND_BACK_R_M = STAND_FRONT_R_M + CROWD_TIERS * CROWD_TIER_DEPTH_M;
export const STAND_TOP_Z_M = STAND_FLOOR_Z_M + (CROWD_TIERS - 1) * CROWD_TIER_RISE_M;
/** Seat pitch along a row: shoulders nearly touching, which is what a standing rail row looks like. */
export const CROWD_SEAT_SPACING_M = 0.50;
/** Billboard cell: a 1.70 m person, the cell wide enough to hold both arms up. */
export const CROWD_FIGURE_W_M = 0.85;
export const CROWD_FIGURE_H_M = 1.70;
/** |x| under which a seat belongs to neither stand (never tinted, jumps for either side). */
export const CROWD_NEUTRAL_X_M = 2.00;
/** House seats: desaturated indigo (5.2); a witness in the dark, not a light source. */
export const CROWD_HOUSE_HEX = "#3A3F6E";
/** Hype above which the leaning side's stand strobes its team colour. */
export const CROWD_TINT_HYPE = 0.8;
/**
 * The crowd's own depth haze, in sim metres. Scene fog (lighting.tsx FOG) is scoped to the fight — far 7
 * render units, 3.41 m — so at 14 m it would flatten the whole stand to one slab of fog colour, which is
 * exactly the dead-grey read part 2 is here to kill. The stand sinks into the room's own air instead: it
 * starts at the near edge of the rake and never goes fully out, so the back row stays a dim glitter.
 */
export const CROWD_HAZE_NEAR_M = 9.0;
export const CROWD_HAZE_FAR_M = 26.0;
export const CROWD_HAZE_MAX = 0.62;
/** The colour the far rows dissolve into: the back wall's own dark slate-indigo (cyclorama.tsx BACK_WALL). */
export const CROWD_HAZE_HEX = "#0A0C18";

/** Which stand a seat at `x` belongs to: −1 the atlas end, +1 the blaze end, 0 the neutral band between. */
export function crowdSide(x: number): -1 | 0 | 1 {
  if (Math.abs(x) <= CROWD_NEUTRAL_X_M) return 0;
  return x < 0 ? -1 : 1;
}

export interface CrowdLayout {
  count: number;
  /** count × 3, sim metres (figure foot point). */
  offsets: Float32Array;
  /** count × 4: seed 0..1, side (−1 atlas / 0 neutral / +1 blaze), tier, facing azimuth (rad). */
  info: Float32Array;
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Seats on CROWD_TIERS tiers, in CROWD_BLOCKS seating blocks with a service bay between each pair. Instances
 * are ordered so any prefix is spread evenly around the ring (van der Corput order within tier-first rounds),
 * so a tier that draws only the first N instances still fills every block and both stands.
 */
export function layoutCrowd(capacity: number): CrowdLayout {
  type Seat = { x: number; y: number; z: number; tier: number; order: number; az: number };
  const seats: Seat[] = [];
  const blockStep = (Math.PI * 2) / CROWD_BLOCKS;
  for (let tier = 0; tier < CROWD_TIERS; tier++) {
    const r = CROWD_INNER_RADIUS_M + tier * CROWD_TIER_DEPTH_M;
    // Seats per block: the block's arc length at this radius, at the row pitch.
    const perBlock = Math.max(2, Math.floor((CROWD_BLOCK_ARC_RAD * r) / CROWD_SEAT_SPACING_M));
    for (let b = 0; b < CROWD_BLOCKS; b++) {
      const centre = b * blockStep;
      for (let i = 0; i < perBlock; i++) {
        // Back rows are staggered half a seat, as a real rake is.
        const t = (i + 0.5 + (tier % 2) * 0.5) / perBlock - 0.5;
        const az = centre + t * CROWD_BLOCK_ARC_RAD;
        const k = b + i * CROWD_BLOCKS;
        // van der Corput radical inverse of the seat's index gives an even prefix distribution.
        let v = 0, f = 0.5, n = i;
        while (n > 0) { v += f * (n & 1); n >>= 1; f *= 0.5; }
        // Outward only: nobody stands in front of their row, and the test's inner-radius floor holds.
        const jitter = hash01(tier * 1000 + k) * 0.11;
        seats.push({
          x: Math.cos(az) * (r + jitter), y: Math.sin(az) * (r + jitter),
          z: STAND_FLOOR_Z_M + tier * CROWD_TIER_RISE_M + 0.03,
          tier, order: v + (b / CROWD_BLOCKS) / perBlock + tier * 0.37, az,
        });
      }
    }
  }
  seats.sort((a, b) => a.order - b.order);
  const count = Math.min(capacity, seats.length);
  const offsets = new Float32Array(count * 3);
  const info = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = seats[i];
    offsets[i * 3] = s.x; offsets[i * 3 + 1] = s.y; offsets[i * 3 + 2] = s.z;
    info[i * 4] = hash01(i * 7.31 + s.tier);
    info[i * 4 + 1] = crowdSide(s.x);
    info[i * 4 + 2] = s.tier;
    info[i * 4 + 3] = s.az;
  }
  return { count, offsets, info };
}

const VERT = /* glsl */ `
#include <common>
attribute vec3 aOffset;
attribute vec4 aInfo;
uniform float uTime;
uniform float uHype;
uniform float uJumpA;
uniform float uJumpB;
uniform float uCheer;
varying vec2 vUv;
varying float vSeed;
varying float vSide;
varying float vPose;
varying float vRow;
varying float vWorldZ;
varying float vType;
varying float vClap;
varying float vAz;
varying float vFlash;
varying float vHaze;
float crowdHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
void main() {
  float seed = aInfo.x;
  float side = aInfo.y;
  float tier = aInfo.z;
  float az = aInfo.w;
  // Lean cycle 5 s of 1–2 cm toward the stage (5.6), a little more with hype; side jump on strikes (near rows most).
  float sway = sin(uTime * 6.2831853 / 5.0 + seed * 40.0) * (0.048 + 0.038 * seed);
  vec2 toStage = -normalize(aOffset.xy);
  float jump = (side < -0.5 ? uJumpA : side > 0.5 ? uJumpB : max(uJumpA, uJumpB) * 0.6) * (1.0 - tier * 0.18);
  float hop = jump * 0.17 * abs(sin(uTime * 13.0 + seed * 20.0)) + uCheer * 0.09 * abs(sin(uTime * 7.0 + seed * 12.0));
  // A Mexican wave rides the ring on a big moment: a 70 degree crest travelling at 1.4 rad/s.
  float crest = fract((az - uTime * 1.4) / 6.2831853);
  float wave = uCheer * (1.0 - smoothstep(0.0, 0.10, crest)) * (1.0 - tier * 0.1);
  hop += wave * 0.22;
  vec3 foot = aOffset + vec3(toStage * (uHype * 0.13 + sway), hop);
  vec3 upV = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
  vec4 mv = modelViewMatrix * vec4(foot, 1.0);
  // Build variety: four silhouette archetypes, and a height spread wide enough to break the picket fence.
  vType = floor(crowdHash(seed * 311.0) * 4.0);
  // Phone flash: one seat in ${CROWD_MAX} per quarter-second slot ≈ 1/s over the crowd, ×4 with hype, a burst on a cheer.
  float slot = floor(uTime * 4.0);
  float pFlash = (0.25 / ${CROWD_MAX}.0) * (1.0 + 3.0 * uHype + 29.0 * step(0.9, uCheer));
  float flashOn = step(crowdHash(seed * 61.7 + slot * 3.1), pFlash);
  float tall = 0.80 + 0.40 * crowdHash(seed * 97.3);
  float s = ${CROWD_FIGURE_H_M.toFixed(3)} * tall * uScale;
  float wide = 0.88 + 0.28 * crowdHash(seed * 53.7);
  mv.xyz += rightV * (position.x * ${(CROWD_FIGURE_W_M / CROWD_FIGURE_H_M).toFixed(3)} * wide + sway * 0.6) * s + upV * (position.y + 0.5) * s;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vSeed = seed;
  vSide = side;
  vRow = tier;
  vFlash = flashOn;
  // Pose: 0 arms down, 1 one arm up, 2 both arms up. Each seat runs on its own beat, so the ring
  // never switches as one block; cheers and the wave crest raise far more of them.
  float beat = floor(uTime * (0.20 + 0.25 * crowdHash(seed * 7.7)) + seed * 9.0);
  float r = crowdHash(seed * 91.7 + beat * 13.0);
  float raise = max(uCheer * 0.85, wave);
  vPose = r < raise ? 2.0 : (r < 0.14 + uHype * 0.3 ? 1.0 : 0.0);
  // Applause: hands in front of the chest, beating at 4–6 Hz, only while the crowd is up.
  vClap = step(0.35, uHype) * step(r, 0.22 + uHype * 0.45) * (0.5 + 0.5 * sin(uTime * (25.0 + 8.0 * seed) + seed * 30.0));
  vWorldZ = foot.z;
  vAz = az;
  // Depth: the rake is 14 m out and 2 m deep, so the back row sits measurably further into the room's air
  // than the front one. That gradient is the whole reason the stand reads as a rake and not as a frieze,
  // and it is ours rather than the scene fog's, which stops 3.4 m from the deck (CROWD_HAZE_*).
  vHaze = smoothstep(${CROWD_HAZE_NEAR_M.toFixed(2)} * uScale, ${CROWD_HAZE_FAR_M.toFixed(2)} * uScale, -mv.z) * ${CROWD_HAZE_MAX.toFixed(2)};
}
`;

const FRAG = /* glsl */ `
#include <common>
uniform float uTime;
uniform vec3 uHazeColor;
uniform float uSurge;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorN;
uniform float uIntensity;
uniform float uHype;
uniform float uLean;
varying vec2 vUv;
varying float vSeed;
varying float vSide;
varying float vPose;
varying float vRow;
varying float vWorldZ;
varying float vType;
varying float vClap;
varying float vAz;
varying float vFlash;
varying float vHaze;
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdCapsule(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float fragHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float bayer4(vec2 fc) {
  ivec2 c = ivec2(mod(fc, 4.0));
  int i = c.x + c.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void main() {
  // p is in units of the figure's own height, isotropic: y 0 at the feet, 1 at the crown.
  vec2 p = vec2((vUv.x - 0.5) * ${(CROWD_FIGURE_W_M / CROWD_FIGURE_H_M).toFixed(3)}, vUv.y);
  float build = fragHash(vSeed * 3.1);
  float shoulder = 0.112 + 0.026 * build;
  float headR = 0.072 + 0.008 * fragHash(vSeed * 5.3);
  float headY = 0.915 - headR;
  float armY = 0.762;
  // A phone held up: a 1–2 px white dot at 4× the crowd emissive, drawn before the silhouette test.
  if (vFlash > 0.5 && length(p - vec2(shoulder * 0.9, armY + 0.12)) < 0.02) {
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * uIntensity * 4.0, 1.0);
    return;
  }

  // Chest, waist and two legs rather than one torso slab over one leg slab: the taper at the waist and
  // the gap between the ankles are the two things that make a 40-pixel silhouette read as a person.
  float head = sdCircle(p - vec2(0.0, headY), headR);
  float neck = sdBox(p - vec2(0.0, headY - headR * 0.88), vec2(headR * 0.36, headR * 0.46));
  float chest = sdBox(p - vec2(0.0, 0.638), vec2(shoulder - 0.018, 0.112)) - 0.018;
  float waist = sdBox(p - vec2(0.0, 0.452), vec2(shoulder - 0.044, 0.086)) - 0.014;
  float legL = sdBox(p - vec2(-shoulder * 0.44, 0.200), vec2(shoulder * 0.28, 0.180)) - 0.010;
  float legR = sdBox(p - vec2(shoulder * 0.44, 0.200), vec2(shoulder * 0.28, 0.180)) - 0.010;
  float d = min(min(head, neck), min(min(chest, waist), min(legL, legR)));

  // Archetypes: 1 a cap with a brim, 2 piled-up hair, 3 a team scarf across the shoulders.
  if (vType > 0.5 && vType < 1.5) {
    d = min(d, sdBox(p - vec2(0.0, headY + headR * 0.72), vec2(headR * 0.95, 0.016)));
    d = min(d, sdBox(p - vec2(headR * 0.95, headY + headR * 0.55), vec2(headR * 0.7, 0.011)));
  } else if (vType > 1.5 && vType < 2.5) {
    d = min(d, sdCircle(p - vec2(0.0, headY + headR * 0.85), headR * 0.55));
  } else if (vType > 2.5) {
    d = min(d, sdBox(p - vec2(0.0, armY - 0.012), vec2(shoulder + 0.030, 0.026)) - 0.010);
  }

  if (vClap > 0.01) {
    // Hands clapping in front of the chest: two short arms that meet and part.
    float gap = 0.040 * (1.0 - vClap);
    d = min(d, sdCapsule(p, vec2(-shoulder, armY), vec2(-gap, 0.60), 0.026));
    d = min(d, sdCapsule(p, vec2(shoulder, armY), vec2(gap, 0.60), 0.026));
  } else {
    if (vPose > 0.5) d = min(d, sdCapsule(p, vec2(shoulder, armY), vec2(0.215 + 0.035 * sin(uTime * 7.0 + vSeed * 30.0), 1.06), 0.026));
    if (vPose > 1.5) d = min(d, sdCapsule(p, vec2(-shoulder, armY), vec2(-0.215 - 0.035 * sin(uTime * 6.0 + vSeed * 17.0), 1.05), 0.026));
    if (vPose < 0.5) {
      d = min(d, sdCapsule(p, vec2(-shoulder, armY), vec2(-shoulder - 0.014, 0.44), 0.026));
      d = min(d, sdCapsule(p, vec2(shoulder, armY), vec2(shoulder + 0.014, 0.44), 0.026));
    }
    // One seat in twelve holds a placard up on both arms.
    if (vPose > 1.5 && fragHash(vSeed * 41.0) > 0.92) d = min(d, sdBox(p - vec2(0.0, 1.14), vec2(0.13, 0.062)) - 0.010);
  }
  if (d > 0.0) discard;
  // Scanlines scrolling up the figure, tear bands sliding through the bowl, and a 2–4 Hz flicker per seat.
  float scan = 0.72 + 0.28 * step(0.5, fract(vWorldZ * 180.0 + vUv.y * 26.0 - uTime * 2.2));
  float tear = step(0.965, fract(vUv.y * 3.0 + vWorldZ * 9.0 - uTime * 0.7 + vSeed * 0.3));
  float flick = step(0.15, fract(uTime * (2.0 + 2.0 * vSeed) + vSeed * 7.0));
  float edge = smoothstep(-0.02, 0.0, d);
  // Bodies dither at under half coverage (a full-coverage ring was the busiest texture in the frame);
  // the outline is solid, so every figure reads as a lit silhouette. Hype and surges fill the bodies in.
  float density = mix((0.38 + 0.14 * uHype + 0.2 * uSurge) * scan * mix(0.7, 1.0, flick), 1.0, edge * 0.7);
  if (bayer4(gl_FragCoord.xy + vec2(vSeed * 64.0, 0.0)) > density) discard;
  // No team tint below hype 80; above it the leaning side's stand strobes its colour at 3 Hz (5.2).
  float strobe = step(${CROWD_TINT_HYPE.toFixed(2)}, uHype) * step(0.5, vSide * uLean) * (0.5 + 0.5 * sin(uTime * 18.85));
  vec3 tint = mix(uColorN, vSide < 0.0 ? uColorA : uColorB, strobe);
  float block = 0.8 + 0.4 * strobe;
  // Per-seat brightness spread, bottom-weighted so only the brightest handful cross the bloom threshold;
  // back rows sit deeper in the haze; a slow shimmer runs round the ring.
  float value = 0.4 + 0.8 * fragHash(vSeed * 23.9);
  float depth = 1.0 - vRow * 0.15;
  float shimmer = 0.82 + 0.18 * sin(vAz * 7.0 - uTime * 1.3) + tear * 0.8;
  float glow = (0.7 + 0.35 * uHype + 0.9 * uSurge) * shimmer;
  // Body and outline weights. At 0.55 / 1.2 a figure's lit pixels came out around 0.09 display — the same
  // value as the wall's haze behind it, so 160 people dissolved into the back of the room and the rake read
  // as one dead mass (part 2 item 4). The wall is now an order of magnitude darker, and these weights put
  // the outline near 0.22 display against it: a dim glitter that is still a third of the opponent, so the
  // crowd reads as a witness without ever competing with the fight. The dither keeps the mass below that.
  gl_FragColor = vec4(tint * uIntensity * value * depth * block * glow * (1.00 + 2.10 * edge), 1.0);
  // Into the room's air. The haze colour is the back wall's own, so the far rows dissolve into the building
  // rather than into a slab of fog that sits in front of it.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, vHaze);
}
`;

export interface CrowdUniforms {
  uTime: IUniform<number>; uHype: IUniform<number>; uJumpA: IUniform<number>; uJumpB: IUniform<number>;
  uCheer: IUniform<number>; uSurge: IUniform<number>; uColorA: IUniform<Color>; uColorB: IUniform<Color>; uColorN: IUniform<Color>;
  uIntensity: IUniform<number>; uScale: IUniform<number>; uLean: IUniform<number>; uHazeColor: IUniform<Color>;
}

export function createCrowdGeometry(layout: CrowdLayout): InstancedBufferGeometry {
  const base = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("aOffset", new InstancedBufferAttribute(layout.offsets, 3));
  g.setAttribute("aInfo", new InstancedBufferAttribute(layout.info, 4));
  g.instanceCount = layout.count;
  return g;
}

export function createCrowdMaterial(): { material: ShaderMaterial; uniforms: CrowdUniforms } {
  const uniforms: CrowdUniforms = {
    uTime: { value: 0 }, uHype: { value: 0.15 }, uJumpA: { value: 0 }, uJumpB: { value: 0 }, uCheer: { value: 0 }, uSurge: { value: 0 },
    uColorA: { value: new Color("#8DB4FF") }, uColorB: { value: new Color("#FF9CC3") }, uColorN: { value: new Color(CROWD_HOUSE_HEX) },
    uIntensity: { value: CALIBRATION.emissive.crowd }, uScale: { value: RENDER_SCALE }, uLean: { value: 0 },
    uHazeColor: { value: new Color(CROWD_HAZE_HEX) },
  };
  // No scene fog: FOG.far is 3.4 m and the rake is 14 m out, so three's fog would flatten the whole stand
  // to one slab of fog colour. The crowd carries its own long-range haze instead (CROWD_HAZE_*).
  const material = new ShaderMaterial({
    vertexShader: `uniform float uScale;\n${VERT}`, fragmentShader: FRAG,
    uniforms: uniforms as unknown as Record<string, IUniform>,
    transparent: false, depthWrite: true, fog: false,
  });
  return { material, uniforms };
}
