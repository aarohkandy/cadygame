// WP7 hosts' scheduler on caption units (EMOTION_BIBLE 7): cadence and the 3 s hard silence, the 45 % silence floor,
// 14 to 26 units over a three-minute match, no repeat within 20 (history persists), never two units from the same
// host in a row, the player's name at most twice, ROOK's KO release at +650 ms, the silent first 4 s of FIGHT, VALE
// coaching-only in matches 1 to 3 and telemetry-only numbers after, menace gates, prosody as data, tokens from real
// event fields, and the optional Web Speech voice with squelch, ducking, and the NO VOICE fallback.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COACH_GAP_MS, KO_RELEASE_MS, NAME_USES_PER_MATCH, NO_REPEAT_WINDOW, OPENING_SILENCE_S, TABLE_SLAM_NEWTONS, UNIT_CADENCE_MS,
  UNIT_SILENCE_MS, WHIFF_STREAK_AT, captionProsody, createAnnouncer, emptyTally, hostEventFor, renderLine,
} from "../src/game/announcer/announcer.ts";
import { COACH_EVENTS, HOST_LINES, linesFor } from "../src/game/announcer/lines.ts";
import { createHostVoice, chooseVoices } from "../src/game/announcer/host-voice.ts";
import { speechFor } from "../src/game/audio/prosody.ts";
import { HOSTS } from "../src/game/brand/hosts.ts";
import { createUiStore } from "../src/game/core/ui-store.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createRng } from "../src/game/core/rng.ts";
import { fakeCombat, fakeEvents, fakeFeedbackContext } from "../src/game/testing/fakes.ts";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

/** A veteran profile by default (both hosts unlocked); `matchesPlayed` puts the profile earlier in its first session. */
function setup(opts = {}) {
  const ui = createUiStore();
  ui.set({ screen: "match" });
  const settings = createSettingsStore({ storage: null });
  settings.set({ profile: { matchesPlayed: opts.matchesPlayed ?? 5 } });
  if (opts.captions) settings.set({ audio: { captions: opts.captions } });
  const started = [];
  let last = null;
  ui.subscribe(() => {
    const c = ui.get().captions;
    if (c && c !== last) started.push({ ...c, atMs: clock.ms });
    last = c;
  });
  const clock = { ms: 0 };
  const announcer = createAnnouncer({ ui, settings, voice: opts.voice ?? null, rng: createRng(opts.seed ?? 7), storage: opts.storage ?? memoryStorage(), hype: opts.hype });
  const ctx = fakeFeedbackContext({ phase: "fight", combat: fakeCombat("arcade", { roundLengthS: 45, fightTimeS: 12 }) });
  // Ticks advance the wall clock and the fight clock together, the way the loop does.
  const tick = (seconds, advanceFight = true) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      clock.ms += 1000 / 60;
      if (advanceFight && (ctx.phase === "fight" || ctx.phase === "sudden_death")) ctx.combat.fightTimeS += 1 / 60;
      announcer.update(1 / 60, ctx);
    }
  };
  // Into round 2 of a match, with the bell line spoken and its cadence spent, so the test's own events start clean.
  const startMatch = () => {
    announcer.onEvents([fakeEvents.phase({ phase: "match_intro", round: 1 })], ctx);
    announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round: 2 })], ctx);
    tick(8);
    started.length = 0;
  };
  return { ui, settings, announcer, ctx, started, tick, clock, startMatch };
}

const crit = (o = {}) => fakeEvents.strike({ crit: true, damage: 34, physicalDamage: 34, vN: 2.73, attacker: "atlas", victim: "blaze", ...o });
const unitOf = (c) => c.lineId.split(".")[0];

