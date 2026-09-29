export const meta = {
  name: 'duel-magic',
  description: 'Diagnose the playtest failures, rebuild the fight to feel magical and The Finals-like, then playtest for real and fix',
  phases: [
    { title: 'Diagnose', detail: 'arm clipping, HUD overlap, clutter inventory, first-person occlusion' },
    { title: 'Build', detail: 'five disjoint areas: camera, scene, magic moments, HUD, physics' },
    { title: 'Playtest', detail: 'one agent plays it for real on the laptop, muted, in short sessions' },
    { title: 'Fix', detail: 'areas fix what the playtest found' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const DIRECTOR_NOTES = `
WHAT THE PRODUCT OWNER SAID after playing it: "could not control it, and it looks shitty with things colliding into each other, and a lot of mess, it does not remind me of the finals that much, make this a lot better, i wanna make it feel magical."
Clarified: keep TRUE FIRST-PERSON. The mess is (1) HUD/UI elements overlapping each other, (2) robot arms clipping through each other/the table/props, (3) far too much on screen with no focal point.
WHAT THE DIRECTOR FOUND in a real-time playtest (1280x720):
- Input was never attached to the canvas (fixed: camera-director now calls pilot.attach). Clicking the arena never re-requested pointer lock (fixed in input-system). Some hosts deny pointer lock outright (fixed: free-cursor fallback). Controls now reach the arm.
- In the first-person fight view the player's OWN ARM fills the centre of the screen at the home pose and completely hides the opponent. You cannot see what you are fighting.
- A huge black curved truss/cable arc sweeps across the top of the frame in the lobby and the fight. The lobby adds a cue-card caddy, pylons, "LIMIT" floor strips, deck decals, a jumbotron and dense crowd rows. Nothing leads the eye.
- The title wordmark is clipped on the right at 800 px wide.
- On the cockpit-choice screen, pressing Enter does not confirm even though the hint bar says ENTER CONFIRM; only a click works.
THE BAR: it should feel like THE FINALS in first person: a bright, clean, high-key arena with bold readable shapes, lots of negative space, restrained sponsor branding, and spectacle that comes from impact and destruction (sparks, debris, flashes, slow-motion on the KO, broadcast energy), with a sparse, crisp FPS HUD. Readability first, then spectacle. When in doubt, DELETE clutter rather than add.`

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel).
Binding docs: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Style guide: ${D}/research/finals-visual.md. Research on game feel: ${D}/research/finals-feel.md and ${D}/research/fps-feel.md.
${DIRECTOR_NOTES}

WHERE WORK RUNS. Edit files ONLY on the laptop at ${REPO}. Push with 'bash ${REPO}/.claude/sync-now.sh' before running anything remotely. Heavy commands run on homebase: ${SSH} 'cd ~/work/torque-limit && ...'. Start slow commands DETACHED and poll (nohup ... > /tmp/<you>.log 2>&1 &, then tail); a tool call blocking over ~3 minutes kills your agent. Never create files in ~/work/torque-limit on the server (the mirror deletes them): helpers go in ~/tl-tools/. Never edit files on the server, commit, switch branches, run "box down", or touch other tmux sessions, containers or ~/data.
Headless checks run on the server in software WebGL with the tools in ~/tl-tools/ (shot.mjs, tlboot.mjs, moments.mjs, visshot.mjs, lobby.mjs): good for layout, crashes and console errors, useless for frame rate or feel. Check ${SSH} 'uptime' and wait if load is above 12. In development the game handle is window.__tl.
BROWSER ON THE LAPTOP: forbidden for you unless your stage explicitly grants it. Do NOT call preview_start, navigate or mcp__Claude_Browser__* otherwise.
SILENCE: nothing may ever play audio out loud. Verify audio only offline.
RULES: no commits, no branch switches. Fix root causes, never weaken a test. Keep typecheck, lint and the full test suite green on the server before you finish. No placeholders or dead buttons.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation.
RESUME-AWARE: an earlier attempt may have been interrupted; read your files first and continue.`

const REPORT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    findings: { type: 'array', items: { type: 'string' }, description: 'what you found, with file:line evidence' },
    changed: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
    handoff: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'findings', 'changed', 'verified', 'remaining', 'handoff'],
}

async function robust(prompt, opts, tries) {
  for (let i = 1; i <= (tries || 4); i++) {
    try {
      const r = await agent(prompt + (i > 1 ? `\n(Attempt ${i}; the previous attempt was interrupted. Continue from the current files.)` : ''),
        { ...opts, label: opts.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${opts.label} attempt ${i}: ${String(e).slice(0, 130)}`) }
  }
  return { status: 'blocked', findings: [], changed: [], verified: [], remaining: ['failed after retries'], handoff: [] }
}

