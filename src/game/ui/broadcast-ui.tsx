// src/game/ui/broadcast-ui.tsx (WP7)
// The broadcast layer over WP6's canvas: every screen, the in-match HUD, the TURBO plate, overlays, the touch
// layer, the error and new-build toasts, screen wipes, and the input that belongs to menus (Esc and back,
// hold-to-skip, arrow and gamepad focus navigation, Q/E tabs).
// Reads UiState one slice at a time so a fight re-renders nothing here. Mirrors the accessibility settings onto <html>
// (data-colorblind, data-reduced-motion) so CSS carries them everywhere. The touch layer reads its own opacity
// setting directly, so nothing is mirrored for it.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import type { GameHandle, MatchPhase, Screen, UiCue } from "../contracts.ts";
import { Hud, useSetting, useUi } from "./hud/hud.tsx";
import { TurboPlate } from "./hud/turbo-plate.tsx";
import { Glyph } from "./kit/glyphs.tsx";
import { SlantButton, UiCueProvider } from "./kit/slant-button.tsx";
import { Wipe } from "./kit/wipe.tsx";
import { BootScreen } from "./screens/boot-screen.tsx";
import { ClickToFight } from "./screens/click-to-fight.tsx";
import { CockpitChoice } from "./screens/cockpit-choice.tsx";
import { EntrantsScreen } from "./screens/entrants-screen.tsx";
import { GreenRoom } from "./screens/green-room.tsx";
import { LabScreen } from "./screens/lab-screen.tsx";
import { PauseMenu, resumeMatch } from "./screens/pause-menu.tsx";
import { PostMatchScreen, attachMatchLog } from "./screens/post-match-screen.tsx";
import { ReplayViewer } from "./screens/replay-viewer.tsx";
import { ReplaysScreen } from "./screens/replays-screen.tsx";
import { SettingsScreen } from "./screens/settings-screen.tsx";
import { TitleScreen } from "./screens/title-screen.tsx";
import { TutorialOverlay } from "./screens/tutorial-overlay.tsx";
import { TouchLayer } from "./touch/touch-layer.tsx";
// The touch layer's stylesheet (`app/mobile.css`) is a global sheet and is imported once, beside globals.css,
// in app/layout.tsx.
import { UPDATE_EVENT, type TorqueLimitUpdateReady } from "../../app/pwa-register.tsx";

const MATCH_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["match", "tutorial"]);
const BACK_TO_LOBBY: ReadonlySet<Screen> = new Set<Screen>(["entrants", "lab", "replays", "settings"]);
const SKIPPABLE: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["match_intro", "ko", "lock", "time_up", "round_replay", "round_summary", "match_replay", "outro"]);
const HOLD_SKIP_MS = 400;
const PAD_REPEAT_MS = 180;
const PAD_AXIS = 0.55;

/* ───────────────────────── helpers ───────────────────────── */

function focusables(root: HTMLElement): HTMLElement[] {
  const sel = 'button:not([disabled]), input:not([type="hidden"]):not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    if (el.tabIndex < 0 || el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function moveFocus(root: HTMLElement, delta: number): void {
  const modal = root.querySelector<HTMLElement>('[aria-modal="true"]');
  const list = focusables(modal ?? root);
  if (list.length === 0) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length];
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function cycleTabs(root: HTMLElement, delta: number): boolean {
  const tablist = root.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablist) return false;
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
  const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  const next = tabs[(i + delta + tabs.length) % tabs.length];
  next?.click();
  next?.focus();
  return true;
}

/**
 * Left/Right inside a radiogroup whose options sit side by side (the cockpit cards, the LOADOUT cards).
 * Returns false when the active element is not such a radio, so the caller can leave the key alone.
 */
function moveRadio(active: Element | null, delta: number): boolean {
  const radio = active instanceof HTMLElement ? active.closest<HTMLElement>('[role="radio"]') : null;
  const group = radio?.closest<HTMLElement>('[role="radiogroup"]');
  if (!radio || !group) return false;
  const options = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'));
  if (options.length < 2) return false;
  const i = options.indexOf(radio);
  const next = options[(i + delta + options.length) % options.length];
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function nudge(el: Element | null, delta: number): void {
  if (el instanceof HTMLInputElement && el.type === "range") {
    const step = Number(el.step) || 1;
    const v = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + step * delta));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  el?.dispatchEvent(new KeyboardEvent("keydown", { key: delta > 0 ? "ArrowRight" : "ArrowLeft", bubbles: true }));
}

