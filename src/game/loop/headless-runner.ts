// src/game/loop/headless-runner.ts (WP1)
// Runs a whole match in Node (eval CLI, smoke suite, tests) with the exact sim-driver and match-director
// the browser uses (GAME_DESIGN 10.3 "Headless"): no rendering, no wall clock, presentation phases
// collapsed to their eval step counts, every decision lockstepped, in-process seat drivers, and an
// optional PilotController fed by a proxy bot. There is no second match loop.

import {
  SEATS,
  type CreateChunkExecutor, type CreateHeadlessMatchRunner, type CreateInProcessSeatDriver, type Episode,
  type HeadlessMatchRunner, type HitstopMsFor, type MatchConfig, type ObservationDelayLine, type PhysicsEngine,
  type PilotController, type Seat,
} from "../contracts.ts";
import { createGameClock } from "./game-clock.ts";
import { createSimDriver, type SeatBinding } from "./sim-driver.ts";
import { createMatchDirector, type SeatBindingFactory } from "../match/match-director.ts";
import { pilotSeatOf, validateMatchConfig, type EpisodeProvenanceSource } from "../match/match-config.ts";
import { PRESETS } from "../match/presets.ts";
import { createUiStore } from "../core/ui-store.ts";
import { createSettingsStore } from "../core/settings.ts";
import { hitstopMsFor } from "../combat/tuning.ts";
import { createChunkExecutor } from "../policy/chunk-executor.ts";
import { createObservationDelayLine } from "../policy/observation.ts";

/** Steps run between event flushes and abort checks. */
export const HEADLESS_CHUNK_STEPS = 4096;

/** Loop services that live outside the contract deps (WP2 hit stop table, WP4 delay line and chunk executor). */
export interface HeadlessLoopServices {
  createChunkExecutor: CreateChunkExecutor;
  createDelayLine: () => ObservationDelayLine;
  hitstopMsFor: HitstopMsFor;
  /** Passed to createEngine (Node: the repo root that holds public/models). */
  nodeFsRoot?: string;
  provenance?: Partial<EpisodeProvenanceSource>;
  obsSchemaHash?: string;
  /** Lockstep hard abort per act (default 30 s). */
  hardAbortMs?: number;
}

export class HeadlessRunAbortedError extends Error {
  constructor() {
    super("headless match aborted");
    this.name = "AbortError";
  }
}

const DEFAULT_PROVENANCE: EpisodeProvenanceSource = {
  tuning: null, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "", harnessCommit: "", userAgent: "node",
};

function nodeUserAgent(): string {
  const proc = (globalThis as { process?: { version?: string; platform?: string; arch?: string } }).process;
  return proc?.version ? `node ${proc.version} ${proc.platform ?? ""} ${proc.arch ?? ""}`.trim() : "headless";
}

/** Binds the loop services and returns a factory with the contract signature. */
export function defineHeadlessMatchRunner(loop: HeadlessLoopServices): CreateHeadlessMatchRunner {
  return (deps) => {
    const runner: HeadlessMatchRunner = {
      async run(cfg: MatchConfig, signal?: AbortSignal): Promise<Episode> {
        if (signal?.aborted) throw new HeadlessRunAbortedError();
        const errors = validateMatchConfig(cfg);
        if (SEATS.some((s) => cfg.seats[s].driver.kind === "human")) errors.push("HEADLESS NEEDS NO HUMAN");
        if (errors.length > 0) throw new Error(`invalid headless match config: ${errors.join("; ")}`);
        // Headless always lockstep with presentation collapsed to eval step counts, and always records.
        const runCfg: MatchConfig = { ...cfg, timing: "eval", turbo: false, record: true };

        const engine: PhysicsEngine = await deps.createEngine({ mode: PRESETS[runCfg.preset].physics, nodeFsRoot: loop.nodeFsRoot });
        const rules = deps.createRules(engine.info);
        const clock = createGameClock({ hitstop: false, dilation: false });
        const settings = createSettingsStore({ storage: null });
        const ui = createUiStore();
        const pilotSeat = pilotSeatOf(runCfg);
        let pilot: PilotController | null = null;
        if (pilotSeat) {
          if (!deps.createPilot || !deps.createProxyBot) {
            engine.dispose();
            throw new Error(`seat ${pilotSeat} needs a pilot controller and proxy bot factory`);
          }
          pilot = deps.createPilot({ kinematics: deps.kinematics, settings, clock, profileMatchesPlayed: () => 0 });
        }

        const sim = createSimDriver({
          engine, rules, clock, kinematics: deps.kinematics, observations: deps.observations,
          createDelayLine: loop.createDelayLine, createChunkExecutor: loop.createChunkExecutor, hitstopMsFor: loop.hitstopMsFor,
          pilot, bus: null, obsSchemaHash: loop.obsSchemaHash, hardAbortMs: loop.hardAbortMs,
        });

        const createDriver = deps.createSeatDriver as CreateInProcessSeatDriver;
        const seats: SeatBindingFactory = {
          async create(c) {
            const out = {} as Record<Seat, SeatBinding>;
            try {
              for (const s of SEATS) {
                const spec = c.seats[s].driver;
                if (spec.kind === "human") throw new Error("headless matches cannot seat a human");
                if (spec.kind === "proxy") {
                  out[s] = { kind: "pilot", proxy: (deps.createProxyBot as NonNullable<typeof deps.createProxyBot>)(spec.bot) };
                  continue;
                }
                const driver = await createDriver(spec, s, { modulePath: spec.kind === "module" ? spec.fileName : undefined });
                out[s] = { kind: "policy", driver };
              }
            } catch (err) {
              seats.dispose(out);
              throw err;
            }
            return out;
          },
          dispose(b) {
            for (const s of SEATS) {
              const binding = b[s];
              if (binding?.kind === "policy") binding.driver.dispose();
            }
          },
        };

        const director = createMatchDirector({
          sim, engine, rules, clock, ui, settings, pilot, seats,
          harness: { createRecorder: deps.createRecorder, moments: null, store: null, computeStats: null },
          replay: null,
          provenance: { ...DEFAULT_PROVENANCE, userAgent: nodeUserAgent(), ...loop.provenance },
          nextSeed: () => runCfg.seed,
          now: () => new Date(),
        });

        let finished = false;
        try {
          await director.startMatch(runCfg);
          const ended = director.whenMatchEnds().then((ep) => { finished = true; return ep; });
          while (!finished) {
            if (signal?.aborted) throw new HeadlessRunAbortedError();
            const n = sim.advance(HEADLESS_CHUNK_STEPS);
            sim.flushEvents();
            if (finished) break;
            if (sim.blocked) {
              await sim.whenUnblocked();
            } else if (n === 0) {
              throw new Error(`headless match stalled in phase ${director.phase}`);
            } else {
              // Let timers, aborts, and driver promises run between chunks.
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }
          const episode = await ended;
          if (!episode) throw new Error("headless match ended without an episode");
          return episode;
        } finally {
          director.dispose();
          pilot?.dispose();
          engine.dispose();
        }
      },
    };
    return runner;
  };
}

/** The contract factory (GAME_DESIGN 11.3): the runner bound to WP2's hit stop table and WP4's chunk executor and delay line. */
export const createHeadlessMatchRunner: CreateHeadlessMatchRunner = defineHeadlessMatchRunner({
  createChunkExecutor,
  createDelayLine: createObservationDelayLine,
  hitstopMsFor,
});
