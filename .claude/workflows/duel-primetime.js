export const meta = {
  name: 'duel-primetime',
  description: 'Prime-time spectacle pass: night arena, glossy stage, glowing robots, big VFX, energetic combat and broadcast HUD, six disjoint areas in parallel',
  phases: [ { title: 'Build', detail: 'six areas against one art bible' } ],
}

const REPO = '/Users/aaroh/cadybot/wrestling_arena'
const D = REPO + '/docs/design'
const SSH = 'ssh -i ~/.ssh/homebase_ed25519 azureuser@100.108.213.121'

const ART_BIBLE = `
THE OWNER'S VERDICT on the current build (after playing it): "this reminds me of a badly made scratch game instead of the finals, do a lot better. its so boring, i wouldn't play this for shit, add some effects and put some polish on it PLEASE".
THE DIRECTOR'S DIAGNOSIS from a real-GPU look: it reads as an unlit grey-box prototype. Overcast grey light, a foggy white void for a background, a flat matte grey deck, matte plastic arms, a crowd of pale ghosts in fog, no light sources, nothing glowing, nothing moving, no contrast, no colour, no spectacle. The previous declutter pass removed noise but put nothing in its place.

ART DIRECTION, BINDING (overrides the high-key daylight direction in SCOPE.md 1.3 and finals-visual.md; everything else in those docs still applies):
"PRIME TIME" - TORQUE LIMIT is the headline night show. Think THE FINALS night arenas and a stadium title fight under lights: the world is dark and the light is the art.
- World: a dark stadium bowl in deep indigo/navy (#07081A to #141633), atmospheric haze, visible light shafts. The background is never a flat void: silhouetted stands, lit tiers, distant LED ribbons, rigging silhouettes against a glowing haze.
- The deck is the jewel: glossy black lacquer that REFLECTS the arms, lights and LED edges (drei MeshReflectorMaterial or equivalent, blurred, roughness ~0.2), team halves as crisp printed graphics, and bright emissive team-colour edge strips (cobalt #2A6BFF, magenta #FF2E7E) that pulse with the show and flash on hits.
- Light: a small number of STRONG, SATURATED, MOVING lights. Two sweeping spotlight cones with volumetric beams in team colours, a hard white key from above that makes crisp contact shadows, signal-orange (#FF4A1C) and volt-yellow (#FFD60A) accents. Bloom only on emissives and hot highlights; nothing lit blows out. Contrast-rich grade: deep blacks, saturated mids, ACES or AgX with a slight teal-shadow / warm-highlight split.
- Robots: glossy clearcoat automotive paint in team colours with bright specular highlights and rim light, dark metal joints, and EMISSIVE LED accents on each link that pulse with servo effort and flare white on impact.
- Motion everywhere: lights sweep, LED boards animate sponsor graphics (OHMSTEAD, PULPO POP, TORQUE LIMIT) and live match info, crowd holograms shimmer and react to hype, haze drifts.
- Spectacle: every hit sparks, flashes, rings and kicks the camera; heavy hits add shockwaves, electric arcs and debris; the KO is slow motion, a white flash, a team-colour shatter burst, confetti cannons and a crowd surge; the round start is the lights slamming on.
- Readability still wins: the opponent is always the brightest, clearest thing in the centre of the frame; the HUD is crisp and sparse; the IP line from SCOPE.md 1.1 holds (no FINALS names, logos, fonts, assets).
- Performance: 60 fps on an M1/M2 MacBook Air at 1280x720, DPR up to 1.25. Every effect pooled or instanced, no per-frame allocation, quality tiers respected, effects switched by uniforms, no shader compiles after boot.`

