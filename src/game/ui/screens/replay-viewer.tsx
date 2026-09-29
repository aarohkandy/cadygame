// src/game/ui/screens/replay-viewer.tsx (WP7)
// Replay viewer (7.3.6 as kept by BUILD_PLAN D6): a scrub timeline with event markers, transport (play, pause, frame
// steps, 0.25× to 4×), the BRAIN panel reading each policy's recorded debug at the playhead, and VERIFY with progress.
// The playhead and clock are written from requestAnimationFrame straight to the DOM.
"use client";

import { useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import type { Episode, GameEvent, GameHandle, PolicyDebug, Seat, VerifyResult } from "../../contracts.ts";
import { SEATS } from "../../contracts.ts";
import { PRESET_LABEL, SEP, formatDuration } from "../hud/format.ts";
import { ActionGlyph, Glyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { Toggle } from "../kit/toggle.tsx";
import { verifyStampLabel, viewerEpisodeId } from "./replays-screen.tsx";

type Rate = 0.25 | 0.5 | 1 | 2 | 4;
const RATES: readonly Rate[] = [0.25, 0.5, 1, 2, 4];

interface Marker { t: number; kind: "strike" | "crit" | "deflect" | "ko" | "core" | "round" | "fault"; seat: Seat | null; label: string }

export function markersOf(events: readonly GameEvent[]): Marker[] {
  const out: Marker[] = [];
  for (const e of events) {
    switch (e.type) {
      case "strike": if (e.tier === "strike" && !e.guarded) out.push({ t: e.t, kind: e.crit ? "crit" : "strike", seat: e.attacker, label: `${e.crit ? "CRIT" : "STRIKE"} ${Math.round(e.damage > 0 ? e.damage : e.physicalDamage)}` }); break;
      case "deflect": out.push({ t: e.t, kind: "deflect", seat: e.defender, label: "DEFLECT" }); break;
      case "ko": out.push({ t: e.t, kind: "ko", seat: e.attacker, label: "KNOCKOUT" }); break;
      case "core": if (e.stage === "steal" || e.stage === "lock") out.push({ t: e.t, kind: "core", seat: e.seat, label: e.stage === "lock" ? "LOCKED" : e.late ? "LATE STEAL" : "STOLEN" }); break;
      case "round_end": out.push({ t: e.t, kind: "round", seat: e.winner, label: "ROUND END" }); break;
      case "policy_fault": out.push({ t: e.t, kind: "fault", seat: e.seat, label: "POLICY FAULT" }); break;
      default: break;
    }
  }
  return out;
}

function BrainPanel(props: { game: GameHandle; seats: readonly Seat[]; names: Record<Seat, string> }): JSX.Element {
  const refs = useRef<Partial<Record<Seat, HTMLPreElement | null>>>({});
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 100) {
        last = now;
        for (const s of props.seats) {
          const el = refs.current[s];
          if (!el) continue;
          const d: PolicyDebug | null = props.game.replay.debugAt(s);
          el.textContent = d ? formatDebug(d) : "no debug recorded at this frame";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.game, props.seats]);
  return (
    <aside className="rv-brain" aria-label="BRAIN">
      <span className="t-label">BRAIN</span>
      {props.seats.map((s) => (
        <div key={s} className={`rv-brain__seat rv-brain__seat--${s}`}>
          <span className="t-plate">{props.names[s]}</span>
          <pre className="t-mono" ref={(el) => { refs.current[s] = el; }} />
        </div>
      ))}
    </aside>
  );
}

export function formatDebug(d: PolicyDebug): string {
  const lines: string[] = [];
  if (d.state) lines.push(`state      ${d.state}`);
  if (d.primitive) lines.push(`primitive  ${d.primitive}`);
  if (d.phase) lines.push(`phase      ${d.phase}`);
  if (d.intent) lines.push(`intent     ${d.intent}`);
  if (d.mood) lines.push(`mood       agg ${d.mood.aggression.toFixed(2)} comp ${d.mood.composure.toFixed(2)} focus ${d.mood.focus.toFixed(2)}`);
  if (typeof d.dda === "number") lines.push(`dda k      ${d.dda.toFixed(2)}`);
  if (d.parryGuess) lines.push(`parry      release ${d.parryGuess.expectedReleaseT.toFixed(3)} s  err ${d.parryGuess.errorMs.toFixed(0)} ms${d.parryGuess.capped ? "  capped" : ""}`);
  if (d.flaw) lines.push(`flaw       ${d.flaw.flaw} ${d.flaw.stage} x${d.flaw.count}`);
  if (d.utilities) {
    const top = Object.entries(d.utilities).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [k, v] of top) lines.push(`  ${k.padEnd(12)} ${v.toFixed(3)}`);
  }
  return lines.join("\n") || "no fields";
}

