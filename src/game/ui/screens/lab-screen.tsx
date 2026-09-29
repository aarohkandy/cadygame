// src/game/ui/screens/lab-screen.tsx (WP7)
// The Lab (7.3.5, trimmed by BUILD_PLAN D1/D2/D3/D6): ATLAS and BLAZE seat columns facing a Rules column, results
// underneath. Seats take HUMAN, BUILT-IN, MODULE, TRAJECTORY, or BRIDGE drivers with their own fields, decision rate,
// chunk execution, and loadout. Rules cover preset, timing, control rate, seed, rounds, action and fair delay, limits,
// record, and render or turbo. Actions: FIGHT IT, RUN MATCH, VERIFY LAST EPISODE, CHECK POLICY DETERMINISM.
// Every config goes through WP1's buildMatchConfig and validateMatchConfig, so the Lab can never start a bad match.
"use client";

import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import type {
  ChunkExecute, ControlHz, DriverSpec, EntrantRecord, EpisodeStats, GameHandle, LoadoutId, MatchConfig, MatchPreset,
  PersonalityId, Seat, TierId, VerifyResult,
} from "../../contracts.ts";
import { SEATS } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { FAIR_DELAY_MAX_MS, PRESETS } from "../../match/presets.ts";
import { buildMatchConfig, isExternalPolicy, validateMatchConfig, type SeatInput } from "../../match/match-config.ts";
import { LOADOUT_LABEL, PERSONALITY_LABEL, PRESET_LABEL, SEP, TIER_LABEL, formatInt, shortSha } from "../hud/format.ts";
import { ActionGlyph, Glyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Slider } from "../kit/slider.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { Toggle } from "../kit/toggle.tsx";
import { entrantSpec } from "./green-room.tsx";
import { LabResults } from "./lab-results.tsx";
import { LOADOUT_ORDER } from "./loadout-picker.tsx";
import { DEFAULT_BRIDGE_URL } from "./entrants-screen.tsx";

/* ───────────────────────── draft ───────────────────────── */

export type LabDriver = "human" | "builtin" | "module" | "trajectory" | "bridge";
export type ChunkMode = "until_next_decision" | "full_chunk" | "n_steps";

export interface SeatDraft {
  driver: LabDriver;
  personality: PersonalityId;
  tier: TierId;
  entrantId: string | null;
  bridgeUrl: string;
  allowLan: boolean;
  loadout: LoadoutId;
  decisionHz: number;
  chunk: ChunkMode;
  nSteps: number;
  ensembleM: number;
}

export interface LabDraft {
  preset: MatchPreset;
  timing: "live" | "eval";
  turbo: boolean;
  controlHz: ControlHz;
  seed: number;
  bestOf: 1 | 3 | 5;
  actionDelayTicks: MatchConfig["actionDelayTicks"];
  fairDelayMs: number;
  strictLimits: boolean;
  record: boolean;
  seats: Record<Seat, SeatDraft>;
}

const LAB_KEY = "torquelimit.lab.v1";

function seatDefault(driver: LabDriver, personality: PersonalityId, tier: TierId): SeatDraft {
  return {
    driver, personality, tier, entrantId: null, bridgeUrl: DEFAULT_BRIDGE_URL, allowLan: false, loadout: "pivot",
    decisionHz: 25, chunk: "until_next_decision", nSteps: 10, ensembleM: 0,
  };
}

export const DEFAULT_LAB: LabDraft = {
  preset: "harness", timing: "eval", turbo: false, controlHz: 50, seed: 42, bestOf: 3, actionDelayTicks: 1, fairDelayMs: 120,
  strictLimits: false, record: true,
  seats: { atlas: seatDefault("builtin", "backlash", "pro"), blaze: seatDefault("module", "overshoot", "contender") },
};

function loadDraft(): LabDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(LAB_KEY) ?? "null") as LabDraft | null;
    if (!raw || typeof raw !== "object" || !raw.seats) return DEFAULT_LAB;
    return {
      ...DEFAULT_LAB, ...raw,
      seats: { atlas: { ...DEFAULT_LAB.seats.atlas, ...raw.seats.atlas }, blaze: { ...DEFAULT_LAB.seats.blaze, ...raw.seats.blaze } },
    };
  } catch {
    return DEFAULT_LAB;
  }
}

