import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimDriver } from "../src/game/loop/sim-driver.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { createUiStore } from "../src/game/core/ui-store.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createMatchDirector, PHASE_MS, EVAL_STEPS, KO_DILATION } from "../src/game/match/match-director.ts";
import { KO_SLOWMO } from "../src/game/camera/juice.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import {
  createFakeEngine, createFakeRules, createFakeObservationBuilder, createFakeDelayLine, createFakeChunkExecutor,
  createFakeKinematics, createFakePilot, createFakeRecorder, createFakeSeatDriver, createFakeMomentBuffer,
  fakeEvents, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const FRAME = 1 / 60;
const FRAME_MS = 1000 / 60;
const PROVENANCE = { tuning: {}, tuningSha256: "t", servoParamsHash: "s", obsSchemaHash: "o", harnessCommit: "c", userAgent: "node" };

function makeGame(opts = {}) {
  const preset = opts.preset ?? "arcade";
  const engine = createFakeEngine({ mode: preset === "arcade" ? "arcade" : "harness" });
  const rules = createFakeRules();
  const clock = createGameClock();
  const bus = createEventBus();
  const ui = createUiStore();
  const settings = createSettingsStore({ storage: null });
  if (opts.matchesPlayed) settings.set({ profile: { matchesPlayed: opts.matchesPlayed, cockpitChosen: true } });
  const pilot = createFakePilot("atlas");
  const moments = createFakeMomentBuffer();
  const saved = new Map();
  const recorders = [];
  const created = [];
  const sim = createSimDriver({
    engine, rules, clock, kinematics: createFakeKinematics(), observations: createFakeObservationBuilder(),
    createDelayLine: createFakeDelayLine, createChunkExecutor: createFakeChunkExecutor, hitstopMsFor: fakeHitstopMsFor,
    pilot, bus,
  });
  let seed = 100;
  const director = createMatchDirector({
    sim, engine, rules, clock, ui, settings, pilot,
    seats: {
      async create(cfg) {
        const b = {};
        for (const s of ["atlas", "blaze"]) {
          const k = cfg.seats[s].driver.kind;
          if (k === "human" || k === "proxy") b[s] = { kind: "pilot", proxy: null };
          else { const d = createFakeSeatDriver(s, { kind: k }); created.push(d); b[s] = { kind: "policy", driver: d }; }
        }
        return b;
      },
      dispose(b) { for (const s of ["atlas", "blaze"]) if (b[s].kind === "policy") b[s].driver.dispose(); },
    },
    harness: {
      createRecorder: () => { const r = createFakeRecorder(); recorders.push(r); return r; },
      moments,
      store: { async save(ep) { saved.set(ep.meta.episodeId, ep); return ep.meta.episodeId; }, async load(id) { return saved.get(id); } },
      computeStats: null,
    },
    replay: null,
    provenance: PROVENANCE,
    nextSeed: () => seed++,
    now: () => new Date("2026-09-16T12:00:00Z"),
    memory: opts.memory,
  });
  const events = [];
  bus.subscribe((batch) => { for (const e of batch) events.push(e); });
  const game = {
    engine, rules, clock, bus, ui, settings, pilot, sim, director, moments, saved, recorders, created, events,
    frame(dt = FRAME) {
      sim.frameTick(dt);
      director.update(dt);
      bus.flush({});
    },
    /** Runs frames until `pred()` holds; returns wall ms elapsed. */
    until(pred, maxMs = 120_000) {
      let ms = 0;
      while (!pred()) {
        game.frame();
        ms += FRAME_MS;
        if (ms > maxMs) throw new Error(`timed out in phase ${director.phase}`);
      }
      return ms;
    },
    /** Makes the rules resolve the round on the next live step. */
    endRound(winner, reason, extra = []) {
      rules.script = (step, t, state) => {
        if (state.outcome) return null;
        state.outcome = { winner, reason, t };
        rules.script = null;
        return extra;
      };
    },
  };
  return game;
}

function quickConfig(overrides = {}) {
  return buildMatchConfig({
    preset: "arcade", context: "quick", seed: 1, now: new Date("2026-09-16T12:00:00Z"),
    seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } } },
    ...overrides,
  });
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= FRAME_MS + 1e-6, `${label}: ${actual.toFixed(1)} ms, expected ${expected} ± 1 frame`);
}

