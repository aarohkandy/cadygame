# Shipping TORQUE LIMIT

One codebase, four ship targets (SCOPE §4). All four serve the **same artefact**: the static export in
`out/`, produced by `npm run build:web`. Nothing is rebuilt per target — the web host, the service worker,
the desktop shell and the mobile shells all read those files.

```
src/ ──(next build, TL_EXPORT=1)──▶ out/ ──┬──▶ any static host            (web)
                                           ├──▶ + sw.js / manifest        (PWA, installable, offline)
                                           ├──▶ + electron/               (desktop .app / .dmg)
                                           └──▶ + capacitor               (iOS / Android)
```

Every command below is marked **[run]** if it was actually executed for this document, or **[not run]**
with the reason. Runs happened on the Linux box (`homebase`, 8 vCPU, software GL), never on the
director's laptop.

---

## 0. One-time setup

```bash
npm install          # [not run here — the tree was already installed] Node >= 22.18 ("engines")
```

Disk: `node_modules` is ~1.0 GB, of which the packaging toolchain is ~324 MB (`electron` 311 MB,
`app-builder-lib` 11 MB, `@capacitor/*` 1.7 MB, `electron-builder` + `dmg-builder` <1 MB). Well inside the
2 GB budget in SCOPE §4. No Xcode, Android Studio, Android SDK or Rust is installed, and none is needed
for any command in sections 1–3.

---

## 1. Web

### Development

```bash
npm run dev                       # http://localhost:3000
npm run dev -- -p 3100            # when 3000 is taken by another project
```

Syncs the vendored `mujoco.wasm` and the three font families into `public/`, then starts Next.
**[run]** as a check, not as a start: a dev server was already up on port 3100 and answered `200` with the
current tree (`<title>TORQUE LIMIT · Live from the benchtop</title>`), so nothing new was started.
The service worker is **deliberately inactive** in dev: `PwaRegister` unregisters any worker a previous
production visit left on the origin, so an edit is never served from a stale cache.

### Production export

```bash
npm run build:web                 # [run] → out/
npm run app:serve                 # [run, on port 4319] → http://127.0.0.1:4300 by default
```

`build:web` (`scripts/app-build-web.mjs`) runs `next build` with `TL_EXPORT=1`, which turns on
`output: "export"` in `next.config.ts`, then stamps the service worker for that build. It writes its
intermediate build into `.next-export/`, so it can be run **while `npm run dev` is up** without wiping the
dev server's `.next`.

Measured on homebase, 2026-09-20:

| | |
|---|---|
| export size | 33 MB (`out/`) |
| entry HTML | 16 KB, prerendered, one client route |
| precached | 120 files — shell 74 (3.3 MB), bulk 46 (28.5 MB) |
| heaviest asset | `mujoco.wasm`, 10.1 MB |

Host requirements: **none beyond correct MIME types.** No Node runtime, no rewrites, no headers are
required. `.wasm` must be `application/wasm` and `.woff/.woff2` must be a font type, or the physics
module and the HUD faces fail in ways that look like game bugs. `scripts/app-serve.mjs` and the desktop
shell share one table for exactly this reason (`electron/mime.mjs`). Verified over HTTP on the box:
`/` → `text/html`, `/mujoco.wasm` → `application/wasm` (10 125 422 bytes),
`/manifest.webmanifest` → `application/manifest+json`, unknown paths → 404 with `404.html`.

The export is relocatable: every URL it emits is relative, so serving it from `https://host/games/tl/`
works with no config change.

---

## 2. PWA

Files: `public/manifest.webmanifest`, `public/icons/**`, `public/sw.js` (template),
`scripts/app-sw.mjs` (stamps it), `src/app/pwa-register.tsx` (mounted in `src/app/layout.tsx`).

- **Manifest** — fullscreen, landscape, `theme_color`/`background_color` `#0E0F14`, `start_url` and
  `scope` both `./` so a subdirectory install works.
- **Icons** — 192/512 `any`, 192/512 `maskable` (drawn inside the 80 % safe circle), a 180 px
  `apple-touch-icon`, and `icon.svg`. Regenerate from the in-game wordmark with
  `npm run app:icons`. **[run]** as `--no-raster` into a scratch directory: the two SVGs it produced are
  byte-identical to the committed ones. It writes the PNGs only when a Playwright Chromium is reachable
  (`TL_PLAYWRIGHT`/`TL_CHROME`), and leaves the committed PNGs untouched otherwise.
