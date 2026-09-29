# TORQUE LIMIT style guide

This is the working style guide for every user-facing surface: DOM screens, the HUD, and the brand art WP6 puts into
the world. `src/app/globals.css` implements it and `tests/styles-tokens.test.mjs`, `tests/copy-labels.test.mjs`,
`tests/brand-marks.test.mjs` and `tests/ip-guard.test.mjs` enforce it. Any exception gets written here first.

Binding sources, in order: the **PRIME TIME** art direction (below, it overrides the high-key daylight direction in
SCOPE.md 1.3 and finals-visual.md), `docs/design/SCOPE.md` (identity, section 1.3 tokens), `docs/design/BUILD_PLAN.md`,
`docs/design/GAME_DESIGN.md` sections 6 to 8, and the translation half of `docs/design/research/finals-visual.md`.

**PRIME TIME.** TORQUE LIMIT is the headline night show: the world is dark and the light is the art. Every screen
stands on the stage indigo (`--stage-950` `#07081A` to `--stage-800` `#141633`, composed as `--stage-backdrop`: two team
washes from the rig, a warm floor bounce), never on a flat void. Plates are ink with lit team edges, emissives glow,
and the big moments are sold with light: a raking sweep across a band, a seam that flares, a burst behind KNOCKOUT.

## 1. The show

| Element | Decision |
|---|---|
| Show | **TORQUE LIMIT**, *Live from the benchtop.* A glossy televised game show for robot arms. |
| Wordmark | `MARKS.torqueLimit`: TORQUE in paper, LIMIT in signal, knocked out of an ink plate cut at the 12° slant. The crossbar of the last T is a gauge needle pinned to its stem, rotated up by the slant and pointing at a tick. Render with `<Wordmark>`; `variant="bare"` drops the plate on ink grounds, `"light"` sets the letters in ink on paper. |
| Hosts | **ROOK** (hype, signal lip) and **DR. VALE** (analyst, paper lip). Captions always, one line at a time, on a slanted ink plate with the host's tag plate in front. Profiles in `src/game/brand/hosts.ts`. |
| Sponsors | **OHMSTEAD**, *Keeping you grounded* (a signal chevron arch over an earth-ground symbol). **PULPO POP** (an ink bubble with a paper octopus and a signal fizz drop). On banners, deck decals, stat stickers, the loading screen, and the intro ribbon. Never on gameplay HUD labels. |
| Mascot | **BIT**, a smiling 4 cm foam cube with a volt front face. Loading bar, Core decal, confetti. |
| Contestants | PILOT (cobalt) against OVERSHOOT, BACKLASH, DEADBAND, and the tutorial arm JIG (magenta). User models appear under their file name. |

All marks are original polygon and arc path data drawn with the block-letter kit in `src/game/brand/sponsors.ts`
(100-unit cap height, 16-unit strokes, 10-unit chamfers, slanted by the panel slant). Fills are `TokenColor` names
only, so WP6 can rasterize them through `Path2D` and recolour per surface.

## 2. Palette: one colour, one meaning

| Token | Hex | One meaning | Never used for |
|---|---|---|---|
| `--ink` | `#0E0F14` | panels, text on light, outlines, sticker shadows | warnings by itself |
| `--paper` | `#F6F3EC` | text on dark, light plates, focus of neutral controls | hits |
| `--signal` | `#FF4A1C` | the show: wordmark LIMIT, primary buttons, selected tabs, focus lip, ROOK's lip, ENGAGE | a team, the Core, damage |
| `--cobalt` | `#2A6BFF` | the ATLAS seat (the pilot side) | buttons, warnings, the Core |
| `--magenta` | `#FF2E7E` | the BLAZE seat (the AI side) | buttons, warnings, damage taken by colour alone |
| `--volt` | `#FFD60A` | the Core and the prize: Core chip and marker, docks, lock-in, gold foil on VICTORY / NEW PB, BIT | highlights, heat, final-round text |
| `--strike` | `#FFF36B` | a landed hit: damage number fill, integrity drain slice, struck silhouette pip | UI chrome |
| `--crit` | `#B6FF2E` | a critical hit: crit number and CRIT tag | anything else |
| `--block` | `#3DE0FF` | guard and deflect: BLOCKED and DEFLECT tags, deflect feed rows | focus, anything else |