describe("match director: the show intro (EMOTION_BIBLE 2, 11.9)", () => {
  for (const fast of [false, true]) {
    test(`${fast ? "fast" : "standard"} show: entrance → boot ritual → count-in → ignite → FIGHT in 4.0 s`, async () => {
      const g = makeGame();
      await g.director.startMatch(quickConfig({ fastShow: fast }));
      assert.equal(g.director.phase, "entrance", "match_intro hands straight to the entrance for a person in the seat");
      assert.equal(g.director.cameraMode, "cockpit", "the reveal is seen from the seat");
      assert.equal(g.pilot.modes.at(-1), "frozen");
      let ms = 0;
      ms += g.until(() => g.director.phase === "boot_ritual");
      near(ms, PHASE_MS.show.entrance, "entrance");
      ms += g.until(() => g.director.phase === "count_in");
      near(ms, PHASE_MS.show.entrance + PHASE_MS.show.ritual, "boot ritual");
      ms += g.until(() => g.director.phase === "round_intro");
      near(ms, PHASE_MS.show.entrance + PHASE_MS.show.ritual + PHASE_MS.show.countIn, "count-in");
      assert.equal(g.rules.live, false);
      ms += g.until(() => g.director.phase === "fight");
      near(ms, 4000, "click → FIGHT");
      assert.equal(g.rules.live, true);
      assert.equal(g.sim.controlLive, true);
      assert.equal(g.pilot.modes.at(-1), "fight");
      assert.equal(g.director.cameraMode, "cockpit");
      assert.deepEqual(g.events.filter((e) => e.type === "phase").map((e) => e.phase).slice(0, 5), ["match_intro", "entrance", "boot_ritual", "count_in", "round_intro"]);
    });
  }

  test("the built-in facing a person is told the profile's match count (DDA new-player ramp)", async () => {
    const g = makeGame({ matchesPlayed: 1 });
    await g.director.startMatch(quickConfig());
    await new Promise((r) => setImmediate(r));
    const resets = g.created.flatMap((d) => d.resetContexts);
    assert.ok(resets.length > 0, "the opponent seat was reset for round 1");
    for (const c of resets) assert.equal(c.config?.matchesPlayed, 1);
    assert.equal(resets[0].config?.personality, "backlash", "the seat's own config survives the merge");
  });

  test("the show intro always plays; the Lab's VS card plays only when the opponent changed", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    assert.equal(g.director.phase, "entrance");
    await g.director.startMatch(quickConfig({ seed: 2 }));
    assert.equal(g.director.phase, "entrance");
    const lab = makeGame();
    await lab.director.startMatch(quickConfig({ context: "lab" }));
    assert.equal(lab.director.phase, "match_intro");
    await lab.director.startMatch(quickConfig({ context: "lab", seed: 2 }));
    assert.equal(lab.director.phase, "round_intro");
  });

  test("the Lab's VS card can be skipped after 1000 ms, not before; the show intro has no skip", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig({ context: "lab" }));
    g.until(() => g.director.phaseElapsedMs >= 500);
    g.director.skip();
    assert.equal(g.director.phase, "match_intro");
    g.until(() => g.director.phaseElapsedMs >= 1000);
    g.director.skip();
    assert.equal(g.director.phase, "round_intro");
    const s = makeGame();
    await s.director.startMatch(quickConfig());
    s.until(() => s.director.phaseElapsedMs >= 1200);
    s.director.skip();
    assert.equal(s.director.phase, "entrance");
  });

  test("pointer lock lost during the ritual pauses like a live round", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    g.until(() => g.director.phase === "boot_ritual");
    g.director.onPointerLockChange(false);
    assert.equal(g.director.phase, "paused");
    assert.equal(g.ui.get().overlay, "click_to_fight");
    g.director.onPointerLockChange(true);
    assert.equal(g.director.phase, "boot_ritual");
  });
});

