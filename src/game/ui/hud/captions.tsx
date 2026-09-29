// src/game/ui/hud/captions.tsx (WP7)
// The one caption (EMOTION_BIBLE 2, 7): bottom centre, one line at a time. A host line carries the host's tag plate in
// its lip colour (HOSTS) and prosody as data (data-ramp 0..3 sets weight, size and reveal speed; data-release
// stretches the final word); a prompt (`HIT IT`, `GUARD · HOLD RMB`) hides the tag and shows the mouse glyph the
// runtime parsed out of the text. Caption size follows settings; FULL / BIG MOMENTS / OFF is honoured.
import type { JSX } from "react";
import { Glyph } from "../kit/glyphs.tsx";

export function Captions(): JSX.Element {
  return (
    <div className="hud-caption" data-h="caption" data-show="false" data-host="true" data-glyph="none" data-ramp="1" data-release="false" aria-live="polite">
      <span className="hud-caption__tag t-plate" data-h="caption-tag" />
      <span className="hud-caption__body t-plate">
        <span className="hud-caption__glyph hud-caption__glyph--left" aria-hidden="true"><Glyph name="mouse-left" /></span>
        <span className="hud-caption__glyph hud-caption__glyph--right" aria-hidden="true"><Glyph name="mouse-right" /></span>
        <span className="hud-caption__glyph hud-caption__glyph--move" aria-hidden="true"><Glyph name="mouse-move" /></span>
        <span className="hud-caption__text" data-h="caption-text" />
        <span className="hud-caption__last" data-h="caption-last" />
      </span>
    </div>
  );
}
