// src/game/harness/episode-store-fs.ts (WP5)
// The episode and entrant stores over a directory, for the Node eval CLI and tests. Episodes are written
// as `<id>.tlep.json` (the torquelimit.episode/3 export format, so the directory is directly usable by
// tools/export/to_lerobot.py), summaries in `torquelimit-index.json`, entrants in `entrants.json`.
// Writes go to a temporary file and are renamed into place. Node built-ins are imported lazily, so this
// module stays importable (and inert) in a browser bundle.

import type { CreateEpisodeStore, Episode } from "../contracts.ts";
import { decodeEpisodeText, encodeEpisodeText, episodeFileName } from "./episode-format.ts";
import { createEpisodeStoreOn } from "./episode-store.ts";
import type { KvBackend, KvOp, StoreName } from "./idb.ts";

export const INDEX_FILE = "torquelimit-index.json";
export const ENTRANTS_FILE = "entrants.json";

interface NodeFs {
  readFile(path: string, enc: "utf8"): Promise<string>;
  writeFile(path: string, data: string, enc: "utf8"): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, opts: { force: boolean }): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>;
}
interface NodePath { join(...parts: string[]): string; }

let nodeModules: Promise<{ fs: NodeFs; path: NodePath }> | null = null;

/** node:fs/promises and node:path, loaded on first use (bundlers are told to leave these imports alone). */
function loadNode(): Promise<{ fs: NodeFs; path: NodePath }> {
  nodeModules ??= (async () => {
    const fsSpec = "node:fs/promises";
    const pathSpec = "node:path";
    const [fs, path] = await Promise.all([
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ fsSpec) as Promise<NodeFs>,
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathSpec) as Promise<NodePath & { default?: NodePath }>,
    ]);
    return { fs, path: path.default ?? path };
  })();
  return nodeModules;
}

function isMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const { fs } = await loadNode();
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if (isMissing(err)) return fallback;
    throw err;
  }
}

async function writeAtomic(dir: string, file: string, text: string): Promise<void> {
  const { fs } = await loadNode();
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

/** Key-value backend over a directory with the same semantics as the IndexedDB backend. */
export function createFsBackend(root: string): KvBackend {
  type Maps = Record<"summaries" | "entrants", Record<string, unknown>>;
  let cache: Maps | null = null;

  async function paths() {
    const { path } = await loadNode();
    return { index: path.join(root, INDEX_FILE), entrants: path.join(root, ENTRANTS_FILE), episode: (id: string) => path.join(root, episodeFileName(id)) };
  }

  async function maps(): Promise<Maps> {
    if (cache) return cache;
    const p = await paths();
    const index = await readJson<{ summaries?: Record<string, unknown> }>(p.index, {});
    const entrants = await readJson<Record<string, unknown>>(p.entrants, {});
    cache = { summaries: index.summaries ?? {}, entrants };
    return cache;
  }

  const isEpisodeStore = (s: StoreName) => s === "episodes" || s === "episodes_human";
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

  return {
    kind: "fs",
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      if (isEpisodeStore(store)) {
        const m = await maps();
        const summary = m.summaries[key] as { store?: string } | undefined;
        if (!summary || summary.store !== store) return undefined;
        const { fs } = await loadNode();
        try {
          return decodeEpisodeText(await fs.readFile((await paths()).episode(key), "utf8")) as T;
        } catch (err) {
          if (isMissing(err)) return undefined;
          throw err;
        }
      }
      const m = await maps();
      return clone(m[store as keyof Maps][key] as T | undefined);
    },

    async getAll<T>(store: StoreName): Promise<T[]> {
      if (isEpisodeStore(store)) throw new Error("listing whole episodes is not supported; list summaries instead");
      const m = await maps();
      return Object.values(m[store as keyof Maps]).map((v) => clone(v as T));
    },

    async write(ops: readonly KvOp[]): Promise<void> {
      const { fs } = await loadNode();
      const p = await paths();
      const m = await maps();
      let indexDirty = false;
      let entrantsDirty = false;
      for (const op of ops) {
        if (isEpisodeStore(op.store)) {
          if ("remove" in op) await fs.rm(p.episode(op.key), { force: true });
          else await writeAtomic(root, p.episode(op.key), encodeEpisodeText(op.value as Episode));
        } else if (op.store === "summaries") {
          if ("remove" in op) delete m.summaries[op.key]; else m.summaries[op.key] = clone(op.value);
          indexDirty = true;
        } else {
          if ("remove" in op) delete m.entrants[op.key]; else m.entrants[op.key] = clone(op.value);
          entrantsDirty = true;
        }
      }
      if (indexDirty) await writeAtomic(root, p.index, `${JSON.stringify({ format: "torquelimit.index/1", summaries: m.summaries }, null, 1)}\n`);
      if (entrantsDirty) await writeAtomic(root, p.entrants, `${JSON.stringify(m.entrants, null, 1)}\n`);
    },
  };
}

/** Episode store over a directory. Node only; `"indexeddb"` belongs to episode-store.ts. */
export const createEpisodeStore: CreateEpisodeStore = (kind) => {
  if (kind === "indexeddb") throw new Error("the IndexedDB episode store lives in episode-store.ts");
  return createEpisodeStoreOn(createFsBackend(kind.fsRoot));
};
