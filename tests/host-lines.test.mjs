// WP3 host line bank (BUILD_PLAN D9, 4 WP3.11): copy rules for ROOK and DR. VALE, variant counts, token vocabulary,
// the rare deep-cut tier, and the checks that stop the bank drifting into templated filler.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BANNED_WORDS, DEEP_CUT_AFTER_LINES, DEEP_CUT_CHANCE, EVENT_CLASS, EVENT_PRIORITY, HOST_LINES, LINE_EVENTS, NO_NUMBER_EVENTS,
  NUMBER_TOKENS, ONE_HOST_EVENTS, hasNumberToken, lineTokens, linesFor, wordCount,
} from "../src/game/announcer/lines.ts";

const KNOWN_TOKENS = new Set(["actor", "target", "round", "count", "file", ...NUMBER_TOKENS]);

/** Beats that fire most rounds. These need enough copy that a five-match night never loops. */
const FREQUENT = ["round_start", "crit", "big_hit", "deflect", "steal", "inherit", "lock", "late_steal", "ko",
  "core_drop", "lock_in_start", "match_win", "match_loss"];

/** The bare shape of a line: tokens and specifics removed, so two lines that differ only by noun collide. */
function shape(text) {
  return text.toLowerCase().replace(/\{[a-z]+\}/g, "*").replace(/[^a-z* ]/g, "").trim();
}