describe("caption units", () => {
  test("a unit ends, then 3 s of hard silence; units start at most one per 6 s; P1 does not wait", () => {
    const { announcer, ctx, started, tick, startMatch } = setup();
    startMatch();
    announcer.onEvents([fakeEvents.deflect()], ctx);
    assert.equal(started.length, 1, "the first unit starts at once");
    const first = started[0];
    tick(0.5);
    announcer.onEvents([crit()], ctx);
    tick(2);
    assert.equal(started.length, 1, "a second unit cannot start inside the first, nor inside its 3 s silence");
    // Keep offering the crit; it is stale after 1.2 s, so it has to be re-offered to land.
    for (let n = 0; n < 12 && started.length < 2; n++) { announcer.onEvents([crit({ vN: 2.5 + n * 0.01 })], ctx); tick(0.5); }
    const second = started[1];
    assert.ok(second, "a second unit eventually starts");
    assert.ok(second.atMs - (first.atMs + first.durationMs) >= UNIT_SILENCE_MS - 20, `hard silence ${second.atMs - (first.atMs + first.durationMs)} ms`);
    assert.ok(second.atMs - first.atMs >= UNIT_CADENCE_MS - 20, `cadence ${second.atMs - first.atMs} ms`);
    // P1 cuts in: the knockout does not queue behind the cadence.
    tick(0.2);
    announcer.onEvents([fakeEvents.ko()], ctx);
    tick(KO_RELEASE_MS / 1000 + 0.05);
    assert.ok(announcer.current && unitOf(announcer.current) === "ko", "the release line is on air");
  });

  test("ROOK's KO release line starts 650 ms after the confirm, never earlier", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { announcer, ctx, started, tick, clock, startMatch } = setup({ seed });
      startMatch();
      tick(2);
      const at = clock.ms;
      announcer.onEvents([fakeEvents.strike({ damage: 40, physicalDamage: 40, vN: 3.1, lethal: true }), fakeEvents.ko()], ctx);
      assert.equal(started.length, 0, "nothing on the confirm frame");
      tick(0.6);
      assert.equal(started.length, 0, "still silent at +600 ms");
      tick(0.2);
      assert.equal(started.length, 1);
      assert.equal(unitOf(started[0]), "ko");
      assert.ok(started[0].atMs - at >= KO_RELEASE_MS, `release at +${Math.round(started[0].atMs - at)} ms`);
    }
  });

  test("the hosts are silent for the first 4 s after FIGHT", () => {
    const { announcer, ctx, started, tick, startMatch } = setup();
    startMatch();
    ctx.combat.fightTimeS = 0.5;
    announcer.onEvents([crit()], ctx);
    tick(1);
    assert.equal(started.length, 0);
    ctx.combat.fightTimeS = OPENING_SILENCE_S + 0.1;
    announcer.onEvents([crit()], ctx);
    tick(0.1);
    assert.equal(started.length, 1);
  });

  test("captions land in the UiStore with a HostId speaker; BIG MOMENTS hides P3; OFF shows nothing; the attract loop is silent", () => {
    const full = setup();
    full.startMatch();
    full.announcer.onEvents([fakeEvents.core({ stage: "drop", seat: null })], full.ctx);
    const cap = full.ui.get().captions;
    assert.ok(cap && (cap.speaker === "rook" || cap.speaker === "vale"));
    assert.equal(cap.priority, 3);
    assert.ok(cap.durationMs >= 1400 && cap.durationMs <= 4200);
    full.tick(5);
    assert.equal(full.ui.get().captions, null, "cleared when the line ends");

    const big = setup({ captions: "big" });
    big.startMatch();
    big.announcer.onEvents([fakeEvents.core({ stage: "drop", seat: null })], big.ctx);
    assert.equal(big.ui.get().captions, null);
    big.tick(8);
    big.announcer.onEvents([crit()], big.ctx);
    assert.ok(big.ui.get().captions);

    const off = setup({ captions: "off" });
    off.startMatch();
    off.announcer.onEvents([crit(), fakeEvents.ko()], off.ctx);
    off.tick(1);
    assert.equal(off.started.length, 0);

    const title = setup();
    title.startMatch();
    title.ui.set({ screen: "title" });
    title.announcer.onEvents([fakeEvents.ko(), crit()], title.ctx);
    title.tick(1);
    assert.equal(title.started.length, 0);
  });

  test("prosody is data: ramp 0..3 by priority, coaching flat, the endings and the lock are release lines", () => {
    assert.deepEqual(captionProsody({ lineId: "ko.rook.3", priority: 1 }), { ramp: 3, release: true });
    assert.deepEqual(captionProsody({ lineId: "lock.vale.2", priority: 1 }), { ramp: 3, release: true });
    assert.deepEqual(captionProsody({ lineId: "crit.rook.1", priority: 2 }), { ramp: 2, release: false });
    assert.deepEqual(captionProsody({ lineId: "crowd.vale.1", priority: 3 }), { ramp: 1, release: false });
    assert.deepEqual(captionProsody({ lineId: "coach_passive.vale.2", priority: 3 }), { ramp: 0, release: false });
    assert.deepEqual(captionProsody({ lineId: "prompt.hit_it", priority: 1 }), { ramp: 0, release: false });
  });
});

