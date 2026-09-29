// src/game/policy/proxy-bots/human-proxy.ts (WP4)
// `human_proxy` (GAME_DESIGN 5.5.7): a generalist that plays through the human control path. It only emits
// synthetic mouse counts, key states, and buttons into a real PilotController, so the jab and charge macros,
// assists, leash, heat, and hit stop apply exactly as they do for a person. It reads what a player could see:
// the opponent in its observation, its own ghost and range cue.
//
//  - Reactions: ex-Gaussian μ 250 / σ 40 / τ 80 ms from a visible attack onset to a guard press (or a step back).
//  - Aim: 1 cm Gaussian aim noise on the opponent's hand, re-drawn per aim change; 15% noise on flick amplitude.
//  - Offence: flicks when the range cue says a flick connects, jabs when a jab does, the occasional charged heavy,
//    and steps in with W when out of range.
//  - Objective: uses the grab assist on a live, free Core (Space held over it), carries it home, and lets the dock
//    magnet finish the dock; tries a steal when the opponent's countdown is under 3 s.
// Deterministic: all randomness comes from its seeded Rng; time is obs.t.

import { CORE_CUBE_INDEX, DOCK_CENTER_X, type Observation, type PilotController, type ProxyBot, type SyntheticInput, type Vec3 } from "../../contracts.ts";
import { createRng, exGaussian, gaussian, substream, type Rng } from "../../core/rng.ts";
import { createKinematics } from "../../kinematics/so101-kinematics.ts";
import { yawToward } from "../../input/assists.ts";
import { MOUSE_RAD_PER_COUNT } from "../../input/pilot-controller.ts";
import { worldToEgoPoint } from "../observation.ts";

export const HUMAN_PROXY_REACTION = { mu: 250, sigma: 40, tau: 80 } as const;
export const HUMAN_PROXY_AIM_NOISE_M = 0.01;
export const HUMAN_PROXY_FLICK_NOISE = 0.15;

const VERTICAL_MUL = 0.8;                 // settings default (3.3)
const ONSET_SPEED = 0.35;
const ONSET_HOLD_S = 0.04;
const MAX_AIM_STEP_RAD = 0.35;            // a hand re-aiming, not a flick
const GUARD_HOLD_S: readonly [number, number] = [0.25, 0.45];
const FLICK_AMP_RAD: readonly [number, number] = [0.55, 0.9];
const FLICK_RETURN_S: readonly [number, number] = [0.12, 0.2];
const DOCK_CARRY_Z = 0.07;

type Mode = "neutral" | "flick_return" | "guard" | "jab" | "charge" | "core_reach" | "core_grip" | "core_carry" | "steal";

const KEY_W = "KeyW", KEY_S = "KeyS", KEY_SPACE = "Space";

