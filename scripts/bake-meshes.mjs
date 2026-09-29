// scripts/bake-meshes.mjs (WP1) — bakes the arm meshes (EMOTION_BIBLE 10.2 step 3).
// Runs the same pipeline the page runs without a bake (parse so101.xml, weld the Menagerie STLs, crease normals,
// edge mask, print axis, merge per (link, material slot), meshopt LOD0 35 % / LOD1 15 % with locked borders) and
// writes the result quantized to public/models/robotstudio_so101/arms.bake, which the page loads instead of the
// 17 MB of STLs. Re-run after touching so101.xml, the STLs or any LOD constant: the page detects a stale bake
// by key and falls back to the STLs with a console warning.
//   node scripts/bake-meshes.mjs            writes the bake and prints the numbers
//   node scripts/bake-meshes.mjs --check    exits 1 when the served bake is missing or stale
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAKE_FILE, bakeKey, decodeBake, encodeBake, linkSlotGeometries, loadRobotAssets, ROBOT_MODEL_BASE_URL, triangleCount,
} from "../src/game/render/robot-assets.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "public", ROBOT_MODEL_BASE_URL);
const out = path.join(modelDir, BAKE_FILE);

const fetchImpl = async (url) => {
  const b = await readFile(path.join(modelDir, url.replace(ROBOT_MODEL_BASE_URL, "")));
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), text: async () => b.toString() };
};

const xml = await readFile(path.join(modelDir, "so101.xml"), "utf8");
if (process.argv.includes("--check")) {
  try {
    const { manifest } = decodeBake((await readFile(out)).buffer);
    if (manifest.key !== bakeKey(xml)) { console.error(`${BAKE_FILE} is stale (key ${manifest.key} ≠ ${bakeKey(xml)})`); process.exit(1); }
    console.log(`${BAKE_FILE} is current (key ${manifest.key})`);
  } catch (err) {
    console.error(`${BAKE_FILE} missing or unreadable: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const t0 = performance.now();
const assets = await loadRobotAssets({ fetchImpl, bake: false, onProgress: (d, t, l) => process.stdout.write(`\r${l.padEnd(60)} ${d}/${t}`) });
process.stdout.write("\n");
if (!assets.simplified) { console.error("meshopt simplifier unavailable: no bake written"); process.exit(1); }
const bake = encodeBake(assets, xml);
await writeFile(out, Buffer.from(bake));
const check = decodeBake(bake);
let lod0 = 0, lod1 = 0;
for (const e of check.bySlot) { lod0 += triangleCount(e.lods.lod0); lod1 += triangleCount(e.lods.lod1); }
console.log(`wrote ${path.relative(root, out)}: ${(bake.byteLength / 1e6).toFixed(2)} MB, key ${check.manifest.key}, ${check.bySlot.length} (link, slot) entries`);
console.log(`triangles per arm: ${assets.trianglesPerArm} full → ${lod0} LOD0 / ${lod1} LOD1  (${(performance.now() - t0).toFixed(0)} ms)`);
for (const e of linkSlotGeometries(assets)) {
  console.log(`  ${e.link.padEnd(13)} ${e.slot.padEnd(11)} ${String(triangleCount(e.lods.lod0)).padStart(6)} / ${String(triangleCount(e.lods.lod1)).padStart(6)}`);
}