// ---------------------------------------------------------------- diagnose
phase('Diagnose')
const PROBES = [
  { key: 'clipping', q: `ROOT-CAUSE THE ARM CLIPPING. Robot arms visibly pass through each other, the table, and props. Establish exactly why: compare the collision geoms MuJoCo actually uses (contype/conaffinity in public/models/robotstudio_so101/so101.xml and arena.xml, and the Arcade model variant) with the visual STL meshes the renderer draws; check whether the two arms can collide with each other and with the deck at all; check render interpolation or ghost/overlay meshes that might draw where the body is not; check whether props in the render scene have any physical counterpart. Measure with MuJoCo on the server (penetration depths, contact counts during a real bot-vs-bot match). Report the causes ranked by how much visible clipping each produces, with the minimal fix for each.` },
  { key: 'hud', q: `AUDIT HUD AND UI OVERLAP. On the server, headless, render every in-match state (idle, strike, guard, Core incoming/dropped/docked/steal, low integrity, sudden death, captions, tutorial cards, round intro, KO) and every menu screen at 1280x720, 1440x900 and 1920x1080, and measure DOM bounding boxes of every visible HUD/UI element to find every pair that overlaps or is clipped. Also check the title wordmark at 800 px wide, and why Enter does not confirm on the cockpit-choice screen. Report every overlap as element A vs element B, state, viewport, pixel overlap, and file that positions each.` },
  { key: 'clutter', q: `INVENTORY THE CLUTTER against THE FINALS standard. List every object the renderer draws in the lobby and in the fight (read src/game/render/** fully): what it is, file, draw calls, triangles, and screen area it covers from the cockpit camera. For each give a verdict KEEP / SIMPLIFY / DELETE judged by: does it help the player read the fight, does it sell a bright clean game-show arena like THE FINALS, or is it noise. Be ruthless: the owner said there is far too much on screen. Specifically judge the big black curved truss/cable arc, the cue-card caddy, pylons, LIMIT floor strips, deck decals, jumbotron, crowd rows, cyclorama. Propose the target composition in one paragraph.` },
  { key: 'viewmodel', q: `SOLVE FIRST-PERSON OCCLUSION. At the home pose the player's own arm fills the centre of the cockpit view and hides the opponent. Read src/game/camera/cockpit-rig.ts, src/game/render/camera-director.tsx, camera-math.ts, and the home pose in src/game/input/pilot-controller.ts and GAME_DESIGN 3.1-3.2. Compute (numerically, with the real kinematics and camera projection) where the own arm and the opponent land on screen at home pose and across the reach envelope. Propose the camera eye position, look target, FOV and home pose that make it read like an FPS: your arm enters from the lower right like a weapon viewmodel, the opponent sits near screen centre, and a flick is visible and readable. Give exact numbers and prove them with the same computation.` },
]
const diag = await parallel(PROBES.map(p => () =>
  robust(BASE + `\nSTAGE: DIAGNOSE (read and measure; do NOT edit repo files).\n${p.q}`,
    { label: 'diag:' + p.key, phase: 'Diagnose', effort: 'high', schema: REPORT }, 3)
    .then(r => ({ probe: p.key, ...r }))
))
for (const d of diag) log(`diag ${d.probe}: ${d.findings.length} findings`)