describe("match director: episode provenance", () => {
  test("the episode names the model the match runs on, not the one the lobby left loaded", async () => {
    // The lobby runs Arcade physics, and the first round reset - which switches the engine to the stock model -
    // happens after the recorder begins. Stamping `engine.info` there put arena-arcade.xml in the provenance of
    // every Proving Ground and Harness episode, and VERIFY LAST EPISODE then rejected them all as MODEL CHANGED.
    const g = makeGame();                                   // engine starts in arcade mode, as the lobby leaves it
    assert.equal(g.engine.info.modelFile, "arena-arcade.xml");
    await g.director.startMatch(quickConfig({
      preset: "proving_ground", context: "lab", record: true, timing: "eval",
      seats: {
        atlas: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } },
        blaze: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } },
      },
    }));
    const meta = g.recorders.at(-1).meta;
    assert.equal(meta.physics, "harness");
    assert.equal(meta.provenance.modelFile, "arena.xml");
    assert.equal(meta.provenance.modelSha256, g.engine.infoFor("harness").modelSha256);
  });

  test("an Arcade match still names the Arcade model", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig({ record: true }));
    const meta = g.recorders.at(-1).meta;
    assert.equal(meta.physics, "arcade");
    assert.equal(meta.provenance.modelFile, "arena-arcade.xml");
  });
});

describe("sim driver: sparse physics channel", () => {
  test("optics impulse and self collisions reach the recording, so the report is not NaN", async () => {
    // Nothing used to call recorder.sparse(), so PhysicalSeatStats.opticsImpulse came back NaN from every
    // episode ever recorded and selfCollisions silently formatted as 0.
    const g = makeGame();
    g.engine.onStep = (frame) => {
      frame.active.opticsImpulse.blaze = 0.25;                 // a hit on blaze's camera mount this step
      frame.active.opticsImpulse.atlas = 0;
      frame.onsets.push({ kind: "self", t: frame.simTime, step: frame.step, seat: "atlas", linkA: "forearm", linkB: "base" });
    };
    await g.director.startMatch(quickConfig({ record: true }));
    g.until(() => g.director.phase === "fight");
    for (let i = 0; i < 10; i++) g.frame();
    const writes = g.recorders.at(-1).sparseWrites;
    const optics = writes["physics.optics_impulse.blaze"] ?? [];
    assert.ok(optics.length > 1, "blaze optics impulse recorded");
    assert.equal(optics[0].value, 0, "the column opens with a zero so its absence means unrecorded");
    assert.equal(optics[1].value, 0.25);
    // atlas took no optics hit, so its column is opened and then stays empty: a real 0, not a missing figure.
    assert.deepEqual(writes["physics.optics_impulse.atlas"].map((e) => e.value), [0]);
    assert.ok((writes["physics.self_contacts.atlas"] ?? []).length > 0, "self collisions recorded");
  });
});

