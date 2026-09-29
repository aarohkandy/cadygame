export const meta = {
  name: 'duel-declutter-look',
  description: 'Immediate look-and-declutter pass on the fight and title views from real-GPU director notes, three disjoint areas, verified headless on the server',
  phases: [ { title: 'Build' } ],
}
const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'
const NOTES = `
DIRECTOR'S REAL-GPU NOTES (cockpit fight view, 1280x720, tier high, 60 fps, 166 draws, 1.32M tris):
The prime-time look finally renders (a NaN in the light-shaft shader hid it; fixed in vfx/haze.ts). It is dramatically better than before, and now the problem is TOO MUCH. The owner: "make it look better and get rid of the things that don't need to be there". Readability of the opponent is the only thing that matters in the frame.
CUT OR TAME (in priority order):
1. The hologram crowd: dense pink/blue tombstone silhouettes fill the entire upper half at full brightness. Thin it, push it back into the haze, drop its brightness by ~60%, break the flat colour halves into mostly neutral cool white with only sparse team accents, and keep motion subtle (sway, phone lights). It must read as a distant living crowd, never a wall of texture behind the opponent's head.
2. The ring of sponsor boards and scrolling "TORQUE LIMIT" ribbons: repeated every couple of metres around the bowl. Keep ONE jumbotron (live feed) and at most two sponsor boards placed off the opponent's sightline; ribbons become one thin, slow, dim LED ribbon.
3. The magenta/cobalt light wash tinting the whole background: rims and sweeps should touch the arms and the deck, not paint the bowl. Keep the bowl dark navy so the arms pop.
4. Hazard stripes on every deck edge: keep them only on the two long edges, thinner.
5. Deck overlays stack up: yellow dock rings + reach arcs + leash line + ghost arm all at once. Reach arcs only while aiming a flick out of range; leash line only while blocked (stretch > 0.6); ghost arm only while blocked (keep); dock rings dimmer until the Core is live.
6. The own arm reads as a broken translucent ghost: the screen-door dither is applied whenever the link is near the eye, which is always for the forearm. Dither ONLY the specific link actually intersecting the near plane, and make the forearm and gripper a solid, confident viewmodel lower-right.
7. Cubes are plain grey blocks: make them glossy printed prize cubes (the Core distinct, volt yellow with the BIT sticker; clutter cubes dark with a thin team keyline).
8. Bottom-right KIT / GRIP OPEN plate and the persistent CALIBRATION bar are noise during a normal fight: collapse the kit plate to a one-line strip that appears only when a value changes, and show the calibration bar only in the tutorial.
9. A 1000 ms hitch in the first fight: 6 shader programs compile after boot (98 programs vs 92 prewarmed). Find the six (trails, decals, LEDs, new VFX, deck reflection, grade?) and add them to prewarm so the count stops growing after boot.
10. Title screen: keep the wordmark and the two arms; the stage behind must be quieter (same crowd and board rules).
KEEP: the reflective lacquer deck and its team halves, the LED edge strips, the glossy team-colour arms with LED accents, the two sweep beams, the volumetric shafts (now fixed), the jumbotron.`
const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel). Docs: ${D}/SCOPE.md, ${D}/GAME_DESIGN.md; style: ${D}/research/finals-visual.md and the ART_BIBLE in ${REPO}/.claude/workflows/duel-primetime.js.
${NOTES}
Three areas edit in parallel; edit ONLY your files. WHERE WORK RUNS: edit only on the laptop at ${REPO}; push with 'bash ${REPO}/.claude/sync-now.sh'; heavy commands run on homebase via ${SSH} 'cd ~/work/torque-limit && ...', DETACHED (nohup ... > /tmp/<you>.log 2>&1 &) and polled; a call blocking over ~3 minutes kills your agent. Helpers only in ~/tl-tools/ on the server; never create files inside ~/work/torque-limit there; never edit on the server, commit, switch branches, or touch other tmux sessions/containers.
LOOKING: headless software-GL shots on the server: ${SSH} 'cd ~/work/torque-limit && node ~/tl-tools/shot.mjs http://127.0.0.1:3000 /tmp/x.png 16000' (steps like "key:Enter", "eval:<js>", "evalfile:<path>"; window.__tl is the game handle, window.__tlR3F = {gl, scene, camera}, window.__tlComposer the post composer). Wait if ${SSH} 'uptime' load is above 12. Copy PNGs back with scp and LOOK at them with the Read tool. Software GL cannot show bloom faithfully; judge composition and clutter. NEVER open a browser on the laptop (the director's GPU).
SILENCE: nothing may play audio. RULES: no commits; fix root causes; typecheck, lint and the tests you own must be green on the server before you finish; delete what your new work replaces. PACING: many small tool calls, <=350 lines per Write. RESUME-AWARE: read your files first.`
const REPORT = { type: 'object', properties: { status: { type: 'string', enum: ['done','partial','blocked'] }, changed: { type: 'array', items: { type: 'string' } }, verified: { type: 'array', items: { type: 'string' } }, remaining: { type: 'array', items: { type: 'string' } }, handoff: { type: 'array', items: { type: 'string' } } }, required: ['status','changed','verified','remaining','handoff'] }
async function robust(p, o, t) { for (let i = 1; i <= (t||4); i++) { try { const r = await agent(p + (i>1 ? `\n(Attempt ${i}; continue from the current files.)` : ''), { ...o, label: o.label + (i>1 ? '#'+i : '') }); if (r) return r } catch (e) { log(`${o.label} ${i}: ${String(e).slice(0,120)}`) } } return { status: 'blocked', changed: [], verified: [], remaining: ['failed after retries'], handoff: [] } }
const AREAS = [
  { key: 'stage', own: 'src/game/render/{holo-crowd.tsx,holo-crowd-material.ts,jumbotron.tsx,brand-textures.ts,cyclorama.tsx,stage.tsx,stage-deck.tsx,deck-texture.ts,led-strips.tsx,lighting.tsx,quality.ts,cubes-view.tsx} and tests/crowd-instancing.test.mjs, tests/deck-texture-layout.test.mjs', task: 'AREA STAGE: notes 1, 2, 3, 4, 7 and 10. Quieter crowd, one jumbotron plus two boards, one dim ribbon, no background wash, stripes on long edges only, prize cubes. Report draw calls and triangles before and after from the headless run.' },
  { key: 'arm', own: 'src/game/render/{robot-view.tsx,robot-materials.ts,ghost-arm.tsx,range-arcs.tsx,reticle-overlay.tsx,prewarm.ts,post-stack.tsx} and src/game/render/vfx/prewarm-list.ts (create), tests/reticle-projection.test.mjs, tests/vfx-pools.test.mjs', task: 'AREA ARM AND OVERLAYS: notes 5, 6 and 9. Solid confident viewmodel, dither only on true near-plane intersection, overlays only when relevant, and every program compiled during boot so the count never grows in play (verify with window.__tlR3F.gl.info.programs.length before and after a headless match).' },
  { key: 'hud', own: 'src/game/ui/hud/** and src/app/globals.css and tests/hud-format.test.mjs, tests/banner-queue.test.mjs', task: 'AREA HUD: note 8, plus a general pass: every persistent element must earn its place during a normal fight; anything contextual appears only while relevant. Zero overlaps at 1280x720 and 1920x1080, zero React commits per frame.' },
]
phase('Build')
const results = await parallel(AREAS.map(a => () => robust(BASE + `\nYOUR AREA OWNS EXACTLY: ${a.own}\n${a.task}`, { label: a.key, phase: 'Build', effort: 'high', schema: REPORT }, 4).then(r => ({ area: a.key, ...r }))))
for (const r of results) log(`${r.area}: ${r.status}`)
return { results }
