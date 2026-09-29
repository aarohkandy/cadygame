// src/game/physics/mujoco-loader.ts (WP2)
// One MuJoCo WASM instance per realm (promise-cached, Strict Mode safe) and cached model files.
//
// Browser: the runtime is served from /mujoco.{js,wasm} (scripts/sync-mujoco.mjs) and imported through an indirect
// import so the bundler never pulls the Emscripten bundle's Node-only branch into the client graph. Models and STLs are
// fetched once from `modelBaseUrl` and reused by every engine (each engine compiles its own MjModel, because Arcade
// servo states edit model arrays in place).
// Node: the same files are read from disk under `nodeFsRoot` (the repository root, default process.cwd()).
import type { MainModule, MjModel } from "@mujoco/mujoco";
import type { PhysicsMode } from "../contracts.ts";

export const DEFAULT_MODEL_BASE_URL = "/models/robotstudio_so101";
export const STOCK_MODEL_FILE = "arena.xml";
export const ARCADE_MODEL_FILE = "arena-arcade.xml";
export const ROBOT_FILE = "so101.xml";
export const ARCADE_ROBOT_FILE = "so101-arcade.xml";

export function modelFileFor(mode: PhysicsMode): string {
  return mode === "arcade" ? ARCADE_MODEL_FILE : STOCK_MODEL_FILE;
}

export interface LoaderOptions {
  modelBaseUrl?: string;
  nodeFsRoot?: string;
  /** Called as each referenced file lands, so a caller can show real download progress. */
  onFile?: (done: number, total: number) => void;
}

export interface ModelFiles {
  source: string;                        // loader source key (Node root or base URL); both modes of a source share it
  file: string;                          // arena.xml | arena-arcade.xml
  xml: string;
  sha256: string;                        // of the arena file bytes actually loaded
  so101Sha256: string;                   // of the vendored so101.xml
  vfs: ReadonlyMap<string, Uint8Array>;  // every file the arena references (robot XML and STL meshes), by VFS path
}

type ImportFn = (specifier: string) => Promise<Record<string, unknown>>;
// An indirect import: invisible to the bundler, resolved by the runtime (browser URL or Node specifier).
const runtimeImport = new Function("s", "return import(s)") as ImportFn;

export function isNodeRuntime(): boolean {
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof (globalThis as { window?: unknown }).window === "undefined" && typeof p?.versions?.node === "string";
}

interface NodeFs { readFile(path: string): Promise<Uint8Array> }
interface NodeUrl { pathToFileURL(path: string): { href: string } }
interface NodePath { join(...parts: string[]): string }

async function nodeModules(): Promise<{ fs: NodeFs; url: NodeUrl; path: NodePath; cwd: string }> {
  const [fs, url, path] = await Promise.all([
    runtimeImport("node:fs/promises"), runtimeImport("node:url"), runtimeImport("node:path"),
  ]);
  const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
  return { fs: fs as unknown as NodeFs, url: url as unknown as NodeUrl, path: path as unknown as NodePath, cwd: proc.cwd() };
}

let modulePromise: Promise<MainModule> | null = null;

/** The MuJoCo module, loaded once per realm. A failed load clears the cache so a retry can succeed. */
export function loadMujoco(opts: LoaderOptions = {}): Promise<MainModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      if (isNodeRuntime()) {
        const node = await nodeModules();
        const root = opts.nodeFsRoot ?? node.cwd;
        const entry = node.path.join(root, "node_modules", "@mujoco", "mujoco", "mujoco.js");
        const mod = await runtimeImport(node.url.pathToFileURL(entry).href);
        const factory = mod.default as (o?: unknown) => Promise<MainModule>;
        return factory();
      }
      const mod = await runtimeImport("/mujoco.js");
      const factory = mod.default as (o?: unknown) => Promise<MainModule>;
      return factory({ locateFile: (p: string) => (p.endsWith(".wasm") ? "/mujoco.wasm" : p) });
    })();
    modulePromise.catch(() => { modulePromise = null; });
  }
  return modulePromise;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Drops render-only mesh geoms and the `<mesh>` assets nothing needs any more.
 *
 * MuJoCo must fetch every mesh a robot XML declares, but a `class="visual"` geom is `contype="0"
 * conaffinity="0"` (so101.xml default classes) and never collides — the renderer draws the arm from
 * `arms.bake`, not from these. Stripping them takes the VFS payload from 17.4 MB to 0.59 MB with the
 * compiled model bit-identical (same qpos over a 4 000-step rollout, same ncon, same body_mass and
 * body_inertia). The `mass=` guard is load-bearing: `camera_mount` is the one body with no `<inertial>`,
 * so its visual geom's mass IS its inertia and that mesh must survive.
 *
 * Only self-closing `<geom …/>` is matched, which is what both vendored files and gen-arcade-model.mjs
 * emit; anything else is left alone and merely downloaded, so the failure mode is the status quo.
 * Never write the result back to disk — `tests/arcade-model.test.mjs` pins the on-disk bytes, and
 * `so101Sha256` is hashed from the unstripped fetch so episode provenance is unchanged.
 */