Neutrals `--ink-800/700/600/500/400`, `--paper-200/400` and `--chrome-100/500` carry structure only. The stage
indigos `--stage-950/900/800/600` are surfaces only: screen backdrops, band gradients, the letterbox.

**Glow.** `--glow-cobalt`, `--glow-magenta`, `--glow-signal` and `--glow-paper` are their colours thinned for light spill
(they follow the colourblind swap). A glow is a `drop-shadow` on the parent of a clipped plate (a filter on the clipped
element itself is clipped away), a `text-shadow` on display type, or a `box-shadow` on an unclipped strip. Glows carry
the same meaning as their colour; there is no volt, strike, crit or block glow outside the selectors that colour allows.

- Where each semantic token may appear is enforced per selector (`ALLOWED` in `tests/styles-tokens.test.mjs`):
  volt in `.hud-core*`, `.tl-prize*`, `.tl-stamp--gold`, `.tl-sticker--prize`; strike in `.hud-hit*`, `.hud-dmg__num`,
  `[data-hit="true"]`; crit in `[data-kind="crit"]`, `[data-tone="crit"]`; block in `[data-tone="block"]`.
- Text on volt, strike, crit and block is ink. Text on signal, cobalt and magenta is paper, 18 px bold or larger.
- **Danger, contested, fault** are hazard stripes (ink/paper, −45°, 10 px bands), pulsing, and shape. Never a new hue.
- **Colourblind teams** (`data-colorblind="true"` on `<html>`): the BLAZE colour becomes amber `#FF9F1C`, so the pair
  differs in hue and luminance. Seats also keep their shape cue: ATLAS plates cut on the left, BLAZE on the right.
- Per frame: neutrals, one team colour per half of the screen, at most one semantic accent. Hit colour lasts < 700 ms.
- UI source never hard-codes a semantic hex value or references a semantic token outside `wordmark.tsx`.

## 3. Type

Loaded by `src/app/fonts.ts` through `next/font/google` (self-hosted at build) as CSS variables. The same faces for
WebGL SDF text live in `public/fonts/` (from `@fontsource`, copied by `scripts/sync-fonts.mjs`, with `OFL.txt`).

| Role | Family | Class | Use |
|---|---|---|---|
| Display | **Anton** 400, slanted with `skewX(-10deg)` (`.t-slant`), line height 0.86 | `.t-display-xl` 160 px, `.t-display-l` 96 px | KNOCKOUT, round numbers, names on cards, stamps |
| HUD and menus | **Barlow Condensed** 500 to 900 with real italics | `.t-num-xl` 64 px 900 italic, `.t-num-m` 36 px 800 italic, `.t-plate` 28 px 800 italic caps, `.t-label` 13 px 600 caps +0.1em | plates, buttons, labels, damage numbers, counters (tabular) |
| Machine truth | **Chivo Mono** 400/500/700 | `.t-mono` 12 px | physics and policy numbers, seeds, hashes, status lines |

Sizes are the 1080p reference and scale with `min(vh, vw)` clamps. Damage numbers are Barlow Condensed 800 italic at
(28 + 16·m) px, ×1.3 for crits and ×0.85 when guarded; physics readouts under them are Chivo Mono or `.t-label`.
No other families appear in computed styles.

## 4. Shapes

- **One panel slant: 12°** (`--slant-panel`, `SLANT_PANEL_DEG`). A plate's cut is `height × 0.2126`.
- **Stamps** slant by 10° (`skewX(-10deg)`) and rotate a third of that; stickers tilt −4° with a 3 px border and a hard
  4 px ink offset shadow. The only other angle is the −45° hazard stripe.
- **Plates** (`.tl-plate`): ink body, optional 4 px lip in a team or show colour along the leading slanted edge, paper
  text. `--cut-left` for the pilot side, `--cut-right` for the AI side.
- **Notched tags** (`.tl-notch`): one 10 px corner clip. Feed rows and policy chips.
- **Foil**: `.tl-stamp--gold` (prize: VICTORY, NEW PB) and `.tl-foil-chrome` (premium neutral: MVP tile, LOCKED text).
- **Halftone** (`.tl-halftone`) at 8–18% inside panels or fading toward a seam.
- **Corner radius is 0 everywhere. No `backdrop-filter`, no glass.** Soft shadows exist only as coloured light (see
  Glow); sticker shadows stay hard ink offsets. Circles appear only as light (shock rings, drawn with radial
  gradients), never as a rounded box. The pause scrim is a hard 80% layer and the canvas goes 70% grayscale through a
  filter on the canvas element.
