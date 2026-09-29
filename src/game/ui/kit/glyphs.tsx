// src/game/ui/kit/glyphs.tsx (WP7)
// Every icon in the UI is an inline SVG sized to the text (no Unicode symbol glyphs anywhere, GAME_DESIGN 6.3).
// Stroke icons use currentColor and square caps; key and pad-button glyphs are device-aware for the hint bar.
import type { JSX } from "react";
import type { InputDevice } from "../../contracts.ts";

export type GlyphName =
  | "diamond" | "check" | "cross" | "warn" | "chevron-right" | "chevron-left" | "dice" | "copy" | "upload" | "download"
  | "play" | "pause" | "step-back" | "step-forward" | "camera" | "lock" | "pin" | "trash" | "eye" | "mouse-left"
  | "mouse-right" | "mouse-move" | "stick" | "pad-a" | "pad-b" | "pad-x" | "pad-y" | "pad-lb" | "pad-rb" | "pad-start" | "pad-view";

const PATHS: Readonly<Record<Exclude<GlyphName, `pad-${string}` | "mouse-left" | "mouse-right" | "mouse-move">, JSX.Element>> = {
  diamond: <path d="M12 2 22 12 12 22 2 12Z" fill="currentColor" />,
  check: <path d="M4 12.5 9.5 18 20 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />,
  cross: <path d="M5 5 19 19M19 5 5 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />,
  warn: <><path d="M12 2 23 21H1Z" fill="currentColor" /><path d="M12 8v6M12 16.5v2" stroke="var(--ink)" strokeWidth="2.5" /></>,
  "chevron-right": <path d="M8 3 17 12 8 21" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />,
  "chevron-left": <path d="M16 3 7 12 16 21" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />,
  dice: <><path d="M3 3h18v18H3Z" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M7 7h3v3H7ZM14 14h3v3h-3ZM10.5 10.5h3v3h-3Z" fill="currentColor" /></>,
  copy: <><path d="M8 8h13v13H8Z" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M16 4H3v13" fill="none" stroke="currentColor" strokeWidth="2.5" /></>,
  upload: <path d="M12 16V3M6 9l6-6 6 6M3 15v6h18v-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />,
  download: <path d="M12 3v13M6 10l6 6 6-6M3 15v6h18v-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />,
  play: <path d="M6 3 20 12 6 21Z" fill="currentColor" />,
  pause: <path d="M5 3h5v18H5ZM14 3h5v18h-5Z" fill="currentColor" />,
  "step-back": <path d="M4 3h3v18H4ZM20 3 9 12l11 9Z" fill="currentColor" />,
  "step-forward": <path d="M17 3h3v18h-3ZM4 3l11 9-11 9Z" fill="currentColor" />,
  camera: <><path d="M2 7h5l2-3h6l2 3h5v13H2Z" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="currentColor" /></>,
  lock: <><path d="M4 10h16v12H4Z" fill="currentColor" /><path d="M7.5 10V6.5a4.5 4.5 0 0 1 9 0V10" fill="none" stroke="currentColor" strokeWidth="2.5" /></>,
  pin: <path d="M8 2h8l-1 7 4 4H5l4-4ZM12 13v9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 16h12l1-16M10 10v8M14 10v8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" fill="currentColor" /></>,
  stick: <><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" fill="currentColor" /></>,
};

function Mouse(props: { side: "left" | "right" | "move" }): JSX.Element {
  return (
    <>
      <path d="M6 2h12v20H6Z" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 2v8M6 10h12" stroke="currentColor" strokeWidth="2.2" />
      {props.side === "left" ? <path d="M6 2h6v8H6Z" fill="currentColor" /> : null}
      {props.side === "right" ? <path d="M12 2h6v8h-6Z" fill="currentColor" /> : null}
      {props.side === "move" ? <path d="M1 16h3M20 16h3M1 16l2-2M1 16l2 2M23 16l-2-2M23 16l-2 2" stroke="currentColor" strokeWidth="1.8" /> : null}
    </>
  );
}

function PadButton(props: { label: string; shape: "round" | "bumper" | "small" }): JSX.Element {
  const body = props.shape === "round"
    ? <path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Z" fill="currentColor" />
    : props.shape === "bumper"
      ? <path d="M2 7h20v10H2Z" fill="currentColor" />
      : <path d="M4 8h16v8H4Z" fill="currentColor" />;
  return (
    <>
      {body}
      <text x="12" y={props.shape === "round" ? 16.5 : 15.2} textAnchor="middle" fontSize={props.shape === "round" ? 12 : 8}
        fontFamily="var(--font-barlow), Arial Narrow, sans-serif" fontWeight={800} fill="var(--ink)">{props.label}</text>
    </>
  );
}

export function Glyph(props: { name: GlyphName; className?: string; title?: string }): JSX.Element {
  const n = props.name;
  let body: JSX.Element;
  if (n === "mouse-left") body = <Mouse side="left" />;
  else if (n === "mouse-right") body = <Mouse side="right" />;
  else if (n === "mouse-move") body = <Mouse side="move" />;
  else if (n === "pad-a") body = <PadButton label="A" shape="round" />;
  else if (n === "pad-b") body = <PadButton label="B" shape="round" />;
  else if (n === "pad-x") body = <PadButton label="X" shape="round" />;
  else if (n === "pad-y") body = <PadButton label="Y" shape="round" />;
  else if (n === "pad-lb") body = <PadButton label="LB" shape="bumper" />;
  else if (n === "pad-rb") body = <PadButton label="RB" shape="bumper" />;
  else if (n === "pad-start") body = <PadButton label="MENU" shape="small" />;
  else if (n === "pad-view") body = <PadButton label="VIEW" shape="small" />;
  else body = PATHS[n];
  return (
    <svg viewBox="0 0 24 24" className={`tl-glyph ${props.className ?? ""}`} role={props.title ? "img" : undefined} aria-hidden={props.title ? undefined : true} focusable="false">
      {props.title ? <title>{props.title}</title> : null}
      {body}
    </svg>
  );
}

/** A keyboard key cap with its label (Chivo Mono). */
export function KeyCap(props: { label: string }): JSX.Element {
  return <span className="tl-key" aria-hidden="true">{props.label}</span>;
}

export type HintAction = "confirm" | "back" | "rematch" | "skip" | "hold_skip" | "pause" | "stats" | "navigate" | "tab";

/** Device-aware input glyph for an action in the hint bar. */
export function ActionGlyph(props: { action: HintAction; device: InputDevice }): JSX.Element {
  const pad = props.device === "gamepad";
  switch (props.action) {
    case "confirm": return pad ? <Glyph name="pad-a" /> : <KeyCap label="ENTER" />;
    case "back": return pad ? <Glyph name="pad-b" /> : <KeyCap label="ESC" />;
    case "rematch": return pad ? <Glyph name="pad-a" /> : <KeyCap label="R" />;
    case "skip": return pad ? <Glyph name="pad-a" /> : <KeyCap label="SPACE" />;
    case "hold_skip": return pad ? <Glyph name="pad-a" /> : <KeyCap label="HOLD SPACE" />;
    case "pause": return pad ? <Glyph name="pad-start" /> : <KeyCap label="ESC" />;
    case "stats": return pad ? <Glyph name="pad-view" /> : <KeyCap label="TAB" />;
    case "navigate": return pad ? <Glyph name="stick" /> : <KeyCap label="ARROWS" />;
    case "tab": return pad ? <><Glyph name="pad-lb" /><Glyph name="pad-rb" /></> : <KeyCap label="Q E" />;
  }
}
