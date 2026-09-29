// src/game/harness/harness-api.ts (WP5)
// The harness facade the game handle, the Lab, the Replays screen, and the eval CLI use: recorder factory,
// the moment buffer, episode and entrant stores, the JSON codec, replay player, stats, aggregates, the
// smoke suite, episode verify, and the policy determinism check.

import type { CreateHarnessApi, Episode, EpisodeStore, HarnessApi, VerifyResult } from "../contracts.ts";
import { aggregate } from "./aggregate.ts";
import { checkPolicyDeterminism, verifyEpisode, withDeterminism } from "./determinism.ts";
import { createEpisodeCodec } from "./episode-format.ts";
import { createMomentBuffer } from "./moment-buffer.ts";
import { createRecorder } from "./recorder.ts";
import { createReplayPlayer } from "./replay-player.ts";
import { computeStats } from "./stats.ts";
import { runSuite } from "./suite.ts";

export type HarnessDeps = Parameters<CreateHarnessApi>[0] & {
  /** Node: repository root holding public/models, passed to createEngine. */
  nodeFsRoot?: string;
};

/** Writes a verify outcome into the stored copy so verdicts can require a passing determinism check. */
async function recordDeterminism(store: EpisodeStore, ep: Episode, result: VerifyResult): Promise<void> {
  if (result.verdict === "error" || ep.meta.result.determinism === result.verdict) return;
  try {
    await store.load(ep.meta.episodeId);
  } catch {
    return;   // not a stored episode (a suite run kept in memory, a file not imported)
  }
  const updated = withDeterminism(ep, result);
  ep.meta.result.determinism = updated.meta.result.determinism;
  await store.save(updated);
}

export function createHarnessApiWith(deps: HarnessDeps): HarnessApi {
  const codec = createEpisodeCodec();
  const verifyDeps = { createEngine: deps.createEngine, createRules: deps.createRules, nodeFsRoot: deps.nodeFsRoot };
  const persist = (ep: Episode, result: VerifyResult) => {
    recordDeterminism(deps.store, ep, result).catch(() => undefined);
  };

  const api: HarnessApi = {
    recorder: createRecorder(),
    moments: createMomentBuffer(),
    store: deps.store,
    entrants: deps.entrants,
    codec,

    createRecorder,

    createReplayPlayer(engine, clock, rules) {
      return createReplayPlayer({
        engine, clock, rules, createEngine: deps.createEngine, createRules: deps.createRules, nodeFsRoot: deps.nodeFsRoot,
        onVerified: persist,
      });
    },

    computeStats,

    aggregate,

    runSuite(opts) {
      return runSuite(opts, {
        runner: deps.runner, store: deps.store, computeStats,
        verify: (ep) => verifyEpisode(ep, verifyDeps),
      });
    },

    async checkDeterminism(ep) {
      const result = await verifyEpisode(ep, verifyDeps);
      persist(ep, result);
      return result;
    },

    checkPolicyDeterminism(driverSpec, seat) {
      return checkPolicyDeterminism(driverSpec, seat, {
        createEngine: deps.createEngine, createRules: deps.createRules, createSeatDriver: deps.createSeatDriver,
        observations: deps.observations, nodeFsRoot: deps.nodeFsRoot,
      });
    },
  };
  return api;
}

export const createHarnessApi: CreateHarnessApi = (deps) => createHarnessApiWith(deps);