- **Icons** are inline SVG from `src/game/ui/kit/glyphs.tsx`, sized to the text. No Unicode symbol glyphs in copy;
  the middle dot `·` is the only separator.

## 5. Motion

Every animated element belongs to exactly one tier.

| Tier | Curve | Used by | Never used by |
|---|---|---|---|
| broadcast | `--ease-snap: cubic-bezier(.3,0,0,1)`; exits `--ease-exit: cubic-bezier(.6,0,.9,.4)` | plates, tote updates, captions, feed rows, wipes, menus, count-ups, policy chip | KO, lock, match end |
| impact | `--ease-impact: cubic-bezier(.2,1.5,.35,1)` (overshoot) | ROUND N, 3·2·1, ENGAGE, TIME, SUDDEN DEATH, STOLEN, damage number pop, centre tags, VS split | menus, captions |
| celebration | impact plus a stamp (rotate, scale 1.3 → 1) and an 80 ms 2 px parent shake | KNOCKOUT with SHORTED OUT, LOCKED, VICTORY, NEW PB, REGISTERED, CALIBRATED | anything more than twice a round |

| Motion | Keyframes | Total |
|---|---|---|
| Slam-in (`.tl-anim-slam`) | scale 1.6 → 0.96 at 90 ms → 1.02 at 160 ms → 1.0 | 240 ms |
| Callout slam (`--ease-slam`, EMOTION_BIBLE 5.7) | scale 1.8 → 1.0, skew −20° → −10°, letters 30 ms apart; impact frame on the first frame | 240 ms in, hold, 180 ms out |
| Plate / feed row (`--ease-plate`, M3 emphasized-decelerate) | translateX 48 → 0, rows 40 ms apart | 200 ms |
| Numbers (`--dur-roll`) | tabular digits roll 350 ms, then a 120 ms pop | 470 ms |
| Bars | linear at 60 Hz via a CSS variable, never React state | |
| Round card light sweep (`--dur-sweep`) | one 12° paper band, linear | 900 ms |
| Menu hover / press | spring, damping 0.8: scale 1.03 on hover, 0.97 on press | ~180 ms |
| Plate slide (`.tl-anim-slide-l/r`) | translateX ±48 px → 0 | 200 ms |
| Stamp (`.tl-anim-stamp`) | rotate −6.7° → 0, scale 1.3 → 1 | 160 ms |
| Exit (`.tl-anim-exit`) | translateX +40 px, opacity 0 | 140 ms |
| Damage number | pop 1.4 → 1.0 in 80 ms (merge re-pops at 1.2), rise 28 px over 600 ms, fade in the last 200 ms | 600 ms |
| Count-up (`<CountUp>`) | tabular digits roll, then pop to 1.15 and back | 350 + 120 ms |
| Feed row | enter 180 ms, hold 4500 ms, collapse 160 ms | 4840 ms |
| Screen wipe (`<Wipe>`) | ink panel with signal lips cuts across at the slant | 360 ms |
| Kinetic letters (`.hud-letter`) | each glyph streaks in from the left (skew −28°, scale 1.5 × 0.8, a two-step smear behind it), overshoots, settles; 26 ms stagger | 300 ms + 26 ms/letter |
| Band open and rake | banner and round bands open from the centre (`clip-path`), then a paper light rakes across | 220 ms, rake 640 ms |
| Callout | streak wipes open under the word, letters stagger in, the whole callout holds and lifts out | 950 ms |
| Splash | KNOCKOUT: 72% paper flash, team burst with rays, two shock rings, twelve shards, letterbox; LOCKED and VICTORY: burst, rings, shards; STOLEN, TIME, SUDDEN DEATH, ROUND TO: one ring | 420 to 820 ms |
| Stage beams | two team light shafts sway behind full-screen menus, the boot and the green room | 11 s loop |
| Button rake | a paper light crosses a button as it takes focus | 520 ms |
| Siblings | 40 ms apart, at most 6 | |
| Low integrity | empty bar segments scroll hazard stripes, 700 ms period; no full-screen tint | loop |