- **Service worker** — one versioned cache per build. `shell` (HTML, hashed chunks, manifest, icons) must
  cache completely or the install fails and the previous worker keeps serving; `bulk` (`mujoco.wasm`, the
  MJCF/STL models, the `.woff` faces, the example policy and schemas) is added file-by-file so one failure
  costs one asset, not the offline install.
- **Updates never interrupt a match.** A waiting worker fires `torquelimit:update-ready` on `window` with
  an `apply()` callback; nothing calls it automatically, so a new build lands on the next cold start.

### Install

- **Chrome / Edge (desktop + Android):** open the site, then the install icon in the address bar.
- **Safari (iOS/iPadOS):** Share → *Add to Home Screen*. iOS ignores `display: fullscreen` and uses
  `standalone` from `display_override`.
- The export must be served over **HTTPS or `http://localhost`** — a service worker will not register on a
  plain-HTTP LAN address, so phone testing over `http://192.168.x.x:3000` gives you the game without
  offline support. That is expected, not a bug.

### Offline verification — **[run]**, homebase, 2026-09-20

`node ~/tl-tools/aread-pwa.mjs http://127.0.0.1:4319 /tmp/aread-pwa` — headless Chromium, software GL:

1. Loads the export. The page registers its own worker (nothing is registered by the harness):
   scope `http://127.0.0.1:4319/`, active. `<link rel=manifest>`, `apple-touch-icon` and
   `theme-color` are all present in `<head>`.
2. Precache completes: **120 entries** — `index.html`, `mujoco.wasm`, `manifest.webmanifest`,
   4 MJCF `.xml`, 19 `.stl`, 50 font files, 61 chunks, 8 icons.
3. Network is switched **offline**, then the page is **reloaded cold**. It boots from cache
   (`serviceWorker.controller` present), reaches the arena, and three Enter presses walk it into a live
   match: WebGL canvas 1600×900, context not lost, HUD showing `PILOT 100 / 0:45 / JIG 100 / ROUND 1`.
4. **Zero** page errors and **zero** failed requests, online or offline.

---

## 3. Desktop (macOS, Apple Silicon)

Files: `electron/main.mjs`, `electron/mime.mjs`, `scripts/app-desktop.mjs`, the `build` block in
`package.json`. Output goes to `dist-app/` (gitignored).

```bash
npm run dev                       # terminal 1
npm run app:dev                   # [not run as-is] the shell against the dev server
npm run app:mac                   # [not run] builds the export, then packages .app + .dmg
```

`app:dev` refuses to launch with a clear message if nothing is serving the URL, instead of opening a blank
window. `app:mac` **[not run here]**: it produces a macOS `.app`/`.dmg` and only runs on macOS, and this
work was done from a Linux box under a standing rule to keep the director's laptop free. It is one command
and needs no arguments. It always rebuilds `out/` first (packaging a stale export is the failure mode that
looks like a code bug), copies the 1024 px icon into `electron/build/`, and runs `electron-builder --mac
--arm64` with `CSC_IDENTITY_AUTO_DISCOVERY=false`.

The result is **unsigned and un-notarised** — there is no Developer ID for this build. macOS will refuse
the first launch from Finder; **right-click → Open → Open** once, and thereafter it opens normally.
Expected size: the Electron runtime (~250 MB) plus the 33 MB export; the `.dmg` compresses to well under
half of that. Not measured here, because the build was not run.

### What was verified — **[run]**, homebase, 2026-09-20

`npm run app:dev` and `npm run app:mac` were not run here (both want a desktop session; `--mac` wants
macOS). What *was* run is the thing they launch: `electron/main.mjs` loading the real export, headless
under Xvfb with software GL, driven over CDP —
`node ~/tl-tools/app-electron.mjs /tmp/tl-build`. From inside that window:

- origin `app://torque-limit`, `isSecureContext: true`
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload, no remote module —
  probed from the page, `require`, `process`, `module` and `global` are all undefined
- **pointer lock: available · gamepad API: available**
- the CSP below arrives on every response
- the game **plays**: title screen → mount select → green room → live match with the HUD up
  (`PILOT 100 / 0:45 / JIG 100 / ROUND 1`), WebGL context alive, **zero** page errors

