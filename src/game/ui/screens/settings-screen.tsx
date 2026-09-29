// src/game/ui/screens/settings-screen.tsx (WP7)
// Settings (7.3.8 as adjusted by BUILD_PLAN 4 WP7.15): CONTROLS, CAMERA, AUDIO, VIDEO, SHOW, ACCESSIBILITY, and TOUCH.
// Every control writes through SettingsStore.set, so changes apply live and persist (torquelimit.settings.v2). HOST
// VOICE reports NO VOICE and stays off when the browser has no speech voices. Also opens from the pause menu.
"use client";

import { useEffect, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import type { GameHandle, Settings } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { SETTINGS_RANGES, defaultSettings } from "../../core/settings.ts";
import { DEFAULT_BINDINGS, RESERVED_CODES, keyLabel, resolveBindings } from "../../input/bindings.ts";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Slider } from "../kit/slider.tsx";
import { Tabs } from "../kit/tabs.tsx";
import { Toggle } from "../kit/toggle.tsx";

export type SettingsTab = "controls" | "camera" | "audio" | "video" | "show" | "access" | "touch";
const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "controls", label: "CONTROLS" }, { id: "camera", label: "CAMERA" }, { id: "audio", label: "AUDIO" }, { id: "video", label: "VIDEO" },
  { id: "show", label: "SHOW" }, { id: "access", label: "ACCESSIBILITY" }, { id: "touch", label: "TOUCH" },
];

const range = (path: string): readonly [number, number] => SETTINGS_RANGES[path] ?? [0, 1];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ON_OFF = [{ value: "off", label: "OFF" }, { value: "on", label: "ON" }] as const;

function Row(props: { label: string; children: ReactNode; note?: string | null }): JSX.Element {
  return (
    <div className="tl-row">
      <span className="t-plate set__label">{props.label}{props.note ? <span className="t-mono set__note">{props.note}</span> : null}</span>
      <div className="set__control">{props.children}</div>
    </div>
  );
}

function useVoicesAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(() => {
    if (typeof speechSynthesis === "undefined") return false;
    return speechSynthesis.getVoices().length > 0 ? true : null;
  });
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const check = () => setAvailable(speechSynthesis.getVoices().length > 0);
    speechSynthesis.addEventListener("voiceschanged", check);
    const t = window.setTimeout(check, 1200);
    return () => { speechSynthesis.removeEventListener("voiceschanged", check); window.clearTimeout(t); };
  }, []);
  return available;
}

function Rebind(props: { game: GameHandle; settings: Readonly<Settings> }): JSX.Element {
  const play = useUiCue();
  const [listening, setListening] = useState<string | null>(null);
  const resolved = resolveBindings(props.settings.controls.bindings);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") { setListening(null); play("back"); return; }
      if (RESERVED_CODES.has(e.code)) return;
      props.game.settings.set({ controls: { bindings: { ...props.game.settings.get().controls.bindings, [listening]: e.code } } });
      setListening(null);
      play("select");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening, play, props.game]);

  return (
    <div className="set-binds" role="table" aria-label="KEY BINDINGS">
      {DEFAULT_BINDINGS.map((b) => {
        const codes = resolved.codesOf.get(b.id) ?? [];
        return (
          <div key={b.id} className="set-binds__row" role="row">
            <span className="t-label" role="rowheader">{b.label}</span>
            <span className="set-binds__keys" role="cell">
              {codes.length === 0 ? <span className="t-mono t-dim">UNBOUND</span> : codes.map((c) => <span key={c} className="tl-key">{keyLabel(c)}</span>)}
            </span>
            <span role="cell">
              {b.rebindable ? (
                <SlantButton label={listening === b.id ? "PRESS A KEY" : "REBIND"} size="sm" active={listening === b.id} onClick={() => setListening(listening === b.id ? null : b.id)} />
              ) : <span className="t-mono t-dim">FIXED</span>}
            </span>
          </div>
        );
      })}
      <div className="set-binds__foot">
        <span className="t-label t-dim">LEFT MOUSE STRIKES · RIGHT MOUSE GUARDS</span>
        <SlantButton label="RESET KEYS" size="sm" cue="back" disabled={Object.keys(props.settings.controls.bindings).length === 0}
          onClick={() => props.game.settings.set({ controls: { bindings: {} } })} />
      </div>
    </div>
  );
}

