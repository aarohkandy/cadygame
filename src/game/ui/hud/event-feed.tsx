// src/game/ui/hud/event-feed.tsx (WP7)
// Top right, four notched rows with a team lip (7.4), only in the Lab and against user models. Rows enter over 180 ms,
// hold 4.5 s, collapse over 160 ms; hud-runtime writes them as events arrive.
import type { JSX } from "react";

export function EventFeed(): JSX.Element {
  return (
    <div className="hud-feed" aria-live="off">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="hud-feed-row tl-notch" data-h={`feed-${i}`} data-show="false" data-seat="none">
          <span className="hud-feed-row__lip" aria-hidden="true" />
          <span className="t-label hud-feed-row__text" data-h={`feed-${i}-text`} />
        </div>
      ))}
    </div>
  );
}
