// src/game/ui/screens/verdict-screen.tsx (WP6)
// The verdict (EMOTION_BIBLE 8.2): readable in ≤ 6 s. Left to right: the result slab by cause (VICTORY; SHORTED
// OUT, OUT-LOCKED, OUT-POINTED, never a bare DEFEAT), round pips, the bout number; three superlatives ranked
// against the pilot's own history (NEW PB only after one completed match); on a loss the gap (one named number)
// and one 30-second goal; on a win the medal stamped. Buttons gated by matchesPlayed at match start: matches 1–2
// REMATCH only (match 1 adds the once-ever STABLE line); match 3+ REMATCH · NEW OPPONENT · SHARE (SAVE CLIP ·
// COPY BOUT · CHALLENGE A FRIEND). Enter is always REMATCH. Nothing here writes the clipboard on its own.
"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { GameHandle, MatchConfig, Seat, SettingsStore } from "../../contracts.ts";
import type { SettingsStoreExtras } from "../../core/settings.ts";
import { SEATS } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { dailyBout, humanSeatOf, showKitFor } from "../../match/match-config.ts";
import { verdictCause, type MatchDirectorExtras, type VerdictCause } from "../../match/match-director.ts";
import { downloadBlob, episodeFileName } from "./lab-results.tsx";
import { SEP } from "../hud/format.ts";
import { useUi } from "../hud/hud.tsx";
import { CountUp } from "../kit/count-up.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { Sticker } from "../kit/sticker.tsx";
import { ConsentStrip as KitConsentStrip } from "../kit/consent-strip.tsx";
import { sharedProfile, type Medal } from "../meta/profile.ts";
import { GOAL_LABEL, GOAL_SKILL, boutCard, computeSuperlatives, lossVerdict, rankSuperlatives } from "../meta/superlatives.ts";
import { clipMime, lastClip, saveClip } from "./clip-recorder.ts";

export const CAUSE_LABEL: Readonly<Record<VerdictCause, string>> = {
  victory: "VICTORY", shorted_out: "SHORTED OUT", out_locked: "OUT-LOCKED", out_pointed: "OUT-POINTED",
};
export const STABLE_LINE = "FEELING IT IN YOUR STOMACH? ESC → STABLE CAMERA";
const MEDAL_LABEL: Readonly<Record<Medal, string>> = { bronze: "BRONZE", silver: "SILVER", gold: "GOLD" };
/** The consent strip's buttons go live this long after the verdict appears (9). */
export const CONSENT_ARM_MS = 1500;

/**
 * The consent strip (9): two buttons, armed 1.5 s in, pointer click or Tab focus + Space only (never Enter, which
 * stays REMATCH); decisionMs and inputMethod go to WP8's settings store. Shown when the store says it is due.
 */
function ConsentStrip(props: { game: GameHandle; onDone: () => void }): JSX.Element {
  const store = props.game.settings as SettingsStore & Partial<SettingsStoreExtras>;
  const shownAt = useRef(0);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    shownAt.current = performance.now();
    const id = window.setTimeout(() => setArmed(true), CONSENT_ARM_MS);
    return () => window.clearTimeout(id);
  }, []);
  function decide(scope: "share" | "local", inputMethod: "pointer" | "keyboard"): void {
    if (!armed) return;
    store.recordConsent?.({ scope, decisionMs: Math.round(performance.now() - shownAt.current), inputMethod });
    props.onDone();
  }
  // Markup and copy are WP7's kit strip (9); the timing and the store write stay here.
  return <KitConsentStrip armed={armed} onDecide={decide} />;
}

/** The goal line is the hint (8.2): REMATCH after a goal re-arms that skill's coaching caption once. WP7 reads it. */
export const nextMatchHint: { skill: "guard" | "dock" | "hit" | null } = { skill: null };

type Extras = GameHandle["director"] & Partial<MatchDirectorExtras>;

