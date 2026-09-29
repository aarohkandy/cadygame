// src/game/harness/idb.ts (WP5)
// A small key-value layer over IndexedDB database `torquelimit` (GAME_DESIGN 5.8 storage), plus an
// in-memory backend with the same structured-clone semantics for Node, tests, and browsers where
// IndexedDB is blocked (private windows, disabled storage). Opening is lazy: nothing touches IndexedDB
// until the first read or write, so constructing a store never throws.

export const DB_NAME = "torquelimit";
/** v2 (EMOTION_BIBLE 9): the upload queue store. onupgradeneeded only adds stores, so v1 data is kept. */
export const DB_VERSION = 2;

/**
 * episodes_human is capped at 200 MB (oldest evicted); episodes is capped at 1 GB (asks first); summaries index
 * both; entrants hold registered policies; upload_queue holds gzip .tlep.json bodies waiting for a 202.
 */
export const STORE_NAMES = ["episodes", "episodes_human", "summaries", "entrants", "upload_queue"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export type KvOp = { store: StoreName; key: string; value: unknown } | { store: StoreName; key: string; remove: true };

export interface KvBackend {
  readonly kind: "indexeddb" | "memory" | "fs";
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  /** Applies every op in one transaction: all land or none do. */
  write(ops: readonly KvOp[]): Promise<void>;
}

/** Thrown when the browser refuses storage (quota, blocked, version conflict). */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new StorageUnavailableError("IndexedDB request failed"));
  });
}

export function indexedDbAvailable(): boolean {
  return typeof (globalThis as { indexedDB?: IDBFactory }).indexedDB !== "undefined";
}

export function createIndexedDbBackend(name = DB_NAME): KvBackend {
  let opening: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!factory) { reject(new StorageUnavailableError("IndexedDB is not available")); return; }
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(name, DB_VERSION);
      } catch (err) {
        reject(new StorageUnavailableError(err instanceof Error ? err.message : String(err)));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of STORE_NAMES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema: close so it can proceed; the next call reopens.
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      req.onerror = () => reject(new StorageUnavailableError(req.error?.message ?? "IndexedDB open failed"));
      req.onblocked = () => reject(new StorageUnavailableError("IndexedDB is blocked by another tab"));
    });
    opening.catch(() => { opening = null; });
    return opening;
  }

  return {
    kind: "indexeddb",
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      const db = await open();
      return requestToPromise(db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
    },
    async getAll<T>(store: StoreName): Promise<T[]> {
      const db = await open();
      return requestToPromise(db.transaction(store, "readonly").objectStore(store).getAll()) as Promise<T[]>;
    },
    async write(ops: readonly KvOp[]): Promise<void> {
      if (ops.length === 0) return;
      const db = await open();
      const stores = Array.from(new Set(ops.map((o) => o.store)));
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new StorageUnavailableError("storage transaction aborted"));
        tx.onerror = () => reject(tx.error ?? new StorageUnavailableError("storage transaction failed"));
        try {
          for (const op of ops) {
            const os = tx.objectStore(op.store);
            if ("remove" in op) os.delete(op.key); else os.put(op.value, op.key);
          }
        } catch (err) {
          tx.abort();
          reject(err);
        }
      });
    },
  };
}

const clone: <T>(v: T) => T = typeof structuredClone === "function"
  ? structuredClone
  : <T>(v: T) => JSON.parse(JSON.stringify(v)) as T;

/** Same semantics as IndexedDB (values are structured-cloned on the way in and out), kept in memory. */
export function createMemoryBackend(): KvBackend {
  const stores = new Map<StoreName, Map<string, unknown>>(STORE_NAMES.map((s) => [s, new Map()]));
  return {
    kind: "memory",
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      const v = stores.get(store)!.get(key);
      return v === undefined ? undefined : clone(v as T);
    },
    async getAll<T>(store: StoreName): Promise<T[]> {
      return Array.from(stores.get(store)!.values(), (v) => clone(v as T));
    },
    async write(ops: readonly KvOp[]): Promise<void> {
      const staged = ops.map((op) => ("remove" in op ? op : { ...op, value: clone(op.value) }));
      for (const op of staged) {
        const s = stores.get(op.store)!;
        if ("remove" in op) s.delete(op.key); else s.set(op.key, op.value);
      }
    },
  };
}

/** IndexedDB in browsers that have it, memory elsewhere. */
export function defaultBackend(): KvBackend {
  return indexedDbAvailable() ? createIndexedDbBackend() : createMemoryBackend();
}

/** Ask the browser to keep this origin's data under storage pressure (no prompt in Chromium; best effort). */
export function requestPersistentStorage(): void {
  const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } } }).navigator?.storage;
  if (!storage?.persist || !storage.persisted) return;
  storage.persisted().then((already) => (already ? true : storage.persist!())).catch(() => false);
}
