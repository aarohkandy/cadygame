# TORQUE LIMIT: where things stand (integration pass, 2026-09-26)

> **The current state is the last section of this file** — *DIRECTOR'S REAL-GPU REVIEW — verification pass (2026-09-27)*. It supersedes the acceptance tables and the frame budget below wherever they disagree, and it carries the measurement recipes.

Branch `fps-duel`, everything uncommitted. Binding spec: `docs/design/EMOTION_BIBLE.md` (section 11 work packages, 11.9 contracts, 12.1 real-GPU checklist). The eight packages (WP1 perf/render, WP2 look, WP3 body, WP4 opponent, WP5 feel, WP6 show flow, WP7 broadcast, WP8 sound + data) have landed and this pass applied every cross-package handoff, resolved the double-implementations, and greened the tree on homebase.

## Play it

```bash
cd /Users/aaroh/cadybot/wrestling_arena && PORT=3100 npm run dev
```

Open http://localhost:3100 (port 3000 is another project). Boot: arena shell → attract loop under the wordmark → `LOADING nn %` → `CLICK TO FIGHT` (the click holds ≤ 1.5 s on the shader prewarm). Click = match 1: best-of-3 vs BACKLASH Rookie, round 1 is the sparring bench (HIT IT / GUARD · HOLD RMB / GRAB IT / BRING IT HOME / HOLD IT · n; 0 damage both ways; ends only by your lock), rounds 2–3 real at 30 s with the first-strike tiebreak and no Sudden Death. Mouse aims, LMB jab/charge, RMB guard, W/S reach, Space grip, Esc pause (STABLE camera toggle lives in the pause menu). `?debug=feel` shows programs (prewarm baseline), worst frame since FIGHT, round max roll/FOV/trauma vs the 3.5 caps, the compile log; `?debug=greycard` the 5.3 calibration.

## Tree state on homebase (`~/work/torque-limit`, synced from the laptop)

- `npm run typecheck` → exit 0 (whole tree).
- `npm run lint` → exit 0 (whole tree).
- `npm test` → see the final numbers at the bottom of this file (the run that produced them is `/tmp/integ-final-test.log` on homebase).
- `node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js` → the smoke suite incl. the REPLAY BIT-EXACT gate (was red mid-pass, see "what this pass fixed").
- `npm run build` → see the bottom of this file.

## What this pass integrated (every handoff from the eight reports)

Contracts (`src/game/contracts.ts`, additive): `GameEvent` gains the `show` carrier (`{ type: "show", show: ShowEvent }`) and `strike.whip?`; `RulesConfig.sparring` / `noSuddenDeath`; `PolicyDebug.affect / show / gaze / tier`; `JuiceOutput.trauma`; `FeedbackSystem.frame: FeedbackFrame`; `CreateFeedbackSystem` deps take `pilot` and `policy`; `HudSeat.policy.tier`; `EpisodeMeta.rules.sparring / noSuddenDeath` (so a re-simulation runs the same show rules).

