// src/game/announcer/host-voice.ts (WP3)
// Optional synthesized voices for ROOK and DR. VALE (SCOPE 3, BUILD_PLAN D9). Off by default; captions always run.
// Web Speech output cannot be routed through WebAudio, so the "PA radio" treatment is a squelch layer we can mix: a
// key-up click and a short band-limited noise burst on voiceBus before each utterance, and a release click with a
// noise tail after it. Each host gets its own voice (HOSTS[id].speech.preferredVoiceNames, then any distinct English
// voice), pitch, and rate. Speech ducks music -8 dB and crowd -5 dB for its duration. When the platform exposes no
// voices, status reads "no_voice" and the setting is switched back off so the toggle never lies.

import type { Caption, HostId, HostProfile, SettingsStore } from "../contracts.ts";
import type { AudioEngine } from "../audio/audio-engine.ts";
import { click, noiseBurst, type SynthContext } from "../audio/synth.ts";
import { captionProsody, type HostSpeaker } from "./announcer.ts";
import { speechFor } from "../audio/prosody.ts";

export type HostVoiceStatus = "unsupported" | "loading" | "ready" | "no_voice";

export interface HostVoice extends HostSpeaker {
  readonly status: HostVoiceStatus;
  /** Voice names chosen per host (for the settings screen). */
  readonly voiceNames: Readonly<Record<HostId, string | null>>;
  dispose(): void;
}

type SpeechLike = Pick<SpeechSynthesis, "getVoices" | "speak" | "cancel"> & Partial<Pick<SpeechSynthesis, "addEventListener" | "removeEventListener">>;
type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export interface HostVoiceDeps {
  settings: SettingsStore;
  engine: AudioEngine | null;
  hosts: Readonly<Record<HostId, HostProfile>>;
  /** Injectable for tests; defaults to globalThis.speechSynthesis / SpeechSynthesisUtterance. */
  speech?: SpeechLike | null;
  Utterance?: UtteranceCtor | null;
  /** How long to wait for voiceschanged before declaring no voices (ms). */
  voiceWaitMs?: number;
}

/** Key-up: a crisp click and 80 ms of band-limited hiss, like a PA channel opening. */
export function renderSquelchIn(s: SynthContext, dest: AudioNode, t: number): number {
  click(s, dest, t, { gain: 0.35, highpass: 1800, lenS: 0.004, body: 1200 });
  return noiseBurst(s, dest, t + 0.004, { filter: "bandpass", freq: 2200, q: 1.1, gain: 0.12, attackS: 0.003, decayS: 0.08 });
}

/** Release: a softer click and a 150 ms noise tail. */
export function renderSquelchOut(s: SynthContext, dest: AudioNode, t: number): number {
  noiseBurst(s, dest, t, { filter: "bandpass", freq: 1800, q: 0.9, gain: 0.1, attackS: 0.002, decayS: 0.15 });
  return click(s, dest, t + 0.012, { gain: 0.22, highpass: 1500, lenS: 0.005, body: 800 });
}

/** Picks a voice per host: preferred names first, then distinct English voices so the hosts never share one. */
export function chooseVoices(voices: readonly SpeechSynthesisVoice[], hosts: Readonly<Record<HostId, HostProfile>>): Record<HostId, SpeechSynthesisVoice | null> {
  const out: Record<HostId, SpeechSynthesisVoice | null> = { rook: null, vale: null };
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length > 0 ? english : [...voices];
  const taken = new Set<SpeechSynthesisVoice>();
  for (const id of ["rook", "vale"] as const) {
    for (const name of hosts[id].speech.preferredVoiceNames) {
      const hit = pool.find((v) => !taken.has(v) && v.name.toLowerCase().includes(name.toLowerCase()));
      if (hit) { out[id] = hit; taken.add(hit); break; }
    }
  }
  for (const id of ["rook", "vale"] as const) {
    if (out[id]) continue;
    const local = pool.find((v) => !taken.has(v) && v.localService);
    const any = local ?? pool.find((v) => !taken.has(v)) ?? pool[0] ?? null;
    out[id] = any;
    if (any) taken.add(any);
  }
  return out;
}

