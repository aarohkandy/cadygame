// src/game/combat/combat-rules.ts (WP5)
// Combat rules, once per physics step on sim time (GAME_DESIGN 2.4, 2.5, 4.2–4.9; BUILD_PLAN D8).
//
// Scoring profiles: `full` (ARCADE) runs guard, deflect, clash stagger, heat effects, the servo state machine, charge
// and abilities; `physical` (PROVING GROUND, HARNESS) scores raw × zone × tool only, with heat as telemetry and the
// Offline slump at KO as the one servo change. Both profiles run the Core, KO, lockout, and round outcomes identically.
//
// Event convention (shared with the fakes and sim-driver): every event carries step = frame.step − 1 (the step that
// just ran) and t = frame.simTime after it. Strike and deflect normals point from the attacker toward the victim.
import {
  IDENTITY_PROFILE, INTENT_BITS, SEATS, otherSeat,
  type ArmContactOnset, type CombatRules, type CombatSnapshot, type CoreMutationRequest, type CreateCombatRules,
  type ContactOnset, type CubeContactOnset, type GameEvent, type Intents, type LinkId, type LoadoutId, type PhysicsFrame, type RoundEndReason, type RulesConfig, type Seat,
  type SeatCombatState, type ServoProfile, type Vec3,
} from "../contracts.ts";
import {
  abilityActive, activateAbility, cancelCharge, consumeHeavyTag, createKitRuntime, endAbility, initialAbility,
  resetKitRuntime, stepAbility, stepCharge, updateArmour, type KitRuntime,
} from "./abilities.ts";
import { createCoreObjective } from "./core-objective.ts";
import {
  arcadeDamage, attribute, magnitudeOf, newAttribution, physicalDamage, rawDamage, type SparringMode,
} from "./damage.ts";
import {
  ARCADE_HEAT, NO_HEAT_DRIVERS, STOCK_HEAT, clampHeat, createHeatRuntime, integrateHeat, servoLoadQ,
  type HeatDrivers, type HeatRuntime,
} from "./heat.ts";
import {
  STATE_SCALES, canBeStaggered, createKnockbackDetector, deflectAllowed, endState, enterState, guardAllowed,
  knockbackStaggerMs, strikeStaggerMs, type KnockbackDetector,
} from "./servo-states.ts";
import { LOADOUTS, tuning, vRefFor } from "./tuning.ts";

const A = tuning.arcade;
const R = tuning.round;
const NEG_INF = Number.NEGATIVE_INFINITY;
const STOCK_INTEGRITY = 100;

type StrikeEvent = Extract<GameEvent, { type: "strike" }>;

/**
 * Match-1 rules (EMOTION_BIBLE 2, 6, 11 WP5), additive on the contract's RulesConfig so every existing caller is
 * unchanged: `sparring` scales damage (round 1: 0 dealt / 0 taken; the SPARRING tier: ×0.6) and `noSuddenDeath` makes
 * a close round at time-up go to the tiebreak (first strike, then damage) instead of Sudden Death.
 */

/** The victim-side modifiers a hit was scored with, so a later upgrade inside the lockout scores on the same terms. */
interface HitMods { guarded: boolean; staggered: boolean; cutout: boolean; armoured: boolean; bulwark: boolean; heavyC: number | null; followUp: number; whip: boolean }
interface LastHit { t: number; victim: Seat; damage: number; event: StrikeEvent; mods: HitMods; cube: number }

interface SeatRt {
  seat: Seat; opp: Seat;
  prev: Intents;
  heat: HeatRuntime; kit: KitRuntime; kb: KnockbackDetector;
  lastGuardEdgeT: number;
  windowPressT: number;
  lastStrikeT: number;
  lastHit: LastHit | null;
  recentHitOnMe: { T: number; damage: number; attacker: Seat; refunded: boolean } | null;
  pendingCutout: boolean;
  staggerOpenerDamage: number; staggerFollowDamage: number;
  burstBoostMs: number;
  heatWarning: boolean; lowIntegritySent: boolean;
  comboLastT: number;
  activityM: number; lastEe: Float64Array; eeValid: boolean;
  lastVel: Float64Array; lastReversalT: number;             // WHIP carry: the tip reversed direction at speed
  lastTableEventT: number;
  profile: ServoProfile; revision: number;
}

function seatState(loadout: LoadoutId, full: boolean): SeatCombatState {
  const max = full ? LOADOUTS[loadout].integrity : STOCK_INTEGRITY;
  return {
    loadout, integrity: max, integrityMax: max, heat: 0,
    servoState: "normal", servoStateRemainingMs: 0, servoStateTotalMs: 0,
    staggerImmuneMs: 0, staggerFollowUps: 0, burstUsed: false,
    guardHeld: false, deflectLockoutMs: 0,
    charging: false, charge: 0, chargeHoldMs: 0, armoured: false,
    releaseBoostMs: 0, heavyTagMs: 0, heavyTagC: 0, overdrive: false,
    ability: initialAbility(loadout),
    protected: false, comboCount: 0, lastStrikeT: -1,
    damageDealtRound: 0, physicalDamageDealtRound: 0, firstStrikeT: -1,
  };
}

