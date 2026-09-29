// src/game/ui/screens/lab-results.tsx (WP7)
// Lab results and the model report (7.3.5, 5.10): entrant cards facing each other with win rate, bootstrap CI and
// effective n, six headline bars (physical damage, strikes, physical block rate, net reaction median, jerk,
// reliability), the verdict stamp, a DETAILS expander with every per-seat physical (and Arcade) figure, and exports.
// ModelReport is reused by the post-match MODEL REPORT tab.
"use client";

import { useState, type JSX } from "react";
import type { AggregateStats, EpisodeStats, GameHandle, MatchPreset, PhysicalSeatStats, Seat } from "../../contracts.ts";
import { SEATS } from "../../contracts.ts";
import {
  PRESET_LABEL, SEP, formatInt, formatMs, formatPercent, formatRateCi, formatSpeed, verdictLabel,
} from "../hud/format.ts";
import { SlantButton } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";

/* ───────────────────────── downloads ───────────────────────── */

/** Saves a Blob through a temporary object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function episodeFileName(id: string): string {
  return `${id.replace(/[^A-Za-z0-9._-]+/g, "-")}.tlep.json`;
}

/* ───────────────────────── headline bars ───────────────────────── */

interface Headline { label: string; value: (s: PhysicalSeatStats) => number; format: (v: number) => string; better: "higher" | "lower" }

export const HEADLINES: readonly Headline[] = [
  { label: "PHYSICAL DAMAGE", value: (s) => s.physicalDamageDealt, format: (v) => v.toFixed(1), better: "higher" },
  { label: "STRIKES", value: (s) => s.strikesLanded, format: formatInt, better: "higher" },
  { label: "BLOCK RATE", value: (s) => s.physicalBlockRate, format: (v) => formatPercent(v), better: "higher" },
  { label: "REACTION NET", value: (s) => s.reactionMs.netMedian, format: formatMs, better: "lower" },
  { label: "ACTION JERK", value: (s) => s.actionJerk, format: (v) => v.toFixed(0), better: "lower" },
  { label: "RELIABILITY", value: (s) => s.reliability, format: (v) => formatPercent(v, 1), better: "higher" },
];

function barFrac(a: number, b: number): [number, number] {
  const fa = Number.isFinite(a) ? Math.abs(a) : 0;
  const fb = Number.isFinite(b) ? Math.abs(b) : 0;
  const m = Math.max(fa, fb);
  return m > 0 ? [fa / m, fb / m] : [0, 0];
}

