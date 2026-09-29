// src/game/render/studio-floor.tsx (GROUNDING D, and the "not black" half of A)
// The ground the whole show stands on: a power-floated, polished concrete studio floor. It is dark, but it is
// concrete, not a void — saw-cut control joints on a 1.35 m grid (the strongest perspective cue in the frame),
// aggregate showing through the polish, trowel swirl in the roughness so the broad reflection of the overhead
// fixtures bends rather than sitting flat, and the traffic lanes around the deck rubbed smoother than the rest.
// On it: 48 mm gaffer runs taping the arm harnesses down from where the cable trays end (rigging.tsx) out to
// two anchored floor boxes, and one mains run crossing the floor behind the safety screen.
//
// One draw. Everything above is analytic in sim-space xy inside a single patched MeshStandardMaterial, so
// there is no texture to sample, nothing tiles, and it stays sharp at the deck edge and soft at the rim, where
// it fades into the bowl so the floor never out-reads the fight.
"use client";

import { useEffect, useMemo, type JSX } from "react";
import { CircleGeometry, Color, Mesh, MeshStandardMaterial } from "three";
import { DECK_LENGTH_M, DECK_WIDTH_M } from "./deck-texture.ts";
import { DECK_POOL_GLSL, DECK_POOL_VERTEX, DECK_SWEEP_UNIFORMS } from "./stage-deck.tsx";
import { DASHER_R_M } from "./holo-crowd-material.ts";
import {
  RIG_APRON_W_M, RIG_CAM_A_X_M, RIG_CAM_A_Y_M, RIG_CAM_B_X_M, RIG_CAM_B_Y_M, RIG_CASE_X_M, RIG_CASE_Y_M,
  RIG_FLOOR_Z_M, RIG_HARNESS_END_Y_M, RIG_MONITOR_X_M, RIG_MONITOR_Y_M, RIG_POST_XY, RIG_TRAY_END_Y_M,
  RIG_TRAY_X_M,
} from "./rigging.tsx";

/** The floor disc: a little inside the bowl, which closes the gap behind it. It has to reach past the crowd
 *  rake now that the rake is at human scale 14 m out (holo-crowd-material.ts STAND_BACK_R_M). */
export const STUDIO_FLOOR_RADIUS_M = 17.0;
/** Saw-cut control joints: a 1.35 m slab grid, 3 mm wide. */
export const FLOOR_JOINT_PITCH_M = 1.35;
export const FLOOR_JOINT_W_M = 0.003;
/** Gaffer tape: a 48 mm roll, which is the real size a viewer's eye can calibrate against. */
export const FLOOR_TAPE_W_M = 0.048;
/** Where the crowd stand's own shadow sits on this floor: just inside its dasher board. */
const STAND_SHADOW_R_M = DASHER_R_M - 0.25;
/** Recessed floor box: a 300 × 200 mm steel lid. */
export const FLOOR_BOX_L_M = 0.300;
export const FLOOR_BOX_W_M = 0.200;

/** Where the taped runs go: [x0, y0, x1, y1], axis-aligned, in sim metres. */
const TAPE_RUNS: readonly (readonly [number, number, number, number])[] = [
  [-RIG_TRAY_X_M, -RIG_TRAY_END_Y_M, -RIG_TRAY_X_M, -(RIG_HARNESS_END_Y_M - 0.09)],
  [RIG_TRAY_X_M, RIG_TRAY_END_Y_M, RIG_TRAY_X_M, RIG_HARNESS_END_Y_M - 0.09],
  [-2.35, -1.94, 2.35, -1.94],
];
/** Floor boxes at the end of each harness run. */
const FLOOR_BOXES: readonly (readonly [number, number])[] = [
  [-RIG_TRAY_X_M, -RIG_HARNESS_END_Y_M], [RIG_TRAY_X_M, RIG_HARNESS_END_Y_M],
];
/**
 * Contact darkening where something stands on this floor (GROUNDING B, the plant test). The key light's
 * shadow camera is ±1.4 render units, which does not reach the safety screen or anything past it, so the
 * feet outside it get their occlusion baked here instead: [x, y, radius].
 */
const FEET: readonly (readonly [number, number, number])[] = [
  ...RIG_POST_XY.map(([x, y]) => [x, y, 0.060] as const),
  [RIG_CAM_A_X_M, RIG_CAM_A_Y_M, 0.520],
  [RIG_CAM_B_X_M, RIG_CAM_B_Y_M, 0.520],
  [RIG_MONITOR_X_M, RIG_MONITOR_Y_M, 0.215],
  [RIG_CASE_X_M, RIG_CASE_Y_M, 0.500],
];