HUD motion animates transform and opacity only (plus `clip-path` on one element at a time, and `text-shadow` during a
letter's first 300 ms), and nothing eases longer than 500 ms except count-ups, the callout's life, and the splash.
**Reduced motion** (`data-reduced-motion="true"`, defaulted from `prefers-reduced-motion`): impact and celebration
animations become 120 ms fades, shakes are removed, the splash (flash included) does not play, and the beams, rakes,
rings and letter streaks stand still.

## 6. HUD rules (EMOTION_BIBLE 2, 5.7, 8.1)

- The React tree mounts once per match; `src/game/ui/hud/hud-runtime.ts` writes every live value after WP6's composer
  renders (`game.onAfterRender`). A fight commits nothing in React.
- **Six elements until match 2:** the crosshair node (range ring from `ReticleState`, the receipt of every contact under
  it for 700 ms: `SOLID 1.4 m/s` with the word band for a profile's first ten receipts, `BLOCKED` alone for a guard, the
  `+0.3` PB delta in volt once a PB exists), the opponent plate (`BACKLASH · ROOKIE`, a `SPARRING` tag and no bar in
  round 1 of match 1), your own bar (mounted hidden, slides in 200 ms on the first damage taken), the Core marker, one
  caption, the wordmark bottom-left. Nothing else is visible in a fight in match 1.
- **Gate table** (`showKitFor(matchesPlayed)` in `format.ts`, written as `data-timer / data-tags / data-heat / data-kit`
  on the HUD root at match start): timer and round pips from match 2; centre tags, the tag over the opponent's gripper
  (OPEN, PUNISH, WHIP) and the DEFLECT caption from match 2; the heat cell from match 3; abilities and the kit strip from
  match 4; the Core chip the first time the Core is live in any match; PB stamps after one completed match.
- Plates: pilot plate cobalt lip, cut left; AI plate magenta lip, cut right; ten-segment integrity bars with a 120 ms
  strike slice and a 900 ms signal ghost drain; `-31` under your plate in the attacker's colour for 700 ms; `WHIFF` in
  grey on the opponent's plate for 300 ms. Policy chips only in the Lab and against user models.
- Centre third: only WP3's WebGL reticle, the crosshair node, damage numbers (only when damage landed), and from match 2
  at most two tags (CLASH, STAGGERED, SHORTED, BURST, STUNNED, LATE GUARD).
- Callout slams (FIRST BLOOD, CRIT, DEFLECT, STREAK at 5, 9, 13 hits, STEAL): 240 ms in on `--ease-slam`, scale 1.8 to
  1.0, skew −20° to −10°, letters 30 ms apart, hold, 180 ms out; one at a time above the opponent at 24 % height
  (`createCalloutSlot`: a new one replaces the one up after 380 ms, or at once when it outranks it; STEAL = CRIT >
  DEFLECT = STREAK > FIRST BLOOD), and they step aside while a banner is up. They never queue. One `FIGHT` slam on the
  bell; `ROUND N` / `FINAL ROUND` under the round intro; no 3-2-1.
- In a fight nothing moves longer than 240 ms and nothing sits over the opponent's silhouette. Between rounds (400 to
  900 ms may fill the screen): one banner at a time, 250 ms apart, dropped after 1.5 s in the queue, celebration outranks
  impact (KNOCKOUT with the SHORTED OUT sticker, LOCKED, ROUND TO, TIME, SUDDEN DEATH, and the result slab by cause:
  VICTORY, SHORTED OUT, OUT-LOCKED, OUT-POINTED, never a bare DEFEAT). While KNOCKOUT is up the letterbox closes over the
  plates. The round card's light sweep is `--dur-sweep` (900 ms).
- The caption: bottom centre, one at a time. A host line carries the host's tag plate; a prompt (`prompt.*` line id from
  the tutorial script) hides the tag and shows the mouse glyph the runtime parsed from `LMB` / `RMB` / `MOUSE` in the
  text (`HIT IT` with the LMB glyph). Prosody is data: `data-ramp` 0..3 sets weight 500 to 900, size 1.0 to 1.35× and a
  reveal of 28 to 60 chars/s (`--reveal-ms`); `data-release` stretches the final word.
