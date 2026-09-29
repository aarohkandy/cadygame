#!/usr/bin/env node
// scripts/eval.mjs (WP5): run the smoke-v1 suite headless and write episodes plus results.json.
//
//   node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke
//
// --policy  a JS module (.js/.mjs), a trajectory (.json), a bridge (ws://127.0.0.1:8765), or builtin:<personality>[:<tier>]
// --seat    atlas | blaze | both (default both)
// --seeds   a-b, inclusive (default: the suite's seeds, 1-3)
// --out     output directory (default .eval/<suite>)
// --no-verify  skip the bit-exact re-simulation gate
// --quiet   only the final summary
//
// Exit codes: 0 every gate passed, 1 a gate failed or a match could not run, 2 bad arguments.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PERSONALITIES = ["overshoot", "backlash", "deadband", "jig"];
const TIERS = ["rookie", "contender", "pro", "champion"];
const SUITE_IDS = ["smoke-v1"];

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE = `usage: node scripts/eval.mjs --suite smoke-v1 --policy <file.js|file.mjs|trajectory.json|ws://host:port|builtin:name[:tier]>
                         [--seat atlas|blaze|both] [--seeds a-b] [--out dir] [--no-verify] [--quiet]`;

export function parseArgs(argv) {
  const opts = { suite: null, policy: null, seat: "both", seeds: null, out: null, verify: true, quiet: false, help: false };
  const take = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf("=");
    const flag = raw.startsWith("--") && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith("--") && eq > 0 ? raw.slice(eq + 1) : null;
    const value = () => {
      if (inline !== null) return inline;
      const v = take(i, flag);
      i++;
      return v;
    };
    switch (flag) {
      case "--suite": opts.suite = value(); break;
      case "--policy": opts.policy = value(); break;
      case "--seat": opts.seat = value(); break;
      case "--seeds": opts.seeds = value(); break;
      case "--out": opts.out = value(); break;
      case "--no-verify": opts.verify = false; break;
      case "--quiet": opts.quiet = true; break;
      case "--help": case "-h": opts.help = true; break;
      default: throw new UsageError(`unknown argument ${raw}`);
    }
  }
  if (opts.help) return opts;
  if (!opts.suite) throw new UsageError("--suite is required");
  if (!SUITE_IDS.includes(opts.suite)) throw new UsageError(`unknown suite ${opts.suite} (available: ${SUITE_IDS.join(", ")})`);
  if (!opts.policy) throw new UsageError("--policy is required");
  if (!["atlas", "blaze", "both"].includes(opts.seat)) throw new UsageError("--seat must be atlas, blaze, or both");
  if (opts.seeds !== null) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(opts.seeds);
    if (!m) throw new UsageError("--seeds must look like 1-3");
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) throw new UsageError("--seeds range is reversed");
    opts.seeds = [a, b];
  }
  opts.out = path.resolve(opts.out ?? path.join(".eval", opts.suite));
  return opts;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Turns --policy into a DriverSpec. Files are read here so the episode records the policy's SHA-256. */
export async function resolvePolicy(policy, cwd = process.cwd()) {
  if (policy.startsWith("builtin:")) {
    const [, personality, tier = "contender"] = policy.split(":");
    if (!PERSONALITIES.includes(personality)) throw new UsageError(`unknown builtin ${personality} (available: ${PERSONALITIES.join(", ")})`);
    if (!TIERS.includes(tier)) throw new UsageError(`unknown tier ${tier} (available: ${TIERS.join(", ")})`);
    return { kind: "builtin", personality, tier, dda: false };
  }
  if (policy.startsWith("proxy:")) throw new UsageError("proxy bots stand in for a human and cannot be evaluated as a policy");
  if (/^wss?:\/\//.test(policy)) {
    const url = new URL(policy);
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    return { kind: "bridge", url: policy, allowLan: !loopback, sessionId: `eval-${Date.now().toString(36)}` };
  }
  const file = path.resolve(cwd, policy);
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new UsageError(`cannot read policy file ${policy}`);
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return { kind: "trajectory", fileName: file, json: text, sha256: sha256(text) };
  if (ext === ".js" || ext === ".mjs") return { kind: "module", fileName: file, source: text, sha256: sha256(text) };
  throw new UsageError(`--policy file must be .js, .mjs, or .json, got ${ext || "no extension"}`);
}

