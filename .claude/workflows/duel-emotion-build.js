export const meta = {
  name: 'duel-emotion-build',
  description: 'Build the EMOTION_BIBLE: Phase 0 contracts and LOD, then eight parallel packages on disjoint files, then an integration sweep',
  phases: [
    { title: 'Phase 0', detail: 'contracts additions, LOD robot assets and robot view' },
    { title: 'Build', detail: 'WP1 perf, WP2 look, WP3 body, WP4 character, WP5 feel, WP6 show flow, WP7 broadcast, WP8 sound and data' },
    { title: 'Integrate', detail: 'handoffs, green tree, headless boot and match' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const BIBLE = D + '/EMOTION_BIBLE.md'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel).
THE BINDING SPEC IS ${BIBLE}. Read section 11 (work packages, rules, the 11.9 contracts) in full, your own package block, and every section your block cites. It overrides GAME_DESIGN.md and SCOPE.md where they conflict. Research behind it: ${D}/research/emotion/*.md. Current state: ${D}/STATUS.md.
The night-show look renders (a NaN shader bug is fixed) and a declutter pass has already landed today (crowd thinned, one ribbon + two boards, no bowl wash, hazard on long edges, keylined cubes, solid viewmodel, prewarm fixed): read the current files before assuming the bible's "before" state.

OWNERSHIP IS LAW. Edit only the files your package owns (the bible lists every path exactly once). Everything not listed is FROZEN. A one-line edit you need elsewhere goes in your handoff, never in the file. Never add dependencies. No new shader programs after prewarm (boot-time variants only). HARNESS and PROVING GROUND physics stay byte-identical. Delete what you replace.

WHERE WORK RUNS: edit only on the laptop at ${REPO}; push with 'bash ${REPO}/.claude/sync-now.sh' (about 9 s); heavy commands run on homebase via ${SSH} 'cd ~/work/torque-limit && ...', always DETACHED (nohup ... > /tmp/<you>.log 2>&1 &) and polled with tail; a tool call blocking more than about 3 minutes kills your agent and you restart from disk. Eight packages share the 8-vCPU server: run only the test files you own during the pass, check ${SSH} 'uptime' before anything heavy and wait while the 1-minute load is above 12, and use at most ONE headless browser run at a time (~/tl-tools/shot.mjs and friends; window.__tl, __tlConfig, __tlR3F, __tlComposer exist in dev). Never create files inside ~/work/torque-limit on the server; helpers go in ~/tl-tools/. Never edit on the server, commit, switch branches, run "box down", or touch other tmux sessions, containers or ~/data.
NEVER open a browser on the laptop (the director's GPU); the director reviews on the real GPU after this pass. SILENCE: nothing may ever play audio; verify audio offline only.
RULES: no commits. Fix root causes; never weaken a test. Before you finish: typecheck clean for the whole tree, lint clean on your files, your owned tests green, all on the server. Quality bar: a polished 2026 AAA game that feels human; no placeholders, no dead buttons.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation. RESUME-AWARE: an earlier attempt may have been interrupted; read your files first and continue.`

const REPORT = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
  changed: { type: 'array', items: { type: 'string' } },
  verified: { type: 'array', items: { type: 'string' } },
  remaining: { type: 'array', items: { type: 'string' } },
  handoff: { type: 'array', items: { type: 'string' }, description: 'exact one-line edits needed in files you do not own, addressed to their package' },
}, required: ['status', 'changed', 'verified', 'remaining', 'handoff'] }

async function robust(p, o, t) {
  for (let i = 1; i <= (t || 4); i++) {
    try {
      const r = await agent(p + (i > 1 ? `\n(Attempt ${i}; the previous attempt was interrupted. Continue from the current files.)` : ''), { ...o, label: o.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${o.label} ${i}: ${String(e).slice(0, 120)}`) }
  }
  return { status: 'blocked', changed: [], verified: [], remaining: ['failed after retries'], handoff: [] }
}

phase('Phase 0')
const p0 = await robust(BASE + `
YOU ARE PHASE 0 (one agent, before anything parallel). Do exactly the two items in the bible's "Phase 0" block:
1. The WP8 contracts additions to src/game/contracts.ts, verbatim from 11.9 (MATCH_PHASES additions, REFLECTION_LAYER, LodGeometries, FeedbackFrame, LedFrame/LedState, OpponentAffect, OpponentMemory in ResetContext, ShowEvent, ReticleState, Prewarmable, SimMutation additions, SessionMeta, QualityMeta). Additive only; keep every existing export; the whole tree must still typecheck (add minimal defaults where a widened union or a new required field would break existing code, and say where).
2. The WP1 part: src/game/render/robot-assets.ts emitting LodGeometries per (link, slot) (LOD1 as a cheap in-browser decimation or vertex-clustered simplification of the merged STL geometry, targeting the triangle budget in section 10), and src/game/render/robot-view.tsx consuming LodGeometries (LOD0 on the arm the camera favours, LOD1 elsewhere per the bible) and setting REFLECTION_LAYER on the arms. Keep everything else in those files working.
Finish with typecheck clean on the whole tree, lint clean on the three files, and tests/stl-geometry.test.mjs and tests/import-smoke.test.mjs green on the server. Report the exact new exports so the packages can rely on them.`, { label: 'phase0', phase: 'Phase 0', effort: 'high', schema: REPORT }, 4)
log(`phase 0: ${p0.status}`)
if (p0.status === 'blocked') return { error: 'phase 0 blocked', p0 }

const WPS = [
  { key: 'WP1', name: 'PERF + RENDER STRUCTURE' },
  { key: 'WP2', name: 'LOOK' },
  { key: 'WP3', name: 'BODY' },
  { key: 'WP4', name: 'CHARACTER' },
  { key: 'WP5', name: 'FEEL' },
  { key: 'WP6', name: 'SHOW FLOW + DEMO' },
  { key: 'WP7', name: 'BROADCAST' },
  { key: 'WP8', name: 'SOUND AND DATA' },
]
phase('Build')
const results = await parallel(WPS.map(w => () =>
  robust(BASE + `\nPHASE 0 IS DONE. Its report: ${JSON.stringify(p0)}\nYOU ARE ${w.key} ${w.name}. Your ownership, "Does" list and acceptance criteria are the "${w.key}" block of section 11 in the bible; follow them exactly, in the order the block gives where it gives one. Seven other packages are editing the same tree right now.`,
    { label: w.key, phase: 'Build', effort: 'high', schema: REPORT }, 4).then(r => ({ wp: w.key, ...r }))
))
for (const r of results) log(`${r.wp}: ${r.status}, remaining ${r.remaining.length}, handoffs ${r.handoff.length}`)

phase('Integrate')
const integ = await robust(BASE + `
YOU ARE THE INTEGRATOR. All packages are done; you may edit ANY file now. Their reports: ${JSON.stringify(results)}
1. Apply every handoff (the one-line cross-package edits) and resolve anything two packages each assumed the other did. Update quality.ts SAFE_PHASES, stage-cues isShowIdlePhase and hud-runtime for the new phase names if any owner missed it.
2. Green tree on the server: npm run typecheck, npm run lint, npm test (all), npm run eval smoke, npm run build. Fix root causes.
3. Headless boot and match on the server (one browser at a time): zero console errors, zero GL warnings, no context loss, boot -> attract -> click -> match 1 round 1 (sparring) -> a real round -> verdict; programs count flat after prewarm; report draw calls and triangles per frame.
4. Update ${D}/STATUS.md with what landed, what is unverified, and the real-GPU review checklist from bible section 12.1 for the director.
Report exact command outputs and an honest list of what remains.`, { label: 'integrate', phase: 'Integrate', effort: 'high', schema: REPORT }, 4)
return { p0, results, integ }