The page is loaded over a registered **`app://` scheme** rather than `file://`. Under `file://` the
runtime fetches (wasm, models, fonts) are cross-origin-null and blocked, and there is no secure context.

### The CSP, and the one directive that is not strict

```
default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
media-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

`'unsafe-eval'` is there because the game does not start without it, which was measured rather than
assumed. With it removed, the window shows Chromium's grey "This page couldn't load" card; bisecting the
policy directive by directive found two callers that build a function from a string:

1. the engine's Node-only loader shim, `Function("s", "return import(s)")`, evaluated at module scope —
   stubbing it out lets the document render, and then
2. `@mujoco/mujoco`'s Emscripten glue, which builds its Embind invokers with `new Function(...)`. The game
   then stops on **"BOOT FAILED · Evaluating a string as JavaScript violates..."**. This one is inside a
   prebuilt wasm package; short of rebuilding MuJoCo with `-sDYNAMIC_EXECUTION=0` there is no way around
   it. `'wasm-unsafe-eval'` covers compiling the module, not this.

What the policy still buys is what matters for a desktop app: no remote script, no remote style, no remote
connection, no framing, no plugins — nothing but files shipped inside the bundle. On top of it,
`onBeforeRequest` cancels every request that is not `app://`, so the window cannot reach the network at
all, and the renderer has no Node to reach for.

A web host that puts its own CSP in front of the export needs the same two relaxations for the same two
reasons.

### When the desktop window comes up empty

A page killed by a CSP violation or a bad chunk is replaced by Chromium's grey card, and a packaged app
has no console to open. The main process therefore forwards the renderer's own errors, so the reason
prints in the terminal that launched the app:

```
[tl-desktop] renderer: Uncaught EvalError: Evaluating a string as JavaScript violates the following
  Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: ...
  (app://torque-limit/_next/static/chunks/0fvzl4ck6vjr5.js:1)
```

That is verbatim from a run with `'unsafe-eval'` removed **[run]** — the check that this forwarding
actually works, and the only reason the cause above was findable at all.

---

## 4. Mobile (iOS / Android)

`capacitor.config.ts` is committed and points `webDir` at `out/`. **No native project is in this repo and
none was built here** — `npx cap add` requires Xcode or Android Studio + the Android SDK, and SCOPE §4
forbids installing any of them on this machine. Everything in this section is **[not run]**.

On a machine that has the right toolchain:

```bash
npm install
npm run build:web                 # produces out/, which is what Capacitor copies

npx cap add ios                   # macOS + Xcode only; creates ios/ (gitignored)
npx cap add android               # Android Studio + SDK; creates android/ (gitignored)

npx cap sync                      # re-copy out/ + config into the native projects; run after every build
npx cap open ios                  # opens Xcode      → run on a device/simulator from there
npx cap open android              # opens Android Studio → Run
```

Notes that will bite:

- **`npx cap sync` after every `npm run build:web`.** Capacitor copies `out/` into the native project; it
  does not read it live. A native build without a sync ships the previous export.
- **Landscape only.** The manifest says so for the PWA, but a native shell needs it set in the project:
  `ios/App/App/Info.plist` → `UISupportedInterfaceOrientations` = the two landscape values;
  `android/app/src/main/AndroidManifest.xml` → `android:screenOrientation="landscape"` on the activity.
- **No Capacitor plugins are installed**, on purpose: the game draws its own boot screen, and a splash
  plugin would double the perceived load. Nothing in the game calls a native API.
- **Touch controls ship in the web build** (Area J, `src/app/mobile.css` + `src/game/ui/touch/`), so the
  mobile shells need no extra input layer.
- The PWA is the supported way to play on a phone today: it installs from Safari and Chrome, runs
  fullscreen, and works offline. The Capacitor shells exist for store distribution.

---

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| `app-build-web: next build produced no index.html` | `TL_EXPORT=1` did not reach `next.config.ts`; run the script, not `next build` |
| Game boots but the HUD is in a fallback face | the host is serving `.woff` as `text/html`; fix MIME types |
| `WebAssembly.instantiateStreaming` fails | `.wasm` is not served as `application/wasm` |
| Desktop window shows "This page couldn't load" | the export is missing (`npm run build:web`) or something in the bundle violated the CSP — the main process now prints the renderer error that caused it |
| Service worker never registers | not HTTPS and not `localhost`, or you are in dev (intentional) |
| Update never appears | by design — a waiting worker applies on the next cold start |