async function gitSha() {
  try {
    const head = (await readFile(path.join(ROOT, ".git", "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 12);
    const ref = head.slice(5);
    try {
      return (await readFile(path.join(ROOT, ".git", ref), "utf8")).trim().slice(0, 12);
    } catch {
      const packed = await readFile(path.join(ROOT, ".git", "packed-refs"), "utf8");
      const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
      return line ? line.slice(0, 12) : "dev";
    }
  } catch {
    return "dev";
  }
}

/** The real game modules, loaded lazily so argument errors never pay for MuJoCo. */
export async function loadServices() {
  const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const [engine, combat, tuning, kin, obs, inproc, pilot, proxy, chunk] = await Promise.all([
    load("src/game/physics/engine.ts"), load("src/game/combat/combat-rules.ts"), load("src/game/combat/tuning.ts"),
    load("src/game/kinematics/so101-kinematics.ts"), load("src/game/policy/observation.ts"),
    load("src/game/policy/in-process-driver.ts"), load("src/game/input/pilot-controller.ts"),
    load("src/game/policy/proxy-bots/index.ts"), load("src/game/policy/chunk-executor.ts"),
  ]);
  const stubs = [engine, combat, tuning, kin, obs, inproc, pilot, proxy, chunk].filter((m) => "__STUB__" in m).map((m) => m.__STUB__);
  if (stubs.length > 0) throw new Error(`the game is not fully built yet (stubbed packages: ${[...new Set(stubs)].join(", ")})`);
  let obsSchemaHash = "";
  try {
    const schema = await load("src/game/policy/obs-schema.ts");
    obsSchemaHash = schema.OBS_SCHEMA_HASH ?? schema.obsSchemaHash ?? "";
  } catch {
    try {
      obsSchemaHash = `sha256:${sha256(await readFile(path.join(ROOT, "public/schemas/torquelimit.obs-3.json"), "utf8"))}`;
    } catch {
      obsSchemaHash = "";
    }
  }
  return {
    createEngine: engine.createPhysicsEngine,
    createRules: combat.createCombatRules,
    hitstopMsFor: tuning.hitstopMsFor,
    tuning: tuning.tuning,
    kinematics: kin.createKinematics(),
    createObservationBuilder: obs.createObservationBuilder,
    createDelayLine: obs.createObservationDelayLine,
    createSeatDriver: inproc.createInProcessSeatDriver,
    createPilot: pilot.createPilotController,
    createProxyBot: proxy.createProxyBot,
    createChunkExecutor: chunk.createChunkExecutor,
    obsSchemaHash,
  };
}

const pad = (n, w) => String(n).padStart(w, " ");

export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) { out(USAGE); return 0; }
  } catch (e) {
    if (e instanceof UsageError) { err(`eval: ${e.message}`); err(USAGE); return 2; }
    throw e;
  }

  let policy;
  try {
    policy = await resolvePolicy(opts.policy, io.cwd ?? process.cwd());
  } catch (e) {
    if (e instanceof UsageError) { err(`eval: ${e.message}`); return 2; }
    throw e;
  }

  const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const [{ defineHeadlessMatchRunner }, { createRecorder }, { createEpisodeStore }, { runSuite, suiteCells, policyLabel }, { computeStats }, { verifyEpisode }, { formatWinRate }, { buildProvenanceSource }, { stampLabel }] = await Promise.all([
    load("src/game/loop/headless-runner.ts"), load("src/game/harness/recorder.ts"), load("src/game/harness/episode-store-fs.ts"),
    load("src/game/harness/suite.ts"), load("src/game/harness/stats.ts"), load("src/game/harness/determinism.ts"),
    load("src/game/harness/aggregate.ts"), load("src/game/harness/provenance.ts"), load("src/game/harness/verdict.ts"),
  ]);

  let services;
  try {
    services = io.services ?? (await loadServices());
  } catch (e) {
    err(`eval: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const nodeFsRoot = io.nodeFsRoot ?? ROOT;
  const harnessCommit = io.harnessCommit ?? (await gitSha());

  const probe = await services.createEngine({ mode: "harness", nodeFsRoot });
  const provenance = await buildProvenanceSource({
    tuning: services.tuning ?? null, engine: probe, obsSchemaHash: services.obsSchemaHash ?? "",
    harnessCommit, userAgent: `node ${process.version} ${process.platform} ${process.arch}`,
  });
  const observations = services.createObservationBuilder(probe.info);
  const modelInfo = probe.info;
  probe.dispose();

  const runner = defineHeadlessMatchRunner({
    createChunkExecutor: services.createChunkExecutor, createDelayLine: services.createDelayLine, hitstopMsFor: services.hitstopMsFor,
    nodeFsRoot, provenance, obsSchemaHash: services.obsSchemaHash ?? "",
  })({
    createEngine: services.createEngine, createRules: services.createRules, kinematics: services.kinematics, observations,
    createSeatDriver: services.createSeatDriver, createPilot: services.createPilot ?? null, createProxyBot: services.createProxyBot ?? null,
    createRecorder,
  });

  await mkdir(opts.out, { recursive: true });
  const store = createEpisodeStore({ fsRoot: opts.out });
  const total = suiteCells({ suite: opts.suite, policySeat: opts.seat, seeds: opts.seeds ?? undefined }).length;
  const label = policyLabel(policy);
  if (!opts.quiet) out(`TORQUE LIMIT · ${opts.suite} · ${path.basename(label)} · ${total} matches · MuJoCo ${modelInfo.mujocoVersion}`);

  const started = Date.now();
  let lastDone = Date.now();
  let result;
  try {
    result = await runSuite({
      suite: opts.suite, policySeat: opts.seat, policy, seeds: opts.seeds ?? undefined, keepEpisodes: true,
      onProgress: (done, n, summary, subject) => {
        if (opts.quiet) return;
        const secs = ((Date.now() - lastDone) / 1000).toFixed(1);
        lastDone = Date.now();
        const winner = summary.winner ? `${path.basename(summary.names[summary.winner])} WINS` : "NO WINNER";
        // The cell judges the policy under test, so the line carries that seat's stamp - not the
        // episode roll-up, which also fires when the built-in opponent trips a reliability check.
        const stamp = subject ? stampLabel(subject.stamp) ?? "NO STAMP" : summary.verdict.toUpperCase();
        out(`[${pad(done, String(n).length)}/${n}] ${path.basename(summary.names.atlas)} vs ${path.basename(summary.names.blaze)} · ${winner} · ${stamp} · ${secs} s`);
      },
    }, {
      runner, store, computeStats,
      verify: opts.verify ? (ep) => verifyEpisode(ep, { createEngine: services.createEngine, createRules: services.createRules, nodeFsRoot }) : undefined,
    });
  } catch (e) {
    err(`eval: suite stopped: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const pass = result.gates.every((g) => g.pass);
  const report = {
    format: "torquelimit.eval-results/1",
    suite: result.suite,
    generated: new Date().toISOString(),
    wallSeconds: (Date.now() - started) / 1000,
    policy: { label, kind: policy.kind, sha256: policy.sha256 ?? null },
    seat: opts.seat,
    provenance: {
      harnessCommit, mujoco: modelInfo.mujocoVersion, modelSha256: modelInfo.modelSha256,
      tuningSha256: provenance.tuningSha256, servoParamsHash: provenance.servoParamsHash, obsSchemaHash: provenance.obsSchemaHash,
    },
    winRate: formatWinRate(result.aggregate),
    aggregate: result.aggregate,
    gates: result.gates,
    pass,
    cells: result.cells.map((c) => ({ ...c, stampLabel: stampLabel(c.stamp) })),
    verify: result.verify,
    episodes: result.episodes,
  };
  await writeFile(path.join(opts.out, "results.json"), `${JSON.stringify(report, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2)}\n`);

  out(`${opts.suite} · ${label} · WIN RATE ${report.winRate}`);
  for (const g of result.gates) out(`  ${g.pass ? "PASS" : "FAIL"}  ${g.name} · ${g.value}`);
  if (result.verify && !opts.quiet) out(`  ${result.verify.message}`);
  const rel = path.relative(process.cwd(), opts.out);
  const where = rel === "" ? "." : rel.startsWith("..") ? opts.out : rel;
  out(`${pass ? "SMOKE PASSED" : "SMOKE FAILED"} · ${result.episodes.length} episodes and results.json in ${where}`);
  return pass ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(`eval: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; },
  );
}