// ---------------------------------------------------------------- build
const AREAS = [
  { key: 'camera', own: 'src/game/camera/**, src/game/render/camera-director.tsx, src/game/render/camera-math.ts, src/game/input/pilot-controller.ts, and tests/cockpit-rig.test.mjs, tests/camera-math.test.mjs, tests/pilot-controller.test.mjs, tests/reticle-projection.test.mjs',
    task: `AREA CAMERA - make first-person read like a real FPS. Implement the viewmodel diagnosis: eye, look target, FOV and home pose so your arm enters lower-right like a weapon, the opponent sits near centre, and every flick is visible. Keep the stance filter so swings do not whip the camera. Update tests to the new numbers.` },
  { key: 'scene', own: 'src/game/render/** EXCEPT camera-director.tsx, camera-math.ts and vfx/**; plus public/models/set/** and tests/crowd-instancing.test.mjs, tests/deck-texture-layout.test.mjs, tests/stl-geometry.test.mjs, tests/interpolate.test.mjs',
    task: `AREA SCENE - declutter and relight to THE FINALS standard. Apply the clutter inventory: DELETE what it marks delete (the curved truss/cable arc first), SIMPLIFY the rest, and relight to a bright, high-key, clean game-show arena with bold readable shapes, lots of negative space and restrained branding. The fight must have one clear focal point: the opponent. Report draw calls and triangles before and after; they should go DOWN.` },
  { key: 'magic', own: 'src/game/render/vfx/**, src/game/feedback/**, and tests/vfx-pools.test.mjs, tests/derez-timeline.test.mjs, tests/juice.test.mjs, tests/hitstop-budget.test.mjs, tests/hitstop-table.test.mjs',
    task: `AREA MAGIC - make impacts and big moments feel magical. Every landed strike: a crisp flash, sparks and debris that read against the clean arena, hit stop and camera kick scaled to strength. KO: slow motion, the loser's servos brown out, a team-colour de-rez burst, confetti and a broadcast flourish. Core drop: a column of light from above and a clear arrival. Round start: a stage-lights-slam moment. Everything pooled, no per-frame allocation, budgets from GAME_DESIGN 8.1 respected. Prove timing with tests.` },
  { key: 'hud', own: 'src/game/ui/** (all), src/app/globals.css, src/app/mobile.css, src/app/layout.tsx, and tests/hud-format.test.mjs, tests/banner-queue.test.mjs, tests/damage-number-merge.test.mjs, tests/styles-tokens.test.mjs, tests/copy-labels.test.mjs, tests/touch-layout.test.mjs, tests/touch-input.test.mjs',
    task: `AREA HUD - a sparse, crisp FPS HUD with zero overlaps. Fix every overlap and clip the HUD audit found. Reserve fixed layout zones so elements cannot collide (top bar: integrity, clock, round pips; centre: reticle only; lower third: one caption line; corners: kit and prompts), show contextual elements only when relevant, and cut anything not earning its place. Fix the title wordmark clipping at narrow widths and make Enter confirm on the cockpit-choice screen. Prove zero overlaps by re-measuring the same states and viewports as the audit.` },
  { key: 'physics', own: 'src/game/physics/**, src/game/combat/**, public/models/robotstudio_so101/arena.xml, public/models/robotstudio_so101/arena-arcade.xml, scripts/gen-arcade-model.mjs, and every tests/ file for physics and combat (mujoco-duel, contact-scan, tunneling, physics-determinism, arcade-model, harness-model-immutable, combat-*, servo-states, core-*)',
    task: `AREA PHYSICS - end the clipping at its root. Apply the clipping diagnosis: the arms must collide with each other and the deck, and nothing drawn may sit where no body is. Keep the stock (verification) model byte-identical to the Menagerie SO-101 (harness-model-immutable must stay green): any collision change for fun goes in the Arcade variant only. Measure penetration before and after in a real bot-vs-bot match on the server.` },
]