export function createHostVoice(deps: HostVoiceDeps): HostVoice {
  const g = globalThis as { speechSynthesis?: SpeechLike; SpeechSynthesisUtterance?: UtteranceCtor };
  const speech = deps.speech === undefined ? (g.speechSynthesis ?? null) : deps.speech;
  const Utterance = deps.Utterance === undefined ? (g.SpeechSynthesisUtterance ?? null) : deps.Utterance;
  let status: HostVoiceStatus = speech && Utterance ? "loading" : "unsupported";
  let chosen: Record<HostId, SpeechSynthesisVoice | null> = { rook: null, vale: null };
  const names: Record<HostId, string | null> = { rook: null, vale: null };
  let speaking = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function refreshVoices(final: boolean): void {
    if (!speech) return;
    let voices: SpeechSynthesisVoice[] = [];
    try { voices = speech.getVoices(); } catch { voices = []; }
    if (voices.length > 0) {
      chosen = chooseVoices(voices, deps.hosts);
      names.rook = chosen.rook?.name ?? null;
      names.vale = chosen.vale?.name ?? null;
      status = "ready";
    } else if (final) {
      status = "no_voice";
      if (deps.settings.get().audio.hostVoice) deps.settings.set({ audio: { hostVoice: false } });
    }
  }

  const onVoicesChanged = () => refreshVoices(false);
  if (status === "loading") {
    refreshVoices(false);
    if (status === "loading") {
      speech?.addEventListener?.("voiceschanged", onVoicesChanged);
      timer = setTimeout(() => { timer = null; if (status === "loading") refreshVoices(true); }, deps.voiceWaitMs ?? 1500);
    }
  }
  const unsubscribe = deps.settings.subscribe(() => {
    const s = deps.settings.get().audio;
    if (s.hostVoice && (status === "no_voice" || status === "unsupported")) deps.settings.set({ audio: { hostVoice: false } });
    if (!s.hostVoice && speaking) voice.cancel(0);
  });

  const voice: HostVoice = {
    get status() { return status; },
    get voiceNames() { return names; },
    get enabled() { return status === "ready"; },

    speak(caption: Caption) {
      if (!speech || !Utterance || status !== "ready") return Promise.resolve();
      const profile = deps.hosts[caption.speaker];
      const audio = deps.settings.get().audio;
      const my = ++generation;
      const engine = deps.engine;
      engine?.playVoice("voice", 3, renderSquelchIn);
      engine?.duck("speech", null);
      speaking = true;
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (my === generation) {
            speaking = false;
            engine?.playVoice("voice", 3, renderSquelchOut);
            engine?.releaseDuck("speech");
          }
          resolve();
        };
        try {
          const u = new Utterance(caption.text);
          const v = chosen[caption.speaker];
          if (v) u.voice = v;
          // Prosody as data (bible 7): the caption's ramp and release set the utterance pitch and rate.
          const pro = captionProsody(caption);
          const sp = speechFor(profile.speech, pro.ramp, pro.release);
          u.pitch = sp.pitch;
          u.rate = sp.rate;
          u.volume = Math.max(0, Math.min(1, audio.voice * audio.master));
          u.onend = finish;
          u.onerror = finish;
          // The squelch opens first; speech starts right behind it.
          setTimeout(() => { if (my === generation) speech.speak(u); else finish(); }, 70);
        } catch {
          finish();
        }
      });
    },

    cancel(fadeMs) {
      generation++;
      if (!speech) return;
      const wasSpeaking = speaking;
      speaking = false;
      const stop = () => {
        try { speech.cancel(); } catch { /* engine gone */ }
      };
      if (fadeMs > 0) setTimeout(stop, fadeMs); else stop();
      if (wasSpeaking) {
        deps.engine?.playVoice("voice", 3, renderSquelchOut);
        deps.engine?.releaseDuck("speech");
      }
    },

    dispose() {
      unsubscribe();
      if (timer) clearTimeout(timer);
      speech?.removeEventListener?.("voiceschanged", onVoicesChanged);
      voice.cancel(0);
    },
  };
  return voice;
}
