export const meta = {
  name: 'duel-wide',
  description: 'Wide parallel build-out: audio, announcer, feedback, HUD, screens, and touch UI, each on strictly disjoint files',
  phases: [
    { title: 'Build', detail: 'six areas writing code in parallel on disjoint files' },
  ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel).
Binding docs in precedence order: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Style guide: ${D}/research/finals-visual.md. Screenshot notes and known bugs: ${D}/screens/INDEX.md.
The game boots and plays end to end: 660 tests pass, typecheck and lint are clean, the harness verifies episodes bit-exact.

OTHER AGENTS ARE EDITING THE SAME TREE RIGHT NOW. Three other areas are live in parallel: render/** (visuals), the game core (loop, match, harness, policy, physics, combat, input, camera, core, contracts, game-handle, scripts, tools, tests), and packaging (package.json, next.config.ts, electron, capacitor, public/manifest, public/sw.js, docs/APPS.md).
Therefore: edit ONLY the files your area owns, listed below. Never edit a file outside that list, not even a one-line import. If you need a change elsewhere, put the exact request in your handoff. If a file you own does not exist yet, create it.

WHERE WORK RUNS. The director's laptop must stay free.
- Edit files ONLY on the laptop at ${REPO} (source of truth).
- Heavy commands run on the homebase server: push first with 'bash ${REPO}/.claude/sync-now.sh' (about 9 s), then e.g. ${SSH} 'cd ~/work/torque-limit && npx tsc --noEmit 2>&1 | tail -20'.
- Long commands (tests, builds) must NOT block your tool call for minutes: start them detached and poll, e.g. ${SSH} 'cd ~/work/torque-limit && nohup npm test > /tmp/<you>.log 2>&1 & echo started' then poll with ${SSH} 'tail -5 /tmp/<you>.log'. A tool call that blocks longer than about 3 minutes gets your agent killed and restarted.
- Never create files inside ~/work/torque-limit on the server (the mirror deletes them): server-side helpers go in ~/tl-tools/, outputs in /tmp.
- Never edit files on the server, never commit, never switch branches, never run "box down", never touch other tmux sessions, containers or ~/data. Its disk is 93% full.

RENDERING IS SCARCE. The server has only 8 vCPU and headless WebGL is software-rendered, so it is already saturated. Do NOT render unless you truly need a picture. Prefer unit tests, offline audio renders, and DOM-only checks. Before starting any headless browser run: ${SSH} 'uptime' and if the 1-minute load is above 12, wait and do something else first. Take screenshots at 1280x720, one at a time, never in parallel with your own second run.
BROWSER: NEVER open a browser on the laptop. Do NOT call preview_start, navigate or any mcp__Claude_Browser__* tool for any reason: that runs the game on the director's GPU, which they forbade. Headless server tools live in ~/tl-tools/ (shot.mjs, tlboot.mjs, moments.mjs, lab.mjs); read them before writing another.
SILENCE: nothing may ever play audio out loud. The headless runner mutes everything. Verify audio ONLY offline: OfflineAudioContext renders on the server, the game's renderAudioReport() hook, and unit tests. Never listen, never raise a volume, never enable host voice.

RULES: do not commit, push or switch branches. No placeholders, no dead buttons, no TODOs in shipped paths. Keep your area's tests, typecheck and lint green on the server before you finish. Quality bar: a polished 2026 AAA game that does not read as generated.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation.
RESUME-AWARE: a previous attempt may have been interrupted; read the files you own first and continue from there.`

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
    key: 'audio', label: 'E-audio',
    own: 'src/game/audio/** and tests/audio-graph.test.mjs, tests/synth-recipes.test.mjs, tests/music-score.test.mjs, tests/crowd-hype.test.mjs',
    task: `AREA E - AUDIO. Make the game SOUND like a televised fight show, entirely with procedural WebAudio (SCOPE.md section 3; no audio files exist and none may be added).
Raise every layer to shipping quality: impact one-shots that layer sub thump, mid body and high tick with per-hit randomisation and a distinct crit timbre; servo whine driven by joint velocity; a kill-confirm built as sub thump, servo ratchet, bell with its own rhythmic gap; guard, deflect and clash cues that are instantly distinguishable by ear; Core dock, lock ticks and steal stings; a crowd bed of filtered noise that swells, cheers and groans on bus events; a driving music bed with round-start, final-round and victory arrangements that duck under big moments; and a proper mix bus with limiting so nothing clips.
Verify OFFLINE only: render each cue through OfflineAudioContext on the server and assert peak, RMS, duration, spectral centroid and that no buffer contains NaN or clipping; check the full match mix by rendering a scripted event sequence. Report the measured table.`,
  },
  {
    key: 'announcer', label: 'F-announcer',
    own: 'src/game/announcer/** and tests/announcer.test.mjs, tests/host-lines.test.mjs',
    task: `AREA F - THE HOSTS. ROOK (hype) and DR. VALE (dry analyst who quotes real numbers) must carry the show without ever reading as machine-written.
Write a large, genuinely funny and characterful line set: every P1/P2/P3 event, round and match beats, Core drop/dock/steal/lock, KO, comeback, whiff streaks, overheats, first blood, close calls, and rare deep-cut lines that reward long sessions. Keep the copy rules from BUILD_PLAN decision D9 (<= 9 words, ROOK carries no numbers, >= 60% of VALE lines carry a real number token, banned-word list, at most one exclamation mark on a ROOK P1 line) and the budget (<= 6 lines per round, <= 2 P3, no repeat within the last 20, 3.5 s gap, stale lines dropped).
The lines must never repeat noticeably in a 5-match session and never sound templated. Vary sentence shape, not just nouns. Then verify with tests: budget, no-repeat, copy rules, token substitution with real physics values, and a simulated 5-match run that asserts no line repeats and every event class has enough distinct lines.`,
  },
  {
    key: 'feedback', label: 'G-feedback',
    own: 'src/game/feedback/** and tests/juice.test.mjs, tests/hitstop-budget.test.mjs, tests/hitstop-table.test.mjs',
    task: `AREA G - GAME FEEL. You own the feedback system that turns physics events into felt response (GAME_DESIGN 8.1 event table, 8.2 camera juice).
Make every event land: the channel budget by magnitude tier, hit stop scaled by hit strength and capped per window, camera kick and trauma shake, FOV punch, chromatic aberration reserved for KO and stagger, haptics, and the KO and lock sequences. Tune the numbers so a fast flick reads as heavier than a slow drag and a crit is unmistakable.
You cannot see or hear this headlessly, so prove it numerically: unit tests that feed a synthetic event stream and assert the emitted plans (channels, durations, magnitudes, budget ceilings, no chromatic aberration on ordinary hits, hit stop total within 120 ms per 600 ms) and that response scales monotonically with hit strength. Report the table of event to response.`,
  },
  {
    key: 'hud', label: 'H-hud',
    own: 'src/game/ui/hud/** and tests/hud-format.test.mjs, tests/banner-queue.test.mjs, tests/damage-number-merge.test.mjs',
    task: `AREA H - IN-MATCH HUD. You own every in-match HUD element (GAME_DESIGN 7.4).
Make the HUD broadcast-grade and instantly readable: integrity bars with chip and delayed-damage feel, the timer and round pips, damage numbers and hitmarkers, the crit and deflect cues, combo bracket, heat and overdrive meters, the Core state (incoming, dropped, carried, docked, lock countdown, contested, stolen), the caption plates for the hosts, low-integrity and sudden-death states, and the stats overlay on Tab. Zero React commits per frame: hot values go through refs and CSS variables as the existing hud-runtime does.
Add a clear TURBO affordance: in turbo the arena intentionally stops drawing, and right now that reads as a hang.
Verify with unit tests for formatting, queueing and merge rules, and with at most ONE headless screenshot at 1280x720 to confirm layout (respect the rendering-is-scarce rule).`,
  },
  {
    key: 'screens', label: 'I-screens',
    own: 'src/game/ui/screens/**, src/game/ui/kit/**, src/game/ui/meta/**, src/game/ui/broadcast-ui.tsx, src/app/globals.css, src/game/brand/**, STYLES.md and tests/styles-tokens.test.mjs, tests/copy-labels.test.mjs, tests/brand-marks.test.mjs, tests/ip-guard.test.mjs, tests/profile.test.mjs, tests/superlatives.test.mjs',
    task: `AREA I - SCREENS AND LAYOUT. You own every non-HUD screen and the stylesheet.
Fix the known layout bugs, each proven with a headless screenshot you actually open with the Read tool: the Lab VERIFY verdict is drawn under the results panel and sliced in half (screens/s29); long entrant names overflow the winner band and round band (s20, s19b); REGISTER ENTRANT is clipped at the right edge of the entrants row at 1440x900 (s05); the replay list issue in INDEX.md. Then sweep every screen at 1280x720, 1440x900 and 1920x1080 for clipping, overflow and overlap and fix what you find.
Then raise the screens themselves: the lobby should feel like a green room in a TV show rather than a menu, the post-match should sell bragging rights, and the whole set should obey the palette, one slant, and motion tiers. Keep every number real; no dead buttons.`,
  },
  {
    key: 'touch', label: 'J-touch-mobile',
    own: 'src/game/ui/touch/** (create it), src/app/mobile.css (create it), and tests/touch-input.test.mjs, tests/touch-layout.test.mjs (create the second)',
    task: `AREA J - PHONE AND TABLET. The current phone layout is not shippable (screens/s26-phone-touch-controls.png): at 390x844 the two virtual sticks overlap, the GRIP/DRIVE/GUARD/STRIKE/ABILITY cluster sits mid-screen on top of them, and the top HUD bar is clipped so both integrity bars run under the timer plate.
Design and build a real touch control scheme for this game in your own files: thumb-reachable absolute swing stick and stance stick in the bottom corners, action buttons along the edges within thumb arc, gestures that suit flick-based combat (a fast drag IS the strike), reach and guard within reach of the same thumbs, safe-area insets, and layouts for portrait 390x844 and landscape 844x390 plus tablet. Nothing may overlap or be clipped, and the fight must stay visible.
Existing touch logic lives in files you do NOT own (src/game/input/**, owned by another agent right now) - do not edit it. Build your components against it and put any required change in your handoff.
Your CSS goes in src/app/mobile.css; you cannot edit layout.tsx or globals.css, so put the one-line import request in your handoff.
Verify with layout unit tests over your own geometry functions, plus at most two headless screenshots (portrait and landscape) that you open with the Read tool.`,
  },
]

phase('Build')
const results = await parallel(AREAS.map(a => () =>
  robust(BASE + `\nYOUR AREA OWNS EXACTLY: ${a.own}\n` + a.task,
    { label: a.label, phase: 'Build', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
for (const r of results) log(`${r.area}: ${r.status}, remaining ${r.remaining.length}`)
return { results }
