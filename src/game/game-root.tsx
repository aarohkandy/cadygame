// src/game/game-root.tsx (WP6)
// Client-only root (loaded through client-entry.tsx with ssr: false). Creates the GameHandle once per page,
// hands over to the director's attract as soon as the physics and the handle exist (EMOTION_BIBLE 2: the arena
// shell first, the CTA reads `LOADING %` while the audio graph synthesizes), mounts WP1's ArenaCanvas under
// WP7's BroadcastUi, owns the document-level hooks (visibility pause, pointer-lock changes), records the
// auto-clip during the earned match replay (8.3), and serves the ?debug=bench route.
"use client";

import { useEffect, useState, useSyncExternalStore, type JSX } from "react";
import type { GameHandle } from "./contracts.ts";
import { createGame, type CreateGameProgress } from "./game-handle.ts";
import { ArenaCanvas } from "./render/arena-canvas.tsx";
import { prewarmStatus } from "./render/prewarm.ts";
import { BroadcastUi } from "./ui/broadcast-ui.tsx";
import { BootScreen } from "./ui/screens/boot-screen.tsx";
import { lastClip, startClip, type ClipRecorder } from "./ui/screens/clip-recorder.ts";
import { runBrowserBench } from "./physics/bench-browser.ts";
import * as matchConfig from "./match/match-config.ts";
import { dailyBout, showKitFor } from "./match/match-config.ts";
import { sharedProfile } from "./ui/meta/profile.ts";

/** Share of the bar the handle build takes; audio preparation fills the rest. */
const HANDLE_SHARE = 0.8;
/** Longest the CTA waits for the shader prewarm to link before it opens anyway (bible 2: ≤ 1.5 s compile hold). */
const PREWARM_HOLD_MS = 1500;

/* ───────────────────────── one-time creation ───────────────────────── */

let bootProgress: CreateGameProgress = { progress: 0, label: "" };
const progressListeners = new Set<() => void>();
let gamePromise: Promise<GameHandle> | null = null;

function setBootProgress(p: CreateGameProgress): void {
  bootProgress = { progress: Math.min(1, Math.max(bootProgress.progress, p.progress)), label: p.label };
  for (const fn of Array.from(progressListeners)) fn();
}

function subscribeBootProgress(fn: () => void): () => void {
  progressListeners.add(fn);
  return () => { progressListeners.delete(fn); };
}

/**
 * Builds the handle and hands over to the attract at once; the audio graph then synthesizes behind the title's
 * `LOADING %` CTA (ui.loading), which clears to `CLICK TO FIGHT` when it is done. Runs once per page load.
 */
/**
 * True when this browser can actually run the show. Probed BEFORE the model download, because without it an
 * unsupported browser pays for every byte and then dies inside the renderer with a blank page; BootScreen
 * already renders `BOOT FAILED · <message>` from a rejection, so failing early turns that into one clear line.
 */
function webgl2Missing(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") === null;
  } catch {
    return true;
  }
}

function bootGame(): Promise<GameHandle> {
  if (gamePromise) return gamePromise;
  gamePromise = (async () => {
    if (webgl2Missing()) throw new Error("THIS BROWSER HAS NO WEBGL 2 · TRY CHROME, EDGE, SAFARI 15+ OR FIREFOX");
    const game = await createGame({ onProgress: (p) => setBootProgress({ progress: p.progress * HANDLE_SHARE, label: p.label }) });
    game.director.enterTitle();
    const publish = (p: CreateGameProgress) => {
      setBootProgress(p);
      game.ui.set({ loading: { progress: bootProgress.progress, label: bootProgress.label } });
    };
    publish({ progress: HANDLE_SHARE, label: "building audio graph" });
    void game.feedback.audio.prepare((done, total) => {
      const f = total > 0 ? done / total : 1;
      publish({ progress: HANDLE_SHARE + (1 - HANDLE_SHARE) * f, label: `synthesizing audio · ${done}/${total}` });
    }).catch(() => { /* a failed synth never blocks the click: the game plays silent */ }).then(async () => {
      // The click holds on the amber blink until the shader prewarm has linked (bible 2 t₀, ≤ 1.5 s); a page whose
      // canvas never prewarms (no WebGL, a hidden tab) is released after the cap so the CTA can never hang.
      const t0 = performance.now();
      while (!prewarmStatus.ready && performance.now() - t0 < PREWARM_HOLD_MS) {
        publish({ progress: 0.98, label: "compiling shaders" });
        await new Promise((r) => setTimeout(r, 50));
      }
      setBootProgress({ progress: 1, label: "ready" });
      game.ui.set({ loading: null });
    });
    return game;
  })();
  return gamePromise;
}

/* ───────────────────────── boot surface ───────────────────────── */

/** WP7's branded boot screen, driven by the real boot progress this module publishes. */
function BootSurface(props: { error: string | null }): JSX.Element {
  const p = useSyncExternalStore(subscribeBootProgress, () => bootProgress, () => bootProgress);
  return <BootScreen progress={p.progress} label={p.label} error={props.error} />;
}