function saveDraft(d: LabDraft): void {
  try { localStorage.setItem(LAB_KEY, JSON.stringify(d)); } catch { /* storage blocked: the draft lasts this visit */ }
}

function chunkOf(s: SeatDraft): ChunkExecute {
  return s.chunk === "n_steps" ? { nSteps: Math.max(1, Math.round(s.nSteps)) } : s.chunk;
}

/** Resolves a draft into driver specs; returns a reason when a seat is incomplete. */
export function resolveSeat(s: SeatDraft, entrants: readonly EntrantRecord[]): DriverSpec | string {
  switch (s.driver) {
    case "human": return { kind: "human" };
    case "builtin": return { kind: "builtin", personality: s.personality, tier: s.tier, dda: false };
    case "module": case "trajectory": {
      const e = entrants.find((x) => x.id === s.entrantId && x.kind === s.driver);
      return e ? entrantSpec(e) : `PICK A ${s.driver === "module" ? "MODULE" : "TRAJECTORY"}`;
    }
    case "bridge":
      return s.bridgeUrl.trim() ? { kind: "bridge", url: s.bridgeUrl.trim(), allowLan: s.allowLan, sessionId: crypto.randomUUID() } : "BRIDGE NEEDS A URL";
  }
}

export function draftToConfig(d: LabDraft, entrants: readonly EntrantRecord[], callsign: string): { cfg: MatchConfig | null; errors: string[] } {
  const errors: string[] = [];
  const specs = {} as Record<Seat, DriverSpec>;
  for (const s of SEATS) {
    const r = resolveSeat(d.seats[s], entrants);
    if (typeof r === "string") errors.push(`${s.toUpperCase()}${SEP}${r}`);
    else specs[s] = r;
  }
  if (errors.length > 0) return { cfg: null, errors };
  const human = SEATS.some((s) => specs[s].kind === "human");
  const seatInput = (s: Seat): SeatInput => ({
    driver: specs[s],
    loadout: d.seats[s].driver === "builtin" ? undefined : d.seats[s].loadout,
    decisionHz: Math.min(d.controlHz, d.seats[s].decisionHz),
    chunkExecute: chunkOf(d.seats[s]),
    temporalEnsembleM: d.seats[s].ensembleM > 0 ? d.seats[s].ensembleM : null,
  });
  const cfg = buildMatchConfig({
    preset: d.preset, context: "lab", seed: d.seed, callsign,
    timing: human ? "live" : d.timing, turbo: !human && d.timing === "eval" && d.turbo,
    controlHz: d.controlHz, bestOf: d.bestOf, actionDelayTicks: d.actionDelayTicks, fairDelayMs: d.fairDelayMs,
    strictLimits: d.strictLimits, record: d.record, keepEpisodes: true, fastShow: true, showKit: true,
    seats: { atlas: seatInput("atlas"), blaze: seatInput("blaze") },
  });
  return { cfg, errors: validateMatchConfig(cfg) };
}

/* ───────────────────────── session results ───────────────────────── */

export interface LabRun {
  matchId: string; episodeId: string | null; stats: EpisodeStats; seed: number; signature: string;
  names: Record<Seat, string>; preset: MatchPreset; policySeats: Seat[]; subjectSeat: Seat;
}

function signatureOf(cfg: MatchConfig): string {
  const seats = SEATS.map((s) => {
    const d = cfg.seats[s].driver;
    const id = d.kind === "builtin" ? `${d.personality}:${d.tier}` : d.kind === "module" || d.kind === "trajectory" ? d.sha256 : d.kind === "bridge" ? d.url : d.kind;
    return `${d.kind}:${id}:${cfg.seats[s].loadout}:${cfg.seats[s].decisionHz}`;
  });
  return [cfg.preset, cfg.controlHz, cfg.bestOf, cfg.actionDelayTicks, cfg.fairDelayMs, cfg.strictLimits, ...seats].join("|");
}

export function policySeatsOf(cfg: MatchConfig): Seat[] {
  return SEATS.filter((s) => cfg.seats[s].driver.kind !== "human" && cfg.seats[s].driver.kind !== "proxy");
}

