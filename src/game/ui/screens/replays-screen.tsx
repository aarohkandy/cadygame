// src/game/ui/screens/replays-screen.tsx (WP7)
// Replays (7.3.6, trimmed by BUILD_PLAN D6): stored episodes as slanted rows (date, seats, preset, result, duration,
// verdict stamp, size, HUMAN tag, pin), a storage meter against the 1 GB non-human cap, an import drop zone that warns
// WILL EVICT N before a lossy import, and per-row OPEN, VERIFY, EXPORT, and DELETE. Imports verify straight away.
"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from "react";
import type { EpisodeSummary, GameHandle, StorageInfo, VerifyResult } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { PRESET_LABEL, SEP, formatBytes, formatDuration, formatStamp } from "../hud/format.ts";
import { ActionGlyph, Glyph } from "../kit/glyphs.tsx";
import { Hazard } from "../kit/hazard.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { downloadBlob, episodeFileName } from "./lab-results.tsx";

/** The episode the replay viewer shows (set just before director.openReplay). */
const replayViewerState = { episodeId: null as string | null };
export function viewerEpisodeId(): string | null { return replayViewerState.episodeId; }
export function setViewerEpisodeId(id: string | null): void { replayViewerState.episodeId = id; }

type RowState =
  | { kind: "idle" } | { kind: "verifying" } | { kind: "verified"; result: VerifyResult } | { kind: "error"; message: string } | { kind: "confirm_delete" };

const VERDICT_LABEL: Readonly<Record<EpisodeSummary["verdict"], string>> = {
  cleared: "CLEARED", fault: "FAULT", arcade: "ARCADE", none: "UNRATED",
};

export function verifyStampLabel(r: VerifyResult): string {
  return r.verdict === "bit_exact" ? `REPLAY VERIFIED${SEP}BIT-EXACT` : r.verdict === "diverged" ? `DIVERGED AT FRAME ${r.divergedFrame ?? "?"}` : "VERIFY ERROR";
}

