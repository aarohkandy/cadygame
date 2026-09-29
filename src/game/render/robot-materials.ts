// src/game/render/robot-materials.ts (WP2)
// Show-machine finish for the SO-101 (EMOTION_BIBLE 5.4): the shells are clear-coated automotive paint in
// the team colour (MeshPhysicalMaterial, clearcoat 1 / clearcoatRoughness 0.05 over base roughness 0.32,
// envMapIntensity 1.8) with a base-to-tip value gradient (0.75 at the mount → 1.15 at the gripper) so a chain
// of cylinders reads as one body with a business end; the servos are dark anodized metal with a brushed
// anisotropic streak along the joint axis (the `tl-shell-aniso` boot-time variant); the wrist lens is
// iridescent (`tl-optics-irid`). Extended through onBeforeCompile with edge highlight and wear (paint rubs
// through to dark primer), the team fresnel rim kicked from behind each arm's far side (the magenta that
// lives on the opponent's silhouette and nowhere else), the per-link LED uniform, team charge glow, the pilot
// heat strip, entrant accent bands, the near-plane own-arm screen door, the KO de-rez dissolve, and the round
// re-render scan. Every variant is constructed at mount and covered by prewarm; no juice or tier change
// compiles a shader.
//
// GROUNDING F, this pass: nothing here is factory-fresh and nothing here glows. Every surface carries
// always-on micro-detail — mould grain as relief, two-octave roughness breakup, grime in the crevices where
// two parts meet, and a WEAR_FLOOR of edge wear rubbing paint to primer before the round even starts
// (`uWear` is only what this round adds). Each class gets one hero touch: the buffing streak in the shells'
// lacquer, the turning swirl on the servos' machined faces, and a bonded nitrile grip pad down the inner
// face of each gripper jaw, burnished pale at the tip with fingerprints on the painted plastic beside it.
// The four classes are separated by specular response alone (`highlightSharpness`), so a greyscale frame
// still tells them apart. The LED no longer makes the paint glow: the strip quads in robot-decals are the
// emitter and the shell only catches their bounce in the crevice.
//
// THEATRE 2 (Part 2 items 2 and 5, acceptance 2): the grounding pass left the machines correct and dull —
// matte, unlit, no highlight defining curvature and no rim holding them off the background. Four changes,
// none of which touch the micro-detail above: the paint stops being a half-metal (SHELL_METALNESS 0.45 →
// 0.26), so three quarters of the team colour comes back as diffuse instead of being handed to a specular
// lobe with a black room to reflect; what is left of the flake becomes a broad roughness-0.44 lobe plus a
// sparse platelet glitter, and that broad lobe is the highlight that rolls along a shell as the arm swings;
// the lacquer reaches harder for the one big soft source in the room (SHELL_ENV_INTENSITY); and the arris is
// polished sharper than the face in both the base roughness and the coat, which is the crisp edge line that
// draws the silhouette. The rim gains a neutral fifth so it survives a greyscale frame, and the pilot's is
// no longer an order under the opponent's. Everything from GROUNDING F multiplies the albedo or displaces
// the roughness, so it keeps its relative contrast at any key level: the relight cannot wash it out.
import {
  Color, MeshPhysicalMaterial, ShaderChunk, Vector3,
  type IUniform, type WebGLProgramParametersWithUniforms,
} from "three";
import { LINK_IDS, TOKEN_HEX, type LedFrame, type LinkId, type Seat } from "../contracts.ts";
import type { MaterialSlot } from "./robot-assets.ts";
import { simToRenderPos } from "./interpolate.ts";
import { PAPER_ALBEDO_SCALE } from "./quality.ts";

/* ───────────────────────── palette ───────────────────────── */

export const INK_700 = "#1C1F29";
export const INK_500 = "#3A3F4D";
export const PAPER_200 = "#E6E0D3";
export const COBALT_300 = "#8DB4FF";
export const MAGENTA_300 = "#FF9CC3";
/** Colourblind AI team (GAME_DESIGN 6.2.1). */
// Must match `:root[data-colorblind="true"]` in globals.css (--magenta / --magenta-300) or the 3D arm and the
// HUD show two different team colours to the players who most need them to agree. STYLES.md is binding here.
export const COLORBLIND_AI = "#FF9F1C";
export const COLORBLIND_AI_300 = "#FFC98A";
/** Dark anodized metal for the servos and the wrist camera mount. */
export const ANODIZED = "#1E222A";

export type Colorway = "pilot" | "rival" | "user_model";

/** Team colour per seat: atlas is the cobalt PILOT side, blaze the magenta AI side (SCOPE 1.2). */
export function teamHex(seat: Seat, colorblind: boolean): string {
  if (seat === "atlas") return TOKEN_HEX.cobalt;
  return colorblind ? COLORBLIND_AI : TOKEN_HEX.magenta;
}
export function teamTintHex(seat: Seat, colorblind: boolean): string {
  if (seat === "atlas") return COBALT_300;
  return colorblind ? COLORBLIND_AI_300 : MAGENTA_300;
}

