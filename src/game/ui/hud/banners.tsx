// src/game/ui/hud/banners.tsx (WP7)
// The centre band (EMOTION_BIBLE 5.7, 6): between rounds one banner at a time from banner-queue (KNOCKOUT with the
// SHORTED OUT sticker, LOCKED, SUDDEN DEATH, TIME, ROUND TO, the result slab), the splash that sells the big ones
// (flash, team burst, ring, shards, letterbox); in a fight the callout slams (FIRST BLOOD, CRIT, DEFLECT, STREAK,
// STEAL), the one FIGHT slam, two centre tags (match 2+: CLASH, STAGGERED, SHORTED) and the tag over the opponent's
// gripper (OPEN, PUNISH, WHIP). All written by hud-runtime.
// Titles are pools of letter slots so each word can stagger in without React: the runtime writes one glyph per slot.
import type { CSSProperties, JSX } from "react";
import { BANNER_LETTERS, CALLOUT_LETTERS } from "./banner-queue.ts";

const SHARDS = 12;

function Letters(props: { prefix: string; count: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: props.count }, (_, i) => (
        <span key={i} className="hud-letter" style={{ "--i": i } as CSSProperties} data-h={`${props.prefix}-${i}`} />
      ))}
    </>
  );
}

export function Banners(): JSX.Element {
  return (
    <>
      <div className="hud-splash" data-h="splash" data-kind="none" data-team="none" aria-hidden="true">
        <i className="hud-splash__flash" />
        <i className="hud-splash__burst" />
        <i className="hud-splash__ring" />
        <i className="hud-splash__ring hud-splash__ring--late" />
        {Array.from({ length: SHARDS }, (_, i) => (
          <i
            key={i}
            className="hud-splash__shard"
            // Fixed, uneven spokes so the burst reads as debris rather than a clock face.
            style={{ "--a": `${i * 30 + ((i * 37) % 17) - 8}deg`, "--d": `${34 + ((i * 53) % 22)}vmin`, "--s": `${0.7 + ((i * 29) % 9) / 10}` } as CSSProperties}
          />
        ))}
        <i className="hud-splash__bar hud-splash__bar--top" />
        <i className="hud-splash__bar hud-splash__bar--bottom" />
      </div>
      <div className="hud-banner" data-h="banner" data-show="false" role="status" aria-live="assertive">
        <div className="hud-banner__band" aria-hidden="true">
          <i className="hud-banner__sweep" />
        </div>
        <div className="hud-banner__word">
          <span className="tl-sr-only" data-h="banner-title" />
          <span className="hud-banner__title t-display-xl t-slant" data-h="banner-letters" aria-hidden="true">
            <Letters prefix="banner-l" count={BANNER_LETTERS} />
          </span>
          <span className="hud-banner__sub t-plate" data-h="banner-sub" />
        </div>
        <span className="hud-banner__sticker tl-sticker tl-sticker--lg" data-h="banner-sticker" />
      </div>
      <div className="hud-callout" data-h="callout" data-show="false" data-tone="neutral" aria-hidden="true">
        <i className="hud-callout__streak" />
        <span className="hud-callout__word t-display-l t-slant">
          <Letters prefix="callout-l" count={CALLOUT_LETTERS} />
        </span>
        <span className="hud-callout__sub t-plate" data-h="callout-sub" />
      </div>
      <div className="hud-countdown" data-h="countdown" data-show="false" aria-hidden="true">
        <i className="hud-countdown__band"><i className="hud-countdown__sweep" /></i>
        <i className="hud-countdown__ring" />
        <span className="hud-countdown__text t-display-xl t-slant" data-h="countdown-text" />
      </div>
      <div className="hud-tags" aria-hidden="true">
        <span className="hud-tag" data-h="tag-0" data-show="false" />
        <span className="hud-tag" data-h="tag-1" data-show="false" />
      </div>
      <span className="hud-grip-tag t-label" data-h="grip-tag" data-show="false" data-kind="open" aria-hidden="true" />
    </>
  );
}
