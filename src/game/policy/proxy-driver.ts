// src/game/policy/proxy-driver.ts (WP4)
// Drives a proxy bot through the PilotController's SyntheticInput (GAME_DESIGN 5.5.7, BUILD_PLAN section 5
// "Proxy bot → pilot"). The sim-driver calls `update` once per control tick with the seat's observation; this
// wrapper forwards every synthetic event to the pilot and folds it into a running FNV-1a digest, so two runs of
// the same seed can be compared input for input (acceptance 13) without storing the stream.

import type { Observation, PilotController, ProxyBot, SyntheticInput } from "../contracts.ts";

export interface ProxyDriver extends ProxyBot {
  /** FNV-1a 32 digest of every synthetic event since the last reset. */
  readonly inputDigest: number;
  /** Synthetic events forwarded since the last reset. */
  readonly inputCount: number;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function createProxyDriver(bot: ProxyBot): ProxyDriver {
  let digest = FNV_OFFSET;
  let count = 0;
  let target: SyntheticInput | null = null;

  function mix(n: number): void {
    const v = n | 0;
    for (let i = 0; i < 4; i++) {
      digest ^= (v >>> (i * 8)) & 0xff;
      digest = Math.imul(digest, FNV_PRIME) >>> 0;
    }
  }
  function mixString(s: string): void {
    for (let i = 0; i < s.length; i++) {
      digest ^= s.charCodeAt(i) & 0xff;
      digest = Math.imul(digest, FNV_PRIME) >>> 0;
    }
  }

  const recording: SyntheticInput = {
    move(dx, dy) { count++; mix(1); mix(Math.round(dx)); mix(Math.round(dy)); target?.move(dx, dy); },
    key(code, down) { count++; mix(2); mixString(code); mix(down ? 1 : 0); target?.key(code, down); },
    button(b, down) { count++; mix(3); mix(b); mix(down ? 1 : 0); target?.button(b, down); },
  };

  return {
    get inputDigest() { return digest; },
    get inputCount() { return count; },
    reset(seed: number) {
      digest = FNV_OFFSET;
      count = 0;
      bot.reset(seed);
    },
    update(obs: Observation, pilot: PilotController, input: SyntheticInput, wallDtS: number) {
      target = input;
      mix(Math.round(obs.t * 1e6));
      bot.update(obs, pilot, recording, wallDtS);
      target = null;
    },
  };
}
