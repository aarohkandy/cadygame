// scripts/demo-capture.mjs (WP6)
// The 60-second demo, rendered from one episode and never from a live take (EMOTION_BIBLE 12.2). Replays a chosen
// episode through the game's own replay player at 1280 × 720, records the canvas with captureStream(60) +
// MediaRecorder in the page (muted: the app's audio settings are zeroed and Chrome runs --mute-audio, so nothing
// plays out loud), one file per shot, and emits the cut list on the music grid (104 BPM, a bar is 2.3077 s) plus
// the ffmpeg lines that concat the shots and mux WP8's mixdown under them.
//
//   node scripts/demo-capture.mjs <episode.tlep.json> [--url http://localhost:3100] [--out tools/demo/out/capture]
//                                [--cut v0|v1] [--headed]
//
// v0 (this week): shots 2, 4, 6, 9, 10: the boot ritual (a live intro, cockpit), the first hit, the dock, the KO,
// the KO from the orbit camera. Every replay shot runs through the replay viewer, whose camera is the orbit; the
// cockpit replay camera lands with WP3, and until then shots 4/6/9 read "orbit" in cuts.json.
// Precondition (12.2): 12.1 item 1 passes on the real GPU; a demo with the hitch in it is not a demo.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "/Users/aaroh/Downloads/monster/node_modules/playwright/index.mjs";

export const BPM = 104;
export const BAR_S = 60 / BPM * 4;      // 2.3077 s
export const W = 1280, H = 720, FPS = 60;

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const episodePath = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--headed"));
const url = flag("--url", "http://localhost:3100");
const outDir = resolve(flag("--out", "tools/demo/out/capture"));
const cut = flag("--cut", "v0");
const headed = args.includes("--headed");
if (!episodePath) { console.error("usage: node scripts/demo-capture.mjs <episode.tlep.json> [--url] [--out] [--cut v0|v1]"); process.exit(2); }

/* ───────────────────────── the take: POTG moments out of the episode's events ───────────────────────── */

export function humanSeatOf(meta) {
  return ["atlas", "blaze"].find((s) => meta.seats?.[s]?.driver === "human") ?? "atlas";
}

/** The moments 12.2 needs, in sim seconds; null where the episode has none. */
export function moments(episode) {
  const me = humanSeatOf(episode.meta);
  const ev = episode.events ?? [];
  const strikes = ev.filter((e) => e.type === "strike" && e.tier === "strike" && e.attacker === me && !e.guarded);
  const firstHit = strikes[0]?.t ?? null;
  const dock = ev.find((e) => e.type === "core" && e.stage === "lock" && e.seat === me)?.t
    ?? ev.find((e) => e.type === "core" && e.stage === "lock_in_start" && e.seat === me)?.t ?? null;
  const ko = ev.find((e) => e.type === "ko" && e.attacker === me)?.t ?? null;
  const block = ev.find((e) => e.type === "strike" && e.victim === me && e.guarded)?.t ?? ev.find((e) => e.type === "deflect" && e.defender === me)?.t ?? null;
  const steal = ev.find((e) => e.type === "core" && e.stage === "steal")?.t ?? null;
  let hardest = null;
  for (const s of strikes) if (!hardest || s.magnitude > hardest.magnitude) hardest = s;
  // POTG weight (8.3): contact speed × (1 + guard-up at impact) × (1.5 if within 2 s of round end).
  const roundEnds = ev.filter((e) => e.type === "round_end").map((e) => e.t);
  const potg = strikes.map((s) => ({ t: s.t, w: s.vN * (1 + (s.guarded ? 1 : 0)) * (roundEnds.some((r) => r - s.t <= 2 && r >= s.t) ? 1.5 : 1) }))
    .sort((a, b) => b.w - a.w)[0]?.t ?? null;
  return { firstHit, block, dock, steal, ko, hardest: hardest?.t ?? null, potg };
}

/** Shots on the bar grid. `live` shots start a fresh match; `replay` shots seek the replay player. */
export function cutList(m, which) {
  const bars = (n) => Math.round(n * BAR_S * 1000) / 1000;
  const v0 = [
    { n: 2, bars: 1, source: "live", camera: "cockpit", from: 0, note: "boot ritual: six LEDs base→gripper, the flash to LOWERED" },
    { n: 4, bars: 1.4, source: "replay", camera: "orbit", at: m.firstHit, lead: 0.6, note: "first flick lands: freeze, sparks, receipt" },
    { n: 6, bars: 2, source: "replay", camera: "orbit", at: m.block ?? m.hardest, lead: 1.2, note: "SLAM tell, BLOCKED, OPEN, punish" },
    { n: 9, bars: 4, source: "replay", camera: "orbit", at: m.ko ?? m.potg, lead: 4.0, note: "near-KO, the heavy hook, KO" },
    { n: 10, bars: 2, source: "replay", camera: "orbit", at: m.ko ?? m.potg, lead: 1.5, rate: 0.5, note: "KO instant replay, cube off the deck" },
  ];
  const v1 = [
    { n: 1, bars: 1, source: "replay", camera: "orbit", at: m.ko ?? m.potg, lead: 0.3, rate: 0.25, note: "cold open on the KO" },
    ...v0,
    { n: 7, bars: 3, source: "replay", camera: "orbit", at: m.dock, lead: 5, note: "Core drops, grab, carry, dock, siren" },
    { n: 8, bars: 3, source: "replay", camera: "orbit", at: m.steal, lead: 2, note: "the steal at 2 s left, pried back, LOCKED" },
  ].sort((a, b) => a.n - b.n);
  const list = (which === "v1" ? v1 : v0).filter((s) => s.source === "live" || s.at !== null);
  let t = 0;
  return list.map((s) => { const out = { ...s, startS: t, lengthS: bars(s.bars) }; t += out.lengthS; return out; });
}

