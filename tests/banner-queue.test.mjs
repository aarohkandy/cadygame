// WP7: banner arbitration (GAME_DESIGN 7.1.3): one at a time, 250 ms gap, stale after 1.5 s, celebration outranks impact.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BANNER_EXIT_MS, BANNER_GAP_MS, BANNER_STALE_MS, CALLOUT_HOLD_MS, CALLOUT_READ_MS, createBannerQueue, createCalloutSlot } from "../src/game/ui/hud/banner-queue.ts";
import { KIT_HOLD_MS, TAG_LIFE_MS, TAG_SLOTS, createKitStrip, createTagSlots } from "../src/game/ui/hud/hud-runtime.ts";

const banner = (kind, tier = "impact", holdMs = 800) => ({ kind, title: kind.toUpperCase(), sub: null, sticker: null, tier, team: null, holdMs });

describe("banner queue", () => {
  test("constants match the design", () => {
    assert.equal(BANNER_GAP_MS, 250);
    assert.equal(BANNER_STALE_MS, 1500);
    assert.equal(BANNER_EXIT_MS, 140);
  });

  test("shows one banner at a time with a 250 ms gap between them", () => {
    const q = createBannerQueue();
    q.push(banner("time", "impact", 500), 0);
    q.push(banner("round_to", "impact", 500), 10);
    q.update(0);
    assert.equal(q.current?.kind, "time");
    assert.equal(q.pending, 1);
    q.update(400);
    assert.equal(q.current?.kind, "time", "holds for its full duration");
    q.update(500);
    assert.equal(q.current, null, "ends at 500 ms");
    assert.equal(q.exiting?.kind, "time");
    q.update(749);
    assert.equal(q.current, null, "still inside the gap");
    q.update(750);
    assert.equal(q.current?.kind, "round_to");
  });

  test("drops a queued banner older than 1.5 s", () => {
    const q = createBannerQueue();
    q.push(banner("time", "impact", 1600), 0);
    q.push(banner("stolen"), 100);
    q.update(0);
    q.update(1600);
    q.update(1850);
    assert.equal(q.current, null, "STOLEN waited 1750 ms and was dropped");
    assert.equal(q.pending, 0);
  });

  test("a celebration banner ends an impact banner at once and jumps the queue", () => {
    const q = createBannerQueue();
    q.push(banner("stolen", "impact", 800), 0);
    q.push(banner("round_to", "impact", 800), 0);
    q.update(0);
    assert.equal(q.current?.kind, "stolen");
    const rev = q.revision;
    q.push(banner("knockout", "celebration", 1100), 200);
    assert.equal(q.current, null);
    assert.equal(q.exiting?.kind, "stolen");
    q.update(200);
    assert.equal(q.current?.kind, "knockout", "no gap for an outranking banner");
    assert.ok(q.revision > rev);
    assert.equal(q.pending, 1, "the queued impact banner waits behind it");
  });

  test("a celebration never gets pre-empted by an impact banner", () => {
    const q = createBannerQueue();
    q.push(banner("locked", "celebration", 1000), 0);
    q.update(0);
    q.push(banner("time"), 100);
    q.update(100);
    assert.equal(q.current?.kind, "locked");
  });

  test("exiting clears after the exit animation and clear() empties everything", () => {
    const q = createBannerQueue();
    q.push(banner("time", "impact", 100), 0);
    q.update(0);
    q.update(100);
    assert.equal(q.exiting?.kind, "time");
    assert.equal(q.update(100 + BANNER_EXIT_MS), true);
    assert.equal(q.exiting, null);
    q.push(banner("stolen"), 300);
    q.clear();
    q.update(1000);
    assert.equal(q.current, null);
    assert.equal(q.pending, 0);
  });
});