function HeadlineBars(props: { stats: EpisodeStats }): JSX.Element {
  return (
    <div className="lab-bars">
      {HEADLINES.map((h) => {
        const a = h.value(props.stats.seats.atlas.physical);
        const b = h.value(props.stats.seats.blaze.physical);
        const [fa, fb] = barFrac(a, b);
        return (
          <div key={h.label} className="lab-bars__row">
            <span className="t-mono lab-bars__v lab-bars__v--atlas">{Number.isFinite(a) ? h.format(a) : "n/a"}</span>
            <span className="lab-bars__track lab-bars__track--atlas"><i style={{ transform: `scaleX(${fa.toFixed(3)})` }} /></span>
            <span className="t-label lab-bars__label">{h.label}</span>
            <span className="lab-bars__track lab-bars__track--blaze"><i style={{ transform: `scaleX(${fb.toFixed(3)})` }} /></span>
            <span className="t-mono lab-bars__v lab-bars__v--blaze">{Number.isFinite(b) ? h.format(b) : "n/a"}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── details ───────────────────────── */

type Row = [string, (s: EpisodeStats["seats"][Seat]) => string];

/** A figure this episode did not record, or one whose input was degenerate, reads n/a - a report never prints NaN. */
const NOT_MEASURED = "n/a";
const cellText = (v: string): string => (v.includes("NaN") ? v.replace(/NaN/g, NOT_MEASURED) : v);

const PHYSICAL_ROWS: readonly Row[] = [
  ["DAMAGE DEALT", (s) => s.physical.physicalDamageDealt.toFixed(1)],
  ["DAMAGE TAKEN", (s) => s.physical.physicalDamageTaken.toFixed(1)],
  ["OPTICS IMPULSE", (s) => `${s.physical.opticsImpulse.toFixed(3)} N·s`],
  ["APPROACH SPEED", (s) => `${formatSpeed(s.physical.approachSpeed.median)}${SEP}p90 ${formatSpeed(s.physical.approachSpeed.p90)}`],
  ["STRIKES", (s) => `${s.physical.strikesLanded} / ${s.physical.strikesTaken} TAKEN`],
  ["GRAZES", (s) => `${s.physical.grazesLanded} / ${s.physical.grazesTaken} TAKEN`],
  ["CRITS", (s) => formatInt(s.physical.crits)],
  ["ATTEMPTS", (s) => `${s.physical.attackAttempts}${SEP}${formatPercent(s.physical.accuracy)} ACC`],
  ["BLOCK RATE", (s) => formatPercent(s.physical.physicalBlockRate)],
  ["REACTION RAW", (s) => `${formatMs(s.physical.reactionMs.rawMedian)}${SEP}p10 ${formatMs(s.physical.reactionMs.p10)}${SEP}p90 ${formatMs(s.physical.reactionMs.p90)}`],
  ["REACTION NET", (s) => `${formatMs(s.physical.reactionMs.netMedian)}${SEP}n ${s.physical.reactionMs.n}${SEP}STRUCT ${formatMs(s.physical.reactionMs.structuralMs)}`],
  ["ANTICIPATIONS", (s) => `${s.physical.reactionMs.anticipations}${SEP}${s.physical.reactionMs.noReaction} NO REACTION`],
  ["CORE", (s) => `${s.physical.lockInHeldS.toFixed(1)} s HELD${SEP}${s.physical.steals} STEALS${SEP}${s.physical.lateSteals} LATE${SEP}${s.physical.locks} LOCKS`],
  ["COMPUTE", (s) => `${formatMs(s.physical.computeMs.median)}${SEP}p99 ${formatMs(s.physical.computeMs.p99)}${SEP}MAX ${formatMs(s.physical.computeMs.max)}`],
  ["SLOW DECISIONS", (s) => formatInt(s.physical.slowDecisions)],
  ["LATE · TIMEOUT", (s) => `${formatPercent(s.physical.lateFrac, 2)}${SEP}${formatPercent(s.physical.timeoutFrac, 2)}`],
  ["ERROR · CLAMPED", (s) => `${formatPercent(s.physical.errorFrac, 2)}${SEP}${formatPercent(s.physical.clampedFrac, 2)}`],
  ["RELIABILITY", (s) => formatPercent(s.physical.reliability, 2)],
  ["LIMIT VIOLATIONS", (s) => `${s.physical.violationsPerJoint.join(" ")}${SEP}MAX ${s.physical.maxOvershoot.toExponential(1)} rad`],
  ["NEAR LIMIT", (s) => formatPercent(s.physical.nearLimitDwell, 1)],
  ["TORQUE SATURATION", (s) => formatPercent(s.physical.torqueSaturationFrac, 1)],
  ["ACTION JERK", (s) => `${s.physical.actionJerk.toFixed(1)} rad/s³`],
  ["CHATTER", (s) => `${s.physical.actionChatter.toFixed(2)} /s`],
  ["SMOOTHNESS LDLJ", (s) => s.physical.ldlj.toFixed(2)],
  ["ENERGY", (s) => `${s.physical.energyJ.toFixed(2)} J`],
  ["TABLE HITS", (s) => formatInt(s.physical.tableHits)],
  ["SELF COLLISIONS", (s) => formatInt(s.physical.selfCollisions)],
];

const ARCADE_ROWS: readonly Row[] = [
  ["SCORED DAMAGE", (s) => `${s.arcade?.damageDealt.toFixed(1) ?? ""} / ${s.arcade?.damageTaken.toFixed(1) ?? ""} TAKEN`],
  ["GUARDED CHIPS", (s) => formatInt(s.arcade?.guardedChips ?? 0)],
  ["DEFLECTS", (s) => `${s.arcade?.deflects ?? 0}${SEP}${s.arcade?.hardDeflects ?? 0} HARD${SEP}${s.arcade?.lateGuards ?? 0} LATE`],
  ["WHIFFS", (s) => `${s.arcade?.whiffs ?? 0}${SEP}${s.arcade?.whiffPunishes ?? 0} PUNISHED`],
  ["HEAT", (s) => `${(s.arcade?.meanHeat ?? 0).toFixed(0)} MEAN${SEP}${s.arcade?.cutouts ?? 0} CUTOUTS`],
  ["STAGGERS", (s) => `${s.arcade?.staggersDealt ?? 0} / ${s.arcade?.staggersTaken ?? 0} TAKEN${SEP}${s.arcade?.bursts ?? 0} BURSTS`],
  ["HEAVIES", (s) => `${s.arcade?.heavySuccesses ?? 0} OF ${s.arcade?.heavyAttempts ?? 0}`],
];

function DetailsTable(props: { stats: EpisodeStats; names: Record<Seat, string> }): JSX.Element {
  const arcade = SEATS.some((s) => props.stats.seats[s].arcade !== null);
  const rows = arcade ? [...PHYSICAL_ROWS, ...ARCADE_ROWS] : PHYSICAL_ROWS;
  return (
    <div className="lab-details" role="table" aria-label="DETAILS">
      <div className="lab-details__row lab-details__row--head" role="row">
        <span role="columnheader" className="t-label">METRIC</span>
        {SEATS.map((s) => <span key={s} role="columnheader" className={`t-plate lab-details__seat lab-details__seat--${s}`}>{props.names[s]}</span>)}
      </div>
      {rows.map(([label, get]) => (
        <div key={label} className="lab-details__row" role="row">
          <span role="rowheader" className="t-label">{label}</span>
          {SEATS.map((s) => <span key={s} role="cell" className="t-mono">{cellText(get(props.stats.seats[s]))}</span>)}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── model report ───────────────────────── */

export function VerdictStamp(props: { stats: EpisodeStats; seat: Seat; animate?: boolean }): JSX.Element {
  const v = props.stats.verdict[props.seat];
  const tone = v.stamp === "cleared" ? "signal" : v.stamp === "fault" ? "fault" : v.stamp === "arcade" ? "paper" : "ink";
  return <Stamp tone={tone} size="s" animate={props.animate}>{verdictLabel(v.stamp, v.reason)}</Stamp>;
}

export function ModelReport(props: { stats: EpisodeStats; names: Record<Seat, string>; preset: MatchPreset; policySeats: readonly Seat[] }): JSX.Element {
  return (
    <div className="lab-report">
      <div className="lab-report__stamps">
        <span className="tl-sticker tl-sticker--ink">{PRESET_LABEL[props.preset]}</span>
        {props.policySeats.map((s) => (
          <span key={s} className="lab-report__stamp">
            <span className={`t-plate lab-details__seat--${s}`}>{props.names[s]}</span>
            <VerdictStamp stats={props.stats} seat={s} animate />
          </span>
        ))}
      </div>
      <HeadlineBars stats={props.stats} />
      <DetailsTable stats={props.stats} names={props.names} />
    </div>
  );
}

/* ───────────────────────── Lab results ───────────────────────── */

export function LabResults(props: {
  game: GameHandle; stats: EpisodeStats; episodeId: string | null; aggregate: AggregateStats | null; subjectSeat: Seat;
  names: Record<Seat, string>; preset: MatchPreset; policySeats: readonly Seat[];
}): JSX.Element {
  const { game, stats, episodeId, aggregate } = props;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const r = stats.result;

  async function exportEpisode(): Promise<void> {
    if (!episodeId) return;
    try { downloadBlob(await game.harness.store.exportBlob(episodeId), episodeFileName(episodeId)); setNote("EPISODE EXPORTED"); }
    catch (err) { setNote(`EXPORT FAILED${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}`); }
  }
  function exportStats(): void {
    const blob = new Blob([JSON.stringify({ episodeId, stats, aggregate }, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${(episodeId ?? "lab-run").replace(/[^A-Za-z0-9._-]+/g, "-")}.stats.json`);
    setNote("STATS EXPORTED");
  }

  return (
    <section className="lab-results tl-anim-slide-up" aria-label="RESULTS">
      <div className="lab-results__cards">
        {SEATS.map((s) => {
          const won = r.winner === s;
          const subject = s === props.subjectSeat;
          return (
            <div key={s} className={`lab-results__card lab-results__card--${s}`} data-won={won ? "true" : "false"}>
              <span className="t-label">{s === "atlas" ? "ATLAS" : "BLAZE"}</span>
              <span className="t-plate lab-results__name">{props.names[s]}</span>
              <span className="t-num-xl">{r.roundsWon[s]}</span>
              {subject && aggregate ? (
                <span className="t-mono">{formatRateCi(aggregate.winRate, aggregate.ciLow, aggregate.ciHigh)}{SEP}{aggregate.seeds} {aggregate.seeds === 1 ? "SEED" : "SEEDS"}</span>
              ) : <span className="t-mono">{won ? "WINNER" : r.forfeit === s ? "FORFEIT" : ""}</span>}
              {props.policySeats.includes(s) ? <VerdictStamp stats={stats} seat={s} animate /> : null}
            </div>
          );
        })}
      </div>
      {r.error ? <div className="tl-error t-label" role="alert">EPISODE ERROR{SEP}{r.error.toUpperCase().replace(/_/g, " ")}</div> : null}
      <HeadlineBars stats={stats} />
      <div className="lab-results__actions">
        <SlantButton label={open ? "HIDE DETAILS" : "DETAILS"} size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
        <SlantButton label="EXPORT EPISODE" size="sm" disabled={!episodeId} onClick={() => void exportEpisode()} />
        <SlantButton label="EXPORT STATS" size="sm" onClick={exportStats} />
        <SlantButton label="OPEN REPLAY" size="sm" disabled={!episodeId} onClick={() => { if (episodeId) void game.director.openReplay(episodeId); }} />
        {note ? <span className="t-label lab-results__note" role="status">{note}</span> : null}
      </div>
      {open ? <DetailsTable stats={stats} names={props.names} /> : null}
    </section>
  );
}
