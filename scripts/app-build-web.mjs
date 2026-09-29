#!/usr/bin/env node
// scripts/app-build-web.mjs (WP-D, SCOPE 4.1/4.2)
// Produces the one artefact all three non-mobile ship targets serve: a fully static export of the game.
//
//   node scripts/app-build-web.mjs [--out out] [--keep-dist]
//
// Steps: sync the vendored MuJoCo + font files into public/, run `next build` with TL_EXPORT=1 (which turns on
// `output: "export"`), move the exported tree to --out, then stamp the service worker with this build's
// precache list. The result is plain files: no Node server, no image optimiser, no rewrite rules.
//
// Next writes the export either into the build's distDir or into ./out depending on version and config, so
// this script pins distDir to a scratch directory and finds the tree that actually has index.html. That also
// keeps a verification build from wiping the .next a running `next dev` is serving out of.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let outDir = "out";
let keepDist = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" || args[i] === "-o") outDir = args[++i];
  else if (args[i] === "--keep-dist") keepDist = true;
  else throw new Error(`app-build-web: unknown argument ${args[i]}`);
}
const out = resolve(repo, outDir);
const distDir = ".next-export";
const dist = resolve(repo, distDir);

function run(cmd, cmdArgs, env) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: repo, stdio: "inherit", env: { ...process.env, ...env } });
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

run(process.execPath, ["scripts/sync-mujoco.mjs"]);
run(process.execPath, ["scripts/sync-fonts.mjs"]);
rmSync(dist, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
run(npx, ["next", "build"], { TL_EXPORT: "1", TL_DIST_DIR: distDir });

// Whichever of the two trees holds the prerendered entry point is the export.
const candidates = [dist, resolve(repo, "out")];
const exported = candidates.find((dir) => existsSync(resolve(dir, "index.html")));
if (!exported) {
  throw new Error(
    `app-build-web: next build produced no index.html in ${candidates.join(" or ")}. ` +
      "The export step did not run — check that TL_EXPORT=1 reached next.config.ts.",
  );
}
if (exported !== out) {
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { recursive: true, force: true });
  cpSync(exported, out, { recursive: true });
}
if (!keepDist && exported === dist) rmSync(dist, { recursive: true, force: true });

// The service worker's precache list is only knowable once the hashed chunks exist.
run(process.execPath, ["scripts/app-sw.mjs", out]);

for (const required of ["index.html", "mujoco.wasm", "sw.js", "manifest.webmanifest"]) {
  const path = resolve(out, required);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`app-build-web: export is missing ${required} — ${path} does not exist`);
  }
}
console.log(`app-build-web: static export ready at ${out}`);
console.log("  serve it with:  node scripts/app-serve.mjs out --port 4300");
