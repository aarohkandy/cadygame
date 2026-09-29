// src/game/render/lighting.tsx (ROLE LIGHT, GROUNDING E)
// The studio's light rig: three real lights, one shadow map, and — new in the grounding pass — the truss that
// holds the lamps (truss-rig.tsx), so every pool on the deck arrives from a fixture you can point at.
//
//   - Key `DirectionalLight` (quality.ts CALIBRATION: 3.2 at 48° elevation, azimuth 110°), the one shadow
//     caster and the one light that defines form: at 48° the specular roll crosses the upper two links of both
//     arms, so curvature reads before colour does. Its lamp is a real can on the truss — RIG entry 3, aimed
//     14° off the calibrated key axis (truss-rig.tsx). The two are wired together on purpose.
//   - Hemisphere 0.12: fill is the enemy of night, and flat coloured fill is what made the old frames cheap.
//   - Environment rig at 0.7: one narrow white streak overhead (0.8 × 0.25 m at radiance 4.0) — the truss
//     lamp bar read as one soft source, and the only environment term that lights an upward surface, so the grey-card
//     arithmetic in quality.ts stays exactly true. Flanking it, two tall white softboxes at shell height
//     (SOFTBOX, 28.0), vertical and so contributing nothing upward: they are what a curved shell sees edge-on,
//     they are the white specular rim that separates an arm from the room and rolls along it as it swings, and
//     they are the only light in this file that reaches a machine without also landing on the deck. The horizon
//     strips stay a glint (0.45 / 0.3): a hint of coloured bounce off the bowl, never a light in their own right.
//   - The hit `PointLight` is mounted at 0 by vfx-system and never added or removed.
//
// Four lit fixtures, four beams, no wandering. Par cans do not sweep: the two team lamps and the two overhead
// shafts are clamped, panned, tilted and left. They are LED pars, so they change colour on a KO cue and ride
// the house level, and the haze drifting through them is what moves. Each beam's apex is the aperture of its
// own can (LIT_FIXTURES), and each deck pool is that beam meeting the mat, so cone, pool and fixture cannot
// drift apart. Fog is deep indigo, near 3.4 render units — past the far edge of the deck and both arms' full
// reach, so the fight is never hazed — far 7.0, which leaves the bowl and the crowd navy and black.
//
// The show still follows stage-cues: the reveal (entrance → count-in) is key 0.3 / hemisphere 0 with only the
// opponent's lamp struck; FIGHT slams the key to full; both team lamps go to the winner's colour on a KO.
"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import { Color, DirectionalLight, HemisphereLight } from "three";
import { REFLECTION_LAYER, RENDER_SCALE, TOKEN_HEX, type Seat, type Vec3 } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { CYC_UNIFORMS } from "./cyclorama.tsx";
import { simToRenderPos } from "./interpolate.ts";
import { CALIBRATION } from "./quality.ts";
import { teamHex } from "./robot-materials.ts";
import { SHADOW_LAYER } from "./shadow-proxies.ts";
import { DECK_SWEEP_UNIFORMS } from "./stage-deck.tsx";
import { LENS_GAIN, LIT_FIXTURES, TRUSS_LENS, TrussRig } from "./truss-rig.tsx";
import { createLightShafts } from "./vfx/haze.ts";
import { isRevealPhase } from "./vfx/stage-cues.ts";

/**
 * Scene fog, render units (RENDER_SCALE = 2.05, so these are 1.66 m and 3.41 m). `near` sits past the whole
 * deck and both arms at full extension: haze belongs to the beams and to the room behind them, never to the
 * fight. `far` keeps the stands inside the fog so the bowl stays a dark band (holo-crowd takes 60 % of it).
 */
export const FOG = { color: "#0B0D26", near: 3.4, far: 7.0 } as const;
/**
 * Volumetric beam strength (additive, linear HDR) for the 2.0 m throw the rigged cans actually have. Up from
 * 0.3 / 0.12: with the cone shader drawing a solid shaft instead of a hollow outline (haze.ts) these are the
 * levels at which the air in the room reads, which is what puts a plane between the opponent and the back
 * wall. They stay far under the bloom gate — haze is lit air, not an emitter.
 *
 * 0.62 / 0.34 → 0.74 / 0.41 is a deliberate 1.2×, and 1.2 is the ceiling rather than a preference. Haze is by
 * far the cheapest lift the frame's mean has (a live gain sweep on one frozen cockpit frame: ×1.2 mean
 * +0.011, ×1.5 +0.031, ×2.5 +0.109) — but the beams cross the back wall, so the wall's measured luminance is
 * the haze in front of it, and PART 2 acceptance 3 wants the wall 8× darker than the opponent. On the same
 * frame the wall reads 0.021 at ×1, 0.043 at ×1.2, 0.085 at ×1.5 and 0.229 at ×2.5, against an opponent of
 * 0.41–0.43: ×1.2 leaves 9×, ×1.5 leaves 5× and fails. Raise these only in step with the opponent.
 */
