import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

// The four ship targets (SCOPE 4) come out of this one config. `TL_EXPORT=1` switches the build to a fully
// static export in `out/` — the artefact the web host, the PWA and the Electron wrapper all serve. It is
// opt-in so `npm run build` and the long-running dev server keep behaving exactly as they did: static export
// disables `next start`, image optimisation and on-demand rendering, none of which the game uses, but all of
// which the existing scripts assume are available.
const staticExport = process.env.TL_EXPORT === "1";

const nextConfig: NextConfig = {
  // A production build and the long-running dev server cannot share one output directory: the build wipes
  // .next while dev is still serving out of it. TL_DIST_DIR lets a verification build write somewhere else
  // without stopping the dev server.
  distDir: process.env.TL_DIST_DIR || ".next",
  // Static export: one prerendered index.html plus hashed chunks, servable by any file server. The game is a
  // single client route that fetches mujoco.wasm, the MJCF/STL models and the .woff faces from /public at
  // runtime, so nothing here needs a Node server. `images.unoptimized` is required by the export (there is no
  // optimiser to call) and is a no-op otherwise: the only raster asset is /og.png, used as a plain URL.
  ...(staticExport ? { output: "export" as const, images: { unoptimized: true } } : {}),
  // React StrictMode's simulated remount is incompatible with @react-three/fiber's WebGL lifecycle: its
  // Canvas cleanup calls unmountComponentAtNode(), which 500 ms later runs forceContextLoss() and deletes
  // the root keyed by the canvas element. StrictMode re-mounts onto the *same* canvas element first, so the
  // deferred teardown destroys the live context — every dev session lost the GL context ~500 ms after the
  // arena mounted and never rendered another frame. Production never double-invokes effects, so turning this
  // off makes dev match the shipped build instead of breaking only in dev.
  reactStrictMode: false,
  // The dev server runs on homebase and is reached through a tunnel, so the browser's Origin is a loopback
  // address that Next does not recognise as its own host. Without this, every /_next/* chunk request is
  // answered with 403 and the app never boots — an empty page with no canvas, which looks exactly like a
  // renderer crash. Dev-only allowance; it has no effect on the production build.
  allowedDevOrigins: ["127.0.0.1", "localhost", "100.108.213.121"],

  // The dev-tools badge floats over the bottom-left corner of a full-bleed game canvas, where it reads as a
  // broken-image glyph on top of the arena and shows up in every screenshot. Nothing here needs it.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_GIT_SHA: gitSha(),
  },
  logging: {
    browserToTerminal: "error",
  },
};

export default nextConfig;