describe("match director: round resolution", () => {
  async function toFight(g, cfg) {
    await g.director.startMatch(cfg);
    g.until(() => g.director.phase === "fight");
  }

  test("KO: 1800 ms, the 3 s round card, then the round-2 entrance (the same arm standing up, 2.4 s)", async () => {
    const g = makeGame();
    await toFight(g, quickConfig());
    g.endRound("atlas", "ko", [fakeEvents.strike({ magnitude: 0.3, lethal: true }), fakeEvents.ko()]);
    g.until(() => g.director.phase === "ko");
    assert.deepEqual(g.director.roundsWon, { atlas: 1, blaze: 0 });
    assert.equal(g.rules.live, false);
    near(g.until(() => g.director.phase !== "ko"), PHASE_MS.ko, "ko");
    assert.equal(g.director.phase, "round_summary");
    near(g.until(() => g.director.phase === "entrance"), PHASE_MS.roundSummary, "round card");
    assert.equal(g.director.round, 2);
    assert.equal(g.engine.resets.length, 2);
    near(g.until(() => g.director.phase === "fight"), 2400, "round-2 intro");
  });

  test("Arcade KO is a real slow-motion beat; stock presets keep the 1000 ms summary and no dilation", async () => {
    const g = makeGame();
    await toFight(g, quickConfig());
    g.endRound("atlas", "ko", [fakeEvents.strike({ magnitude: 0.3, lethal: true }), fakeEvents.ko()]);
    g.until(() => g.director.phase === "ko" && g.clock.timeScale < 1);
    assert.ok(Math.abs(g.clock.timeScale - KO_DILATION.scale) < 1e-9, `scale ${g.clock.timeScale}`);
    // EMOTION_BIBLE 6 KO row: the one allowed slow motion is 0.3× for 700 ms; juice.ts KO_SLOWMO is the single source.
    assert.equal(KO_DILATION.scale, KO_SLOWMO.scale);
    assert.equal(KO_DILATION.holdMs, KO_SLOWMO.ms);

    const s = makeGame();
    await toFight(s, quickConfig({ preset: "proving_ground" }));
    s.endRound("atlas", "ko");
    s.until(() => s.director.phase === "round_summary");
    assert.equal(s.clock.timeScale, 1);
    near(s.until(() => s.director.phase === "entrance"), PHASE_MS.roundSummary, "stock round_summary");
  });

  test("fast show: no round card, KO → FIGHT is 4.2 s", async () => {
    const g = makeGame();
    await toFight(g, quickConfig({ fastShow: true }));
    g.endRound("blaze", "ko");
    g.until(() => g.director.phase === "ko");
    const ms = g.until(() => g.director.phase === "fight" && g.director.round === 2);
    near(ms, PHASE_MS.ko + 2400, "KO → FIGHT");
  });

  test("match 1 (bible 2): a time-up tie never goes to Sudden Death; the sparring round locks in at 4.0 s", async () => {
    const { firstMatchConfig } = await import("../src/game/match/match-config.ts");
    const g = makeGame();
    await g.director.startMatch(firstMatchConfig(5, g.settings.get()));
    g.until(() => g.director.phase === "fight");
    assert.equal(g.rules.config.lockInS.atlas, 4, "HOLD IT · 4");
    assert.equal(g.rules.config.coreDropAtS > 100, true, "no Core until the script asks");
    g.endRound("atlas", "lock");
    g.until(() => g.director.round === 2 && g.director.phase === "fight");
    assert.equal(g.rules.config.roundLengthS, 30);
    g.rules.state.seats.atlas.integrity = 40;
    g.rules.state.seats.blaze.integrity = 37;
    g.endRound("blaze", "time");
    g.until(() => g.director.phase === "time_up");
    assert.deepEqual(g.director.roundsWon, { atlas: 1, blaze: 1 }, "the rules' tiebreak decides, not Sudden Death");
    g.until(() => g.director.phase !== "time_up" && g.director.phase !== "round_summary");
    assert.notEqual(g.director.phase, "sudden_death");
  });

  for (const [reason, phase, std, fst] of [["lock", "lock", 1500, 1200], ["forfeit", "time_up", 1200, 800]]) {
    for (const fast of [false, true]) {
      test(`${reason}: ${phase} lasts ${fast ? fst : std} ms (${fast ? "fast" : "standard"})`, async () => {
        const g = makeGame();
        await toFight(g, quickConfig({ fastShow: fast }));
        g.endRound("atlas", reason);
        g.until(() => g.director.phase === phase);
        near(g.until(() => g.director.phase !== phase), fast ? fst : std, phase);
      });
    }
  }

  test("time with an Integrity gap ≤ 5 goes to sudden death, live after its 1600 ms intro, integrity carried", async () => {
    const g = makeGame();
    await toFight(g, quickConfig());
    g.rules.state.seats.atlas.integrity = 40;
    g.rules.state.seats.blaze.integrity = 37;
    g.endRound("atlas", "time");
    g.until(() => g.director.phase === "time_up");
    assert.deepEqual(g.director.roundsWon, { atlas: 0, blaze: 0 });
    near(g.until(() => g.director.phase === "sudden_death"), 1200, "time_up");
    assert.equal(g.rules.state.suddenDeath, true);
    assert.equal(g.rules.state.seats.blaze.integrity, 37);
    assert.equal(g.rules.config.lockInS.atlas, 4);
    assert.equal(g.rules.live, false);
    near(g.until(() => g.rules.live), 1600, "sudden death intro");
    g.endRound("blaze", "sudden_death_strike");
    g.until(() => g.director.phase === "ko");
    assert.deepEqual(g.director.roundsWon, { atlas: 0, blaze: 1 });
  });

  test("time with a larger gap awards the round without sudden death", async () => {
    const g = makeGame();
    await toFight(g, quickConfig());
    g.rules.state.seats.atlas.integrity = 60;
    g.rules.state.seats.blaze.integrity = 20;
    g.endRound("atlas", "time");
    g.until(() => g.director.phase === "time_up");
    assert.deepEqual(g.director.roundsWon, { atlas: 1, blaze: 0 });
  });

  test("underdog lock-in: the seat down a round gets 6.0 s in Arcade, 8.0 s in stock presets", async () => {
    const g = makeGame();
    await toFight(g, quickConfig({ fastShow: true }));
    g.endRound("blaze", "ko");
    g.until(() => g.director.round === 2 && g.director.phase === "fight");
    assert.deepEqual(g.rules.config.lockInS, { atlas: 6, blaze: 8 });
  });
});