/** Page-lifetime record of Lab runs, so repeated runs of one setup build up a seed-bootstrap win rate. */
export const labSession = {
  runs: [] as LabRun[],
  awaiting: null as { cfg: MatchConfig } | null,
  seenStats: null as EpisodeStats | null,
  listeners: new Set<() => void>(),

  begin(cfg: MatchConfig): void { this.awaiting = { cfg }; this.seenStats = null; },
  cancel(): void { this.awaiting = null; },

  /** Picks up the director's saved result for the awaited Lab match. Safe to call repeatedly. */
  sync(game: GameHandle): void {
    const ui = game.ui.get();
    const a = this.awaiting;
    if (a && ui.lastStats && ui.lastStats !== this.seenStats) {
      this.seenStats = ui.lastStats;
      const cfg = a.cfg;
      const policySeats = policySeatsOf(cfg);
      const subject: Seat = policySeats.find((s) => isExternalPolicy(cfg.seats[s].driver)) ?? (policySeats.includes("blaze") ? "blaze" : "atlas");
      this.runs.push({
        matchId: cfg.id, episodeId: ui.lastEpisodeId, stats: ui.lastStats, seed: cfg.seed, signature: signatureOf(cfg),
        names: { atlas: cfg.seats.atlas.displayName, blaze: cfg.seats.blaze.displayName }, preset: cfg.preset, policySeats, subjectSeat: subject,
      });
      for (const fn of Array.from(this.listeners)) fn();
    }
    const last = this.runs[this.runs.length - 1];
    if (last && last.episodeId === null && ui.lastEpisodeId && a && last.matchId === a.cfg.id) {
      last.episodeId = ui.lastEpisodeId;
      for (const fn of Array.from(this.listeners)) fn();
    }
  },
};

/* ───────────────────────── seat column ───────────────────────── */

const DRIVER_OPTIONS: readonly { value: LabDriver; label: string }[] = [
  { value: "human", label: "HUMAN" }, { value: "builtin", label: "BUILT-IN" }, { value: "module", label: "MODULE" },
  { value: "trajectory", label: "TRAJECTORY" }, { value: "bridge", label: "BRIDGE" },
];
const PERSONALITIES: readonly PersonalityId[] = ["overshoot", "backlash", "deadband", "jig"];
const TIERS: readonly TierId[] = ["rookie", "contender", "pro", "champion"];

function Field(props: { label: string; children: ReactNode; hint?: string | null }): JSX.Element {
  return (
    <div className="lab-field">
      <span className="t-label lab-field__label">{props.label}</span>
      <div className="lab-field__control">{props.children}</div>
      {props.hint ? <span className="t-mono lab-field__hint">{props.hint}</span> : null}
    </div>
  );
}