const feetGlsl = FEET.map(([x, y, r]) =>
  `ao = max(ao, pool(p, vec2(${x.toFixed(3)}, ${y.toFixed(3)}), ${r.toFixed(3)}));`).join("\n  ");
const segGlsl = TAPE_RUNS.map(([x0, y0, x1, y1]) =>
  `tape = max(tape, seg(p, vec2(${x0.toFixed(3)}, ${y0.toFixed(3)}), vec2(${x1.toFixed(3)}, ${y1.toFixed(3)})));`).join("\n  ");
const boxGlsl = FLOOR_BOXES.map(([x, y]) => {
  const c = `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`;
  return `fbox = max(fbox, vec2(rect(p, ${c}, HALF_BOX), rect(p, ${c}, HALF_BOX - 0.022)));\n  fix = max(fix, lidFixings(p, ${c}));`;
}).join("\n  ");

/**
 * Overall level of the concrete, applied on top of its albedo. The floor is lit by the same key and pools as
 * the deck, so at its own albedo it came out as bright as the mat — two lit planes of the same value, no
 * island, no dynamic range (part 2 item 1). This is the one knob that says "the deck is the lit thing and the
 * studio is the dark room around it"; the fixtures' own pools (FLOOR_POOL) still land on top of it.
 */
// 0.62 measured 0.417 on a real GPU against an opponent of 0.413 - i.e. dead level with the thing the player
// is supposed to read, which is PART 1 acceptance 1 ("nothing in the background is brighter than the
// opponent") running on empty. The floor is also the largest surface in frame, so it is the cheapest way
// to bring the whole-frame mean back under acceptance 1's 0.28 ceiling without dimming the deck lane, which
// is forbidden. 0.44 clears the opponent by ~30% and costs nothing anywhere else.
const FLOOR_LEVEL = 0.44;
/** How much specular survives where `fade` has gone to zero: enough that the far floor is not a matte void. */
const FLOOR_SPEC_FLOOR = 0.05;

const FLOOR_PARS = /* glsl */ `
varying vec2 vFloorP;
`;
/**
 * The two par-can pools land on the concrete as well as on the deck (lighting.tsx aims them; stage-deck owns
 * the cone maths). Without this the pools stop dead at the deck edge, which is the one place the floor stops
 * obeying "every pool has a fixture".
 */
