// src/game/ui/screens/clip-recorder.ts (WP6)
// The auto-clip (EMOTION_BIBLE 8.3): during the earned `match_replay` (already rendered, orbit camera) the canvas is
// recorded with captureStream(30) + MediaRecorder (WebM in Chrome, MP4 in Safari), the wordmark and bout number
// burned in bottom-left by compositing onto a second canvas. No rolling recording: the recorder starts on the
// replay phase and stops on the next phase. The verdict's SAVE CLIP downloads it; navigator.share({ files }) on
// mobile. game-root.tsx drives it from the UI store; nothing here touches audio.

export const CLIP_FPS = 30;
export const CLIP_BITRATE = 2_500_000;   // ≈ 2–4 MB for a 3.5 s replay at 1280 × 720 (acceptance: 2–4 MB WebM)

export interface Clip { blob: Blob; mime: string; ext: "webm" | "mp4"; boutNumber: number; ms: number }

/** The best container the browser can record; null when MediaRecorder is missing (the SAVE CLIP button hides). */
export function clipMime(): { mime: string; ext: "webm" | "mp4" } | null {
  const mr = (globalThis as { MediaRecorder?: { isTypeSupported?(t: string): boolean } }).MediaRecorder;
  if (!mr?.isTypeSupported) return null;
  for (const c of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (mr.isTypeSupported(c)) return { mime: c, ext: "webm" };
  for (const c of ["video/mp4;codecs=avc1", "video/mp4"]) if (mr.isTypeSupported(c)) return { mime: c, ext: "mp4" };
  return null;
}

export interface ClipRecorder {
  /** Resolves with the clip once stopped; null when recording could not start. */
  stop(): Promise<Clip | null>;
}

/** Starts recording `source` through a burn-in canvas. Returns null when the browser cannot record. */
export function startClip(source: HTMLCanvasElement, opts: { boutNumber: number; wordmark: string }): ClipRecorder | null {
  const kind = clipMime();
  if (!kind || typeof source.captureStream !== "function") return null;
  const burn = document.createElement("canvas");
  burn.width = source.width;
  burn.height = source.height;
  const ctx = burn.getContext("2d");
  if (!ctx) return null;
  const started = performance.now();
  let raf = 0;
  const draw = () => {
    ctx.drawImage(source, 0, 0, burn.width, burn.height);
    const h = Math.round(burn.height * 0.032);
    ctx.font = `700 ${h}px Anton, Impact, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(h * 0.6, burn.height - h * 2.2, ctx.measureText(opts.wordmark).width + h * 1.2, h * 1.6);
    ctx.fillStyle = "#F6F3EC";
    ctx.fillText(opts.wordmark, h * 1.2, burn.height - h);
    ctx.font = `${Math.round(h * 0.7)}px "Chivo Mono", monospace`;
    ctx.fillText(`#${String(opts.boutNumber).padStart(4, "0")}`, h * 1.2 + ctx.measureText(opts.wordmark).width * 1.7, burn.height - h);
    raf = requestAnimationFrame(draw);
  };
  const stream = burn.captureStream(CLIP_FPS);
  const chunks: Blob[] = [];
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType: kind.mime, videoBitsPerSecond: CLIP_BITRATE });
  } catch {
    return null;
  }
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start(250);
  raf = requestAnimationFrame(draw);
  return {
    stop() {
      return new Promise<Clip | null>((resolve) => {
        cancelAnimationFrame(raf);
        rec.onstop = () => {
          for (const t of stream.getTracks()) t.stop();
          if (chunks.length === 0) { resolve(null); return; }
          resolve({ blob: new Blob(chunks, { type: kind.mime }), mime: kind.mime, ext: kind.ext, boutNumber: opts.boutNumber, ms: performance.now() - started });
        };
        if (rec.state === "inactive") rec.onstop(new Event("stop")); else rec.stop();
      });
    },
  };
}

/** The last clip of the session, read by the verdict's SAVE CLIP. */
export const lastClip: { clip: Clip | null; pending: Promise<Clip | null> | null } = { clip: null, pending: null };

export function clipFileName(clip: Clip): string {
  return `torque-limit-${String(clip.boutNumber).padStart(4, "0")}.${clip.ext}`;
}

/** Saves the clip: the share sheet on devices that take files, a download everywhere else. */
export async function saveClip(clip: Clip): Promise<"shared" | "saved"> {
  const file = new File([clip.blob], clipFileName(clip), { type: clip.mime });
  const nav = navigator as Navigator & { canShare?(d: { files: File[] }): boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: "TORQUE LIMIT" }); return "shared"; } catch { /* dismissed: fall through to the download */ }
  }
  const url = URL.createObjectURL(clip.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