describe("host lines", () => {
  test("every line is at most 9 words, with a token counting as one word", () => {
    for (const l of HOST_LINES) assert.ok(wordCount(l.text) <= 9, `${l.id}: "${l.text}" has ${wordCount(l.text)} words`);
  });

  test("no exclamation marks except at most one in a ROOK line of a P1 event", () => {
    for (const l of HOST_LINES) {
      const n = (l.text.match(/!/g) ?? []).length;
      if (n === 0) continue;
      assert.equal(l.speaker, "rook", `${l.id} is not ROOK`);
      assert.equal(EVENT_PRIORITY[l.event], 1, `${l.id} is not a P1 event`);
      assert.equal(n, 1, `${l.id} has ${n} exclamation marks`);
    }
  });

  test("no banned words or self-correction gags", () => {
    for (const l of HOST_LINES) {
      const lower = l.text.toLowerCase();
      for (const w of BANNED_WORDS) {
        const re = new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`);
        assert.ok(!re.test(lower), `${l.id} uses "${w}"`);
      }
      assert.ok(!/\b\w+er,\s+(i mean|or rather|sorry|well)\b/.test(lower) && !/\.\.\./.test(lower), `${l.id} looks like an "-er, X" self-correction gag`);
    }
  });

  test("ROOK never carries a number token or a digit; at least 60% of VALE lines carry a real number token", () => {
    // Coaching and the crowd meter carry no number by design (EMOTION_BIBLE 7); everything else VALE says is telemetry.
    const vale = HOST_LINES.filter((l) => l.speaker === "vale" && !NO_NUMBER_EVENTS.includes(l.event));
    for (const l of HOST_LINES.filter((x) => x.speaker === "rook")) {
      assert.equal(hasNumberToken(l.text), false, `${l.id} carries a number`);
      assert.ok(!/\d/.test(l.text), `${l.id} has a digit`);
    }
    const numeric = vale.filter((l) => hasNumberToken(l.text)).length / vale.length;
    assert.ok(numeric >= 0.6, `VALE numeric share ${numeric}`);
  });

  test("every event gives DR. VALE at least two lines that quote a measurement", () => {
    const thin = [];
    for (const event of LINE_EVENTS) {
      if (NO_NUMBER_EVENTS.includes(event) || ONE_HOST_EVENTS.includes(event)) continue;
      const numeric = linesFor(event, "vale").filter((l) => hasNumberToken(l.text)).length;
      if (numeric < 2) thin.push(`${event}: ${numeric}`);
    }
    assert.deepEqual(thin, [], `events without two numeric VALE lines: ${thin.join(", ")}`);
  });

  test("every P1/P2 event has >= 8 variants split across both hosts; every P3 event >= 4", () => {
    for (const [event, priority] of Object.entries(EVENT_PRIORITY)) {
      const all = linesFor(event);
      const rook = linesFor(event, "rook").length;
      const vale = linesFor(event, "vale").length;
      assert.ok(all.length >= (priority <= 2 ? 8 : 4), `${event}: ${all.length} variants`);
      if (ONE_HOST_EVENTS.includes(event)) assert.ok(all.length >= 4, `${event}: one-host beat with ${all.length} lines`);
      else assert.ok(rook >= 2 && vale >= 2, `${event}: split ${rook}/${vale}`);
    }
  });

  test("every event class carries at least 12 variants (EMOTION_BIBLE 7: 12 per class, 20-line no-repeat window)", () => {
    const perClass = new Map();
    for (const l of HOST_LINES) perClass.set(EVENT_CLASS[l.event], (perClass.get(EVENT_CLASS[l.event]) ?? 0) + 1);
    for (const event of LINE_EVENTS) assert.ok(EVENT_CLASS[event], `${event} has no class`);
    const thin = [...perClass].filter(([, n]) => n < 12).map(([c, n]) => `${c}: ${n}`);
    assert.deepEqual(thin, [], `classes under 12 variants: ${thin.join(", ")}`);
  });

  test("coaching is VALE's alone and never quotes a number; chaos is ROOK's clip caption", () => {
    for (const event of ["coach_passive", "coach_turtle", "coach_whiff", "coach_guard"]) {
      assert.equal(linesFor(event, "rook").length, 0, `${event} has a ROOK line`);
      assert.ok(linesFor(event, "vale").length >= 8, `${event}: ${linesFor(event, "vale").length} coaching lines`);
      for (const l of linesFor(event)) assert.equal(hasNumberToken(l.text), false, `${l.id} coaches with a number`);
    }
    assert.ok(linesFor("chaos", "rook").some((l) => /going on the show/i.test(l.text)), "ROOK's one chaos caption exists");
  });

  test("the beats that fire every round carry at least 14 variants each", () => {
    for (const event of FREQUENT) {
      const n = linesFor(event).length;
      assert.ok(n >= 14, `${event}: ${n} variants is not enough for a long session`);
      assert.ok(linesFor(event, "rook").length >= 5 && linesFor(event, "vale").length >= 5, `${event}: lopsided split`);
    }
  });

  test("priorities and banks agree: no event without copy, no copy without a priority", () => {
    for (const event of LINE_EVENTS) assert.ok(EVENT_PRIORITY[event], `${event} has copy but no priority`);
    for (const event of Object.keys(EVENT_PRIORITY)) assert.ok(linesFor(event).length > 0, `${event} has a priority but no copy`);
  });

  test("tokens come from the known vocabulary, ids are unique, and jokes live only in P1 banks", () => {
    const ids = new Set();
    for (const l of HOST_LINES) {
      assert.ok(!ids.has(l.id), `duplicate id ${l.id}`);
      ids.add(l.id);
      for (const t of lineTokens(l)) assert.ok(KNOWN_TOKENS.has(t), `${l.id} uses unknown token {${t}}`);
      if (l.kind === "joke") assert.equal(EVENT_PRIORITY[l.event], 1, `${l.id} joke outside P1`);
      assert.ok(/[.!?]$/.test(l.text), `${l.id} ends without punctuation`);
      assert.equal(l.text, l.text.trim());
    }
    const jokes = HOST_LINES.filter((l) => l.kind === "joke").length;
    assert.ok(jokes / HOST_LINES.length <= 0.1);
  });

  test("deep cuts exist, stay rare, and are spread across the show", () => {
    const deep = HOST_LINES.filter((l) => l.kind === "deep");
    assert.ok(deep.length >= 12, `${deep.length} deep cuts is not a reward`);
    assert.ok(deep.length / HOST_LINES.length <= 0.08, "deep cuts are not supposed to be common");
    const events = new Set(deep.map((l) => l.event));
    assert.ok(events.size >= 10, `deep cuts only cover ${events.size} events`);
    assert.ok(deep.some((l) => l.speaker === "rook") && deep.some((l) => l.speaker === "vale"), "both hosts need one");
    assert.ok(DEEP_CUT_AFTER_LINES >= 20 && DEEP_CUT_CHANCE > 0 && DEEP_CUT_CHANCE < 0.5);
  });

  test("no line is repeated anywhere in the bank, and no two share a sentence shape", () => {
    const seen = new Map();
    for (const l of HOST_LINES) {
      const prev = seen.get(l.text);
      assert.equal(prev, undefined, `${l.id} repeats the text of ${prev}`);
      seen.set(l.text, l.id);
    }
    // Within one host's bank for one event, two lines that reduce to the same shape are the same line twice.
    for (const event of LINE_EVENTS) {
      for (const speaker of ["rook", "vale"]) {
        const shapes = new Map();
        for (const l of linesFor(event, speaker)) {
          const k = shape(l.text);
          assert.equal(shapes.get(k), undefined, `${l.id} has the same shape as ${shapes.get(k)}`);
          shapes.set(k, l.id);
        }
      }
    }
  });

  test("sentence shape varies inside a bank: no host opens two lines the same way", () => {
    const flat = [];
    for (const event of LINE_EVENTS) {
      for (const speaker of ["rook", "vale"]) {
        const lines = linesFor(event, speaker);
        const openers = new Map();
        for (const l of lines) {
          const opener = shape(l.text).split(" ").slice(0, 2).join(" ");
          const n = (openers.get(opener) ?? 0) + 1;
          openers.set(opener, n);
          if (n === 3) flat.push(`${event}/${speaker}: three lines open with "${opener}"`);
        }
        if (lines.length >= 5) {
          // A bank whose lines are all the same length is a template with the nouns swapped.
          const lengths = new Set(lines.map((l) => wordCount(l.text)));
          if (lengths.size < 3) flat.push(`${event}/${speaker}: ${lengths.size} lengths`);
        }
      }
    }
    assert.deepEqual(flat, [], `banks with too little length variety: ${flat.join(", ")}`);
  });

  test("the vocabulary is ours: steals, never pries; no reference-game names", () => {
    for (const l of HOST_LINES) {
      const lower = l.text.toLowerCase();
      assert.ok(!/\bpr(y|ied|ies)\b/.test(lower), `${l.id} says pry`);
      assert.ok(!/cash(out|-out| out)|the finals|embark|scotty|june\b/.test(lower), `${l.id} borrows reference vocabulary`);
    }
  });
});