const BASE = `
You are on the TORQUE LIMIT team: a first-person 1v1 robot-arm fighting game (human vs AI) at ${REPO} (branch fps-duel). Binding docs: ${D}/SCOPE.md, ${D}/BUILD_PLAN.md, ${D}/GAME_DESIGN.md. Research: ${D}/research/*.md.
${ART_BIBLE}

SIX AREAS ARE EDITING THE TREE AT THE SAME TIME. Edit ONLY the files your area owns. Put cross-area needs in handoff; never touch another area's file.
WHERE WORK RUNS: edit only on the laptop at ${REPO}; push with 'bash ${REPO}/.claude/sync-now.sh'; heavy commands (tests, typecheck, lint, builds) run on homebase via ${SSH} 'cd ~/work/torque-limit && ...', DETACHED with nohup and polled (a tool call blocking over ~3 min kills your agent). Helpers only in ~/tl-tools/. Never edit on the server, commit, switch branches, or touch other tmux sessions/containers. Wait if server load (uptime) is above 12.
LOOKING AT YOUR WORK: headless software-GL shots on the server (~/tl-tools/shot.mjs, visshot.mjs, moments.mjs; window.__tl is the game handle) are fine for composition and crashes but cannot show bloom or reflections faithfully. Do NOT open a browser on the laptop; the director reviews on the real GPU after this phase.
SILENCE: nothing may ever play audio out loud.
RULES: no commits. Fix root causes, never weaken a test. Before you finish: typecheck and lint clean, and the tests you own green, on the server. No placeholders or dead buttons. Delete what your new work replaces.
PACING: many small tool calls, at most ~350 lines per Write, no long silent deliberation. RESUME-AWARE: read your files first; an earlier attempt may have been interrupted.`

const REPORT = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
  changed: { type: 'array', items: { type: 'string' } },
  verified: { type: 'array', items: { type: 'string' } },
  remaining: { type: 'array', items: { type: 'string' } },
  handoff: { type: 'array', items: { type: 'string' } },
}, required: ['status', 'changed', 'verified', 'remaining', 'handoff'] }

async function robust(p, o, t) {
  for (let i = 1; i <= (t || 4); i++) {
    try {
      const r = await agent(p + (i > 1 ? `\n(Attempt ${i}; continue from the current files.)` : ''), { ...o, label: o.label + (i > 1 ? '#' + i : '') })
      if (r) return r
    } catch (e) { log(`${o.label} ${i}: ${String(e).slice(0, 120)}`) }
  }
  return { status: 'blocked', changed: [], verified: [], remaining: ['failed after retries'], handoff: [] }
}