const FLOOR_POOL = /* glsl */ `
{
  vec3 tlLit = tlPoolLight() * 0.30;
  reflectedLight.directDiffuse += tlLit * (diffuseColor.rgb + vec3(0.05));
}
`;
const FLOOR_FUN = /* glsl */ `
const vec2 HALF_BOX = vec2(${(FLOOR_BOX_L_M / 2).toFixed(4)}, ${(FLOOR_BOX_W_M / 2).toFixed(4)});
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1, 0)), f.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), f.x), f.y);
}
/**
 * 1 inside an axis-aligned rect of half-size h, antialiased by one pixel.
 * The filter width is CLAMPED: at the grazing angles this floor is seen at, a pixel covers metres and a raw
 * fwidth() makes smoothstep return < 1 for points that are nowhere near the rect — which turned the whole
 * far floor into a floor-box lid, metalness and all, and mirrored the bowl's magenta strip back as red.
 */
float rect(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  float e = max(d.x, d.y);
  return 1.0 - smoothstep(0.0, clamp(fwidth(e), 1e-5, 0.008), e);
}
/** Signed distance to an axis-aligned box, for the deck's own contact shadow. */
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
/** Occlusion under a foot: dark at the contact, gone by its radius. */
float pool(vec2 p, vec2 c, float r) { return 1.0 - smoothstep(r * 0.30, r, length(p - c)); }
/** The four fixings that anchor a floor box lid, inset from its corners. */
float lidFixings(vec2 p, vec2 c) {
  vec2 o = HALF_BOX - 0.030;
  float m = rect(p, c + o, vec2(0.006));
  m = max(m, rect(p, c - o, vec2(0.006)));
  m = max(m, rect(p, c + vec2(o.x, -o.y), vec2(0.006)));
  m = max(m, rect(p, c + vec2(-o.x, o.y), vec2(0.006)));
  return m;
}
/** A taped run of FLOOR_TAPE_W_M between two points (the runs are axis-aligned). */
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 c = (a + b) * 0.5;
  vec2 h = abs(b - a) * 0.5 + ${(FLOOR_TAPE_W_M / 2).toFixed(4)};
  return rect(p, c, h);
}
`;
const FLOOR_FRAG = /* glsl */ `
  vec2 p = vFloorP;
  float r = length(p);
  // Power-floated concrete: fine aggregate showing through, trowel swirl in the polish.
  // Fade the grain out once a cell is smaller than a pixel, or the far floor crawls with aliasing.
  float res = clamp(1.0 - fwidth(p.x) * 70.0, 0.0, 1.0);
  float agg = mix(0.5, fnoise(p * 210.0) * 0.6 + fnoise(p * 620.0) * 0.4, res);
  float swirl = fnoise(p * 2.4 + vec2(fnoise(p * 1.1) * 2.0));
  // Aggregate dies at grazing angles (a 5 mm cell is well under a pixel out there), which left the mid floor
  // with nothing but the 1.3 m blotch and no visible material at all. A 30 cm patchiness in the polish holds
  // where the grain cannot: it is coarse enough to survive the same resolution gate at three times the range.
  float mottle = mix(0.5, fnoise(p * 3.3), clamp(1.0 - fwidth(p.x) * 9.0, 0.0, 1.0));
  float blotch = fnoise(p * 0.75) * 0.64 + mottle * 0.36;
  vec3 base = mix(vec3(0.0225, 0.0238, 0.0272), vec3(0.0430, 0.0446, 0.0484), blotch * 0.8 + agg * 0.25);
  // Power-floated, not wet-look: 0.58 keeps the overhead streak as a broad soft bloom. Any smoother and the
  // floor mirrors the bowl's amber and magenta horizon strips and the whole studio turns orange (it did).
  float rough = 0.52 + swirl * 0.18 - blotch * 0.07;
  float metal = 0.0;
  // The traffic lane around the deck is walked and wheeled smooth; the rim never is.
  float lane = 1.0 - smoothstep(0.7, 2.1, r);
  rough -= lane * 0.11;
  // Saw-cut control joints on the slab grid: a dark line, and the slab edge dusty beside it.
  vec2 g = abs(fract(p / ${FLOOR_JOINT_PITCH_M.toFixed(4)} + 0.5) - 0.5) * ${FLOOR_JOINT_PITCH_M.toFixed(4)};
  float jw = ${(FLOOR_JOINT_W_M / 2).toFixed(5)};
  float joint = 1.0 - smoothstep(jw, jw + clamp(fwidth(g.x), 1e-5, 0.010), min(g.x, g.y));
  base *= 1.0 - 0.72 * joint;
  rough = mix(rough, 0.92, joint);
  // Gaffer tape: matte black cloth, its edge lifting a little where it has been walked on.
  float tape = 0.0;
  ${segGlsl}
  base = mix(base, vec3(0.0135, 0.0138, 0.0146) * (0.85 + 0.3 * agg), tape);
  rough = mix(rough, 0.93 - 0.05 * agg, tape);
  // Anchored floor boxes: a steel lid, the recess line around it, four fixings through the corners.
  vec2 fbox = vec2(0.0);
  float fix = 0.0;
  ${boxGlsl}
  float lid = fbox.y, recess = fbox.x - fbox.y;
  base = mix(base, vec3(0.5200, 0.5350, 0.5500), lid);
  base = mix(base, vec3(0.0075, 0.0078, 0.0084), recess);
  rough = mix(rough, 0.38 + agg * 0.12, lid);
  rough = mix(rough, 0.62, fix * lid);
  base = mix(base, vec3(0.3300, 0.3350, 0.3400), fix * lid);
  metal = max(metal, lid * 0.88);
  // Nothing stands on this floor without leaving a mark under it: the apron's own footprint first, then
  // every post and every leg past the reach of the key light's shadow camera.
  float ao = 1.0 - smoothstep(0.0, 0.11, sdBox(p, vec2(${(DECK_LENGTH_M / 2 + RIG_APRON_W_M).toFixed(4)}, ${(DECK_WIDTH_M / 2 + RIG_APRON_W_M).toFixed(4)})));
  ${feetGlsl}
  // The stand is a 15 m mass sitting on this floor; it gets the same contact darkening as everything else,
  // spread wide because the thing casting it is 1.5 m tall (GROUNDING B, out past the key's shadow camera).
  ao = max(ao, (1.0 - smoothstep(0.0, 1.60, abs(r - ${STAND_SHADOW_R_M.toFixed(3)}))) * 0.85);
  base *= 1.0 - 0.62 * ao;
  rough = mix(rough, 0.88, ao * 0.55);
  // Past the working area the floor falls away to nearly nothing well before the stand. This is where the
  // frame's true blacks come from (part 2 acceptance 1): the lit island of the deck, then a floor that drops
  // off a cliff, then the crowd glittering out of the dark. A slow tail keeps the far concrete from banding.
  // The old curve started at 1.9 m and the floor was still at three quarters brightness a metre past the
  // barrier, which is what made the band behind the screen the biggest flat pale shape in the frame.
  // 0.90/0.80 left the floor past 10 m at 0.10 x 0.20 = 2% of albedo - a cliff edge rather than a room. The
  // softer pair keeps the falloff but gives the far floor a ground plane to sit on. The floor is the largest
  // surface in frame, so this moves the whole-frame mean more than any other constant here: 0.62/0.55 put the
  // mean at 0.278 against a 0.28 ceiling. 0.78/0.70 keeps the ground plane and leaves the gate real headroom.
  float fade = (1.0 - 0.78 * smoothstep(1.35, 4.40, r)) * (1.0 - 0.70 * smoothstep(4.20, 10.0, r))
             * (1.0 - 0.60 * smoothstep(9.0, ${STUDIO_FLOOR_RADIUS_M.toFixed(2)}, r));
  rough = mix(rough, 0.95, 1.0 - fade);
  diffuseColor.rgb = base * fade * ${FLOOR_LEVEL.toFixed(3)};
  roughnessFactor = clamp(rough, 0.20, 1.0);
  metalnessFactor = metal;
  // Held for FLOOR_SPEC, which runs further down the same main().
  float floorFade = fade;
`;
/**
 * The far concrete's real brightness was never its albedo: at the grazing angles the cockpit sees it at,
 * Fresnel drives a dielectric's specular to ~1 and the floor mirrors the environment whole. `fade` only ever
 * scaled the diffuse, so beyond the barrier the concrete kept a flat, untextured environment sheen — the
 * pale plane that read as the cheapest thing in the frame, brighter than the opponent and hiding every true
 * black behind it. Fading the specular response with the same curve is the whole fix: near the deck the
 * polish keeps its broad reflection of the overhead fixtures (GROUNDING D), and past it the floor goes out.
 * The lid of a floor box keeps its own metal, so the two anchored boxes still read as steel.
 */