/**
 * Enter on a menu screen does what every hint bar says it does. The native button activation covers the easy
 * case, but it is lost two ways: focus falls to <body> after a click on a bare part of the screen, and a pointer
 * lock (or its free-cursor fallback) left over from the arena makes the input system cancel every bound key. Nothing focused:
 * the checked option (PICK YOUR MOUNT, LOADOUT) is confirmed, else focus lands on the first control like pad A.
 * Returns whether it handled the key.
 */
function confirmKey(root: HTMLElement, active: Element | null, cancelledByLock: boolean): boolean {
  if (!(active instanceof HTMLElement) || active === document.body || !root.contains(active)) {
    const scope = root.querySelector<HTMLElement>('[aria-modal="true"]') ?? root;
    const checked = scope.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not([disabled])');
    if (checked) checked.click();
    else moveFocus(root, 1);
    return true;
  }
  // Only the lock can have cancelled the native click here; a component that wanted Enter for itself did its
  // work in its own handler and left no pointer lock behind.
  if (cancelledByLock && active.matches('button, a[href], [role="radio"], [role="tab"], [role="button"]')) {
    active.click();
    return true;
  }
  return false;
}

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "range");
}

/* ───────────────────────── settings → document ───────────────────────── */

function useDocumentSettings(game: GameHandle): void {
  const colorblind = useSetting(game, (s) => s.access.colorblind);
  const reduced = useSetting(game, (s) => s.access.reducedMotion);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorblind = colorblind ? "true" : "false";
    root.dataset.reducedMotion = reduced ? "true" : "false";
  }, [colorblind, reduced]);
}

/* ───────────────────────── input ───────────────────────── */

