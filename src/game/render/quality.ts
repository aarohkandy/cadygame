// src/game/render/quality.ts (WP1)
// Quality tiers (EMOTION_BIBLE 10.2 step 7: DEFAULT runs MSAA 0 + SMAA, HIGH keeps MSAA 4 and DoF), the
// calibrated night-show lighting triple (5.3), and the tier controller that queues a tier change and applies it
// only at a safe moment (a phase with no round live), never mid-round. What a tier mounts in the post stack is
// decided once at boot; the controller's later verdicts only touch buffers and pass enables (post-stack.tsx).
import type { MatchPhase, Settings } from "../contracts.ts";

export type QualityTierId = "high" | "default" | "low";

export interface QualityTier {
  id: QualityTierId;
  /** Device pixel ratio cap (`null`: min(2, devicePixelRatio)). */
  dpr: number | null;
  msaa: 0 | 2 | 4;
  smaa: boolean;
  bloomLevels: number;
  ao: boolean;
  dof: boolean;
  shadowMapSize: 1024 | 2048;
  /** Holographic crowd instances (5.2: 160 on DEFAULT, a witness rather than wallpaper). */
  crowd: number;
  /** Jumbotron feed refresh (Hz, ≤ 15). */
  jumbotronHz: number;
  /** Confetti count per burst. */
  confetti: number;
  /** Overhead volumetric light shafts drawn besides the two team sweep beams (additive overdraw; 5.2: 2 on DEFAULT). */
  shafts: number;
  /**
   * Hard ceiling on rendered pixels, before the dpr ratio is applied.
   *
   * The renderer is fill-rate bound, not geometry bound: measured on an Apple M5 the whole frame costs
   * ~4–6 ms per megapixel with a ~1 ms fixed intercept, and post-processing is ~60 % of it. A ratio alone
   * cannot bound that, because the ratio multiplies a window whose size we do not control — at DEFAULT's
   * 1.25 a maximised 4K window asks for 13 Mpx. These budgets are what keeps a large window honest.
   */
  maxPixels: number;
}

export const QUALITY_TIERS: Readonly<Record<QualityTierId, QualityTier>> = {
  high: { id: "high", dpr: 1.5, msaa: 4, smaa: false, bloomLevels: 6, ao: true, dof: true, shadowMapSize: 2048, crowd: 160, jumbotronHz: 15, confetti: 300, shafts: 4, maxPixels: 4_200_000 },
  default: { id: "default", dpr: 1.25, msaa: 0, smaa: true, bloomLevels: 4, ao: true, dof: false, shadowMapSize: 1024, crowd: 160, jumbotronHz: 12, confetti: 240, shafts: 4, maxPixels: 2_400_000 },
  low: { id: "low", dpr: 1.0, msaa: 0, smaa: true, bloomLevels: 4, ao: false, dof: false, shadowMapSize: 1024, crowd: 80, jumbotronHz: 8, confetti: 140, shafts: 0, maxPixels: 1_200_000 },
};

/** The largest crowd any tier asks for; the instanced mesh is allocated at this size once. */
export const CROWD_CAPACITY = Math.max(...Object.values(QUALITY_TIERS).map((t) => t.crowd));

/**
 * Never render below this ratio, however large the window. 0.5 is the honest floor: on a 4K panel it is
 * exactly a 1080p internal buffer upscaled, which is a normal console-grade trade. Below it the HUD type
 * stops being legible, so past here the answer is a lower tier, not fewer pixels.
 */
export const MIN_DPR = 0.5;

/**
 * The pixel ratio to render a `cssW × cssH` canvas at: the tier's ratio, then clamped so the tier's pixel
 * budget is never exceeded. Pass a zero size (SSR, or a canvas that has not laid out) to get the ratio alone.
 */
export function tierDpr(tier: QualityTier, deviceDpr: number, cssW = 0, cssH = 0): number {
  const want = Math.min(tier.dpr ?? Math.min(2, Math.max(1, deviceDpr)), Math.max(1, deviceDpr));
  const area = cssW * cssH;
  if (!(area > 0)) return want;
  return Math.max(MIN_DPR, Math.min(want, Math.sqrt(tier.maxPixels / area)));
}

/* ───────────────────────── calibrated lighting (6.5) ───────────────────────── */

