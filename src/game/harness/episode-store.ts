// src/game/harness/episode-store.ts (WP5)
// Episode storage (GAME_DESIGN 5.8, EMOTION_BIBLE 9): episodes with a human or proxy seat go to
// `episodes_human`, capped at 200 MB for `local` and `share` alike (the oldest unpinned evicted silently, one
// toast at 150 MB with EXPORT); every other episode goes to `episodes`, capped at 1 GB. A save that would pass
// that cap names how many of the oldest unpinned episodes it would evict and asks first (WILL EVICT N). A summary
// row per episode drives the Replays list and the storage meter without loading episodes. The upload queue
// (gzip .tlep.json ≤ 16 MB, sent after the verdict, kept in IndexedDB when the tab closes first) lives here too.
// The browser store keeps the in-memory Episode by structured clone; the same logic runs over the
// Node filesystem in episode-store-fs.ts.

import {
  SEATS,
  type CreateEpisodeStore, type Episode, type EpisodeStore, type EpisodeSummary, type Seat, type StorageInfo,
} from "../contracts.ts";
import { createEpisodeCodec, EpisodeFormatError } from "./episode-format.ts";
import { defaultBackend, requestPersistentStorage, type KvBackend, type KvOp, type StoreName } from "./idb.ts";
import { episodeVerdicts, summaryVerdict } from "./verdict.ts";

/** Cap for non-human episodes (5.8: 1 GB). */
export const EPISODE_CAP_BYTES = 1024 ** 3;
/** Cap for human episodes (9: 200 MB, `local` too), and the one toast at 150 MB. */
export const HUMAN_CAP_BYTES = 200 * 1024 ** 2;
export const HUMAN_WARN_BYTES = 150 * 1024 ** 2;
export const HUMAN_WARNING = "MATCH STORAGE 150 MB · OLDEST MATCHES WILL BE DROPPED · EXPORT";
/** After a 202 the receiver has the episode: keep this many recent human episodes locally (9). */
export const KEEP_AFTER_UPLOAD = 20;
/** Upload bodies over this are refused (9: ≤ 16 MB gzip). */
export const UPLOAD_MAX_BYTES = 16 * 1024 ** 2;

export class EpisodeNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`episode ${id} not found`);
    this.name = "EpisodeNotFoundError";
    this.id = id;
  }
}

/** A save needs to evict `count` episodes and nobody confirmed it. The Replays screen shows WILL EVICT N. */
export class EvictionDeclinedError extends Error {
  readonly count: number;
  constructor(count: number) {
    super(`saving needs to evict ${count} older episode${count === 1 ? "" : "s"}`);
    this.name = "EvictionDeclinedError";
    this.count = count;
  }
  get label(): string { return `WILL EVICT ${this.count}`; }
}

/** The episode alone is larger than the cap, or pinned episodes leave no room. */
export class StorageFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageFullError";
  }
  get label(): string { return "STORAGE FULL"; }
}

/** Summary row as stored: the public summary plus where the episode lives. */
export interface StoredSummary extends EpisodeSummary {
  store: Extract<StoreName, "episodes" | "episodes_human">;
}

export interface EpisodeStoreOptions {
  capBytes?: number;
  humanCapBytes?: number;
  humanWarnBytes?: number;
  /** Size accounting; defaults to estimateEpisodeBytes. */
  sizeOf?: (ep: Episode) => number;
  /** Ask the browser for persistent storage on the first save. */
  persist?: boolean;
}

export interface EpisodeStoreExtras {
  readonly backend: KvBackend;
  importFile(file: File | Blob, opts?: { confirmEvict?: (n: number) => Promise<boolean> }): Promise<string>;
  summary(id: string): Promise<EpisodeSummary | null>;
  /** Human episodes evicted by the last save (the 200 MB cap), for the Replays screen. */
  readonly lastHumanEvictions: readonly string[];
  /** Keeps the `keep` most recent human episodes and drops the rest that are in `uploaded` (called after a 202). */
  pruneUploaded(uploaded: readonly string[], keep?: number): Promise<string[]>;
}

export function isHumanEpisode(ep: Episode): boolean {
  return SEATS.some((s) => ep.meta.seats[s].driver === "human" || ep.meta.seats[s].driver === "proxy");
}

function typedBytes(a: { byteLength: number }): number {
  return a.byteLength;
}