/**
 * Rim gain (5.2): `rim = team × pow(1 − |N·V|, 3) × gain × (0.5 + 0.5·max(0, N·uKickDir))`. 4.0 puts the
 * opponent's silhouette edge at ≈ 1.0 linear, over the 0.95 bloom threshold, so the rim is what blooms; the
 * pilot's cobalt rim stays under it (5.1: the foreground arm is slightly under key and never blooms).
 *
 * THEATRE 2: the pilot rim was 1.2, which put the viewmodel's edge an order below the kicker that lit the
 * opponent, and against a back wall that is now a place rather than a void the foreground arm read as a flat
 * blue silhouette. 2.2 separates it from whatever is behind it and still peaks around 0.55 linear — a
 * comfortable half-stop under the 0.98 bloom threshold, so the opponent is still the only arm that blooms.
 */
export const RIM_GAIN = { rival: 4.0, pilot: 2.2 } as const;

/**
 * How much of the rim is neutral rather than team-coloured. A rim made purely of saturated team colour is
 * invisible in a greyscale frame (Part 2 acceptance 3 reads silhouette separation in greyscale) and it
 * smears team colour into the air. A fifth of it is the white key wrapping the edge, which is what a real
 * back-kicker does; the rest stays paint colour.
 */
export const RIM_NEUTRAL = 0.22;

/** The kicker direction (render space, unit) for a seat: from behind that arm's far side, a little above. */
export function rimKickDirRender(seat: Seat, out = new Vector3()): Vector3 {
  const p = new Float64Array(3);
  const s = seat === "atlas" ? -1 : 1;
  simToRenderPos(s * 0.9, -s * 0.46, 0.36, p);
  return out.set(p[0], p[1], p[2]).normalize();
}

/* ───────────────────────── shared per-arm uniforms ───────────────────────── */

export interface ArmUniforms {
  uTeam: IUniform<Color>;           // linear team colour
  uRim: IUniform<number>;           // fresnel rim gain (RIM_GAIN)
  uKickDir: IUniform<Vector3>;      // render-space direction toward the rim kicker
  uRimFlash: IUniform<number>;      // deflect rim flash 0..1
  uRimFlashColor: IUniform<Color>;
  uLed: IUniform<Float32Array>;     // 8 × (r, g, b, intensity) per link (LedFrame.perLink)
  uCharge: IUniform<number>;        // hand emissive multiplier (0 when not public)
  uHeat: IUniform<number>;          // 0..100 (pilot heat strip)
  uHeatStrip: IUniform<number>;     // 1 on the pilot, 0 otherwise
  uCutout: IUniform<number>;        // 1 while in Cutout (hazard pulse)
  uBands: IUniform<number>;         // entrant accent bands 0..3 (−1: user model wide band)
  uWear: IUniform<number>;          // 0..1 edge wear, grows through a round
  uTime: IUniform<number>;
  uDerez: IUniform<number>;         // 0 intact → 1 fully dissolved
  uDerezBottom: IUniform<number>;   // render-space Y range swept by the dissolve
  uDerezTop: IUniform<number>;
  uScanY: IUniform<number>;         // re-render scan: fragments above this render Y are not rendered yet; 1e3 = off
  uScanColor: IUniform<Color>;
  uBandColor: IUniform<Color>;
}

export function createArmUniforms(): ArmUniforms {
  return {
    uTeam: { value: new Color(TOKEN_HEX.cobalt) },
    uRim: { value: 0 },
    uKickDir: { value: rimKickDirRender("atlas") },
    uRimFlash: { value: 0 },
    uRimFlashColor: { value: new Color(TOKEN_HEX.block) },
    uLed: { value: new Float32Array(LINK_IDS.length * 4) },
    uCharge: { value: 0 },
    uHeat: { value: 0 },
    uHeatStrip: { value: 0 },
    uCutout: { value: 0 },
    uBands: { value: 0 },
    uWear: { value: 0 },
    uTime: { value: 0 },
    uDerez: { value: 0 },
    uDerezBottom: { value: 0 },
    uDerezTop: { value: 1 },
    uScanY: { value: 1e3 },
    uScanColor: { value: new Color(TOKEN_HEX.signal) },
    uBandColor: { value: new Color(TOKEN_HEX.paper) },
  };
}

/** Copies a pilot LED frame (3.3, WP3) into the arm's per-link LED uniform. */
export function setArmLed(arm: ArmUniforms, frame: LedFrame): void {
  arm.uLed.value.set(frame.perLink.subarray(0, arm.uLed.value.length));
}
/** Sets one link's LED (colour linear, intensity in emissive units); the opponent's tells and flares use this. */
export function setArmLinkLed(arm: ArmUniforms, link: LinkId, r: number, g: number, b: number, intensity: number): void {
  const o = LINK_IDS.indexOf(link) * 4;
  const a = arm.uLed.value;
  a[o] = r; a[o + 1] = g; a[o + 2] = b; a[o + 3] = intensity;
}

/* ───────────────────────── base-to-tip gradient ───────────────────────── */

/**
 * Where each link sits along the arm (0 mount → 1 gripper) and its link-local chain axis with the span to
 * the next joint (SO-101 body tree), so `vLocalPos` ramps the value inside the link too.
 */