/**
 * The night-show lighting triple (EMOTION_BIBLE 5.3), calibrated rather than guessed and written down so nobody
 * re-tunes blind. With `Canvas flat` the renderer outputs linear HDR and the composer's ToneMapping pass (ACES
 * filmic: a real toe for deep blacks and a shoulder that rolls hot highlights off) maps it. three's physically
 * based lights give an upward Lambert surface a linear radiance of
 *   albedo / π · (key · sin(elevation) + hemisphere_sky + environment) · exposure
 * The world is dark and the fight is lit: an 18 % grey card under the key reads 0.34 display (tolerance 0.03),
 * bowl blacks sit ≤ 0.03 and specular hot spots reach ≥ 1.6 linear before ACES. Almost all of the light is the
 * key: faces it misses fall into the indigo night, and that is where the contrast comes from. The grade's
 * S-curve pivots on the card (calibratedGreyLinear) so it does not move the number. predictDisplayValue
 * reproduces the arithmetic (the unit test); ?debug=greycard reads the real frame back.
 */
export const CALIBRATION = {
  toneMapping: "aces" as "aces" | "neutral" | "agx",
  exposure: 0.7,
  /** Hard white key, camera-left and slightly behind the eye at 48°: the clearcoat streak lands on the opponent's upper links. */
  key: { color: "#F4F6FF", intensity: 3.2, elevationDeg: 48, azimuthDeg: 110 },
  /**
   * Fill is the enemy of night; the deck reflection is the fill.
   *
   * Measured, because a materials pass asked for 0.30 here to lift the vertical faces of props off black and
   * it does not work: the sky colour is 0.0205 luminance, so even at 0.30 an upward surface receives 0.0062
   * irradiance against the key's 3.2 · sin 48° = 2.38 — two and a half thousandths of the frame's light, and
   * a vertical face gets half of that. It cannot move a side face that the grade's 1.58 toe is crushing, and
   * `tests/interpolate.test.mjs` pins this number as part of the calibration triple. Left at 0.12. The lever
   * that does move a prop's dark side is the environment, a real area light, through each material's own
   * envMapIntensity: `CUBE_ENV_INTENSITY` 2.2 and `SHELL_ENV_INTENSITY` 2.4 are that lever, already pulled.
   */
  hemisphere: { sky: "#1C2352", ground: "#05060F", intensity: 0.12 },
  environmentIntensity: 0.7,
  /**
   * Cosine-weighted Lightformer radiance on an upward surface at environmentIntensity 1: the overhead softbox
   * is a 1.6 × 0.25 m streak (≈ 0.10 sr); the horizon strips add ≈ 0 upward (lighting.tsx).
   */
  environmentIrradianceEstimate: 0.1,
  /**
   * Bloom is a lens artefact, not a look (GROUNDING E, acceptance 7). The threshold sits above every lit
   * surface in the room and only real emitters cross it — but PART 2 asks it to actually bloom once it does,
   * so the gain and the spread are back up while the gate stays exactly where it was:
   *   diffuse lit surface  ≤ 0.35   the mat, the shells, the aluminium trim — never
   *   holo crowd           0.55     never
   *   THRESHOLD            0.98
   *   par-can lens         5.0      truss-rig.tsx LENS_GAIN
   *   jumbotron            3.4
   *   sparks               6      (KIND_CORE gains, sparks.ts)
   *   LED strips           10
   * The knee stays tight (0.12) so nothing creeps in under the gate. What crosses it is a filament, a screen
   * or a mirror image of one, and those are the only things allowed to flare.
   */
  bloom: { threshold: 0.98, smoothing: 0.12, intensity: 1.15, radius: 0.8 },
  /**
   * Broadcast vignette, multiplicative and applied before tone mapping: `color *= smoothstep(0.8,
   * offset · 0.799, d · (darkness + offset))`. It scales, so a black corner stays black; deep here because
   * the corners of a televised arena frame are where the true blacks live (PART 2 acceptance 1).
   *
   * 0.72 → 0.62 is the last 0.016 of PART 2 acceptance 1's mean, and it is taken here rather than out of
   * another lamp because every other lever was measured and each one costs something the frame cannot pay.
   * On one frozen cockpit frame, live: this vignette is worth +0.016 of mean for +0.009 of back wall (the
   * wall stays 13× darker than the opponent, gate 8×); a further 1.5× on the softboxes is worth +0.021 but
   * lifts the studio floor 0.32 → 0.47 against an opponent of 0.50, which would make the concrete the second
   * object in the frame brighter than the machine; another 1.15× of haze is worth +0.011 for +0.022 of back
   * wall, which spends the whole 8× ratio; and dropping `grade.contrast` to 1.40 is worth +0.006 but takes
   * the ≥ 0.85 highlight population from 0.46 % to 0.36 %, under that clause's 0.5 % floor. The ≤ 0.03 black
   * population is the one gate with room to spare — 48 % against a 5 % floor — so the vignette is where the
   * mean is cheapest, and it still leaves 43 %.
   */
  vignette: { offset: 0.24, darkness: 0.62 },
  /**
   * The grade, applied after tone mapping (post-stack.tsx GradeEffect).
   *
   * `contrast` is the exponent of a pivot-preserving filmic S: a power toe below the calibrated grey card and
   * its mirror above, both fixing the card exactly and sharing slope `contrast` there. 0 maps to 0 and 1 to 1,
   * which is how the corners reach true black and a specular hit reaches paper white while ?debug=greycard
   * still reads what predictDisplayValue says. The old curve was linear in sqrt space with an additive shadow
   * tint on top; the tint was a black lift of ≈ 0.035 display luma over the whole frame, and a frame with no
   * black in it is the flat mid-dark band the director saw.
   *
   * `shadowCool` is therefore multiplicative: shadows go cold by losing red, not by gaining blue.
   * `saturation` is rolled off in the dark (post-stack GRADE_FRAG): colour belongs to the lit machines, and
   * the air, the concrete and the bowl stay neutral.
   */
  grade: { contrast: 1.58, saturation: 1.2, shadowCool: [0.76, 0.9, 1.1] as const, highlightWarm: [1.06, 1.0, 0.9] as const },
  /**
   * Emissive authoring range for bloom sources (5.4: LED lines at 10 on the deck edges).
   *
   * `spark` is the one knob for how hot a strike spark is, and until this pass nothing read it: every
   * `KIND_CORE` intensity in `vfx/sparks.ts` was its own literal, the hit core sat at 9 in neutral white,
   * and a contact frame's twenty coincident additive streaks clipped to a colourless patch. The gains are
   * multiples of this number now, so 6 is a real 25 % cut with the ratios between the kinds intact.
   */
  emissive: { led: 10, jumbotron: 3.4, crowd: 0.55, spark: 6 },
  greycard: { target: 0.34, tolerance: 0.03, paperMax: 0.75 },
} as const;

