export const meta = {
  name: 'duel-build',
  description: 'Plan work packages from the design, build the spine, build six packages in parallel, then integrate and play-test in the browser',
  phases: [
    { title: 'Plan', detail: 'trim the design to SCOPE.md and assign disjoint file ownership' },
    { title: 'Spine', detail: 'contracts, loop, match director, stubs so the tree compiles' },
    { title: 'Packages', detail: 'physics/combat, feel, AI/policy, harness, render, UI in parallel' },
    { title: 'Integrate', detail: 'wire everything, fix the tree, play a match in the browser' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'

const BASE = `
You are on a team building TORQUE LIMIT, a first-person 1v1 robot-arm fighting game (human vs AI) in ${REPO} (branch fps-duel).
Binding documents, in precedence order:
  1. ${D}/SCOPE.md  (product owner's override: identity, scope cut, audio, packaging, definition of done). READ IT FULLY FIRST.
  2. ${D}/BUILD_PLAN.md (file ownership and contract adjustments; exists after the Plan phase)
  3. ${D}/GAME_DESIGN.md (detailed spec; follow it wherever SCOPE.md and BUILD_PLAN.md do not override)
Research references: ${D}/research/*.md (finals-visual.md is the style guide, codebase.md maps the old code).
Stack: Next.js 16.3.3 (read node_modules/next/dist/docs guides before writing Next-specific code; this version has breaking changes), React 19, R3F 9.7, drei 10.7, three 0.185.1, MuJoCo 3.12 WASM (runtime served from public/mujoco.{js,wasm}), Tailwind 4, Node 22.23 (type stripping: tests import .ts directly).
Team rules:
- Quality bar: this must feel like a polished 2026 AAA game, not generated or placeholder code. No TODO stubs left in shipped paths, no fake numbers, no dead buttons.
- Do NOT git commit, push, or change branches.
- A dev server is already running on port 3000 serving this repo; do not start another on 3000 and do not kill it.
- Keep local disk use small: no large downloads beyond npm packages named in the plan.
`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'WP1..WP7' },
          name: { type: 'string' },
          summary: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'name', 'summary', 'files'],
      },
    },
    disjointCheck: { type: 'string' },
  },
  required: ['packages', 'disjointCheck'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'partial', 'blocked'] },
    built: { type: 'array', items: { type: 'string' }, description: 'features implemented' },
    tests: { type: 'string', description: 'test commands run and pass/fail counts' },
    typecheckOwnFiles: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'anything in scope not done, with reason' },
    integrationNotes: { type: 'array', items: { type: 'string' }, description: 'what the integrator must wire or know' },
    depsNeeded: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'built', 'tests', 'typecheckOwnFiles', 'gaps', 'integrationNotes', 'depsNeeded'],
}

phase('Plan')
const plan = await agent(BASE + `
ROLE: technical producer. Produce ${D}/BUILD_PLAN.md, the build contract for this sprint.
1. Read SCOPE.md, then GAME_DESIGN.md sections 10 and 11 in full, and skim the rest.
2. Start from GAME_DESIGN 11.4's seven packages (WP1 spine, WP2 physics/combat/kinematics, WP3 feel: input/camera/audio/announcer/feedback, WP4 AI and policy runtime, WP5 harness, WP6 stage/render/VFX, WP7 broadcast UI/HUD/brand). Remove every file that only serves a cut feature in SCOPE.md 2.2. Add files needed by SCOPE.md (touch controls in WP3; game-show stage set, holographic crowd, de-rez KO VFX in WP6; hosts ROOK and DR. VALE, sponsor marks, Anton/Barlow Condensed/Chivo Mono fonts in WP7; procedural audio only in WP3; JSON episode format in WP5; steal-inherits-countdown in WP2). App packaging is NOT in this sprint; do not assign PWA/Electron/Capacitor files.
3. Every file (source, test, script, public asset, doc) belongs to exactly one package. Old files slated for deletion (GAME_DESIGN 10.8) are owned by the package that deletes them. package.json, lockfile, tsconfig, eslint config, next.config, README, src/app/page.tsx belong to WP1. src/app/layout.tsx and globals.css belong to WP7.
4. Write a "Contract adjustments" section: the exact edits to GAME_DESIGN 11.2's contracts.ts for this scope (types to remove for cut features, types to add or change: steal inheriting countdown, touch input, host ids ROOK/VALE, JSON episode format, anything else). WP1 applies them.
5. Write a "Stub protocol" section: WP1 creates a compiling stub for every factory export in GAME_DESIGN 11.3 (as trimmed) inside the owning package's file, so the tree typechecks before the parallel phase; the owning package then replaces the stub with the real implementation and keeps the exported signature.
6. Write per-package acceptance criteria (trimmed from GAME_DESIGN 11.4 and 12) and the integration responsibilities table (trimmed 11.5).
7. Verify disjointness mechanically: extract every path from the package file lists with a script and prove no duplicates. Put the result in disjointCheck.
Return the package list with full file lists.`, { label: 'producer:plan', phase: 'Plan', effort: 'high', schema: PLAN_SCHEMA })

