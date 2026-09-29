// src/game/combat/heat.ts (WP2)
// Heat (stamina), GAME_DESIGN 4.5. Arcade: a real resource that ends in Thermal Cutout. Stock presets: telemetry only,
// computed with its own k_Q and never read by any scoring or servo rule.
import type { ArmFrame } from "../contracts.ts";
import { tuning } from "./tuning.ts";

export interface HeatModel {
  kQ: number; idleCool: number; extraCool: number; coolQ: number; coolHoldS: number; max: number;
  guard: number; charging: number; overdrive: number;
}

export const ARCADE_HEAT: Readonly<HeatModel> = Object.freeze({
  kQ: tuning.arcade.heat.kQ, idleCool: tuning.arcade.heat.idleCool, extraCool: tuning.arcade.heat.extraCool,
  coolQ: tuning.arcade.heat.coolQ, coolHoldS: tuning.arcade.heat.coolHoldS, max: tuning.arcade.heat.max,
  guard: tuning.arcade.guard.holdHeatPerS, charging: tuning.arcade.heat.charging, overdrive: tuning.arcade.heat.overdrive,
});

export const STOCK_HEAT: Readonly<HeatModel> = Object.freeze({
  kQ: tuning.stock.heat.kQ, idleCool: tuning.stock.heat.idleCool, extraCool: tuning.stock.heat.extraCool,
  coolQ: tuning.stock.heat.coolQ, coolHoldS: tuning.stock.heat.coolHoldS, max: tuning.stock.heat.max,
  guard: 0, charging: 0, overdrive: 0,
});

export interface HeatRuntime { lowQHeldS: number; lastQ: number }

export function createHeatRuntime(): HeatRuntime {
  return { lowQHeldS: 0, lastQ: 0 };
}

/**
 * Q = mean over the 5 arm joints of (actuator_force / current forcerange)².
 *
 * No hold-your-own-weight deadband here, deliberately. It looks like the fix for "heat pins at 92–100 for a
 * whole round", but the real defect was that pinning had no CONSEQUENCE: Thermal Cutout only fired on a rising
 * edge, so a seat already at max never tripped it (see the peak test in combat-rules). Subtracting a deadband
 * instead makes every strike bank less heat, and `tests/combat-heat.test.mjs` proves the cost — at 0.30 flick
 * spam every 250 ms no longer reaches Cutout inside 4–8 s, i.e. heat stops being a limiter at all.
 */
export function servoLoadQ(arm: ArmFrame): number {
  let sum = 0;
  for (let j = 0; j < 5; j++) {
    const r = arm.forceRange[j];
    if (r > 0) { const x = arm.tau[j] / r; sum += x * x; }
  }
  return sum / 5;
}

export interface HeatDrivers { guarding: boolean; guardMul: number; charging: boolean; overdrive: boolean }

export const NO_HEAT_DRIVERS: Readonly<HeatDrivers> = Object.freeze({ guarding: false, guardMul: 1, charging: false, overdrive: false });

/** One step of dH/dt = k_Q·Q·loadoutHeat − 5 [− 15 after 0.8 s of Q < 0.02] + holds. Returns the clamped heat. */
export function integrateHeat(heat: number, rt: HeatRuntime, q: number, dtS: number, model: Readonly<HeatModel>, loadoutHeat: number, d: Readonly<HeatDrivers>): number {
  rt.lastQ = q;
  if (q < model.coolQ) rt.lowQHeldS += dtS; else rt.lowQHeldS = 0;
  let rate = model.kQ * q * loadoutHeat - model.idleCool;
  // The deep-cool is an IDLE bonus, not a subsidy for holding something. Ungated, guarding with a still arm
  // net-cooled at 14/s (-20 idle +6 guard), so "push now or cool down" was never a decision and a guard war
  // could not be broken. Holding a charge or Overdrive stops being free thinking time for the same reason.
  if (rt.lowQHeldS >= model.coolHoldS && !d.guarding && !d.charging && !d.overdrive) rate -= model.extraCool;
  if (d.guarding) rate += model.guard * d.guardMul;
  if (d.charging) rate += model.charging;
  if (d.overdrive) rate += model.overdrive;
  return clampHeat(heat + rate * dtS, model.max);
}

export function clampHeat(h: number, max = 100): number {
  return h < 0 ? 0 : h > max ? max : h;
}
