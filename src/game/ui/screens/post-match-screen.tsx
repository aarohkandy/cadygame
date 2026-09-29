// src/game/ui/screens/post-match-screen.tsx (WP6)
// A person's quick fight ends on the verdict (verdict-screen.tsx, EMOTION_BIBLE 8.2). This screen remains the Lab
// result and the policy-vs-policy scoreboard: VICTORY in gold foil with the team lip, or DEFEAT in ink; score pips;
// the three most extreme superlatives against local personal bests with count-ups and NEW PB stickers; tabs STATS,
// TIMELINE (integrity lines with event marks that open the replay there), and MODEL REPORT for non-human seats; and
// REMATCH (focused, Enter / R / pad A), SWAP OPPONENT, GREEN ROOM, PIN REPLAY, EXPORT EPISODE. The profile's W–L and
// personal bests update exactly once per match id.
"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from "react";
import type { EpisodeStats, GameEvent, GameHandle, MatchConfig, Seat } from "../../contracts.ts";
import { SEATS } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { humanSeatOf } from "../../match/match-config.ts";
import { PRESET_LABEL, REASON_LABEL, SEP, formatDuration, formatInt, formatRecord, formatSpeed } from "../hud/format.ts";
import { useUi } from "../hud/hud.tsx";
import { CountUp } from "../kit/count-up.tsx";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { Sticker } from "../kit/sticker.tsx";
import { Tabs } from "../kit/tabs.tsx";
import { recordIn, sharedProfile, type ProfileData, type WinLoss } from "../meta/profile.ts";
import { computeSuperlatives, rankSuperlatives, type RankedSuperlative } from "../meta/superlatives.ts";
import { ModelReport, VerdictStamp, downloadBlob, episodeFileName } from "./lab-results.tsx";
import { labSession, policySeatsOf } from "./lab-screen.tsx";
import { setViewerEpisodeId } from "./replays-screen.tsx";
import { VerdictScreen } from "./verdict-screen.tsx";

/* ───────────────────────── match event log ───────────────────────── */

const LOGGED: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "strike", "deflect", "combo", "core", "low_integrity", "round_end", "phase", "ko", "first_strike", "match_end", "policy_fault", "clash",
]);

/** Every event of the current match that the post-match screen reads, copied off the bus as it flushes. */
export const matchLog = { events: [] as GameEvent[], matchId: null as string | null };

export function attachMatchLog(game: GameHandle): () => void {
  return game.bus.subscribe((events) => {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!LOGGED.has(e.type)) continue;
      if (e.type === "phase" && (e.phase === "match_intro" || e.phase === "rematch_intro")) {
        matchLog.events.length = 0;
        matchLog.matchId = game.director.config?.id ?? null;
      }
      if (e.type === "phase" && e.phase !== "round_intro") continue;
      matchLog.events.push({ ...e } as GameEvent);
    }
  });
}

/* ───────────────────────── timeline ───────────────────────── */

interface RoundSpan { t0: number; t1: number }

