// src/game/ui/hud/match-intro.tsx (WP6)
// The show intro's text (EMOTION_BIBLE 2, 6 last row). `entrance`: the opponent's nameplate slams in (`BACKLASH ·
// ROOKIE`, the `SPARRING` tag and no bar in the match-1 sparring round) and, on a rematch or round 2+, the memory
// caption (`IT REMEMBERS THE LEFT HOOK`) or VALE's round-2 line. `boot_ritual` and `count_in`: nothing (the arm
// and the LEDs are the show). `round_intro` in the show flow: the one FIGHT slam, 240 ms in. The Lab and
// policy-only matches keep the old split-screen VS card on `match_intro`.
"use client";

import { useMemo, type CSSProperties, type JSX } from "react";
import type { DriverSpec, GameHandle, OpponentMemory, Seat, SeatConfig } from "../../contracts.ts";
import { BrandMarkSvg } from "../../brand/wordmark.tsx";
import { isFirstMatch } from "../../match/match-config.ts";
import type { MatchDirectorExtras } from "../../match/match-director.ts";
import { Halftone } from "../kit/halftone.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { sharedProfile } from "../meta/profile.ts";
import { LOADOUT_LABEL, PERSONALITY_STYLE, SEP, TIER_LABEL, driverTag, formatRecord } from "./format.ts";
import { useUi } from "./hud.tsx";

const BEATS = { split: 200, opponent: 800, pilot: 1100, vs: 1600, out: 4800 } as const;
const FAST_SCALE = 0.4;
/** The FIGHT slam lands this far into the ignite beat (2: "one FIGHT slam (240 ms in)"). */
export const FIGHT_SLAM_MS = 240;

/** The rematch intro's memory caption (4.5): one line, only when the opponent has something to remember. */
export function memoryCaption(m: OpponentMemory): string | null {
  if (m.bestMove === "hook" && m.hurtSide !== 0) return `IT REMEMBERS THE ${m.hurtSide < 0 ? "LEFT" : "RIGHT"} HOOK`;
  if (m.bestMove === "hook") return "IT REMEMBERS THE HOOK";
  if (m.grudge >= 2) return "IT WANTS THIS ONE";
  if (m.feintsWorked >= 2) return "IT STOPPED BITING";
  if (m.timeToFirstAttackS !== null && m.timeToFirstAttackS >= 5) return "IT KNOWS YOU WAIT";
  if (m.bestMove === "crit") return "IT REMEMBERS THE CRIT";
  return null;
}

function archetype(spec: DriverSpec): string | null {
  if (spec.kind === "builtin") return PERSONALITY_STYLE[spec.personality];
  if (spec.kind === "module" || spec.kind === "trajectory") return "USER MODEL";
  if (spec.kind === "bridge") return "LOCAL BRIDGE";
  return null;
}

function Nameplate(props: { seat: Seat; cfg: SeatConfig; record: string | null; delayMs: number }): JSX.Element {
  const { seat, cfg } = props;
  const human = cfg.driver.kind === "human";
  const type = archetype(cfg.driver);
  return (
    <div className={`intro-plate intro-plate--${seat} tl-anim-${seat === "atlas" ? "slide-l" : "slide-r"}`} style={{ animationDelay: `${props.delayMs}ms` }}>
      <span className="intro-plate__type t-label">{human ? "PILOT" : type ?? "ENTRANT"}</span>
      <span className="intro-plate__name t-display-l t-slant">{cfg.displayName}</span>
      <span className="intro-plate__tag t-mono">
        {human ? `LOADOUT ${LOADOUT_LABEL[cfg.loadout]}` : `${driverTag(cfg.driver)}${SEP}${LOADOUT_LABEL[cfg.loadout]}`}
      </span>
      {props.record ? <span className="intro-plate__record t-mono">{props.record}</span> : null}
    </div>
  );
}