function SeatColumn(props: {
  seat: Seat; draft: SeatDraft; controlHz: ControlHz; preset: MatchPreset; entrants: readonly EntrantRecord[];
  onChange: (patch: Partial<SeatDraft>) => void; onRegister: () => void;
}): JSX.Element {
  const { seat, draft, entrants } = props;
  const policy = draft.driver !== "human";
  const pool = entrants.filter((e) => e.kind === draft.driver);
  const rates = Array.from(new Set([props.controlHz, props.controlHz / 2, 10].map((x) => Math.round(x)))).filter((x) => x > 0 && props.controlHz % x === 0);
  return (
    <section className={`lab-seat lab-seat--${seat}`} aria-label={seat === "atlas" ? "ATLAS" : "BLAZE"}>
      <header className="lab-seat__head">
        <span className="t-display-l t-slant">{seat === "atlas" ? "ATLAS" : "BLAZE"}</span>
      </header>
      <Field label="DRIVER">
        <Toggle label="DRIVER" value={draft.driver} options={DRIVER_OPTIONS.map((o) => ({ ...o, disabled: o.value === "human" && !PRESETS[props.preset].humanAllowed }))} onChange={(v) => props.onChange({ driver: v })} />
      </Field>

      {draft.driver === "builtin" ? (
        <>
          <Field label="ENTRANT">
            <Toggle label="ENTRANT" value={draft.personality} options={PERSONALITIES.map((p) => ({ value: p, label: PERSONALITY_LABEL[p] }))} onChange={(v) => props.onChange({ personality: v })} />
          </Field>
          <Field label="TIER">
            <Toggle label="TIER" value={draft.tier} options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} onChange={(v) => props.onChange({ tier: v })} />
          </Field>
        </>
      ) : null}

      {draft.driver === "module" || draft.driver === "trajectory" ? (
        <Field label={draft.driver === "module" ? "MODULE" : "TRAJECTORY"} hint={pool.length === 0 ? "NONE REGISTERED" : null}>
          <div className="lab-pick">
            {pool.map((e) => (
              <button key={e.id} type="button" className="lab-pick__item" aria-pressed={draft.entrantId === e.id} onClick={() => props.onChange({ entrantId: e.id })}>
                <span className="t-plate lab-pick__name">{e.fileName}</span>
                <span className="t-mono">sha {shortSha(e.sha256)}</span>
              </button>
            ))}
            <SlantButton label="REGISTER ENTRANT" size="sm" onClick={props.onRegister} />
          </div>
        </Field>
      ) : null}

      {draft.driver === "bridge" ? (
        <>
          <Field label="URL">
            <input className="tl-field lab-input-wide" value={draft.bridgeUrl} spellCheck={false} onChange={(e) => props.onChange({ bridgeUrl: e.currentTarget.value })} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label="NETWORK">
            <Toggle label="NETWORK" value={draft.allowLan ? "lan" : "local"} options={[{ value: "local", label: "THIS MACHINE" }, { value: "lan", label: "ALLOW LAN" }]} onChange={(v) => props.onChange({ allowLan: v === "lan" })} />
          </Field>
        </>
      ) : null}

      {policy ? (
        <>
          <Field label="DECISION RATE">
            <Toggle label="DECISION RATE" value={rates.includes(draft.decisionHz) ? draft.decisionHz : rates[1] ?? rates[0]} options={rates.map((r) => ({ value: r, label: `${r} HZ` }))} onChange={(v) => props.onChange({ decisionHz: v })} />
          </Field>
          {draft.driver !== "builtin" ? (
            <>
              <Field label="CHUNKS">
                <Toggle label="CHUNKS" value={draft.chunk} options={[
                  { value: "until_next_decision", label: "UNTIL NEXT" }, { value: "full_chunk", label: "FULL CHUNK" }, { value: "n_steps", label: "N STEPS" },
                ]} onChange={(v) => props.onChange({ chunk: v })} />
              </Field>
              {draft.chunk === "n_steps" ? (
                <Field label="STEPS">
                  <Slider label="STEPS" min={1} max={100} step={1} value={draft.nSteps} onChange={(v) => props.onChange({ nSteps: v })} />
                </Field>
              ) : null}
              <Field label="ENSEMBLE">
                <Slider label="ENSEMBLE" min={0} max={16} step={1} value={draft.ensembleM} format={(v) => (v === 0 ? "OFF" : `m ${v}`)} onChange={(v) => props.onChange({ ensembleM: v })} />
              </Field>
            </>
          ) : null}
        </>
      ) : null}

      {props.preset === "arcade" && draft.driver !== "builtin" ? (
        <Field label="LOADOUT">
          <Toggle label="LOADOUT" value={draft.loadout} options={LOADOUT_ORDER.map((l) => ({ value: l, label: LOADOUT_LABEL[l] }))} onChange={(v) => props.onChange({ loadout: v })} />
        </Field>
      ) : null}
    </section>
  );
}

/** The verdict a VERIFY run stamps in the Lab footer. */
function verifyStamp(r: VerifyResult): string {
  if (r.verdict === "bit_exact") return "REPLAY VERIFIED · BIT-EXACT";
  return r.verdict === "diverged" ? `DIVERGED AT FRAME ${r.divergedFrame ?? "?"}` : "VERIFY ERROR";
}

/** The line under the stamp carries frames and anything the harness adds; never the verdict twice. */
function verifyNote(r: VerifyResult): string | null {
  const msg = (r.message ?? "").trim();
  if (!msg) return null;
  const same = (t: string): string => t.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return same(msg) === same(verifyStamp(r)) ? null : msg;
}

/* ───────────────────────── screen ───────────────────────── */

