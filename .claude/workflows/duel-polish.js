export const meta = {
  name: 'duel-polish',
  description: 'Fix the bugs found in integration, raise the visuals to AAA, make mobile shippable, add app packaging, then verify headless on the server',
  phases: [
    { title: 'Fix', detail: 'four parallel areas: visuals, UI and mobile, core bugs, app packaging' },
    { title: 'Verify', detail: 'headless verification sweep on the server with fresh screenshots' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team, a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel).
Binding docs, in precedence order: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Style guide: ${D}/research/finals-visual.md. Screenshot review notes: ${D}/screens/INDEX.md (read it; it names bugs and the shot that shows each).
The game already boots and plays: 660 tests pass, typecheck and lint are clean, the harness verifies episodes bit-exact, and 32 screenshots exist in ${D}/screens/.

WHERE WORK RUNS. The director's laptop must stay free; the remote server does the compute.
- Edit files ONLY on the laptop at ${REPO}. It is the source of truth.
- A mirror runs on homebase at ~/work/torque-limit. Push edits before running anything there: bash ${REPO}/.claude/sync-now.sh (about 9 s; a 3 s background loop also runs, do not rely on it).
- Run EVERY heavy command on the server, never locally: ${SSH} 'cd ~/work/torque-limit && npm test 2>&1 | tail -30' (same for typecheck, lint, build, eval, bench, long node scripts).
- NEVER create files inside ~/work/torque-limit on the server (the mirror deletes them). Server-side helper scripts go in ~/tl-tools/, outputs in /tmp on the server.
- Never edit files on the server, never commit, never switch branches, never run "box down", never touch other tmux sessions, containers (myai-*, nmlive-*), or ~/data. Delete nothing there. Its disk is 93% full (~20 GB free): clean up anything large you create.

BROWSER: NEVER open a browser on the laptop. Do NOT call preview_start, navigate, or any mcp__Claude_Browser__* tool for any reason: it would run the game on the director's GPU, which they have explicitly forbidden. All visual checking happens headless on the server with software WebGL:
    ${SSH} 'cd ~/work/torque-limit && node ~/tl-tools/shot.mjs http://127.0.0.1:3000 /tmp/x.png 14000 "key:Enter" "wait:3000"'
  Existing server tools in ~/tl-tools/: shot.mjs (screenshot + console + GL probe + steps), tlboot.mjs (persistent-profile Playwright boot), moments.mjs and fpv5.mjs (catch in-match moments off the event bus and freeze the world), lab.mjs, bridge.mjs. Read them before writing new ones; extend rather than duplicate. In development the live game handle is exposed as window.__tl with window.__tlConfig.
  Copy a PNG back and open it with the Read tool to actually look at it:
    scp -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121:/tmp/x.png ${D}/screens/<name>.png
  The dev server runs on the server in tmux "tldev" (logs ~/logs/tldev.log). Restart it only if it is down.
  Software rendering finds crashes, black screens, layout and console errors. It CANNOT measure frame rate: never report SwiftShader timings as performance.

SILENCE: nothing may play audio, ever. The headless runner already mutes everything (volumes zeroed, host voice off, speechSynthesis stubbed, --mute-audio). Never add a step that raises a volume. Verify audio only offline (OfflineAudioContext, renderAudioReport(), unit tests) on the server.

RULES: do not commit, push, or switch branches. Fix root causes; never weaken or delete a test to make it pass. Keep typecheck, lint and the 660-test suite green (run them on the server before you finish). No placeholders, no dead buttons. Quality bar: a polished 2026 AAA game.
PACING: many small tool calls, at most ~350 lines per Write. Avoid long silent deliberation.
RESUME-AWARE: a previous attempt may have been interrupted; inspect the current files and continue from there.`

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    changed: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
    handoff: { type: 'array', items: { type: 'string' }, description: 'anything another area must know' },
  },
  required: ['status', 'changed', 'verified', 'remaining', 'handoff'],
}

async function robust(prompt, opts, tries) {
  for (let i = 1; i <= (tries || 4); i++) {
    try {
      const r = await agent(prompt + (i > 1 ? `\n(Attempt ${i}; the previous attempt was interrupted. Continue from the current state of the files.)` : ''),
        { ...opts, label: opts.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${opts.label} attempt ${i}: ${String(e).slice(0, 130)}`) }
  }
  return { status: 'blocked', changed: [], verified: [], remaining: ['failed after retries'], handoff: [] }
}