describe("match director: match end, outro, rematch", () => {
  async function winMatch(g, winner) {
    for (let r = 0; r < 2; r++) {
      g.until(() => g.director.phase === "fight");
      g.endRound(winner, "ko");
      g.until(() => g.director.phase === "ko");
    }
  }

  for (const fast of [false, true]) {
    for (const playerWins of [true, false]) {
      test(`outro ${playerWins ? "win" : "loss"} (${fast ? "fast" : "standard"}), then post-match with the episode saved`, async () => {
        const g = makeGame();
        await g.director.startMatch(quickConfig({ fastShow: fast }));
        await winMatch(g, playerWins ? "atlas" : "blaze");
        g.until(() => g.director.phase === "outro");
        assert.equal(g.director.cameraMode, "outro");
        const table = fast ? PHASE_MS.outro.fast : PHASE_MS.outro.standard;
        g.director.skip();
        assert.equal(g.director.gg, true, "a click at the top of the outro is the GG tap, not a skip");
        assert.equal(g.director.phase, "outro");
        near(g.until(() => g.director.phase === "verdict"), playerWins ? table.win : table.loss, "outro");
        const ep = g.recorders[0].ended;
        assert.equal(ep.winner, playerWins ? "atlas" : "blaze");
        assert.deepEqual(ep.roundsWon, playerWins ? { atlas: 2, blaze: 0 } : { atlas: 0, blaze: 2 });
        assert.equal(ep.rounds.length, 2);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(g.ui.get().lastEpisodeId, g.recorders[0].meta.episodeId);
        assert.equal(g.ui.get().screen, "post_match");
        assert.equal(g.settings.get().profile.matchesPlayed, 1);
        assert.ok(g.events.some((e) => e.type === "match_end"));
        assert.ok(g.created.every((d) => d.disposed));
      });
    }
  }

  test("rematch → FIGHT is 2.4 s; the loser's memory is written and read back", async () => {
    const written = [];
    const mem = { bestMove: "hook", hurtSide: -1, timeToFirstAttackS: 2, feintsWorked: 0, grudge: 1 };
    const g = makeGame({ memory: { read: () => mem, write: (opp, events, player, won) => written.push({ opp: opp.personality, n: events.length, player, won }), lossStreak: () => 0 } });
    await g.director.startMatch(quickConfig());
    assert.deepEqual(g.director.opponentMemory, mem);
    await winMatch(g, "blaze");
    g.until(() => g.director.phase === "verdict");
    assert.equal(written.length, 1);
    assert.deepEqual([written[0].opp, written[0].player, written[0].won], ["backlash", "atlas", false]);
    assert.ok(written[0].n >= 2, "round_end events reach the memory");
    await g.director.rematch();
    assert.equal(g.director.phase, "entrance");
    near(g.until(() => g.director.phase === "fight"), 2400, "rematch → FIGHT");
    assert.notEqual(g.director.config.seed, 1);
    assert.equal(g.director.config.tutorial, false);
  });

  test("LLL guard (8.4): two straight losses drop the rematch one tier; below Rookie, the sparring cadence", async () => {
    const { tierBelow } = await import("../src/game/match/match-director.ts");
    assert.deepEqual(["champion", "pro", "contender", "rookie"].map(tierBelow), ["pro", "contender", "rookie", null]);
    for (const [tier, expectTier, expectBehavior] of [["pro", "contender", undefined], ["rookie", "rookie", "sparring"]]) {
      const g = makeGame({ memory: { read: () => ({ bestMove: null, hurtSide: 0, timeToFirstAttackS: null, feintsWorked: 0, grudge: 0 }), write() {}, lossStreak: () => 2 } });
      await g.director.startMatch(quickConfig({ seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier, dda: true } } } }));
      await winMatch(g, "blaze");
      g.until(() => g.director.phase === "verdict");
      await g.director.rematch();
      assert.equal(g.director.config.seats.blaze.driver.tier, expectTier);
      assert.equal(g.director.config.seats.blaze.driver.behavior, expectBehavior);
    }
  });

  test("holding skip for 400 ms jumps the between-round chain to the next round intro", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    g.until(() => g.director.phase === "fight");
    g.endRound("atlas", "ko");
    g.until(() => g.director.phase === "ko");
    g.director.setHoldSkip(true);
    const ms = g.until(() => g.director.phase === "entrance");
    near(ms, 400, "hold skip");
    assert.equal(g.ui.get().holdSkipProgress, 0);
  });
});