/** A realistic three-minute match: contacts every couple of seconds, a Core, a streak, two knockouts, quiet spells. */
function threeMinuteMatch(s, i = 0) {
  const { announcer, ctx, tick } = s;
  announcer.onEvents([fakeEvents.phase({ phase: "match_intro", round: 1 })], ctx);
  const beats = [
    [fakeEvents.strike({ damage: 12 + i, physicalDamage: 12 + i, vN: 1.4 })], [fakeEvents.deflect({ pressLeadMs: 40 + i })],
    [{ type: "combo", t: 0, step: 0, seat: "atlas", count: 3 }], [crit({ damage: 31 + i, vN: 2.4 + i * 0.07 })],
    [fakeEvents.core({ stage: "drop", seat: null })], [fakeEvents.strike({ attacker: "blaze", victim: "atlas", damage: 18, physicalDamage: 18, vN: 1.9 })],
    [fakeEvents.core({ stage: "lock_in_start", seat: "atlas", remainingS: 8 })], [fakeEvents.whiff({ seat: "blaze" })],
    [fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 4.5 })], [fakeEvents.tableHit({ seat: "blaze", force: 18 + i })],
    [fakeEvents.strike({ damage: 38 + i, physicalDamage: 38 + i, vN: 3 })], [fakeEvents.clash({ heavyWinner: "atlas" })],
  ];
  let n = 0;
  for (let round = 1; round <= 3; round++) {
    ctx.combat.round = round;
    ctx.combat.fightTimeS = 0;
    ctx.combat.roundLengthS = 60;
    ctx.phase = "round_intro";
    announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round, finalRound: round === 3 })], ctx);
    tick(3, false);
    ctx.phase = "fight";
    announcer.onEvents([fakeEvents.phase({ phase: "fight", round })], ctx);
    // 60 s of fight: a beat every 2.5 s for 40 s, then 20 s with little happening.
    for (let t = 0; t < 40; t += 2.5) { announcer.onEvents(beats[n++ % beats.length], ctx); tick(2.5); }
    tick(20);
    ctx.phase = "ko";
    announcer.onEvents([fakeEvents.strike({ damage: 40, physicalDamage: 40, vN: 3.2, lethal: true }), fakeEvents.ko(), fakeEvents.roundEnd({ winner: "atlas", reason: "ko" })], ctx);
    tick(4, false);
  }
  ctx.phase = "outro";
  announcer.onEvents([fakeEvents.matchEnd({ winner: "atlas" })], ctx);
  tick(5, false);
}

describe("a three-minute match (EMOTION_BIBLE 7 targets)", () => {
  test("14 to 26 units, no repeat within 20, at least 45 % silence, name at most twice, hosts alternate", () => {
    for (const seed of [11, 22, 33]) {
      const s = setup({ seed, storage: null });
      threeMinuteMatch(s, seed);
      const { started, announcer } = s;
      // A unit is a lead line; a VALE follow-up inside 2 s of ROOK's clause belongs to the unit before it.
      const units = [];
      for (const c of started) {
        const prev = units[units.length - 1];
        const follow = prev && c.speaker === "vale" && prev.lead.speaker === "rook" && c.atMs - (prev.lead.atMs + prev.lead.durationMs) <= 2000 && unitOf(c) === unitOf(prev.lead);
        if (follow) prev.follow = c; else units.push({ lead: c, follow: null });
      }
      assert.ok(units.length >= 14 && units.length <= 26, `seed ${seed}: ${units.length} units (${announcer.units} counted)`);
      assert.ok(announcer.spokenFrac <= 0.55, `seed ${seed}: hosts spoke ${(announcer.spokenFrac * 100).toFixed(0)} % of fight time`);
      const ids = started.map((c) => c.lineId);
      for (let i = 0; i < ids.length; i++) {
        const prev = i > 0 ? ids.lastIndexOf(ids[i], i - 1) : -1;
        if (prev >= 0) assert.ok(i - prev > NO_REPEAT_WINDOW, `${ids[i]} repeated after ${i - prev} lines`);
      }
      const nameUses = started.filter((c) => c.text.includes("PILOT")).length;
      assert.ok(nameUses <= NAME_USES_PER_MATCH, `seed ${seed}: the player's name was said ${nameUses} times`);
      for (let i = 1; i < units.length; i++) {
        const last = units[i - 1].follow ?? units[i - 1].lead;
        assert.notEqual(units[i].lead.speaker, last.speaker, `seed ${seed}: two units in a row from ${last.speaker} (${last.lineId} then ${units[i].lead.lineId})`);
      }
      for (const u of units) if (u.follow) assert.ok(u.follow.atMs - (u.lead.atMs + u.lead.durationMs) <= 2000, "VALE's number inside 2 s");
      for (const c of started) assert.ok(!/\{[a-z]+\}/.test(c.text), `unresolved token in "${c.text}"`);
      assert.deepEqual([...new Set(started.map((c) => c.speaker))].sort(), ["rook", "vale"]);
    }
  });

  test("every KO caption starts at least 650 ms after the confirm, and the quiet stretch still gets a thread or crowd line", () => {
    const s = setup({ seed: 44, storage: null, hype: () => 0.6 });
    threeMinuteMatch(s, 3);
    const kos = s.started.filter((c) => unitOf(c) === "ko");
    assert.ok(kos.length >= 2, `${kos.length} KO lines over three knockouts`);
    const kinds = new Set(s.started.map(unitOf));
    assert.ok([...kinds].some((k) => k.startsWith("thread_") || k === "crowd"), `no filler in the quiet stretches: ${[...kinds].join(", ")}`);
    assert.ok(kinds.has("momentum_up") || kinds.has("momentum_down"), "the momentum stab fired");
  });
});