const AREAS = [
  {
    key: 'visuals',
    label: 'A-visuals',
    task: `AREA A - VISUALS. You own src/game/render/** (lighting, stage, crowd, post-stack, quality, deck-texture, robot materials, vfx/**) and public/models/set/** if you add baked art. Touch nothing else.
The director looked at ${D}/screens/s12-fpv-strike-landing.png and ${D}/screens/s02-title.png and judged: the title staging reads well, but the in-match view does not look like a 2026 AAA game. Concretely:
- The background behind the arena is a blown-out near-white void with no depth: no back wall, no horizon, no atmosphere. It reads as an empty grey room, not a televised arena.
- Lighting is flat: little shadow contact, no rim separation between the arms and the background, no sense of stage lighting.
- The holographic crowd is crude repeated billboards with no variety, motion, or depth.
- Materials are plain: the robots lack the anodized sheen, decals and wear that the style guide calls for.
Fix all of that. Build a real televised arena: a bounded stage with back walls, depth haze and vignette so the arena reads as an interior; stage lighting with team-coloured rims that separate the arms from the background; a crowd that has depth, variety and reacts (it already receives hype from the bus); richer robot materials and deck art; and stronger VFX for strikes. Follow ${D}/research/finals-visual.md and SCOPE 1.3 (palette, one-colour-one-meaning, bloom on emissives only, grey-card exposure so nothing blows out).
Respect the perf design: instancing, no per-frame allocation, effects always mounted and switched by uniforms, quality tiers. Draw calls and triangles per frame are measurable headlessly (the render stage measured ~245 draws and ~1.85M triangles per frame at high tier): report yours before and after and do not make it worse.
Prove every change by rendering on the server and LOOKING at the PNG with the Read tool. Save your best before/after pair as ${D}/screens/polish-visuals-before.png and -after.png.`,
  },
  {
    key: 'ui',
    label: 'B-ui-mobile',
    task: `AREA B - UI, LAYOUT AND MOBILE. You own src/game/ui/**, src/app/globals.css, src/app/layout.tsx, src/game/brand/**, src/game/game-root.tsx, and STYLES.md. Touch nothing else.
Fix, each proven with a headless screenshot you look at:
1. PHONE LAYOUT IS NOT SHIPPABLE (${D}/screens/s26-phone-touch-controls.png). At 390x844 the two virtual sticks overlap each other, the GRIP/DRIVE/GUARD/STRIKE/ABILITY cluster sits mid-screen on top of them instead of along the edges, and the top HUD bar is clipped so both integrity bars run under the timer plate. Design a real phone HUD: thumb-reachable sticks in the bottom corners, action cluster along the right edge, a compact top bar that fits, safe-area insets, and no overlap in portrait or landscape. Test at 390x844 and 844x390 (the headless tool takes TLW/TLH env vars).
2. The Lab's VERIFY verdict is drawn underneath the results panel and sliced in half (s29).
3. Long entrant names overflow the winner band and the round band (s20, s19b).
4. REGISTER ENTRANT is clipped at the right edge of the entrants row at 1440x900 (s05).
5. The replay list layout problem noted in INDEX.md.
6. TURBO mode intentionally stops drawing the arena, which reads as a hang: add a clear on-screen affordance (e.g. a "TURBO - VIEW PAUSED" plate over the frozen canvas) so it never looks broken.
7. WP7's BootScreen is not used: game-root renders its own BootSurface instead. Wire the real boot screen.
8. Sweep every screen at 1280x720, 1440x900 and 1920x1080 for overflow, clipping and overlap; fix what you find. Re-shoot the affected screens into ${D}/screens/ replacing the stale ones.`,
  },
  {
    key: 'core',
    label: 'C-core-bugs',
    task: `AREA C - CORE BUGS AND WIRING. You own src/game/{loop,match,harness,policy,physics,combat,input,camera,kinematics}/**, src/game/game-handle.ts, src/game/core/**, src/game/contracts.ts, src/game/render/arena-canvas.tsx (only for the turbo render gate), scripts/**, tools/**, and tests/**. Do not touch src/game/ui/**, src/app/globals.css, or the rest of src/game/render/**.
1. REAL BUG, highest priority: pausing a turbo match permanently cripples it. Measured on the server with director.pause() then director.resume() (the shipped path, which the visibility-change hook also calls whenever the tab is hidden): before the pause the sim ran about 5x real time (+29.2 s sim per 6 s wall); afterwards +0.08 s per 6 s wall, and it never recovers. Since hiding the tab triggers it, a player who switches windows comes back to a dead match. Find the root cause (look at the clock's accumulator, timeScale, turbo/external-drive state and the catch-up cap in the sim driver), fix it, and add a regression test that pauses and resumes a turbo match and asserts the sim rate recovers.
2. Wire the leftovers named in ${D}/screens/INDEX.md and the package reports: WP1's displayLatencyMs, the provenance hashes (call buildProvenanceSource from src/game/harness/provenance.ts in createGame), and a contract hook so the loadout picker can retune the lobby arm's servos live (area B will call it; define and document the API in your handoff).
3. Built-in opponents trip the policy reliability bar ("7 TABLE HITS" at Contender) because they are held to the same standard as user models. Decide the honest fix (e.g. table hits are telemetry for built-ins, or the bar differs for built-in seats), implement it, and say why.
4. Re-check the opponent-behavior sweep test that timed out at 170 s under CPU contention: make it robust (raise the limit or shrink the sweep) without weakening what it proves.
5. Run the full suite, typecheck, lint, eval smoke and a production build on the server and report the numbers.`,
  },
  {
    key: 'packaging',
    label: 'D-packaging',
    task: `AREA D - APP PACKAGING (SCOPE.md section 4). You own package.json, package-lock.json, next.config.ts, .gitignore, public/manifest.webmanifest, public/icons/**, public/sw.js, src/app/pwa-register.tsx (new, referenced from nowhere else - hand it to area B to mount, do not edit layout.tsx yourself), electron/**, capacitor.config.ts, docs/APPS.md, and scripts/ files whose name starts with "app-". Touch nothing else; other areas are editing in parallel.
Deliver four ship targets from one codebase:
1. WEB: a production static export that works served from any static host. Verify on the server: build it, serve the output with a static file server on a spare port, and load it headless to confirm the game boots (WASM, models and fonts all load with relative paths).
2. PWA: manifest, maskable icons generated from the wordmark, theme colour, and a service worker that precaches the app shell and caches mujoco.wasm, the MJCF/STL models and fonts so the game runs offline after first load. Must be installable. Verify headless on the server: register the worker, reload offline (Playwright setOffline or route blocking) and confirm the game still boots.
3. DESKTOP: Electron wrapper loading the static export from disk, with contextIsolation on, nodeIntegration off, no remote module, a strict CSP, and pointer lock plus gamepad working. Scripts: "app:dev" and "app:mac" producing an unsigned arm64 .app/.dmg into a gitignored directory. Electron and electron-builder are dev dependencies; keep the local install under about 500 MB and do not install anything on the server it does not need. Building the mac app must happen on the laptop (it is macOS-only) but keep it to a single build command the director can run; do NOT run a long mac build yourself unless it is quick.
4. MOBILE: Capacitor config and docs/APPS.md with exact instructions for iOS and Android. Do not install Xcode, Android Studio, the Android SDK or Rust anywhere. Note in the doc that an Android APK can be built on the homebase server later and iOS needs a Mac with full Xcode.
docs/APPS.md must be accurate: every command in it you have actually run, or it is clearly marked as not yet run and why.`,
  },
]

