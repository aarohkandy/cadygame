export const meta = {
  name: 'duel-finish',
  description: 'Finish the remaining areas, wire every handoff, get the tree green, and make the game ready to play on localhost',
  phases: [
    { title: 'Finish', detail: 'visuals, core bugs, packaging and handoff wiring in parallel' },
    { title: 'Ship', detail: 'green tree, final screenshots, localhost readiness' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel).
Binding docs, in precedence order: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Style guide: ${D}/research/finals-visual.md. Known bugs and shot list: ${D}/screens/INDEX.md.
STATE: the game boots and plays end to end. Typecheck is clean. Audio, hosts, feedback, HUD, screens and a new touch layer were just rebuilt by other agents. The director now wants everything finished and the game running on localhost for them to play.

OTHER AGENTS ARE EDITING THE SAME TREE IN PARALLEL. Edit ONLY the files your area owns. Never touch another area's file, not even one import line; put the request in your handoff instead.

WHERE WORK RUNS. The director's laptop must stay free.
- Edit files ONLY on the laptop at ${REPO} (the source of truth).
- Push before running anything remotely: bash ${REPO}/.claude/sync-now.sh (about 9 s).
- Heavy commands run on homebase: ${SSH} 'cd ~/work/torque-limit && ...'. Start anything slow DETACHED and poll it, e.g. ${SSH} 'cd ~/work/torque-limit && nohup npm test > /tmp/<you>.log 2>&1 & echo started' then poll with tail. A tool call that blocks more than about 3 minutes gets your agent killed.
- Never create files inside ~/work/torque-limit on the server (the mirror deletes them): helpers go in ~/tl-tools/, outputs in /tmp.
- Never edit files on the server, never commit, never switch branches, never run "box down", never disturb other tmux sessions, containers or ~/data. Server disk is 93% full.
RENDERING IS SCARCE: the box has 8 vCPU and renders in software. Check ${SSH} 'uptime' first and wait if the 1-minute load is above 12. One headless run at a time, 1280x720, only when you need a picture.
BROWSER: NEVER open a browser on the laptop. Do NOT call preview_start, navigate or any mcp__Claude_Browser__* tool. Headless tools live in ~/tl-tools/ (shot.mjs, tlboot.mjs, moments.mjs, lab.mjs); read before writing more.
SILENCE: nothing may ever play audio out loud. Verify audio only offline (OfflineAudioContext, renderAudioReport(), unit tests).
RULES: do not commit, push or switch branches. No placeholders, no dead buttons. Keep typecheck, lint and the full test suite green on the server before you finish; fix root causes, never weaken a test.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation.
RESUME-AWARE: an earlier attempt at your area may have been interrupted mid-flight. Read the files you own first and continue from there rather than starting over.`

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    changed: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
    handoff: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'changed', 'verified', 'remaining', 'handoff'],
}

async function robust(prompt, opts, tries) {
  for (let i = 1; i <= (tries || 4); i++) {
    try {
      const r = await agent(prompt + (i > 1 ? `\n(Attempt ${i}; the previous attempt was interrupted. Continue from the current files.)` : ''),
        { ...opts, label: opts.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${opts.label} attempt ${i}: ${String(e).slice(0, 130)}`) }
  }
  return { status: 'blocked', changed: [], verified: [], remaining: ['failed after retries'], handoff: [] }
}