describe("match director: pause and pointer lock", () => {
  test("pause stops the sim clock and phase timers; resume continues", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    g.until(() => g.director.phase === "fight");
    g.director.pause();
    assert.equal(g.director.phase, "paused");
    assert.equal(g.ui.get().overlay, "pause");
    const t = g.clock.simTime;
    for (let i = 0; i < 30; i++) g.frame();
    assert.equal(g.clock.simTime, t);
    g.director.resume();
    assert.equal(g.director.phase, "fight");
    g.frame();
    assert.ok(g.clock.simTime > t);
  });

  test("losing pointer lock pauses with CLICK TO FIGHT; regaining it resumes", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    g.until(() => g.director.phase === "fight");
    g.director.onPointerLockChange(false);
    assert.equal(g.ui.get().overlay, "click_to_fight");
    g.director.onPointerLockChange(true);
    assert.equal(g.director.phase, "fight");
    assert.equal(g.ui.get().overlay, null);
  });

  test("with a bridge seat the human is protected for 3 s, then forfeits the round", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig({
      seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "bridge", url: "ws://127.0.0.1:8765", allowLan: false, sessionId: "s" } } },
    }));
    g.until(() => g.director.phase === "fight");
    g.director.onPointerLockChange(false);
    assert.notEqual(g.director.phase, "paused");
    assert.equal(g.rules.state.seats.atlas.protected, true);
    assert.equal(g.pilot.modes.at(-1), "hold_guard");
    near(g.until(() => g.director.phase === "time_up"), PHASE_MS.lockHold, "lock hold");
    assert.deepEqual(g.director.roundsWon, { atlas: 0, blaze: 1 });
    assert.equal(g.rules.state.seats.atlas.protected, false);
  });

  test("pause is a no-op on a turbo match, which has no human seat to pause for", async () => {
    // A turbo run is eval-timed by definition (buildMatchConfig refuses TURBO with live timing) and eval
    // timing refuses a human seat, so there is no seat for the pause menu to belong to. The visibility hook
    // calls director.pause() whenever the tab is hidden; on a turbo run that must change nothing at all,
    // because the run is exactly what the player left going and nobody is watching it.
    const g = makeGame({ preset: "harness" });
    const cfg = buildMatchConfig({
      preset: "harness", context: "lab", seed: 5, timing: "eval", turbo: true, now: new Date("2026-09-16T12:00:00Z"),
      seats: {
        atlas: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } },
        blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } },
      },
    });
    assert.equal(cfg.turbo, true);
    await g.director.startMatch(cfg);
    g.until(() => g.director.phase === "fight");

    // Eval timing is lockstep, so a frame that asked a policy for an action stops until the reply lands;
    // the browser's turbo pump yields between frames for exactly this reason.
    const stepsOver = async (n) => {
      const a = g.engine.frame.step;
      for (let i = 0; i < n; i++) { g.frame(); if (g.sim.blocked) await g.sim.whenUnblocked(); }
      return g.engine.frame.step - a;
    };
    const before = await stepsOver(30);
    assert.ok(before > 0);

    g.director.pause();
    assert.equal(g.director.phase, "fight", "a turbo match must not enter the pause phase");
    assert.equal(g.clock.paused, false);
    assert.equal(g.ui.get().overlay, null);
    g.director.resume();
    assert.equal(g.clock.paused, false);

    const after = await stepsOver(30);
    // Within a tenth: the two windows start at different points of the control-tick cycle, so they differ
    // by at most a tick's worth of steps. The regression would be a collapse to a fraction of the rate.
    assert.ok(after >= before * 0.9, `pause/resume changed how fast the turbo match steps: ${before} then ${after}`);
  });

  test("forfeit round from the pause menu awards the round to the opponent", async () => {
    const g = makeGame();
    await g.director.startMatch(quickConfig());
    g.until(() => g.director.phase === "fight");
    g.director.pause();
    g.director.forfeitRound();
    assert.equal(g.director.phase, "time_up");
    assert.equal(g.clock.paused, false);
    assert.deepEqual(g.director.roundsWon, { atlas: 0, blaze: 1 });
  });
});

