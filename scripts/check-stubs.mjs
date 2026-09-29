#!/usr/bin/env node
// Fails while any package still ships a stub. Stub files carry exactly one marker export:
//   export const __STUB__ = "WPn";
// The owning package deletes the marker when its real implementation lands (BUILD_PLAN section 3).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["src", "scripts"];
const EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);
const MARKER = /export\s+const\s+__STUB__\s*=\s*["'](WP\d)["']/;
const SELF = path.join("scripts", "check-stubs.mjs");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(name))) yield full;
  }
}

const hits = [];
for (const top of SCAN) {
  const dir = path.join(root, top);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of walk(dir)) {
    const rel = path.relative(root, file);
    if (rel === SELF) continue;
    const match = MARKER.exec(readFileSync(file, "utf8"));
    if (match) hits.push({ rel, owner: match[1] });
  }
}

if (hits.length > 0) {
  const byOwner = new Map();
  for (const hit of hits) byOwner.set(hit.owner, [...(byOwner.get(hit.owner) ?? []), hit.rel]);
  console.error(`check-stubs: ${hits.length} stub file(s) remain`);
  for (const [owner, files] of [...byOwner.entries()].sort()) {
    console.error(`  ${owner}`);
    for (const file of files.sort()) console.error(`    ${file}`);
  }
  process.exit(1);
}
console.log("check-stubs: no stubs remain");
