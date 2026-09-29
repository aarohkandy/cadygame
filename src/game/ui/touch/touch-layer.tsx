// src/game/ui/touch/touch-layer.tsx (Area J - phone and tablet)
// The on-screen fight controls, placed by the solver in layout.ts rather than by a stack of CSS breakpoints.
// Every control is absolutely positioned at a solved rect, so the same component covers a 360 px Android, a
// notched iPhone in either orientation and an iPad without a single device query.
//
//   left thumb   STANCE pad in the bottom-left corner: x drifts the stance, y springs the reach out and back.
//                GRIP sits on its arc, and OVERDRIVE joins it once the arcade kit is unlocked.
//   right thumb  SWING pad in the bottom-right corner: absolute aim, a full sweep is the same 1.8 rad hook as the
//                pad's right stick - and a fast, committed drag across it IS a jab, so a flick lands without the
//                thumb ever leaving the pad. STRIKE, GUARD and ABILITY sit on the same thumb's arc; STRIKE still
//                holds to charge and releases heavy, which no gesture can do.
//
// Positions are inline because the solver owns them. mobile.css owns only the look: octagon wells, slanted plates,
// the flick flash and the safe-area probe. Knobs move by writing transforms through refs, so a sweep never commits
// a React render.
"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent, type RefObject,
} from "react";
import { TOKEN_HEX, type GameHandle, type TouchInput } from "../../contracts.ts";
import { knobOffset, stickFromPointer, touchControlsEnabled } from "../../input/touch-input.ts";
import { createFlickDetector, flickHaptic, type Flick, type FlickDetector } from "./gestures.ts";
import { controlRect, solveTouchLayout, type ControlId, type Rect, type Viewport } from "./layout.ts";

const FIGHT_SCREENS = new Set(["match", "tutorial"]);

const BUTTONS: readonly { id: Extract<ControlId, "grip" | "strike" | "guard" | "overdrive" | "ability">; label: string; color: string; ink: boolean }[] = [
  { id: "strike", label: "STRIKE", color: TOKEN_HEX.cobalt, ink: false },
  { id: "guard", label: "GUARD", color: TOKEN_HEX.block, ink: true },
  { id: "grip", label: "GRIP", color: TOKEN_HEX.paper, ink: true },
  { id: "overdrive", label: "DRIVE", color: TOKEN_HEX.signal, ink: false },
  { id: "ability", label: "ABILITY", color: TOKEN_HEX.volt, ink: true },
];

type PlateId = (typeof BUTTONS)[number]["id"];

const NO_SELECT: CSSProperties = {
  touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
  WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent",
};

