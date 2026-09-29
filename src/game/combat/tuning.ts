// src/game/combat/tuning.ts (WP5)
// Every combat number in one place (GAME_DESIGN 2.4, 2.5, 4.2–4.9, 8.1). The whole table is recorded in each episode's
// meta (`tuning` + `tuningSha256`), so a number changed here is visible in every recording made with it.
// `scripts/bench-physics.mjs` measures and rewrites the block between the bench markers (vRef and v_free).
import {
  DOCK_RADIUS,
  type GameEvent, type HitstopMsFor, type LinkId, type LoadoutId, type MatchPreset, type AbilityId,
} from "../contracts.ts";

/* ───────────────────────── measured by scripts/bench-physics.mjs ───────────────────────── */
// <bench:measured>
/** Peak gripperframe speed (m/s) of the canonical hook per physics profile (4.2). */
export const MEASURED_VREF = { whip: 3.141, pivot: 2.893, anvil: 2.685, stock: 1.625 } as const;
/** Free-space joint speed (rad/s) while |error| passes each bin (4.6 knockback), per profile, per arm joint 0–4. */
export const MEASURED_VFREE = {
  errorBins: [0.35, 0.5, 0.7, 1, 1.4],
  whip: [[10.641, 10.385, 10.012, 9.036, 6.377], [10.504, 10.202, 9.738, 8.766, 6.133], [10.136, 9.93, 9.588, 8.773, 6.19], [7.007, 9.014, 10.713, 9.875, 7.024], [11.109, 10.937, 10.568, 9.71, 7.044]],
  pivot: [[9.257, 9.106, 8.837, 8.163, 5.911], [9.14, 8.942, 8.637, 7.92, 5.847], [8.81, 8.708, 8.482, 7.954, 5.875], [5.536, 7.707, 9.294, 8.719, 6.459], [9.457, 9.363, 9.154, 8.616, 6.452]],
  anvil: [[8.538, 8.398, 8.127, 7.491, 5.429], [8.452, 8.283, 7.99, 7.318, 5.263], [8.239, 8.103, 7.875, 7.337, 5.37], [5.455, 7.181, 8.414, 7.782, 5.66], [8.675, 8.555, 8.313, 7.756, 5.636]],
  stock: [[4.784, 4.767, 4.725, 4.563, 3.672], [4.669, 4.578, 4.439, 4.193, 3.361], [4.223, 4.201, 4.176, 4.107, 3.419], [2.139, 3.903, 4.965, 4.845, 3.968], [4.803, 4.795, 4.768, 4.669, 3.858]],
} as const;
// </bench:measured>

/* ───────────────────────── servo parameters (4.6, 4.8, 4.10) ───────────────────────── */

export interface ServoParams { kp: number; kv: number; tauMax: number; damping: number; armature: number }

/** Stock Menagerie STS3215 class (so101.xml). Every stock preset runs exactly this. */
export const STOCK_SERVO: Readonly<ServoParams> = Object.freeze({ kp: 998.22, kv: 2.731, tauMax: 2.94, damping: 0.6, armature: 0.028 });
/** Absolute torque cap on any composed Arcade profile (N·m). */
export const TAU_CAP_NM = 8.0;

export interface LoadoutDef extends ServoParams {
  integrity: number; dmg: number; heat: number; staggerRecv: number; ability: AbilityId;
}

export const LOADOUTS: Readonly<Record<LoadoutId, Readonly<LoadoutDef>>> = Object.freeze({
  whip: Object.freeze({ kp: 998.22, kv: 2.731, tauMax: 4.998, damping: 0.42, armature: 0.0224, integrity: 85, dmg: 1.08, heat: 0.9, staggerRecv: 1.3, ability: "snap" as const }),
  pivot: Object.freeze({ kp: 998.22, kv: 4.097, tauMax: 5.88, damping: 0.6, armature: 0.028, integrity: 100, dmg: 1.0, heat: 1.0, staggerRecv: 1.0, ability: "recoil_coil" as const }),
  anvil: Object.freeze({ kp: 998.22, kv: 5.462, tauMax: 7.644, damping: 0.84, armature: 0.0504, integrity: 115, dmg: 0.94, heat: 1.15, staggerRecv: 0.7, ability: "bulwark" as const }),
});