export const BEAM = { team: 0.74, shaft: 0.41 } as const;
/** Reveal levels (2, 5.3): key 0.3 absolute, hemisphere 0, the opponent's lamp at full on its mount. */
export const REVEAL = { key: 0.3, hemisphere: 0 } as const;
/**
 * Deck-projected pool strength (linear, before 1/d² in sim metres) and cone half-angle (rad). A par can throws
 * a 0.82 m pool from 2.04 m at this angle — two pools that cover the working area of a 1.10 m deck and leave
 * its corners in shadow, which is what tells the eye the deck has corners. The strength is what sets how far
 * apart the lit lanes and those corners sit: the mat is black rubber, so the pool is the only thing that lifts
 * it off the floor of the histogram, and everything outside the two cones falls away to true black.
 */
// Flown wider and turned down together, at constant flux: 16 x 0.20^2 ~= 7.1 x 0.30^2. That spreads the same
// energy over 2.25x the area and takes the on-axis peak down 2.25x, which is what a rigger does with a wider
// lens. It is NOT the "dim the deck" lever STATUS.md forbids - the lit lane keeps its energy, only its hot
// centre comes down. On a real GPU that centre measured 0.714 against an opponent of 0.413, so the deck was
// out-reading the machines and PART 2 acceptance 3 was failing on hardware while passing on SwiftShader.
// POOL_COS in stage-deck.tsx is a hand-copied duplicate of these angles and MUST move with them, or the haze
// cone and the pool it makes stop being the same fixture.
export const POOL = { strength: 7.1, angle: 0.3, innerAngle: 0.18 } as const;

/**
 * How much team colour is in the two key-fill pars. A studio keys a subject with white and spends colour on
 * the background; the old rig ran both pars at full saturation and flooded half the deck each, which is why
 * the arms read as flat coloured fill and the deck out-shone them. 0.30 leaves enough gel to tell the two
 * halves apart and lets the shells' own paint and the specular roll do the work. A KO pulse overrides it —
 * an LED par can saturate on a cue, and that is the one moment it should.
 */
// Colour should be bounced albedo, not gelled lamps: it belongs to the objects, not the room. At 0.30 the two
// team-gelled pars washed half the deck pink and half blue; 0.18 keeps the coloured edge but lets the paint,
// the LED strips and the deck lines carry team identity. The KO pulse overrides this, so the cue still saturates.
export const TEAM_GEL = 0.18;

/**
 * Radiance of the two tall white softboxes flanking the deck at shell height — the kicker that lights the
 * machines, and the one lever in this file that reaches the arms without touching the deck.
 *
 * Measured, not guessed. Three things light an arm: the key, the hemisphere and the environment. The
 * hemisphere is dead (0.12 → 0.6 on a live frame moved the opponent 0.3922 → 0.3922, and quality.ts already
 * says why), the key is pinned by `tests/interpolate.test.mjs` along with the rest of the grey-card triple,
 * and the deck's two par-can pools are an analytic cone that only the mat, the studio floor and the clutter
 * cubes evaluate — the arms standing in those pools are not in them (see the handoff in STATUS). That leaves
 * the environment, and of the environment only these two: they are vertical, so they put nothing on an
 * upward surface, which is why raising them moves a curved painted shell and leaves both the grey card and
 * `environmentIrradianceEstimate` exactly where quality.ts computes them. 6.0 → 28.0 is the size of the lift
 * the frame needed; the horizon glints and the overhead lamp bar are deliberately NOT scaled with it,
 * because the first two are coloured (the room must not flood with team colour) and the third is the one
 * environment term the calibration accounts for.
 */
export const SOFTBOX = 28.0;

