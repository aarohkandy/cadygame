// src/game/ui/screens/register-entrant.tsx (WP6)
// Register Entrant (7.3.4, 5.6; EMOTION_BIBLE 8.3 challenge files): reads a dropped .js/.mjs module, a .json
// trajectory, or a friend's shared episode (.tl / .tlep.json, share scope only: the recorded arm's ctrl becomes a
// trajectory under their callsign), hashes it in the app, runs WP4's registration checks, and animates one row per
// 120 ms, each landing with a stamp. A failure stamps hazard stripes and the fixture index; a pass stamps
// REGISTERED, shows the cold act separately, and saves the entrant to IndexedDB.
"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import type { DriverSpec, EntrantRecord, GameHandle, RegistrationResult, RegistrationRow } from "../../contracts.ts";
import { EPISODE_FILE_EXTENSION, decodeEpisodeText } from "../../harness/episode-format.ts";
import { SEP, formatMs, shortSha } from "../hud/format.ts";
import { Glyph } from "../kit/glyphs.tsx";
import { SlantButton, useUiCue } from "../kit/slant-button.tsx";
import { Stamp } from "../kit/stamp.tsx";

export const ROW_REVEAL_MS = 120;
export const CHALLENGE_EXTENSION = ".tl";
export const ENTRANT_EXTENSIONS: readonly string[] = [".js", ".mjs", ".json", CHALLENGE_EXTENSION, EPISODE_FILE_EXTENSION];
/** The trajectory parser's frame cap (policy/trajectory.ts). */
const TRAJECTORY_MAX_FRAMES = 100_000;

export function isChallengeFile(fileName: string): boolean {
  const n = fileName.toLowerCase();
  return n.endsWith(CHALLENGE_EXTENSION) || n.endsWith(EPISODE_FILE_EXTENSION);
}

/**
 * A challenge file → the recorded human arm as a `{ fps, frames }` trajectory under the pilot's callsign (8.3).
 * Only a file that carries share consent is accepted; the ctrl stream is sampled once per control tick from the
 * run-length recording. Throws with an uppercase reason for the register panel.
 */
