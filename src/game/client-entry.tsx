// src/game/client-entry.tsx (WP1)
// The page's only client boundary. The game touches window, WebGL, WebAudio, and WASM at module scope,
// so it is never prerendered: next/dynamic with ssr: false loads game-root.tsx in the browser only.
"use client";

import dynamic from "next/dynamic";

const GameRoot = dynamic(() => import("./game-root.tsx"), {
  ssr: false,
  loading: () => <main className="h-dvh w-full bg-[#0E0F14]" />,
});

export function ClientEntry() {
  return <GameRoot />;
}