export function createHumanProxy(): ProxyBot {
  const kin = createKinematics();
  let baseSeed = 0x5eed_7a11;
  let rng: Rng = createRng(baseSeed);
  let roundKey = "";
  let mode: Mode = "neutral";
  let modeUntil = 0;
  let flickBackRad = 0;
  let onsetSince = -1;
  let reactAt = -1;
  let nextOffenceT = 0;
  let aimNoise: Vec3 = [0, 0, 0];
  let aimNoiseUntil = 0;
  let lastT = -1;
  const held = new Map<string, boolean>();
  let lmb = false, rmb = false;
  const ghostEgo: Vec3 = [0, 0, 0];

  function key(input: SyntheticInput, code: string, down: boolean): void {
    if ((held.get(code) ?? false) === down) return;
    held.set(code, down);
    input.key(code, down);
  }
  function button(input: SyntheticInput, b: 0 | 2, down: boolean): void {
    if (b === 0) { if (lmb === down) return; lmb = down; } else { if (rmb === down) return; rmb = down; }
    input.button(b, down);
  }
  function releaseAll(input: SyntheticInput): void {
    for (const [code, down] of held) if (down) input.key(code, false);
    held.clear();
    if (lmb) input.button(0, false);
    if (rmb) input.button(2, false);
    lmb = false; rmb = false;
  }

  /** Mouse counts that move the command yaw toward `yaw` (at most maxStep rad this update). */
  function turnTo(input: SyntheticInput, pilot: PilotController, yaw: number, maxStep: number): void {
    let d = yaw - pilot.command.yaw;
    if (d > maxStep) d = maxStep; else if (d < -maxStep) d = -maxStep;
    const counts = Math.round(d / MOUSE_RAD_PER_COUNT);
    if (counts !== 0) input.move(counts, 0);
  }

  /** Mouse counts that bring the ghost tip height toward z (closed loop on the pilot's own ghost). */
  function liftTo(input: SyntheticInput, pilot: PilotController, z: number): void {
    const err = z - ghostEgo[2];
    if (Math.abs(err) < 0.004) return;
    const reach = Math.max(0.12, pilot.command.reach);
    const dElev = Math.max(-0.25, Math.min(0.25, err / reach));
    const counts = Math.round(-dElev / (MOUSE_RAD_PER_COUNT * VERTICAL_MUL));
    if (counts !== 0) input.move(0, counts);
  }

  function reseed(obs: Observation): void {
    rng = createRng(substream(baseSeed, "human_proxy", obs.side, obs.round.index));
    mode = "neutral"; modeUntil = 0; onsetSince = -1; reactAt = -1;
    nextOffenceT = obs.t + rng.range(0.4, 0.9);
    aimNoiseUntil = 0; lastT = -1;
  }

  return {
    reset(seed: number) {
      baseSeed = seed >>> 0;
      rng = createRng(baseSeed);
      roundKey = "";
    },

    update(obs, pilot, input, wallDtS) {
      void wallDtS;
      const key0 = `${obs.side}|${obs.round.index}`;
      if (key0 !== roundKey || obs.t < lastT) { releaseAll(input); roundKey = key0; reseed(obs); }
      lastT = obs.t;
      const fight = obs.round.phase === "fight" || obs.round.phase === "sudden_death";
      if (!fight) { releaseAll(input); mode = "neutral"; return; }

      const g = pilot.ghost.tipWorld;
      worldToEgoPoint(pilot.seat, g[0], g[1], g[2], ghostEgo);
      const opp = obs.opponent;
      const t = obs.t;

      // Aim noise re-drawn every 0.4–0.8 s, like a hand settling on a new point.
      if (t >= aimNoiseUntil) {
        aimNoise = [gaussian(rng, 0, HUMAN_PROXY_AIM_NOISE_M), gaussian(rng, 0, HUMAN_PROXY_AIM_NOISE_M), gaussian(rng, 0, HUMAN_PROXY_AIM_NOISE_M * 0.5)];
        aimNoiseUntil = t + rng.range(0.4, 0.8);
      }
      const aimX = opp.ee.pos[0] + aimNoise[0], aimY = opp.ee.pos[1] + aimNoise[1], aimZ = opp.ee.pos[2] + aimNoise[2];

      // Attack onset on the opponent hand: closing on our hand faster than 0.35 m/s for 40 ms.
      const own = obs.self.ee.pos;
      const dx = own[0] - opp.ee.pos[0], dy = own[1] - opp.ee.pos[1], dz = own[2] - opp.ee.pos[2];
      const dist = Math.hypot(dx, dy, dz);
      const closing = dist > 1e-6 ? (opp.ee.linvel[0] * dx + opp.ee.linvel[1] * dy + opp.ee.linvel[2] * dz) / dist : 0;
      if (closing > ONSET_SPEED || opp.charge_public > 0) {
        if (onsetSince < 0) onsetSince = t;
        if (reactAt < 0 && t - onsetSince >= ONSET_HOLD_S) {
          reactAt = onsetSince + exGaussian(rng, HUMAN_PROXY_REACTION.mu, HUMAN_PROXY_REACTION.sigma, HUMAN_PROXY_REACTION.tau) / 1000;
        }
      } else {
        onsetSince = -1;
      }

      const core = obs.cubes[CORE_CUBE_INDEX];
      const coreFree = !!core && obs.core.phase === "live" && !core.parked && core.held_by !== "opponent" && obs.core.docked_in === null;
      const holdingCore = !!core && core.held_by === "self";

      // Defence interrupts offence (not a committed grab).
      if (reactAt >= 0 && t >= reactAt && mode !== "core_grip" && mode !== "core_carry") {
        reactAt = -1;
        button(input, 0, false);
        if (rng.next() < 0.7) {
          mode = "guard";
          modeUntil = t + rng.range(GUARD_HOLD_S[0], GUARD_HOLD_S[1]);
          button(input, 2, true);
        } else {
          mode = "neutral";
          key(input, KEY_S, true);
          modeUntil = t + 0.25;
        }
      }

      switch (mode) {
        case "guard":
          turnTo(input, pilot, yawToward(kin, aimX, aimY), MAX_AIM_STEP_RAD);
          if (t >= modeUntil) { button(input, 2, false); mode = "neutral"; nextOffenceT = t + rng.range(0.05, 0.25); }
          return;
        case "flick_return":
          if (t >= modeUntil) { input.move(Math.round(-flickBackRad / MOUSE_RAD_PER_COUNT), 0); mode = "neutral"; }
          return;
        case "jab":
          if (t >= modeUntil) { button(input, 0, false); mode = "neutral"; }
          return;
        case "charge":
          turnTo(input, pilot, yawToward(kin, aimX, aimY), 0.1);
          if (t >= modeUntil) { button(input, 0, false); mode = "neutral"; nextOffenceT = t + rng.range(0.35, 0.7); }
          return;
        case "core_reach":
        case "core_grip":
          if (!coreFree && !holdingCore) { key(input, KEY_SPACE, false); mode = "neutral"; return; }
          if (holdingCore) { mode = "core_carry"; return; }
          turnTo(input, pilot, yawToward(kin, core.pos[0], core.pos[1]), MAX_AIM_STEP_RAD);
          liftTo(input, pilot, 0.06);
          if (Math.hypot(ghostEgo[0] - core.pos[0], ghostEgo[1] - core.pos[1]) < 0.05) { key(input, KEY_SPACE, true); mode = "core_grip"; }
          if (t >= modeUntil) { key(input, KEY_SPACE, false); mode = "neutral"; }
          return;
        case "core_carry": {
          if (!holdingCore) { key(input, KEY_SPACE, false); mode = "neutral"; return; }
          const dock = dockEgo(obs);
          turnTo(input, pilot, yawToward(kin, dock[0], dock[1]), 0.12);
          liftTo(input, pilot, DOCK_CARRY_Z);
          const dxy = Math.hypot(core.pos[0] - dock[0], core.pos[1] - dock[1]);
          if (dxy < 0.035) key(input, KEY_SPACE, false);            // the dock magnet takes it from here
          if (t >= modeUntil + 4) { key(input, KEY_SPACE, false); mode = "neutral"; }
          return;
        }
        case "steal":
          turnTo(input, pilot, yawToward(kin, core.pos[0], core.pos[1]), MAX_AIM_STEP_RAD);
          liftTo(input, pilot, 0.05);
          if (t >= modeUntil) { key(input, KEY_SPACE, false); key(input, KEY_W, false); mode = "neutral"; }
          return;
        default:
          break;
      }

      // Neutral: release step-back keys, track the opponent's hand, choose the next move.
      if (t >= modeUntil) key(input, KEY_S, false);
      turnTo(input, pilot, yawToward(kin, aimX, aimY), MAX_AIM_STEP_RAD);
      liftTo(input, pilot, Math.max(0.06, Math.min(0.2, aimZ)));

      if (coreFree && Math.hypot(core.pos[0] - own[0], core.pos[1] - own[1]) < 0.3) {
        mode = "core_reach"; modeUntil = t + 2.5;
        key(input, KEY_W, false);
        return;
      }
      if (holdingCore) { mode = "core_carry"; modeUntil = t; return; }
      if (obs.core.owner === "opponent" && obs.core.docked_in === "opponent" && obs.core.lock_in_remaining < 3 && core) {
        mode = "steal"; modeUntil = t + 1.2;
        key(input, KEY_SPACE, true); key(input, KEY_W, true);
        return;
      }

      const cue = pilot.rangeCue;
      key(input, KEY_W, !cue.flick && !cue.jab && cue.nearestM > 0.04);
      if (t < nextOffenceT) return;
      const roll = rng.next();
      if (cue.jab && roll < 0.35) {
        mode = "jab"; modeUntil = t + rng.range(0.06, 0.12);
        button(input, 0, true);
        nextOffenceT = t + rng.range(0.3, 0.6);
      } else if (cue.flick && roll < 0.8) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const amp = rng.range(FLICK_AMP_RAD[0], FLICK_AMP_RAD[1]) * (1 + gaussian(rng, 0, HUMAN_PROXY_FLICK_NOISE));
        // Wind the hand to one side, then sweep through the target: the servo turns the jump into swing speed.
        input.move(Math.round((side * amp) / MOUSE_RAD_PER_COUNT), 0);
        flickBackRad = side * amp * rng.range(1.6, 2.0);   // the return sweeps through the target to the far side
        mode = "flick_return"; modeUntil = t + rng.range(FLICK_RETURN_S[0], FLICK_RETURN_S[1]);
        nextOffenceT = t + rng.range(0.35, 0.75);
      } else if ((cue.flick || cue.jab) && roll < 0.9) {
        mode = "charge"; modeUntil = t + rng.range(0.65, 1.0);
        button(input, 0, true);
      } else {
        nextOffenceT = t + rng.range(0.2, 0.5);
      }
    },
  };
}

/** Own dock centre in the seat's ego frame. */
function dockEgo(obs: Observation): Vec3 {
  return worldToEgoPoint(obs.side, DOCK_CENTER_X[obs.side], 0, 0, [0, 0, 0]);
}