Wiring that now exists end to end:
- **Opponent character channel**: `sim-driver.noteDebug` puts WP4's `show` events on the bus and keeps `affect` / effective `tier` on the seat telemetry (`hud.seats[s].policy.tier`). feedback-system forwards show events to the announcer (`onShowEvents`) and sets `setAffect` from the opponent seat every frame; hud-runtime draws `WHIP` (strike `whip` flag) and coaches `GUARD · HOLD RMB` on a SLAM tell in the SPARRING tier. `opponentMemory` rides `ResetContext` through `sim.resetDrivers(round, overrides, memory)` (EMPTY for HARNESS / fresh profiles).
- **Pilot body**: `game-handle` subscribes the bus to `pilot.onEvents`; the director drives `setRitual` across `boot_ritual` + `count_in` (1800 ms first time, 600 ms rematch); `settings.camera.fovDeg` 58; `pilot.reticle` feeds the HUD crosshair ring; `pilot.tremorMm` folds into `FeedbackFrame.vibration`; an aim reversal ticks the haptics; gripper stages and the ghost-leash crossings (0.6 tick / 1.0 buzz) play WP8's recipes.
- **Render**: robot-view uses `RIM_GAIN` (rival 4.0 / pilot 1.2), per-seat decal placements (01 / 02), writes the shells' per-link LED uniform (pilot: WP3's LED state machine, also on the LED beads; opponent: servo effort in the team colour), paints `FeedbackFrame.ledFlare` white and adds the 30 Hz `vibration` on the upper links; led-strips flood the struck edge from `deckFlash`; holo-crowd leans from `FeedbackFrame.hypeLean` (stage-cues' copy deleted); post-stack reads `impactFrame` and `lensSmear` (chromatic + vignette, no new program); quality.ts key azimuth 110°, the dead `rim / sweep / beam / fog` blocks deleted; ghost-arm no longer decimates the already-LOD1 link geometry; every VFX pool and the gripper trail draw once before the prewarm; the reticle overlay's own scene is registered for the prewarm (it was the one program that compiled at the first FIGHT).
- **Rules and show flow**: `showRulesFor(cfg)` (match-config) puts `sparring: "round1" | "tier" | null` and `noSuddenDeath` on the live `RulesConfig` per round and into `EpisodeMeta.rules`; `determinism.ts` rebuilds them (`showRulesFromMeta`) and skips `show` / `task_success` events (non-rules); KO slow-mo is one source (`KO_SLOWMO` 0.3× / 700 ms in juice.ts, the director's `KO_DILATION` reads it); the drill emits `task_success`; the FIGHT slam is one (match-intro in the show flow, hud-runtime only in the Lab); host captions stay off while the sparring script drives (its overlay is the one caption); `GG? TAP · LMB` on the outro window; the GG/verdict consent strip and the round-card one-tap label render WP7's kit components (WP6's copies and the unused `kit/result-slab.tsx` deleted); the `LOADING` CTA waits on `prewarmStatus.ready` (≤ 1.5 s).
- **Sound**: host speech pitch/rate follow `speechFor(ramp, release)`; caption reveal speed reads the same prosody table (hud-runtime's local constants deleted); the announcer gets the crowd hype getter.
- **Housekeeping**: `npm run bake:meshes`; `docs/HARNESS.md` says `torquelimit.episode/4`; `tests/settings.test.mjs` (FOV 58), `tests/match-director.test.mjs` (KO row from the bible), `tests/announcer.test.mjs` (prosody) updated to the spec.

### What this pass fixed that the packages could not see
- **Re-simulation was no longer bit-exact** (`tests/replay-verify.test.mjs`, `tests/eval-cli.test.mjs`, the smoke suite's REPLAY BIT-EXACT gate): WP4's `show` debug + the new sim-driver forwarding put `show` events into recordings, and the re-sim treated them as rules events. Bisected against the pre-pass snapshot on homebase (`~/tl-tools/integ-pre`, `integ-bisect*.sh`); fixed in `determinism.ts NON_RULES_EVENTS`.
- The first `rulesConfigFor` change crashed the re-sim (`humanSeatOf` on a meta-only config); the show flags moved to the director + episode meta instead.
- The sparring round slid the own bar in and printed `-31` from `physicalDamage` while `damage` was 0 (hud-runtime now uses physical damage only under physical scoring).

## Headless verification on homebase (SwiftShader, muted, `~/tl-tools/integ-show.mjs`, `integ-prog*.mjs`)

Boot → title at 4.6 s, prewarm linked at 17 s (58 programs), `CLICK TO FIGHT` with `phase=attract`, `matchesPlayed=0`; click → `entrance → boot_ritual → count_in → round_intro → fight` in the `tutorial` screen with `SPARRING` on the plate, gate `timer/tags/kit = false`, `tutorial=true`; 45 s of the sparring round: draw calls 71 (min 71 / max 75), triangles 121 573 (max 137 788); then a quick human_proxy vs BACKLASH Rookie round: 7 min of fight, draw calls 74 (74–76), triangles 166 477 (max 166 585), no KO reached under software GL. Page errors 0, network failures 0, context loss 0. GL log: only `KHR_parallel_shader_compile not supported` (SwiftShader; the prewarm falls back to the synchronous link) and the `[post]` compile-log line, which named exactly one program appearing at the first FIGHT: the reticle overlay ring (identified from its uniforms); it is now in the prewarm. The re-run after that fix is the last line of this file.

**Not driven headless:** the sparring round → verdict transition (it ends only by the pilot's lock; a mouse-driven dock under SwiftShader at ~1 fps is not reachable), so the verdict screen, the rematch memory caption, the round card and the consent strip are rendered but unverified here; a real round's KO / round_summary / post_match were not reached in the 7-minute window.

## Real-GPU review checklist for the director (EMOTION_BIBLE 12.1: M1/M2 Air, Chrome, 1280 × 720, DPR 1.25, muted, close the tab after)

1. `?debug=feel` after a 3-round ARCADE match with a KO, a deflect, a steal and a tier change: programs N = M (the prewarm baseline) outside the tier change's safe phase and again before the next `fight`; 0 frames > 25 ms after FIGHT; p95 ≤ 16.7 ms; draws ≤ 90; triangles ≤ 0.45 M; max roll ≤ 3°, FOV ≤ 6°, trauma ≤ 0.35 (the panel prints all of these).
2. `?debug=greycard`: 0.34 ± 0.03 with `predictDisplayValue` agreeing (the unit test predicts 0.35). Mid-fight greyscale thumbnail: opponent > pilot arm > deck > bowl; histogram ≥ 5 % ≤ 0.03, ≥ 0.5 % ≥ 0.95, bloom < 5 %.
3. Rest pose (READY, reticle on the opponent's gripper): continuous magenta rim on the opponent that blooms (gain 4.0 is now applied), none on the bowl; its mount and both LED lines inside the centre 60 %; crowd ≤ 18 % and not pink/blue; one static ribbon; boards dim and still; no deck hazard; no reach arcs; dock ring invisible; own forearm solid; both arms unfogged.
4. 10 s idle recording: both arms breathing (pilot: command-side breath; opponent: WP4 layers), opponent gaze tracking, weight shifts, five background layers moving, nothing fast.
5. Move the mouse once: view turns the same frame, ghost ring moves, whine starts, LED lights, arm follows and overshoots; phone slow-mo onset ≤ 45 ms.
6. Land a heavy: freeze, sound on the frame, victim shivers on the contact frame and through the freeze (`FeedbackFrame.vibration`), sparks stay 10 s, number pops, deck edge flashes (`deckFlash`), crowd `ohh`, one caption unit. Take a heavy: the view kicks away from the side hit; the lens smear (chromatic + vignette) decays over ~6 s.
7. Hit a guard: 0.5° shove, stall growl, `BLOCKED`. Block one: zero shake.
8. Bait a SLAM: the opponent's LED and whine lead by ≥ 250 ms (per-link LED uniform now written); whiff it: `OPEN`; punish: `PUNISH`; a strike inside the 300 ms reversal carry: `WHIP` (match 2+).
9. Dock the Core: siren (match 2+); let it be stolen: alarm ≤ 100 ms, red ring, red edge, `STEAL IN PROGRESS`; last 3 s: drums out, stomps, hosts silent; a steal that begins inside the last 5 s holds the round open (10 s cap).
10. KO: 0.3× for 700 ms, white flash, two impact frames, de-rez, cone on the winner, slump with the falling whine, confirm → roar → ROOK at +650 ms; loser's arm silent after.
11. Fresh profile (only after item 1 passes): silent until the click; tab open → first hit ≤ 15 s; round 1 won by ~44 s with ≤ 12 text events; the round-2 intro is the same arm standing up; verdict ≤ 6 s with one button; rematch in 3.4 s with the loser's sulk and the memory caption; after match 2 the consent strip inert for 1.5 s, then SYSTEMS CHECK once.
12. Eyes-shut: hit / miss / blocked / dealt / taken from sound and rumble, 9/10.
13. Five-person recognition of flinch, taunt, celebration, dejection clips ≥ 60 %.
14. PROVING GROUND and HARNESS episodes re-simulate BIT-EXACT against a pre-pass recording (headless: green again, see above); an ARCADE episode with a non-empty `opponentMemory` re-simulates BIT-EXACT against itself (WP4's determinism test covers the memory half; a recorded human match has not been re-simulated).

## Known gaps after this pass (honest list)

- **No real-GPU pass yet**: every acceptance in 12.1 is unverified on hardware; headless SwiftShader proves counts, phases and error-free boot only.
- `human.raw / active / gazeHint` columns (episode /4) are declared but the pilot exposes no raw sample; the recorder derives `active` from the command and leaves `raw` NaN.
- The upload receiver (Cloudflare Worker + R2) does not exist; `createUploadQueue` is not called from the verdict (nothing to send to), so `SHARE` only stores consent.
- The per-match one-tap label (hearts / CLEAN–SLOPPY) has no post-end recorder path; the per-round intent label is stored.
- `pilot.onMotion` → ≤ 5 ms whine onset is not wired (the whine follows measured joint speed within a control tick); LED-state sounds (3.3) beyond the boot chirps are not wired.
- 10.2 step 6 (skinned merge, 28 → 8 draws per arm) not started; DEFAULT reads 74–76 draws / 166 k triangles headless, inside the ≤ 90 / ≤ 0.45 M budget already.
- The LLL rule exists twice: the director drops the tier on rematch from the persisted loss streak, and the worker's in-memory ledger drops it within a session on any match; the ledger key includes the tier so the two agree rather than stack (a double drop is not possible), but a daily bout after two losses in a session drops only through the worker.
- CORNER v1 k-NN driver, demo v0 video, docs other than HARNESS.md, and the cockpit replay camera for `scripts/demo-capture.mjs` shots 4/6/9 are not done.
- Dev-only: `checkMaterialsReady … isReady` page errors reported by WP2 under StrictMode double-mount were not reproduced in the integration probe (0 page errors).

## Rules that bit

- Never open a browser on the laptop; one headless browser at a time on homebase; nothing plays audio.
- `~/tl-tools/integ-pre` is the pre-pass tree snapshot on homebase and `integ-bisect.sh` / `integ-bisect-rev.sh` overlay single paths onto it — the fastest way to find which package broke a frozen test.
- Sync with `.claude/sync-now.sh` before every remote command; never edit on the server.

## Final numbers (filled by the integration run)

All on homebase `~/work/torque-limit`, synced from the laptop at the end of the pass:

- `npm run typecheck` → `EXIT=0`.
- `npm run lint` → `EXIT=0` (whole tree; the last three render edits re-linted individually, exit 0).
- `npm test` → `# tests 914 / # pass 914 / # fail 0`, `EXIT=0` (was 902/12 at the start of integration: host-voice prosody, the KO row, eval CLI ×2, replay verify ×8 — all root-caused above).
- `node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js` → `PASS REPLAY BIT-EXACT · 1 … SMOKE PASSED · 6 episodes`, `EXIT=0`.
- `npm run build` → `EXIT=0` (Next static export).
- Headless program count after the reticle fixes (`~/tl-tools/integ-prog.mjs`): `attract: 59 programs` → `fight: 59 programs, new ids (none)` — FLAT. The second reticle variant was three keying the program on the target's colour space (`srgb-linear` scratch target vs the `srgb` canvas); `prewarmScene` now compiles the overlay scenes against the canvas and the ring material is `toneMapped: false`.
- Headless show run (`~/tl-tools/integ-show.mjs`, log `/tmp/integ-show.log`): page errors 0, GL driver warnings 0 (the two logged lines are SwiftShader's missing `KHR_parallel_shader_compile` and our own `[post]` compile log), network failures 0, context loss 0; sparring round 71 draws / 121 573 triangles, real round 74 draws / 166 477 triangles per frame.

---

# GROUNDING + THEATRE — integration (2026-09-27)

Two role passes against `docs/design/GROUNDING.md`, and this one review pass over both. PART 1 (grounding)
shipped on 2026-09-26 and had to survive; PART 2 (theatre) is the pass the director asked for after seeing
PART 1 on hardware — *"the grounding worked, but the show is gone; it reads as a dim workshop instead of a
televised night arena."* Four roles worked PART 2 (relight, arena, surfaces, ui); relight came back blocked
and its work did not land. This section is what the world actually looks like now, measured.

## What the world looks like now

**The deck is a real object and it is the lit island.** 18 mm plate, brushed-aluminium trim with a chamfered
arris, 14 countersunk M5 heads with dirt rings, two ESD rubber mat panels with a 3 mm seam, worn printed
graphics, milled dock recesses, baked contact AO under every footprint. What changed in PART 2 is its
*value*: the mat was grading to a mean of 0.027 display with 88 % of it under 0.06 — the largest object in a
cockpit frame was effectively black, and every midtone the histogram wanted was missing from the mat rather
than from the room. Its albedo is now lifted 1.7× in the mat's own fragment patch (`MAT_ALBEDO_LIFT`), which
is the single change that gave the frame a mid-range: the mat now measures **0.256 inside a par pool and
0.063 outside one**, a real range on the biggest surface on screen, while staying four to six stops under
the opponent.

**Past the deck edge is a dark room, not a pale plane.** The real "dead flat grey wall" of the director's
note was not the cyclorama but `studio-floor`: `fade` only ever scaled diffuse, and at the grazing angle the
cockpit sees the far concrete at, Fresnel drives a dielectric's specular to ~1, so beyond the barrier the
floor mirrored the environment whole as a flat untextured plane brighter than the opponent. `FLOOR_SPEC`
now scales `material.specularColor` / `specularColorBlended` / `specularF90` by the same distance curve
(floor-box lids keep their metal through `metalnessFactor`), the fade is steepened, `FLOOR_LEVEL` is 0.62,
and a 30 cm mottle carries material at the distances where the 5 mm aggregate dies. Measured: the studio
floor is **0.131** against the opponent's 0.455.

**The back of the room is inside the frame.** Every architectural feature in `cyclorama` used to be drawn
above the top of the cockpit frame and therefore never drawn at all: the eye is 0.36 m over the deck pitched
18.7° down through a 58° lens, so the frame top is elevation 0.180 and the crowd's skyline occludes to 0.115
— the wall is only ever seen in a 0.065-wide band, and the portals were laid at 0.176–0.268 with the ribbon
cove at 0.300. `ROOM_LIFT` 0.55 and a single `ela = el / ROOM_LIFT` layout space put the portal heads at
2.6 m, the ribbon cove at 2.9 m and the back-of-house floor at 3.2 m, which is where a televised arena's
fascia actually is. The haze was cut from 0.019/0.023/0.052 to 0.0038/0.0047/0.0090 and its centre moved from
elevation 0.205 to 0.075: it had been laying ~0.038 linear of flat blue over the whole visible wall, brighter
than the crowd standing in front of it, and it is now a backlight behind the crowd's heads.

**The crowd is people.** 1.70 m figures on a two-row rake at 14 m — the same human scale as the 1.22 m
tripods and the flight case inside the barrier — with the body/outline weights lifted from `0.55 + 1.2·edge`
to `1.00 + 2.10·edge`, because at the old weights 160 people were drawn at the same value as the wall behind
them and dissolved into one dead mass. Measured at **0.054**, 8.5× darker than the opponent: dim and
glittering, never near the fight.

**The machines are lit, not tinted.** Shell metalness 0.26, `SHELL_ENV_INTENSITY` 2.4, rim gain 2.2 pilot /
4.0 rival, the arris polished sharper than the face in both base roughness and coat. Clutter cubes now
evaluate the two par-can sweep cones themselves (`DECK_POOL_GLSL` with the world position and normal of the
*instance*) — a prop standing inside a pool of light was the one object that pool did not light — and carry
a mat bounce weighted by `(0.5 − 0.5·worldN.y)` that lifts the foot of each block off black.

**The air has beams again, and they are beams.** See "the two bugs this pass found by looking" below.

**Quiet UI.** The tote rides `--hud-scale` like the rest of the HUD instead of being hard-coded at 1080p, so
it holds the same fraction of the frame at both resolutions (it was 7.8 % of a 720p frame against 5.2 % of a
1080p one — half again as much). `tests/styles-tokens.test.mjs` now fails the moment a px size in the tote
stops going through `--hud-scale`.

## The two bugs this pass found by looking at frames rather than at diffs

**The light shafts were drawn inside-out, and the obvious fix is worse.** Three hard-edged straight-sided
translucent wedges crossed every frame top to bottom and were the least convincing thing on screen. The cause
is in `vfx/haze.ts`: the path-length term was `pow(1 − |V·N|, 1.4)` on the cone shell's radial normal, which
is *maximum exactly on the beam's own silhouette*, so each cone terminated on a polygon boundary at full
strength. The physical term is the chord, `|V·N|`, bright through the middle and zero at the edge — and
swapping to it was measured and **paints the whole cockpit frame a flat saturated blue** (`revA-clean.png`:
mean 0.322, 77.8 % of all pixels inside one 16th-of-range bucket, zero pixels at or below 0.03), because the
cockpit eye sits *inside* the team key-fill cones and an enveloping cone is then at full strength over every
pixel. The sign that is wrong for a camera outside the cone is the only one that is safe for a camera inside
it. Shipped: keep the safe sign and fade only the last sliver, `* smoothstep(0.0, 0.12, |V·N|)`, which costs
nothing at the core (the first term is already zero there) and removes the hard termination. Both states were
rendered and read; the fix is visible in `revC-clean.png` and `revC-wide.png` as cones with no edge.

**Two faces of steel on exactly the same plane.** The pilot's mount plate carried a green speckled patch
across its face from the cockpit — reported as "a broken dirt or vertex-colour layer". It was z-fighting:
`rigging.tsx` put the clean machined face at `top − 0.0011` with a 0.0022 thickness and the weathered plate
around it at `top − THICK/2` with thickness `THICK`, so both tops landed on `top` to the micron and the depth
buffer picked per pixel. The machined face now stands 0.2 mm proud, which is a real machining step and more
depth than the buffer can confuse. Gone in `revC-wide.png`.

## Handoffs: applied, resolved, and one declined on measurement

Applied:

- **`stage-deck` mat albedo × 1.7** (arena → deck owner). The one lever that moved the frame's mean; the
  studio floor was not it (that role raised `FLOOR_LEVEL` 0.34 → 0.48 → 0.62 and the whole-frame mean moved
  0.1084 → 0.1076).
- **`rigging` `envMapIntensity` 0.42 → 0.62** (surfaces → rigging), matching `stage-deck`'s
  `TRIM_ENV_INTENSITY`: the apron extrusion and the deck trim are two parts of the same stock 2 mm apart and
  were reflecting the room by different amounts.
- **The mount-plate defect** (surfaces → rigging), root-caused above rather than papered over.
- **The gripper status LEDs** (surfaces → robot-view/VFX). They blew to pure white and bloomed into
  colourless ~50 px blobs in front of the machine. The quads and their material were correct; the drive
  reached 9–10 linear against a 0.98 bloom threshold. `LED_CAP` 1.6 / `LED_FLARE_CAP` 4 cap the bead's
  radiance a little over the threshold and let only the 250 ms impact flare go higher. Visible in
  `revC-wide.png`: the elbow bead is now a tight bright point, not a blob. See "what still fails" for the
  one place this did not finish the job.
- **The truss cones** (arena → truss/VFX). The suggested fix was a radial fade on the cone; the actual cause
  was the inverted path-length term above, and a radial fade would have been a second fade on top of the term
  that was already the radial fade, with the sign wrong.

**Declined, on measurement — this is the one thing two roles each assumed the other had settled.** The
surfaces role tuned every material against `CALIBRATION` key 3.2 at 48°, `environmentIntensity` 0.7, exposure
0.7, `grade.contrast` 1.58, and asked the relight role for exactly one value: `CALIBRATION.hemisphere`
`intensity: 0.12 → 0.30`, to lift the vertical faces of props off black. Relight came back blocked, so the
value never moved and the materials shipped tuned against a fill that does not exist. I applied it, measured
it, and reverted it:

- The sky colour `#1C2352` is 0.0205 luminance. At intensity 0.30 an upward Lambert surface receives 0.0062
  irradiance against the key's `3.2 · sin 48° = 2.38` — **two and a half thousandths of the frame's light**,
  and a vertical face gets half of that. It cannot move a side face that a 1.58 power toe is crushing.
- It also fails `tests/interpolate.test.mjs` "the 5.3 calibration triple", which pins the whole triple
  (`0.3 !== 0.12`), and that test is right to: the hemisphere is part of a calibration, not a dial.
- The lever that *does* move a prop's dark side is the environment — a real area light — through each
  material's own `envMapIntensity`, and surfaces had already pulled it: `CUBE_ENV_INTENSITY` 2.2,
  `SHELL_ENV_INTENSITY` 2.4. Because the hemisphere did not move, **no compensation is owed on either
  constant**; surfaces' own note said the 0.7× retune would only have been needed on the
  `environmentIntensity` alternative.

The arithmetic is now written into the comment on `CALIBRATION.hemisphere` so the next pass does not spend a
render cycle rediscovering it.

## PART 2 acceptance, walked against frames that were opened and read

Evidence: homebase, SwiftShader, muted, DEFAULT, 1280 × 720, cockpit forced, a **live** round frozen
mid-fight (`~/tl-tools/rev-shots.mjs`, log `/tmp/rev-shotC.log`, `ERRORS []`), plus a Rec.709 greyscale of the
same frame and a broadcast wide. Frames: `revC-clean.png`, `revC-clean-grey.png`, `revC-wide.png`. Every
number below is `ffmpeg` rgb24 → Rec.709 luma over the named crop, not an estimate.

Whole-frame histogram of the cockpit fight frame:
`mean 0.1127 · ≤ 0.03 = 43.92 % · ≤ 0.06 = 51.87 % · ≥ 0.85 = 1.37 % · ≥ 0.95 = 0.68 %`.

Region luminance, same frame: opponent **0.4553** · deck mat in a pool **0.2557** · pilot arm **0.1953** ·
studio floor **0.1307** · deck mat outside a pool **0.0628** · crowd band **0.0536** · back wall **0.0529**.

| # | PART 2 acceptance | Verdict |
|---|---|---|
| 1 | ≥ 5 % ≤ 0.03, ≥ 0.5 % ≥ 0.85, mean 0.12–0.28 | **FAIL** — two of three |
| 2 | A swing visibly moves a specular highlight along the shell | **NOT VERIFIABLE HEADLESS** |
| 3 | Opponent brightest large object; back wall ≥ 8× darker | **PASS** (8.6×) |
| 4 | Three depth planes separable in a still | **PASS** |
| 5 | No region over a fifth of the screen is flat untextured grey | **PASS** |
| 6 | Crowd and furniture at one human scale; deck reads ~1 m | **PASS** (arithmetic + wide frame) |
| 7 | The Core is identifiable as the prize within one second | **NOT VERIFIED** |
| 8 | No caption or prompt taller than 6 % of frame height | **PASS** |
| 9 | PART 1 still passes and the budget holds | **FAIL on draws** |

1. **FAIL, narrowly, and not where anyone expected.** 43.92 % of pixels sit at or below 0.03 (gate 5 %) and
   1.37 % at or above 0.85 (gate 0.5 %) — both pass with a wide margin, and the ≤ 0.03 number was **0.00 %**
   before PART 2, so the frame went from having no black in it at all to having deep true blacks. The mean is
   0.1127 against a 0.12 floor: short by 0.007. It is no longer the mat — the mat now measures 0.256 lit /
   0.063 unlit, and lifting it further would start to close the 8.6× back-wall gate in acceptance 3, which
   has only 7 % of margin left. What is left is *composition*: in this look direction roughly 45 % of the
   frame is unlit room (the right-hand quadrant measures mean 0.0367 with 96.7 % of it in two buckets). The
   honest lever is the cockpit's look direction — `COCKPIT_EYE_EGO` / `COCKPIT_TARGET_EGO` in
   `camera-math.ts` — which is a camera change and not a set change, and not something to do blind at the end
   of an integration pass.
2. Needs a GPU and needs motion. Two static frames each show a highlight on a shell; nobody has seen a
   highlight *travel* across one during a swing, and SwiftShader will not show clearcoat faithfully anyway.
3. **PASS.** Opponent 0.4553, back wall 0.0529 → 8.6×, against a gate of 8×. The crowd band at 0.0536 is
   8.5×. In the greyscale the pink opponent is unambiguously the brightest large object in the frame.
4. **PASS.** In `revC-clean-grey.png` the viewmodel arm, the opponent and the room are three clearly separate
   value planes, with the soft-edged beams carrying the air between them.
5. **PASS.** The 150 px back band (20.8 % of the frame, the region the director called "a dead grey void")
   has a real distribution — 16-bucket shape `81.6 / 6.5 / 4.4 / 2.9 / 2.0 / 1.3 / 0.8 / 0.3 / 0.1` — and
   reads as sponsor boards, a ribbon, portals and a crowd rake, all dark. Nothing over a fifth of the screen
   is one flat value.
6. **PASS** on the numbers and on the wide frame: 1.70 m crowd at 14 m, 1.22 m tripods, a 220 mm acrylic
   barrier on posts with base flanges, a 1.10 m deck. The barrier posts and the deck in `revC-wide.png` read
   at a consistent scale. Not tested on a person who has never seen the game.
7. **NOT VERIFIED.** The Core was not loose on the mat in any frame the harness would give. Argued from the
   code (volt albedo, machined-and-lacquered surface, diffuser-seam bleed 0.90 just under the 0.98 bloom
   gate) and not seen.
8. **PASS.** `.tut__line` is `clamp(15px, min(2.9vh, 2.4vw), 36px)` plus 11 px of padding — 4.8 % of a 720p
   frame and 4.3 % of a 1080p one, both in the lower third, and `tests/styles-tokens.test.mjs` holds the
   arithmetic. In `revC-clean.png` the live damage caption measures 3.6 % of frame height.
9. PART 1 below; the budget fails on draw calls at DEFAULT.

## PART 1 acceptance: did the grounding survive?

| # | PART 1 acceptance | Verdict |
|---|---|---|
| 1 | Squint order; nothing in the background brighter than the opponent | **PASS** |
| 2 | Every object touching the deck has a contact shadow | **PASS** |
| 3 | Greyscale shows four materials by specular response alone | **PASS** (provisional) |
| 4 | Cable harness and mount bolts visible without hunting | **PASS** |
| 5 | A viewer guesses the deck is about a metre across | **NOT VERIFIED** |
| 6 | Every bright pool on the deck has an identifiable fixture | **PARTIAL** |
| 7 | Nothing emits but LED strips, screens, status LEDs and hot VFX | **PASS** |
| 8 | ≤ 90 draws, ≤ 0.45 M triangles, programs flat | **FAIL on draws** |

1. **PASS, and better than last pass.** Measured order: opponent 0.455 → lit mat 0.256 → pilot arm 0.195 →
   studio floor 0.131 → unlit mat 0.063 → crowd 0.054 → back wall 0.053. Nothing behind the fight comes near
   the opponent. The pale plane beyond the barrier that used to beat it is gone.
2. **PASS.** In `revC-wide.png` every cube sits in a tight dark patch, both mount plates sit in a baked
   dirt-and-AO footprint, the barrier posts have flanged contact darkening and the deck throws a shadow onto
   the concrete.
3. **PASS, provisional.** The greyscale separates matte grainy rubber, a hard bright specular band on the
   trim and apron, dark satin paint with a roll along each link, and lighter matte anodised servo blocks.
   `highlightSharpness()` pins the ordering numerically (grip pad 0.07 / servo 0.44 / optics 0.80 / shell
   0.96) in `tests/crowd-instancing.test.mjs`. SwiftShader renders clearcoat and anisotropy poorly, so the
   sharp-versus-broad half is inferred.
4. **PASS.** Both braided harnesses leave their base, sag into the tray, cross the trim and drop into a floor
   box; the mount plates and their M6 heads read at a glance, and now without the speckle.
5. **NOT VERIFIED** by eye on a naive viewer. The furniture is at arithmetic-correct scale and
   `tests/rigging-geometry.test.mjs` holds it.
6. **PARTIAL, unchanged.** Every cone is derived from the aperture of the can that throws it, so fixture and
   pool cannot drift apart, but the truss sits above the cockpit's 18° downward look and the can itself is
   out of frame from the acceptance camera.
7. **PASS.** This pass added no emitter and removed brightness from two: the LED beads are capped and the
   beams no longer paint their own silhouettes.
8. Below.

## Frame budget

Measured the way the game measures it — `gl.info.autoReset = false`, one `reset()` per frame, so these are
whole-frame totals across the shadow, reflection, world, overlay and post passes — at 1280 × 720, cockpit,
in a **live** round with a human seat (never in turbo, where the canvas does not draw and `gl.info` is
stale), median of 12 consecutive frames. Tool: `~/tl-tools/rev-budget.mjs`.

| tier | draw calls (min / **med** / max) | triangles (med) | programs |
|---|---|---|---|
| LOW | 69 / **70** / 72 | 146 422 | 57 |
| DEFAULT | 88 / **94** / 100 | 177 352 | 64 |
| HIGH | 102 / **104** / 110 | 177 148 | 69 |
| gate (DEFAULT) | ≤ 90 | ≤ 0.45 M | flat after prewarm |

Triangles pass at every tier with 2.5× headroom. Programs are flat after prewarm and **this pass added no
program and no draw**: every change is extra lines inside an existing patched shader, a constant, or a
per-frame clamp, and `customProgramCacheKey` discipline is intact on every material touched. `ERRORS []` on
every run that produced a number here.

Draw calls at DEFAULT are **4 over the gate at the median of a live round** and exactly at it in a quiet one.
Per-object attribution on a 90-call quiet frame (`~/tl-tools/rev-attrib.mjs`, same reset discipline — with
`autoReset` left on, every row reads 0, which is the bug that made the last pass's attribution useless):

| object | draws | triangles |
|---|---|---|
| `arm-blaze` (opponent, all links) | 19 | 53 349 |
| `stage` | 15 | 17 146 |
| `arm-atlas` (pilot viewmodel) | 9 | 58 607 |
| `vfx` (all pools) | 6 | 2 440 |
| `truss-rig` | 3 | 4 984 |
| `cubes` | 3 | 8 100 |
| `led-strips` / `safety-screen` / `blob-shadows` / `light-shafts` / `haze` / `leash` | 2 each | ≤ 3 072 each |
| `studio-floor` / `rigging` / `cyc-wall` / `crowd-risers` / `holo-crowd` / `deck-plate` / `deck-trim` / `deck-bolts` / `ribbon-dasher` / `sponsor-boards` / `truss-tubes` / `truss-cans` / `truss-lenses` | 1 each | ≤ 7 228 each |

**28 of the frame's 90 draws are the two arms, one mesh per link slot**, which is exactly where EMOTION_BIBLE
10.2 step 6 (the skinned merge, 28 → 8 draws per arm) has always said the headroom is. Nothing in the set
dressing has fat left: the deck is 4 draws, the whole studio floor is 1, the whole rigging merge is 1, the
crowd is 1. The 88 → 100 spread across a live round is `vfx` pools coming and going. This gate cannot be met
without the skinned merge, and no look change should be reverted to chase four draws.

## What still fails

- **Draw calls at DEFAULT: 94 median against ≤ 90.** Structural; see above. Zero delta from this pass.
- **The histogram's mean: 0.1127 against a 0.12 floor.** Short by 0.007, with the other two gates passed by a
  wide margin. Composition, not materials; the lever is the cockpit camera.
- **One blown white blob remains, and only in the cockpit view.** In `revC-clean.png` a ~120 px colourless
  blob sits over the pilot's own gripper. It is *not* the same defect as the opponent-side blobs, which the
  `LED_CAP` change fixed (see the tight elbow highlight in `revC-wide.png`). The likely cause is a scale one:
  `LED_SIZE_M` is 4.5 × 2.2 mm in **world metres**, so the identical bead subtends 4 px on the opponent at
  0.8 m and tens of px on your own gripper at ~0.15 m, and then blooms. The precise next step is to fade or
  shrink the own-arm beads inside the near-plane band `robot-view` already maintains
  (`OWN_ARM_DITHER_BAND`) rather than to lower `LED_CAP` again, which would dim the opponent's tell. Not
  attempted blind: it needs a frame to confirm.
- **A separate, arguably-correct flare**: impact sparks (`CALIBRATION.emissive.spark` 8) blow out at the
  contact point on the frame a hit lands. GROUNDING E allows hot VFX to emit and PART 2 asks for highlights,
  so this is left for the director's eye rather than clamped.
- **`intg-shots.mjs`'s "clean" frame does not actually hide the HUD.** It hides `body > div > *` that are not
  canvases, and the HUD is nested deeper, so the tote and the damage caption are still in every frame the
  last two passes measured — including the numbers above. Their black plates are ~3 % of the frame and pull
  the mean *down*, so acceptance 1 is if anything measured slightly pessimistically. Worth fixing before the
  next histogram is quoted to the director.
- Everything PART 1 left open that this pass did not touch: the on-deck cable tray at x = ±0.478 sits inside
  the area a cube can slide into (render-only clash), and acceptance 5 and 6 still need frames the headless
  camera will not give.

## What only a real GPU can judge

SwiftShader renders none of these faithfully; every verdict above that depends on them is provisional.

- **PART 2 acceptance 2 in full** — a specular highlight *travelling* along a shell as the arm swings.
  Somebody has to swing the arm on a GPU and watch it. This is the single most load-bearing unverified claim
  in the theatre pass.
- The trim's specular arris, the planar reflection on it and on the scuffed lanes, and the clearcoat roll on
  the shells.
- Bloom shape and coverage: the threshold is 0.98 with a tight knee and the LED beads now rest at 1.6, so
  whether they flare like a filament or like a glow painted on the object is a hardware question — and so is
  whether the capped beads still read as the opponent's 250 ms tell.
- Whether the crowd's Bayer dither shimmers or crawls at 60 fps, and whether the softened beam edge still
  reads as haze rather than as a gradient.
- 60 fps itself. Software GL runs at roughly 1 fps; nothing here measures frame time.

## Verification (homebase, final tree)

`npm run typecheck` **EXIT=0** (whole tree) · `npm run lint` **EXIT=0** (whole tree) · `npm run build`
**EXIT=0** (Next static export) · `npm test` **`# tests 932 / # pass 932 / # fail 0`**.

The suite was first run while the box sat at load 45 with four agents on it and reported four failures. Three
were load artefacts and reproduce as such: `eval-cli` ("the real command") exited `null` — killed — 161 s in
on episode 3 of 6; `opponent-behavior` ("built-in opponent bot sweeps") timed out at 300 000 ms; `recorder`
("speed and size") failed a timing assertion at `store.save 52.7 ms`. The fourth was real and was mine: the
hemisphere change above broke `tests/interpolate.test.mjs` "the 5.3 calibration triple". All four are green on
the quiet box. **No test was weakened or skipped to get there.**

Files this review pass touched: `src/game/render/{rigging,robot-view,stage-deck}.tsx`,
`src/game/render/vfx/haze.ts`, `src/game/render/quality.ts` (comment only, after the measured revert), and
this file. Nothing in physics, rules, policy or the recorder; HARNESS and PROVING GROUND byte-identical; no
new dependency; no new shader program.

Tools added on homebase (measurement rigs, not product code): `~/tl-tools/rev-shots.mjs` (live-round budget
plus cockpit / clean / wide frames, `TLNOHMR=1` so another agent's sync cannot reload the page mid-run — this
killed one run before it was set), `~/tl-tools/rev-budget.mjs` (budget only, one tier per boot),
`~/tl-tools/rev-attrib.mjs` (per-object draw attribution with `autoReset` correctly off), and
`/tmp/rev-regions.sh` (the region crops quoted above).

---

# DIRECTOR'S REAL-GPU REVIEW — verification pass (2026-09-27)

Supersedes the two tables above wherever they disagree. Two roles worked the director's five defects (perf:
the skinned merge; polish: the bead, the boards, the ghost, the sparks) and this pass applied their handoffs,
re-measured everything from one tree, and root-caused the one defect that was fixed in the wrong place.

**Method for every number below** (unchanged from the last pass, and the reviewer's): homebase, SwiftShader,
muted, fresh profile, 1280 × 720, DEFAULT unless a tier is named, cockpit forced, a **live** round with a
human seat (never turbo, where the canvas does not draw and `gl.info` is stale), `gl.info.autoReset = false`
with one `reset()` per frame so these are whole-frame totals across the shadow, reflection, world, overlay
and post passes, median of 14 consecutive frames, `TLNOHMR=1`. `ERRORS []` on every run quoted. Luminance is
`ffmpeg` rgb24 → Rec.709 luma over a named crop, never an estimate.

## Frame budget: the merge landed and the gate is met at every tier

| tier | draw calls (min / **med** / max) | triangles (med) | programs | was (med) |
|---|---|---|---|---|
| LOW | 54 / **54** / 57 | 146 402 | 58 | 70 |
| DEFAULT | 78 / **78** / 86 | 187 524 | 65 | 94 |
| HIGH | 84 / **90** / 98 | 187 536 | 70 | 104 |
| gate (DEFAULT) | ≤ 90 | ≤ 0.45 M | flat after prewarm | |

**DEFAULT passes in every frame of both runs**, not only at the median: 78 / 78 / 86 on the budget run and
71 / 78 / 86 on the confirming run inside the screenshot pass. The gate is written for DEFAULT; HIGH is
quoted for completeness and has come down 104 → 90 with it. Triangles hold 2.4× of headroom at every tier.
The three tiers are distinct and did apply: program counts at the title screen read 36 / 43 / 48 and in the
fight 58 / 65 / 70, and the shots run reads `settings.video.quality` back as `default`.

Per-object attribution, frozen DEFAULT cockpit frame, base 77 draws (`~/tl-tools/cl-budget.mjs`, the same
`autoReset`-off discipline — with it left on every row reads 0, which is what made an earlier attribution
useless):

| object | draws | was |
|---|---|---|
| `stage` | 15 | 15 |
| `arm-blaze` (opponent, incl. its mirror) | 6 | 19 |
| `arm-atlas` (pilot viewmodel, incl. its mirror) | 5 | 9 |
| `vfx` (all pools) | 4 | 6 |
| `truss-rig` / `cubes` | 3 each | 3 each |
| `light-shafts` / `safety-screen` / `led-strips` / `blob-shadows` / `leash` / `haze` | 2 each | 2 each |
| 14 further set-dressing objects, `atlas_mirror`, `blaze_mirror` | 1 each | 1 each |

**The two arms are 11 draws, down from 28.** That is EMOTION_BIBLE 10.2 step 6 done: each arm now draws one
`SkinnedMesh` per material class instead of one mesh per (link, slot), with the link's transform carried on
`skinIndex.x` into a 32-vec4 `uLinkP` array, the eight link objects promoted to `Bone`s so the shells still
follow their MuJoCo bodies exactly. The named target was 8 per arm; the outturn is 5 + 1 mirror on the
opponent and 4 + 1 on the pilot (whose `upper_arm` class is entirely hidden in the cockpit). The LOD swap,
the REFLECTION_LAYER mask, the cockpit hidden-link rule, the per-link LED uniform, the dither gate and the
shadow proxies were each checked in the code and in a frame and all still work.

**Programs are flat.** 65 mid-fight and 65 again after the sparks, the ghost, the broadcast camera and both
LED families had all drawn (`PROGRAMS_END`), against a prewarm baseline of 65. The baseline itself moved
64 → 65: one extra boot-time variant, most plausibly the pilot colourway's shell program in the reflection
pass, which the pilot arm never reached before because its mirror meshes were always frustum-culled. **This
is compliant and the open question is closed**: the 10.1 programs row is `N = M at every frame`, a relation
between the live count and the prewarm baseline, not an absolute number, and the prewarm catches the new
variant at boot.

## PART 2 acceptance

Frame: `/tmp/tlshots/ver-clean.png` on homebase (a live round, frozen mid-fight, HUD hidden by walking the
canvas's own ancestor chain — the old `body > div > *` selector did not reach the HUD, so every histogram
before this pass was measured with the tote and the damage caption still in frame).

Whole frame, HUD hidden: `mean 0.0932 · ≤ 0.03 = 51.92 % · ≥ 0.85 = 0.58 % · ≥ 0.95 = 0.10 %`.
Same frame with the HUD: `mean 0.1009`.

Region luminance, same frame, the crops the last pass used: opponent **0.3383** · studio floor **0.1115** ·
deck mat outside a pool **0.0539** · crowd band **0.0289** · back wall **0.0235**. Added this pass, because
the greyscale asked the question: **deck mat inside a par pool 0.43–0.55** across three crops, and the
opponent's own shell on three tight crops that exclude background 0.254 / 0.296 / 0.330.

| # | PART 2 acceptance | Verdict |
|---|---|---|
| 1 | ≥ 5 % ≤ 0.03, ≥ 0.5 % ≥ 0.85, mean 0.12–0.28 | **FAIL** — two of three, mean 0.0932 |
| 2 | A swing visibly moves a specular highlight along the shell | **NOT VERIFIABLE HEADLESS** |
| 3 | Opponent brightest large object; back wall ≥ 8× darker | **SPLIT** — ratio PASS (14.4×), "brightest" **FAIL** |
| 4 | Three depth planes separable in a still | **PASS** |
| 5 | No region over a fifth of the screen is flat untextured grey | **PASS** |
| 6 | Crowd and furniture at one human scale; deck reads ~1 m | **PASS** |
| 7 | The Core is identifiable as the prize within one second | **NOT VERIFIED** |
| 8 | No caption or prompt taller than 6 % of frame height | **PASS** |
| 9 | PART 1 still passes and the budget holds | **PASS** — the budget now holds |

1. **FAIL on the mean, and the honest number is worse than the one last quoted.** 51.92 % of pixels sit at
   or below 0.03 (gate 5 %) and 0.58 % at or above 0.85 (gate 0.5 %) — both pass. The mean is **0.0932**,
   not the 0.1127 in the table above: that number was taken through the broken clean pass with the HUD still
   in frame, and the last pass's note that the HUD's black plates were pulling the mean *down* is backwards.
   Measured both ways on the same frame, the HUD **raises** the mean (0.1009 with it, 0.0932 without). So
   acceptance 1 is short by 0.027, not 0.007. No look change in this pass was spent on it, deliberately:
   the two levers inside the render layer are the deck pool's strength (it lights about an eighth of the
   frame — a 20 % lift there is worth about +0.003, against ±0.010 of frame-to-frame variation between two
   runs of the same build) and the mat's albedo, which is already 1.7× and whose next increment eats into
   acceptance 3. Roughly 45 % of the frame is unlit room. That is composition, and the lever is
   `COCKPIT_EYE_EGO` / `COCKPIT_TARGET_EGO` in `camera-math.ts` — a camera decision, not a set change, and
   not one to take blind at the end of a verification pass. Note also that SwiftShader renders no bloom at
   all, so every mean quoted here is a pre-bloom floor; a real GPU will read higher by an unknown amount.
3. **The ratio clause passes wider than ever; the "brightest large object" clause now fails, and this is a
   finding, not a regression from this pass.** Opponent 0.3383 against a 0.0235 back wall is **14.4×**
   (gate 8×, was 8.6×), and the crowd band at 0.0289 is 11.7×. Nothing here lifted the back wall. But the
   greyscale was opened and read rather than assumed, and **the lit deck lane is plainly the brightest
   large thing in the frame**: the mat inside a par pool measures 0.43–0.55 against the opponent's shell at
   0.25–0.33 on tight crops that exclude background. The last pass recorded "deck mat in a pool 0.2557"
   against an opponent of 0.4553; on a correctly HUD-hidden frame with the mat's shipped 1.7×
   `MAT_ALBEDO_LIFT` that ordering is reversed. Measured order now: lit mat 0.43–0.55 > opponent 0.34 >
   deck trim 0.22 ≈ pilot arm 0.22 > studio floor 0.11 > unlit mat 0.054 > crowd 0.029 > back wall 0.024.

   **This is the bill for acceptance 1's one working lever and the director should price it, not a role.**
   `MAT_ALBEDO_LIFT` is the single change that gave the frame a midrange; turning it down restores
   "opponent brightest" and pushes the mean (already short by 0.027) further down, and turning it up does
   the reverse. No blind look change was made either way at the end of a verification pass. Note that
   PART 1 acceptance 1 is *not* breached by this: its wording is "at a glance the frame reads deck, arms,
   barrier, floor, crowd, in that order of brightness. Nothing **in the background** is brighter than the
   opponent" — the deck is foreground and is listed first, so PART 1 acceptance 1 still passes. The two
   acceptances disagree with each other about the deck, and only the director can settle which one means it.
9. The budget now holds at DEFAULT in a live round. See the table above.

## PART 1 acceptance

Unchanged from the table above except row 8, which now **PASSES**: ≤ 90 draws (78 median at DEFAULT),
≤ 0.45 M triangles (187 k), programs flat after prewarm. Rows 1–7 were re-read on `ver-clean.png`,
`ver-clean-grey.png` and `ver-wide.png` and hold. Row 1 in particular: the squint order is deck, arms,
barrier, floor, crowd, which is the order PART 1 asks for, and nothing *in the background* comes near the
opponent (floor 0.11, crowd 0.029, wall 0.024 against 0.34) — see PART 2 acceptance 3 above for why the
deck being first is a problem for a different acceptance. Every object touching the deck has its contact
patch, the four materials separate in the greyscale by specular response alone, both cable harnesses and
the mount bolts read from the cockpit, and nothing emits that should not.

## The five defects

**1. Draw calls over the gate — FIXED.** 94 median → **78 median (78–86)** at DEFAULT, under the ≤ 90 gate
in every frame of two runs. The arms are 11 draws, down from 28. Frames opened: `ver-clean.png`,
`ver-wide.png`, `ver-z-grip.png` — both arms render whole and correctly posed, every link present, no
detached or missing shell, nothing stranded at the origin, the paint gradient, the dark anodised servo
blocks with their bolt holes, the red heat strip, the jaw prongs and the LED beads all reading as before.

**2. Blown white LED bead on the pilot's own gripper — FIXED, measured against the director's own frame.**
The bead is now scaled about its centre by `clamp(viewDepth / 0.55 m, 0.1, 1)` in the LED material's vertex
shader, so a bead 0.15 m from the eye is drawn at the angular size it has at 0.55 m; the threshold that
tells a bead from a flank strip is the quad's width, and a strip is never scaled. `LED_CAP` is untouched, so
the opponent's beads and the 250 ms tell are unchanged. Counting colourless near-white pixels
(min(r, g, b) ≥ 235) and their largest connected run over the whole frame:

| frame | colourless px | largest blob | bbox |
|---|---|---|---|
| `revC-clean.png` (the director's frame) | 7 002 | **4 271 px** | 81 × 71 |
| `ver-clean.png` (now) | 1 393 | **796 px** | 58 × 21 |

The round 81 × 71 blob over the gripper is gone. What is left at the same place is 58 × 21 — the shape of
the flank LED strip itself, which is a line by design and is the one thing the clamp must not shrink.
Frames opened: `ver-z-grip.png` and `ver-z-bead.png` (5× crops of the pilot's wrist and forearm) — small
bright points on the shell, a continuous strip line, no colourless blob anywhere on the viewmodel; and
`ver-wide.png`, where both arms' beads read as tight points.

**3. The sponsor board band reads as garbage — FIXED.** The wordmarks are gone; each panel is a colour field
with three large repeats of that sponsor's symbol alone (the lockup minus its set text), so a panel cut by
the frame edge shows whole marks instead of the "EAD" / "PULP" fragments. Frame opened: `ver-z-band.png`, a
2× crop of the back-wall band out of the cockpit frame — alternating arch-over-ground-bars and
octopus-badge marks on navy and dark-red fields, no letter fragments at any point across the wall. The band
measures 0.0235, still a dim practical rather than a light source.

**4. The ghost arm is heavy — FIXED.** Fill 0.12 over two faces → 0.045 on front faces only, the fresnel rim
tightened and strengthened, and the "thin white-hot inner line" — which actually ran e 0.30 → 0.62, most of
a near-field shell, and was the real cause of the pale solid arm — narrowed to e 0.46 → 0.66. Frame opened:
`ver-z-ghost.png`, a 3× crop at leash stretch 0.40: the hologram reads as contour lines plus the leash
ribbon and its tip ring, and **the deck's red trim line and the pink LED line run straight through the
body** — it is a projection, not a second arm. The "only while genuinely blocked" half is measured, not
argued: sampling `hud.reticle.leashStretch` and the hologram's own `uFade` through a live round with no
input gives 0.291 / fade 0.793 while the arm settles at the round start, then fade **0** at every later
sample down to stretch 0.015. It is off at rest and returns only when the arm is behind its command.

**5. Impact sparks blow out at the contact point — ROOT-CAUSED ELSEWHERE AND FIXED THERE.** The sparks were
the wrong suspect, and the previous pass's fix to them, while correct on its own terms, could not have
settled this. Pinning every contact pool's shader clock and re-stamping its births to hold a strike at an
exact age of 50 ms (`~/tl-tools/ver-freeze.mjs`), then hiding one pool at a time on the identical frame:

| frame at age 50 ms | colourless px ≥ 0.95 | largest blob |
|---|---|---|
| all pools drawing | 10 220 | 7 730 px (109 × 146) |
| sparks hidden | 8 381 | 3 382 px |
| arcs hidden | 6 423 | 2 357 px |
| **bursts hidden** | **0** | **0 px** |
| all hidden | 0 | 0 px |

Hide the burst pool and **every colourless clipped pixel in the frame disappears**, with the sparks and the
arcs still drawing. They only clipped where they landed on top of the burst's disc, which was already
saturated before anything was added to it: `BURST_SPEC.flash` was `intensity: 12` and `star` `intensity: 9`,
both in neutral `#FFFFFF` — the identical defect the previous pass found and fixed in `sparks.ts`, a number
written as a literal that nothing downstream could turn down. Both now read `CALIBRATION.emissive.spark` as
a gain (× 1.5 and × 1.125, so 9 and 6.75) in the same filament white `#FFEAC8`, which is the one authored
knob for how hot a contact is. `tests/vfx-pools.test.mjs` pins both against that constant and against a
warm core, so re-hardcoding a literal or reverting to neutral white fails a test.

The fix was then A/B'd on one frame. Two separate boots cannot do this — each spawns a different-sized
shower — and pinning the pools alone is not enough either, because the arms and the camera keep moving
between two screenshots two seconds apart. With the game clock frozen **and** every pool pinned, the live
`flash` and `star` instances were repainted in place back to the old spec (neutral white at 12 and 9), so
the two images differ only in the two numbers under test:

| the identical frozen contact frame | colourless px ≥ 0.95 | largest colourless blob | contact crop ≥ 0.85 / ≥ 0.95 |
|---|---|---|---|
| old spec (`#FFFFFF`, 12 and 9) | 9 505 | 6 177 px (116 × 107) | 12.49 % / 8.88 % |
| **shipped** (filament, 9 and 6.75) | **7 228** | **3 902 px (88 × 87)** | 11.03 % / 7.46 % |
| bursts hidden entirely | 0 | 0 px | 1.19 % / 0.15 % |

Colourless clipped area is down 24 %, the blob down 37 %, and **the loss is almost entirely out of the
clipped band rather than the readable one**: ≥ 0.85 falls 1.46 pp while ≥ 0.95 falls 1.42 pp, and the flash
still contributes about 10 pp of bright highlight over a frame with the pool hidden. Frames opened, the two
stacked as one image: the old spec is a hard-edged featureless white plate that hides both grippers; the
shipped one keeps a hot flash with warm rays, and the pink gripper's fingers, the blue shell and the deck's
red trim line all read through the lower half of it. **REDUCED, not eliminated** — at 9 linear the very
centre of the disc still saturates all three channels, and taking that out means dimming the flash, which
is the opposite of what the review asked for.

## Handoffs: applied and resolved

- **perf → WP2 (`robot-materials.ts`), applied, and applied better than asked.** The merged arm needs the
  shell shader's per-link constants as a uniform array, and until now `robot-view` read them back through
  `probeShellConstants`: it built one throwaway material per (link, slot) at boot and ran its own
  `onBeforeCompile` against an empty shader record to harvest the uniform values. The handoff asked for two
  `export` keywords on `LINK_GRADIENT` and `JAW_GEOMETRY`. Exporting the raw tables would have put the
  axis-over-span division, the `normalize` fallback and the "only a hand slot has a jaw" rule in two files
  that must agree forever, so instead **`shellLinkConstants(slot, link)` is exported** — the one function
  that derives all six values — and both `patch()` (the per-link material) and `packLinkConstants()` (the
  merged `uLinkP`) now call it. The two cannot drift, the back door is gone, and ~20 lines of `robot-view`
  deleted themselves. `LINK_GRADIENT` and `JAW_GEOMETRY` stay private.
- **perf → WP2, awareness.** The merge rewrites eleven anchor strings in the shell shader
  (`attribute float edge;`, `vEdge = edge;`, `vObjNormal = objectNormal;`, the `vJointAxisView` line and the
  declarations of `uDither`, `uLinkIndex`, `uGradAxis`, `uGradUnit`, `uGradT`, `uJawInner`, `uJawTip`).
  Reword any of them and the arm throws at boot rather than rendering wrong, and
  `tests/stl-geometry.test.mjs` fails first — the anchors are scraped from the `swap()` calls, so the test
  cannot drift from the code. Two semantics changed on purpose: `vObjNormal` is the raw `normal` attribute
  (three's skinning overwrites `objectNormal`, which would have given the jaw's inner-face test the posed
  normal), and the servo streak's joint axis is `skinMatrix * z` so it still turns with its own link.
- **polish → WP5 (the contact flare), applied here rather than handed on again.** The handoff said the white
  at a contact is not the spark pool and named bursts / arcs / chips / the hit light as where to look. It is
  `bursts`, measured; see defect 5 above. Fixed at the root in `bursts.ts`.
- **polish → this file, two corrections, both applied above.** The broken "clean" pass was raising the mean,
  not lowering it, and `CALIBRATION.emissive.spark` was dead until the previous pass wired it.
- No conflict between the two roles: their file sets do not overlap, and their two tests cross-pin each
  other's constants (`LED_BEAD_MAX_W_M < 0.02 m` in `vfx-pools`, strip length `> 0.02 m` in `stl-geometry`)
  and both hold.

## What still fails

- **PART 2 acceptance 1, the histogram mean: 0.0932 against a 0.12 floor.** The other two gates pass wide.
  Composition, not materials; see acceptance 1 above for the arithmetic on every lever inside the render
  layer and why the remaining one is the cockpit camera. Every mean here is also a pre-bloom floor, because
  SwiftShader renders no bloom.
- **PART 2 acceptance 3's "brightest large object" clause**, newly failing on measurement: the lit deck
  lane at 0.43–0.55 beats the opponent's 0.25–0.33. It trades directly against acceptance 1's mean through
  `MAT_ALBEDO_LIFT`, and it contradicts PART 1 acceptance 1, which lists the deck first. A director call.
- **PART 2 acceptance 2, 7 and PART 1 acceptance 5** are unchanged and still need a GPU or a naive viewer.
- **HIGH sits at 90 draws median (84–98).** There is no gate at HIGH and it came down from 104, but it is
  now where DEFAULT used to be, and the next feature that costs a draw will be felt there first.
- The on-deck cable tray at x = ±0.478 still sits inside the area a cube can slide into (render-only clash).
- The merged shells are `frustumCulled = false` — a skinned mesh's bind-pose bounds are link-local and
  would cull the arm away — so each arm's classes and its mirror always submit. Restoring culling with a
  per-frame world-space bound would claw back a few draws in frames where an arm is off screen. Not worth
  it at 78 median; it is the headroom if a later change pushes the budget back up.

## What only a real GPU can settle

SwiftShader renders none of these, so every verdict that depends on them is provisional.

- **PART 2 acceptance 2 in full** — a specular highlight *travelling* along a shell as the arm swings.
  Still the single most load-bearing unverified claim in the theatre pass, and now also the last check that
  the skinned merge did not disturb the clearcoat roll: the merge is proven on geometry, posing, per-link
  binding, draw counts, triangle counts, program counts and the greyscale value order, and on nothing that
  needs clearcoat, bloom or the planar reflection.
- **Whether the clamped near bead still flares like a filament through bloom** rather than shrinking to
  nothing, and whether the capped beads still read as the opponent's 250 ms tell.
- **Whether the warmed contact flash still reads warm after bloom and the ACES shoulder.** The measurement
  above is of pre-bloom clipping only; bloom will spread the disc further than anything here shows.
- Whether the narrowed ghost rim still reads as a projection once bloom catches it.
- The trim's specular arris, the planar reflection, the clearcoat roll, whether the crowd's Bayer dither
  crawls at 60 fps, and 60 fps itself — software GL runs at roughly 1 fps and nothing here measures frame
  time.

## Verification (homebase, final tree, quiet box)

`npm run typecheck` **EXIT=0** (whole tree) · `npm run lint` **EXIT=0** (whole tree) · `npm run build`
**EXIT=0** (Next static export) · `npm test` **`# tests 937 / # pass 937 / # fail 0`**.

The run quoted is the one taken with the box at load 2–6 (`/tmp/verify-green2.log`). The three known load
artefacts (`eval-cli` "the real command", the `opponent-behavior` sweep, `recorder` "speed and size") did
not appear; they reproduce only above about load 40. **No test was weakened or skipped.** One test was
added (the contact flash and star against `CALIBRATION.emissive.spark`), on top of the four the two roles
added. No commits.

Files this pass touched: `src/game/render/robot-materials.ts` (export `shellLinkConstants`, `patch()` takes
it), `src/game/render/robot-view.tsx` (the probe replaced by that call), `src/game/render/vfx/bursts.ts`
(the contact flash and star), `tests/vfx-pools.test.mjs` (one test), and this file. Nothing in physics,
rules, policy or the recorder; no new dependency; no new shader program — `bursts.ts` changes two constants
inside an existing material and `robot-materials.ts` changes only where a uniform's value comes from.

Tools added on homebase by this pass: `~/tl-tools/ver-freeze.mjs` — `spark-freeze.mjs` generalised, so any
contact pool sharing the `(birth, life, kind, rotation)` `aTime` layout can be pinned at an exact age, one
hidden at a time for attribution, and repainted in place for a matched A/B on one frozen frame; and
`~/tl-tools/ver-run.sh` / `ver-fz.sh` (private snapshot dev server on port 3022). `/tmp/blob.py` counts
colourless near-white pixels and the largest connected run of them, which is the only number that says
"blown out" rather than "bright". Frames are in `/tmp/tlshots/ver-*.png` and `/tmp/tlshots/vfzD-*.png`.
Every headless run had `reap.sh` before and after it, one browser at a time, nothing played audio.

---

# RELIGHT pass (2026-09-28): light the machines, lift the room

Scheduled twice, died twice to a server overload; this is the pass that ran. Three constants changed, all
in this role's own files. **PART 2 acceptance 1 now passes on all three of its clauses**, acceptance 3's
ratio clause passes wider than the gate, and acceptance 3's "brightest large object" clause passes on every
large-region reading and fails only on the 1.6 %-of-frame hot centre of one par pool — see the director
hand-back below, because that last one is no longer a look problem, it is a definition problem.

## What changed

| file | constant | before | after |
|---|---|---|---|
| `lighting.tsx` | `SOFTBOX` (the two vertical white env softboxes at shell height) | 6.0 | **28.0** |
| `lighting.tsx` | `BEAM` (volumetric team / shaft strength) | 0.62 / 0.34 | **0.74 / 0.41** |
| `quality.ts` | `vignette.darkness` | 0.72 | **0.62** |

Nothing else. No light was added or removed, no fixture moved, no geometry, no material, no shader program,
no dependency. The grey card is untouched and was not re-derived: `CALIBRATION.exposure`, `key.intensity`,
`key.elevationDeg`, `hemisphere.intensity` and `environmentIntensity × environmentIrradianceEstimate` all
read exactly what `tests/interpolate.test.mjs` pins, because the softboxes are vertical rects and a vertical
rect contributes ~0 irradiance to the upward 18 % card the calibration is defined on. `predictDisplayValue`
and `?debug=greycard` therefore still agree with each other and with the 0.34 ± 0.03 target.

## Before and after (homebase SwiftShader, 1280 × 720, DEFAULT, fresh profile, cockpit forced, human seat, LIVE round, frozen mid-fight, HUD hidden by the canvas's ancestor chain, TLNOHMR=1, `ERRORS []` on both)

Before is the verifier's `/tmp/tlshots/ver-clean.png` — the frame every earlier number in this file is
taken from. After is `/tmp/tlshots/rlZ-clean.png`.

| histogram | before | after | gate |
|---|---|---|---|
| mean | 0.0932 | **0.1380** | 0.12 – 0.28 ✓ |
| ≤ 0.03 display luma | 51.92 % | **44.16 %** | ≥ 5 % ✓ |
| ≥ 0.85 | 0.58 % | **0.83 %** | ≥ 0.5 % ✓ |
| ≥ 0.95 | 0.10 % | 0.31 % | — |

| region (Rec.709 luma of a fixed crop, `~/tl-tools/rl-regions.sh`) | before | after |
|---|---|---|
| opponent (110 × 170 on the shell) | 0.3383 | **0.4762** |
| lit deck island (420 × 210, 9.6 % of the frame) | 0.3738 | **0.4418** |
| lit lane, hot centre of the par pool (180 × 80, 1.6 %) | 0.6847 | 0.7171 |
| studio floor | 0.1115 | **0.3472** |
| pilot arm | 0.2334 | 0.2674 |
| deck mat, unlit near side | 0.0733 | 0.1045 |
| deck mat, outside a pool | 0.0539 | 0.0676 |
| crowd band | 0.0289 | 0.0459 |
| back wall | 0.0235 | 0.0341 |
| **opponent ÷ back wall** | 14.4 × | **14.0 ×** (gate 8 ×) |

Value order after, brightest first: par-pool hot centre 0.717 → **opponent 0.476** → lit deck island 0.442 →
studio floor 0.347 → pilot arm 0.267 → unlit near mat 0.105 → mat outside a pool 0.068 → crowd 0.046 →
back wall 0.034. The opponent is now ahead of the deck as a large object; before this pass it was behind it
(0.3383 against 0.3738).

Budget, same tree, live round, `cl-budget.mjs` (autoReset off, one reset per frame, median of 14):
**78 draw calls median (78–86), 187 524 triangles median, 65 programs** against a 65 prewarm baseline —
identical to the figures in the section above. Three constants cannot move a draw call, and they did not.

## Every lever, priced

Measured, not estimated, and all of it on **one** frozen cockpit frame per sweep, because two boots produce
two poses and two haze patterns and the difference between them is larger than most of these effects. The
tool is `~/tl-tools/rl-sweep.mjs` / `rl-sweep2.mjs`: it locks the key and hemisphere intensities behind
property getters (`runShow()` rewrites them every frame), writes `scene.environmentIntensity`, the fog
colour and `toneMappingExposure` directly, hooks `multiplyScalar` on the shared `uPoolColor` objects that
`onBeforeCompile` assigns into the deck's shader, hooks `needsUpdate` on the light-shafts colour attribute,
and reaches the grade's `uContrast` and the vignette's `darkness` through `window.__tlComposer`. That turns
a ten-minute rebuild-per-guess into a one-minute screenshot-per-guess.

| lever, on one frozen frame | Δ mean | Δ opponent | Δ back wall | verdict |
|---|---|---|---|---|
| hemisphere 0.12 → 0.60 | +0.0002 | +0.0002 | 0 | **dead**, exactly as `quality.ts` already argues |
| fog `#0B0D26` → `#1B2452` | 0.0000 | 0 | 0 | **dead** — the black 45 % of the frame is unlit geometry, not fog |
| key 3.2 → 5.12 | +0.025 | +0.023 | +0.000 | works, but pinned by `tests/interpolate.test.mjs` |
| exposure 0.7 → 1.0 | +0.039 | +0.076 | +0.016 | works, pinned by the same test, and lifts the lane more than the machine |
| environment × 4 | +0.036 | +0.062 | **+0.000** | **the lever**: it never touches the back wall |
| haze × 1.2 | +0.011 | +0.002 | +0.022 | **shipped** |
| haze × 1.5 | +0.031 | +0.007 | +0.064 | wall ratio falls to 4.9 ×, fails |
| haze × 2.5 | +0.109 | +0.036 | +0.208 | wall ratio 1.9 ×, fails badly |
| vignette darkness 0.87 → 0.50 (live) | +0.035 | 0 | +0.020 | **shipped at half that** |
| `grade.contrast` 1.58 → 1.40 | +0.006 | −0.000 | +0.004 | **refused**: ≥ 0.85 falls 0.46 % → 0.36 %, under acceptance 1's own floor |
| `grade.contrast` 1.58 → 1.25 | +0.013 | +0.001 | +0.008 | **refused**: ≥ 0.85 falls to 0.28 % |
| deck pool × 0.5 | −0.011 | −0.011 | 0 | **forbidden** (dimming the deck) |
| deck pool × 0 | −0.026 | −0.027 | 0 | **forbidden**; and it is the whole lane: litlane 0.691 → 0.160 |

Three of those numbers decided the pass. **The haze is the cheapest mean in the frame and the wall ratio is
what caps it** — the beams cross the back wall, so what the wall crop measures is the haze in front of it,
and ×1.2 is the last gain that leaves 8 × of headroom. **Lowering the grade's contrast is the trap**: it
looks like free mean and it is paid for out of the highlight clause of the same acceptance. **The
environment is the only lever that lifts the frame without touching the wall at all**, which is why it took
the largest share, and it had to be spent on the vertical softboxes alone: the overhead lamp bar is the one
environment term the grey card accounts for, and the horizon strips and the console kick are coloured, and
the brief was explicit about not flooding the room in team colour.

The softbox is also capped, and it is capped by the value order rather than by a gate: past about 28 it
lifts the polished concrete faster than it lifts a painted shell (at ×1.5 more, floor 0.32 → 0.47 against an
opponent of 0.50), because the floor is a large surface seen at a grazing angle and a grazing surface sees a
vertical softbox in its specular lobe. Pushing it further would just put the studio floor ahead of the
opponent instead of the deck.

## The remaining clause, and the hand-back

**PART 2 acceptance 3's "the opponent is the brightest large object" is now a definition question, not a
lighting one.** Read as an object, the deck lost: the lit island over 9.6 % of the frame is 0.4418 against
the opponent's 0.4762. Read as the hot centre of one par pool over 1.6 % of the frame, the deck wins at
0.7171. Nothing in the render layer can close that last gap by adding light, and the measurement says why.

1. **The pool is the brightest light in the room and it lands only on the floor.** `POOL.strength` 16 with
   1/d² in sim metres is ≈ 3.85 of irradiance at the pool centre, against the key's 3.2 · sin 48° = 2.38.
   Switching it off drops the lane 0.7144 → 0.2067 and the whole-frame mean by 0.028. It is the lit island.
2. **The arms are not in it.** `DECK_POOL_GLSL`'s analytic cones are evaluated by the mat, the studio floor
   and the clutter cubes and by nothing else — `cubes-view.tsx` says so in as many words, having fixed
   exactly this for the cubes ("a cube inside a pool of light was the one object the pool did not reach").
   The two machines standing in those pools are the props that were left out.
3. **Every lever that lights a machine and not the deck was swept and they are all small or all pinned**
   (the table above). The softboxes moved the opponent 0.338 → 0.476, which is the whole of this pass's
   +0.14, and they are now at their own ceiling.

### Handoff 1 → the materials role (`robot-materials.ts`), measured, not argued

Applied here temporarily, measured, and reverted; the file is byte-identical to the pre-pass snapshot
(`md5 2db6e24236eed166cf289e2e73bcc010`, checked against `~/tl-tools/ver-snap/`). In `patch()`:

```ts
import { DECK_POOL_GLSL, DECK_SWEEP_UNIFORMS } from "./stage-deck.tsx";
// ...
Object.assign(shader.uniforms, DECK_SWEEP_UNIFORMS, arm, { uDither: dither, /* unchanged */ });
shader.vertexShader = shader.vertexShader
  .replace("#include <common>", `#include <common>\nvarying vec3 vPoolWorld;\n${VERTEX_HEAD}`)
  .replace("#include <fog_vertex>", `#include <fog_vertex>\nvPoolWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${VERTEX_BODY}`);
shader.fragmentShader = shader.fragmentShader
  .replace("#include <common>", `#include <common>\n${DECK_POOL_GLSL}\n${FRAGMENT_HEAD}`)
  // ... and, appended to the existing chain:
  .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directDiffuse += tlPoolLight() * diffuseColor.rgb;");
```

`transformed`, not `position`: the shells are skinned, and `stage-deck.tsx`'s own `DECK_POOL_VERTEX` uses
the bind-pose attribute because nothing that used it was skinned. Note that this closes an import cycle —
`stage-deck.tsx` already imports `teamHex` from `robot-materials.ts`. It typechecked, built and ran
headlessly with `ERRORS []` in this pass, but the clean version is to lift `DECK_POOL_GLSL` and
`DECK_SWEEP_UNIFORMS` into a leaf module that both can import.

**What it is worth, measured as a within-frame A/B** (the probe applied, then the pool switched off and on
against the *same* frozen frame, which is the only way to measure this — two boots differ by more than the
effect): opponent **0.4354 → 0.4983**, Δ +0.063. The same switch without the probe moves the same crop by
+0.027, which is the deck behind the opponent and its planar reflection rather than the shell, so **the
shell's own share is about +0.036**. Whole-frame mean with the probe read 0.1608 against 0.1387 without it,
but those are two boots and only the within-frame pair should be quoted.

It is a real, visible fix — the frame `/tmp/tlshots/rlG-clean.png` shows both machines lit by their own par
cans for the first time, and it is the physically correct behaviour — but **it does not on its own settle
the clause**: it takes the opponent to about 0.50 against a pool centre of 0.71. The pilot arm gains
**nothing** from it (0.2673 both ways), which is a second finding for that role: the viewmodel arm is
outside both cones as the cockpit frames it.

### Handoff 2 → the director, not a role

If the pool's hot centre must also sit under the opponent, the only lever is the pool's on-axis strength,
and this role was told not to pull it. Two notes for whoever prices it:

- **Widening the cone alone does nothing.** `POOL_COS` in `stage-deck.tsx` is a hand-copied duplicate of
  `POOL.angle` / `POOL.innerAngle` in `lighting.tsx` (0.20 / 0.12 rad, written as literals in both files —
  worth deduplicating on its own account). But the shader is `uPoolColor * cone / d²`: `cone` is a
  smoothstep on the angle, so opening it widens the lit area at an unchanged on-axis peak. It makes the
  island bigger, not softer.
- **Flying the can wider and turning it down together does** — `POOL.angle` 0.20 → 0.30 with
  `POOL.strength` 16 → 7.1 (× (0.20/0.30)²) keeps the same total flux on the deck, spreads it over 2.25 ×
  the area and takes the peak down 2.25 ×, which is what a real rigger does with a wider lens. Estimated
  from the ×0.5 sweep that would land the pool centre near 0.50 against an opponent of 0.48–0.50 — a dead
  heat, so it needs measuring, not shipping. `POOL_COS` and `POOL` must move together or the haze cone and
  the pool it makes stop being the same fixture.

### Note for the materials role

`SHELL_ENV_INTENSITY`'s comment asks to be told if this role moves `CALIBRATION.environmentIntensity` or the
key. **Neither moved.** What moved is the two vertical softboxes inside the environment, 6.0 → 28.0, which
from a lacquered shell's point of view is the same thing: the coat now has a much hotter, equally narrow
source to draw its band from. If the clearcoat band clips on real hardware, the knob is
`SHELL_ENV_INTENSITY` 2.4, not `SOFTBOX`.

## What only a real GPU can settle (unchanged, plus one)

Everything the previous section lists still stands, and this pass adds one: **whether the softboxes at 28.0
blow the clearcoat band out on hardware.** SwiftShader renders no clearcoat and no bloom, so the specular
roll this change is supposed to have strengthened is precisely the thing the measurement cannot see. What is
measured is the diffuse and broad-lobe consequence of it: the opponent's shell is up 0.14 of display luma
and the ≥ 0.85 highlight population is up from 0.58 % to 0.83 %. On hardware that band is narrower and
hotter than either number implies, and bloom will catch it.

Also unverifiable here, and now more load-bearing than before: 60 fps. Nothing in this pass costs a draw
call or a triangle, but the beams carry 1.2 × the additive overdraw they did, and additive overdraw is a
fill cost that a software renderer at ~1 fps cannot price.

## Verification (homebase, final tree, quiet box, load 2.7–8.7)

`npm run typecheck` **EXIT=0** (whole tree) · `npm run lint` **EXIT=0** (whole tree) ·
`npm test` **`# tests 937 / # pass 937 / # fail 0`**. No test was added, changed, weakened or skipped —
this pass deliberately changed no constant that a test pins. None of the three known load artefacts
appeared. No commits.

Files touched: `src/game/render/lighting.tsx` (`SOFTBOX`, `BEAM`, two doc blocks),
`src/game/render/quality.ts` (`vignette.darkness` and its comment), and this file. `post-stack.tsx`,
`vfx/haze.ts` and `truss-rig.tsx` were read and left alone: the post stack's grade is where the trap was,
the haze shader needed no change (the gain in `lighting.tsx` was the right knob), and the rig is at the
height that sells the scale.

Tools added on homebase: `~/tl-tools/rl-sweep.mjs` (live lighting sweep on one frozen frame — property
locks on the two light intensities, direct writes to the environment, fog and exposure, `multiplyScalar` and
`needsUpdate` hooks for the deck pools and the light shafts), `rl-sweep2.mjs` (the same for the grade's
contrast and the vignette, through `window.__tlComposer`), `rl-regions.sh` (the verifier's five crops plus
`litlane`, `pilotarm`, `unlitmat` and `island`), `rl-measure.sh`, `rl-run.sh` and `rl-final.sh` (private
snapshot dev server on port 3023). Frames are in `/tmp/tlshots/rl[A–H,Z]-*.png`.

One warning for the next agent using these: **`reap.sh <age>` kills its own caller** when the caller lives
under `~/tl-tools/` and has been running longer than `<age>`. `rev-run.sh` / `ver-fz.sh` both call
`reap.sh 60` after the render and are silently killed at that line; `rl-run.sh` passes 1800 instead. Every
headless run here had `reap.sh` before and after it, one browser at a time, nothing played audio.

### Director decision 2026-09-27: relight handoff 1 declined

The relight role's handoff asked `robot-materials.ts` to import `DECK_POOL_GLSL` / `DECK_SWEEP_UNIFORMS` from `stage-deck.tsx` so the par-can pools light the shells (measured +0.036 on the opponent crop). Declined: `stage-deck.tsx` already imports `teamHex` from `robot-materials.ts`, so this creates a module cycle whose module-level consts can initialise undefined. PART 2 acceptance 3 passes as written without it (opponent 0.4762 > deck-as-object 0.4418); the only brighter region is a par-can hot centre over 1.6% of the frame, which is a specular pool, not a large object. If this is ever wanted, move the two exports into a new `render/deck-pool.ts` that both files import, rather than importing across the existing edge.

### Demo take 2026-09-27 (post-relight) and the defects it exposes

`tools/demo/out/demo.mp4`, 85 s, recorded on the director's GPU by `node tools/demo/record-demo.mjs`, muted. Reaches attract → entrance → a live Arcade round vs OVERSHOOT → KO → confetti → VICTORY. Frames at `tools/demo/out/f*.png`.

Defects visible in this take, none of them fixed yet:
1. **`ROUND 1` slams across a full-width band that covers the middle third of the frame**, hiding both arms at the moment the round starts. It should be a plate, not a letterbox.
2. **Host captions are truncated mid-word**: "BOTH ARMS TWITCHING. LET US SEE I1", "MA1". The caption box is sized to a shorter string than the line it is given.
3. **The VICTORY title is half-hidden behind the same band** and reads grey rather than triumphant.
4. **The winner's arm at the victory beat is lit almost white** on its upper links: the celebration pose walks into a par-can hot centre.
5. The heat meter pins at 92–100 for most of the round because the scripted demo pilot never rests; a human would not sit there, but it makes the demo look like the arm is permanently overheated.

---

# PLAYABILITY PASS (2026-09-28): load, device coverage, controls, depth

Brief, in the user's words: "optimize the game as much as you can so its less laggy and works basically
everywhere"; "make it look as good as the finals and work as well too"; "intuitive controls"; "something a
lot of people can easily play, think a lot, and cook". Plus: "it doesn't load right and stuff".

Six read-only audits ran in parallel over boot, runtime perf, the visual gap, controls, reach and combat
depth, then a completeness critic. Their findings are the basis for everything below. Every number here was
measured, not estimated, and the measurement is named.

## The two corrections that reframe earlier passes in this file

**1. The frame budget was optimising the wrong resource.** Measured in a real browser (Apple M5, Chrome
152/ANGLE Metal) by forced composer renders behind a `readPixels` GPU fence: render cost is essentially
linear in pixel count at ~4–6 ms per megapixel with a ~1 ms fixed intercept. Scene-only is 1.91 ms of a
4.77 ms frame at 1024x768 — **post-processing is ~60 % of GPU cost**, and removing any individual effect
saves nothing measurable (±0.3 ms) because `postprocessing` merges them into two EffectPasses. So the draw
call work this file documents (104 → 90 → 78 → 71) **buys no frame rate at all**; it was never the
constraint. What costs frames is pixels x shader, and the levers are resolution and pass count.

| case | pixels | Mpx | ms | fps |
|---|---|---|---|---|
| 720p | 1280x720 | 0.92 | 7.3 | 138 |
| 1080p | 1920x1080 | 2.07 | 9.3 | 108 |
| 1080p at DEFAULT's dpr 1.25 | 2400x1350 | 3.24 | 13.9 | 72 |
| 1440p | 2560x1440 | 3.69 | 17.1 | **59** |
| Retina fullscreen, dpr 2 | 2880x1800 | 5.18 | 31.9 | **31** |
| 4K | 3840x2160 | 8.29 | 46.2 | **22** |

On the fastest hardware this game will ever meet. `QUALITY_TIERS.high` had `dpr: null` → `min(2, deviceDpr)`,
so HIGH on any Retina Mac rendered 5.2 Mpx at 31 fps: the best tier was unplayable on the hardware it was for.

**2. SwiftShader's numbers in the RELIGHT section are wrong where they matter most.** Measured on the
director's own real-GPU demo frames (`tools/demo/out/f*.png`): the back wall reads **0.0003–0.0139** display
luma, not the 0.0341 recorded here — so `opponent ÷ back wall` is 30x–1400x, not 14.0x, and **the haze
ceiling of x1.2 was set against a wall value that does not exist on a GPU**. And PART 2 acceptance 3 was
**failing on hardware** while recorded as passing: lit deck island 0.4606 against an opponent of 0.4129, with
the par-pool centre at 0.714. 28–29 % of every fight-frame pixel sat at or below 0.01 — the room the
cyclorama shader draws was being rendered into black.

## The look: the night stays, the void goes

`STYLES.md:8-9` binds the PRIME TIME direction and explicitly overrides the high-key daylight direction. So
"make it bright like the reference game" would overturn a written decision, not fix a bug — and that
direction has a real cost in its own game, where players report they cannot read enemies through the
indoor/outdoor exposure swing. The diagnosis that survives measurement is narrower and fixable: **the night
had no room in it.** Constants only; no draw call, pass or program added.

Measured on one pinned camera pose (stored in `localStorage.__tlPose` so a frame is reproducible across
reloads — two boots otherwise differ by more than any of these effects):

| | before | after | gate |
|---|---|---|---|
| whole-frame mean | 0.2829 | **0.2799** | 0.12–0.28 ✓ |
| ≤ 0.03 population | — | 13.17 % | ≥ 5 % ✓ |
| ≥ 0.85 population | — | 0.58 % | ≥ 0.5 % ✓ |
| opponent | 0.3689 | **0.4278** | — |
| deck − opponent gap | 0.112 | **0.026** | acceptance 3 |

Acceptance 3's "brightest large object" clause still favours the deck, but the gap is **a quarter of what it
was** and it was already failing on hardware before this pass (0.048 by the demo-frame measurement).

- `cyclorama.tsx` wall albedo x2.6 — the portals, cove, courses and pier rhythm were drawn into black. x3.8
  was tried first and read as a lit room rather than a night broadcast; measure the mean before changing it.
- `cyclorama.tsx` `ROOM_LIFT` 0.55 → 0.44 — the cockpit lens sees 11.1° above horizon and the lighting grid
  sat at 17.2°, i.e. the whole room was above the frame. 0.38 puts the grid in frame but grazes the crowd rake.
- `studio-floor.tsx` `FLOOR_LEVEL` 0.62 → 0.44 and fade 0.90/0.80 → 0.78/0.70. The near floor measured 0.417
  against an opponent of 0.413 — dead level with the thing the player must read. The floor is the largest
  surface in frame and therefore the cheapest lever on the whole-frame mean.
- `lighting.tsx` `POOL` flown wider and turned down together at constant flux (16 @ 0.20 rad → 7.1 @ 0.30),
  with `stage-deck.tsx` `POOL_COS` in lockstep. This is **not** the forbidden "dim the deck" row — the lane
  keeps its energy and only its peak comes down. `tests/deck-pool-angles.test.mjs` now pins both the lockstep
  and the flux invariant, because the two constants are hand-copied duplicates with nothing else guarding them.
- `lighting.tsx` `TEAM_GEL` 0.30 → 0.18 — colour belongs to the objects, not the room.
- `robot-materials.ts` `SHELL_ENV_INTENSITY` 2.4 → 2.05, and the rival's shell_body desaturated 0.16 toward
  paper. Not lower: the shells are what acceptance 3 measures, so every point off the env is paid for in the
  opponent's readability. 1.8 was tried and cost too much.
- `robot-materials.ts` `COLORBLIND_AI` was `#F2C200` while `globals.css` says `#FF9F1C` — **the 3D arm and
  the HUD showed different team colours to the players who most need them to agree.** Now matched.

## The five demo defects

1. **ROUND/FIGHT letterbox — fixed.** `.hud-countdown__band` was 110vw x 24vh plus 74 px of skew spread: a
   243 px envelope over a 720 px frame, 31.7 %, covering both arms at the moment the round starts. Now a
   bounded plate: 573 x 145 px, 18.9 %, and `.hud-countdown` is inset 30 % from the bottom so it clears the
   viewmodel.
2. **Captions truncated mid-word — fixed, and the stated cause was wrong.** The box was never too small. The
   reveal was `clip-path` with `steps(n, end)` where the clip is a fraction of the span's **width** and `n`
   is its **character count**; on proportional Barlow Condensed a step boundary lands inside a glyph, so half
   a "T" reads as "1". Replaced with a per-character substring write in `hud-runtime.ts`, which can only ever
   produce whole glyphs. The CSS reveal keyframes are gone; the release stretch stays. Reduced motion is now
   honoured in the runtime (whole line at once) rather than by an `animation: none` rule.
3. **VICTORY hidden and grey — fixed.** Same unbounded-band geometry, plus it wore the chrome foil that
   `STYLES.md` 2 assigns to LOCKED. VICTORY now takes the volt prize foil; `tests/styles-tokens.test.mjs`
   allowlist updated to match the style guide it was already lagging.
4. **Winner's arm blown white — fixed, and the stated cause was wrong.** Not a par can: the deck pools are
   evaluated by the mat, floor and cubes only, and that handoff was declined. It is the softbox at 28.0 in a
   metallic lobe — the exact risk the RELIGHT pass logged against `SHELL_ENV_INTENSITY`, which is the knob
   used here.
5. **Heat pinned at 92–100 — fixed, and the stated cause was wrong.** Not the scripted pilot. Thermal Cutout
   tested a **rising edge**, so a seat whose heat arrived from events (a blocked hit, a deflect, a clash,
   Burst) could sit at exactly max forever without ever tripping. Now a peak test. A hold-your-own-weight
   deadband in `servoLoadQ` was also tried and **reverted**: `tests/combat-heat.test.mjs` proved it stops
   flick spam reaching Cutout inside 4–8 s, i.e. it removes heat as a limiter entirely. The edge test was the
   whole bug.

## Depth: heat is a resource and defence is a decision

- **A failed defensive guess cost nothing.** A landed deflect buys a 650 ms stun worth ~94 of a 100-Integrity
  bar; a missed press cost 400 ms of deflect availability and nothing else. `deflect.whiffHeat` now charges
  it. **6, not the 12 first tried** — at 12, `tests/opponent-behavior.test.mjs` put OVERSHOOT vs BACKLASH at
  1/12 against a 25–75 % gate, because an aggressive bot presses guard reactively and cooked itself. At 6 the
  three Pro matchups sit at 4/12, 6/12, 5/12. **That sweep is the gate that catches this; run it on a quiet
  box before touching this number.**
- **The deep-cool was an always-on subsidy**, so guarding with a still arm net-cooled at 14/s and a guard war
  could not be broken. It is now an idle bonus, gated on no active guard, charge or Overdrive.

## Reach and controls

- **The pause menu was unreachable from inside a live match, on every device.** Losing the pointer lock swaps
  `overlay: null` for `click_to_fight`, which `back()` had no branch for, so Esc did nothing once a match was
  live — SETTINGS, the STABLE camera comfort toggle, FORFEIT and QUIT were all unreachable from the only
  screen that needs them. On touch nothing called `pause()` at all. Both fixed; the touch PAUSE plate lives
  in `layout.hudBand`, deliberately **not** thumb-reachable and deliberately not a solver control.
- **A gamepad could not get past the title screen** — the poll returned before reading any button there.
  Caveat: a pad press is not a user-activation gesture, so the audio context stays suspended on that path.
- **The one teaching moment named mouse buttons on every device.** `glyphFor` now returns an action and
  `glyphLabel` renders it per device (LMB/RMB, RT/LT, or the STRIKE/GUARD plate labels); `COACH_LINE.nudge`
  is device-neutral. The title footer no longer advertises an Esc key to a phone.
- **Nothing handled a hard failure.** Added: a WebGL2 probe before the model download (an unsupported browser
  used to pay for every byte and then show a blank page), `webglcontextlost`/`restored` handling (the picture
  froze while the match kept running), and a 30 s timeout plus one retry on every boot fetch (a stalled
  connection left a pending promise forever, and BootScreen only renders an error on a *rejection*).

## Boot: 24.1 MB → ~8.1 MB

`loadModelFiles` walked every `<mesh file=>` in the MJCF into the MuJoCo VFS — all 18 STLs, 16.6 MB — while
the renderer used `arms.bake` and the collision geoms are `type="box"`. Two asset pipelines, each locally
correct, neither aware of the other. `stripVisualMeshes` now hands MuJoCo a physics-only model: **17,409,712 B
→ 590,036 B, a 96.6 % cut, 18 meshes → 4**, verified bit-exact (identical qpos over a 4 000-step rollout,
identical ncon, identical body_mass/body_inertia) and confirmed live at 4 STL requests, 78 → 64 total.
The `mass=` guard is load-bearing: `camera_mount` has no `<inertial>`, so its visual geom's mass IS its
inertia. The XML on disk is untouched — `tests/arcade-model.test.mjs` pins those bytes and `so101Sha256` is
hashed before the strip, so episode provenance is unchanged.

Also: the service worker precached the bulk tier with `cache: "reload"`, which **bypasses the HTTP cache** —
on a production first visit it re-downloaded ~22 MB while the page's own boot fetches were still in flight.
Now a plain `cache.add` (the cache key already carries BUILD_ID and chunks are content-hashed), and the bulk
list no longer includes the 14 render-only STLs the loader stopped asking for.

## Perf: tiers that mean something

- **`auto` never measured the device** — `QUALITY_TIERS[setting === "auto" ? "default" : setting]` meant a
  Chromebook, a 2019 Intel laptop and an M5 all booted DEFAULT, while `gpuTierOf` already existed and was
  used only for telemetry. Now `initialTierFor` seeds from the GPU before the first world frame.
- **A pixel budget per tier** (`maxPixels`, 4.2/2.4/1.2 M) on top of the dpr ratio, because a ratio cannot
  bound a window we do not control. `MIN_DPR` 0.5 is the floor — on a 4K panel that is a 1080p internal
  buffer upscaled. Re-derived on resize, not sampled once at mount.
- **A latching ceiling** replaces drei's `flipflops={3}`, which switched adaptation off permanently after four
  verdicts. Every decline lowers the ceiling for the session, so the controller converges downward and cannot
  oscillate. `auto` is capped at DEFAULT: HIGH costs 1.44x the pixels plus MSAA 4, and a vsync-capped 60 fps
  reads as headroom when it is really a ceiling.
- **Real monitor bounds** — the stock ones did nothing between 40 and 59 fps on a 60 Hz panel.
- **`"paused"` is now a safe phase for a tier change.** It was the one moment a struggling player reaches for
  quality and the one moment it could not be applied.
- **The `shafts` knob was arithmetically dead**: `SWEEPS.length + min(SHAFTS.length, tier.shafts)` collapsed
  6/2/2 to the same 4 cones at every tier, and the cockpit eye sits *inside* the two team cones. The budget
  now covers the sweeps too; LOW draws none.
- **PostStack is keyed on the tier**, so a session that booted HIGH no longer keeps its DepthOfField pass and
  6-level bloom after the player turns quality down.

## Also in this pass

- **The charge line was strictly dominated, so nobody ever telegraphed.** `charge.armourRawMax` 16 → 26. At 16
  almost any hook punched through a charged arm's armour, so committing to the tell lost both the exchange and
  the tempo (a plain full hook is ~31 damage in 0.66 s against a charged heavy's ~41 in 1.2 s) — and with
  nothing to punish, the deflect read/counter-read layer had nothing to read. `armourMul` untouched: the fix is
  tempo, not damage. `tests/combat-abilities.test.mjs` now reads the threshold from the tuning table instead of
  a literal, so raising it re-points the test with it. Balance sweep unchanged at 4/12, 6/12, 5/12.
- **The sparring round could trap a new player forever.** On a dock cap, `hold` sent `index` back to `grab`
  unconditionally, so a player who could pick the Core up but never lock it cycled grab → hold → grab with no
  exit from match 1 — every other step caps out and ends. It now finishes the round once "dock" is marked
  skipped, carrying the un-taught skill to the verdict. `tests/tutorial-script.test.mjs` pins the termination.
- **The boot bar sat at 0.05 for the entire model download and then jumped to 0.6**, which reads as a hang —
  and a frozen bar is most of what "it doesn't load right" actually feels like. `loadModelFiles` now reports
  each file as it lands (`onFile`, threaded through `CreatePhysicsEngine`) and the bar walks 0.05 → 0.55
  across the fetch. The denominator grows as the robot XML names its meshes, so the count is honest rather
  than smooth.

## Considered and deliberately not changed

- **The jab fires on button release**, which adds the player's own tap duration (~90 ms) to the most-used
  action. This is not a bug: press starts a potential charge and release under `JAB_TAP_MAX_MS` resolves it as
  a jab, so the system cannot know at press time which the player meant. Firing on press would mean retracting
  a committed jab when the hold continues, and it would cost the charge mechanic — which this same pass just
  spent `armourRawMax` making worthwhile. The 180 ms window is the knob if it ever needs to feel snappier.
- **The room was NOT made bright-daylight** like the reference game, because `STYLES.md:8-9` binds the PRIME
  TIME night direction and explicitly overrides the daylight one. The measured defect was narrower — the night
  had no room in it — and that is what was fixed.

## Verification

`npm run typecheck` EXIT=0 · `npm run lint` EXIT=0 · `npm run build` EXIT=0 · `npm test` — see the run below. Two test files added
(`tests/quality-budget.test.mjs`, `tests/deck-pool-angles.test.mjs`, 18 tests). No test was weakened or
skipped; `tests/styles-tokens.test.mjs` gained one allowlist entry that `STYLES.md` 2 already authorised.

Final run: **956 tests / 955 pass / 1 fail**, up from 937 at the start of the pass.

**Still failing, pre-existing and untouched by this pass:** `tests/replay-verify.test.mjs:259` — a tamper
test that mutates ctrl at step 5 000 and expects `diverged`, but gets `bit_exact`. It was failing before any
change here. Worth a look on its own: a tamper-detection test that no longer detects tampering means the
determinism check has a blind spot, most likely because the mutated ctrl row lands where the rules override
it (a slumped/Offline arm) so the sim never sees the change.