const LINK_GRADIENT: Readonly<Record<LinkId, { t0: number; t1: number; axis: [number, number, number]; span: number }>> = {
  base: { t0: 0.0, t1: 0.08, axis: [0, 0, 1], span: 0.062 },
  shoulder: { t0: 0.08, t1: 0.2, axis: [0, 0, -1], span: 0.054 },
  upper_arm: { t0: 0.2, t1: 0.44, axis: [-1, 0, 0], span: 0.116 },
  lower_arm: { t0: 0.44, t1: 0.7, axis: [-1, 0, 0], span: 0.135 },
  wrist: { t0: 0.7, t1: 0.84, axis: [0, -1, 0], span: 0.061 },
  gripper: { t0: 0.84, t1: 1.0, axis: [0, 0, 0], span: 1 },
  camera_mount: { t0: 0.9, t1: 0.9, axis: [0, 0, 0], span: 1 },
  moving_jaw: { t0: 1.0, t1: 1.0, axis: [0, 0, 0], span: 1 },
};
export const GRADIENT_VALUE = { mount: 0.75, tip: 1.15 } as const;

/**
 * The two gripper jaws, in link-local metres from so101.xml: which way the gripping face points (`inner`,
 * unit) and the axis to the tip (`tip`, scaled so `dot(position, tip)` is 0 at the root and 1 at the tip).
 * The fixed jaw (`gripper`, wrist_roll_follower) reaches 105 mm down −z with its contact ridge on +x; the
 * moving jaw reaches 82 mm down −y with its ridge on −x. Everything else has no jaw and gets a zero vector.
 */
const JAW_GEOMETRY: Partial<Record<LinkId, { inner: [number, number, number]; tip: [number, number, number] }>> = {
  gripper: { inner: [1, 0, 0], tip: [0, 0, -1 / 0.105] },
  moving_jaw: { inner: [-1, 0, 0], tip: [0, -1 / 0.082, 0] },
};

/* ───────────────────────── shared surface GLSL ───────────────────────── */

/**
 * Value noise and a UV-free bump, shared by every procedural surface in the render layer (the arm shells
 * here, the moulded cubes in cubes-view). `tlBump` needs `vViewPosition`, which every MeshStandard/Physical
 * fragment shader declares; `h` is relief in metres.
 */
export const TL_SURFACE_GLSL = /* glsl */ `
float tlHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float tlNoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = tlHash13(i), n100 = tlHash13(i + vec3(1,0,0)), n010 = tlHash13(i + vec3(0,1,0)), n110 = tlHash13(i + vec3(1,1,0));
  float n001 = tlHash13(i + vec3(0,0,1)), n101 = tlHash13(i + vec3(1,0,1)), n011 = tlHash13(i + vec3(0,1,1)), n111 = tlHash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
/**
 * Micro-relief from a height field, using the screen-space derivative frame (the STLs carry no UVs, so
 * there is no tangent to hang a normal map on). h is relief in metres.
 */
vec3 tlBump(vec3 n, float h) {
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
`;

/* ───────────────────────── shader chunks ───────────────────────── */

const VERTEX_HEAD = /* glsl */ `
attribute float edge;
attribute vec3 printAxis;
varying vec3 vPrintAxisLocal;
varying float vEdge;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vJointAxisView;
varying vec3 vObjNormal;
`;
const VERTEX_BODY = /* glsl */ `
vEdge = edge;
vLocalPos = position;
vPrintAxisLocal = printAxis;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
// Every SO-101 joint turns about its link's local z: the brushed streak on a servo runs along it.
vJointAxisView = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
// Link-local normal: which way a face points on the part itself, so the jaw's inner face knows it is inner.
vObjNormal = objectNormal;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform vec3 uTeam;
uniform float uRim;
uniform vec3 uKickDir;
uniform float uRimFlash;
uniform vec3 uRimFlashColor;
uniform vec4 uLed[${LINK_IDS.length}];
uniform float uCharge;
uniform float uHeat;
uniform float uHeatStrip;
uniform float uCutout;
uniform float uBands;
uniform float uWear;
uniform float uTime;
uniform float uDerez;
uniform float uDerezBottom;
uniform float uDerezTop;
uniform float uScanY;
uniform vec3 uScanColor;
uniform vec3 uBandColor;
uniform float uDither;
uniform float uLinkKind;
uniform float uLinkIndex;
uniform vec3 uGradAxis;
uniform vec3 uGradUnit;
uniform vec2 uGradT;
uniform vec3 uJawInner;
uniform vec3 uJawTip;
varying float vEdge;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vPrintAxisLocal;
varying vec3 vJointAxisView;
varying vec3 vObjNormal;
#define uPrintAxisLocal vPrintAxisLocal
${TL_SURFACE_GLSL}
// Set once in the colour chunk, read by roughness, normal and the clearcoat patch (all run after it).
float tlN26;       // coarse octave, ~4 cm: the slow mottle in a sprayed coat
float tlN180;      // fine octave, ~6 mm: orange peel and dust
float tlScuff;     // sparse blotch field where the shell is proud: the scuffs a used machine carries
float tlGrime;     // 0..1 in the crevices: what settles in a gap and never comes out
float tlPad;       // 1 on a jaw grip pad (bonded rubber on the inner face)
float tlTipT;      // 0 at a jaw's root → 1 at its tip
float tlBayer4(vec2 fc) {
  ivec2 c = ivec2(mod(fc, 4.0));
  int i = c.x + c.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
float tlDerezValue() {
  vec3 cell = floor(vWorldPos / 0.012);
  float h = clamp((vWorldPos.y - uDerezBottom) / max(uDerezTop - uDerezBottom, 1e-3), 0.0, 1.0);
  return h * 0.72 + tlHash13(cell) * 0.28;
}
// Tangent frame for the brushed servo streak: T along the joint axis projected onto the surface.
mat3 tlJointFrame(vec3 n) {
  vec3 t = vJointAxisView - n * dot(vJointAxisView, n);
  float l = length(t);
  t = l > 1e-4 ? t / l : normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  return mat3(t, cross(n, t), n);
}
`;