/* ───────────────────────── ?debug=bench ───────────────────────── */

function BenchRoute(): JSX.Element {
  const [report, setReport] = useState<string>("running physics bench");
  useEffect(() => {
    let live = true;
    runBrowserBench().then(
      (r) => { if (live) setReport(JSON.stringify(r, null, 2)); },
      (err: unknown) => { if (live) setReport(err instanceof Error ? err.message : String(err)); },
    );
    return () => { live = false; };
  }, []);
  return (
    <main className="min-h-dvh overflow-x-auto bg-[#0E0F14] px-4 py-6 text-[#F6F3EC]">
      <pre className="font-mono text-sm">{report}</pre>
    </main>
  );
}

/* ───────────────────────── root ───────────────────────── */

function useGame(): { game: GameHandle | null; error: string | null } {
  const [state, setState] = useState<{ game: GameHandle | null; error: string | null }>({ game: null, error: null });
  useEffect(() => {
    let live = true;
    bootGame().then(
      (game) => { if (live) setState({ game, error: null }); },
      (err: unknown) => { if (live) setState({ game: null, error: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { live = false; };
  }, []);
  return state;
}

/**
 * The auto-clip (8.3, match 3+): record the canvas through the earned match replay, keep the result for SAVE CLIP.
 * Subscribes to the UI store, so it costs nothing per frame; the recorder itself draws at 30 fps while it runs.
 */
function useAutoClip(game: GameHandle | null): void {
  useEffect(() => {
    if (!game) return;
    let rec: ClipRecorder | null = null;
    let phase = game.ui.get().phase;
    const unsub = game.ui.subscribe(() => {
      const next = game.ui.get().phase;
      if (next === phase) return;
      phase = next;
      if (next === "match_replay" && !rec) {
        const cfg = game.director.config;
        const canvas = game.view.canvas;
        if (!cfg || cfg.context !== "quick" || !canvas || !showKitFor(game.settings.get().profile.matchesPlayed).share) return;
        const bout = dailyBout(new Date(), sharedProfile().totals());
        rec = startClip(canvas, { boutNumber: bout.number, wordmark: "TORQUE LIMIT" });
      } else if (rec) {
        const r = rec;
        rec = null;
        lastClip.pending = r.stop().then((clip) => { lastClip.clip = clip; return clip; });
      }
    });
    return () => { unsub(); if (rec) void rec.stop(); };
  }, [game]);
}

function useDocumentHooks(game: GameHandle | null): void {
  useEffect(() => {
    if (!game) return;
    const onVisibility = () => { if (document.visibilityState === "hidden") game.director.pause(); };
    const onLock = () => { game.director.onPointerLockChange(document.pointerLockElement !== null); };
    // A lost GL context (GPU reset, driver update, a laptop waking) froze the picture while the match kept
    // running underneath — the player sees a still frame and loses a round they cannot see. Pause and say so.
    const onContextLost = (e: Event) => {
      e.preventDefault();                                  // lets the browser attempt a restore
      game.director.pause();
      game.ui.set({ error: "GRAPHICS RESET · RELOAD IF THE PICTURE DOES NOT RETURN" });
    };
    const onContextRestored = () => { game.ui.set({ error: null }); };
    const canvas = game.view.canvas;
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerlockchange", onLock);
    canvas?.addEventListener("webglcontextlost", onContextLost);
    canvas?.addEventListener("webglcontextrestored", onContextRestored);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", onLock);
      canvas?.removeEventListener("webglcontextlost", onContextLost);
      canvas?.removeEventListener("webglcontextrestored", onContextRestored);
    };
  }, [game]);
}

/* ───────────────────────── development handle ───────────────────────── */

/**
 * Exposes the live GameHandle as `window.__tl` in development builds only, so headless
 * capture and diagnostic tooling can drive the game to an exact moment (freeze the clock
 * on a strike, jump to a screen) without synthesising real-time input. Stripped from
 * production: `process.env.NODE_ENV` is inlined by the bundler, so the branch is dead code
 * in a production build and no handle is ever attached for a player.
 */
function useDevHandle(game: GameHandle | null): void {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !game) return;
    const w = window as unknown as { __tl?: GameHandle; __tlConfig?: typeof matchConfig };
    w.__tl = game;
    w.__tlConfig = matchConfig;                  // config builders, so tooling can compose any seat pairing
    return () => { delete w.__tl; delete w.__tlConfig; };
  }, [game]);
}

function GameShell(): JSX.Element {
  const { game, error } = useGame();
  useDocumentHooks(game);
  useAutoClip(game);
  useDevHandle(game);
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0E0F14] select-none">
      {game ? (
        <>
          <ArenaCanvas game={game} />
          <BroadcastUi game={game} />
        </>
      ) : (
        <BootSurface error={error} />
      )}
    </main>
  );
}

export default function GameRoot(): JSX.Element {
  const bench = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("debug") === "bench",
    () => false,
  );
  return bench ? <BenchRoute /> : <GameShell />;
}
