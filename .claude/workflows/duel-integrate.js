export const meta = {
  name: 'duel-integrate',
  description: 'Fix rendering in the real browser, make the full match flow playable, verify harness and build, capture screenshots',
  phases: [
    { title: 'Render', detail: 'fix WebGL sampler mismatch and context loss so the 3D stage renders' },
    { title: 'Flow', detail: 'title to lobby to match to post-match to rematch, console clean, wiring gaps closed' },
    { title: 'Harness', detail: 'Lab, Proving Ground vs example policy, export and verify, full tests and build' },
    { title: 'Screens', detail: 'capture every screen and HUD moment to docs/design/screens' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const REPORTS = '/private/tmp/claude-501/-Users-aaroh-cadybot/bf29d6f4-db92-4051-b91e-5dbac9866ca7/scratchpad/pkg-reports.txt'

const BASE = `
You are the integration team for TORQUE LIMIT, a first-person 1v1 robot-arm fighting game (human vs AI) in ${REPO} (branch fps-duel). You may edit ANY file in the repo.
Binding docs in precedence order: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Style guide: ${D}/research/finals-visual.md.
All seven work packages were built in parallel WITHOUT ever running in a real browser. Their final reports (status, tests, gaps, integration notes) are in ${REPORTS}; read the parts relevant to your stage.
Stack: Next.js 16.3.3, React 19, R3F 9.7, drei 10.7, three 0.185.1, postprocessing 6.39.5 + @react-three/postprocessing 3.1.1, MuJoCo 3.12 WASM, Node 22.23.
WHERE WORK RUNS (the director's laptop is overloaded; heavy compute belongs on the remote server):
- The repo on the laptop at ${REPO} is the source of truth and the ONLY place you edit files. A background job mirrors it to the server every 3 seconds.
- A mirror lives on the homebase server at ~/work/torque-limit (8 vCPU, 62 GB RAM, Ubuntu, Node 22.23, deps installed). Connect with: ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121
- Run EVERY heavy command there, never on the laptop: npm test, npm run typecheck, npm run lint, npm run build, npm run eval, npm run bench, and any long node script. Example:
    ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121 'cd ~/work/torque-limit && npm test 2>&1 | tail -40'
  After editing files, push them to the server before running anything there by calling the one-shot mirror (takes about 9 s):
    bash ${REPO}/.claude/sync-now.sh
  A background loop also mirrors every 3 s, but do not rely on it; if a remote run behaves as if your edit is missing, run sync-now.sh and retry.
- NEVER edit files on the server, never git commit there, never run "box down", never stop or disturb the other tmux sessions, docker containers (myai-*, nmlive-*, mcai) or data under ~/data and ~/work that belong to other projects. Do not delete anything on the server.
- The server's disk is 92% full (about 20 GB free). Keep build artifacts small and clean up anything large you create there.
- The dev server for the game already runs on the server in tmux session "tldev" (logs: ~/logs/tldev.log) and is tunnelled to the laptop, so in the browser the game is at http://localhost:3010. To restart it: ssh ... 'tmux kill-session -t tldev; tmux new-session -d -s tldev "cd ~/work/torque-limit && npm run dev 2>&1 | tee ~/logs/tldev.log"'
BROWSER: NEVER OPEN A BROWSER ON THE LAPTOP. The director's GPU must stay free. Do NOT call preview_start, navigate, or any mcp__Claude_Browser__* tool, for any reason. All browser verification runs HEADLESS ON THE SERVER with software WebGL (SwiftShader), which needs no GPU:
    ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121 'cd ~/work/torque-limit && node ~/tl-tools/shot.mjs http://127.0.0.1:3000 /tmp/shot1.png 14000 "key:Enter" "wait:3000"'
  It prints JSON: canvas presence/size, WebGL context-lost state, renderer string, the page's visible text, and every console error; and it writes a PNG. Extra arguments are steps applied in order: "key:<Key>", "click:<css selector>", "mouse:<x>,<y>", "wait:<ms>".
  The tool lives OUTSIDE the mirrored repo at ~/tl-tools/shot.mjs. Anything you create inside ~/work/torque-limit on the server is DELETED by the next mirror sync, so put server-side helper scripts in ~/tl-tools/ and write outputs to /tmp on the server. Extend shot.mjs freely (pointer lock, mouse drags for flicks, longer scripted playthroughs, frame-rate sampling with requestAnimationFrame, capturing several PNGs in one run).
  To look at a screenshot, copy it to the laptop and open it with the Read tool:
    scp -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121:/tmp/shot1.png ${D}/screens/<name>.png
  Headless software rendering is correct for finding crashes, black screens, layout, HUD, and console errors. It is NOT a frame-rate measurement; never report SwiftShader timings as the game's performance.
SILENCE IS MANDATORY: the director's machine must never make a sound. Nothing you run may play audio. The headless runner already mutes the game (volumes zeroed, host voice off, speech synthesis disabled, --mute-audio) and runs on the server anyway, so keep it that way and never add a step that raises a volume or enables host voice. Audio correctness is verified OFFLINE only: OfflineAudioContext renders, the game's renderAudioReport() hook, and unit tests on the server. Never verify sound by listening.
Rules: do not git commit, push, or switch branches. Fix root causes; never delete or weaken tests to make them pass. Quality bar: a polished 2026 AAA game, no placeholders, no dead buttons.
PACING: make steady visible progress with many small tool calls. Write at most about 350 lines per Write call. Avoid long silent deliberation.
RESUME-AWARE: a previous attempt at this stage may have been interrupted. Check the current state of the page and files first and continue from there.`

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    fixed: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' }, description: 'things confirmed working in the real browser, with evidence' },
    remaining: { type: 'array', items: { type: 'string' }, description: 'known problems left, with details' },
  },
  required: ['status', 'fixed', 'verified', 'remaining'],
}

async function robust(prompt, opts, tries) {
  for (let i = 1; i <= (tries || 3); i++) {
    try {
      const r = await agent(prompt + (i > 1 ? `\n(Attempt ${i}; a previous attempt was interrupted. Continue from the current state.)` : ''),
        { ...opts, label: opts.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${opts.label} attempt ${i} failed: ${String(e).slice(0, 140)}`) }
  }
  return { status: 'blocked', fixed: [], verified: [], remaining: ['stage failed after retries'] }
}

phase('Render')
const render = await robust(BASE + `
STAGE: RENDER. Symptoms observed by the director just now in the in-app browser at 1440x900:
- Title screen DOM renders (wordmark, PRESS ANY KEY, sponsors) but the 3D attract match behind it is not visible (flat grey gradient), and a broken-image icon shows at the top-left corner.
- After pressing a key, the console floods with WebGL warnings "GL_INVALID_OPERATION: glDrawElements / glDrawElementsInstanced / glDrawArraysInstanced: Mismatch between texture format and sampler type (signed/unsigned/float/shadow)" (71 messages) followed by "THREE.WebGLRenderer: Context Lost."
Likely suspects to investigate (verify, don't assume): a shadow map or depth texture sampled by a non-shadow sampler (or a sampler2DShadow bound to a non-depth texture) in onBeforeCompile patches or custom ShaderMaterials in src/game/render/**; the post stack (EffectComposer with HalfFloatType + MSAA, N8AO, DepthOfField depth usage); integer DataTextures (Uint8/Uint16 with RedIntegerFormat) sampled as float; instanced crowd/VFX materials; and GPU memory pressure from loading full-resolution STL meshes twice (about 726k triangles) plus canvas textures. Bisect: disable subsystems (post stack, crowd, VFX, set dressing, shadows) one at a time via temporary flags until the warnings stop, then fix the actual cause and re-enable everything. Also find and fix the broken image.
Done when: the title attract match visibly renders the stage and both robot arms, the lobby renders, the console has zero WebGL warnings and no context loss across title -> lobby -> starting a match -> 60 s of fighting, and frame rate is reasonable (measure with requestAnimationFrame timing via javascript_tool and report it). Take a screenshot of the title and the in-match first-person view and describe what is on screen.`, { label: 'render-fix', phase: 'Render', effort: 'high', schema: REPORT }, 3)
log(`render: ${render.status}; remaining ${render.remaining.length}`)

phase('Flow')
const flow = await robust(BASE + `
STAGE: FLOW. The render stage reported: ${JSON.stringify(render)}
Known issues to fix: the first-launch "PICK YOUR MOUNT" cockpit choice screen overflows (the STABLE COCKPIT card is cut off at the right edge at 1440x900); WP7 says game-root renders its own BootSurface instead of WP7's BootScreen; WP7's loadout picker cannot retune the lobby arm; WP1's displayLatencyMs and provenance hashes are not wired; WP3's touch controls are styled inline instead of via globals.css. Check every "integrationNotes" item in the reports file and close the ones that affect play.
Then PLAY the game like a real player, end to end, with mouse and keyboard in the browser: first launch -> cockpit choice -> (tutorial if it is forced, complete it) -> lobby -> pick an opponent (try JIG and OVERSHOOT) -> match intro -> rounds -> strikes landing (flick the mouse hard at the opponent; use left mouse for jab/charge, right mouse for guard, W/S reach, Space grip) -> Core drop, dock, steal -> KO or lock -> round flow -> post-match -> REMATCH -> back to lobby -> settings -> pause/resume. Pointer lock works in the in-app browser only after a click on the canvas; if pointer lock is refused in the automation environment, drive the pilot through the game's own synthetic input or debug hooks and say so.
Judge the experience as a demanding player and fix what makes it feel broken, confusing, or cheap: unreadable HUD, dead time, controls that do nothing, camera problems, the AI standing still, hits that never register, layout overflow at 1440x900 and at 1280x720, text overlapping, anything placeholder-looking. Keep the console at zero errors and zero warnings (except known harmless browser-extension noise).
Report every step of the playthrough honestly in "verified" with what you saw.`, { label: 'flow-playtest', phase: 'Flow', effort: 'high', schema: REPORT }, 3)
log(`flow: ${flow.status}; remaining ${flow.remaining.length}`)

phase('Harness')
const harness = await robust(BASE + `
STAGE: HARNESS AND GREEN TREE. Previous stages: render ${JSON.stringify(render)} flow ${JSON.stringify(flow)}
1. In the headless server browser (extend ~/tl-tools/shot.mjs with a Playwright script of your own under ~/tl-tools/): open The Lab and register public/policies/example-policy.js as an entrant (Playwright setInputFiles on the file input, or a Blob/File through page.evaluate; say how you did it). Run a PROVING GROUND match against it (and a HARNESS model-vs-built-in match with a fixed seed). Confirm the model report shows CLEARED FOR BROADCAST or POLICY FAULT with physical stats, the episode exports, re-imports, and VERIFY reports a bit-exact re-simulation. Confirm an ARCADE match report is labelled as not verification.
2. Local bridge: run tools/bridge/torquelimit_bridge.py (check its README for the command; use python3 and only lightweight deps; do NOT install torch or lerobot) and connect a seat to it from the Lab; confirm a live match against it works, and that killing the process mid-round yields a POLICY FAULT timeout rather than a crash.
3. Green tree: npm run typecheck (0 errors), npm run lint (0 errors), npm test (all pass; it is slow, run with a long timeout and save the log), npm run eval smoke suite per README, and npm run build (production build must succeed; note that the dev server shares .next, so if the build conflicts with the running dev server, build with a separate distDir via an environment variable or temporary config, and restore afterwards).
Fix everything that fails at its root cause. Report exact command results.`, { label: 'harness-green', phase: 'Harness', effort: 'high', schema: REPORT }, 3)
log(`harness: ${harness.status}; remaining ${harness.remaining.length}`)

phase('Screens')
const screens = await robust(BASE + `
STAGE: SCREENS. Capture real PNG screenshots for review, all rendered HEADLESS ON THE SERVER, then copied to ${D}/screens/ on the laptop with scp, plus ${D}/screens/INDEX.md listing each with one line on what it shows. Write a Playwright script under ~/tl-tools/ that drives the game through each moment and calls page.screenshot for each; the DOM HUD and the WebGL canvas composite automatically in a real page screenshot. Verify each PNG with the Read tool after copying it back and confirm it is not blank or black.
Shots: title with attract match, cockpit choice, lobby, entrant select, settings, loading/boot, match intro VS card, first-person fight idle, first-person mid-exchange with a strike landing (sparks, damage number, hitmarker), guard/deflect, stagger, Core dropping, Core docked with lock countdown, a steal, KO de-rez with SHORTED OUT stamp, round intro, post-match with bragging stats, The Lab, a model report, replay viewer, pause menu, touch controls at a phone viewport (390x844).
Previous stage reports: ${JSON.stringify({ render, flow, harness })}`, { label: 'screens', phase: 'Screens', effort: 'medium', schema: REPORT }, 3)

return { render, flow, harness, screens }