/**
 * Own-arm screen door (3.1): only the fragments actually about to cross the near plane go, fading in over
 * OWN_ARM_DITHER_BAND render units of view depth (0.02 = 1 cm). The rest of the viewmodel stays solid, so
 * the forearm and gripper read as a confident FPS viewmodel instead of a translucent ghost.
 */
export const OWN_ARM_DITHER_BAND = 0.02;

/** Discards for dither, de-rez, and scan; runs first in main(). */
const FRAGMENT_DISCARD = /* glsl */ `
if (uDither > 0.0) {
  float tlNearFade = 1.0 - smoothstep(0.0, ${OWN_ARM_DITHER_BAND.toFixed(3)}, vViewPosition.z);
  if (tlNearFade > 0.0 && tlBayer4(gl_FragCoord.xy) > 1.0 - uDither * tlNearFade * 0.65) discard;
}
float tlDz = tlDerezValue();
if (uDerez > 0.0 && tlDz < uDerez * 1.12 - 0.06) discard;
if (vWorldPos.y > uScanY) discard;
`;

/**
 * These arms were built, calibrated and fought with before the match started, so the wear floor is never
 * zero: `uWear` is what this round adds on top of it.
 */
export const WEAR_FLOOR = 0.24;

/** The jaw grip pads are bonded nitrile: no lacquer, no highlight — the matte end of the material range. */
export const JAW_PAD_ROUGHNESS = 0.93;

/** The shells' lacquer: the one razor-sharp highlight in the scene, sitting on a deliberately soft base. */
export const SHELL_CLEARCOAT_ROUGHNESS = 0.04;