- Gameplay HUD labels never carry brand text; sponsor reaction frames live on the jumbotron bug only.

## 7. Copy

- Labels, buttons, tabs, toggles, stickers and hints: caps, at most three words.
- Hosts (EMOTION_BIBLE 7): the unit of speech is one ROOK clause, optionally VALE's one number inside 2 s. 3 s of hard
  silence after a unit, at most one unit per 6 s, silent for at least 45 % of a fight, 14 to 26 units in a three-minute
  match, no two units in a row from the same host, the player's name at most twice a match, no line inside the last 20,
  at least 12 variants per event class. ROOK never quotes a number; every VALE number is a telemetry value. VALE only
  coaches in matches 1 to 3 (state-tied, one per 8 s, only while the opponent's menace is under 0.2); her numbers start
  at match 4. ROOK's KO release line starts 650 ms after the confirm. Verdict copy: `SHORTED OUT` / `OUT-LOCKED` /
  `OUT-POINTED`, and every loss names its gap (`LOCK 6.8 / 8.0 s`, `INTEGRITY 4 LEFT`, `2 UNGUARDED HOOKS`).
- Instructions and tips: one caps line. No exclamation marks in UI copy.
- Units stay lower case where physics writes them: `2.7 m/s`, `41 ms`, `N·m`.
- Harness words: Register Entrant, The Lab, CLEARED FOR BROADCAST, POLICY FAULT, ARCADE PHYSICS · NOT VERIFICATION.
- Objective words: the Core; dock, lock, steal (never "pry").

## 8. Calibration record

WP6 records the lit-scene calibration here from `?debug=greycard` on the DEFAULT tier. Targets: grey card luminance
0.46 ± 0.02, brightest lit paper at or below 0.75, and every lit surface below the bloom threshold so only
`toneMapped: false` emissives (LED strips, par-can lenses, jumbotron, holographic crowd, charge glow) bloom.

## 9. IP line

Style, genre conventions and design patterns are wanted; names are not. `tests/ip-guard.test.mjs` fails on the
reference game's name, studio, typefaces, sponsors, hosts, catchphrases or arena names anywhere in `src/`, `public/`,
this file or `README.md`.

## 10. Screen furniture

Named pieces that carry real numbers. None of them may ever show a figure the game cannot produce.

| Piece | Decision |
|---|---|
| Call sheet (`.gr__sheet`) | The green room's card for tonight: opponent name, tier (or preset for a user model) and kit, and the head-to-head this browser's profile holds against that opponent. Ink plate, signal lip, cut left. Under 820 px of height it folds into one strip so the seven rundown rows keep their room. `FIRST MEETING` when the profile has no record. |
| Tally light (`.gr__tally`) | Reads the match phase, nothing else: `STANDBY` with a blinking lamp until the director hands the green room over, then `STAGE READY` with a signal lamp. |
| Series line (`.pm__series`) | Post match, under the score: the running record against tonight's opponent, read back after this match lands in the profile, so it counts the fight just played. Hidden until the pair have met. |
| Roster rail (`.ent__rail`) | One row, always. It centres while the whole roster fits and scrolls once it does not; the screen-edge fades make a card past the edge read as "the row continues". A partly visible card at 1920 is the rail working, not a clipped card. A horizontal scroller has to clip its vertical axis, and the card's action row is bottom-anchored, so the portrait (`.ent-card__portrait`) is the card's give: capped at 150 px but tied to `17vh`, it shrinks at 720p, where the card's `46vh` floor otherwise leaves no headroom, and is unchanged from 1080p up. |
| Clipping text boxes | Barlow Condensed's italic caps draw a glyph box about 1.12 em tall, so a box that clips its own text (`.tl-btn .truncate`, `.lab-pick__name`, `.rep-row__seats`, `.pm__score-name`, `.hud-seat-name`, `.hud-stats__name`) sets `line-height: 1.26`. At the plate's own line height the clip shaved the baseline off. Boxes set in Chivo Mono (`.hud-policy-chip span.t-mono`, and `.gr__sheet-line` / `.gr__sheet-h2h` in the folded call sheet) already clear it on `.t-mono`'s own 1.3. New clipping text boxes join one list or the other; `tests/styles-tokens.test.mjs` fails on one that joins neither. |
