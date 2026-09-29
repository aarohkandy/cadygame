// Bot sweeps on real physics (BUILD_PLAN 4 WP4 criteria 4 and 7). Matches run in parallel worker threads.
// In-repo sizes are trimmed to keep `npm test` fast; TL_FULL_SWEEP=1 runs the full sizes (20 / 50 seeds), which is
// meant for the homebase server.
import assert from "node:assert/strict";
import os from "node:os";
import { describe, test } from "node:test";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const FULL = process.env.TL_FULL_SWEEP === "1";

if (!isMainThread) {
  const { createHeadlessMatchRunner } = await import("../src/game/loop/headless-runner.ts");
  const { createPhysicsEngine } = await import("../src/game/physics/engine.ts");
  const { createCombatRules } = await import("../src/game/combat/combat-rules.ts");
  const { createKinematics } = await import("../src/game/kinematics/so101-kinematics.ts");
  const { createObservationBuilder } = await import("../src/game/policy/observation.ts");
  const { createInProcessSeatDriver } = await import("../src/game/policy/in-process-driver.ts");
  const { buildMatchConfig } = await import("../src/game/match/match-config.ts");
  const { createFakeRecorder } = await import("../src/game/testing/fakes.ts");
  const root = workerData.root;
  const probe = await createPhysicsEngine({ mode: "arcade", nodeFsRoot: root });
  const observations = createObservationBuilder(probe.info);
  probe.dispose();
  const spec = (x) => {
    const [p, t] = x.split(":");
    return p === "jig" ? { kind: "builtin", personality: "jig", tier: "contender", dda: false, behavior: t } : { kind: "builtin", personality: p, tier: t, dda: false };
  };
  for (const job of workerData.jobs) {
    let recorder = null;
    let faults = 0;
    const runner = createHeadlessMatchRunner({
      createEngine: (o) => createPhysicsEngine({ ...o, nodeFsRoot: root }), createRules: createCombatRules, kinematics: createKinematics(),
      observations, createSeatDriver: createInProcessSeatDriver, createPilot: null, createProxyBot: null,
      createRecorder: () => { recorder = createFakeRecorder(); return recorder; },
    });
    const aSeat = job.i % 2 === 0 ? "atlas" : "blaze";
    const bSeat = aSeat === "atlas" ? "blaze" : "atlas";
    const cfg = buildMatchConfig({ preset: "arcade", context: "suite", seed: job.seed, bestOf: 3, now: new Date("2026-09-16T12:00:00Z"), seats: { [aSeat]: { driver: spec(job.a) }, [bSeat]: { driver: spec(job.b) } } });
    const ep = await runner.run(cfg);
    for (const r of recorder.rows) for (const s of ["atlas", "blaze"]) if (r.status[s] === "clamped" || r.status[s] === "error") faults++;
    faults += ep.events.filter((e) => e.type === "joint_limit_violation" || e.type === "policy_fault").length;
    parentPort.postMessage({ key: job.key, aWon: ep.meta.result.winner === aSeat, faults });
  }
}

/** Worker threads the sweep will use. Hoisted so the time budget below is computed from the same number. */
const SWEEP_THREADS = Math.max(1, Math.min(os.availableParallelism() - 1, 6));

/**
 * Wall-clock budget for the whole sweep.
 *
 * Measured on the homebase server (8 cores, otherwise idle): 60 matches in 93.7 s of wall time and 426 s of
 * CPU, so about 7.1 s of CPU per headless match. `node --test` runs this file concurrently with the rest of
 * the suite, so the workers only ever get a slice of the machine and the wall time moves with whatever else
 * is running - which is how a flat 170 s budget came to fail here under load while proving nothing about the
 * bots. Budget the measured cost and leave 3x for contention, with a floor so a small or busy machine still
 * gets a fair run. The sweep itself is unchanged: same pairings, same seed counts, same thresholds.
 */
const PER_MATCH_CPU_S = 7.1;
const sweepTimeoutMs = (jobCount) => Math.max(300_000, Math.ceil((jobCount * PER_MATCH_CPU_S * 3) / SWEEP_THREADS) * 1000);

/** Runs every job across worker threads; resolves to results keyed by job key. */
function sweep(jobs) {
  const threads = Math.max(1, Math.min(jobs.length, SWEEP_THREADS));
  const buckets = Array.from({ length: threads }, () => []);
  jobs.forEach((j, i) => buckets[i % threads].push(j));
  const results = [];
  return Promise.all(buckets.map((bucket) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { jobs: bucket, root: process.cwd() } });
    w.on("message", (m) => results.push(m));
    w.on("error", reject);
    w.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sweep worker exited ${code}`))));
  }))).then(() => results);
}

function jobsFor(key, a, b, n, seedBase) {
  return Array.from({ length: n }, (_, i) => ({ key, a, b, i, seed: seedBase + i }));
}

if (isMainThread) {
  const pairs = [["overshoot:pro", "backlash:pro"], ["backlash:pro", "deadband:pro"], ["deadband:pro", "overshoot:pro"]];
  const nPair = FULL ? 50 : 12;
  const nGuard = FULL ? 20 : 6;
  const nTier = FULL ? 20 : 6;
  const jobs = [
    ...jobsFor("guard", "overshoot:pro", "jig:hold_guard", nGuard, 5000),
    ...["overshoot", "backlash", "deadband"].flatMap((p) => jobsFor(`tier:${p}`, `${p}:champion`, `${p}:rookie`, nTier, 6000)),
    ...pairs.flatMap(([a, b]) => jobsFor(`pair:${a}|${b}`, a, b, nPair, 7000)),
  ];

  describe("built-in opponent bot sweeps (headless, real physics)", { timeout: FULL ? 0 : sweepTimeoutMs(jobs.length) }, () => {
    let results = null;
    const results$ = () => (results ??= sweep(jobs));
    const rate = (all, key) => { const r = all.filter((x) => x.key === key); return { wins: r.filter((x) => x.aWon).length, n: r.length }; };

    test("Pro OVERSHOOT beats JIG hold_guard (≥ 90% at full size)", async (t) => {
      const { wins, n } = rate(await results$(), "guard");
      t.diagnostic(`guard ${wins}/${n}`);
      assert.ok(wins / n >= (FULL ? 0.9 : 5 / 6), `${wins}/${n}`);
    });

    test("Champion beats Rookie (≥ 80% at full size, pooled over the three personalities)", async (t) => {
      const all = await results$();
      let wins = 0, n = 0;
      for (const p of ["overshoot", "backlash", "deadband"]) { const r = rate(all, `tier:${p}`); wins += r.wins; n += r.n; t.diagnostic(`tier:${p} ${r.wins}/${r.n}`); }
      assert.ok(wins / n >= (FULL ? 0.8 : 0.7), `${wins}/${n}`);
    });

    for (const [a, b] of pairs) {
      test(`${a} vs ${b} is balanced (${FULL ? "35–65% over 50" : "25–75% over 12"} seeds)`, async (t) => {
        const { wins, n } = rate(await results$(), `pair:${a}|${b}`);
        t.diagnostic(`${a} vs ${b} ${wins}/${n}`);
        const lo = FULL ? 0.35 : 0.25, hi = FULL ? 0.65 : 0.75;
        assert.ok(wins / n >= lo && wins / n <= hi, `${wins}/${n}`);
      });
    }

    test("never violates: no clamped or errored actions, no joint-limit violations, no policy faults", async () => {
      const faults = (await results$()).reduce((s, r) => s + r.faults, 0);
      assert.equal(faults, 0);
    });
  });
}