const FRAGMENT_COLOR = /* glsl */ `
{
  float convex = max(vEdge, 0.0);
  float tlWear = ${WEAR_FLOOR.toFixed(2)} + ${(1 - WEAR_FLOOR).toFixed(2)} * uWear;
  // Jaw grip pads: a bonded rubber pad down the inner face of each jaw, worn brightest where it grips.
  tlTipT = clamp(dot(vLocalPos, uJawTip), 0.0, 1.0);
  tlPad = dot(uJawInner, uJawInner) < 0.5 ? 0.0
    : smoothstep(0.52, 0.80, dot(normalize(vObjNormal), uJawInner)) * smoothstep(0.10, 0.26, tlTipT);
  // Grime: what settles into a gap between two parts and never comes out. Present on a clean machine too.
  tlGrime = smoothstep(0.0, -0.5, vEdge);
  // Base-to-tip value gradient (5.4): one body with a business end.
  float tlT = mix(uGradT.x, uGradT.y, clamp(dot(vLocalPos, uGradAxis), 0.0, 1.0));
  diffuseColor.rgb *= mix(${GRADIENT_VALUE.mount.toFixed(2)}, ${GRADIENT_VALUE.tip.toFixed(2)}, tlT);
  diffuseColor.rgb *= 1.0 + 0.08 * convex;
  // Wear: paint on sharp edges rubs through to dark primer, crevices collect grime. Both grow through the round.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.019, 0.024), tlWear * 0.45 * smoothstep(0.30, 0.8, abs(vEdge)));
  diffuseColor.rgb *= 1.0 - (0.20 + 0.22 * tlWear) * tlGrime;
  // Scuffs: a sparse blotch field that only bites where the shell is already proud. Both octaves are
  // computed once here and read back by the roughness and normal chunks.
  tlN26 = tlNoise3(vLocalPos * 26.0);
  tlN180 = tlNoise3(vLocalPos * 180.0);
  tlScuff = smoothstep(0.62, 0.86, tlNoise3(vLocalPos * 52.0));
  float scuff = tlScuff * smoothstep(0.1, 0.5, convex);
  diffuseColor.rgb *= 1.0 - 0.18 * tlWear * scuff;
  // Paint is never laid down perfectly even, and a machine in a studio collects a fine film of dust.
  diffuseColor.rgb *= 0.90 + 0.20 * (tlN26 * 0.62 + tlN180 * 0.38);
  // Grip pad: black nitrile, sanded pale at the tip by every cube it has ever squeezed.
  if (tlPad > 0.0) {
    vec3 pad = mix(vec3(0.021, 0.022, 0.025), vec3(0.085, 0.084, 0.080), smoothstep(0.45, 1.0, tlTipT) * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, pad, tlPad);
  }
  // Entrant accent bands on the upper arm (uLinkKind 3): 1..3 narrow bands, −1 one wide band.
  if (uLinkKind > 2.5 && uLinkKind < 3.5 && uBands != 0.0) {
    float x = -vLocalPos.x;
    float band = 0.0;
    if (uBands < 0.0) band = step(0.052, x) * step(x, 0.074);
    else {
      for (int b = 0; b < 3; b++) {
        if (float(b) >= uBands) break;
        float c = 0.086 - float(b) * 0.009;
        band = max(band, step(abs(x - c), 0.0028));
      }
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor * ${PAPER_ALBEDO_SCALE.toFixed(2)}, band);
  }
}
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
{
  float tlWear = ${WEAR_FLOOR.toFixed(2)} + ${(1 - WEAR_FLOOR).toFixed(2)} * uWear;
  // The paint gets a faint orange-peel breakup only, so the clearcoat stays a clean mirror; the servos' brushed
  // streak is the anisotropy lobe (tl-shell-aniso), so their roughness only carries wear.
  roughnessFactor += (tlN180 - 0.5) * 0.13 + (tlN26 - 0.5) * 0.09
    // The arris is where the buffing wheel bears hardest and where paint is thinnest over the moulding:
    // it is the sharpest thing on the part, and that crisp edge line is what draws a machine's silhouette.
    - 0.17 * max(vEdge, 0.0)
    + 0.22 * tlWear * tlScuff
    + 0.18 * tlGrime;   // dust in a crevice never polishes
  // Metallic flake: aluminium platelets suspended in the colour coat, each one a mirror at its own angle.
  // A sparse dip in roughness is what makes paint glitter as the part turns, and it costs one noise tap.
  // Faded out once a platelet is smaller than a pixel, or the opponent's shells crawl with sampling noise.
  {
    vec3 fp = vLocalPos * 640.0;
    roughnessFactor -= 0.30 * smoothstep(0.80, 0.96, tlNoise3(fp)) * (1.0 - tlPad)
      * (1.0 - smoothstep(0.35, 1.1, max(length(fwidth(fp.xy)), abs(fwidth(fp.z)))));
  }
  // Hero, metal: the turning swirl left on the servo's machined face, fading out before it aliases.
  if (uLinkKind > 1.5 && uLinkKind < 2.5) {
    float r = length(vLocalPos.xy) * 2800.0;
    roughnessFactor += sin(r) * 0.045 * (1.0 - smoothstep(0.7, 2.2, fwidth(r)));
  }
  if (dot(uJawInner, uJawInner) > 0.5) {
    float inner = smoothstep(0.30, 0.75, dot(normalize(vObjNormal), uJawInner));
    // Fingerprints: whorl ridges of skin oil, left where a hand set the jaw and never wiped it.
    float whorl = sin(tlNoise3(vLocalPos * 210.0) * 34.0) * 0.5 + 0.5;
    roughnessFactor -= inner * (1.0 - tlPad) * whorl * 0.09;
    // Contact smears: the rubber is burnished glossy where it grips, brightest at the tip.
    roughnessFactor += tlPad * (${JAW_PAD_ROUGHNESS.toFixed(2)} - roughnessFactor) * (1.0 - 0.45 * smoothstep(0.4, 1.0, tlTipT));
  }
  roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
{
  vec3 V = normalize(vViewPosition);
  vec3 N = normalize(normal);
  float fres = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  // Team rim (5.2): a fresnel edge kicked from behind the arm's far side, so it lives on the silhouette only.
  vec3 kick = normalize((viewMatrix * vec4(uKickDir, 0.0)).xyz);
  vec3 rimTint = mix(uTeam, vec3(1.0), ${RIM_NEUTRAL.toFixed(2)});
  totalEmissiveRadiance += rimTint * pow(fres, 3.0) * uRim * (0.5 + 0.5 * max(0.0, dot(N, kick)));
  totalEmissiveRadiance += uRimFlashColor * pow(fres, 2.0) * 4.0 * uRimFlash;
  // Per-link LED (5.4): the strip is the emitter (robot-decals owns those quads); the shell only catches its
  // bounce, strongest in the crevice beside the strip where the light has nowhere to go. Paint never glows.
  vec4 led = uLed[int(uLinkIndex + 0.5)];
  totalEmissiveRadiance += led.rgb * led.a * 0.30 * (0.35 + 0.65 * tlGrime);
  // Hand charge glow (uLinkKind 1 = hand slot).
  if (uLinkKind > 0.5 && uLinkKind < 1.5 && uCharge > 0.0) totalEmissiveRadiance += uTeam * uCharge * (0.35 + 0.65 * max(vEdge, 0.2));
  // Pilot heat strip on the upper arm: team at 0, paper at 70, hazard stripes toward 100 and in Cutout.
  if (uHeatStrip > 0.5 && uLinkKind > 2.5 && uLinkKind < 3.5) {
    float x = -vLocalPos.x;
    float strip = step(0.058, x) * step(x, 0.078);
    if (strip > 0.0) {
      float h = clamp(uHeat / 100.0, 0.0, 1.0);
      vec3 base = mix(uTeam, vec3(0.92, 0.9, 0.84), smoothstep(0.0, 0.7, h));
      float hazard = step(0.7, h) + uCutout;
      float stripes = step(0.5, fract((x + vLocalPos.y) * 180.0 + uTime * 2.0));
      float pulse = 0.6 + 0.4 * sin(uTime * (uCutout > 0.5 ? 25.13 : 12.57));
      vec3 hz = mix(vec3(0.004), vec3(0.92, 0.9, 0.84), stripes) * pulse;
      totalEmissiveRadiance += mix(base, hz, clamp(hazard, 0.0, 1.0)) * 3.2;
    }
  }
  // De-rez burning edge in the team colour.
  if (uDerez > 0.0) {
    float d = tlDerezValue() - (uDerez * 1.12 - 0.06);
    totalEmissiveRadiance += uTeam * 9.0 * (1.0 - smoothstep(0.0, 0.05, d));
  }
  // Re-render scan band in signal orange just under the scan line.
  if (uScanY < 100.0) {
    float s = uScanY - vWorldPos.y;
    totalEmissiveRadiance += uScanColor * 7.0 * (1.0 - smoothstep(0.0, 0.035, s));
  }
}
`;