export function ReplayViewer(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const player = game.replay;
  const play = useUiCue();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(player.playing);
  const [rate, setRate] = useState<Rate>(1);
  const [brain, setBrain] = useState(true);
  const [verify, setVerify] = useState<{ state: "idle" } | { state: "running"; f: number } | { state: "done"; result: VerifyResult } | { state: "error"; message: string }>({ state: "idle" });
  const headRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLElement>(null);
  const episodeId = viewerEpisodeId();

  useEffect(() => {
    if (!episodeId) return;
    let live = true;
    game.harness.store.load(episodeId).then((ep) => { if (live) setEpisode(ep); }, (err: unknown) => { if (live) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [game, episodeId]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const d = player.durationS;
      const f = d > 0 ? Math.min(1, Math.max(0, player.t / d)) : 0;
      if (headRef.current) headRef.current.style.transform = `translateX(${(f * 100).toFixed(3)}%)`;
      if (clockRef.current) clockRef.current.textContent = `${player.t.toFixed(2)} / ${d.toFixed(2)} s`;
      trackRef.current?.setAttribute("aria-valuenow", player.t.toFixed(1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  const markers = useMemo(() => (episode ? markersOf(episode.events) : []), [episode]);
  const names = episode ? { atlas: episode.meta.seats.atlas.name, blaze: episode.meta.seats.blaze.name } : { atlas: "ATLAS", blaze: "BLAZE" };
  const policySeats = episode ? SEATS.filter((s) => episode.meta.seats[s].driver !== "human" && episode.meta.seats[s].driver !== "proxy") : [];

  const toggle = () => { if (player.playing) player.pause(); else player.play(); setPlaying(player.playing); play("select"); };
  const step = (n: number) => { player.pause(); setPlaying(false); player.stepFrames(n); };
  const close = () => { play("back"); game.director.closeReplay(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space" || e.code === "KeyK") { e.preventDefault(); if (player.playing) player.pause(); else player.play(); setPlaying(player.playing); }
      else if (e.code === "ArrowRight" || e.code === "Period") { e.preventDefault(); player.pause(); setPlaying(false); player.stepFrames(e.shiftKey ? 10 : 1); }
      else if (e.code === "ArrowLeft" || e.code === "Comma") { e.preventDefault(); player.pause(); setPlaying(false); player.stepFrames(e.shiftKey ? -10 : -1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  function seekFromPointer(e: ReactPointerEvent<HTMLDivElement>): void {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    player.seek(f * player.durationS);
  }

  async function runVerify(): Promise<void> {
    setVerify({ state: "running", f: 0 });
    try {
      const result = await player.verify((f) => {
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, f)).toFixed(3)})`;
      });
      setVerify({ state: "done", result });
      play(result.verdict === "bit_exact" ? "sticker" : "back");
    } catch (err) {
      setVerify({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const duration = player.durationS;

  return (
    <div className="rv">
      <header className="rv__top">
        <span className="tl-sticker tl-sticker--lg">REPLAY</span>
        <span className="t-plate rv__title">{episode ? `${names.atlas} VS ${names.blaze}` : "LOADING EPISODE"}</span>
        {episode ? <span className="tl-sticker tl-sticker--ink">{PRESET_LABEL[episode.meta.preset]}</span> : null}
        {episode ? <span className="t-mono rv__meta">SEED {episode.meta.seed}{SEP}{formatDuration(duration)}{SEP}{episode.meta.controlHz} HZ</span> : null}
        <span className="tl-showbar__spacer" />
        <SlantButton label="CLOSE" size="sm" cue={null} onClick={close} />
      </header>

      {brain && policySeats.length > 0 ? <BrainPanel game={game} seats={policySeats} names={names} /> : null}

      <footer className="rv__bottom">
        {loadError ? <div className="tl-error t-mono">{loadError}</div> : null}
        <div className="rv__timeline" ref={trackRef} role="slider" aria-label="TIMELINE" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={0} tabIndex={0}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e); }}
          onPointerMove={(e) => { if (e.buttons & 1) seekFromPointer(e); }}>
          <div className="rv__rail" />
          {duration > 0 ? markers.map((m, i) => (
            <span key={i} className={`rv__marker rv__marker--${m.kind}`} data-seat={m.seat ?? "none"} style={{ left: `${Math.min(100, (m.t / duration) * 100)}%` }} title={m.label} />
          )) : null}
          <div className="rv__head" ref={headRef}><i /></div>
        </div>
        <div className="rv__transport">
          <button type="button" className="lab-icon" aria-label="BACK 10 FRAMES" onClick={() => step(-10)}><Glyph name="step-back" /></button>
          <button type="button" className="lab-icon" aria-label="BACK 1 FRAME" onClick={() => step(-1)}><Glyph name="chevron-left" /></button>
          <button type="button" className="lab-icon rv__play" aria-label={playing ? "PAUSE" : "PLAY"} onClick={toggle}><Glyph name={playing ? "pause" : "play"} /></button>
          <button type="button" className="lab-icon" aria-label="FORWARD 1 FRAME" onClick={() => step(1)}><Glyph name="chevron-right" /></button>
          <button type="button" className="lab-icon" aria-label="FORWARD 10 FRAMES" onClick={() => step(10)}><Glyph name="step-forward" /></button>
          <span className="t-mono rv__clock" ref={clockRef} />
          <Toggle label="SPEED" value={rate} options={RATES.map((r) => ({ value: r, label: `${r}X` }))} onChange={(r) => { setRate(r); player.setRate(r); }} />
          <Toggle label="BRAIN" value={brain ? "on" : "off"} options={[{ value: "on", label: "BRAIN ON" }, { value: "off", label: "BRAIN OFF", disabled: policySeats.length === 0 }]} onChange={(v) => setBrain(v === "on")} />
          <span className="tl-showbar__spacer" />
          <SlantButton label="VERIFY" size="sm" variant="primary" disabled={verify.state === "running" || !episode} onClick={() => void runVerify()} />
        </div>
        {verify.state === "running" ? (
          <div className="rv__verify"><span className="t-label">VERIFYING</span><span className="rv__progress"><i ref={progressRef} /></span></div>
        ) : null}
        {verify.state === "done" ? (
          <div className="rv__verify">
            <Stamp tone={verify.result.verdict === "bit_exact" ? "signal" : "fault"} size="s" animate>{verifyStampLabel(verify.result)}</Stamp>
            <span className="t-mono">{verify.result.checkedFrames} FRAMES{verify.result.divergedT !== null ? `${SEP}AT ${verify.result.divergedT.toFixed(3)} s` : ""}{verify.result.eventMismatch ? `${SEP}${verify.result.eventMismatch}` : ""}</span>
          </div>
        ) : null}
        {verify.state === "error" ? <div className="tl-error t-mono">{verify.message}</div> : null}
        <div className="tl-hintbar">
          <span className="tl-hint t-label"><ActionGlyph action="skip" device={game.pilot.device} /> PLAY</span>
          <span className="tl-hint t-label"><ActionGlyph action="navigate" device={game.pilot.device} /> STEP</span>
          <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> CLOSE</span>
        </div>
      </footer>
    </div>
  );
}