export function SettingsScreen(props: { game: GameHandle; embedded?: boolean; onBack?: () => void }): JSX.Element {
  const game = props.game;
  const s = useSyncExternalStore((fn) => game.settings.subscribe(fn), () => game.settings.get(), () => game.settings.get());
  const [tab, setTab] = useState<SettingsTab>("controls");
  const voices = useVoicesAvailable();
  const set = game.settings.set;
  const back = props.onBack ?? (() => game.ui.set({ screen: "green_room" }));

  const body = (() => {
    switch (tab) {
      case "controls": return (
        <>
          <Row label="SENSITIVITY"><Slider label="SENSITIVITY" min={range("controls.sensitivity")[0]} max={range("controls.sensitivity")[1]} step={0.05} value={s.controls.sensitivity} format={(v) => v.toFixed(2)} onChange={(v) => set({ controls: { sensitivity: v } })} /></Row>
          <Row label="VERTICAL"><Slider label="VERTICAL" min={range("controls.verticalMul")[0]} max={range("controls.verticalMul")[1]} step={0.05} value={s.controls.verticalMul} format={(v) => `${v.toFixed(2)}X`} onChange={(v) => set({ controls: { verticalMul: v } })} /></Row>
          <Row label="INVERT Y"><Toggle label="INVERT Y" value={s.controls.invertY ? "on" : "off"} options={ON_OFF} onChange={(v) => set({ controls: { invertY: v === "on" } })} /></Row>
          <Row label="PAD DEADZONE"><Slider label="PAD DEADZONE" min={range("controls.padDeadzone")[0]} max={range("controls.padDeadzone")[1]} step={0.01} value={s.controls.padDeadzone} format={(v) => v.toFixed(2)} onChange={(v) => set({ controls: { padDeadzone: v } })} /></Row>
          <Row label="KEYS"><Rebind game={game} settings={s} /></Row>
        </>
      );
      case "camera": return (
        <>
          <Row label="COCKPIT"><Toggle label="COCKPIT" value={s.camera.cockpit} options={[{ value: "standard", label: "STANDARD" }, { value: "stable", label: "STABLE" }]} onChange={(v) => set({ camera: { cockpit: v } })} /></Row>
          <Row label="FIELD OF VIEW"><Slider label="FIELD OF VIEW" min={range("camera.fovDeg")[0]} max={range("camera.fovDeg")[1]} step={1} value={s.camera.fovDeg} format={(v) => `${Math.round(v)} DEG`} onChange={(v) => set({ camera: { fovDeg: v } })} /></Row>
          <Row label="CAMERA MOTION"><Slider label="CAMERA MOTION" min={0} max={1} step={0.05} value={s.camera.motion01} format={pct} onChange={(v) => set({ camera: { motion01: v } })} /></Row>
          <Row label="GHOST OPACITY"><Slider label="GHOST OPACITY" min={0} max={1} step={0.05} value={s.camera.ghostOpacity01} format={pct} onChange={(v) => set({ camera: { ghostOpacity01: v } })} /></Row>
        </>
      );
      case "audio": return (
        <>
          {(["master", "sfx", "music", "crowd"] as const).map((k) => (
            <Row key={k} label={k === "sfx" ? "EFFECTS" : k.toUpperCase()}><Slider label={k.toUpperCase()} min={0} max={1} step={0.05} value={s.audio[k]} format={pct} onChange={(v) => set({ audio: { [k]: v } })} /></Row>
          ))}
          <Row label="CAPTIONS"><Toggle label="CAPTIONS" value={s.audio.captions} options={[{ value: "full", label: "FULL" }, { value: "big", label: "BIG MOMENTS" }, { value: "off", label: "OFF" }]} onChange={(v) => set({ audio: { captions: v } })} /></Row>
          <Row label="HOST VOICE" note={voices === false ? "NO VOICE" : null}>
            <Toggle label="HOST VOICE" value={s.audio.hostVoice && voices !== false ? "on" : "off"} disabled={voices === false}
              options={ON_OFF} onChange={(v) => set({ audio: { hostVoice: v === "on" } })} />
          </Row>
          <Row label="VOICE"><Slider label="VOICE" min={0} max={1} step={0.05} value={s.audio.voice} format={pct} disabled={!s.audio.hostVoice || voices === false} onChange={(v) => set({ audio: { voice: v } })} /></Row>
        </>
      );
      case "video": return (
        <>
          <Row label="QUALITY"><Toggle label="QUALITY" value={s.video.quality} options={[{ value: "auto", label: "AUTO" }, { value: "high", label: "HIGH" }, { value: "default", label: "DEFAULT" }, { value: "low", label: "LOW" }]} onChange={(v) => set({ video: { quality: v } })} /></Row>
          <Row label="SCREEN EFFECTS"><Slider label="SCREEN EFFECTS" min={0} max={1} step={0.05} value={s.video.effects01} format={pct} onChange={(v) => set({ video: { effects01: v } })} /></Row>
          <Row label="DAMAGE NUMBERS"><Toggle label="DAMAGE NUMBERS" value={s.video.damageNumbers} options={[{ value: "on", label: "ON" }, { value: "merged", label: "MERGED" }, { value: "off", label: "OFF" }]} onChange={(v) => set({ video: { damageNumbers: v } })} /></Row>
        </>
      );
      case "show": return (
        <Row label="FAST SHOW" note={s.show.fast === "auto" ? (s.profile.matchesPlayed >= 5 ? "ON AFTER 5 MATCHES" : `ON AFTER ${5 - s.profile.matchesPlayed} MORE`) : null}>
          <Toggle label="FAST SHOW" value={s.show.fast} options={[{ value: "auto", label: "AUTO" }, { value: "on", label: "ON" }, { value: "off", label: "OFF" }]} onChange={(v) => set({ show: { fast: v } })} />
        </Row>
      );
      case "access": return (
        <>
          <Row label="COLOURBLIND TEAMS"><Toggle label="COLOURBLIND TEAMS" value={s.access.colorblind ? "on" : "off"} options={ON_OFF} onChange={(v) => set({ access: { colorblind: v === "on" } })} /></Row>
          <Row label="REDUCED MOTION"><Toggle label="REDUCED MOTION" value={s.access.reducedMotion ? "on" : "off"} options={ON_OFF} onChange={(v) => set({ access: { reducedMotion: v === "on" } })} /></Row>
          <Row label="CAPTION SIZE"><Slider label="CAPTION SIZE" min={range("access.captionScale")[0]} max={range("access.captionScale")[1]} step={0.05} value={s.access.captionScale} format={(v) => `${v.toFixed(2)}X`} onChange={(v) => set({ access: { captionScale: v } })} /></Row>
        </>
      );
      case "touch": return (
        <>
          <Row label="TOUCH CONTROLS"><Toggle label="TOUCH CONTROLS" value={s.controls.touch.mode} options={[{ value: "auto", label: "AUTO" }, { value: "on", label: "ON" }, { value: "off", label: "OFF" }]} onChange={(v) => set({ controls: { touch: { mode: v } } })} /></Row>
          <Row label="STICK SIZE"><Slider label="STICK SIZE" min={range("controls.touch.stickRadiusPx")[0]} max={range("controls.touch.stickRadiusPx")[1]} step={4} value={s.controls.touch.stickRadiusPx} format={(v) => `${Math.round(v)} PX`} onChange={(v) => set({ controls: { touch: { stickRadiusPx: v } } })} /></Row>
          <Row label="OPACITY"><Slider label="OPACITY" min={range("controls.touch.opacity01")[0]} max={1} step={0.05} value={s.controls.touch.opacity01} format={pct} onChange={(v) => set({ controls: { touch: { opacity01: v } } })} /></Row>
        </>
      );
    }
  })();

  function resetTab(): void {
    const d = defaultSettings({ reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
    switch (tab) {
      case "controls": set({ controls: { sensitivity: d.controls.sensitivity, verticalMul: d.controls.verticalMul, invertY: d.controls.invertY, padDeadzone: d.controls.padDeadzone, bindings: {} } }); break;
      case "camera": set({ camera: d.camera }); break;
      case "audio": set({ audio: d.audio }); break;
      case "video": set({ video: d.video }); break;
      case "show": set({ show: d.show }); break;
      case "access": set({ access: d.access }); break;
      case "touch": set({ controls: { touch: d.controls.touch } }); break;
    }
  }

  return (
    <div className={`tl-screen ${props.embedded ? "set--embedded" : "tl-screen--solid"} set`}>
      <header className="tl-showbar">
        {props.embedded ? null : <Wordmark className="tl-showbar__mark" />}
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">SETTINGS</div>
        <span className="tl-showbar__spacer" />
        <SlantButton label="BACK" size="sm" variant="paper" cue="back" onClick={back} />
      </header>
      <div className="tl-screen__body set__body">
        <Tabs label="SETTINGS" items={TABS} value={tab} onChange={setTab} />
        <div className="set__panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {body}
          <div className="set__reset"><SlantButton label="RESET TAB" size="sm" cue="back" onClick={resetTab} /></div>
        </div>
      </div>
      <footer className="tl-hintbar">
        <span className="tl-hint t-label"><ActionGlyph action="tab" device={game.pilot.device} /> TABS</span>
        <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> BACK</span>
      </footer>
    </div>
  );
}