/* ───────────────────────── scoring (4.2, 4.3) ───────────────────────── */

const ZONE: Readonly<Record<LinkId, number>> = Object.freeze({
  camera_mount: 1.5, moving_jaw: 1.1, gripper: 1.0, wrist: 0.8, lower_arm: 0.7, upper_arm: 0.5, shoulder: 0.5, base: 0.5,
});
const TOOL: Readonly<Record<LinkId, number>> = Object.freeze({
  moving_jaw: 1.0, gripper: 1.0, camera_mount: 1.0, wrist: 0.85, lower_arm: 0.7, upper_arm: 0.5, shoulder: 0.5, base: 0.5,
});

const SCORING = Object.freeze({
  contactMaxRatio: 0.2,          // max(α, β) below this is a shove
  clashMinRatio: 0.2, clashRatioLo: 0.75, clashRatioHi: 1.33,
  grazeNu: 0.2, strikeNu: 0.35,
  rawScale: 20, rawOffset: 0.2, rawSpan: 0.55, rawClampMax: 1.45, rawExp: 1.2,
  rawRef: 31.2,                  // magnitude = raw / rawRef
  damageCap: 45,
  zone: ZONE, tool: TOOL,
  lockoutMs: 220,
  cubeMul: 0.5, cubeThrowWindowS: 1.0,
  clashMagnitude: 0.6, contactMagnitude: 0.15,
  armArmGateN: 0.3, tableGateN: 3,
  contactEventGapMs: 100,
  /** EMOTION_BIBLE 6/11: sparring (match-1 round 1 deals and takes nothing; the SPARRING tier ×0.6) and the WHIP carry. */
  sparringTierMul: 0.6, whipMul: 1.1, whipCarryMs: 300, whipReversalSpeed: 0.5,
});

/* ───────────────────────── Arcade rules ───────────────────────── */