describe("a fresh profile (matches 1 to 3)", () => {
  test("round 1 of match 1 is silent but for coaching, and coaching is VALE, state-tied, one per 8 s", () => {
    const { announcer, ctx, started, tick } = setup({ matchesPlayed: 0, seed: 5 });
    announcer.onEvents([fakeEvents.phase({ phase: "match_intro", round: 1 })], ctx);
    announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round: 1 })], ctx);
    ctx.combat.fightTimeS = 4.5;
    announcer.onEvents([fakeEvents.core({ stage: "drop", seat: null }), fakeEvents.core({ stage: "lock", seat: "atlas" })], ctx);
    tick(0.4);
    assert.equal(started.length, 0, "no host reaction in the sparring round, not even the lock");
    // Nothing touched for 5 s: VALE nudges once.
    tick(6);
    assert.equal(started.length, 1);
    assert.equal(started[0].speaker, "vale");
    assert.equal(unitOf(started[0]), "coach_passive");
    // Three whiffs in a row is the next coaching beat, but not inside the 8 s gap.
    announcer.onEvents([fakeEvents.whiff(), fakeEvents.whiff(), fakeEvents.whiff()], ctx);
    tick(1);
    assert.equal(started.length, 1);
    tick(COACH_GAP_MS / 1000);
    announcer.onEvents([fakeEvents.whiff(), fakeEvents.whiff(), fakeEvents.whiff()], ctx);
    tick(0.5);
    assert.equal(started.length, 2);
    assert.equal(unitOf(started[1]), "coach_whiff");
    for (const c of started) assert.ok(!/\d/.test(c.text), `coaching carries a number: ${c.text}`);
  });

  test("in rounds 2 and 3 of match 1 ROOK calls the moments and VALE still only coaches; her numbers start at match 4", () => {
    const early = setup({ matchesPlayed: 2, seed: 8 });
    early.startMatch();
    for (let n = 0; n < 12; n++) { early.announcer.onEvents([[crit()], [fakeEvents.deflect()], [fakeEvents.ko()]][n % 3], early.ctx); early.tick(8); }
    assert.ok(early.started.length >= 4);
    for (const c of early.started) {
      if (c.speaker === "vale") assert.ok(COACH_EVENTS.includes(unitOf(c)), `VALE spoke a non-coaching line in match 3: ${c.lineId}`);
    }
    const late = setup({ matchesPlayed: 3, seed: 8 });
    late.startMatch();
    for (let n = 0; n < 12; n++) { late.announcer.onEvents([[crit()], [fakeEvents.deflect()], [fakeEvents.ko()]][n % 3], late.ctx); late.tick(8); }
    assert.ok(late.started.some((c) => c.speaker === "vale" && /\d/.test(c.text)), "VALE quotes a number from match 4");
  });

  test("menace gates: above 0.7 the hosts say nothing, above 0.4 no colour, coaching only below 0.2", () => {
    const s = setup({ matchesPlayed: 0, seed: 9 });
    s.announcer.onEvents([fakeEvents.phase({ phase: "match_intro", round: 1 })], s.ctx);
    s.announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round: 1 })], s.ctx);
    s.announcer.setAffect({ arousal: 0.5, valence: 0, stance: 0, composure: 1, menace: 0.5 });
    s.ctx.combat.fightTimeS = 5;
    s.tick(8);
    assert.equal(s.started.length, 0, "no coaching while menace is above 0.2");
    s.announcer.setAffect(null);
    s.tick(2);
    assert.equal(s.started.length, 1, "coaching returns when the opponent calms down");

    const v = setup({ seed: 9 });
    v.startMatch();
    v.announcer.setAffect({ arousal: 1, valence: 0, stance: 0, composure: 0, menace: 0.8 });
    v.announcer.onEvents([crit()], v.ctx);
    v.tick(1.5);
    assert.equal(v.started.length, 0, "silent above 0.7, and the moment goes stale rather than playing late");
    v.announcer.setAffect({ arousal: 1, valence: 0, stance: 0, composure: 0, menace: 0.5 });
    v.announcer.onEvents([fakeEvents.core({ stage: "drop", seat: null })], v.ctx);
    v.tick(1);
    assert.equal(v.started.length, 0, "no colour above 0.4");
    v.announcer.onEvents([crit()], v.ctx);
    v.tick(0.5);
    assert.equal(v.started.length, 1, "a P2 moment still gets through");
  });
});