type VerifyState = { state: "idle" } | { state: "running" } | { state: "done"; result: VerifyResult } | { state: "error"; message: string };
type DeterminismState = { state: "idle" } | { state: "running" } | { state: "done"; seats: Partial<Record<Seat, boolean>> } | { state: "error"; message: string };

export function LabScreen(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const [draft, setDraft] = useState<LabDraft>(loadDraft);
  const [entrants, setEntrants] = useState<EntrantRecord[]>([]);
  const [runs, setRuns] = useState<LabRun[]>(() => labSession.runs.slice());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
  const [determinism, setDeterminism] = useState<DeterminismState>({ state: "idle" });

  useEffect(() => {
    let live = true;
    game.harness.entrants.list().then((l) => { if (live) setEntrants(l); }, () => { if (live) setEntrants([]); });
    return () => { live = false; };
  }, [game]);

  useEffect(() => {
    const update = () => setRuns(labSession.runs.slice());
    labSession.listeners.add(update);
    const off = game.ui.subscribe(() => labSession.sync(game));
    labSession.sync(game);
    return () => { labSession.listeners.delete(update); off(); };
  }, [game]);

  const patch = useCallback((p: Partial<LabDraft>) => setDraft((d) => { const n = { ...d, ...p }; saveDraft(n); return n; }), []);
  const patchSeat = useCallback((seat: Seat, p: Partial<SeatDraft>) => setDraft((d) => {
    const n = { ...d, seats: { ...d.seats, [seat]: { ...d.seats[seat], ...p } } };
    // The preset decides who may sit and how fast the loop runs; keep the draft consistent with it.
    if (p.driver === "human") { n.timing = "live"; n.turbo = false; }
    saveDraft(n);
    return n;
  }), []);

  const callsign = game.settings.get().profile.callsign;
  const { cfg, errors } = useMemo(() => draftToConfig(draft, entrants, callsign), [draft, entrants, callsign]);
  const human = SEATS.some((s) => draft.seats[s].driver === "human");
  const externalFacingHuman = human && SEATS.some((s) => ["module", "trajectory", "bridge"].includes(draft.seats[s].driver));
  const presetDef = PRESETS[draft.preset];
  const latest = runs[runs.length - 1] ?? null;
  const sameSetup = useMemo(() => (latest ? runs.filter((r) => r.signature === latest.signature) : []), [latest, runs]);
  const aggregate = useMemo(() => {
    if (!latest || sameSetup.length === 0) return null;
    try { return game.harness.aggregate(sameSetup.map((r) => r.stats), latest.subjectSeat, (i) => sameSetup[i].seed); }
    catch { return null; }
  }, [game, latest, sameSetup]);

  function setPreset(p: MatchPreset): void {
    const def = PRESETS[p];
    const seats = { ...draft.seats };
    for (const s of SEATS) if (!def.humanAllowed && seats[s].driver === "human") seats[s] = { ...seats[s], driver: "builtin" };
    patch({ preset: p, controlHz: def.controlHz.includes(draft.controlHz) ? draft.controlHz : def.controlHz[0], seats });
  }

  async function run(): Promise<void> {
    if (!cfg || errors.length > 0 || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      if (human) void game.pilot.requestLock();
      labSession.begin(cfg);
      await game.director.startMatch(cfg);
      patch({ seed: (draft.seed + 1) >>> 0 });
    } catch (err) {
      labSession.cancel();
      setStartError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START");
    } finally {
      setStarting(false);
    }
  }

  async function verifyLast(): Promise<void> {
    const id = latest?.episodeId ?? game.ui.get().lastEpisodeId;
    if (!id) return;
    setVerify({ state: "running" });
    try {
      const ep = await game.harness.store.load(id);
      const result = await game.harness.checkDeterminism(ep);
      setVerify({ state: "done", result });
      play(result.verdict === "bit_exact" ? "sticker" : "back");
    } catch (err) {
      setVerify({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function checkPolicies(): Promise<void> {
    if (!cfg) return;
    setDeterminism({ state: "running" });
    try {
      const seats: Partial<Record<Seat, boolean>> = {};
      for (const s of SEATS) {
        const d = cfg.seats[s].driver;
        if (d.kind === "human" || d.kind === "proxy") continue;
        seats[s] = await game.harness.checkPolicyDeterminism(d, s);
      }
      setDeterminism({ state: "done", seats });
      play("sticker");
    } catch (err) {
      setDeterminism({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const lastEpisodeId = latest?.episodeId ?? null;

  return (
    <div className="tl-screen tl-screen--solid lab">
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">THE LAB</div>
        <span className="tl-sticker tl-sticker--ink">{presetDef.resultStamp === "verdict" ? "VERIFICATION" : "ARCADE PHYSICS"}</span>
        <span className="tl-showbar__spacer" />
        <SlantButton label="BACK" size="sm" variant="paper" cue="back" onClick={() => game.ui.set({ screen: "green_room" })} />
      </header>

      <div className="tl-screen__body lab__body">
        <div className="lab__grid">
          <SeatColumn seat="atlas" draft={draft.seats.atlas} controlHz={draft.controlHz} preset={draft.preset} entrants={entrants}
            onChange={(p) => patchSeat("atlas", p)} onRegister={() => game.ui.set({ screen: "entrants" })} />

          <section className="lab-rules" aria-label="RULES">
            <header className="lab-seat__head"><span className="t-display-l t-slant">RULES</span></header>
            <Field label="PRESET">
              <Toggle label="PRESET" value={draft.preset} options={(["arcade", "proving_ground", "harness"] as const).map((p) => ({ value: p, label: PRESET_LABEL[p] }))} onChange={setPreset} />
            </Field>
            <Field label="TIMING" hint={human ? "EVAL NEEDS NO HUMAN" : null}>
              <Toggle label="TIMING" value={human ? "live" : draft.timing} options={[{ value: "live", label: "LIVE" }, { value: "eval", label: "EVAL", disabled: human }]} onChange={(v) => patch({ timing: v, turbo: v === "eval" && draft.turbo })} />
            </Field>
            <Field label="CONTROL">
              <Toggle label="CONTROL" value={draft.controlHz} options={([50, 30, 60] as const).map((hz) => ({ value: hz, label: `${hz} HZ`, disabled: !presetDef.controlHz.includes(hz) }))} onChange={(v) => patch({ controlHz: v })} />
            </Field>
            <Field label="SEED">
              <div className="lab-seed">
                <input className="tl-field lab-seed__input" inputMode="numeric" value={draft.seed} aria-label="SEED"
                  onChange={(e) => { const v = Number(e.currentTarget.value.replace(/\D/g, "")); if (Number.isFinite(v)) patch({ seed: Math.min(0xffffffff, v) >>> 0 }); }}
                  onKeyDown={(e) => e.stopPropagation()} />
                <button type="button" className="lab-icon" aria-label="RANDOM SEED" onClick={() => { play("select"); patch({ seed: crypto.getRandomValues(new Uint32Array(1))[0] }); }}><Glyph name="dice" /></button>
                <button type="button" className="lab-icon" aria-label="COPY SEED" onClick={() => { play("select"); void navigator.clipboard?.writeText(String(draft.seed)); }}><Glyph name="copy" /></button>
              </div>
            </Field>
            <Field label="ROUNDS">
              <Toggle label="ROUNDS" value={draft.bestOf} options={([1, 3, 5] as const).map((n) => ({ value: n, label: `BEST OF ${n}` }))} onChange={(v) => patch({ bestOf: v })} />
            </Field>
            <Field label="ACTION DELAY">
              <Slider label="ACTION DELAY" min={0} max={5} step={1} value={draft.actionDelayTicks} format={(v) => `${v} ${v === 1 ? "TICK" : "TICKS"}`} onChange={(v) => patch({ actionDelayTicks: v as MatchConfig["actionDelayTicks"] })} />
            </Field>
            <Field label="FAIR DELAY" hint={externalFacingHuman ? null : "APPLIES WITH A HUMAN VS A POLICY"}>
              <Slider label="FAIR DELAY" min={0} max={FAIR_DELAY_MAX_MS} step={10} value={draft.fairDelayMs} disabled={!externalFacingHuman} format={(v) => `${formatInt(v)} ms`} onChange={(v) => patch({ fairDelayMs: v })} />
            </Field>
            <Field label="LIMITS">
              <Toggle label="LIMITS" value={draft.strictLimits ? "strict" : "lenient"} options={[{ value: "strict", label: "STRICT" }, { value: "lenient", label: "LENIENT" }]} onChange={(v) => patch({ strictLimits: v === "strict" })} />
            </Field>
            <Field label="RECORD">
              <Toggle label="RECORD" value={draft.record ? "on" : "off"} options={[{ value: "on", label: "ON" }, { value: "off", label: "OFF" }]} onChange={(v) => patch({ record: v === "on" })} />
            </Field>
            <Field label="RENDER">
              <Toggle label="RENDER" value={draft.turbo && !human && draft.timing === "eval" ? "turbo" : "on"} options={[{ value: "on", label: "ON" }, { value: "turbo", label: "TURBO", disabled: human || draft.timing !== "eval" }]} onChange={(v) => patch({ turbo: v === "turbo" })} />
            </Field>
          </section>

          <SeatColumn seat="blaze" draft={draft.seats.blaze} controlHz={draft.controlHz} preset={draft.preset} entrants={entrants}
            onChange={(p) => patchSeat("blaze", p)} onRegister={() => game.ui.set({ screen: "entrants" })} />
        </div>

        {errors.length > 0 ? (
          <ul className="lab__errors" role="alert">
            {errors.map((e) => <li key={e} className="tl-error t-label">{e}</li>)}
          </ul>
        ) : null}
        {startError ? <div className="tl-error t-label" role="alert">{startError}</div> : null}

        {latest ? (
          <LabResults game={game} stats={latest.stats} episodeId={latest.episodeId} aggregate={aggregate} subjectSeat={latest.subjectSeat}
            names={latest.names} preset={latest.preset} policySeats={latest.policySeats} />
        ) : (
          <p className="lab__empty t-label">NO RUNS YET{SEP}RESULTS LAND HERE</p>
        )}
      </div>

      <footer className="lab__foot">
          <div className="lab__checks">
            {verify.state === "running" ? <span className="t-label lab__pending">VERIFYING EPISODE</span> : null}
            {verify.state === "done" ? (
              <span className="lab__check">
                <Stamp tone={verify.result.verdict === "bit_exact" ? "signal" : "fault"} size="s" animate>{verifyStamp(verify.result)}</Stamp>
                <span className="t-mono">{verify.result.checkedFrames} FRAMES{verifyNote(verify.result) ? `${SEP}${verifyNote(verify.result)}` : ""}</span>
              </span>
            ) : null}
            {verify.state === "error" ? <span className="tl-error t-mono">{verify.message}</span> : null}
            {determinism.state === "running" ? <span className="t-label lab__pending">CHECKING POLICIES</span> : null}
            {determinism.state === "done" ? (
              <span className="lab__check">
                {SEATS.filter((s) => determinism.seats[s] !== undefined).map((s) => (
                  <Stamp key={s} tone={determinism.seats[s] ? "paper" : "fault"} size="s" animate>
                    {`${s === "atlas" ? "ATLAS" : "BLAZE"} ${determinism.seats[s] ? "DETERMINISTIC" : "NONDETERMINISTIC"}`}
                  </Stamp>
                ))}
              </span>
            ) : null}
            {determinism.state === "error" ? <span className="tl-error t-mono">{determinism.message}</span> : null}
          </div>
        <div className="lab__foot-row">
          <div className="lab__actions">
            {human
              ? <SlantButton label="FIGHT IT" variant="primary" disabled={!cfg || errors.length > 0 || starting} onClick={() => void run()} />
              : <SlantButton label="RUN MATCH" variant="primary" disabled={!cfg || errors.length > 0 || starting} onClick={() => void run()} />}
            <SlantButton label="VERIFY LAST EPISODE" size="md" disabled={!lastEpisodeId || verify.state === "running"} onClick={() => void verifyLast()} />
            <SlantButton label="CHECK DETERMINISM" size="md" disabled={!cfg || determinism.state === "running" || SEATS.every((s) => draft.seats[s].driver === "human")} onClick={() => void checkPolicies()} />
          </div>
          <div className="tl-hintbar">
            <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> BACK</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
