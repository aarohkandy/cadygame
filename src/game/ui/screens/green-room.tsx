// src/game/ui/screens/green-room.tsx (WP6)
// The green room (7.3.3, restyled to the show): reached by Esc from the title or the verdict, never on the way to
// the first fight (EMOTION_BIBLE 2: click = fight). A fresh profile's FIGHT here is still match 1. A place to play,
// not a dashboard. The live scene fills the left two thirds and the pilot arm
// follows the cursor (pointer ray through game.view.camera onto the ego z = 0.15 plane → pilot.setCursorTarget).
// The DOM menu on the right steers it: hovering a row points the arm across the deck, a mouse click fires a real
// jab and changes screen once it lands, and keyboard or pad activation skips the jab.
"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Vector3 } from "three";
import type { DriverSpec, EntrantRecord, GameHandle, LoadoutId, MatchPreset, PersonalityId, TierId } from "../../contracts.ts";
import { MOUNT_X, RENDER_SCALE } from "../../contracts.ts";
import { BrandMarkSvg, Wordmark } from "../../brand/wordmark.tsx";
import { lobbyCursorTargetEgo } from "../../render/lobby-tiles.tsx";
import { firstMatchConfig, quickFightConfig, warmupConfig } from "../../match/match-config.ts";
import { LOADOUT_LABEL, PERSONALITY_LABEL, PRESET_LABEL, SEP, TIER_LABEL, formatRecord } from "../hud/format.ts";
import { useSetting, useUi } from "../hud/hud.tsx";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Toggle } from "../kit/toggle.tsx";
import { sharedProfile, type WinLoss } from "../meta/profile.ts";
import { LoadoutPicker } from "./loadout-picker.tsx";

/* ───────────────────────── lobby choice (per-browser convenience) ───────────────────────── */

export const LOBBY_KEY = "torquelimit.lobby.v1";

export type LobbyOpponent =
  | { kind: "builtin"; personality: Exclude<PersonalityId, "jig">; tier: TierId }
  | { kind: "entrant"; id: string; name: string };

export interface LobbyChoice {
  opponent: LobbyOpponent; loadout: LoadoutId; modelPreset: Extract<MatchPreset, "arcade" | "proving_ground">;
  /** Streamer fields (8.4): NAME THE CHALLENGER and CHAT SEED, both optional, no backend. */
  challenger: string; chatSeed: string;
}

export const DEFAULT_LOBBY: LobbyChoice = {
  opponent: { kind: "builtin", personality: "deadband", tier: "contender" }, loadout: "pivot", modelPreset: "proving_ground",
  challenger: "", chatSeed: "",
};

export function loadLobbyChoice(): LobbyChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(LOBBY_KEY) ?? "null") as Partial<LobbyChoice> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_LOBBY;
    const o = raw.opponent;
    const loadout = raw.loadout === "whip" || raw.loadout === "anvil" || raw.loadout === "pivot" ? raw.loadout : DEFAULT_LOBBY.loadout;
    const modelPreset = raw.modelPreset === "arcade" ? "arcade" : "proving_ground";
    const tiers: TierId[] = ["rookie", "contender", "pro", "champion"];
    const people = ["overshoot", "backlash", "deadband"];
    let opponent: LobbyOpponent = DEFAULT_LOBBY.opponent;
    if (o && o.kind === "builtin" && people.includes(o.personality) && tiers.includes(o.tier)) opponent = { kind: "builtin", personality: o.personality, tier: o.tier };
    else if (o && o.kind === "entrant" && typeof o.id === "string" && typeof o.name === "string") opponent = { kind: "entrant", id: o.id, name: o.name };
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 32) : "");
    return { opponent, loadout, modelPreset, challenger: text(raw.challenger), chatSeed: text(raw.chatSeed) };
  } catch {
    return DEFAULT_LOBBY;
  }
}

export function saveLobbyChoice(patch: Partial<LobbyChoice>): LobbyChoice {
  const next = { ...loadLobbyChoice(), ...patch };
  try { localStorage.setItem(LOBBY_KEY, JSON.stringify(next)); } catch { /* storage blocked: the choice lasts this session */ }
  return next;
}

