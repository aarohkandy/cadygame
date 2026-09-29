import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PRESETS, presetRules, timestepFor, stepsPerControlTick, pilotRulesFor, MATCH_PRESETS, FAIR_DELAY_DEFAULT_MS } from "../src/game/match/presets.ts";
import { PRESET_PHYSICS, PRESET_SCORING } from "../src/game/contracts.ts";
import { buildMatchConfig, validateMatchConfig, rulesConfigFor, fairDelayFor, decimationFor, fastShowFrom, showKitFrom, BUILTIN_LOADOUTS, quickFightConfig, chatSeedFor } from "../src/game/match/match-config.ts";
import { defaultSettings } from "../src/game/core/settings.ts";

const NOW = new Date("2026-09-16T12:00:00Z");

describe("presets (GAME_DESIGN 4.10, DEMO removed)", () => {
  test("exactly three presets, consistent with the contract tables", () => {
    assert.deepEqual([...MATCH_PRESETS].sort(), ["arcade", "harness", "proving_ground"]);
    for (const p of MATCH_PRESETS) {
      assert.equal(PRESETS[p].physics, PRESET_PHYSICS[p]);
      assert.equal(PRESETS[p].scoring, PRESET_SCORING[p]);
    }
  });

  test("timesteps and steps per control tick", () => {
    assert.equal(timestepFor("arcade", 50), 0.0025);
    assert.equal(timestepFor("proving_ground", 50), 0.005);
    assert.equal(timestepFor("harness", 50), 0.005);
    assert.equal(timestepFor("harness", 30), 1 / 600);
    assert.equal(timestepFor("harness", 60), 1 / 600);
    assert.throws(() => timestepFor("arcade", 60), /ARCADE runs at 50 Hz/);
    assert.throws(() => timestepFor("proving_ground", 30));
    assert.equal(stepsPerControlTick(0.0025, 50), 8);
    assert.equal(stepsPerControlTick(0.005, 50), 4);
    assert.equal(stepsPerControlTick(1 / 600, 30), 20);
    assert.equal(stepsPerControlTick(1 / 600, 60), 10);
    assert.throws(() => stepsPerControlTick(0.003, 50));
  });

  test("hit stop, dilation, and comebacks exist only in Arcade", () => {
    assert.deepEqual(MATCH_PRESETS.map((p) => [p, presetRules(p).hitstop, presetRules(p).dilation, presetRules(p).comebacks]),
      [["arcade", true, true, true], ["proving_ground", false, false, false], ["harness", false, false, false]]);
  });

  test("human input shaping per preset, with the onboarding gate", () => {
    assert.deepEqual(pilotRulesFor("arcade", true), { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: true, showKit: true });
    assert.equal(pilotRulesFor("arcade", false).showKit, false);
    assert.equal(pilotRulesFor("arcade", true, false).aimAssist, false, "aim assist only against the AI");
    const pg = pilotRulesFor("proving_ground", true);
    assert.equal(pg.jabMacro, false);
    assert.equal(pg.chargeMacro, false);
    assert.equal(pg.leash, true);
    assert.equal(pg.assists, true);
    assert.equal(pg.showKit, false, "stock presets ignore the kit");
    assert.equal(PRESETS.harness.humanAllowed, false);
  });

  test("fair delay defaults to 120 ms where a human may sit, 0 in Harness", () => {
    assert.equal(presetRules("arcade").fairDelayDefaultMs, FAIR_DELAY_DEFAULT_MS);
    assert.equal(presetRules("proving_ground").fairDelayDefaultMs, 120);
    assert.equal(presetRules("harness").fairDelayDefaultMs, 0);
  });

  test("Arcade reports never verify a policy", () => {
    assert.equal(PRESETS.arcade.resultStamp, "arcade_physics");
    assert.equal(PRESETS.proving_ground.resultStamp, "verdict");
  });
});