export const PAPER_ALBEDO_SCALE = 0.5;

export function srgbEncode(linear: number): number {
  const x = Math.max(0, linear);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
export function srgbDecode(encoded: number): number {
  const x = Math.max(0, encoded);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** three's ACESFilmicToneMapping for a grey input (the input and output matrices both have unit row sums). */
export function acesToneMapGrey(v: number): number {
  const x = Math.max(0, v) / 0.6;
  const fit = (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  return Math.min(1, Math.max(0, fit));
}

/** Khronos PBR Neutral tone mapping for a grey input (three's NeutralToneMapping). */
export function neutralToneMapGrey(v: number): number {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  let x = v;
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  x -= offset;
  if (x < startCompression) return x;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (x + d - startCompression);
  const g = 1 - 1 / (desaturation * (x - newPeak) + 1);
  return newPeak * (1 - g) + newPeak * g;
}

/** Tone-mapped (display-linear, before the sRGB curve) value of a grey Lambert surface at a key-light cosine. */
export function toneMappedGrey(albedoLinear: number, keyCos: number): number {
  const c = CALIBRATION;
  const irradiance = c.key.intensity * Math.max(0, keyCos) + c.hemisphere.intensity + c.environmentIntensity * c.environmentIrradianceEstimate;
  const radiance = (albedoLinear / Math.PI) * irradiance * c.exposure;
  return c.toneMapping === "aces" ? acesToneMapGrey(radiance) : neutralToneMapGrey(radiance);
}

/** Key-light cosine of an upward surface (the deck, the card) under the calibrated key elevation. */
export function keyCosUpward(): number {
  return Math.sin((CALIBRATION.key.elevationDeg * Math.PI) / 180);
}

/** The 18 % grey card's tone-mapped value under the key: the grade's S-curve pivots here so the card does not move. */
export function calibratedGreyLinear(): number {
  return toneMappedGrey(0.18, keyCosUpward());
}

/** Predicted display value (sRGB 0..1) of a grey Lambert surface with linear albedo at a key-light cosine. */
export function predictDisplayValue(albedoLinear: number, keyCos: number): number {
  return srgbEncode(toneMappedGrey(albedoLinear, keyCos));
}

/* ───────────────────────── tier controller ───────────────────────── */

/** Phases during which a tier change may be applied (under the re-render scan or with no round live). */
const SAFE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  "boot", "title", "green_room", "round_intro", "post_match", "replay_viewer", "match_intro", "rematch_intro",
  "attract", "boot_ritual", "entrance", "round_summary", "verdict", "systems_check",
  // Pause is the best moment of all: the render loop still runs (only the clock stops), so the re-prewarm and
  // the shadow rebuild finish behind the menu — and it is exactly when a struggling player reaches for this.
  "paused",
]);

export function isSafeTierPhase(phase: MatchPhase): boolean { return SAFE_PHASES.has(phase); }

export interface QualityController {
  readonly tier: QualityTier;
  readonly queued: QualityTierId | null;
  /** Performance monitor verdicts (auto mode only). */
  decline(): void;
  incline(): void;
  /** Settings changed (explicit tier choices queue immediately). */
  syncSettings(setting: Settings["video"]["quality"]): void;
  /** Sets the auto tier from the GPU probe, before the first world frame. Ignored once a round has run. */
  seed(id: QualityTierId): void;
  /** Applies a queued tier when `phase` is safe; returns true when the tier changed. */
  applyIfSafe(phase: MatchPhase): boolean;
  subscribe(fn: () => void): () => void;
}

const ORDER: readonly QualityTierId[] = ["low", "default", "high"];

/**
 * The tier `auto` should start at, from the GPU's unmasked renderer string. Software and integrated parts
 * cannot carry DEFAULT's fill cost, and guessing DEFAULT for every machine on earth is what made `auto`
 * meaningless. `gpuTierOf` already buckets the string for telemetry; this is the same bucket, used.
 */
export function initialTierFor(gpuTier: "apple" | "discrete" | "integrated" | "unknown"): QualityTierId {
  return gpuTier === "integrated" ? "low" : "default";
}

/** The best tier `auto` may ever reach on its own. HIGH stays an explicit opt-in: it costs 1.44× the pixels
 *  of DEFAULT plus MSAA 4, and a vsync-capped 60 fps reads as headroom when it is really a ceiling. */
const AUTO_MAX: QualityTierId = "default";

export function createQualityController(initialSetting: Settings["video"]["quality"]): QualityController {
  let setting = initialSetting;
  let tier: QualityTier = QUALITY_TIERS[setting === "auto" ? "default" : setting];
  let queued: QualityTierId | null = null;
  // Monotone ratchet: every decline lowers the ceiling for the rest of the session, so the controller
  // converges downward and can never oscillate between two tiers (which is what `flipflops` used to bound).
  // ponytail: per-session and reset by a reload; persist it to settings if repeat visits should remember.
  let ceiling = setting === "auto" ? ORDER.indexOf(AUTO_MAX) : ORDER.length - 1;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of Array.from(listeners)) fn(); };
  const queue = (id: QualityTierId) => { queued = id === tier.id ? null : id; };
  return {
    get tier() { return tier; },
    get queued() { return queued; },
    decline() {
      if (setting !== "auto") return;
      const i = ORDER.indexOf(queued ?? tier.id);
      ceiling = Math.min(ceiling, i - 1);
      if (i > 0) queue(ORDER[i - 1]);
    },
    incline() {
      if (setting !== "auto") return;
      const i = ORDER.indexOf(queued ?? tier.id);
      if (i < ceiling) queue(ORDER[i + 1]);
    },
    seed(id) {
      if (setting !== "auto" || tier.id === id) return;
      // Before the first world frame, so this applies directly rather than waiting for a safe phase.
      tier = QUALITY_TIERS[id];
      ceiling = Math.min(ceiling, ORDER.indexOf(id));
      queued = null;
      notify();
    },
    syncSettings(next) {
      if (next === setting) return;
      setting = next;
      ceiling = next === "auto" ? ORDER.indexOf(AUTO_MAX) : ORDER.length - 1;
      queue(next === "auto" ? "default" : next);
    },
    applyIfSafe(phase) {
      if (!queued || !isSafeTierPhase(phase)) return false;
      tier = QUALITY_TIERS[queued];
      queued = null;
      notify();
      return true;
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/* ───────────────────────── render layers ───────────────────────── */

/** Local-only overlays (ghost arm, reticle twin): the main camera renders them, the jumbotron feed does not. */
export const LOCAL_LAYER = 4;
/** Jumbotron screens: excluded from their own feed camera. */
export const SCREEN_LAYER = 3;