const AREAS = [
  {
    key: 'visuals', label: 'A-visuals',
    own: 'src/game/render/** (all of it, including vfx/) and tests/interpolate.test.mjs, tests/camera-math.test.mjs, tests/reticle-projection.test.mjs, tests/vfx-pools.test.mjs, tests/derez-timeline.test.mjs, tests/stl-geometry.test.mjs, tests/deck-texture-layout.test.mjs, tests/crowd-instancing.test.mjs',
    task: `AREA A - VISUALS (an earlier attempt was interrupted; continue it).
The director looked at ${D}/screens/s12-fpv-strike-landing.png and said the in-match view does not look like a 2026 AAA game: the background behind the arena is a blown-out near-white void with no depth or back wall, lighting is flat with no rim separation, the holographic crowd is crude repeated billboards, and robot materials are plain.
Finish that work: a bounded televised arena with back walls, depth haze and vignette; stage lighting with team-coloured rims separating the arms from the background; a crowd with depth, variety and hype-driven reaction; richer robot materials, deck art and decals; stronger strike VFX. Follow ${D}/research/finals-visual.md and SCOPE 1.3 (palette, bloom on emissives only, grey-card exposure so nothing blows out).
Also yours, from other agents' handoffs: the lobby's 3D menu slabs (FIGHT / ENTRANTS / LOADOUT / THE LAB / REPLAYS / SETTINGS props) overlap the blue arm and duplicate the DOM menu - restage them as set dressing that reads as a green room, not a second menu.
Keep the perf design (instancing, no per-frame allocation, effects switched by uniform, quality tiers). Report draw calls and triangles per frame before and after; do not regress them. Prove the result by rendering on the server and opening the PNG with the Read tool; save ${D}/screens/polish-visuals-after.png.`,
  },
  {
    key: 'core', label: 'C-core-bugs',
    own: 'src/game/{loop,match,harness,policy,physics,combat,input,camera,kinematics}/**, src/game/game-handle.ts, src/game/core/**, src/game/contracts.ts, scripts/**, tools/**, and every test file not owned by another area',
    task: `AREA C - CORE BUGS AND WIRING (an earlier attempt was interrupted; continue it).
1. HIGHEST PRIORITY, still open: pausing a turbo match permanently cripples it. Measured on the server with director.pause() then director.resume() (the shipped path, which the visibility-change hook also calls when the tab is hidden): before the pause the sim ran about 5x real time (+29.2 s sim per 6 s wall); afterwards +0.08 s per 6 s wall and it never recovers. A player who switches windows returns to a dead match. Find the root cause (clock accumulator, timeScale, turbo/external-drive state, catch-up cap in the sim driver), fix it, and add a regression test that pauses and resumes a turbo match and asserts the rate recovers.
2. Wire the leftovers: WP1's displayLatencyMs, the provenance hashes (call buildProvenanceSource from src/game/harness/provenance.ts inside createGame), and a contract hook letting the loadout picker retune the lobby arm's servos live (document the API in your handoff so the UI area can call it).
3. From the HUD area's handoff: the stats overlay has no gamepad binding. src/game/input/gamepad.ts binds PAD.VIEW to "optics" and nothing ever calls consumeUi("stats"). Give the stats overlay a real binding and make the action reachable.
4. From the feedback area's handoff: in src/game/camera/juice.ts, planFeedback sets vibration before the graze/guarded early-break, so a guarded hit gets a freeze and victim vibration but no camera response. Decide the correct behaviour and make it consistent.
5. Built-in opponents are held to the user-model reliability bar and trip "7 TABLE HITS" at Contender. Implement the honest fix and explain it.
6. Make tests/opponent-behavior.test.mjs robust to CPU contention (it timed out at 170 s when a headless Chromium and a build shared the 8 cores) without weakening what it proves.
7. Finish with the full suite, typecheck, lint, eval smoke and a production build on the server; report the numbers.`,
  },
  {
    key: 'packaging', label: 'D-packaging',
    own: 'package.json, package-lock.json, next.config.ts, .gitignore, public/manifest.webmanifest, public/icons/**, public/sw.js, src/app/pwa-register.tsx, src/app/layout.tsx, electron/**, capacitor.config.ts, docs/APPS.md, and scripts/app-*.mjs',
    task: `AREA D - PACKAGING AND APP SHELL (an earlier attempt was interrupted; continue it). Deliver SCOPE.md section 4: four ship targets from one codebase.
1. WEB: a production static export that runs from any static host; verify on the server by building, serving the output on a spare port and loading it headless.
2. PWA: manifest, maskable icons, theme colour, and a service worker precaching the app shell plus mujoco.wasm, models and fonts so it works offline after first load and is installable. Verify offline boot headlessly on the server.
3. DESKTOP: Electron wrapper loading the static export from disk with contextIsolation on, nodeIntegration off, no remote module, strict CSP, pointer lock and gamepad working; scripts "app:dev" and "app:mac" producing an unsigned arm64 .app/.dmg into a gitignored directory. Keep the local install under about 500 MB. Do not run a long mac build yourself; make it one command the director can run.
4. MOBILE: Capacitor config plus docs/APPS.md with exact instructions. Install no Xcode, Android Studio, Android SDK or Rust anywhere.
You also own src/app/layout.tsx, so land these two handoffs from other areas: add 'import "./mobile.css";' immediately after the globals.css import (the touch area created that file), and make sure the PWA registration component is actually mounted.
docs/APPS.md must be accurate: every command in it either actually run by you, or explicitly marked as not yet run and why.`,
  },
  {
    key: 'wiring', label: 'K-wiring',
    own: 'src/game/ui/broadcast-ui.tsx, src/game/ui/hud/** and src/game/ui/screens/** ONLY for mounting and import changes named below, plus tests/touch-layout.test.mjs and tests/touch-input.test.mjs',
    task: `AREA K - MOUNT THE NEW TOUCH LAYER AND CLOSE UI HANDOFFS. The touch area built a complete phone/tablet control layer in src/game/ui/touch/** with its own stylesheet src/app/mobile.css, but nothing mounts it, so it is unreachable.
1. In src/game/ui/broadcast-ui.tsx, replace the old TouchControls import/mount (currently from ../input/touch-controls.tsx) with the new TouchLayer from ../ui/touch/, wiring whatever props it needs. Read the touch area's files first and follow their documented API exactly.
2. Verify the whole phone experience headlessly at 390x844 portrait and 844x390 landscape, and a tablet size: nothing overlapping, nothing clipped, the fight visible, controls within thumb reach. Fix what you find in the mount or in your own files; if the fix belongs in src/game/ui/touch/** (not yours), report it in handoff.
3. Re-shoot ${D}/screens/s26-phone-touch-controls.png and add a landscape shot; open both with the Read tool to confirm they are correct.
4. The screens area could not sweep phone width. Check every screen (title, cockpit choice, lobby, entrants, settings, Lab, replays, post-match, pause) at 390x844 for clipping and overlap; fix what is in your files and hand off the rest.
Do not edit src/app/globals.css, src/app/mobile.css, src/app/layout.tsx, or src/game/ui/touch/** - other areas own them.`,
  },
]