/** The two team lamps: RIG entries 0 and 1, aimed at a band behind each seat's mount. */
export const SWEEPS: readonly { seat: Seat; lamp: Vec3; aim: Vec3 }[] = LIT_FIXTURES.slice(0, 2).map((f, i) => ({
  seat: (f.seat ?? (i === 0 ? "atlas" : "blaze")) as Seat,
  lamp: f.lamp,
  aim: f.aim,
}));

/** The two overhead shafts: RIG entries 2 (the key's lamp, hard white) and 3 (volt), radius 0.16 m. */
export const SHAFTS: readonly { lamp: Vec3; aim: Vec3; radius: number; hex: string }[] = LIT_FIXTURES.slice(2, 4).map((f, i) => ({
  lamp: f.lamp,
  aim: f.aim,
  radius: 0.16,
  hex: i === 0 ? CALIBRATION.key.color : TOKEN_HEX.volt,
}));

/**
 * How far below the house level the bowl sits. The squint test (GROUNDING acceptance 1) wants deck, arms,
 * barrier, floor, crowd in that order of brightness; before this the cyclorama's tier fascias and haze band
 * ran at the same level as the fight and the background won.
 */
export const BOWL_LEVEL = 0.45;

const WHITE = new Color(1, 1, 1);

/** Key light direction (sim) from the calibrated azimuth and elevation. */
export function keyDirectionSim(out: Float64Array): Float64Array {
  const el = (CALIBRATION.key.elevationDeg * Math.PI) / 180;
  const az = (CALIBRATION.key.azimuthDeg * Math.PI) / 180;
  out[0] = Math.cos(el) * Math.cos(az); out[1] = Math.cos(el) * Math.sin(az); out[2] = Math.sin(el);
  return out;
}

// A shadow map cannot be resized in place. WebGLShadowMap builds the pair — the colour render target and the
// DepthTexture attached to it — only in its `shadow.map === null` branch, and RenderTarget.setSize() resizes
// `textures[i].image` while never touching `depthTexture.image`. The two attachments then disagree, the
// shadow framebuffer comes back FRAMEBUFFER_INCOMPLETE_DIMENSIONS, and every draw of the shadow pass fails
// with GL_INVALID_FRAMEBUFFER_OPERATION for as long as the tier stays changed. Dropping the target instead
// lets three rebuild both attachments at the new size.
//
// Dropping it is safe here only because a null map is always refilled before anything samples it: this runs
// from the quality subscription at frame priority 0, markShadows() raises needsUpdate at 0.4, and the
// jumbotron feed pass at 0.5 (when it runs) re-raises it whenever a caster is unprimed. Without those gates three binds its
// shared empty shadow texture, which setValueT1Array leaves without a compare function, and a sampler2DShadow
// reading a depth texture with compare mode off is the other way ANGLE rejects the draw.
function applyShadowSize(key: DirectionalLight, size: number): void {
  if (key.shadow.mapSize.x === size) return;
  key.shadow.mapSize.set(size, size);
  if (key.shadow.map !== null) {
    key.shadow.map.dispose();
    key.shadow.map = null;
  }
}

function buildLights() {
  const p = new Float64Array(3);
  const key = new DirectionalLight(CALIBRATION.key.color, CALIBRATION.key.intensity);
  key.name = "key";
  keyDirectionSim(p);
  simToRenderPos(p[0] * 3, p[1] * 3, p[2] * 3, p);
  key.position.set(p[0], p[1], p[2]);
  key.target.position.set(0, 0.1, 0);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.012;
  const cam = key.shadow.camera;
  cam.left = -1.4; cam.right = 1.4; cam.top = 1.4; cam.bottom = -1.4; cam.near = 0.5; cam.far = 14;
  cam.layers.enable(SHADOW_LAYER);
  cam.updateProjectionMatrix();
  const hemi = new HemisphereLight(CALIBRATION.hemisphere.sky, CALIBRATION.hemisphere.ground, CALIBRATION.hemisphere.intensity);
  hemi.name = "hemisphere";
  // The deck mirror renders REFLECTION_LAYER only (5.4); the lights must be on it or the mirrored arms go black.
  key.layers.enable(REFLECTION_LAYER);
  hemi.layers.enable(REFLECTION_LAYER);
  const shafts = createLightShafts(SWEEPS.length + SHAFTS.length);
  return {
    key, hemi, shafts,
    /** Team colours (linear), refreshed when colour-blind mode changes. */
    team: [new Color(), new Color()] as const,
    shaftColors: SHAFTS.map((sh) => new Color(sh.hex)),
    beamColor: new Color(),
    colorblind: null as boolean | null,
    hype: 0,
    lamp: new Float64Array(3),
    land: new Float64Array(3),
  };
}
type Built = ReturnType<typeof buildLights>;