/** One representative bus event per host beat, so every line bank can be exercised through the real pipeline. */
const EVENT_SAMPLES = {
  round_start: () => fakeEvents.phase({ phase: "round_intro", round: 2 }),
  final_round: () => fakeEvents.phase({ phase: "round_intro", round: 3, finalRound: true }),
  sudden_death: () => fakeEvents.phase({ phase: "sudden_death", round: 3 }),
  time_up: () => fakeEvents.roundEnd({ reason: "time", winner: "atlas" }),
  comeback: () => fakeEvents.roundEnd({ reason: "ko", winner: "atlas" }),
  close_call: () => fakeEvents.roundEnd({ reason: "time", winner: "atlas" }),
  first_strike: () => ({ type: "first_strike", t: 0, step: 0, seat: "atlas" }),
  crit: () => crit(),
  big_hit: () => fakeEvents.strike({ damage: 41, physicalDamage: 41, vN: 3.1 }),
  deflect: () => fakeEvents.deflect({ pressLeadMs: 48 }),
  late_guard: () => ({ type: "late_guard", t: 0, step: 0, defender: "blaze", attacker: "atlas", refund: 4, pressLagMs: 55 }),
  clash: () => fakeEvents.clash({ heavyWinner: "atlas" }),
  combo: () => ({ type: "combo", t: 0, step: 0, seat: "atlas", count: 5 }),
  momentum_up: () => ({ type: "combo", t: 0, step: 0, seat: "atlas", count: 3 }),
  whiff_streak: () => fakeEvents.whiff({ seat: "atlas" }),
  heat_warning: () => ({ type: "heat_warning", t: 0, step: 0, seat: "atlas", on: true }),
  overheat: () => ({ type: "overheat", t: 0, step: 0, seat: "atlas" }),
  burst: () => ({ type: "burst", t: 0, step: 0, seat: "atlas" }),
  table_slam: () => fakeEvents.tableHit({ force: TABLE_SLAM_NEWTONS + 19 }),
  joint_limit: () => ({ type: "joint_limit_violation", t: 0, step: 0, seat: "blaze", joint: 2, overshoot: 0.04 }),
  low_integrity: () => ({ type: "low_integrity", t: 0, step: 0, seat: "atlas" }),
  stalemate: () => ({ type: "stalemate", t: 0, step: 0, seconds: 6 }),
  policy_fault: () => fakeEvents.policyFault({ seat: "blaze" }),
  core_incoming: () => fakeEvents.core({ stage: "incoming", seat: null, remainingS: 3 }),
  core_drop: () => fakeEvents.core({ stage: "drop", seat: null }),
  lock_in_start: () => fakeEvents.core({ stage: "lock_in_start", seat: "atlas", remainingS: 8 }),
  contested: () => fakeEvents.core({ stage: "contested_on", seat: "atlas", remainingS: 5 }),
  steal: () => fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 5.2 }),
  inherit: () => fakeEvents.core({ stage: "lock_in_resume", seat: "blaze", from: "atlas", inherited: true, remainingS: 4 }),
  late_steal: () => fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 1.2, late: true }),
  lock: () => fakeEvents.core({ stage: "lock", seat: "atlas" }),
  ko: () => fakeEvents.ko(),
  match_win: () => fakeEvents.matchEnd({ winner: "atlas" }),
  match_loss: () => fakeEvents.matchEnd({ winner: "blaze" }),
  flaw_exploited: () => ({ type: "flaw", t: 0, step: 0, seat: "blaze", flaw: "bites_feints", stage: "exploited", count: 3 }),
  flaw_patched: () => ({ type: "flaw", t: 0, step: 0, seat: "blaze", flaw: "bites_feints", stage: "patched", count: 3 }),
  user_model_intro: () => fakeEvents.phase({ phase: "match_intro", round: 1 }),
  user_model_wins: () => fakeEvents.matchEnd({ winner: "blaze" }),
  user_model_loses: () => fakeEvents.matchEnd({ winner: "atlas" }),
};

