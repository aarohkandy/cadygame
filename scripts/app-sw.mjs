#!/usr/bin/env node
// scripts/app-sw.mjs (WP-D, SCOPE 4.2)
// Stamps the service worker for one built export: fills in the build id and the precache manifest that
// public/sw.js ships with as placeholders, and writes the result over <export>/sw.js.
//
//   node scripts/app-sw.mjs [export-dir]        (default: out)
//
// The manifest is split in two. `shell` is what the game needs to reach its loading screen — the prerendered
// HTML, the hashed JS/CSS chunks, the manifest and the icons — and a failure there fails the install. `bulk`
// is the heavy half the game needs to actually play offline: mujoco.wasm, the MJCF/STL models, the .woff
// faces and the example policy. Every path is written relative to the worker so the export also works when a
// host serves it from a subdirectory.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportDir = resolve(repo, process.argv[2] ?? "out");

/** Every file under `dir`, as paths relative to the export root, with forward slashes. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(abs));
    else if (entry.isFile()) found.push(relative(exportDir, abs).split(sep).join("/"));
  }
  return found;
}

const all = walk(exportDir).sort();
if (!all.includes("index.html")) {
  throw new Error(`app-sw: ${exportDir} has no index.html — build the export first (npm run build:web)`);
}

// The worker itself, source maps and the RSC text payloads are not precached: the first is being written
// here, the second is debug weight, and the third is only used by client-side navigation the game never does.
const SKIP = (p) => p === "sw.js" || p.endsWith(".map") || p.endsWith(".txt");
const isShell = (p) =>
  p === "index.html" || p === "404.html" || p === "_not-found.html" ||
  p === "manifest.webmanifest" || p === "favicon.ico" ||
  p.startsWith("_next/") || p.startsWith("icons/");
// The render bake is the arm; the four physics meshes are everything MuJoCo collides against. The other
// fourteen STLs under models/.../assets/ are render-only geometry that nothing loads at runtime any more
// (see stripVisualMeshes in mujoco-loader.ts), so precaching them would put 16.8 MB back on a first visit
// that the loader no longer asks for.
const PHYSICS_MESHES = [
  "wrist_roll_follower_so101_gripper_part0_v1.stl",
  "moving_jaw_so101_gripper_part0_v1.stl",
  "moving_jaw_so101_gripper_part1_v1.stl",
  "wrist_roll_follower_so101_camera_mount.stl",
];
const isModelAsset = (p) => p.includes("/assets/");
const isBulk = (p) =>
  p === "mujoco.js" || p === "mujoco.wasm" || p === "og.png" ||
  p.startsWith("fonts/") || p.startsWith("policies/") || p.startsWith("schemas/") ||
  (p.startsWith("models/") && (!isModelAsset(p) || PHYSICS_MESHES.some((m) => p.endsWith(`/${m}`))));

const shell = all.filter((p) => !SKIP(p) && isShell(p));
const bulk = all.filter((p) => !SKIP(p) && !isShell(p) && isBulk(p));
const ignored = all.filter((p) => !SKIP(p) && !isShell(p) && !isBulk(p));

// Build id: the shell's bytes plus the bulk tier's names and sizes. Any change to a chunk, an icon or a model
// gives a new id, which renames the cache and makes the browser see a byte-different sw.js — without that,
// the worker never updates and a redeploy would be invisible to anyone who already installed the game.
const digest = createHash("sha256");
for (const p of shell) digest.update(p).update(readFileSync(resolve(exportDir, p)));
for (const p of bulk) digest.update(p).update(String(statSync(resolve(exportDir, p)).size));
const buildId = digest.digest("hex").slice(0, 16);

const manifest = { shell: shell.map((p) => `./${p}`), bulk: bulk.map((p) => `./${p}`) };
const template = readFileSync(resolve(repo, "public/sw.js"), "utf8");
const PLACEHOLDER = "/* __TL_PRECACHE__ */ { shell: [], bulk: [] }";
if (!template.includes(PLACEHOLDER) || !template.includes("__TL_BUILD_ID__")) {
  throw new Error("app-sw: public/sw.js no longer has both stamping placeholders");
}
const stamped = template
  .replace("__TL_BUILD_ID__", buildId)
  .replace(PLACEHOLDER, JSON.stringify(manifest, null, 2));
writeFileSync(resolve(exportDir, "sw.js"), stamped);

const bytes = (list) => list.reduce((n, p) => n + statSync(resolve(exportDir, p)).size, 0);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`app-sw: ${exportDir}/sw.js  build ${buildId}`);
console.log(`  shell ${shell.length} files (${mb(bytes(shell))}), bulk ${bulk.length} files (${mb(bytes(bulk))})`);
if (ignored.length > 0) console.log(`  not cached: ${ignored.length} file(s) — ${ignored.slice(0, 6).join(", ")}`);
