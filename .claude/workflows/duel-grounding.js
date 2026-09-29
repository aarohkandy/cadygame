export const meta = {
  name: 'duel-grounding',
  description: 'Make the world physically make sense: the deck as a real object, everything planted, hardware and studio furniture, sourced light, high-quality materials',
  phases: [
    { title: 'Build', detail: 'ground, hardware and furniture, light, materials in parallel' },
    { title: 'Review', detail: 'integrate, green tree, headless composition check' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game at ${REPO} (branch fps-duel).
THE BINDING BRIEF FOR THIS PASS IS ${D}/GROUNDING.md. READ IT IN FULL FIRST. It overrides the look sections (5.x) of ${D}/EMOTION_BIBLE.md, which remains binding for everything else (section 11 ownership rules, 11.9 contracts). Current state: ${D}/STATUS.md.
The owner's words: "this doesn't look that good, think about everything like the ground, make it make sense, and do good please. make this acc high quality."
THE ONE TEST for anything you add or keep: what is it made of, what holds it up, who installed it. If there is no answer, it does not ship. Physical plausibility beats spectacle; delete decoration that fails the test rather than adding more.

OWNERSHIP IS LAW: edit only your own files, listed in your role. Everything else is FROZEN, including every file owned by another role in this pass. A change you need elsewhere goes in your handoff as an exact one-line edit. No new dependencies. No new shader programs after prewarm (boot-time variants only, keep customProgramCacheKey discipline). HARNESS and PROVING GROUND physics stay byte-identical: this is a render-only pass, never touch physics, rules, policy or the recorder.
PERFORMANCE IS A HARD GATE: ≤ 90 draw calls and ≤ 0.45 M triangles per frame at DEFAULT, 60 fps, program count flat after prewarm. Instance everything repeated (bolts, posts, cable links); merge static geometry into single draws; bake detail into textures and shaders rather than polygons. Report your draw/triangle delta.

WHERE WORK RUNS: edit only on the laptop at ${REPO}; push with 'bash ${REPO}/.claude/sync-now.sh'; heavy commands on homebase via ${SSH} 'cd ~/work/torque-limit && ...', always DETACHED (nohup ... > /tmp/<you>.log 2>&1 &) and polled with tail; a call blocking over ~3 minutes kills your agent. Four agents share an 8-vCPU box: check ${SSH} 'uptime' and wait while the 1-minute load is above 12; ONE headless browser run at a time (~/tl-tools/shot.mjs, integ-show.mjs; window.__tl, __tlConfig, __tlR3F, __tlComposer exist in dev). Never create files inside ~/work/torque-limit on the server (helpers in ~/tl-tools/), never edit on the server, never commit.
LOOK AT YOUR WORK: render headless on the server, scp the PNG back, and open it with the Read tool. Software GL will not show bloom or reflections faithfully; judge silhouette, composition, contact shadows, material contrast (a greyscale read), and clutter. NEVER open a browser on the laptop; the director reviews on the real GPU after this pass.
SILENCE: nothing may ever play audio.
RULES: no commits. Fix root causes; never weaken a test. Before finishing: whole-tree typecheck clean, lint clean on your files, your owned tests green, on the server.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation. RESUME-AWARE: read your files first; an earlier attempt may have been interrupted.`

const REPORT = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
  changed: { type: 'array', items: { type: 'string' } },
  verified: { type: 'array', items: { type: 'string' }, description: 'include the draw-call and triangle delta and what you saw in your own screenshots' },
  remaining: { type: 'array', items: { type: 'string' } },
  handoff: { type: 'array', items: { type: 'string' } },
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

const ROLES = [
  {
    key: 'ground',
    own: 'src/game/render/stage-deck.tsx, src/game/render/deck-texture.ts, src/game/render/blob-shadows.ts, tests/deck-texture-layout.test.mjs',
    task: `ROLE GROUND: sections A and B of the brief. Rebuild the deck as a real object (18 mm plate, brushed aluminium trim with a specular arris, matte ESD rubber mat with grain and worn printed graphics, a 3 mm centre seam, countersunk hex bolts with dirt rings) and PLANT EVERYTHING (tight contact shadows and contact AO under both arm bases, every cube, the Core, and the dock hardware; they track moving objects). Resolve the current contradiction that a matte mat carries a mirror reflection: the planar reflection belongs to the trim and the scuffed lanes, masked by the print and the mat's roughness. Dock rings become milled recesses with painted rings, not glowing decals.
This is the single most important role in the pass: if objects still float, nothing else matters.`,
  },
  {
    key: 'hardware',
    own: 'src/game/render/stage.tsx, src/game/render/rigging.tsx (create), src/game/render/studio-floor.tsx (create), src/game/render/cyclorama.tsx, src/game/render/led-strips.tsx, tests/rigging-geometry.test.mjs (create)',
    task: `ROLE HARDWARE AND STUDIO: sections C, D and G. Build the things that say installed and give scale: steel mount plates with four bolts and a ground strap under each arm base; a braided cable harness leaving each base, sagging under gravity into a cable tray that runs off the deck edge; an 80 mm brushed aluminium apron; a low clear acrylic safety barrier on aluminium posts with scuffs and finger smears (slightly refractive, catches rim light); a dark polished concrete studio floor with roughness variation and a broad soft reflection, gaffer-taped cable runs and floor boxes; human-scale furniture beyond the barrier (two camera positions, a floor monitor on a stand, a rolling case) at CORRECT scale against a 1.10 × 0.70 m deck; and the scale cues (bolt heads, cable diameter, tape width, a caliper graphic on the apron).
Everything repeated is instanced; the static set merges into as few draws as possible. Keep the existing LED strips as real fixtures but stop using emissive as decoration. Own the cyclorama only to keep the bowl dark, out of focus and never brighter than the fight.`,
  },
  {
    key: 'light',
    own: 'src/game/render/lighting.tsx, src/game/render/quality.ts, src/game/render/post-stack.tsx, src/game/render/vfx/haze.ts, src/game/render/truss-rig.tsx',
    task: `ROLE LIGHT: section E, plus the calibration. Every pool of light on the deck must have a visible fixture that plausibly makes it (par cans on the truss aligned with the cones). The key must define form: a specular roll across each arm shell, so curvature reads; no object lit only by flat coloured fill. Rebalance so the arms are the brightest thing and the bowl is dark. Keep the grey-card calibration honest (predictDisplayValue agrees with ?debug=greycard) and the bloom threshold above every lit surface so only real emitters bloom. Haze belongs to the beams and must not fog the arms.
You own quality.ts and post-stack.tsx: keep the tier table and the no-compile-after-prewarm discipline intact.`,
  },
  {
    key: 'materials',
    own: 'src/game/render/robot-materials.ts, src/game/render/robot-decals.ts, src/game/render/cubes-view.tsx, src/game/render/brand-textures.ts, tests/crowd-instancing.test.mjs',
    task: `ROLE MATERIALS: section F, the reason it currently reads as untextured plastic. Give every surface micro-detail in the shader (roughness variation, subtle normal breakup, crevice darkening where parts meet, edge wear rubbing paint to primer) and one hero touch per object class (clearcoat streak on shells, brushed swirl on metal, grain on rubber). Gripper jaws get fingerprint and contact smears on the inner faces with the brightest wear at the tips. Cubes become injection-moulded plastic with a parting line, a sink mark and a slightly worn printed number. Make the four material classes (rubber mat, brushed metal, painted shell, anodised servo) distinguishable in GREYSCALE by specular response alone: verify that with a desaturated screenshot you actually look at.
Do this with shader detail and generated textures, not polygons or new files loaded at runtime.`,
  },
]

phase('Build')
const results = await parallel(ROLES.map(r => () =>
  robust(BASE + `\nYOUR ROLE OWNS EXACTLY: ${r.own}\n${r.task}`, { label: r.key, phase: 'Build', effort: 'high', schema: REPORT }, 4)
    .then(x => ({ role: r.key, ...x }))
))
for (const r of results) log(`${r.role}: ${r.status}, remaining ${r.remaining.length}`)

phase('Review')
const review = await robust(BASE + `
YOU ARE THE REVIEWER AND INTEGRATOR. All four roles are done; you may edit any render file now (still no physics, rules, policy or recorder). Their reports: ${JSON.stringify(results)}
1. Apply every handoff and resolve anything two roles each assumed the other did (especially: who owns the deck edge where trim, apron and barrier meet, and whether any emissive decoration survived).
2. Walk the eight acceptance tests at the end of ${D}/GROUNDING.md. For each, produce evidence from a headless render you actually open with the Read tool, including a GREYSCALE version for the material and squint tests (convert with the ffmpeg on homebase). Say plainly which tests pass and which fail.
3. Green tree on the server: npm run typecheck, npm run lint, npm test, npm run build. Fix root causes.
4. Report draw calls and triangles per frame at each tier against the ≤ 90 / ≤ 0.45 M gate, and confirm the program count is flat after prewarm.
5. Append a short section to ${D}/STATUS.md: what the grounding pass changed, what still fails, and what only the real GPU can judge.`, { label: 'review', phase: 'Review', effort: 'high', schema: REPORT }, 4)
return { results, review }