/** The show entrance: the opponent's plate and, when there is one, the one caption under it. */
function Entrance(props: { game: GameHandle; opp: SeatConfig; sparring: boolean; caption: string | null }): JSX.Element {
  const d = props.opp.driver;
  const tier = d.kind === "builtin" ? TIER_LABEL[d.tier] : null;
  return (
    <div className="intro" data-fast="true" data-show="entrance">
      <div className="intro__plates" style={{ justifyContent: "center" }}>
        <div className="intro-plate intro-plate--blaze tl-anim-slam" style={{ animationDelay: "300ms" }}>
          <span className="intro-plate__name t-display-l t-slant">{props.opp.displayName}{tier ? `${SEP}${tier}` : ""}</span>
          {props.sparring ? <span className="intro-plate__tag t-plate">SPARRING</span> : null}
        </div>
      </div>
      {props.caption ? (
        <div className="intro__ribbon tl-anim-slide-up" style={{ animationDelay: "900ms" }}>
          <span className="t-plate">{props.caption}</span>
        </div>
      ) : null}
    </div>
  );
}

export function MatchIntro(props: { game: GameHandle }): JSX.Element | null {
  const phase = useUi(props.game, (s) => s.phase);
  const match = useUi(props.game, (s) => s.match);
  const round = useUi(props.game, (s) => s.round);
  const profile = useMemo(() => sharedProfile(), []);
  if (!match) return null;
  const human = match.seats.atlas.driver.kind === "human";

  if (human && phase === "entrance") {
    const director = props.game.director as GameHandle["director"] & Partial<MatchDirectorExtras>;
    const first = isFirstMatch(match);
    const sparring = first && round === 1;
    const caption = first && round === 2
      ? "SPARRING'S OVER · IT HITS BACK NOW"
      : round === 1 && director.opponentMemory ? memoryCaption(director.opponentMemory) : null;
    return <Entrance game={props.game} opp={match.seats.blaze} sparring={sparring} caption={caption} />;
  }
  if (human && phase === "round_intro") {
    return (
      <div className="intro" data-fast="true" data-show="ignite">
        <div className="intro__vs" style={{ "--vs-delay": `${FIGHT_SLAM_MS}ms` } as CSSProperties}>
          <Stamp tone="paper" size="xl" animate delayMs={FIGHT_SLAM_MS}>FIGHT</Stamp>
        </div>
      </div>
    );
  }
  if (phase !== "match_intro" || human) return null;

  const k = match.fastShow ? FAST_SCALE : 1;
  const at = (ms: number) => Math.round(ms * k);
  const blaze = match.seats.blaze;
  const oppRecord = profile.record(blaze.driver);
  const style = { "--intro-out": `${at(BEATS.out)}ms` } as CSSProperties;

  return (
    <div className="intro" style={style} data-fast={match.fastShow ? "true" : "false"}>
      <div className="intro__half intro__half--atlas" style={{ animationDelay: `${at(BEATS.split) - 200 * k}ms` }}>
        <Halftone fade opacity={0.18} className="intro__dots" />
      </div>
      <div className="intro__half intro__half--blaze" style={{ animationDelay: `${at(BEATS.split) - 200 * k}ms` }}>
        <Halftone fade opacity={0.18} className="intro__dots intro__dots--flip" />
      </div>
      <div className="intro__plates">
        <Nameplate seat="atlas" cfg={match.seats.atlas} record={null} delayMs={match.fastShow ? at(BEATS.split) : at(BEATS.pilot)} />
        <div className="intro__vs" style={{ "--vs-delay": `${at(BEATS.vs)}ms` } as CSSProperties}>
          <Stamp tone="paper" size="xl" animate delayMs={at(BEATS.vs)}>VS</Stamp>
        </div>
        <Nameplate
          seat="blaze"
          cfg={blaze}
          record={oppRecord.w + oppRecord.l > 0 ? `RECORD ${formatRecord(oppRecord.w, oppRecord.l)}` : null}
          delayMs={match.fastShow ? at(BEATS.split) : at(BEATS.opponent)}
        />
      </div>
      {!match.fastShow ? (
        <div className="intro__ribbon tl-anim-slide-up" style={{ animationDelay: `${at(BEATS.opponent)}ms` }}>
          <span className="t-label">PRESENTED BY</span>
          <BrandMarkSvg id="ohmstead" title="OHMSTEAD" recolor={{ ink: "paper" }} className="intro__sponsor" />
        </div>
      ) : null}
    </div>
  );
}