describe("match config", () => {
  const moduleSpec = { kind: "module", fileName: "act_v3.mjs", source: "", sha256: "9f2c" };

  test("fair delay applies only to a module, trajectory, or bridge facing a human or proxy", () => {
    const vsHuman = buildMatchConfig({ preset: "proving_ground", context: "quick", seed: 1, now: NOW, seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: moduleSpec } } });
    assert.equal(fairDelayFor(vsHuman, "blaze"), 120);
    assert.equal(fairDelayFor(vsHuman, "atlas"), 0);
    const vsBuiltin = buildMatchConfig({ preset: "proving_ground", context: "quick", seed: 1, now: NOW, seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "deadband", tier: "pro", dda: true } } } });
    assert.equal(fairDelayFor(vsBuiltin, "blaze"), 0);
    const bots = buildMatchConfig({ preset: "harness", context: "lab", seed: 1, now: NOW, seats: { atlas: { driver: moduleSpec }, blaze: { driver: moduleSpec } } });
    assert.equal(fairDelayFor(bots, "blaze"), 0);
    assert.equal(bots.timing, "eval");
    assert.equal(vsHuman.timing, "live");
  });

  test("defaults: decision rate half the control rate, built-in loadouts, timestep from the preset", () => {
    const cfg = buildMatchConfig({ preset: "arcade", context: "quick", seed: 3, now: NOW, seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: true } } } });
    assert.equal(cfg.seats.blaze.decisionHz, 25);
    assert.equal(decimationFor(cfg, "blaze"), 2);
    assert.equal(cfg.seats.blaze.loadout, BUILTIN_LOADOUTS.overshoot);
    assert.equal(cfg.timestep, 0.0025);
    assert.match(cfg.id, /^2026-09-16T12:00:00\.000Z-[0-9a-f]{4}$/);
    assert.deepEqual(validateMatchConfig(cfg), []);
  });

  test("validation names every unrunnable combination", () => {
    const base = { context: "lab", seed: 1, now: NOW };
    const humanHarness = buildMatchConfig({ ...base, preset: "harness", seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: moduleSpec } } });
    assert.ok(validateMatchConfig(humanHarness).includes("HARNESS FORBIDS A HUMAN SEAT"));
    const humanEval = buildMatchConfig({ ...base, preset: "arcade", timing: "eval", seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: moduleSpec } } });
    assert.ok(validateMatchConfig(humanEval).includes("EVAL NEEDS NO HUMAN"));
    const twoPilots = buildMatchConfig({ ...base, preset: "arcade", seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "proxy", bot: "human_proxy" } } } });
    assert.ok(validateMatchConfig(twoPilots).includes("ONE PILOT SEAT AT MOST"));
    const wrongHz = { ...buildMatchConfig({ ...base, preset: "arcade", seats: { atlas: { driver: moduleSpec }, blaze: { driver: moduleSpec } } }), controlHz: 60 };
    assert.ok(validateMatchConfig(wrongHz).includes("ARCADE RUNS AT 50 HZ"));
  });

  test("round rules: underdog lock-in in Arcade only, 4 s and no Core delay in sudden death", () => {
    const arcade = buildMatchConfig({ preset: "arcade", context: "quick", seed: 1, now: NOW, seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: moduleSpec } } });
    assert.deepEqual(rulesConfigFor(arcade, { atlas: 0, blaze: 1 }, false).lockInS, { atlas: 6, blaze: 8 });
    const sd = rulesConfigFor(arcade, { atlas: 1, blaze: 1 }, true);
    assert.deepEqual(sd.lockInS, { atlas: 4, blaze: 4 });
    assert.equal(sd.coreDropAtS, 0);
    const pg = { ...arcade, preset: "proving_ground", timestep: 0.005 };
    assert.deepEqual(rulesConfigFor(pg, { atlas: 0, blaze: 1 }, false).lockInS, { atlas: 8, blaze: 8 });
    assert.equal(rulesConfigFor(arcade, { atlas: 0, blaze: 0 }, false).coreDropAtS, 15);
  });

  test("fast show turns on after five matches in auto; the kit after three", () => {
    const s = defaultSettings();
    assert.equal(fastShowFrom(s), false);
    assert.equal(fastShowFrom({ ...s, profile: { ...s.profile, matchesPlayed: 5 } }), true);
    assert.equal(fastShowFrom({ ...s, show: { fast: "off" }, profile: { ...s.profile, matchesPlayed: 50 } }), false);
    assert.equal(showKitFrom({ ...s, profile: { ...s.profile, matchesPlayed: 2 } }), false);
    assert.equal(showKitFrom({ ...s, profile: { ...s.profile, matchesPlayed: 3 } }), true);
  });

  test("streamer fields (8.4): NAME THE CHALLENGER names the plate, CHAT SEED fixes the scatter, both optional", async () => {
    const { defaultSettings } = await import("../src/game/core/settings.ts");
    const settings = defaultSettings();
    const opponent = { kind: "builtin", personality: "backlash", tier: "pro", dda: true };
    const plain = quickFightConfig({ opponent, loadout: "pivot", preset: "arcade", seed: 9, settings });
    assert.equal(plain.seats.blaze.displayName, "BACKLASH");
    assert.equal(plain.seed, 9);
    const named = quickFightConfig({ opponent, loadout: "pivot", preset: "arcade", seed: 9, settings, challengerName: " chat_mod ", chatSeed: "tuesday" });
    assert.equal(named.seats.blaze.displayName, "CHAT_MOD");
    assert.equal(named.seed, chatSeedFor("TUESDAY"));
    assert.equal(chatSeedFor("  "), null);
    assert.notEqual(chatSeedFor("a"), chatSeedFor("b"));
  });
});