describe("match director: eval timing runs on steps", () => {
  test("KO holds exactly the eval step count, other presentation phases take zero steps", async () => {
    const g = makeGame({ preset: "harness" });
    const cfg = buildMatchConfig({
      preset: "harness", context: "lab", seed: 5, timing: "eval", now: new Date("2026-09-16T12:00:00Z"),
      seats: { atlas: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } } },
    });
    await g.director.startMatch(cfg);
    await g.sim.whenUnblocked();
    assert.equal(g.director.phase, "fight");
    const run = async (n) => { let done = 0; while (done < n) { done += g.sim.advance(n - done); if (g.sim.blocked) await g.sim.whenUnblocked(); } };
    await run(40);
    g.endRound("atlas", "ko");
    await run(1);
    assert.equal(g.director.phase, "ko");
    await run(EVAL_STEPS.ko - 1);
    assert.equal(g.director.phase, "ko");
    await run(1);
    assert.equal(g.director.phase, "fight");
    assert.equal(g.director.round, 2);
    g.endRound("atlas", "lock");
    await run(1 + EVAL_STEPS.lock);
    assert.equal(g.director.phase, "post_match");
    const ep = await g.director.whenMatchEnds();
    assert.equal(ep, null, "the match already ended");
    assert.equal(g.recorders[0].ended.winner, "atlas");
  });
});

