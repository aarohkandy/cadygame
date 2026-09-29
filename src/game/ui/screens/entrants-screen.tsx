// src/game/ui/screens/entrants-screen.tsx (WP7)
// Entrants (7.3.4, trimmed by BUILD_PLAN D7): a carousel of slanted cards for JIG, OVERSHOOT, BACKLASH, DEADBAND, every
// registered user model, the dashed REGISTER ENTRANT drop card, and the LOCAL BRIDGE card. Each card shows its driver
// tag, style, loadout, and your local record; built-ins carry a tier selector. SELECT sets the green room's FIGHT;
// FIGHT starts it now.
"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from "react";
import type { BridgeHello, DriverSpec, EntrantRecord, GameHandle, MatchPreset, PersonalityId, TierId } from "../../contracts.ts";
import { BUILTIN_LOADOUTS, quickFightConfig, warmupConfig } from "../../match/match-config.ts";
import {
  LOADOUT_LABEL, PERSONALITY_LABEL, PERSONALITY_STYLE, PRESET_LABEL, SEP, TIER_LABEL, driverTag, formatRecord, formatStamp, shortSha,
} from "../hud/format.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { ActionGlyph, Glyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Toggle } from "../kit/toggle.tsx";
import { sharedProfile } from "../meta/profile.ts";
import { DEFAULT_LOBBY, entrantSpec, loadLobbyChoice, randomSeed, saveLobbyChoice } from "./green-room.tsx";
import { ENTRANT_EXTENSIONS, RegisterEntrant } from "./register-entrant.tsx";

const TIERS: readonly TierId[] = ["rookie", "contender", "pro", "champion"];
const BUILTINS: readonly PersonalityId[] = ["jig", "overshoot", "backlash", "deadband"];
export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8765";

const TAGLINE: Readonly<Record<PersonalityId, string>> = {
  jig: "THE TEST RIG · SPARS ON REQUEST",
  overshoot: "CLOSES FAST · SWINGS PAST",
  backlash: "WAITS · THEN MAKES YOU PAY",
  deadband: "HIDES INTENT · FEINTS OFTEN",
};