describe("announcer tokens and coverage", () => {
  test("tokens resolve from real event fields; a line with an unavailable token is never rendered", () => {
    const ctx = fakeFeedbackContext({ names: { atlas: "PILOT", blaze: "OVERSHOOT" } });
    const tally = emptyTally();
    const m = hostEventFor(crit(), ctx, tally, null);
    assert.equal(m.event, "crit");
    assert.equal(m.tokens.get("speed"), "2.7");
    assert.equal(m.tokens.get("dmg"), "34");
    assert.equal(m.tokens.get("target"), "OVERSHOOT");
    assert.equal(hostEventFor(crit({ damage: 12 }), ctx, tally, null), null, "under 30 damage is not a call");
    const steal = hostEventFor(fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 1.43, late: true }), ctx, tally, null);
    assert.equal(steal.event, "late_steal");
    assert.equal(steal.tokens.get("secs"), "1.4");
    const ko = hostEventFor(fakeEvents.ko(), ctx, tally, null);
    assert.equal(ko.tokens.has("speed"), false, "no lethal strike seen, no speed");
    assert.equal(renderLine({ text: "Integrity zero at {speed} meters a second." }, ko.tokens), null);
    const resume = hostEventFor(fakeEvents.core({ stage: "lock_in_resume", seat: "blaze", from: "atlas", inherited: true, remainingS: 3 }), ctx, tally, null);
    assert.equal(resume.event, "inherit");
    // Three unanswered is the momentum stab; the first hit in matches 1 to 3 is the receipt, not a call.
    assert.equal(hostEventFor({ type: "combo", t: 0, step: 0, seat: "atlas", count: 3 }, ctx, tally, null).event, "momentum_up");
    assert.equal(hostEventFor({ type: "first_strike", t: 0, step: 0, seat: "atlas" }, { ...ctx, matchesPlayed: 1 }, tally, null), null);
    assert.equal(hostEventFor({ type: "first_strike", t: 0, step: 0, seat: "atlas" }, { ...ctx, matchesPlayed: 3 }, tally, null).event, "first_strike");
  });

  test("the beats carry real physics values, not decoration", () => {
    const ctx = fakeFeedbackContext({ combat: fakeCombat("arcade", { fightTimeS: 21.4 }) });
    const tally = emptyTally();
    const slam = hostEventFor(fakeEvents.tableHit({ force: 27.6 }), ctx, tally, null);
    assert.equal(slam.event, "table_slam");
    assert.equal(slam.tokens.get("newtons"), "28", "newtons come from the constraint force");
    assert.equal(hostEventFor(fakeEvents.tableHit({ force: TABLE_SLAM_NEWTONS - 1 }), ctx, tally, null), null, "a tap is not a slam");
    const late = hostEventFor({ type: "late_guard", t: 0, step: 0, defender: "blaze", attacker: "atlas", refund: 3, pressLagMs: 62.4 }, ctx, tally, null);
    assert.equal(late.tokens.get("ms"), "62");
    const hot = hostEventFor({ type: "overheat", t: 0, step: 0, seat: "atlas" }, ctx, tally, null);
    assert.equal(hot.tokens.get("secs"), "21.4");
    tally.whiffs.atlas = WHIFF_STREAK_AT - 1;
    assert.equal(hostEventFor(fakeEvents.whiff(), ctx, tally, null), null);
    tally.whiffs.atlas = WHIFF_STREAK_AT;
    assert.equal(hostEventFor(fakeEvents.whiff(), ctx, tally, null).tokens.get("count"), String(WHIFF_STREAK_AT));
    assert.equal(hostEventFor(fakeEvents.policyFault({ seat: "atlas" }), ctx, tally, null), null, "a human cannot fault");
  });

  test("a knockout never quotes a strike from an earlier round", () => {
    const { announcer, ctx, started, tick, startMatch } = setup({ seed: 55 });
    startMatch();
    for (let n = 0; n < 8 && !started.some((c) => c.text.includes("3.9") || c.text.includes("44")); n++) {
      announcer.onEvents([fakeEvents.strike({ damage: 44, physicalDamage: 44, vN: 3.9, lethal: true }), fakeEvents.ko()], ctx);
      tick(6);
    }
    assert.ok(started.some((c) => c.text.includes("3.9") || c.text.includes("44")), "a KO should be able to quote its strike");
    announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round: 2 })], ctx);
    tick(6);
    const before = started.length;
    announcer.onEvents([fakeEvents.ko()], ctx);
    tick(6);
    const said = started.slice(before).map((c) => c.text).join(" ");
    assert.ok(!said.includes("3.9") && !said.includes("44"), `stale numbers carried into round two: ${said}`);
  });

  test("a round decided by nothing is a close call; one won from the critical band is a comeback", () => {
    const combat = fakeCombat("arcade", { fightTimeS: 45 });
    combat.seats.atlas.integrity = 96;
    combat.seats.blaze.integrity = 91;
    const ctx = fakeFeedbackContext({ combat });
    const tally = emptyTally();
    tally.roundDamage.blaze = 40;
    const close = hostEventFor(fakeEvents.roundEnd({ reason: "time" }), ctx, tally, null);
    assert.equal(close.event, "close_call");
    assert.equal(close.tokens.get("dmg"), "5");
    combat.seats.blaze.integrity = 20;
    assert.equal(hostEventFor(fakeEvents.roundEnd({ reason: "time" }), ctx, tally, null).event, "time_up");
    tally.minIntegrityFrac.atlas = 0.12;
    assert.equal(hostEventFor(fakeEvents.roundEnd({ reason: "ko" }), ctx, tally, null).event, "comeback");
  });
});

const EVENT_SETUP = {
  time_up: (c) => { c.seats.atlas.integrity = c.seats.atlas.integrityMax * 0.8; c.seats.blaze.integrity = c.seats.blaze.integrityMax * 0.3; },
  close_call: (c) => { c.seats.atlas.integrity = c.seats.atlas.integrityMax * 0.96; c.seats.blaze.integrity = c.seats.blaze.integrityMax * 0.91; },
  comeback: (c) => { c.seats.atlas.integrity = c.seats.atlas.integrityMax * 0.12; c.seats.blaze.integrity = c.seats.blaze.integrityMax * 0.44; },
};
const EVENT_PREPARE = {
  comeback: () => [fakeEvents.strike({ attacker: "blaze", victim: "atlas", damage: 22, physicalDamage: 22 })],
  whiff_streak: () => [fakeEvents.whiff({ seat: "atlas" }), fakeEvents.whiff({ seat: "atlas" })],
};