export function VerdictScreen(props: { game: GameHandle; match: MatchConfig }): JSX.Element {
  const { game, match } = props;
  const play = useUiCue();
  const director = game.director as Extras;
  const roundsWon = useUi(game, (s) => s.roundsWon);
  const episodeId = useUi(game, (s) => s.lastEpisodeId);
  const [share, setShare] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [clipReady, setClipReady] = useState(lastClip.clip !== null);
  const consentStore = game.settings as SettingsStore & Partial<SettingsStoreExtras>;
  const [consent, setConsent] = useState(() => consentStore.consentStripDue?.(game.settings.get().profile.matchesPlayed) === true);
  const events = useMemo(() => director.matchEvents ?? [], [director]);
  const player: Seat = humanSeatOf(match) ?? "atlas";
  const opp: Seat = player === "atlas" ? "blaze" : "atlas";
  const winner: Seat | null = director.winner ?? (roundsWon.atlas === roundsWon.blaze ? null : roundsWon.atlas > roundsWon.blaze ? "atlas" : "blaze");
  const won = winner === player;
  const cause = verdictCause(won, director.finalReason ?? null);
  // Gates key on matchesPlayed at match start; finalize() has already counted this match.
  const played = game.settings.get().profile.matchesPlayed;
  const kit = showKitFor(Math.max(0, played - 1));
  const bout = useMemo(() => dailyBout(new Date(), sharedProfile().totals()), []);
  const names: Record<Seat, string> = { atlas: match.seats.atlas.displayName, blaze: match.seats.blaze.displayName };

  const list = useMemo(() => computeSuperlatives(events, player), [events, player]);
  const rounds = useMemo(() => events.filter((e) => e.type === "round_end").map((e) => (e.type === "round_end" && e.winner === player ? "win" as const : "loss" as const)), [events, player]);
  const lockOrClutch = useMemo(() => events.some((e) => (e.type === "round_end" && e.reason === "lock" && e.winner === player) || (e.type === "core" && e.stage === "steal" && e.seat === player && e.late)), [events, player]);

  useEffect(() => {
    if (!winner) return;
    sharedProfile().applyMatch({
      matchId: match.id, opponent: match.seats[opp].driver, won, superlatives: list,
      roundsWon: { player: roundsWon[player], opponent: roundsWon[opp] }, lockOrClutch, medalsOn: true,
    });
  }, [match, opp, won, list, winner, roundsWon, player, lockOrClutch]);

  const ranked = useMemo(() => rankSuperlatives(list, sharedProfile().bestsBefore(match.id)), [list, match.id]);
  const medal = sharedProfile().medalFor(match.id);
  const stableLine = useMemo(() => (kit.stableHint ? sharedProfile().claimStableHint() : false), [kit.stableHint]);
  const loss = useMemo(() => {
    if (won) return null;
    const core = game.rules.state.core;
    const held = core.owner === player ? { player: core.lockInTotalS - core.lockInRemainingS, total: core.lockInTotalS } : null;
    return lossVerdict(events, player, director.finalReason ?? null, director.tutorial?.skipped ?? [], {
      player: game.rules.state.seats[player].integrity, opponent: game.rules.state.seats[opp].integrity,
    }, held);
  }, [won, events, player, opp, director, game]);

  useEffect(() => {
    if (consent) consentStore.consentStripShown?.(game.settings.get().profile.matchesPlayed);
  }, [consent, consentStore, game]);

  useEffect(() => {
    const p = lastClip.pending;
    if (!p) return;
    let live = true;
    void p.then((c) => { if (live) setClipReady(c !== null); });
    return () => { live = false; };
  }, []);

  function rematch(): void {
    nextMatchHint.skill = loss ? GOAL_SKILL[loss.goal] : null;
    play("select");
    void game.director.rematch();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === "KeyR" || e.code === "Enter") { e.preventDefault(); rematch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function copyBout(): Promise<void> {
    const text = boutCard({ boutNumber: bout.number, callsign: names[player], opponent: names[opp], score: { player: roundsWon[player], opponent: roundsWon[opp] }, rounds, events, player });
    try { await navigator.clipboard.writeText(text); setNote("BOUT COPIED"); play("sticker"); }
    catch { setNote("CLIPBOARD BLOCKED"); }
  }

  async function challenge(): Promise<void> {
    if (!episodeId) return;
    try { downloadBlob(await game.harness.store.exportBlob(episodeId), episodeFileName(episodeId)); setNote("CHALLENGE FILE SAVED"); }
    catch (err) { setNote(`EXPORT FAILED${SEP}${err instanceof Error ? err.message.toUpperCase() : ""}`); }
  }

  async function clip(): Promise<void> {
    const c = lastClip.clip ?? (await lastClip.pending);
    if (!c) { setNote("NO CLIP THIS MATCH"); return; }
    setNote((await saveClip(c)) === "shared" ? "CLIP SHARED" : "CLIP SAVED");
  }

  const need = Math.floor(match.bestOf / 2) + 1;
  return (
    <div className="tl-screen tl-screen--scrim pm" data-verdict={cause}>
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">VERDICT</div>
        <span className="tl-sticker tl-sticker--ink t-mono">BOUT #{String(bout.number).padStart(4, "0")}</span>
      </header>

      <div className="tl-screen__body pm__body">
        <section className="pm__left">
          <div className="pm__result">
            <Stamp tone={won ? "gold" : "ink"} size="xl" animate fit>{CAUSE_LABEL[cause]}</Stamp>
            <div className={`pm__lip pm__lip--${winner ?? "none"}`} aria-hidden="true" />
            {director.gg ? <span className="pm-sup__pb"><Sticker tone="signal" animate delayMs={500}>GG</Sticker></span> : null}
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
          </div>

          {loss ? (
            <div className="pm__best" role="status">
              <span className="t-label pm__best-title">THE GAP</span>
              <div className="pm-sup pm-sup--mvp tl-anim-slide-l" style={{ animationDelay: "300ms" }}>
                <span className="t-num-m pm-sup__value">{loss.gap}</span>
              </div>
              <span className="t-label pm__best-title">30-SECOND GOAL</span>
              <div className="pm-sup tl-anim-slide-l" style={{ animationDelay: "420ms" }}>
                <span className="t-display-l t-slant pm-sup__value">{GOAL_LABEL[loss.goal]}</span>
              </div>
            </div>
          ) : medal && kit.medals ? (
            <div className="pm__best">
              <span className="t-label pm__best-title">MEDAL</span>
              <div className="pm-sup pm-sup--mvp tl-anim-slide-l" style={{ animationDelay: "300ms" }}>
                <Sticker tone="prize" animate delayMs={400}>{MEDAL_LABEL[medal]}</Sticker>
                <span className="t-mono pm-sup__display">{names[opp]}</span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="pm__right">
          {ranked.length > 0 ? (
            <div className="pm__best">
              <span className="t-label pm__best-title">BEST OF MATCH</span>
              {ranked.map((s, i) => (
                <div key={s.id} className={`pm-sup tl-anim-slide-l ${i === 0 ? "pm-sup--mvp" : ""}`} style={{ animationDelay: `${300 + i * 120}ms` }}>
                  <span className="t-label pm-sup__label">{s.label}</span>
                  <span className="t-num-xl pm-sup__value">
                    <CountUp value={s.headline} decimals={s.unit === "m/s" ? 2 : 0} durationMs={600} delayMs={360 + i * 120} />
                    {s.unit ? <span className="t-plate pm-sup__unit">{s.unit === "%" ? "%" : ` ${s.unit}`}</span> : null}
                  </span>
                  <span className="t-mono pm-sup__display">{s.display}</span>
                  {s.newPb && kit.pbStamps ? <span className="pm-sup__pb"><Sticker tone="prize" animate delayMs={760 + i * 120}>NEW PB</Sticker></span> : null}
                </div>
              ))}
            </div>
          ) : <p className="t-label pm__empty">NO CONTACT THIS MATCH</p>}
        </section>
      </div>

      <footer className="pm__foot">
        <div className="pm__actions">
          <SlantButton label="REMATCH" variant="primary" autoFocus hint="ENTER" onClick={rematch} />
          {kit.share ? (
            <>
              <SlantButton label="NEW OPPONENT" size="md" onClick={() => { game.director.enterGreenRoom(); game.ui.set({ screen: "entrants" }); }} />
              {share ? (
                <>
                  {clipMime() ? <SlantButton label="SAVE CLIP" size="md" disabled={!clipReady} onClick={() => void clip()} /> : null}
                  <SlantButton label="COPY BOUT" size="md" onClick={() => void copyBout()} />
                  <SlantButton label="CHALLENGE A FRIEND" size="md" disabled={!episodeId} onClick={() => void challenge()} />
                </>
              ) : <SlantButton label="SHARE" size="md" onClick={() => setShare(true)} />}
            </>
          ) : null}
          {note ? <span className="t-label pm__note" role="status">{note}</span> : null}
        </div>
        {stableLine ? <p className="t-label pm__note">{STABLE_LINE}</p> : null}
        {consent ? <ConsentStrip game={game} onDone={() => setConsent(false)} /> : null}
      </footer>
    </div>
  );
}