function syncTeamColours(b: Built, colorblind: boolean): void {
  if (b.colorblind === colorblind) return;
  b.colorblind = colorblind;
  b.team[0].set(teamHex("atlas", colorblind));
  b.team[1].set(teamHex("blaze", colorblind));
}

/**
 * Drives beam `i`: its cone (apex at the can's aperture, landing where the aim meets the deck), its lens, and
 * — for the two team lamps — the deck pool the mat shader paints. `level` 0 is the lamp not struck: cone, pool
 * and lens all go dark together, because they are one fixture. `coneRadius` null takes the pool's half-angle.
 */
function driveBeam(b: Built, i: number, lamp: Vec3, aim: Vec3, coneRadius: number | null, color: Color, level: number, gain: number, pool: boolean): void {
  // Where the aim meets the mat (sim z = 0). Guarded: a can aimed level never lands, so cap the throw.
  const t = aim[2] < -1e-3 ? -lamp[2] / aim[2] : 3;
  simToRenderPos(lamp[0], lamp[1], lamp[2], b.lamp);
  simToRenderPos(lamp[0] + aim[0] * t, lamp[1] + aim[1] * t, lamp[2] + aim[2] * t, b.land);
  const len = Math.hypot(b.land[0] - b.lamp[0], b.land[1] - b.lamp[1], b.land[2] - b.lamp[2]);
  const radius = coneRadius ?? len * Math.tan(POOL.angle) * 0.8;
  b.shafts.set(i, b.lamp[0], b.lamp[1], b.lamp[2], b.land[0], b.land[1], b.land[2], radius, color, gain * level);
  TRUSS_LENS.color[i].copy(color).multiplyScalar(LENS_GAIN * level);
  if (!pool) return;
  const u = DECK_SWEEP_UNIFORMS;
  u.uPoolLamp.value[i].set(b.lamp[0], b.lamp[1], b.lamp[2]);
  u.uPoolAxis.value[i].set(b.land[0] - b.lamp[0], b.land[1] - b.lamp[1], b.land[2] - b.lamp[2]).normalize();
  u.uPoolColor.value[i].copy(color).multiplyScalar(POOL.strength * level);
}

/** One frame of the show: house level, the reveal, the four struck lamps, the key, the bowl uniforms. */
function runShow(b: Built, rt: StageRuntime, dt: number): void {
  const now = rt.wallMs();
  const cues = rt.vfx.cues;
  syncTeamColours(b, rt.colorblind());
  const slam = cues.slam(now);
  const house = cues.houseLevel(now) * cues.lampLevel;
  b.hype += (Math.max(0, Math.min(1, rt.game.feedback.audio.hype)) - b.hype) * Math.min(1, dt * 3);
  const reveal = isRevealPhase(rt.game.director.phase) && slam <= 0;

  b.key.intensity = reveal ? REVEAL.key : CALIBRATION.key.intensity * (0.45 + 0.55 * Math.min(1, house) + 0.25 * slam);
  b.hemi.intensity = reveal ? REVEAL.hemisphere : CALIBRATION.hemisphere.intensity;

  // KO and lock: both team lamps go to the pulse colour (the winner's, or volt) while it rings. An LED par
  // changes colour where a tungsten can could not, and these are LED pars.
  const pulse = Math.min(1, cues.ledPulse(now) * 1.4);
  const opponent: Seat = rt.game.pilot.seat === "atlas" ? "blaze" : "atlas";
  for (let i = 0; i < SWEEPS.length; i++) {
    const sw = SWEEPS[i];
    b.beamColor.copy(b.team[i]).lerp(cues.pulseColor, pulse).lerp(WHITE, (1 - TEAM_GEL) * (1 - pulse));
    // The reveal strikes only the opponent's lamp; nothing is added to or removed from the scene.
    const level = reveal ? (sw.seat === opponent ? 1 : 0) : house;
    driveBeam(b, i, sw.lamp, sw.aim, null, b.beamColor, level, BEAM.team, true);
  }
  const wallS = now / 1000;
  for (let i = 0; i < SHAFTS.length; i++) {
    const sh = SHAFTS[i];
    // The haze in the beam thins and thickens; the lamp itself is bolted down and does not breathe.
    const breathe = 0.9 + 0.1 * Math.sin(wallS * 0.5 + i * 1.3);
    driveBeam(b, SWEEPS.length + i, sh.lamp, sh.aim, sh.radius * RENDER_SCALE, b.shaftColors[i], reveal ? 0 : house * breathe, BEAM.shaft, false);
  }
  b.shafts.update(wallS);

  CYC_UNIFORMS.uTime.value = wallS % 1000;
  CYC_UNIFORMS.uLevel.value = reveal ? 0 : house * BOWL_LEVEL;
  CYC_UNIFORMS.uHype.value = b.hype;
}