/**
 * Micro-relief, in metres: the moulding grain every plastic part carries, deepened in the scuffs, plus the
 * coarse texture of a bonded rubber pad. Half a hundredth of a millimetre is enough to break a flat highlight.
 */
const FRAGMENT_MICRO_NORMAL = /* glsl */ `
{
  float h = tlNoise3(vLocalPos * 780.0) * 0.00020 + tlN26 * 0.00090 + tlScuff * 0.00012;
  if (tlPad > 0.0) h += tlPad * tlNoise3(vLocalPos * 2100.0) * 0.00040;
  normal = tlBump(normal, h);
}
`;

/** three's normal chunk with the anisotropy tangent frame taken from the joint axis instead of UV derivatives (STLs have no UVs). */
const NORMAL_JOINT_FRAME = ShaderChunk.normal_fragment_begin
  .replace(/mat3 tbn = getTangentFrame\([\s\S]*?\);/, "mat3 tbn = tlJointFrame(normal);") + FRAGMENT_MICRO_NORMAL;

/**
 * Orange peel: the lacquer has a texture of its own, and it is the only thing a thick clearcoat lets you
 * see — three keeps `nonPerturbedNormal` for the coat, so relief added to the base normal never reaches the
 * highlight. Without this the shells read as moulded toy plastic however much detail is under the coat.
 */
const FRAGMENT_CLEARCOAT_NORMAL = /* glsl */ `
#ifdef USE_CLEARCOAT
clearcoatNormal = tlBump(clearcoatNormal, tlN26 * 0.00085 + tlN180 * 0.00014);
#endif
`;

/**
 * Hero, paint: the buffing streak a polishing wheel leaves in the lacquer, stretched forty to one along the
 * part's chain axis, and the grip pad where the lacquer stops altogether.
 */
const FRAGMENT_CLEARCOAT = /* glsl */ `
#ifdef USE_CLEARCOAT
{
  vec3 sp = vLocalPos * 300.0;
  sp -= uGradUnit * (dot(sp, uGradUnit) * 0.975);
  material.clearcoatRoughness = clamp(material.clearcoatRoughness + (tlNoise3(sp) - 0.5) * 0.12 + 0.30 * tlGrime
    - 0.02 * max(vEdge, 0.0), 0.01, 1.0);
  material.clearcoat *= 1.0 - tlPad;
}
#endif
`;

/** Material class kinds for the program cache key and per-link behaviour. */
export const LINK_KIND: Readonly<Record<"body" | "hand" | "servo" | "optics" | "upper_arm_body", number>> = {
  body: 0, hand: 1, servo: 2, upper_arm_body: 3, optics: 4,
};

export interface ShellLinkConstants {
  /** `uLinkKind`: which of the five material classes this (slot, link) belongs to. */
  kind: number;
  gradAxis: Vector3;
  gradUnit: Vector3;
  gradT: [number, number];
  jawInner: Vector3;
  jawTip: Vector3;
}

/**
 * The per-link constants the shell shader takes as uniforms, derived from `LINK_GRADIENT` and `JAW_GEOMETRY`.
 * `patch()` writes them as uniforms on a per-link material; the merged arm in robot-view packs the same
 * values into its `uLinkP` array. One source so the two cannot drift.
 */