const ARCADE = Object.freeze({
  scoring: SCORING,
  guard: Object.freeze({ tauScale: 1.4, kvScale: 2.0, chip: 0.2, defenderHeatPerRaw: 0.6, attackerHeat: 10, holdHeatPerS: 6 }),
  deflect: Object.freeze({
    leadMs: 150, lateGuardLagMs: 30, lateGuardRefund: 0.5, lateGuardAttackerHeat: 5,
    stunMs: 650, hardStunMs: 900, hardRatio: 0.2, attackerHeat: 20, defenderHeat: -15, lockoutMs: 400,
    /**
     * Heat for a guard press that never became a deflect, so a defensive guess costs something: a landed
     * deflect buys a 650 ms stun worth most of a health bar, and a missed one used to cost only 400 ms of
     * deflect availability. A read that LANDS still refunds 15 (defenderHeat), so reading well is rewarded
     * twice and fishing is taxed.
     *
     * 6, not the 12 this started at. At the 1.8 presses/s fishing cap 12 is +21.6 heat/s — about Overdrive —
     * and `tests/opponent-behavior.test.mjs` showed that is not a tax but a kill: OVERSHOOT vs BACKLASH went
     * to 1/12, far outside the 25-75% balance gate, because an aggressive bot presses guard reactively and
     * simply cooked itself. 6 keeps the decision and holds the matchup at 4/12. Re-run that sweep on a quiet
     * box before raising it again — it is the gate that catches this.
     */
    whiffHeat: 6,
    links: Object.freeze(["camera_mount", "moving_jaw", "gripper", "wrist", "lower_arm"] as LinkId[]),
  }),
  clash: Object.freeze({ heat: 8, microMs: 150 }),
  heat: Object.freeze({
    kQ: 120, idleCool: 5, extraCool: 15, coolQ: 0.02, coolHoldS: 0.8,
    charging: 8, overdrive: 25, whiff: 10, chargeCancel: 8, snap: 12, burst: 35,
    warnOn: 70, warnOff: 65, max: 100, afterCutout: 40,
  }),
  states: Object.freeze({
    micro: Object.freeze({ tau: 0.7, kp: 1, kv: 1, ms: 150 }),
    stagger: Object.freeze({
      tau: 0.5, kp: 0.25, kv: 0.6, baseMs: 180, perDamageMs: 8, maxMs: 450, guardBreakMs: 400, knockbackMs: 300,
      rawMin: 10, guardAfterFrac: 0.6, incoming: 0.8, decay: 0.6, followUpCap: 25, comboCap: 60,
    }),
    stun: Object.freeze({ tau: 0.3, kp: 0.1, kv: 0.5 }),
    cutout: Object.freeze({ tau: 0.35, kp: 1, kv: 1, ms: 2000, incoming: 1.25 }),
    offline: Object.freeze({ tau: 0.05, kp: 0.02, kv: 0.2 }),
    immunityMs: 900,
  }),
  knockback: Object.freeze({
    contactWindowMs: 100, errorMin: 0.35, nonDecreasingMs: 60, holdMs: 120,
    awaySpeedMin: 0.3, freeFrac: 0.3, guardEdgeQuietMs: 250, commandStepQuietMs: 250, commandStepRad: 0.2, commandTickMs: 20,
  }),
  burst: Object.freeze({ heatMax: 65, tauScale: 1.3, boostMs: 150 }),
  charge: Object.freeze({
    rampMs: 600, holdMaxMs: 1000, publicAt: 0.25, armourAt: 0.667, armourTailMs: 120,
    /**
     * The raw impact a strike needs to punch through a charged arm's armour.
     *
     * 26, up from 16. GAME_DESIGN 4.4 says a charge "beats flicks in its last 200 ms", but at 16 almost any
     * hook broke through, so the charge line was strictly dominated: a plain full hook is ~31 damage in 0.66 s
     * against a fully charged heavy's ~41 in 1.2 s. Committing to the telegraph lost the exchange AND the
     * tempo, so no one ever telegraphed — and with nothing to punish, the whole deflect read/counter-read
     * layer had nothing to read. 26 is nu < ~0.855: everything short of a near-top-speed hook now bounces,
     * which is the reason to accept the tell. `armourMul` deliberately unchanged — the fix is tempo, not damage.
     */
    armourRawMax: 26, armourMul: 0.5,
    releaseBoostMs: 250, releaseTauPerC: 0.5, heavyWindowMs: 400, heavyPerC: 0.3, whiffRecoveryMs: 250, whiffTau: 0.8,
  }),
  overdrive: Object.freeze({ tauScale: 1.35 }),
  abilities: Object.freeze({
    snap: Object.freeze({ charges: 2, rechargeMs: 5000, activeMs: 180, tau: 1.6, kv: 0.5, heat: 12 }),
    recoil_coil: Object.freeze({ activeMs: 2500, cooldownMs: 14000, guardHeatMul: 2 }),
    bulwark: Object.freeze({ activeMs: 3000, cooldownMs: 16000, tau: 1.5, kv: 3.0, chip: 0, attackerHeat: 20, breakRaw: 60 }),
  }),
  loadouts: LOADOUTS,
  vRef: MEASURED_VREF,
  vFree: MEASURED_VFREE,
});

/* ───────────────────────── stock rules (physical scoring) ───────────────────────── */

const STOCK = Object.freeze({
  scoring: SCORING,
  heat: Object.freeze({ kQ: 60, idleCool: 5, extraCool: 15, coolQ: 0.02, coolHoldS: 0.8, max: 100 }),
  servo: STOCK_SERVO,
  offline: ARCADE.states.offline,
  vRef: MEASURED_VREF.stock,
});

/* ───────────────────────── round and Core (2.4, 2.5) ───────────────────────── */