const FLOOR_SPEC = /* glsl */ `
{
  float keep = clamp(mix(${FLOOR_SPEC_FLOOR.toFixed(3)}, 1.0, floorFade) + metalnessFactor, 0.0, 1.0);
  material.specularColor *= keep;
  material.specularColorBlended *= keep;
  material.specularF90 *= keep;
}
`;

export function createStudioFloor(): { mesh: Mesh; dispose(): void } {
  const geometry = new CircleGeometry(STUDIO_FLOOR_RADIUS_M, 96);
  geometry.deleteAttribute("uv");
  // No scene fog: FOG.far is 3.4 m and this disc is 17 m across the radius, so three's fog would flatten
  // everything past the barrier into one slab of fog colour. The falloff below is ours and goes the distance.
  const material = new MeshStandardMaterial({
    color: new Color("#FFFFFF"), roughness: 0.52, metalness: 0, envMapIntensity: 0.60, dithering: true, fog: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, DECK_SWEEP_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FLOOR_PARS}\nvarying vec3 vPoolWorld;`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFloorP = position.xy;")
      .replace("#include <project_vertex>", `#include <project_vertex>\n${DECK_POOL_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FLOOR_PARS}\n${DECK_POOL_GLSL}\n${FLOOR_FUN}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${FLOOR_FRAG}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${FLOOR_SPEC}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${FLOOR_POOL}`);
  };
  material.customProgramCacheKey = () => "tl-studio-floor";
  const mesh = new Mesh(geometry, material);
  mesh.position.z = RIG_FLOOR_Z_M;
  mesh.receiveShadow = true;
  mesh.name = "studio-floor";
  return { mesh, dispose() { geometry.dispose(); material.dispose(); } };
}

export function StudioFloor(): JSX.Element {
  const built = useMemo(() => createStudioFloor(), []);
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.mesh} />;
}