function seatRt(seat: Seat): SeatRt {
  return {
    seat, opp: otherSeat(seat), prev: { guard: false, charge: false, grip: false, overdrive: false, ability: false, burst: false },
    heat: createHeatRuntime(), kit: createKitRuntime(), kb: createKnockbackDetector(),
    lastGuardEdgeT: NEG_INF, windowPressT: NEG_INF, lastStrikeT: NEG_INF, lastHit: null, recentHitOnMe: null,
    pendingCutout: false, staggerOpenerDamage: 0, staggerFollowDamage: 0, burstBoostMs: 0,
    heatWarning: false, lowIntegritySent: false, comboLastT: NEG_INF,
    activityM: 0, lastEe: new Float64Array(3), eeValid: false, lastVel: new Float64Array(3), lastReversalT: NEG_INF, lastTableEventT: NEG_INF,
    profile: { ...IDENTITY_PROFILE }, revision: 0,
  };
}

function onsetSpeed(o: ContactOnset): number {
  return o.kind === "self" ? 0 : o.vN;
}

/** Pure intent bits helper for tests and tools. */
export function intentsFromBitsInto(bits: number, out: Intents): Intents {
  out.guard = (bits & INTENT_BITS.guard) !== 0; out.charge = (bits & INTENT_BITS.charge) !== 0;
  out.grip = (bits & INTENT_BITS.grip) !== 0; out.overdrive = (bits & INTENT_BITS.overdrive) !== 0;
  out.ability = (bits & INTENT_BITS.ability) !== 0; out.burst = (bits & INTENT_BITS.burst) !== 0;
  return out;
}