function place(rect: Rect): CSSProperties {
  return { position: "absolute", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` };
}

function coarsePointer(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function subscribeCoarse(fn: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const mq = matchMedia("(pointer: coarse)");
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

const FALLBACK: Viewport = { width: 390, height: 844, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 };

/**
 * Viewport and safe-area insets, re-read on rotate and on resize. `env(safe-area-inset-*)` is only readable through
 * a real element, so a zero-size probe carries the insets as padding and the effect reads them back. Without the
 * probe the layout still solves; it just uses the 16 px floors the solver applies anyway.
 */
function useViewport(probe: RefObject<HTMLDivElement | null>): Viewport {
  const [vp, setVp] = useState<Viewport>(FALLBACK);
  useEffect(() => {
    const read = (): void => {
      const el = probe.current;
      const pad = el ? getComputedStyle(el) : null;
      const n = (v: string | undefined): number => {
        const f = Number.parseFloat(v ?? "0");
        return Number.isFinite(f) ? f : 0;
      };
      setVp((prev) => {
        const next: Viewport = {
          width: Math.round(window.innerWidth),
          height: Math.round(window.innerHeight),
          safeTop: Math.round(n(pad?.paddingTop)),
          safeRight: Math.round(n(pad?.paddingRight)),
          safeBottom: Math.round(n(pad?.paddingBottom)),
          safeLeft: Math.round(n(pad?.paddingLeft)),
        };
        const same = prev.width === next.width && prev.height === next.height
          && prev.safeTop === next.safeTop && prev.safeRight === next.safeRight
          && prev.safeBottom === next.safeBottom && prev.safeLeft === next.safeLeft;
        return same ? prev : next;
      });
    };
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
      vv?.removeEventListener("resize", read);
    };
  }, [probe]);
  return vp;
}

function buzz(ms: number): void {
  const nav = globalThis.navigator as Navigator | undefined;
  try { nav?.vibrate?.(ms); } catch { /* a browser that refuses to buzz is not a failure */ }
}

interface PadProps {
  rect: Rect;
  variant: "stance" | "swing";
  label: string;
  axisHint: string;
  onMove(x: number, y: number): void;
  onRelease(): void;
  onFlick?(f: Flick): void;
}

/** One absolute thumb pad. The value mapping reads the live rect, so it stays exact at whatever size solved. */
function Pad({ rect, variant, label, axisHint, onMove, onRelease, onFlick }: PadProps): JSX.Element {
  const well = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const v = useRef({ x: 0, y: 0 });
  const k = useRef({ x: 0, y: 0 });
  // Built once, lazily, and never replaced: the recogniser carries the thumb's trail across moves.
  const [flick] = useState<FlickDetector>(createFlickDetector);

  const set = useCallback((clientX: number, clientY: number, tMs: number) => {
    const el = well.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const radius = box.width / 2;
    const dx = clientX - (box.left + box.width / 2);
    const dy = clientY - (box.top + box.height / 2);
    stickFromPointer(dx, dy, radius, v.current);
    knobOffset(dx, dy, radius, k.current);
    if (knob.current) knob.current.style.transform = `translate(${k.current.x}px, ${k.current.y}px)`;
    onMove(v.current.x, v.current.y);
    if (!onFlick) return;
    const f = flick.sample(v.current.x, v.current.y, tMs);
    if (!f) return;
    onFlick(f);
    if (well.current) {
      well.current.dataset.flick = "true";
      window.setTimeout(() => { if (well.current) well.current.dataset.flick = "false"; }, 160);
    }
  }, [flick, onFlick, onMove]);

  const end = useCallback(() => {
    active.current = null;
    flick.end();
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
    if (well.current) well.current.dataset.held = "false";
    onRelease();
  }, [flick, onRelease]);

  return (
    <div
      ref={well}
      role="presentation"
      className={`tlm-pad tlm-pad--${variant}`}
      data-held="false"
      data-flick="false"
      style={{ ...place(rect), ...NO_SELECT }}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (active.current !== null) return;
        e.preventDefault();
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.held = "true";
        set(e.clientX, e.clientY, e.timeStamp);
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerId !== active.current) return;
        e.preventDefault();
        set(e.clientX, e.clientY, e.timeStamp);
      }}
      onPointerUp={(e) => { if (e.pointerId === active.current) end(); }}
      onPointerCancel={(e) => { if (e.pointerId === active.current) end(); }}
      onLostPointerCapture={(e) => { if (e.pointerId === active.current) end(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="tlm-pad__axis" aria-hidden="true">{axisHint}</span>
      <div ref={knob} className="tlm-pad__knob" aria-hidden="true" />
      <span className="tlm-pad__label" aria-hidden="true">{label}</span>
    </div>
  );
}

interface PlateProps {
  rect: Rect;
  label: string;
  color: string;
  ink: boolean;
  onDown(down: boolean): void;
}

function Plate({ rect, label, color, ink, onDown }: PlateProps): JSX.Element {
  const pointer = useRef<number | null>(null);
  const el = useRef<HTMLButtonElement>(null);
  const set = (down: boolean): void => {
    if (el.current) el.current.dataset.down = down ? "true" : "false";
    onDown(down);
  };
  return (
    <button
      ref={el}
      type="button"
      aria-label={label}
      className="tlm-plate"
      data-down="false"
      style={{ ...place(rect), ...NO_SELECT, background: color, color: ink ? TOKEN_HEX.ink : TOKEN_HEX.paper }}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        e.preventDefault();
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={(e) => { if (e.pointerId === pointer.current) { pointer.current = null; set(false); } }}
      onPointerCancel={(e) => { if (e.pointerId === pointer.current) { pointer.current = null; set(false); } }}
      onLostPointerCapture={(e) => { if (e.pointerId === pointer.current) { pointer.current = null; set(false); } }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="tlm-plate__text">{label}</span>
    </button>
  );
}

export function TouchLayer({ game }: { game: GameHandle }): JSX.Element | null {
  const settings = useSyncExternalStore(game.settings.subscribe, game.settings.get, game.settings.get);
  const ui = useSyncExternalStore(game.ui.subscribe, game.ui.get, game.ui.get);
  const coarse = useSyncExternalStore(subscribeCoarse, coarsePointer, () => false);
  const probe = useRef<HTMLDivElement>(null);
  const vp = useViewport(probe);
  const touch: TouchInput = game.pilot.touch();

  const t = settings.controls.touch;
  const kit = !!ui.match?.showKit && ui.match.preset === "arcade";
  // Any overlay at all takes the controls away, not just the pause menu: the pause menu, the tap-to-fight prompt
  // and the seat-protection countdown each cover the screen and swallow the pointer, so a live control under one
  // is a control the player can see and cannot press.
  const shown = touchControlsEnabled(t.mode, coarse) && FIGHT_SCREENS.has(ui.screen) && ui.overlay === null;

  const layout = useMemo(
    () => solveTouchLayout(vp, { stickRadiusPx: t.stickRadiusPx, kit }),
    [vp, t.stickRadiusPx, kit],
  );

  // A flick holds STRIKE for its own press window. The timer is cleared on unmount and on any release, so the
  // input can never be left stuck down by a backgrounded tab.
  const strikeTimer = useRef<number | null>(null);
  const strikeHeld = useRef(false);
  const clearStrike = useCallback(() => {
    if (strikeTimer.current !== null) {
      window.clearTimeout(strikeTimer.current);
      strikeTimer.current = null;
      touch.button("strike", false);
    }
  }, [touch]);

  useEffect(() => {
    if (!shown) { clearStrike(); touch.release(); return; }
    const drop = (): void => { strikeHeld.current = false; clearStrike(); touch.release(); };
    const onVisibility = (): void => { if (document.visibilityState === "hidden") drop(); };
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", onVisibility);
      drop();
    };
  }, [shown, touch, clearStrike]);

  const onSwing = useCallback((x: number, y: number) => touch.swing(x, y), [touch]);
  const onSwingEnd = useCallback(() => { touch.swing(0, 0); clearStrike(); }, [touch, clearStrike]);
  const onStance = useCallback((x: number, y: number) => { touch.stance(x); touch.reach(y); }, [touch]);
  const onStanceEnd = useCallback(() => { touch.stance(0); touch.reach(0); }, [touch]);
  const onFlick = useCallback((f: Flick) => {
    if (strikeHeld.current) return;   // the thumb is already charging; the swing is aim, not a jab
    clearStrike();
    touch.button("strike", true);
    buzz(flickHaptic(f));
    strikeTimer.current = window.setTimeout(() => {
      strikeTimer.current = null;
      touch.button("strike", false);
    }, f.pressMs);
  }, [touch, clearStrike]);

  const onPlate = useCallback((id: PlateId, down: boolean) => {
    if (id === "strike") {
      // Holding STRIKE is a charge, and a charge outranks a gesture: a flick fired mid-hold must not release it.
      strikeHeld.current = down;
      if (down) { clearStrike(); buzz(9); }
    }
    touch.button(id, down);
  }, [touch, clearStrike]);

  const stance = controlRect(layout, "stance");
  const swing = controlRect(layout, "swing");

  return (
    <>
      <div ref={probe} aria-hidden="true" className="tlm-safe-probe" style={SAFE_PROBE} />
      {shown && stance && swing ? (
        <div
          className="tlm-layer"
          data-profile={layout.profile}
          style={{ ...NO_SELECT, opacity: t.opacity01 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* PAUSE is deliberately NOT a solver control: the solver's contract is thumb-reachable fight controls,
              and the one button that must never be hit by a stray thumb is the one that stops the match. It sits
              in layout.hudBand, which the solver already reserves and forbids every control from entering.
              Without it a phone player has no route to SETTINGS, the STABLE camera toggle, FORFEIT or QUIT. */}
          <button
            type="button"
            aria-label="PAUSE"
            className="tlm-pause"
            style={{ position: "absolute", right: 8, top: layout.hudBand.h + 8, ...NO_SELECT }}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); game.director.pause(); }}
          >
            <span aria-hidden="true">II</span>
          </button>
          <Pad rect={stance} variant="stance" label="STANCE" axisHint="REACH" onMove={onStance} onRelease={onStanceEnd} />
          <Pad rect={swing} variant="swing" label="SWING" axisHint="FLICK" onMove={onSwing} onRelease={onSwingEnd} onFlick={onFlick} />
          {BUTTONS.map((b) => {
            const rect = controlRect(layout, b.id);
            if (!rect) return null;
            return (
              <Plate
                key={b.id}
                rect={rect}
                label={b.label}
                color={b.color}
                ink={b.ink}
                onDown={(down) => onPlate(b.id, down)}
              />
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** Inline so the insets are readable even before mobile.css lands; the stylesheet only hides it more thoroughly. */
const SAFE_PROBE: CSSProperties = {
  position: "fixed", top: 0, left: 0, width: 0, height: 0, visibility: "hidden", pointerEvents: "none",
  paddingTop: "env(safe-area-inset-top, 0px)", paddingRight: "env(safe-area-inset-right, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)",
};