const AREAS = [
  { key: 'atmosphere', own: 'src/game/render/lighting.tsx, quality.ts, post-stack.tsx, cyclorama.tsx, arena-canvas.tsx, vfx/haze.ts, vfx/stage-cues.ts, and tests/interpolate.test.mjs',
    task: `ATMOSPHERE: turn the world into the prime-time night arena. Dark indigo bowl with silhouetted stands and lit tiers (cyclorama), drifting haze with visible light shafts, two sweeping volumetric spotlight cones in team colours plus a hard white key with crisp contact shadows, orange/yellow accent lights, and the round-start "lights slam on" cue (stage-cues). Post: bloom on emissives, the contrast-rich grade, vignette, subtle chromatic aberration reserved for big hits (driven by the existing juice uniforms), SMAA/MSAA per tier. Retune exposure so nothing blows out. Keep the tiers.` },
  { key: 'stage', own: 'src/game/render/stage.tsx, stage-deck.tsx, deck-texture.ts, led-strips.tsx, jumbotron.tsx, brand-textures.ts, holo-crowd.tsx, holo-crowd-material.ts, blob-shadows.ts, cubes-view.tsx, shadow-proxies.ts, range-arcs.tsx, and tests/deck-texture-layout.test.mjs, tests/crowd-instancing.test.mjs',
    task: `STAGE: make the deck the jewel and the arena alive. Glossy black reflective deck (MeshReflectorMaterial from drei 10.7 or an equivalent planar reflection, blurred, cheap tier fallback) with crisp printed team halves and centre graphics; bright emissive team-colour LED edge strips that breathe with the show and flash on hits (subscribe to bus events); animated LED sponsor boards and the jumbotron showing live match info; the Core cube and clutter cubes as glossy printed objects that catch highlights; the holographic crowd as shimmering glowing silhouettes in the dark stands that surge with hype. Replace the flat grey deck entirely.` },
  { key: 'robots', own: 'src/game/render/robot-materials.ts, robot-view.tsx, robot-decals.ts, robot-assets.ts, ghost-arm.tsx, and a new src/game/render/trails.ts, plus tests/stl-geometry.test.mjs',
    task: `ROBOTS: make the arms look like expensive show machines. Glossy clearcoat automotive paint in team colours with strong specular and rim response, dark anodized metal joints, crisp decals, and EMISSIVE LED accents on each link that pulse with measured servo effort (joint velocity / torque from the physics frame) and flare white on impact. Add motion trails: a ribbon trail from each gripper tip that appears above a speed threshold so a flick leaves a glowing arc in team colour (pooled geometry, no per-frame allocation), mounted from robot-view. The ghost arm must only show when the arm is actually blocked (keep that behaviour).` },
  { key: 'vfx', own: 'src/game/render/vfx/** EXCEPT vfx/haze.ts and vfx/stage-cues.ts, plus tests/vfx-pools.test.mjs, tests/derez-timeline.test.mjs',
    task: `VFX: make every impact spectacular and readable. Hot sparks with streak trails and gravity, a bright contact flash, an expanding shockwave ring on the deck, electric arcs between the arms on heavy hits and clashes, flying debris chips, deflect as a bright blue ring burst, the Core drop as a light column that stays readable (never covering the view), and the KO: slow-motion window cue, white flash, team-colour shatter/de-rez burst, confetti cannons from the stage edges. Everything pooled and budgeted per GAME_DESIGN 8.1 tiers, scaled by hit strength.` },
  { key: 'energy', own: 'src/game/camera/**, src/game/feedback/**, src/game/combat/tuning.ts, src/game/combat/abilities.ts, src/game/policy/**, src/game/match/**, and tests/juice.test.mjs, tests/hitstop-*.test.mjs, tests/cockpit-rig.test.mjs, tests/opponent-*.test.mjs, tests/dda.test.mjs, tests/match-director.test.mjs, tests/combat-abilities.test.mjs',
    task: `ENERGY: the owner said it is BORING. Make the fight exciting in the ARCADE preset only (stock/verification presets stay byte-identical): punchier hit stop and camera kick, a real slow-motion KO window, FOV punch on heavies, faster pacing (shorter dead time between rounds, quicker Core timing if it drags), and an AI that is aggressive, readable and fun: it pressures, feints, whiffs, and reacts, instead of standing still. Also finish the interrupted balance work already partly on disk: an opening grace so the AI cannot land damage before the player's first input each round, a gentler invisible ramp for a profile's first matches, and make tests/opponent-behavior.test.mjs green by fixing the real imbalance. Full suite, typecheck and lint green on the server.` },
  { key: 'broadcast', own: 'src/game/ui/** (all), src/app/globals.css, src/app/mobile.css, src/app/layout.tsx, src/game/brand/**, STYLES.md, and tests/hud-format.test.mjs, tests/banner-queue.test.mjs, tests/damage-number-merge.test.mjs, tests/styles-tokens.test.mjs, tests/copy-labels.test.mjs, tests/touch-*.test.mjs, tests/brand-marks.test.mjs, tests/ip-guard.test.mjs',
    task: `BROADCAST: a prime-time TV graphics package on a dark stage. Crisp HUD plates that read on dark (ink with glowing team edges), animated slam-in banners with motion blur feel, big kinetic callouts for FIRST BLOOD / CRIT / DEFLECT / STREAK / STEAL / KO with stagger animation, a live event ticker, a KO splash that sells the moment, round-intro and VS cards with light-sweep reveals, and menus restyled for the dark show (the green room lit like a backstage set). Keep zero overlaps, zero React commits per frame in-match, and the copy rules.` },
]

phase('Build')
const results = await parallel(AREAS.map(a => () =>
  robust(BASE + `\nYOUR AREA OWNS EXACTLY: ${a.own}\n` + a.task, { label: a.key, phase: 'Build', effort: 'high', schema: REPORT }, 4)
    .then(r => ({ area: a.key, ...r }))
))
for (const r of results) log(`${r.area}: ${r.status}`)
return { results }
