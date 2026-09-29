import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { buildEpisodeMeta, buildMatchConfig } from "../src/game/match/match-config.ts";
import { createEpisodeStore as createBrowserStore, createEpisodeStoreOn, EpisodeNotFoundError, estimateEpisodeBytes } from "../src/game/harness/episode-store.ts";
import { createEpisodeStore as createFsStore } from "../src/game/harness/episode-store-fs.ts";
import { createMemoryBackend } from "../src/game/harness/idb.ts";
import { EpisodeFormatError, encodeEpisodeText } from "../src/game/harness/episode-format.ts";
import { SEGMENTS_COLUMN } from "../src/game/harness/recorder.ts";
import { bytesEqual } from "../src/game/harness/typed-b64.ts";
import { fakeModelInfo } from "../src/game/testing/fakes.ts";

const PROV = { tuning: null, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "", harnessCommit: "dev", userAgent: "test" };

function makeEpisode({ id, created = "2026-09-16T12:00:00.000Z", human = false, preset = "harness", rows = 100, winner = "atlas" }) {
  const cfg = buildMatchConfig({
    preset, context: human ? "quick" : "lab", seed: 1, bestOf: 1, now: new Date(created),
    seats: {
      atlas: { driver: human ? { kind: "human" } : { kind: "module", fileName: "a.mjs", source: "a", sha256: "a".repeat(64) } },
      blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } },
    },
  });
  const facts = { atlas: { name: human ? "PILOT" : "a.mjs", sha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", inputDevice: human ? "keyboard_mouse" : null },
    blaze: { name: "BACKLASH", sha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", inputDevice: null } };
  const meta = buildEpisodeMeta(cfg, fakeModelInfo(), facts, { atlas: null, blaze: null }, PROV, new Date(created));
  meta.episodeId = id;
  return {
    meta: { ...meta, result: { winner, roundsWon: { atlas: 1, blaze: 0 }, rounds: [{ round: 1, winner, reason: "ko", tEnd: 20 }], forfeit: null, determinism: "unchecked", error: null } },
    columns: { timestamp: new Float64Array(rows).map((_, i) => i / 50), frame_index: new Uint32Array(rows).map((_, i) => i), phase: new Uint8Array(rows).fill(6) },
    shapes: { timestamp: [], frame_index: [], phase: [] },
    steps: { ctrl: { steps: new Uint32Array([0]), values: new Float64Array(12), width: 12 }, intents: { steps: new Uint32Array([0]), values: new Uint8Array(2), width: 2 }, mutations: [], checkpoints: [] },
    sparse: { [SEGMENTS_COLUMN]: [] },
    events: [{ type: "phase", t: 0, step: 0, phase: "fight", round: 1, finalRound: false }],
  };
}

describe("episode store (IndexedDB semantics over the memory backend)", () => {
  test("save, list newest first with summaries, load by structured clone, pin, remove", async () => {
    const store = createEpisodeStoreOn(createMemoryBackend());
    const a = makeEpisode({ id: "ep-a", created: "2026-09-16T10:00:00.000Z" });
    const b = makeEpisode({ id: "ep-b", created: "2026-09-16T11:00:00.000Z", human: true, preset: "arcade", winner: "blaze" });
    assert.equal(await store.save(a), "ep-a");
    assert.equal(await store.save(b), "ep-b");
    const list = await store.list();
    assert.deepEqual(list.map((s) => s.id), ["ep-b", "ep-a"]);
    const sb = list[0];
    assert.deepEqual(sb.names, { atlas: "PILOT", blaze: "BACKLASH" });
    assert.equal(sb.human, true);
    assert.equal(sb.verdict, "arcade");
    assert.equal(sb.winner, "blaze");
    assert.equal(sb.durationS, 2);
    assert.equal(sb.bytes, estimateEpisodeBytes(b));
    assert.equal("store" in sb, false);
    assert.equal(list[1].verdict, "cleared");

    const loaded = await store.load("ep-a");
    assert.notEqual(loaded, a);
    assert.ok(loaded.columns.timestamp instanceof Float64Array);
    assert.ok(bytesEqual(loaded.columns.timestamp, a.columns.timestamp));

    await store.pin("ep-a", true);
    assert.equal((await store.list()).find((s) => s.id === "ep-a").pinned, true);
    await store.save(a);   // re-saving keeps the pin
    assert.equal((await store.list()).find((s) => s.id === "ep-a").pinned, true);

    await store.remove("ep-a");
    await assert.rejects(store.load("ep-a"), EpisodeNotFoundError);
    await store.remove("ep-a");   // idempotent
    const info = await store.storage();
    assert.equal(info.otherBytes, 0);
    assert.equal(info.humanBytes, estimateEpisodeBytes(b));
  });

  test("export and import round-trip through the JSON codec; a broken file is a named error", async () => {
    const store = createEpisodeStoreOn(createMemoryBackend());
    const ep = makeEpisode({ id: "ep-x" });
    await store.save(ep);
    const blob = await store.exportBlob("ep-x");
    assert.equal(blob.type, "application/json");
    const other = createEpisodeStoreOn(createMemoryBackend());
    assert.equal(await other.importFile(blob), "ep-x");
    const back = await other.load("ep-x");
    assert.ok(bytesEqual(back.columns.frame_index, ep.columns.frame_index));
    assert.equal((await other.list()).length, 1);
    await assert.rejects(other.importFile(new Blob(['{"format":"torquelimit.episode/2"}'])), (e) => e instanceof EpisodeFormatError && e.code === "wrong_format");
  });

  test("the browser factory never touches IndexedDB at construction and works where it is missing", async () => {
    const store = createBrowserStore("indexeddb");
    assert.deepEqual(await store.list(), []);
    assert.throws(() => createBrowserStore({ fsRoot: "/tmp" }), /episode-store-fs/);
  });
});

describe("episode store over a directory (eval CLI)", () => {
  test("writes .tlep.json files plus an index, and survives a new store instance", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tl-store-"));
    try {
      const store = createFsStore({ fsRoot: dir });
      assert.deepEqual(await store.list(), []);
      assert.deepEqual(await readdir(dir), [], "listing writes nothing");
      const ep = makeEpisode({ id: "2026-09-16T12:00:00.000Z-beef" });
      await store.save(ep);
      const files = (await readdir(dir)).sort();
      assert.deepEqual(files, ["2026-09-16T12-00-00.000Z-beef.tlep.json", "torquelimit-index.json"]);
      assert.equal(await readFile(path.join(dir, files[0]), "utf8"), encodeEpisodeText(ep));
      const reopened = createFsStore({ fsRoot: dir });
      const list = await reopened.list();
      assert.equal(list[0].id, ep.meta.episodeId);
      const back = await reopened.load(ep.meta.episodeId);
      assert.ok(bytesEqual(back.columns.timestamp, ep.columns.timestamp));
      await reopened.remove(ep.meta.episodeId);
      assert.deepEqual((await readdir(dir)).sort(), ["torquelimit-index.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