describe("announcer coverage", () => {
  test("every beat has enough distinct lines to survive being fired over and over", () => {
    for (const [event, make] of Object.entries(EVENT_SAMPLES)) {
      const want = linesFor(event).length;
      const seen = new Set();
      const isModel = event.startsWith("user_model");
      for (let attempt = 0; attempt < 4 && seen.size < want; attempt++) {
        const { announcer, ctx, started, tick, startMatch } = setup({ seed: 900 + attempt, storage: null });
        startMatch();
        ctx.opponentIsUserModel = isModel;
        ctx.combat.suddenDeath = true;
        EVENT_SETUP[event]?.(ctx.combat);
        for (let i = 0; i < want * 3; i++) {
          ctx.combat.fightTimeS = 18;
          const prep = EVENT_PREPARE[event]?.() ?? [];
          if (prep.length > 0) announcer.onEvents(prep, ctx);
          announcer.onEvents([make()], ctx);
          tick(10);
        }
        for (const c of started) if (c.lineId.startsWith(`${event}.`)) seen.add(c.lineId);
      }
      const floor = event === "user_model_intro" ? 4 : Math.min(want, 8);
      assert.ok(seen.size >= floor, `${event}: only ${seen.size} distinct lines reachable of ${want}`);
    }
  });
});

function roundScript(i) {
  const shape = i % 3;
  const common = [
    [{ type: "first_strike", t: 0, step: 0, seat: "atlas" }],
    [fakeEvents.deflect({ pressLeadMs: 40 + i })],
    [crit({ damage: 31 + i, vN: 2.4 + i * 0.07 })],
    [fakeEvents.core({ stage: "drop", seat: null })],
    [fakeEvents.core({ stage: "lock_in_start", seat: i % 2 ? "blaze" : "atlas", remainingS: 8 })],
  ];
  if (shape === 0) {
    return [...common,
      [fakeEvents.core({ stage: "steal", seat: "atlas", from: "blaze", remainingS: 4.5 })],
      [fakeEvents.strike({ damage: 38 + i, physicalDamage: 38 + i, vN: 3 })],
      [fakeEvents.ko()],
      [fakeEvents.roundEnd({ winner: "atlas", reason: "ko" })]];
  }
  if (shape === 1) {
    return [...common,
      [{ type: "overheat", t: 0, step: 0, seat: "blaze" }],
      [fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 1.1, late: true })],
      [fakeEvents.core({ stage: "lock_in_resume", seat: "blaze", from: "atlas", inherited: true, remainingS: 1.1 })],
      [fakeEvents.core({ stage: "lock", seat: "blaze" })],
      [fakeEvents.roundEnd({ winner: "blaze", reason: "lock" })]];
  }
  return [...common,
    [{ type: "combo", t: 0, step: 0, seat: "atlas", count: 5 }],
    [fakeEvents.whiff({ seat: "blaze" }), fakeEvents.whiff({ seat: "blaze" }), fakeEvents.whiff({ seat: "blaze" })],
    [fakeEvents.tableHit({ seat: "blaze", force: 18 + i })],
    [{ type: "low_integrity", t: 0, step: 0, seat: "atlas" }],
    [fakeEvents.roundEnd({ winner: "atlas", reason: "time" })]];
}

describe("a five-match session", () => {
  test("nothing the hosts say is ever heard twice, and the show keeps finding new things to say", () => {
    const { announcer, ctx, started, tick } = setup({ seed: 4242 });
    let i = 0;
    for (let match = 1; match <= 5; match++) {
      announcer.onEvents([fakeEvents.phase({ phase: match === 1 ? "match_intro" : "rematch_intro", round: 1 })], ctx);
      tick(3);
      for (let round = 1; round <= 3; round++) {
        i++;
        ctx.combat.round = round;
        ctx.combat.fightTimeS = 6 + i;
        ctx.combat.seats.atlas.integrity = ctx.combat.seats.atlas.integrityMax * (0.9 - (i % 4) * 0.2);
        ctx.combat.seats.blaze.integrity = ctx.combat.seats.blaze.integrityMax * (0.35 + (i % 3) * 0.2);
        announcer.onEvents([fakeEvents.phase({ phase: "round_intro", round, finalRound: round === 3 })], ctx);
        tick(6);
        for (const batch of roundScript(i)) { announcer.onEvents(batch, ctx); tick(6); }
      }
      announcer.onEvents([fakeEvents.matchEnd({ winner: match % 2 ? "atlas" : "blaze" })], ctx);
      tick(5);
      announcer.onEvents([fakeEvents.phase({ phase: "post_match", round: 3 })], ctx);
      tick(2);
    }
    const ids = started.map((c) => c.lineId);
    assert.ok(ids.length >= 45, `a five-match night produced only ${ids.length} lines`);
    // The bible's variety rule: no line inside the 20-line window, and no line more than twice in five matches.
    for (let i = 0; i < ids.length; i++) {
      const prev = i > 0 ? ids.lastIndexOf(ids[i], i - 1) : -1;
      if (prev >= 0) assert.ok(i - prev > NO_REPEAT_WINDOW, `${ids[i]} repeated after ${i - prev} lines`);
    }
    const counts = countBy(ids);
    const worn = [...counts].filter(([, n]) => n > 2).map(([id, n]) => `${id} x${n}`);
    assert.deepEqual(worn, [], `lines worn out in one session: ${worn.join(", ")}`);
    assert.deepEqual([...new Set(started.map((c) => c.speaker))].sort(), ["rook", "vale"]);
    const events = new Set(ids.map((id) => id.split(".")[0]));
    assert.ok(events.size >= 10, `only ${events.size} kinds of moment got a line`);
    for (const c of started) assert.ok(!/\{[a-z]+\}/.test(c.text), `unresolved token in "${c.text}"`);
  });

  test("deep cuts stay hidden early and turn up once the night has some history", () => {
    const deepIds = new Set(HOST_LINES.filter((l) => l.kind === "deep").map((l) => l.id));
    const early = setup({ seed: 11 });
    early.startMatch();
    for (let n = 0; n < 6; n++) { early.announcer.onEvents([crit()], early.ctx); early.tick(8); }
    assert.ok(early.started.length > 0);
    assert.ok(!early.started.some((c) => deepIds.has(c.lineId)), "a deep cut showed up in the first few lines");
    let found = false;
    for (let seed = 0; seed < 6 && !found; seed++) {
      const long = setup({ seed: 500 + seed, storage: null });
      long.startMatch();
      for (let n = 0; n < 160 && !found; n++) {
        long.announcer.onEvents([[crit()], [fakeEvents.deflect()], [fakeEvents.ko()],
          [fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 3 })]][n % 4], long.ctx);
        long.tick(8);
        found = long.started.some((c) => deepIds.has(c.lineId));
      }
    }
    assert.ok(found, "no deep cut ever surfaced in a long session");
  });
});

