// electron/mime.mjs (WP-D, SCOPE 4.1/4.3)
// The one content-type table for the static export. Both things that serve it — scripts/app-serve.mjs for the
// web check and the desktop app's app:// handler — read it from here, because the game fails in obscure ways
// when a type is wrong: a .wasm served as text/plain fails WebAssembly.instantiateStreaming, and a .woff
// served as text/html fails the font load and silently drops the HUD onto a fallback face.
export const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".stl": "model/stl",
  ".obj": "model/obj",
});

/** Content type for a file path, or application/octet-stream when the extension is unknown. */
export function contentTypeFor(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
