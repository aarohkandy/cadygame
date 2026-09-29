// src/game/ui/kit/wipe.tsx (WP7)
// Screen transition (7.2 broadcast tier): an ink panel with a signal lip cuts across at the panel slant, 200 ms in and
// 160 ms out. Changing `trigger` plays it once; the element unmounts itself when the animation ends.
"use client";

import { useEffect, useState, type JSX } from "react";

export const WIPE_MS = 360;

export function Wipe(props: { trigger: string }): JSX.Element | null {
  const [playing, setPlaying] = useState<string | null>(null);
  const [seen, setSeen] = useState(props.trigger);

  if (props.trigger !== seen) {
    setSeen(props.trigger);
    setPlaying(props.trigger);
  }

  useEffect(() => {
    if (playing === null) return;
    const id = window.setTimeout(() => setPlaying(null), WIPE_MS);
    return () => window.clearTimeout(id);
  }, [playing]);

  if (playing === null) return null;
  return (
    <div className="tl-wipe" aria-hidden="true" key={playing}>
      <div className="tl-wipe__panel" />
    </div>
  );
}