const ROUND = Object.freeze({
  suddenDeathRawMin: 16, lowIntegrity: 25, stalemateS: 6, comboGapS: 1.2, comboMin: 3,
  /** Match 1 has no Sudden Death: inside this Integrity gap the round goes to the tiebreak (first strike, then damage). */
  tieMargin: 10,
  /** Overtime (EMOTION_BIBLE 6): a steal begun inside the last 5 s cannot end the round until it resolves, 10 s cap. */
  overtimeStealWindowS: 5, overtimeCapS: 10,
});

const CORE = Object.freeze({
  cube: 4, dockRadius: DOCK_RADIUS, dockZMax: 0.035, dockSpeedMax: 0.05, dockHoldMs: 250, leaveHoldMs: 100,
  stealTouchWindowMs: 300, contestRadius: 0.08, lateStealS: 2.0, dropZ: 0.22, biasM: 0.03, biasIntegrityGap: 15,
  carriedZ: 0.035,
});

export const tuning = Object.freeze({ version: 1, arcade: ARCADE, stock: STOCK, round: ROUND, core: CORE });
export type Tuning = typeof tuning;

/* ───────────────────────── helpers ───────────────────────── */

export function vRefFor(loadout: LoadoutId | null): number {
  return loadout ? MEASURED_VREF[loadout] : MEASURED_VREF.stock;
}

/** v_free(profile, joint, |e|) by linear interpolation over the measured bins, clamped at the ends (4.6). */
export function vFreeFor(loadout: LoadoutId | null, joint: number, absError: number): number {
  const bins = MEASURED_VFREE.errorBins;
  const row = MEASURED_VFREE[loadout ?? "stock"][joint] ?? MEASURED_VFREE[loadout ?? "stock"][0];
  if (absError <= bins[0]) return row[0];
  for (let i = 1; i < bins.length; i++) {
    if (absError <= bins[i]) {
      const f = (absError - bins[i - 1]) / (bins[i] - bins[i - 1]);
      return row[i - 1] + f * (row[i] - row[i - 1]);
    }
  }
  return row[row.length - 1];
}

/* ───────────────────────── hit stop (EMOTION_BIBLE 6) ───────────────────────── */

/**
 * One linear formula for every strike: `clamp(50 + 125·m, 50, 150)`. Continuous, so two nearly identical swings never
 * feel like two games; the light/heavy split at m = 0.4 exists only for channels (camera, sub, sparks, hit light), never
 * for the clock. Crit adds 20 inside the cap, a guarded hit freezes `33 + 17·m` on onset only. The clock's rolling
 * budget (game-clock.ts) keeps a flurry from turning into a slideshow.
 */
export const HITSTOP = Object.freeze({
  base: 50, perM: 125, critBonus: 20, guardedBase: 33, guardedPerM: 17, deflect: 110, clash: 55, ko: 150, cap: 150,
  /** Channel split only (sparks count, hit light, sub, camera recoil): never the clock. */
  heavyM: 0.4,
});

/** Pure: identical for the sim-driver (freeze) and juice. Zero in every preset but Arcade (no sim or render freeze). */
export const hitstopMsFor: HitstopMsFor = (event: GameEvent, preset: MatchPreset) => {
  if (preset !== "arcade") return 0;
  switch (event.type) {
    case "strike": {
      if (event.tier !== "strike") return 0;
      const m = event.magnitude < 0 ? 0 : event.magnitude > 1 ? 1 : event.magnitude;
      if (event.guarded) return Math.round(HITSTOP.guardedBase + HITSTOP.guardedPerM * m);
      const base = Math.round(HITSTOP.base + HITSTOP.perM * m);
      return Math.min(HITSTOP.cap, event.crit ? base + HITSTOP.critBonus : base);
    }
    case "deflect": return HITSTOP.deflect;
    case "clash": return HITSTOP.clash;
    case "ko": return HITSTOP.ko;
    default: return 0;
  }
};