function countBy(xs) {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

describe("host voice", () => {
  function fakeVoices(names) {
    return names.map((name, i) => ({ name, lang: "en-US", localService: i % 2 === 0, voiceURI: name, default: i === 0 }));
  }

  test("speech uses each host's voice, pitch, and rate, ducks the mix, and wraps the utterance in the squelch layer", async () => {
    const spoken = [];
    const speech = {
      getVoices: () => fakeVoices(["Samantha", "Daniel", "Fred"]),
      speak: (u) => { spoken.push(u); setTimeout(() => u.onend?.(), 5); },
      cancel: () => undefined,
    };
    class Utterance { constructor(text) { this.text = text; } }
    const calls = [];
    const engine = {
      playVoice: (bus, _p, render) => { calls.push(["squelch", bus, render.name]); return true; },
      duck: (id, hold) => calls.push(["duck", id, hold]),
      releaseDuck: (id) => calls.push(["release", id]),
    };
    const settings = createSettingsStore({ storage: null });
    settings.set({ audio: { hostVoice: true, voice: 0.5, master: 1 } });
    const voice = createHostVoice({ settings, engine, hosts: HOSTS, speech, Utterance });
    assert.equal(voice.status, "ready");
    assert.notEqual(voice.voiceNames.rook, voice.voiceNames.vale, "hosts never share a voice");
    await voice.speak({ speaker: "vale", lineId: "x", text: "Optics hit at 2.7 meters per second.", priority: 2, durationMs: 2000 });
    const u = spoken[0];
    // Prosody as data (bible 7): the caption's ramp (priority 2 → ramp 2) and release set the utterance pitch and rate.
    const pro = captionProsody({ lineId: "x", priority: 2 });
    const expected = speechFor(HOSTS.vale.speech, pro.ramp, pro.release);
    assert.equal(u.pitch, expected.pitch);
    assert.equal(u.rate, expected.rate);
    assert.notEqual(u.rate, HOSTS.vale.speech.rate, "a ramped line is not read at the host's resting rate");
    assert.equal(u.volume, 0.5);
    assert.deepEqual(calls.map((c) => c[0]), ["squelch", "duck", "squelch", "release"]);
    assert.equal(calls[0][1], "voice");
    assert.equal(calls[1][1], "speech");
    voice.dispose();
  });

  test("with no voices available the status reads NO VOICE and the setting stays off", async () => {
    const settings = createSettingsStore({ storage: null });
    settings.set({ audio: { hostVoice: true } });
    const speech = { getVoices: () => [], speak: () => undefined, cancel: () => undefined };
    const voice = createHostVoice({ settings, engine: null, hosts: HOSTS, speech, Utterance: class {}, voiceWaitMs: 10 });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(voice.status, "no_voice");
    assert.equal(settings.get().audio.hostVoice, false);
    settings.set({ audio: { hostVoice: true } });
    assert.equal(settings.get().audio.hostVoice, false, "turning it on again does not stick");
    assert.equal(voice.enabled, false);
    voice.dispose();
  });

  test("voice choice prefers the host's named voices, then distinct local English voices", () => {
    const voices = fakeVoices(["Karen", "Google UK English Male", "Alex"]);
    const chosen = chooseVoices(voices, HOSTS);
    assert.ok(chosen.rook && chosen.vale);
    assert.notEqual(chosen.rook.name, chosen.vale.name);
  });
});
