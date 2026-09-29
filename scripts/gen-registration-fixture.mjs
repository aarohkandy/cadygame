#!/usr/bin/env node
// scripts/gen-registration-fixture.mjs (WP4)
// Builds public/policies/fixtures/registration-obs-3.json: 200 torquelimit.obs/3 observations recorded from real
// headless bot matches (MuJoCo physics, real combat rules, built-in opponents on both seats), chosen to cover what a
// policy must survive before it is cleared (GAME_DESIGN 5.6): both seats, active contact, full extension, joints
// near their limits, sudden death, the Core held and docked, a Staggered self, and physical-scoring observations.
//
//   node scripts/gen-registration-fixture.mjs            regenerate the fixture (about a minute)
//   node scripts/gen-registration-fixture.mjs --schema   rewrite public/schemas/torquelimit.obs-3.json and print its hash
//   node scripts/gen-registration-fixture.mjs --check    verify the fixture decodes to 200 schema-complete observations

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "public/policies/fixtures/registration-obs-3.json");
const SCHEMA_FILE = path.join(ROOT, "public/schemas/torquelimit.obs-3.json");

const args = new Set(process.argv.slice(2));

if (args.has("--schema")) {
  const { obsSchemaText, OBS_SCHEMA_HASH } = await import("../src/game/policy/obs-schema.ts");
  const text = obsSchemaText();
  fs.mkdirSync(path.dirname(SCHEMA_FILE), { recursive: true });
  fs.writeFileSync(SCHEMA_FILE, text);
  const hash = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  console.log(`wrote ${path.relative(ROOT, SCHEMA_FILE)} (${text.length} bytes)`);
  console.log(`hash ${hash}`);
  if (hash !== OBS_SCHEMA_HASH) console.log("update OBS_SCHEMA_HASH in src/game/policy/obs-schema.ts to the hash above");
  process.exit(0);
}

const { OBS_BLOCKS, JOINT_LIMITS, SEATS } = await import("../src/game/contracts.ts");
const { decodeRegistrationFixture, encodeRegistrationFixture, REGISTRATION_FIXTURE_COUNT } = await import("../src/game/policy/registration.ts");

if (args.has("--check")) {
  const obs = decodeRegistrationFixture(fs.readFileSync(FIXTURE, "utf8"));
  if (obs.length !== REGISTRATION_FIXTURE_COUNT) throw new Error(`fixture has ${obs.length} observations`);
  for (const [i, o] of obs.entries()) {
    for (const [name, len] of Object.entries(OBS_BLOCKS)) {
      if (o.blocks[name].length !== len) throw new Error(`fixture ${i} block ${name}`);
      for (const v of o.blocks[name]) if (!Number.isFinite(v)) throw new Error(`fixture ${i} block ${name} not finite`);
    }
  }
  console.log(`ok: ${obs.length} observations`);
  process.exit(0);
}

const { createHeadlessMatchRunner } = await import("../src/game/loop/headless-runner.ts");
const { createPhysicsEngine } = await import("../src/game/physics/engine.ts");
const { createCombatRules } = await import("../src/game/combat/combat-rules.ts");
const { createKinematics } = await import("../src/game/kinematics/so101-kinematics.ts");
const { createObservationBuilder } = await import("../src/game/policy/observation.ts");
const { createInProcessSeatDriver } = await import("../src/game/policy/in-process-driver.ts");
const { buildMatchConfig } = await import("../src/game/match/match-config.ts");
const { createRecorder } = await import("../src/game/harness/recorder.ts");

/** Every observation a driver is asked to act on, per match. */
const captured = [];
const capturingDriver = async (spec, seat, opts) => {
  const driver = await createInProcessSeatDriver(spec, seat, opts);
  const request = driver.request.bind(driver);
  driver.request = (obs, tick) => { captured.push(obs); request(obs, tick); };
  return driver;
};

const kinematics = createKinematics();
const probe = await createPhysicsEngine({ mode: "arcade", nodeFsRoot: ROOT });
const observations = createObservationBuilder(probe.info);
probe.dispose();
const runner = createHeadlessMatchRunner({
  createEngine: (o) => createPhysicsEngine({ ...o, nodeFsRoot: ROOT }),
  createRules: createCombatRules,
  kinematics,
  observations,
  createSeatDriver: capturingDriver,
  createPilot: null, createProxyBot: null,
  createRecorder: () => createRecorder(),
});

const MATCHES = [
  { preset: "arcade", seed: 3101, atlas: ["overshoot", "pro"], blaze: ["deadband", "champion"] },
  { preset: "arcade", seed: 3102, atlas: ["backlash", "champion"], blaze: ["overshoot", "contender"] },
  { preset: "arcade", seed: 3103, atlas: ["deadband", "rookie"], blaze: ["backlash", "pro"] },
  { preset: "proving_ground", seed: 3104, atlas: ["overshoot", "pro"], blaze: ["backlash", "pro"] },
  { preset: "harness", seed: 3105, atlas: ["deadband", "pro"], blaze: ["overshoot", "champion"] },
];