/**
 * In-memory size of an episode: typed payloads exactly, plus a measured-average estimate for plain objects
 * (events ≈ 220 B, mutations ≈ 120 B, sparse entries ≈ 160 B each). Drives the cap and the storage meter.
 */
export function estimateEpisodeBytes(ep: Episode): number {
  let n = 0;
  for (const name of Object.keys(ep.columns)) n += typedBytes(ep.columns[name]);
  n += typedBytes(ep.steps.ctrl.steps) + typedBytes(ep.steps.ctrl.values);
  n += typedBytes(ep.steps.intents.steps) + typedBytes(ep.steps.intents.values);
  const stateBytes = (s: Episode["steps"]["checkpoints"][number]["state"]) =>
    typedBytes(s.qpos) + typedBytes(s.qvel) + typedBytes(s.ctrl) + typedBytes(s.qacc_warmstart) + typedBytes(s.servo) + 8;
  for (const c of ep.steps.checkpoints) n += stateBytes(c.state) + 16;
  for (const m of ep.steps.mutations) n += m.kind === "reset" ? stateBytes(m.state) + 32 : 120;
  n += ep.events.length * 220;
  for (const k of Object.keys(ep.sparse)) n += ep.sparse[k].length * 160;
  return n + 4096;
}

export function summarize(ep: Episode, bytes: number, pinned: boolean): StoredSummary {
  const names = {} as Record<Seat, string>;
  for (const s of SEATS) names[s] = ep.meta.seats[s].name;
  const rows = ep.columns.frame_index.length;
  const human = isHumanEpisode(ep);
  return {
    id: ep.meta.episodeId,
    created: ep.meta.created,
    names,
    preset: ep.meta.preset,
    winner: ep.meta.result.winner,
    durationS: ep.meta.controlHz > 0 ? rows / ep.meta.controlHz : 0,
    bytes,
    verdict: summaryVerdict(episodeVerdicts(ep)),
    pinned,
    human,
    store: human ? "episodes_human" : "episodes",
  };
}

function publicSummary(s: StoredSummary): EpisodeSummary {
  return {
    id: s.id, created: s.created, names: s.names, preset: s.preset, winner: s.winner, durationS: s.durationS,
    bytes: s.bytes, verdict: s.verdict, pinned: s.pinned, human: s.human,
  };
}

/** Oldest unpinned episodes of `store` to evict so `incoming` more bytes fit; null when even all of them are not enough. */
export function planEviction(summaries: readonly StoredSummary[], incoming: number, cap: number, excludeId: string | null, store: StoredSummary["store"] = "episodes"): string[] | null {
  const others = summaries.filter((s) => s.store === store && s.id !== excludeId);
  let used = 0;
  for (const s of others) used += s.bytes;
  let over = used + incoming - cap;
  if (over <= 0) return [];
  const candidates = others.filter((s) => !s.pinned).sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
  const out: string[] = [];
  for (const c of candidates) {
    if (over <= 0) break;
    out.push(c.id);
    over -= c.bytes;
  }
  return over <= 0 ? out : null;
}

/** The store logic over any key-value backend (IndexedDB, memory, filesystem). */
export type ExtendedEpisodeStore = Omit<EpisodeStore, "importFile"> & EpisodeStoreExtras;