describe("match director: attract, green room, the sparring round, the drill", async () => {
  const { firstMatchConfig, systemsCheckConfig } = await import("../src/game/match/match-config.ts");

  test("the title runs an unrecorded, silent attract match under the broadcast camera and loops it", async () => {
    const g = makeGame();
    g.director.enterTitle();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(g.director.phase, "attract");
    assert.equal(g.ui.get().screen, "title");
    assert.equal(g.director.cameraMode, "broadcast");
    assert.equal(g.director.config.context, "attract");
    assert.equal(g.recorders.length, 0);
    for (let round = 0; round < 2; round++) {
      g.until(() => g.rules.live);
      g.endRound("atlas", "ko");
      g.until(() => !g.rules.live);
    }
    for (let i = 0; i < 600 && g.director.config?.seed !== 101; i++) {
      g.frame();
      if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(g.director.config.seed, 101, "a fresh attract match follows the last");
    assert.equal(g.director.phase, "attract");
    assert.equal(g.ui.get().screen, "title");
  });

  test("green room: lobby engine layout, cursor-driven pilot, no cockpit prompt", async () => {
    const g = makeGame();
    g.director.enterGreenRoom();
    assert.equal(g.director.phase, "green_room");
    assert.equal(g.ui.get().screen, "green_room");
    assert.equal(g.engine.resets.at(-1).layout, "lobby");
    assert.equal(g.pilot.modes.at(-1), "lobby_cursor");
    assert.equal(g.director.cameraMode, "lobby");
    const before = g.pilot.writes;
    for (let i = 0; i < 10; i++) g.frame();
    assert.ok(g.pilot.writes > before, "the lobby arm follows the pilot every step");
  });

  test("match 1 round 1: the script drives BACKLASH, a KO restarts the bench, only the pilot's lock ends it, round 2 is real", async () => {
    const g = makeGame();
    await g.director.startMatch(firstMatchConfig(8, g.settings.get()));
    assert.equal(g.ui.get().screen, "tutorial");
    assert.equal(g.director.phase, "entrance");
    g.until(() => g.director.phase === "fight");
    const backlash = g.created[0];
    const behaviours = () => backlash.resetContexts.map((c) => c.config.behavior);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(behaviours(), ["parked_in_reach"]);
    assert.equal(g.director.tutorial.step.id, "hit");

    // Hands the rules one batch of events, then lets any hit stop they cause run out.
    const feed = (events) => {
      g.rules.script = () => { g.rules.script = null; return events; };
      g.until(() => g.rules.script === null && g.clock.hitstopRemainingMs === 0);
      g.frame();
    };
    feed([fakeEvents.strike()]);
    assert.equal(g.director.tutorial.step.id, "guard");
    assert.equal(g.ui.get().tutorialStep, "guard");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(backlash.resetContexts.at(-1).config.behavior, "slow_heavy", "the held SLAM tell");

    g.endRound("blaze", "ko");
    g.frame(); g.frame();
    assert.equal(g.director.phase, "fight", "a KO restarts the bench, not the round");
    assert.equal(g.director.tutorial.step.id, "guard");
    assert.deepEqual(g.director.roundsWon, { atlas: 0, blaze: 0 });

    feed([fakeEvents.strike({ attacker: "blaze", victim: "atlas", guarded: true })]);
    assert.equal(g.director.tutorial.step.id, "grab");
    assert.equal(g.rules.config.coreDropAtS, 0.5, "the Core drops when the script asks");
    g.rules.state.core.phase = "live";
    g.rules.state.core.lastTouchedBy = "atlas";
    g.frame(); g.frame();
    assert.equal(g.director.tutorial.step.id, "hold");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(behaviours(), ["parked_in_reach", "slow_heavy", "idle", "idle"]);

    g.endRound("atlas", "lock", [fakeEvents.core({ stage: "lock", seat: "atlas" })]);
    g.until(() => g.director.phase === "lock");
    assert.deepEqual(g.director.roundsWon, { atlas: 1, blaze: 0 }, "the pilot has won a round");
    g.until(() => g.director.round === 2 && g.director.phase === "entrance");
    assert.equal(g.director.tutorial, null, "rounds 2–3 are real");
    near(g.until(() => g.director.phase === "fight"), 2400, "round-2 intro: the same arm standing up");
    assert.equal(g.rules.config.roundLengthS, 30);
    assert.equal(g.settings.get().profile.matchesPlayed, 0);
  });

  test("after match 2 the next REMATCH runs the SYSTEMS CHECK drill once, then the pending rematch", async () => {
    const g = makeGame({ matchesPlayed: 1 });
    await g.director.startMatch(quickConfig());
    for (let r = 0; r < 2; r++) { g.until(() => g.director.phase === "fight"); g.endRound("atlas", "ko"); g.until(() => g.director.phase === "ko"); }
    g.until(() => g.director.phase === "verdict");
    assert.equal(g.settings.get().profile.matchesPlayed, 2);
    assert.equal(g.director.drillPending, true);
    await g.director.rematch();
    assert.equal(g.director.config.preset, "proving_ground");
    assert.equal(g.director.config.context, "warmup");
    assert.deepEqual(g.director.config, { ...systemsCheckConfig(g.director.config.seed, g.settings.get()), id: g.director.config.id });
    assert.equal(g.director.drillPending, false);
    g.until(() => g.director.phase === "systems_check");
    assert.equal(g.rules.live, true);
    assert.equal(g.pilot.modes.at(-1), "fight");
    assert.equal(g.rules.config.coreDropAtS, 0.5, "the Core drops at once: it is a DOCK drill");
    assert.equal(g.rules.config.roundLengthS, 20);
    assert.equal(g.pilot.rulesSet.at(-1).assists, false, "no shaping in a drill");
    assert.match(g.director.drill.task, /^dock the core from pose/);
    g.endRound("atlas", "lock", [fakeEvents.core({ stage: "lock", seat: "atlas" })]);
    g.until(() => g.director.phase === "lock");
    assert.equal(g.director.drill.result, "NOMINAL");
    assert.equal(g.rules.live, false, "control stops on SYSTEMS NOMINAL");
    for (let i = 0; i < 1200 && g.director.config?.context !== "quick"; i++) {
      g.frame();
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(g.director.config.context, "quick");
    assert.equal(g.director.drill, null);
    assert.equal(g.director.phase, "entrance", "the pending rematch starts as a rematch");
    assert.equal(g.settings.get().profile.matchesPlayed, 2, "the drill counts as no match");
  });
});
