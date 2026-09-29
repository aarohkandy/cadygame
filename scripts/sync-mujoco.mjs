#!/usr/bin/env node
// Guards the vendored MuJoCo runtime in public/ against the pinned @mujoco/mujoco package.
//
//   node scripts/sync-mujoco.mjs          verify; exit 1 when public/mujoco.{js,wasm} differ from the package
//   node scripts/sync-mujoco.mjs --write  copy the package runtime into public/, then verify
//
// `npm run dev` and `npm run build` run the verify form, so a stale or hand-edited WASM fails the build
// instead of shipping a runtime whose physics differs from the one Node tests and the eval CLI use.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const FILES = ["mujoco.js", "mujoco.wasm"];

function packageDir() {
  // The package's "exports" map hides package.json, so resolve an exported file and take its directory.
  const wasm = require.resolve("@mujoco/mujoco/mujoco.wasm", { paths: [root] });
  return path.dirname(wasm);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function main() {
  const write = process.argv.includes("--write");
  const pkgDir = packageDir();
  const version = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  const mismatches = [];

  for (const name of FILES) {
    const source = path.join(pkgDir, name);
    const target = path.join(root, "public", name);
    if (!existsSync(source)) {
      console.error(`sync-mujoco: @mujoco/mujoco@${version} has no ${name}; reinstall dependencies.`);
      process.exit(1);
    }
    if (write) copyFileSync(source, target);
    if (!existsSync(target)) {
      mismatches.push(`${name}: missing from public/`);
      continue;
    }
    const want = sha256(source);
    const have = sha256(target);
    if (want !== have) mismatches.push(`${name}: public ${have.slice(0, 12)} != package ${want.slice(0, 12)}`);
  }

  if (mismatches.length > 0) {
    console.error(`sync-mujoco: public/ runtime does not match @mujoco/mujoco@${version}`);
    for (const line of mismatches) console.error(`  ${line}`);
    console.error("  run `node scripts/sync-mujoco.mjs --write` to copy the pinned runtime");
    process.exit(1);
  }
  if (write) console.log(`sync-mujoco: copied @mujoco/mujoco@${version} runtime into public/`);
}

main();
