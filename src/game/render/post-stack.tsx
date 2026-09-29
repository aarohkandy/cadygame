// src/game/render/post-stack.tsx (WP1)
// The post stack (EMOTION_BIBLE 5.3, 10.2 steps 1–2, 7): half-float HDR composer rendering at priority +1 with
// N8AO, depth of field (mounted on HIGH only), mipmap bloom that only emissives and specular hot spots exceed,
// the anamorphic streak (a horizontal blur of the bloom, ADD 0.25), chromatic aberration (zero at rest), vignette,
// ACES tone mapping, the GradeEffect (a pivot-preserving filmic S on the calibrated grey card — power toe below,
// mirrored shoulder above, 0 to 0 and 1 to 1 so the frame has real blacks and real highlights — plus the
// luminance-weighted saturation, multiplicative cool shadows / warm highlights, desaturation from juice, the KO
// white flash and the impact frame) and SMAA (mounted on
// the tiers that run without MSAA). Zero programs after prewarm: what a tier mounts is decided once at boot and
// never toggled; a tier change only writes `composer.multisampling` (a buffer, not a program) and
// `N8AOPostPass.enabled` (a Pass, skipped, not recompiled). Bloom levels stay at the boot tier's value: the
// MipmapBlurPass `levels` setter disposes its two materials, which is two compiles (measured). No effect ever
// receives a changing prop and no blendFunction ever flips: postprocessing's EffectPass recompiles the merged
// program on either.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import {
  BlendFunction, Effect, ToneMappingMode,
  type BloomEffect, type ChromaticAberrationEffect, type DepthOfFieldEffect, type EffectComposer as Composer, type VignetteEffect,
} from "postprocessing";
import { useEffect, useRef, useState, type JSX } from "react";
import { Color, HalfFloatType, Uniform, Vector2, Vector3 } from "three";
import type { FeedbackFrame, FeedbackSystem } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { CALIBRATION, calibratedGreyLinear, type QualityTier } from "./quality.ts";
import { teamHex } from "./robot-materials.ts";
import { linearColor } from "./vfx/sparks.ts";

/** Frames rendered after boot (and after a tier change) before the program count is taken as the baseline. */
export const POST_PREWARM_FRAMES = 3;
/** Peak white added to the frame by the KO flash (stage-cues koFlash). */
export const KO_FLASH_PEAK = 0.55;
/** Anamorphic streak (5.3): taps each side of the pixel on the half-res bloom, and its ADD opacity. */
export const STREAK_TAPS = 6;
export const STREAK_OPACITY = 0.18;

/** WP5 publishes the per-frame feel state here once feedback-system lands it (11.9 FeedbackFrame). */
type FeedbackWithFrame = FeedbackSystem & { readonly frame?: FeedbackFrame };