export function createEpisodeStoreOn(backend: KvBackend, opts: EpisodeStoreOptions = {}): ExtendedEpisodeStore {
  const cap = opts.capBytes ?? EPISODE_CAP_BYTES;
  const humanCap = opts.humanCapBytes ?? HUMAN_CAP_BYTES;
  const humanWarn = opts.humanWarnBytes ?? HUMAN_WARN_BYTES;
  const sizeOf = opts.sizeOf ?? estimateEpisodeBytes;
  let lastHumanEvictions: string[] = [];
  let warned = false;
  const codec = createEpisodeCodec();
  let persistAsked = !opts.persist;
  // Serialize writes so two saves never plan evictions against the same snapshot.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  const summaries = () => backend.getAll<StoredSummary>("summaries");

  async function summaryOf(id: string): Promise<StoredSummary> {
    const s = await backend.get<StoredSummary>("summaries", id);
    if (!s) throw new EpisodeNotFoundError(id);
    return s;
  }

  async function saveImpl(ep: Episode, confirmEvict?: (n: number) => Promise<boolean>): Promise<string> {
    const id = ep.meta.episodeId;
    if (typeof id !== "string" || id.length === 0) throw new EpisodeFormatError("malformed", "episode has no id", "meta.episodeId");
    const bytes = sizeOf(ep);
    const all = await summaries();
    const existing = all.find((s) => s.id === id) ?? null;
    const summary = summarize(ep, bytes, existing?.pinned ?? false);
    const ops: KvOp[] = [];
    if (summary.store === "episodes") {
      if (bytes > cap) throw new StorageFullError(`episode is ${Math.ceil(bytes / 1e6)} MB, over the ${Math.round(cap / 1e6)} MB cap`);
      const evict = planEviction(all, bytes, cap, id);
      if (evict === null) throw new StorageFullError("pinned episodes fill the storage cap; unpin or delete some");
      if (evict.length > 0) {
        const ok = confirmEvict ? await confirmEvict(evict.length) : false;
        if (!ok) throw new EvictionDeclinedError(evict.length);
        for (const victim of evict) {
          ops.push({ store: "episodes", key: victim, remove: true }, { store: "summaries", key: victim, remove: true });
        }
      }
    }
    if (summary.store === "episodes_human") {
      // 9: a 200 MB cap for local too. The oldest unpinned human episodes go silently; the toast fires once at 150 MB.
      if (bytes > humanCap) throw new StorageFullError(`match is ${Math.ceil(bytes / 1e6)} MB, over the ${Math.round(humanCap / 1e6)} MB match cap`);
      const evict = planEviction(all, bytes, humanCap, id, "episodes_human");
      if (evict === null) throw new StorageFullError("pinned matches fill the match storage cap; unpin or export some");
      for (const victim of evict) ops.push({ store: "episodes_human", key: victim, remove: true }, { store: "summaries", key: victim, remove: true });
      lastHumanEvictions = evict;
    }
    if (existing && existing.store !== summary.store) ops.push({ store: existing.store, key: id, remove: true });
    ops.push({ store: summary.store, key: id, value: ep }, { store: "summaries", key: id, value: summary });
    await backend.write(ops);
    if (!persistAsked) { persistAsked = true; requestPersistentStorage(); }
    return id;
  }

  const store: ExtendedEpisodeStore = {
    backend,

    save(ep, o) {
      return serial(() => saveImpl(ep, o?.confirmEvict));
    },

    async list() {
      const all = await summaries();
      all.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? 1 : -1));
      return all.map(publicSummary);
    },

    async load(id) {
      const s = await summaryOf(id);
      const ep = await backend.get<Episode>(s.store, id);
      if (!ep) throw new EpisodeNotFoundError(id);
      return ep;
    },

    remove(id) {
      return serial(async () => {
        const s = await backend.get<StoredSummary>("summaries", id);
        if (!s) return;
        await backend.write([{ store: s.store, key: id, remove: true }, { store: "summaries", key: id, remove: true }]);
      });
    },

    pin(id, pinned) {
      return serial(async () => {
        const s = await summaryOf(id);
        if (s.pinned === pinned) return;
        await backend.write([{ store: "summaries", key: id, value: { ...s, pinned } }]);
      });
    },

    async storage(): Promise<StorageInfo> {
      const all = await summaries();
      let humanBytes = 0;
      let otherBytes = 0;
      for (const s of all) {
        if (s.store === "episodes_human") humanBytes += s.bytes; else otherBytes += s.bytes;
      }
      const snapshot = all.slice();
      const warning = humanBytes >= humanWarn && !warned ? HUMAN_WARNING : null;
      if (warning) warned = true;
      return {
        humanBytes, otherBytes, capBytes: cap, humanCapBytes: humanCap, humanWarning: warning,
        wouldEvict: (bytes: number) => {
          const plan = planEviction(snapshot, bytes, cap, null);
          return plan === null ? snapshot.filter((s) => s.store === "episodes" && !s.pinned).length : plan.length;
        },
      };
    },

    async exportBlob(id) {
      return codec.encode(await store.load(id));
    },

    async importFile(file, o) {
      const text = await file.text();
      const ep = codec.decode(text);
      return store.save(ep, o);
    },

    async summary(id) {
      const s = await backend.get<StoredSummary>("summaries", id);
      return s ? publicSummary(s) : null;
    },

    get lastHumanEvictions() { return lastHumanEvictions; },

    pruneUploaded(uploaded, keep = KEEP_AFTER_UPLOAD) {
      return serial(async () => {
        const human = (await summaries()).filter((s) => s.store === "episodes_human")
          .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
        const sent = new Set(uploaded);
        const drop = human.slice(keep).filter((s) => sent.has(s.id) && !s.pinned).map((s) => s.id);
        if (drop.length === 0) return [];
        const ops: KvOp[] = [];
        for (const id of drop) ops.push({ store: "episodes_human", key: id, remove: true }, { store: "summaries", key: id, remove: true });
        await backend.write(ops);
        return drop;
      });
    },
  };
  return store;
}

