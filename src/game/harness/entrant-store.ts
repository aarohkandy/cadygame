// src/game/harness/entrant-store.ts (WP5)
// Registered entrants (uploaded JS modules and JSON trajectories) that persist across reloads. The same
// file registered twice is one entrant: the id comes from its kind and SHA-256, and a re-registration
// refreshes the name and file name while keeping the original registration date.

import type { CreateEntrantStore, EntrantRecord, EntrantStore } from "../contracts.ts";
import { defaultBackend, type KvBackend } from "./idb.ts";
import { createFsBackend } from "./episode-store-fs.ts";

/** Stable id for a policy file: `module-3f9a…` (16 hex digits of its SHA-256). */
export function entrantId(kind: EntrantRecord["kind"], sha256: string): string {
  return `${kind}-${sha256.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 16)}`;
}

function validate(e: Omit<EntrantRecord, "id" | "created">): void {
  if (e.kind !== "module" && e.kind !== "trajectory") throw new Error(`unknown entrant kind ${String(e.kind)}`);
  if (!/^[0-9a-fA-F]{64}$/.test(e.sha256)) throw new Error("entrant sha256 must be 64 hex digits");
  if (typeof e.source !== "string" || e.source.length === 0) throw new Error("entrant source is empty");
  if (typeof e.fileName !== "string" || e.fileName.length === 0) throw new Error("entrant file name is empty");
}

export function createEntrantStoreOn(backend: KvBackend, now: () => Date = () => new Date()): EntrantStore {
  return {
    async list() {
      const all = await backend.getAll<EntrantRecord>("entrants");
      return all.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1));
    },
    async save(e) {
      validate(e);
      const id = entrantId(e.kind, e.sha256);
      const existing = await backend.get<EntrantRecord>("entrants", id);
      const record: EntrantRecord = {
        id, kind: e.kind, fileName: e.fileName, name: e.name || e.fileName, source: e.source, sha256: e.sha256.toLowerCase(),
        created: existing?.created ?? now().toISOString(),
      };
      await backend.write([{ store: "entrants", key: id, value: record }]);
      return record;
    },
    async remove(id) {
      await backend.write([{ store: "entrants", key: id, remove: true }]);
    },
  };
}

export const createEntrantStore: CreateEntrantStore = (kind) =>
  createEntrantStoreOn(kind === "indexeddb" ? defaultBackend() : createFsBackend(kind.fsRoot));