phase('Fix')
const results = await parallel(AREAS.map(a => () =>
  robust(BASE + '\n' + a.task, { label: a.label, phase: 'Fix', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
for (const r of results) log(`${r.area}: ${r.status}, remaining ${r.remaining.length}`)

phase('Verify')
const verify = await robust(BASE + `
STAGE: VERIFY. The four fix areas are done. Their reports: ${JSON.stringify(results)}
You may edit any file. Do all of this on the server, headless:
1. Integrate the handoffs between areas (for example mount area D's PWA registration component, call area C's loadout retune hook from area B's picker) and resolve anything two areas each assumed the other did.
2. Green tree: npm run typecheck, npm run lint, npm test, npm run eval smoke, npm run build. All must pass; fix root causes.
3. Re-shoot the full screenshot set with ~/tl-tools/moments.mjs and friends into ${D}/screens/ (replace stale shots, keep the naming), including the phone layout at 390x844 and 844x390. Open every new PNG with the Read tool and confirm it shows what it claims and has no clipping, overlap or blank canvas.
4. Rewrite ${D}/screens/INDEX.md: one line per shot, plus a findings list of what is still wrong.
5. Confirm the app still boots with zero console errors, zero GL warnings and no context loss, and report draw calls and triangles per frame at each quality tier.
Report the exact command outputs and an honest list of what remains broken.`, { label: 'verify-sweep', phase: 'Verify', effort: 'high', schema: REPORT }, 4)

return { results, verify }
