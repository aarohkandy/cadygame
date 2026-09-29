// src/game/combat/abilities.ts (WP2)
// The Arcade kit: charge → release → heavy tag or whiff (4.7), the loadout signatures SNAP, RECOIL COIL and BULWARK and
// Overdrive (4.8). Stock presets never call into this module; their intents are recorded and ignored.
import type { AbilityId, AbilityState, LoadoutId, Seat, SeatCombatState } from "../contracts.ts";
import { clampHeat } from "./heat.ts";
import type { EventSink } from "./servo-states.ts";
import { LOADOUTS, tuning } from "./tuning.ts";

const CH = tuning.arcade.charge;
const AB = tuning.arcade.abilities;
const HEAT = tuning.arcade.heat;

export function initialAbility(loadout: LoadoutId): AbilityState {
  const id: AbilityId = LOADOUTS[loadout].ability;
  switch (id) {
    case "snap": return { id, charges: AB.snap.charges, maxCharges: AB.snap.charges, cooldownMs: 0, cooldownTotalMs: AB.snap.rechargeMs, activeMs: 0 };
    case "recoil_coil": return { id, charges: 1, maxCharges: 1, cooldownMs: 0, cooldownTotalMs: AB.recoil_coil.cooldownMs, activeMs: 0 };
    case "bulwark": return { id, charges: 1, maxCharges: 1, cooldownMs: 0, cooldownTotalMs: AB.bulwark.cooldownMs, activeMs: 0 };
  }
}

export interface KitRuntime {
  chargeNeedsRelease: boolean;      // an auto-release at the hold limit needs the button released before a new charge
  whiffPending: boolean;            // a release is waiting for its heavy strike
  releasedC: number;
  armourTailMs: number;
  whiffRecoveryMs: number;
  bulwarkRawTaken: number;
  publicSent: boolean; fullSent: boolean;
}

export function createKitRuntime(): KitRuntime {
  return { chargeNeedsRelease: false, whiffPending: false, releasedC: 0, armourTailMs: 0, whiffRecoveryMs: 0, bulwarkRawTaken: 0, publicSent: false, fullSent: false };
}

export function resetKitRuntime(k: KitRuntime): void {
  Object.assign(k, createKitRuntime());
}

export function abilityActive(s: SeatCombatState, id: AbilityId): boolean {
  return s.ability.id === id && s.ability.activeMs > 0;
}

/** Charge may run outside Stun and Offline, and never under an active BULWARK. */
export function chargeAllowed(s: SeatCombatState): boolean {
  return s.servoState !== "stun" && s.servoState !== "offline" && !abilityActive(s, "bulwark");
}

export function abilityAllowed(s: SeatCombatState): boolean {
  return s.servoState !== "stun" && s.servoState !== "offline";
}

/** Heavy armour: from c ≥ 0.667 through the hold until 120 ms after release. */
export function updateArmour(s: SeatCombatState, k: KitRuntime): void {
  s.armoured = (s.charging && s.charge >= CH.armourAt) || k.armourTailMs > 0;
}

/**
 * Advances the charge by one step. `held` is intents.charge; returns nothing, emits start/public/full/release and
 * whiff. The release path is shared by the falling edge and the 1000 ms auto-release.
 */
export function stepCharge(s: SeatCombatState, k: KitRuntime, seat: Seat, held: boolean, dtMs: number, t: number, step: number, emit: EventSink): void {
  if (k.armourTailMs > 0) k.armourTailMs = Math.max(0, k.armourTailMs - dtMs);
  if (s.releaseBoostMs > 0) s.releaseBoostMs = Math.max(0, s.releaseBoostMs - dtMs);
  if (k.whiffRecoveryMs > 0) k.whiffRecoveryMs = Math.max(0, k.whiffRecoveryMs - dtMs);
  if (s.heavyTagMs > 0) {
    s.heavyTagMs = Math.max(0, s.heavyTagMs - dtMs);
    if (s.heavyTagMs === 0 && k.whiffPending) {
      k.whiffPending = false;
      s.heavyTagC = 0;
      s.heat = clampHeat(s.heat + HEAT.whiff);
      k.whiffRecoveryMs = CH.whiffRecoveryMs;
      emit({ type: "whiff", t, step, seat });
    }
  }
  if (!held) k.chargeNeedsRelease = false;

  if (s.charging) {
    if (!held || !chargeAllowed(s)) {
      if (!chargeAllowed(s)) { cancelCharge(s, k, seat, t, step, emit, false); return; }
      release(s, k, seat, t, step, emit);
      return;
    }
    if (s.charge < 1) {
      s.charge = Math.min(1, s.charge + dtMs / CH.rampMs);
    } else {
      s.chargeHoldMs += dtMs;
    }
    if (!k.publicSent && s.charge >= CH.publicAt) { k.publicSent = true; emit({ type: "charge", t, step, seat, stage: "public", c: s.charge }); }
    if (!k.fullSent && s.charge >= 1) { k.fullSent = true; emit({ type: "charge", t, step, seat, stage: "full", c: 1 }); }
    if (s.chargeHoldMs >= CH.holdMaxMs) {
      release(s, k, seat, t, step, emit);
      k.chargeNeedsRelease = true;
    }
    return;
  }
  if (held && !k.chargeNeedsRelease && chargeAllowed(s)) {
    s.charging = true;
    s.charge = Math.min(1, dtMs / CH.rampMs);   // the press step is the first ramp step: c = 1 exactly 600 ms in
    s.chargeHoldMs = 0;
    k.publicSent = false;
    k.fullSent = false;
    k.chargeNeedsRelease = true;          // one charge per press
    emit({ type: "charge", t, step, seat, stage: "start", c: 0 });
  }
}

