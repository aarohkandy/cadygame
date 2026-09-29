#!/usr/bin/env node
// Copies the show's typefaces from the pinned @fontsource packages into public/fonts/ for WebGL SDF text
// (troika reads .woff, not .woff2) and writes OFL.txt with every family's copyright and license.
// DOM text uses next/font/google instead; these files exist so lobby tiles, deck paint, and the jumbotron
// render the same faces with no runtime network request (BUILD_PLAN D11).
//
//   node scripts/sync-fonts.mjs          copy files that are missing or differ; idempotent, quiet when current
//   node scripts/sync-fonts.mjs --check  verify only; exit 1 when public/fonts/ is stale
//
// `npm run dev` and `npm run build` run the copy form, so a fresh clone gets its fonts without a manual step.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outDir = path.join(root, "public", "fonts");

// Latin subsets only: every string the show renders in WebGL is ASCII copy or numbers.
const FAMILIES = [
  { pkg: "@fontsource/anton", files: ["anton-latin-400-normal.woff"] },
  {
    pkg: "@fontsource/barlow-condensed",
    files: [500, 600, 700, 800, 900].flatMap((w) => [
      `barlow-condensed-latin-${w}-normal.woff`,
      `barlow-condensed-latin-${w}-italic.woff`,
    ]),
  },
  { pkg: "@fontsource/chivo-mono", files: [400, 500, 700].map((w) => `chivo-mono-latin-${w}-normal.woff`) },
];

function packageDir(pkg) {
  return path.dirname(require.resolve(`${pkg}/package.json`, { paths: [root] }));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sameContent(target, want) {
  return existsSync(target) && sha256(readFileSync(target)) === sha256(want);
}

function main() {
  const check = process.argv.includes("--check");
  const stale = [];
  let copied = 0;
  const licenseParts = [
    "Fonts in this directory are copied from @fontsource packages by scripts/sync-fonts.mjs.",
    "Each family is licensed under the SIL Open Font License, Version 1.1, reproduced below per family.",
  ];

  if (!check) mkdirSync(outDir, { recursive: true });

  for (const family of FAMILIES) {
    let dir;
    try {
      dir = packageDir(family.pkg);
    } catch {
      console.error(`sync-fonts: ${family.pkg} is not installed; run npm install.`);
      process.exit(1);
    }
    const version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
    for (const name of family.files) {
      const source = path.join(dir, "files", name);
      if (!existsSync(source)) {
        console.error(`sync-fonts: ${family.pkg}@${version} has no files/${name}`);
        process.exit(1);
      }
      const bytes = readFileSync(source);
      const target = path.join(outDir, name);
      if (sameContent(target, bytes)) continue;
      if (check) stale.push(name);
      else {
        copyFileSync(source, target);
        copied += 1;
      }
    }
    const license = readFileSync(path.join(dir, "LICENSE"), "utf8").trim();
    licenseParts.push(`${"=".repeat(72)}\n${family.pkg}@${version}\n${"=".repeat(72)}\n\n${license}`);
  }

  const ofl = Buffer.from(`${licenseParts.join("\n\n")}\n`, "utf8");
  const oflPath = path.join(outDir, "OFL.txt");
  if (!sameContent(oflPath, ofl)) {
    if (check) stale.push("OFL.txt");
    else {
      writeFileSync(oflPath, ofl);
      copied += 1;
    }
  }

  if (check && stale.length > 0) {
    console.error(`sync-fonts: public/fonts/ is stale (${stale.join(", ")}); run node scripts/sync-fonts.mjs`);
    process.exit(1);
  }
  if (copied > 0) console.log(`sync-fonts: wrote ${copied} file(s) to public/fonts/`);
}

main();