describe("centre tag slots", () => {
  test("two different tags take the two slots", () => {
    const t = createTagSlots();
    assert.deepEqual(t.push("DEFLECT", "block", 0), { index: 0, repeat: false });
    assert.deepEqual(t.push("CLASH", "neutral", 100), { index: 1, repeat: false });
    assert.equal(t.slots[0].label, "DEFLECT");
    assert.equal(t.slots[1].label, "CLASH");
  });

  test("a repeat re-pops the tag already up instead of filling the second slot", () => {
    const t = createTagSlots();
    t.push("STAGGERED", "neutral", 0);
    const rev = t.slots[0].revision;
    const again = t.push("STAGGERED", "neutral", 300);
    assert.deepEqual(again, { index: 0, repeat: true }, "the same word never appears twice at once");
    assert.equal(t.slots[0].revision, rev + 1, "re-popped");
    assert.equal(t.slots[0].until, 300 + TAG_LIFE_MS, "and its life restarts from the second event");
    assert.equal(t.slots[1].label, "", "the other slot is still free for something that says a different thing");
  });

  test("the same word again after it has cleared is a new tag, not a repeat", () => {
    const t = createTagSlots();
    t.push("BURST", "team-atlas", 0);
    t.expire(TAG_LIFE_MS);
    assert.equal(t.push("BURST", "team-atlas", TAG_LIFE_MS + 1).repeat, false);
  });

  test("a third tag takes the slot that expires soonest", () => {
    const t = createTagSlots();
    t.push("DEFLECT", "block", 0);
    t.push("CLASH", "neutral", 200);
    assert.deepEqual(t.push("BLOCKED", "block", 300), { index: 0, repeat: false }, "the oldest goes first");
    assert.equal(t.slots[1].label, "CLASH", "the newer one is left alone");
  });

  test("expire reports exactly which slots cleared, once", () => {
    const t = createTagSlots();
    t.push("DEFLECT", "block", 0);
    t.push("CLASH", "neutral", 400);
    assert.equal(t.expire(TAG_LIFE_MS - 1), 0);
    assert.equal(t.expire(TAG_LIFE_MS), 1, "slot 0 only");
    assert.equal(t.expire(TAG_LIFE_MS), 0, "a cleared slot is not reported twice");
    assert.equal(t.expire(400 + TAG_LIFE_MS), 2, "slot 1");
    assert.equal(TAG_SLOTS, 2);
  });

  test("a new round clears the centre", () => {
    const t = createTagSlots();
    t.push("STAGGERED", "neutral", 0);
    t.clear();
    assert.equal(t.slots[0].label, "");
    assert.equal(t.expire(1), 0, "nothing left to report");
  });
});

describe("kinetic callouts", () => {
  const c = (kind, word = kind.toUpperCase()) => ({ kind, word, sub: null, tone: "neutral" });

  test("one at a time; a same-rank callout waits until the one up has been read", () => {
    const s = createCalloutSlot();
    assert.equal(s.push(c("crit"), 0), true);
    assert.equal(s.push(c("crit"), CALLOUT_READ_MS - 1), false, "too soon: dropped, not queued");
    assert.equal(s.current.kind, "crit");
    assert.equal(s.push(c("deflect"), 10), true, "a higher rank replaces at once");
    assert.equal(s.push(c("crit"), 20), false, "a lower rank never cuts in");
    assert.equal(s.push(c("streak"), 10 + CALLOUT_READ_MS), true, "same rank once read");
  });

  test("times out after the hold and clears on demand", () => {
    const s = createCalloutSlot();
    s.push(c("first_strike"), 0);
    const rev = s.revision;
    assert.equal(s.update(CALLOUT_HOLD_MS - 1), false);
    assert.equal(s.update(CALLOUT_HOLD_MS), true);
    assert.equal(s.current, null);
    assert.equal(s.revision, rev + 1);
    s.push(c("crit"), CALLOUT_HOLD_MS);
    s.clear();
    assert.equal(s.current, null);
  });
});

describe("kit strip", () => {
  test("comes up on news, holds, and stays while a live state needs watching", () => {
    const k = createKitStrip();
    assert.equal(k.update("snap|2|true|open|cool", false, 0), true, "first content is news");
    assert.equal(k.update("snap|2|true|open|cool", false, KIT_HOLD_MS - 1), true);
    assert.equal(k.update("snap|2|true|open|cool", false, KIT_HOLD_MS), false, "an idle fight shows nothing");
    assert.equal(k.update("snap|2|true|closed|cool", false, KIT_HOLD_MS), true, "the grip closing is news");
    assert.equal(k.update("snap|2|true|closed|hot", true, 10 * KIT_HOLD_MS), true, "a hot arm keeps it up");
    assert.equal(k.update("snap|2|true|closed|warm", false, 20 * KIT_HOLD_MS), true, "cooling off is news");
    assert.equal(k.update("snap|2|true|closed|warm", false, 21 * KIT_HOLD_MS), false);
    k.clear();
    assert.equal(k.update("snap|2|true|closed|warm", false, 22 * KIT_HOLD_MS), true, "a new match shows the loadout once");
  });
});
