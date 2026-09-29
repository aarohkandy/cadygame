#!/usr/bin/env node
// scripts/app-serve.mjs (WP-D, SCOPE 4.1)
// Static file server for the production export. Not part of the game: it exists so `npm run app:serve` can
// prove the export is host-agnostic — plain files, correct MIME types, no Node runtime behind them.
//
//   node scripts/app-serve.mjs [dir] [--port 4300] [--host 127.0.0.1]
//
// Why not `npx serve`: the export ships mujoco.wasm, .woff faces and MJCF/STL models, and a real static host
// gets their content types right. This one shares that table with the desktop app (electron/mime.mjs), so the
// check models what the game will actually be served.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { CONTENT_TYPES } from "../electron/mime.mjs";

const TYPES = CONTENT_TYPES;

function parseArgs(argv) {
  const opts = { dir: "out", port: 4300, host: "127.0.0.1" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") opts.port = Number(argv[++i]);
    else if (a === "--host") opts.host = argv[++i];
    else rest.push(a);
  }
  if (rest[0]) opts.dir = rest[0];
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error(`app-serve: --port must be 1..65535, got ${String(opts.port)}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const root = resolve(process.cwd(), opts.dir);
try {
  if (!statSync(root).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`app-serve: ${root} is not a directory. Run \`npm run build:web\` first.`);
  process.exit(1);
}

/** Maps a request path to a file inside root, or null when it escapes the root or does not exist. */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const abs = resolve(root, rel);
  // A path that normalises outside the root is a traversal attempt; refuse it rather than reading it.
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  for (const candidate of abs.endsWith(sep) || rel === "" ? [join(abs, "index.html")] : [abs, join(abs, "index.html"), `${abs}.html`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");
  if (!file) {
    const notFound = resolveFile("/404.html");
    res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    if (notFound && req.method !== "HEAD") { createReadStream(notFound).pipe(res); return; }
    res.end("404");
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Hashed chunks under /_next/static are immutable; everything else must revalidate so a redeploy is picked
  // up. The service worker does the offline caching, so nothing here needs a long heuristic TTL.
  const immutable = file.includes(`${sep}_next${sep}static${sep}`);
  const size = statSync(file).size;
  res.writeHead(200, {
    "content-type": type,
    "content-length": size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    // Same-origin isolation headers keep SharedArrayBuffer available if the physics build ever wants threads.
    "cross-origin-resource-policy": "same-origin",
  });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
});

server.listen(opts.port, opts.host, () => {
  console.log(`app-serve: ${root} → http://${opts.host}:${opts.port}`);
});
