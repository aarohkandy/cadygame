// src/game/brand/hosts.ts (WP7)
// The two original hosts of TORQUE LIMIT (SCOPE 1.2, BUILD_PLAN D9). Captions always show a tag plate from here
// (captions.tsx); with HOST VOICE on, WP3's announcer speaks through Web Speech using `speech`.
//
// ROOK      hype caller for the big moments. Signal lip (the show's own colour). Slightly low and quick.
// DR. VALE  dry analyst who quotes real numbers. Paper lip. Level pitch, a touch slower so numbers land.
//
// preferredVoiceNames are matched in order against speechSynthesis.getVoices() names (substring, case-insensitive);
// they cover the stock voices of macOS/iOS, Chrome, Edge, and Android so both hosts sound distinct on each.

import type { HostId, HostProfile } from "../contracts.ts";

export const HOSTS: Readonly<Record<HostId, HostProfile>> = {
  rook: {
    id: "rook", tag: "ROOK", role: "hype", lip: "signal",
    speech: {
      pitch: 0.86, rate: 1.1,
      preferredVoiceNames: ["Daniel", "Google UK English Male", "Microsoft Ryan", "Microsoft Guy", "Aaron", "Arthur", "Fred"],
    },
  },
  vale: {
    id: "vale", tag: "DR. VALE", role: "analyst", lip: "paper",
    speech: {
      pitch: 1.04, rate: 0.95,
      preferredVoiceNames: ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Moira", "Karen", "Tessa"],
    },
  },
};

export const HOST_IDS: readonly HostId[] = ["rook", "vale"];

/** Picks the best available Web Speech voice for a host, or null when none is installed. */
export function pickHostVoice<V extends { name: string; lang: string }>(id: HostId, voices: readonly V[]): V | null {
  if (voices.length === 0) return null;
  for (const want of HOSTS[id].speech.preferredVoiceNames) {
    const w = want.toLowerCase();
    const hit = voices.find((v) => v.name.toLowerCase().includes(w));
    if (hit) return hit;
  }
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (english.length === 0) return voices[0];
  // Give the two hosts different fallbacks so they never share a voice when two or more exist.
  return english[id === "rook" ? 0 : Math.min(1, english.length - 1)];
}