if (!plan || !plan.packages || plan.packages.length < 5) {
  log('Plan phase failed to produce packages; stopping.')
  return { error: 'no plan', plan }
}
log(`plan: ${plan.packages.map(p => p.id + ' ' + p.files.length + ' files').join(', ')} | ${plan.disjointCheck}`)

// ---------------------------------------------------------------------------
// Robust agent: a stalled or crashed agent must not kill the workflow. Every
// prompt is resume-aware, so a retry continues from the files on disk.
const RESUME = `
RESUME-AWARE: an earlier attempt at this exact task may have been interrupted part-way. Before writing anything, inspect the files you own on disk (ls, git status, read them). Keep good work that is already there, finish what is incomplete, and do not redo finished files.
PACING: make steady visible progress. Write files incrementally: at most about 350 lines per Write call; for a longer file, write the first part and then append the rest with further edits. Prefer many small tool calls over one giant generation, and avoid very long silent deliberation before acting.`

async function robust(prompt, opts, tries) {
  const n = tries || 3
  for (let i = 1; i <= n; i++) {
    try {
      const r = await agent(prompt + RESUME + (i > 1 ? `\n(This is attempt ${i}; a previous attempt was interrupted.)` : ''),
        { ...opts, label: opts.label + (i > 1 ? `#${i}` : '') })
      if (r) return r
      log(`${opts.label}: empty result on attempt ${i}`)
    } catch (e) {
      log(`${opts.label}: attempt ${i} failed: ${String(e).slice(0, 160)}`)
    }
  }
  return null
}

phase('Spine')
const wp1 = plan.packages.find(p => p.id === 'WP1')
const SPINE_COMMON = BASE + `
ROLE: WP1 spine engineer, one stage of the spine. WP1 package: ${JSON.stringify(wp1)}
Read BUILD_PLAN.md sections 0-3 (decisions, WP1 file list, contract adjustments, stub protocol) before acting.
State already on disk from a previous interrupted run: package.json/lockfile/tsconfig/eslint/next.config/.gitignore were edited, dependencies installed, scripts/sync-mujoco.mjs and scripts/check-stubs.mjs exist, and src/game/contracts.ts (about 800 lines) exists and passes tsc --strict on its own. Verify rather than redo.
You are the only agent working right now; you may edit only WP1 files plus, in stage 4, the stub files of other packages.`

const SPINE_STAGES = [
  { key: 'S1-config', task: `STAGE 1 of 4: repo config and contracts. Verify package.json scripts, pins, and devDependencies match BUILD_PLAN (fix anything missing, including scripts/sync-fonts.mjs which the dev/build scripts call, so "npm run dev" cannot break), tsconfig/eslint/next.config match GAME_DESIGN 10.1 as adjusted, npm install is complete, and src/game/contracts.ts fully applies BUILD_PLAN's contract adjustments (review it section by section against BUILD_PLAN 2 and fix gaps). Run: npx tsc --noEmit on contracts, node scripts/sync-mujoco.mjs, node scripts/sync-fonts.mjs.` },
  { key: 'S2-core', task: `STAGE 2 of 4: core runtime, real implementations with tests. src/game/core/* (event-bus, ui-store with useSyncExternalStore-compatible subscribe, settings store on localStorage with try/catch, seeded rng, hud-frame), src/game/loop/game-clock.ts, src/game/loop/event-ring.ts, src/game/testing/fakes.ts, and their WP1 tests. Run the tests.` },
  { key: 'S3-loop', task: `STAGE 3 of 4: the match loop, real implementations with tests. src/game/loop/sim-driver.ts (fixed-step, hit-stop break on the impact step, catch-up cap, render alpha), src/game/match/* (match-director phase machine and timings from GAME_DESIGN 2.2 as adjusted, match-config, presets, replay-moments, tutorial-script), src/game/loop/headless-runner.ts, and their WP1 tests. Code against contracts; other packages' factories are not implemented yet, so tests use fakes. Run the tests.` },
  { key: 'S4-stubs-shell', task: `STAGE 4 of 4: stubs and app shell. Create a compiling stub for every other package's factory export per BUILD_PLAN's stub protocol and scripts/check-stubs.mjs marker convention, in the owning package's files. Write src/game/game-handle.ts (createGame wiring every factory), client-entry.tsx (use client, next/dynamic ssr:false), game-root.tsx, src/app/page.tsx, WP1's README section, and tests/import-smoke.test.mjs. Legacy files that no longer compile against the new tree and are owned by another package for deletion may be excluded from typecheck via tsconfig exclude (note it) rather than deleted. Finish with: npm run typecheck = 0 errors for the whole tree, npm test = all pass, npm run lint = 0 errors, and curl http://localhost:3000 returns 200 without a compile error in the body.` },
]
const spineReports = []
for (const st of SPINE_STAGES) {
  const r = await robust(SPINE_COMMON + '\n' + st.task, { label: 'WP1:' + st.key, phase: 'Spine', effort: 'medium', schema: REPORT_SCHEMA }, 4)
  spineReports.push({ stage: st.key, ...(r || { status: 'blocked', gaps: ['stage failed after retries'] }) })
  log(`spine ${st.key}: ${r ? r.status : 'FAILED'}`)
  if (!r) return { error: 'spine stage failed: ' + st.key, spineReports }
}
const spine = spineReports