export function shellLinkConstants(slot: MaterialSlot, link: LinkId): ShellLinkConstants {
  const kind = slot === "shell_hand" ? LINK_KIND.hand
    : slot === "servo" ? LINK_KIND.servo
      : slot === "optics" ? LINK_KIND.optics
        : link === "upper_arm" ? LINK_KIND.upper_arm_body : LINK_KIND.body;
  const g = LINK_GRADIENT[link];
  const axis = new Vector3(g.axis[0], g.axis[1], g.axis[2]);
  // Only the hand shells carry a jaw: the `gripper` link also holds a servo, which has no grip pad.
  const jaw = kind === LINK_KIND.hand ? JAW_GEOMETRY[link] : undefined;
  return {
    kind,
    gradAxis: axis.clone().divideScalar(g.span),
    gradUnit: axis.lengthSq() > 0 ? axis.clone().normalize() : new Vector3(1, 0, 0),
    gradT: [g.t0, g.t1],
    jawInner: new Vector3(...(jaw?.inner ?? [0, 0, 0])),
    jawTip: new Vector3(...(jaw?.tip ?? [0, 0, 0])),
  };
}

export interface ShellMaterialHandle {
  material: MeshPhysicalMaterial;
  /** Per-draw own-arm dither gate 0..1: 1 while the link's bounding sphere crosses the near-plane band. */
  dither: IUniform<number>;
}

function patch(shader: WebGLProgramParametersWithUniforms, arm: ArmUniforms, dither: IUniform<number>, link: LinkId, c: ShellLinkConstants): void {
  Object.assign(shader.uniforms, arm, {
    uDither: dither, uLinkKind: { value: c.kind }, uLinkIndex: { value: LINK_IDS.indexOf(link) },
    uGradAxis: { value: c.gradAxis }, uGradT: { value: c.gradT }, uGradUnit: { value: c.gradUnit },
    uJawInner: { value: c.jawInner }, uJawTip: { value: c.jawTip },
  });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
    .replace("#include <fog_vertex>", `#include <fog_vertex>\n${VERTEX_BODY}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
    .replace("#include <clipping_planes_fragment>", `${FRAGMENT_DISCARD}\n#include <clipping_planes_fragment>`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
    .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
    .replace("#include <normal_fragment_begin>", NORMAL_JOINT_FRAME)
    .replace("#include <clearcoat_normal_fragment_begin>", `#include <clearcoat_normal_fragment_begin>\n${FRAGMENT_CLEARCOAT_NORMAL}`)
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE}`)
    .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${FRAGMENT_CLEARCOAT}`);
}

/**
 * Pilot paint is the team colour pulled toward ink: the viewmodel sits beside the lens, and a
 * full-saturation mirror there would out-shine the opponent, which must stay the brightest thing in the
 * frame (5.1). THEATRE 2: a third was too far under a key this dark — the arm lost its hue and read as a
 * grey-blue silhouette. A fifth keeps the cobalt in the paint and still leaves the opponent ahead, because
 * what puts the opponent in front is the kicker rim (RIM_GAIN 4.0 against 2.2) and not the albedo.
 */
export const PILOT_PAINT_DEPTH = 0.20;

/**
 * Metallic-flake content of the paint. 0.45 was a half-metal, and a half-metal in a dark room is a dark
 * object: metalness scales the diffuse away and hands the light budget to a specular lobe that has an almost
 * black environment to reflect, which is exactly the "matte flat plastic" the director saw. 0.26 keeps three
 * quarters of the paint's own colour (the saturation belongs in the paint) and still leaves a broad flake
 * lobe at base roughness — that lobe, not the razor clearcoat line, is the highlight that rolls across a
 * shell as the arm swings.
 */
export const SHELL_METALNESS = 0.26;

/**
 * Reflection strength on the lacquer. The overhead softbox is the only large bright thing in the room, so
 * the coat needs to be reaching for it hard enough to draw a band down each cylinder. Tuned against
 * CALIBRATION.environmentIntensity 0.7 and key 3.2; see the handoff if the relight role moves either.
 */
// 2.05, down from 2.4. Not further: the shells are also what acceptance 3 measures as 'the brightest large
// object', so every point taken off the env is paid for by the opponent's readability against the deck.
// The relight pass raised the two vertical softboxes 6 -> 28 and logged the risk that the
// clearcoat band would blow out on hardware, naming THIS knob as the fix rather than SOFTBOX. It did blow out:
// on a real victory frame the winner's shoulder measured 0.574 mean / 0.996 max against 0.144 on its own
// forearm. SwiftShader renders no clearcoat and no bloom, which is why the sweep could not see it.
export const SHELL_ENV_INTENSITY = 2.05;
const INK = new Color(INK_700);

