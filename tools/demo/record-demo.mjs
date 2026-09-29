// tools/demo/record-demo.mjs
// Records a demo video of TORQUE LIMIT on this Mac's real GPU with Playwright + the installed Google Chrome.
// Audio is forced off (the app's settings, speech synthesis, and Chrome's --mute-audio): nothing plays aloud.
//
//   node tools/demo/record-demo.mjs [url] [outDir] [--headed]
//
// Output: <outDir>/demo.webm (1280x720). Convert to mp4 with ffmpeg where one is available:
//   ffmpeg -i demo.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart demo.mp4
import { chromium } from "/Users/aaroh/Downloads/monster/node_modules/playwright/index.mjs";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:3100";
const outDir = process.argv[3] || "/Users/aaroh/cadybot/wrestling_arena/tools/demo/out";
const headed = process.argv.includes("--headed");
mkdirSync(outDir, { recursive: true });

const W = 1280, H = 720;
const browser = await chromium.launch({
  channel: "chrome",
  headless: !headed,
  args: ["--mute-audio", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=metal", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: W, height: H } },
});
const page = await context.newPage();
await page.addInitScript(() => {
  try {
    const K = "torquelimit.settings.v2";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(K) || "{}"); } catch {}
    s.audio = { ...(s.audio || {}), master: 0, sfx: 0, music: 0, crowd: 0, voice: 0, hostVoice: false };
    // A returning pilot: no cockpit prompt, no tutorial, kit unlocked, and the fast show.
    s.profile = { ...(s.profile || {}), callsign: "PILOT", tutorialDone: true, cockpitChosen: true, matchesPlayed: 6 };
    localStorage.setItem(K, JSON.stringify(s));
  } catch {}
  if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const wait = (ms) => page.waitForTimeout(ms);
const phase = () => page.evaluate(() => globalThis.__tl?.director?.phase ?? "?");

await page.goto(url, { waitUntil: "load" });
await wait(9000);
log("renderer:", await page.evaluate(() => { const c = document.querySelector("canvas"); const g = c && (c.getContext("webgl2") || c.getContext("webgl")); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "n/a"; }));
log("title phase:", await phase());
await wait(4000);                       // hold on the title attract match

await page.keyboard.press("Enter");     // leave the title
await wait(1800);
if ((await phase()) === "cockpit_choice") {
  const std = page.locator("button, [role=button]").filter({ hasText: /STANDARD/i }).first();
  if (await std.count()) await std.click();
  await wait(1500);
}
log("phase:", await phase());
await wait(2500);                       // green room beat

// Start a real Arcade fight against OVERSHOOT (Contender) through the dev config builders; the green
// room's own FIGHT row is the fallback (Enter selects it, then a trusted click on its box).
const startedViaApi = await page.evaluate(async () => {
  const w = globalThis;
  if (!w.__tl || !w.__tlConfig) return false;
  try {
    const cfg = w.__tlConfig.quickFightConfig({
      opponent: { kind: "builtin", personality: "overshoot", tier: "contender", dda: true },
      loadout: "pivot", preset: "arcade", seed: 4242, settings: w.__tl.settings.get(), bestOf: 1,
    });
    await w.__tl.director.startMatch(cfg);
    return true;
  } catch (e) { console.warn("startMatch failed", e); return false; }
});
if (!startedViaApi) await page.keyboard.press("Enter");
await wait(1500);
if ((await phase()) === "green_room") {
  const box = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "FIGHT" && e.getBoundingClientRect().width > 0);
    const el = leaf && (leaf.closest("button,[role=button],li,a") || leaf);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (box) await page.mouse.click(box.x, box.y);
  await wait(1500);
}
for (let i = 0; i < 20 && (await phase()) === "green_room"; i++) await wait(500);
log("after FIGHT:", await phase());

// Wait for control (the intro overlays are gone once the phase is "fight"), then click the arena for pointer lock.
for (let i = 0; i < 60 && (await phase()) !== "fight"; i++) await wait(500);
log("fight phase:", await phase());
await page.mouse.click(W / 2, H / 2);
await wait(300);
const cx = W / 2, cy = H / 2 + 40;
async function flick(dx, dy, steps = 6) {
  await page.mouse.move(cx, cy);
  await page.mouse.move(cx + dx, cy + dy, { steps });
  await page.mouse.move(cx, cy, { steps: 10 });
}
const start = Date.now();
let beat = 0;
while (Date.now() - start < 42000 && (await phase()) === "fight") {
  const k = beat++ % 8;
  if (k === 0) await flick(260, -40);
  else if (k === 1) await flick(-240, 30);
  else if (k === 2) { await page.mouse.down(); await wait(120); await page.mouse.up(); }            // jab
  else if (k === 3) { await page.mouse.down(); await wait(700); await flick(220, -60, 4); await page.mouse.up(); } // charged heavy
  else if (k === 4) { await page.mouse.down({ button: "right" }); await wait(900); await page.mouse.up({ button: "right" }); } // guard
  else if (k === 5) { await page.keyboard.down("KeyW"); await flick(200, -30); await page.keyboard.up("KeyW"); }
  else if (k === 6) { await page.keyboard.down("Space"); await flick(-120, 60, 8); await wait(400); await page.keyboard.up("Space"); }
  else await flick(300, 0, 4);
  await wait(650);
}
log("end of play phase:", await phase());
// Keep fighting until the round resolves, then hold on the outro and the post-match screen.
const ENDS = new Set(["ko", "lock", "time_up", "sudden_death", "outro", "post_match", "round_end"]);
for (let i = 0; i < 90 && !ENDS.has(await phase()); i++) { await flick(i % 2 ? 260 : -240, -30); await wait(700); }
log("resolution phase:", await phase());
for (let i = 0; i < 40 && (await phase()) !== "post_match"; i++) await wait(500);
await wait(6000);
log("final phase:", await phase());

await context.close();
await browser.close();
const files = readdirSync(outDir).filter((f) => f.endsWith(".webm")).sort();
const latest = files[files.length - 1];
if (latest && latest !== "demo.webm") renameSync(join(outDir, latest), join(outDir, "demo.webm"));
log("wrote", join(outDir, "demo.webm"));
