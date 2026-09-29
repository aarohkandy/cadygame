// electron/main.mjs (WP-D, SCOPE 4.3)
// The desktop shell. It is a window and a file server and nothing else: no Node in the page, no preload
// bridge, no IPC surface. The game inside is the same static export the web and PWA targets ship.
//
// Why a custom app:// scheme instead of file://
//   The game fetches mujoco.wasm, the MJCF/STL models and the .woff faces at runtime. Under file:// those
//   fetches are cross-origin-null and blocked, WebAssembly.instantiateStreaming has no content type to work
//   with, and there is no secure context. A registered standard + secure scheme gives the page a real origin,
//   working fetch, and a correct content type per file — with no HTTP port open on the machine.
import { access, readFile, stat } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, protocol, session, shell } from "electron";
import { contentTypeFor } from "./mime.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const SCHEME = "app";
const ORIGIN = `${SCHEME}://torque-limit`;

// Packaged: the export is copied to Resources/app by electron-builder (see package.json "build"). Unpackaged:
// it is the repo's out/. TL_APP_URL overrides both and points the window at a running `next dev` instead.
const EXPORT_DIR = app.isPackaged ? join(process.resourcesPath, "app") : resolve(here, "..", "out");
const DEV_URL = process.env.TL_APP_URL ?? "";

// Two relaxations, both forced by what the export actually contains, and both measured rather than assumed
// (see docs/APPS.md §3):
//   'unsafe-inline' — Next inlines its RSC payload as a <script> in the prerendered HTML, and a static
//     export has no server to mint a nonce.
//   'unsafe-eval'   — @mujoco/mujoco's Emscripten glue builds its Embind invokers with `new Function(...)`.
//     Without it the physics module never instantiates and the game stops on "BOOT FAILED · Evaluating a
//     string as JavaScript violates...". 'wasm-unsafe-eval' covers compiling the module but not that.
// What the policy still buys is the part that matters for a desktop app: no remote script, no remote style,
// no remote connection, no framing, no plugins, nothing but files shipped inside the bundle. The game makes
// no network calls at runtime, so connect-src never needs a host, and onBeforeRequest below cancels every
// non-app:// request outright rather than trusting this header alone.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/** Resolves an app:// pathname to a real file inside the export, or null if it escapes or is missing. */
async function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const abs = rel === "" ? join(EXPORT_DIR, "index.html") : resolve(EXPORT_DIR, rel);
  if (abs !== EXPORT_DIR && !abs.startsWith(EXPORT_DIR + sep)) return null;
  try {
    const info = await stat(abs);
    if (info.isDirectory()) {
      const index = join(abs, "index.html");
      await access(index);
      return index;
    }
    return abs;
  } catch {
    return null;
  }
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const file = await resolveAsset(new URL(request.url).pathname);
    if (!file) {
      // One client route: anything unresolved is a navigation into the app, answered with the shell.
      const shellFile = await resolveAsset("/index.html");
      if (!shellFile) return new Response("Export missing", { status: 500, headers: { "content-type": "text/plain" } });
      return new Response(await readFile(shellFile), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(await readFile(file), { headers: { "content-type": contentTypeFor(file) } });
  });
}

function hardenSession(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] } });
  });
  // The game needs exactly two permissions. Everything else — camera, microphone, geolocation, notifications,
  // clipboard, MIDI — is denied, and denied by policy rather than by never being asked for.
  const ALLOWED = new Set(["pointerLock", "fullscreen"]);
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED.has(permission));
  // Nothing in this app loads a remote resource; refuse every one rather than trusting the CSP alone.
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    const allowed = details.url.startsWith(`${SCHEME}://`) || (DEV_URL !== "" && details.url.startsWith(DEV_URL));
    callback({ cancel: !allowed });
  });
}

function applicationMenu() {
  // A game window with no menu loses Cmd+Q, Cmd+H and the Services menu on macOS, which reads as broken.
  // This is the smallest menu that keeps the platform's own shortcuts working; there are no app commands.
  const template = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" }]
      : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { label: "View", submenu: [{ role: "togglefullscreen" }, { type: "separator" }, { role: "reload" }] },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: "#0E0F14",
    title: "TORQUE LIMIT",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      // The page is untrusted-by-construction: it gets no Node, no remote module, no preload, its own
      // isolated world, and the OS sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      // The arena is a full-bleed WebGL canvas; a background throttle stalls the physics loop when the
      // window is behind another and the match would jump on return.
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // No part of the game opens a window or navigates away. A link that tries goes to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const home = new URL(DEV_URL || `${ORIGIN}/`);
    if (target.origin !== home.origin) {
      event.preventDefault();
      if (/^https?:$/.test(target.protocol)) void shell.openExternal(url);
    }
  });
  // A page that dies of a CSP violation or a bad chunk is replaced by Chromium's grey "This page couldn't
  // load" card, and in a packaged app there is no console to open and no server log to read. Forwarding the
  // renderer's own errors to the process that launched the app is the only way to see why.
  win.webContents.on("console-message", (event) => {
    if (event.level !== "error") return;
    const where = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : "";
    console.error(`[tl-desktop] renderer: ${event.message}${where}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[tl-desktop] renderer gone: ${details.reason} (exit ${details.exitCode})`);
  });
  // Without this, a failed main-frame load is just Chromium's grey "This page couldn't load" card with no
  // reason anywhere — the single hardest failure to diagnose in a packaged app, because there is no console
  // to open and no server log to read.
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 is ERR_ABORTED: a superseded navigation, not a failure.
    console.error(`[tl-desktop] load failed: ${description} (${code}) for ${url}`);
  });

  void win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
  return win;
}

// A second copy would fight the first for pointer lock and the gamepad.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    if (!DEV_URL) {
      try {
        await access(join(EXPORT_DIR, "index.html"));
      } catch {
        console.error(`[tl-desktop] no static export at ${EXPORT_DIR}. Run \`npm run build:web\` first.`);
        app.quit();
        return;
      }
      registerProtocol();
    }
    hardenSession(session.defaultSession);
    Menu.setApplicationMenu(applicationMenu());
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