export function ReplaysScreen(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const [list, setList] = useState<EpisodeSummary[] | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<{ file: File; evict: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([game.harness.store.list(), game.harness.store.storage()]);
      setList(l.slice().sort((a, b) => b.created.localeCompare(a.created)));
      setStorage(s);
    } catch (err) {
      setList([]);
      setNotice({ tone: "error", text: `STORAGE UNAVAILABLE${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}` });
    }
  }, [game]);
  useEffect(() => {
    let live = true;
    Promise.all([game.harness.store.list(), game.harness.store.storage()]).then(
      ([l, s]) => { if (live) { setList(l.slice().sort((a, b) => b.created.localeCompare(a.created))); setStorage(s); } },
      (err: unknown) => { if (live) { setList([]); setNotice({ tone: "error", text: `STORAGE UNAVAILABLE${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}` }); } },
    );
    return () => { live = false; };
  }, [game]);

  const setRow = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }));

  async function verify(id: string): Promise<void> {
    setRow(id, { kind: "verifying" });
    try {
      const ep = await game.harness.store.load(id);
      const result = await game.harness.checkDeterminism(ep);
      setRow(id, { kind: "verified", result });
      play(result.verdict === "bit_exact" ? "sticker" : "back");
    } catch (err) {
      setRow(id, { kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function doImport(file: File): Promise<void> {
    setImporting(null);
    setNotice(null);
    try {
      const id = await game.harness.store.importFile(file);
      setNotice({ tone: "ok", text: `IMPORTED${SEP}${file.name}` });
      await refresh();
      await verify(id);
    } catch (err) {
      const name = err instanceof Error && err.name && err.name !== "Error" ? `${err.name.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()}${SEP}` : "";
      setNotice({ tone: "error", text: `IMPORT REJECTED${SEP}${name}${err instanceof Error ? err.message : String(err)}` });
      play("back");
    }
  }

  async function startImport(file: File | null | undefined): Promise<void> {
    if (!file) return;
    try {
      const info = await game.harness.store.storage();
      const evict = info.wouldEvict(file.size);
      if (evict > 0) setImporting({ file, evict });
      else await doImport(file);
    } catch {
      await doImport(file);
    }
  }

  async function exportEpisode(id: string): Promise<void> {
    try { downloadBlob(await game.harness.store.exportBlob(id), episodeFileName(id)); }
    catch (err) { setNotice({ tone: "error", text: `EXPORT FAILED${SEP}${err instanceof Error ? err.message : ""}` }); }
  }

  async function open(id: string): Promise<void> {
    try {
      setViewerEpisodeId(id);
      await game.director.openReplay(id);
    } catch (err) {
      setViewerEpisodeId(null);
      setNotice({ tone: "error", text: `CANNOT OPEN${SEP}${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const onDrop = (e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragging(false); void startImport(e.dataTransfer.files[0]); };
  // The cap only governs episodes that may be evicted; human runs are kept forever and sit outside it. The
  // meter shows both, so it can never read 0 B while the panel underneath it names megabytes on disk.
  const capBytes = storage?.capBytes ?? 0;
  const otherBytes = storage?.otherBytes ?? 0;
  const humanBytes = storage?.humanBytes ?? 0;
  const scaleBytes = Math.max(capBytes, otherBytes + humanBytes);
  const pct = (b: number) => (scaleBytes > 0 ? `${Math.min(100, (b / scaleBytes) * 100).toFixed(2)}%` : "0%");

  return (
    <div className="tl-screen tl-screen--solid rep" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">REPLAYS</div>
        <span className="tl-showbar__spacer" />
        <SlantButton label="BACK" size="sm" variant="paper" cue="back" onClick={() => game.ui.set({ screen: "green_room" })} />
      </header>

      <div className="tl-screen__body rep__body">
        <aside className="rep__side">
          <div className="rep-meter" aria-label="STORAGE">
            <span className="t-label">STORAGE</span>
            <span className="rep-meter__track">
              <i className="rep-meter__fill" style={{ width: pct(otherBytes) }} />
              <i className="rep-meter__kept" style={{ width: pct(humanBytes) }} />
            </span>
            <span className="t-mono">{storage ? `${formatBytes(otherBytes + humanBytes)} STORED` : "READING"}</span>
            <span className="t-mono rep-meter__note">{storage ? `${formatBytes(otherBytes)} OF ${formatBytes(capBytes)} EVICTABLE` : ""}</span>
            <span className="t-mono rep-meter__note">{storage ? `HUMAN ${formatBytes(humanBytes)}${SEP}NEVER EVICTED` : ""}</span>
          </div>
          <button type="button" className="rep-drop" data-drag={dragging ? "true" : "false"} onClick={() => inputRef.current?.click()}>
            <Glyph name="upload" className="rep-drop__icon" />
            <span className="t-plate">IMPORT EPISODE</span>
            <span className="t-mono">.tlep.json</span>
          </button>
          <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={(e) => { void startImport(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          {importing ? (
            <div className="rep-evict" role="alertdialog" aria-label="WILL EVICT">
              <Hazard className="rep-evict__stripes" />
              <span className="t-plate">WILL EVICT {importing.evict}</span>
              <span className="t-label">OLDEST UNPINNED RUNS GO FIRST</span>
              <div className="tl-cluster">
                <SlantButton label="IMPORT ANYWAY" size="sm" variant="primary" onClick={() => void doImport(importing.file)} />
                <SlantButton label="CANCEL" size="sm" cue="back" onClick={() => setImporting(null)} />
              </div>
            </div>
          ) : null}
          {notice ? <div className={notice.tone === "error" ? "tl-error t-mono" : "rep-notice t-mono"} role="status">{notice.text}</div> : null}
        </aside>

        <ol className="rep__list" aria-label="EPISODES">
          {list === null ? <li className="t-label rep__empty">READING EPISODES</li> : null}
          {list !== null && list.length === 0 ? <li className="t-label rep__empty">NO EPISODES YET{SEP}PLAY A MATCH OR IMPORT ONE</li> : null}
          {(list ?? []).map((ep, i) => {
            const st = rows[ep.id] ?? { kind: "idle" };
            const winner = ep.winner ? ep.names[ep.winner] : null;
            return (
              <li key={ep.id} className="rep-row tl-anim-slide-l" style={{ animationDelay: `${Math.min(6, i) * 40}ms` }} data-pinned={ep.pinned ? "true" : "false"}>
                <div className="rep-row__main">
                  <span className="t-mono rep-row__date">{formatStamp(ep.created)}</span>
                  <span className="t-plate rep-row__seats">
                    <span className="rep-row__atlas">{ep.names.atlas}</span> VS <span className="rep-row__blaze">{ep.names.blaze}</span>
                  </span>
                  <span className="rep-row__tags">
                    <span className="tl-sticker tl-sticker--ink">{PRESET_LABEL[ep.preset]}</span>
                    <span className={`tl-sticker ${ep.verdict === "fault" ? "tl-sticker--hazard" : ep.verdict === "cleared" ? "" : "tl-sticker--paper"}`}>{VERDICT_LABEL[ep.verdict]}</span>
                    {ep.human ? <span className="tl-sticker tl-sticker--paper">HUMAN</span> : null}
                    {ep.pinned ? <span className="tl-sticker tl-sticker--ink">PINNED</span> : null}
                  </span>
                  <span className="t-mono rep-row__facts">{winner ? `${winner} WINS` : "NO RESULT"}{SEP}{formatDuration(ep.durationS)}{SEP}{formatBytes(ep.bytes)}</span>
                </div>
                <div className="rep-row__actions">
                  {st.kind === "confirm_delete" ? (
                    <>
                      <SlantButton label="DELETE IT" size="sm" variant="primary" cue="back" onClick={() => void game.harness.store.remove(ep.id).then(refresh)} />
                      <SlantButton label="KEEP" size="sm" onClick={() => setRow(ep.id, { kind: "idle" })} />
                    </>
                  ) : (
                    <>
                      <SlantButton label="OPEN" size="sm" variant="primary" onClick={() => void open(ep.id)} />
                      <SlantButton label="VERIFY" size="sm" disabled={st.kind === "verifying"} onClick={() => void verify(ep.id)} />
                      <button type="button" className="lab-icon" aria-label={ep.pinned ? "UNPIN" : "PIN"} aria-pressed={ep.pinned} onClick={() => void game.harness.store.pin(ep.id, !ep.pinned).then(refresh)}><Glyph name="pin" /></button>
                      <button type="button" className="lab-icon" aria-label="EXPORT" onClick={() => void exportEpisode(ep.id)}><Glyph name="download" /></button>
                      <button type="button" className="lab-icon" aria-label="DELETE" onClick={() => setRow(ep.id, { kind: "confirm_delete" })}><Glyph name="trash" /></button>
                    </>
                  )}
                </div>
                {st.kind === "verifying" ? <div className="rep-row__verify"><Hazard moving className="rep-row__progress" /><span className="t-label">VERIFYING</span></div> : null}
                {st.kind === "verified" ? (
                  <div className="rep-row__verify">
                    <Stamp tone={st.result.verdict === "bit_exact" ? "signal" : "fault"} size="s" animate>{verifyStampLabel(st.result)}</Stamp>
                    <span className="t-mono">{st.result.checkedFrames} FRAMES{st.result.message ? `${SEP}${st.result.message}` : ""}</span>
                  </div>
                ) : null}
                {st.kind === "error" ? <div className="tl-error t-mono">{st.message}</div> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="tl-hintbar">
        <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> BACK</span>
      </footer>
    </div>
  );
}