const GRADE_FRAG = /* glsl */ `
uniform float uContrast;
uniform float uSaturation;
uniform float uFlash;
uniform float uPivot;
uniform float uImpact;
uniform vec3 uImpactTint;
uniform vec3 uShadowCool;
uniform vec3 uHighWarm;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Saturation belongs to the machines. The lift runs at full strength on anything the key is actually on and
  // rolls back to half in the dark, so team colour lives on the paint and the LEDs while the air, the concrete
  // and the bowl stay neutral (PART 2: "saturated colour on the machines, not smeared over the room").
  float sat = uSaturation * mix(0.5, 1.0, smoothstep(0.012, 0.20, l));
  c = clamp(mix(vec3(l), c, sat), 0.0, 1.0);
  // Pivot-preserving filmic S in a gamma-2 space: a power toe below the calibrated grey card and its mirror
  // above. Both branches map uPivot to itself and both have slope uContrast there, so the curve is C1, the
  // grey card is a fixed point whatever the contrast is, 0 stays 0 and 1 stays 1. That last part is the point:
  // the corners can reach true black and a specular hit can reach paper white without moving the card.
  vec3 s = sqrt(c);
  // The 1e-4 floors are for pow(0.0, x): the spec says 0, several drivers say NaN, and one NaN channel here
  // paints the whole frame. At this epsilon both branches still land inside a rounding error of pure 0 / 1.
  vec3 lo = uPivot * pow(max(s / uPivot, 1e-4), vec3(uContrast));
  vec3 hi = 1.0 - (1.0 - uPivot) * pow(max((1.0 - s) / (1.0 - uPivot), 1e-4), vec3(uContrast));
  s = clamp(mix(lo, hi, step(vec3(uPivot), s)), 0.0, 1.0);
  c = s * s;
  // Cool the shadows by scaling, never by adding: an additive tint is a black lift, and a lifted black is why
  // the frame had no true black in it at all.
  c *= mix(uShadowCool, vec3(1.0), smoothstep(0.0, 0.22, l));
  c *= mix(vec3(1.0), uHighWarm, smoothstep(0.30, 0.95, l));
  // Impact frame (5.7): two inverted frames tinted to the striker's team, then one at 50 %.
  float li = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, (1.0 - li) * uImpactTint, uImpact);
  c = mix(c, vec3(1.0), uFlash);
  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

/** The display-referred colour grade, run after tone mapping. Uniforms only. */
class GradeEffect extends Effect {
  constructor() {
    const g = CALIBRATION.grade;
    super("GradeEffect", GRADE_FRAG, {
      uniforms: new Map<string, Uniform>([
        ["uContrast", new Uniform(g.contrast)],
        ["uSaturation", new Uniform(g.saturation)],
        ["uFlash", new Uniform(0)],
        ["uPivot", new Uniform(Math.sqrt(calibratedGreyLinear()))],
        ["uImpact", new Uniform(0)],
        ["uImpactTint", new Uniform(new Vector3(1, 1, 1))],
        ["uShadowCool", new Uniform(new Vector3(...g.shadowCool))],
        ["uHighWarm", new Uniform(new Vector3(...g.highlightWarm))],
      ]),
    });
  }
  set(saturation: number, flash: number, impact: number, tint: Color): void {
    this.uniforms.get("uSaturation")!.value = saturation;
    this.uniforms.get("uFlash")!.value = flash;
    this.uniforms.get("uImpact")!.value = impact;
    (this.uniforms.get("uImpactTint")!.value as Vector3).set(tint.r, tint.g, tint.b);
  }
}

const STREAK_FRAG = /* glsl */ `
uniform sampler2D uBloom;
uniform vec3 uTint;
uniform float uTexel;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 s = vec3(0.0);
  for (int i = 1; i <= ${STREAK_TAPS}; i++) {
    float w = 1.0 - float(i) / float(${STREAK_TAPS + 1});
    float dx = float(i) * uTexel;
    s += (texture2D(uBloom, uv + vec2(dx, 0.0)).rgb + texture2D(uBloom, uv - vec2(dx, 0.0)).rgb) * w;
  }
  // Σ weights = 2 · Σ (1 − i/(N+1)) = N.
  outputColor = vec4(s / float(${STREAK_TAPS}) * uTint, inputColor.a);
}
`;

/** Anamorphic streak: a 2·STREAK_TAPS-tap horizontal blur of the half-res bloom, added at STREAK_OPACITY, tinted. */
class StreakEffect extends Effect {
  constructor() {
    super("StreakEffect", STREAK_FRAG, {
      blendFunction: BlendFunction.ADD,
      uniforms: new Map<string, Uniform>([
        ["uBloom", new Uniform(null)],
        ["uTint", new Uniform(new Vector3(1, 1, 1))],
        ["uTexel", new Uniform(1 / 640)],
      ]),
    });
    this.blendMode.opacity.value = STREAK_OPACITY;
  }
  override setSize(width: number): void {
    // The bloom texture is half resolution; one of its texels is two framebuffer pixels wide.
    this.uniforms.get("uTexel")!.value = 2 / Math.max(1, width);
  }
  bind(bloom: BloomEffect, tint: Color): void {
    const u = this.uniforms.get("uBloom")!;
    if (u.value !== bloom.texture) u.value = bloom.texture;
    (this.uniforms.get("uTint")!.value as Vector3).set(tint.r, tint.g, tint.b);
  }
}

/**
 * CALIBRATION.exposure was in the grey-card arithmetic and in nothing else: the renderer ran at 1.0, so every
 * frame was 1/0.7 brighter than quality.ts claimed and ?debug=greycard read 0.479 against a predicted 0.347
 * (18 % card, ACES, key 3.2 at 48°). three's ACESFilmicToneMapping — which postprocessing's ToneMappingEffect
 * includes verbatim — multiplies by `toneMappingExposure`, and WebGLRenderer uploads that uniform to every
 * program on a material refresh, so setting it here is what actually applies the exposure. The forward pass is
 * NoToneMapping (`Canvas flat`) and never reads it, so nothing is exposed twice, and bloom thresholds are
 * measured before tone mapping and so are unmoved.
 */
function applyExposure(gl: { toneMappingExposure: number }): void {
  gl.toneMappingExposure = CALIBRATION.exposure;
}

/** MSAA for a tier on a stack that mounted (or did not mount) SMAA at boot: never both off. */
export function runtimeMsaa(tier: QualityTier, smaaMounted: boolean): number {
  return tier.msaa === 0 && !smaaMounted ? 2 : tier.msaa;
}

export function PostStack(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const gl = useThree((s) => s.gl);
  // Mount decisions are taken once from the boot tier; later tiers are applied imperatively (see the header).
  const [boot] = useState<QualityTier>(() => rt.quality.tier);
  const composer = useRef<Composer | null>(null);
  const ca = useRef<ChromaticAberrationEffect | null>(null);
  const vignette = useRef<VignetteEffect | null>(null);
  const dof = useRef<DepthOfFieldEffect | null>(null);
  const bloom = useRef<BloomEffect | null>(null);
  const n8ao = useRef<{ enabled: boolean } | null>(null);
  const [caOffset] = useState(() => new Vector2(0, 0));
  const [grade] = useState(() => new GradeEffect());
  const [streak] = useState(() => new StreakEffect());
  const [impactTint] = useState(() => new Color(1, 1, 1));
  const [streakTint] = useState(() => new Color(1, 1, 1));
  const [white] = useState(() => new Color(1, 1, 1));

  useEffect(() => {
    const apply = () => {
      const tier = rt.quality.tier;
      if (composer.current) composer.current.multisampling = runtimeMsaa(tier, boot.smaa);
      if (n8ao.current) n8ao.current.enabled = tier.ao;
    };
    apply();
    return rt.quality.subscribe(apply);
  }, [rt, boot]);
  useEffect(() => { applyExposure(gl); }, [gl]);
  useEffect(() => () => { grade.dispose(); streak.dispose(); }, [grade, streak]);

  useFrame(() => {
    const game = rt.game;
    const juice = game.feedback.juice;
    const s = game.settings.get();
    const effects = s.video.effects01 * (s.access.reducedMotion ? 0 : 1);
    const frame = (game.feedback as FeedbackWithFrame).frame;
    // 11.9 lensSmear (a heavy hit taken, τ 6 s): the lens bleeds at the edges, no new program (chromatic + vignette).
    const smear = frame ? frame.lensSmear * effects : 0;
    const off = (juice.chromaticOffset + 0.0035 * smear) * effects;
    caOffset.set(off, off);
    if (ca.current) ca.current.offset = caOffset;
    if (vignette.current) vignette.current.darkness = CALIBRATION.vignette.darkness + (juice.vignetteBoost + 0.12 * smear) * effects;
    const desat = Math.min(1, juice.desaturate * effects);
    const impact = frame ? Math.min(1, Math.max(0, frame.impactFrame)) * effects : 0;
    if (frame && impact > 0) impactTint.copy(linearColor(teamHex(frame.hitLight.seat, rt.colorblind())));
    grade.set(CALIBRATION.grade.saturation * (1 - desat), KO_FLASH_PEAK * rt.vfx.cues.koFlash(rt.wallMs()) * effects, impact, impact > 0 ? impactTint : white);
    // Streak tint: white at rest; a hit taken leans it to the attacker's colour with the damage edge.
    const edge = juice.edge;
    const lean = Math.min(1, Math.max(edge.left, edge.right, edge.top));
    streakTint.copy(white);
    if (lean > 0) streakTint.lerp(linearColor(edge.color), lean * 0.6);
    if (bloom.current) streak.bind(bloom.current, streakTint);
    if (dof.current) dof.current.bokehScale = game.director.cameraMode === "cockpit" ? 2 : 0;
  }, 0.9);

  const toneMode = CALIBRATION.toneMapping === "aces" ? ToneMappingMode.ACES_FILMIC : CALIBRATION.toneMapping === "agx" ? ToneMappingMode.AGX : ToneMappingMode.NEUTRAL;
  return (
    <EffectComposer
      ref={(c) => {
        composer.current = c;
        if (process.env.NODE_ENV !== "production") (globalThis as Record<string, unknown>).__tlComposer = c;
      }}
      multisampling={runtimeMsaa(boot, boot.smaa)}
      frameBufferType={HalfFloatType}
      enableNormalPass={false}
      renderPriority={1}
    >
      {/* Contact occlusion, not an ambient wash (GROUNDING B): 0.12 render units is ≈ 5.8 cm of sim, so the
          darkening under an arm base, a cube or the Core is tight to the contact and gone within a few
          centimetres, which is what plants an object. The old 0.35 radius spread it into a soft grey halo
          that read as fog. Constant props: nothing here recompiles. */}
      <N8AO ref={n8ao} enabled={boot.ao} halfRes aoRadius={0.12} intensity={2.6} distanceFalloff={0.6} quality="performance" />
      {boot.dof ? <DepthOfField ref={dof} worldFocusDistance={0.9} worldFocusRange={1.2} bokehScale={2} /> : null}
      <Bloom
        ref={bloom}
        mipmapBlur
        luminanceThreshold={CALIBRATION.bloom.threshold}
        luminanceSmoothing={CALIBRATION.bloom.smoothing}
        intensity={CALIBRATION.bloom.intensity}
        radius={CALIBRATION.bloom.radius}
        levels={boot.bloomLevels}
      />
      <primitive object={streak} />
      <ChromaticAberration ref={ca} offset={caOffset} radialModulation modulationOffset={0.25} />
      <Vignette ref={vignette} offset={CALIBRATION.vignette.offset} darkness={CALIBRATION.vignette.darkness} eskil={false} />
      <ToneMapping mode={toneMode} />
      <primitive object={grade} />
      {boot.smaa ? <SMAA /> : null}
    </EffectComposer>
  );
}