export function StudioLighting(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const scene = useThree((s) => s.scene);
  const built = useMemo(() => buildLights(), []);

  useEffect(() => {
    scene.add(built.key.target);
    return () => {
      scene.remove(built.key.target);
      built.shafts.dispose();
    };
  }, [scene, built]);

  useEffect(() => {
    const apply = () => {
      applyShadowSize(built.key, rt.quality.tier.shadowMapSize);
      // The budget covers the team sweeps too, not just the overheads: the cockpit eye sits INSIDE the two
      // team cones, so they are the expensive ones. `2 + min(2, shafts)` made every tier draw all four.
      built.shafts.setCount(Math.min(SWEEPS.length + SHAFTS.length, rt.quality.tier.shafts));
    };
    apply();
    return rt.quality.subscribe(apply);
  }, [rt, built]);

  useFrame((_, dt) => runShow(built, rt, Math.min(dt, 0.1)), 0);

  return (
    <>
      <primitive object={built.key} />
      <primitive object={built.hemi} />
      <primitive object={built.shafts.mesh} />
      <TrussRig />
      <fog attach="fog" args={[new Color(FOG.color), FOG.near, FOG.far]} />
      <Environment resolution={256} frames={1} environmentIntensity={CALIBRATION.environmentIntensity}>
        {/* The lamp bar overhead: 0.8 × 0.25 m at 2 m, radiance 4.0. Half the solid angle at twice the
            radiance of the old 1.6 × 0.25 streak, so L·Ω — the whole of the environment's upward irradiance,
            and the only environment term quality.ts's grey-card arithmetic accounts for — is unchanged, while
            the clearcoat reflection of it on a shell is twice as bright and half as wide. That is the
            difference between a wash and a specular roll that tells you the shell is curved (GROUNDING E). */}
        <Lightformer form="rect" intensity={4.0} color="#FFFFFF" scale={[0.8, 0.25, 1]} position={[0, 2, 0]} rotation={[Math.PI / 2, 0, 0]} />
        {/* The two studio softboxes flanking the deck at shell height: tall, narrow, white and hot. A vertical
            rect contributes essentially nothing to the irradiance of an upward surface, so the grey card and
            quality.ts's arithmetic do not move — but a curved painted shell sees them edge-on, and that is the
            rim of white specular that separates an arm from the room and rolls along it as the arm swings
            (PART 2 items 1 and 2). Neutral on purpose: the colour belongs to the paint, not to the air. */}
        <Lightformer form="rect" intensity={SOFTBOX} color="#FFFFFF" scale={[0.35, 1.1, 1]} position={[-2.6, 0.55, 0.4]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={SOFTBOX} color="#FFFFFF" scale={[0.35, 1.1, 1]} position={[2.6, 0.55, -0.4]} rotation={[0, -Math.PI / 2, 0]} />
        {/* Coloured bounce off the bowl behind each seat: a glint on a vertical edge, not a light. */}
        <Lightformer form="rect" intensity={0.45} color={TOKEN_HEX.cobalt} scale={[1.8, 0.12, 1]} position={[-6, 1.2, 0]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={0.45} color={TOKEN_HEX.magenta} scale={[1.8, 0.12, 1]} position={[6, 1.2, 0]} rotation={[0, -Math.PI / 2, 0]} />
        {/* The pilot's own console, behind the eye: a warm kick in the reflections of their gripper. */}
        <Lightformer form="rect" intensity={0.3} color={TOKEN_HEX.volt} scale={[1.8, 0.12, 1]} position={[-4, 0.3, 0]} rotation={[0, Math.PI / 2, 0]} />
      </Environment>
    </>
  );
}