/* ───────────────────────── capture ───────────────────────── */

const episodeText = readFileSync(episodePath, "utf8");
const episode = JSON.parse(episodeText);
const shots = cutList(moments(episode), cut);
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  channel: "chrome", headless: !headed,
  args: ["--mute-audio", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=metal", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  try {
    const K = "torquelimit.settings.v2";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(K) || "{}"); } catch { /* fresh */ }
    s.audio = { ...(s.audio || {}), master: 0, sfx: 0, music: 0, crowd: 0, voice: 0, hostVoice: false };
    s.profile = { ...(s.profile || {}), callsign: "PILOT", cockpitChosen: true, matchesPlayed: 6 };
    localStorage.setItem(K, JSON.stringify(s));
  } catch { /* storage blocked: Chrome is muted anyway */ }
  if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
});
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => globalThis.__tl && globalThis.__tl.ui.get().loading === null, null, { timeout: 120_000 });
log("booted; renderer:", await page.evaluate(() => { const g = globalThis.__tlR3F?.gl?.getContext?.(); const d = g?.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "n/a"; }));

/** Records the canvas for `seconds` at 60 fps and returns the WebM bytes (base64) from the page. */
async function record(seconds) {
  return page.evaluate(async (s) => {
    const canvas = globalThis.__tl.view.canvas;
    const stream = canvas.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start(100);
    await new Promise((r) => setTimeout(r, s * 1000));
    rec.stop();
    await done;
    for (const t of stream.getTracks()) t.stop();
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let bin = ""; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, seconds);
}

const id = await page.evaluate(async (text) => globalThis.__tl.harness.store.importFile(new Blob([text], { type: "application/json" })), episodeText);
log("episode imported:", id);
const files = [];
for (const shot of shots) {
  const file = join(outDir, `shot-${String(shot.n).padStart(2, "0")}.webm`);
  if (shot.source === "live") {
    await page.evaluate(() => {
      const tl = globalThis.__tl;
      const cfg = globalThis.__tlConfig.nextMatchConfig(7, tl.settings.get(), { w: 3, l: 0 }, new Date());
      return tl.director.startMatch(cfg);
    });
    await page.waitForFunction(() => globalThis.__tl.director.phase === "boot_ritual", null, { timeout: 15_000 });
  } else {
    await page.evaluate(async ({ id: epId, t, rate }) => {
      const tl = globalThis.__tl;
      if (tl.director.phase !== "replay_viewer") await tl.director.openReplay(epId);
      tl.replay.setRate(rate);
      tl.replay.seek(Math.max(0, t));
      tl.replay.play();
    }, { id, t: shot.at - shot.lead, rate: shot.rate ?? 1 });
  }
  const b64 = await record(shot.lengthS);
  writeFileSync(file, Buffer.from(b64, "base64"));
  files.push(file);
  log(`shot ${shot.n}: ${shot.lengthS.toFixed(2)} s → ${file}`);
  if (shot.source === "live") await page.evaluate(() => globalThis.__tl.director.enterTitle());
}
await browser.close();

const cuts = { bpm: BPM, barS: BAR_S, episode: resolve(episodePath), shots: shots.map((s, i) => ({ ...s, file: files[i] })) };
writeFileSync(join(outDir, "cuts.json"), JSON.stringify(cuts, null, 2));
writeFileSync(join(outDir, "concat.txt"), files.map((f) => `file '${f}'`).join("\n") + "\n");
log("cut list:", join(outDir, "cuts.json"));
console.log([
  "# on homebase (ffmpeg): concat the shots, then mux WP8's mixdown from the same episode",
  `ffmpeg -f concat -safe 0 -i ${join(outDir, "concat.txt")} -c:v libx264 -r 60 -pix_fmt yuv420p ${join(outDir, "demo-video.mp4")}`,
  `node tools/export/mixdown.mjs ${resolve(episodePath)} --cuts ${join(outDir, "cuts.json")} -o ${join(outDir, "demo-audio.wav")}`,
  `ffmpeg -i ${join(outDir, "demo-video.mp4")} -i ${join(outDir, "demo-audio.wav")} -c:v copy -c:a aac -shortest -movflags +faststart ${join(outDir, "demo.mp4")}`,
].join("\n"));