phase('Build')
const build = await parallel(AREAS.map(a => () =>
  robust(BASE + `\nDIAGNOSIS RESULTS (use them): ${JSON.stringify(diag)}\nYOUR AREA OWNS EXACTLY: ${a.own}\nOther areas are editing the same tree at the same time: edit only your files; put cross-area needs in handoff.\n` + a.task,
    { label: 'build:' + a.key, phase: 'Build', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
for (const b of build) log(`build ${b.area}: ${b.status}`)

// ---------------------------------------------------------------- playtest
phase('Playtest')
const PLAYTEST_GRANT = `
LAPTOP BROWSER GRANT (this stage only): the owner allowed SHORT, MUTED playtest sessions on their machine, because feel cannot be judged in software rendering. Rules, all mandatory:
1. The game is served locally at http://localhost:3100 (a dev server already running on the laptop from ${REPO}; if it is down, start it detached with: cd ${REPO} && PORT=3100 nohup npm run dev > /tmp/tl-local-dev.log 2>&1 & ). Open it with the Browser preview_start tool using configuration name "torque-local".
2. BEFORE interacting, mute: run in the page via javascript_tool: const K="torquelimit.settings.v2"; let s={}; try{s=JSON.parse(localStorage.getItem(K)||"{}")}catch{} s.audio={...(s.audio||{}),master:0,sfx:0,music:0,crowd:0,voice:0,hostVoice:false}; localStorage.setItem(K,JSON.stringify(s)); location.reload(); then after reload also: speechSynthesis.cancel(); speechSynthesis.speak=()=>{}. Re-mute after every reload.
3. Keep each session under about 10 minutes of browser time, and CLOSE THE TAB (tabs_close) at the end of every session and before you finish. Never leave it open.
4. Set the viewport to 1280x720 with resize_window and reset it to preset "desktop" before closing.
5. The embedded pane may refuse pointer lock; the game falls back to free-cursor input, so drag the mouse (left_click_drag) and use keys. window.__tl exposes the game handle for reading state.`
const playtest = await robust(BASE + PLAYTEST_GRANT + `
STAGE: PLAYTEST. The five areas just rebuilt the game. Their reports: ${JSON.stringify(build)}
Play it like a demanding player who loves THE FINALS: title, cockpit choice, green room, then real fights against JIG and OVERSHOOT. Use the mouse to aim and flick, left click to jab and charge, right click to guard, W/S reach, Space grip. Take screenshots at the important moments and read state from window.__tl.
Judge, and be specific and harsh: can you control it; can you see the opponent; does anything overlap, clip or collide; is there clutter; does it feel magical and like THE FINALS; is every hit readable; is anything confusing or dead.
You MAY fix small, obvious bugs yourself (a few lines). For anything larger, write it up as a finding assigned to one area: camera, scene, magic, hud, or physics.
Report findings as "[area] problem -> fix" lines, most important first.`, { label: 'playtest', phase: 'Playtest', effort: 'high', schema: REPORT }, 3)

// ---------------------------------------------------------------- fix
phase('Fix')
const fixes = await parallel(AREAS.map(a => () =>
  robust(BASE + `\nPLAYTEST FINDINGS: ${JSON.stringify(playtest)}\nBUILD REPORTS: ${JSON.stringify(build)}\nYOUR AREA OWNS EXACTLY: ${a.own}\nOther areas are editing in parallel: edit only your files.\nSTAGE: FIX. Fix every playtest finding assigned to area "${a.key}", plus any handoff addressed to you in the build reports. If nothing is assigned to you, verify your area is clean and return status done with no changes.`,
    { label: 'fix:' + a.key, phase: 'Fix', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
return { diag, build, playtest, fixes }
