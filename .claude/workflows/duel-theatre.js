export const meta = {
  name: 'duel-theatre',
  description: 'Keep the grounding, bring back the show: real dynamic range, a key that defines form, a back wall that is a place, readable objects, quiet UI',
  phases: [
    { title: 'Build', detail: 'relight, arena backdrop and crowd, surfaces, UI scale in parallel' },
    { title: 'Review', detail: 'integrate, histogram and greyscale evidence, budget, green tree' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game at ${REPO} (branch fps-duel).
THE BINDING BRIEF IS ${D}/GROUNDING.md — read the whole file, both parts. PART 1 (grounding) has SHIPPED and must not regress: the deck is a real object, everything is planted with contact shadows, mount plates and cable harnesses and the acrylic barrier and the concrete floor exist, light comes from visible fixtures, materials have micro-detail. PART 2 (theatre) is this pass. ${D}/EMOTION_BIBLE.md remains binding for everything else (section 11 ownership rules, 11.9 contracts).
The owner wants high quality. The director's verdict on the current build: the grounding worked, but the show is gone — it now reads as a dim workshop instead of a televised night arena. Your job is BOTH: keep every physical rule, add the dynamic range and drama.

OWNERSHIP IS LAW: edit only your own files. Everything else is FROZEN, including other roles' files in this pass; a change you need elsewhere goes in your handoff as an exact one-line edit. No new dependencies, no new shader programs after prewarm (boot-time variants only, keep customProgramCacheKey discipline). RENDER ONLY: never touch physics, rules, policy or the recorder. HARNESS and PROVING GROUND stay byte-identical.
BUDGET IS A HARD GATE: ≤ 90 draw calls at DEFAULT in a live round, ≤ 0.45 M triangles, 60 fps, program count flat after prewarm. Instance repeats, merge static geometry, bake detail into shaders and textures rather than polygons. Measure your delta the way the reviewer did last pass: whole-frame gl.info with one reset per frame, in a LIVE round (never in turbo, where the canvas does not draw and gl.info is stale), median of 8+ consecutive frames.

WHERE WORK RUNS: edit only on the laptop at ${REPO}; push with 'bash ${REPO}/.claude/sync-now.sh'; heavy commands on homebase via ${SSH} 'cd ~/work/torque-limit && ...', always DETACHED (nohup ... > /tmp/<you>.log 2>&1 &) and polled with tail; a call blocking over ~3 minutes kills your agent. Four agents share an 8-vCPU box: check ${SSH} 'uptime' and wait while the 1-minute load is above 12; ONE headless browser at a time (~/tl-tools/ has shot.mjs, integ-show.mjs, rig-shot.mjs, matF-shot.mjs and others — read them before writing another; window.__tl, __tlConfig, __tlR3F, __tlComposer exist in dev). Homebase has about 12 GB free: clean up what you create in /tmp.
LOOK AT YOUR WORK: render headless, scp the PNG back, open it with the Read tool, and also convert a Rec.709 GREYSCALE copy (ffmpeg is on homebase, not on the laptop) and look at that too. Software GL will not show clearcoat, bloom or the planar reflection faithfully: judge composition, dynamic range, silhouette separation and scale from it, and say plainly what only hardware can settle. NEVER open a browser on the laptop.
SILENCE: nothing may ever play audio. RULES: no commits. Fix root causes; never weaken a test. Before finishing: whole-tree typecheck clean, lint clean on your files, owned tests green, on the server.
PACING: many small tool calls, ≤ 350 lines per Write, no long silent deliberation. RESUME-AWARE: read your files first.`

const REPORT = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
  changed: { type: 'array', items: { type: 'string' } },
  verified: { type: 'array', items: { type: 'string' }, description: 'draw/triangle delta, what you saw in your own colour and greyscale renders, and any measurement' },
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
    key: 'relight',
    own: 'src/game/render/lighting.tsx, src/game/render/quality.ts, src/game/render/post-stack.tsx, src/game/render/vfx/haze.ts, src/game/render/truss-rig.tsx',
    task: `ROLE RELIGHT: Part 2 items 1, 2 and 7, and acceptance 1, 2 and 4. The frame currently has no true blacks and no bright highlights; it is one flat mid-dark band.
Rebuild the dynamic range: a strong key that lands on the arms and makes specular highlights snap and roll as they swing; deep falloff so corners, the underside of the deck and the far floor go to true black; exposure and grade tuned so a fight frame's histogram meets acceptance 1 (≥ 5 % at or below 0.03, ≥ 0.5 % at or above 0.85, mean 0.12–0.28) while the grey card stays honest. Make the volumetric haze and the beams visible again so there is real atmosphere and three separable depth planes. Bloom only on true emitters, but let it actually bloom.
Do not go back to flooding the room with team colour: saturation belongs on the machines, the air stays neutral. Measure the histogram yourself on a rendered frame and report the numbers.`,
  },
  {
    key: 'arena',
    own: 'src/game/render/cyclorama.tsx, src/game/render/holo-crowd.tsx, src/game/render/holo-crowd-material.ts, src/game/render/led-strips.tsx, src/game/render/rigging.tsx, src/game/render/studio-floor.tsx, src/game/render/stage.tsx',
    task: `ROLE ARENA: Part 2 items 3, 4 and acceptance 3, 5, 6. Above the barrier the frame is a dead flat grey wall with a thin white band — the cheapest thing on screen — and the crowd is invisible and still built at miniature scale while the studio furniture is at true human scale.
Make the back of the room a place: dark, with sparse deliberate practicals (a lit ribbon, vomitory or doorway openings with light spilling out, equipment and rigging silhouettes, a distant lighting grid), depth layers that fall away rather than one flat plane, and a real crowd at HUMAN scale consistent with the furniture, dim and glittering, never brighter than the fight. Nothing back there may out-shine the opponent (acceptance 3: at least 8× darker).
Fix the scale coherence: one world, one scale. A viewer must still read the deck as about a metre across.`,
  },
  {
    key: 'surfaces',
    own: 'src/game/render/robot-materials.ts, src/game/render/robot-decals.ts, src/game/render/cubes-view.tsx, src/game/render/deck-texture.ts, src/game/render/stage-deck.tsx, tests/deck-texture-layout.test.mjs',
    task: `ROLE SURFACES: Part 2 items 2 and 5, acceptance 2, 7 and the Part 1 material test. The arms read as matte flat plastic with no highlight defining curvature, and the cubes are near-black on a dark mat so the Core does not read as a prize.
Make the machines look expensive under the new key: glossy clear-coated paint with a highlight that rolls across the shell as it moves, crisp edge highlights, a rim that separates each arm from the background, and colour that stays saturated in the paint rather than washing the room. Keep the Part 1 micro-detail (crevice dirt, edge wear, fingerprints, grain) — it must survive the relight rather than disappear into shadow.
Make the objects readable: the Core unmistakably the prize (bright, distinct, catching light, without becoming a glowing decal), clutter cubes legible against the mat by value and material contrast, and the mat itself not muddy.
Coordinate through your handoff with the relight role if a value depends on the key's final intensity; state the assumption you tuned against.`,
  },
  {
    key: 'ui',
    own: 'src/game/ui/hud/** and src/app/globals.css and tests/hud-format.test.mjs, tests/styles-tokens.test.mjs',
    task: `ROLE UI: Part 2 item 7 and acceptance 8. Tutorial prompts and captions are enormous — "SWING THE MOUSE ACROSS IT" spans half the screen and "HIT IT / LMB" is a huge slab across the middle of the fight.
Bring every in-fight prompt, caption and coach line down to a broadcast scale: nothing taller than 6 % of frame height, sitting in the lower third, out of the opponent's silhouette, legible but quiet. Keep the six-element HUD rule, the showKit gating and zero React commits per frame. While you are there, check every remaining HUD element at 1280×720 and 1920×1080 for size, contrast against the now-darker frame, and overlap, and fix what is off.
Verify by measuring the rendered DOM boxes as a fraction of frame height, and by looking at a render.`,
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
YOU ARE THE REVIEWER AND INTEGRATOR. All four roles are done; you may edit any render or HUD file (still never physics, rules, policy or the recorder). Their reports: ${JSON.stringify(results)}
1. Apply every handoff and resolve anything two roles each assumed the other did, especially any value tuned against a different key intensity than shipped.
2. Walk PART 2 acceptance 1–9 and the PART 1 acceptance list. For each, give evidence from a render you actually opened with the Read tool, plus the measured numbers: a real luminance histogram of a cockpit fight frame (pixel statistics computed in the page or from the PNG on homebase, not guessed), the greyscale comparison for the brightness ordering, and the whole-frame draw/triangle medians in a LIVE round at each tier. State plainly which tests pass and which fail.
3. Green tree on homebase: npm run typecheck, npm run lint, npm test, npm run build.
4. Rewrite the "grounding pass" section of ${D}/STATUS.md to cover both passes: what the world looks like now, which acceptance tests pass, what fails, and what only the real GPU can judge.`, { label: 'review', phase: 'Review', effort: 'high', schema: REPORT }, 4)
return { results, review }