function release(s: SeatCombatState, k: KitRuntime, seat: Seat, t: number, step: number, emit: EventSink): void {
  const c = s.charge;
  s.charging = false;
  s.charge = 0;
  s.chargeHoldMs = 0;
  s.releaseBoostMs = CH.releaseBoostMs;
  s.heavyTagMs = CH.heavyWindowMs;
  s.heavyTagC = c;
  k.releasedC = c;
  k.whiffPending = true;
  if (c >= CH.armourAt) k.armourTailMs = CH.armourTailMs;
  emit({ type: "charge", t, step, seat, stage: "release", c });
}

/** Guard-press cancel (+8 heat, no whiff), or a forced cancel by Stagger/Stun (no heat). */
export function cancelCharge(s: SeatCombatState, k: KitRuntime, seat: Seat, t: number, step: number, emit: EventSink, byGuard: boolean): void {
  if (!s.charging) return;
  const c = s.charge;
  s.charging = false;
  s.charge = 0;
  s.chargeHoldMs = 0;
  k.armourTailMs = 0;
  if (byGuard) s.heat = clampHeat(s.heat + HEAT.chargeCancel);
  emit({ type: "charge", t, step, seat, stage: "cancel", c });
}

/** Consumes the heavy tag for a landed strike. Returns c, or null when the attacker is not tagged. */
export function consumeHeavyTag(s: SeatCombatState, k: KitRuntime): number | null {
  if (s.heavyTagMs <= 0) return null;
  const c = s.heavyTagC;
  s.heavyTagMs = 0;
  s.heavyTagC = 0;
  k.whiffPending = false;
  return c;
}

/** Ability press edge. Returns true when the ability fired. */
export function activateAbility(s: SeatCombatState, k: KitRuntime, seat: Seat, t: number, step: number, emit: EventSink): boolean {
  if (!abilityAllowed(s)) return false;
  const a = s.ability;
  switch (a.id) {
    case "snap":
      if (a.charges <= 0 || a.activeMs > 0) return false;
      a.charges--;
      a.activeMs = AB.snap.activeMs;
      if (a.cooldownMs <= 0) a.cooldownMs = AB.snap.rechargeMs;
      s.heat = clampHeat(s.heat + AB.snap.heat);
      break;
    case "recoil_coil":
      if (a.charges <= 0) return false;
      a.charges = 0;
      a.activeMs = AB.recoil_coil.activeMs;
      a.cooldownMs = AB.recoil_coil.cooldownMs;
      break;
    case "bulwark":
      if (a.charges <= 0) return false;
      a.charges = 0;
      a.activeMs = AB.bulwark.activeMs;
      a.cooldownMs = 0;                   // BULWARK's cooldown starts when it ends
      k.bulwarkRawTaken = 0;
      if (s.charging) cancelCharge(s, k, seat, t, step, emit, false);
      break;
  }
  emit({ type: "ability", t, step, seat, ability: a.id, phase: "start" });
  return true;
}

/** Ends an active ability early (RECOIL COIL consumed, BULWARK broken) or on its timer. */
export function endAbility(s: SeatCombatState, seat: Seat, t: number, step: number, emit: EventSink): void {
  const a = s.ability;
  if (a.activeMs <= 0) return;
  a.activeMs = 0;
  if (a.id === "bulwark") a.cooldownMs = AB.bulwark.cooldownMs;
  emit({ type: "ability", t, step, seat, ability: a.id, phase: "end" });
}

/** Timers: active windows, SNAP's sequential recharge, cooldowns. */
export function stepAbility(s: SeatCombatState, seat: Seat, dtMs: number, t: number, step: number, emit: EventSink): void {
  const a = s.ability;
  if (a.activeMs > 0) {
    a.activeMs = Math.max(0, a.activeMs - dtMs);
    if (a.activeMs === 0) {
      a.activeMs = 1;                      // let endAbility see it as active and emit exactly once
      endAbility(s, seat, t, step, emit);
    }
  }
  if (a.cooldownMs > 0 && !(a.id === "bulwark" && a.activeMs > 0)) {
    a.cooldownMs = Math.max(0, a.cooldownMs - dtMs);
    if (a.cooldownMs === 0) {
      if (a.id === "snap") {
        a.charges = Math.min(a.maxCharges, a.charges + 1);
        if (a.charges < a.maxCharges) a.cooldownMs = AB.snap.rechargeMs;
      } else {
        a.charges = 1;
      }
    }
  }
}