export function stripVisualMeshes(robotXml: string): string {
  const out = robotXml.replace(/[ \t]*<geom\b[^>]*?\/>\s*/g, (tag) => (
    /\btype="mesh"/.test(tag) && /\bclass="visual"/.test(tag) && !/\bmass="/.test(tag) ? "" : tag
  ));
  const used = new Set(Array.from(out.matchAll(/<geom\b[^>]*\bmesh="([^"]+)"/g), (m) => m[1]));
  return out.replace(/[ \t]*<mesh\b([^>]*)\bfile="([^"]+)"([^>]*)\/>\s*/g, (tag, pre: string, file: string, post: string) => {
    // A <mesh> is keyed by its name when it has one, else by the file's basename (same rule as robot-assets).
    const name = /\bname="([^"]+)"/.exec(pre + post)?.[1] ?? file.replace(/\.stl$/i, "");
    return used.has(name) ? tag : "";
  });
}

/** Mesh files named by a robot XML (`<mesh file="…">`), resolved against its meshdir. */
export function meshFilesOf(robotXml: string): string[] {
  const meshdir = /meshdir="([^"]*)"/.exec(robotXml)?.[1] ?? "";
  const out: string[] = [];
  const re = /<mesh\b[^>]*\bfile="([^"]+)"/g;
  for (let m = re.exec(robotXml); m; m = re.exec(robotXml)) out.push(meshdir ? `${meshdir}/${m[1]}` : m[1]);
  return out;
}

