import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EPISODE_CAP_BYTES, EvictionDeclinedError, HUMAN_CAP_BYTES, HUMAN_WARNING, HUMAN_WARN_BYTES, StorageFullError, createEpisodeStoreOn, createUploadQueue, planEviction,
} from "../src/game/harness/episode-store.ts";
import { createMemoryBackend } from "../src/game/harness/idb.ts";
import { SEGMENTS_COLUMN } from "../src/game/harness/recorder.ts";

const MB = 1024 * 1024;

/** Minimal valid episode: the store only reads meta, row count, and the seats' driver kinds. */
function makeEpisode({ id, created = "2026-09-01T00:00:00.000Z", human = false }) {
  const seat = (driver, name) => ({ driver, name, loadout: "pivot", policySha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", decisionHz: 25, chunkExecute: "until_next_decision", temporalEnsembleM: null, inputDevice: null });
  return {
    meta: {
      format: "torquelimit.episode/4", episodeId: id, created, controlHz: 50, timestep: 0.005, seed: 1, seedStreams: {},
      preset: "harness", physics: "harness", scoring: "physical", timing: human ? "live" : "eval", actionDelayTicks: 1, fairDelayMs: 0, strictLimits: false,
      seats: { atlas: seat(human ? "human" : "builtin", "A"), blaze: seat("builtin", "B") }, inputShaping: { atlas: null, blaze: null },
      rules: { roundLengthS: 45, bestOf: 1 }, tuning: null, tuningSha256: "", servoParamsHash: "", tolerances: {},
      provenance: { mujoco: "", modelFile: "", modelSha256: "", so101Sha256: "", harnessCommit: "", userAgent: "", contracts: "3.0.0", obsSchemaHash: "" },
      result: { winner: "atlas", roundsWon: { atlas: 1, blaze: 0 }, rounds: [], forfeit: null, determinism: "unchecked", error: null },
    },
    columns: { timestamp: new Float64Array(1), frame_index: new Uint32Array(1) }, shapes: {},
    steps: { ctrl: { steps: new Uint32Array(0), values: new Float64Array(0), width: 12 }, intents: { steps: new Uint32Array(0), values: new Uint8Array(0), width: 2 }, mutations: [], checkpoints: [] },
    sparse: { [SEGMENTS_COLUMN]: [] }, events: [],
  };
}

/** Episodes carry their simulated size in the id so the fill costs no real memory. */
function storeWithSizes() {
  return createEpisodeStoreOn(createMemoryBackend(), { sizeOf: (ep) => Number(ep.meta.episodeId.split(":")[1]) * MB });
}

const at = (i) => new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString();

describe("storage cap and eviction (1 GB for non-human episodes)", () => {
  test("a 1.1 GB simulated fill asks before evicting, evicts the oldest unpinned, and never a human episode", async () => {
    const store = storeWithSizes();
    // 3 human episodes of 20 MB (never counted against the 1 GB cap), then 100 MB non-human episodes.
    for (let i = 0; i < 3; i++) await store.save(makeEpisode({ id: `human${i}:20`, created: at(i), human: true }));
    for (let i = 0; i < 10; i++) await store.save(makeEpisode({ id: `bot${i}:100`, created: at(10 + i) }));
    await store.pin("bot0:100", true);
    let info = await store.storage();
    assert.equal(info.otherBytes, 1000 * MB);
    assert.equal(info.humanBytes, 60 * MB);
    assert.equal(info.capBytes, EPISODE_CAP_BYTES);
    assert.equal(info.wouldEvict(74 * MB), 1, "1024 MB cap: 1000 + 74 needs one eviction");

    const asked = [];
    // Declined: nothing changes and the error names the count for the WILL EVICT N prompt.
    await assert.rejects(store.save(makeEpisode({ id: "bot10:100", created: at(30) }), { confirmEvict: async (n) => { asked.push(n); return false; } }),
      (e) => e instanceof EvictionDeclinedError && e.count === 1 && e.label === "WILL EVICT 1");
    // No callback at all never evicts silently.
    await assert.rejects(store.save(makeEpisode({ id: "bot10:100", created: at(30) })), EvictionDeclinedError);
    assert.equal((await store.list()).length, 13);

    await store.save(makeEpisode({ id: "bot10:100", created: at(30) }), { confirmEvict: async (n) => { asked.push(n); return true; } });
    assert.deepEqual(asked, [1, 1]);
    const ids = (await store.list()).map((s) => s.id);
    assert.ok(ids.includes("bot0:100"), "pinned survives");
    assert.ok(!ids.includes("bot1:100"), "oldest unpinned evicted");
    for (let i = 0; i < 3; i++) assert.ok(ids.includes(`human${i}:20`));

    // Pile on: 1.1 GB of further non-human saves keeps humans and the pin, stays under the cap.
    for (let i = 0; i < 11; i++) await store.save(makeEpisode({ id: `late${i}:100`, created: at(40 + i) }), { confirmEvict: async () => true });
    info = await store.storage();
    assert.ok(info.otherBytes <= EPISODE_CAP_BYTES);
    assert.equal(info.humanBytes, 60 * MB);
    const after = (await store.list()).map((s) => s.id);
    assert.ok(after.includes("bot0:100"));
    for (let i = 0; i < 3; i++) assert.ok(after.includes(`human${i}:20`));
  });

  test("9: human episodes cap at 200 MB for local too, the oldest unpinned going silently, with one toast at 150 MB", async () => {
    const store = storeWithSizes();
    for (let i = 0; i < 7; i++) await store.save(makeEpisode({ id: `h${i}:20`, created: at(i), human: true }));
    let info = await store.storage();
    assert.equal(info.humanCapBytes, HUMAN_CAP_BYTES);
    assert.equal(info.humanBytes, 140 * MB);
    assert.equal(info.humanWarning, null, "under 150 MB: no toast");
    await store.save(makeEpisode({ id: "h7:20", created: at(7), human: true }));
    info = await store.storage();
    assert.ok(info.humanBytes >= HUMAN_WARN_BYTES);
    assert.equal(info.humanWarning, HUMAN_WARNING, "the toast names EXPORT");
    assert.equal((await store.storage()).humanWarning, null, "once");
    await store.pin("h0:20", true);
    for (let i = 8; i < 12; i++) await store.save(makeEpisode({ id: `h${i}:20`, created: at(i), human: true }));
    info = await store.storage();
    assert.ok(info.humanBytes <= HUMAN_CAP_BYTES, `${info.humanBytes / MB} MB of matches`);
    const ids = (await store.list()).map((s) => s.id);
    assert.ok(ids.includes("h0:20"), "pinned survives");
    assert.ok(!ids.includes("h1:20") && !ids.includes("h2:20"), "the oldest unpinned went first");
    assert.ok(ids.includes("h11:20"));
    assert.deepEqual(store.lastHumanEvictions.length > 0, true);
    await assert.rejects(store.save(makeEpisode({ id: "huge:300", created: at(30), human: true })), StorageFullError);
    // After a 202 the receiver has them: keep the 20 most recent, drop older uploaded ones.
    for (let i = 12; i < 40; i++) await store.save(makeEpisode({ id: `h${i}:2`, created: at(i), human: true }));
    const before = (await store.list()).filter((s) => s.human).length;
    const dropped = await store.pruneUploaded((await store.list()).map((s) => s.id), 20);
    assert.ok(dropped.length > 0 && before - dropped.length === 20 + 1, "20 kept plus the pinned one");
  });

  test("9: the upload queue keeps gzip bodies in IndexedDB, refuses over 16 MB, and removes only what got a 202", async () => {
    const backend = createMemoryBackend();
    const q = createUploadQueue(backend, { maxBytes: 4096 });
    const ep = makeEpisode({ id: "up:1", human: true });
    const item = await q.enqueue(ep);
    assert.ok(item && item.bytes > 0 && item.bytes <= 4096 && item.scope === "share");
    assert.equal((await q.pending()).length, 1);
    ep.columns.timestamp = new Float64Array(200000).map((_v, i) => Math.sin(i));
    assert.equal(await q.enqueue({ ...ep, meta: { ...ep.meta, episodeId: "up:big" } }), null, "over the cap: refused");
    const seen = [];
    let r = await q.flush(async (body, it) => { seen.push([it.id, body.size]); return 503; });
    assert.deepEqual(r, { sent: [], failed: ["up:1"] });
    assert.equal((await q.pending())[0].attempts, 1);
    assert.equal((await q.pending())[0].lastStatus, 503);
    r = await q.flush(async () => { throw new Error("offline"); });
    assert.deepEqual(r.failed, ["up:1"]);
    r = await q.flush(async () => 202);
    assert.deepEqual(r, { sent: ["up:1"], failed: [] });
    assert.equal((await q.pending()).length, 0);
    assert.equal(seen[0][0], "up:1");
  });

  test("an episode over the cap, or pins that leave no room, is STORAGE FULL", async () => {
    const store = storeWithSizes();
    await assert.rejects(store.save(makeEpisode({ id: "huge:1100" })), (e) => e instanceof StorageFullError && e.label === "STORAGE FULL");
    for (let i = 0; i < 10; i++) {
      await store.save(makeEpisode({ id: `p${i}:100`, created: at(i) }));
      await store.pin(`p${i}:100`, true);
    }
    await assert.rejects(store.save(makeEpisode({ id: "next:100", created: at(20) }), { confirmEvict: async () => true }), StorageFullError);
  });

  test("planEviction is exact at the boundary and ignores the episode being replaced", () => {
    const s = (id, bytes, created, extra = {}) => ({ id, bytes, created, store: "episodes", pinned: false, ...extra });
    const all = [s("a", 40, "1"), s("b", 40, "2"), s("c", 20, "3"), s("h", 500, "0", { store: "episodes_human" })];
    assert.deepEqual(planEviction(all, 0, 100, null), []);
    assert.deepEqual(planEviction(all, 1, 100, null), ["a"]);
    assert.deepEqual(planEviction(all, 50, 100, null), ["a", "b"]);
    assert.deepEqual(planEviction(all, 40, 100, "a"), []);
    assert.equal(planEviction(all, 101, 100, null), null);
  });

  test("concurrent saves plan against each other's writes", async () => {
    const store = storeWithSizes();
    await Promise.all(Array.from({ length: 15 }, (_, i) => store.save(makeEpisode({ id: `c${i}:100`, created: at(i) }), { confirmEvict: async () => true })));
    const info = await store.storage();
    assert.ok(info.otherBytes <= EPISODE_CAP_BYTES, `${info.otherBytes / MB} MB`);
    assert.equal((await store.list()).length, 10);
  });
});