function useMenuInput(game: GameHandle, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    let holdStart = 0;
    let holding = false;

    const back = (): boolean => {
      const ui = game.ui.get();
      const root = rootRef.current;
      if (root?.querySelector('[aria-modal="true"]')) return false;
      if (MATCH_SCREENS.has(ui.screen)) {
        if (ui.overlay === "pause") { resumeMatch(game); return true; }
        // Losing the pointer lock swaps `null` for the CLICK TO FIGHT overlay, which used to fall through to
        // `return false` — so once a match was live, Esc did nothing and the pause menu (SETTINGS, the STABLE
        // camera toggle, FORFEIT, QUIT) was unreachable on the only screen that needs it. The director is
        // already paused here; RESUME clears the overlay and re-requests the lock on its way out.
        if (ui.overlay === "click_to_fight") { game.ui.set({ overlay: "pause" }); return true; }
        if (ui.overlay === null && document.pointerLockElement === null) { game.director.pause(); return true; }
        return false;
      }
      if (ui.screen === "replay_viewer") { game.feedback.audio.playUi("back"); game.director.closeReplay(); return true; }
      if (BACK_TO_LOBBY.has(ui.screen)) { game.feedback.audio.playUi("back"); game.ui.set({ screen: "green_room" }); return true; }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const ui = game.ui.get();
      const root = rootRef.current;
      if (!root || ui.screen === "boot" || ui.screen === "title") return;
      const active = document.activeElement;
      if (e.code === "Escape") { if (back()) e.preventDefault(); return; }
      if (MATCH_SCREENS.has(ui.screen) && ui.overlay === null) {
        if ((e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") && SKIPPABLE.has(ui.phase)) {
          e.preventDefault();
          if (!e.repeat && !holding) { holding = true; holdStart = performance.now(); game.director.setHoldSkip(true); }
        }
        return;
      }
      if (isTextField(active)) return;
      if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat) {
        // The pilot's own lock flag, not document.pointerLockElement: on hosts that deny pointer lock the input
        // system runs a free-cursor fallback that still counts as locked and still cancels bound keys.
        if (confirmKey(root, active, e.defaultPrevented && (game.pilot.locked || document.pointerLockElement !== null))) e.preventDefault();
        return;
      }
      if (e.code === "ArrowDown" || e.code === "ArrowUp") {
        if (active instanceof HTMLInputElement && active.type === "range") return;
        if (ui.screen === "replay_viewer") return;
        e.preventDefault();
        moveFocus(root, e.code === "ArrowDown" ? 1 : -1);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        // The kit's Toggle and native range inputs own Left/Right themselves; everything else with side-by-side
        // radio cards (PICK YOUR MOUNT, LOADOUT) would otherwise ignore the arrows its own hint bar promises.
        if (e.defaultPrevented) return;
        if (active instanceof HTMLInputElement && active.type === "range") return;
        if (moveRadio(active, e.code === "ArrowRight" ? 1 : -1)) e.preventDefault();
      } else if ((e.code === "KeyQ" || e.code === "KeyE") && !e.repeat) {
        if (cycleTabs(root, e.code === "KeyE" ? 1 : -1)) e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!holding || !(e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter")) return;
      holding = false;
      game.director.setHoldSkip(false);
      if (performance.now() - holdStart < HOLD_SKIP_MS) game.director.skip();
    };

    /* gamepad menus: polled only while no fight is live */
    const pressed = new Map<number, boolean>();
    let lastNav = 0;
    let raf = 0;
    const edge = (pad: Gamepad, i: number): boolean => {
      const down = !!pad.buttons[i]?.pressed;
      const was = pressed.get(i) ?? false;
      pressed.set(i, down);
      return down && !was;
    };
    const poll = (now: number) => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected && p.mapping === "standard");
      const root = rootRef.current;
      if (!pad || !root) return;
      const ui = game.ui.get();
      const inFight = MATCH_SCREENS.has(ui.screen) && ui.overlay === null;
      if (inFight) {
        if (edge(pad, 9)) game.director.pause();
        // VIEW (button 8) is handled by WP4's gamepad reader, which raises the rebindable STATS action as a
        // hold; the HUD runtime reads that. Synthesising a Tab key here would hard-code the binding.
        if (SKIPPABLE.has(ui.phase)) {
          const a = !!pad.buttons[0]?.pressed;
          const was = pressed.get(0) ?? false;
          pressed.set(0, a);
          if (a && !was) { holding = true; holdStart = now; game.director.setHoldSkip(true); }
          if (!a && was && holding) { holding = false; game.director.setHoldSkip(false); if (now - holdStart < HOLD_SKIP_MS) game.director.skip(); }
        } else {
          pressed.set(0, !!pad.buttons[0]?.pressed);
        }
        return;
      }
      // A pad must be able to start the show. The title screen listens for Enter, so forward A as that rather
      // than duplicating its start path. Note: a gamepad press is NOT a user-activation gesture, so the
      // AudioContext stays suspended until the first real pointer or key event — the match starts silent.
      if (ui.screen === "title" || ui.screen === "boot") {
        if (ui.screen === "title" && edge(pad, 0)) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        return;
      }
      if (edge(pad, 0)) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && root.contains(active) && active !== document.body) active.click();
        else moveFocus(root, 1);
      }
      if (edge(pad, 1)) back();
      if (edge(pad, 9) && MATCH_SCREENS.has(ui.screen) && ui.overlay === "pause") resumeMatch(game);
      if (edge(pad, 4)) cycleTabs(root, -1);
      if (edge(pad, 5)) cycleTabs(root, 1);
      const y = (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0) || (Math.abs(pad.axes[1] ?? 0) > PAD_AXIS ? Math.sign(pad.axes[1]) : 0);
      const x = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0) || (Math.abs(pad.axes[0] ?? 0) > PAD_AXIS ? Math.sign(pad.axes[0]) : 0);
      if ((x !== 0 || y !== 0) && now - lastNav > PAD_REPEAT_MS) {
        lastNav = now;
        if (y !== 0) moveFocus(root, y);
        else nudge(document.activeElement, x);
      }
      if (x === 0 && y === 0) lastNav = 0;
    };
    raf = requestAnimationFrame(poll);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (holding) game.director.setHoldSkip(false);
    };
  }, [game, rootRef]);
}

/* ───────────────────────── root ───────────────────────── */