/** Base surface per slot (5.4): team paint shells, dark anodized servos and optics. */
export function slotSurface(slot: MaterialSlot, colorway: Colorway, seat: Seat, colorblind: boolean): { color: Color; roughness: number; metalness: number } {
  switch (slot) {
    // Metallic-flake automotive paint under a mirror clearcoat. The hand is a touch hotter so the business
    // end reads first.
    case "shell_body":
    case "shell_hand": {
      const c = new Color(teamHex(seat, colorblind));
      if (colorway === "pilot") c.lerp(INK, PILOT_PAINT_DEPTH);
      else if (colorway === "user_model") c.lerp(INK, 0.5);
      // The rival took raw team hex at full saturation on both slots, and the grade adds another 1.2x on lit
      // pixels — so the anodised servo blocks, the bolt holes and the heat strip were swamped and the shell
      // read as candy plastic. Pulling the BODY toward paper lets the material story back through; the hand
      // keeps full chroma so the business end still reads first, and RIM_GAIN carries team identity.
      else if (colorway === "rival" && slot === "shell_body") c.lerp(new Color(PAPER_200), 0.16);
      return { color: c, roughness: slot === "shell_hand" ? 0.38 : 0.44, metalness: SHELL_METALNESS };
    }
    // Machined and bead-blasted aluminium: a tight bright highlight and no lacquer over it.
    case "optics": return { color: new Color(ANODIZED), roughness: 0.20, metalness: 1 };
    // Anodised servo case: the streak is long and dim, never a point (the anisotropy lobe does the rest).
    case "servo": return { color: new Color(ANODIZED), roughness: 0.56, metalness: 0.95 };
  }
}

/**
 * The four material classes' specular signature, as the greyscale test reads them: how sharp the one
 * highlight a class shows is (1 = mirror point, 0 = none). Acceptance 3 needs these separated far enough
 * that colour is not what tells mat, metal, paint and servo apart.
 */
export function highlightSharpness(slot: MaterialSlot | "grip_pad"): number {
  if (slot === "grip_pad") return 1 - JAW_PAD_ROUGHNESS;
  // The shells' lacquer is the highlight, not the paint under it.
  if (slot === "shell_body" || slot === "shell_hand") return 1 - SHELL_CLEARCOAT_ROUGHNESS;
  return 1 - slotSurface(slot, "rival", "blaze", false).roughness;
}

/** Program cache keys of the three boot-time variants (5.4); prewarm compiles each once at mount. */
export const SHELL_PROGRAM_KEYS = { gloss: "tl-shell-gloss", servo: "tl-shell-aniso", optics: "tl-optics-irid" } as const;

/** Creates one shell material for (arm, link, slot). Materials of the same class share a program. */
export function createShellMaterial(
  slot: MaterialSlot, link: LinkId, colorway: Colorway, seat: Seat, colorblind: boolean, arm: ArmUniforms,
): ShellMaterialHandle {
  const s = slotSurface(slot, colorway, seat, colorblind);
  const dither: IUniform<number> = { value: 0 };
  const linkConst = shellLinkConstants(slot, link);
  const params = { color: s.color, roughness: s.roughness, metalness: s.metalness };
  // Three programs in total, all constructed at mount: clearcoat shells; anisotropic servos (USE_ANISOTROPY is
  // a define, so this is its own boot-time program); the iridescent lens (USE_IRIDESCENCE likewise).
  let material: MeshPhysicalMaterial;
  let cls: string;
  if (slot === "servo") {
    material = new MeshPhysicalMaterial({ ...params, anisotropy: 0.6, anisotropyRotation: Math.PI / 2, envMapIntensity: 1.4 });
    cls = SHELL_PROGRAM_KEYS.servo;
  } else if (slot === "optics") {
    material = new MeshPhysicalMaterial({ ...params, iridescence: 0.35, iridescenceIOR: 1.6, ior: 1.6, envMapIntensity: 1.4 });
    material.emissive = new Color(teamTintHex(seat, colorblind));
    material.emissiveIntensity = 0;
    cls = SHELL_PROGRAM_KEYS.optics;
  } else {
    material = new MeshPhysicalMaterial({ ...params, clearcoat: 1, clearcoatRoughness: SHELL_CLEARCOAT_ROUGHNESS, envMapIntensity: SHELL_ENV_INTENSITY });
    cls = SHELL_PROGRAM_KEYS.gloss;
  }
  material.onBeforeCompile = (shader) => patch(shader, arm, dither, link, linkConst);
  material.customProgramCacheKey = () => cls;
  return { material, dither };
}

/** Updates a material's base colour when the colorway or colourblind setting changes (no recompile). */
export function recolorShellMaterial(h: ShellMaterialHandle, slot: MaterialSlot, colorway: Colorway, seat: Seat, colorblind: boolean): void {
  h.material.color.copy(slotSurface(slot, colorway, seat, colorblind).color);
}

/** Linear team colour and the rim kicker direction into the arm uniforms. */
export function setArmTeam(arm: ArmUniforms, seat: Seat, colorblind: boolean): void {
  arm.uTeam.value.set(teamHex(seat, colorblind));
  rimKickDirRender(seat, arm.uKickDir.value);
}

/** Entrant accent bands (5.5.6): overshoot 1, backlash 2, deadband 3, jig/user model one wide band. */
export function bandsFor(driverKind: string, personality: string | null): number {
  if (driverKind === "module" || driverKind === "trajectory" || driverKind === "bridge") return -1;
  if (personality === "overshoot") return 1;
  if (personality === "backlash") return 2;
  if (personality === "deadband") return 3;
  if (personality === "jig") return -1;
  return 0;
}