/** Robot XML files an arena references through `<model file="…">`. */
export function robotFilesOf(arenaXml: string): string[] {
  const out: string[] = [];
  const re = /<model\b[^>]*\bfile="([^"]+)"/g;
  for (let m = re.exec(arenaXml); m; m = re.exec(arenaXml)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Per-attempt ceiling on a boot fetch. The largest single file left after the visual meshes are stripped is
 *  ~2.5 MB, so 30 s is generous even on a poor link while still bounding a dead connection. */
export const BOOT_FETCH_TIMEOUT_MS = 30_000;

/** Runs `once` again a single time if the first attempt throws (a timeout, a dropped connection, a 5xx retry). */
async function withRetry<T>(once: () => Promise<T>): Promise<T> {
  try {
    return await once();
  } catch {
    return await once();
  }
}

type Reader = (rel: string) => Promise<Uint8Array>;

async function makeReader(opts: LoaderOptions): Promise<Reader> {
  if (isNodeRuntime()) {
    const node = await nodeModules();
    const dir = node.path.join(opts.nodeFsRoot ?? node.cwd, "public", "models", "robotstudio_so101");
    return async (rel) => new Uint8Array(await node.fs.readFile(node.path.join(dir, rel)));
  }
  const base = (opts.modelBaseUrl ?? DEFAULT_MODEL_BASE_URL).replace(/\/$/, "");
  return async (rel) => {
    // One retry behind a timeout. Without these a stalled connection leaves the promise pending forever and
    // the boot screen sits there with no error and no retry — BootScreen only renders "BOOT FAILED" on a
    // rejection, so a hang shows nothing at all. That is the silent freeze players report as "it won't load".
    const res = await withRetry(() => fetch(`${base}/${rel}`, { signal: AbortSignal.timeout(BOOT_FETCH_TIMEOUT_MS) }));
    if (!res.ok) throw new Error(`Arena model file ${rel} failed to load (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
}

const fileCache = new Map<string, Promise<ModelFiles>>();
const byteCache = new Map<string, Promise<Uint8Array>>();

/** Reads (once) an arena XML and every file it needs. */
export function loadModelFiles(mode: PhysicsMode, opts: LoaderOptions = {}): Promise<ModelFiles> {
  const file = modelFileFor(mode);
  const key = `${opts.nodeFsRoot ?? ""}|${opts.modelBaseUrl ?? ""}|${file}`;
  let hit = fileCache.get(key);
  if (!hit) {
    hit = (async () => {
      const read = await makeReader(opts);
      const cached = (rel: string) => {
        const k = `${opts.nodeFsRoot ?? ""}|${opts.modelBaseUrl ?? ""}|${rel}`;
        let p = byteCache.get(k);
        if (!p) { p = read(rel); byteCache.set(k, p); p.catch(() => byteCache.delete(k)); }
        return p;
      };
      // Files are counted as they land. `total` grows as the robot XML names its meshes, so the bar is honest
      // rather than smooth: it never claims to know the denominator before it does.
      let done = 0, total = 2;
      const tick = () => { done++; opts.onFile?.(done, Math.max(total, done)); };
      const arenaBytes = await cached(file);
      tick();
      const xml = new TextDecoder().decode(arenaBytes);
      const vfs = new Map<string, Uint8Array>();
      const decoder = new TextDecoder();
      for (const robot of robotFilesOf(xml)) {
        const robotBytes = await cached(robot);
        // Hand MuJoCo the physics-only model, so the mesh list below is the four files that matter.
        tick();
        const thin = stripVisualMeshes(decoder.decode(robotBytes));
        vfs.set(robot, new TextEncoder().encode(thin));
        const meshes = meshFilesOf(thin);
        total += meshes.length;
        const bytes = await Promise.all(meshes.map((m) => cached(m).then((b) => { tick(); return b; })));
        meshes.forEach((m, i) => vfs.set(m, bytes[i]));
      }
      const so101 = await cached(ROBOT_FILE);
      const [sha256, so101Sha256] = await Promise.all([sha256Hex(arenaBytes), sha256Hex(so101)]);
      return { source: `${opts.nodeFsRoot ?? ""}|${opts.modelBaseUrl ?? ""}`, file, xml, sha256, so101Sha256, vfs };
    })();
    fileCache.set(key, hit);
    hit.catch(() => fileCache.delete(key));
  }
  return hit;
}

interface EmscriptenFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
}

/** Per module instance: source key → directory in the Emscripten MEMFS holding that source's files. */
const fsDirs = new WeakMap<MainModule, Map<string, string>>();
const writtenFiles = new WeakMap<MainModule, Set<string>>();

/**
 * Compiles a fresh MjModel from cached files.
 *
 * The files go into the module's in-memory Emscripten FS once (a memcpy per file) and MuJoCo compiles from a path.
 * MjVFS.addBuffer is not used: embind converts its argument byte by byte, which costs ~3 s for the 17 MB of STLs.
 * Compiling from one directory also lets MuJoCo's mesh cache serve the second model of the same source.
 */
export function compileModel(mujoco: MainModule, files: ModelFiles): MjModel {
  const fs = (mujoco as unknown as { FS: EmscriptenFs }).FS;
  let dirs = fsDirs.get(mujoco);
  if (!dirs) { dirs = new Map(); fsDirs.set(mujoco, dirs); }
  let written = writtenFiles.get(mujoco);
  if (!written) { written = new Set(); writtenFiles.set(mujoco, written); }
  let dir = dirs.get(files.source);
  if (!dir) {
    dir = `/torquelimit/models/${dirs.size}`;
    dirs.set(files.source, dir);
  }
  const put = (rel: string, data: Uint8Array | string) => {
    const full = `${dir}/${rel}`;
    if (written.has(full)) return;
    const slash = full.lastIndexOf("/");
    fs.mkdirTree(full.slice(0, slash));
    fs.writeFile(full, data);
    written.add(full);
  };
  for (const [name, bytes] of files.vfs) put(name, bytes);
  put(files.file, files.xml);
  return mujoco.MjModel.from_xml_path(`${dir}/${files.file}`);
}