/** A side-view arm pose per entrant, drawn in its colorway (the card portrait). */
function Portrait(props: { pose: PersonalityId | "model" | "bridge" }): JSX.Element {
  const poses: Readonly<Record<string, string>> = {
    jig: "M40 170h60M70 170v-30l10-40 50-10 20 10",
    overshoot: "M40 170h60M70 170v-30l30-50 60 20 20 30",
    backlash: "M40 170h60M70 170v-30l-5-55 40-25 35 5",
    deadband: "M40 170h60M70 170v-30l20-45 55 5 5 35",
    model: "M40 170h60M70 170v-30l15-50 55-5 20 20",
    bridge: "M40 170h60M70 170v-30l15-50 55-5 20 20",
  };
  return (
    <svg viewBox="0 0 220 190" className="ent-card__portrait" aria-hidden="true">
      <path d="M0 176h220" stroke="var(--ink-500)" strokeWidth="3" />
      <path d={poses[props.pose]} fill="none" stroke="var(--paper)" strokeWidth="14" strokeLinecap="square" strokeLinejoin="miter" />
      <path d={poses[props.pose]} fill="none" stroke="var(--magenta)" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

function RecordLine(props: { spec: DriverSpec; tier?: TierId | null }): JSX.Element {
  const profile = sharedProfile();
  const all = profile.record(props.spec, null);
  const tier = props.tier ? profile.record(props.spec, props.tier) : null;
  return (
    <span className="t-mono ent-card__record">
      {tier && props.tier ? `${TIER_LABEL[props.tier]} ${formatRecord(tier.w, tier.l)}${SEP}ALL ${formatRecord(all.w, all.l)}` : `YOUR RECORD ${formatRecord(all.w, all.l)}`}
    </span>
  );
}

export function EntrantsScreen(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const lobby = loadLobbyChoice();
  const [tiers, setTiers] = useState<Record<string, TierId>>(() => {
    const o = lobby.opponent;
    return o.kind === "builtin" ? { [o.personality]: o.tier } : {};
  });
  const [entrants, setEntrants] = useState<EntrantRecord[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
  const [allowLan, setAllowLan] = useState(false);
  const [bridge, setBridge] = useState<{ state: "idle" | "probing" | "ok" | "fail"; hello: BridgeHello | null; message: string | null }>({ state: "idle", hello: null, message: null });
  const [bridgePreset, setBridgePreset] = useState<Extract<MatchPreset, "arcade" | "proving_ground">>("proving_ground");
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setVersion] = useState(0);

  const refresh = useCallback(() => {
    game.harness.entrants.list().then(
      (list) => setEntrants(list.slice().sort((a, b) => b.created.localeCompare(a.created))),
      (err: unknown) => { setEntrants([]); setError(err instanceof Error ? err.message.toUpperCase() : "ENTRANTS UNAVAILABLE"); },
    );
  }, [game]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => sharedProfile().subscribe(() => setVersion((v) => v + 1)), []);

  const back = () => game.ui.set({ screen: "green_room" });

  async function fight(spec: DriverSpec, preset: MatchPreset): Promise<void> {
    setError(null);
    try {
      void game.pilot.requestLock();
      await game.director.startMatch(quickFightConfig({ opponent: spec, loadout: loadLobbyChoice().loadout, preset, seed: randomSeed(), settings: game.settings.get() }));
    } catch (err) {
      setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START");
    }
  }

  function selectBuiltin(p: Exclude<PersonalityId, "jig">, fightNow: boolean): void {
    const tier = tiers[p] ?? "contender";
    saveLobbyChoice({ opponent: { kind: "builtin", personality: p, tier } });
    if (fightNow) void fight({ kind: "builtin", personality: p, tier, dda: true }, "arcade");
    else back();
  }

  function selectEntrant(e: EntrantRecord, fightNow: boolean): void {
    saveLobbyChoice({ opponent: { kind: "entrant", id: e.id, name: e.fileName } });
    if (fightNow) void fight(entrantSpec(e), loadLobbyChoice().modelPreset);
    else back();
  }

  async function remove(e: EntrantRecord): Promise<void> {
    await game.harness.entrants.remove(e.id);
    const o = loadLobbyChoice().opponent;
    if (o.kind === "entrant" && o.id === e.id) saveLobbyChoice({ opponent: DEFAULT_LOBBY.opponent });
    setConfirmRemove(null);
    refresh();
  }

  function pickFile(f: File | null | undefined): void {
    if (!f) return;
    setError(null);
    setFile(f);
  }

  function onDrop(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  }

  async function probe(): Promise<void> {
    setBridge({ state: "probing", hello: null, message: null });
    try {
      const hello = await game.probeBridge(bridgeUrl.trim(), allowLan);
      setBridge({ state: "ok", hello, message: null });
      play("sticker");
    } catch (err) {
      setBridge({ state: "fail", hello: null, message: err instanceof Error ? err.message : String(err) });
      play("back");
    }
  }

  const selected = lobby.opponent;

  return (
    <div className="tl-screen tl-screen--scrim ent" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">ENTRANTS</div>
        <span className="tl-showbar__spacer" />
        <SlantButton label="BACK" size="sm" variant="paper" cue="back" onClick={back} />
      </header>

      <div className="tl-screen__body ent__body">
        <div className="ent__rail" role="list">
          {BUILTINS.map((p, i) => {
            const tier = tiers[p] ?? "contender";
            const isJig = p === "jig";
            const spec: DriverSpec = { kind: "builtin", personality: p, tier, dda: true };
            const isSelected = selected.kind === "builtin" && selected.personality === p;
            return (
              <article key={p} role="listitem" className="ent-card tl-anim-slide-up" data-selected={isSelected ? "true" : "false"} style={{ animationDelay: `${i * 40}ms` }}>
                <Portrait pose={p} />
                <span className="t-label ent-card__style">{PERSONALITY_STYLE[p]}</span>
                <h2 className="t-display-l t-slant ent-card__name" style={{ ["--name-len" as string]: PERSONALITY_LABEL[p].length }}>{PERSONALITY_LABEL[p]}</h2>
                <span className="t-mono ent-card__tag">{isJig ? `BUILT-IN${SEP}SPARRING` : driverTag(spec)}{SEP}{LOADOUT_LABEL[BUILTIN_LOADOUTS[p]]}</span>
                <span className="t-label ent-card__line">{TAGLINE[p]}</span>
                {isJig ? <span className="t-mono ent-card__record">NO RECORD KEPT</span> : <RecordLine spec={spec} tier={tier} />}
                {!isJig ? (
                  <Toggle label="TIER" value={tier} options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
                    onChange={(t) => setTiers((m) => ({ ...m, [p]: t }))} className="ent-card__tiers" />
                ) : null}
                <div className="ent-card__actions">
                  {isJig ? (
                    <SlantButton label="WARM UP" size="sm" variant="primary" onClick={() => {
                      void game.pilot.requestLock();
                      game.director.startMatch(warmupConfig(randomSeed(), loadLobbyChoice().loadout, game.settings.get())).catch((err: unknown) => setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START"));
                    }} />
                  ) : (
                    <>
                      <SlantButton label="FIGHT" size="sm" variant="primary" onClick={() => selectBuiltin(p, true)} />
                      <SlantButton label={isSelected ? "SELECTED" : "SELECT"} size="sm" onClick={() => selectBuiltin(p, false)} />
                    </>
                  )}
                </div>
              </article>
            );
          })}

          {(entrants ?? []).map((e, i) => {
            const spec = entrantSpec(e);
            const isSelected = selected.kind === "entrant" && selected.id === e.id;
            return (
              <article key={e.id} role="listitem" className="ent-card ent-card--model tl-anim-slide-up" data-selected={isSelected ? "true" : "false"} style={{ animationDelay: `${Math.min(6, 4 + i) * 40}ms` }}>
                <Portrait pose="model" />
                <span className="t-label ent-card__style">{e.kind === "module" ? "USER MODEL" : "TRAJECTORY"}</span>
                <h2 className="t-plate ent-card__name ent-card__name--file" style={{ ["--name-len" as string]: e.fileName.length }}>{e.fileName}</h2>
                <span className="t-mono ent-card__tag">sha {shortSha(e.sha256)}{SEP}{formatStamp(e.created)}</span>
                <span className="t-label ent-card__line">{e.name && e.name !== e.fileName ? e.name.toUpperCase() : "REGISTERED ENTRANT"}</span>
                <RecordLine spec={spec} tier={null} />
                <div className="ent-card__actions">
                  {confirmRemove === e.id ? (
                    <>
                      <SlantButton label="REMOVE IT" size="sm" variant="primary" cue="back" onClick={() => void remove(e)} />
                      <SlantButton label="KEEP" size="sm" onClick={() => setConfirmRemove(null)} />
                    </>
                  ) : (
                    <>
                      <SlantButton label="FIGHT" size="sm" variant="primary" onClick={() => selectEntrant(e, true)} />
                      <SlantButton label={isSelected ? "SELECTED" : "SELECT"} size="sm" onClick={() => selectEntrant(e, false)} />
                      <button type="button" className="ent-card__icon" aria-label="REMOVE ENTRANT" onClick={() => setConfirmRemove(e.id)}><Glyph name="trash" /></button>
                    </>
                  )}
                </div>
              </article>
            );
          })}

          <article role="listitem" className="ent-card ent-card--register" data-drag={dragging ? "true" : "false"}>
            <button type="button" className="ent-register" onClick={() => inputRef.current?.click()}>
              <Glyph name="upload" className="ent-register__icon" />
              <span className="t-display-l t-slant ent-register__title">REGISTER ENTRANT</span>
              <span className="t-label">DROP A FILE OR BROWSE</span>
              <span className="t-mono">{ENTRANT_EXTENSIONS.join("  ")}</span>
            </button>
            <input ref={inputRef} type="file" accept={ENTRANT_EXTENSIONS.join(",")} hidden onChange={(e) => { pickFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          </article>

          <article role="listitem" className="ent-card ent-card--bridge">
            <Portrait pose="bridge" />
            <span className="t-label ent-card__style">PYTHON PROCESS</span>
            <h2 className="t-display-l t-slant ent-card__name" style={{ ["--name-len" as string]: "LOCAL BRIDGE".length }}>LOCAL BRIDGE</h2>
            <label className="ent-bridge__field">
              <span className="t-label">URL</span>
              <input className="tl-field" value={bridgeUrl} spellCheck={false} onChange={(e) => setBridgeUrl(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <Toggle label="NETWORK" value={allowLan ? "lan" : "local"} options={[{ value: "local", label: "THIS MACHINE" }, { value: "lan", label: "ALLOW LAN" }]} onChange={(v) => setAllowLan(v === "lan")} />
            {bridge.state === "ok" && bridge.hello ? (
              <dl className="ent-bridge__hello">
                <div><dt className="t-label">POLICY</dt><dd className="t-plate">{bridge.hello.name}{bridge.hello.version ? ` ${bridge.hello.version}` : ""}</dd></div>
                <div><dt className="t-label">CLAIMED SHA</dt><dd className="t-mono">{bridge.hello.claimedSha256 ? shortSha(bridge.hello.claimedSha256) : "NONE"}</dd></div>
                <div><dt className="t-label">CHUNKS</dt><dd className="t-mono">{bridge.hello.supportsChunks ? `${bridge.hello.maxChunk} AT ${bridge.hello.chunkHz} HZ` : "NO"}</dd></div>
                {bridge.hello.provenance ? Object.entries(bridge.hello.provenance).slice(0, 6).map(([k, v]) => (
                  <div key={k}><dt className="t-label">{k.replace(/_/g, " ").toUpperCase().slice(0, 18)}</dt><dd className="t-mono">{typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)}</dd></div>
                )) : null}
              </dl>
            ) : null}
            {bridge.state === "fail" ? <p className="tl-error t-mono">{bridge.message}</p> : null}
            <div className="ent-card__actions">
              {bridge.state === "ok" ? (
                <>
                  <Toggle label="PRESET" value={bridgePreset} options={[{ value: "arcade", label: PRESET_LABEL.arcade }, { value: "proving_ground", label: PRESET_LABEL.proving_ground }]} onChange={setBridgePreset} />
                  <SlantButton label="FIGHT" size="sm" variant="primary" onClick={() => void fight({ kind: "bridge", url: bridgeUrl.trim(), allowLan, sessionId: crypto.randomUUID() }, bridgePreset)} />
                </>
              ) : null}
              <SlantButton label={bridge.state === "probing" ? "CONNECTING" : bridge.state === "ok" ? "RECONNECT" : "CONNECT"} size="sm" disabled={bridge.state === "probing"} onClick={() => void probe()} />
            </div>
          </article>
        </div>
        {error ? <div className="tl-error t-label" role="alert">{error}</div> : null}
      </div>

      <footer className="tl-hintbar">
        <span className="tl-hint t-label"><ActionGlyph action="navigate" device={game.pilot.device} /> BROWSE</span>
        <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> BACK</span>
      </footer>

      {file ? (
        <RegisterEntrant
          game={game}
          file={file}
          onClose={() => { setFile(null); refresh(); }}
          onRegistered={(rec, fightNow) => { setFile(null); refresh(); selectEntrant(rec, fightNow); }}
        />
      ) : null}
    </div>
  );
}
