# TORQUE LIMIT: Game Design Document

**Status:** Build spec v2.0, 2026-09-16. Branch `fps-duel`. Repo `wrestling_arena`. v2.0 folds in the adversarial critique (fun, ai-slop, feasibility, harness). Every accepted or rejected issue is listed in section 14.
**This file is the source of truth.** If code, a research doc, or a ticket disagrees with it, this file wins. Change it through a PR that names the section and the reason.

Inputs, all read in full: `docs/design/research/{codebase,combat-design,ai-opponent,finals-feel,finals-visual,fps-feel}.md`. Where the research docs disagree, this document picks one answer. Section 13 lists every conflict and the choice made.

> **Legal and identity line.** The reference game taught us two things: a fight reads better as a *show*, and a timed objective that can be interrupted creates late drama. We keep exactly those two ideas (the distance audit in 1.5 enforces the limit) and nothing else: no names, logos, sponsors, characters, announcer names or lines, arena names, audio, textures, screenshots, fonts, vocabulary, or signature set pieces. Our fiction is our own: **a robot-arm fight streamed live from a workbench in a maker space.** Fonts are OFL from Google Fonts. Recorded audio is either recorded by us or CC0 and credited.

---

## 1. Vision, pillars, brand

### 1.1 One sentence

**TORQUE LIMIT is a first-person, one-on-one robot-arm fight streamed live from a workbench.** You pilot a real, simulated SO-101 arm from a camera bolted beside its base. You flick, guard, deflect, and wrestle a rival arm controlled by an AI, ours or yours, under true MuJoCo physics, while a room full of people leans over the bench. Every match is also a recorded, re-simulatable experiment, and a stock-physics preset turns the same arena into a verification harness for real SO-101 policies.

### 1.2 Four design pillars

Each pillar comes with a test. A feature that fails every test gets cut.

| # | Pillar | What it means | The test |
|---|---|---|---|
| P1 | **Physics is the fight** | Every hit, stagger, KO slump, and thrown cube comes out of MuJoCo contacts and servo limits. No canned hit animations, no scripted forces, no faked outcomes. | Could this moment be reproduced by re-simulating the recorded per-step `sim.ctrl` column and mutation log? If not, it's fake. |
| P2 | **Instant intent, honest weight** | Your *command* (ghost arm and reticle) answers the mouse in the same frame. Your *arm* answers at the speed a torque-limited servo allows, and that lag is the skill. The camera moves only with your stance, never with each swing. | Mouse-to-reticle is the same rendered frame (WebGL overlay). Mouse-to-first-visible-arm-motion is ≤ 45 ms. Nothing in the input path is smoothed; only the camera stance is low-passed. |
| P3 | **A bench, a crowd, a show** | A live stream shot on a phone over a real workbench: clamp lamps, a dark fight mat, people crowding in out of focus, one deadpan operator reading the run log. Chaos lives on the mat; the HUD stays calm. | Pause on any frame. It should read as a live event at human scale, not a dashboard, a tech demo, or a knock-off of another show. |
| P4 | **Proof on the bench** | The game doubles as a policy harness. Any seat can be a human, the built-in AI, an uploaded JS module, a JSON trajectory, or a local Python process. Stock presets never change the robot model, never let game rules touch scoring, and record everything needed to re-simulate bit-exact and train in LeRobot. | Can someone register a LeRobot-style policy (images + joint state), run it on the stock preset, export the episode, re-simulate it bit-exact, and load the export in LeRobot without leaving the app? |

### 1.3 Brand (all original, one tone: dry lab humour)

| Element | Decision |
|---|---|
| **Show name** | **TORQUE LIMIT**. The name nods to the real 2.94 N·m servo ceiling. |
| Tagline | *"Live from the benchtop."* |
| Wordmark | `TORQUE` in Archivo ExtraCondensed Black Italic, knocked out of an ink parallelogram cut at the font's own italic angle. `LIMIT` follows in the same face. **The crossbar of the final T is a gauge needle** pinned at the top of the stem and rotated to the slant angle, pointing at a small tick. At ≥ 64 px `LIMIT` may use a 3 px paper outline; below 64 px it is always a solid knockout (counters stay open). |
| League (in-game progression) | **Open Servo League**: a bracket you climb (7.3.11). Anyone can register an AI. |
| Venue | **Bench One**, a workbench in a maker space, shot at real human scale (6.6). The robots are 30 cm desk arms; the people are people. |
| Host | **THE OPERATOR** (caption tag `OPS`): one deadpan test operator reading the run log. Captions only by default (8.5). No second host, no persona backstory. |
| Sponsors | **None.** No fictional brands on the HUD, the mat, or the banners. Brand clutter is replaced by real bench objects (6.6). |
| Mascot | **None.** |
| Human side | **PILOT** (default callsign, editable, 12 chars max). Team colour Cobalt. |
| AI side | Entrants **OVERSHOOT** (pressure), **BACKLASH** (counter-puncher), **DEADBAND** (trickster), and the tutorial arm **JIG**. An uploaded model shows under its file name. Team colour Magenta. The names are control-engineering faults that describe how each one fights. |
| Harness words | Loading a policy is **Register Entrant**. A passing stock-preset run earns **CLEARED FOR BROADCAST**; a run with faults gets **POLICY FAULT**. The harness screen is **The Lab**. |
| Progression currency | **Rep** (7.3.7). |
| Objective words | The **Core** (a 4 cm cube). You **dock** it; the countdown **locks** the round. The opponent **pries** it loose. |

Before shipping, run a trademark search on TORQUE LIMIT, OVERSHOOT, BACKLASH, DEADBAND, and JIG as game or product names. Rename any collision in `src/game/brand/marks.ts` and `src/game/announcer/lines.ts` only.

### 1.4 "AAA, not AI-generated": non-negotiable craft rules

1. **No placeholder anything.** No lorem ipsum, fake telemetry, fake season counters, or buttons that do nothing. Every number on screen is real. Procedural stand-in audio (9.7) is allowed only before M4 and is tracked as a bug.
2. **No dashboard vocabulary.** No rounded cards, soft drop shadows, glassmorphism or `backdrop-filter`, pastel palettes, emoji, or sentence-case paragraphs during a match. Corner radius is 0 everywhere.
3. **One slant, one type family, three motion tiers.** The slant is the measured italic angle of Archivo (6.3). Motion uses the three tiers in 7.2. Every exception gets written into `STYLES.md` first.
4. **Feedback is budgeted, not maximised.** Every event is felt within 16 ms of its physics step on the number of channels its magnitude tier allows (8.1): light hits 3, heavy hits 5, KO everything.
5. **Short copy, loud type.** Labels are all caps and never longer than 3 words. Commentary appears as a caption plate, never a paragraph. Copy rules are in 8.5.
6. **Zero React renders per frame in a match.** Hot values reach the DOM through refs and CSS variables; the reticle is drawn in WebGL.
7. **Pre-warm every shader and audio graph behind the loading screen** (10.6). A hitch on the first spark counts as a bug.
8. **One colour, one meaning** (6.2). A colour that means two things is a bug.
9. **Every line of copy is read aloud by a person before it ships.**

### 1.5 Distance audit (signed off before M3, re-checked at M4)

The reference game's signatures, and what we did with each. **At most two may survive.** Anyone adding a feature that matches a row marked CUT must reopen this table in a PR.

| # | Signature | Verdict | What makes ours different |
|---|---|---|---|
| 1 | A fight presented as a televised show with a graphics package | **SURVIVES (1 of 2)** | Our show is a phone-shot livestream at a workbench. One deadpan operator, no hype hosts, no sponsors, no stadium. |
| 2 | Timed deposit objective that decides rounds and can be interrupted | **SURVIVES (2 of 2)** | Physical docking of a real cube into a tape-marked ring; interruption is a physical pry. No money, cash register, vault, or currency theme. |
| 3 | Steal that inherits the countdown; last-second steal as the top moment | **CUT** | A pry only pauses the owner's clock. A prier who docks the Core starts their own shorter lock-in (2.5). The top replay moment is the KO slump. |
| 4 | Fan count as XP | **CUT** | Rep, earned from medals and league wins (7.3.7). |
| 5 | Satirical megacorp and soda sponsors | **CUT** | No sponsors. Real bench objects dress the set. |
| 6 | Two hosts: ex-contestant plus analyst | **CUT** | One operator voice, captions by default. |
| 7 | Holographic or virtual crowd | **CUT** | Real people, out of focus, at human scale behind the bench (6.6). |
| 8 | Voxel dissolve on elimination | **CUT** | Servo brownout: LED dies, relay clicks, the arm slumps under gravity and stays slumped (8.3). |
| 9 | Chrome and foil gradients | **CUT** | Flat 2-stop anodized sheen (6.4). |
| 10 | "Contestant" as the player word | **CUT** | "Entrant", "pilot". |
| 11 | Destructible arena that gets wrecked and rebuilt | **CUT** | Only physical mess: cubes stay where they land, tape scuffs. Between rounds a camera shutter cut resets the bench (6.6). |
| 12 | Daylight high-key arena with saturated set pieces | **CUT** | Warm clamp lamps, window light, and a dark ESD fight mat (6.5, 6.6). |
| 13 | Confetti cannons and sponsor floods on eliminations | **CUT** | Hole-punch confetti thrown by hand, match end only. |
| 14 | Condensed slanted display type and sticker badges | **CHANGED, counts under #1** | One variable family (Archivo) with the slant taken from its real italic; stamps are flat ink/paper, no foil, no sticker drop shadows. |

The 12.3 legal checkbox is **"distance audit signed off"**, not "no names used".

---

## 2. Core loop and match flow

### 2.1 The loop

```
 READ the rival arm (servo LEDs, whine pitch, charge glow in its team colour)
   → POSITION (stance yaw, reach) until the range cue says IN RANGE
   → COMMIT (flick / jab / charged heavy / grab)                  ← arm lags your command by physics
   → RESOLVE (strike · graze · guard chip · deflect · clash · whiff) ← MuJoCo contact onset, section 4
   → PUNISH or RESET (short stagger windows, heat management, burst out)
   → at 15 s, the CORE drops: race, dock, defend, PRY
   → KO or LOCK ends the round → (replay only if it earned one) → next round (best of 3)
```

Target match length: **≈ 87 s typical with the standard show, ≈ 70 s with Fast show, 170 s worst case.** A round takes 25–35 s at the median. **KO to next ENGAGE ≤ 4.0 s with Fast show.** Rematch to ENGAGE is **3.4 s** everywhere in this document.

### 2.2 Phase machine (owner: `src/game/match/match-director.ts`)

All durations are wall-clock milliseconds unless marked "sim". Match rules (round timer, lock-in, deflect windows) run on **sim time**. Presentation runs on **wall time**, except in `timing: eval`, where every non-fight phase runs a **fixed number of sim steps** (column "eval steps") with no wall dependence, so eval episodes are deterministic in length.

```
boot → title (attract) → green_room ⇄ {entrants, league, daily, lab, replays, settings}
green_room → match_intro → round_intro → fight → (ko | lock | time_up → [sudden_death]) → round_end
round_end → [round_replay] → [round_summary] → round_intro (next round) … → [match_replay] → outro → post_match
post_match → REMATCH (→ rematch_intro → round_intro) | green_room
fight ⇄ paused   (Esc or pointer-lock loss; bridge/eval matches use the hold rule in 7.3.10)
```

| Phase | Standard | Fast show | Eval steps | What happens | Input |
|---|---|---|---|---|---|
| `boot` | until loaded (≤ 4 s warm) | same | n/a | Loading screen (7.3.1). WASM, models, meshes, audio, pre-warm. | none |
| `title` | until input | same | n/a | Attract match: OVERSHOOT (Pro) vs BACKLASH (Pro), Arcade, DDA off. | any key or mouse move → `green_room`, unlocks audio |
| `green_room` | until chosen | same | n/a | The lobby (7.3.3). | menu |
| `match_intro` | **6000 ms**, skip after 1000 | **2500 ms** | 0 | Only when the opponent changed since the last match. Beats in 2.3. | any key skips |
| `rematch_intro` | **1000 ms** | 1000 ms | 0 | Nameplates slam in and out. | none |
| `round_intro` | **2900 ms**, ENGAGE at 2400 | **1600 ms**, ENGAGE at 1200 | 0 (engine.reset then straight to fight) | The bench reset cut (6.6) runs at 0 ms: engine reset, cubes placed, arms at home guard, physics running with inputs buffered. Standard: `ROUND N` slab at 0, "3·2·1" at 900/1400/1900, **ENGAGE at 2400**. Fast: `ROUND N` at 0, **ENGAGE at 1200**. Control unlocks and the round timer starts on the ENGAGE frame. | buffered (last 150 ms replayed at unlock) |
| `fight` | ≤ **45.0 s sim** | same | n/a | Combat. 12.0 s sim: Core incoming. **15.0 s sim: Core drops.** 35.0 s: timer amber-equivalent (7.4). 40.0 s: one tick per second. | full |
| `ko` | **1800 ms** | 1800 ms | 360 steps (Arcade 720) | KO sequence (8.3). The loser's servos are Offline. Arcade dilation only. | none |
| `lock` | **1500 ms** | 1200 ms | 300 steps | Lock sequence (8.4). | none |
| `time_up` | **1200 ms** | 800 ms | 0 | `TIME` banner. Resolves 2.4. | none |
| `sudden_death` | ≤ **20.0 s sim** | same | n/a | Starts with a 1600 ms `SUDDEN DEATH` intro. Integrity carries over. Core drops at 0 s with a **4.0 s** lock-in. Ends on the first unguarded strike with raw ≥ 16, a lock, or timeout (2.4). | full |
| `round_replay` | **2500 ms**, only if the round earned a replay (8.6) | same rule | 0 (not recorded) | Replay of the deciding moment. | any key skips; hold skips chain |
| `round_summary` | **1000 ms** | **skipped** | 0 | Best Score strip (7.4.3). | any key skips |
| `match_replay` | **3500 ms**, only if earned (8.6) | same rule | 0 | Replay of the match-deciding moment. | any key skips |
| `outro` | win **4500 ms**, loss **3000 ms**, skip after 800 | win **2500 ms**, loss **1500 ms** | 0 | Broadcast camera behind the winner. Winner plays its victory emote through real servos; loser stays Offline and slumped (state restored after any replay, 5.9). Wordmark at 400 ms. Match-end confetti on a player win only. | any key skips |
| `post_match` | until chosen | same | n/a | Post-match (7.3.7). **REMATCH has focus.** Enter, R, or A. | menu |
| `paused` | n/a | n/a | n/a | Sim clock stops, pause menu opens. | menu |

**Skipping.** A single key press skips the current skippable screen. **Holding** Space, Enter, or pad A for **400 ms** during any between-round phase skips the whole chain (`round_end` → `round_intro` of the next round, ENGAGE timing unchanged) and fills a thin ink progress bar under the hint bar while held.

**Fast show** (`settings.show.fast`: `auto | on | off`, default `auto`). `auto` turns Fast show on once `profile.matchesPlayed ≥ 5`. It changes only the column above; rules never change.

**Typical 2–0 match (standard show, one earned round replay, earned match replay):** intro 6.0 + 2 × (round_intro 2.9 + fight 30 + ko 1.8) + summary 1.0 + replay 2.5 + match_replay 3.5 + outro 4.5 ≈ **87 s**. **Fast show rematch:** rematch_intro 1.0 + 2 × (1.6 + 30 + 1.8) + outro 2.5 ≈ **70 s**.

**KO → ENGAGE, Fast show, no earned replay:** ko 1.8 + round_intro ENGAGE 1.2 = **3.0 s** (gate ≤ 4.0 s).

**Rematch path:** post_match → `rematch_intro` 1000 ms → `round_intro` ENGAGE at 2400 ms = **3.4 s to control** (standard), 2.2 s with Fast show.

### 2.3 Match intro beats (6000 ms standard; Fast show keeps only the rows marked F, retimed ×0.4)

| t (ms) | Beat |
|---|---|
| 0 (F) | Cut from black to the phone-camera wide shot of the bench. A clamp lamp clicks on. |
| 200 (F) | The screen splits on the slant: cobalt panel from the left, magenta from the right (200 ms, motion tier *impact*). |
| 800 | Opponent power-on: joints twitch into home pose one at a time from base to gripper, 120 ms each, with a recorded servo chirp and an LED tick per joint. Nameplate: name, driver tag (e.g. `BUILT-IN · PRO`, `USER MODEL · act_v3.mjs · sha 9f2c1a`), and local W–L record. |
| 1600 (F) | `VS` stamp on the seam (ink on paper, motion tier *celebration*). |
| 2600 | Opponent intro pose, a 1.2 s joint trajectory played through the real servos: OVERSHOOT double gripper snap, BACKLASH slow roll-and-settle, DEADBAND wrist-roll flourish, a user model a single nod. |
| 3200 | Cut to the player side. Your power-on runs, then your nameplate with callsign and loadout. |
| 4800 (F) | The camera pushes into the cockpit mount along a 1200 ms ease-in-out path. |
| 6000 (F) | Hand off to `round_intro`. |

### 2.4 Round and match resolution

- **Best of 3.** The first seat to 2 round wins takes the match. The Lab can set best of 1 or best of 5.
- A round ends immediately on:
  1. **KO**: a seat's Integrity reaches 0. The other seat wins, even mid-lock-in.
  2. **LOCK**: a seat's Core lock-in reaches 0. That seat wins.
  3. **Time**: the higher Integrity wins. If the difference is ≤ 5, go to Sudden Death.
- **Sudden Death** is won by the first unguarded strike with raw ≥ 16 (4.3) or by a lock. After 20.0 s sim with neither, tiebreaks apply in order: more damage dealt this round, then more Integrity, then the seat that landed the round's first strike. Draws don't exist, so no stats code handles them.
- **Round 3** is the **Final Round**. The music plays its final-round arrangement. Rules don't change.
- **Integrity resets** to the loadout maximum at every `round_intro` except Sudden Death.
- **Comeback rules (Arcade only, all off in every stock preset):**
  - *Underdog Dock*: a seat that is down a round has a **6.0 s** lock-in instead of 8.0 s.
  - *Core bias*: if the Integrity difference is ≥ 15 at the drop, the Core drops **0.03 m** toward the lower-Integrity seat's side.
  - There are no other rubber bands. Damage is never scaled for comebacks.

### 2.5 The Core (objective)

| Rule | Value |
|---|---|
| Core body | `cube_4` in `arena.xml`, rendered as a matte prize-yellow (`--prize`) printed cube with a black tape stripe. Mass 0.08 kg (Arcade variant `heavy_core`: 0.16 kg). |
| Clutter cubes | `cube_0`, `cube_2`, `cube_6`, `cube_8` at their MJCF positions. Throwable. |
| Parked cubes | `cube_1`, `cube_3`, `cube_5`, `cube_7` at world (2.0 + 0.1·i, 0, 0.02), off the table, never rendered. `cube_4` stays parked until it drops. |
| Incoming | At fight time **12.0 s sim**: the hopper above centre lights and ticks 3 times over 3 s. |
| Drop | At **15.0 s sim**: teleport `cube_4` to (bias, 0, 0.22) with zero velocity, recorded as a `place_cube` mutation (5.8). It falls under gravity through the clear hopper (visual only). |
| Docks | Sites `atlas_dock` at world **(−0.12, 0, 0)** and `blaze_dock` at **(+0.12, 0, 0)**, **radius 0.07 m**, marked with prize-yellow gaffer tape. Provisional values; the geometry gate below sets the final ones **before M0**. |
| Docked | The Core's centre is within `DOCK_RADIUS` (XY) of a dock centre, z < 0.035, speed < 0.05 m/s, held for ≥ **250 ms sim**. |
| Lock-in | 8.0 s (6.0 underdog; 4.0 in Sudden Death). Runs while the Core is docked in its owner's dock. The first seat to dock an unowned Core becomes its owner. |
| Leaves the dock | The countdown pauses and keeps its progress. |
| **Pry** | The Core was docked with progress > 0, then leaves the owner's dock (outside radius or z > 0.035 for ≥ 100 ms sim), and the last gripper geom to touch it within 300 ms belonged to the **opponent**. Emits `core.pry`. The owner's clock stays paused and the Core is loose and contestable. |
| After a pry | If the owner re-docks it, the owner resumes their paused progress. If the **prier** docks it in the prier's own dock, the prier becomes owner and starts a fresh **6.0 s** lock-in (4.0 in Sudden Death); the old owner's progress is discarded. No time is inherited. |
| Late pry | A pry with ≤ 2.0 s remaining. |
| Contested flag | The opponent's gripperframe is within 0.08 m of the docked Core. |
| Damage | The Core never deals damage. |
| **Geometry gate (WP2, day 0, before M0)** | Measured with `scripts/probe-dock-geometry.mjs` on the untouched `arena.xml` at stock and at every Arcade loadout: (a) the owner's gripperframe reaches its dock centre at ≤ 70% extension; (b) the **opponent's** gripperframe reaches a point **2–3 cm past the dock centre** (toward the owner's base) at ≤ **85%** extension; (c) the opponent can close its jaws on a Core resting at dock centre. If any check fails, move both docks inward in 0.01 m steps (minimum ±0.09) and then grow the radius up to 0.08. WP2 hands the passing values to WP1, which writes them into `DOCK_CENTER_X` / `DOCK_RADIUS` before M0 merges. The same checks are the `core-geometry` regression test (12.1). |

**Assisted grab and dock** (human command layer, 3.1.4) make the Core race winnable by hand; the `core-race-v1` suite (5.10.4) proves it before M3.

---

## 3. Camera and controls

### 3.1 The directing-arm / following-arm model

The player never moves the arm directly. The player moves a **command**: a massless pose shown as the **ghost arm**. The physical arm chases the ghost through its PD servos. Above 2.9 mrad of error the servo is torque-saturated (kp 998, τmax 2.94 N·m stock), so **the size and speed of the ghost's jump become arm velocity, and arm velocity becomes damage** (section 4).

```
mouse / stick ──► COMMAND (ψ, θ, r, φ, ρ, grip) ── same frame ──► ghost arm, reticle (WebGL overlay), range cue
                    │                     └── 250 ms low-pass of ψ, θ ──► STANCE ──► camera look
                    └─► per physics step (2.5 ms Arcade / 5 ms stock): assists → commandToJoints → leash → ctrl
                                                   └─► PD servo → arm moves (onset ≤ 45 ms, full swing 70–285 ms)
```

#### 3.1.1 Command state (owner: `src/game/input/pilot-controller.ts`)

| Field | Range | Maps to | Default (home guard) |
|---|---|---|---|
| yaw ψ | [−1.90, 1.90] rad | `shoulder_pan` directly, no IK (yaw = pan angle; the reticle is drawn at the FK tip, so link lateral offsets never show as disagreement) | 0.00 |
| elevation θ | [−0.35, 0.90] rad | planar 2-link IK → `shoulder_lift`, `elbow_flex` | solved so the roll-axis point sits at ego (0.20, 0, 0.15) |
| reach r = r_stance + r_offset | [0.12, 0.42] m from the shoulder-lift pivot to the **wrist_roll axis point** | planar IK | r_stance at home, r_offset 0 |
| tool φ | [−0.80, 0.80] rad | `wrist_flex` offset from "tool level with aim ray" | 0.00 |
| roll ρ | [−2.74385, 2.74385] rad | `wrist_roll` | 0.00 |
| grip g | open **1.15** / closed **0.04** | `gripper` | 0.04 |

- **Planar IK target is the wrist_roll axis point** (the point on the roll axis at the gripper body origin), which does not move with roll. The closed-form IK lives in `src/game/kinematics/so101-kinematics.ts` (WP2) with link offsets fitted against FK. Its RMS on the roll-axis point must be < 1 mm over 2,000 samples. The `gripperframe` site (12 mm off the roll axis) is always computed by **full FK including roll** for the ghost tip, reticle, range cue, and observations.
- **Reach is absolute with a spring.** `W` held sets `r_offset = +0.12`, `S` held sets `r_offset = −0.08`, neither sets `r_offset = 0`. The change is instant (the servo is the smoother), so jabbing in and out is a key tap. Holding W or S longer than **400 ms** also creeps `r_stance` toward that side at **0.25 m/s**, clamped to [0.14, 0.36], so the player can step in or out. `r` is clamped to [0.12, 0.42] after summing.
- **Leash:** each commanded arm joint (0–4) is clamped to within **0.60 rad** of its measured angle. `leashStretch = max_j |cmd_j − q_j| / 0.60`. Off in the DEMO preset (4.10).
- **No rate limit, no smoothing, no acceleration** on any command axis. The servo is the smoother. The only filtered quantity in the input path is the camera stance (3.2).
- **Guard blend** while guard is held (every preset with a human): the command blends **60%** toward the *guard line*, the point at r = 0.24 m on the segment from your shoulder to the opponent's gripperframe, with jaws closed and wrist_flex +0.40 rad. Command yaw rate is capped at **2.0 rad/s**. In stock presets the blend is pose-only and grants no damage reduction (4.10).
- **Home guard pose:** roll-axis point at ego (0.20, 0, 0.15), grip 0.04, roll 0. Grippers start about 0.24 m apart.

#### 3.1.2 Strike inputs

| Input | Behaviour (exact) |
|---|---|
| **Flick** (mouse or right stick) | Nothing special. ψ and θ jump and the servo does the rest. This is the light strike. The range cue (3.1.4) tells you whether a flick from here connects. |
| **Jab** (LMB / RT tap, released < 180 ms) | `r_offset += 0.10` for **160 ms** (on top of W/S), then back. θ doesn't change. Disabled in DEMO. |
| **Charge** (LMB / RT held ≥ 180 ms) | `intents.charge = true`. c rises 0 → 1 over **600 ms** (rules, 4.7). **Wind-up is applied to the arm command only**: r −0.06 m, φ −0.50 rad, ψ rotated 0.45 rad away from the last 150 ms of yaw motion (straight retract if still). The camera stance and the reticle anchor keep the un-wound aim, so the reticle stays where you're aiming and the ghost visibly pulls back. Mouse sensitivity ×**0.75** while charging. After c = 1 you may hold up to **1000 ms** more (heat +8/s), then it releases on its own. Disabled in DEMO. |
| **Heavy release** (LMB / RT release after charge) | The command snaps to the aim: φ +0.50, r_offset → min(0.42 − r_stance, 0.05 + 0.05·c). Delaying the release and moving the aim during the hold are the mixup. |
| **Charge cancel** (RMB / LT press while charging) | Cancels the charge with no whiff penalty, costs **+8 heat**, emits `charge.cancel`. The guard press that cancels does **not** open a deflect window. |
| Feint | Not a button. Reverse the command before contact, or cancel a charge. |

#### 3.1.3 The ghost arm and range visuals (render: `src/game/render/ghost-arm.tsx`, `src/game/render/reticle-overlay.tsx`, WP6)

- **Ghost:** the SO-101 render meshes posed at `pilot.ghost.joints`, drawn at the seat's mount. `MeshBasicMaterial` in `--cobalt` at fill opacity **0.12**, plus a fresnel edge `pow(1 − N·V, 2.5) × 0.6` with an ink inner line so it reads on the dark mat and the light bench. `depthWrite: false`. Only **lower_arm, wrist, gripper, moving_jaw** in a match; the full ghost in the tutorial.
- **Leash line:** when `leashStretch > 0.6`, a dashed line from physical tip to ghost tip, ink core with a 1 px paper outline, thickening at stretch 1.0.
- **Reach arc on the mat:** a thin paper arc decal on the fight mat at the flick sweep radius (current r projected to z = 0), spanning ψ ± 0.9 rad, drawn at 35% opacity; a second dashed arc at the jab radius. Both turn solid when the range cue is true.
- **Opponent hand shadow:** a soft ink blob decal under the opponent's gripperframe on the mat (size and softness by height). This is the depth cue for a 4 cm target 30–45 cm away.
- The ghost and arcs are **local only**. The opponent never sees them and the AI never receives them.
- **Replay "target ghost":** in the replay viewer any seat's recorded `sim.ctrl` can be shown as a ghost.
- **Daily best-run ghost** (7.3.12): the ghost of your recorded best daily run, synced by sim time, in paper at 0.10 opacity.

#### 3.1.4 Assists (human command layer only, owner `src/game/input/assists.ts`, WP3)

Assists edit the **command**, never the servo, the physics, or scoring. They are recorded per step as `input_shaping` flags (5.8). Allowed in Arcade and Proving Ground; in DEMO they are off by default and a recorded toggle; they never apply to policy seats.

| Assist | Rule |
|---|---|
| **Range cue** | Each frame: sample 9 FK tip positions along the flick sweep (ψ − 0.9 … ψ + 0.9 at current r, θ) and 3 along the jab (r + 0.10). Test each against the opponent hurtbox capsules (gripper, camera_mount, wrist, lower_arm; radius 0.02 m, from the opponent's interpolated body frame). `rangeCue.flick` is true if any sweep sample on the side facing the opponent is within 0.015 m of a capsule surface; `rangeCue.jab` likewise for the jab samples. Also outputs `nearestM`. Cost ≤ 0.05 ms. |
| **Grab assist** | While Space (grip) is held and the physical gripperframe is within **0.05 m** of a cube centre: tool pitch φ and roll ρ snap to align the jaws with the cube's nearest face pair (roll = cube yaw folded to ±π/4 relative to the jaw axis; pitch = vertical approach), reach snaps so the roll-axis point is over the cube centre, and height targets z 0.025 at the jaws. Mouse yaw still applies, with ψ pulled onto the cube's azimuth when within 0.12 rad. Jaws open to 1.15 for the first **120 ms** after the press, then close. Once both jaws touch the cube, elevation gets +0.06 m so it lifts. |
| **Dock magnet** | Releasing Space while holding the Core with its XY centre within **0.04 m** of your own dock centre: for **150 ms** the command places the roll-axis point over the dock centre at z 0.03, then the jaws open. |
| **Aim assist** (gamepad, Arcade vs AI only) | When LS is idle, stance yaw drifts toward the opponent gripper yaw at 0.6 rad/s. |

### 3.2 First-person cockpit camera (owner: `src/game/camera/cockpit-rig.ts`, WP3)

| Parameter | Value |
|---|---|
| Anchor | The seat's **fixed base frame**. No physics jitter, nothing to interpolate. |
| Eye position | Ego (−0.12, −0.07, +0.24) m from the base: 12 cm behind, 7 cm right, 24 cm up. |
| Base look target | Ego (0.32, 0.00, 0.12), the contest centre, about 15° down. |
| **Stance** | `ψ_s`, `θ_s` = one-pole low-pass of the command ψ and θ with **τ = 250 ms** (wall time, excluding the charge wind-up offset). This is the only filtered term in the input path. |
| Look yaw offset | `24° · tanh((g_yaw · ψ_s) / 24°)`, **g_yaw 0.45** (Standard cockpit) or **0.20** (Stable cockpit). |
| Look pitch offset | `10° · tanh((g_pitch · (θ_s − θ_home)) / 10°)`, g_pitch 0.30 (Standard) or 0.12 (Stable). |
| Strikes | A flick moves the **reticle and the arm** on screen, same frame. It does not move the camera; only stance changes (holding a new aim for ~0.25 s, or A/D drift) do. |
| Roll | 0, plus juice (8.2) only. |
| Secondary sway | roll = `clamp(−k_r · q̇ᶠ_pan, ±1°)`, pitch = `clamp(k_p · q̇ᶠ_lift, ±0.5°)`, where `q̇ᶠ` is measured joint velocity through a **6 Hz one-pole** with a **0.3 rad/s deadzone**. k_r = 0.089 °/(rad/s) (a 9 rad/s hook gives 0.8°), k_p = 0.05. Output slew-limited to **20°/s** so single contact steps can't spike it. Scaled by Camera motion %. |
| Vertical FOV | **62°** default. Slider 50–80°. |
| Near / far | 0.004 / 40 render units |
| Own-arm fade | Any own-arm link whose bounding sphere comes within 0.12 render units of the eye is dithered to 35% (screen-door). |
| Opponent always in frame | The ±24° clamp keeps the opponent base and the overlap zone inside the view. |
| **Camera motion default** | **60%**. First launch asks one question before the tutorial: **STANDARD COCKPIT** or **STABLE COCKPIT** (look gains above, shake ×0.5, kick ×0.5). Changeable in Settings. |

**Why the camera ignores swings:** in an FPS the player looks where they want. Here the player is swinging, not looking; camera motion without look intent is the classic nausea trigger. The stance split keeps an FPS-like same-frame response on the reticle while the world holds still during 4–8 Hz flick exchanges.

**Other camera modes** (owner: `src/game/render/camera-director.tsx`; pure math in `src/game/render/camera-math.ts`, WP6):
- `broadcast`: the "phone on a tripod" at (0, 0.95, 0.42) sim looking at (0, 0, 0.10), FOV 38°, slow handheld drift (0.3° at 0.2 Hz). Title and model-vs-model spectating.
- `intro`: the scripted path in 2.3.
- `replay`: starts 45° off the victim's side at radius 0.9 m sim, orbits 30° over the clip.
- `lobby`: 3/4 front-left of the pilot arm, position ego (0.55, 0.42, 0.34) looking at ego (0.05, 0, 0.14), FOV 40°.
- `lab_overview`: top-front at 60° elevation, FOV 45°.
- ~~`optics_pip` (C key)~~ — **cut by SCOPE 2.2** ("policy image cameras and the laptop screen render target"). It is a render target off the arm's camera mount, so it goes with them. SCOPE 2.2 also says to leave no dead button behind: there is no OPTICS key, no pad button and no SETTINGS rebind row for it.

### 3.3 Mouse and keyboard

Pointer lock uses `requestPointerLock({ unadjustedMovement: true })`, falling back to plain `requestPointerLock()`. On `pointerlockerror` (Chrome rejects re-lock for ~1 s after a user exit) the controller shows **RE-ARMING…** and retries once at +1100 ms. Deltas accumulate from `pointerrawupdate` where supported (otherwise `pointermove`). The first event after a lock is dropped.

| Input | Action |
|---|---|
| Mouse X / Y | Yaw ψ / elevation θ. `K = 0.0015 × sensitivity` rad per count (default 1.0; range 0.25–3.0). Vertical multiplier 0.8 (range 0.4–1.2). Invert-Y off. No acceleration, no smoothing. |
| LMB tap / hold / release | Jab / Charge / Heavy |
| RMB hold | Guard. The press edge is a deflect attempt (4.4). While charging, the press cancels the charge instead. |
| W / S | Reach out / in (absolute with spring); hold > 400 ms to step the stance (3.1.1) |
| A / D | Stance drift: ψ −/+ at **1.6 rad/s** (a strafe-like stance shift; the camera follows through the stance filter) |
| Space (hold) | Grip closed, release opens. Grab assist and dock magnet (3.1.4). |
| Shift (hold) | Overdrive (4.8). While Staggered, a Shift **press** is **Burst** (4.6). Hidden for a profile's first 3 matches. |
| F | Loadout ability (4.8). Hidden for a profile's first 3 matches. |
| Q / E | Wrist roll ρ −/+ at 5.0 rad/s (advanced; grab assist sets roll for you) |
| Mouse wheel | Tool pitch φ in 0.15 rad notches (advanced) |
| Tab (hold) | Stats overlay: strike speed, ν, heat, reaction time, policy detail |
| Esc | Pause (7.3.10 describes the bridge/eval hold rule) |
| Enter / R | Rematch (post-match) |

Warm-up is a green-room menu item (7.3.3), not a key.

### 3.4 Gamepad (standard mapping)

A rate-controlled stick can't flick, so the **right stick is an absolute swing stick**:

```
curve(v) = sign(v) · ((|v| − 0.12) / 0.88)^1.5  for |v| > 0.12 (radial deadzone), else 0
ψ = ψ_center + 0.90 · curve(RSx)                θ = θ_center + 0.50 · curve(−RSy)
ψ_center += 1.6 rad/s · curve(LSx) · dt
r_offset = curve(−LSy) · (LSy < 0 ? 0.12 : 0.08)     // absolute with spring; |LSy| > 0.9 for 400 ms creeps r_stance
Aim assist (Arcade, human vs AI only): when LS is idle, ψ_center drifts toward the opponent gripper yaw at 0.6 rad/s.
```

A full-left to full-right stick flick in about 50 ms is a 1.8 rad step, a full-speed hook, which gives parity with the mouse.

| Input | Action |
|---|---|
| RS (absolute) | Aim and swing. RS click re-centres ψ_center on the opponent. |
| LS | X: stance drift. Y: reach (absolute with spring). |
| RT (analogue, threshold 0.35) | Tap = Jab, hold = Charge, release = Heavy |
| LT (threshold 0.35) | Guard / Deflect / charge cancel |
| RB | Grip (assisted grab) |
| LB | Overdrive; press while Staggered = Burst |
| Y | Ability |
| X / B | Wrist roll − / + at 5.0 rad/s |
| D-pad up / down | Tool pitch notches |
| View | Stats overlay, held (the same rebindable STATS action as the key) |
| Menu | Pause |

**Haptics** use `vibrationActuator.playEffect("dual-rumble", …)` and fire on the event frame (8.1).

### 3.5 Input buffering

- Continuous axes are never buffered. The latest value is used. Pointer deltas that arrive during an Arcade hit stop accumulate and apply on the first post-freeze frame, exactly like a long frame.
- Discrete edges (jab, charge start, guard press, ability, grip, burst) buffer for **100 ms**.
- **Edges pressed during an active hit stop** are stamped with the sim time of the first post-freeze step, and they are **excluded from the deflect check for the onset that caused the freeze**. Seeing a hit land during the freeze never converts it into a deflect.
- At ENGAGE, the last **150 ms** of buffered edges replay.

---

## 4. Combat model

All rules run once per physics step on **sim time**, in `src/game/combat/combat-rules.ts` (WP2). All tuning numbers live in `src/game/combat/tuning.ts`, which exports two tables, `tuning.arcade` and `tuning.stock`, plus the pure function `hitstopMsFor(event, preset)` (8.1). The **scoring profile** is `full` in Arcade and `physical` in every stock preset (4.10); each rule below states what it does under each.

### 4.1 Contact onset (physics, `src/game/physics/contact-scan.ts`)

For each cross-arm geom pair in `data.contact`, read **immediately after `mj_step`**, while contacts and `cvel` both describe the pre-impulse state:

1. **Onset** is a pair key `(geom1, geom2)` that wasn't active on the previous step and hasn't ended within the last **30 ms sim**. Gaps shorter than 30 ms merge into one episode.
2. **Gate:** `efc_force[efc_address] > 0.3 N`. Otherwise the pair is ignored.
3. **Contact-point velocity vectors** `vA` and `vB` come from `cvel` at `subtree_com[rootid]` translated to `contact.pos` (the existing `contactPointSpeed` math without the `hypot`).
4. The normal `n = contact.frame[0..2]` points from geom1 to geom2. Orient it Atlas → Blaze.
5. `aN = max(0, vA·n)`, `bN = max(0, −vB·n)`, `vN = |(vA − vB)·n|`.
6. The link is the victim geom's body mapped to a `LinkId` (10.4).

Cube-arm onsets and arm-table onsets use the same method. The table gate is `efc_force > 3 N`.

**Arcade strike hulls.** In Arcade, onsets are scanned on the hull geoms of `arena-arcade.xml` (4.10), and each hull geom maps to the `LinkId` of the body it is attached to. The thin real geoms still collide but are excluded from the onset scan in Arcade. Stock presets scan the untouched real geoms of `arena.xml`.

**Scan cost.** `contact-scan.ts` reads `ncon` first and skips the walk when no cross-seat geom pair is possible (geom→seat table cached at load). When it walks, it reads each contact once with minimal property access, reusing one scratch object, so the embind wrappers don't drive GC.

### 4.2 Attribution

```
vRef(seat)  = measured reference tip speed for the seat's physics profile (tuning table, written by scripts/bench-physics.mjs):
              the peak gripperframe speed of the canonical hook (pan −0.7 → +0.7 rad step, lift 0.14, elbow 0.14) at pan 0.
              Starting values until the bench overwrites them: Whip 3.2, Pivot 2.9, Anvil 2.7, stock 1.6 m/s.
α = aN / vRef(atlas),  β = bN / vRef(blaze)
max(α, β) < 0.20                              → CONTACT (a shove: no damage)
min(α, β) ≥ 0.20 and 0.75 ≤ α/β ≤ 1.33        → CLASH
otherwise                                     → attacker = larger side; ν = vN / vRef(attacker)
    ν < 0.35                                  → GRAZE
    ν ≥ 0.35                                  → STRIKE
```

A measured reference (not a theoretical terminal speed) means the same swing gets the same ν on every loadout, so a fast low-damping arm is not punished for never reaching a speed it can't reach within a real swing.

### 4.3 Damage formula

```
raw = 20 × clamp((ν − 0.20) / 0.55, 0, 1.45)^1.2                        // 0 … 31.2
dmg = min(45, raw × zone(victimLink) × tool(attackerLink) × loadoutDmg(attacker) × heavy(c) × state(victim) × decay(victim))
```

| Multiplier | Arcade (`full`) | Stock presets (`physical`) |
|---|---|---|
| `zone(victimLink)` | `camera_mount` **1.5 (CRIT, "Optics")** · `moving_jaw` 1.1 · `gripper` 1.0 · `wrist` 0.8 · `lower_arm` 0.7 · `upper_arm`, `shoulder`, `base` 0.5 | same |
| `tool(attackerLink)` | `moving_jaw`, `gripper`, `camera_mount` 1.0 · `wrist` 0.85 · `lower_arm` 0.7 · `upper_arm`, `shoulder`, `base` 0.5 | same |
| `loadoutDmg` | Whip 1.08 · Pivot 1.00 · Anvil 0.94 | 1 |
| `heavy(c)` | 1 + 0.30·c when tagged by a charge release (4.7) | 1 (intents ignored) |
| `state(victim)` | Guarding 0.20 (Bulwark 0) · Staggered 0.80 · Cutout 1.25 · Heavy armour 0.5 (4.7), multiplicative | 1 (no servo state or heat value ever changes damage) |
| `decay(victim)` | Within one Stagger, the k-th follow-up hit is × 0.6^k (4.6) | 1 |

- **Tiers:**
  - **GRAZE** (0.20 ≤ ν < 0.35): deals its formula damage (≤ 4.8 raw), shows a grey tick and a `GRAZE · 0.31 m/s` tag, a soft recorded tap. No stagger, no hit stop, no combo, and it does **not** consume the lockout.
  - **STRIKE** (ν ≥ 0.35): full rules below.
- **Every strike tag shows the contact speed** `vN` in m/s (e.g. `IMPACT 2.7 m/s`), so "faster lands harder" is explicit.
- **Lockout:** each attacker deals STRIKE damage at most once per **220 ms sim**. A later onset inside the window can raise that hit's damage to the higher value (event `strike` with `upgrade: true`), never a second hit.
- **Thrown cubes:** a cube hitting an arm deals formula × **0.5**, with `vRef` of the last arm whose gripper touched it within **1.0 s**. No stagger. A cube you last touched can't hurt you. The Core deals 0.
- **Reference values** at zone × tool × loadoutDmg = 1 (any profile, since vRef is measured per profile): full hook (ν ≈ 1.0) = **31**; short flick (ν 0.58) = **13**; lazy swing (ν 0.43) = **7**; graze (ν 0.30) = **3**; shove (ν < 0.2) = 0.
- **Loadout balance target:** the reference hook deals **30 ± 3** for every loadout (Whip 33.7, Pivot 31.2, Anvil 29.3), and for every loadout pair the hooks-to-kill differ by at most 1 (Integrity 85 / 100 / 115). Test in `combat-damage`.
- **Magnitude** (drives all feedback): `m = clamp(raw / 31.2, 0, 1)` for strikes and grazes, 0.6 for clashes, 0.15 for contacts.
- **Crit** = victim zone `camera_mount`.
- **Time to kill** at Pivot vs Pivot: 4 clean hooks or 8 flicks.

### 4.4 Guard, Deflect, Clash

**Stock presets (`physical` scoring): guard and deflect do not exist as rules.** A guarding pose blocks only by physically being in the way. `intents.guard` is recorded and ignored. Everything below is Arcade.

**Guard (hold, Arcade).**
- Pose blend is in 3.1.1 (policy seats move their own arm; `intents.guard` enables the multiplier).
- Arcade servo while guarding: τ × **1.4**, kv × **2.0** (the 8 N·m cap still applies).
- Incoming damage × 0.20 (chip). **Guarded strikes never cause Stagger.**
- Defender heat +0.6 × raw. Attacker heat +10 on a guarded hit. Holding guard costs +6 heat/s.
- **Guard break:** heat reaching 100 while guarding → Thermal Cutout plus a 400 ms Stagger.

**Deflect (parry, Arcade).**
- **Window:** guard press edge at sim time P, strike onset at sim time T: **T − 150 ms ≤ P ≤ T + 5 ms**. Resolution happens at onset (plus the 5 ms, 2 Arcade steps, which fits inside the same rendered frame), so strike feedback stays same-frame and no retraction is ever needed.
- **Late guard:** T + 5 ms < P ≤ T + 30 ms. The strike stands, and a `late_guard` event refunds **50%** of that strike's damage to the defender's Integrity. No stun. The feedback shows `LATE GUARD +9`.
- **Excluded presses:** a press that cancels a charge (3.1.2), and any press made during the hit stop caused by this onset (3.5).
- **Conditions:** victim link is `camera_mount`, `moving_jaw`, `gripper`, `wrist`, or `lower_arm`; the defender is not Stunned, Staggered, or in Cutout.
- **Result:** 0 damage. The attacker is **Stunned 650 ms** (**900 ms** on a *hard deflect*, where the defender's own `bN/vRef ≥ 0.20`) and gains +20 heat. The defender loses 15 heat.
- **Anti-mash:** a guard press that doesn't become a deflect locks out new deflect windows for **400 ms**. Guard still blocks during the lockout.

**Clash.**
- No damage. Arcade: both seats +8 heat and a **150 ms Micro-stagger** (τ × 0.7). Stock: event only.
- A heavy-tagged arm clashing with a non-heavy arm **wins the clash** in Arcade: it resolves as a STRIKE by the heavy side (4.7).

The flick-vs-heavy triangle (Arcade, Pivot):

| Attack | Arrival after commit | Answer |
|---|---|---|
| Short flick 0.3 rad | ≈ 70 ms | Read or guard; loses to heavy armour |
| Full hook 1.4 rad | ≈ 125 ms | Read or guard; loses to heavy armour |
| Charged heavy | 180–1780 ms visible charge (glow from c ≥ 0.25) + ≈ 125 ms travel | **Deflect on reaction**, but the release can be delayed up to 1 s past full, angled during the hold, or cancelled for 8 heat, so a deflect is a timing guess, not a free read. Beats flicks in its last 200 ms of charge (armour). |

### 4.5 Heat (stamina)

```
Q      = mean over 5 arm joints of (actuator_force / current_forcerange)^2          // per step
dH/dt  = k_Q · Q · loadoutHeat − 5                                                 // per s
         − 15   extra cooling once Q < 0.02 has held for 0.8 s
         + 6    while guarding   + 8 while charging   + 25 while Overdrive held
Events: guarded hit +10 attacker, +0.6·raw defender · deflected +20 attacker · deflect success −15 defender
        · late guard +5 attacker · clash +8 both · whiff +10 · charge cancel +8 · Snap +12 · Burst +35
H ∈ [0, 100]
```

- **Arcade:** `k_Q = 120` (calibrated at 2× torque). Table below.
- **Stock presets:** heat is **telemetry only**, computed with `tuning.stock.k_Q = 60` (re-measured at stock, where any real motion saturates Q, so the same rhythm reads the same). It never changes a servo, a multiplier, a deflect, or an outcome, and observation fields 10–15 of `game` are zero (5.4). Test: a stock episode's scored damage is identical with heat forced to 0.

| Behaviour (Arcade, measured Q at 2×) | dH/dt | 0 → 100 |
|---|---|---|
| Idle | −5, then −20 | cools fully in ≈ 5 s |
| One full hook every 1.5 s | ≈ −0.8 | never (sustainable rhythm) |
| Flick every 250 ms | +17.6 | 5.7 s |
| Shoving stalemate | +34.7 | 2.9 s |

- **Thermal Cutout at H = 100 (Arcade):** 2.0 s of τ × 0.35, incoming damage × 1.25, no deflect. When it ends, H is set to 40.
- **Warning state:** from H ≥ 70, the thin heat arc on the reticle fills and the heat strip on your arm (6.7) brightens; a recorded rising whine; a haptic pulse.

### 4.6 Servo state machine (Arcade only)

Runtime servo edits happen **only in Arcade**, through `engine.applyServoProfile(seat, profile)`, which writes `actuator_gainprm[i·10]` (kp), `actuator_biasprm[i·10+1]` (−kp), `actuator_biasprm[i·10+2]` (−kv), and `actuator_forcerange[2i, 2i+1]` for that seat's **5 arm actuators**. The gripper actuator stays stock. Scales multiply the loadout base (4.8); final |τ| is capped at **8.0 N·m**. Every profile change is recorded as a `servo_profile` mutation (5.8). In stock presets the machine is not run at all; `servo_state` telemetry is limited to `offline` at KO.

| State | Trigger | Duration | τ | kp | kv | Rules |
|---|---|---|---|---|---|---|
| Normal | n/a | n/a | ×1 | ×1 | ×1 | n/a |
| Micro-stagger | Clash | 150 ms | ×0.7 | ×1 | ×1 | n/a |
| Stagger | (a) **unguarded** STRIKE with raw ≥ 10 (not during heavy armour); (b) guard break; (c) **knockback** (below) | (a) (180 + 8·dmg) ms × staggerRecv, **max 450**; (b) 400 ms; (c) 300 ms × staggerRecv | ×0.5 | ×0.25 | ×0.6 | No deflect. Guard allowed after 60% of the duration. Incoming × 0.8. Follow-up decay × 0.6^k. **A second landed STRIKE ends Stagger** right after its damage applies. **Burst** can end it. |
| Stun | Got deflected | 650 ms (900 hard) | ×0.3 | ×0.1 | ×0.5 | No guard, ability, or charge |
| Thermal Cutout | H = 100 | 2000 ms | ×0.35 | ×1 | ×1 | Incoming × 1.25, no deflect |
| Offline (KO) | Integrity 0 | rest of round | ×0.05 | ×0.02 | ×0.2 | The arm droops 7–10 cm in 1 s under real gravity. Also applied in stock presets (the KO is an outcome, not a scoring modifier). |
| Stagger immunity | End of Stagger or Stun | 900 ms | n/a | n/a | n/a | Can't be re-staggered |

**Knockback trigger (c).** Tracking error counts only when the arm is being **pushed**, never when it is merely slow. All of the following must hold continuously for **120 ms**, evaluated per step for the arm joint j with the largest error:

1. A cross-arm or cube contact on this seat's geoms within the last **100 ms**.
2. `|ctrl_j − q_j| > 0.35 rad`, and the error has **not decreased** over the last 60 ms.
3. The joint is not tracking its target: either `sign(q̇_j) ≠ sign(ctrl_j − q_j)` with `|q̇_j| ≥ 0.3 rad/s` (driven away), or `|q̇_j| < 0.30 × v_free(loadout, |e|)`, where `v_free` is the free-space step-response speed table measured by the bench and stored in `tuning.arcade`.
4. The seat is not in Stun, Stagger, Micro-stagger, Cutout, or Offline, not within **250 ms** after a guard press or release edge, and not within **250 ms** after a command step (any arm joint's `ctrl` changing by > 0.20 rad within one control tick).

Regression (`servo-states` test, 12.1): a full 1.4 rad hook through empty air at every loadout and at stock, a guard press, a Stunned arm with the mouse sweeping, a Cutout arm with the mouse sweeping, and the built-in HOOK primitive with its path lead all produce **zero** stagger events.

**Burst.** While Staggered, an `intents.burst` press edge (Shift / LB) with heat ≤ 65 and burst unused this round: Stagger ends at once, heat +35, τ × 1.3 for 150 ms, 900 ms stagger immunity starts, `burst` event. Once per round per seat.

**Combo bound.** One read can't decide a round: with lockout 220 ms and the 450 ms cap, a staggered victim takes at most one follow-up before the stagger ends. `combat-damage` asserts that follow-up damage within one Stagger is ≤ 25 and opener plus follow-ups is ≤ 60 for any loadout pair.

Modifiers stack multiplicatively on τ in this order: state × guard (1.4) × overdrive (1.35) × ability × release boost × burst. Then the absolute cap applies.

### 4.7 Charge, release, whiff (Arcade; stock presets record `intents.charge` and ignore it)

- **Charge:** `intents.charge` held → c rises 0 → 1 over **600 ms sim**. Heat +8/s. Holding at c = 1 is allowed for up to **1000 ms**, then the charge releases on its own.
- **Public telegraph:** the charge becomes public at **c ≥ 0.25**. From that point the hand emissive glows in the owner's team colour and `opp.charge` in every observation reads c; below 0.25 it reads 0. Built-in perception uses the same field.
- **Heavy armour:** from c ≥ 0.667 (the last 200 ms of the ramp), through any hold, until 120 ms after release: incoming unguarded STRIKEs with raw < 16 don't stagger, don't cancel the charge, and deal × 0.5. A heavy-tagged arm wins clashes against non-heavy arms.
- **Release** (charge falling edge): τ × (1 + 0.5·c) for **250 ms**. The next damaging strike within **400 ms** is tagged `heavy(c)`.
- **Cancel:** a guard press while charging cancels it, +8 heat, no whiff, `charge` event stage `cancel`.
- **Whiff:** a release with no strike within 400 ms → +10 heat and a **250 ms** τ × 0.8 recovery. Emits `whiff`.

### 4.8 Loadouts and abilities (Arcade)

| | **WHIP** (light) | **PIVOT** (medium, default) | **ANVIL** (heavy) |
|---|---|---|---|
| τmax (5 arm actuators) | 4.998 N·m (×1.7) | 5.880 N·m (×2.0) | 7.644 N·m (×2.6) |
| Joint damping (`dof_damping`) | 0.42 (×0.7) | 0.60 | 0.84 (×1.4) |
| Armature (`dof_armature`) | 0.0224 (×0.8) | 0.028 | 0.0504 (×1.8) |
| kv | 2.731 (×1.0) | 4.097 (×1.5) | 5.462 (×2.0) |
| kp | 998.22 | 998.22 | 998.22 |
| vRef (measured, 4.2; starting value) | 3.2 m/s | 2.9 m/s | 2.7 m/s |
| Integrity | 85 | 100 | 115 |
| loadoutDmg / loadoutHeat | 1.08 / 0.90 | 1.00 / 1.00 | 0.94 / 1.15 |
| Stagger received | ×1.3 | ×1.0 | ×0.7 |
| Signature | **SNAP** | **RECOIL COIL** | **BULWARK** |
| Fantasy | Fastest arrival, hits a little harder, fragile | All-rounder, best deflect tools | Wins shoves and guard wars, slowest start |

| Ability (F / Y) | Effect | Cost |
|---|---|---|
| **SNAP** | For 180 ms: τ × 1.6, kv × 0.5 | 2 charges, each recharging in 5.0 s. +12 heat per use. |
| **RECOIL COIL** | For 2.5 s: the first strike that lands on you while guard is held counts as a deflect, whatever the press timing. Then it ends. | 14 s cooldown. Guard heat doubled while active. |
| **BULWARK** | For 3.0 s: braced guard with τ × 1.5, kv × 3.0, chip × 0. Each blocked strike gives the attacker +20 heat. You can't strike (command yaw rate cap 2 rad/s, jab and charge disabled). Taking 60 total raw ends it early. | 16 s cooldown, from when it ends |

**Overdrive** (Shift / LB), all loadouts: τ × 1.35 while held, +25 heat/s.

**Onboarding gate:** abilities and Overdrive are hidden and disabled for a profile's first **3 matches** (`profile.matchesPlayed < 3`); the kit panel doesn't render them. Built-in AI still uses its ability only from Contender up.

**Stock presets:** loadouts, abilities, Overdrive, Burst, and charge are ignored. Both arms run stock Menagerie parameters; intents are recorded only.

**Built-in loadouts:** OVERSHOOT = Whip, BACKLASH = Anvil, DEADBAND = Pivot, JIG = Pivot.

### 4.9 Grip and Throw

- **Grip:** hold to close (0.04), release to open (1.15). Real frictional grasps of cubes and the Core. Human grabs use the grab assist (3.1.4).
- **For policy seats, grip is `targets[5]`.** `intents.grip` is ignored for policies; the recorded grip state is derived as `targets[5] < (GRIP_OPEN + GRIP_CLOSED) / 2`.
- **Throw:** a cube released during a flick flies at tip speed and deals damage per 4.3.
- **Bind is cut from v1.** `data.eq_active` throws `BindingError: _emval_take_value has unknown type memory_view<bool>` in `@mujoco/mujoco` 3.12.0 even when read. No weld equality is added to `arena.xml`, and no code reads or writes `eq_active`. If Bind returns it will be built on `xfrc_applied` spring forces, which save and restore cleanly.

### 4.10 Presets: Arcade, Proving Ground, Harness, Demo

A match setting **PRESET**, chosen in the green room (FIGHT defaults to Arcade; a user-model entrant offers ARCADE or PROVING GROUND) and in the Lab (defaults to Harness). A preset fixes a **physics mode** (`arcade` or `harness`, the latter meaning stock) and a set of rules.

| | **ARCADE** (play) | **PROVING GROUND** (human vs model, honest) | **HARNESS** (verification) | **DEMO** (teleop data) |
|---|---|---|---|---|
| Physics mode | `arcade` | `harness` (stock) | `harness` (stock) | `harness` (stock) |
| Model file | `arena-arcade.xml` (generated: `arena.xml` + strike hulls) | `arena.xml`, untouched | `arena.xml`, untouched | `arena.xml`, untouched |
| Timestep | **2.5 ms**, 400 Hz | **5.0 ms** (as shipped) | **5.0 ms**, or **1/600 s** when control_hz is 30 or 60 | same as Harness |
| Control tick | 50 Hz (8 steps) | 50 Hz (4 steps) | 50 Hz (4 steps) at 5 ms; 30 Hz (20 steps) or 60 Hz (10 steps) at 1/600 s | same as Harness |
| Human ctrl write | every physics step | every physics step | n/a | every physics step |
| kp / kv | 998.22 / loadout | 998.22 / **2.731** | same | same |
| forcerange (arm) | loadout + runtime states, cap ±8.0 | **±2.94** | **±2.94** | **±2.94** |
| dof_damping / armature (arm) | loadout | **0.60 / 0.028** | same | same |
| Runtime model edits | servo states, guard, overdrive, abilities | **None** (Offline at KO excepted: recorded mutation) | **None** except Offline | **None** except Offline |
| Scoring profile | `full` | `physical`: dmg = raw × zone × tool; no guard, deflect, charge, heat, or state effects; KO and Core as normal | `physical` | `physical` |
| Human input shaping | leash, guard blend, jab, charge, assists | leash, guard blend (pose only), assists; **no jab or charge macros** | n/a | **none**: leash off, no guard blend, no macros; assists off unless toggled (recorded) |
| Hit stop | sim-clock freeze (8.1), budgeted | **none** (no sim or render freeze) | none | none |
| Time dilation | KO only | none | none | none |
| Juice | full budget (8.1) | sound, sparks, markers, camera shake at ×0.5; nothing that delays or hides the frame | spectator: sound and sparks | minimal: sound only |
| Comeback rules | on | off | off | off |
| Observation fair delay | human seated vs `module`/`trajectory`/`bridge`: **120 ms** | human seated vs `module`/`trajectory`/`bridge`: **120 ms** (Lab: 0–200 ms) | 0 (no human) | 0 unless an opponent policy is seated, then 120 ms |
| Determinism | seeded, verifiable | seeded, verifiable, model seat bit-exact | seeded, lockstep eval available, verifiable | seeded, verifiable |
| Result sticker | **ARCADE PHYSICS · NOT VERIFICATION** on every model report | CLEARED FOR BROADCAST or POLICY FAULT (human seat noted) | CLEARED FOR BROADCAST or POLICY FAULT | none (dataset) |
| Arena variants (7.3.11) | allowed | standard only | standard, or a variant flagged `non-stock layout` | standard only |

**Why four presets.** Arcade is the game: 2× torque and states make a human feel crisp, but a stock-trained policy is out of distribution there, so Arcade model reports always carry the sticker. Proving Ground is how you honestly fight your own model: the model's plant and scoring are exactly Harness, and only the human side gets input help, which is recorded. Harness is model-vs-model verification. Demo records human teleop with no shaping so the data matches an SO-101 plant.

**Strike hulls (Arcade only).** `scripts/gen-arcade-model.mjs` (WP2) generates `public/models/robotstudio_so101/arena-arcade.xml` from `arena.xml` by inserting massless capsule geoms (radius **0.009 m**, `contype="8" conaffinity="8"`, `mass="0"`, `group="4"`, invisible) into each seat's `gripper`, `moving_jaw`, `camera_mount` (inside `gripper`), `wrist`, and `lower_arm` bodies, sized to each link's bounding box, plus `<exclude>` pairs so a seat's hulls never touch each other or their own links. The output is committed; a test checks that stripping the hull geoms reproduces `arena.xml` exactly. The decision is about thickness × speed, not CPU: at dt 2.5 ms a Whip tip covers 9–11 mm per step against 2–6 mm real geoms. Stock presets keep the thin geoms and accept the extra geometric noise, because P4 forbids touching the model.

**Bench gate.** `npm run bench` must report p95 ≤ **1.2 ms per 16.7 ms of sim** (6.7 Arcade steps with contact scan, both arms in contact), in Node and on the `?debug=bench` browser page on an M1 MacBook Air. The measured calibration is 0.093 ms per step including the contact walk, so this is a regression guard, not a risk.

---

## 5. AI opponent and model-verification harness

### 5.1 The one rule

**The built-in opponent is a policy.** It uses the same `reset(ctx)` / `act(obs)` contract, runs in the same Worker runner (or the same in-process runner under Node), gets the same joint-limit validation, and reads the same `torquelimit.obs/3` observation as an uploaded model. If the built-in AI can't do something through that interface, no model can.

### 5.2 Seats and drivers

A match has two seats, `atlas` (left mount, world x = −0.32) and `blaze` (right mount, x = +0.32, rotated π). The player is always `atlas` when a human plays. Each seat has one driver:

| Driver | Source | Transport (browser) | Transport (Node: eval CLI, tests) |
|---|---|---|---|
| `human` | `PilotController` | direct `ctrl` write every physics step | n/a |
| `proxy` | a scripted human-input bot (`src/game/policy/proxy-bots/*`) feeding synthetic mouse/keyboard input into a real `PilotController` | main thread, every frame | in-process, every control tick (same code) |
| `builtin` | `src/game/policy/opponent/index.ts` with `{personality, tier, dda}` | module Worker: `new Worker(new URL("./policy-worker.ts", import.meta.url), { type: "module" })` | `createInProcessSeatDriver` imports `opponent/index.ts` directly |
| `module` | uploaded `.js`/`.mjs` (single file or pre-bundled) | the same Worker imports it from a Blob URL with `import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)` | `createInProcessSeatDriver` imports the file path |
| `trajectory` | uploaded `.json` `{fps, frames: number[][6]}` (fps 1–240, ≤ 100k frames, linear interpolation) | sampler, main thread | same sampler |
| `bridge` | local process, protocol in 5.7 | proxy Worker with WebSocket (HTTP POST fallback) | Node `WebSocket` (global in Node ≥ 22) in-process |
| `replay` | a recorded episode's `sim.ctrl` column | sampler | same sampler |

**Determinism shim** (`src/game/policy/policy-rng-shim.ts`, WP4). Before importing a `module` policy, and again on every `reset`, the runner replaces `Math.random` with sfc32 seeded from `ctx.seed`. In `timing: eval` it also stubs `Date.now()` and `performance.now()` to return sim time in ms (the runner measures `computeMs` with a captured real `performance.now` before the stub). `bridge` servers receive the seed in `reset` and are documented to call `torch.manual_seed(seed)` and `torch.use_deterministic_algorithms(True)`.

**Seeds.** `rng.ts` derives substreams from the match seed: `ctx.seed = substream(matchSeed, "seat", seat, round)` and `EngineResetOptions.seed = substream(matchSeed, "physicsInit", round)`. Two seats never share a seed, and each round re-jitters.

### 5.3 Timing

- Physics runs at 400 Hz (Arcade) or 200 Hz / 600 Hz (stock presets). The **control tick** is `controlHz` (50 by default; 30 or 60 in stock presets at dt 1/600 s, 4.10). Each non-human seat decides every `decimation` control ticks: **2 by default** (25 Hz at 50), or 1 / 2 / 5.
- `obs.t` is sim time. The UI clock is sim time too.
- **Live mode** (a human is present): a request goes out on the decision tick, and the result applies on the first control tick at least `actionDelayTicks` (**default 1**) after the request *and* after arrival. If a new decision tick comes before the reply, the seat holds its last action and logs `late`. After **500 ms wall** with no reply, it logs `timeout` and holds its last safe pose. Three consecutive timeouts mark the seat `disconnected`: the round is forfeited in a Lab match, and casual play continues with the seat holding.
- **Eval mode** (lockstep, no human): on the decision tick the sim waits for the reply **indefinitely**. No wall-clock timeout ever changes the sim outcome; compute time over 500 ms is logged as a `slow_decision` metric only. A separate **hard abort at 30 s wall** per act errors the episode (`result.error = "policy_hang"`) instead of holding a pose. The action applies after exactly `actionDelayTicks` control ticks. Rendering is optional, and **turbo** runs as fast as the policies reply.
- **Warm-up:** after `reset_ok`, every non-human driver receives `warmup` with **8** dummy observations taken from the registration fixture (5.6) and a **60 s** budget before the first real act (CUDA context, autotune, `torch.compile`). Warm-up acts are not recorded and don't count toward reliability.
- **Chunked actions:** a `PolicyAction` may carry `chunk` (targets at `chunkHz`) and `intentChunk` (INTENT_BITS per chunk step). `chunkStartT` is the sim time of `chunk[0]`, defaulting to the `t` of the observation the policy was given. Entries are applied **by sim time**: the runner resamples to the control rate and skips entries whose time is already past. The seat option `chunkExecute` chooses:
  - `until_next_decision` (default): run until the next decision tick; the rest is discarded.
  - `full_chunk`: suppress decision requests until the chunk is consumed.
  - `n_steps:<k>`: execute k control ticks, then request.
  - `temporalEnsembleM` (optional, number): the runner keeps every received chunk and applies the ACT-style exponentially weighted average with weight `exp(−m·i)` over all chunks covering the current tick.
  The executed chunk index and source chunk id are recorded per tick (5.8).
- **Fair delay:** whenever a **human is seated** (any preset) facing a `module`, `trajectory`, or `bridge` seat, that seat's observations come from a delay line `fairDelayMs` in the past (default **120 ms**; Lab range 0–200; recorded in meta). `builtin` models its own perception lag (5.5.3) and gets no external delay. With no human seated, the delay is 0.

### 5.4 Observation `torquelimit.obs/3` (ego frame)

Each seat observes from its **own base**: origin at its mount on the table plane, **+x toward the opponent base**, +z up, +y = z × x. Atlas: `p_ego = p_world − (−0.32, 0, 0)`. Blaze: `p_ego = (−(x − 0.32), −y, z)`. That is a **180° rotation about z**, not a mirror; quaternions and velocities rotate the same way. Joint vectors need no transform. **One policy can play either seat.** In ego coordinates the opponent base is at (0.64, 0, 0), the midline at x = 0.32, the own dock at (0.32 + DOCK_CENTER_X.atlas, 0, 0), and the opponent dock mirrored.

**Conventions.** `ee` is the **`gripperframe` site** of `so101.xml`. `wrist_pos` is the origin of the `gripper` body (on the wrist_roll axis). `elbow_pos` is the origin of the `lower_arm` body. `tau` is `data.actuator_force[i]` (clamped to forcerange). Quaternions are wxyz, **canonicalized to w ≥ 0**. `dt` is the **control period** (0.02 s at 50 Hz). The TypeScript definition is in the contracts (11.2); the JSON schema is published as `public/schemas/torquelimit.obs-3.json` (WP4) and imported by the Python tools, with `obs_schema_hash` = SHA-256 of that file.

The flat transport is a set of named float32 blocks. Every block is sent to every transport (JS module, bridge `flat` and `dict`), so no transport sees less.

**`state`** float32[12], LeRobot `observation.state` (positions) and `observation.velocity`:

| Index | Name | Unit |
|---|---|---|
| 0–5 | `self.q.{shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper}` | rad |
| 6–11 | `self.qd.*` | rad/s |

**`self_ext`** float32[32]:

| Index | Name | Unit |
|---|---|---|
| 0–2 | `self.ee.pos` | ego m |
| 3–6 | `self.ee.quat` (w ≥ 0) | |
| 7–9 | `self.ee.linvel` | m/s |
| 10–12 | `self.wrist_pos` | ego m |
| 13–18 | `self.tau` | N·m |
| 19–24 | `self.ctrl` (real servo target now) | rad |
| 25–30 | `last_action` (applied targets at the previous control tick) | rad |
| 31 | `self.gripper_opening` = (q₅ − 0.04) / (1.15 − 0.04) | 0–1 |

**`opponent_state`** float32[28], LeRobot `observation.opponent_state`:

| Index | Name | Unit |
|---|---|---|
| 0–5 | `opp.q` | rad |
| 6–11 | `opp.qd` | rad/s |
| 12–14 | `opp.ee.pos` | ego m |
| 15–18 | `opp.ee.quat` (w ≥ 0) | |
| 19–21 | `opp.ee.linvel` | m/s |
| 22–24 | `opp.elbow_pos` | ego m |
| 25–27 | `opp.wrist_pos` | ego m |

**`game`** float32[16], LeRobot `observation.game`:

| Index | Name | Definition |
|---|---|---|
| 0 | `self.integrity_frac` | integrity / integrity_max |
| 1 | `opp.integrity_frac` | |
| 2 | `phase.time_remaining_frac` | remaining / current phase length (45 s fight, 20 s sudden death); 0 outside fight phases |
| 3 | `phase.is_fight` | 1 in `fight` or `sudden_death` |
| 4 | `phase.sudden_death` | 0/1 |
| 5 | `round.rounds_won_diff_frac` | (self − opp) / ceil(best_of / 2) |
| 6 | `core.lock_in_signed_frac` | +remaining / that owner's full lock-in if self owns, − if the opponent owns, 0 otherwise |
| 7 | `core.lock_in_full` | owner's full lock-in / 8 (0 when unowned) |
| 8 | `core.live` | 0/1 |
| 9 | `contact.touching` | 1 if any cross-arm geom pair has `efc_force > 0.3 N` this step |
| 10 | `self.heat_frac` | Arcade only; 0 in stock presets |
| 11 | `opp.charge_public` | c if c ≥ 0.25 else 0; Arcade only |
| 12 | `self.servo_state_code / 5` | normal 0, micro 1, stagger 2, stun 3, cutout 4, offline 5; stock: offline only |
| 13 | `opp.servo_state_code / 5` | same |
| 14 | `self.servo_state_remaining_s` | Arcade only |
| 15 | `self.guard_active` | Arcade only (intent accepted by rules) |

**`environment_state`** float32[81], LeRobot `observation.environment_state`: for each of the 9 cubes in index order, ego `pos(3) + quat(4, w ≥ 0) + parked(1) + held_by(1: +1 self, −1 opponent, 0 none)`. Parked cubes report their parked pose.

**`contacts`** float32[20]: the 4 most recent contact events since this seat's previous observation, newest first, each `[kind, attacker, zone, normal_speed, age_s]`, zero-padded. kind: 0 none, 1 strike, 2 graze, 3 deflect, 4 clash, 5 contact, 6 cube_hit, 7 table_hit. attacker: +1 self, −1 opponent, 0 none. zone: LinkId index + 1 in `LINK_IDS` order, 0 none.

**Images (optional, browser only).** A seat's `images` option requests any of `wrist` (the real `<seat>_wrist_cam`), `overhead` (fixed camera 0.9 m above the table centre looking down, fovy 50°), and `front` (the broadcast phone camera). They are rendered offscreen by WP6 at the **decision rate** at a configurable size (default **224 × 224 RGB**, up to 640 × 480), with LeRobot names `observation.images.wrist|overhead|front`. JS modules receive `Uint8Array` RGB buffers (transferred); bridges receive binary WebSocket frames (5.7). Episodes with images record them as video (5.8). Node eval can't render; a suite that requests images must run in the browser (RUN SUITE in the Lab), and the CLI refuses it with a clear message.

**The opponent's command, ghost, and assists are never observable.** Only physical state and public game state are.

### 5.5 Built-in opponent architecture (`src/game/policy/opponent/`)

```
obs (ego) → [Perception] delay buffer · event detectors · habit model (order-1/2 Markov, decayed)
          → [Mind]       mood {aggression, composure, focus} low-passed · DDA scalar k
          → [Decision]   commitment FSM  (NEUTRAL → COMMITTED(windup→active→follow→recover) · RATTLED · RESET_SPACING · ROUND_TRANSITION)
                         utility selector in NEUTRAL every think interval, softmax over IAUS scores
          → [Motor]      primitive keyframes (ego task space) → min-jerk path → per-primitive noise → analytic IK → 6 targets + intents
```

#### 5.5.1 Commitment FSM

| State | Entry | Behaviour | Exit |
|---|---|---|---|
| `NEUTRAL` | default | Guard with idle sway. The utility selector runs every `think` ms ± 20 ms. | an action is chosen |
| `COMMITTED` | an action is chosen | Phases are windup → active → follow → recover. **Windup** can be cancelled when `cancelable` and progress < `cancelWindow` (this is how feints work). **Active and follow** can't be cancelled. **Recover** can be cancelled into GUARD after `recoverMin × tier.recoverScale`. | primitive done → NEUTRAL; hit taken during windup → RATTLED |
| `RATTLED` | own strike taken with raw ≥ 10 | 150–350 ms (lerp by raw 10→39): EE −0.06 m in x, +0.04 m in z, guard intent on | timer ends |
| `RESET_SPACING` | ≥ 3 contact onsets within 2.0 s | 400–900 ms drift back to the personality's preferred range at low pressure | timer ends |
| `ROUND_TRANSITION` | phase is not `fight`/`sudden_death` | plays the SHOWBOAT or home primitive, ignores combat | phase is fight |

#### 5.5.2 Primitives (ego metres; durations at tier Contender before noise)

| Primitive | Keyframes | Phases windup/active/follow/recover (ms) | Intents |
|---|---|---|---|
| GUARD | EE (0.20, y_track, 0.15), pitch −0.3, grip 0.04. `y_track` follows opp EE y at gain 0.6 with 150 ms lag. | continuous | guard when threat > 0.5 |
| PARRY | from guard: lateral snap ±0.05 m in y toward the incoming path, z +0.02 | —/90/—/150 | guard **press** placed at predicted impact − 60 ms (± tier noise) through `intentChunk` at 50 Hz (20 ms resolution). Against a charged heavy, the press time is subject to the heavy guess rule (5.5.5). |
| POKE | guard → x + 0.07 | 40/70/30/120 | n/a |
| JAB | guard → aim + 0.03 overshoot | 90/130/75/200 | n/a |
| HOOK | pan out to ±0.9 rad at r 0.36 m, z 0.10 → sweep through to ∓0.4 | 220/180/80/300 | n/a |
| SLAM (heavy) | (0.18, y_aim, 0.30) pitch −1.2 → (aim.x, aim.y, 0.03) | 330–900 charge (may hold past full)/150/60/450 | charge held through windup, released at active; 20% of SLAMs delay release 150–500 ms past full |
| FEINT(x) | runs JAB or SLAM windup to 40–70%, then cancels to GUARD or chains into the other | windup × 0.55, then 120 back | the SLAM feint charges and cancels with a guard press (costs 8 heat) |
| CORE_GRAB | approach core at z 0.08 open 1.15 → descend z 0.025 → close 0.04 (hold 120) → lift z 0.10 | 250/200/120/150 | grip via targets[5] |
| CORE_DOCK | carry to own dock (dock centre, z 0.05) → lower z 0.025 → open 1.15 → retreat to guard | 300/250/120/200 | grip then release via targets[5] |
| PRY | full extension toward the Core in the opponent's dock, aimed 2 cm past its centre (toward the opponent base) at z 0.03; either close on it and drag toward own side, or flick it outward with the jaw if the grasp misses | 200/250/300/400 | targets[5] |
| GRAB_THROW | approach cube z 0.08 → descend 0.025 → close → lift 0.16 → fling pan and elbow toward opp EE, release at EE speed ≥ 0.9 m/s within 20° of target | 350/250/200/300 | targets[5] |
| ADVANCE / RETREAT | guard.x ± 0.04–0.06 | 180–260 | n/a |
| CIRCLE | guard pan ± 0.15–0.30 rad | 250–400 | n/a |
| ABILITY | OVERSHOOT fires SNAP at the start of an active phase; BACKLASH fires BULWARK when threat > 0.7 and heat < 40; DEADBAND fires RECOIL COIL when the habit model predicts HOOK or JAB with p > 0.5 | instant | ability |
| BURST | when staggered with heat ≤ 65 and the stagger's remaining time > 200 ms, at probability tier.burstProb | instant | burst |
| SHOWBOAT | gripper open/close twice at 3 Hz, slow raise, re-guard | 400–900 | n/a |
| IDLE_SWAY | ±(5–15) mm Lissajous at 0.3–0.6 Hz plus OU drift (θ = 2/s, σ = 4 mm) | continuous | n/a |

- **Paths** use min-jerk interpolation between keyframes (`s = 10τ³ − 15τ⁴ + 6τ⁵`). Attacks lead the path by 40–80 ms because the servos saturate; the stagger rule (4.6) is written so this lead never triggers knockback.
- **Output** is a `chunk` at 50 Hz covering the decision period plus one tick, with `chunkStartT` = the observation's t, so a 25 Hz decision rate still places targets and presses at 20 ms resolution.
- **Noise** is sampled once per primitive, never per tick: `σ_pos = posBase + posK × demandedSpeed`, scaled × (1.4 − 0.6·composure). Duration scale is log-normal with the tier's CV.
- **Clamped** to joint limits with a 0.01 rad margin, so the built-in AI never logs a violation.
- **Heat awareness (Arcade):** above heat 70, attack utilities × 0.4 and GUARD is avoided unless threat > 0.8.
- **Stock presets:** the AI's intents are ignored by scoring; it still guards with its arm pose, which physically blocks.

#### 5.5.3 Perception

- A ring buffer holds 1.5 s of observations. The AI "sees" `obs(t − perceptionLag)`.
- **Guard volume** (shared with stats 5.10): a capsule in the seat's ego frame from its own `camera_mount` body origin to its `shoulder` body origin, radius **0.06 m**.
- **Detectors** run on the lagged view:
  - `attackOnset`: opp EE velocity component toward the nearest point of the own guard volume > 0.35 m/s for ≥ 40 ms, **or** `opp.charge_public` > 0 (true only from c ≥ 0.25).
  - `whiff`: an opp active phase ended with no contact, opp EE past the midline (ego x < 0.32), outward speed < 0.1 m/s.
  - `feintSuspect`: onset followed by opp EE deceleration to < 0.1 m/s within 120 ms, or a public charge that disappears without a release.
- Each detected event is released to Decision at `now + exGaussian(μ, σ, τ)` with a floor of 120 ms. While guard is up in NEUTRAL, *blocks* (not punishes) use μ × 0.8.
- **Habit model:** player actions discretized into J (jab/poke), S (heavy), H (hook), G (guard hold), F (feint), T (cube/core), A (advance), R (retreat). Order-1 and order-2 counts decay with the tier's half-life, with situation keys {afterBlocked, afterHit, afterWhiff}. A prediction p ≥ `readThreshold` lets the AI pre-commit the counter, logged as `anticipation`.

#### 5.5.4 Utility selector

```
score(a) = personalityWeight(a) × Π considerations(a) × compensation(n) × novelty(a) × readBonus(a) × heatGate(a) × patch(a)
novelty(a) = exp(−usesInLast10s(a) / 2)
compensation(n) = 1 + (1 − 1/n) × (1 − Π)   (IAUS make-up factor, applied per consideration)
pick = softmax(scores, T = personality.temp × tier.tempMul × (1.3 − 0.6·composure))
```

| Action | Considerations (multiplied) |
|---|---|
| POKE | inReach(dist to opp forearm, logistic falling, centre 0.09 m) · oppExtended (opp EE ego x < 0.36) · aggression^0.5 |
| JAB | inReach(centre 0.16 m) · (1 − oppActive) · aggression^0.7 · (1 − threat) |
| HOOK | lateralOpening (opp EE \|y\| offset from guard line, linear 0–0.08 m) · inReach(0.20 m) · (1 − oppGuardHeld) · aggression |
| SLAM | (oppRecovering OR oppGuardHeld) · aggression² · (1 + desperation) · (1 + clutch) |
| WHIFF_PUNISH | released whiff event · windowRemaining > own move t90 · Bernoulli(tier.punishProb) |
| GUARD / PARRY | threat (released attackOnset) · (1 − aggression)^0.5. PARRY also needs composure > 0.5 and the tier allows parry. |
| FEINT | personality.feintRate · P(player guards within 300 ms of our windup) · aggression |
| CORE_GRAB | core live · core unowned or loose · dist(own EE, core) < 0.30 m · (1 − threat) |
| CORE_DOCK | holding core |
| PRY | opp owns core · core docked · (lockInRemaining < 4 s → 1, else 0.4) · (1 − oppGuardNearDock) |
| GRAB_THROW | cube within 0.06 m of reachable low zone · (1 − threat) · throwAffinity · oppDistracted |
| ADVANCE / RETREAT / CIRCLE | spacing error vs personality.preferredX · rhythm bias |
| SHOWBOAT | strike landed with raw ≥ 25 within 600 ms · (1 − threat) · showboat |
| IDLE_SWAY | constant 0.05 |

`threat` = logistic(opp EE closing speed × proximity), centre 0.6 m/s at 0.15 m. `clutch` = 1 in the last 10 s of a close round (integrity difference < 20). `desperation` = 1 when opp integrity − own > 40. `patch(a)` is the flaw adaptation factor (5.5.6), 1 by default.

#### 5.5.5 Tiers

| Knob | Rookie | Contender | Pro | Champion |
|---|---|---|---|---|
| Reaction ex-Gaussian μ / σ / τ (ms) | 330 / 45 / 140 | 260 / 35 / 90 | 215 / 28 / 55 | 185 / 22 / 35 |
| Perception lag (ms, included in reaction) | 110 | 90 | 70 | 60 |
| Think interval (ms) | 160 | 110 | 90 | 80 |
| Position noise base / per m/s (mm) | 14 / 18 | 9 / 12 | 6 / 8 | 4 / 6 |
| Timing CV | 0.18 | 0.12 | 0.08 | 0.06 |
| Whiff-punish probability | 0.25 | 0.50 | 0.75 | 0.90 |
| Feint recognition | 0.10 | 0.35 | 0.60 | 0.75 |
| Read threshold | never | 0.75 | 0.60 | 0.50 |
| Habit half-life (events) | 8 | 15 | 25 | 40 |
| Parry / Ability / Burst prob | no / no / 0 | yes / yes / 0.3 | yes / yes / 0.6 | yes / yes / 0.8 |
| **Heavy parry success cap** | n/a | 40% | **55%** | **70%** |
| Flaw adaptation | no | no | yes | yes |
| Recover scale | 1.30 | 1.10 | 1.00 | 0.95 |
| Temperature multiplier | 1.4 | 1.0 | 0.8 | 0.7 |
| DDA band / target perf (AI side) | ±25% / **−0.15** | ±15% / **−0.05** | ±10% / **0** | off |

**Heavy guess rule.** A deflect against a charged heavy is a guess about release timing, so the AI guesses. When PARRY targets a public charge, the press time is drawn from the AI's model of the player's release delay (habit counts of past delays). A rolling window of its last 10 heavy parry attempts is kept per match; while the success fraction is at or above the tier cap, the press time gets a deliberate error of ±(180–300 ms), direction random. Each guess is logged in `debug.parryGuess = {expectedReleaseT, errorMs, capped}`. The `heavy-v1` suite (5.10.4) holds the result to a 30–60% human-proxy heavy success band.

**Rookie's signature mistakes:** drops guard for 300 ms after landing a hit; gives its last successful action a +50% utility bonus; bites most feints.

**DDA** (live Arcade only):
- **Signal:** `perf = EMA((dealt − taken) / (dealt + taken + 10))` from the AI's side, updated at the end of an exchange (≥ 600 ms with no contact). **Target per tier** (table above): Rookie −0.15 (player favoured), Contender −0.05, Pro 0.
- **Actuation:** a scalar k ∈ [−1, 1], +k = harder, moving at most ±0.1 per exchange. It scales reaction μ, perception lag, punish probability, feint recognition, temperature, and slam windup length within the tier band. **Never** servos, damage, reach, or IK.
- **Loss streak:** after **2 consecutive match losses** by the player against the same entrant and tier, the next match starts with k −0.2 (logged `dda` with `reason: "loss_streak"`).
- **Never harder after a player loss:** in the first round after a player lost a round or match, k may only move toward easier.
- **Frozen** in the last 10 s of a deciding round, in eval, in every stock preset, in replay, in league boss gauntlets, in the daily challenge, and at Champion.
- k is logged as a `dda` event.

#### 5.5.6 Personalities (data in `personalities.ts`)

| | **OVERSHOOT**, pressure (Whip) | **BACKLASH**, counter-puncher (Anvil) | **DEADBAND**, trickster (Pivot) | **JIG**, tutorial and sparring (Pivot) |
|---|---|---|---|---|
| Preferred guard x | 0.26 | 0.18 | 0.22 | 0.20 |
| Weights | POKE 1.4, JAB 1.3, FEINT 1.2, HOOK 0.9, SLAM 0.5, PRY 1.2, CORE 1.0, THROW 0.3, GUARD 0.7, SHOWBOAT 0.8 | GUARD 1.5, PARRY 1.3, WHIFF_PUNISH 1.6, SLAM 1.3, CORE 1.2, PRY 0.6, JAB 0.7, FEINT 0.3, POKE 0.4 | FEINT 1.5, THROW 1.6, PRY 1.5, CIRCLE 1.4, HOOK 1.2, JAB 0.9, SLAM 0.7, GUARD 0.9, SHOWBOAT 1.3 | scripted behaviours only |
| Base aggression | 0.75 | 0.30 | 0.50 | n/a |
| Tilt (wTilt) | +0.25 (angrier when hit) | −0.15 (more careful) | 0, score weight × 2 | n/a |
| τ_mood | 4 s | 8 s | 5 s | n/a |
| Temperature | 1.1 | 0.7 | 1.3 | n/a |
| Noise / windup | noise × 1.15, windup × 0.85 | noise × 0.8, reaction μ + 15 ms, slam windup × 1.15 | habit weight × 1.5, half-life × 1.3 | n/a |
| Flaw (id) | `chains_jabs`: after a blocked jab, 30% chance of a second jab without checking threat | `bites_feints`: recognition × 0.6; slow to react to cube throws | `panics`: composure drops 2× faster; below 0.3 it retreats and throws wild (noise × 1.6) | n/a |
| Flaw exploited when | the player punishes the chained jab within 500 ms | a player feint draws a PARRY or GUARD commit that the player then hits | the player lands a strike while composure < 0.3 | n/a |
| Adaptation (Pro, Champion) after 3 exploits in one match | chain chance → 0 and next JAB after a block waits for threat < 0.3 | recognition × 1.0 for the rest of the match | composure decay back to 1× | n/a |
| Idle style | bounces sway at 0.6 Hz | nearly still, 0.3 Hz deep breaths | circles | still |
| Accent (on magenta team) | ink stripe, 1 band | ink stripe, 2 bands | ink stripe, 3 bands | paper stripe |

- **Flaw scouting.** Entrant cards hide the flaw line until the player has exploited it once (stored per profile). Then it stamps **SCOUTED** with the flaw text. The rules emit `flaw` events `{seat, flaw, stage: "exploited" | "patched"}`; the operator calls a patch in captions ("Backlash has stopped biting.").
- **JIG behaviours**, selected by `config.behavior`: `parked_in_reach` (hand held still inside the pilot's flick range), `idle` (home), `hold_guard`, `slow_heavy` (SLAM every 3.0 s with a 700 ms charge), `sparring` (guards, and throws a slow JAB every 2.5–4 s), `chase` (tasks only: sweeps its gripper toward the Core at 0.4 m/s).

#### 5.5.7 Proxy bots (`src/game/policy/proxy-bots/`, WP4)

Proxy bots play **through the human control path**: they emit synthetic pointer deltas and key states into a real `PilotController` (WP3's `synthetic-input.ts`), so assists, leash, jab and charge macros, heat, and hit stop apply exactly as for a person. They exist to test the human meta, which AI-vs-AI suites never touch.

| Bot | Behaviour |
|---|---|
| `human_proxy` | Plays a generalist game. Reaction ex-Gaussian μ 250 / σ 40 / τ 80 ms, 1 cm aim noise, 15% input noise on flick amplitude, uses the range cue and the grab assist. |
| `flick_heat_cap` | Flicks every 250 ms whenever in range, stops at heat 95, resumes at 60. |
| `turtle` | Holds guard, deflect-presses on every visible onset, BULWARK on cooldown, docks only when the Core lands within reach. |
| `core_camper` | Ignores combat until the drop, rushes the Core, docks, then parks the hand over its own dock. |
| `overdrive_spam` | Overdrive held whenever heat < 80, hooks. |
| `jab_spam` | LMB tap every 190 ms with W held. |
| `hook_rhythm` | A full hook every 1.5 s, guard between. |
| `heavy_mixer` | Charges heavies with random release delays (0–1000 ms past full), 25% cancels, aims at opponent optics. |

### 5.6 Policy module contract (upload)

```js
// my_policy.mjs — single file, or pre-bundled
export const policyName = "act_so101_v3";             // optional
export const provenance = { checkpoint: "…", run: "…" }; // optional, stored verbatim
export function reset(ctx) {}                          // ctx: ResetContext (contracts); may return a Promise
export function act(obs) {                             // obs: Observation (torquelimit.obs/3)
  return [0, -1.1, 0.6, 1.4, 0, 0.05];                 // legacy: 6 absolute joint targets (rad)
  // or: return { targets: [...6], intents: { guard: true }, chunk: [[…6…], …], chunkHz: 50, chunkStartT: obs.t, intentChunk: [1, 1, 0] }
}
```

**Validation:**
- NaN or Infinity → `error`. Strict mode fails the seat; lenient holds the last action.
- Targets are always clamped exactly to `JOINT_LIMITS`. A clamp counts as a **violation** (status `clamped` plus a `joint_limit_violation` event with joint and overshoot) only when the overshoot is > **1e-5 rad**, so a correct float32 policy clamping to float32 limits never faults. The overshoot is recorded either way.
- Intents missing → all false. `intents.grip` is ignored for policies (4.9).
- **There's no hidden smoothing.** What the model outputs (after the exact clamp) is what `ctrl` gets.
- `public/policies/example-policy.js` is rewritten to obs/3 and shows guard plus a timed jab.

**Registration checks** (Entrants screen, 7.3.4): `FILE PARSED`, `EXPORTS act()`, `RESET OK`, `COLD ACT · 41 ms` (the first act, measured alone), `200 FIXTURE ACTS · p99 3.2 ms` (warm), `ACTIONS FINITE`, `WITHIN LIMITS`, `DETERMINISTIC` (or `NON-DETERMINISTIC`, a warning, not a failure). The fixture is `public/policies/fixtures/registration-obs-3.bin`: 200 recorded observations covering both seats, active contact, full extension, near joint limits, sudden death, Core held and docked, and a Staggered self state. A failure reports the first failing fixture index (`FAILED AT FIXTURE 137 · NaN`).

**CHECK POLICY DETERMINISM** (Lab action and registration step): run the fixture stream twice from the same `ctx.seed` and compare every returned number exactly. Result recorded as `meta.seats.*.policyDeterministic: true | false | "unchecked"`.

### 5.7 Local bridge protocol `torquelimit.bridge/2`

- **WebSocket** `ws://127.0.0.1:<port>` (default 8765), JSON text frames plus binary image frames. Loopback only unless the Lab's **Allow LAN** toggle is on.
- **HTTP fallback:** `POST http://127.0.0.1:<port>/v1/{hello,reset,warmup,act}`, same bodies (images base64 in `images`). The server must send `Access-Control-Allow-Origin: http://localhost:3000`.
- Run the app over `http://localhost` for bridge use, because an https page can't open `ws://`.
- **Two bridge seats** may share one server (distinguished by `seat` and `session_id`) or use two ports.

```jsonc
// browser → server on connect
{ "type": "hello", "id": 1, "protocol": "torquelimit.bridge/2", "observation_schema": "torquelimit.obs/3",
  "obs_schema_hash": "sha256:…", "session_id": "2026-09-16T18-02-11Z-7f3a", "seats": ["blaze"],
  "control_hz": 50, "decision_hz": 25, "joint_names": ["shoulder_pan","shoulder_lift","elbow_flex","wrist_flex","wrist_roll","gripper"],
  "joint_limits": [[-1.91986,1.91986],[-1.7453293,1.7453293],[-1.69,1.69],[-1.658063,1.658063],[-2.7438473,2.7438473],[-0.174533,1.7453292]],
  "units": "rad", "formats": ["dict","flat"], "images": { "wrist": [224,224], "overhead": [224,224] } }
// server → browser (a server may reject a mismatched obs_schema_hash with a fatal error)
{ "type": "hello_ok", "id": 1, "policy": { "name": "act_so101_v3", "version": "2026-09-10", "claimed_sha256": "…",
    "provenance": { "checkpoint": "…", "run_id": "…", "framework": "lerobot 0.x / torch 2.x", "device": "cuda:0" } },
  "obs_format": "flat", "supports_chunks": true, "max_chunk": 100, "chunk_hz": 50 }
// per round, per seat
{ "type": "reset", "id": 2, "seat": "blaze", "session_id": "…", "episode_id": "…", "round": 1, "seed": 3141592653, "context": { /* ResetContext */ } }
{ "type": "reset_ok", "id": 2 }
{ "type": "warmup", "id": 3, "seat": "blaze", "count": 8 }       // followed by 8 act messages with "warmup": true
// per decision tick; if images are configured, one binary frame per image precedes the act:
//   [u32 act_id][u8 camera: 0 wrist 1 overhead 2 front][u16 w][u16 h][RGB bytes]
{ "type": "act", "id": 57, "seat": "blaze", "tick": 110, "t": 2.2, "warmup": false,
  "state": [/*12*/], "self_ext": [/*32*/], "opponent_state": [/*28*/], "game": [/*16*/], "environment_state": [/*81*/], "contacts": [/*20*/],
  "obs": { /* only if obs_format = dict */ } }
{ "type": "action", "id": 57, "action": [0.01,-0.4,0.9,-0.3,0.0,0.05], "intents": { "guard": false } }
{ "type": "action", "id": 57, "chunk": [[…6…],[…6…]], "chunk_hz": 50, "chunk_start_t": 2.18, "intent_chunk": [0,0,1], "info": { "entropy": 0.12 } }
// either direction
{ "type": "error", "id": 57, "message": "CUDA OOM", "fatal": false }
{ "type": "ping", "id": 58 }   →   { "type": "pong", "id": 58 }
{ "type": "bye" }
```

**Rules:**
- Reply to each `act` with the same `id`. Stale ids are dropped and logged `late`.
- Live mode: 500 ms wall per act. Eval mode: no timeout on the outcome, 30 s hard abort (5.3). Warm-up: 60 s total.
- `info` is stored sparsely and capped at 4 KB per step.
- `claimed_sha256` is stored as claimed; the app never presents it as verified.

**Shipped (WP5):**
- `tools/bridge/torquelimit_bridge.py`: a reference server (`pip install websockets numpy`) whose `Policy` class returns the guard pose, handles `seat`, `warmup`, `seed` (with the torch determinism lines commented in), and images.
- `tools/bridge/calibration.py`: the `sim_rad ↔ lerobot_units` map with **default constants derived from `so101.xml` joint ranges**: arm joints `lerobot = 100 · (q − mid_j) / half_range_j` (`range_m100_100` mode) or `deg = q · 180/π` (`degrees` mode); gripper `100 · (q − lo) / (hi − lo)`. A unit test maps the Menagerie home pose to the LeRobot values documented in `docs/HARNESS.md`. The README's first instruction is still to check calibration against the real arm.

### 5.8 Recording `torquelimit.episode/2`

The recorder is on by default for every match. **Nothing is ever rounded**: float32 columns stay float32 bytes, float64 columns stay float64 bytes.

**Row convention.** Row *i* is control tick *i*. `observation.*` is sampled after the last physics step of tick *i* − 1 and **before** any ctrl write of tick *i*. `action.{seat}` is the applied target **in effect over [tᵢ, tᵢ₊₁)**. For human and proxy seats, whose ctrl changes every step, `action` is the ctrl at the first step of the tick, and the full per-step ctrl is in `sim.ctrl` (below).

**Per-tick columns:**

| Column | Type | Notes |
|---|---|---|
| `timestamp`, `frame_index`, `episode_index`, `index` | float64, uint32, uint32, uint32 | `timestamp` = sim time |
| `round`, `phase` | uint8, uint8 | phase code in `MATCH_PHASES` order |
| `discontinuity` | uint8 bitfield | 1 engine reset · 2 cube teleport · 4 servo profile change · 8 variant event |
| `observation.{block}.{atlas,blaze}` | float32[n] | blocks per 5.4: `state` 12, `self_ext` 32, `opponent_state` 28, `game` 16, `environment_state` 81, `contacts` 20 |
| `observation.delivered.{block}.{seat}` | float32[n] | what the policy actually received after the delay line; only written when `fairDelayMs > 0` for that seat |
| `action.{seat}` | float64[6] | applied target |
| `action_raw.{seat}` | float64[6] | the returned target, written **on the arrival row**; NaN on other rows |
| `policy.request_frame_index.{seat}` | int32 | on arrival rows: the row whose observation was sent; −1 otherwise |
| `policy.obs_frame_index.{seat}` | int32 | on every row: the source row of the observation that produced the action in effect; −1 while holding a safe pose or for humans |
| `policy.chunk_id.{seat}`, `policy.chunk_index.{seat}` | int32, int16 | executed chunk and entry; −1 if none |
| `intents.{seat}` | uint8 | guard 1, charge 2, grip 4, overdrive 8, ability 16, burst 32 (as accepted by rules) |
| `policy.status.{seat}` | uint8 | ok 0, held 1, late 2, timeout 3, clamped 4, error 5, slow 6 |
| `policy.compute_ms.{seat}` | float32 | decision ticks; NaN otherwise |
| `human.command.{seat}` | float32[6] | pre-shaping command (ψ, θ, r, φ, ρ, g); human/proxy seats only |
| `human.shaping.{seat}` | uint8 | leash_active 1, guard_blend 2, jab_macro 4, charge_windup 8, grab_assist 16, dock_magnet 32, aim_assist 64 |
| `human.display_latency_ms` | float32 | input sample → presented frame, via `requestVideoFrameCallback` (NaN in Node) |

**Per-step streams** (physics-step indexed; this is what re-simulation consumes):

| Stream | Encoding |
|---|---|
| `sim.ctrl` | run-length: `(step uint32, ctrl float64[nu])` written only when any actuator's ctrl changed |
| `sim.intents` | run-length: `(step uint32, atlas uint8, blaze uint8)` when either changed (Arcade scoring needs per-step intents) |
| `sim.mutations` | every non-action state change with its step index: `reset {seed, round, SimState}` · `place_cube {index, pos}` · `servo_profile {seat, kp[5], kv[5], forcerange[5]}` · `timestep {dt}` · `variant {id, event}` · `offline {seat}` |
| `sim.checkpoints` | every 50 control ticks: `(step, SimState)` with the full `SimState` (qpos, qvel, ctrl, qacc_warmstart, servo) and `checksum` |

- **Events:** every `GameEvent` (11.2) with its `step`, plus stats-only detector events (`attack_onset`, `whiff_detected`, `feint_detected`, `reaction`).
- **Images:** when a seat has `images`, each camera is encoded with WebCodecs (`VideoEncoder`, VP9 or H.264, one keyframe per second) at the decision rate and stored as a container entry `video/<seat>.<camera>.webm` with a per-frame `frame_index` table.
- **Meta:** format, episodeId, created, `controlHz`, `timestep`, seed and substream ids, `preset`, physics mode, timing, decimation, action delay, `fairDelayMs`, strict limits, arena variant, seats (driver, name, tier/personality, `policySha256` for app-hashed modules, `claimedSha256` and `provenance` object for bridges, `policyDeterministic`, `chunkExecute`, images), `inputShaping` summary, rules, **the full tuning table** plus `tuningSha256`, `servoParamsHash`, stats tolerance constants (5.10), `parentEpisodeId`, `branchFrame`, `policyState`, result, and provenance (MuJoCo version, SHA-256 of the model file actually loaded and of `so101.xml`, `NEXT_PUBLIC_GIT_SHA`, user agent, contracts version, obs schema hash).
- **File:** `.tlep` = gzip( 4-byte magic `TLE2` · u32 header length · header JSON (meta, column directory with dtype/shape/offset, sparse data, events) · raw little-endian column buffers · video entries ). Serialization and compression run in `src/game/harness/episode-codec-worker.ts`, receiving the column `ArrayBuffer`s by transfer, so the main thread never blocks at match end. **Plain JSON** (`.tlep.json`, float64 as 17 significant digits, float32 as 9) is an export option only.
- **Size gate:** a 3-round, 45 s-per-round Arcade episode with a human seat and no images is ≤ **12 MB** as `.tlep`; the recorder adds ≤ 0.3 ms per control tick.
- **Storage** (IndexedDB `torquelimit`):
  - `episodes_human`: any episode with a human or proxy seat. **Never auto-evicted.**
  - `episodes`: other episodes, cap 1 GB. When a save would exceed the cap, the Replays screen shows **WILL EVICT N** and asks before evicting the oldest unpinned ones.
  - Browser **RUN SUITE** keeps stats plus events only unless **KEEP EPISODES** is ticked.
  - The Replays screen shows a storage meter and **EXPORT HUMAN DEMOS**, which writes every human episode as a LeRobot-ready bundle into a directory through the File System Access API (fallback: one download per episode).
- **Round replays** don't need the file. A **moment buffer** holds the last 6.0 s of `SimState` at 50 Hz.

**LeRobot export** (`tools/export/to_lerobot.py episode.tlep --seat blaze --out ./ds`):
- **One LeRobot episode per round**, containing only `fight` and `sudden_death` rows. Timestamps restart at 0 and are monotonic per exported episode.
- **Features:** `observation.state` = `state[0:6]` (joint positions) in `--units rad|degrees|range_m100_100` (gripper 0–100 in LeRobot units); `observation.velocity` = `state[6:12]` with `--with-velocity`; `observation.opponent_state`, `observation.game`, `observation.environment_state` (opt-in with `--with-game`); `observation.images.wrist|overhead|front` from the video entries; `action` (6, same units); `next.done` (true on the last row of the round); `next.reward` = Δ(damage dealt − damage taken)/100 per row, plus ±1 on the terminal row; `phase`, `discontinuity`; `task` string, e.g. `"duel vs BACKLASH Pro · harness"` or the task name for 5.11 tasks.
- **Alignment:** `--align decision` (default) pairs each `action_raw` with the delivered observation of its `policy.request_frame_index` row; `--align applied` pairs row observations with `action`.
- **fps** = `controlHz`. Recording at 30 Hz needs the 1/600 s timestep (4.10); the exporter never resamples silently.
- **Refuses** Arcade episodes unless `--allow-arcade`, and writes `physics_mode`, `preset`, `timestep`, `servo_params_hash`, `input_shaping`, `fair_delay_ms`, and `source_episode_id` into `meta/info.json`.
- Calls `LeRobotDataset.create`, `add_frame(frame, task=…)`, `save_episode`, then `finalize()`. The exact `lerobot` version is pinned in `tools/export/requirements.txt` and recorded in `docs/HARNESS.md`.

### 5.9 Replay

1. **Kinematic replay** (always exact): for each frame, `restoreState` writes the nearest checkpoint or recorded body state and calls `mj_forward`. Two restores per render frame (k and k+1) feed interpolation.
   - The director calls `engine.saveState()` before entering any replay phase or the replay viewer and `restoreState(saved, "both")` when it leaves, so the live end state (e.g. a slumped Offline arm in `outro`) is never lost.
   - While a replay drives the engine, `clock.setExternalDrive(true)` stops sim-driver stepping, and the player sets `clock.setRenderAlpha(a)`.
   - Controls: scrub, 0.25× / 0.5× / 1× / 2× / 4×, frame step (, / .), event markers on the timeline (strike ticks in the attacker's team colour, guard ink, deflect cyan, whiff hollow, fault hazard-striped).
   - Clicking a marker jumps to 1.0 s before the event.
   - Cameras: broadcast, either cockpit, free orbit.
   - Overlays: target ghost (`sim.ctrl`) per seat, `policy.debug` "brain" panel (state, primitive, phase, top 5 utilities, mood bars, DDA k, parry guess), per-joint action-vs-actual plot (last 3 s), contact force sparkline.
2. **Physics re-sim** (verification): restore the first `reset` mutation's `SimState`, then for every physics step apply that step's mutations, write `sim.ctrl` and `sim.intents`, `mj_step`, run `rules.step` with the recorded preset and tuning, and compare checksums at every checkpoint and regenerated events against recorded events. Result: **REPLAY VERIFIED · BIT-EXACT** or **DIVERGED AT t = 12.34 s (frame 617)**. Because ctrl is recorded per step, **episodes with human seats verify too**; the badge verifies physics and rules, not the human.
3. **Take over:** pause at frame k and play on as a human against the recorded opponent's live policy.
   - The opponent policy is **fast-forwarded**: reset with the recorded `ResetContext`, then fed the recorded **delivered** observations from frame 0 to k with its outputs discarded; for policies marked deterministic, every output is asserted equal to the recorded `action_raw`.
   - The engine restores the checkpoint at or before k and re-simulates to k.
   - The new episode records `parentEpisodeId`, `branchFrame = k`, and `policyState: "replayed" | "replayed_mismatch" | "cold"` (`cold` when the driver can't be fast-forwarded, e.g. a bridge that rejects warm replays).
   - Or play against the replayed trajectory.
4. **Compare** (Replays screen, two episodes with the same seed and opponent): frame-aligned per-joint applied-action difference plot, the first divergence frame (first row where `action` differs by > 1e-9 or a checkpoint checksum differs), and both event timelines stacked. Computed by `src/game/harness/compare.ts`.

### 5.10 Stats (`src/game/harness/stats.ts`)

Stats are a pure function of the episode **and consume recorded events**; damage, deflects, and heat are never re-derived, so a newer `tuning.ts` can't silently change archived numbers. The tolerance constants used are written into meta.

#### 5.10.1 Per seat, every preset (physical block, invariant to intents)

| Metric | Definition |
|---|---|
| Result | round wins, match W/L, reason per round |
| Physical damage dealt / taken | Σ `raw × zone × tool` over strikes and grazes (the `physical` profile, computed from recorded strike events) |
| Optics impulse | Σ contact normal impulse (efc force × dt) on the opponent `camera_mount` |
| Approach speed at contact | median and p90 of attacker `vN` over strikes |
| Strikes / grazes landed and taken | event counts |
| Crits | strikes on `camera_mount` |
| Attack attempts | `attack_onset` count: opponent-directed EE velocity component toward the victim's guard volume (5.5.3) > 0.35 m/s for ≥ 40 ms, debounced 150 ms |
| Accuracy | strikes / attempts |
| Physical block rate | attempts received that ended with no strike on the victim within 400 ms / attempts received |
| Reaction latency | For each opponent `attack_onset` at t₀: the first t within 800 ms where the defender's **measured** EE velocity changes by ‖Δv‖ > 0.25 m/s from its value at t₀ in a threat-reducing direction (increasing the predicted minimum distance, over a 0.3 s horizon, between the attacker EE ray and the defender's guard volume). Reported raw and **net of structural latency** = decision period + actionDelayTicks × control period + fairDelayMs (+ perception lag for `builtin`, + `display_latency_ms` median for humans). Median, p10, p90, n. **Anticipation** = raw latency < structural latency + 100 ms. None within 800 ms = **no reaction**. |
| Core | lock-in time held, pries, late pries, locks |
| Decision compute | `compute_ms` median / p99 / max; `slow` count (eval) |
| Reliability | late, timeout, error, clamped fractions of decision ticks. Reliability = 1 − Σ. |
| Joint-limit violations | clamps with overshoot > 1e-5 rad per joint; max overshoot |
| Near-limit dwell | fraction of ticks with any \|q − limit\| < 0.03 rad |
| Torque saturation | fraction of ticks with any \|τ\| ≥ 0.98 × **2.94** N·m (stock reference) |
| Action jerk | on the applied ctrl resampled to **h = 20 ms** for every seat type (per-tick mean of per-step ctrl for humans): `sqrt(mean ‖(a[k+1] − 3a[k] + 3a[k−1] − a[k−2]) / h³‖²)`, rad/s³ |
| Action chatter | sign changes of Δa per joint per second on the same 20 ms series, counting only \|Δa\| > 0.01 rad |
| Smoothness (LDLJ) | `−ln((T³/v_peak²) ∫‖d²v/dt²‖² dt)` of the measured EE path per attack, averaged |
| Energy | Σ\|τ·qd\|·dt (J) |
| Table hits / self-collisions | `arm_table` onsets with force > 3 N; own-link contact onsets |
| Determinism | verified / diverged at frame N / not checked |

#### 5.10.2 Arcade block (only for Arcade episodes)

Scored damage, guarded chips, deflects and hard deflects, late guards, whiffs and whiff punishes, heat mean and cutouts, staggers dealt and taken, bursts, heavy attempts and heavy success (heavy-tagged strike landed unguarded and not deflected).

#### 5.10.3 Aggregates

- **The seed is the unit.** A suite's per-seed score is the mean result over its cells for that seed. Win rate is reported with a **bootstrap 95% CI over seeds** (10,000 resamples) and the effective n (number of seeds), e.g. "63% (54–71) · 50 seeds".
- **Rating:** Bradley–Terry with **one anchor**, Contender DEADBAND = 1200. All other entrants (including each tier × personality) are fitted (MM iterations until Δ < 1e-6, max 500), with bootstrap-over-seeds CIs. There are no draws (2.4).
- **CLI regression gate:** `node scripts/eval.mjs --suite gauntlet-v2 --policy a.mjs --baseline results/b.json` runs a **paired** comparison per seed (paired bootstrap of per-seed score differences, one-sided, `--alpha` default 0.05) and exits 1 on a significant drop. Timeout and violation checks are **rate-based**: fail if the rate rises by more than max(0.5 percentage points, 2× the baseline rate). The gate **refuses to compare** (exit 2) when `modelSha256`, `tuningSha256`, MuJoCo version, suite id, or contracts version differ, unless `--force-compare`, which prints the mismatches in the output.
- **CLEARED FOR BROADCAST** (stock presets only) when all hold: 0 errors; 0 timeouts (live) or 0 hangs (eval); late fraction < 2%; violations (overshoot > 1e-5) = 0; table hits > 3 N < 5; determinism verified when checked. Otherwise **POLICY FAULT** with the first failing reason. Arcade model reports show the **ARCADE PHYSICS · NOT VERIFICATION** sticker instead.

#### 5.10.4 Suites

| Suite | Content | Where | Gate (nightly on the server, 12.1) |
|---|---|---|---|
| `smoke-v1` | seeds 1–3 × Contender × both seats (6 matches), Harness, eval | CI | exit 0 |
| `gauntlet-v2` | seeds 1–50 × {OVERSHOOT, BACKLASH, DEADBAND} × {Contender, Pro, Champion} × both seats = **900 matches**, Harness, eval, DDA off, best of 1 | nightly | reports; balance gates below use the builtin-vs-builtin variant |
| `balance-v2` | builtin vs builtin, all personality pairs at Pro, 50 seeds, **Arcade** | nightly | pair win rates 35–65%; median round 25–35 s; KO share 45–70%; sudden death < 15%; **pries in ≥ 30% of rounds that reach a lock-in** |
| `exploits-v1` | each exploit proxy bot (5.5.7) vs each personality at Contender, 30 seeds, Arcade; plus a round robin among the bots | nightly | **no bot wins > 55%** vs Contender (pooled over personalities); **no bot beats every other bot** (> 50%) |
| `core-race-v1` | `human_proxy` vs each personality at Contender, 50 seeds, Arcade; rounds start at the Core drop with combat damage off; first lock wins | nightly | human proxy wins **40–60%** |
| `heavy-v1` | `heavy_mixer` vs Contender, Pro, Champion, 30 seeds each, Arcade | nightly | heavy success **30–60%** at every tier; AI heavy parry success ≤ tier cap + 5 pp |
| `tasks-v1` | the 5.11 tasks × 20 seeds, Harness | browser or CLI | reports only |

### 5.11 Verification tasks (non-combat, same arena)

Pick-and-place policies can be verified before they're asked to fight. Rules live in `src/game/combat/task-objectives.ts` (WP2), task configs in `src/game/harness/suite.ts` (WP5), and the director runs them as `MatchConfig.task` (WP1). Every task uses a stock preset and emits `task` events (`start`, `success`, `fail`, with a score).

| Task | Setup | Success / score |
|---|---|---|
| `dock_core` | Core placed at a seeded position in the policy's half (reachable); opponent seat is JIG `idle`; 20 s | Core docked and 3.0 s of lock-in held; score = time to first dock |
| `stack` | `cube_0` and `cube_2` on the mat at seeded positions; 30 s | `cube_0` resting on `cube_2` (z within 5 mm of 0.06, XY within 1.5 cm) for 1.0 s |
| `keep_away` | policy holds the Core; a scripted opponent (`JIG` behaviour `chase`) sweeps its gripper toward the Core; 20 s | score = fraction of time with no opponent gripper contact on the Core or the policy's hand |

---

## 6. Art direction

### 6.1 Look in one paragraph

**Late afternoon in a maker space.** A birch-ply workbench under two warm clamp lamps, cool window light from the left, a pegboard of tools behind. In the middle of the bench, a dark charcoal ESD mat marked with gaffer tape: that's the ring. Two 30 cm printed arms, one paper-white with a cobalt hand, one ink-dark with a magenta hand. People crowd in around the bench, huge and soft out of focus, a few holding up phones. Everything that matters in a fight (hands, sparks, the Core, the docks) is judged against the **dark mat**, so it reads. Only LEDs, sparks, and the charge glow emit light. The mess is physical: cubes stay where they land and tape gets scuffed. Between rounds a shutter cut resets the bench.

### 6.2 Palette tokens (`src/app/globals.css` and Tailwind 4 `@theme`)

```css
:root {
  /* neutrals: surfaces and structure, never gameplay meaning */
  --ink-900:#0E0F14;  --ink-700:#1C1F29;  --ink-500:#3A3F4D;
  --paper-50:#F6F3EC; --paper-200:#E6E0D3;
  --mat-800:#2A2C33;  --birch-300:#D8C3A0; --steel-400:#9AA0A8;
  /* the seven semantic colours (6.2.1) */
  --ink:#0E0F14;                                        /* text on light, structure, outlines */
  --paper:#F6F3EC;                                      /* text on dark, structure, outlines */
  --cobalt:#2A6BFF;  --cobalt-300:#8DB4FF;              /* PILOT team (tint = same meaning) */
  --magenta:#FF2E7E; --magenta-300:#FF9CC3;             /* AI team (tint = same meaning) */
  --prize:#FFD60A;                                      /* the Core, docks, lock-in. Nothing else. */
  --hit:#FFFFFF;                                        /* a landed hit: always white-hot core + ink edge */
  --deflect:#3DE0FF;                                    /* a deflect. Nothing else. */
  --slant: <measured, 6.3>;  --slant-k: <tan(slant)>;
  --safe:4vmin;
}
:root[data-colorblind="true"] { --magenta:#F2C200; --magenta-300:#F8DC6A; --prize:#FFFFFF; }
@theme {
  --color-ink-900:#0E0F14; --color-ink-700:#1C1F29; --color-ink-500:#3A3F4D;
  --color-paper-50:#F6F3EC; --color-paper-200:#E6E0D3; --color-mat-800:#2A2C33;
  --color-cobalt:#2A6BFF; --color-cobalt-300:#8DB4FF; --color-magenta:#FF2E7E; --color-magenta-300:#FF9CC3;
  --color-prize:#FFD60A; --color-hit:#FFFFFF; --color-deflect:#3DE0FF;
  --font-display: var(--font-archivo), "Arial Narrow", sans-serif;
  --font-ui: var(--font-archivo), "Arial Narrow", sans-serif;
  --font-mono: var(--font-chivo-mono), ui-monospace, monospace;
}
```

#### 6.2.1 Semantics table (copied into `STYLES.md`, enforced in review and by `hud-format.test.mjs`)

| Colour | One meaning | Never used for |
|---|---|---|
| ink | text on light surfaces, structure, the outline of every HUD stroke | warnings by itself |
| paper | text on dark surfaces, structure, the outer outline of reticle strokes | hits |
| cobalt | the PILOT team | buttons, warnings, the Core |
| magenta | the AI team | buttons, warnings, damage taken by colour alone |
| prize | the Core, the docks, the lock-in countdown | highlights, stickers, heat, final-round text, entrant accents |
| hit | a landed hit (spark core, hit tick, damage number fill) | UI chrome; always drawn with an ink edge |
| deflect | a deflect | guard, UI focus, anything else |

- **Danger, contested, fault** are expressed by **hazard stripes** (ink/paper, −45°, 10 px), pulsing, and shape, not by an extra hue.
- **Crits** are distinguished by size, shape (four outward ticks), and the crit sound, not by a colour.
- **The charge telegraph** is the owner's team colour pushed to HDR with a 4 Hz pulse from c ≥ 0.25.
- **Colourblind mode** (`data-colorblind`): the AI team becomes `#F2C200` (a blue-yellow pair with cobalt), the prize becomes white with a dashed tape ring, and hits keep their streak shape. Verified with a deuteranopia/protanopia/tritanopia simulator screenshot pass (WP7 acceptance).
- **Per-frame budget:** neutrals, one team colour per half of the screen, and at most one semantic accent. Hit colour appears for < 700 ms.
- Text on team colours: paper only, ≥ 18 px bold. Text on prize, hit, deflect: ink.

### 6.3 Typography (`next/font/google`, self-hosted at build)

One variable superfamily so display and UI share DNA:

| Role | Family and axes | Use |
|---|---|---|
| Display | **Archivo** italic, `wdth 62`, `wght 900` (ExtraCondensed Black Italic) | Title cards, KNOCKOUT, round numbers, wordmark. Line height 0.86. **Never faux-skewed.** |
| UI / HUD | **Archivo**, `wdth 87.5` (SemiCondensed), `wght 600–800`, roman for labels, italic for numerals and plates | Plates, labels, numerals, buttons, captions. `font-variant-numeric: tabular-nums` on every counter. Labels: 650, uppercase, tracking +0.06em. |
| Machine truth | **Chivo Mono** 400, 700 | Policy chips, physics numbers in the Lab and Tab stats, seeds, hashes |

- **THE slant** is Archivo Italic's measured `post.italicAngle`, read once by `scripts/measure-font-slant.mjs` (WP7) from `public/fonts/Archivo-Italic[wdth,wght].ttf` and written into `globals.css` as `--slant` and `--slant-k`. Plates, cuts, stripes, and wipes use `--slant`. There is no other angle in the UI except the hazard stripe (−45°), and no `skewX` on text.
- **No Unicode symbols** (◆ ▸ ● ○ ▰ ✕ etc.) anywhere: every icon is inline SVG in `src/game/ui/kit/glyphs.tsx`, sized to the text's cap height.
- **Outlines** on type only at ≥ 64 px; below that, text is a solid knockout.

**HUD type scale** at 1080p (scale with `clamp(…, calc(X/1080*100vh), …)`):

| Token | Spec |
|---|---|
| `display-xl` | 160 px Archivo wdth 62 wght 900 italic |
| `display-l` | 96 px, same |
| `num-xl` | 64 px Archivo wdth 87.5 wght 800 italic, tabular |
| `num-m` | 36 px, same |
| `plate` | 28 px Archivo wdth 87.5 wght 800 italic, caps |
| `label` | 13 px Archivo wdth 87.5 wght 650, caps, +0.06em |
| `mono` | 12 px Chivo Mono |

### 6.4 Shape language

- One slant: `--slant`. Plates are parallelograms (`clip-path` with `--cut = h × --slant-k`).
- Notched tags have a 10 px corner clip.
- **Stamps** (VS, SCOUTED, CLEARED, NEW PB): flat ink or paper fill, 2 px border in the opposite neutral, rotated by −`--slant`/3, **no drop shadow, no foil**.
- **Hazard stripes** mean danger, contested, or fault. Nothing else.
- **Anodized sheen** (winner card, CLEARED stamp background): a flat 2-stop `linear-gradient(180deg, var(--ink-700) 0%, var(--ink-500) 100%)`.
- **Layering:** a 4 px lip in team colour on the leading edge, an ink body, paper text.
- Every HUD cluster sits flush against the 4vmin safe edge.

### 6.5 Lighting recipe (three 0.185 / R3F 9)

| Light | Type | Colour | Intensity | Placement |
|---|---|---|---|---|
| Window (key) | `DirectionalLight` | `#EAF1FF` | 2.2 (calibrated below) | From the left window, elevation 50°, azimuth along world +y so neither seat is backlit. `castShadow`, 2048² map (1024² LOW), ortho ±1.4 render units, `bias −0.0003`, `normalBias 0.015`. `renderer.shadowMap.autoUpdate = false`; the main render sets `needsUpdate = true` once per frame. |
| Clamp lamp × 2 | `SpotLight` | `#FFD7A8` | 10 cd, decay 2 | On the bench's rear edge, one aimed at each half of the mat. Angle 0.55, penumbra 0.8, no shadow. |
| Room fill | `HemisphereLight` | sky `#DDE6F2`, ground `#5E513F` | 0.5 | n/a |
| Hit flash | `PointLight` (one pooled instance) | `--hit` or `--deflect` | 0 → 2.5 → 0 over 90 ms | at the contact point, distance 0.7, decay 2 |

- **Environment:** drei `<Environment resolution={256} frames={1}>` from `<Lightformer>`s: a window rect `#FFFFFF` at 1.5 on the left, two warm lamp discs `#FFD7A8` at 1.0 above the bench, and a dim `#3A3F4D` ceiling plane. It replaces any RectAreaLight (there is none). `scene.environmentIntensity = 0.6`. No HDR files.
- **Fog:** `THREE.Fog("#C9C3B8", 3.5, 14.0)` render units, to push the room back.
- **Tone mapping and exposure (calibrated, not guessed).** The composer ends with tone mapping; WP6 renders the `?debug=greycard` scene (an 18% grey card, a paper card, and a mat swatch on the bench under the recipe) with both `AGX` and `NEUTRAL`, adjusts light intensities and exposure so that the **grey card reads 0.46 ± 0.02** display value, the **brightest lit paper/birch ≤ 0.75**, and the **mat ≈ 0.10–0.14**, picks the operator with the better highlight roll-off on the shells, and records the chosen operator, exposure, intensities, and the three measured values in `STYLES.md` and `quality.ts`.
- **Bloom** is global mipmap bloom on HDR input with `luminanceThreshold` **2.8** and smoothing 0.2. Emissive sources (LEDs, spark cores, charge glow, phone screens) are authored at **×6 to ×10**; lit surfaces sit below 1.0 after calibration. `?debug=greycard` also reads back max pre-tonemap luminance over bench, mat, and shells in a lit idle frame and fails if it's ≥ the threshold.
- **Static set lighting is baked once:** `scripts/bake-set.mjs` (WP6) computes per-vertex ambient occlusion and a single-bounce warm tint for the bench, mat edges, props, and pegboard by raycasting the static layout in Node (three.js `Raycaster`, no WebGL), and writes `public/models/set/*.bin`. The set never moves.
- **Contact grounding on every tier:** `blob-shadows.ts` draws instanced soft ellipse decals under every cube, both arm bases, and both grippers (radius and opacity by height above the mat), so nothing floats even with N8AO off.
- **No night variant in v1.** A future lighting story (e.g. "after hours": one clamp lamp and a monitor glow, same tone mapping) is a separate, screenshot-reviewed deliverable.

### 6.6 Set dressing: Bench One (real human scale)

All dressing is **visual only**. Units are sim metres (render = × 2.05). The robots are 30 cm desk arms; everything else is life-size, which is the joke and the identity.

| # | Element | Spec |
|---|---|---|
| 1 | **Bench top** | Birch plywood 1.60 × 0.90 m, top surface at z = 0 (the MJCF floor stays the collision plane). `MeshStandardMaterial` `--birch-300`, roughness 0.7, procedural triplanar grain, baked AO. |
| 2 | **Fight mat** | Charcoal ESD mat 0.84 × 0.54 m centred, 2 mm proud, `--mat-800`, roughness 0.8, a 5 cm grid printed in `--ink-500` at 1 mm, a grounding snap in one corner. Everything within 0.30 m of the midline is judged against this dark ground. |
| 3 | **Tape marks** | Docks: prize-colour gaffer tape annulus, 19 mm wide, at `DOCK_RADIUS` around each dock centre, with slightly lifted torn ends. The drop point: a paper-tape X. Seat edges: a strip of cobalt tape along the atlas short edge, magenta along the blaze edge. Drawn into one 2048 × 1316 canvas texture at load (`deck-texture.ts`), `polygonOffset −1`. |
| 4 | **Core hopper** | A clear acrylic funnel on a bent aluminium stand arching over the mat, mouth 0.22 m above the drop point. On incoming, a small paper tag on it flips three times; at the drop, a recorded latch click. |
| 5 | **Clamp lamps** | Two, on the rear edge, aimed at each half (6.5). |
| 6 | **Broadcast phone** | A phone on a mini tripod at the bench's front-right corner. Its dark screen shows a small REC dot. It is the `broadcast` camera's position. |
| 7 | **Laptop** | Behind the opponent, at (0.55, 0.30, 0), lid at 110°. Its screen shows a 512 × 288 render target at **15 Hz** (the replay camera between rounds, the tote board during fights), rendered on layer 2 with no shadow update, no bloom, no crowd, and LOD1 arms. |
| 8 | **Bench clutter** | Static baked meshes: a filament spool, digital calipers, a mug, hex keys, a small STS3215 box, printed brackets, a roll of tape. |
| 9 | **Room** | Pegboard wall with tools 1.1 m behind the bench, a window to the left at 30° with soft daylight, ceiling cable trays. |
| 10 | **Crowd** | **14 people** as camera-facing cards 0.6–1.6 m from the bench edge, heads 0.45–0.75 m above the bench top, some leaning on the bench. Silhouettes are painted procedurally at load into a 2048² atlas (head-and-shoulders shapes, muted clothing in neutrals, never team colours) and **pre-blurred** on every tier. Idle sway 0.2–0.4 Hz. Six hold phones up with small emissive screens (paper × 6). Hype drives lean-in (3 cm × hype) and swaps two arms-up poses on KO and late pry. On HIGH the cockpit view adds a half-res `DepthOfField` pass for the props; LOW and DEFAULT rely on the pre-blur. |
| 11 | **Clutter cubes** | Printed PLA, `--paper-50`, `MeshStandardMaterial` roughness 0.55 with triplanar print lines. |
| 12 | **Core** | Printed PLA in `--prize` with a black tape stripe. While live, a thin emissive seam at ×1.5 (below bloom threshold). |

**Physical mess, nothing more:**
- Strike scuff decals (pooled 64): pale `#6A6D75` tape scuffs on the mat at contact points under 2 cm height.
- Cubes stay where they land.
- KO: the loser's servo LEDs die (8.3). Nothing shatters.
- **Bench reset** at `round_intro`: a 250 ms dip to ink with a recorded camera shutter click; the engine reset happens under the dip.

### 6.7 Robot materials and colorways

**Render meshes:** `scripts/bake-meshes.mjs` (10.6) bakes the STLs into indexed, crease-normal (35°) meshes at LOD0, LOD1 (35%), and a shadow LOD (15%), and adds two vertex attributes: **curvature** (signed mean curvature per vertex, normalized; edge mask) and **AO** (hemisphere raycast within the part). The manifest records each part's **print axis** (the axis of its largest flat face, which is the printed base).

**Mesh → material slot** (by `so101.xml` mesh name):

| Slot | Meshes |
|---|---|
| `shell_body` | `base_so101_v2`, `rotation_pitch_so101_v1`, `upper_arm_so101_v1`, `under_arm_so101_v1`, `motor_holder_so101_base_v1`, `base_motor_holder_so101_v1`, `waveshare_mounting_plate_so101_v2` |
| `shell_hand` | `wrist_roll_pitch_so101_v2`, `motor_holder_so101_wrist_v1`, `wrist_roll_follower_so101_v1`, `wrist_roll_follower_so101_gripper_part0_v1`, `moving_jaw_so101_v1`, `moving_jaw_so101_gripper_part0_v1`, `moving_jaw_so101_gripper_part1_v1` |
| `optics` | `wrist_roll_follower_so101_camera_mount` |
| `servo` | `sts3215_03a_v1`, `sts3215_03a_no_horn_v1` |

**Shell shader** (`MeshStandardMaterial` + `onBeforeCompile`, shared by body and hand; the hand adds clearcoat 0.3 via `MeshPhysicalMaterial`):
- a triplanar **0.2 mm print-layer normal** along the part's print axis, amplitude 0.15;
- roughness breakup from a low-frequency noise (0.42 ± 0.06);
- **edge highlight and wear** from the curvature attribute: convex edges lighten 8% and lose 0.1 roughness; with wear on, the colour lerps 12% toward a raw PLA tone on sharp edges;
- baked AO multiplied into ambient.

**Decals** (`src/game/render/robot-decals.ts`): a procedural canvas atlas drawn at load (servo ID labels `ID 1`–`ID 6`, Phillips screw heads, calibration witness marks, a small TORQUE LIMIT sticker on the base) placed as mesh-local projected quads from a fixed table per link.

**Colorways:**

| Slot | PILOT (Cobalt) | RIVAL (Magenta) | USER MODEL |
|---|---|---|---|
| `shell_body` | `--paper-50` | `--ink-700` | `--ink-700` |
| `shell_hand` | `--cobalt` | `--magenta` | `--magenta` |
| `optics` | `--ink-900` with a lens ring emissive `--cobalt-300` × 6 | `--ink-900`, ring `--magenta-300` × 6 | same as rival |
| `servo` | `--ink-700`, roughness 0.55, emissive **servo LED** decal in team colour × 6, brightness = clamp(\|ctrl − q\| / 0.6, 0.08, 1) | same, rival LED | same |
| Upper-arm stripe | none | entrant ink bands (5.5.6) | a paper band with the file name's first 3 letters |

- **Readability:** the pilot is light-bodied, the rival dark-bodied; hands carry the team colour against the dark mat.
- **Rival rim:** an `onBeforeCompile` fresnel term on the rival's shells: `emissive += team × pow(1 − N·V, 3) × 0.5`.
- **Own heat strip:** an emissive strip on the pilot's `upper_arm` shell in the lower cockpit frame: team colour at 0 heat, ramping to `--paper` at 70, then pulsing ink/paper hazard stripes (a shader stripe mask) toward 100 and in Cutout.
- **Charge glow** (public from c ≥ 0.25): the hand emissive in the **owner's team colour** at × (2 + 8c) with a 4 Hz pulse.

### 6.8 VFX list (owner: `src/game/render/vfx/`, WP6)

All VFX are pooled and allocate nothing per frame. They're driven only by `GameEvent`s and never write to MuJoCo. Every effect must read on both the dark mat and the light bench: WP6 acceptance includes a **≥ 3:1 luminance contrast** check of spark pixels against the local background at the midline on DEFAULT (12.2).

| Effect | Build | Colours | Life | Pool |
|---|---|---|---|---|
| Strike sparks | instanced velocity-aligned **streaks**, **alpha-blended** (not additive): an ink outer edge (alpha 0.8) and an HDR white core (`--hit` × 8), gravity 9.8 m/s², count 6 + 30·m | hit, ink | 160–300 ms | 512 |
| Graze tick | 3 short streaks, core × 3, no light | hit, ink | 120 ms | 16 |
| Crit burst | sparks × 1.6 larger, plus 4 print flakes (paper or team chips) and a 1-frame flash disc | hit, ink, team | flash 60 ms, flakes 700 ms | 8 |
| Guard ripple | hex-grid ring quad on the contact normal, 0 → 0.06 m, **ink body with a paper edge** | ink, paper | 220 ms | 8 |
| Deflect burst | 6-wedge chevron ring plus cyan-core streaks with ink edges, plus a rim flash on the attacker arm (fresnel × 4 in deflect) | deflect, ink | 300 ms | 4 |
| Clash | radial fan of 12 white-core streaks with ink edges plus a thin ring | hit, ink | 250 ms | 4 |
| Contact puff | 4 small dust quads | `#8A8F99` at 60% | 200 ms | 32 |
| Gripper smear | per arm, the last 8 interpolated gripperframe positions as a camera-facing strip, team colour × 2 with an ink edge, visible when tip speed > 0.9 m/s | team | continuous | 2 |
| Scuff decal | projected quad on the mat | `#6A6D75` | round | 64 |
| Chips | instanced 6 mm print flakes with a ballistic and mat bounce; used by crits and lobby tile breaks | paper, team, prize (tiles) | 1.2 s | 128 |
| Confetti | hole-punch dots thrown in from above camera, flutter noise, match end on a player win | paper, prize | 2.5 s | 300 |
| Overheat haze | heat-haze distortion sprite plus grey puffs at the shoulder servo while heat > 85 or in Cutout | `#9AA0A8` at 40% | loop | 2 |
| Lock pulse | a prize ring expanding 0 → 2 cm on the dock tape at each lock-in tick; a solid prize fill at lock | prize | 300 ms / loop | 2 |
| Blob shadows | 6.5 | ink at 45% | continuous | 24 |
| Bench reset dip | a full-screen ink quad in front of the camera, 250 ms | ink | 250 ms | 1 |
| Hit light | the pooled PointLight (6.5) | hit / deflect | 90 ms | 1 |

---

## 7. HUD and UI

### 7.1 Principles

1. **The HUD is the stream package.** Anchored, calm, and sparse. The bench supplies the chaos.
2. The centre third of the screen holds only the reticle cluster, hit ticks, damage numbers, and at most 2 tags.
3. **At most one full-screen banner at a time.** Banners queue with a 250 ms gap; a queued banner older than 1.5 s is dropped.
4. **The React tree mounts once.** Per-frame values (bars, heat, timer, markers) are written by `src/game/ui/hud/hud-runtime.ts`, whose `update()` is registered with `game.onAfterRender` and runs from WP6's `useFrame` at **priority +2, after the composer renders**, so it uses the same frame's camera and `HudFrame`. There is no separate rAF. It writes `el.style.setProperty('--v', x)`, `transform`, and `textContent`.
5. **The reticle, hit ticks, leash line, and range arcs are drawn in WebGL** (`src/game/render/reticle-overlay.tsx`, WP6), in an orthographic overlay scene rendered after the composer, so the reticle and the arm are always on the same presented frame. DOM keeps plates, timer, captions, banners, damage numbers.
6. HUD motion animates **transform and opacity only**, plus `clip-path` on one element at a time. Nothing eases longer than 500 ms, except count-ups.
7. **Gameplay HUD labels never carry brand text.**

### 7.2 Motion tiers

Every animated element belongs to exactly one tier. The table is copied into `STYLES.md`.

| Tier | Curve | Used by | Never used by |
|---|---|---|---|
| **broadcast** | `--ease-snap: cubic-bezier(.3,0,0,1)`, no overshoot; exits `--ease-exit: cubic-bezier(.6,0,.9,.4)` | plates, tote updates, captions, feed rows, screen wipes, menus, count-ups, the policy chip | KO, lock, match end |
| **impact** | `--ease-impact: cubic-bezier(.2,1.5,.35,1)` (overshoot) | banners for ROUND N, TIME, SUDDEN DEATH, PRIED; hit ticks; damage number pop; the VS split | menus, captions |
| **celebration** | impact curve plus a stamp (rotate −slant/3, scale 1.3 → 1.0) and a 2 px parent shake for 80 ms | KNOCKOUT, LOCKED, VICTORY, NEW PB, SCOUTED, league tier-up | anything that happens more than twice per round |

| Motion | Keyframes | Total |
|---|---|---|
| Banner (impact) | 0: scale 1.6, opacity 0 → 90 ms: scale 0.96, opacity 1 → 160 ms: 1.02 → 240 ms: 1.0. **SFX transient at +90 ms.** | 240 ms |
| Plate slide (broadcast) | translateX ±48 px → 0 over 180 ms `--ease-snap` | 180 ms |
| Stamp (celebration) | rotate −3·slant/3 → −slant/3, scale 1.3 → 1.0 over 160 ms `--ease-impact`, parent shake 2 px 80 ms | 160 ms |
| Count-up (broadcast) | tabular digits roll over 350 ms `--ease-snap` | 350 ms |
| Exit (broadcast) | translateX +40 px, opacity 0, 140 ms `--ease-exit` | 140 ms |
| Stagger siblings | 40 ms apart, max 6 | n/a |
| Screen transition (broadcast) | a wipe cut at `--slant`: ink panel, 200 ms in, 160 ms out | 360 ms |
| Feed row (broadcast) | enter 180 ms, hold 4500 ms, collapse 160 ms | 4840 ms |
| Low integrity | the integrity bar's empty segments show animated hazard stripes (period 700 ms). No full-screen tint. | loop |
| `prefers-reduced-motion` | impact and celebration become 120 ms fades; camera motion and screen effects default to 30% | n/a |

### 7.3 Screens

Every screen shares a full-bleed live 3D background (the bench), a top **show bar** (the wordmark at left in a 44 px ink plate as a solid knockout, and the section title in `plate` type), and a bottom **hint bar** (device-aware SVG button glyphs, `label` type). Screen changes use the wipe.

#### 7.3.1 Boot / loading

- **Background:** flat `--ink-900`. No scrolling stripes.
- **Centre:** the wordmark (`display-l`, solid knockout).
- **Progress bar:** 10 segments, 28 px each, filled paper as loading progresses.
- **Status line:** `mono`, paper at 60%, driven by real stages (`fetching mujoco.wasm · 10.1 MB`, `compiling arena-arcade.xml`, `decoding audio · 38 files`, `warming shaders`, `building audio graph`).
- **Tips:** one-line tips in `label` type, rotating every 4 s, e.g. `FLICK FAST · ARM SPEED IS DAMAGE`.
- **Timing:** minimum display 900 ms. Exits with a wipe to Title.

#### 7.3.2 Title (attract)

- **Background:** the live attract match under the `broadcast` phone camera, crowd hype 0.4, the title music cue.
- **Wordmark:** `display-xl`, stamps in once at 300 ms (celebration tier). No idle pulse, no chromatic effect.
- **Tagline:** *LIVE FROM THE BENCHTOP* in `label`, fades in at 700 ms.
- **Prompt:** bottom centre, `PRESS ANY KEY` in a paper plate. **Steady.** It animates only when an input arrives.
- **Any key, click, or mouse move of ≥ 40 px:** unlocks audio (`AudioContext.resume()`; a mouse move alone can't unlock audio in every browser, so the first key or click in the green room retries), plays the select cue, dollies 180 ms into the pilot arm, then wipes to the Green Room.

#### 7.3.3 Green Room (lobby): a place to play, not a menu

Layout: two thirds live scene on the left, a slanted menu stack on the right.

- **Scene:** engine layout `lobby` (all cubes parked). Only the pilot arm is driven; the blaze seat holds home pose with LEDs dark. Shown through the `lobby` camera. **Your arm follows your cursor:** `green-room.tsx` (WP7) intersects the pointer ray (through `game.view.camera`) with the plane **ego z = 0.15** on `pointermove` and calls `game.pilot.setCursorTarget(egoPoint)`. Idle 3 s → IDLE_SWAY.
- **Menu tiles are real meshes** (`src/game/render/lobby-tiles.tsx`, WP6): thin printed plates (0.07 × 0.04 × 0.004 m sim) standing in an arc at ego x 0.30, y +0.10 → −0.10, z 0.12–0.26, with SDF text from drei `<Text>` using `public/fonts/Archivo-Italic[wdth,wght].ttf`. They are depth-tested, so the gripper passes in front of and behind them correctly. Each tile has a simple box collider checked against the interpolated gripperframe in render space.
  - **Hovering** a tile or its DOM mirror makes the arm point at the tile.
  - **Mouse click:** the arm fires a physical jab at the tile. When the gripperframe enters the tile collider (or after 260 ms), the tile breaks into print flakes from the shared chip pool (6.8) with the stamp cue, and the screen changes 220 ms later.
  - **Keyboard, gamepad, or Enter activation skips the jab:** the tile flashes and the screen changes immediately.
- **Menu stack** (right, flush to the safe edge, each a 64 px ink plate, `plate` type). This DOM stack is the focusable, accessible mirror of the tiles and the source of truth for navigation:
  1. **FIGHT**: Quick Fight with the last entrant, tier, and loadout (default DEADBAND · Contender · Arcade).
  2. **LEAGUE** (7.3.11)
  3. **DAILY** (7.3.12)
  4. **ENTRANTS** (7.3.4)
  5. **LOADOUT**: inline expander of three slanted cards (WHIP / PIVOT / ANVIL) with τ, Integrity, a 3-bar stat, and the ability (hidden before match 3). **Selecting a card re-tunes the lobby arm live.**
  6. **WARM UP**: pointer lock plus free sparring with JIG `sparring`, full HUD. Esc returns.
  7. **THE LAB** (7.3.5)
  8. **REPLAYS** (7.3.6)
  9. **SETTINGS** (7.3.8)
- **Preset chip:** under FIGHT. Against built-in entrants it shows `ARCADE`. Against a user model it is a two-state toggle `ARCADE | PROVING GROUND` (4.10).
- **Callsign plate:** bottom-left, editable inline (12 chars, caps), with the local record `W 12 · L 7` in mono.
- **First launch:** one full-screen choice, **STANDARD COCKPIT** or **STABLE COCKPIT** (3.2), then FIGHT starts the tutorial (7.3.9).

#### 7.3.4 Entrants

- A horizontal carousel of **entrant cards** (320 × 440 px, cut at `--slant`, ink body, team lip; the selected card gets the anodized sheen):
  - portrait: a live 3D thumbnail of the arm in its colorway (256² target at 10 Hz, focused card only)
  - name in `display-l`
  - driver tag in mono
  - archetype and loadout
  - **flaw line**: hidden (`FLAW · UNSCOUTED`) until the player has exploited it once, then stamped **SCOUTED** with the text (e.g. BACKLASH: `BITES ON FEINTS`)
  - **medals** row: 4 SVG pips (CLEAN, PRY, READ, BROWNOUT; 7.3.11), filled per tier won
  - local record against you
  - a **tier selector**: `ROOKIE · CONTENDER · PRO · CHAMPION`
- Cards: JIG, OVERSHOOT, BACKLASH, DEADBAND, then **every registered user model** (the **RIVAL** model has a hazard-stripe lip and its record), then a dashed card **REGISTER ENTRANT** (drop a `.js`, `.mjs`, or `.json`, or click to browse).
- **Registration checks** animate as a checklist, one row per 120 ms, each ending in a stamp, per 5.6. A failure stamps the row with hazard stripes and the fixture index.
- **Bridge card:** `LOCAL BRIDGE` with a URL field (default `ws://127.0.0.1:8765`) and CONNECT. It performs `hello`, then shows the returned policy name, `CLAIMED SHA`, and the provenance fields.
- Registered models persist in IndexedDB (`entrants` store: file text, name, sha256 computed by the app, date, rival flag).

#### 7.3.5 The Lab (harness)

Layout: two seat columns facing each other (ATLAS left, BLAZE right), a centre **Rules** column, results underneath.

- **Seat column:** driver selector (HUMAN · PROXY · BUILT-IN · MODULE · TRAJECTORY · BRIDGE · REPLAY), the driver's own fields, decision rate `50 / 25 / 10 Hz`, chunk execution (`UNTIL NEXT DECISION · FULL CHUNK · N STEPS`, temporal ensemble m), images (`WRIST · OVERHEAD · FRONT`, size), and loadout (Arcade only).
- **Rules column:**
  - `PRESET ARCADE | PROVING GROUND | HARNESS | DEMO` (default Harness; DEMO requires a human seat; HARNESS forbids one)
  - `TIMING LIVE | EVAL` (EVAL disabled when a human is seated)
  - `CONTROL 50 | 30 | 60 HZ` (30/60 switch the stock timestep to 1/600 s; Arcade 50 only)
  - `SEED` (mono input, dice, copy)
  - `ROUNDS 1 | 3 | 5`
  - `ACTION DELAY 0–5 ticks` (default 1)
  - `FAIR DELAY 0–200 ms` (editable only when a human is seated; default 120)
  - `LIMITS STRICT | LENIENT` (default Lenient)
  - `VARIANT` (standard; others flag the result `NON-STOCK LAYOUT`)
  - `RECORD ON`, `KEEP EPISODES` (for suites)
  - `RENDER ON | TURBO` (Turbo only in eval)
- **DEMO session fields:** operator id, input device (auto-filled), sensitivity (auto-filled), notes, assists toggle. All written to meta.
- **Actions:** **FIGHT IT** (human seated), **RUN MATCH** (no human; spectate or Turbo), **RUN SUITE** (`smoke-v1`, `gauntlet-v2`, `tasks-v1`; the nightly Arcade suites are CLI only), **RUN TASK** (5.11), **VERIFY LAST EPISODE**, **CHECK POLICY DETERMINISM**.
- **Results:**
  - Two entrant cards facing each other with win rate, bootstrap CI, and effective n (`63% (54–71) · 50 SEEDS`), record, and rating with CI.
  - Six headline bars: physical damage, strikes, physical block rate, reaction median (net), jerk, reliability.
  - **DETAILS** expander with the full 5.10 tables and CI overlap highlights.
  - Suite heatmap (3 × 3, ink → paper).
  - Result stamp: **CLEARED FOR BROADCAST**, **POLICY FAULT: <reason>**, or **ARCADE PHYSICS · NOT VERIFICATION**.
  - Buttons: EXPORT EPISODE (`.tlep`), EXPORT JSON, EXPORT STATS, OPEN REPLAY, COMPARE.
- **Scope:** bars and the heatmap only; detailed plots live in the replay viewer.

#### 7.3.6 Replays

- A list of stored episodes as slanted rows: date, seats, preset badge, result, duration, CLEARED / FAULT / ARCADE stamp, size, HUMAN tag.
- **Storage meter** (used / 1 GB for non-human episodes; human episodes listed separately as never evicted), **EXPORT HUMAN DEMOS**, and the **WILL EVICT N** confirmation (5.8). Import drop zone.
- **Replay viewer** (full screen): timeline with event markers (5.9), transport, camera switcher (BROADCAST · ATLAS COCKPIT · BLAZE COCKPIT · FREE), overlay toggles (TARGET GHOST · BRAIN · JOINT PLOTS · FORCES), **VERIFY** with progress, **TAKE OVER**.
- **COMPARE** (select two rows with the same seed and opponent): the 5.9 compare view.
- **Brain panel:** right side, ink, mono. **Joint plots:** canvas2D strip at the bottom, 6 rows, recorded ctrl vs q over the last 3 s.

#### 7.3.7 Post-match

- **Left column:**
  - The **result wordmark** VICTORY (team lip, anodized sheen) or DEFEAT (ink).
  - Score pips.
  - **Best of Match**: the player's 3 most extreme superlatives vs local history, each with a count-up and a `NEW PB` stamp. Leads with the best superlative even on a loss.
- **Superlatives:** HARDEST HIT (`IMPACT 2.7 m/s · 34`), FASTEST STRIKE (m/s), QUICKEST DEFLECT (ms from opponent onset to your press), DEFLECTS, CRIT RATE, LONGEST COMBO, PRIES, CLUTCH ROUND (won at ≤ 15 Integrity).
- **Right side:** tabs STATS · TIMELINE · MODEL REPORT.
  - Timeline: integrity lines for both seats with event icons; clicking opens the replay there.
  - Model report (any non-human seat): the 5.10 tables plus the preset stamp.
- **Progress strip** under the tabs: medals earned this match, league progress, rival record, and at most one **DRILL** offer (7.3.13).
- **Buttons:** **REMATCH** (primary, focused, Enter / R / A, under the cursor at open), SWAP OPPONENT, GREEN ROOM, PIN REPLAY.
- **Rep** (localStorage `torquelimit.profile.v2`): KO 40, round win 30, pry 35, late pry 60, deflect 10, lock 40, match win 80, match played 20, medal 50, league tier cleared 300, daily best beaten 60.
  - Levels: 1–3 at 100, 250, 450 rep, then +400 per level; each level unlocks one cosmetic (hand print colour, mat tape colour, intro pose, victory emote, nameplate frame). Cosmetics **never** change geometry, mass, or servos, and never use semantic colours.

#### 7.3.8 Settings

- Tabs: CONTROLS · CAMERA · AUDIO · VIDEO · SHOW · ACCESSIBILITY.
- **CONTROLS:** sensitivity, vertical multiplier, invert Y, rebind table, gamepad deadzone.
- **CAMERA:** COCKPIT `STANDARD | STABLE`, FOV 50–80, camera motion 0–100% (**default 60%**), ghost opacity 0–100%.
- **AUDIO:** master, SFX, music, crowd volumes; captions `FULL | BIG MOMENTS | OFF`; **OPERATOR VOICE `OFF | ON`** (default OFF; pre-rendered lines, 8.5) with its VOICE volume; **SCREEN-READER VOICE `OFF | ON`** (accessibility; `speechSynthesis` with local voices only; when ON the VOICE slider is hidden because speech can't be routed through the mixer).
- **VIDEO:** quality `AUTO | HIGH | DEFAULT | LOW`, screen effects 0–100%, damage numbers `ON | MERGED | OFF`.
- **SHOW:** FAST SHOW `AUTO | ON | OFF` (2.2).
- **ACCESSIBILITY:** colourblind team pair, reduced motion, caption size.
- Persist in localStorage `torquelimit.settings.v2`.

#### 7.3.9 Tutorial "Calibration" (first launch, ≤ 90 s)

JIG is the opponent. Each step shows an `OPS` caption and one goal stamp and completes on a real event. Abilities, Overdrive, heat, deflect, and pries are not taught here (7.3.13).

| # | Goal | JIG behaviour | Completion |
|---|---|---|---|
| 1 | **FLICK** | `parked_in_reach` (hand held inside your flick range; the range cue is already lit) | land any strike |
| 1b | **REACH** | `parked_in_reach` moved 8 cm back, out of range | tap W to reach in and land a strike |
| 2 | **HOOK** | `idle` | land a strike with ν ≥ 0.8 (the `IMPACT` tag teaches speed) |
| 3 | **GUARD** | `sparring` | hold guard through 2 jabs |
| 4 | **DOCK** | `idle`, Core dropped near you | grab (assisted), dock (magnet), hold the lock-in for 3 s |

After step 4: a **CALIBRATED** stamp, then a wipe into a best-of-1 against **BACKLASH Rookie** (slow, readable, bites feints). The full ghost shows during the tutorial. Skip with Esc → SKIP.

#### 7.3.10 Pause and pointer-lock overlays

- **Pause:** the canvas freezes on the current frame at 70% grayscale (CSS `filter` on the canvas element, not `backdrop-filter`) under a **hard ink scrim at 80%**, with a vertical plate stack RESUME · SETTINGS · FORFEIT ROUND · QUIT TO GREEN ROOM. The sim clock is stopped.
- **Pointer lock lost** mid-match (Esc or any other cause) is pause-equivalent for the human seat:
  - When pause is allowed (no bridge seat, not a Lab eval), the match pauses and a centre plate reads `CLICK TO FIGHT`.
  - When a bridge seat is present, the sim keeps running, the human command is frozen at home guard, and the human seat is **protected** (takes no damage) for up to **3 s**. If lock isn't regained, the human forfeits the round. The plate shows a 3 s countdown bar.
  - A re-lock rejected by the browser shows **RE-ARMING…** and retries (3.3).
  - The first mouse event after re-lock is dropped.

#### 7.3.11 Open Servo League, medals, variants, rival

- **League screen** (`league-screen.tsx`): a bracket of 4 tiers × 3 entrants. Beat each entrant (best of 3) at a tier to unlock the next tier. Each tier ends in a **boss gauntlet**: OVERSHOOT, BACKLASH, DEADBAND back to back at that tier, best of 1 each, **Integrity carried over** between the three matches. Clearing Champion's gauntlet stamps the league card.
- **Arena variants** (physical MJCF, WP2), unlocked by tier and used in league and daily matches:
  - Contender: `ridge`: a printed ridge 15 mm high, 20 mm wide across the mat at x = 0, spanning y ±0.20; cubes and the Core must be lifted over it.
  - Pro: `heavy_core` (Core mass 0.16 kg) and `sliding_dock`: each dock's tape pad sits on a thin plate on a slide joint along y, driven by a position actuator on a seeded ±0.05 m, 0.1 Hz sine; dock centres are read from the sites every step.
  - Champion: `cube_rain`: every 6.0 s sim a clutter cube is re-dropped through the hopper at a seeded offset (recorded `place_cube` mutations).
- **Medals** per entrant and tier: **CLEAN** (win without taking a crit), **PRY** (win a round by lock after landing a pry), **READ** (3+ deflects in a match), **BROWNOUT** (win round 1 by KO). Shown on entrant cards.
- **Rival slot:** any registered user model can be marked RIVAL. It appears as the final match of every league tier. Its W–L record against you is tracked and shown on its card. Rival matches offer `ARCADE | PROVING GROUND` (default PROVING GROUND, since that is the only honest test of the model).

#### 7.3.12 Daily challenge

- Seeded by the local date (`hash("YYYY-MM-DD")`): entrant, tier, loadout, arena variant, and match seed.
- One best-of-1 in Arcade, DDA frozen. Score = physical damage dealt − taken + 30 per lock + 20 per medal + 1 per second of round time left on a KO win.
- Local best only (no network). The best run's episode is pinned; the **BEST RUN GHOST** toggle shows its recorded command ghost synced by sim time (3.1.3).

#### 7.3.13 Drills

One-screen drills (≤ 45 s each, against JIG) are **offered on the post-match screen after the first loss that involved the mechanic**. At most one offer per post-match. A completed drill stamps a DRILLED mark in the profile.

| Drill | Offered after | Content |
|---|---|---|
| HEAT | your first Thermal Cutout | flick until the arc fills, then back off; survive 20 s with no Cutout |
| DEFLECT | first time you're deflected or eat a charged heavy | deflect 2 telegraphed heavies (`slow_heavy`), then one with a delayed release |
| KIT | match 3 (abilities unlock) | use your ability and Overdrive once each; burst out of one stagger |
| PRY | first round lost to a lock | pry the Core out of JIG's dock twice |

### 7.4 In-match HUD (1920 × 1080 reference, 4vmin safe inset)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [PILOT  ████████░░ 72][pip pip]     [ 0:31 ]  [CORE 5.2]     [pip pip][██████░░░░ 58 OVERSHOOT]│ tote board (top centre)
│ [silhouette pips · STAGGER ▬▬]                                                               │ under the player plate
│                                                                                              │
│                               ‹ bracket ›  · tip dot     (WebGL)                             │ reticle cluster
│                                  thin heat arc · charge ring                                 │
│                                       34                                                     │ damage number (world)
│                                   IMPACT 2.7 m/s                                             │
│                                                                                              │
│                   OPS  Docked. Clock's running.                                ┌ KIT ──────┐ │ captions / kit panel
│                                                                                │ SNAP  2   │ │
│                                                                                │ GRIP OPEN │ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Position and size | Content and behaviour |
|---|---|---|
| **Tote board** | top centre, 56 px, max 1100 px | Pilot plate (cut left, cobalt lip): callsign `plate`, 10-segment integrity bar, number `num-m`. Round pips (SVG). **Timer box** centre, paper fill with ink `num-xl`; ≤ 10 s it gains hazard-stripe edges and pulses scale 1.0 → 1.06 each second. **Core chip** (Core live only): an SVG diamond in prize (or owner team colour when owned) with lock-in seconds `num-m`, or `CONTESTED` on hazard stripes. The AI plate mirrors the pilot plate. On a strike, the victim's bar segment flashes `--hit` for 120 ms, then drains over 300 ms. |
| **Under the player plate** | 24 px strip | **SO-101 silhouette pips** (6 SVG joint pips in link order; the struck link flashes `--hit` 300 ms) and the **servo state tag** (`STAGGER`, `STUNNED`, `CUTOUT`, `OFFLINE`) with a thin countdown bar. This replaces the integrity panel. |
| **Reticle cluster** | follows the projected ghost tip (WebGL, WP6) | 7.4.1 |
| **Screen centre dot** | exact centre | 2 px paper dot, 1 px ink outline, 30% opacity: the fixed anchor |
| **Damage numbers** | world-anchored at the contact point, +16 px up, ±10 px jitter | 7.4.2 |
| **Damage edges** | full-screen DOM overlay, left/right/top gradients | attacker team colour, opacity 0.30·m, τ 250 ms decay; heavy hits and above only (8.1) |
| **Kit panel** | bottom right, 300 × 110 px | Ability name with charges or cooldown sweep, `OVERDRIVE` while held, grip `OPEN` / `CLOSED`, loadout in `label`. Ability and Overdrive rows hidden before match 3. |
| **Captions** | bottom centre, max 900 px, 40 px above the safe edge | `OPS` tag, then the line, on a slanted ink plate with a 4 px paper lip. Broadcast tier in/out, hold 2.2 s + 45 ms per character. One at a time. |
| **Banners** | centre band | ROUND N, KNOCKOUT, LOCKED, PRIED, SUDDEN DEATH, TIME: full-width band at `--slant`, `display-l` / `display-xl`, tier per 7.2 |
| **Core marker** | world-anchored on the Core, edge-clamped | 18 px SVG diamond in prize (owner colour when owned), edge arrow when off-screen, 60% opacity nearer than 0.1 m to your gripperframe |
| **Policy chip** | under the AI plate, 20 px | **Only in the Lab and against user models.** `mono`: tier or file, driver, decision Hz, last compute ms. Lip hazard-striped on late/timeout/error for 1.5 s. Tab expands it. |
| **Event feed** | top right, 4 rows max | **Only in the Lab and against user models.** Notched ink tags with a team lip: `OVERSHOOT 19 CRIT`, `PILOT DEFLECT`, `CLASH`, `PRIED`, `POLICY FAULT · TIMEOUT`. |
| **Debug overlay** (`?debug=feel`) | top left | fps, CPU/GPU ms, steps/frame, α, hitstop ms and budget used, trauma, stance and look offsets, last event magnitude, draw calls, triangles, **reticle-vs-projected-ghost-tip pixel error** (must be 0 on the same frame) |

#### 7.4.1 Reticle cluster (WebGL overlay, `src/game/render/reticle-overlay.tsx`, WP6)

Every stroke has an **ink core with a 1 px paper outline**, so it reads on the dark mat, the bench, and the crowd. **At most two rings** are visible at once (priority: charge ring, then heat arc).

| Part | Spec |
|---|---|
| Aim bracket | Two brackets cut at `--slant`, 18 px tall, 26 px apart, 3 px stroke, centred on the projected ghost tip (same frame). |
| **Range cue** | When `rangeCue.flick` is true the brackets fill solid paper and an **IN RANGE** tick (a 6 px notch under the bracket) appears; for the first 10 matches a `label` reads `IN RANGE`. When only `rangeCue.jab` is true, the notch appears hollow. On the mat, the reach arcs turn solid (3.1.3). |
| Tip dot | 5 px paper dot, 1 px ink outline, at the projected **physical** gripperframe. A 1 px line at 40% joins it to the bracket when > 12 px apart. |
| Heat arc | One thin arc (2 px), 220°, radius 36 px, visible only at heat ≥ 40. Fill = heat. From 70, it shows hazard dashes; in Cutout it blinks at 4 Hz. The main heat readout is the strip on your arm (6.7). |
| Charge ring | Inner ring radius 28 px, 4 px, fills in your **team colour** as c rises; pulses at 4 Hz once public (c ≥ 0.25); a solid stamp at c = 1. |
| Guard state | While guard is held the brackets close to 14 px apart. In the deflect lockout they dim to 50%. |
| Hit ticks | 4 diagonal ticks around the bracket, `--hit` with ink edge, length 8 + 8·m px; crit: 28 px with 4 extra outward ticks; guarded: `--ink-500` with paper edge, 6 px; graze: 2 short grey ticks. |
| Leash line | 3.1.3 |

#### 7.4.2 Damage numbers (DOM, `damage-numbers.tsx`, WP7)

- Archivo wdth 87.5 wght 800 italic, size **(28 + 16·m) px**, `--hit` fill with a 2 px ink stroke (paint-order stroke).
- Under each number, a `label`-size tag `IMPACT 2.7 m/s` (contact speed `vN`).
- Crit: × 1.3 size with a `CRIT` tag. Guarded: × 0.85 size, `--ink-500` fill with paper stroke. **Graze:** no number, only the tag `GRAZE · 0.31 m/s` in grey.
- Damage taken is not shown as a number (edges and the integrity bar carry it).
- **Motion:** pop 1.4 → 1.0 in 80 ms (impact tier), rise 28 px over 600 ms, fade over the last 200 ms.
- **Merging:** a hit on the same victim within **400 ms** adds to the live number and re-pops it at 1.2.
- Pool of 16 DOM nodes. Setting ON / MERGED (merge window 1200 ms) / OFF.

#### 7.4.3 Best Score strip (`round_summary`, standard show only)

Three paper-lipped tiles slide in 60 ms apart (broadcast tier): **HARDEST HIT** (`IMPACT 2.7 m/s · 34`), **FASTEST STRIKE** (m/s), **OBJECTIVE** (lock-in seconds held or pries). Each shows the winner's team lip and name.

---

## 8. Game feel

### 8.1 Feedback budget and event table

**Channels.** Juice channels are counted; information (hit ticks, damage numbers, bars, tags) is always shown and isn't counted.

| Code | Channel |
|---|---|
| A | audio one-shot |
| V | world VFX (sparks, ripples, hit light, victim vibration) |
| S | hit stop (Arcade only) |
| C | camera (trauma shake, kick, FOV spring) |
| E | damage edge |
| P | post (chromatic aberration, vignette boost, desaturation) |
| X | haptics (gamepad only; not counted) |

**Budget per magnitude tier:** **graze and light** (m < 0.4): at most **3** (A, V, S). **Heavy** (m ≥ 0.4, crit, deflect, clash): at most **5** (A, V, S, C, E). **KO**: everything, including P and dilation. **P is used only by KO and by Stagger taken**; ordinary hits never touch chromatic aberration.

**Hit stop** (`hitstopMsFor(event, preset)`, a pure function in `src/game/combat/tuning.ts`, WP2; juice and sim-driver both call it):

| Event | ms (Arcade) |
|---|---|
| graze, contact | 0 |
| strike dealt or taken, m ≥ 0.15 | round(**133 · m²**) (m 0.4 → 21, m 0.6 → 48, m 1 → 133) |
| strike, crit | the above + 17, max 150 |
| strike, guarded | round(50 · m²) |
| deflect | 90 |
| clash | 40 |
| KO | 150 |
| any event in PROVING GROUND, HARNESS, DEMO | 0 (no sim or render freeze) |

- **Immediate:** sim-driver calls `clock.requestHitstop(hitstopMsFor(e, preset))` the moment `rules.step` emits a qualifying event and **breaks out of the step loop**, so the frozen frame is the impact step itself and no step k+1 runs before the freeze ends.
- **Merge:** `remaining = max(remaining, new)`. A single freeze never exceeds **150 ms**.
- **Budget:** at most **120 ms of total freeze in any rolling 600 ms of wall time**; `requestHitstop` trims a request to the remaining budget. In a 4-per-second flick exchange (m ≈ 0.4, 21 ms each) the sim is frozen about 8% of the time.
- **Command freezes too.** During a freeze the ghost arm and reticle hold their pose; pointer deltas accumulate and apply on the first post-freeze frame; discrete edges are stamped at the first post-freeze step and can't deflect the triggering onset (3.5). The AI's Worker is paused with the sim, so neither side gains reaction time.
- Everything else fires **on the event frame**. Audio never waits for hit stop.
- Rows are from the local player's perspective. With no human seated, "dealt" rows apply without camera effects.

| Trigger (GameEvent) | Tier | Visual (world + HUD info) | Camera (C) / Edge (E) / Post (P) | Audio (A) | Duration |
|---|---|---|---|---|---|
| `contact` (shove) | none | contact puff | none | `thunk` recorded, −12 dB, spatial | 200 ms |
| `strike` tier graze | light | graze tick VFX; 2 grey hit ticks; `GRAZE · 0.31 m/s` tag | none | `tap_soft` (recorded PLA tap), −10 dB | 150 ms |
| `strike` dealt, m < 0.4 | light | sparks 6 + 30·m; hit ticks; damage number and IMPACT tag | none | `tok` (recorded PLA-on-PLA hit + servo tick), pitch +3·m st | 180 ms |
| `strike` dealt, m ≥ 0.4 | heavy | as above; hit light; victim LED flash; crowd lean | C: trauma +0.10 + 0.12m (24 Hz); FOV −2°·m | `tok` + `crack` layer | 180 ms |
| `strike` dealt, **crit** | heavy | sparks × 1.6, crit flakes, crit hit ticks, CRIT tag | C: as heavy + trauma 0.05 | strike + `tink` at **+40 ms** | 260 ms |
| `strike` dealt, **guarded** | light | guard ripple; guarded ticks; small guarded number; `BLOCKED` tag 400 ms | none | `thock` (+ `clang` if raw ≥ 20) | 220 ms |
| `strike` taken, m < 0.4 | light | sparks at contact; silhouette pip flash; bar drain | none | `crunch_light` | 300 ms |
| `strike` taken, m ≥ 0.4 | heavy | as above | C: trauma +0.25 + 0.35m (18 Hz); kick 1.5° + 3°·m away from contact. E: attacker team colour, 0.30·m | `crunch` | edge 450 ms |
| `strike` taken, guarded | light | guard ripple | none | `thock` | 220 ms |
| `late_guard` | light | `LATE GUARD +9` tag | none | `thock` pitched down | 400 ms |
| `deflect` dealt | heavy | cyan chevron burst, **DEFLECT** tag, attacker rim flash | C: FOV −2° over 120 ms, no shake | `ting` (recorded metal ping ×2, rising) + crowd `ohh` | 500 ms |
| `deflect` taken (Stunned) | heavy | **STUNNED** tag; reticle dims 50% | C: kick 2.5° pitch up. P: desaturate 30% for the stun | `stun_down` | stun duration |
| `clash` | heavy | clash fan and ring; **CLASH** tag | C: trauma +0.2; kick 1.5° along the normal | `clash` (recorded aluminium ring) | 250 ms |
| `whiff` (you) | light | charge ring flashes empty once | none | `whiff` −6 dB | 150 ms |
| `charge` start / public / full / release / cancel | light | charge ring; hand glow; at release a smear forced visible 250 ms; on cancel the ring snaps empty | release: FOV −1.5° | recorded servo wind-up loop; `ping` at full; `release` thump; `cancel` relay click | as charge |
| `servo_state` → stagger (opponent) | light | **STAGGERED** tag; opponent LEDs flicker 12 Hz | none | `stagger_zap` (recorded servo stutter) | state duration |
| `servo_state` → stagger (you) | heavy | **STAGGER** tag under your plate; view sags (pitch +1.5° spring) | C: trauma +0.4, FOV +3°. P: CA 0.002 decaying τ 90 ms | `stagger_zap` + stutter | state duration |
| `burst` | heavy | **BURST** tag; hand flash in team colour | C: FOV −2° | `burst` (relay clack + whine up) | 300 ms |
| `overheat` (you, → Cutout) | light | heat strip hazard pulse; overheat haze; **CUTOUT** tag | none | `power_down` + relay click; servo bed −5 st for 2 s | 2000 ms |
| heat ≥ 70 (you) | none | heat arc hazard dashes | none | `heat_whine` loop −24 dB rising | while ≥ 70 |
| `ability` | light | kit pip consumes; hand flash (team colour); BULWARK draws a hex plane 6 cm in front of the gripper in ink/paper | SNAP: FOV −1.5° | `snap` / `coil` / `bulwark` | per ability |
| `first_strike` | none | `FIRST STRIKE` tag under the tote, 1200 ms | none | none (captions P3) | 1200 ms |
| `combo` (≥ 3, ≤ 1.2 s apart, no hit taken) | none | `×3`, `×4` next to the bracket | none | tok pitch walks the music's mode (D E F G A) | 1200 ms |
| `low_integrity` (you, ≤ 25) | none | integrity hazard segments; shoulder sparks every 0.6 s | none | stutter loop −18 dB; music low-pass 1.2 kHz | until KO or round end |
| `low_integrity` (opponent) | none | opponent LED flicker, tote bar hazard segments | none | crowd murmur +3 dB | until KO or round end |
| `ko` | KO | 8.3 | 8.3 | 8.3 | 1800 ms |
| `core` incoming | none | hopper tag flips; tote `CORE 3·2·1` | none | `riser` (recorded hopper rattle + music fill) | 3000 ms |
| `core` drop | light | the Core falls through the hopper; Core marker | C: trauma +0.05 | `latch` + recorded PLA clack on first mat contact | 800 ms |
| `core` lock_in_start | none | dock tape lock pulses start; tote chip turns owner colour | none | tick loop 1 Hz → 2 Hz < 3 s → 4 Hz < 1 s | until end |
| `core` contested | none | dock tape edge hazard-dashes; `CONTESTED` | none | tick adds a +1 st layer | while flagged |
| `core` pry | heavy | **PRIED** banner (impact), Core chip wipes to loose | prier: C trauma +0.15 | `pry` (recorded scrape + two-note motif) + crowd rise | 900 ms |
| `core` pry, late (≤ 2 s) | heavy | as pry, plus a `LATE` stamp; replay-eligible | as pry | as pry + crowd roar; caption P1 | 1200 ms |
| `core` lock | KO-class, no P | 8.4 | 8.4 | 8.4 | 1500 ms |
| `phase: round_intro` | none | bench reset dip; ROUND slab; 3·2·1 (standard); **ENGAGE** (impact) | none | shutter click; count beats; `engage` hit; music enters on ENGAGE | 2900 / 1600 ms |
| final round / sudden death intro | none | `FINAL ROUND` slab (celebration tier) / `SUDDEN DEATH` slab with hazard edges; clamp lamps dim to 60% | none | final-round arrangement / percussion-only cue | 2900 / 1600 ms |
| timer ≤ 10 s | none | timer hazard edges pulse | none | `tick` each second, louder from 5 s | continuous |
| `time_up` | none | `TIME` banner | none | recorded bench buzzer | 1200 ms |
| `round_end` | none | `ROUND TO PILOT` / `ROUND TO OVERSHOOT` in the winner's team colour | none | crowd cheer / groan | into next phase |
| `match_end` win / loss | KO-class | VICTORY / DEFEAT wordmark; hole-punch confetti on a player win | outro camera | `victory` / `defeat` motif variations (9.5) | outro |
| `flaw` patched | none | `PATCHED` stamp on the opponent plate for 1.5 s | none | caption P2 | 1500 ms |
| `policy_fault` | none | policy chip lip hazard; feed row (Lab and user models) | none | `fault_blip` −12 dB | 1500 ms |

**Haptics** (gamepad; local player only):

| Event | Effect |
|---|---|
| Strike dealt | duration 50 + 70·m ms, strong 0.15, weak 0.25 + 0.4·m |
| Strike taken | duration 60 + 80·m ms, strong 0.4 + 0.5·m, weak 0.3 + 0.4·m |
| Deflect dealt | 90 ms, weak 1.0 / strong 0.6 |
| Clash | 120 ms, 0.8 / 0.8 |
| Heat ≥ 70 | weak 0.15 pulse at 8 Hz |
| KO | 400 ms, 1.0 / 1.0 |

### 8.2 Camera juice (owner: `src/game/camera/juice.ts`)

- **Trauma:** `trauma ∈ [0, 1]`, linear decay **1.6/s** in wall time, shake = trauma².
- **Shake** is **rotation only**: yaw and pitch max **1.2°**, roll max **2.0°**, 1D gradient noise per channel. Frequency **18 Hz** for received hits and **24 Hz** for dealt, taken from the event that added the most trauma in the last 300 ms. Translation is 0.
- **Directional kick:** a critically damped 3-axis angular spring, ω = **22 rad/s**, wall time.
- **FOV spring:** ω = **18 rad/s**.
- **Post uniforms** (KO and Stagger taken only): `ChromaticAberration.offset` decays τ 90 ms, rest 0; vignette boost τ 200 ms, rest 0.35; desaturation (Stun taken) holds for the stun.
- **Settings:** Camera motion % multiplies trauma output, kick, FOV, and sway (0% disables all four; default 60%). STABLE COCKPIT additionally multiplies shake and kick × 0.5. Screen effects % multiplies CA, vignette boost, edges, and desaturation.
- **Hit stop behaviour:** sim steps, render α, ghost, reticle, and spark physics freeze. Camera springs, trauma decay, flash envelopes, UI, and audio keep running.
  - **Victim vibration:** the rendered hit-link group offsets along the contact normal by `A·(1 − t/T)·sign(sin(2π·30·t))`, A = 1.5 mm sim for the victim and 0.5 mm for the attacker.
- **Dilation:** Arcade KO only (8.3).

### 8.3 KO sequence (`ko`, 1800 ms): built around the slump

The one thing only this game has is a real arm losing power under real gravity. Nothing is allowed to cover it.

| t (ms, wall) | Beat |
|---|---|
| 0 | Lethal hit. Rules apply **Offline** on the lethal step (4.6; every preset). Hit stop **150 ms**. The bracket collapses to a small ink-and-paper X. Recorded heavy `crunch`. Music ducks −12 dB, other SFX −6 dB, for 1200 ms. |
| 150 | The loser's **servo LEDs die** from base to gripper, 40 ms apart, each with a recorded **relay click**; under them, a recorded **spin-down whine**. Arcade: dilation **0.35× for 400 ms**, easing to 1.0 by 900 ms. |
| 150–1000 | The camera **holds** on the drooping arm: cockpit look offsets ease toward the loser's gripper by up to 4° (no pull-back, no cut). The arm droops 7–10 cm and settles on its own physics. Crowd noise drops to a murmur. |
| settle (first of: loser joint speed < 0.05 rad/s, or 1100 ms) | **KNOCKOUT** (`display-xl`, celebration tier) with the winner's name below in `plate`. Crowd roar (hype +0.7). Caption P1. Match-end only: nothing else. |
| 1800 | → `round_replay` (if earned, 8.6), else `round_summary` / `round_intro`. The loser stays Offline and slumped until the bench reset dip. |

No chips, no dissolve, no confetti, no sponsor bug, no light floods.

### 8.4 Lock sequence (`lock`, 1500 ms)

| t (ms) | Beat |
|---|---|
| 0 | The lock-in reaches 0. The dock tape ring fills solid prize. Recorded mechanical `latch` plus the two-note motif sting. The owner's Core seam goes full. |
| 150 | **LOCKED** banner (celebration tier) with `ROUND TO …` beneath. Crowd roar. |
| 300 | Caption P1. |
| 1500 | → next phase |

The loser's servos are **not** cut on a lock. Both arms go home at the bench reset.

### 8.5 The Operator (owner: `src/game/announcer/`, WP3)

- **One voice.** THE OPERATOR, caption tag `OPS`, reads the run log in a flat, dry register.
- **Captions** always (per the captions setting: FULL, BIG MOMENTS = P1 + P2, OFF).
- **OPERATOR VOICE** (default **OFF**): every line has a pre-rendered file `public/audio/vo/<lineId>.ogg`, generated offline by `tools/vo/render_lines.py` with a local Piper voice whose license permits redistribution (named in `public/audio/CREDITS.md`), or replaced by a human recording with the same ids. Files play through `voiceBus` with a **band-pass 300–3400 Hz "phone speaker" EQ** (diegetic: the stream's phone), so the voice's synthetic quality reads as the medium. Speech ducks music −8 dB and crowd −5 dB (attack 40 ms, release 300 ms).
- **Numbers are never spoken.** Each line has `caption` text (may contain `{speed}`, `{ms}`, `{dmg}`, `{secs}`) and a `spoken` text that omits or rounds them into words at render time ("under a quarter"). Rendered files exist only for lines without tokens in their spoken text.
- **SCREEN-READER VOICE** (accessibility, default OFF): `speechSynthesis` reads the caption, **only with a voice where `voice.localService === true`**; if none exists the option is disabled with `NO LOCAL VOICE`. It can't be mixed, so the VOICE slider hides while it's on.
- **Priorities:**
  - **P1 (interrupt):** KO, match end, late pry, lock.
  - **P2 (queue):** pry, deflect, crit with dmg ≥ 30, round start, final round, sudden death, flaw patched.
  - **P3 (filler):** first strike, combo ≥ 4, core drop, lock-in start, low integrity (player), stalemate (no arm contact for 6.0 s sim), user-model intro.
- **Global cooldown** 3.5 s after a line ends. P1 cuts the current line with a 60 ms fade.
- **Staleness:** P2 dropped if it can't start within 1.2 s, P3 within 0.8 s.
- **Budget:** ≤ **5** lines per round, ≤ 2 P3.
- **No repeats:** a shuffle bag per event, never a variant among the **last 20 lines** (localStorage `torquelimit.vo.history`).
- **Context tokens:** `{you}`, `{opp}`, `{round}`, `{speed}` (m/s, 1 dp), `{ms}` (int), `{dmg}` (int), `{secs}` (1 dp), `{count}`, `{file}`.

**Copy rules** (enforced by `announcer.test.mjs` over `lines.ts`):
1. **Ratio** per event bank and overall: about **70% plain calls** tied to state, **20% number-bearing observations**, **≤ 10% jokes**, and jokes only in P1 banks. Each line carries `kind: "call" | "number" | "joke"`.
2. **No exclamation marks.** Ever.
3. **Banned words:** chill, energy, literally, textbook, "not today", insane, epic, vibes, banked, larceny, and any "-er, X" self-correction gag.
4. Short and declarative, ≤ 9 words.
5. Every line has `readAloudBy: string` (a person's initials) before it can ship; the test fails on an empty field at M4.

**Line bank.** `lines.ts` holds **≥ 8 variants for every P1/P2 event** and ≥ 4 for P3. Required examples, in the operator's voice:

| Event | Lines |
|---|---|
| round_start | "Round {round}. Arms are live." · "Bench is clear. Go." · "Both servos calibrated." · "Clock's running." |
| final_round | "Final round." · "Last round on the bench." · "No resets after this one." |
| sudden_death | "Sudden death. Next clean hit ends it." · "Level at the buzzer. Four-second lock-in." |
| first_strike | "First contact to {you}." · "{opp} lands first." |
| crit | "Off the camera mount." · "Optics hit. {speed} meters a second." · "That found the lens." |
| big hit | "Full swing. Clean." · "{dmg} on that one." · "Hard contact." |
| deflect | "Deflected." · "Stun on the deflect." · "Read it {ms} milliseconds early." · "Turned away. {opp} is stunned." |
| combo ≥ 4 | "{count} unanswered." · "{opp} can't get a hand up." |
| stalemate | "Nobody's committing." · "Six seconds without contact." |
| core_drop | "Core's down, center of the mat." · "Core is live. Eight seconds in a dock takes it." |
| lock_in_start | "Docked. Clock's running." · "{you} docks it. {secs} on the clock." |
| pry | "Pried loose." · "Out of the dock. Clock stopped at {secs}." · "{opp} pries it free." |
| late pry | "Pried with {secs} left." · "Out at the last second." |
| lock | "Locked. Round over." · "Clock ran out in the dock." |
| low_integrity | "{you} is under a quarter." · "Shoulder's smoking." |
| ko | "Brownout. {opp} is down." · "Servos off. Round over." · "That arm is done for the round." · (joke) "Somebody catch that arm." |
| match win / loss | "Match to {you}." · "{opp} takes the match. Rematch is one key." |
| flaw patched | "{opp} has stopped biting." · "{opp} patched that." |
| user model intro | "User model on the bench. File {file}." · "This entrant was trained by someone in the room." |
| user model wins / loses | "The model takes it." · "Model loses. Check the logs." |

### 8.6 Replay moments

- **A replay is earned, not automatic.** A round (or match) replay plays only if the deciding moment qualifies:
  1. KO where the lethal strike had m ≥ 0.8 or was a crit (the slump is the subject);
  2. a late pry;
  3. a lock within 3 s after a pry;
  4. a deflect that led to the deciding hit within 2 s.
  Otherwise the flow goes straight on (2.2). Priority when several qualify: 1 > 2 > 3 > 4.
- **Clip:** `t_event − 2.5 s` to `t_event + 1.2 s` from the moment buffer (the extra 0.4 s keeps the slump in frame).
- **Speed curve:** 1.0× until 400 ms before the event, eased to **0.25×** through the event (± 150 ms), then 0.6×. Fitted to 2500 ms (round) or 3500 ms (match) by trimming the lead-in.
- **Overlays:** letterbox bars 8%; a `REPLAY` stamp top left; one readout (count-up on the impact frame) `IMPACT 2.7 m/s · 31`. No ν, no zone code, no sponsor.
- **Crowd:** an "ohh" swell on the impact frame.

### 8.7 Crowd hype

- **Model:** `h ∈ [0, 1]`, `h += impulse`, `h −= 0.12·dt`. Floor 0.15 during a fight, 0.4 in attract mode.
- **Impulses:** strike 0.04 + 0.1·m · crit +0.12 · deflect +0.15 · clash +0.06 · pry +0.35 · late pry +0.6 · KO +0.7 · lock +0.5 · sudden death sets `h = max(h, 0.6)` · stalemate 6 s −0.1.
- **Refractory:** 700 ms per reaction type.
- **Home crowd:** the room is on the pilot's side and groans when the pilot is pried or KO'd.
- **Drives:** crowd audio layers (9.6), music arrangement (9.5), crowd lean and arms-up poses (6.6).

---

## 9. Audio design (recorded sound, physics-driven mixing)

The "zero audio files" rule from v1 was self-imposed and is lifted. The user's constraint is **local and free**: files ship in `public/audio/`, are either recorded by us or CC0, and are credited in `public/audio/CREDITS.md`. Procedural synthesis stays **only where the sound is diegetically electronic** (heat whine, relay clicks, UI blips, the phone-speaker EQ) and as a pre-M4 stand-in (9.7). Physics still drives every parameter: the recordings are grains and layers; the pitch, gain, and filter curves come from the sim.

### 9.1 Graph (owner: `src/game/audio/audio-engine.ts`)

```
AudioContext({ latencyHint: "interactive" })     // log baseLatency + outputLatency at start
 ├─ sfxBus  (Gain 1.0)   ← per-voice PannerNode(HRTF, refDistance 0.3, rolloff 1, "inverse") for world sounds
 ├─ uiBus   (Gain 0.63 ≈ −4 dB)
 ├─ voiceBus(Gain 0.9)   → BiquadFilter highpass 300 Hz → BiquadFilter lowpass 3400 Hz → WaveShaper (soft 2% drive)   // phone speaker
 ├─ musicBus(Gain 0.32 ≈ −10 dB) → BiquadFilter lowpass (20 kHz rest; 1.2 kHz low integrity; 800 Hz KO)
 ├─ crowdBus(Gain 0.30)
 └─ all → master Gain 0.8 → DynamicsCompressor(threshold −10, knee 6, ratio 12, attack 0.002, release 0.15) → destination
```

- **Listener:** position and orientation set every render frame from the active camera, in sim metres.
- **Unlock:** the graph is built during `boot` (suspended) and resumed on the first user gesture.
- **Loading:** every file is fetched and decoded with `decodeAudioData` during `boot` (≈ 38 files, ≤ 6 MB total). Format: `.ogg` (Opus) with `.m4a` (AAC) fallback chosen by `canPlayType`. All files are loudness-normalized to −16 LUFS short-term at authoring time.
- **Voice pool:** at most **24** concurrent one-shots. Priority KO 5 > deflect/clash 4 > strike 3 > guard 2 > contact/cube/UI 1. A new voice steals the oldest of the lowest priority. Nodes come from a pool; beds create nothing per frame.
- **Grain player** (`beds.ts`): looping `AudioBufferSourceNode`s with random start offsets and 30 ms crossfaded re-triggers, so recorded beds never audibly loop.
- **Ramps:** `setTargetAtTime` with explicit time constants.
- **Hit stop / dilation:** beds get `playbackRate = timeScale^0.5` plus a 1.2 kHz low-pass released over the ease. One-shots stay unpitched.

### 9.2 Recording and sourcing plan (WP3; `tools/audio/RECORDING.md`)

**Session A: the real SO-101** (STS3215 servos, PLA shell), recorded with a small-diaphragm condenser at 20 cm and a contact mic on the base, 48 kHz / 24-bit:

| Asset id | What to record |
|---|---|
| `servo_whine_l{0..3}` | one joint slewing continuously under 4 loads (free, light hand resistance, heavy resistance, stalled), 6 s each |
| `servo_tick` | a single small step move, 20 takes |
| `servo_windup` | a slow ramp to stall and hold, 3 s |
| `servo_spin_down` | power cut during motion (for KO), 5 takes |
| `servo_stutter` | a joint fighting an oscillating hand push, 4 s |
| `gear_chatter` | fast back-and-forth small moves |
| `pla_hit_{soft,med,hard}` | PLA part striking another PLA part at three speeds, 10 takes each |
| `pla_tap_soft` | fingertip-speed PLA tap |
| `pla_scrape` | PLA dragged along PLA and along an ESD mat, 5 s |
| `jaw_clack` | gripper jaws closing on nothing and on a cube |
| `cube_{mat,wood}` | printed cube dropped on the ESD mat and on birch ply from 5, 15, 25 cm |
| `latch` | a small spring latch or cabinet catch |
| `shutter` | a phone camera shutter |
| `aluminium_ring` | a light strike on an aluminium extrusion (for clash) |
| `metal_ping` | a small screwdriver tapping a steel ruler (deflect) |
| `bench_buzzer` | a cheap piezo buzzer (time up) |

**Crowd:** CC0 indoor small-crowd recordings (30–80 people) from Freesound's CC0 filter: a murmur bed, cheer loops at three intensities, and one-shots (ohh, roar, groan, applause). Each file's source URL, author, and license go in `CREDITS.md`. If suitable CC0 material isn't found, record the room at a local meetup with consent and credit.

**Music instruments:** CC0 drum kit one-shots (kick, snare, rim, closed/open hat, ride, toms) and CC0 multisampled clavinet and electric bass, credited the same way; missing instruments fall back to the synth recipes in 9.7.

### 9.3 Continuous beds (owner: `beds.ts`)

| Bed | Source | Driven by |
|---|---|---|
| **Servo whine** (per arm, spatial at the elbow) | crossfade of `servo_whine_l0..l3` grains by load; playbackRate 0.8 → 1.6 | load = mean(\|τ\|/τmax) picks the crossfade; rate = 0.8 + 0.8 × clamp(Σ\|ctrl − q\|₀₋₄ / 0.6, 0, 1); gain −18 dB × load. Smoothing τ 30 ms. **This is the audible telegraph.** |
| **Gear chatter** (per arm) | `gear_chatter` grains | gain ∝ Σ\|qd\| / 20, max −24 dB |
| **Contact scrape** | `pla_scrape` grains, band-passed 780 Hz / 1600 Hz layers | pressure = force / 2.2 → gain; slip = relative speed → rate and grain density (up to 3 grains per 20 ms) |
| **Heat whine** (player, procedural: electronic) | sine 2.2 kHz, AM 8 Hz depth 0.6 | on at heat ≥ 70, −30 → −18 dB from 70 to 100 |
| **Low-integrity stutter** (player) | `servo_stutter` grains gated at 5.5 Hz random 70% duty | integrity ≤ 25, −18 dB |
| **Lock-in tick** (procedural: relay) | noise click 3 ms highpass 2 kHz + sine 1600 Hz 20 ms decay | 1 / 2 / 4 Hz per 8.1 |
| **Crowd** | 9.5 | hype |

### 9.4 One-shots (owner: `sfx.ts`)

| Name | Source and treatment |
|---|---|
| `thunk` | `pla_hit_soft` lowpass 400 Hz, −12 dB |
| `tap_soft` (graze) | `pla_tap_soft`, −10 dB |
| `tok` (strike dealt) | `pla_hit_med` (m < 0.6) or `pla_hit_hard`, pitched +3·m semitones, plus `servo_tick` at −10 dB |
| `crack` (heavy layer) | `pla_hit_hard` highpass 1.5 kHz, −6 dB |
| `tink` (crit, +40 ms) | `metal_ping` pitched +7 st, −8 dB |
| `crunch_light` / `crunch` (taken) | `pla_hit_med` / `pla_hit_hard` lowpass 900 Hz, plus a sine 70 Hz body a 1/180 at −8 dB |
| `thock` (guard) | `pla_hit_soft` bandpass 400 Hz, −6 dB |
| `clang` | `aluminium_ring` short, −9 dB |
| `ting` (deflect) | `metal_ping` twice, 70 ms apart, second +7 st, −4 dB |
| `stun_down` | `servo_spin_down` first 250 ms, −8 dB |
| `clash` | `aluminium_ring` full, plus `pla_hit_hard`, −3 dB |
| `whiff` | pink noise band sweep 2000 → 600 Hz over 180 ms (air, procedural), −14 dB |
| `charge` (loop) | `servo_windup` grains, rate 0.9 → 1.3 with c |
| `ping` (charge full) | `servo_tick` + relay click, −10 dB |
| `release` | `pla_scrape` 120 ms burst + sine 60 Hz a 1/200, −6 dB |
| `cancel` | relay click (procedural), −10 dB |
| `stagger_zap` | `servo_stutter` 300 ms, −8 dB |
| `burst` | relay clack + `servo_whine_l3` 200 ms rate 1.6, −6 dB |
| `power_down` (cutout) | `servo_spin_down` + relay click at 0 and 700 ms, −6 dB |
| `snap` / `coil` / `bulwark` | `jaw_clack` pitched up / `servo_windup` 400 ms with 12 Hz vibrato / `pla_hit_hard` lowpass 200 Hz + `servo_whine_l2` 500 ms, −8 to −10 dB |
| `cube_tap` | `cube_mat` or `cube_wood` by surface and speed (spatial) |
| `latch` | `latch`, −4 dB |
| `riser` | recorded hopper rattle grains building over 3 s, plus the music's fill |
| `pry` | `pla_scrape` 300 ms + the motif's first two notes on clav |
| `ko` layers | 8.3: `crunch`, then per-joint relay clicks (procedural), then `servo_spin_down` |
| `lock` | `latch` + motif two-note sting |
| `engage` | snare hit + crash from the drum kit |
| `tick` (timer) | relay click, −16 dB (−10 dB from 5 s) |
| `buzzer` | `bench_buzzer` 600 ms |
| `fault_blip` | two square 330 Hz blips (procedural: electronic), −12 dB |
| UI `hover` / `select` / `back` | procedural blips: sine 1200 Hz 25 ms −20 dB / sine 660 → 990 Hz steps −14 dB / 990 → 660 −16 dB |
| UI `slam` | kick drum one-shot at −12 dB, scheduled at slam start + 90 ms |
| UI `stamp` | `jaw_clack` lowpass 2 kHz, −10 dB |
| UI `shutter` | `shutter` |

### 9.5 Music (owner: `music.ts`, score data in `music-score.ts`)

- **Identity:** a small **studio band** (drums, electric bass, clavinet) playing funk-leaning breakbeats in **D Dorian at 104 BPM**. The signature is a six-note **needle motif** D–F–G–A–B–A, whose B natural (the raised Dorian sixth) is the colour. Harmony is a **i–IV vamp (Dm7 – G7)** with a ♭VII (Cmaj7) turnaround every 8 bars. **No vi–IV–I–V loop anywhere.**
- **Scheduler:** lookahead scheduler, 25 ms timer, 100 ms lookahead, every note on AudioContext time. Arrangement layers change on bar boundaries with 1-bar crossfades.

| Layer | Parts | Enabled by |
|---|---|---|
| `low` | drums: kick and rim ghost pattern, closed hats 8ths · bass: root-fifth figure on the vamp | always in a match, lobby, title |
| `mid` | + snare backbeat · clav comping (muted 16th stabs on Dm7 / G7) | `smoothstep(0.35, 0.45, hype)`, forced on in the Final Round |
| `high` | + needle motif on clav (lead, every 4 bars) · open hats on off-beats · tom fills into bar 1 | `smoothstep(0.70, 0.80, hype)` |
| `final_round` | the motif doubled an octave up, drums in half-time feel | replaces `high` in round 3 |
| `sudden_death` | kick on every beat, bass pedal on D, clav stabs on beat 4 only | replaces all layers |

| Music state | Content |
|---|---|
| `title` | low + mid, motif every 8 bars |
| `lobby` | bass and brushed hats only |
| `match` | layers by hype; enters on the ENGAGE downbeat |
| `between_rounds` | low layer at −6 dB |
| `victory` (3.0 s) | the motif played in full, then resolved up to a D major chord (Picardy third) with a tom fill and crash |
| `defeat` (3.0 s) | the motif's first four notes, stopping on A over a held Dm with the bass falling to C; no resolution |

### 9.6 Crowd (owner: `crowd.ts`)

| Layer | Source | Gain |
|---|---|---|
| Murmur | CC0 room murmur bed (grain player) | −22 dB constant during shows |
| Cheer | three CC0 cheer loops crossfaded by hype (low / mid / high) | `h²` × −8 dB |
| Applause | CC0 applause grains, density `20·h` per s, random pan ±0.8 | −18 dB |
| "Ohh" | CC0 one-shot, 3 variants | −10 dB |
| Roar | CC0 one-shot, 3 variants | −4 dB |
| Groan | CC0 one-shot, 2 variants | −12 dB |

Reactions trigger from hype impulses ≥ 0.3 (roar), deflects and replay impacts ("ohh"), and pilot-side KO or pry taken (groan).

### 9.7 Procedural stand-ins (pre-M4 only)

Until an asset id exists in `public/audio/`, `sfx.ts` and `beds.ts` fall back to the v1 synthesis recipes (kept in `src/game/audio/standins.ts`), and `?debug=audio` lists every stand-in in use. **M4 requires zero stand-ins** except the procedural sounds this section names as electronic.

---

## 10. Technical architecture

### 10.1 Stack and dependencies (exact pins)

| Package | Version | Status |
|---|---|---|
| next | 16.3.3 | keep |
| react / react-dom | 19.2.8 | keep |
| three | 0.185.1 (pin exactly; `postprocessing` caps three < 0.187) | keep, pin `"three": "0.185.1"` |
| @react-three/fiber | 9.7.0 | keep, pin exact |
| @react-three/drei | 10.7.8 | keep, pin exact. Allowed imports: `Environment`, `Lightformer`, `PerformanceMonitor`, `Text` (troika SDF text for lobby tiles, loading local TTFs only) |
| @mujoco/mujoco | 3.12.0 (pin exact; `public/mujoco.{js,wasm}` must match, enforced by `scripts/sync-mujoco.mjs`) | keep |
| **postprocessing** | **6.39.5** | add |
| **@react-three/postprocessing** | **3.1.1** | add |
| **meshoptimizer** (dev) | exact version resolved by `npm i -D -E meshoptimizer`, recorded in `package.json` | add (bake script only) |
| tailwindcss / @tailwindcss/postcss | ^4 | keep |
| typescript | ^5 | keep |
| typescript-eslint (dev) | exact version at install | add (for `consistent-type-imports`) |

**No other runtime dependencies.** No state, audio, or animation library. **No network at runtime:** fonts are self-hosted by `next/font` at build (and `public/fonts/*.ttf` for SDF text), the environment is built from Lightformers, audio files are local.

**TypeScript and Node:**
- `tsconfig.json`: `target: "ES2022"`, `erasableSyntaxOnly: true`, `allowImportingTsExtensions: true`, **`verbatimModuleSyntax: true`** (forces `import type` for types, which Node's type stripping requires).
- ESLint: `@typescript-eslint/consistent-type-imports` with `fixStyle: "inline-type-imports"`, error level, on `src/game/**` and `scripts/**`.
- `package.json`: **`"type": "module"`**, so `.ts` and `.js` files are unambiguously ESM under Node.
- **Node ≥ 22.18** (type stripping on by default). Tests import `.ts` directly. Every file under `src/game/**` uses **relative imports with explicit `.ts` extensions**, no `@/` alias, no enums, no namespaces, no parameter properties, and **no `.tsx` import from any file a Node test or script loads** (pure math lives in `.ts` siblings, e.g. `camera-math.ts`).
- **M1 import smoke test** (`tests/import-smoke.test.mjs`, WP1): imports every non-React `src/game/**/*.ts` file in Node and calls each factory with fakes.

**Scripts** (`package.json`):

```json
"dev": "node scripts/sync-mujoco.mjs && next dev",
"build": "node scripts/sync-mujoco.mjs && next build",
"start": "next start",
"lint": "eslint",
"typecheck": "tsc --noEmit",
"test": "node --test tests/*.test.mjs",
"bench": "node scripts/bench-physics.mjs",
"gen:arcade-model": "node scripts/gen-arcade-model.mjs",
"probe:docks": "node scripts/probe-dock-geometry.mjs",
"bake:meshes": "node scripts/bake-meshes.mjs",
"bake:set": "node scripts/bake-set.mjs",
"measure:slant": "node scripts/measure-font-slant.mjs",
"gen:fixture": "node scripts/gen-registration-fixture.mjs",
"eval": "node scripts/eval.mjs"
```

### 10.2 Module map

```
src/app/page.tsx                          server component → <ClientEntry/>
src/game/client-entry.tsx                 "use client"; next/dynamic(() => import("./game-root.tsx"), { ssr: false })
src/game/game-root.tsx                    creates GameHandle once (module-level promise cache); renders <ArenaCanvas/> + <BroadcastUi/>; ?debug=bench route
src/game/contracts.ts                     ALL shared types + protocol constants (dependency root)
src/game/game-handle.ts                   createGame(): wires every package factory
src/game/loop/                            game-clock.ts · sim-driver.ts · event-ring.ts · headless-runner.ts
src/game/match/                           match-director.ts · match-config.ts · presets.ts
src/game/core/                            event-bus.ts · ui-store.ts · settings.ts · rng.ts · hud-frame.ts
src/game/physics/                         engine.ts · mujoco-loader.ts · model-index.ts · contact-scan.ts · servo.ts · sim-state.ts · bench-browser.ts
src/game/combat/                          combat-rules.ts · damage.ts · heat.ts · servo-states.ts · core-objective.ts · abilities.ts · task-objectives.ts · tuning.ts
src/game/kinematics/                      so101-kinematics.ts
src/game/input/                           input-system.ts · bindings.ts · gamepad.ts · pilot-controller.ts · assists.ts · synthetic-input.ts · haptics.ts
src/game/camera/                          cockpit-rig.ts · juice.ts · springs.ts · noise.ts
src/game/audio/                           audio-engine.ts · asset-loader.ts · sfx.ts · beds.ts · music.ts · music-score.ts · crowd.ts · standins.ts · feedback-audio.ts
src/game/announcer/                       announcer.ts · lines.ts · screen-reader-voice.ts
src/game/feedback/                        feedback-system.ts
src/game/policy/                          observation.ts · obs-schema.ts · seat-drivers.ts · in-process-driver.ts · policy-worker.ts · policy-rng-shim.ts · bridge-worker.ts · bridge-client.ts · action-validation.ts · chunk-executor.ts · trajectory.ts · proxy-driver.ts
src/game/policy/opponent/                 index.ts · perception.ts · mind.ts · decision.ts · primitives.ts · motor.ts · personalities.ts · tiers.ts · dda.ts
src/game/policy/proxy-bots/               index.ts · human-proxy.ts · exploit-bots.ts
src/game/harness/                         recorder.ts · episode-format.ts · episode-codec-worker.ts · episode-store.ts · episode-store-fs.ts · moment-buffer.ts · replay-player.ts · replay-driver.ts · takeover.ts · compare.ts · video-recorder.ts · stats.ts · aggregate.ts · suite.ts · determinism.ts · provenance.ts · harness-api.ts
src/game/render/                          arena-canvas.tsx · robot-assets.ts · robot-decals.ts · robot-view.tsx · ghost-arm.tsx · reticle-overlay.tsx · range-arcs.tsx · cubes-view.tsx · stage.tsx · crowd.tsx · lobby-tiles.tsx · lighting.tsx · post-stack.tsx · camera-director.tsx · camera-math.ts · policy-cameras.ts · laptop-screen.tsx · blob-shadows.ts · quality.ts · interpolate.ts · deck-texture.ts · prewarm.ts
src/game/render/vfx/                      vfx-system.ts · sparks.ts · bursts.ts · ripples.ts · smears.ts · decals.ts · chips.ts · confetti.ts · haze.ts · lock-pulse.ts · bench-reset.ts
src/game/brand/                           marks.ts · wordmark.tsx · slant.ts
src/game/ui/                              broadcast-ui.tsx · kit/* · screens/* · hud/* · meta/*
scripts/                                  sync-mujoco.mjs · bench-physics.mjs · gen-arcade-model.mjs · probe-dock-geometry.mjs · bake-meshes.mjs · bake-set.mjs · measure-font-slant.mjs · gen-registration-fixture.mjs · eval.mjs
tools/bridge/                             torquelimit_bridge.py · calibration.py · test_calibration.py · README.md
tools/export/                             to_lerobot.py · requirements.txt
tools/vo/                                 render_lines.py · README.md
tools/audio/                              RECORDING.md
public/models/robotstudio_so101/          so101.xml (untouched) · arena.xml · arena-arcade.xml (generated) · variants/*.xml
public/models/so101-render/               baked LOD meshes · public/models/set/ baked set meshes
public/audio/                             *.ogg, *.m4a, vo/*, CREDITS.md
public/fonts/                             Archivo roman + italic variable TTFs, OFL.txt
public/schemas/                           torquelimit.obs-3.json
public/policies/                          example-policy.js · fixtures/registration-obs-3.bin
```

### 10.3 Frame loop: fixed-step physics decoupled from rendering

The R3F `useFrame` priorities are:
- −3: `InputSampler`
- −2: `game.frameTick`
- −1: `CameraDirector`
- 0: world components
- **+1: `EffectComposer` renders**, then the reticle overlay scene renders on top. Because a positive priority exists, R3F auto-render is off.
- **+2: `game.runAfterRender()`**, which calls every callback registered through `game.onAfterRender` (the HUD runtime).

`game.frameTick(wallDt)` (WP1, `src/game/loop/sim-driver.ts`):

```ts
const wall = Math.min(wallDt, 0.1);                         // tab-switch guard
clock.advanceWall(wall);                                    // hit-stop countdown and budget window (wall), dilation curve
const frozen = clock.hitstopRemainingMs > 0;
pilot.sampleFrame(wall, frozen);                            // frozen: accumulate deltas, hold ghost/reticle, stamp edges post-freeze
if (!clock.paused && !clock.externalDrive && !frozen) clock.acc += wall * clock.timeScale;
let n = 0; const MAX = mode === "arcade" ? 16 : 12;         // ≤ 40 ms catch-up; beyond that drop time (no spiral)
while (clock.acc >= engine.frame.dt && n < MAX) {
  const step = engine.frame.step;
  if (step % stepsPerControlTick === 0) controlTick();     // obs build (per-seat event ring), drivers, chunk executor, recorder.tick
  applyStepMutations(step);                                 // core placement, cube rain, servo profile (recorded as sim.mutations)
  if (humanSeat) { pilot.writeCommand(engine.frame, rules.state, cmdBuf); engine.setTargets(humanSeat, cmdBuf); }
  recorder.stepCtrl(step, engine.frame, stepIntentBits);   // RLE sim.ctrl and sim.intents
  engine.step();                                            // mj_step, swaps prev/curr body buffers, fills onsets
  const firstNew = events.length;
  rules.step({ frame: engine.frame, intents: stepIntents }, events);  // tags each event with step
  eventRing.push(events, firstNew);                         // per-seat ring, cleared only when that seat's obs is built
  director.onSimStep(engine.frame, rules.state, events, firstNew);
  clock.acc -= engine.frame.dt; clock.simTime = engine.frame.simTime; n++;
  const stopMs = maxHitstop(events, firstNew, preset);      // tuning.hitstopMsFor over the new events
  if (stopMs > 0) { clock.requestHitstop(stopMs); clock.acc = 0; break; }   // freeze ON the impact step
}
if (n === MAX) clock.acc = 0;
clock.setRenderAlpha(clock.hitstopRemainingMs > 0 ? 1 : clock.acc / engine.frame.dt);
feedbackCtx.update(director, rules.state, view.lastPose);
bus.pushStepEvents(events, 0); recorder.events(events);   // plus director/driver events already queued with bus.emit
bus.flush(feedbackCtx);                                     // delivers this frame's events once: feedback, vfx, hud runtime, announcer
events.length = 0;
feedback.update(wall, feedbackCtx, engine.frame);
director.update(wall);                                      // wall-time phases (eval: step-count phases run inside onSimStep)
fillHudFrame(hud, …);                                       // plain numbers, no allocation
```

- **Physics** runs at 400 Hz (Arcade, dt 2.5 ms) or 200 / 600 Hz (stock presets), always on sim time. Rules, policies, the round timer, and deflect windows use sim time. Juice, banners, and hit-stop countdowns use wall time.
- **Events** are tagged with `step`. The recorder derives `frame_index = floor(step / stepsPerControlTick)`. Observations read the per-seat ring, so events from steps after a seat's last control tick of frame N are still delivered at frame N+1's control tick.
- **Rendering** interpolates every MuJoCo body between the last two steps (position lerp and quaternion slerp by α from `frame.bodyPosPrev/Curr`, `frame.bodyQuatPrev/Curr`). When frozen, α = 1 on the impact step. The three.js scene has **one flat group per MuJoCo body**. The world root is `<group scale={2.05} rotation={[-π/2, 0, 0]}>`, mapping sim (x, y, z) to render (x·2.05, z·2.05, −y·2.05).
- **Rules:** zero React state changes per frame, zero `new` in the hot path, WASM typed-array views copied with `.set()` every step and never cached across frames.
- **Singleton:** the MuJoCo module and model load once through a module-level promise cache (Strict Mode safe).
- **Menus** use `frameloop="always"`; when `document.hidden` the loop stops and the sim pauses.
- **Headless:** `src/game/loop/headless-runner.ts` (WP1) wraps the same `sim-driver` and `match-director` code with presentation phases collapsed to their eval step counts, no rendering, and in-process seat drivers. `scripts/eval.mjs` and every Node test that runs a match use it; there is no second match loop.

### 10.4 Link mapping (sim body → LinkId)

| Body suffix (`atlas_` / `blaze_` prefix) | LinkId |
|---|---|
| `base` | `base` |
| `shoulder` | `shoulder` |
| `upper_arm` | `upper_arm` |
| `lower_arm` | `lower_arm` |
| `wrist` | `wrist` |
| `gripper` | `gripper` |
| `camera_mount` | `camera_mount` |
| `moving_jaw_so101_v1` | `moving_jaw` |


Arcade strike-hull geoms (4.10) map to the `LinkId` of the body they are inserted into, through the same table.

### 10.5 State management

| State | Lives in | Written by | Read by | Rate |
|---|---|---|---|---|
| Sim state | MuJoCo `data` | engine | engine frame buffers | 200 / 400 / 600 Hz |
| Engine frame (typed arrays) | `engine.frame` | engine | rules, pilot, render, audio, obs | per step |
| Combat state | `rules.state` (mutable plain object) | rules | director, hud-frame, obs, feedback | per step |
| Match phase and config | `director` | director | everyone | on change |
| GameEvents | per-frame reusable array (each tagged with `step`) → `bus.flush(ctx)`; copied into the per-seat event ring | rules, director, drivers | bus subscribers: `feedback-system.ts`, `vfx-system.ts`, `hud-runtime.ts`, `announcer` (through feedback); ring: observation builder; recorder | per frame / per control tick |
| HUD numbers | `game.hud` (`HudFrame`, mutable) | `fillHudFrame` (WP1) | `hud-runtime.ts` (WP7), `reticle-overlay.tsx` (WP6) | per frame |
| UI state | `game.ui` (`UiStore`, `useSyncExternalStore`) | director, announcer, harness, screens | React UI | a few times per round |
| Settings | `game.settings` (localStorage `torquelimit.settings.v2`) | settings screen | everyone | on change |
| Profile, league, medals, daily | localStorage `torquelimit.profile.v2` (`src/game/ui/meta/*`) | post-match, league, daily screens | UI, director (onboarding gates via `MatchConfig`) | per match |
| Persistent data | IndexedDB `torquelimit`: `episodes_human`, `episodes`, `suite_results`, `entrants` | harness, entrants screen | UI | on save |

### 10.6 Rendering: post stack, geometry, quality

**Canvas:**

```tsx
<Canvas flat dpr={tier.dpr} shadows="percentage"
  gl={{ antialias: false, powerPreference: "high-performance", stencil: false, depth: true }}
  camera={{ fov: 62, near: 0.004, far: 40 }}>
```

**Post stack** (`src/game/render/post-stack.tsx`), one merged pass. **Every effect is always mounted**; tiers and juice switch them only through uniforms and `blendFunction = BlendFunction.SKIP`, so no tier change or juice event compiles a shader:

```tsx
<EffectComposer multisampling={tier.msaa} frameBufferType={HalfFloatType} enableNormalPass={false} renderPriority={1}>
  <N8AO halfRes aoRadius={0.35} intensity={2} distanceFalloff={1} quality="performance" blendFunction={tier.ao ? NORMAL : SKIP} />
  <DepthOfField focusDistance={dof.focus} focalLength={0.02} bokehScale={2} blendFunction={tier.dof && cockpit ? NORMAL : SKIP} />
  <Bloom mipmapBlur luminanceThreshold={2.8} luminanceSmoothing={0.2} intensity={0.6} radius={0.7} levels={tier.bloomLevels} />
  <ChromaticAberration offset={caOffset /* KO and stagger taken only */} radialModulation modulationOffset={0.25} />
  <Vignette offset={0.30} darkness={0.35} eskil={false} />
  <ToneMapping mode={calibrated.mode /* AGX or NEUTRAL, chosen in 6.5 */} />
  <SMAA blendFunction={tier.smaa ? NORMAL : SKIP} />
</EffectComposer>
```

**Quality tiers** use drei `<PerformanceMonitor flipflops={3}>`. A tier decision is **queued and applied only at the next `round_intro` bench-reset dip** (under the ink quad), never mid-round. DPR and MSAA change only there. No `AdaptiveDpr`.

| Tier | DPR | MSAA | SMAA | Bloom levels | N8AO | DoF | Shadow map | Opponent mesh | Crowd |
|---|---|---|---|---|---|---|---|---|---|
| HIGH | min(2, device) | 4 | no | 6 | half-res | cockpit | 2048 | LOD0 | 14 |
| DEFAULT | **1.25** | **2** | no | 5 | **half-res** | off (pre-blurred) | 2048 | LOD1 (35%) | 14 |
| LOW | 1.0 | 0 | yes | 4 | off | off | 1024 | LOD1 | 8 |

**Materials for cost:** clearcoat only on robot hands (`MeshPhysicalMaterial`); shells, bench, mat, cubes, and props use `MeshStandardMaterial`. No RectAreaLight. The shadow map updates once per main frame (`autoUpdate = false`). The laptop screen renders on layer 2 with no shadow update, no post, no crowd, LOD1 arms, at 15 Hz. Policy image cameras (`policy-cameras.ts`) render on layer 3 at the decision rate into their own small targets, no post, then read back with `readPixels` into a reused buffer.

**Geometry bake** (`scripts/bake-meshes.mjs`, output committed to `public/models/so101-render/`):
1. Parse `so101.xml` visual geoms and load each STL.
2. `mergeVertices(1e-4)` → `toCreasedNormals(35°)`.
3. Compute per-vertex **curvature** (normalized signed mean curvature) and **AO** (64-ray hemisphere within the part).
4. Detect the **print axis** (normal of the largest planar face cluster).
5. meshoptimizer `simplify` to LOD1 (35% of indices, error 0.01) and a shadow LOD (15%).
6. Write `{mesh}.lod0.bin`, `{mesh}.lod1.bin`, `{mesh}.shadow.bin`. Format: a 16-byte header (`TLM2`, vertexCount u32, indexCount u32, flags u32), then Float32 positions, Float32 normals, Float32 curvature, Float32 AO (except shadow), and Uint32 indices.
7. Write `manifest.json` with per-mesh triangle counts, print axis, and SHA-256 of the source STL.

`scripts/bake-set.mjs` does the same AO/bounce bake for the static set (6.5). The Menagerie `LICENSE` is copied into the render folder.

**Pre-warm** (`src/game/render/prewarm.ts`) behind boot: `compileAsync` walks only visible objects, so instead render **3 warm-up frames into a 1×1 target** with every pooled effect made visible at opacity 0 directly in front of the camera (sparks, streak variants, ripples, bursts, chips, confetti, haze, lock pulse, smears, blob shadows, ghost, reticle overlay, lobby tiles and SDF text), the hit light at intensity 1e-4, both colorways, shadow-casting and instanced variants, the laptop and policy-camera layers, and **each tier's post configuration enabled once**. Then restore visibility and record `renderer.info.programs.length`; WP6 acceptance asserts it never grows afterwards.

### 10.7 Performance budget (60 fps, MacBook Air M1, Chrome, p95 after 5 min)

| Bucket | Budget |
|---|---|
| Input + sim + contact scan (≈ 6.7 steps per frame at 400 Hz) | **1.2 ms** (the bench gate, 4.10) |
| Rules + events + feedback | 0.5 ms |
| Assists (range cue, grab) | 0.1 ms |
| Policy inference on the main thread (trajectory / replay / proxy drivers only) | 0.2 ms |
| Scene update (body transforms, particles, smears, HUD runtime) | 1.0 ms |
| three.js submission (≤ 80 draw calls, ≤ 1.2 M triangles incl. shadow) | 2.0 ms |
| **CPU total** | **≤ 5.0 ms** |
| GPU main pass (DPR 1.25, MSAA 2) | 5.0 ms |
| Shadow pass (shadow LOD) | 1.0 ms |
| Post (merged + N8AO half-res + bloom) | 2.5 ms |
| Laptop screen RT at 15 Hz (amortised) | 0.3 ms |
| **GPU total** | **≤ 9.0 ms** |
| JS heap growth during a 3-round match | < 5 MB, no GC pause > 4 ms |
| First load, cold (WASM 10.1 MB + STL + baked meshes + audio ≤ 6 MB) | ≤ 9 s on 100 Mbps; warm ≤ 4 s |

The GPU numbers are **measured with a real Chrome performance trace on an M1 MacBook Air at M2** (vertical slice), not assumed; if DEFAULT misses, the fallback order is N8AO → SKIP on DEFAULT, then DPR 1.1.

### 10.8 Existing files: keep, replace, delete

| Path | Fate | Owner |
|---|---|---|
| `public/models/robotstudio_so101/so101.xml` + assets + LICENSE/README/CHANGELOG | **Keep untouched** | n/a |
| `public/models/robotstudio_so101/arena.xml` | **Edit:** rename sites `atlas_zone`/`blaze_zone` → `atlas_dock`/`blaze_dock` at the gated positions (2.5); update the model name to `TORQUE LIMIT SO-101 Duel`. **No equality constraints.** Keep cubes, mounts, and option (timestep set at runtime per preset). | WP2 |
| `public/models/robotstudio_so101/arena-arcade.xml` | **Create** (generated by `gen-arcade-model.mjs`, committed) | WP2 |
| `public/models/robotstudio_so101/variants/src/{ridge,sliding_dock,heavy_core}.fragment.xml` and generated `variants/{id}.arcade.xml`, `variants/{id}.stock.xml` | **Create** (hand-written fragments; `gen-arcade-model.mjs` merges each into the Arcade and stock models; `cube_rain` is a rule schedule, not a model) | WP2 |
| `public/mujoco.js`, `public/mujoco.wasm` | Keep; synced by `scripts/sync-mujoco.mjs` | WP1 |
| `public/policies/example-policy.js` | **Rewrite** to obs/3 | WP4 |
| `public/{file,globe,next,vercel,window}.svg` | **Delete** (unused starter art) | WP7 |
| `public/og.png` | **Replace** with a TORQUE LIMIT key-art render (1200×630) | WP7 |
| `src/app/page.tsx` | **Rewrite** → `<ClientEntry/>` | WP1 |
| `src/app/layout.tsx` | **Rewrite**: fonts (Archivo with `axes: ["wdth"]` and italics, Chivo Mono), metadata title `TORQUE LIMIT`, description `Live from the benchtop.`, `<body class="bg-ink-900 overflow-hidden">` | WP7 |
| `src/app/globals.css` | **Rewrite**: tokens, `@theme`, base, kit classes (plate, tag, stamp, hazard, sheen), keyframes | WP7 |
| `src/app/favicon.ico` | **Replace** with a wordmark-needle favicon | WP7 |
| `src/components/arena-app.tsx` | **Delete** | WP1 |
| `src/components/arena-scene.tsx` | **Delete** (spark heat ramp and `onBeforeCompile` size trick ported into `vfx/sparks.ts`) | WP6 |
| `src/components/controller-map.tsx` | **Delete** | WP7 |
| `src/lib/mujoco-engine.ts` | **Delete** (loader trick, geom tables, `contactPointSpeed` ported into `src/game/physics/*`) | WP2 |
| `src/lib/task-space-ik.mjs` | **Delete** (DLS solver ported into `so101-kinematics.ts` as fallback) | WP2 |
| `src/lib/arm-participation.mjs` | **Delete** (validation, trajectory, worker bootstrap ported into `src/game/policy/*`) | WP4 |
| `src/lib/arena-audio.mjs` | **Delete** (scrape/cube recipes ported into `audio/standins.ts`) | WP3 |
| `src/lib/gamepad-controls.mjs`, `src/lib/manual-controls.mjs` | **Delete** (radial deadzone and edge detection ported into `input/gamepad.ts`) | WP3 |
| `tests/mujoco-duel.test.mjs` | **Rewrite** to import `src/game/physics/engine.ts` | WP2 |
| `tests/arena-audio.test.mjs`, `tests/gamepad-controls.test.mjs`, `tests/manual-controls.test.mjs` | **Delete** (replaced) | WP3 |
| `tests/arm-participation.test.mjs` | **Delete** (replaced) | WP4 |
| `README.md` | **Rewrite** (what it is, run, controls, presets, harness quickstart, licenses, audio credits link) | WP1 |
| `AGENTS.md`, `CLAUDE.md` | Keep | n/a |
| `STYLES.md` | **Create** from sections 6 and 7 (semantics table, motion tiers, calibration record) | WP7 |
| `next.config.ts` | Edit: `env: { NEXT_PUBLIC_GIT_SHA }` from `git rev-parse --short HEAD` (fallback `"dev"`); keep `logging` | WP1 |
| `tsconfig.json` | Edit per 10.1; keep `@/*` for `src/app` only | WP1 |
| `eslint.config.mjs` | Edit: ignore `public/mujoco.js`, `public/models/so101-render/**`; add `consistent-type-imports` | WP1 |
| `package.json` | Edit per 10.1 (`"type": "module"`, scripts, pins) | WP1 |

---

## 11. Work packages

### 11.1 Rules of engagement

1. **Seven packages, WP1–WP7.** Each file in the repo belongs to **exactly one** package (the lists in 11.4 are exhaustive and disjoint). A package edits only its own files. If you need a change in another package's file, open an issue to its owner.
2. **`src/game/contracts.ts` (WP1) is the dependency root.** WP1 writes it **first**, verbatim from 11.2, and merges it before any other package starts (milestone **M0**). Two values are filled at M0 from day-0 measurements: `DOCK_CENTER_X` / `DOCK_RADIUS` (WP2's dock geometry gate, 2.5). After M0, a contract change needs a PR approved by every package that imports the changed symbol, and `CONTRACTS_VERSION` gets bumped.
3. **Skeleton-first (M1):** each package merges stub exports for every factory in 11.3. Stubs match the signatures, return inert objects, compile, and pass `tests/import-smoke.test.mjs` in Node. From then on `main` always builds and runs.
4. **Tests** use the fakes in `src/game/testing/fakes.ts` (WP1) to exercise a package without the others.
5. **Milestones:**
   - **M0:** contracts (with gated dock values).
   - **M1:** skeletons, import smoke test, boot to Title.
   - **M2** (vertical slice): human vs JIG and DEADBAND Contender in Arcade with sparks, tok, damage numbers, KO slump, range cue, grab assist; the M1 Air GPU trace (10.7); the `core-race-v1` suite runs.
   - **M3** (content complete): every screen, all personalities, presets, league, harness export/replay/verify/compare, bridge/2 with images, LeRobot export, distance audit signed off.
   - **M4** (polish and verification): section 12 all green, zero audio stand-ins.
6. Commits follow Conventional Commits with the package as scope, e.g. `feat(wp3-feel): add range cue`.

### 11.2 Shared contracts: `src/game/contracts.ts` (owner WP1; written verbatim)

```ts
// src/game/contracts.ts
// TORQUE LIMIT shared contracts. Dependency root for every work package.
// Erasable TypeScript only (no enums/namespaces). verbatimModuleSyntax: import types with `import type`.
import type { PerspectiveCamera } from "three";

export const CONTRACTS_VERSION = "2.0.0";

/* ───────────────────────── primitives ───────────────────────── */
export type Seat = "atlas" | "blaze";
export const SEATS: readonly Seat[] = ["atlas", "blaze"];
export function otherSeat(s: Seat): Seat { return s === "atlas" ? "blaze" : "atlas"; }

export type Vec3 = [number, number, number];
export type QuatWxyz = [number, number, number, number];

export const JOINT_NAMES = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"] as const;
export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_LIMITS: readonly (readonly [number, number])[] = [
  [-1.91986, 1.91986], [-1.7453293, 1.7453293], [-1.69, 1.69],
  [-1.658063, 1.658063], [-2.7438473, 2.7438473], [-0.174533, 1.7453292],
];
export const VIOLATION_TOLERANCE_RAD = 1e-5;
export const GRIP_OPEN = 1.15;
export const GRIP_CLOSED = 0.04;

export const RENDER_SCALE = 2.05;                 // render = sim (x, y, z) → (x·s, z·s, −y·s)
export const MOUNT_X: Readonly<Record<Seat, number>> = { atlas: -0.32, blaze: 0.32 };
export const DOCK_CENTER_X: Readonly<Record<Seat, number>> = { atlas: -0.12, blaze: 0.12 };  // M0: replaced by the gated values (2.5)
export const DOCK_RADIUS = 0.07;                                                              // M0: replaced by the gated value
export const CORE_CUBE_INDEX = 4;
export const CLUTTER_CUBES: readonly number[] = [0, 2, 6, 8];
export const HOME_TIP_EGO: Vec3 = [0.20, 0.0, 0.15];        // wrist_roll axis point
export const GUARD_VOLUME_RADIUS = 0.06;                      // capsule camera_mount → shoulder (5.5.3)

export type PhysicsMode = "arcade" | "harness";              // harness = stock Menagerie parameters
export type MatchPreset = "arcade" | "proving_ground" | "harness" | "demo";
export const PRESET_PHYSICS: Readonly<Record<MatchPreset, PhysicsMode>> =
  { arcade: "arcade", proving_ground: "harness", harness: "harness", demo: "harness" };
export type ScoringProfile = "full" | "physical";
export const PRESET_SCORING: Readonly<Record<MatchPreset, ScoringProfile>> =
  { arcade: "full", proving_ground: "physical", harness: "physical", demo: "physical" };
export type ControlHz = 30 | 50 | 60;
export type ArenaVariantId = "standard" | "ridge" | "sliding_dock" | "heavy_core" | "cube_rain";
export type LoadoutId = "whip" | "pivot" | "anvil";
export type AbilityId = "snap" | "recoil_coil" | "bulwark";
export const LINK_IDS = ["base", "shoulder", "upper_arm", "lower_arm", "wrist", "gripper", "camera_mount", "moving_jaw"] as const;
export type LinkId = (typeof LINK_IDS)[number];
export type ServoStateId = "normal" | "micro_stagger" | "stagger" | "stun" | "cutout" | "offline";
export const SERVO_STATE_CODE: Readonly<Record<ServoStateId, number>> =
  { normal: 0, micro_stagger: 1, stagger: 2, stun: 3, cutout: 4, offline: 5 };

export interface Intents { guard: boolean; charge: boolean; grip: boolean; overdrive: boolean; ability: boolean; burst: boolean; }
export const INTENT_BITS: Readonly<Record<keyof Intents, number>> = { guard: 1, charge: 2, grip: 4, overdrive: 8, ability: 16, burst: 32 };
export function noIntents(): Intents { return { guard: false, charge: false, grip: false, overdrive: false, ability: false, burst: false }; }

/* ───────────────────────── physics (WP2) ───────────────────────── */
export interface ServoProfile { tauScale: number; kpScale: number; kvScale: number; }   // multiplies loadout base; engine caps |τ| ≤ 8.0
export const IDENTITY_PROFILE: Readonly<ServoProfile> = { tauScale: 1, kpScale: 1, kvScale: 1 };

export interface ArmFrame {
  q: Float64Array; qd: Float64Array; qacc: Float64Array;   // len 6
  tau: Float64Array; ctrl: Float64Array;                    // len 6 (actuator_force, ctrl)
  forceRange: Float64Array;                                 // len 6, current |forcerange|
  eePos: Float64Array; eeVel: Float64Array;                 // len 3, world, gripperframe site
  eeQuat: Float64Array;                                     // len 4, world, wxyz, w ≥ 0
  elbowPos: Float64Array;                                   // len 3, world, lower_arm body origin
  wristPos: Float64Array;                                   // len 3, world, gripper body origin (wrist_roll axis point)
  shoulderPos: Float64Array; cameraMountPos: Float64Array;  // len 3, world (guard volume ends)
}
export interface CubesFrame { pos: Float64Array; quat: Float64Array; linvel: Float64Array; }   // 9×3, 9×4 (wxyz), 9×3, world

export interface ArmContactOnset {
  kind: "arm_arm"; t: number; step: number;
  atlasLink: LinkId; blazeLink: LinkId;
  aN: number; bN: number; vN: number;                       // m/s, pre-impulse, along normal (4.1)
  efcForce: number; pos: Vec3; normal: Vec3;                // world; normal points atlas → blaze
}
export interface CubeContactOnset { kind: "cube_arm"; t: number; step: number; cube: number; seat: Seat; link: LinkId; vN: number; pos: Vec3; normal: Vec3; }
export interface TableContactOnset { kind: "arm_table"; t: number; step: number; seat: Seat; link: LinkId; vN: number; efcForce: number; pos: Vec3; }
export interface SelfContactOnset { kind: "self"; t: number; step: number; seat: Seat; linkA: LinkId; linkB: LinkId; }
export type ContactOnset = ArmContactOnset | CubeContactOnset | TableContactOnset | SelfContactOnset;

export interface ActiveContacts {
  armArmTouching: boolean; maxArmForce: number;
  lastCrossContactT: Record<Seat, number>;                  // sim time of the last arm-arm or cube contact on that seat, −1 none
  gripperOnCube: Record<Seat, number>;                      // any gripper geom touching cube index, −1 none
  bothJawsOnCube: Record<Seat, number>;                     // both jaws on the same cube, −1 none
  lastGripperTouch: { cube: Int32Array /* 9, Seat index 0/1 or −1 */; t: Float64Array /* 9 */ };
  opticsImpulse: Record<Seat, number>;                      // Σ normal impulse this step on that seat's camera_mount
}

export interface PhysicsFrame {
  mode: PhysicsMode; dt: number; step: number; simTime: number;
  arms: Record<Seat, ArmFrame>;
  cubes: CubesFrame;
  docks: Float64Array;                                      // 2×3, world dock centres (atlas, blaze); moves in sliding_dock
  nbody: number;
  bodyPosPrev: Float64Array; bodyPosCurr: Float64Array;     // nbody×3, world, sim metres
  bodyQuatPrev: Float64Array; bodyQuatCurr: Float64Array;   // nbody×4, world, wxyz
  onsets: ContactOnset[];                                   // onsets produced by THIS step only (array reused)
  active: ActiveContacts;
}

export interface ModelInfo {
  mujocoVersion: string; modelFile: string; modelSha256: string; so101Sha256: string;
  variant: ArenaVariantId;
  nq: number; nv: number; nu: number; nbody: number;
  bodyNames: readonly string[];
  bodyId: Readonly<Record<Seat, Readonly<Record<LinkId, number>>>>;
  cubeBodyIds: readonly number[];                           // len 9
  hullScoring: boolean;                                     // true for arena-arcade models (4.1)
}

export interface EngineResetOptions {
  mode: PhysicsMode;
  timestep: 0.0025 | 0.005 | number;                        // 1/600 allowed in harness mode (4.10)
  seed: number;                                             // physicsInit substream for this round (cube jitter ±6 mm, start pose ±0.02 rad)
  loadouts: Record<Seat, LoadoutId>;                        // ignored in harness
  homePose: Record<Seat, Float64Array>;                     // len 6
  layout: "duel" | "lobby" | "attract" | "task";
}

export interface SimState {
  time: number; qpos: Float64Array; qvel: Float64Array; ctrl: Float64Array;
  qacc_warmstart: Float64Array;
  servo: Float64Array;                                      // per-actuator [kp, kv, forcerangeHi] ×12 (restores Arcade runtime edits)
}

export interface PhysicsEngine {
  readonly info: ModelInfo;
  readonly frame: PhysicsFrame;
  reset(opts: EngineResetOptions): void;
  setTargets(seat: Seat, targets: ArrayLike<number>): void; // clamps exactly to JOINT_LIMITS; writes data.ctrl
  applyServoProfile(seat: Seat, profile: ServoProfile): void; // arm actuators 0–4; harness: only the Offline profile is accepted
  placeCube(index: number, pos: Vec3 | null): void;         // null → parked (2.0 + 0.1·index, 0, 0.02)
  step(): void;                                             // one mj_step; swaps prev/curr; fills onsets/active/docks
  saveState(out?: SimState): SimState;
  restoreState(state: SimState, slot: "prev" | "curr" | "both"): void; // mj_forward; fills body buffers of that slot
  checksum(): number;                                       // FNV-1a 32 over qpos ∥ qvel ∥ ctrl bytes
  dispose(): void;
}
export type CreatePhysicsEngine = (opts: { mode: PhysicsMode; variant?: ArenaVariantId; modelBaseUrl?: string; nodeFsRoot?: string }) => Promise<PhysicsEngine>;

/* ───────────────────────── kinematics (WP2) ───────────────────────── */
export interface CommandState { yaw: number; elev: number; reach: number; tool: number; roll: number; grip: number; }
export interface So101Kinematics {
  fkTipEgo(q: ArrayLike<number>, out: Float64Array): Float64Array;              // gripperframe site, full FK incl. roll, ego frame
  fkRollAxisEgo(q: ArrayLike<number>, out: Float64Array): Float64Array;         // wrist_roll axis point (gripper body origin), ego
  commandToJoints(cmd: CommandState, out: Float64Array): Float64Array;           // closed-form planar IK on the roll-axis point, clamped
  jointsToCommand(q: ArrayLike<number>, out: CommandState): CommandState;
  solveTipEgo(target: Vec3, pitch: number, seed: ArrayLike<number>, out: Float64Array): { ok: boolean; errorM: number };
  homeCommand(): CommandState;                                                    // roll-axis point at HOME_TIP_EGO
}

/* ───────────────────────── combat (WP2) ───────────────────────── */
export interface AbilityState { id: AbilityId; charges: number; maxCharges: number; cooldownMs: number; cooldownTotalMs: number; activeMs: number; }
export interface SeatCombatState {
  loadout: LoadoutId;
  integrity: number; integrityMax: number;
  heat: number;                                             // 0..100 (telemetry only in physical scoring)
  servoState: ServoStateId; servoStateRemainingMs: number; servoStateTotalMs: number;
  staggerImmuneMs: number; staggerFollowUps: number;
  burstUsed: boolean;
  guardHeld: boolean; deflectLockoutMs: number;
  charging: boolean; charge: number; chargeHoldMs: number;  // charge 0..1
  armoured: boolean;
  releaseBoostMs: number; heavyTagMs: number; heavyTagC: number;
  overdrive: boolean;
  ability: AbilityState;
  protected: boolean;                                       // pointer-lock hold rule (7.3.10): takes no damage
  comboCount: number; lastStrikeT: number;
  damageDealtRound: number; physicalDamageDealtRound: number; firstStrikeT: number;   // −1 when none
}
export interface CoreState {
  phase: "dormant" | "incoming" | "live";
  owner: Seat | null;                                       // seat whose countdown is running or paused
  dockedIn: Seat | null;
  lockInRemainingS: number;
  lockInTotalS: number;                                     // the owner's full lock-in (8, 6, or 4)
  contested: boolean;
  loose: boolean;                                           // true after a pry until re-docked
  lastTouchedBy: Seat | null;
}
export type RoundEndReason = "ko" | "lock" | "time" | "sudden_death_strike" | "sudden_death_tiebreak" | "forfeit";
export interface RoundOutcome { winner: Seat; reason: RoundEndReason; t: number; }
export interface TaskState { id: TaskId; running: boolean; score: number; success: boolean | null; }
export interface CombatSnapshot {
  preset: MatchPreset; scoring: ScoringProfile; round: number; suddenDeath: boolean;
  fightTimeS: number; roundLengthS: number;
  seats: Record<Seat, SeatCombatState>;
  core: CoreState;
  task: TaskState | null;
  outcome: RoundOutcome | null;
}
export type TaskId = "dock_core" | "stack" | "keep_away";
export interface RulesConfig {
  preset: MatchPreset; roundLengthS: number; suddenDeathLengthS: number;
  loadouts: Record<Seat, LoadoutId>;
  lockInS: Record<Seat, number>;                            // 8 or 6 (underdog)
  comebacks: boolean;
  coreIncomingAtS: number; coreDropAtS: number;             // 12, 15 (0, 0 in sudden death)
  variant: ArenaVariantId;
  task: { id: TaskId; seed: number } | null;
  combatDamage: boolean;                                    // false in core-race-v1
}
export interface CarryOver { integrity: Record<Seat, number>; }
export interface RulesStepInput { frame: PhysicsFrame; intents: Record<Seat, Intents>; }
export interface CoreMutationRequest { cube: number; pos: Vec3 | null; }
export interface CombatRules {
  readonly state: CombatSnapshot;
  reset(cfg: RulesConfig, round: number, suddenDeath: boolean, carry: CarryOver | null): void;
  setLive(live: boolean): void;                             // false outside fight/sudden_death: no timers, no damage
  setProtected(seat: Seat, on: boolean): void;
  step(input: RulesStepInput, out: GameEvent[]): void;      // once per physics step; every emitted event carries t and step
  servoProfile(seat: Seat): ServoProfile;                   // current composed profile (Arcade; Offline in every preset)
  profileRevision(seat: Seat): number;                      // increments when servoProfile(seat) changes
  requestPlacements(out: CoreMutationRequest[]): number;    // drop/park/cube-rain commands for the driver to apply this step; returns count
}
export type CreateCombatRules = (info: ModelInfo) => CombatRules;
/** combat/tuning.ts exports this; juice and sim-driver both call it (8.1). */
export type HitstopMsFor = (event: GameEvent, preset: MatchPreset, playerSeat: Seat | null) => number;

/* ───────────────────────── events ───────────────────────── */
export const MATCH_PHASES = [
  "boot", "title", "green_room", "match_intro", "rematch_intro", "round_intro", "fight",
  "ko", "lock", "time_up", "sudden_death", "round_replay", "round_summary",
  "match_replay", "outro", "post_match", "paused", "replay_viewer", "lab_run", "task",
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface EvBase { t: number; step: number; }                  // sim seconds, physics step index
export type GameEvent =
  | (EvBase & { type: "contact"; pos: Vec3; magnitude: number })
  | (EvBase & { type: "strike"; tier: "graze" | "strike"; attacker: Seat; victim: Seat; raw: number; damage: number; physicalDamage: number;
                nu: number; vN: number; zone: LinkId; tool: LinkId; crit: boolean; guarded: boolean; heavyC: number; armoured: boolean;
                pos: Vec3; normal: Vec3; magnitude: number; lethal: boolean; upgrade: boolean; thrownCube: number /* −1 */ })
  | (EvBase & { type: "late_guard"; defender: Seat; attacker: Seat; refund: number; pressLagMs: number })
  | (EvBase & { type: "deflect"; defender: Seat; attacker: Seat; hard: boolean; pressLeadMs: number; pos: Vec3; normal: Vec3 })
  | (EvBase & { type: "clash"; pos: Vec3; normal: Vec3; magnitude: number; heavyWinner: Seat | null })
  | (EvBase & { type: "whiff"; seat: Seat })
  | (EvBase & { type: "charge"; seat: Seat; stage: "start" | "public" | "full" | "release" | "cancel"; c: number })
  | (EvBase & { type: "servo_state"; seat: Seat; state: ServoStateId; durationMs: number; cause: "strike" | "guard_break" | "knockback" | "deflect" | "clash" | "heat" | "ko" | "end" | "second_strike" | "burst" })
  | (EvBase & { type: "burst"; seat: Seat })
  | (EvBase & { type: "heat_warning"; seat: Seat; on: boolean })
  | (EvBase & { type: "overheat"; seat: Seat })
  | (EvBase & { type: "ability"; seat: Seat; ability: AbilityId; phase: "start" | "end" })
  | (EvBase & { type: "table_hit"; seat: Seat; force: number; pos: Vec3 })
  | (EvBase & { type: "combo"; seat: Seat; count: number })
  | (EvBase & { type: "first_strike"; seat: Seat })
  | (EvBase & { type: "low_integrity"; seat: Seat })
  | (EvBase & { type: "ko"; victim: Seat; attacker: Seat; pos: Vec3 })
  | (EvBase & { type: "core"; stage: "incoming" | "drop" | "lock_in_start" | "contested_on" | "contested_off" | "pry" | "lock";
                seat: Seat | null; from: Seat | null; remainingS: number; late: boolean })
  | (EvBase & { type: "flaw"; seat: Seat; flaw: "chains_jabs" | "bites_feints" | "panics"; stage: "exploited" | "patched"; count: number })
  | (EvBase & { type: "task"; task: TaskId; stage: "start" | "success" | "fail"; score: number })
  | (EvBase & { type: "stalemate"; seconds: number })
  | (EvBase & { type: "phase"; phase: MatchPhase; round: number; finalRound: boolean })
  | (EvBase & { type: "round_end"; winner: Seat; reason: RoundEndReason; roundsWon: Record<Seat, number> })
  | (EvBase & { type: "match_end"; winner: Seat; roundsWon: Record<Seat, number> })
  | (EvBase & { type: "policy_fault"; seat: Seat; status: ActionStatus | "disconnect" | "hang"; detail: string })
  | (EvBase & { type: "joint_limit_violation"; seat: Seat; joint: number; overshoot: number })
  | (EvBase & { type: "dda"; seat: Seat; k: number; reason: "exchange" | "loss_streak" | "post_loss_clamp" });
export type GameEventType = GameEvent["type"];

export interface EventBus {
  emit(e: GameEvent): void;                                 // queues for this frame (director and drivers use this)
  pushStepEvents(events: readonly GameEvent[], from: number): void; // sim-driver hands over rules events
  flush(ctx: FeedbackContext): void;                        // delivers the frame's events once, in step order, then clears
  subscribe(fn: (events: readonly GameEvent[], ctx: FeedbackContext) => void): () => void;
}
/** loop/event-ring.ts (WP1): per-seat ring of events since that seat's last observation. */
export interface SeatEventRing { push(events: readonly GameEvent[], from: number): void; drain(seat: Seat, out: GameEvent[]): number; clear(): void; }

/* ───────────────────────── clock (WP1) ───────────────────────── */
export interface GameClock {
  readonly simTime: number; readonly wallTime: number;
  readonly alpha: number;                                   // render interpolation 0..1
  readonly timeScale: number; readonly hitstopRemainingMs: number;
  readonly hitstopBudgetUsedMs: number;                     // freeze used in the rolling 600 ms window
  readonly externalDrive: boolean;
  paused: boolean;
  requestHitstop(ms: number): number;                       // max-merge, single cap 150, budget 120 per 600 ms wall; returns ms granted; arcade only
  requestDilation(scale: number, holdMs: number, easeMs: number): void;  // arcade only
  setRenderAlpha(a: number): void;
  setExternalDrive(on: boolean): void;                      // true: sim-driver skips stepping (replay player drives the engine)
}

/* ───────────────────────── match config (WP1) ───────────────────────── */
export type PersonalityId = "overshoot" | "backlash" | "deadband" | "jig";
export type TierId = "rookie" | "contender" | "pro" | "champion";
export type JigBehavior = "parked_in_reach" | "idle" | "hold_guard" | "slow_heavy" | "sparring" | "chase";
export type ProxyBotId = "human_proxy" | "flick_heat_cap" | "turtle" | "core_camper" | "overdrive_spam" | "jab_spam" | "hook_rhythm" | "heavy_mixer";
export type DriverSpec =
  | { kind: "human" }
  | { kind: "proxy"; bot: ProxyBotId }
  | { kind: "builtin"; personality: PersonalityId; tier: TierId; dda: boolean; behavior?: JigBehavior }
  | { kind: "module"; fileName: string; source: string; sha256: string }
  | { kind: "trajectory"; fileName: string; json: string; sha256: string }
  | { kind: "bridge"; url: string; allowLan: boolean; sessionId: string }
  | { kind: "replay"; episodeId: string; seat: Seat };
export type DriverKind = DriverSpec["kind"];
export type ChunkExecute = "until_next_decision" | "full_chunk" | { nSteps: number };
export type CameraImageId = "wrist" | "overhead" | "front";
export interface ImageRequest { cameras: CameraImageId[]; width: number; height: number; }   // default 224×224
export interface SeatConfig {
  seat: Seat; displayName: string; driver: DriverSpec; loadout: LoadoutId;
  decisionHz: number;                                       // controlHz / decimation
  chunkExecute: ChunkExecute; temporalEnsembleM: number | null;
  images: ImageRequest | null;
}
export interface DemoSessionMeta { operatorId: string; inputDevice: string; sensitivity: number; notes: string; assists: boolean; }
export interface MatchConfig {
  id: string;                                               // ISO time + 4 hex
  preset: MatchPreset; timing: "live" | "eval"; turbo: boolean;
  controlHz: ControlHz; timestep: number;                   // derived by match/presets.ts (4.10)
  seed: number;                                             // uint32
  bestOf: 1 | 3 | 5; roundLengthS: 45;
  variant: ArenaVariantId;
  task: TaskId | null;
  seats: Record<Seat, SeatConfig>;
  actionDelayTicks: 0 | 1 | 2 | 3 | 4 | 5;
  fairDelayMs: number;                                      // applied only when a human/proxy seat faces module/trajectory/bridge
  strictLimits: boolean;
  record: boolean; keepEpisodes: boolean;
  tutorial: boolean;
  fastShow: boolean;
  showKit: boolean;                                         // abilities/overdrive visible (profile.matchesPlayed ≥ 3)
  combatDamage: boolean;
  context: "quick" | "league" | "daily" | "lab" | "tutorial" | "warmup" | "drill" | "suite";
  demo: DemoSessionMeta | null;
  parent: { episodeId: string; branchFrame: number } | null; // take over
}

/* ───────────────────────── policy / observation (WP4) ───────────────────────── */
export type ActionStatus = "ok" | "held" | "late" | "timeout" | "clamped" | "error" | "slow";
export const ACTION_STATUS_CODE: Readonly<Record<ActionStatus, number>> = { ok: 0, held: 1, late: 2, timeout: 3, clamped: 4, error: 5, slow: 6 };

export interface PolicyDebug {
  state?: string; primitive?: string; phase?: string; intent?: string;
  mood?: { aggression: number; composure: number; focus: number };
  utilities?: Record<string, number>; dda?: number;
  parryGuess?: { expectedReleaseT: number; errorMs: number; capped: boolean };
  flaw?: { flaw: "chains_jabs" | "bites_feints" | "panics"; stage: "exploited" | "patched"; count: number };   // sim-driver turns this into a `flaw` GameEvent
}
export interface PolicyAction {
  targets: number[];                                        // len 6, absolute joint targets (rad)
  intents?: Partial<Intents>;
  chunk?: number[][]; chunkHz?: number; chunkStartT?: number;
  intentChunk?: number[];                                   // INTENT_BITS per chunk step, same length and rate as chunk
  debug?: PolicyDebug; info?: unknown;
}
export interface ActionResult { tick: number; requestFrameIndex: number; chunkId: number; action: PolicyAction; computeMs: number; status: ActionStatus; error?: string; }

export const OBS_SCHEMA = "torquelimit.obs/3";
export const OBS_BLOCKS = { state: 12, self_ext: 32, opponent_state: 28, game: 16, environment_state: 81, contacts: 20 } as const;
export type ObsBlockName = keyof typeof OBS_BLOCKS;

export interface ArmObservation {
  q: number[]; qd: number[]; tau: number[]; ctrl: number[];
  ee: { pos: Vec3; quat: QuatWxyz; linvel: Vec3 };          // gripperframe site; quat w ≥ 0
  elbow_pos: Vec3; wrist_pos: Vec3; gripper_opening: number;
  integrity: number; integrity_max: number;
  heat: number; servo_state: ServoStateId; servo_state_remaining_ms: number;  // arcade only; 0 / "normal" otherwise (offline always reported)
  charge_public: number; guard: boolean; loadout: LoadoutId | null;
}
export interface ObsContactEvent {
  kind: "strike" | "graze" | "deflect" | "clash" | "contact" | "cube_hit" | "table_hit";
  attacker: "self" | "opponent" | null; damage_to_self: number; damage_to_opponent: number;
  normal_speed: number; zone: LinkId | null; pos: Vec3; t: number;
}
export interface ObsImages { wrist?: Uint8Array; overhead?: Uint8Array; front?: Uint8Array; width: number; height: number; frameIndex: number; }
export interface Observation {
  schema: typeof OBS_SCHEMA;
  tick: number; frame_index: number; t: number; dt: number; side: Seat; preset: MatchPreset;
  self: ArmObservation; opponent: ArmObservation;           // opponent.ctrl is always zeros
  cubes: { pos: Vec3; quat: QuatWxyz; linvel: Vec3; is_core: boolean; parked: boolean; held_by: "self" | "opponent" | null }[];
  core: { phase: CoreState["phase"]; owner: "self" | "opponent" | null; docked_in: "self" | "opponent" | null;
          lock_in_remaining: number; lock_in_full: number; contested: boolean; loose: boolean };
  contacts: ObsContactEvent[];                              // events since this seat's previous observation
  round: { index: number; best_of: number; phase: MatchPhase; time_remaining: number; phase_length: number;
           rounds_won: { self: number; opponent: number }; sudden_death: boolean };
  last_action: number[];                                    // applied at the previous control tick
  status: { late_steps: number; clamped_steps: number; timeouts: number };
  blocks: { [K in ObsBlockName]: Float32Array };            // section 5.4, exact layouts
  images: ObsImages | null;
}
export interface ResetContext {
  schema: typeof OBS_SCHEMA; protocol: "torquelimit.policy/3"; obs_schema_hash: string;
  side: Seat; seed: number; episode_id: string; round: number;
  control_hz: ControlHz; decision_hz: number; action_delay_ticks: number; fair_delay_ms: number;
  mode: "live" | "eval"; preset: MatchPreset; physics: PhysicsMode; strict_limits: boolean;
  joint_names: readonly string[]; joint_limits: readonly (readonly [number, number])[];
  home_pose: number[];
  arena: { opponent_base: Vec3; midline_x: 0.32; dock_self: Vec3; dock_opponent: Vec3; dock_radius: number; variant: ArenaVariantId };
  rules: { round_length: number; best_of: number; integrity_max: number; loadout: LoadoutId | null; scoring: ScoringProfile };
  task: TaskId | null;
  images: ImageRequest | null;
  config?: { personality?: PersonalityId; tier?: TierId; dda?: boolean; behavior?: JigBehavior };
}
export interface SeatDriver {
  readonly kind: DriverKind; readonly name: string;
  readonly sha256: string | null; readonly claimedSha256: string | null; readonly provenance: Record<string, unknown> | null;
  reset(ctx: ResetContext): Promise<void>;
  warmup(fixture: readonly Observation[]): Promise<void>;   // 8 acts, 60 s budget, not recorded
  request(obs: Observation, tick: number): void;            // non-blocking
  poll(): ActionResult | null;                              // newest completed result not yet returned
  waitForResult(hardAbortMs: number): Promise<ActionResult>; // eval lockstep: no outcome timeout; rejects with "hang" after hardAbortMs
  dispose(): void;
}
export type CreateSeatDriver = (spec: Exclude<DriverSpec, { kind: "human" } | { kind: "replay" } | { kind: "proxy" }>, seat: Seat) => Promise<SeatDriver>;
/** policy/in-process-driver.ts (WP4): same contract without Workers or bundler syntax, for Node. */
export type CreateInProcessSeatDriver = (spec: Exclude<DriverSpec, { kind: "human" } | { kind: "replay" } | { kind: "proxy" }>, seat: Seat, opts: { modulePath?: string }) => Promise<SeatDriver>;

/** policy/proxy-driver.ts (WP4) drives a PilotController through SyntheticInput (WP3). */
export interface SyntheticInput { move(dx: number, dy: number): void; key(code: string, down: boolean): void; button(b: 0 | 2, down: boolean): void; }
export interface ProxyBot { reset(seed: number): void; update(obs: Observation, pilot: PilotController, input: SyntheticInput, wallDtS: number): void; }
export type CreateProxyBot = (id: ProxyBotId) => ProxyBot;

export interface ObservationBuilder {
  build(seat: Seat, frame: PhysicsFrame, combat: CombatSnapshot,
        match: { round: number; bestOf: number; phase: MatchPhase; phaseLengthS: number; roundsWon: Record<Seat, number> },
        lastApplied: Float64Array, status: Observation["status"], tick: number, frameIndex: number,
        events: readonly GameEvent[], images: ObsImages | null, out?: Observation): Observation;
}
export interface ObservationDelayLine { push(obs: Observation): void; read(delayMs: number): Observation; clear(): void; }

export type WorkerRequest =
  | { type: "load"; kind: "builtin" | "module"; source?: string; fileName?: string }
  | { type: "reset"; id: number; ctx: ResetContext; evalClock: boolean }   // worker reseeds Math.random from ctx.seed; evalClock stubs Date/performance
  | { type: "act"; id: number; tick: number; obs: Observation; simTimeMs: number; warmup: boolean };
export type WorkerResponse =
  | { type: "loaded"; name: string; provenance: Record<string, unknown> | null }
  | { type: "reset_ok"; id: number }
  | { type: "action"; id: number; action: PolicyAction; computeMs: number }
  | { type: "error"; id: number | null; message: string; fatal: boolean };

/* ───────────────────────── render-side services (WP6) ───────────────────────── */
export interface PolicyImageSource {
  capture(seat: Seat, req: ImageRequest, frame: PhysicsFrame, out: ObsImages): boolean;  // false if rendering is unavailable (Node, turbo without render)
}

/* ───────────────────────── pilot + camera (WP3) ───────────────────────── */
export interface GhostPose { joints: Float64Array; tipWorld: Float64Array; rollAxisWorld: Float64Array; leashStretch: number; }
export interface RangeCue { flick: boolean; jab: boolean; nearestM: number; flickArcRadiusM: number; jabArcRadiusM: number; }
export type PilotMode = "fight" | "lobby_cursor" | "frozen" | "hold_guard";
export interface InputShapingFlags { leash: boolean; guardBlend: boolean; jabMacro: boolean; chargeWindup: boolean; grabAssist: boolean; dockMagnet: boolean; aimAssist: boolean; }
export interface PilotRules { jabMacro: boolean; chargeMacro: boolean; leash: boolean; guardBlend: boolean; assists: boolean; aimAssist: boolean; showKit: boolean; }
export interface PilotController {
  readonly seat: Seat;
  readonly command: Readonly<CommandState>;                 // pre-shaping command
  readonly ghost: GhostPose;
  readonly intents: Readonly<Intents>;
  readonly stance: { readonly yaw: number; readonly elev: number };   // 250 ms low-pass (3.2)
  readonly look: { readonly yawOffset: number; readonly pitchOffset: number };  // radians, from stance
  readonly rangeCue: Readonly<RangeCue>;
  readonly shaping: Readonly<InputShapingFlags>;            // what shaped the last written ctrl
  readonly reach01: number;
  readonly device: "keyboard_mouse" | "gamepad" | "synthetic";
  readonly locked: boolean; readonly rearming: boolean;
  readonly edgeSimTimes: { guardPress: number };            // sim time stamps (post-freeze rule, 3.5)
  attach(target: HTMLElement): void;
  detach(): void;
  requestLock(): Promise<boolean>;
  setMode(mode: PilotMode): void;
  setRules(rules: PilotRules): void;                        // from the preset (4.10)
  setCursorTarget(egoPoint: Vec3 | null): void;             // lobby: arm points at this ego point
  triggerJab(): void;                                       // lobby tile click
  resetCommand(): void;                                     // home guard
  synthetic(): SyntheticInput;                              // proxy bots
  sampleFrame(wallDtS: number, frozen: boolean): void;
  writeCommand(frame: PhysicsFrame, combat: CombatSnapshot, out: Float64Array): void;
  dispose(): void;
}
export type CreatePilotController = (deps: { kinematics: So101Kinematics; settings: SettingsStore; clock: GameClock; profileMatchesPlayed: () => number }) => PilotController;

export interface CameraPose { position: Vec3; quaternion: [number, number, number, number] /* three xyzw */; fovDeg: number; }
export interface JuiceOutput {
  yaw: number; pitch: number; roll: number;                 // radians, additive
  fovOffsetDeg: number;
  chromaticOffset: number; vignetteBoost: number; desaturate: number;
  edge: { left: number; right: number; top: number; color: string };
  victimVibration: { seat: Seat | null; link: LinkId | null; offset: Vec3 };  // sim metres
  koFocus: { seat: Seat | null; weight: number };           // KO camera hold toward the loser's gripper (8.3)
}
export interface CockpitRig {
  compute(seat: Seat, pilot: PilotController | null, juice: JuiceOutput, frame: PhysicsFrame, settings: Settings, out: CameraPose): CameraPose;
}
export type CreateCockpitRig = () => CockpitRig;

/* ───────────────────────── feedback: juice + audio + announcer (WP3) ───────────────────────── */
export type MusicState = "off" | "title" | "lobby" | "match" | "between_rounds" | "victory" | "defeat";
export type UiCue = "hover" | "select" | "back" | "slam" | "stamp" | "countdown_beat" | "engage" | "tick" | "shutter";
export interface FeedbackContext {
  playerSeat: Seat | null; preset: MatchPreset; phase: MatchPhase;
  combat: CombatSnapshot; names: Record<Seat, string>; opponentIsUserModel: boolean;
  camera: CameraPose | null;                                // last rendered pose (render space)
  fastShow: boolean;
}
export interface AudioControl {
  unlock(): Promise<void>;
  load(onProgress: (done: number, total: number) => void): Promise<void>;   // decode every file during boot
  setMusic(state: MusicState): void;
  playUi(cue: UiCue, whenMs?: number): void;
  setVolumes(v: Settings["audio"]): void;
  readonly hype: number;
  readonly latencyMs: number;
  readonly standinsInUse: readonly string[];
}
export interface Caption { speaker: "OPS"; lineId: string; text: string; priority: 1 | 2 | 3; durationMs: number; }
export interface FeedbackSystem {
  readonly juice: JuiceOutput;
  readonly audio: AudioControl;
  update(wallDtS: number, ctx: FeedbackContext, frame: PhysicsFrame): void;
  dispose(): void;
}
/** feedback-system.ts subscribes itself to the bus inside the factory. Nobody else delivers events to it. */
export type CreateFeedbackSystem = (deps: { clock: GameClock; ui: UiStore; settings: SettingsStore; bus: EventBus }) => FeedbackSystem;

/* ───────────────────────── harness (WP5) ───────────────────────── */
export interface TickRecord {
  frameIndex: number; t: number; round: number; phase: MatchPhase; discontinuity: number;
  obs: Record<Seat, { [K in ObsBlockName]: Float32Array }>;
  delivered: Record<Seat, { [K in ObsBlockName]: Float32Array } | null>;
  applied: Record<Seat, Float64Array>; raw: Record<Seat, Float64Array | null>;
  requestFrameIndex: Record<Seat, number>; obsFrameIndex: Record<Seat, number>;
  chunkId: Record<Seat, number>; chunkIndex: Record<Seat, number>;
  intents: Record<Seat, number>;                            // INTENT_BITS bitfield
  status: Record<Seat, ActionStatus>; computeMs: Record<Seat, number>;   // NaN when not a decision tick
  human: Record<Seat, { command: Float32Array; shaping: number } | null>;
  displayLatencyMs: number;
  images: Record<Seat, ObsImages | null>;
}
export type SimMutation =
  | { kind: "reset"; step: number; seed: number; round: number; state: SimState }
  | { kind: "place_cube"; step: number; index: number; pos: Vec3 | null }
  | { kind: "servo_profile"; step: number; seat: Seat; kp: number[]; kv: number[]; forcerange: number[] }
  | { kind: "timestep"; step: number; dt: number }
  | { kind: "variant"; step: number; id: ArenaVariantId; event: string }
  | { kind: "offline"; step: number; seat: Seat };
export interface SeatMeta {
  driver: DriverKind; name: string; loadout: LoadoutId; personality?: PersonalityId; tier?: TierId; proxyBot?: ProxyBotId;
  policySha256: string | null; claimedSha256: string | null; provenance: Record<string, unknown> | null;
  policyDeterministic: boolean | "unchecked";
  decisionHz: number; chunkExecute: ChunkExecute; temporalEnsembleM: number | null; images: ImageRequest | null;
}
export interface StatsTolerances { attackOnsetSpeed: 0.35; attackOnsetMs: 40; debounceMs: 150; reactionDv: 0.25; reactionWindowMs: 800; anticipationMarginMs: 100; jerkH: 0.02; chatterMin: 0.01; nearLimit: 0.03; violationTol: typeof VIOLATION_TOLERANCE_RAD; }
export interface EpisodeMeta {
  format: "torquelimit.episode/2"; episodeId: string; created: string;
  controlHz: ControlHz; timestep: number;
  seed: number; seedStreams: Record<string, number>;
  preset: MatchPreset; physics: PhysicsMode; scoring: ScoringProfile; timing: "live" | "eval";
  actionDelayTicks: number; fairDelayMs: number; strictLimits: boolean; variant: ArenaVariantId; task: TaskId | null;
  seats: Record<Seat, SeatMeta>;
  inputShaping: Record<Seat, InputShapingFlags | null>;
  demo: DemoSessionMeta | null;
  rules: { roundLengthS: number; bestOf: number };
  tuning: unknown; tuningSha256: string; servoParamsHash: string; tolerances: StatsTolerances;
  parentEpisodeId: string | null; branchFrame: number | null; policyState: "replayed" | "replayed_mismatch" | "cold" | null;
  provenance: { mujoco: string; modelFile: string; modelSha256: string; so101Sha256: string; harnessCommit: string; userAgent: string; contracts: string; obsSchemaHash: string };
}
export interface RoundResultRecord { round: number; winner: Seat; reason: RoundEndReason; tEnd: number; }
export interface MatchResultRecord {
  winner: Seat | null; roundsWon: Record<Seat, number>; rounds: RoundResultRecord[]; forfeit: Seat | null;
  determinism: "unchecked" | "bit_exact" | "diverged"; error: "policy_hang" | null;
}
export interface RleStream { steps: Uint32Array; values: Float64Array | Uint8Array; width: number; }
export interface Episode {
  meta: EpisodeMeta & { result: MatchResultRecord };
  columns: { timestamp: Float64Array; frame_index: Uint32Array; [name: string]: Float64Array | Float32Array | Uint32Array | Int32Array | Int16Array | Uint8Array };
  shapes: Record<string, number[]>;
  steps: { ctrl: RleStream; intents: RleStream; mutations: SimMutation[]; checkpoints: { step: number; state: SimState; checksum: number }[] };
  sparse: Record<string, { frame_index: number; value: unknown }[]>;
  events: GameEvent[];                                      // each carries step; frame_index = floor(step / stepsPerControlTick)
  video: Record<string, { mime: string; frameIndex: Uint32Array; data: Uint8Array }>;   // "blaze.wrist" etc.
}
export interface EpisodeSummary { id: string; created: string; names: Record<Seat, string>; preset: MatchPreset; winner: Seat | null; durationS: number; bytes: number; verdict: "cleared" | "fault" | "arcade" | "none"; pinned: boolean; human: boolean; }
export interface Recorder {
  readonly recording: boolean;
  begin(meta: EpisodeMeta): void;
  tick(rec: TickRecord): void;                              // copies data; caller reuses buffers
  stepCtrl(step: number, frame: PhysicsFrame, intents: Record<Seat, number>): void;   // RLE per physics step
  mutation(m: SimMutation): void;
  checkpoint(step: number, state: SimState, checksum: number): void;
  events(events: readonly GameEvent[]): void;
  sparse(column: string, frameIndex: number, value: unknown): void;
  end(result: MatchResultRecord): Episode;
}
export interface EpisodeCodec { encode(ep: Episode): Promise<Blob>; decode(blob: Blob): Promise<Episode>; toJson(ep: Episode): Promise<Blob>; }   // runs in episode-codec-worker.ts (browser) or inline (Node)
export interface MomentClip { frames: SimState[]; times: number[]; eventT: number; }
export interface MomentBuffer { push(t: number, sim: SimState): void; clip(eventT: number, beforeS: number, afterS: number): MomentClip; clear(): void; }
export interface VerifyResult { verdict: "bit_exact" | "diverged" | "error"; divergedFrame: number | null; divergedT: number | null; eventMismatch: string | null; checkedFrames: number; message: string; }
export interface ReplayPlayer {
  readonly durationS: number; readonly t: number; readonly playing: boolean; readonly rate: number;
  load(ep: Episode): void;
  seek(t: number): void; play(): void; pause(): void; setRate(r: 0.25 | 0.5 | 1 | 2 | 4): void; stepFrames(n: number): void;
  update(wallDtS: number): void;                            // restores prev/curr frames; clock.setRenderAlpha; requires clock.externalDrive
  targetGhost(seat: Seat, out: Float64Array): Float64Array; // recorded sim.ctrl at t
  debugAt(seat: Seat): PolicyDebug | null;
  verify(onProgress: (f: number) => void): Promise<VerifyResult>;
  takeOver(humanSeat: Seat): Promise<MatchConfig>;          // fast-forwards the opponent policy (5.9)
}
export interface PhysicalSeatStats {
  physicalDamageDealt: number; physicalDamageTaken: number; opticsImpulse: number;
  approachSpeed: { median: number; p90: number };
  strikesLanded: number; strikesTaken: number; grazesLanded: number; grazesTaken: number; crits: number;
  attackAttempts: number; accuracy: number; physicalBlockRate: number;
  reactionMs: { rawMedian: number; netMedian: number; p10: number; p90: number; n: number; anticipations: number; noReaction: number; structuralMs: number };
  lockInHeldS: number; pries: number; latePries: number; locks: number;
  computeMs: { median: number; p99: number; max: number }; slowDecisions: number;
  lateFrac: number; timeoutFrac: number; errorFrac: number; clampedFrac: number; reliability: number;
  violationsPerJoint: number[]; maxOvershoot: number; nearLimitDwell: number; torqueSaturationFrac: number;
  actionJerk: number; actionChatter: number; ldlj: number; energyJ: number;
  tableHits: number; selfCollisions: number;
}
export interface ArcadeSeatStats {
  damageDealt: number; damageTaken: number; guardedChips: number; deflects: number; hardDeflects: number; lateGuards: number;
  whiffs: number; whiffPunishes: number; meanHeat: number; cutouts: number; staggersDealt: number; staggersTaken: number; bursts: number;
  heavyAttempts: number; heavySuccesses: number; aiHeavyParryAttempts: number; aiHeavyParrySuccesses: number;
}
export interface EpisodeStats {
  seats: Record<Seat, { physical: PhysicalSeatStats; arcade: ArcadeSeatStats | null }>;
  result: MatchResultRecord; durationS: number;
  verdict: Record<Seat, { stamp: "cleared" | "fault" | "arcade" | "none"; reason: string | null }>;
}
export interface AggregateStats {
  seeds: number; winRate: number; ciLow: number; ciHigh: number;
  rating: number | null; ratingCi: [number, number] | null;
  perOpponent: Record<string, { seeds: number; winRate: number; ciLow: number; ciHigh: number }>;
  rates: { timeout: number; violation: number; hang: number };
}
export type SuiteId = "smoke-v1" | "gauntlet-v2" | "balance-v2" | "exploits-v1" | "core-race-v1" | "heavy-v1" | "tasks-v1";
export interface SuiteOptions { suite: SuiteId; policySeat: Seat | "both"; policy: DriverSpec; seeds?: [number, number]; keepEpisodes: boolean; onProgress: (done: number, total: number, last: EpisodeSummary) => void; signal?: AbortSignal; }
export interface SuiteResult { suite: SuiteId; episodes: string[]; aggregate: AggregateStats; heatmap: Record<string, Record<string, number>>; gates: { name: string; value: number; pass: boolean }[]; }
export interface RegressionReport { comparable: boolean; mismatches: string[]; pairedDelta: number; pValue: number; alpha: number; regressed: boolean; rateFailures: string[]; }
export interface CompareResult { firstDivergenceFrame: number | null; actionDiff: Record<Seat, Float32Array /* frames×6 */>; eventsA: GameEvent[]; eventsB: GameEvent[]; }
export interface StorageInfo { humanBytes: number; otherBytes: number; capBytes: number; wouldEvict: (bytes: number) => number; }
export interface EpisodeStore {
  save(ep: Episode, opts?: { confirmEvict?: (n: number) => Promise<boolean> }): Promise<string>;
  list(): Promise<EpisodeSummary[]>;
  load(id: string): Promise<Episode>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  storage(): Promise<StorageInfo>;
  exportBlob(id: string, format: "tlep" | "json"): Promise<Blob>;
  exportHumanDemos(dir: FileSystemDirectoryHandle | null): Promise<number>;
  importFile(file: File | Blob): Promise<string>;
}
export type CreateEpisodeStore = (kind: "indexeddb" | { fsRoot: string }) => EpisodeStore;   // fs for the Node CLI
export interface HeadlessMatchRunner { run(cfg: MatchConfig, signal?: AbortSignal): Promise<Episode>; }
export type CreateHeadlessMatchRunner = (deps: {
  createEngine: CreatePhysicsEngine; createRules: CreateCombatRules; kinematics: So101Kinematics;
  observations: ObservationBuilder; createSeatDriver: CreateSeatDriver | CreateInProcessSeatDriver;
  createPilot: CreatePilotController | null; createProxyBot: CreateProxyBot | null;
  createRecorder: () => Recorder; images: PolicyImageSource | null;
}) => HeadlessMatchRunner;
export interface HarnessApi {
  readonly recorder: Recorder;
  readonly moments: MomentBuffer;
  readonly store: EpisodeStore;
  readonly codec: EpisodeCodec;
  createRecorder(): Recorder;
  createReplayPlayer(engine: PhysicsEngine, clock: GameClock, rules: CombatRules): ReplayPlayer;
  createReplayDriver(ep: Episode, seat: Seat): SeatDriver;
  computeStats(ep: Episode): EpisodeStats;
  aggregate(eps: readonly EpisodeStats[], subjectSeat: Seat, seedOf: (i: number) => number): AggregateStats;
  compareToBaseline(current: SuiteResult & { meta: EpisodeMeta }, baseline: SuiteResult & { meta: EpisodeMeta }, alpha: number, force: boolean): RegressionReport;
  compare(a: Episode, b: Episode): CompareResult;
  runSuite(opts: SuiteOptions): Promise<SuiteResult>;
  checkDeterminism(ep: Episode): Promise<VerifyResult>;
  checkPolicyDeterminism(driverSpec: DriverSpec, seat: Seat): Promise<boolean>;
}
export type CreateHarnessApi = (deps: {
  createEngine: CreatePhysicsEngine; createRules: CreateCombatRules; createSeatDriver: CreateSeatDriver | CreateInProcessSeatDriver;
  observations: ObservationBuilder; runner: HeadlessMatchRunner; store: EpisodeStore;
}) => HarnessApi;

/* ───────────────────────── UI store, HUD frame, settings (WP1) ───────────────────────── */
export type Screen = "boot" | "title" | "green_room" | "entrants" | "league" | "daily" | "lab" | "replays" | "replay_viewer" | "compare" | "settings" | "match" | "post_match" | "tutorial" | "drill" | "cockpit_choice";
export type Overlay = null | "pause" | "click_to_fight" | "hold_guard";
export interface BestScoreTile { label: "HARDEST HIT" | "FASTEST STRIKE" | "OBJECTIVE"; seat: Seat; value: string; detail: string; }
export interface UiState {
  screen: Screen; overlay: Overlay; phase: MatchPhase;
  loading: { progress: number; label: string } | null;
  match: MatchConfig | null; round: number; roundsWon: Record<Seat, number>;
  captions: Caption | null;
  bestScore: BestScoreTile[] | null;
  lastEpisodeId: string | null; lastStats: EpisodeStats | null;
  replayMomentLabel: string | null;                          // e.g. "IMPACT 2.7 m/s · 31"
  holdSkipProgress: number;                                  // 0..1 (2.2)
  lockHoldRemainingMs: number | null;                        // pointer-lock hold rule
  error: string | null;
}
export interface UiStore {
  get(): Readonly<UiState>;
  set(patch: Partial<UiState>): void;
  subscribe(fn: () => void): () => void;                    // useSyncExternalStore-compatible
}
export interface HudSeat {
  name: string; integrity: number; integrityMax: number; heat: number;
  servoState: ServoStateId; stateRemaining01: number; charge: number; charging: boolean; guard: boolean; overdrive: boolean;
  abilityId: AbilityId; abilityCharges: number; abilityMaxCharges: number; abilityCooldown01: number; abilityActive: boolean;
  grip: "open" | "closed"; roundsWon: number; lowIntegrity: boolean; struckLink: LinkId | null; struckAgeMs: number;
  policy: { label: string; hz: number; computeMs: number; status: ActionStatus; faults: number } | null;
}
export interface HudFrame {
  phase: MatchPhase; round: number; bestOf: number; finalRound: boolean; suddenDeath: boolean;
  timeLeftS: number; playerSeat: Seat | null; preset: MatchPreset; showKit: boolean; showPolicyUi: boolean;
  seats: Record<Seat, HudSeat>;
  core: { visible: boolean; owner: Seat | null; remainingS: number; contested: boolean; loose: boolean; worldPos: Vec3 };
  reticle: { visible: boolean; ghostTipWorld: Vec3; physicalTipWorld: Vec3; reach01: number; leashStretch: number;
             guard: boolean; deflectLocked: boolean; rangeCue: RangeCue; matchesPlayed: number };
  juice: JuiceOutput;
  hitstop: { remainingMs: number; budgetUsedMs: number };
}
export interface Settings {
  controls: { sensitivity: number; verticalMul: number; invertY: boolean; padDeadzone: number; bindings: Record<string, string> };
  camera: { cockpit: "standard" | "stable"; fovDeg: number; motion01: number; ghostOpacity01: number };
  audio: { master: number; sfx: number; music: number; crowd: number; voice: number; captions: "full" | "big" | "off"; operatorVoice: boolean; screenReaderVoice: boolean };
  video: { quality: "auto" | "high" | "default" | "low"; effects01: number; damageNumbers: "on" | "merged" | "off" };
  show: { fast: "auto" | "on" | "off" };
  access: { colorblind: boolean; reducedMotion: boolean; captionScale: number };
  profile: { callsign: string; tutorialDone: boolean; cockpitChosen: boolean; matchesPlayed: number };
}
export interface SettingsStore { get(): Readonly<Settings>; set(patch: DeepPartial<Settings>): void; subscribe(fn: () => void): () => void; }
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/* ───────────────────────── director + game handle (WP1) ───────────────────────── */
export type CameraMode = "cockpit" | "broadcast" | "intro" | "replay" | "lobby" | "lab_overview" | "outro";
export interface MatchDirector {
  readonly phase: MatchPhase;
  readonly config: MatchConfig | null;
  readonly cameraMode: CameraMode;
  readonly cameraSeat: Seat;
  readonly phaseElapsedMs: number;
  enterTitle(): void;
  enterGreenRoom(): void;
  startMatch(cfg: MatchConfig): Promise<void>;
  rematch(): Promise<void>;
  pause(): void; resume(): void; forfeitRound(): void; quitToGreenRoom(): void;
  onPointerLockChange(locked: boolean): void;               // pause or hold rule (7.3.10)
  skip(): void;                                             // skips the current skippable phase
  setHoldSkip(held: boolean): void;                         // 400 ms hold skips the between-round chain
  openReplay(episodeId: string): Promise<void>;             // saves live SimState first; restores on exit
  closeReplay(): void;
}
export interface GameView {
  camera: PerspectiveCamera | null; canvas: HTMLCanvasElement | null; lastPose: CameraPose | null;
  policyImages: PolicyImageSource | null;                   // WP6 sets it once the canvas exists
}
export interface GameHandle {
  readonly engine: PhysicsEngine; readonly rules: CombatRules; readonly kinematics: So101Kinematics;
  readonly clock: GameClock; readonly director: MatchDirector; readonly bus: EventBus;
  readonly pilot: PilotController; readonly cockpit: CockpitRig; readonly feedback: FeedbackSystem;
  readonly harness: HarnessApi; readonly observations: ObservationBuilder; readonly createSeatDriver: CreateSeatDriver;
  readonly ui: UiStore; readonly settings: SettingsStore; readonly hud: HudFrame;
  readonly view: GameView;                                  // WP6 writes camera/canvas/lastPose/policyImages
  readonly replay: ReplayPlayer;
  frameTick(wallDtS: number): void;                         // WP6 calls at useFrame priority −2
  onAfterRender(fn: () => void): () => void;                // WP7 hud-runtime registers
  runAfterRender(): void;                                   // WP6 calls at useFrame priority +2, after the composer
}

/* ───────────────────────── brand (WP7) ───────────────────────── */
export type TokenColor = "ink-900" | "ink-700" | "ink-500" | "paper-50" | "cobalt" | "magenta" | "prize";
export interface BrandMark { viewBox: string; paths: { d: string; fill: TokenColor; stroke?: TokenColor; strokeWidth?: number }[]; }
```

> **Contract notes.** `Observation.opponent.ctrl` is always zeros (the opponent's command is hidden). `ArmObservation.ctrl` for `self` is the real servo target. In `physical` scoring, `heat`, `servo_state` (except `offline`), `charge_public`, and `guard` are reported as 0 / `"normal"` / false. `PilotController` is imported by `ProxyBot` only as a type.

### 11.3 Module map: factory exports every package must provide at M1

| Export | File | Package |
|---|---|---|
| `createGame(): Promise<GameHandle>` | `src/game/game-handle.ts` | WP1 |
| `createGameClock`, `createEventBus`, `createSeatEventRing`, `createUiStore`, `createSettingsStore`, `createHudFrame` | `src/game/loop/game-clock.ts`, `src/game/core/event-bus.ts`, `src/game/loop/event-ring.ts`, `src/game/core/ui-store.ts`, `src/game/core/settings.ts`, `src/game/core/hud-frame.ts` | WP1 |
| `createHeadlessMatchRunner: CreateHeadlessMatchRunner` | `src/game/loop/headless-runner.ts` | WP1 |
| `presetRules(preset): { physics, scoring, timestep, pilotRules, hitstop, fairDelayDefaultMs }` | `src/game/match/presets.ts` | WP1 |
| `createPhysicsEngine: CreatePhysicsEngine` | `src/game/physics/engine.ts` | WP2 |
| `createCombatRules: CreateCombatRules` | `src/game/combat/combat-rules.ts` | WP2 |
| `hitstopMsFor: HitstopMsFor`, `tuning` | `src/game/combat/tuning.ts` | WP2 |
| `createKinematics(): So101Kinematics` | `src/game/kinematics/so101-kinematics.ts` | WP2 |
| `runBrowserBench(): Promise<object>` | `src/game/physics/bench-browser.ts` | WP2 |
| `createPilotController: CreatePilotController` | `src/game/input/pilot-controller.ts` | WP3 |
| `createCockpitRig: CreateCockpitRig` | `src/game/camera/cockpit-rig.ts` | WP3 |
| `createFeedbackSystem: CreateFeedbackSystem` | `src/game/feedback/feedback-system.ts` | WP3 |
| `createSeatDriver: CreateSeatDriver` | `src/game/policy/seat-drivers.ts` | WP4 |
| `createInProcessSeatDriver: CreateInProcessSeatDriver` | `src/game/policy/in-process-driver.ts` | WP4 |
| `createProxyBot: CreateProxyBot` | `src/game/policy/proxy-bots/index.ts` | WP4 |
| `createObservationBuilder(info: ModelInfo): ObservationBuilder`, `createObservationDelayLine(): ObservationDelayLine` | `src/game/policy/observation.ts` | WP4 |
| `act`, `reset`, `policyName` (built-in policy module) | `src/game/policy/opponent/index.ts` | WP4 |
| `createHarnessApi: CreateHarnessApi` | `src/game/harness/harness-api.ts` | WP5 |
| `createEpisodeStore: CreateEpisodeStore` | `src/game/harness/episode-store.ts` (IndexedDB) and `episode-store-fs.ts` (Node) | WP5 |
| `ArenaCanvas: (props: { game: GameHandle }) => JSX.Element` | `src/game/render/arena-canvas.tsx` | WP6 |
| `cameraMath` (pure pose functions for every camera mode) | `src/game/render/camera-math.ts` | WP6 |
| `BroadcastUi: (props: { game: GameHandle }) => JSX.Element` | `src/game/ui/broadcast-ui.tsx` | WP7 |
| `MARKS: Record<"torqueLimit" \| "needle", BrandMark>` | `src/game/brand/marks.ts` | WP7 |

### 11.4 Packages

Every file listed below belongs to exactly one package. Tests live in `tests/` and are owned by the package that lists them.

---

#### WP1: Spine (contracts, loop, match director, presets, headless runner, app shell). **Dependency root.**

**Owns (creates or edits):**
- `src/game/contracts.ts` (**first, M0**), `src/game/testing/fakes.ts`
- `src/app/page.tsx`, `src/game/client-entry.tsx`, `src/game/game-root.tsx`, `src/game/game-handle.ts`
- `src/game/loop/game-clock.ts`, `sim-driver.ts`, `event-ring.ts`, `headless-runner.ts`
- `src/game/match/match-director.ts`, `match-config.ts`, `presets.ts`
- `src/game/core/event-bus.ts`, `ui-store.ts`, `settings.ts`, `rng.ts`, `hud-frame.ts`
- `scripts/sync-mujoco.mjs`
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `README.md`
- deletes `src/components/arena-app.tsx`
- tests: `game-clock`, `hitstop-budget`, `sim-driver`, `event-ring`, `event-bus`, `headless-runner`, `match-director`, `presets`, `replay-state-restore`, `rng`, `settings`, `import-smoke`

**Responsibilities:**
- Contracts verbatim, with the gated dock values at M0. Dependencies and TS/Node config per 10.1.
- `rng.ts`: sfc32 plus SplitMix64 substreams (`physicsInit/round`, `seat/<seat>/round`, `dda`, `arena`, `daily`); `gaussian`, `exGaussian(rng, μ, σ, τ)` with a 120 ms floor.
- `game-clock.ts`: accumulator; hit stop (max-merge, single cap 150 ms, **120 ms per rolling 600 ms wall budget**, returns granted ms, Arcade only); dilation curve; `setRenderAlpha`; `setExternalDrive`.
- `sim-driver.ts`: the loop in 10.3 exactly, including the **break on hit stop**, per-seat event ring, control tick at `stepsPerControlTick` for the preset and control Hz, decision scheduling, live and eval timing (5.3, including the no-outcome-timeout eval wait and 30 s hang abort), warm-up, action-delay queue, `chunk-executor` use, fair-delay line (whenever a human or proxy seat faces module/trajectory/bridge), lenient/strict handling, recorder tick assembly (every column in 5.8, `human.display_latency_ms` from WP6's frame timing), per-step ctrl and intent RLE, mutations (resets, placements, cube rain, servo profiles, offline), checkpoints every 50 ticks, moment buffer at 50 Hz, profile application on revision change, `debug.flaw` and `debug.dda` → `flaw` / `dda` events, protected-seat rule.
- `event-bus.ts`: `emit`, `pushStepEvents`, `flush(ctx)`, `subscribe(fn(events, ctx))`. Events are delivered once per frame in step order.
- `presets.ts`: the 4.10 table as data: physics mode, scoring profile, timestep for control Hz, `PilotRules`, hit stop on/off, default fair delay, comeback rules, allowed variants, result stamp.
- `match-director.ts`: every phase and duration in 2.2 for both show modes and eval step counts, Fast show `auto`, hold-to-skip chain, round/match resolution, underdog lock-in and Core bias config, onboarding gates (`showKit`), attract config, lobby layout, tutorial and drill flows (driving JIG behaviours), task mode, rematch path, **earned replay selection (8.6)**, `saveState` before and `restoreState` after every replay phase and the replay viewer, `clock.setExternalDrive` around replays, pointer-lock hold rule (7.3.10), `UiStore` updates, camera mode per phase, daily and league match configs from WP7's meta module inputs (passed in `MatchConfig`), rep and `matchesPlayed` increments in settings.
- `headless-runner.ts`: the same sim-driver and director with presentation phases collapsed to eval step counts, in-process drivers, optional pilot + proxy bot, fs-less recorder output.
- `hud-frame.ts`: fills `HudFrame` without allocation (including `rangeCue`, `showPolicyUi`, `hitstop`).
- `settings.ts`: defaults from 7.3.8, localStorage v2 with try/catch and a v1 migration that drops removed keys.
- `game-handle.ts`: wires all factories, `onAfterRender` / `runAfterRender`. `game-root.tsx`: one-time creation, loading progress, visibility pause, `?debug=bench` route calling WP2's `runBrowserBench`.
- `fakes.ts`: `fakeFrame`, `fakeCombat`, `fakeEvents.*`, `FakeEngine`, `FakeSeatDriver`, `FakeFeedback`, `FakePilot`, `FakeImageSource`.

**Consumes:** every factory in 11.3.

**Acceptance criteria:**
1. `npm run typecheck`, `lint`, `test`, and `build` pass on `main` at M1 and every day after. `import-smoke` imports every non-React `src/game/**/*.ts` in Node.
2. Director phase table: every row of 2.2 in both show modes, measured with a fake clock (±1 frame); KO → ENGAGE ≤ 4.0 s with Fast show; rematch → ENGAGE = 3.4 s standard.
3. Real-time factor: over 60 s wall in the browser, `simTime` advances 60.0 s ± 0.5% in every preset, deviating only by granted hit stop and dilation.
4. **Hit stop:** a strike emitted at step k of a frame means no step k+1 runs before the freeze ends (`sim-driver` test). The budget test: 10 strikes of m = 1 within 600 ms grant ≤ 120 ms total.
5. With an instant fake policy, live actions apply exactly `actionDelayTicks` ticks after the request. In eval, a fake policy that takes 2 s wall per act changes nothing about the outcome (same checksums as an instant one) and one that never answers errors the episode after 30 s.
6. Events emitted on steps after a seat's last control tick of frame N appear in that seat's observation at frame N+1 (`event-ring` test).
7. After a replay phase, the engine state equals the pre-replay state bit for bit (`replay-state-restore`).
8. React Profiler shows **0 commits** during 10 s of a fight.
9. `sync-mujoco.mjs` fails the build when `public/mujoco.wasm` differs from the package's WASM.

---

#### WP2: Physics, combat rules, kinematics, arena models

**Owns:**
- `public/models/robotstudio_so101/arena.xml`, `arena-arcade.xml`, `variants/**`
- `src/game/physics/engine.ts`, `mujoco-loader.ts`, `model-index.ts`, `contact-scan.ts`, `servo.ts`, `sim-state.ts`, `bench-browser.ts`
- `src/game/combat/combat-rules.ts`, `damage.ts`, `heat.ts`, `servo-states.ts`, `core-objective.ts`, `abilities.ts`, `task-objectives.ts`, `tuning.ts`
- `src/game/kinematics/so101-kinematics.ts`
- `scripts/bench-physics.mjs`, `scripts/gen-arcade-model.mjs`, `scripts/probe-dock-geometry.mjs`
- deletes `src/lib/mujoco-engine.ts`, `src/lib/task-space-ik.mjs`
- tests: `mujoco-duel` (rewrite), `contact-scan`, `arcade-model`, `tunneling`, `core-geometry`, `combat-damage`, `combat-defense`, `combat-heat`, `servo-states`, `core-objective`, `task-objectives`, `hitstop-table`, `kinematics`, `harness-model-immutable`, `physical-scoring`, `physics-determinism`

**Responsibilities:**
- **Day 0 (before M0):** `probe-dock-geometry.mjs` runs the 2.5 gate on the untouched `arena.xml` and hands the passing dock values to WP1.
- **Loader:** a single promise-cached MuJoCo instance; `/mujoco.js` through the indirect import in the browser, `node_modules/@mujoco/mujoco` in Node. Loads `arena-arcade.xml` or variant files for Arcade, `arena.xml` for stock presets.
- **Engine:** per-preset timestep; loadout params at Arcade `reset`; stock values in harness mode; seeded start jitter; cube layouts; prev/curr body buffers; dock positions from sites; onset detection (4.1) with hull mapping in Arcade and the `ncon` early-out; active contacts, optics impulse, last gripper touch; `saveState`/`restoreState` (qpos, qvel, ctrl, qacc_warmstart, servo); FNV-1a checksum over qpos ∥ qvel ∥ ctrl. **Never reads or writes `eq_active`.**
- **Arcade model:** `gen-arcade-model.mjs` per 4.10, and variant generation from fragments.
- **Rules:** everything in 4.2–4.9, 2.4–2.5, and 5.11, exactly, with both scoring profiles; every number in `tuning.ts` (`tuning.arcade`, `tuning.stock`, `v_free` table, vRef table written by the bench); `hitstopMsFor`; outcome detection; events per the union including `late_guard`, `burst`, `charge` stages, `core` pry and lock, `task`, `stalemate`.
- **Kinematics:** analytic FK from `so101.xml` (tip incl. roll and roll-axis point), closed-form planar IK on the roll-axis point, DLS fallback.
- **Bench:** `bench-physics.mjs` prints p50/p95 ms per 16.7 ms of sim for Arcade and stock with both arms in contact, and **measures and writes** the vRef table (4.2) and the `v_free` table (4.6) into `tuning.ts`. `bench-browser.ts` runs the same timing in Chrome.

**Consumes:** `contracts.ts` only.

**Acceptance criteria:**
1. **Hook:** a scripted full hook in Arcade Pivot against a stationary blaze at home is attributed to atlas with ν ≥ 0.9 and damage 31 ± 3; the same at stock gives 31 ± 3 in `physicalDamage`.
2. **Loadout balance:** reference hook damage is 30 ± 3 for Whip, Pivot, and Anvil, and hooks-to-kill differ by ≤ 1 for every loadout pair.
3. **Limp victim:** the same hook into a τ × 0.05 victim is still attributed to the attacker. **Slow push:** an 800 ms ramp scores 0.
4. **Stagger rule:** zero stagger events for a 1.4 rad flick with no contact at every loadout and at stock, a guard press, a Stunned or Cutout arm with a sweeping command, and the built-in HOOK path. A pinned arm pushed by the opponent for 150 ms does stagger.
5. **Combo bound:** follow-up damage within one Stagger ≤ 25; opener plus follow-ups ≤ 60 for every loadout pair. Guarded strikes never stagger.
6. **Deflect window:** −151 ms fails, −150 passes, +5 passes, +6 is a `late_guard`, +31 is neither. A press during the hit stop caused by that onset never deflects it. A charge-cancel press opens no window.
7. **Physical scoring:** a stock episode whose policy toggles guard every tick scores the same damage as the same targets with guard always false; forcing heat to 0 changes nothing.
8. **Heat (Arcade):** flick spam every 250 ms reaches Cutout within 4–8 s; a hook every 1.5 s never does over 30 s.
9. **Offline droop** ≥ 5 cm within 1 s, in every preset.
10. **Dock geometry** (`core-geometry`): the 2.5 gate passes on the committed values. **Pry:** dragging the docked Core out with the opponent gripper emits `pry` and pauses the owner; the prier docking it starts a fresh 6.0 s lock-in.
11. **Harness immutability:** after a full stock match with every intent spammed, every `model.actuator_*` and `dof_*` array equals a fresh compile, except the recorded Offline profile at KO.
12. **Arcade model:** stripping hull geoms from `arena-arcade.xml` reproduces `arena.xml`. **Tunneling:** a Whip hook at max speed aimed at the opponent camera_mount registers an onset in 100 of 100 seeded trials.
13. **IK:** roll-axis point RMS < 1 mm over 2,000 random reachable targets; FK gripperframe matches `site_xpos` within 1e-6 m over 1,000 samples at random roll.
14. **Determinism:** same seed, same per-step ctrl and intents → same checksum after 2,000 steps in every preset and timestep.
15. **Bench:** p95 ≤ 1.2 ms per 16.7 ms of sim in Node and on `?debug=bench` on an M1 Air.
16. **Tasks:** each 5.11 task has a scripted success and failure fixture.

---

#### WP3: Feel (input, command, assists, cockpit camera, juice, audio, operator, haptics)

**Owns:**
- `src/game/input/input-system.ts`, `bindings.ts`, `gamepad.ts`, `pilot-controller.ts`, `assists.ts`, `synthetic-input.ts`, `haptics.ts`
- `src/game/camera/cockpit-rig.ts`, `juice.ts`, `springs.ts`, `noise.ts`
- `src/game/audio/audio-engine.ts`, `asset-loader.ts`, `sfx.ts`, `beds.ts`, `music.ts`, `music-score.ts`, `crowd.ts`, `standins.ts`, `feedback-audio.ts`
- `src/game/announcer/announcer.ts`, `lines.ts`, `screen-reader-voice.ts`
- `src/game/feedback/feedback-system.ts`
- `public/audio/**` (including `vo/` and `CREDITS.md`), `tools/vo/render_lines.py`, `tools/vo/README.md`, `tools/audio/RECORDING.md`
- deletes `src/lib/arena-audio.mjs`, `src/lib/gamepad-controls.mjs`, `src/lib/manual-controls.mjs`, `tests/arena-audio.test.mjs`, `tests/gamepad-controls.test.mjs`, `tests/manual-controls.test.mjs`
- tests: `pilot-controller`, `assists`, `synthetic-input`, `gamepad`, `cockpit-rig`, `juice`, `announcer`, `audio-graph`, `music-score`, `crowd-hype`

**Responsibilities:**
- **Input:** pointer lock with `unadjustedMovement`, `pointerrawupdate`, **RE-ARMING** retry on `pointerlockerror`, key map (3.3), gamepad (3.4), edge buffer with the hit-stop stamping rule (3.5), rebinding.
- **Pilot controller:** command state with reach spring and stance creep (3.1.1), jab/charge/cancel sequencing (3.1.2), wind-up applied to the arm command only, guard blend and yaw-rate cap, leash, `PilotRules` from the preset, ghost pose (FK via WP2), stance low-pass, lobby cursor targeting, `hold_guard` mode, sensitivity × 0.75 while charging, `shaping` flags, `synthetic()` for proxy bots.
- **Assists:** range cue, grab assist, dock magnet, aim assist (3.1.4).
- **Cockpit rig:** eye, stance-driven look with Standard/Stable gains, velocity-based sway with deadzone and slew limit, juice composition, KO focus hold.
- **Juice:** trauma, noise, kick and FOV springs, the 8.1 budget per tier, CA/vignette/desaturation only where 8.1 allows, victim vibration; hit stop requests use WP2's `hitstopMsFor` (sim-driver issues the actual request).
- **Audio:** graph with voiceBus (9.1), asset loading, grain beds (9.3), one-shots (9.4), music score and scheduler (9.5), crowd (9.6), stand-ins (9.7), spatial listener, voice pool, recording and sourcing per 9.2 with `CREDITS.md`.
- **Operator:** scheduler, line bank with copy rules and `readAloudBy`, captions to `UiStore.captions`, pre-rendered VO playback, screen-reader voice with the `localService` filter, `render_lines.py` (Piper, offline).
- **FeedbackSystem:** subscribes itself to the bus in its factory; fans events to juice, audio, operator, haptics; hype model (8.7).

**Consumes:** `contracts.ts`. At runtime: WP2 `So101Kinematics` and `hitstopMsFor` (import), WP1 `GameClock`, `UiStore`, `SettingsStore`, `EventBus`.

**Acceptance criteria:**
1. **Same-frame command:** a mouse delta before `sampleFrame` changes `command`, `ghost`, and `rangeCue` in the same call with no filtering (exact gain formula). `look` changes only through the 250 ms stance filter.
2. **Flick:** an injected 400-count X delta at sensitivity 1.0 gives Δψ = 0.600 rad in one frame; `writeCommand` writes a pan target clamped to q + 0.60.
3. **Reach spring:** W down → `r_offset` +0.12 on the same frame; W up → 0 on the same frame; W held 1.0 s creeps `r_stance` by 0.15 m.
4. **Jab, charge, cancel:** a 150 ms press yields a jab; a 400 ms press yields charge from 180 ms with wind-up on the arm command while `stance` and the reticle anchor don't move; RMB during charge cancels with no deflect edge.
5. **Grab assist:** with a cube 3 cm from the tip, pressing Space aligns roll to the cube face (± 0.05 rad) and places the roll-axis target over the cube centre (± 2 mm) in the same frame; `shaping.grabAssist` is set.
6. **Frozen sampling:** during a freeze the ghost doesn't move; accumulated deltas apply on the first post-freeze frame; a guard press during the freeze carries the post-freeze sim time.
7. **Camera:** a 1.4 rad flick back and forth at 6 Hz moves camera yaw by < 2° peak-to-peak (Standard) and the reticle by the full sweep. Sway stays < 1° over a recorded 30 s fight episode. Camera position is constant.
8. **Gamepad parity:** a −1 → +1 stick sweep in 50 ms gives a 1.80 rad ψ step; radial deadzone.
9. **Juice budget:** for every event type, the number of active channels never exceeds its tier budget (8.1); ordinary strikes never set `chromaticOffset`.
10. **Operator:** ≤ 5 lines per round, ≤ 2 P3, no repeats within 20, P1 interrupts; `lines.ts` passes the copy rules (ratio, no `!`, banned words, ≤ 9 words); numbers never appear in `spoken` text.
11. **Audio:** zero `AudioNode`s created per frame by beds; every one-shot renders in `OfflineAudioContext` (`?debug=audio`) with peak ≤ −0.5 dBFS after the limiter; `standinsInUse` is empty at M4 except the electronic sounds named in 9.2–9.4.
12. **Event-frame audio:** the `tok` onset is ≤ 1 render frame after the strike step (`?debug=feel` log).
13. **Proxy parity:** a `SyntheticInput` sequence produces the same `ctrl` stream as the equivalent recorded real input events.

---

#### WP4: AI opponent, proxy bots, policy runtime

**Owns:**
- `src/game/policy/observation.ts`, `obs-schema.ts`, `seat-drivers.ts`, `in-process-driver.ts`, `policy-worker.ts`, `policy-rng-shim.ts`, `bridge-worker.ts`, `bridge-client.ts`, `action-validation.ts`, `chunk-executor.ts`, `trajectory.ts`, `proxy-driver.ts`
- `src/game/policy/opponent/index.ts`, `perception.ts`, `mind.ts`, `decision.ts`, `primitives.ts`, `motor.ts`, `personalities.ts`, `tiers.ts`, `dda.ts`
- `src/game/policy/proxy-bots/index.ts`, `human-proxy.ts`, `exploit-bots.ts`
- `public/policies/example-policy.js`, `public/policies/fixtures/registration-obs-3.bin`, `public/schemas/torquelimit.obs-3.json`
- `scripts/gen-registration-fixture.mjs`
- deletes `src/lib/arm-participation.mjs`, `tests/arm-participation.test.mjs`
- tests: `observation`, `obs-schema`, `action-validation`, `chunk-executor`, `trajectory`, `seat-drivers`, `rng-shim`, `bridge-client`, `opponent-determinism`, `opponent-behavior`, `opponent-humanness`, `heavy-guess`, `dda`, `flaws`, `proxy-bots`

**Responsibilities:**
- **Observations:** obs/3 exactly per 5.4 (blocks, canonical quaternions, conventions, zeroed Arcade-only fields in physical scoring), images passed through from `PolicyImageSource`, the events window from the ring, the delay line (1.5 s at control rate, nearest-older), and the JSON schema file.
- **Drivers:** Worker drivers for `builtin` and `module` (Blob-URL import with `webpackIgnore`/`turbopackIgnore`, determinism shim, warm-up, `waitForResult`), the in-process driver for Node, `trajectory`, `bridge` (bridge/2 in `bridge-client.ts`, shared by the Worker and Node: seats, session id, schema hash, binary image frames, warm-up, chunk fields, loopback enforcement), the proxy driver (bot + `SyntheticInput` + `PilotController`).
- **Validation:** exact clamp with the 1e-5 violation tolerance, strict/lenient, grip derived from `targets[5]` (5.6).
- **Chunk executor:** `chunkStartT` time indexing, `until_next_decision`, `full_chunk`, `n_steps`, temporal ensemble, `intentChunk`, executed chunk id and index.
- **Built-in opponent:** all of 5.5: FSM, perception with guard volume and public-charge rule, habit model, mood, utility selector, primitives (chunked at 50 Hz), noise, IK via WP2 kinematics, tiers with heavy guess rule, personalities with flaws, scouting signals and adaptation (`debug.flaw`), JIG behaviours, DDA with per-tier targets and loss-streak rule. Seeded only from `ctx.seed`; no `Math.random`, no wall clock.
- **Proxy bots:** 5.5.7.
- **Registration fixture:** `gen-registration-fixture.mjs` samples 200 observations from recorded bot episodes to cover the listed situations.
- `example-policy.js`: guard pose plus a jab every 1.2 s using `obs.opponent.ee.pos`, ~40 lines, commented.

**Consumes:** `contracts.ts`; WP2 `so101-kinematics.ts` (import); WP1 `core/rng.ts` (import); at runtime WP3's `PilotController` (proxy driver) and WP6's `PolicyImageSource`.

**Acceptance criteria:**
1. **Seat rotation symmetry:** building blaze's state by rotating atlas's world state 180° about the table-centre z axis gives dict fields equal to 1e-9 and flat blocks equal under `Math.fround`.
2. **Schema:** the flat blocks match `torquelimit.obs-3.json` index by index; quaternions have w ≥ 0; in physical scoring `game[10..15]` are 0.
3. **Determinism:** the built-in AI gives identical actions over 3,000 acts from the same seed in Node. A module calling `Math.random` and `Date.now` is deterministic under the shim in eval.
4. **Bot sweeps** (headless runner): Pro OVERSHOOT beats JIG `hold_guard` in ≥ 90% of 20 seeds; Champion beats Rookie ≥ 80%; personality pairs at Pro within 35–65% over 50 seeds.
5. **Heavy guess:** against `heavy_mixer`, AI heavy parry success over 30 seeds is ≤ cap + 5 pp at Pro and Champion, and every guess is in `debug.parryGuess`.
6. **Humanness:** built-in net reaction medians within tier μ + τ ± 40 ms and p10 ≥ 150 ms; chatter at Pro ≤ 2 sign changes/s per joint.
7. **Never violates:** 0 violations over 100 bot matches.
8. **Worker safety:** a module that throws, returns NaN, sleeps 600 ms, or returns 7 numbers produces error / error / timeout (live) / error without killing a lenient match; in eval the sleeping module produces `slow` and the same outcome as a fast one.
9. **Chunks:** a 100-step chunk with `full_chunk` executes all 100 entries with no decision requests in between; entries older than the current tick are skipped by `chunkStartT`.
10. **Bridge:** against the reference server, hello → reset → warmup → 500 acts with two seats on one server completes with 0 errors and median round trip < 5 ms; a mismatched `obs_schema_hash` is rejected.
11. **DDA:** after two player match losses, the next match starts at k − 0.2; k never increases in the round after a player round loss.
12. **Example policy** registration passes and it plays a full match.

---

#### WP5: Harness (recording, codec, store, replay, take over, compare, stats, suites, bridge tooling, export, CLI)

**Owns:**
- `src/game/harness/recorder.ts`, `episode-format.ts`, `episode-codec-worker.ts`, `episode-store.ts`, `episode-store-fs.ts`, `moment-buffer.ts`, `replay-player.ts`, `replay-driver.ts`, `takeover.ts`, `compare.ts`, `video-recorder.ts`, `stats.ts`, `aggregate.ts`, `suite.ts`, `determinism.ts`, `provenance.ts`, `harness-api.ts`
- `scripts/eval.mjs`
- `tools/bridge/torquelimit_bridge.py`, `calibration.py`, `test_calibration.py`, `README.md`; `tools/export/to_lerobot.py`, `requirements.txt`
- `docs/HARNESS.md`
- tests: `recorder`, `episode-format`, `episode-store`, `storage-eviction`, `moment-buffer`, `stats`, `aggregate`, `regression-gate`, `replay-verify`, `takeover`, `compare`, `suite`, `eval-cli`

**Responsibilities:**
- **Recorder:** every column and stream in 5.8, preallocated growth in 30 s chunks, RLE per-step ctrl and intents, mutations, checkpoints, events with steps, video via `video-recorder.ts` (WebCodecs).
- **Codec:** the `.tlep` binary container, encoded and decoded in `episode-codec-worker.ts` with transferred buffers (inline in Node); JSON export with 17/9 significant digits.
- **Store:** IndexedDB (`episodes_human` never evicted, `episodes` capped with confirmation, `suite_results`), storage info, pin, export human demos (File System Access API with download fallback); `episode-store-fs.ts` for the CLI.
- **Replay player:** kinematic replay, target ghost, debug lookup, `verify` (per-step re-sim through `createPhysicsEngine` + `createCombatRules` + recorded ctrl, intents, mutations; checksums and event comparison), external-drive handshake with the clock.
- **Take over:** policy fast-forward with assertion and `policyState`; returns the branch `MatchConfig`.
- **Compare:** 5.9.4.
- **Stats:** 5.10.1–5.10.2 as pure functions over recorded events and columns, with tolerances in meta.
- **Aggregates and gate:** seed-unit bootstrap CIs, single-anchor Bradley–Terry with bootstrap CIs, paired regression test, rate-based checks, comparability refusal.
- **Suites:** all of 5.10.4 plus `tasks-v1`, run through the headless runner (Node) or the live runner (browser).
- **Determinism:** episode verify and `checkPolicyDeterminism` on the registration fixture. **Provenance:** SHA-256 via `crypto.subtle` or `node:crypto`; tuning table and hash in meta.
- `scripts/eval.mjs`: `--suite`, `--policy <file.mjs|ws://…|builtin:…|proxy:…>`, `--seat`, `--seeds a-b`, `--baseline <json>`, `--alpha`, `--force-compare`, `--out <dir>`. Exits 0 pass, 1 regression, 2 not comparable. Refuses image suites with a clear message.
- **Python tools:** bridge/2 reference server, calibration defaults and test, LeRobot exporter (5.8), pinned `requirements.txt`. `docs/HARNESS.md`: register, presets, bridge, images, record, replay, verify, compare, suites, CLI, observation tables, calibration table, LeRobot export, alignment conventions.

**Consumes:** `contracts.ts`; factories from WP1 (headless runner), WP2, WP4 through `CreateHarnessApi` deps; WP1 `core/rng.ts`.

**Acceptance criteria:**
1. **Round trip:** record → `.tlep` → import gives byte-identical columns, streams, and events. JSON export → import gives identical float64 and float32 values.
2. **Verify:** a 3-round **bot-vs-bot eval** episode, exported and re-imported, verifies `bit_exact`. A **human-vs-builtin Proving Ground** episode (recorded with a scripted proxy human in the browser) verifies `bit_exact` after the round trip. Mutating one `sim.ctrl` value at step 5,000 returns `diverged` at the first checkpoint after it.
3. **Kinematic replay:** body poses at any seek time match live-recorded poses to 1e-9.
4. **Alignment:** in an episode with actionDelayTicks 1, decimation 2, and fair delay 120 ms, every `action_raw` row's `policy.request_frame_index` points at the row whose delivered observation the fake policy received (fixture policy echoes its input tick).
5. **Stats:** each metric has a hand-built fixture with a known answer (reaction raw and net, jerk on resampled ctrl, chatter, LDLJ, physical block rate, bootstrap CI, rating).
6. **Gate:** a baseline with a different `tuningSha256` exits 2; a copy with 5 of 50 seeds flipped to losses exits 1 at α 0.05; an identical copy exits 0.
7. **Size and speed:** the 5.8 size gate; recorder ≤ 0.3 ms per tick; encoding a 3-round episode never blocks the main thread for more than 8 ms.
8. **Storage:** a 1.1 GB simulated fill asks before evicting and never evicts a human episode.
9. **Take over:** fast-forwarding the built-in AI to frame 900 reproduces the recorded `action_raw` exactly and marks `replayed`.
10. **CLI:** `node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js --out /tmp/tl` completes and writes 6 episodes plus `results.json`.
11. **LeRobot:** `to_lerobot.py` on a sample stock episode produces one dataset episode per round with `observation.state` shape [6], `action` [6], `next.done`, `next.reward`, `task`, monotonic timestamps; `LeRobotDataset("./ds")` loads it; an Arcade episode is refused without `--allow-arcade`; the calibration unit test passes.
12. **CLEARED FOR BROADCAST** logic matches 5.10.3 (fixture per failing reason), and Arcade reports always carry the Arcade stamp.

---

#### WP6: Stage (world rendering, cameras, reticle overlay, lighting, post, VFX, bakes, policy cameras)

**Owns:**
- `src/game/render/arena-canvas.tsx`, `robot-assets.ts`, `robot-decals.ts`, `robot-view.tsx`, `ghost-arm.tsx`, `reticle-overlay.tsx`, `range-arcs.tsx`, `cubes-view.tsx`, `stage.tsx`, `crowd.tsx`, `lobby-tiles.tsx`, `lighting.tsx`, `post-stack.tsx`, `camera-director.tsx`, `camera-math.ts`, `policy-cameras.ts`, `laptop-screen.tsx`, `blob-shadows.ts`, `quality.ts`, `interpolate.ts`, `deck-texture.ts`, `prewarm.ts`
- `src/game/render/vfx/vfx-system.ts`, `sparks.ts`, `bursts.ts`, `ripples.ts`, `smears.ts`, `decals.ts`, `chips.ts`, `confetti.ts`, `haze.ts`, `lock-pulse.ts`, `bench-reset.ts`
- `scripts/bake-meshes.mjs`, `scripts/bake-set.mjs`, `public/models/so101-render/**`, `public/models/set/**`, `public/fonts/**`
- deletes `src/components/arena-scene.tsx`
- tests: `interpolate`, `mesh-bake`, `set-bake`, `vfx-pools`, `camera-math`, `reticle-projection`

**Responsibilities:**
- **Canvas:** config (10.6), `useFrame` priorities (10.3) including the reticle overlay pass and `runAfterRender` at +2, `game.view` writes, frame timing for `display_latency_ms` via `requestVideoFrameCallback`, pre-warm (10.6).
- **Robot assets:** baked LODs with curvature and AO, the shell shader (print layers, breakup, edge wear), decals, colorways and entrant stripes, servo LEDs (dying in sequence on KO), heat strip, team-colour charge glow, rival rim, own-arm dither.
- **Ghost arm, range arcs, hand shadow, reticle overlay** (3.1.3, 7.4.1) in WebGL, drawn from `HudFrame` and the pilot on the same frame.
- **Stage:** bench, mat, tape texture, hopper, lamps, phone, laptop screen, clutter, room, crowd (6.6), baked set AO, blob shadows, lighting and environment (6.5) with the grey-card calibration page `?debug=greycard` and the bloom readback check.
- **Lobby tiles** as meshes with SDF text and colliders, breaking into the chip pool; exposes tile hover/activate callbacks to WP7 through props on `ArenaCanvas`.
- **Post stack** with SKIP-switched effects and uniforms from `feedback.juice`; quality tiers applied only at the bench-reset dip.
- **Camera director:** cockpit pose from `game.cockpit.compute`; `broadcast`, `intro`, `replay`, `lobby`, `lab_overview`, `outro` (no optics PiP — cut by SCOPE 2.2); pure pose math in `camera-math.ts`.
- **Policy cameras:** `PolicyImageSource` for wrist, overhead, and front at the requested size on layer 3.
- **VFX system:** subscribes to `game.bus`; every effect in 6.8 with pools; hit light; bench reset dip on `round_intro`.
- **Bakes:** 10.6 and 6.5; `public/fonts/` holds the Archivo TTFs and `OFL.txt`.

**Consumes:** `contracts.ts`; `GameHandle` at runtime; WP7 `src/game/brand/marks.ts` and `slant.ts` (import).

**Acceptance criteria:**
1. **Pixels match contacts:** spark spawn positions coincide with rendered contact surfaces (0.25× replay check). Interpolation test: α = 0.5 gives the exact lerp/slerp.
2. **Reticle on the same frame:** `?debug=feel` reports 0 px between the reticle bracket centre and the projected ghost tip on every frame of a 30 s flick session.
3. **Spark contrast:** a DEFAULT-tier screenshot of a strike at the midline has spark-pixel luminance contrast ≥ 3:1 against the local background (automated `?debug=contrast` capture), and the same on the bench outside the mat.
4. **Calibration:** `?debug=greycard` values within 6.5 tolerances are recorded in `STYLES.md`; max lit-surface pre-tonemap luminance < bloom threshold.
5. **Performance (DEFAULT, M1 MacBook Air, Chrome):** p95 frame ≤ 16.7 ms over a 3-round match after 5 minutes; ≤ 80 draw calls; ≤ 1.2 M triangles; `renderer.info.programs.length` never grows after pre-warm, including across tier changes and the first crit, deflect, KO, and lock.
6. **Zero allocation:** no `new THREE.*` inside any `useFrame`; heap flat ±2 MB over 60 s of fighting.
7. **Colour:** hands and HUD tokens within ΔE ≤ 3 in a lit frame under the calibrated tone mapping; colourblind mode screenshots pass a simulator check.
8. **Cockpit:** the opponent base and contest zone are visible at FOV 62 for every command in range. Own-arm dither engages within 0.12 render units.
9. **Lobby tiles:** the gripper visibly occludes and is occluded by tiles (depth test screenshot); keyboard activation changes screen with no jab.
10. **Bake:** LOD1 ≤ 35% ±2% of source triangles; manifest hashes match; curvature and AO attributes present.
11. **Pools:** 20 strikes in 1 s never allocate beyond pools.
12. **Policy images:** a 224×224 wrist capture at 25 Hz costs ≤ 1.5 ms per capture on DEFAULT and matches a reference render of the same state within 2/255 per channel.

---

#### WP7: Broadcast UI (screens, HUD DOM, meta progression, brand, styles)

**Owns:**
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/favicon.ico`
- `STYLES.md`, `public/og.png`, deletes `public/{file,globe,next,vercel,window}.svg`
- `src/game/brand/marks.ts`, `wordmark.tsx`, `slant.ts`
- `scripts/measure-font-slant.mjs`
- `src/game/ui/broadcast-ui.tsx`
- `src/game/ui/kit/plate.tsx`, `stamp.tsx`, `slant-button.tsx`, `wipe.tsx`, `count-up.tsx`, `tabs.tsx`, `slider.tsx`, `toggle.tsx`, `glyphs.tsx`, `hazard.tsx`
- `src/game/ui/screens/boot-screen.tsx`, `title-screen.tsx`, `cockpit-choice.tsx`, `green-room.tsx`, `loadout-picker.tsx`, `entrants-screen.tsx`, `register-entrant.tsx`, `league-screen.tsx`, `daily-screen.tsx`, `lab-screen.tsx`, `lab-results.tsx`, `replays-screen.tsx`, `replay-viewer.tsx`, `compare-view.tsx`, `settings-screen.tsx`, `pause-menu.tsx`, `post-match-screen.tsx`, `drill-overlay.tsx`, `tutorial-overlay.tsx`, `click-to-fight.tsx`
- `src/game/ui/hud/hud.tsx`, `hud-runtime.ts`, `tote-board.tsx`, `player-strip.tsx`, `policy-chip.tsx`, `event-feed.tsx`, `damage-numbers.tsx`, `damage-edges.tsx`, `kit-panel.tsx`, `captions.tsx`, `banners.tsx`, `banner-queue.ts`, `core-marker.tsx`, `best-score-strip.tsx`, `match-intro.tsx`, `replay-overlay.tsx`, `hold-skip-bar.tsx`, `debug-overlay.tsx`, `format.ts`
- `src/game/ui/meta/profile.ts`, `league.ts`, `medals.ts`, `daily.ts`, `drills.ts`, `rival.ts`, `scouting.ts`
- deletes `src/components/controller-map.tsx`
- tests: `hud-format`, `banner-queue`, `damage-number-merge`, `styles-tokens`, `copy-labels`, `league`, `medals`, `daily-seed`, `drills-offer`, `scouting`

**Responsibilities:**
- **Brand:** wordmark with the T-crossbar needle and the needle mark as SVG path data (`MARKS`, delivered at M1); `slant.ts` (the measured angle, written by `measure-font-slant.mjs`, also imported by WP6); `Wordmark` with the < 64 px knockout rule.
- **Styles:** tokens, `@theme`, kit classes, keyframes (6.2–6.4, 7.2); `layout.tsx` fonts; `STYLES.md` with the semantics table, motion tiers, and the calibration record WP6 supplies through an issue.
- **Screens:** every screen in 7.3 with the specified behaviour, copy, and motion tier; the green-room cursor raycast (ego z = 0.15 plane → `game.pilot.setCursorTarget`); the DOM menu mirror wired to WP6's tile callbacks; keyboard activation without the jab.
- **HUD DOM:** everything in 7.4 except the WebGL reticle cluster, via `hud-runtime.ts` registered with `game.onAfterRender`; banner queue and caps; policy chip and feed only when `hud.showPolicyUi`.
- **Meta:** rep, levels, cosmetics, league bracket and boss gauntlets, medals, daily seed and scoring, drills offers, rival record, flaw scouting (from `flaw` events), all in localStorage `torquelimit.profile.v2`; produces the `MatchConfig` inputs the director needs (`context`, variant, carried Integrity for gauntlets).
- **Replay viewer, compare view, Lab UI, Entrants registration checklist** over `game.harness`, `game.replay`, `game.director`, and `createSeatDriver` dry runs.
- **Debug overlay** `?debug=feel`.

**Consumes:** `contracts.ts`; `GameHandle` at runtime.

**Acceptance criteria:**
1. **Screenshot review:** every 7.3 screen at 1920×1080 and 1280×720, no overflow or overlap; every label caps and ≤ 3 words (`copy-labels` test over the screen strings); no Unicode symbol glyphs in rendered text (scan); no `backdrop-filter` in `globals.css`.
2. **No per-frame React:** 0 commits during 10 s of fighting while the HUD updates.
3. **Rematch:** post-match → ENGAGE 3.4 s; Enter / R / A start it with no mouse movement. Hold-to-skip reaches the next `round_intro` within 450 ms of press.
4. **Registration:** the example policy shows every check and REGISTERED; a NaN module fails with `FAILED AT FIXTURE n`; cold act latency is shown separately.
5. **Reduced motion:** impact and celebration tiers become ≤ 120 ms fades.
6. **Damage numbers:** merge test (12 + 19 → 31 re-popped); graze shows a tag and no number.
7. **Colour semantics:** `styles-tokens` parses `globals.css` and fails if prize, deflect, or hit tokens are referenced by any class outside their allowed components list; contrast rules in 6.2 pass.
8. **Slant:** `--slant` in `globals.css` and `slant.ts` equal the measured `post.italicAngle`.
9. **League/daily/drills:** unit tests for bracket progression and carried Integrity, deterministic daily seed per date, one drill offer per post-match after the right trigger, SCOUTED only after an `exploited` flaw event.

---

### 11.5 Cross-package integration responsibilities (who wires what)

| Integration | Wired in | By |
|---|---|---|
| All factories → `GameHandle` | `src/game/game-handle.ts` | WP1 |
| Canvas mounting, `frameTick`, `runAfterRender`, camera and `policyImages` writes | `src/game/render/arena-canvas.tsx` | WP6 |
| UI mounting over the canvas | `src/game/game-root.tsx` | WP1 |
| Bus subscribers | `feedback-system.ts` (WP3) and `vfx-system.ts` (WP6) subscribe in their factories; `hud-runtime.ts` (WP7) subscribes on mount. **Nobody calls feedback directly.** | each owner |
| Rules events → bus, event ring, recorder | `sim-driver.ts` | WP1 |
| Hit stop request and loop break | `sim-driver.ts` using WP2's `hitstopMsFor` | WP1 |
| Profile application, Core placements, cube rain (rules → engine, recorded) | `sim-driver.ts` | WP1 |
| Preset → pilot rules, scoring, timestep | `match/presets.ts` → `pilot.setRules`, `RulesConfig`, `EngineResetOptions` | WP1 |
| Juice → post uniforms | `post-stack.tsx` | WP6 |
| Juice → camera | `cockpit-rig.ts` (compute), `camera-director.tsx` (apply) | WP3 / WP6 |
| `HudFrame` → reticle overlay (WebGL) and HUD DOM | `reticle-overlay.tsx` / `hud-runtime.ts` | WP6 / WP7 |
| Captions → HUD | `announcer.ts` sets `UiStore.captions`; `captions.tsx` renders | WP3 / WP7 |
| Hype → crowd visuals | `crowd.tsx` reads `game.feedback.audio.hype` | WP6 |
| Lobby tiles ↔ menu | `lobby-tiles.tsx` callbacks ↔ `green-room.tsx` | WP6 / WP7 |
| Lab → suites, verify, compare | `lab-screen.tsx`, `replays-screen.tsx` call `game.harness` | WP7 |
| `debug.flaw` / `debug.dda` → events → scouting | `sim-driver.ts` → bus → `meta/scouting.ts` | WP1 / WP7 |
| Policy images → observations | `sim-driver.ts` calls `game.view.policyImages.capture` on decision ticks and passes them to `observations.build` | WP1 |
| Proxy bots → pilot | `proxy-driver.ts` uses `pilot.synthetic()` | WP4 |
| Headless runner → CLI and suites | `scripts/eval.mjs`, `suite.ts` | WP5 |

---

## 12. Verification plan

### 12.1 Automated (must be green on `main` for M4)

| Command | Covers | Gate |
|---|---|---|
| `npm run typecheck` | whole tree | 0 errors |
| `npm run lint` | whole tree, incl. `consistent-type-imports` | 0 errors, 0 warnings in `src/game/**` |
| `npm test` | every `tests/*.test.mjs` from 11.4 (≈ 90 files) | 100% pass, full run ≤ 180 s |
| `npm run build` | Next 16 production build, prerender-safe | success, **0 build warnings** (including no critical-dependency warning from the policy worker) |
| `npm run bench` | physics cost | p95 ≤ 1.2 ms per 16.7 ms of sim |
| `npm run probe:docks` | dock geometry gate (2.5) | pass |
| `npm run eval -- --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke` | the Node harness end to end | exit 0, 6 episodes, results.json |
| nightly on the server: `npm run eval -- --suite balance-v2 --policy builtin:deadband:pro --out .eval/balance` | builtin balance, Arcade | pair win rates 35–65%; median round 25–35 s; KO share 45–70%; sudden death < 15%; pries in ≥ 30% of rounds that reach a lock-in |
| nightly: `--suite exploits-v1` | human meta, Arcade | no exploit bot > 55% vs Contender; no bot beats every other bot |
| nightly: `--suite core-race-v1` | Core race by hand | human proxy wins 40–60% |
| nightly: `--suite heavy-v1` | heavies vs parries | heavy success 30–60% at Contender, Pro, Champion; AI heavy parry ≤ cap + 5 pp |
| nightly: `--suite gauntlet-v2 --policy public/policies/example-policy.js` | harness at scale | completes; results archived for the regression gate |

**Key regression tests by name** (each assigned in 11.4):
- `servo-states` (no self-stagger: air hook at every loadout and stock, guard press, Stun/Cutout sweep, AI hook lead)
- `combat-damage` (reference hook 31 ± 3, loadout balance, limp victim, slow push, combo bound ≤ 60)
- `combat-defense` (deflect window edges −150/+5, late guard to +30, no deflect from a hit-stop press, anti-mash, clash priority)
- `physical-scoring` (intents and heat have no effect in stock presets)
- `harness-model-immutable`, `arcade-model`, `tunneling` (100/100)
- `core-geometry`, `core-objective` (pry, fresh lock-in, underdog, Core bias)
- `kinematics` (roll-axis RMS < 1 mm, FK tip 1e-6 m)
- `physics-determinism`
- `observation` (seat rotation symmetry, schema, zeroed fields)
- `opponent-determinism`, `heavy-guess`, `dda`
- `replay-verify` (bot eval 3 rounds bit-exact after `.tlep` round trip; human-vs-builtin Proving Ground bit-exact; mutation diverges)
- `recorder` (alignment columns), `storage-eviction`, `regression-gate`
- `sim-driver` (break on hit stop, action delay, eval no-timeout), `hitstop-budget`, `event-ring`
- `match-director` (phase durations both show modes, KO → ENGAGE ≤ 4 s), `replay-state-restore`
- `juice` (channel budget, no CA on ordinary hits), `cockpit-rig` (camera ignores swings, sway < 1°)
- `announcer` (budget, no repeats, copy rules)
- `import-smoke`

### 12.2 Browser verification (per AGENTS.md: run, check console, screenshot)

Run `npm run dev` and open `http://localhost:3000` in Chrome (primary), plus Safari 17+ and Firefox for a smoke check. If a playtest session opens any media page for reference, mute it immediately (`document.querySelector('video').muted = true`) and pause it.

1. The console shows 0 errors and 0 warnings through boot → cockpit choice → tutorial → green room → a full match → post-match → replay → compare → Lab suite.
2. Screenshots of every screen in 7.3 and of the HUD at: first strike, graze, crit, deflect, late guard, clash, stagger, burst, KO slump (before and after KNOCKOUT), pry, lock, sudden death, low integrity, range cue lit. Save to `docs/design/screens/` and compare against sections 6–8.
3. **Spark contrast:** `?debug=contrast` captures a midline strike on DEFAULT and asserts ≥ 3:1 spark-to-background luminance contrast on the mat and on the bench.
4. **Calibration:** `?debug=greycard` values within tolerance; max lit-surface luminance under the bloom threshold.
5. `?debug=feel` shows fps ≥ 58 at p95, steps/frame stable, reticle-vs-ghost pixel error 0, hit-stop budget ≤ 120 ms per 600 ms, 0 shader compiles after boot, heap flat.
6. `?debug=bench` on an M1 MacBook Air meets the bench gate.
7. `?debug=audio` lists no stand-ins except the electronic procedural sounds (M4).
8. A production build (`npm run build && npm start`) registers `example-policy.js` from a Blob URL and plays a match.

### 12.3 Playtest checklist: the definition of done

"Done" means **every box below is checked by two people who didn't build the feature**, on a MacBook Air (DEFAULT tier) with mouse and keyboard, and once with an Xbox-standard gamepad.

**Feel (P2)**
- [ ] The reticle and ghost move the instant the mouse moves. Nobody describes controls as "floaty" or "laggy" when asked open-ended questions.
- [ ] A fast flick visibly lands harder than a slow drag; testers read the `IMPACT m/s` tag and discover this within 2 minutes.
- [ ] Nobody reports "hits randomly don't land": testers can tell from the range cue whether a flick will connect before they throw it.
- [ ] Every landed strike produces sparks visible against the mat, a recorded tok, a damage number, and (from m ≥ 0.4) a hit stop that sticks without making exchanges feel stuttery. A crit is distinguishable by ear with eyes closed.
- [ ] Getting hit hard tells you the direction (kick plus edge) without looking at the HUD.
- [ ] No tester reports motion sickness in a 10-minute session at default camera settings; flick exchanges don't swing the view. At 0% camera motion there's no shake, kick, sway, or FOV change.
- [ ] No tester ever staggers from their own swing, guard press, or mouse movement while stunned.
- [ ] Gamepad players land full hooks with the swing stick within 3 minutes.

**Fun (P1, P3)**
- [ ] A new player completes Calibration in ≤ 90 s and wins a round against BACKLASH Rookie within their first 3 matches.
- [ ] A new player docks the Core by hand (with the grab assist) in their first match.
- [ ] A 3-match session produces at least one moment testers retell unprompted (a pry, a clutch deflect, a KO slump).
- [ ] After being staggered by a clean hit, testers feel they had an answer (guard, burst) and the round wasn't decided by that one read.
- [ ] Testers charge heavies against Pro and land some of them; nobody concludes "never charge".
- [ ] At least 60% of testers press REMATCH after their first loss. KO → next ENGAGE feels quick with Fast show.
- [ ] After 20 matches, testers can name a next goal (a league tier, a medal, the daily, the rival).
- [ ] Testers can name at least one flaw of each personality after 3 matches against it, and notice when a Pro patches it.
- [ ] In blinded A/B builds (DDA on vs off), testers can't tell which build went easy (≤ 60% correct over 10 testers).
- [ ] Median round is 25–35 s. KO share is 45–70%. Guard-turtling never stalls a round.
- [ ] The Core creates a pry attempt in ≥ 50% of rounds that reach a lock-in.
- [ ] The KO slump reads as satisfying to 8 of 10 testers, and they describe the arm losing power (not an effect).

**Look and sound (P3, 1.4)**
- [ ] Every paused frame reads as a live stream from a workbench. No dashboard remnants, placeholder text, fake numbers, rounded cards, glass blur, or default-browser controls.
- [ ] Every colour on screen has exactly one meaning (6.2.1); testers can say what prize-yellow means after one match.
- [ ] Nothing floats: cubes and arm bases are grounded on every tier.
- [ ] No repeated caption within a 5-match session. Captions on BIG MOMENTS feel sparse. With OPERATOR VOICE on, the voice sounds like a phone speaker, not a GPS.
- [ ] The crowd audibly swells on pries and KOs and groans when the pilot is pried.
- [ ] Music: testers can hum the needle motif after a session.
- [ ] **Distance audit signed off** (1.5): at most two signatures of the reference game survive, reviewed by someone who has played it.

**Model verification (P4)**
- [ ] Register `public/policies/example-policy.js` from Entrants → every check passes (cold act shown) → fight it in PROVING GROUND → post-match MODEL REPORT shows physical stats and CLEARED or FAULT. The same fight in ARCADE shows **ARCADE PHYSICS · NOT VERIFICATION**.
- [ ] In the Lab: blaze = example policy, atlas = BACKLASH Pro, Harness, eval, seed 42, best of 3 → RUN MATCH → export `.tlep` → re-import → VERIFY shows **REPLAY VERIFIED · BIT-EXACT**.
- [ ] A Proving Ground match against a user model, exported and re-imported, also verifies BIT-EXACT.
- [ ] Run `python tools/bridge/torquelimit_bridge.py` with wrist and overhead images enabled, connect via LOCAL BRIDGE, fight it live; the policy chip shows the name, 25 Hz, and compute ms. Kill the process mid-round → `POLICY FAULT · TIMEOUT`, the seat holds, the badge is POLICY FAULT.
- [ ] In eval, a bridge policy with a 2 s first act (simulated CUDA warm-up) produces the same result as a fast one and no fault.
- [ ] A NaN policy fails registration at a named fixture index. A 600 ms-per-act policy logs timeouts in live mode and holds its pose.
- [ ] `smoke-v1` from the Lab UI fills the bracket; EXPORT STATS matches `npm run eval` for the same seeds.
- [ ] Replay: TARGET GHOST shows commands vs arm diverging during servo lag; BRAIN shows the built-in AI's primitive, utilities, and parry guesses.
- [ ] TAKE OVER from a replay frame plays against the fast-forwarded policy, and the new episode shows `parent` and `policyState: replayed`.
- [ ] COMPARE two episodes of different policies on the same seed shows the first divergence frame.
- [ ] `tools/export/to_lerobot.py` converts a stock Lab episode (one dataset episode per round, images included), `LeRobotDataset` loads it, and an Arcade episode is refused without `--allow-arcade`.
- [ ] A DEMO session records operator metadata and exports with `input_shaping` in `meta/info.json`.
- [ ] Stock presets show stock servos: the model report lists `kp 998.22 · kv 2.731 · τ 2.94 N·m · dt 5 ms`, and `harness-model-immutable` is green.
- [ ] RUN SUITE with KEEP EPISODES off doesn't evict any stored episode; human demos are never evicted.

**Performance**
- [ ] 60 fps p95 on an M1 MacBook Air after 5 minutes. No frame > 50 ms during the KO sequence, first spark, first crit, or a quality tier change.
- [ ] Cold load ≤ 9 s, warm ≤ 4 s. Rematch to ENGAGE 3.4 s.

---

## 13. Research conflicts resolved

| Topic | Options in research | Decision (and why) |
|---|---|---|
| Show name | CIRCUIT (finals-feel) vs TORQUE LIMIT (finals-visual) | **TORQUE LIMIT.** Tied to the real servo limit. |
| Setting and scale | Daylight TV arena with hologram crowd (finals-visual) | **A workbench in a maker space at human scale** with real people out of focus. Original, cheap to render, and readable (dark mat). |
| Camera anchor | Base-anchored soft follow (combat) vs shoulder-anchored aim 1:1 (fps-feel) | **Base anchor; camera follows a 250 ms stance filter at gain 0.45 (Standard) or 0.20 (Stable); strikes move the reticle, not the camera.** A 1:1 or unfiltered camera whips with every swing and causes nausea. |
| FOV | 55° vs 72° vs 78° | **62° vertical**, slider 50–80. |
| Hit stop | Sim time scale 0.15 (finals-feel) vs full sim-clock freeze (fps-feel) | **Full sim freeze in Arcade, scaled by m², budgeted 120 ms per 600 ms, command frozen too; none in stock presets**, so a human never gets extra wall-clock perception against a model being verified. |
| Shake | 2.2°/1.2° plus translation vs rotation only | **Rotation only, 1.2° / 2.0°**, and only from heavy hits. |
| Damage basis | force × speed vs normal approach speed ν | **ν, normalised by a measured per-profile hook speed.** Peak force varies 35 → 615 N between near-identical swings; a theoretical terminal speed punished low-damping loadouts. |
| Crit zone | whole gripper and jaw vs camera_mount only | **camera_mount only.** |
| Deflect | faster defender contact speed vs press window | **Press window −150/+5 ms resolved at onset**, late guard to +30 ms as a partial refund; hard deflect bonus kept. |
| Round length / Core | 40 s spawn T−25 vs 45 s spawn +15 s | **45 s, drop at 15 s**, docks gated for reachable pries. |
| Objective drama | Steal inherits countdown (finals-feel) | **Pry pauses; a prier's dock starts a fresh 6 s lock-in.** Keeps late drama without copying the reference game's steal rule. |
| Comebacks | Underdog, Second Wind, Overclock, Steal bonus | **Underdog Dock and Core bias only.** |
| Arcade torque | 2× loadouts vs "don't change the servo" | **2× loadouts in Arcade, stock in Proving Ground, Harness, and Demo**, with an Arcade sticker on every model report. |
| Timestep | 5 ms vs 2.5 ms | **2.5 ms in Arcade with strike hulls; 5 ms (or 1/600 s for 30/60 Hz control) in stock presets.** |
| Tunneling fix | CPU-gated fallback | **Thickness-gated: generated `arena-arcade.xml` hulls, always in Arcade; stock presets untouched.** |
| Physics thread | Worker vs main thread | **Main thread.** 0.093 ms per step measured. Policies run in Workers. |
| AI human-fair delay | 180 ± 30 ms for all bots vs internal lag | **Built-in: internal tiered lag.** **External models vs a seated human in any preset: 120 ms default, recorded.** No human: 0. |
| Tone mapping and AA | SMAA vs MSAA 4 | **AgX or Neutral chosen by grey-card calibration; MSAA 2 + half-res N8AO on DEFAULT**, SMAA on LOW. |
| Team colours | Green/orange vs cobalt/magenta | **Cobalt pilot, magenta AI**, blue/yellow in colourblind mode, one meaning per colour. |
| Type | Condensed display + condensed UI pairing (finals-visual) | **Archivo variable superfamily** with the slant taken from its real italic. |
| Announcer | Piper pre-rendered (finals-feel) vs rare voice (visual) vs `speechSynthesis` (v1) | **One operator, captions by default, optional Piper pre-rendered lines through a phone-speaker EQ**; `speechSynthesis` only as a local-voice accessibility reader. |
| Audio source | All procedural (v1) | **Recorded SO-101 and PLA sounds plus CC0 crowd and instruments**, procedural only for electronics. The constraint is local and free, not "no files". |
| Music | EDM pad progression (v1) | **Studio band in D Dorian with a signature motif**, no vi–IV–I–V. |
| Obs schema | `roboarena.obs/2` flat 64 | **`torquelimit.obs/3`** with LeRobot-native blocks, optional images, published JSON schema. |
| Episode format | Columnar JSON, 50 Hz actions | **`.tlep` binary container with per-step ctrl, mutations, and checkpoints**; bit-exact for any seat type. |
| Human uses AI primitives | optional | **No.** Humans drive the continuous command with physically honest assists; primitives stay AI-only. |
| Bind | weld via `eq_active` | **Cut from v1.** `eq_active` throws in the 3.12.0 bindings. |

---

## 14. Critique resolution log

One line per critique issue, in the order received. "Accepted" means the design changed; "partial" means accepted with a stated deviation; "rejected" carries its justification.

| # | Critic | Severity | Decision | What changed |
|---|---|---|---|---|
| 1 | fun | critical | accepted | Knockback stagger now requires recent contact, a non-shrinking error, and a joint being driven away or stalled vs measured free-space speed; excluded in Stun/Cutout/guard edges/command steps; zero-stagger regression for air hooks, guard press, Anvil (4.6, 12.1). |
| 2 | fun | critical | accepted | Human grab assist and dock magnet in the command layer (3.1.4); `core-race-v1` human-proxy suite gated at 40–60% vs Contender (5.10.4); Arcade Core bias toward the lower-Integrity seat (2.4). |
| 3 | fun | critical | accepted | Docks moved to ±0.12 m, radius 0.07, with a day-0 geometry gate (opponent reaches 2–3 cm past centre at ≤ 85%) that sets contract values before M0; Steal replaced by Pry (last opponent toucher dislodges, clock pauses) (2.5). |
| 4 | fun | critical | accepted | Predictive range cue with IN RANGE bracket state, reach arcs and opponent hand shadow on the mat; W/S reach absolute with spring; tutorial step 1 with JIG parked in reach, 1b teaches reach (3.1.1, 3.1.3, 3.1.4, 7.4.1, 7.3.9). |
| 5 | fun | major | accepted | Hit stop scales with m² (flicks ≤ 21 ms), 120 ms per 600 ms budget, ghost/command frozen with the sim, budget tests (8.1, 11.4 WP1). |
| 6 | fun | major | partial | Guarded hits never stagger, Stagger capped at 450 ms, follow-up decay ×0.6^k, second strike ends Stagger, Burst escape (35 heat, once per round), combo bound test ≤ 60; the scripted "physical knockback" is rejected because P1 forbids scripted forces, and the second strike's own contact separates the arms (4.6). |
| 7 | fun | major | accepted | Heavy armour in the last 200 ms and clash priority, delayable release up to 1 s, 8-heat charge cancel, charge public only from c ≥ 0.25, AI heavy parry caps (Contender 40/Pro 55/Champion 70%) via logged guess error, `heavy-v1` 30–60% gate (4.4, 4.7, 5.5.5). |
| 8 | fun | major | accepted | Camera follows a 250 ms stance filter; strikes move reticle and arm only; camera motion default 60%; STANDARD/STABLE cockpit chosen on first launch (3.2, 7.3.3). |
| 9 | fun | major | accepted | PROVING GROUND and DEMO presets beside ARCADE and HARNESS; Arcade model reports stamped ARCADE PHYSICS · NOT VERIFICATION; optional wrist/overhead/front image observations with LeRobot names; non-combat verification tasks `tasks-v1` (4.10, 5.4, 5.11). |
| 10 | fun | major | accepted | Open Servo League bracket with carried-Integrity boss gauntlets, per-entrant medals, seeded daily challenge with best-run ghost, physical MJCF arena variants, Rival slot with tracked record (7.3.11, 7.3.12). |
| 11 | fun | major | partial | Spoken voice defaults OFF with captions; speechSynthesis kept only as a local-voice screen reader; instead of gibberish robot voices, optional lines are pre-rendered offline (Piper) through a diegetic phone-speaker EQ, which fixes the same problem with intelligible speech (8.5). |
| 12 | fun | major | accepted | Replays only when earned; round summary 1.0 s; Fast show (auto after 5 matches) with 1.6 s intro and 1.5 s loss outro; hold-to-skip chain; keyboard menu activation skips the lobby jab; KO → ENGAGE ≤ 4 s gate (2.2, 8.6, 7.3.3). |
| 13 | fun | major | accepted | DDA targets per tier (Rookie −0.15, Contender −0.05, Pro 0), loss-streak k −0.2, never harder after a player loss (5.5.5). |
| 14 | fun | major | accepted | Proxy exploit bots through the real human control path and nightly `exploits-v1` gates: none > 55% vs Contender, no bot dominates all others (5.5.7, 5.10.4). |
| 15 | fun | major | accepted | 90 s tutorial covers flick, reach, hook, guard, dock only; drills offered after the first relevant loss; graduation vs BACKLASH Rookie; abilities and Overdrive hidden for 3 matches (7.3.9, 7.3.13, 4.8). |
| 16 | fun | minor | accepted | A/D are stance drift; roll moved to Q/E, tool pitch stays on the wheel as advanced; ability on F; warm-up is a menu item (3.3). |
| 17 | fun | minor | partial | GRAZE tier (ν 0.20–0.35) with tick, tag, and soft tap; contact speed shown on every strike; hulls used in Arcade only, since stock presets must keep the untouched model for verification (4.3, 4.10). |
| 18 | fun | minor | accepted | Wind-up offset applies to the arm command only, not stance or reticle anchor; sensitivity ×0.75 while charging (3.1.2). |
| 19 | fun | minor | accepted | Lock loss is pause-equivalent; bridge matches hold the human at guard, protected for 3 s, then forfeit; RE-ARMING retry on `pointerlockerror` (3.3, 7.3.10). |
| 20 | fun | minor | accepted | Flaws hidden until exploited then SCOUTED; Pro/Champion patch a flaw after 3 exploits and the operator calls it (5.5.6, 7.3.4). |
| 21 | ai-slop | critical | accepted | Distance audit table with a two-signature cap and sign-off checkbox; renamed steal/cash-in/fans to pry/lock/rep; one operator voice; no sponsors or mascot; brownout KO; real crowd; flat anodized sheen (1.3, 1.5, 12.3). |
| 22 | ai-slop | critical | accepted | Dark charcoal ESD fight mat under the contest zone; alpha-blended spark streaks with ink edges and HDR cores; guard ripple ink/paper; 3:1 spark contrast test (6.6, 6.8, 12.2). |
| 23 | ai-slop | critical | accepted | Voice OFF by default; Piper pre-rendered `.ogg` through `voiceBus` with EQ; numbers only in captions; speechSynthesis limited to `localService` voices and hides the VOICE slider; section 13 states the real constraint (8.5, 9.1, 13). |
| 24 | ai-slop | critical | accepted | Lifted "zero audio files"; recording plan for the real SO-101 and PLA; CC0 crowd and instruments with credits; studio-band D Dorian score with a motif and motif-variation stingers; procedural only for electronics; stand-ins banned at M4 (9). |
| 25 | ai-slop | major | accepted | Rewrote the line bank: ~70/20/10 call/number/joke ratio, jokes only in P1, no exclamation marks, banned-word list, ≤ 9 words, `readAloudBy` per line, fixed the `{ms}` line; the per-host syntax rule is applied to the single remaining voice (8.5). |
| 26 | ai-slop | major | accepted | Archivo variable superfamily for display and UI plus Chivo Mono; slant from the measured italic angle, no faux skew; wordmark needle is the T crossbar; knockout below 64 px; all symbols as inline SVG (1.3, 6.3, 6.4). |
| 27 | ai-slop | major | accepted | Baked set AO/bounce, blob shadows on every tier, N8AO half-res on DEFAULT with MSAA 2, grey-card exposure calibration choosing AgX or Neutral, curvature/AO bake, print-layer triplanar normal, roughness breakup, decals (6.5, 6.7, 10.6). |
| 28 | ai-slop | major | accepted | Committed to real human scale on a maker-space bench: out-of-focus people with phones, clamp lamps, phone-on-tripod camera, laptop screen, tape-marked docks; hologram crowd and TV props removed (6.6). |
| 29 | ai-slop | major | accepted | Seven semantic colours with a one-meaning table in STYLES.md; strike and crit hues merged into white-hot plus shape; charge in team colour; blue/yellow colourblind pair with white prize; no sponsor hues (6.2). |
| 30 | ai-slop | major | accepted | Integrity panel removed (tote plus strip under the player plate); heat moved to the arm strip plus one thin arc; reach pip dropped; max two rings; ink-core/paper-outline strokes; policy chip and feed hidden vs built-in AI; no brand text in HUD labels (7.4). |
| 31 | ai-slop | major | accepted | Channel budget per magnitude tier (3/5/all); CA only for KO and stagger taken; film grain, glitch pulses, lens crack, speed lines removed; three motion tiers (8.1, 7.2). |
| 32 | ai-slop | major | accepted | KO rebuilt around the slump: LEDs die with relay clicks and spin-down, camera holds ~800 ms, KNOCKOUT after the arm settles; de-rez, chips, sponsor bug removed; confetti only at match end (8.3). |
| 33 | ai-slop | major | accepted | Lobby tiles are depth-tested meshes with drei `<Text>` SDF text breaking into the shared chip pool; the DOM stack is the accessible mirror (7.3.3, WP6). |
| 34 | ai-slop | minor | accepted | Entrants renamed from the control-engineering domain (OVERSHOOT, BACKLASH, DEADBAND, JIG); one tone, dry lab humour; mascot and soda cut (1.3). |
| 35 | ai-slop | minor | accepted | Replay readout is `IMPACT 2.7 m/s · 31` only; ν stays in the Lab and Tab; DAMAGE PER JOULE superlative removed; replays only when earned (8.6, 7.3.7). |
| 36 | ai-slop | minor | accepted | Prime Time variant cut from v1; any later variant must be an original, same-tone-mapping lighting story reviewed on its own (6.5). |
| 37 | ai-slop | minor | accepted | Steady title prompt that reacts to input or mouse move; hazard stripes reserved for danger/contested/fault; loading stripes removed; pause uses an 80% ink scrim over a greyed frozen frame, no blur (7.3.1, 7.3.2, 7.3.10). |
| 38 | feasibility | critical | accepted | Same fix as #1, including the "being driven away" velocity test and the no-evaluation states; WP2 acceptance #4 covers every loadout and stock (4.6). |
| 39 | feasibility | critical | accepted | Full-precision per-step `sim.ctrl`/intents RLE, mutation log with reset SimStates, checkpoints, no rounding anywhere, eval presentation phases in fixed step counts, 3-round bot and human episodes verified after round trip (5.8, 5.9, 2.2). |
| 40 | feasibility | critical | partial | `hitstopMsFor` pure function in tuning.ts; sim-driver requests immediately and breaks the step loop; test for no step k+1. The frozen-buffer render freeze for Harness is rejected: stock presets have no freeze at all, which the harness critic (#69) also required (8.1, 10.3). |
| 41 | feasibility | critical | accepted | `createHeadlessMatchRunner` in WP1 on the same sim-driver/director; `createInProcessSeatDriver` in WP4; fs EpisodeStore in WP5; camera math in `camera-math.ts` (10.3, 11.2, 11.4). |
| 42 | feasibility | major | accepted | Bind cut; no weld in arena.xml; `eqActive` removed from SimState and `eqActiveWritable` from ModelInfo; engine never touches `eq_active` (4.9, 11.2). |
| 43 | feasibility | major | accepted | Window T−150..T+5 resolved at onset; late presses to +30 give a `late_guard` 50% refund with no stun; presses during the causing hit stop excluded, with a test (4.4, 3.5). |
| 44 | feasibility | major | accepted | vRef measured per profile by the bench; damage curve re-based so the reference hook is 30 ± 3 per loadout; Integrity 85/100/115; hooks-to-kill within ±1 test (4.2, 4.3, 4.8). |
| 45 | feasibility | major | accepted | Thickness-based decision; generated `arena-arcade.xml` with 9 mm capsule hulls on gripper, jaw, camera mount, wrist, lower arm mapped to LinkIds; stock presets load untouched arena.xml; 100/100 tunneling test (4.10, 4.1). |
| 46 | feasibility | major | accepted | Sway from 6 Hz filtered joint velocity with deadzone, ±1° clamp, 20°/s slew, scaled by camera motion; < 1° over a recorded fight (3.2, WP3 #7). |
| 47 | feasibility | major | accepted | Calibrated exposure keeps lit surfaces below 1.0; bloom threshold 2.8; emissives ×6–10; readback check that lit surfaces stay under threshold (6.5). |
| 48 | feasibility | major | accepted | DEFAULT DPR 1.25 MSAA 2; RectAreaLight folded into Lightformers; clearcoat only on hands; shadow map updated once per frame; laptop screen on a no-shadow layer; SKIP-switched effects; tier/DPR/MSAA changes only at the round reset; budget measured on an M1 Air at M2 (10.6, 10.7). |
| 49 | feasibility | major | accepted | Bus carries context (`flush(ctx)`, `subscribe(fn(events, ctx))`); feedback subscribes itself; per-seat event ring; events tagged with step and frame_index derived; CONTRACTS_VERSION 2.0.0 (10.3, 11.2, 11.5). |
| 50 | feasibility | major | accepted | No separate HUD rAF: `hud-runtime.update` runs via `onAfterRender` at useFrame +2; reticle, hit ticks, leash, and range arcs drawn in a WebGL overlay; debug pixel-error check (7.1, 7.4.1). |
| 51 | feasibility | major | accepted | `verbatimModuleSyntax`, `consistent-type-imports`, `"type": "module"`, M1 import smoke test (10.1). |
| 52 | feasibility | major | accepted | IK targets the wrist_roll axis point (RMS < 1 mm); gripperframe from full FK incl. roll for reticle, ghost, observations; yaw = pan with the reticle drawn at the FK tip (3.1.1, WP2 #13). |
| 53 | feasibility | minor | accepted | Director saves and restores SimState around replays; `setRenderAlpha` and `setExternalDrive` on GameClock; sim-driver skips stepping under external drive; tests (5.9, 11.2). |
| 54 | feasibility | minor | accepted | `intentChunk` in PolicyAction and bridge/2; built-in PARRY places presses at 20 ms resolution through 50 Hz chunks (5.5.2, 5.6, 5.7). |
| 55 | feasibility | minor | accepted | Hit-stop budget implemented in `clock.requestHitstop` (120 ms per 600 ms, stricter than suggested) with only m ≥ 0.15 hits freezing; test (8.1, WP1). |
| 56 | feasibility | minor | accepted | `.tlep` binary container of little-endian typed arrays, encoded in a Worker with transferred buffers; JSON export only; ≤ 12 MB gate and ≤ 8 ms main-thread block (5.8). |
| 57 | feasibility | minor | accepted | One bench number: p95 ≤ 1.2 ms per 16.7 ms of sim in Node and `?debug=bench` on an M1 Air; contact scan with `ncon` early-out and single-read walk (4.10, 4.1, 10.7). |
| 58 | feasibility | minor | accepted | Pre-warm renders 3 frames to a 1×1 target with every pooled effect visible at opacity 0, hit light at 1e-4, every tier variant; program count asserted stable (10.6). |
| 59 | feasibility | minor | accepted | Module import uses `webpackIgnore`/`turbopackIgnore`; production-build Blob URL registration test; build must have 0 warnings (5.2, 12.1, 12.2). |
| 60 | feasibility | minor | accepted | Rematch 3.4 s everywhere; inline question deleted and tile ownership resolved (tiles WP6, menu mirror WP7); green-room.tsx owns the ego z = 0.15 cursor raycast (2.2, 7.3.3, 11.4). |
| 61 | harness | critical | accepted | Same recording redesign as #39 with full SimState checkpoints (incl. warmstart and servo), mutation stream for resets/placements/profiles, human seats verifiable, gzip round-trip test for a human-vs-builtin episode (5.8, 5.9, WP5 #2). |
| 62 | harness | critical | accepted | Stock presets use `physical` scoring: intents never affect damage, deflects, or outcome; a preset-invariant physical metrics block; test that guard toggling scores identically (4.3, 4.4, 5.10.1, WP2 #7). |
| 63 | harness | critical | accepted | obs/3 blocks with LeRobot-native `observation.state` (6 positions, velocities optional), opponent/game/environment blocks, optional images rendered offscreen and recorded as video, control Hz 30/50/60 via a 1/600 s stock timestep, calibration defaults with unit test (5.4, 5.7, 5.8, 4.10). |
| 64 | harness | critical | accepted | Documented row convention; `policy.request_frame_index`, `policy.obs_frame_index`, `observation.delivered.*` columns; exporter `--align decision|applied`, decision default (5.8). |
| 65 | harness | major | accepted | Exporter refuses Arcade without `--allow-arcade` and writes physics/preset/timestep/servo hash/input shaping; pre-shaping command and per-step shaping flags recorded; DEMO preset with no macros, leash off, operator metadata (4.10, 5.8, 7.3.5). |
| 66 | harness | major | accepted | One rule: in stock presets no heat or servo state affects scoring or outcome; separate `tuning.stock` heat constants as telemetry; Arcade-only obs fields zeroed; forced-heat test (4.5, 4.6, 5.4). |
| 67 | harness | major | accepted | Guard volume defined as a 0.06 m capsule; threat-reducing defined by predicted minimum distance; latency on measured EE velocity, reported raw and net of structural latency; anticipation relative to that floor; jerk/chatter on a common 20 ms applied-ctrl series; tolerances in meta (5.5.3, 5.10.1). |
| 68 | harness | major | accepted | Seed as the unit with bootstrap CIs; single anchor (Contender DEADBAND 1200); draw clause removed; paired per-seed regression test with α; rate-based timeout/violation checks; comparability refusal on model/tuning/MuJoCo/suite/contracts mismatch; 50 seeds (5.10.3, 5.10.4). |
| 69 | harness | major | accepted | Fair delay (default 120 ms, recorded) whenever a human faces an external model in any preset; no render or sim hit stop in stock presets; `human.display_latency_ms` column and net human reaction metrics (5.3, 4.10, 5.8, 5.10.1). |
| 70 | harness | major | accepted | Worker shim seeds `Math.random` from `ctx.seed` and stubs clocks in eval; per-seat per-round seed substreams; CHECK POLICY DETERMINISM recorded in meta; bridge seed and torch determinism documented (5.2, 5.6, 5.7). |
| 71 | harness | major | accepted | Eval never lets wall time change the outcome (slow decisions logged as metrics), 30 s hang abort errors the episode, `warmup` step with 60 s budget (5.3, 5.7). |
| 72 | harness | major | accepted | Every transport receives every obs block (incl. last_action, ctrl, contacts buffer, guard, servo remaining); `seat` and `session_id` in bridge messages; `obs_schema_hash` in hello (5.4, 5.7). |
| 73 | harness | major | accepted | `chunkStartT` with sim-time indexing and past-entry skipping; `chunkExecute` modes (until next decision, full chunk, n steps); runner-side temporal ensemble; executed chunk id/index recorded (5.3, 5.6, 5.8). |
| 74 | harness | major | accepted | Take over fast-forwards the policy on recorded delivered observations with output assertion; `parentEpisodeId`, `branchFrame`, `policyState` in meta (5.9). |
| 75 | harness | major | accepted | LeRobot export per round with fight rows only, monotonic timestamps, `phase`, `discontinuity`, `next.done`, `next.reward`, `task`; lerobot version pinned in requirements (5.8). |
| 76 | harness | minor | accepted | Named sites and bodies for ee/elbow/wrist; tau = `actuator_force`; w ≥ 0 quaternions; dt = control period; phase-relative time with a sudden-death flag; lock-in divided by the owner's full lock-in plus `lock_in_full`; touching defined; JSON schema file imported by Python (5.4). |
| 77 | harness | minor | accepted | Renamed to seat rotation symmetry with a 180° rotation construction; dict at 1e-9, flat blocks with `Math.fround` equality (WP4 #1). |
| 78 | harness | minor | accepted | Exact clamp, violation only above 1e-5 rad with overshoot recorded; policy grip derived from `targets[5]`, `intents.grip` ignored for policies (5.6, 4.9). |
| 79 | harness | minor | accepted | Human episodes never auto-evicted; suites store stats unless KEEP EPISODES; storage meter and WILL EVICT confirmation; EXPORT HUMAN DEMOS bundle (5.8, 7.3.6). |
| 80 | harness | minor | accepted | Full tuning table and hash in meta; stats consume recorded events; bridge hashes stored as `claimed_sha256` with a verbatim provenance object; COMPARE view for same-seed episodes (5.8, 5.9, 5.10). |
| 81 | harness | minor | accepted | Registration runs 200 diverse fixture observations, reports the first failing index, and measures cold first-act latency separately from warm p99 (5.6, 7.3.4). |
