# TORQUE LIMIT — screen captures

Every PNG here is a real page screenshot of the running game: the WebGL canvas and the DOM HUD
composited by the browser, no mock-ups and nothing pasted together by hand. All of them were
rendered **headless on the homebase server** under software WebGL — SwiftShader, renderer string
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` — and copied here
with `scp`. No browser was opened on the director's machine, and nothing played audio: every run
zeroes the audio settings, turns the host voice off, stubs `speechSynthesis.speak` and launches
Chromium with `--mute-audio`.

Viewport is 1440x900 unless the row or the folder says otherwise. Colour, layout, HUD text and
effects are faithful. **Frame rate is not**: software rasterisation says nothing about how the game
performs on a real GPU, and no timing in these shots should be read as performance.

## How the in-match moments were caught

A strike flash lives about 200 ms and a software-rendered screenshot takes seconds, so these were not
snapped in passing. The capture tool (`~/tl-tools/moments.mjs` on homebase) watches the game's own
event bus; the instant the wanted event fires it stops the sim clock, holds the wall clock — the HUD
ages damage numbers and banners off `performance.now` — pauses every CSS animation and rewinds it to
the beat worth seeing, then shoots. What you see is the frame the real match produced.

The pilot seat in the fight shots is played by the built-in `human_proxy` bot through the human
control path, which is why the nameplate reads HUMAN PROXY instead of a callsign. The camera is the
cockpit rig, the same first-person view a human seat gets.

Capture helpers, all server-side only, in `~/tl-tools/` on homebase: `tlboot.mjs` (shared boot, hard
silence, instrumentation), `moments.mjs` (event-triggered in-match frames), `visshot.mjs` and
`lobby.mjs` (cockpit and Green Room with the `?debug=feel` counters), `sweep.mjs` (responsive DOM
sweep), `ship-boot.mjs` (the ship-stage boot check).

## Front of house

| File | What it shows |
| --- | --- |
| `s01-boot.png` | Boot screen: wordmark, BIT mascot, the progress ladder mid-load (`loading mujoco.wasm`), the FLICK FAST · ARM SPEED IS DAMAGE tip and the sponsor row. |
| `s02-title.png` | Title with the attract match live behind it: both arms on the deck, crowd tiers, truss, PRESS ANY KEY, LIVE FROM THE BENCHTOP, PRESENTED BY. |
| `s03-cockpit-choice.png` | PICK YOUR MOUNT: STANDARD vs STABLE COCKPIT, wave diagrams and spec lists sitting on shared baselines. |
| `s04-lobby.png` | GREEN ROOM: the numbered rundown 01 FIGHT … 07 SETTINGS and the CALLSIGN PILOT W0·L0 plate. **Stale set** — see `polish-green-room-after.png` for the current 3D staging. |
| `s05-entrants.png` | ENTRANT SELECT: JIG, OVERSHOOT, BACKLASH, DEADBAND cards with archetype line, tier chips and local record, plus the REGISTER ENTRANT drop target. |
| `s06-settings.png` | SETTINGS, CONTROLS tab: sensitivity, vertical, invert Y, pad deadzone and the rebindable key list, which scrolls — the shot is cut mid-row at STRIKE KEY. The list is one row shorter than when this was shot: OPTICS is gone (SCOPE 2.2). |
| `s07-lab.png` | THE LAB: ATLAS and BLAZE seat columns, the RULES column (preset, timing, control rate, seed, rounds, delays, limits, record) and RUN MATCH / VERIFY LAST EPISODE / CHECK DETERMINISM. |
| `s08-replays.png` | REPLAYS, empty state: storage meter and the IMPORT EPISODE drop target with NO EPISODES YET. |
| `s22-loadout.png` | GREEN ROOM with the LOADOUT row open: WHIP, PIVOT and ANVIL with torque, integrity and the speed/torque/integrity bars. **Stale set**, same as `s04`. |
| `s23-replays.png` | REPLAYS with a recorded episode: HUMAN PROXY VS JIG ROOKIE, preset and driver chips, result, size, and OPEN / VERIFY / pin / export / delete. |
| `s24-replay-viewer.png` | REPLAY VIEWER: scrubber, step controls, 0.25x–4x, BRAIN ON/OFF and VERIFY over the replayed arena. |
| `s30-register-entrant.png` | REGISTER ENTRANT running its checklist on `public/policies/example-policy.js` (file parsed, exports act(), reset, cold act, fixture acts, finite, limits, deterministic). |

## Match

| File | What it shows |
| --- | --- |
| `s09-match-intro-vs.png` | The VS card: cobalt/magenta slant split, PILOT and DEADBAND nameplates with driver tag and local record, the VS stamp on the seam, PRESENTED BY ribbon. |
| `s10-round-intro.png` | ROUND 1 over the cockpit view, with the hold-to-skip bar. |
| `s11-fpv-idle.png` | First person at rest: the pilot's own mount and gripper in the foreground, the opponent across the deck, HUD bar, jumbotron mirror, KIT panel. |
| `s11b-broadcast-fight.png` | The same fight from the broadcast camera — both fighting arms, both camera mounts, clutter cubes, reach rings, crowd and jumbotron. |
| `s12-fpv-strike-landing.png` | A strike landing: impact flash and sparks, the `8 · IMPACT 1.1 M/S` damage number, a GRAZE tag, the FIRST STRIKE banner and DR. VALE calling the first scoring contact. |
| `s13-guarded-hit.png` | A hit that lands into JIG's raised guard, with the guarded/graze tag. |
| `s14-deflect.png` | A deflect: the DEFLECT tag, JIG carrying the Core, the TIME band as the round expires. |
| `s15-stagger.png` | A stagger: the STAGGERED tag, the `14 · IMPACT 1.7 M/S` number and ROOK on the call. |
| `s16-core-dropping.png` | The Core falling from the chute, CORE LIVE on the HUD, ROOK: SOMEBODY COMMIT. ANYBODY. |
| `s17-core-docked.png` | The Core docked on the pilot's ring with the HUD chip counting LOCK-IN 8.0. |
| `s18-core-steal.png` | The Core contested — both arms on it and the contest cue up. |
| `s19-ko.png` | The KO band: KNOCKOUT with the SHORTED OUT sticker, credited to OVERSHOOT, over the de-rezzed deck. |
| `s19b-ko-derez.png` | The same beat one frame earlier from the winning side: the de-rez sparks, the `83 · IMPACT 1.4 M/S` finishing number, COMBO tags and ROOK: SHORTED OUT! OVERSHOOT IS DONE. |
| `s20-post-match.png` | POST MATCH, STATS tab: damage, strikes, crits, deflects, steals, top speed, block rate, reaction net, lock-in held, and REMATCH / SWAP OPPONENT / GREEN ROOM / PIN REPLAY / EXPORT EPISODE. |
| `s21-pause-menu.png` | PAUSED over the greyed, frozen cockpit view: RESUME, SETTINGS, FORFEIT ROUND, QUIT TO LOBBY. |

## The Lab

| File | What it shows |
| --- | --- |
| `s27-model-report.png` | MODEL REPORT for a Proving Ground run, BACKLASH vs `example-policy.js`: both seats CLEARED FOR BROADCAST, the comparison bars and the metric table (damage, optics impulse, approach speed, strikes, grazes, crits, attempts, block rate, reaction raw and net). |
| `s28-lab-results.png` | The Lab's own result panel after that run. |
| `s29-lab-verify.png` | VERIFY LAST EPISODE: REPLAY VERIFIED · BIT-EXACT, 1369 FRAMES. |

## Phone and tablet

Captured at device pixel ratio 2, so the PNGs are twice the CSS size named here.

| File | CSS viewport | What it shows |
| --- | --- | --- |
| `s25-phone-title.png` | 390x844 | The title screen at phone width. |
| `s26-phone-touch-controls.png` | 390x844 | In-match portrait with the solved touch layer: STANCE and SWING pads in the bottom corners, STRIKE / GUARD / GRIP / DRIVE / ABILITY on the thumb arcs, the clock plate and the two-up seat row above. |
| `s26b-phone-touch-controls-landscape.png` | 844x390 | The same layer in landscape. |

## Responsive sweep

Eight menu screens at three viewports, one folder each: `1280x720/`, `1920x1080/`, `390x844/`.
Every folder holds `title`, `cockpit-choice`, `green-room`, `loadout`, `entrants`, `lab`, `replays`,
`settings`. These are DOM-layout checks, not art passes.

## Packaging (SCOPE 4)

| File | What it shows |
| --- | --- |
| `pwa-online.png` | The installed PWA on its first, online load. |
| `pwa-offline.png` | The same install after the network was cut and the page reloaded cold — it boots from the service-worker cache. |
| `app-pwa-offline-match.png` | A live match in that offline PWA. |
| `app-icon-maskable-512.png` | The 512 px maskable app icon, generated from the wordmark geometry. |
| `app-web-export-boot.png` | **Misnamed.** Byte-identical to `s03-cockpit-choice.png`; it is not the export's boot screen. |

## Before and after

| File | What it shows |
| --- | --- |
| `polish-visuals-before.png` | Cockpit at 1440x900 before the lighting, crowd and deck-print pass, with the `?debug=feel` counters burned in (225 draw calls / 1,253,740 triangles). |
| `polish-visuals-after.png` | Same camera, same strike moment, after it (227 calls / 1,254,316 triangles). |
| `polish-green-room-after.png` | The restaged Green Room: the eye-level menu slabs replaced by the deck-level prep caddy and its rack of numbered cue cards. This, not `s04`, is the current set. |

## Earlier stages

`t1-*`, `long-*`, `flow-*`, `f-*` and `h-*` are captures from the earlier render, flow and harness
stages, kept for before/after comparison (`flow-match-intro.png` is the tutorial card overlapping the
round intro before that fix; `flow-round-intro-fixed.png` is after). `flow-cockpit-1440.png` is
byte-identical to `s03-cockpit-choice.png`.

## Ship boot check (no shot, numbers only)

`~/tl-tools/ship-tiers.mjs` walks the real UI once — title → PICK YOUR MOUNT → GREEN ROOM →
an autonomous Arcade match at each quality tier → POST MATCH — at 1280x720 on homebase, reading the
`?debug=feel` counters. Result: **0 console errors, 0 GL warnings, 0 failed requests, 0 context
losses**, every screen reached.

| Tier | Device pixel ratio | Draw calls | Triangles (incl. the shadow pass) | Programs (pre-warm 87) |
| --- | --- | --- | --- | --- |
| `low` | 1.00 (pinned) | 185 | 1,250,192 | 104 |
| `default` | 1.25 | 217 | 1,254,243 | 105 |
| `high` | native — 1.00 headless | 219 | 1,254,245 | 105 |

Steady-state cockpit frames during a fight. Another run of the same tier caught frames as low as 106
calls / 626,986 triangles: the jumbotron feed camera re-renders on its own clock (8 Hz at `low`, 12 at
`default`, 15 at `high`) and roughly doubles both counts on the frames where it fires. `high` reads
dpr 1.00 only because it takes the device's own ratio and a headless Chromium reports 1; on a Retina
display it would be 2.

---

# Still wrong, or not verified

This section is the honest list. "Fixed" means the code that caused it changed and something checks
it; "not re-shot" means no capture in this folder shows the fix yet.

## Fixed since the last review

| Was | Now |
| --- | --- |
| Phone layout not ready: the two virtual sticks overlapped, the button cluster sat in the middle, the HUD bar was clipped. | The solved touch layer is mounted and measures clean at 390x844, 844x390 and 1194x834: 0 clipped, 0 control overlaps, 0 controls over HUD text, no page scroll. Re-shot as `s26` and `s26b`. |
| The lobby's 3D menu slabs read as clutter, crossed the blue arm and duplicated the DOM rundown. | Replaced by the prep caddy and cue cards. Re-shot as `polish-green-room-after.png`. The WARM UP card also reported the wrong id (`warm_up` vs `warmup`) and did nothing when jabbed; it works now. |
| Damage numbers stacked on top of each other and became unreadable. | `spreadLabels()` pushes colliding labels apart, newest keeps the contact point. Unit-tested. **Not re-shot.** |
| Long display names overflowed the winner and round bands. | `.tl-fit` container-query fit-to-width: the text drops a size instead of running off the plate. **Not re-shot.** |
| The replay list's storage meter read 0 B while the panel beside it named megabytes. | The meter now scales against `max(cap, other + human)` and shows both bands, so it cannot read 0 B while episodes exist. **Not re-shot.** |
| A commentary line could play long after it stopped being true. | A queued line is now retired by either clock — the wall deadline it was queued against, or sim time moving past the moment it described. **Not re-shot.** |

## Open

1. **The LOCKED band has never been captured.** Across roughly a dozen bot-vs-bot matches the Core
   was dropped, chased, carried and contested, but `lock_in_start` only fired once (with a
   Champion-tier DEADBAND, `s17`) and no run held the dock for the full eight seconds. The real
   finding underneath it: **at Contender tier the AI effectively never completes the Core
   objective.** That is an opponent-balance question, not a capture problem, and nothing in this
   pass touched it.
2. **`app-web-export-boot.png` and `flow-cockpit-1440.png` are byte-identical to
   `s03-cockpit-choice.png`.** Two capture runs saved the wrong frame. The web export and the
   desktop shell *were* verified booting and playing (see `docs/APPS.md`), but these two files are
   not evidence of it.
3. **`s04-lobby.png` and `s22-loadout.png` are stale** — they predate the caddy.
   `s06-settings.png` is cut mid-row at STRIKE KEY with no visible scroll affordance on the KEYS
   list; the list does scroll, but nothing in the frame says so. Worth a look.
4. **The cockpit rest pose parks the pilot's own gripper across the centre of frame**
   (`s11-fpv-idle.png`, `s13`, `s15`). It clears the moment the arm reaches (`s12`), but the neutral
   read is blocked. Not addressed — it is a home-pose decision, not a bug.
5. **REGISTER ENTRANT is clipped at the right edge of the entrants row at 1440x900**
   (`s05-entrants.png`): the card title and the `.js .mjs .json` hint are cut off. Not addressed.
   Separately, the rail clipped 8 px vertically at 390x844 under `overflow-y: hidden`; that one *is*
   fixed (tighter card block padding and rail gutters at phone width) but is **not re-shot**.
6. **The Lab's VERIFY verdict was drawn underneath the results panel** (`s29-lab-verify.png`), and
   the BLAZE stamp hung past the card's right edge (`s28-lab-results.png`). The verdict now lives in
   its own `lab__foot` footer rather than behind the results card, but **this was not re-rendered at
   ship**, so treat it as believed-fixed, unverified.
7. **The replay viewer titled an episode ATLAS VS BLAZE** where the list showed entrant names
   (`s24-replay-viewer.png`). Both screens now read the same field — `episode.meta.seats[seat].name`
   — so either the shot caught the pre-load fallback or that episode genuinely carried seat ids as
   names (a Lab run does). **Not reproduced, not re-shot.**
8. **A second round clock at phone width** was reported during the touch pass: the clock plate and
   the tote row appearing to read the same time. Only one clock exists in the DOM (`hud-timer`), so
   if this is real it is the in-world jumbotron mirror lining up under the HUD. **Not reproduced**
   in `s26`. Left open.
9. **The cyclorama's painted upper bowl** still uses the older blocky crowd figures, so the painted
   rows behind the instanced rake are cruder than the rake in front of them. Not visible at cockpit
   range; worth folding in if a wider camera ever shows it.
10. **The rim spot throws a soft coloured pool on the deck** that is bright at its core. It keeps its
    hue rather than burning to white, but if it should be tighter the two numbers are
    `CALIBRATION.rim.intensityCd` (4.2) and `rim.angle` (0.32) in `src/game/render/quality.ts`.

## What only real hardware can settle

Nothing in this folder can answer any of these. Every shot was rendered by a CPU rasteriser on a
headless server with no GPU, no sound card, no pointing device and no touchscreen.

- **Frame rate, frame time, and whether the quality tiers are set right.** Draw-call and triangle
  counts here are real; the milliseconds are not.
- **Pointer-lock feel** — the mouse-to-reticle latency the whole game is built around, and Chrome's
  re-lock refusal after a user-initiated exit.
- **Gamepad rumble.** `vibrationActuator.playEffect("dual-rumble", …)` is called on the event frame;
  no headless run can tell you it was felt.
- **Audio.** Every run here is hard-muted by policy. The mix was verified offline
  (`OfflineAudioContext`, `renderAudioReport()`, unit tests) and never through a speaker.
- **Touch on a real phone.** The layer is measured at phone and tablet viewports with a simulated
  coarse pointer; thumb reach, palm rejection and the safe-area insets of an actual notch are not.
- **The packaged macOS app.** `npm run app:mac` only runs on macOS, and the director's laptop was
  kept free, so the `.app`/`.dmg` sizes in `docs/APPS.md` are expectations rather than measurements.
- **The iOS and Android shells.** `npx cap add` needs Xcode or Android Studio, which SCOPE §4 forbids
  installing here. `capacitor.config.ts` is committed and the sequence is written down; it has never
  been run.
