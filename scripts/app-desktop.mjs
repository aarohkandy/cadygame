#!/usr/bin/env node
// scripts/app-desktop.mjs (WP-D, SCOPE 4.3)
// The two desktop commands, behind one script so `npm run app:dev` and `npm run app:mac` stay single commands.
//
//   node scripts/app-desktop.mjs --dev [url]   launch the Electron shell against a running `next dev`
//   node scripts/app-desktop.mjs --mac         build the static export and package an unsigned arm64 app
//
// --mac is macOS-only (it produces a .app and a .dmg) and always builds the export first, because packaging a
// stale out/ is the one failure mode that looks like a code bug in the shipped app.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args[0];
if (mode !== "--dev" && mode !== "--mac") {
  console.error("usage: node scripts/app-desktop.mjs --dev [url] | --mac");
  process.exit(2);
}

function run(cmd, cmdArgs, env = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: repo, stdio: "inherit", env: { ...process.env, ...env } });
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

if (mode === "--dev") {
  const url = args[1] ?? process.env.TL_APP_URL ?? "http://localhost:3000";
  // Electron shows a blank window against a dev server that is not up yet, which reads as a renderer crash.
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.error(`app-desktop: nothing is serving ${url} (${error instanceof Error ? error.message : String(error)}).`);
    console.error("  start the game first:  npm run dev");
    console.error("  or point the shell somewhere else:  npm run app:dev -- http://127.0.0.1:3000");
    process.exit(1);
  }
  run(npx, ["electron", "."], { TL_APP_URL: url });
} else {
  if (process.platform !== "darwin") {
    console.error(`app-desktop: --mac builds a .app/.dmg and only runs on macOS (this is ${process.platform}).`);
    console.error("  the static export itself is platform-independent:  npm run build:web");
    process.exit(1);
  }
  run(process.execPath, ["scripts/app-build-web.mjs"]);

  // electron-builder takes the mac icon from buildResources/icon.png; keep it generated from the wordmark
  // rather than checked in twice.
  const iconSource = resolve(repo, "public/icons/icon-1024.png");
  const iconTarget = resolve(repo, "electron/build/icon.png");
  if (!existsSync(iconSource)) {
    throw new Error(`app-desktop: ${iconSource} is missing — run \`npm run app:icons\` (needs a Chromium; see docs/APPS.md)`);
  }
  mkdirSync(dirname(iconTarget), { recursive: true });
  copyFileSync(iconSource, iconTarget);

  // Unsigned on purpose: there is no Developer ID for this build. CSC_IDENTITY_AUTO_DISCOVERY=false stops
  // electron-builder picking up whatever certificate happens to be in the login keychain.
  run(npx, ["electron-builder", "--mac", "--arm64", "--publish", "never"], { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  console.log("app-desktop: packaged into dist-app/ (unsigned — first launch needs right-click → Open)");
}