phase('Packages')
const others = plan.packages.filter(p => p.id !== 'WP1')
const reports = await parallel(others.map(p => () =>
  robust(BASE + `
ROLE: ${p.id} lead engineer (${p.name}). Your package: ${JSON.stringify(p)}
The spine (WP1) is done. Its stage reports: ${JSON.stringify(spine)}
Five other packages are being built at the same moment by other engineers in the SAME working tree. Therefore:
- Edit and create ONLY the files in your package list. Never touch another package's file. If you need something from another package, code against the contract in src/game/contracts.ts and write the need into integrationNotes.
- Do not run npm install or edit package.json. If you truly need a dependency, list it in depsNeeded and implement without it.
- When you typecheck (npx tsc --noEmit), filter the output to your own files; errors in files you do not own may be transient.
- Do not use the in-app Browser pane; the integrator will. You may run node scripts and your tests.
Read BUILD_PLAN.md (your section, the contract adjustments, the integration table), SCOPE.md, and every GAME_DESIGN.md section relevant to your package, plus the research docs for your area. Replace every STUB in your files with the full real implementation (remove the stub marker), keep the exported signatures, delete the old files your package owns, and write the tests your package owns. Aim for the definition of done: complete, tuned, and polished, not a skeleton. Where the design gives numbers, use them; where it is silent, make a strong, tasteful decision and note it.
Work in this order so an interruption loses little: (1) the factory files other packages depend on, (2) the rest of your modules, (3) tests.
Before finishing: run your tests and report counts; report the filtered typecheck result for your files.`,
    { label: p.id + ':' + p.name, phase: 'Packages', effort: 'high', schema: REPORT_SCHEMA }, 4)
    .then(r => r ? { id: p.id, name: p.name, ...r } : { id: p.id, name: p.name, status: 'blocked', built: [], tests: 'agent failed', typecheckOwnFiles: '', gaps: ['agent failed after retries'], integrationNotes: [], depsNeeded: [] })
))
for (const r of reports) log(`${r.id}: ${r.status}, gaps ${r.gaps.length}`)

phase('Integrate')
const integration = await robust(BASE + `
ROLE: integration lead. All packages have finished. You may now edit ANY file in the repo.
Package reports: ${JSON.stringify(reports)}
Spine report: ${JSON.stringify(spine)}
1. Install any depsNeeded that are justified (small npm packages only).
2. Wire everything per BUILD_PLAN's integration table. Remove any remaining STUB markers by checking the real implementations exist; if a package left a stub or gap, implement it.
3. Get the whole tree green: npm run typecheck (0 errors), npm run lint (0 errors), npm test (all pass), npm run build (succeeds). Fix root causes, never delete tests to pass.
4. Play it. Load the Browser tools with ToolSearch (query "Claude_Browser", max_results 30) and use the in-app browser against the already-running dev server at http://localhost:3000 (if it is not responding, start it with the preview_start tool using configuration name "roboarena"). Set the viewport to 1440x900. Boot, get to the lobby, start a match vs a built-in opponent, and actually fight using keyboard and mouse actions (click the canvas for pointer lock, move the mouse, press/hold keys). Watch read_console_messages for errors and fix every one. Get through a full match to post-match and rematch.
5. Take screenshots of: loading, title, lobby, match intro, first-person fight (mid-exchange), a strike landing, the Core docked, KO, post-match, The Lab, settings. Save them as PNGs in ${D}/screens/ (use the page's canvas/DOM capture via javascript_tool, or describe precisely in a screens/INDEX.md if saving pixels is impossible, but try hard to save real images).
6. Also verify PROVING GROUND against public/policies/example-policy.js: model report shows, episode exports, re-import and verify runs.
7. Reset the viewport to the desktop preset when finished.
Report honestly: what works end to end, what is broken or missing, the exact command outputs, and the list of screenshots.`,
  { label: 'integrator', phase: 'Integrate', effort: 'high', schema: {
    type: 'object',
    properties: {
      typecheck: { type: 'string' }, lint: { type: 'string' }, tests: { type: 'string' }, build: { type: 'string' },
      playthrough: { type: 'string', description: 'what happened when playing, step by step' },
      consoleErrors: { type: 'string' },
      screenshots: { type: 'array', items: { type: 'string' } },
      provingGround: { type: 'string' },
      broken: { type: 'array', items: { type: 'string' } },
      missing: { type: 'array', items: { type: 'string' } },
    },
    required: ['typecheck', 'lint', 'tests', 'build', 'playthrough', 'consoleErrors', 'screenshots', 'provingGround', 'broken', 'missing'],
  } }, 3)

return { plan: plan.packages.map(p => ({ id: p.id, name: p.name, files: p.files.length })), spine, reports, integration }
