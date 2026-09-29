// capacitor.config.ts (WP-D, SCOPE 4.4)
// Mobile shells for the same static export the web, PWA and desktop targets ship. Capacitor copies `out/`
// into a native project and serves it from a local origin, so the game's runtime fetches (mujoco.wasm, the
// MJCF/STL models, the .woff faces) behave exactly as they do on a web host — which is why `webDir` points at
// the export and nothing here rewrites paths.
//
// No Capacitor plugins are installed: the game's own boot screen is the first thing drawn (a splash plugin
// would double the perceived load time) and nothing in it touches a native API.
//
// The native projects are NOT in this repo and are not built on the director's laptop. `npx cap add ios` and
// `npx cap add android` generate them on a machine with the right toolchain; docs/APPS.md has the exact steps.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.torquelimit.game",
  appName: "TORQUE LIMIT",
  webDir: "out",
  // The arena is a WebGL canvas that owns the whole screen: no pull-to-refresh bounce, no overscroll glow, no
  // system background flashing through between frames.
  backgroundColor: "#0E0F14",
  android: {
    backgroundColor: "#0E0F14",
    allowMixedContent: false,
    // The game makes no network calls at runtime; cleartext would only ever help an attacker.
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: "#0E0F14",
    // Rubber-banding on a full-bleed game canvas reads as the arena tearing loose from the HUD.
    scrollEnabled: false,
    contentInset: "never",
  },
  server: {
    // capacitor:// on iOS and https://localhost on Android are secure contexts, which the WASM build and the
    // service worker both require.
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