const stamp = Date.now();
for (const m of MATCHES) {
  const cfg = buildMatchConfig({
    preset: m.preset, context: "suite", seed: m.seed, bestOf: 3, now: new Date("2026-09-16T12:00:00Z"),
    seats: {
      atlas: { driver: { kind: "builtin", personality: m.atlas[0], tier: m.atlas[1], dda: false } },
      blaze: { driver: { kind: "builtin", personality: m.blaze[0], tier: m.blaze[1], dda: false } },
    },
  });
  const before = captured.length;
  const ep = await runner.run(cfg);
  console.log(`${m.preset} ${m.atlas.join(":")} vs ${m.blaze.join(":")}: ${ep.meta.result.winner} ${JSON.stringify(ep.meta.result.roundsWon)} · ${captured.length - before} observations`);
}

// Sudden death needs a close time-up; keep playing evenly matched Pro mirrors until a round goes there.
for (let extra = 0; extra < 10 && !captured.some((o) => o.round.sudden_death); extra++) {
  const personality = ["backlash", "deadband", "overshoot"][extra % 3];
  const cfg = buildMatchConfig({
    preset: "arcade", context: "suite", seed: 3200 + extra, bestOf: 3, now: new Date("2026-09-16T12:00:00Z"),
    seats: {
      atlas: { driver: { kind: "builtin", personality, tier: "pro", dda: false } },
      blaze: { driver: { kind: "builtin", personality, tier: "pro", dda: false } },
    },
  });
  const ep = await runner.run(cfg);
  MATCHES.push({ preset: "arcade", seed: 3200 + extra, atlas: [personality, "pro"], blaze: [personality, "pro"] });
  console.log(`arcade ${personality}:pro mirror seed ${3200 + extra}: ${ep.meta.result.rounds.map((r) => r.reason).join(" ")}`);
}

/* ── selection ── */

const nearLimit = (o) => o.self.q.some((q, j) => q - JOINT_LIMITS[j][0] < 0.05 || JOINT_LIMITS[j][1] - q < 0.05);
const CATEGORIES = [
  ["sudden_death", (o) => o.round.sudden_death, 12],
  ["staggered_self", (o) => o.self.servo_state === "stagger", 16],
  ["core_held", (o) => o.cubes.some((c) => c.is_core && c.held_by !== null), 12],
  ["core_docked", (o) => o.core.docked_in !== null, 18],
  ["contact", (o) => o.contacts.length > 0 || o.blocks.game[9] === 1, 24],
  ["full_extension", (o) => o.self.ee.pos[0] > 0.42, 16],
  ["near_joint_limit", nearLimit, 16],
  ["charge_public", (o) => o.opponent.charge_public > 0, 10],
  ["physical_scoring", (o) => o.preset !== "arcade", 24],
];

function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i + 0.5) * list.length / n)]);
  return out;
}

const chosen = new Set();
const counts = {};
for (const [name, pred, want] of CATEGORIES) {
  for (const seat of SEATS) {
    const pool = captured.filter((o) => o.side === seat && !chosen.has(o) && pred(o));
    for (const o of spread(pool, Math.ceil(want / 2))) chosen.add(o);
  }
  counts[name] = [...chosen].filter(pred).length;
}
for (const seat of SEATS) {
  const rest = captured.filter((o) => o.side === seat && !chosen.has(o));
  const need = Math.ceil((REGISTRATION_FIXTURE_COUNT - chosen.size) / (seat === "atlas" ? 2 : 1));
  for (const o of spread(rest, need)) { if (chosen.size < REGISTRATION_FIXTURE_COUNT) chosen.add(o); }
}
const selected = [...chosen].slice(0, REGISTRATION_FIXTURE_COUNT).sort((a, b) => captured.indexOf(a) - captured.indexOf(b));
if (selected.length !== REGISTRATION_FIXTURE_COUNT) throw new Error(`only ${selected.length} observations captured`);
counts.atlas = selected.filter((o) => o.side === "atlas").length;
counts.blaze = selected.filter((o) => o.side === "blaze").length;

/** Dict numbers rounded to 6 significant digits (the float32 blocks stay exact). */
function roundDict(o) {
  return JSON.parse(JSON.stringify({ ...o, blocks: undefined }, (k, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v)));
}
const doc = encodeRegistrationFixture(selected.map((o) => ({ ...roundDict(o), blocks: o.blocks })), {
  source: "scripts/gen-registration-fixture.mjs",
  matches: MATCHES.map((m) => `${m.preset} seed ${m.seed} ${m.atlas.join(":")} vs ${m.blaze.join(":")}`),
  coverage: counts,
});
fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
fs.writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`);
console.log(`wrote ${path.relative(ROOT, FIXTURE)}: ${selected.length} observations, ${(fs.statSync(FIXTURE).size / 1024).toFixed(0)} KB, coverage ${JSON.stringify(counts)} in ${((Date.now() - stamp) / 1000).toFixed(0)} s`);