export function entrantSpec(e: EntrantRecord): DriverSpec {
  return e.kind === "module"
    ? { kind: "module", fileName: e.fileName, source: e.source, sha256: e.sha256 }
    : { kind: "trajectory", fileName: e.fileName, json: e.source, sha256: e.sha256 };
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/* ───────────────────────── menu ───────────────────────── */

export type LobbyMenuId = "fight" | "entrants" | "loadout" | "warmup" | "lab" | "replays" | "settings";
/** Rundown rows, in the order the arm fans across the deck (lobbyCursorTargetEgo). */
export const LOBBY_MENU_IDS: readonly LobbyMenuId[] = ["fight", "entrants", "loadout", "warmup", "lab", "replays", "settings"];
const MENU_LABEL: Readonly<Record<LobbyMenuId, string>> = {
  fight: "FIGHT", entrants: "ENTRANTS", loadout: "LOADOUT", warmup: "WARM UP", lab: "THE LAB", replays: "REPLAYS", settings: "SETTINGS",
};
/** Jab travel before a clicked tile breaks, and the beat after the break (7.3.3). */
export const TILE_JAB_MS = 260;
export const TILE_BREAK_MS = 220;
const CURSOR_PLANE_Z = 0.15;

export function GreenRoom(props: { game: GameHandle }): JSX.Element {
  const { game } = props;
  const play = useUiCue();
  const [choice, setChoice] = useState<LobbyChoice>(loadLobbyChoice);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<LobbyMenuId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callsign = useSetting(game, (s) => s.profile.callsign);
  const matchesPlayed = useSetting(game, (s) => s.profile.matchesPlayed);
  const phase = useUi(game, (s) => s.phase);
  const [record, setRecord] = useState(() => sharedProfile().totals());
  const [h2h, setH2h] = useState<WinLoss | null>(null);
  const pending = useRef<number | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);

  useEffect(() => sharedProfile().subscribe(() => setRecord(sharedProfile().totals())), []);

  // Opening the kit picker makes the rundown taller than its column: bring the picker into view so the
  // kit you are choosing is on screen, rather than leaving it under the fold.
  useEffect(() => {
    if (!expanded) return;
    const picker = menuRef.current?.querySelector(".loadout");
    picker?.scrollIntoView({ block: "nearest" });
  }, [expanded]);

  /* The call sheet's head-to-head: this pilot against tonight's opponent, out of the local profile. */
  useEffect(() => {
    let live = true;
    const read = async (): Promise<void> => {
      const o = choice.opponent;
      if (o.kind === "builtin") {
        const spec: DriverSpec = { kind: "builtin", personality: o.personality, tier: o.tier, dda: true };
        if (live) setH2h(sharedProfile().record(spec, o.tier));
        return;
      }
      const rec = (await game.harness.entrants.list()).find((e) => e.id === o.id);
      if (live) setH2h(rec ? sharedProfile().record(entrantSpec(rec), null) : null);
    };
    void read();
    const off = sharedProfile().subscribe(() => { void read(); });
    return () => { live = false; off(); };
  }, [choice.opponent, game]);
  // The lobby arm wears the picked kit: the director retunes the idle arm's servos whenever this changes.
  useEffect(() => { game.director.setLobbyLoadout(choice.loadout); }, [game, choice.loadout]);
  useEffect(() => () => { if (pending.current !== null) window.clearTimeout(pending.current); }, []);

  /* cursor → arm */
  useEffect(() => {
    const ndc = new Vector3();
    const origin = new Vector3();
    const dir = new Vector3();
    const planeY = CURSOR_PLANE_Z * RENDER_SCALE;
    const onMove = (e: PointerEvent) => {
      const cam = game.view.camera;
      const canvas = game.view.canvas;
      if (!cam || !canvas || e.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      if (e.clientX > rect.left + rect.width * 0.68) return;   // the menu column steers by hover instead
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam);
      origin.setFromMatrixPosition(cam.matrixWorld);
      dir.copy(ndc).sub(origin);
      if (Math.abs(dir.y) < 1e-6) return;
      const k = (planeY - origin.y) / dir.y;
      if (k <= 0) return;
      const rx = origin.x + dir.x * k, rz = origin.z + dir.z * k;
      // Render → sim world (x·s, z·s, −y·s)⁻¹, then world → atlas ego.
      const wx = rx / RENDER_SCALE, wy = -rz / RENDER_SCALE;
      game.pilot.setCursorTarget([wx - MOUNT_X.atlas, wy, CURSOR_PLANE_Z]);
    };
    const onLeave = () => game.pilot.setCursorTarget(null);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      game.pilot.setCursorTarget(null);
    };
  }, [game]);

  const opponentSpec = useCallback(async (): Promise<{ spec: DriverSpec; preset: MatchPreset } | null> => {
    const o = choice.opponent;
    if (o.kind === "builtin") return { spec: { kind: "builtin", personality: o.personality, tier: o.tier, dda: true }, preset: "arcade" };
    const list = await game.harness.entrants.list();
    const rec = list.find((e) => e.id === o.id);
    if (!rec) return null;
    return { spec: entrantSpec(rec), preset: choice.modelPreset };
  }, [choice, game]);

  const go = useCallback(async (id: LobbyMenuId): Promise<void> => {
    setError(null);
    switch (id) {
      case "fight": {
        if (busy) return;
        setBusy(true);
        try {
          void game.pilot.requestLock();
          if (matchesPlayed === 0) {
            await game.director.startMatch(firstMatchConfig(randomSeed(), game.settings.get()));
            return;
          }
          const opp = await opponentSpec();
          if (!opp) {
            saveLobbyChoice({ opponent: DEFAULT_LOBBY.opponent });
            setChoice(loadLobbyChoice());
            setError("ENTRANT REMOVED · PICK AGAIN");
            return;
          }
          await game.director.startMatch(quickFightConfig({
            opponent: opp.spec, loadout: choice.loadout, preset: opp.preset, seed: randomSeed(), settings: game.settings.get(),
            challengerName: choice.challenger, chatSeed: choice.chatSeed,
          }));
        } catch (err) {
          setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START");
        } finally {
          setBusy(false);
        }
        return;
      }
      case "warmup":
        void game.pilot.requestLock();
        try { await game.director.startMatch(warmupConfig(randomSeed(), choice.loadout, game.settings.get())); }
        catch (err) { setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START"); }
        return;
      case "loadout": setExpanded((x) => !x); return;
      case "entrants": game.ui.set({ screen: "entrants" }); return;
      case "lab": game.ui.set({ screen: "lab" }); return;
      case "replays": game.ui.set({ screen: "replays" }); return;
      case "settings": game.ui.set({ screen: "settings" }); return;
    }
  }, [busy, choice, game, matchesPlayed, opponentSpec]);

  const pointAt = useCallback((id: LobbyMenuId | null) => {
    setHover(id);
    game.pilot.setCursorTarget(id ? lobbyCursorTargetEgo(LOBBY_MENU_IDS.indexOf(id)) : null);
  }, [game]);

  /** Mouse click: the arm jabs the tile; the screen changes once it breaks. */
  const clickTile = useCallback((id: LobbyMenuId) => {
    if (pending.current !== null) return;
    if (id === "loadout") { void go(id); return; }
    pointAt(id);
    game.pilot.triggerJab();
    pending.current = window.setTimeout(() => {
      play("stamp");
      pending.current = window.setTimeout(() => { pending.current = null; void go(id); }, TILE_BREAK_MS);
    }, TILE_JAB_MS);
  }, [game, go, play, pointAt]);

  const o = choice.opponent;
  const oppName = o.kind === "builtin" ? PERSONALITY_LABEL[o.personality] : o.name;
  const oppSub = o.kind === "builtin"
    ? `${TIER_LABEL[o.tier]}${SEP}${LOADOUT_LABEL[choice.loadout]}`
    : `${PRESET_LABEL[choice.modelPreset]}${SEP}${LOADOUT_LABEL[choice.loadout]}`;
  const ready = phase === "green_room";

  return (
    <div className="tl-screen tl-screen--scrim-right gr">
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">GREEN ROOM</div>
        <span className="gr__tally t-label" data-ready={ready ? "true" : "false"} role="status">
          <i aria-hidden="true" />{ready ? "STAGE READY" : "STANDBY"}
        </span>
        <span className="tl-showbar__spacer" />
        <BrandMarkSvg id="pulpoPop" title={null} recolor={{ ink: "paper", paper: "ink" }} className="gr__sponsor" />
      </header>

      <div className="gr__body">
        <div className="gr__stage" aria-hidden="true" />
        <div className="gr__side">
          <section className="gr__sheet tl-plate tl-plate--lip-signal tl-plate--cut-left" aria-label="CALL SHEET">
            <span className="t-label gr__sheet-title">CALL SHEET</span>
            <span className="t-plate gr__sheet-name" style={{ ["--name-len" as string]: (matchesPlayed > 0 ? oppName : "BACKLASH").length }}>{matchesPlayed > 0 ? oppName : "BACKLASH"}</span>
            <span className="t-mono gr__sheet-line">{matchesPlayed > 0 ? oppSub : `ROOKIE${SEP}SPARRING FIRST`}</span>
            <span className="t-mono gr__sheet-h2h">
              {h2h && (h2h.w > 0 || h2h.l > 0) ? `HEAD TO HEAD ${formatRecord(h2h.w, h2h.l)}` : "FIRST MEETING"}
            </span>
            {matchesPlayed > 0 ? (
              <div className="grid gap-1" aria-label="STREAMER FIELDS">
                <label className="t-label grid gap-1">NAME THE CHALLENGER
                  <input className="t-mono tl-plate tl-plate--ink" maxLength={16} value={choice.challenger} placeholder={oppName}
                    onChange={(e) => setChoice(saveLobbyChoice({ challenger: e.currentTarget.value }))} />
                </label>
                <label className="t-label grid gap-1">CHAT SEED
                  <input className="t-mono tl-plate tl-plate--ink" maxLength={32} value={choice.chatSeed} placeholder="RANDOM"
                    onChange={(e) => setChoice(saveLobbyChoice({ chatSeed: e.currentTarget.value }))} />
                </label>
              </div>
            ) : null}
          </section>
          <nav className="gr__menu" aria-label="GREEN ROOM" ref={menuRef} onMouseLeave={() => pointAt(null)}>
            {LOBBY_MENU_IDS.map((id, i) => (
              <div key={id} className="gr__item tl-anim-slide-r" style={{ animationDelay: `${i * 40}ms` }}>
                <SlantButton
                  label={MENU_LABEL[id]}
                  variant={id === "fight" ? "primary" : "ink"}
                  block
                  autoFocus={id === "fight"}
                  disabled={!ready || (busy && id === "fight")}
                  active={hover === id}
                  lead={<span className="gr__index t-mono">{String(i + 1).padStart(2, "0")}</span>}
                  hint={id === "fight" ? (matchesPlayed > 0 ? null : "MATCH 1") : id === "loadout" ? LOADOUT_LABEL[choice.loadout] : null}
                  aria-expanded={id === "loadout" ? expanded : undefined}
                  cue={id === "loadout" ? "select" : null}
                  onMouseEnter={() => pointAt(id)}
                  onFocus={() => pointAt(id)}
                  onClick={(e) => {
                    // detail 0 is a keyboard or pad activation: it skips the jab.
                    if (e.detail === 0) { play("select"); void go(id); }
                    else clickTile(id);
                  }}
                />
                {id === "fight" ? (
                  <div className="gr__fight-meta">
                    <span className="t-mono">{matchesPlayed > 0 ? `VS ${oppName}` : `VS BACKLASH${SEP}BEST OF 3`}</span>
                    {matchesPlayed > 0 && o.kind === "entrant" ? (
                      <Toggle
                        label="PRESET"
                        value={choice.modelPreset}
                        options={[{ value: "arcade", label: PRESET_LABEL.arcade }, { value: "proving_ground", label: PRESET_LABEL.proving_ground }]}
                        onChange={(v) => setChoice(saveLobbyChoice({ modelPreset: v }))}
                      />
                    ) : (
                      <span className="tl-sticker tl-sticker--ink">{PRESET_LABEL.arcade}</span>
                    )}
                  </div>
                ) : null}
                {id === "loadout" && expanded ? (
                  <LoadoutPicker value={choice.loadout} matchesPlayed={matchesPlayed} onChange={(l) => { setChoice(saveLobbyChoice({ loadout: l })); }} />
                ) : null}
              </div>
            ))}
              {error ? <div className="tl-error t-label" role="alert">{error}</div> : null}
          </nav>
        </div>
      </div>

      <footer className="gr__foot">
        <label className="gr__callsign tl-plate tl-plate--lip-cobalt tl-plate--cut-left">
          <span className="t-label gr__callsign-label">CALLSIGN</span>
          <input
            className="tl-field tl-field--callsign gr__callsign-input"
            maxLength={12}
            value={callsign}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => game.settings.set({ profile: { callsign: e.currentTarget.value.toUpperCase() } })}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); e.stopPropagation(); }}
          />
          <span className="t-mono gr__record">{formatRecord(record.w, record.l)}</span>
        </label>
        <div className="tl-hintbar">
          <span className="tl-hint t-label"><ActionGlyph action="navigate" device={game.pilot.device} /> MOVE</span>
          <span className="tl-hint t-label"><ActionGlyph action="confirm" device={game.pilot.device} /> SELECT</span>
        </div>
      </footer>
    </div>
  );
}
