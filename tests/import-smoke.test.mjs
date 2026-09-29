// Import smoke (BUILD_PLAN 3, 4 WP1.1): every non-React module under src/game imports in Node without throwing,
// and every contract factory can be called with fakes and returns a type-correct object. Stubs pass this test;
// real implementations must keep passing it.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JOINT_NAMES, OBS_BLOCKS, SEATS, TOKEN_HEX } from "../src/game/contracts.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { createUiStore } from "../src/game/core/ui-store.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createHudFrame } from "../src/game/core/hud-frame.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import {
  createFakeEngine, createFakeKinematics, createFakeRecorder, fakeCombat, fakeEvents, fakeFrame, fakeModelInfo,
} from "../src/game/testing/fakes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = path.join(root, "src", "game");

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) yield full;
  }
}

const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

describe("import smoke", () => {
  test("every non-React module under src/game imports", async () => {
    const files = [...walk(gameDir)];
    assert.ok(files.length > 20, `expected the whole module tree, found ${files.length} files`);
    for (const file of files) {
      await assert.doesNotReject(import(pathToFileURL(file).href), `import ${path.relative(root, file)}`);
    }
  });

  test("WP2 factories: engine, rules, tuning, kinematics, bench", async () => {
    const { createPhysicsEngine } = await load("src/game/physics/engine.ts");
    const engine = await createPhysicsEngine({ mode: "arcade" });
    assert.equal(engine.frame.arms.atlas.q.length, 6);
    assert.equal(engine.frame.cubes.pos.length, 27);
    const step0 = engine.frame.step;
    engine.step();
    assert.equal(engine.frame.step, step0 + 1);
    const state = engine.saveState();
    assert.equal(state.qpos.length, engine.info.nq);
    engine.restoreState(state, "both");
    assert.equal(typeof engine.checksum(), "number");
    engine.dispose();

    const { createCombatRules } = await load("src/game/combat/combat-rules.ts");
    const rules = createCombatRules(fakeModelInfo());
    const out = [];
    rules.step({ frame: fakeFrame(), intents: { atlas: {}, blaze: {} } }, out);
    assert.ok(Array.isArray(out));
    assert.ok(rules.state.seats.atlas && rules.state.seats.blaze && rules.state.core);
    assert.equal(typeof rules.servoProfile("atlas").tauScale, "number");

    const { hitstopMsFor, tuning } = await load("src/game/combat/tuning.ts");
    assert.equal(typeof hitstopMsFor(fakeEvents.strike(), "arcade", "atlas"), "number");
    assert.ok(tuning && typeof tuning === "object");

    const { createKinematics } = await load("src/game/kinematics/so101-kinematics.ts");
    const k = createKinematics();
    assert.equal(k.commandToJoints(k.homeCommand(), new Float64Array(6)).length, 6);
    assert.equal(typeof k.solveTipEgo([0.2, 0, 0.15], 0, new Float64Array(6), new Float64Array(6)).ok, "boolean");

    const { runBrowserBench } = await load("src/game/physics/bench-browser.ts");
    assert.equal(typeof runBrowserBench, "function");
  });

  test("WP3 factories: pilot, cockpit rig, feedback", async () => {
    const clock = createGameClock();
    const settings = createSettingsStore({ storage: null });
    const ui = createUiStore();
    const bus = createEventBus();

    const { createPilotController } = await load("src/game/input/pilot-controller.ts");
    const pilot = createPilotController({ kinematics: createFakeKinematics(), settings, clock, profileMatchesPlayed: () => 0 });
    pilot.sampleFrame(1 / 60, false);
    const ctrl = new Float64Array(6);
    pilot.writeCommand(fakeFrame(), fakeCombat(), ctrl);
    assert.equal(typeof pilot.synthetic().move, "function");
    assert.equal(typeof pilot.touch().swing, "function");
    pilot.dispose();

    const { createCockpitRig } = await load("src/game/camera/cockpit-rig.ts");
    const pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fovDeg: 0 };
    const { createJuiceOutput } = await load("src/game/core/hud-frame.ts");
    createCockpitRig().compute("atlas", pilot, createJuiceOutput(), fakeFrame(), settings.get(), pose);
    assert.ok(pose.fovDeg > 0);

    const { createFeedbackSystem } = await load("src/game/feedback/feedback-system.ts");
    const feedback = createFeedbackSystem({ clock, ui, settings, bus });
    await feedback.audio.prepare(() => {});
    assert.equal(typeof feedback.audio.hype, "number");
    feedback.dispose();
  });

  test("WP4 factories: drivers, proxy bot, observations, built-in module, chunk executor, registration", async () => {
    const builtin = { kind: "builtin", personality: "backlash", tier: "rookie", dda: false };
    const { createSeatDriver } = await load("src/game/policy/seat-drivers.ts");
    const { createInProcessSeatDriver } = await load("src/game/policy/in-process-driver.ts");
    for (const d of [await createSeatDriver(builtin, "blaze"), await createInProcessSeatDriver(builtin, "blaze", {})]) {
      assert.equal(d.kind, "builtin");
      assert.equal(d.poll(), null);
      d.dispose();
    }

    const { createProxyBot } = await load("src/game/policy/proxy-bots/index.ts");
    createProxyBot("human_proxy").reset(1);

    const { createObservationBuilder, createObservationDelayLine } = await load("src/game/policy/observation.ts");
    const obs = createObservationBuilder(fakeModelInfo()).build(
      "atlas", fakeFrame(), fakeCombat(),
      { round: 1, bestOf: 3, phase: "fight", phaseLengthS: 45, roundsWon: { atlas: 0, blaze: 0 } },
      new Float64Array(6), { late_steps: 0, clamped_steps: 0, timeouts: 0 }, 0, 0, [],
    );
    for (const [name, size] of Object.entries(OBS_BLOCKS)) assert.equal(obs.blocks[name].length, size, name);
    const line = createObservationDelayLine();
    line.push(obs);
    assert.equal(line.read(0), obs);

    const policy = await load("src/game/policy/opponent/index.ts");
    assert.equal(typeof policy.policyName, "string");
    await policy.reset({});
    assert.equal(policy.act(obs).targets.length, JOINT_NAMES.length);

    const { createChunkExecutor } = await load("src/game/policy/chunk-executor.ts");
    const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: null });
    assert.equal(typeof ex.sample(0, { targets: new Float64Array(6), intents: 0, chunkId: -1, chunkIndex: -1, exhausted: false }), "boolean");

    const { runRegistration, probeBridge } = await load("src/game/policy/registration.ts");
    const result = await runRegistration({ kind: "module", fileName: "p.js", source: "", sha256: "00" }, () => {});
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof probeBridge, "function");
  });

  test("WP5 factories: harness api, stores, codec", async () => {
    const { createEpisodeStore } = await load("src/game/harness/episode-store.ts");
    const { createEpisodeStore: createFsStore } = await load("src/game/harness/episode-store-fs.ts");
    const { createEntrantStore } = await load("src/game/harness/entrant-store.ts");
    const { createEpisodeCodec } = await load("src/game/harness/episode-format.ts");
    const { createHarnessApi } = await load("src/game/harness/harness-api.ts");
    const store = createEpisodeStore("indexeddb");
    assert.ok(Array.isArray(await createFsStore({ fsRoot: root }).list()));
    const entrants = createEntrantStore("indexeddb");
    assert.ok(Array.isArray(await entrants.list()));
    assert.equal(typeof createEpisodeCodec().encode, "function");

    const engine = createFakeEngine();
    const harness = createHarnessApi({
      createEngine: async () => createFakeEngine(), createRules: () => null, createSeatDriver: async () => null,
      observations: null, runner: { run: async () => null }, store, entrants,
    });
    assert.equal(harness.store, store);
    assert.equal(harness.entrants, entrants);
    assert.equal(typeof harness.codec.decode, "function");
    const replay = harness.createReplayPlayer(engine, createGameClock(), null);
    const verify = await replay.verify(() => {});
    assert.ok(["bit_exact", "diverged", "error"].includes(verify.verdict));
    assert.equal(typeof harness.createRecorder().begin, "function");
  });

  test("WP6 and WP7 data modules: camera math and brand", async () => {
    const { cameraMath } = await load("src/game/render/camera-math.ts");
    for (const mode of ["cockpit", "broadcast", "intro", "replay", "lobby", "lab_overview", "outro"]) {
      assert.equal(typeof cameraMath[mode], "function", mode);
    }
    const { MARKS } = await load("src/game/brand/marks.ts");
    for (const id of ["torqueLimit", "needle", "ohmstead", "pulpoPop", "bit"]) {
      assert.match(MARKS[id].viewBox, /^\d+ \d+ \d+ \d+$/, id);
      for (const p of MARKS[id].paths) assert.ok(p.fill in TOKEN_HEX);
    }
    const { HOSTS } = await load("src/game/brand/hosts.ts");
    assert.equal(HOSTS.rook.tag, "ROOK");
    assert.equal(HOSTS.vale.tag, "DR. VALE");
    const slant = await load("src/game/brand/slant.ts");
    assert.deepEqual([slant.SLANT_PANEL_DEG, slant.SLANT_STAMP_DEG, slant.STICKER_TILT_DEG], [12, 10, -4]);
  });

  test("WP1 factories: headless runner binds the contract deps", async () => {
    const { createHeadlessMatchRunner } = await load("src/game/loop/headless-runner.ts");
    const runner = createHeadlessMatchRunner({
      createEngine: async ({ mode }) => createFakeEngine({ mode }), createRules: () => null, kinematics: createFakeKinematics(),
      observations: null, createSeatDriver: async () => null, createPilot: null, createProxyBot: null,
      createRecorder: createFakeRecorder,
    });
    assert.equal(typeof runner.run, "function");
    assert.equal(typeof createHudFrame().seats.atlas.integrity, "number");
    assert.ok(buildMatchConfig);
  });

  test("createGame wires every factory and runs frames through the title", async () => {
    const { createGame } = await load("src/game/game-handle.ts");
    const labels = [];
    const game = await createGame({ onProgress: (p) => labels.push(p.label) });
    assert.ok(labels.length > 0);
    for (const key of [
      "engine", "rules", "kinematics", "clock", "director", "bus", "pilot", "cockpit", "feedback", "harness",
      "observations", "createSeatDriver", "ui", "settings", "hud", "view", "replay", "runRegistration", "probeBridge",
    ]) {
      assert.ok(game[key] !== undefined && game[key] !== null, key);
    }
    assert.ok(game.harness.entrants && game.harness.codec);

    let rendered = 0;
    const off = game.onAfterRender(() => { rendered++; });
    game.director.enterTitle();
    for (let i = 0; i < 30; i++) {
      game.frameTick(1 / 60);
      game.runAfterRender();
      await new Promise((resolve) => setImmediate(resolve));
    }
    off();
    game.runAfterRender();
    assert.equal(rendered, 30);
    assert.equal(game.ui.get().screen, "title");
    for (const s of SEATS) assert.equal(typeof game.hud.seats[s].integrity, "number");
    game.director.enterGreenRoom();
    game.frameTick(1 / 60);
    assert.equal(game.director.phase, "green_room");
  });
});