function ErrorToast(props: { game: GameHandle }): JSX.Element | null {
  const error = useUi(props.game, (s) => s.error);
  if (!error) return null;
  return (
    <div className="tl-toast tl-anim-slide-up" role="alert">
      <span className="tl-toast__stripes tl-hazard" aria-hidden="true" />
      <span className="t-label tl-toast__text">{error}</span>
      <button type="button" className="lab-icon" aria-label="DISMISS" onClick={() => props.game.ui.set({ error: null })}><Glyph name="cross" /></button>
    </div>
  );
}

/**
 * The PWA's "a newer build is installed" toast. `pwa-register.tsx` announces the waiting worker; applying it
 * reloads the page, so the offer is only made between matches — a reload mid-fight would throw the round away.
 * Nothing here runs when the page is not served by a service worker: the event simply never fires.
 */
function UpdateToast(props: { game: GameHandle }): JSX.Element | null {
  const [apply, setApply] = useState<(() => void) | null>(null);
  const screen = useUi(props.game, (s) => s.screen);
  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<TorqueLimitUpdateReady>).detail;
      if (detail?.apply) setApply(() => detail.apply);
    };
    window.addEventListener(UPDATE_EVENT, onReady);
    return () => window.removeEventListener(UPDATE_EVENT, onReady);
  }, []);
  if (!apply || MATCH_SCREENS.has(screen)) return null;
  return (
    <div className="tl-toast tl-anim-slide-up" role="status">
      <span className="tl-toast__stripes tl-hazard" aria-hidden="true" />
      <span className="t-label tl-toast__text">NEW BUILD READY</span>
      <SlantButton label="RELOAD" variant="primary" onClick={apply} />
      <button type="button" className="lab-icon" aria-label="DISMISS" onClick={() => setApply(null)}><Glyph name="cross" /></button>
    </div>
  );
}

export function BroadcastUi(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const rootRef = useRef<HTMLDivElement>(null);
  const screen = useUi(game, (s) => s.screen);
  const overlay = useUi(game, (s) => s.overlay);
  const loading = useUi(game, (s) => s.loading);
  const tutorial = useUi(game, (s) => s.match?.tutorial === true);

  const play = useCallback((cue: UiCue) => game.feedback.audio.playUi(cue), [game]);
  useDocumentSettings(game);
  useMenuInput(game, rootRef);
  useEffect(() => attachMatchLog(game), [game]);

  // Menus stop the pilot's gamepad and cursor from fighting the UI: the director owns pilot modes, so only the
  // pointer lock needs releasing when a menu screen appears.
  useEffect(() => {
    if (!MATCH_SCREENS.has(screen) && document.pointerLockElement) document.exitPointerLock();
  }, [screen]);

  const inMatch = MATCH_SCREENS.has(screen);
  const body = useMemo(() => {
    switch (screen) {
      case "boot": return <BootScreen progress={loading?.progress ?? 0} label={loading?.label ?? ""} />;
      case "title": return <TitleScreen game={game} />;
      case "cockpit_choice": return <CockpitChoice game={game} />;
      case "green_room": return <GreenRoom game={game} />;
      case "entrants": return <EntrantsScreen game={game} />;
      case "lab": return <LabScreen game={game} />;
      case "replays": return <ReplaysScreen game={game} />;
      case "replay_viewer": return <ReplayViewer game={game} />;
      case "settings": return <SettingsScreen game={game} />;
      case "post_match": return <PostMatchScreen game={game} />;
      case "match": case "tutorial": return null;
    }
  }, [screen, game, loading]);

  return (
    <UiCueProvider play={play}>
      <div ref={rootRef} className="tl-ui-root" data-screen={screen}>
        {inMatch ? <Hud game={game} /> : null}
        {inMatch ? <TurboPlate game={game} /> : null}
        {inMatch && tutorial ? <TutorialOverlay game={game} /> : null}
        <TouchLayer game={game} />
        {body}
        {inMatch && overlay === "pause" ? <PauseMenu game={game} /> : null}
        {inMatch && (overlay === "click_to_fight" || overlay === "hold_guard") ? <ClickToFight game={game} mode={overlay} /> : null}
        <ErrorToast game={game} />
        <UpdateToast game={game} />
        <Wipe trigger={inMatch ? "match" : screen} />
      </div>
    </UiCueProvider>
  );
}
