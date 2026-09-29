import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createEntrantStore, createEntrantStoreOn, entrantId } from "../src/game/harness/entrant-store.ts";
import { createMemoryBackend } from "../src/game/harness/idb.ts";

const entrant = (over = {}) => ({ kind: "module", fileName: "act_so101.mjs", name: "act_so101_v3", source: "export function act(){return [0,0,0,0,0,0]}", sha256: "AB".repeat(32), ...over });

describe("entrant store", () => {
  test("save assigns a stable id from kind and hash; the same file registered twice stays one entrant", async () => {
    let clock = 0;
    const store = createEntrantStoreOn(createMemoryBackend(), () => new Date(Date.UTC(2026, 8, 16, 0, clock++)));
    const first = await store.save(entrant());
    assert.equal(first.id, entrantId("module", "ab".repeat(32)));
    assert.equal(first.sha256, "ab".repeat(32));
    const again = await store.save(entrant({ name: "renamed", fileName: "v2.mjs" }));
    assert.equal(again.id, first.id);
    assert.equal(again.created, first.created);
    assert.equal(again.name, "renamed");
    const traj = await store.save(entrant({ kind: "trajectory", fileName: "wave.json", source: '{"fps":50,"frames":[]}', name: "" }));
    assert.equal(traj.name, "wave.json");
    const list = await store.list();
    assert.deepEqual(list.map((e) => e.kind), ["trajectory", "module"]);
    await store.remove(first.id);
    assert.deepEqual((await store.list()).map((e) => e.id), [traj.id]);
  });

  test("rejects malformed records", async () => {
    const store = createEntrantStoreOn(createMemoryBackend());
    await assert.rejects(store.save(entrant({ sha256: "xyz" })), /64 hex/);
    await assert.rejects(store.save(entrant({ source: "" })), /empty/);
    await assert.rejects(store.save(entrant({ kind: "bridge" })), /kind/);
  });

  test("entrants persist across reloads (a new store over the same directory)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tl-entrants-"));
    try {
      const saved = await createEntrantStore({ fsRoot: dir }).save(entrant());
      const reloaded = await createEntrantStore({ fsRoot: dir }).list();
      assert.deepEqual(reloaded, [saved]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the IndexedDB factory is lazy and usable where IndexedDB is missing", async () => {
    const store = createEntrantStore("indexeddb");
    assert.deepEqual(await store.list(), []);
  });
});
