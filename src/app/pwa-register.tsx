"use client";
// src/app/pwa-register.tsx (WP-D, SCOPE 4.2)
// Installs the PWA half of the app: the manifest link, the iOS home-screen icon, and the service worker that
// makes the game playable with no network after one load.
//
// It renders nothing and owns no UI — a "new version" toast belongs to the UI layer, not here. When an update
// is ready this dispatches `torquelimit:update-ready` on `window` with an `apply()` callback; WP7's
// `broadcast-ui.tsx` listens for it and offers the reload between matches. Nothing reloads itself mid-match.
//
// Mounted once, at the end of <body> in src/app/layout.tsx.
import { useEffect } from "react";

/** The event `window.dispatchEvent` carries when a newer build is installed and waiting. */
export interface TorqueLimitUpdateReady {
  /** Activates the waiting worker and reloads. Safe to call only when nothing is in play. */
  apply: () => void;
}

/** The window event name; WP7's BroadcastUi listens for it and raises the toast. */
export const UPDATE_EVENT = "torquelimit:update-ready";

/** Adds a <link> to <head> once, keyed by rel, so hand-written markup in layout.tsx always wins. */
function ensureLink(rel: string, href: string, attrs: Record<string, string> = {}): void {
  if (document.querySelector(`link[rel="${rel}"]`)) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
  document.head.appendChild(link);
}

export function PwaRegister(): null {
  useEffect(() => {
    // Every URL is resolved against <base>/the document, never against "/": the export is also served from
    // subdirectories and, in the desktop build, from a custom app:// origin.
    const base = document.baseURI;
    ensureLink("manifest", new URL("manifest.webmanifest", base).href);
    ensureLink("apple-touch-icon", new URL("icons/apple-touch-icon.png", base).href, { sizes: "180x180" });

    if (!("serviceWorker" in navigator)) return;

    // Electron already loads every file from disk, and its app:// origin is not a service-worker context at
    // all: touching the container there rejects with "The document is in an invalid state", which surfaces as
    // an unhandled rejection in the shipped desktop app. Leave it alone entirely.
    const isDesktopShell = / Electron\//.test(navigator.userAgent);
    if (isDesktopShell) return;

    // Dev serves an unstamped worker and unhashed chunks; a worker there would cache a half-built app and
    // then serve it over the next edit. Tear down anything a previous production visit left on this origin.
    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      // getRegistrations() also rejects on any origin the browser treats as insecure (a LAN IP over plain
      // http, which is how the dev server is reached from a phone). Nothing here is worth an error for.
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }

    let cancelled = false;
    // Set only by an explicit apply(). On a first install the worker calls clients.claim(), which also fires
    // controllerchange — reloading on that would yank the page out from under a player who just arrived.
    let applyRequested = false;

    const announce = (waiting: ServiceWorker): void => {
      const detail: TorqueLimitUpdateReady = {
        apply: () => {
          applyRequested = true;
          waiting.postMessage({ type: "TL_SKIP_WAITING" });
        },
      };
      window.dispatchEvent(new CustomEvent<TorqueLimitUpdateReady>(UPDATE_EVENT, { detail }));
    };

    const watch = (registration: ServiceWorkerRegistration): void => {
      if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // "installed" with a controller already present means this is an update, not a first install.
          if (installing.state === "installed" && navigator.serviceWorker.controller && !cancelled) announce(installing);
        });
      });
    };

    // Registering after `load` keeps the worker's install — tens of megabytes of wasm and geometry — off the
    // critical path of the first paint, which is the loading screen the player is already looking at.
    const register = (): void => {
      navigator.serviceWorker
        .register(new URL("sw.js", base).href, { scope: new URL("./", base).href })
        .then((registration) => {
          if (!cancelled) watch(registration);
        })
        .catch((error: unknown) => {
          // A failed registration costs offline play and nothing else; the game must still start.
          console.warn("[tl-pwa] service worker registration failed", error);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // After an applied update the new worker controls this page while the DOM still belongs to the old build;
    // reload once so markup, chunks and cached assets all come from the same build.
    let reloading = false;
    const onControllerChange = () => {
      if (!applyRequested || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}

export default PwaRegister;