function TimelineChart(props: { events: readonly GameEvent[]; max: Record<Seat, number>; names: Record<Seat, string>; onOpen: (t: number) => void }): JSX.Element {
  const { spans, series, marks, bounds } = useMemo(() => {
    const spans: RoundSpan[] = [];
    const series: Record<Seat, { x: number; y: number }[]> = { atlas: [], blaze: [] };
    const marks: { x: number; t: number; kind: string; seat: Seat | null }[] = [];
    let open: RoundSpan | null = null;
    let offset = 0;
    const hp: Record<Seat, number> = { atlas: props.max.atlas, blaze: props.max.blaze };
    for (const e of props.events) {
      if (e.type === "phase" && e.phase === "round_intro") {
        if (open) { offset += open.t1 - open.t0; spans.push(open); }
        open = { t0: e.t, t1: e.t };
        hp.atlas = props.max.atlas; hp.blaze = props.max.blaze;
        for (const s of SEATS) series[s].push({ x: offset, y: 1 });
        continue;
      }
      if (!open) continue;
      open.t1 = Math.max(open.t1, e.t);
      const x = offset + (e.t - open.t0);
      if (e.type === "strike" && e.tier === "strike") {
        hp[e.victim] = Math.max(0, hp[e.victim] - (e.damage > 0 ? e.damage : e.physicalDamage));
        series[e.victim].push({ x, y: hp[e.victim] / props.max[e.victim] });
        if (e.crit) marks.push({ x, t: e.t, kind: "crit", seat: e.attacker });
      } else if (e.type === "deflect") marks.push({ x, t: e.t, kind: "deflect", seat: e.defender });
      else if (e.type === "ko") marks.push({ x, t: e.t, kind: "ko", seat: e.attacker });
      else if (e.type === "core" && (e.stage === "steal" || e.stage === "lock")) marks.push({ x, t: e.t, kind: e.stage, seat: e.seat });
      else if (e.type === "round_end") {
        for (const s of SEATS) series[s].push({ x, y: hp[s] / props.max[s] });
      }
    }
    if (open) spans.push(open);
    const bounds: number[] = [];
    let acc = 0;
    for (let i = 0; i < spans.length; i++) { if (i > 0) bounds.push(acc); acc += spans[i].t1 - spans[i].t0; }
    return { spans, series, marks, bounds };
  }, [props.events, props.max]);

  const total = spans.reduce((a, s) => a + (s.t1 - s.t0), 0);
  if (total <= 0) return <p className="t-label pm__empty">NO ROUND DATA</p>;
  const W = 1000, H = 220, pad = 12;
  const sx = (x: number) => pad + (x / total) * (W - 2 * pad);
  const sy = (y: number) => H - pad - y * (H - 2 * pad);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => {
    if (i === 0) return `M${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
    return `H${sx(p.x).toFixed(1)} V${sy(p.y).toFixed(1)}`;
  }).join(" ");
  return (
    <div className="pm-timeline">
      <svg viewBox={`0 0 ${W} ${H}`} className="pm-timeline__svg" role="img" aria-label="INTEGRITY TIMELINE" preserveAspectRatio="none">
        {bounds.map((b) => <path key={b} d={`M${sx(b).toFixed(1)} 0V${H}`} className="pm-timeline__round" />)}
        <path d={path(series.atlas)} className="pm-timeline__line pm-timeline__line--atlas" />
        <path d={path(series.blaze)} className="pm-timeline__line pm-timeline__line--blaze" />
      </svg>
      <div className="pm-timeline__marks">
        {marks.map((m, i) => (
          <button key={i} type="button" className={`pm-mark pm-mark--${m.kind}`} data-seat={m.seat ?? "none"} style={{ left: `${(sx(m.x) / W) * 100}%` }}
            aria-label={`${m.kind.toUpperCase()} REPLAY`} onClick={() => props.onOpen(m.t)} />
        ))}
      </div>
      <div className="pm-timeline__legend">
        <span className="t-label pm-legend pm-legend--atlas">{props.names.atlas}</span>
        <span className="t-label pm-legend pm-legend--blaze">{props.names.blaze}</span>
        <span className="t-label t-dim">SELECT A MARK TO REPLAY IT</span>
      </div>
    </div>
  );
}

/* ───────────────────────── stats tab ───────────────────────── */

function StatsTab(props: { stats: EpisodeStats | null; events: readonly GameEvent[]; names: Record<Seat, string> }): JSX.Element {
  const live = useMemo(() => {
    const out: Record<Seat, { dmg: number; strikes: number; crits: number; deflects: number; steals: number; top: number }> = {
      atlas: { dmg: 0, strikes: 0, crits: 0, deflects: 0, steals: 0, top: 0 }, blaze: { dmg: 0, strikes: 0, crits: 0, deflects: 0, steals: 0, top: 0 },
    };
    for (const e of props.events) {
      if (e.type === "strike" && e.tier === "strike" && !e.guarded) {
        const a = out[e.attacker]; a.strikes++; a.dmg += e.damage > 0 ? e.damage : e.physicalDamage; if (e.crit) a.crits++; a.top = Math.max(a.top, e.vN);
      } else if (e.type === "deflect") out[e.defender].deflects++;
      else if (e.type === "core" && e.stage === "steal" && e.seat) out[e.seat].steals++;
    }
    return out;
  }, [props.events]);
  const rows: [string, (s: Seat) => string][] = [
    ["DAMAGE", (s) => formatInt(live[s].dmg)],
    ["STRIKES", (s) => formatInt(live[s].strikes)],
    ["CRITS", (s) => formatInt(live[s].crits)],
    ["DEFLECTS", (s) => formatInt(live[s].deflects)],
    ["STEALS", (s) => formatInt(live[s].steals)],
    ["TOP SPEED", (s) => formatSpeed(live[s].top)],
  ];
  if (props.stats) {
    const st = props.stats;
    rows.push(
      ["BLOCK RATE", (s) => `${Math.round(st.seats[s].physical.physicalBlockRate * 100)}%`],
      ["REACTION NET", (s) => `${Math.round(st.seats[s].physical.reactionMs.netMedian)} ms`],
      ["LOCK-IN HELD", (s) => `${st.seats[s].physical.lockInHeldS.toFixed(1)} s`],
    );
  }
  return (
    <div className="pm-stats" role="table" aria-label="STATS">
      <div className="pm-stats__row pm-stats__row--head" role="row">
        <span role="columnheader" />
        {SEATS.map((s) => <span key={s} role="columnheader" className={`t-plate pm-legend pm-legend--${s}`}>{props.names[s]}</span>)}
      </div>
      {rows.map(([label, get], i) => (
        <div key={label} className="pm-stats__row tl-anim-slide-up" role="row" style={{ animationDelay: `${Math.min(6, i) * 40}ms` }}>
          <span role="rowheader" className="t-label">{label}</span>
          {SEATS.map((s) => <span key={s} role="cell" className="t-num-m">{get(s)}</span>)}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── screen ───────────────────────── */

type PmTab = "stats" | "timeline" | "report";

/* Module-level so the identities never change across renders: useSyncExternalStore resubscribes
   whenever `subscribe` changes, and re-reads whenever `getSnapshot` does. */
const subscribeProfile = (fn: () => void): (() => void) => sharedProfile().subscribe(fn);
const readProfile = (): Readonly<ProfileData> => sharedProfile().get();

function useProfileUpdate(match: MatchConfig | null, winner: Seat | null, events: readonly GameEvent[]): { ranked: RankedSuperlative[]; player: Seat | null; series: WinLoss | null } {
  const player = match ? humanSeatOf(match) : null;
  const counts = match !== null && (match.context === "quick" || match.context === "lab");
  const list = useMemo(() => (player ? computeSuperlatives(events, player) : []), [events, player]);

  useEffect(() => {
    if (!match || !winner || !player || !counts) return;
    const opp = match.seats[player === "atlas" ? "blaze" : "atlas"].driver;
    sharedProfile().applyMatch({ matchId: match.id, opponent: opp, won: winner === player, superlatives: list });
  }, [match, winner, player, counts, list]);

  // The series line reads the profile back after this match lands in it, so the record on screen
  // already counts the fight the player just finished. The profile is an external store, so it is
  // read through useSyncExternalStore rather than mirrored into state from an effect: a synchronous
  // setState in an effect body costs an extra render pass on every mount of this screen, and React
  // flags it. `get()` returns the same object until a commit replaces it, which is the identity
  // useSyncExternalStore needs; `record()` builds a fresh object per call, so it is derived after.
  const profile = useSyncExternalStore(
    subscribeProfile,
    readProfile,
    readProfile,
  );
  const series = useMemo(() => {
    if (!match || !player || !counts) return null;
    const opp = match.seats[player === "atlas" ? "blaze" : "atlas"].driver;
    return recordIn(profile, opp);
  }, [profile, match, player, counts]);

  const ranked = useMemo(() => {
    if (!match || !player) return [];
    // bestsBefore is stable across the profile update, so the stamps do not change once the match is applied.
    return rankSuperlatives(list, sharedProfile().bestsBefore(match.id));
  }, [list, match, player]);
  return { ranked, player, series };
}

export function PostMatchScreen(props: { game: GameHandle }): JSX.Element {
  const match = useUi(props.game, (s) => s.match);
  if (match && humanSeatOf(match) && (match.context === "quick" || match.context === "warmup")) return <VerdictScreen game={props.game} match={match} />;
  return <ScoreboardScreen game={props.game} />;
}

function ScoreboardScreen(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const match = useUi(game, (s) => s.match);
  const roundsWon = useUi(game, (s) => s.roundsWon);
  const stats = useUi(game, (s) => s.lastStats);
  const episodeId = useUi(game, (s) => s.lastEpisodeId);
  const [tab, setTab] = useState<PmTab>("stats");
  const [pinned, setPinned] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const events = useMemo(() => matchLog.events.slice(), []);

  const winner: Seat | null = stats?.result.winner ?? (roundsWon.atlas === roundsWon.blaze ? null : roundsWon.atlas > roundsWon.blaze ? "atlas" : "blaze");
  const { ranked, player, series } = useProfileUpdate(match, winner, events);
  const names: Record<Seat, string> = { atlas: match?.seats.atlas.displayName ?? "ATLAS", blaze: match?.seats.blaze.displayName ?? "BLAZE" };
  const policySeats = match ? policySeatsOf(match) : [];
  const won = player !== null && winner === player;
  const lab = match?.context === "lab";
  const maxIntegrity: Record<Seat, number> = { atlas: game.rules.state.seats.atlas.integrityMax || 100, blaze: game.rules.state.seats.blaze.integrityMax || 100 };
  const lastReason = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e.type === "round_end") return e.reason; }
    return null;
  }, [events]);

  useEffect(() => { if (lab) labSession.sync(game); }, [game, lab, stats, episodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === "KeyR") { e.preventDefault(); play("select"); void game.director.rematch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, play]);

  async function openAt(t: number): Promise<void> {
    if (!episodeId) return;
    setViewerEpisodeId(episodeId);
    await game.director.openReplay(episodeId);
    game.replay.seek(Math.max(0, t - 1.5));
  }

  async function pin(): Promise<void> {
    if (!episodeId) return;
    try { await game.harness.store.pin(episodeId, true); setPinned(true); play("sticker"); }
    catch (err) { setNote(`PIN FAILED${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}`); }
  }

  async function exportEpisode(): Promise<void> {
    if (!episodeId) return;
    try { downloadBlob(await game.harness.store.exportBlob(episodeId), episodeFileName(episodeId)); setNote("EPISODE EXPORTED"); }
    catch (err) { setNote(`EXPORT FAILED${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}`); }
  }

  const tabs = [
    { id: "stats" as const, label: "STATS" },
    { id: "timeline" as const, label: "TIMELINE" },
    ...(policySeats.length > 0 ? [{ id: "report" as const, label: "MODEL REPORT", disabled: !stats }] : []),
  ];
  const bestOf = match?.bestOf ?? 3;
  const need = Math.floor(bestOf / 2) + 1;

  return (
    <div className="tl-screen tl-screen--scrim pm">
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">{lab ? "LAB RESULT" : "POST MATCH"}</div>
        {match ? <span className="tl-sticker tl-sticker--ink">{PRESET_LABEL[match.preset]}</span> : null}
      </header>

      <div className="tl-screen__body pm__body">
        <section className="pm__left">
          <div className="pm__result">
            {player ? (
              won
                ? <Stamp tone="gold" size="xl" animate>VICTORY</Stamp>
                : <Stamp tone="ink" size="xl" animate>DEFEAT</Stamp>
            ) : winner ? <Stamp tone={winner === "atlas" ? "cobalt" : "magenta"} size="l" animate fit>{`${names[winner]} WINS`}</Stamp> : <Stamp tone="ink" size="l" animate>NO RESULT</Stamp>}
            <div className={`pm__lip pm__lip--${winner ?? "none"}`} aria-hidden="true" />
          </div>
          <div className="pm__score">
            {SEATS.map((s) => (
              <div key={s} className={`pm__score-seat pm__score-seat--${s}`}>
                <span className="t-plate pm__score-name">{names[s]}</span>
                <span className="pm__pips" aria-label={`${roundsWon[s]} ROUNDS`}>
                  {Array.from({ length: need }, (_, i) => (
                    <svg key={i} viewBox="0 0 20 14" className={`hud-round-pip hud-round-pip--${s}`} data-on={i < roundsWon[s] ? "true" : "false"}><path d="M4 1h15l-3 12H1Z" /></svg>
                  ))}
                </span>
              </div>
            ))}
            {lastReason ? <span className="t-label pm__reason">DECIDED BY {REASON_LABEL[lastReason]}</span> : null}
            <span className="t-mono pm__card">BEST OF {bestOf}{stats ? `${SEP}${formatDuration(stats.durationS)}` : ""}</span>
            {series && player && (series.w > 0 || series.l > 0) ? (
              <span className="t-mono pm__series">SERIES {formatRecord(series.w, series.l)}{SEP}VS {names[player === "atlas" ? "blaze" : "atlas"]}</span>
            ) : null}
          </div>

          {ranked.length === 0 && stats && policySeats.length > 0 ? (
            <div className="pm__verdicts">
              <span className="t-label pm__best-title">VERDICT</span>
              {policySeats.map((s, i) => (
                <div key={s} className="pm__verdict tl-anim-slide-l" style={{ animationDelay: `${300 + i * 120}ms` }}>
                  <span className="t-mono pm__verdict-name">{names[s]}</span>
                  <VerdictStamp stats={stats} seat={s} animate />
                </div>
              ))}
            </div>
          ) : null}

          {ranked.length > 0 ? (
            <div className="pm__best">
              <span className="t-label pm__best-title">BEST OF MATCH</span>
              {ranked.map((s, i) => (
                <div key={s.id} className={`pm-sup tl-anim-slide-l ${i === 0 ? "pm-sup--mvp" : ""}`} style={{ animationDelay: `${300 + i * 120}ms` }}>
                  <span className="t-label pm-sup__label">{s.label}</span>
                  <span className="t-num-xl pm-sup__value">
                    <CountUp value={s.headline} decimals={s.unit === "m/s" ? 2 : 0} delayMs={360 + i * 120} />
                    {s.unit ? <span className="t-plate pm-sup__unit">{s.unit === "%" ? "%" : ` ${s.unit}`}</span> : null}
                  </span>
                  <span className="t-mono pm-sup__display">{s.display}</span>
                  {s.newPb ? <span className="pm-sup__pb"><Sticker tone="prize" animate delayMs={760 + i * 120}>NEW PB</Sticker></span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="pm__right">
          <Tabs label="POST MATCH" items={tabs} value={tab} onChange={setTab} />
          <div className="pm__panel" role="tabpanel">
            {tab === "stats" ? <StatsTab stats={stats} events={events} names={names} /> : null}
            {tab === "timeline" ? <TimelineChart events={events} max={maxIntegrity} names={names} onOpen={(t) => void openAt(t)} /> : null}
            {tab === "report" && stats && match ? <ModelReport stats={stats} names={names} preset={match.preset} policySeats={policySeats} /> : null}
          </div>
        </section>
      </div>

      <footer className="pm__foot">
        <div className="pm__actions">
          {match && match.context !== "tutorial" ? (
            <SlantButton label="REMATCH" variant="primary" autoFocus hint="R" onClick={() => void game.director.rematch()} />
          ) : null}
          {lab ? (
            <SlantButton label="BACK TO LAB" size="md" onClick={() => { game.director.enterGreenRoom(); game.ui.set({ screen: "lab" }); }} />
          ) : (
            <SlantButton label="SWAP OPPONENT" size="md" onClick={() => { game.director.enterGreenRoom(); game.ui.set({ screen: "entrants" }); }} />
          )}
          <SlantButton label="GREEN ROOM" size="md" cue="back" onClick={() => game.director.enterGreenRoom()} />
          <SlantButton label={pinned ? "PINNED" : "PIN REPLAY"} size="md" disabled={!episodeId || pinned} onClick={() => void pin()} />
          <SlantButton label="EXPORT EPISODE" size="md" disabled={!episodeId} onClick={() => void exportEpisode()} />
          {note ? <span className="t-label pm__note" role="status">{note}</span> : null}
        </div>
        <div className="tl-hintbar">
          <span className="tl-hint t-label"><ActionGlyph action="rematch" device={game.pilot.device} /> REMATCH</span>
          <span className="tl-hint t-label"><ActionGlyph action="tab" device={game.pilot.device} /> TABS</span>
        </div>
      </footer>
    </div>
  );
}
