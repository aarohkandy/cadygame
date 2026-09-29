// src/game/policy/opponent/index.ts (WP4)
// The built-in opponent as a policy module (GAME_DESIGN 5.1, 5.5). It speaks the exact upload contract:
// `reset(ctx)` and `act(obs)` over torquelimit.obs/3, so it runs in the same Worker, the same in-process runner,
// and through the same validation as any user model.
//
//   obs → Perception (lagged view, detectors, habits) → Mind (mood, affect, menace) + DDA (k, effective tier)
//       → Decision (commitment FSM, utilities, reactions, character beats, the scripted sparring cues)
//       → Motor (primitive path → IK → 6 targets) → MotionLayers (affect posture, breathing, gaze, flinch, tells,
//         temperament shaping in joint space) → a 50 Hz chunk covering the decision period plus one tick
//
// Seeded only from ctx.seed: no Math.random, no wall clock. `createOpponent()` gives independent instances (two
// built-in seats share one realm under Node); the module-level `reset`/`act` drive one default instance (Worker).
// The policy status channel (PolicyAction.debug) carries the opponent's affect at 10 Hz, its show events and its
// gaze events as OpponentDebug (EMOTION_BIBLE 11.9 OpponentAffect / ShowEvent); WP8 audio and WP7 hosts read them.

import {
  CORE_CUBE_INDEX, DOCK_CENTER_X, DOCK_RADIUS, EMPTY_OPPONENT_MEMORY, GRIP_CLOSED, INTENT_BITS, JOINT_LIMITS, JOINT_NAMES, MOUNT_X, OBS_SCHEMA, otherSeat,
  type Intents, type Observation, type OpponentAffect, type PolicyAction, type PolicyDebug, type ResetContext, type ShowEvent, type Vec3,
} from "../../contracts.ts";
import { createRng } from "../../core/rng.ts";
import { Dda, type DdaScales, type EffectiveTierId } from "./dda.ts";
import { Decision, TICK_S, type BrainEnv, type TickOutput } from "./decision.ts";
import { MotionLayers, type GazeEvent, type LayerInputs } from "./layers.ts";
import { Mind } from "./mind.ts";
import { Motor } from "./motor.ts";
import { Perception } from "./perception.ts";
import { PERSONALITIES } from "./personalities.ts";
import { guardPose } from "./primitives.ts";

/**
 * What the built-in opponent adds to PolicyDebug (11.9): its affect at 10 Hz, the show events it decided this act,
 * its gaze events, and the tier it is really playing (8.4). Structurally a PolicyDebug; readers narrow to this.
 */
export interface OpponentDebug extends PolicyDebug {
  affect?: OpponentAffect;
  show?: ShowEvent[];
  gaze?: GazeEvent[];
  tier?: EffectiveTierId;
}
/** Where the player's eye sits, ego (m): above and behind their mount. */
const PLAYER_CAMERA: Vec3 = [0.72, 0, 0.34];
const AFFECT_PERIOD_S = 0.1;

export const policyName = "torquelimit.builtin";
export const provenance = { source: "src/game/policy/opponent", design: "GAME_DESIGN 5.5" };

/** Chunk rate of the built-in opponent's output (5.5.2 "Output"). */
export const OPPONENT_CHUNK_HZ = 50;
/** Longest gap the brain simulates tick by tick when an observation arrives late; beyond it, it jumps. */
const MAX_CATCH_UP_TICKS = 50;

export interface OpponentPolicy {
  reset(ctx: ResetContext): void;
  act(obs: Observation): PolicyAction;
  /** Internal state for tests and the brain panel. */
  inspect(): { state: string; primitive: string; reactions: readonly number[]; heavy: { attempts: number; successes: number } | null; ddaK: number; flaw: { count: number; patched: boolean } | null };
}

function bitsToIntents(bits: number): Partial<Intents> {
  const out: Partial<Intents> = {};
  if (bits & INTENT_BITS.guard) out.guard = true;
  if (bits & INTENT_BITS.charge) out.charge = true;
  if (bits & INTENT_BITS.overdrive) out.overdrive = true;
  if (bits & INTENT_BITS.ability) out.ability = true;
  if (bits & INTENT_BITS.burst) out.burst = true;
  return out;
}