phase('Finish')
const results = await parallel(AREAS.map(a => () =>
  robust(BASE + `\nYOUR AREA OWNS EXACTLY: ${a.own}\n` + a.task,
    { label: a.label, phase: 'Finish', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
for (const r of results) log(`${r.area}: ${r.status}, remaining ${r.remaining.length}`)

phase('Ship')
const ship = await robust(BASE + `
STAGE: SHIP. All areas are finished. Their reports: ${JSON.stringify(results)}
You may now edit ANY file. The director is about to play this on their own machine at localhost, so it must start cleanly and work.
1. Close every open handoff between areas; resolve anything two areas each assumed the other did.
2. Green tree on the server, all of it: npm run typecheck (0 errors), npm run lint (0 errors), npm test (every test passing), npm run eval smoke, npm run build (production build succeeds). Fix root causes.
3. Boot check headless on the server: zero console errors, zero GL warnings, no context loss, title -> lobby -> a match -> post-match. Report draw calls and triangles per frame per quality tier.
4. Make first-run on the director's machine clean: 'npm run dev' from a fresh clone state must work (sync-mujoco and sync-fonts included), and the README must state exactly how to start it, the controls, the presets, and how to register a policy. Verify the README's commands are real.
5. Write ${D}/screens/INDEX.md fresh: every current shot, plus an honest list of what is still wrong or unverified.
6. Report: the exact command outputs, what a player should expect at localhost:3000, the known issues, and anything that only real hardware can confirm.`, { label: 'ship', phase: 'Ship', effort: 'high', schema: REPORT }, 4)

return { results, ship }
