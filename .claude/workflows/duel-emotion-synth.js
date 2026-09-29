export const meta = {
  name: 'duel-emotion-synth',
  description: 'Synthesize the finished emotion research into EMOTION_BIBLE.md with a parallel build plan, then adversarially critique and revise it',
  phases: [ { title: 'Synthesize' }, { title: 'Critique' }, { title: 'Revise' } ],
}
const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const OUT = D + '/research/emotion'
const CONTEXT = `
PROJECT: TORQUE LIMIT at ${REPO} (branch fps-duel): a first-person 1v1 robot-arm fighting game, human vs AI, two SO-101 desk arms (MuJoCo physics in the browser, React Three Fiber, Next.js 16). Docs: ${D}/GAME_DESIGN.md (long), ${D}/SCOPE.md, ${D}/STATUS.md. Research: ${D}/research/*.md and the NINE finished emotion tracks in ${OUT}/ (feel, finals-alive, expressive-ai, embodiment, hooks, audio, polish, perf, data). The night-show art bible is the ART_BIBLE string in ${REPO}/.claude/workflows/duel-primetime.js; that look now RENDERS (a NaN shader bug hid it until today): dark stadium, reflective lacquer deck, hologram crowd tiers, sponsor boards, LED edges, glossy team-colour arms.
THE OWNER'S VERDICTS: "not as amazing as the finals, unoptimized, bad, awful, plain, no emotion"; wants a deep dive into what makes a game feel HUMAN and have EMOTION, applied through look, wow and engaging gameplay, not lore; goal is getting people interested, then collecting data from play. Latest: "make it look better and get rid of the things that don't need to be there".
THE DIRECTOR'S REAL-GPU NOTES on the cockpit view today: 60 fps, 166 draw calls, 1.32M triangles, 34 ms input latency, but a 1000 ms hitch in the fight (6 shader programs compile after boot: 98 vs 92 prewarmed). The frame is busy: dense pink/blue hologram crowd tombstones fill the upper half, repeated sponsor boards and scrolling wordmark ribbons ring the bowl, hazard stripes on every deck edge, yellow dock rings plus reach arcs plus a leash line plus a translucent dithered own arm all at once; the magenta rim/sweep wash tints the whole background; cubes are plain grey blocks; the own arm reads as a broken ghost. Readability of the opponent is the only thing that matters in that frame.
RULES: do not edit repo files except the document you own. Do not open the game in a browser. Be decisive and concrete (numbers, hex, ms, file paths).`
phase('Synthesize')
const BIBLE = D + '/EMOTION_BIBLE.md'
await agent(CONTEXT + `
You are the lead game designer and art director. Read every file in ${OUT}/, the ART_BIBLE, SCOPE.md, STATUS.md, and skim GAME_DESIGN.md. Write ${BIBLE}: the binding document that turns TORQUE LIMIT into a game people want to play and share. It overrides GAME_DESIGN.md and SCOPE.md where they conflict (say so at the top).
Sections: (a) the emotional promise in one paragraph and the three feelings every match must deliver; (b) the first 60 seconds, second by second; (c) the player's arm as a body (viewmodel language, states, rituals); (d) the opponent as a character (motion language, tells, reactions, temperaments, the Luxo principle); (e) the look: what stays, what is CUT, and why, with the director's clutter notes resolved item by item, plus lighting, materials, composition, living background and UI motion; (f) feel spec per event across camera, time, viewmodel, sound, UI, haptics; (g) the audio emotion arc; (h) the engagement loop and shareable moments, no lore; (i) the data product and consent loop; (j) performance budget and the optimization order (kill the post-boot shader compiles first); (k) WORK PACKAGES: 8 packages buildable in parallel with STRICTLY DISJOINT file ownership (exact paths, nothing twice), each with acceptance criteria checkable on a real GPU, and a shared contracts note with any new cross-package interface written out; (l) a real-GPU review checklist and a 60-second demo-video shot list that shows the game at its best.
Return a 12-line summary.`, { label: 'lead-designer', phase: 'Synthesize', effort: 'high' })
phase('Critique')
const CRITICS = [
  { key: 'emotion', lens: 'Veteran creative director who judges whether a design will make players FEEL something. Attack everything generic, every "more effects" without emotional purpose, every place the opponent still reads as a script, every place the player arm still feels like a cursor, every hook that will not survive a bored 19-year-old on a laptop.' },
  { key: 'feasibility', lens: 'Principal engineer on this codebase (read src/game/render, camera, feedback, policy/opponent, loop). Attack feasibility at 60 fps on an M1/M2 Air in Chrome: per-effect cost, shader compiles, allocation, physics budget, triangle load; and whether the work packages are truly disjoint with complete contracts. Demand cuts or cheaper substitutes.' },
  { key: 'clarity', lens: 'UX researcher running a first-session study with players who have never seen this. Walk the first 60 seconds and three matches as written; find every moment of confusion, dead time, unreadable feedback, clutter, or missing reason to continue. Be specific about what the player sees and thinks each second.' },
  { key: 'data', lens: 'ML robotics researcher who will train SO-101 policies on this data. Attack the data product: sufficiency and cleanliness of what is recorded, arcade contamination, honest consent, whether the contribution loop is real, and whether the tasks people play produce diverse useful demonstrations.' },
]
const critiques = await parallel(CRITICS.map(c => () =>
  agent(CONTEXT + `\n${c.lens}\nRead ${BIBLE} (and ${OUT}/*.md where useful). Every issue must cite the section, say concretely what goes wrong, and propose a concrete fix. Rank by severity.`,
    { label: 'critic:' + c.key, phase: 'Critique', effort: 'high', schema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, section: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'section', 'problem', 'fix'] } } }, required: ['issues'] } })
    .then(r => r ? r.issues.map(i => ({ critic: c.key, ...i })) : []).catch(() => [])
))
const issues = critiques.flat()
log(`critique: ${issues.length} issues, ${issues.filter(i => i.severity === 'critical').length} critical`)
phase('Revise')
const revision = await agent(CONTEXT + `
You are the lead designer. Revise ${BIBLE} to resolve these issues: change the design for every critical and major one, fix minors where cheap, justify any rejection. Keep the 8 work packages strictly disjoint with complete contracts. Append a "Critique resolution log" with one line per issue.
ISSUES: ${JSON.stringify(issues, null, 1)}
Return: the 10 most important changes, then the final work package list (name + owned paths, one line each).`, { label: 'revise', phase: 'Revise', effort: 'high' })
return { biblePath: BIBLE, issueCount: issues.length, revision }