export function challengeTrajectory(text: string): { name: string; json: string } {
  const ep = decodeEpisodeText(text);
  const consent = (ep.meta as { session?: { consent?: { scope?: string } } }).session?.consent;
  if (consent?.scope !== "share") throw new Error("NOT SHARED · THE FILE CARRIES NO SHARE CONSENT");
  const seat = (["atlas", "blaze"] as const).find((s) => ep.meta.seats[s].driver === "human");
  if (!seat) throw new Error("NO PILOT IN THIS EPISODE");
  const { steps, values, width } = ep.steps.ctrl;
  if (steps.length === 0 || width < 12) throw new Error("NO RECORDED CONTROL");
  const perTick = Math.max(1, Math.round(1 / (ep.meta.timestep * ep.meta.controlHz)));
  const offset = seat === "atlas" ? 0 : 6;
  const lastStep = steps[steps.length - 1];
  const ticks = Math.min(TRAJECTORY_MAX_FRAMES, Math.floor(lastStep / perTick) + 1);
  const frames: number[][] = [];
  let i = 0;
  for (let k = 0; k < ticks; k++) {
    const step = k * perTick;
    while (i + 1 < steps.length && steps[i + 1] <= step) i++;
    const row: number[] = [];
    for (let j = 0; j < 6; j++) row.push(Number(values[i * width + offset + j]));
    frames.push(row);
  }
  const name = (ep.meta.seats[seat].name || "PILOT").toUpperCase().slice(0, 24);
  return { name, json: JSON.stringify({ fps: ep.meta.controlHz, frames }) };
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function entrantKindOf(fileName: string): "module" | "trajectory" | null {
  const n = fileName.toLowerCase();
  if (n.endsWith(".json")) return "trajectory";
  if (n.endsWith(".js") || n.endsWith(".mjs")) return "module";
  return null;
}

type Phase = "reading" | "checking" | "passed" | "failed" | "error";

export function RegisterEntrant(props: {
  game: GameHandle; file: File; onClose: () => void; onRegistered: (rec: EntrantRecord, fight: boolean) => void;
}): JSX.Element {
  const { game, file } = props;
  const play = useUiCue();
  const [phase, setPhase] = useState<Phase>("reading");
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<EntrantRecord | null>(null);
  const queue = useRef<RegistrationRow[]>([]);
  const finished = useRef<RegistrationResult | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let timer = 0;
    let live = true;

    // Reveal queued rows at the checklist pace; settle once the last row has landed.
    const pump = () => {
      const next = queue.current.shift();
      if (next) {
        setRows((r) => [...r, next]);
        play(next.status === "fail" ? "back" : "stamp");
      } else if (finished.current) {
        const res = finished.current;
        finished.current = null;
        setResult(res);
        setPhase(res.ok ? "passed" : "failed");
        play(res.ok ? "sticker" : "back");
        return;
      }
      timer = window.setTimeout(pump, ROW_REVEAL_MS);
    };

    (async () => {
      try {
        const challenge = isChallengeFile(file.name);
        const kind = challenge ? "trajectory" : entrantKindOf(file.name);
        if (!kind) throw new Error(`UNSUPPORTED FILE${SEP}USE ${ENTRANT_EXTENSIONS.join(" ")}`);
        const text = await file.text();
        // A challenge file fights under the friend's callsign: the plate reads their name, not the file's.
        const arm = challenge ? challengeTrajectory(text) : null;
        const source = arm ? arm.json : text;
        const fileName = arm ? arm.name : file.name;
        const sha = await sha256Hex(source);
        if (!live) return;
        setPhase("checking");
        timer = window.setTimeout(pump, ROW_REVEAL_MS);
        const spec: Extract<DriverSpec, { kind: "module" } | { kind: "trajectory" }> = kind === "module"
          ? { kind: "module", fileName, source, sha256: sha }
          : { kind: "trajectory", fileName, json: source, sha256: sha };
        const res = await game.runRegistration(spec, (row) => { queue.current.push(row); }, abort.signal);
        if (!live) return;
        if (res.ok) {
          const rec = await game.harness.entrants.save({ kind, fileName, name: arm ? arm.name : res.name || file.name, source, sha256: sha });
          if (live) setSaved(rec);
        }
        finished.current = res;
      } catch (err) {
        if (!live) return;
        window.clearTimeout(timer);
        setPhase("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => { live = false; abort.abort(); window.clearTimeout(timer); };
  }, [file, game, play]);

  const failedRow = rows.find((r) => r.status === "fail") ?? null;
  const done = phase === "passed" || phase === "failed" || phase === "error";

  return (
    <div className="reg" role="dialog" aria-modal="true" aria-label="REGISTER ENTRANT">
      <div className="reg__panel tl-anim-slide-up">
        <header className="reg__head">
          <div className="tl-plate tl-plate--lip-signal t-plate">REGISTER ENTRANT</div>
          <span className="t-mono reg__file">{file.name}</span>
        </header>

        <ol className="reg__rows">
          {rows.map((r) => (
            <li key={r.id} className="reg__row tl-anim-slide-l" data-status={r.status}>
              <span className="reg__mark" aria-hidden="true">
                <Glyph name={r.status === "pass" ? "check" : r.status === "warn" ? "warn" : "cross"} />
              </span>
              <span className="t-plate reg__label">{r.label}</span>
              <span className="t-mono reg__detail">
                {r.detail ?? ""}{r.fixtureIndex !== null ? `${r.detail ? SEP : ""}FIXTURE ${r.fixtureIndex}` : ""}
              </span>
              <span className="reg__stamp">
                <Stamp tone={r.status === "fail" ? "fault" : r.status === "warn" ? "paper" : "ink"} size="s" animate>
                  {r.status === "pass" ? "PASS" : r.status === "warn" ? "WARN" : "FAIL"}
                </Stamp>
              </span>
            </li>
          ))}
          {phase === "reading" || phase === "checking" ? (
            <li className="reg__row reg__row--pending" aria-live="polite"><span className="t-label">{phase === "reading" ? "READING FILE" : "RUNNING CHECKS"}</span></li>
          ) : null}
        </ol>

        {phase === "passed" && result ? (
          <div className="reg__verdict">
            <Stamp tone="signal" size="l" animate>REGISTERED</Stamp>
            <dl className="reg__facts">
              <div><dt className="t-label">NAME</dt><dd className="t-plate">{result.name || file.name}</dd></div>
              <div><dt className="t-label">COLD ACT</dt><dd className="t-mono">{formatMs(result.coldActMs)}</dd></div>
              <div><dt className="t-label">P99 ACT</dt><dd className="t-mono">{formatMs(result.p99ActMs)}</dd></div>
              <div><dt className="t-label">DETERMINISTIC</dt><dd className="t-mono">{result.deterministic ? "YES" : "NO"}</dd></div>
              <div><dt className="t-label">SHA</dt><dd className="t-mono">{shortSha(result.sha256)}</dd></div>
            </dl>
          </div>
        ) : null}
        {phase === "failed" ? (
          <div className="reg__verdict reg__verdict--fail">
            <Stamp tone="fault" size="l" animate>
              {failedRow?.fixtureIndex !== null && failedRow?.fixtureIndex !== undefined ? `FAILED AT FIXTURE ${failedRow.fixtureIndex}` : "FAILED"}
            </Stamp>
            {failedRow ? <p className="t-mono reg__why">{failedRow.label}{failedRow.detail ? `${SEP}${failedRow.detail}` : ""}</p> : null}
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="reg__verdict reg__verdict--fail">
            <Stamp tone="fault" size="m" animate>NOT REGISTERED</Stamp>
            <p className="t-mono reg__why">{message}</p>
          </div>
        ) : null}

        <footer className="reg__actions">
          {phase === "passed" && saved ? (
            <>
              <SlantButton label="FIGHT IT" variant="primary" size="md" autoFocus onClick={() => props.onRegistered(saved, true)} />
              <SlantButton label="DONE" size="md" onClick={() => props.onRegistered(saved, false)} />
            </>
          ) : (
            <SlantButton label={done ? "CLOSE" : "CANCEL"} size="md" cue="back" autoFocus={done} onClick={props.onClose} />
          )}
        </footer>
      </div>
    </div>
  );
}