export const createCombatRules: CreateCombatRules = (info) => {
  void info;
  const state: CombatSnapshot = {
    preset: "arcade", scoring: "full", round: 0, suddenDeath: false, fightTimeS: 0, roundLengthS: 45,
    seats: { atlas: seatState("pivot", true), blaze: seatState("pivot", true) },
    core: createCoreObjective().state,
    outcome: null,
  };
  const core = createCoreObjective();
  state.core = core.state;
  const rt: Record<Seat, SeatRt> = { atlas: seatRt("atlas"), blaze: seatRt("blaze") };
  let cfg: RulesConfig | null = null;
  let live = false;
  let full = true;
  let sparring: SparringMode = null;
  let noSuddenDeath = false;
  let overtimeUntilS = -1;                                 // > 0 while a late steal holds the round open
  let coreWasLoose = false;
  const placements: CoreMutationRequest[] = [];
  const attribution = newAttribution();
  let lastContactEventT = NEG_INF;
  let lastArmContactT = 0;
  let stalemateSent = false;
  let firstStrikeSeat: Seat | null = null;
  let out: GameEvent[] = [];
  let curT = 0, curStep = 0;
  const emit = (e: GameEvent) => { out.push(e); };

  /* ───────── helpers ───────── */

  const vRef = (seat: Seat) => (full ? vRefFor(state.seats[seat].loadout) : vRefFor(null));

  function guardEffective(s: SeatCombatState): boolean {
    return full && (s.guardHeld || abilityActive(s, "bulwark"));
  }

  function composeProfile(seat: Seat, o: ServoProfile): ServoProfile {
    const s = state.seats[seat];
    if (s.servoState === "offline") { const off = STATE_SCALES.offline; o.tauScale = off.tauScale; o.kpScale = off.kpScale; o.kvScale = off.kvScale; return o; }
    if (!full) { o.tauScale = 1; o.kpScale = 1; o.kvScale = 1; return o; }
    const base = STATE_SCALES[s.servoState];
    const kp = base.kpScale;
    let tau = base.tauScale, kv = base.kvScale;
    const k = rt[seat].kit;
    if (abilityActive(s, "bulwark")) { tau *= A.abilities.bulwark.tau; kv *= A.abilities.bulwark.kv; }
    else if (s.guardHeld) { tau *= A.guard.tauScale; kv *= A.guard.kvScale; }
    if (s.overdrive) tau *= A.overdrive.tauScale;
    if (abilityActive(s, "snap")) { tau *= A.abilities.snap.tau; kv *= A.abilities.snap.kv; }
    if (s.releaseBoostMs > 0) tau *= 1 + A.charge.releaseTauPerC * k.releasedC;
    if (rt[seat].burstBoostMs > 0) tau *= A.burst.tauScale;
    if (k.whiffRecoveryMs > 0) tau *= A.charge.whiffTau;
    o.tauScale = tau; o.kpScale = kp; o.kvScale = kv;
    return o;
  }

  const scratchProfile: ServoProfile = { ...IDENTITY_PROFILE };
  function refreshProfile(seat: Seat): void {
    const r = rt[seat];
    composeProfile(seat, scratchProfile);
    if (scratchProfile.tauScale !== r.profile.tauScale || scratchProfile.kpScale !== r.profile.kpScale || scratchProfile.kvScale !== r.profile.kvScale) {
      r.profile.tauScale = scratchProfile.tauScale; r.profile.kpScale = scratchProfile.kpScale; r.profile.kvScale = scratchProfile.kvScale;
      r.revision++;
    }
  }

  function setOutcome(winner: Seat, reason: RoundEndReason): void {
    if (state.outcome) return;
    state.outcome = { winner, reason, t: curT };
  }

  function tiebreakWinner(): Seat {
    const a = state.seats.atlas, b = state.seats.blaze;
    if (noSuddenDeath && firstStrikeSeat) return firstStrikeSeat;   // match 1: first strike, then damage
    if (a.damageDealtRound !== b.damageDealtRound) return a.damageDealtRound > b.damageDealtRound ? "atlas" : "blaze";
    if (a.integrity !== b.integrity) return a.integrity > b.integrity ? "atlas" : "blaze";
    if (firstStrikeSeat) return firstStrikeSeat;
    if (core.lockInHeldS.atlas !== core.lockInHeldS.blaze) return core.lockInHeldS.atlas > core.lockInHeldS.blaze ? "atlas" : "blaze";
    return rt.atlas.activityM >= rt.blaze.activityM ? "atlas" : "blaze";
  }

  function knockOut(victim: Seat, attacker: Seat, pos: Vec3): void {
    const v = state.seats[victim];
    v.integrity = 0;
    if (v.charging) cancelCharge(v, rt[victim].kit, victim, curT, curStep, emit, false);
    if (v.ability.activeMs > 0) endAbility(v, victim, curT, curStep, emit);
    v.guardHeld = false; v.overdrive = false;
    enterState(v, victim, "offline", 0, "ko", curT, curStep, emit);
    emit({ type: "ko", t: curT, step: curStep, victim, attacker, pos });
    setOutcome(attacker, "ko");
  }

  function forcedStagger(seat: Seat, ms: number, cause: "strike" | "guard_break" | "knockback"): void {
    const s = state.seats[seat];
    if (s.charging) cancelCharge(s, rt[seat].kit, seat, curT, curStep, emit, false);
    enterState(s, seat, "stagger", ms, cause, curT, curStep, emit);
    rt[seat].staggerFollowDamage = 0;
  }

  function addHeat(seat: Seat, delta: number): void {
    if (!full) return;
    const s = state.seats[seat];
    s.heat = clampHeat(s.heat + delta);
  }

  /* ───────── strikes ───────── */

  interface StrikeInput {
    T: number; attacker: Seat; victim: Seat; raw: number; nu: number; vN: number;
    zone: LinkId; tool: LinkId | null; pos: Vec3; normal: Vec3; defenderRatio: number; cube: number;
    tier: "graze" | "strike";
  }

  function tryDeflect(i: StrikeInput): boolean {
    if (!full || i.tier !== "strike" || i.cube >= 0) return false;
    const d = state.seats[i.victim];
    const vr = rt[i.victim];
    const coil = abilityActive(d, "recoil_coil") && d.guardHeld;
    if (!coil) {
      if (!deflectAllowed(d) || !A.deflect.links.includes(i.zone)) return false;
      const P = vr.windowPressT;
      if (!(P >= i.T - A.deflect.leadMs / 1000 - 1e-9)) return false;
      if (P > i.T + 1e-9) return false;                              // every strike freezes: a later press is a late guard
    } else if (d.servoState !== "normal" && d.servoState !== "micro_stagger") {
      return false;
    }
    const pressLeadMs = coil && !(vr.windowPressT > NEG_INF) ? 0 : Math.round((i.T - vr.windowPressT) * 1e6) / 1e3;
    vr.windowPressT = NEG_INF;
    if (coil) endAbility(d, i.victim, curT, curStep, emit);
    const a = state.seats[i.attacker];
    const hard = i.defenderRatio >= A.deflect.hardRatio;
    consumeHeavyTag(a, rt[i.attacker].kit);
    if (a.charging) cancelCharge(a, rt[i.attacker].kit, i.attacker, curT, curStep, emit, false);
    if (a.servoState !== "offline") {
      enterState(a, i.attacker, "stun", hard ? A.deflect.hardStunMs : A.deflect.stunMs, "deflect", curT, curStep, emit);
    }
    addHeat(i.attacker, A.deflect.attackerHeat);
    addHeat(i.victim, A.deflect.defenderHeat);
    rt[i.attacker].lastStrikeT = i.T;
    emit({ type: "deflect", t: curT, step: curStep, defender: i.victim, attacker: i.attacker, hard, pressLeadMs, pos: i.pos, normal: i.normal });
    return true;
  }

  function resolveStrike(i: StrikeInput): void {
    if (state.outcome) return;
    const ar = rt[i.attacker];
    const a = state.seats[i.attacker], v = state.seats[i.victim];
    if (v.servoState === "offline") return;
    const strikeTier = i.tier === "strike";

    // Lockout: one STRIKE per attacker per 220 ms; a harder onset inside the window upgrades that hit.
    if (strikeTier && i.T - ar.lastStrikeT < A.scoring.lockoutMs / 1000 - 1e-9) {
      const last = ar.lastHit;
      if (!last || last.victim !== i.victim || last.event.tier !== "strike") return;
      const dmg = computeDamage(i, last.mods);
      if (!(dmg.damage > last.damage + 1e-9)) return;
      const delta = v.protected ? 0 : dmg.damage - last.damage;
      applyDamage(i.attacker, i.victim, delta, dmg.physical - last.event.physicalDamage);
      const e: StrikeEvent = {
        ...last.event, t: curT, step: curStep, raw: i.raw, nu: i.nu, vN: i.vN, zone: i.zone, tool: i.tool ?? last.event.tool,
        damage: v.protected ? last.damage : dmg.damage, physicalDamage: dmg.physical, magnitude: magnitudeOf(i.raw),
        crit: i.zone === "camera_mount", pos: i.pos, normal: i.normal, upgrade: true, lethal: v.integrity <= 0,
      };
      last.damage = e.damage; last.event = e;
      emit(e);
      if (v.integrity <= 0) knockOut(i.victim, i.attacker, i.pos);
      return;
    }

    if (tryDeflect(i)) return;

    const guarded = strikeTier || i.tier === "graze" ? guardEffective(v) : false;
    const armoured = full && v.armoured && !guarded && i.raw < A.charge.armourRawMax;
    const inStagger = full && v.servoState === "stagger";
    const followUp = inStagger && strikeTier && i.cube < 0 ? v.staggerFollowUps + 1 : 0;
    const heavyC = full && strikeTier && i.cube < 0 ? consumeHeavyTag(a, ar.kit) : null;
    const whip = full && strikeTier && i.cube < 0 && i.T - ar.lastReversalT <= A.scoring.whipCarryMs / 1000 + 1e-9;
    const mods: HitMods = {
      guarded, staggered: inStagger, cutout: full && v.servoState === "cutout", armoured,
      bulwark: full && abilityActive(v, "bulwark"), heavyC, followUp, whip,
    };
    const dmg = computeDamage(i, mods);
    let damage = dmg.damage;
    if (followUp > 0) {
      const vr = rt[i.victim];
      const room = Math.min(A.states.stagger.followUpCap - vr.staggerFollowDamage, A.states.stagger.comboCap - vr.staggerOpenerDamage - vr.staggerFollowDamage);
      damage = Math.max(0, Math.min(damage, room));
      vr.staggerFollowDamage += damage;
    }
    if (v.protected) damage = 0;
    applyDamage(i.attacker, i.victim, damage, dmg.physical);

    if (full) {
      if (guarded) {
        addHeat(i.victim, A.guard.defenderHeatPerRaw * i.raw);
        addHeat(i.attacker, abilityActive(v, "bulwark") ? A.abilities.bulwark.attackerHeat : A.guard.attackerHeat);
        if (abilityActive(v, "bulwark")) {
          const k = rt[i.victim].kit;
          k.bulwarkRawTaken += i.raw;
          if (k.bulwarkRawTaken >= A.abilities.bulwark.breakRaw) endAbility(v, i.victim, curT, curStep, emit);
        }
      }
    }

    const magnitude = magnitudeOf(i.raw);
    const e: StrikeEvent = {
      type: "strike", t: curT, step: curStep, tier: i.tier, attacker: i.attacker, victim: i.victim,
      raw: i.raw, damage, physicalDamage: dmg.physical, nu: i.nu, vN: i.vN, zone: i.zone, tool: i.tool ?? "gripper",
      crit: i.zone === "camera_mount", guarded, heavyC: heavyC ?? 0, armoured, pos: i.pos, normal: i.normal,
      magnitude, lethal: v.integrity <= 0, upgrade: false, thrownCube: i.cube, whip: mods.whip,
    };
    emit(e);

    if (strikeTier) {
      ar.lastStrikeT = i.T;
      ar.lastHit = { t: i.T, victim: i.victim, damage, event: e, mods, cube: i.cube };
      a.lastStrikeT = i.T;
      if (a.firstStrikeT < 0 && state.seats[i.victim].firstStrikeT < 0 && firstStrikeSeat === null) {
        a.firstStrikeT = i.T;
        firstStrikeSeat = i.attacker;
        emit({ type: "first_strike", t: curT, step: curStep, seat: i.attacker });
      }
      a.comboCount = i.T - ar.comboLastT <= R.comboGapS + 1e-9 ? a.comboCount + 1 : 1;
      ar.comboLastT = i.T;
      v.comboCount = 0;
      rt[i.victim].comboLastT = NEG_INF;
      if (a.comboCount >= R.comboMin) emit({ type: "combo", t: curT, step: curStep, seat: i.attacker, count: a.comboCount });
      if (!guarded) rt[i.victim].recentHitOnMe = { T: i.T, damage, attacker: i.attacker, refunded: false };
    }

    if (v.integrity <= 0) { knockOut(i.victim, i.attacker, i.pos); return; }

    if (full && strikeTier && i.cube < 0) {
      if (inStagger) {
        v.staggerFollowUps++;
        endState(v, i.victim, "second_strike", curT, curStep, emit);
        if (rt[i.victim].pendingCutout) startPendingCutout(i.victim);
      } else if (!guarded && i.raw >= A.states.stagger.rawMin && !armoured && canBeStaggered(v)) {
        forcedStagger(i.victim, strikeStaggerMs(damage, v.loadout), "strike");
        rt[i.victim].staggerOpenerDamage = damage;
      }
    }

    if (state.suddenDeath && strikeTier && !guarded && i.raw >= R.suddenDeathRawMin - 1e-9) {
      setOutcome(i.attacker, "sudden_death_strike");
    }
  }

  function computeDamage(i: StrikeInput, m: HitMods): { damage: number; physical: number } {
    const cubeMul = i.cube >= 0 ? A.scoring.cubeMul : 1;
    const physical = physicalDamage(i.raw, i.zone, i.tool) * cubeMul;
    if (!full) return { damage: physical, physical };
    const damage = arcadeDamage({
      raw: i.raw, victimLink: i.zone, attackerLink: i.tool, attackerLoadout: state.seats[i.attacker].loadout,
      heavyC: m.heavyC, guarded: m.guarded, bulwark: m.bulwark, staggered: m.staggered, cutout: m.cutout, armoured: m.armoured,
      followUpIndex: m.followUp, cubeThrow: i.cube >= 0, whip: m.whip, sparring,
    });
    return { damage, physical };
  }

  function applyDamage(attacker: Seat, victim: Seat, damage: number, physical: number): void {
    const v = state.seats[victim], a = state.seats[attacker];
    v.integrity = Math.max(0, v.integrity - damage);
    a.damageDealtRound += damage;
    a.physicalDamageDealtRound += physical;
  }

  function startPendingCutout(seat: Seat): void {
    rt[seat].pendingCutout = false;
    enterState(state.seats[seat], seat, "cutout", A.states.cutout.ms, "heat", curT, curStep, emit);
  }

  /* ───────── onsets ───────── */

  function armOnset(o: ArmContactOnset): void {
    attribute(o.aN, o.bN, o.vN, vRef("atlas"), vRef("blaze"), attribution);
    let kind = attribution.kind;
    let attacker = attribution.attacker;
    let nu = attribution.nu;
    let heavyWinner: Seat | null = null;
    if (kind === "clash" && full) {
      const aHeavy = state.seats.atlas.heavyTagMs > 0, bHeavy = state.seats.blaze.heavyTagMs > 0;
      if (aHeavy !== bHeavy) {
        heavyWinner = aHeavy ? "atlas" : "blaze";
        attacker = heavyWinner;
        nu = o.vN / vRef(heavyWinner);
        kind = nu >= A.scoring.strikeNu ? "strike" : "clash";
      }
    }
    if (kind === "contact") {
      if (curT - lastContactEventT >= A.scoring.contactEventGapMs / 1000 - 1e-9) {
        lastContactEventT = curT;
        emit({ type: "contact", t: curT, step: curStep, pos: o.pos, magnitude: A.scoring.contactMagnitude });
      }
      return;
    }
    if (kind === "clash") {
      if (state.outcome) return;
      if (full) {
        for (const seat of SEATS) {
          addHeat(seat, A.clash.heat);
          const s = state.seats[seat];
          if (s.servoState === "normal") enterState(s, seat, "micro_stagger", A.clash.microMs, "clash", curT, curStep, emit);
        }
      }
      emit({ type: "clash", t: curT, step: curStep, pos: o.pos, normal: o.normal, magnitude: A.scoring.clashMagnitude, heavyWinner: null });
      return;
    }
    const att = attacker as Seat;
    const victim = otherSeat(att);
    const sign = att === "atlas" ? 1 : -1;
    const normal: Vec3 = [o.normal[0] * sign, o.normal[1] * sign, o.normal[2] * sign];
    const defenderRatio = victim === "atlas" ? o.aN / vRef("atlas") : o.bN / vRef("blaze");
    const input: StrikeInput = {
      T: o.t, attacker: att, victim, raw: rawDamage(nu), nu, vN: o.vN,
      zone: victim === "atlas" ? o.atlasLink : o.blazeLink, tool: att === "atlas" ? o.atlasLink : o.blazeLink,
      pos: o.pos, normal, defenderRatio, cube: -1, tier: kind,
    };
    if (heavyWinner) {
      // The heavy side wins the clash outright: resolved as its strike, then announced as a clash it won.
      emit({ type: "clash", t: curT, step: curStep, pos: o.pos, normal: o.normal, magnitude: A.scoring.clashMagnitude, heavyWinner });
    }
    resolveStrike(input);
  }

  function cubeOnset(o: CubeContactOnset): void {
    if (o.cube === tuning.core.cube) return;                           // the Core never deals damage
    const touch = state.outcome ? -1 : lastGripperSeat(o.cube, o.t);
    if (touch === null) return;
    const thrower: Seat = touch === 0 ? "atlas" : "blaze";
    if (thrower === o.seat) return;                                    // a cube you last touched can't hurt you
    const nu = o.vN / vRef(thrower);
    if (nu < A.scoring.grazeNu) return;
    const tier = nu < A.scoring.strikeNu ? "graze" : "strike";
    resolveStrike({
      T: o.t, attacker: thrower, victim: o.seat, raw: rawDamage(nu), nu, vN: o.vN, zone: o.link, tool: null,
      pos: o.pos, normal: [-o.normal[0], -o.normal[1], -o.normal[2]], defenderRatio: 0, cube: o.cube, tier,
    });
  }

  let frameRef: PhysicsFrame | null = null;
  function lastGripperSeat(cube: number, t: number): number | null {
    const f = frameRef;
    if (!f) return null;
    const seatIdx = f.active.lastGripperTouch.cube[cube];
    if (seatIdx < 0 || t - f.active.lastGripperTouch.t[cube] > A.scoring.cubeThrowWindowS + 1e-9) return null;
    return seatIdx;
  }

  /* ───────── per-seat step ───────── */

  const ordered: ContactOnset[] = [];
  const integrityNow: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const place = (p: CoreMutationRequest) => { placements.push(p); };
  const byNormalSpeed = (a: ContactOnset, b: ContactOnset) => onsetSpeed(b) - onsetSpeed(a);
  const heatDrivers: HeatDrivers = { guarding: false, guardMul: 1, charging: false, overdrive: false };

  function stepSeat(seat: Seat, frame: PhysicsFrame, intents: Intents, dtMs: number): void {
    const s = state.seats[seat];
    const r = rt[seat];
    const prev = r.prev;
    const guardPress = intents.guard && !prev.guard, guardRelease = !intents.guard && prev.guard;
    const abilityPress = intents.ability && !prev.ability, burstPress = intents.burst && !prev.burst;

    // Activity (final tiebreak) and table hits are profile-independent.
    const ee = frame.arms[seat].eePos;
    if (r.eeValid) {
      r.activityM += Math.hypot(ee[0] - r.lastEe[0], ee[1] - r.lastEe[1], ee[2] - r.lastEe[2]);
      // WHIP carry (EMOTION_BIBLE 6 streamlining): the tip reversing direction at speed opens a 300 ms +10 % window.
      const vx = (ee[0] - r.lastEe[0]) / frame.dt, vy = (ee[1] - r.lastEe[1]) / frame.dt, vz = (ee[2] - r.lastEe[2]) / frame.dt;
      const lv = r.lastVel;
      const minV = A.scoring.whipReversalSpeed;
      if (vx * lv[0] + vy * lv[1] + vz * lv[2] < 0 && Math.hypot(vx, vy, vz) >= minV && Math.hypot(lv[0], lv[1], lv[2]) >= minV) r.lastReversalT = curT;
      lv[0] = vx; lv[1] = vy; lv[2] = vz;
    }
    r.lastEe[0] = ee[0]; r.lastEe[1] = ee[1]; r.lastEe[2] = ee[2]; r.eeValid = true;

    if (!full) {
      s.guardHeld = intents.guard && s.servoState !== "offline";      // telemetry only; scores nothing
      s.heat = integrateHeat(s.heat, r.heat, servoLoadQ(frame.arms[seat]), dtMs / 1000, STOCK_HEAT, 1, NO_HEAT_DRIVERS);
      return;
    }
    if (s.servoState === "offline") { s.guardHeld = false; s.overdrive = false; return; }

    // Timers.
    if (s.servoStateTotalMs > 0) {
      s.servoStateRemainingMs = Math.max(0, s.servoStateRemainingMs - dtMs);
      if (s.servoStateRemainingMs === 0) {
        const ended = endState(s, seat, "end", curT, curStep, emit);
        if (ended === "cutout") s.heat = A.heat.afterCutout;
        if (ended === "stagger" && r.pendingCutout) startPendingCutout(seat);
      }
    }
    if (s.staggerImmuneMs > 0) s.staggerImmuneMs = Math.max(0, s.staggerImmuneMs - dtMs);
    if (s.deflectLockoutMs > 0) s.deflectLockoutMs = Math.max(0, s.deflectLockoutMs - dtMs);
    if (r.burstBoostMs > 0) r.burstBoostMs = Math.max(0, r.burstBoostMs - dtMs);
    if (r.windowPressT > NEG_INF && curT - r.windowPressT > A.deflect.leadMs / 1000 + 1e-9) {
      r.windowPressT = NEG_INF;
      s.deflectLockoutMs = A.deflect.lockoutMs;                        // anti-mash: the press never became a deflect
      // ...and it costs heat. A landed deflect buys a 650 ms stun worth ~94 of a 100-Integrity bar; a missed
      // one used to cost only 400 ms of deflect availability, so fishing for it was free and the read/counter-
      // read layer collapsed. Paying in the resource that already exists makes the guess a budget decision.
      addHeat(seat, A.deflect.whiffHeat);
    }
    stepAbility(s, seat, dtMs, curT, curStep, emit);

    // Guard: hold, press edge (charge cancel or deflect window), late guard.
    s.guardHeld = intents.guard && guardAllowed(s);
    if (guardPress || guardRelease) r.lastGuardEdgeT = curT;
    if (guardPress) {
      // Late guard: a press up to 30 ms after an unguarded strike landed (every strike freezes, so any later press is
      // made during its hit stop) refunds half of it. The strike may already have staggered this arm, so the late
      // guard is judged before guard availability.
      const hit = r.recentHitOnMe;
      if (hit && !hit.refunded && s.servoState !== "stun" && s.servoState !== "cutout") {
        const lag = curT - hit.T;
        if (lag >= 1e-9 && lag <= A.deflect.lateGuardLagMs / 1000 + 1e-9) {
          hit.refunded = true;
          const refund = hit.damage * A.deflect.lateGuardRefund;
          s.integrity = Math.min(s.integrityMax, s.integrity + refund);
          state.seats[hit.attacker].damageDealtRound -= refund;
          addHeat(hit.attacker, A.deflect.lateGuardAttackerHeat);
          emit({ type: "late_guard", t: curT, step: curStep, defender: seat, attacker: hit.attacker, refund, pressLagMs: Math.round(lag * 1e6) / 1e3 });
        }
      }
      if (s.charging) {
        cancelCharge(s, r.kit, seat, curT, curStep, emit, true);        // the cancelling press opens no window
      } else if (guardAllowed(s) && s.deflectLockoutMs <= 0) {
        r.windowPressT = curT;
      }
    }

    // Burst (while Staggered) and Overdrive share a button; the rules read their own bits.
    if (burstPress && s.servoState === "stagger" && !s.burstUsed && s.heat <= A.burst.heatMax + 1e-9) {
      s.burstUsed = true;
      endState(s, seat, "burst", curT, curStep, emit);
      addHeat(seat, A.heat.burst);
      r.burstBoostMs = A.burst.boostMs;
      emit({ type: "burst", t: curT, step: curStep, seat });
      if (r.pendingCutout) startPendingCutout(seat);
    }
    s.overdrive = intents.overdrive && s.servoState !== "stagger" && s.servoState !== "stun";

    stepCharge(s, r.kit, seat, intents.charge, dtMs, curT, curStep, emit);
    updateArmour(s, r.kit);
    if (abilityPress) activateAbility(s, r.kit, seat, curT, curStep, emit);

    // Heat and its thresholds.
    heatDrivers.guarding = s.guardHeld || abilityActive(s, "bulwark");
    heatDrivers.guardMul = abilityActive(s, "recoil_coil") ? A.abilities.recoil_coil.guardHeatMul : 1;
    heatDrivers.charging = s.charging;
    heatDrivers.overdrive = s.overdrive;
    const before = s.heat;
    s.heat = integrateHeat(s.heat, r.heat, servoLoadQ(frame.arms[seat]), dtMs / 1000, ARCADE_HEAT, LOADOUTS[s.loadout].heat, heatDrivers);
    // Peak, not rising edge. Event heat (a blocked hit, a deflect, a clash, Burst) is applied between steps, so
    // a seat could arrive at this line ALREADY at max with `before` also at max — the old edge test then said
    // "not a crossing" and Thermal Cutout never fired. A seat could sit pinned at 100 for a whole round with no
    // cutout and no guard break, which is why heat read as a meter rather than a resource. The
    // `servoState !== "cutout" && !pendingCutout` guard below already prevents re-entry.
    const peak = before > s.heat ? before : s.heat;
    if (peak >= A.heat.max && s.servoState !== "cutout" && !r.pendingCutout) {
      if (heatDrivers.guarding) {
        forcedStagger(seat, A.states.stagger.guardBreakMs, "guard_break");
        r.pendingCutout = true;
      } else {
        if (s.charging) cancelCharge(s, r.kit, seat, curT, curStep, emit, false);
        enterState(s, seat, "cutout", A.states.cutout.ms, "heat", curT, curStep, emit);
      }
      emit({ type: "overheat", t: curT, step: curStep, seat });
    }
    if (!r.heatWarning && s.heat >= A.heat.warnOn) { r.heatWarning = true; emit({ type: "heat_warning", t: curT, step: curStep, seat, on: true }); }
    else if (r.heatWarning && s.heat < A.heat.warnOff) { r.heatWarning = false; emit({ type: "heat_warning", t: curT, step: curStep, seat, on: false }); }

    // Knockback (pushed, not slow).
    const eligible = s.servoState === "normal" && !s.armoured;
    if (r.kb.step({
      arm: frame.arms[seat], t: curT, dt: frame.dt, loadout: s.loadout,
      lastCrossContactT: frame.active.lastCrossContactT[seat], lastGuardEdgeT: r.lastGuardEdgeT, eligibleState: eligible,
    }) && canBeStaggered(s)) {
      forcedStagger(seat, knockbackStaggerMs(s.loadout), "knockback");
    }
  }

  /* ───────── round flow ───────── */

  function stepLive(frame: PhysicsFrame, intents: Record<Seat, Intents>): void {
    const dtMs = frame.dt * 1000;
    state.fightTimeS += frame.dt;
    for (const seat of SEATS) stepSeat(seat, frame, intents[seat], dtMs);

    if (frame.active.armArmTouching) { lastArmContactT = state.fightTimeS; stalemateSent = false; }
    // Several geom pairs can open on the same step; score the fastest first so the lockout keeps the hardest hit.
    ordered.length = 0;
    for (const o of frame.onsets) ordered.push(o);
    if (ordered.length > 1) ordered.sort(byNormalSpeed);
    for (const o of ordered) {
      if (state.outcome) break;
      switch (o.kind) {
        case "arm_arm": armOnset(o); break;
        case "cube_arm": cubeOnset(o); break;
        case "arm_table": {
          const r = rt[o.seat];
          if (curT - r.lastTableEventT >= 0.15) {
            r.lastTableEventT = curT;
            emit({ type: "table_hit", t: curT, step: curStep, seat: o.seat, force: o.efcForce, pos: o.pos });
          }
          break;
        }
        case "self": break;
      }
    }

    if (!state.outcome) {
      integrityNow.atlas = state.seats.atlas.integrity;
      integrityNow.blaze = state.seats.blaze.integrity;
      const locked = core.step(frame, state.fightTimeS, integrityNow, curT, curStep, emit, place);
      if (locked) setOutcome(locked, "lock");
      // Overtime: a steal begun inside the last 5 s holds the round open until the Core is docked again, 10 s cap.
      const stealNow = state.core.loose && !coreWasLoose;
      coreWasLoose = state.core.loose;
      if (stealNow && overtimeUntilS < 0 && state.fightTimeS >= state.roundLengthS - R.overtimeStealWindowS - 1e-9) {
        overtimeUntilS = state.roundLengthS + R.overtimeCapS;
      }
      if (overtimeUntilS >= 0 && !state.core.loose) overtimeUntilS = -1;
    }

    for (const seat of SEATS) {
      const s = state.seats[seat], r = rt[seat];
      if (!r.lowIntegritySent && s.integrity > 0 && s.integrity <= R.lowIntegrity) {
        r.lowIntegritySent = true;
        emit({ type: "low_integrity", t: curT, step: curStep, seat });
      }
    }
    if (!stalemateSent && state.fightTimeS - lastArmContactT >= R.stalemateS - 1e-9) {
      stalemateSent = true;
      emit({ type: "stalemate", t: curT, step: curStep, seconds: R.stalemateS });
    }

    const overtime = overtimeUntilS >= 0 && state.fightTimeS < overtimeUntilS - 1e-9;
    if (!state.outcome && !overtime && state.fightTimeS >= state.roundLengthS - 1e-9) {
      if (state.suddenDeath) {
        setOutcome(tiebreakWinner(), "sudden_death_tiebreak");
      } else {
        const a = state.seats.atlas.integrity, b = state.seats.blaze.integrity;
        const tie = noSuddenDeath ? Math.abs(a - b) <= R.tieMargin + 1e-9 : a === b;
        setOutcome(tie ? tiebreakWinner() : a > b ? "atlas" : "blaze", "time");
      }
    }
  }

  const rules: CombatRules = {
    state,

    reset(c: RulesConfig, round, suddenDeath, carry) {
      cfg = c;
      full = c.preset === "arcade";
      sparring = full ? c.sparring ?? null : null;
      noSuddenDeath = full && c.noSuddenDeath === true;
      overtimeUntilS = -1;
      coreWasLoose = false;
      state.preset = c.preset;
      state.scoring = full ? "full" : "physical";
      state.round = round;
      state.suddenDeath = suddenDeath;
      state.fightTimeS = 0;
      state.roundLengthS = suddenDeath ? c.suddenDeathLengthS : c.roundLengthS;
      for (const seat of SEATS) {
        const prevState = state.seats[seat];
        const fresh = seatState(c.loadouts[seat], full);
        if (carry) fresh.integrity = Math.max(0, Math.min(fresh.integrityMax, carry.integrity[seat]));
        if (suddenDeath) {
          fresh.heat = prevState.heat;
          fresh.burstUsed = prevState.burstUsed;
          fresh.damageDealtRound = prevState.damageDealtRound;
          fresh.physicalDamageDealtRound = prevState.physicalDamageDealtRound;
          fresh.firstStrikeT = prevState.firstStrikeT;
          fresh.ability = prevState.loadout === fresh.loadout ? prevState.ability : fresh.ability;
          fresh.ability.activeMs = 0;
        }
        Object.assign(prevState, fresh);
        const r = rt[seat];
        const keep = { profile: r.profile, revision: r.revision, activity: suddenDeath ? r.activityM : 0 };
        Object.assign(r, seatRt(seat));
        r.profile = keep.profile; r.revision = keep.revision; r.activityM = keep.activity;
        r.kb.reset();
        resetKitRuntime(r.kit);
      }
      state.outcome = null;
      live = false;
      placements.length = 0;
      if (!suddenDeath) placements.push({ cube: tuning.core.cube, pos: null });
      core.reset(c, suddenDeath);
      if (!suddenDeath) firstStrikeSeat = null;
      lastArmContactT = 0;
      stalemateSent = false;
      lastContactEventT = NEG_INF;
      for (const seat of SEATS) refreshProfile(seat);
    },

    setLive(on) {
      live = on;
    },

    setProtected(seat, on) {
      state.seats[seat].protected = on;
    },

    step(input, events) {
      out = events;
      const frame = input.frame;
      frameRef = frame;
      curT = frame.simTime;
      curStep = frame.step - 1;
      if (cfg && live && !state.outcome) stepLive(frame, input.intents);
      for (const seat of SEATS) {
        const p = rt[seat].prev, i = input.intents[seat];
        p.guard = i.guard; p.charge = i.charge; p.grip = i.grip; p.overdrive = i.overdrive; p.ability = i.ability; p.burst = i.burst;
        refreshProfile(seat);
      }
    },

    servoProfile(seat) {
      return rt[seat].profile;
    },

    profileRevision(seat) {
      return rt[seat].revision;
    },

    requestPlacements(outArr) {
      const n = placements.length;
      for (let k = 0; k < n; k++) outArr.push(placements[k]);
      placements.length = 0;
      return n;
    },
  };
  return rules;
};

/** Zone multiplier lookup re-exported for HUD tooling that labels hits. */
export { zoneMul } from "./damage.ts";
export type { KitRuntime };