export function createOpponent(): OpponentPolicy {
  const perception = new Perception();
  const mind = new Mind();
  const dda = new Dda();
  const motor = new Motor();
  const decision = new Decision();
  const layers = new MotionLayers();
  let ctx: ResetContext | null = null;
  let lastEpisode: string | null = null;
  let simT = -1;
  let periodS = 0.04;
  const scales: DdaScales = { reactionMul: 1, lagMul: 1, punishMul: 1, recognitionMul: 1, tempMul: 1, slamWindupMul: 1, thinkMul: 1, pressureMul: 1 };
  const tick: TickOutput = { pose: guardPose(0.2, 0), intents: 0 };
  let env: BrainEnv | null = null;
  let lastParryGuessKey = "";
  let lastAffectT = -1;
  let gazeSeen = 0;
  const layerInputs: LayerInputs = {
    arousal: 0, valence: 0, stance: 0, gripper: [0.44, 0, 0.15], camera: PLAYER_CAMERA, core: null, aim: [0.44, 0, 0.15], awaySide: 1,
    motion: { phase: "transition", tell: null, side: 1 },
  };

  function tuneperception(e: BrainEnv): void {
    const tier = e.tier, p = e.personality;
    perception.tuning = {
      lagMs: tier.perceptionLagMs * scales.lagMul,
      reaction: { mu: (tier.reaction.mu + p.reactionMuAddMs) * scales.reactionMul, sigma: tier.reaction.sigma, tau: tier.reaction.tau },
      halfLife: tier.habitHalfLife * p.habitHalfLifeMul,
      habitWeight: p.habitWeight,
    };
  }

  /** Task pose → joints through IK, then the motion layers on top (commit advances their state). */
  function solve(t: number, out: TickOutput, commit: boolean, row: number[]): void {
    motor.solve(out.pose, row);
    const e = env as BrainEnv;
    const li = layerInputs;
    li.arousal = mind.arousal; li.valence = mind.valence; li.stance = mind.stance;
    li.motion = decision.motion(t);
    layers.apply(t, row, out.pose, li, e.rng, commit);
  }

  const policy: OpponentPolicy = {
    reset(input: ResetContext): void {
      const c = completeContext(input);
      ctx = c;
      const personality = PERSONALITIES[c.config?.personality ?? "backlash"];
      const newMatch = c.episode_id !== lastEpisode;
      lastEpisode = c.episode_id;
      const rng = createRng(c.seed);
      dda.reset(c);
      dda.scales(scales);
      const memory = c.opponentMemory ?? EMPTY_OPPONENT_MEMORY;
      env = { obs: null as unknown as Observation, ctx: c, rng, perception, mind, layers, scales, tier: dda.tier, personality, memory };
      tuneperception(env);
      perception.reset(perception.tuning, !newMatch);
      mind.reset(personality, !newMatch);
      layers.reset(personality.temperament, rng);
      decision.reset(env, newMatch);
      motor.reset(c.home_pose);
      simT = -1;
      periodS = c.decision_hz > 0 ? 1 / c.decision_hz : 0.04;
      lastParryGuessKey = "";
      lastAffectT = -1; gazeSeen = 0;
    },

    act(obs: Observation): PolicyAction {
      if (!env || !ctx) throw new Error("built-in opponent: act() before reset()");
      const e = env;
      e.obs = obs;
      if (dda.observe(obs, obs.blocks.game)) { dda.scales(scales); tuneperception(e); }
      mind.update(obs);
      // While the guard is up in NEUTRAL, blocks come quicker (μ × 0.8, 5.5.3).
      perception.ingest(obs, e.rng, decision.state === "NEUTRAL" && decision.guardUp);
      decision.onObservation(e);
      const v = perception.view;
      const li = layerInputs;
      li.gripper = v.oppEe; li.aim[0] = (v.oppEe[0] + v.oppWrist[0]) / 2; li.aim[1] = (v.oppEe[1] + v.oppWrist[1]) / 2; li.aim[2] = (v.oppEe[2] + v.oppWrist[2]) / 2;
      const core = obs.cubes[CORE_CUBE_INDEX];
      li.core = core && !core.parked && obs.core.phase === "live" ? core.pos : null;
      li.awaySide = v.oppEe[1] >= 0 ? 1 : -1;

      // Catch up ticks skipped by a late observation (state only).
      if (simT >= 0 && obs.t - simT > TICK_S * 1.5) {
        let n = 0;
        for (let t = simT + TICK_S; t < obs.t - 1e-9 && n < MAX_CATCH_UP_TICKS; t += TICK_S, n++) {
          decision.step(t, e);
          decision.output(t, e, tick, true);
          solve(t, tick, true, [0, 0, 0, 0, 0, 0]);
        }
      }

      const entries = Math.max(2, Math.round(periodS / TICK_S) + 1);
      const chunk: number[][] = new Array(entries);
      const intentChunk: number[] = new Array(entries);
      for (let k = 0; k < entries; k++) {
        const t = obs.t + k * TICK_S;
        const lookahead = k === entries - 1;
        const fresh = t > simT + 1e-9;
        if (fresh && !lookahead) {
          decision.step(t, e);
          simT = t;
        }
        decision.output(t, e, tick, fresh && !lookahead);
        const row = [0, 0, 0, 0, 0, 0];
        solve(t, tick, fresh && !lookahead, row);
        chunk[k] = row;
        intentChunk[k] = tick.intents;
      }

      const debug: OpponentDebug = {
        state: decision.state, primitive: decision.primitive, phase: decision.phase, intent: decision.intentLabel,
        mood: { aggression: round3(mind.mood.aggression), composure: round3(mind.mood.composure), focus: round3(mind.mood.focus) },
        utilities: decision.utilities, tier: dda.tierId,
      };
      if (dda.reporting) debug.dda = dda.k;
      if (decision.parryGuess) {
        const g = decision.parryGuess;
        const key = `${g.expectedReleaseT}|${g.errorMs}`;
        if (key !== lastParryGuessKey) { lastParryGuessKey = key; debug.parryGuess = { ...g }; }
      }
      const flaw = decision.takeFlawReport();
      if (flaw) debug.flaw = flaw;
      if (lastAffectT < 0 || obs.t - lastAffectT >= AFFECT_PERIOD_S - 1e-9) { lastAffectT = obs.t; debug.affect = mind.affect(); }
      const show = decision.takeShow();
      if (show.length > 0) debug.show = show;
      if (layers.gazeEvents.length > gazeSeen) {
        debug.gaze = layers.gazeEvents.slice(gazeSeen).map((g) => ({ ...g }));
        gazeSeen = layers.gazeEvents.length;
      }
      if (gazeSeen > 48) { layers.gazeEvents.splice(0, gazeSeen - 16); gazeSeen = 16; }

      return {
        targets: chunk[0].slice(),
        intents: bitsToIntents(intentChunk[0]),
        chunk, chunkHz: OPPONENT_CHUNK_HZ, chunkStartT: obs.t, intentChunk,
        debug,
      };
    },

    inspect() {
      return {
        state: decision.state,
        primitive: decision.primitive,
        reactions: perception.reactionLog,
        heavy: decision.scripted ? null : decision.heavyParryRecord(),
        ddaK: dda.k,
        flaw: decision.scripted ? null : decision.flaw,
      };
    },
  };
  return policy;
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/**
 * Fills anything a partial context leaves out with this build's defaults (seat blaze, 50/25 Hz, stock home pose,
 * standard arena), so the module stays usable from tools that hand it a bare `{ seed }`.
 */
function completeContext(c: Partial<ResetContext>): ResetContext {
  const side = c.side ?? "blaze";
  const dock = (x: number): Vec3 => [side === "atlas" ? x - MOUNT_X.atlas : -(x - MOUNT_X.blaze), 0, 0];
  return {
    schema: OBS_SCHEMA, protocol: "torquelimit.policy/3", obs_schema_hash: c.obs_schema_hash ?? "",
    side, seed: Number.isFinite(c.seed) ? (c.seed as number) : 0, episode_id: c.episode_id ?? "", round: c.round ?? 1,
    control_hz: c.control_hz ?? 50, decision_hz: c.decision_hz ?? 25, action_delay_ticks: c.action_delay_ticks ?? 1,
    fair_delay_ms: c.fair_delay_ms ?? 0, mode: c.mode ?? "live", preset: c.preset ?? "arcade", physics: c.physics ?? "arcade",
    strict_limits: c.strict_limits ?? false, joint_names: c.joint_names ?? JOINT_NAMES, joint_limits: c.joint_limits ?? JOINT_LIMITS,
    home_pose: c.home_pose ?? [0, -0.62, 1.08, -0.48, 0, GRIP_CLOSED],
    arena: c.arena ?? { opponent_base: [0.64, 0, 0], midline_x: 0.32, dock_self: dock(DOCK_CENTER_X[side]), dock_opponent: dock(DOCK_CENTER_X[otherSeat(side)]), dock_radius: DOCK_RADIUS },
    rules: c.rules ?? { round_length: 45, best_of: 3, integrity_max: 100, loadout: null, scoring: "full" },
    ...(c.config ? { config: c.config } : {}),
    ...(c.opponentMemory ? { opponentMemory: c.opponentMemory } : {}),
  };
}

/* ── module-level policy contract (one instance per realm: the policy Worker) ── */

const defaultInstance = createOpponent();

export function reset(ctx: ResetContext): void {
  defaultInstance.reset(ctx);
}

export function act(obs: Observation): PolicyAction {
  return defaultInstance.act(obs);
}