/* ───────────────────────── upload queue (9) ───────────────────────── */

export interface UploadItem {
  id: string;                 // episode id
  scope: "share";             // only shared episodes are ever queued
  bytes: number;              // gzip body size
  queuedAt: string;
  attempts: number;
  lastStatus: number | null;  // last HTTP status, null before the first try
}

export interface UploadQueue {
  /** gzip-encodes the episode and stores the body; returns the item, or null when the body is over 16 MB. */
  enqueue(ep: Episode): Promise<UploadItem | null>;
  pending(): Promise<UploadItem[]>;
  /**
   * Sends every pending body through `send` (the receiver returns 202 when it has the episode). Items with a 202 are
   * removed and returned; anything else stays queued with its status. Never throws for a network failure.
   */
  flush(send: (body: Blob, item: UploadItem) => Promise<number>): Promise<{ sent: string[]; failed: string[] }>;
  remove(id: string): Promise<void>;
}

/** gzip via CompressionStream where the platform has it (browsers, Node ≥ 18); identity otherwise (tests). */
export async function gzipText(text: string): Promise<Blob> {
  const g = globalThis as { CompressionStream?: new (format: string) => { readable: ReadableStream; writable: WritableStream } };
  if (!g.CompressionStream) return new Blob([text], { type: "application/json" });
  const cs = new g.CompressionStream("gzip");
  const stream = new Blob([text]).stream().pipeThrough(cs as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Response(stream).blob().then((b) => new Blob([b], { type: "application/gzip" }));
}

export function createUploadQueue(backend: KvBackend, opts: { maxBytes?: number } = {}): UploadQueue {
  const codec = createEpisodeCodec();
  const maxBytes = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  type Row = UploadItem & { body: ArrayBuffer };
  const rowsOf = () => backend.getAll<Row>("upload_queue");
  const strip = (r: Row): UploadItem => ({ id: r.id, scope: r.scope, bytes: r.bytes, queuedAt: r.queuedAt, attempts: r.attempts, lastStatus: r.lastStatus });
  return {
    async enqueue(ep) {
      const text = await codec.encode(ep).text();
      const gz = await gzipText(text);
      if (gz.size > maxBytes) return null;
      const body = await gz.arrayBuffer();
      const item: UploadItem = { id: ep.meta.episodeId, scope: "share", bytes: gz.size, queuedAt: new Date().toISOString(), attempts: 0, lastStatus: null };
      await backend.write([{ store: "upload_queue", key: item.id, value: { ...item, body } }]);
      return item;
    },
    async pending() {
      return (await rowsOf()).map(strip).sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
    },
    async flush(send) {
      const sent: string[] = [];
      const failed: string[] = [];
      for (const row of await rowsOf()) {
        let status = 0;
        try { status = await send(new Blob([row.body], { type: "application/gzip" }), strip(row)); } catch { status = 0; }
        if (status === 202) {
          await backend.write([{ store: "upload_queue", key: row.id, remove: true }]);
          sent.push(row.id);
        } else {
          await backend.write([{ store: "upload_queue", key: row.id, value: { ...row, attempts: row.attempts + 1, lastStatus: status || null } }]);
          failed.push(row.id);
        }
      }
      return { sent, failed };
    },
    async remove(id) {
      await backend.write([{ store: "upload_queue", key: id, remove: true }]);
    },
  };
}

/** Browser store (IndexedDB `torquelimit`). Node callers use episode-store-fs.ts for `{ fsRoot }`. */
export const createEpisodeStore: CreateEpisodeStore = (kind) => {
  if (kind !== "indexeddb") {
    throw new Error("the filesystem episode store lives in episode-store-fs.ts (Node only)");
  }
  return createEpisodeStoreOn(defaultBackend(), { persist: true });
};
