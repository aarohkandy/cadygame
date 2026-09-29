# TORQUE LIMIT: EMOTION BIBLE (binding)

Written 2026-09-26 against branch `fps-duel`, from the nine emotion tracks in `research/emotion/`, the PRIME TIME `ART_BIBLE` in `.claude/workflows/duel-primetime.js`, `SCOPE.md`, `STATUS.md`, and the director's real-GPU notes of today. **Revision 2 (same day)** after the emotion, feasibility, clarity and data critiques; every issue is answered in the resolution log at the end.

**Precedence.** This file overrides `GAME_DESIGN.md` and `SCOPE.md` wherever they disagree. The `ART_BIBLE` (night show) stays binding except where section 5 cuts or retunes a line of it. Where this file is silent, the older documents still apply. The overrides that matter most, so nobody has to diff:

| Older rule | Now |
|---|---|
| `tuning.ts` hit stop `200·m²`, cap 150 (GAME_DESIGN 8.1 still says `133·m²`; the code is the baseline) | one continuous formula for every strike: **`clamp(50 + 125·m, 50, 150)`** (50 at 0, 100 at 0.4, 150 at 0.8); crit +20 inside the cap; guarded `33 + 17·m` on onset only; the 50 ms floor beats the 120/600 budget for the first hit in any window (6) |
| SCOPE 1.3 high-key daylight; GAME_DESIGN 6.5 lighting recipe | PRIME TIME night show as retuned in 5.3: one shadowed key, **no spot lights in the forward shader**, rims as shader fresnel, sweeps as deck-projected pools plus two cones |
| GAME_DESIGN 7.3.9 tutorial as a separate gated screen | **the first match is the tutorial** (2); `tutorial-overlay.tsx` becomes captions inside a real best-of-3 vs BACKLASH |
| GAME_DESIGN JIG sparring opponent (`jig.ts`) | **JIG is deleted as a character.** Its behaviours become BACKLASH's `sparring` mode (2, 4.5). One opponent, one plate, one memory |
| SCOPE 2.2 cut daily, medals, rival | reopened in their smallest form only: daily seed as bout number, 3 medal stamps per opponent (counted from match 2), challenge-file rival (8) |
| GAME_DESIGN 2.3 match intro 6000 ms | **4.0 s first time, 2.4 s on rematch** (2, 3.4) |
| GAME_DESIGN 10.7 budget (≤ 80 draws, ≤ 1.2 M tris) | ≤ 90 draws, **≤ 0.45 M triangles including reflection and shadow**, programs flat for the whole match (10) |
| GAME_DESIGN midpoint twists / any "modifier per round" | **cut entirely** (8.4). Their hours go to the rematch intro and the memory captions |
| ART_BIBLE "hazard stripes", "sponsor graphics on LED boards", "crowd holograms shimmer" | cut or reduced item by item in 5.2 |
| Everything in the director's clutter list | resolved in 5.2 |

Nothing here adds lore. Hosts, sponsors and mascot exist only as *witnesses* that react to what the player did.

**Preconditions for measuring any of this** (12.1 item 11 and the demo): no first-session study and no demo capture until `programs N = M` holds from FIGHT to verdict on the real GPU (10.2 step 1). Until then the fresh-profile walk measures the hitch, not the design.

---

## 1. The emotional promise

TORQUE LIMIT is the feeling of being strapped into a machine that is slightly too heavy for you, in front of people who are watching, across the table from a thing that is clearly thinking about you. You move and the machine strains after your hand; you hit and the room stops for three frames and then answers; you get hit and you learn where from. The opponent breathes, looks at your gripper before it swings, flinches when you land, sulks when it loses a round, and remembers the side you slammed it from. Every match ends with a number that is yours and a button that starts the next one in under three seconds. Nobody explains any of this; the show explains itself.

**The three feelings every match must deliver, in order, and the test for each:**

1. **"It heard me."** (ownership and weight) Within one frame of a mouse move the view turns, the hand-ghost moves, the servo whines, the LED lights; within 45 ms the arm visibly begins to move; then it overshoots and settles like a thing with mass. Test: a new player asked "heavy or laggy?" says "heavy but it does what I say". Section 3.
2. **"Someone is in there."** (the opponent as a character) The arm is never still, looks before it acts, telegraphs heavy attacks for ≥ 250 ms, visibly flinches on the contact frame (render vibration) and commands its recoil within 40 ms of sim time after the freeze, and carries a mood you can read from its posture. It is the same arm from the first hit to the last verdict. Test: five people label 3 s clips of flinch / taunt / celebration / dejection at ≥ 60 %. Section 4.
3. **"I was seen."** (the show reacts) Any action of consequence gets two non-HUD reactions within 300 ms: one from the world (lights, crowd, deck edge) and one from a character (host caption, opponent, own arm), and every landed hit prints a number the player can beat next time. Test: the hype trace crosses 50 at least twice in an average ARCADE match and the verdict screen always shows one stat that belongs to the player, even in a loss. Sections 7, 8.

If a change does not serve one of these three, it is clutter, and section 5 cuts it.

---

## 2. The first 60 seconds

Measured from tab open on a mid laptop. Nothing below requires reading; every prompt is one or two words in Anton on the HUD (with a mouse glyph when it names a button) and disappears on completion. **Match 1 is a real best-of-3 vs BACKLASH Rookie.** Round 1 is BACKLASH's `sparring` mode (it tracks, flinches, winds up and re-approaches, deals 0 damage and takes 0 damage; the round can only end by your lock). Rounds 2 and 3 are real. The first match uses only mouse, LMB and RMB; reach and grip are assisted (defined under the table).

**Hard audio rule:** zero audio before t₀. Chrome and Safari will not start an `AudioContext` before a gesture; the attract sells the game silently. Before t₀ the "alive" signal is visual only: deck LED breath at 0.28 Hz and the attract replay's own motion.

| t | What the player sees and hears | Why (source) |
|---|---|---|
| 0.0–1.5 s | Arena shell from the first bundle: dark bowl, deck LED line breathing, wordmark. The CTA slot reads `LOADING 43 %` in Chivo Mono until `mujoco.wasm`, the mesh bake (10.2 step 3) and the prewarm are done. Silent. | Poki: first pixel ≤ 1.5 s (hooks 2.1) |
| 1.5–6 s | Attract replay, 12 s from one canned episode, captions on, silent: a cockpit flick landing with the freeze and the `SOLID 1.4 m/s` receipt (3 s), a cockpit guard with `BLOCKED` (2 s), a cockpit grab-carry-dock-`LOCKED` (4 s), then the orbit KO slump (3 s) as the promise. Arms appear as soon as the bake lands (≤ 3 s on 20 Mbit/s); until then the shell plays the bowl, the LED line and the wordmark. When loading completes the CTA slams to `CLICK TO FIGHT` (the first pixel of motion the player owns). No cockpit prompt, no settings, no dataset line: wordmark, attract, CTA, nothing else. | attract mode = ad + tutorial (hooks 3.1) |
| click (t₀) | Pointer lock. No lobby. The click plays a 40 ms relay clack at −12 dB (confirmation) and lights out with the crowd murmur at −18 dB on the same frame. If the click arrives while a compile is still finishing (≤ 1.5 s), the boot ritual holds on the amber blink for the difference; the ritual absorbs +1.5 s without reading as a stall. | menus kill conversion |
| t₀ + 0.3–1.8 s | Reveal: key at 0.3 intensity, hemisphere 0, one volumetric cone (`haze.ts`, instanced) aimed at the opponent's mount with its deck-projected pool at full; no light is added or removed. BACKLASH (magenta) does its entrance gesture (a wave); nameplate slams in reading `BACKLASH · ROOKIE` with a `SPARRING` tag and **no bar**; VALE caption: "BACKLASH. Rookie. It's learning you." | reveal cadence (finals-alive P1) |
| t₀ + 1.8–3.6 s | Your power-on ritual, 1.8 s, **no captions**: base LED amber blink, six joints self-test base→gripper (110 ms each, rising servo tick, six-note chord; the servo life bed starts under the first relay click), arm slams to LOWERED with a white flash frame, camera pitch −12°→0 over 400 ms (eyes opening). The three count-in kicks land at eighth notes in the last 0.87 s; the slam to LOWERED is the third kick. | embodiment 8.5: the ritual is the embark; the control map lives on the pause plate (Esc) |
| t₀ + 3.6–4.0 s | Both deck LED edges ignite, one `FIGHT` slam (240 ms in), key snaps to 3.2, both cones return to their sweep bands, first music stab. BACKLASH's gripper is already **inside your reach** (~0.10 m from yours), parked. | spacing: something in reach in ≤ 3 s (feel 3) |
| t₀ + 4–12 s | Caption `HIT IT` with the LMB glyph. Ghost per 3.1 thresholds (ring only; the leash appears if you out-run the arm). First mouse move: same-frame view turn, whine ≤ 5 ms, LED ≤ 1 frame, arm onset ≤ 45 ms, overshoot visible. First contact lands: 50 ms freeze, `tok` on the event frame, 6–18 sparks that stay on the deck, receipt `SOLID 1.4 m/s` under the crosshair, BACKLASH flinches (render shiver on the frame, commanded recoil after the freeze) and looks at you, crowd `ohh` at −10 dB, deck edge flashes cobalt 120 ms, `FIRST BLOOD` slam (no host caption). **Passive fallback:** at +5 s without contact the reticle ring pulses and BACKLASH's gripper drifts 4 cm into yours at 0.05 m/s (a nudge, not a strike); VALE: "Swing the mouse across it." **Cap 12 s**, then the step advances anyway. | feel 4, expressive-ai 4.3, finals-alive P3 |
| t₀ + 12–22 s | BACKLASH rises to the SLAM Kabuki hold and **waits there** (LED saturating, whine rising, breathing attenuated) for up to 3.0 s; from the first frame of the tell the caption reads `GUARD · HOLD RMB` with the mouse glyph. Guard: cyan LED, `BLOCKED`, zero camera shake for the defender, attacker's servo stall growl; the step completes. No guard: the strike lands at m ≈ 0.1 with **zero Integrity loss** (flinch, sound, edge only), and the wind-up repeats after 1.5 s. **Cap 3 wind-ups (~10 s)**; on cap VALE: "We'll come back to that", and the skipped skill becomes the verdict's goal (`BLOCK 3 STRIKES`). | Celeste's small hole (hooks 2.2); feel 7.2 |
| t₀ + 22–25 s | Core drops in a volt light column, within ±0.02 m of your current reach radius and inside ±0.3 rad pan. Caption `GRAB IT` with the Core marker on the cube; your dock ring is visible from the drop, pulsing volt at 2 Hz. BACKLASH `idle`, looks at the Core, then at you (curiosity beat). | expressive-ai 4.9 |
| t₀ + 25–40 s | Grab (assisted: the gripper auto-locks on Core contact): target glow, lock click, contact thump, volt gripper LED; caption `BRING IT HOME`. Carry to your dock: magnet clunk, rising two-note, **no siren in match 1**; caption `HOLD IT · 4` counting down over a **4.0 s** lock-in (the Sudden Death value), tick 1→2→4 Hz. At 2 s BACKLASH does its curiosity sniff toward the Core (a look, no contact) so the countdown has a visible reason. **Cap 20 s** from the drop for grab+dock; on cap the Core re-drops once closer, then VALE coaches. | finals-alive P5, audio 10.E |
| t₀ + 40–44 s | `LOCKED` slam, deck edges chase to cobalt, confetti **no** (match win only), crowd cheer swell 700 ms, jumbotron `1–0`. Round card 3 s: `HARDEST HIT · SOLID 1.4 m/s` (no `NEW PB`, no PB ghost until one match is complete), the bed thins to bass + pad. **The player has won a round by ~44 s (60 s worst case with only mouse contact) without a possible failure.** | Portal order: win first, then risk |
| t₀ + 44–48 s | Round 2 intro, 2.4 s, same arm: BACKLASH's LEDs drop from sparring dim (0.4) to 0 over 150 ms with a slump (0–0.6 s), re-light with its READY signature and the plate slams again **without** the `SPARRING` tag and now **with** its bar (0.6–1.4 s), then its fold-and-wait entrance. VALE (match 1 only): "Sparring's over. It hits back now. Guard when it winds up." Boot ritual 0.6 s version. | round-start ritual (expressive-ai 4.11); one opponent, one relationship |
| t₀ + 48–60 s | A real round, **30 s, no Sudden Death** (a time-up tie resolves by first strike landed, then damage dealt; VALE: "Level. First hit takes it."). BACKLASH breathes at 0.3 Hz, tracks your gripper with 220 ms lag, telegraphs every heavy; the first heavy tell of the round gets `GUARD · HOLD RMB` once more. If you hold guard for 6 s without striking it steps back out of range and VALE coaches "It won't come to you. Flick at it." A passive player gets a beckon taunt, never a POKE. When you are hit you see exactly three faces of one idea: your bar slides in (200 ms) and chunks, `−31` under your plate, the damage edge. No `OPEN` / `WHIP` / `PUNISH` tags in match 1. The player may lose this round; the loss lands after a win and round 3 decides. | hooks 2.4, 3.4 |

**Assist in match 1** (`assists.ts`, ARCADE only, flagged per tick in `human.shaping`): reach auto-tracks the nearest target's depth (BACKLASH's gripper, then the Core) with τ 150 ms; grip auto-locks on Core contact. From match 2: `GRIP · SPACE` is captioned once at the first Core drop and grip assist is off; `REACH · W/S` is captioned the first time the opponent's gripper leaves your range; Q/E is never captioned (pause plate only).

**Text budget for the minute: ≤ 12 events, one at a time, listed:** VALE's intro line, `HIT IT`, `FIRST BLOOD` (slam only), `GUARD · HOLD RMB`, `BLOCKED`, `GRAB IT`, `BRING IT HOME`, `HOLD IT · n`, `LOCKED`, the round card, VALE's round-2 line, `GUARD · HOLD RMB` (once). Coaching fallbacks (passive, turtle, cap) are the only additions and each fires at most once. No `PILOT ONLINE`, no `READY`, no joint captions, no host reaction to the first hit: the number is the receipt under the crosshair.

**Hard rules for the minute:** one caption at a time; the HUD shows **six** elements until match 2: crosshair (its receipt is part of the same node, ≤ 700 ms), opponent plate, own bar (mounted hidden, slides in on the first damage taken), Core marker, one caption, wordmark bottom-left; no heat, no abilities, no deflect window; BACKLASH never deals or takes damage in round 1 and a KO is impossible there.

**`showKit` gate table (per element, keyed on `matchesPlayed` at match start; WP6 and WP7 build from this table, nothing else):**

| Element | Appears |
|---|---|
| The six above | match 1 |
| Timer, round pips | match 2 |
| `DEFLECT` caption on the first parry-able tell; `OPEN` / `WHIP` / `PUNISH` tags | match 2 |
| Sudden Death (with its own entry caption); dock siren, named by VALE ("That siren is your clock.") | match 2 |
| Full ghost thresholds | match 1 (3.1 applies from the start; there is no tutorial ghost) |
| Heat gauge (`HEAT` captioned once at 60 %) | match 3 |
| Abilities, loadout choice in the green room, kit panel | match 4 |
| Core chip | the first time the Core is live in any match |
| Verdict buttons beyond REMATCH | 8.2 |
| `NEW PB` stamps, PB ghost swing | after one completed match |
| VALE number lines | match 4 (matches 1–3: coaching only, 7) |
| Title dataset line | ≥ 100 pilots have shared **and** the profile has ≥ 2 matches or has consented |
| STABLE camera hint | one 8-word line under the match-1 verdict buttons, once ever |

---

## 3. The player's arm as a body

The physical arm is never animated, never swayed, and is the hitbox. Everything below is command-side (sub-millimetre at the tip), render-side, LED/material-side, audio-side or camera-side. The AI never sees the ghost. HARNESS zeroes all of it. **What is recorded:** `human.command` is captured before any command-side life layer (breath, idle break) is added, and noted as such in episode `/4`.

### 3.1 Viewmodel language: one body at two speeds

The **ghost is the hand** (0 ms); the painted arm is the muscle that carries it (30–250 ms, honest physics). Ownership dies at ~190 ms of visual delay, so the thing that answers within a frame must look like a hand, not like a debug overlay.

- Below leash stretch 0.15: only a 3 mm ring at the ghost tip (the reticle's world twin) plus the jaw outline when it differs from the physical jaw by > 4°.
- Stretch 0.15→0.35: wrist, gripper and jaw hologram fade in (today's `GHOST_SHOW_STRETCH` `[0.35, 0.6]` becomes `[0.15, 0.35]`). The same thresholds apply from match 1; the `tutorial` full-ghost branch in `ghost-arm.tsx` is deleted.
- Ghost edge hue: cobalt `#2A6BFF` at 0 → white at 0.6 → **amber `#FFB020`** at 1.0. A 10 ms tick at the 0.6 crossing, a low buzz at 1.0. Amber already means "the arm is behind the command" everywhere in this file (BOOT blink, whiff LED, the opponent's `OPEN` hang), so the lesson is the same on both bodies. Signal orange `#FF4A1C` means HOT and nothing else.
- The leash is a **tapered ribbon** whose width is proportional to stretch, with three beads travelling arm→ghost at the servo's closing speed. Drawn only above 0.35. The dashed line is deleted.
- **Clip to the world.** While a contact between your tool link and the opponent is live, the drawn ghost tip is clamped to the half-space of that contact's plane (position and normal from the last contact event in `contact-scan`) + 8 mm and flushes white. One dot product, no physics API. The command still goes through; only the picture stops.
- **Own arm is solid.** The cockpit shows forearm, wrist and gripper as solid, glossy, cobalt-rimmed paint. Near plane **0.02 render units (1 cm)**. `FRAGMENT_DISCARD`'s near-fade dither stays but `OWN_ARM_DITHER_BAND` shrinks 0.08 → **0.02**, so only fragments about to be clipped screen-door (an STL has no caps; a hard clip would show a black hole every time the forearm crosses the lens). `COCKPIT_HIDDEN_LINKS` (base, shoulder, upper_arm) stays hidden. The "broken ghost" the director saw was the 0.08 band plus a full ghost drawn on top; the band fix and the thresholds above are the whole cure.
- The player sees their own arm in the deck reflection. That is the only place the whole body is ever visible during a round.

### 3.2 Life without moving the hitbox

| Signal | Where | Joints / channel | Amplitude | Rate | Gate |
|---|---|---|---|---|---|
| Breath | command | wrist_flex, gripper | wrist ±0.15°, jaw ±1.5° (0.65 mm at the tip) | 0.28 Hz, jaw lags 0.35 s | `1 − clamp01(|cmd vel| / 0.6 rad/s)` |
| Hold tremor | **render only** (`FeedbackFrame.vibration`, mm) | wrist links | 0.1 mm base → 0.6 mm at heat 100 % | 7 + 11 + 13 Hz | while any servo error > 0.02 rad |
| LED breath | LED | all link LEDs | 0.75→1.0 of state colour | 0.28 Hz | steady (not breathing) inside strike range: stillness = tension |
| Idle break | command | one of jaw-check / roll-settle / knuckle | jaw +20°, roll ±8°, flex ∓5° | every 6–14 s | no input > 2.5 s AND opponent tip > 1.3× range AND no Core within 0.4 m; never pan or lift |
| Action break | command | wrist_flex | +2.5° then critically damped 220 ms | 250 ms after any strike or clash | plus a 90 ms whine tail dropping a minor third |
| Heat as breathing | render + LED + whine | as tremor, plus LED and whine | tremor max, LED 2 Hz, whine +1 semitone / 10 % | heat > 80 % | the player feels overheated before the HUD says so |

Tremor and heat never touch `sim.ctrl`: a kp-998 servo at 400 Hz turns a commanded tremor into real torque ripple, the recorded command stream grades as chatter in `stats.ts`, and the opponent's perception reads it as motion. Render-only costs nothing in the data.

### 3.3 States with a face (one colour, one meaning)

| State | LED | Sound |
|---|---|---|
| OFF | dark, one 0.5 Hz amber blip on the base | none |
| BOOT | amber blink 3 Hz → steady amber | six servo ticks |
| LOWERED | team 0.4, breathing | idle purr |
| READY | team 1.0 | breath only |
| COMMIT (jab/charge/heavy) | team → white flare 60 ms at release, 300 ms ramp back | strike synthesis |
| GUARD | cyan `#3DE0FF` | filtered hold hum |
| GRIP | volt `#FFD60A` on the gripper LED, pulsing 1–4 Hz with clamp force | 3.4 |
| HOT (> 80 %) | team cross-faded to signal orange `#FF4A1C`, 2 Hz | whine +1 semitone per 10 % |
| STAGGER | red flicker 12 Hz for 400 ms then 0.2 dim | brownout sag + relay clack |
| SHORTED OUT | all to 0 over 150 ms; one last amber blip at +900 ms | de-rez |

Amber `#FFB020` = behind the command (boot, whiff, ghost at 1.0). Orange `#FF4A1C` = hot. Cyan = guard. Volt = grip / Core / live dock. Red = stagger / steal. White = a hit landing. No colour has two meanings.

### 3.4 Rituals

- **Power-on** (section 2): 1.8 s first time in a session, 0.6 s after. Never skippable; it is the embark. No captions.
- **Gripper, three stages** (Alyx): target (LED tints toward the target colour, jaws +8° over 80 ms, 2 kHz rollover tick) → lock (Space, or auto in match 1: 40 ms jaw twitch, 8 ms click, leash snaps to target 120 ms; target cannot change until release) → contact (sub + body thump, jaw settles with one 8 % overshoot, LED volt steady, rumble 60 ms strong 0.5). Release: spring open, 90 ms "chuff". A failed grab (lock, no contact in 250 ms) plays a two-note descending tick and a hollow clack. Never silently fail.
- **Damage worn on the body, not the HUD:** paint chips at each received contact (4–14 mm decals, cap 24 per link); below 40 % round health one link LED drops out at random (30–90 ms, 0.5 Hz), below 20 % two; whine detunes 1 semitone per 20 % lost; a heavy clash or received heavy leaves 1–3 dust specks and a smear on the lens (12 % opacity, clears over 6 s); a received crit leaves a hairline crack for the round.
- **GG tap:** after the final KO both arms return to neutral and the winner holds its gripper out for 2 s. Caption `TAP · LMB` (first three matches only, after ROOK's +650 ms line has finished); LMB taps back and VALE notes it. No G key, no untaught inputs.

### 3.5 What the camera must never do

Never bob, breathe or idle; never smooth or accelerate aim; never move on your own swing or flinch on your own landed hit; never exceed ±3° roll, ±1.5° pitch sway, 6° FOV punch, trauma 0.35 outside a KO; never leave the shoulder anchor; never interpolate on a different clock than the arm; never add motion blur; never cut to third person during a live round; never drop below 60 fps for an effect. `?debug=feel` shows max roll/FOV/trauma reached per round and the build asserts them.

---

## 4. The opponent as a character

Emotion in a machine is read from timing and posture, not from features. The body is Luxo Jr. with a gripper: five servos and a jaw. **The Luxo principle:** the same hop at a different speed is a different feeling, so arousal is a speed-and-acceleration multiplier on every behaviour, never a separate animation set; anticipation is sized to the decision; the eyes (the gripper) lead the action; nothing is ever still. All motion is *commanded* through the same policy interface so HARNESS stays honest and every clip replays bit-exact.

### 4.1 Motion language (additive layers, priority low→high)

`q_cmd = q_base(behaviour) + q_affect + q_breath + q_gaze + q_react`, each with its own blend (60–120 ms). Breathing and gaze attenuate to 0.3 during a tell so the tell reads (staging).

| Layer | Numbers |
|---|---|
| **Affect posture** (always on, slow) | arousal a (τ 1.5 s): `shoulder_lift −0.10·a`, `elbow_flex −0.08·a`, `wrist_flex −0.06·a`, breath rate ×(1+a); valence v (τ 4 s): `wrist_flex −0.08·v`, gripper 15 % open and LED bright when +, closed and LED 40 % when −; stance s (τ 2 s): open = `elbow_flex −0.10·s` lean in; closed = `elbow_flex +0.12`, `shoulder_pan ±0.10` away |
| **Breathing** | `shoulder_lift ±0.012`, `elbow_flex ∓0.010` antiphase (5–8 mm at the gripper), 0.30 Hz (BACKLASH) … 0.60 Hz (OVERSHOOT), inhale 45 % / exhale 55 %; sway `shoulder_pan ±0.02`, `wrist_roll ±0.03` at 0.17 + 0.11 Hz; weight shift ±0.06 pan every 4–9 s over 350 ms; micro-saccade `wrist_flex ±0.015`, jaw ±3 % every 0.8–2.5 s |
| **Gaze** | reactive glance 80–170 ms ease-out with 5–8 % overshoot; considered look 250–400 ms ease-in-out, hold 300–900 ms; tracking the player's gripper with τ 120 ms (OVERSHOOT) … 220 ms (BACKLASH), capped ±0.35 rad; budget 60 % player gripper / 25 % player camera / 15 % elsewhere; **gaze snaps to the target 150–400 ms before any attack**; a feint looks at the wrong target; eye-contact holds of 600–1200 ms with jaws +10 % at round start, after landing a hit, after eating one |
| **Flinch** (two owners, one look) | **Render, on the contact frame (WP5, `FeedbackFrame.vibration.blaze`, runs through the freeze):** 0–150 ms recoil offset up to 1.5 mm plus ±6° shiver at 18 Hz τ 60 ms, LED white 1 frame then 30 % for 300 ms. **Commanded (WP4, first decision tick after the contact, lands ≤ 40 ms sim time after unfreeze):** lift/elbow/wrist step +0.12…+0.25 away from the contact normal, jaw snaps shut; 140–400 ms re-guard with 10 % overshoot; 400–900 ms glance at the player, stance −0.3 for 2 s, arousal +0.25. Light contact 40 %; blocked hit 60 % with a 90 ms shove instead of the shiver; Core slam adds a 300 ms pan wobble. Big hits stun breathing one cycle then resume at 1.6× (winded), decaying over 6 s. The sim is frozen ≥ 50 ms on every scored hit, so the two owners read as one reflex |

### 4.2 Tells (never two attacks share one)

| Primitive | Opening pose Δ from guard | Tell | Strike | Return (player's window) |
|---|---|---|---|---|
| POKE | none; jaw closes 40 ms before | 0–40 ms | 100–150 ms | 120 ms |
| JAB | `elbow_flex +0.10`, `wrist_flex −0.05`, gaze on target; short LED blip, high whine chirp | 90–140 ms | 310 ms | 170–220 ms |
| HOOK / sweep | `shoulder_pan −0.20` opposite the swing, `wrist_roll +0.3` | 150–220 ms | 240 ms | 200 ms |
| SLAM | `shoulder_lift −0.35`, `elbow_flex −0.20`, jaws wide, **40 ms Kabuki hold at the top**; LED ramps to saturation, low rising whine | **300–450 ms** (≥ 250 ms is the floor for any heavy); in `sparring` the hold stretches to ≤ 3.0 s | 340 ms | 300–400 ms |
| GRAB | jaws 100 %, `wrist_flex +0.15`, slow approach 0.05 m/s², ratchet sound | 200–300 ms | contact-driven | 250 ms |
| FEINT | JAB or SLAM opening, abort at 60–80 %, snap back with 15 % overshoot | full tell | none | 100 ms |

The opponent's servo whine is driven from its **commanded** velocity, so it sounds 40–80 ms before the link moves. You hear it decide. A whiff hangs its arm in overshoot with amber LEDs and (from match 2) an `OPEN` tag over its gripper for 300 ms; that is the fighting-game loop (whiff → punish) made visible.

### 4.3 Reactions and social behaviours (animation groups of 3–5 variants, never the same one twice running)

- **Hesitation** (top two utility scores within 10 %, low composure, or authored flaw; never at Champion): start a JAB tell, pause 150–300 ms at 40 %, retreat 3–5 cm over 120 ms, up to 3 retreats. **Hover:** ±2 cm at 1.5 Hz for 400–800 ms, gaze flicking. Both are the AI's most punishable states and are meant to be.
- **Taunts** (only when ahead or after a whiff punish; 400–900 ms of real vulnerability; cooldown 16 s at Rookie, 8 s at Champion): beckon (`wrist_flex −0.25→+0.10` twice at 2 Hz, jaws in sync), chatter (jaws 6–8 Hz, LED strobes), shrug, **slow re-guard** (0.4× speed, gaze held on your camera: contempt as timing only), wave-off (BACKLASH only).
- **Celebration** (once per round): big (full stretch up, jaws open, `wrist_roll ±0.6` at 3 Hz for 1.2 s, two pan bows toward you); cool (BACKLASH: one slow nod, gripper closes once, nothing else moves); manic (OVERSHOOT: four 150 ms hops, snaps to guard because it wants the next round).
- **Dejection** (round lost): sink over 600 ms (`shoulder_lift +0.25`, `elbow_flex +0.30`, `wrist_flex +0.35`, jaw shut, LED to 25 %), hold with heavy 0.6× breathing to 2.5 s, one slow pan away, one glance back. OVERSHOOT slams the deck first (Cozmo's forklift), DEADBAND laughs it off in 1.2 s, BACKLASH is longest and stillest.
- **Curiosity** toward the Core every 12–25 s in a quiet stretch: considered look, two pauses, 20° gaze sweeps, "sniff" 3–4 cm above it with slow jaw open/close at 1 Hz. If you rush it during the sniff, the flinch fires. Its fault.
- **Fear** (health < 25 %, composure < 0.3): abrupt retreat at full servo acceleration, `elbow_flex +0.35`, 6° shiver at 15 Hz τ 500 ms, LED flicker, guards high for 2–4 s, then rallies (OVERSHOOT: valence flips to anger) or turtles (BACKLASH).
- **Sparring** (BACKLASH, match 1 round 1 only, and the SPARRING churn tier of 8.4): parked in reach, tracks and flinches, re-approaches on its own 1.5 s after every hit ("come back for more"), winds up SLAM-class holds on cue from the tutorial script, strikes at m ≈ 0.1 for 0 damage, takes 0 damage, never POKEs. This is the old `jig.ts`, folded into `personalities.ts` / `decision.ts`.

**Order inside WP4:** balance the tier table first (`tiers.ts`, `dda.ts`) until the 12-seed test is green (Champion beats Rookie ≥ 80 %); only then add the behaviours above, gated by tier as noted, and re-run.

### 4.4 Temperament through a target-shaping filter (the physical PD never changes)

| Parameter | OVERSHOOT | BACKLASH | DEADBAND |
|---|---|---|---|
| Command overshoot | 0.12 × travel | 0.03 | 0.08 |
| Settle τ | 70 ms | 140 ms | 90 ms |
| Ring ζ (6–9 Hz) | 0.35 (visible) | 0.9 (dead) | 0.5 |
| Ease | ease-out (snappy) | ease-in-out | asymmetric, random per primitive |
| Onset jitter | 0–30 ms | 40–90 ms | 0–120 ms |
| Amplitude jitter | ±8 % | ±3 % | ±12 % |
| Follow-through lag (wrist_roll, jaw) | 40 ms | 80 ms | 60 ms |
| Overlap (next primitive starts at) | 70 % | 85 % | 60–80 % |
| Breath | 0.6 Hz small | 0.3 Hz deep | 0.45 Hz irregular |
| Gaze τ | 120 ms | 220 ms | 150 ms + 15 % wrong-target glances |
| Arousal gain | 1.4 | 0.7 | 1.0 |
| On being hit | valence −0.2 (anger) | stance −0.4 (caution) | composure −0.3 |

Jitter is per primitive, never per tick (per-tick jitter reads as servo buzz). To make the opponent feel angry raise acceleration, not amplitude.

### 4.5 Pacing, memory, and saying it out loud

- **Menace gauge** (10 Hz): +0.15 per AI strike attempt in reach, +0.25 per hit on the player, −0.05 per 100 ms without contact. > 0.8: the AI is sent backstage for 1.5–3 s (retreat to x ≈ 0.16, breathe, glance at the Core, look at you), ending early if you advance. < 0.2 for 4 s with a passive player: it probes (POKE from match 2; beckon in match 1). Hosts: no lines above 0.7, colour above 0.4, coaching below 0.2. The director advises; it never moves the arm.
- **Memory** per opponent across sessions: the move that scored on it most, the side it was hit from, your time-to-first-attack, whether feints worked. **The main thread owns the store** (`core/settings.ts` → `profile.ts`, localStorage) and passes an `OpponentMemory` record in `ResetContext` (11.9); the recorder stamps it in `meta.opponentMemory` so a replay reseeds identically; WP4 reads it from `ctx` only; HARNESS passes an empty record. Effects are visible and referenced: guard biased 0.08 rad toward the side that hurt it with a caption at round start; the tell of the move that beat it shortens 15 % once and VALE says so (from match 4; ROOK says it as colour before); a taunt (idle > 3 s at reach while ahead) raises its opening aggression 0.2 and it skips the eye-contact beat (a grudge). The rematch intro plays the memory: loser's sulk, winner's swagger, and the caption names what it remembers (`IT REMEMBERS THE LEFT HOOK`). This is what makes match 2 a grudge instead of a re-roll.
- **If the AI didn't show it, it didn't happen.** Decision events route to body, LED, whine, and one host line with a cooldown: waiting for a whiff ("BACKLASH is waiting for a miss"), feint bitten ("Sold it"), feint ignored ("Didn't buy that one"), rattled ("It's covering up"), plan switched, comeback ("It's hurt and it's angry"), turtling ("It won't come out"; explaining *lack* of action is what stops turtling from reading as broken).
- **Tough = smart.** The opponent lives long enough to have a mood: opening grace 3 s, no tier above Rookie until `matchesPlayed ≥ 3` or a 2–0.

---

## 5. The look

### 5.1 The one rule

The opponent is the brightest, sharpest, most saturated thing in the frame, always. Everything else is graded down until it is. Three depth layers: foreground pilot arm (cobalt rim, slightly under key, sharp), midground opponent (white key + magenta rim, the only thing that blooms besides LEDs), background bowl (soft blue-black, lines and dots only). Grayscale-thumbnail test on any mid-fight frame: opponent > pilot arm > deck > bowl in that value order, or the frame fails.

### 5.2 The director's clutter list, resolved item by item

**Baseline first:** re-run `?debug=feel` on the current `fps-duel` head before WP1 starts and replace the "Today" column of 10.1 with it; the director's 166 / 1.32 M predate the hit light at 0, the concourse ribbon removal and the jumbotron frustum gate, and the crowd is 380 on DEFAULT with 3 tiers, not 400 / 4.

| Director's note | Verdict | Exactly what changes |
|---|---|---|
| Dense pink/blue hologram crowd tombstones fill the upper half | **Reduce hard.** The crowd is a witness, not wallpaper. | Instances 380 → **160** (tier DEFAULT), 3 tiers → 2, stand rake lowered so the crowd occupies ≤ **18 %** of frame height from the cockpit eye; base emissive `crowd` 1.3 → **0.55**, colour desaturated indigo `#3A3F6E`, **no team tint below hype 80** (above 80 the leaning side's stand strobes team colour, the only time it is pink or blue); flicker 2–4 Hz per instance, lean cycle 5 s, 1–2 cm sway; jump 250 ms on strikes, arms up on KO (exists). Phone flashes stay (Poisson 1/s, ×4 on hype, 30 on KO): they are the cheapest "people". |
| Repeated sponsor boards and scrolling wordmark ribbons ring the bowl | **Concourse ribbon: done (already gone).** Keep one dasher ribbon. Boards go static. | Dasher ribbon at **30 % brightness, static during fight** (scroll 40 px/s only between rounds and in attract). The two boards stay at ±90° where they are, as **static dim plates (emissive ≤ 0.08) that never animate during a live round**; they are behind the opponent's head from the cockpit and a witness does not stand between you and the fight. Sponsor reaction frames (OHMSTEAD `OVERCURRENT` on a crit, PULPO POP `SNATCHED` on a steal) live only on the **jumbotron bug** (10 % corner, already the live tote, 1.2 s) and as a **1.5 s panel swap on the dasher ribbon** (below the arm, no brightness change), and on the between-round card ("presented by"). Zero new geometry. No wordmark in the 3D scene during a fight; the wordmark lives bottom-left of the HUD so every screenshot is attributed. During a fight the only lit things beyond the deck line are the opponent's rim and LEDs. |
| Hazard stripes on every deck edge | **Cut all deck hazard.** | `deck-texture.ts` border becomes a single 6 mm ink gutter; the LED edge is one continuous emissive line per side (led 10 on the deck only). Hazard survives in exactly two places: the CONTESTED dashes on the dock ring and the `SHORTED OUT` stamp. Team halves stay as matte prints (roughness 0.45); the black lacquer between is the mirror. |
| Yellow dock rings + reach arcs + leash line + translucent dithered own arm all at once | **One of them at a time.** | Reach arcs (`range-arcs.tsx`) **deleted** (file and the `arena-canvas.tsx` import, both WP1); the range cue moves into the reticle (ring fills clockwise as the opponent's gripper enters the 60–85 % sweet band, snaps solid at contact range). Dock rings drawn only while the Core is loose, carried or docked (idle dock: a 1 mm outline at 15 %), volt only when live. Leash: tapered ribbon above stretch 0.35 only (3.1). Own arm: solid, dither band 0.02 (3.1). At rest in a fight the frame shows: reticle, opponent, your solid forearm, the deck line. Nothing else. |
| Magenta rim/sweep wash tints the whole background | **Team light touches only the arms.** | The four SpotLights leave the forward shader (10). Rims become shell fresnel: `rim = team × pow(1 − |N·V|, 3) × 4.0 × (0.5 + 0.5·max(0, N·uKickDir))`, `uKickDir` fixed from behind each arm's far side, so the magenta lives on the opponent's silhouette and nowhere else (gain 4.0 puts the silhouette edge at ≈ 1.0 linear, over the 0.95 bloom threshold, so the rim is what blooms). Sweeps become two deck-projected pools (analytic cone in the deck shader, `smoothstep` on angle, 1/d², decay so they end at 0.45 m beyond the deck edge) plus two volumetric cones aimed at a band 0.25–0.45 m **behind** each arm at 0.15 m height, periods 11 s and 14 s. Bowl hemisphere sky `#2A3070` → `#1C2352`, ground `#05060F`; fog (**render units**, `scene.fog` in `lighting.tsx`) near 3.5 → **2.7** (≈ 1.3 m, just past the opponent's mount at 2.46), far 16 → **7**. Both arms stay fog-free; the bowl and crowd are navy and black. |
| Cubes are plain grey blocks | **Make them objects.** | The Core: volt `#FFD60A` clearcoat with an ink BIT print, its own countdown digits on the face, the only saturated yellow in the scene. Clutter cubes: **three**, not more, ink `#0E0F14` clearcoat with a team-number decal and a 2 mm volt edge chamfer, so a hit that launches one reads on the lacquer. Cubes stay where they fall (permanence). |
| Own arm reads as a broken ghost | **Solid body, hand-ghost only.** | 3.1. |
| 6 shader programs compile after boot (98 vs 92) causing a 1000 ms hitch | **First job of the whole plan.** | 10.2 step 1: the culprits are in `post-stack.tsx`, not the VFX pools. |
| 166 draw calls, 1.32 M triangles | **≤ 90 and ≤ 0.45 M** (from the re-measured baseline). | 10.2. |

Already on disk, listed so nobody double-counts the savings: hit `PointLight` mounted at 0 (`vfx-system.ts:147`); concourse ribbon gone (`led-strips.tsx`, one ribbon + one boards draw); jumbotron feed frustum-gated off in the cockpit (`jumbotron.tsx`).

Also cut (was in the ART_BIBLE or on disk, serves none of the three feelings): overhead shafts 6 → **2** on DEFAULT (one noise octave, radius 0.16); truss lamp chase; the concourse rail geometry that only existed to hold a ribbon; the jumbotron re-rendering the scene (it shows the tote, captions and the KO instant replay from the existing render target only during `ko`, never during a live round); the second sponsor ribbon atlas panels for the wordmark and BIT; **all midpoint twists** (8.4).

### 5.3 Lighting (3 real lights, 1 shadow map)

- **Key** `DirectionalLight` `#F4F6FF`: elevation 70° → **48°**, azimuth camera-left and slightly behind the eye, intensity 2.42 → **3.2**, 2048/1024 shadow by tier, `normalBias 0.012`. At 48° the clearcoat streak lands on the opponent's upper two links as seen from the eye and shadows fall away across the deck.
- **Hemisphere** 0.3 → **0.12**. Fill is the enemy of night; the deck reflection is the fill.
- **Environment** Lightformer rig, `environmentIntensity` 0.5 → **0.7**; the softbox becomes a 1.6 × 0.25 m streak (≈ **0.10 sr**; `environmentIrradianceEstimate` 0.38 → **0.10**); two horizon strips 1.8 × 0.12 m at intensity 3 in team colours; one volt strip behind the camera at 0.4.
- **Hit light** `PointLight` mounted at 0 always (done today; never added or removed: light count changes recompile every lit material), team colour, 120 ms on heavy hits.
- **Exposure and grade** (`quality.ts CALIBRATION`, one triple, written down so nobody re-tunes blind): key 3.2 at 48°, hemisphere 0.12, environment 0.7 × 0.10, **`exposure` 1.0 → 0.70**, `grade.contrast` 1.12 → **1.32**, `saturation` 1.12 → **1.18**, shadow tint ×2 `[-0.004, 0.003, 0.008]`; `greycard.target` 0.46 → **0.34**, tolerance 0.03. `predictDisplayValue(0.18, cos 48°)` with these numbers gives 0.35 and is the unit test; `?debug=greycard` is the real-frame check. Bowl blacks ≤ 0.03, specular hot spots ≥ 1.6 linear before ACES. Keep ACES.
- **Bloom** threshold 1.25 → **0.95**, smoothing 0.2, intensity 0.9, radius 0.78; coverage must stay under 5 % of pixels. Anamorphic streak: a 12-tap half-res horizontal blur of the brightest bloom mip, ADD at 0.25, team-tinted, for LED edges, the rim and the KO flash only.
- **Beams** `beam.team` 0.16 → **0.45**, `shaft` 0.07 → **0.18** at the lamp, `pow(1 − t, 1.6)` along the axis, fresnel-soft rim `pow(|N·V|, 1.4)`, depth-fade over the last 4 cm above the deck. Never between the eye and the opponent.

### 5.4 Materials (boot-time variants only, no program after prewarm)

- **Shells:** clearcoat 1 / clearcoatRoughness 0.05 over base roughness 0.32 (keep the two lobes far apart); `envMapIntensity` 1.4 → **1.8**; **base-to-tip value gradient** 0.75 at the mount → 1.15 at the gripper via `vLocalPos` so a chain of cylinders reads as one body with a business end; wear pooled at edges only.
- **Joints:** anisotropy 0.6 along the joint axis, roughness 0.42: a brushed streak that turns with the joint. `USE_ANISOTROPY` is a define, so this is a **boot-time program variant** (`customProgramCacheKey 'tl-shell-aniso'`), constructed at mount and covered by prewarm.
- **Optics:** iridescence 0.35, IOR 1.6 on the lens only (`'tl-optics-irid'`, same rule; a spectral Fresnel on one small mesh).
- **Per-link LED** uniform (colour + intensity) driven by the state machine in 3.3 for the pilot and by tracking error / tells for the opponent; emissive `led` 7 → 10 on deck edges only.
- **Deck:** own planar reflection (keep) with Schlick fresnel (F0 0.04, exponent 5) so the far half under the opponent is near-mirror; print mask matte vs lacquer mirror; reflection renders **`REFLECTION_LAYER` (= 5) only: arms LOD1 + LED line + cubes + hit light**, 480 × 270 on DEFAULT, **every frame** (a 30 Hz mirror swims ≈ 40 px against the print on a 3°/frame flick; the layer mask already removes ~90 % of the pass).
- **Decals:** team number, `SO-101` plate, OHMSTEAD mark at the shoulder, ≤ 15 % coverage, readable at 1 m or not at all.

### 5.5 Composition

Two regimes. **Composed frames** (attract, intro, rest pose at READY, KO replay, verdict background): opponent on the upper-right third intersection, its gripper centre-right; your gripper lower-left as foreground; the deck LED lines and the printed midline converge on the opponent's mount; a 2° dutch drift over 20 s during idle phases only. **Live round:** the camera is whatever the player aims; the only rules are 5.1 (value order) and *with the reticle centred on the opponent's gripper, its mount and both deck LED lines are inside the centre 60 % of width*. No sweep pool, shaft or crowd element brighter than the opponent's lit shell anywhere in frame, ever.

Camera, in sim metres (`camera-math.ts`): eye `COCKPIT_EYE_EGO` **(−0.10, 0.16, 0.36)**, target **(0.52, −0.03, 0.15)** (unchanged; the 10 cm lateral offset is what puts the forearm lower-right and keeps the opponent unoccluded), FOV **58° vertical** (≈ 90° horizontal at 16:9; today's 78° vertical is ≈ 106° horizontal and shrinks the opponent to 60 % of its height). Rest-pose screenshot test in 12.1 item 3.

### 5.6 Living background (five layers, slow, staggered, never hard-reset)

| Layer | Rate | Amplitude | On events |
|---|---|---|---|
| Deck-projected sweep pools + 2 cones | 11 s and 14 s | 0.3 m band behind each arm | chase ×2 between rounds; both to the winner's colour on KO |
| Crowd (160) | flicker 2–4 Hz, lean 5 s | 1–2 cm, ±15 % | jump 250 ms on strikes; arms up on KO |
| Phone flashes | ~1/s Poisson | 1–2 px at 4× crowd emissive | ×4 with hype, 30 on KO |
| Dasher ribbon | static in fight; 40 px/s between rounds | 6 s ±20 % breath | white flood 120 ms on the struck side; 1.5 s sponsor panel swap on crit / steal |
| Haze + beams | UV drift 0.02/s, noise scroll 0.15/s down | ±10 % density | slam on FIGHT |

The jumbotron feed stays ≤ 15 Hz and never uploads a `CanvasTexture` per frame.

### 5.7 UI motion tokens

| Motion | Curve | Duration |
|---|---|---|
| Callout slam (FIRST BLOOD, CRIT, KO) | `--ease-slam cubic-bezier(.2,1.5,.35,1)` | 240 ms in, hold, 180 ms out; scale 1.8→1.0, skew −20°→−10°, letters stagger 30 ms; impact frame fires on the slam's first frame |
| Plate / feed row | M3 emphasized-decelerate `cubic-bezier(.05,.7,.1,1)` | 200 ms, translateX 48→0, rows stagger 40 ms |
| Numbers | `--ease-snap` | 350 ms roll + 120 ms pop, tabular digits |
| Bars | linear at 60 Hz via CSS var | never React state |
| Round card light-sweep | linear | 900 ms, one 12° white band |
| Menu hover / press | spring, damping 0.8 | ~180 ms, scale 1.03 / 0.97 |

In-match: nothing over 240 ms, nothing overlapping the opponent's silhouette, one caption at a time. Between rounds: 400–900 ms may fill the screen. **Impact frame:** on crit, clash and KO, two frames of `mix(c, 1 − luma(c)` tinted to the striker's team, `uImpact)` on the existing GradeEffect, then one frame at 50 %; zero new passes; reduced-motion zeroes it.

---

## 6. Feel spec per event

`m` = normalized impact magnitude. Order of importance when budget forces cuts: hit stop → sound on the event frame → victim thrown + render vibration → camera kick → flash and sparks → HUD → rumble. A heavy hit **adds channels**; it never just scales the light one. Dealt shake is 24 Hz (sharp), taken shake 18 Hz (a slam): the player must tell dealt from taken with eyes shut. Audio is scheduled at `ctx.currentTime + (tContact − tNow) + baseLatency`, never on the next rAF; onset error median < 8 ms, p95 < 20 ms.

**Hit stop, one formula for every strike:** `hitstopMsFor = clamp(50 + 125·m, 50, 150)`, crit +20 inside the cap, guarded `33 + 17·m` on onset only, deflect 110, clash 55, KO 150 (`tuning.ts`; `strikeK`/`m²` deleted). Continuous, so two nearly identical swings never feel like two games. The light/heavy split at m = 0.4 exists **only for channels** (camera, sub, sparks, hit light), never for the clock.

| Event | Camera | Time | Viewmodel / world | Sound | UI | Haptics (ms / strong / weak) |
|---|---|---|---|---|---|---|
| **Command** (any mouse move) | yaw same frame, zero filter; roll `clamp(−0.012·pan accel, ±3°)` low-passed 12 Hz | — | ghost jumps same frame; LED per joint = `clamp(|ctrl−q|/0.5)`; arm onset ≤ 45 ms; overshoot 0.09–0.18 rad drawn by the smear ribbon; seat "clack" when error crosses 0.02 rad down | whine onset ≤ 5 ms (scheduled in the input handler), pitch 180 + 900·min(1, Σerr/1 rad) Hz, growl + 50 Hz flutter at saturation | none | 12 / 0.15 tick on direction reversal |
| **Light hit dealt** (m < 0.4) | none | freeze `50 + 125·m` | 6–18 sparks that land and stay; victim link vibrates 0.8 mm @ 30 Hz render-only; victim LED white 1 frame | `tok`: transient + small body, no sub, pitch ±4 % | hit ticks 150 ms; receipt `SOFT 0.6 m/s` (first 10 receipts of a profile carry the word band: SOFT < 1.0, SOLID 1.0–1.8, HARD > 1.8 m/s) | 50 / 0.15 / 0.25 |
| **Heavy hit dealt** (m ≥ 0.4) | recoil −0.8° pitch ω 22; FOV −2.5°·(0.5+m) ω 18; trauma +0.10 + 0.15·m at 24 Hz roll-biased; crit: 0.5× for 120 ms after the freeze | freeze `50 + 125·m` (cap 150); attacker's ghost unfreezes at 60 % of it | 18–36 sparks; hit PointLight 120 ms; deck edge flash 120 ms; victim vibration 1.5 mm @ 30 Hz for the whole freeze; striking LED white 250 ms; smear ribbon forced 250 ms; scuff decal on the deck (64-slot atlas); crit chips paint on the struck link | transient + body + **sub 70→38 Hz** + ring tail + servo shock on the victim; crit `tink` 3.2 kHz at **+40 ms**; ping tier (raw ≥ 28) rising 1.8→3.6 kHz at +30 ms; `heavy_hit` duck music −4 | number pops 1.4→1 in 80 ms, holds 700; opponent bar chunk with 900 ms red ghost drain; `HARD 2.7 m/s`, and once a PB exists `+0.3` in volt beside it when it beats the PB; crit/clash impact frame | 50 + 70·m / 0.15 / 0.25 + 0.4·m |
| **Hit taken** | kick **away from the contact** 1.5° + 3°·m, axis `cross(fwd, contactDir)`, ω 22; trauma **+0.15 + 0.20·m** at 18 Hz (0.35 at m = 1, so magnitude keeps reading under the 3.5 cap); FOV +3°·m | same freeze; stagger: 0.35× → 1.0 over 350 ms | own upper housing vibrates 1.5 mm; 0.3° pitch jitter for the freeze; tether snaps taut; lens speck if heavy; paint chip | same object, body low-passed to 900 Hz, sub +2 dB, 120 ms camera-side rumble 40–120 Hz; music lowpass dip 200 ms | your bar chunks (slides in on the first one); `−31` in attacker colour under your plate; HUD frame shakes 2 px 120 ms; damage edge 0.30·m from the hit side, τ 250 ms | 60 + 80·m / 0.4 + 0.5·m / 0.3 + 0.4·m |
| **Whiff (yours)** | 0.6° roll into the swing, then 0.4° stumble dip over 200 ms at the leash | none | overshoot forced visible; tether taut for the settle; LED amber 250 ms (τ×0.8) | whoosh: band-passed noise centre 400 + 600·v/3 Hz, 120 ms falling tail; whine falls; no impact layer | charge ring snaps empty; heat +10 | 30 / 0 / 0.2 air pulse |
| **Whiff (theirs)** | none | none | its arm hangs in overshoot, LEDs amber, **`OPEN` tag over its gripper 300 ms** (match 2+) | spatialized whoosh; crowd `ohh` if it passed within 0.08 m of you | opponent plate `WHIFF` grey 300 ms; `PUNISH` tag if you land within 400 ms (match 2+) | none |
| **Block (you hit their guard)** | **0.5° push back along the normal**, ω 22, no shake | 33 + 17·m on onset only | tether taut and stays; ghost drags; LED white and holds; smear cuts dead at the contact | `thock` (dull, −3 dB) then **stall growl** 55–60 Hz AM 11 Hz gated by `err > 0.3 rad AND |q̇| < 0.3 rad/s`, rising over 150 ms | `BLOCKED` 400 ms; small grey number | 40 / 0.5 thud, then 0.2 weak buzz while stalled |
| **Block (you blocked)** | **zero shake, zero kick.** A wall does not move. | same freeze; deflect: none for the defender | guard ripple decal on your gripper; LED cyan; opponent flinch at 60 % with a shove | `thock` + cyan ripple tone; your servo's holding growl; late guard: two upward ticks (C6, E6) at +80 ms | guard chip; `BLOCKED` alone until match 3, then `BLOCKED · 2.1 N` | 40 / 0.3 |
| **Deflect** | FOV −2° over 120 ms | attacker 90 ms, defender 0 | cyan chevron burst; attacker stunned | bright `ting`; crowd `ohh`; host P2 | `DEFLECT` slam; refund 15 heat | 80 / 0.6 / 0.6 |
| **Clash** | both cameras 1.5° kick along the normal | 40 ms | ring flash at contact; both LEDs white; electric arc 120 ms | two rings detuned 30–60 cents, 250 ms; `shhk` sweep | `CLASH` | 80 / 0.6 / 0.6 |
| **Grab / dock** | none | none | 3.4 three stages; dock: magnet clunk, volt ring fills; Core face shows the countdown | rollover tick, lock click, contact thump; dock: 140 Hz clunk + rising C5–G5; dock siren E5/B4 at 3 Hz −12 dB for the countdown (match 2+); tick 1→2→4 Hz | `DOCKED`, ring | lock 16 / 0.3 / 0.5; contact 60 / 0.5 / 0.4 |
| **Steal contact** (within 100 ms) | none | none | owner's deck edge flashes red; jumbotron `STEAL IN PROGRESS`; opponent's taunt snap if it is stealing | siren → 5 Hz with a square component; `steal` duck music −6; crowd roar (you) or groan + 0.5 s hush (AI) | countdown ring pulses red at 2 Hz | 60 / 0.4 / 0.4 |
| **Last 3 s of a lock** | none | none | ring at 4 Hz; crowd stomps in time; hosts silent | `last_3s` strips the drums; tick pitch rises per second; overtime: a steal begun inside the last 5 s cannot end the round until it resolves (10 s cap) | ROOK counts only if you own it | none |
| **Stagger / burst** | 0.6° pitch dip; 120 ms brightness sag; P: CA + vignette for 400 ms | 0.35× → 1.0 over 350 ms | brownout slump; red LED flicker 12 Hz; relay clacks | brownout sag + clacks; whine wow 200 ms | `SHORTED` chip | 140 / 1.0 / 0.2 then 200 ms silence |
| **KO** | the one allowed slow motion: 0.3× for 700 ms; white flash; 150 ms freeze | full | winner LED full; loser: de-rez burst in team colour, then the key cone on the winner doing its gesture while the loser slumps under real gravity; confetti **only on a match win**; deck edges to the winner's colour; jumbotron instant replay from the existing render target | kill confirm at 0 (sub → ratchet → bell → gap → answer, +12-ping coin tail 400 ms); `near_ko` had thinned the mix ≥ 1.5 s before; crowd roar swells from +0.4 s, peaks +1.0–1.4 s; **ROOK's release line at +650 ms, never earlier**; music tag on the next bar after +1.8 s | `SHORTED OUT` stamp; impact frame ×2 | 250 / 1.0 / 0.6 (the only pulse over 250 ms) |
| **Round / match won or lost** | orbit only for the earned replay | — | winner celebration group; loser dejection group; **rematch intro plays the memory**: loser's sulk entrance (dejection group held into the 2.4 s intro, LEDs at 25 % until FIGHT), winner's swagger (celebration variant at 0.6× into the entrance, one slow look at your camera), caption naming what it remembers (4.5) | victory tag 2 bars; defeat tag bass-only with one descending stab (never sad: sad punishes a rematch); a 2-bar "come on" chant invites the rematch | 8.2 verdict | none |

Streamlining (ARCADE only, silent, off in HARNESS and visible in the Lab report): strike buffer 100 ms (150 across a freeze); coyote guard 80 ms after onset counts as `late_guard`; reticle magnetism ≤ 3° toward the opponent's gripper within 12° when the mouse is under 200 counts/s, τ 120 ms; aim-brake holds the command when the mouse stops ≥ 40 ms within 0.15 rad; whip carry keeps the speed tag for 300 ms after a reversal (`WHIP` +10 % damage); deflect refunds 15 heat.

---

## 7. The audio emotion arc

Everything synthesized in WebAudio, no files. Nothing before t₀ (2). Emotion is contrast: every big moment is preceded by a hole and followed by a continuation. Priorities decide the mix: kill confirm and lock 10; ping and steal 9; heavy hit, crit tink, host start 8; solid hit, block, deflect 6; jab, servo shock, lock tick 4; servo life, crowd bed, music 2; UI 1. A voice at p ≥ 8 ducks buses ≤ p − 4 by −(p − 4) dB with 20 ms attack / 200 ms release and drops voices ≤ p − 6 due within 80 ms. No two hold-type ducks stack past −14 dB on music.

**Servo life, both arms, from the first relay click of the boot ritual:** hold buzz (50 Hz saw AM by 8–12 % duty square → BP 1.2 kHz, −38 dB at zero error to −26 dB at saturation), hold jitter clicks (Poisson 0.5–3/s ∝ error), whine (600 + 2400·v/vmax Hz + 2nd harmonic −9 dB, attack 15 / release 80 ms), gear chatter, strain growl (55 Hz AM 11 Hz when saturated and not moving), stop click (a servo brakes, it does not fade), heat hiss above 70. The opponent's layer is panned by its azimuth, −4 dB, and driven by its **commanded** velocity so it leads its motion. Idle 5 s: sfx bus between −45 and −30 dBFS (alive, not loud).

| Beat | Trigger | Music (104 BPM D Dorian, six layers) | Crowd | Hosts | Servo / SFX | Ducks |
|---|---|---|---|---|---|---|
| A Pre-round (2.4–4 s) | intro | between-rounds bed → three muted count-in kicks at eighth notes in the last 0.87 s of the ritual | energy 0.3, anticipation 0→0.7 | ROOK one ramp line, then silence for the count | power-on chirps (six relay clicks + 400→1400 Hz chirps, 120 ms apart; opponent 400 ms after you) | — |
| B FIGHT | fight start | `low` + `mid` on the downbeat | applause 1.5 s | **silent for the first 4 s** | servo life on | — |
| C First contact | first strike | drums gate on `in_exchange` (grippers < 1.6× range ≥ 300 ms, held 1.5 s) | first `ohh` −10 dB whoever hit | match 4+: VALE's number 1.5 s later; matches 1–3: nothing, the receipt is the number | full impact object; reward offsets if earned | `heavy_hit` if raw ≥ 20 |
| D Momentum | 3-hit streak / broken | one-bar clav stab up a fourth on the player's streak, down a fourth when it breaks | chant on the player's streak (6 "ohh" voices on 2 and 4, two groups a fifth apart); groan-then-dip on the AI's | ROOK ramp 2 on yours; VALE counts theirs ("three unanswered") | beaten arm's growl and jitter rise with damage | — |
| E Core drama | drop / dock / pry / steal | drop: one-bar riser then `high` on; dock: lock tick; last 3 s: drums out | dock: mood swing; < 3 s: murmur up a minor third, brightness 800→1400 Hz; steal: roar or groan + hush | ROOK counts only your lock; one release line on a steal | clunk + C5–G5; pry: 250 ms growl on both arms then ratchet release; steal inherits the tick then re-pitches down a fourth | `lock`, `steal`, `last_3s` |
| F Near-KO | either Integrity ≤ 20, u = 1 − i/20 | drums × (1 − 0.7u), lowpass 12 kHz → 1.2 kHz | held breath: cheer −10 dB, one cough click every 3–5 s (not silence) | silent except one VALE line at the threshold | victim: heartbeat servo stutter 0.9 Hz (you) or brownout flicker with relay clicks (AI); hunter's 2nd harmonic up | `near_ko` |
| G KO | Integrity 0 | bed out; tag after release | roar swell +0.4 s, peak +1.0–1.4, hold 2.5, decay 4 s | ROOK release line at **+650 ms** | confirm at 0; brownout from +150 ms per joint; slump whine 900→120 Hz tracked to real joint velocity; final stop click; then that arm is **silent** | `ko` |
| H Post-match | outro | victory tag / bass-only defeat tag → lobby bed | applause + one late whistle / murmur then "come on" chant | VALE one real stat; ROOK names the deciding moment | winner's gesture through real servos at +3 dB; loser silent | `match_end` |

**Hosts.** The unit of speech is the **caption unit**: one ROOK reaction (one clause), optionally followed by VALE's one number ≤ 2 s later. The 3 s hard silence and the ≤ 1-per-6 s cadence apply **after the unit ends**. Rules: silent ≥ 45 % of fight time; 14–26 units per 3-minute match; no two units from the same host in a row; ≥ 12 variants per event class with a 20-line no-repeat window; the player's name at most twice a match; one narrative thread per round (comeback > revenge > first_blood > clock) with 4–6 lines that reference this round's events; prosody as data (`ramp 0..3` → caption weight 500→900, size 1.0→1.35×, reveal 28→60 chars/s; release lines stretch the final word). **VALE in matches 1–3 speaks only coaching lines tied to state** (max one per 8 s, only when menace < 0.2); her number lines start at match 4. **Every VALE number is read from telemetry** (episode events, `stats.ts`), never authored: the cube's mass comes from the sim's body mass, the speed from tip velocity at contact. Voices, if enabled: dry, near-field, PA band-pass, no reverse or DJ effects.

Test targets (offline render, no speaker): −16 LUFS ± 2 integrated over a round, crest ≥ 12 dB; five one-shots (jab, solid, heavy, crit, ping) monotonic in peak with reward-layer centroid > 2 kHz and body < 1 kHz; onset p95 ≤ 20 ms; hosts silent ≥ 45 %; drums < 0.3 for ≥ 20 % of fight time; `near_ko` active ≥ 1.5 s before any KO confirm; shouts silent 300 ms before the confirm.

---

## 8. The engagement loop and shareable moments

```
ATTRACT (silent; 12 s of one canned episode; LOADING → CLICK TO FIGHT)
  → click = swing (≤ 6 s from tab open with the mesh bake)
MATCH 1 = best-of-3 vs BACKLASH Rookie (round 1 sparring: HIT IT → GUARD → GRAB → BRING IT HOME → LOCKED by ~44 s;
  rounds 2–3 real, 30 s, no Sudden Death)
  → MATCH (70–120 s): 3 s loop flick/guard/counter, every contact returns a receipt; 30 s loop = round + round card
  → earned replay (POTG-scored) → auto-clip (match 3+)
VERDICT (≤ 6 s to read, REMATCH focused, 3.4 s to control; gated by matchesPlayed, 8.2)
  → REMATCH (the goal line is the hint) · NEW OPPONENT (match 3+) · SHARE (match 3+)
  → SYSTEMS CHECK drill after match 2 (9) · LLL guard · daily seed · medal ladder · friend files · tomorrow's #bout
```

### 8.1 Competence receipts (inside the match)

Every contact prints a receipt as part of the crosshair node (≤ 700 ms). For the first 10 receipts of a profile the receipt is a word plus the number (`SOFT 0.6 m/s` / `SOLID 1.4 m/s` / `HARD 2.2 m/s`, bands 0–1.0 / 1.0–1.8 / > 1.8) and a guard prints `BLOCKED` alone; newtons appear from match 3; once a PB exists the receipt shows `+0.3` in volt beside the number when it beats the PB. That is the scale. Between rounds (after one completed match) the round card shows `vs PB` deltas and a 0.8 s ghost of your PB swing beside the current one. Round 2 after losing round 1: Underdog Dock on, and ROOK names it.

### 8.2 The verdict screen (replaces the scoreboard)

Left to right: result slab by cause (`VICTORY`; loss: `SHORTED OUT` for a KO, `OUT-LOCKED` for a lock, `OUT-POINTED` for time; never a bare "DEFEAT"), round pips, bout number; **three superlatives ranked against the player's own history, at least one theirs even on a loss** (`FASTEST STRIKE 1.62 m/s`, with `NEW PB` only after one completed match); loss only: **the gap**, one named number (`LOCK 6.8 / 8.0 s`, `INTEGRITY 4 LEFT`, `2 UNGUARDED HOOKS`) and one 30-second goal generated from the loss cause or a skipped tutorial step (≥ 2 unguarded or GUARD skipped → `BLOCK 3 STRIKES`; lost by lock → `DOCK FIRST`; KO with < 3 landed → `LAND 3 HITS`; lost by ≤ 5 → `ONE MORE HIT`; no hook ≥ 0.8 m/s → `ONE HARD HOOK`); win only: the next medal (match 2+). **The goal line is the hint:** pressing REMATCH after a goal re-arms that skill's coaching caption once in the next match. Numbers count up over 600 ms with ticks.

**Buttons, gated by `matchesPlayed`:** matches 1–2: `REMATCH` (focused) only, plus (match 1, once ever) the 8-word line `FEELING IT IN YOUR STOMACH? ESC → STABLE CAMERA`; match 3+: `REMATCH` · `NEW OPPONENT` · `SHARE` (one key; opens `SAVE CLIP` / `COPY BOUT` / `CHALLENGE A FRIEND`). Enter always means REMATCH. Nothing on the verdict writes the clipboard on its own. The consent strip (9) sits at the bottom of the match-2 verdict and never takes Enter.

### 8.3 Artifacts every match mints, no server

- **Bout Card** (text, `COPY BOUT` only, no auto-copy, no toast on REMATCH):
  ```
  TORQUE LIMIT #0412  PILOT 2–1 BACKLASH
  🟦🟦⬛   1.62 m/s hook · 94 ms reflex · 3 cubes launched
  ```
  Bout number = daily seed (`hash(date)`, rotating opponent, tier by record), so two people who played today fought the same scatter and can compare. No URL unless the setting is on.
- **Auto-clip** (match 3+): during the earned `match_replay` (3.5 s, orbit camera, already rendered) record the canvas with `captureStream(30)` + `MediaRecorder` (WebM in Chrome, MP4 in Safari), wordmark and bout number burned in bottom-left, `SAVE CLIP` and `navigator.share({files})` on mobile. No rolling recording. POTG selector adds an Overwatch-style difficulty weight: contact speed × (1 + guard-up at impact) × (1.5 if within 2 s of round end). The loser's KO slump and any cube that leaves the deck are eligible: **the funny failure is the TikTok clip.** ROOK has one caption class for chaos only: "THAT'S GOING ON THE SHOW."
- **Challenge file:** export the episode as `.tl` (only when `consent.scope === 'share'`; the file carries `scope`); a friend drops it on REGISTER ENTRANT and fights *your arm* (the `replay` driver plays your recorded `sim.ctrl`) with your callsign on the plate. Drivatar without the model; every shared file is a labelled human demonstration. The social feature is the dataset.
- **Medals** (counted from match 2): three stamps per opponent on the entrant card: BRONZE beat them (match 1's win counts for BRONZE), SILVER 2–0, GOLD 2–0 with a lock or a clutch steal. Nine stamps, then user models. No XP, no currency.

### 8.4 Guards against churn

**LLL rule:** after two straight losses to the same opponent the third match is one tier down with Underdog Dock from round 1 and a host line ("Rookie's been watching tape"); below Rookie is the **SPARRING tier**: BACKLASH with the sparring cadence, no SLAM, opening grace 5 s, strike damage ×0.6, plus the `GUARD · HOLD RMB` caption on every heavy tell. After a win the tier restores silently. No opponent above Rookie until `matchesPlayed ≥ 3` or a 2–0. First session target 5–8 min = 4–5 matches. **No midpoint twists.** DOUBLE TORQUE, SLICK DECK, HOT CORE and LIGHTS OUT are cut: a random modifier per round breaks feeling 1 (the arm stops doing what it did last round), LIGHTS OUT breaks 5.1, physics twists break the re-simulation gate, and they pollute the ARCADE data that tunes DDA and personalities. Their hours go to the rematch intro (6, last row) and the memory captions (4.5). Streamer fields with zero backend: `NAME THE CHALLENGER` and `CHAT SEED`.

### 8.5 Metrics (localStorage ring `torquelimit.metrics.v1`, read from the console during playtests)

Conversion to play ≥ 70 %; time to first hit ≤ 15 s median; first-match completion ≥ 80 %; matches per first session ≥ 4; rematch rate ≥ 60 %; share rate ≥ 10 % (from match 3); drills per first session ≥ 1, drill completion ≥ 70 %; consent decisions with `decisionMs ≥ 800` ≥ 90 %; LLL verdicts trending to 0; D1 ≥ 30 %.

---

## 9. The data product and consent loop

The game is the front door for two datasets, and the promise to the player is split the way the data actually splits. Every match already re-simulates bit-exact, so **camera images are never rendered live**; `qpos` per tick is enough to render any camera later on homebase with MuJoCo's renderer (wrist first, then overhead and front), with lighting and viewpoint randomisation per episode.

- **Two lanes, one game, two honest sentences.** **Opponent lane:** CORNER opponents are trained on **duel** data, and ARCADE duels are fine for it (the opponent lives inside the game's physics; the `to_lerobot.py` arcade refusal is about the real arm). CORNER v1 = k-NN over `sim.ctrl` chunks keyed on obs/3 state + opponent_state from shared ARCADE duels, running in the policy Worker; its stamp reads `TRAINED ON 1,204 DUELS`. **Robot lane:** the public SO-101 dataset comes only from **stock physics** (SYSTEMS CHECK drills DOCK / STACK / KEEP AWAY, and PROVING GROUND with assists flagged per tick); its counter reads `ROBOT DATASET: 812 drills`, always separate from `CORNER v3: 1,204 duels`. CORNER v2 (drills) trains the drill demonstrator (the ghost that shows a solved drill), never a duel opponent: a solo-task policy seated in a duel is out of distribution on every axis. Do not try to make ARCADE honest.
- **Drills in the flow** (WP6): the **SYSTEMS CHECK** is a 20 s DOCK drill under stock physics, no shaping, inserted **after match 2's verdict** (gate `matchesPlayed === 2`, so the first minute and the first rematch, the highest-pull moment, are untouched), framed as the boot check for the next opponent: your arm reboots at stock torque, the Core drops, dock it, `SYSTEMS NOMINAL`, then the intro. STACK unlocks at match 3, KEEP AWAY at match 5; one drill per session unless the player opens SYSTEMS CHECK from the green room. `meta.rounds[i].task` = `dock the core from pose 3 zone B` (25–50 chars), `physics: 'stock'`, `preset: 'harness'`. Drill segments: `approach | grasp | lift | transport | place | retract | recover` from grip state, Core height and dock distance; duel segments stay `carry | contest | guard | attack | idle`.
- **Honest diversity.** One MuJoCo scene, one Core mesh and one servo model with only pose and position varying is 1,600 demos of one environment-object pair; the dataset card says its role is **sim pretraining / co-training with real SO-101 Hub data**, not deployment data. Buy variation that still re-simulates: 3 Core variants (mass 40 / 80 / 120 g, size ±15 %) and 3 cube sets chosen per drill by seed via a new `object_variant` mutation; per-episode servo kp/kv ±10 % through the existing `servo_profile` mutation; friction ±20 % via a new `geom_friction` mutation `{ kind: 'geom_friction'; step; geom; friction: [number, number, number] }`. Grid: 8 rest poses × 4 zones × 3 objects = 96 conditions × ~17 demos per drill.
- **Episode `torquelimit.episode/4`** (additive): `meta.session` per `SessionMeta` (11.9): random resettable `pilotId`, generated callsign, `consent {version, grantedAt, scope, decisionMs, inputMethod}`, a **non-fingerprinting** device block (`gpuTier: 'apple' | 'integrated' | 'discrete' | 'unknown'`, viewport in 4 buckets, dpr to 0.5, fps to the nearest 5, `mouseSensitivity`, `invertY`, `gamepadDeadzone`), build with `inputMappingSha` (hash of `bindings.ts` + pilot-controller constants), sessionIndex, matchIndexInSession, skillPrior; `meta.opponentMemory` (4.5); per-tick `human.raw` f32[8] (mouse dx/dy, buttons, keys, sticks), `human.command` f32[6] captured **before** any life layer, `human.shaping` u8, `human.active` u8, `human.gaze_hint` f32[2], `dda.k` f32; per-round `task`, `physics`, outcome, segments; `meta.quality` {clean, tier A–D, version} from `stats.ts`. No IP, no email; the exact device numbers live only in the local metrics ring, never in the episode.
- **One-tap labels**, never mandatory: **per round** on the round card, "What were you going for?" (RUSH / BAIT / TURTLE / CORE / MESSING AROUND), gone after 2 s; **per match** on the verdict (match 3+), one question, "Did BACKLASH feel like a person?" (1–5 hearts, the only honest measure of feeling 2) or "Rate your run" (CLEAN / SLOPPY), alternating. Every label stores `{skipped, shownMs}` and the `opponentBuild` (personality, tier, mean `dda.k`, CORNER version/sha) in `sparse.labels`.
- **Consent, freely given, never in the way.** A two-button strip at the bottom of the **match-2 verdict**, REMATCH still focused, Enter still REMATCH: `HELP TRAIN THE ARM · [SHARE MY MATCHES] [KEEP LOCAL] · what is recorded?` The two buttons activate 1.5 s after the verdict appears, respond only to a pointer click or Tab focus + Space (never Enter), and `consent.decisionMs` / `inputMethod` are recorded; a decision under 800 ms is stored as `local` and the strip returns at match 5. Unanswered = local, the strip returns on later verdicts at most once per session. Full text behind "what is recorded?": "Every match is recorded on your device as robot data (joint angles, your inputs, what happened). SHARE trains the CORNER opponents everyone fights (from duels) and adds your drills to a public robot dataset under your callsign. We never store your name, email or IP. This callsign is published. Opponents already trained and dataset versions already published keep what they learned. Change your mind any time in Settings: SHARE OFF and DELETE MY DATA." Match-1 and match-2 episodes stay local until the strip is answered; a later SHARE uploads them.
- **Callsign and identity.** Default callsign is generated (`PILOT-7F3A`), editable, with "this name is published" under the field and a reject list for email-like or two-word inputs. `RESET PILOT ID` is disabled until `DELETE MY DATA` has been sent and acknowledged; prior ids are kept in `torquelimit.pilot.history` so a later delete can name them. Challenge files carry `scope` and export only under `share`.
- **What the player sees back:** post-match `CLEAN RUN` stamp (or SLOPPY with the one reason); **WATTS per completed drill, not per second** (A 20 / B 10 / C 3 / D 0, at most 30 counted drills per pilot per day; duel rounds earn a flat 2 for the opponent lane; not spendable; ranks the CONTRIBUTORS roll, which shows the quality version); every CORNER opponent carries `TRAINED ON 1,204 DUELS`, and when you beat one ROOK says it was trained on your data and VALE says how many. Title line only per the gate table in 2. Contributor roll + `CITATION.cff`. CC BY 4.0.
- **Quality tier per drill round** (frozen at dataset v1, `meta.quality.version` stamped, the board shows the version): A = `outcome: success`, `durationS` within [p10, p60] of the reference distribution, 0 table hits, LDLJ > −8; B = success with any of those missed; C = attempted (≥ 1 grasp event) but failed; D = idle / AFK. A slow smooth arm that docks nothing is a D, not an A.
- **Upload:** gzip `.tlep.json` (≤ 16 MB) in the background after the verdict, never blocking rematch, queued in IndexedDB when the tab closes first; receiver = Cloudflare Worker + R2 (homebase cannot receive from the public internet); homebase pulls hourly and **re-simulates as the anti-tamper gate against the archived build** (`~/work/torque-limit-data/builds/<sha>/{mujoco.wasm, arena*.xml, so101.xml, tuning.json}` keyed by `provenance.commit`; every deploy archives its build); DIVERGED episodes are **quarantined with a reason** (`build_missing`, `checksum_mismatch`), never deleted; divergence rate per build on the dashboard, target < 2 % (a rise is a determinism bug, not fraud). Scores quality, converts with `to_lerobot.py`, publishes LeRobot v3 weekly at **25 fps** (`--decimate 2`, exact) with the native 50 fps as a second repo, the card saying which to use for co-training; trains CORNER (k-NN first, then ACT on CPU). Local retention: keep the 20 most recent human episodes after a `202`; `episodes_human` is capped at **200 MB for `local` too** (evict oldest, one toast at 150 MB with EXPORT).
- **Exporter delta** (WP8, `tools/export/to_lerobot.py`): (1) read `meta.rounds[i].task`, fall back to the current string; (2) `--min-tier A|B|C` from `meta.quality.tier`; (3) features `human.shaping` int64[1], `human.command` f32[6], optional `human.raw` f32[8] behind `--with-human`; (4) drill reward +1 on the `task_success` event row, 0 elsewhere, `next.done` at success or timeout; (5) episode-level filter `--max-shaped-frac 0.05` (drop the round, never the tick: masking ticks breaks the temporal continuity ACT and BC-RNN need); (6) `--robot-type so101_follower` default, documented on the card; (7) keep the arcade refusal and add `--lane opponent`, which allows arcade and writes `matches.parquet` instead of a LeRobot dataset; (8) `--decimate 2`.
- **Order:** session block + consent strip + raw columns + quality stamp (half a day) → upload path (1–2 days) → **CORNER v1 (duels)** stamp → **SYSTEMS CHECK drill in the flow** → dataset v1 (drills, 25 fps) → one-tap labels → offline camera render → CORNER v2 (drill demonstrator) → streak and roll → TAKE OVER as intervention recording.

---

## 10. Performance budget and the optimization order

### 10.1 Targets (DEFAULT tier: 1280 × 720, DPR 1.25, M1/M2 Air, Chrome, cockpit, 3-round match after 5 min)

| Metric | Today (director, 2026-09-26; **re-measure on the current head before WP1**) | Target |
|---|---|---|
| fps / frame p95 | 60 with a 1000 ms hitch | 60, p95 ≤ 16.7 ms, **no frame > 25 ms after FIGHT** |
| shader programs | 98 vs 92 prewarmed (6 compile after boot) | **N = M at every frame** except the safe phase in which a tier applied, and N = M again before the next `fight`; `?debug=feel` line `programs N (prewarm M)` |
| draw calls | 166 (stale) | **≤ 90** |
| triangles incl. reflection + shadow | 1.32 M (stale) | **≤ 0.45 M** |
| input latency (motion-to-photon) | 34 ms | **≤ 36 ms, no regression** (the vsync'd rAF floor on macOS is ≈ 33 ms; the measurable levers are whine onset ≤ 5 ms, ghost same-frame, arm onset ≤ 45 ms) |
| first pixel / click-to-swing | — | ≤ 1.5 s / ≤ 6 s on 20 Mbit/s with the mesh bake |
| bloom coverage | — | < 5 % of pixels |
| GPU (estimate, to be replaced by differencing) | 11–15 ms | main 2.0, shadow 1.0, reflection 0.7, N8AO 1.8, bloom 0.9, streak 0.25, merged post 0.5, beams 0.5, HUD 0.6 ≈ **8.3 ms** |
| JS heap over a match | — | < 5 MB growth, no GC pause > 4 ms |
| physics | 0.55 ms p50 (M5) | ≤ 1.2 ms p95 per 16.7 ms of sim |

### 10.2 Order (each step measured by differencing with `?debug=feel` before the next)

1. **Kill the post-boot shader compiles: the culprits are in `post-stack.tsx`.** The VFX pools already build their materials in `createVfxSystem` and the hit light is already mounted at 0; the six programs come from (a) DoF and SMAA flipping `blendFunction` to `BlendFunction.DST` after `POST_PREWARM_FRAMES` (postprocessing's `EffectPass` listens to blendMode `change` and recompiles the merged pass) and (b) the composer keyed `msaa-${tier.msaa}`, so the first `PerformanceMonitor` decline at `round_intro` remounts the composer and compiles N8AO + DoF + bloom + the effect pass mid-match. Fix: remove the composer key; change MSAA imperatively (`composer.multisampling = n` recreates the input buffer without a compile); never pass changing props to wrapped effects: hold refs and set `effect.enabled` (the N8AO wrapper already does), never `blendFunction`; mount DoF only on HIGH at boot and never toggle it; after `applyIfSafe` run `prewarmScene` + 3 post frames and assert `gl.info.programs.length === programsAfterPrewarm` before the round starts; `compileAsync` so the loading screen animates. Keep the per-event program diff log (first strike, deflect, Core drop, KO, tier change; material name per new program) as the verification tool, not the fix. Acceptance: the 10.1 programs row; Performance panel shows no `linkProgram` after boot outside a safe phase.
2. **Stop the discarded passes.** DoF's seven internal passes and SMAA's three run on every tier today even when blended out. Mount per tier at boot (step 1). Saves 1.5–2.5 ms.
3. **Bake the arms** (`scripts/bake-meshes.mjs`, from GAME_DESIGN 10.6, lands in WP1): LOD0 (35 %) and LOD1 (15 %) with `MeshoptSimplifier` (inside `three@0.185.1`), welded pre-crease mesh, `LockBorder`, target error 0.01, `buildRenderGeometry` for crease normals and the edge mask, meshopt-encoded ≈ 3 MB total; serve the bake, keep the 17 MB STL path as the dev fallback. Until the bake lands the attract plays without arms (2). A load-time Worker for the fallback simplify is fine; the no-workers rule below is about physics, policy stepping and OffscreenCanvas. 296 k → 104 k per arm.
4. **Reflection pass: `REFLECTION_LAYER` only** (arms LOD1 + LED line + cubes + hit light), 480 × 270, **every frame**. Removes ~50 draws and ~90 % of the pass.
5. **Spots out of the forward shader** (5.2): rims → `uRim` fresnel, sweeps → deck projection + cones. Each lit fragment evaluates 1 directional + 1 point + hemi + env instead of 6 lights; shells' programs shrink; grey card re-verified at 0.34 with the 5.3 triple.
6. **Skinned merge**: one `SkinnedMesh` per (arm, material slot) with 8 rigid bones; 28 → 8 draws; `interpolateBody` writes bone transforms; `uLinkKind` becomes a vertex attribute. Only after 1–5 are green.
7. DEFAULT: MSAA 0 + SMAA (mounted); HIGH keeps MSAA 4. Shafts 6 → 2, one octave, radius 0.16. Shadow map 1024 on DEFAULT. Cyclorama `renderOrder` 10 (after opaques). `MAX_STEPS_PER_FRAME.arcade` 16 → 12.
8. Latency: confirm no render lerp on the command path (fixed-step interpolation ≤ 5 ms only), aim yaw applied in the same render frame, whine scheduled in the input handler; measure with a 240 fps phone on the laptop and accept no regression from 34 ms. A lower number exists only via `desynchronized: true` on Windows/Linux Chrome behind a setting; never on macOS.

Cut order if still over budget, preserving the look: reflection 480 → 320 × 180 → N8AO off (blob shadows carry contact) → **reflection every other frame** → bloom levels 5 → 4 → cones 2 → 1 → DPR 1.25 → 1.0. Never physics or policy workers, never OffscreenCanvas, never a desynchronized canvas on macOS.

---

## 11. Work packages (Phase 0, then 8 parallel packages with strictly disjoint file ownership)

Rules: edit only the files your package owns; every path below appears exactly once; anything not listed (`src/game/physics/*`, `src/game/kinematics/*`, `src/game/harness/{determinism,replay-player,suite,verdict,aggregate,harness-api,moment-buffer,entrant-store,episode-store-fs,typed-b64}.ts`, `src/game/policy/{bridge-*,chunk-executor,observation,obs-schema,action-validation,registration,seat-drivers,trajectory,proxy-*}.ts`, `src/game/loop/{headless-runner,turbo-gate,event-ring}.ts`, `src/game/core/{rng,ui-store,hud-frame}.ts`, `src/app/page.tsx`, `src/app/pwa-register.tsx`, `src/game/testing/fakes.ts`, `src/game/policy/proxy-bots/*`) is **frozen** for this pass: no package touches it; cross-package needs go through the contracts in 11.9 or the handoff; **a package that needs a one-line edit outside its files posts it in the handoff and the owner applies it the same day**; no new dependencies; no new shader programs after prewarm (boot-time variants only); nothing plays audio out loud; HARNESS and PROVING GROUND stay byte-identical for physics; typecheck, lint and owned tests green on homebase before finishing; delete what you replace. Acceptance is checked on the real GPU in short muted sessions per section 12.

### Phase 0 (≤ 1 day, one agent, before anything parallel)
1. WP8 lands `src/game/contracts.ts`: `MATCH_PHASES` + `attract`, `boot_ritual`, `entrance`, `count_in`, `round_summary`, `verdict`, `systems_check`; `REFLECTION_LAYER = 5`; `LodGeometries { lod0, lod1 }` per (link, slot); `FeedbackFrame`, `LedFrame`, `OpponentAffect`, `ShowEvent`, `ReticleState`, `Prewarmable`, `SessionMeta`, `QualityMeta`, `OpponentMemory` (added to `ResetContext`), `SimMutation` + `geom_friction` and `object_variant` (11.9).
2. WP1 lands `robot-assets.ts` LOD output and a `robot-view.tsx` that consumes `LodGeometries` and sets `REFLECTION_LAYER`; `quality.ts SAFE_PHASES`, `stage-cues.ts isShowIdlePhase` and `hud-runtime.ts` are then updated by their owners against the new phase names on day 1 of the parallel pass.

### WP1 PERF + RENDER STRUCTURE: zero compiles, half the triangles (section 10)
**Owns:** `src/game/render/prewarm.ts`, `src/game/render/post-stack.tsx`, `src/game/render/quality.ts`, `src/game/render/robot-assets.ts`, `src/game/render/robot-view.tsx`, `src/game/render/shadow-proxies.ts`, `src/game/render/arena-canvas.tsx`, `src/game/render/range-arcs.tsx` (delete), `src/game/render/frame-timing.ts`, `src/game/render/debug-scenes.tsx`, `src/game/render/interpolate.ts`, `src/game/render/boot-resize.ts`, `src/game/loop/sim-driver.ts`, `src/game/loop/game-clock.ts`, `scripts/bake-meshes.mjs` (new), `tests/stl-geometry.test.mjs`, `tests/interpolate.test.mjs`, `tests/sim-driver.test.mjs`, `tests/game-clock.test.mjs`.
**Does:** 10.2 steps 1–4, 6, 7, 8; `createArmRig` LOD0/LOD1 and the skinned merge in `robot-view.tsx`; reflection layer masks on the arms; `RangeArcs` deleted with its import; the calibration triple of 5.3 (exposure 0.70, grade, grey card 0.34, `environmentIrradianceEstimate` 0.10, `predictDisplayValue` unit test, bloom, streak effect, impact-frame uniform on GradeEffect); DoF/SMAA per-tier mounting; near plane 0.02 and `OWN_ARM_DITHER_DEPTH_M` from WP2's band; `?debug=feel` gains `programs N (prewarm M)`, per-program names on growth, max roll/FOV/trauma per round, and a compile log; the hit-stop clock in `sim-driver` via WP5's `hitstopMsFor` (attacker ghost release at 60 %).
**Acceptance (real GPU):** programs per the 10.1 row over a 3-round match with a KO, a deflect, a steal and a tier change; no frame > 25 ms after FIGHT; ≤ 90 draws; ≤ 0.45 M triangles; `?debug=greycard` reads 0.34 ± 0.03 and `predictDisplayValue` agrees; bloom coverage < 5 %; frame p95 ≤ 16.7 ms at 5 min; loading screen animates during compile; first pixel ≤ 1.5 s and arms present ≤ 3 s on a throttled 20 Mbit/s profile; no reach arcs exist.

### WP2 LOOK: the night show, decluttered (section 5)
**Owns:** `src/game/render/lighting.tsx`, `src/game/render/cyclorama.tsx`, `src/game/render/holo-crowd.tsx`, `src/game/render/holo-crowd-material.ts`, `src/game/render/led-strips.tsx`, `src/game/render/brand-textures.ts`, `src/game/render/deck-texture.ts`, `src/game/render/stage-deck.tsx`, `src/game/render/jumbotron.tsx`, `src/game/render/stage.tsx`, `src/game/render/cubes-view.tsx`, `src/game/render/blob-shadows.ts`, `src/game/render/robot-materials.ts`, `src/game/render/robot-decals.ts`, `src/game/render/lobby-tiles.tsx`, `src/game/render/vfx/haze.ts`, `src/game/render/vfx/stage-cues.ts`, `tests/deck-texture-layout.test.mjs`, `tests/crowd-instancing.test.mjs`.
**Does:** every row of 5.2 (crowd 160 / 2 tiers / ≤ 18 % / desaturated; dasher static and dim with the 1.5 s sponsor panel swap; boards static ≤ 0.08 emissive; deck hazard cut; cubes as objects; spots removed → fresnel rims at gain 4.0 + deck-projected sweeps + 2 cones; fog 2.7 / 7), 5.3 light rig (key 3.2 at 48°, hemi 0.12, env 0.7 with the 0.10 sr streak; the intro reveal as key 0.3 / hemi 0 / one cone on the mount), 5.4 materials (gradient, the two boot-time variants with cache keys, per-link LED uniform, deck fresnel and print mask in `stage-deck.tsx`, `OWN_ARM_DITHER_BAND` 0.02, decals), `REFLECTION_LAYER` on the LED line and cubes, 5.6 living background numbers, `isShowIdlePhase` for the new phases.
**Acceptance:** greyscale thumbnail of a mid-fight frame reads opponent > pilot arm > deck > bowl; a continuous magenta edge on the opponent's silhouette in the rest pose that blooms, and no magenta on the bowl; both arms unfogged; crowd ≤ 18 % of frame height and not pink/blue below hype 80; exactly one ribbon and it does not scroll during a fight; boards never animate during a live round; no hazard stripe on the deck; clearcoat streak visible on the opponent's upper two links; a 10 s idle recording shows all five layers moving and nothing faster than the eye follows; 0 SpotLights in the scene graph; no program appears after prewarm when any variant material first draws.

### WP3 BODY: the pilot's hand, input and the camera (section 3)
**Owns:** `src/game/input/pilot-controller.ts`, `src/game/input/assists.ts`, `src/game/input/haptics.ts`, `src/game/input/input-system.ts`, `src/game/input/bindings.ts`, `src/game/input/gamepad.ts`, `src/game/input/touch-input.ts`, `src/game/render/ghost-arm.tsx`, `src/game/render/reticle-overlay.tsx`, `src/game/render/camera-director.tsx`, `src/game/render/camera-math.ts`, `src/game/camera/cockpit-rig.ts`, `src/game/camera/juice.ts`, `src/game/camera/springs.ts`, `src/game/camera/noise.ts`, `tests/pilot-controller.test.mjs`, `tests/assists.test.mjs`, `tests/gamepad.test.mjs`, `tests/cockpit-rig.test.mjs`, `tests/juice.test.mjs`, `tests/camera-math.test.mjs`, `tests/reticle-projection.test.mjs`, `tests/touch-input.test.mjs`, `tests/synthetic-input.test.mjs`.
**Does:** 3.1 ghost as hand (thresholds from match 1, amber hue, ribbon leash, half-space clip from the last contact, tutorial branch deleted), 3.2 breath / idle / action breaks (command-side, flagged off in HARNESS) and the render-only tremor + heat as `FeedbackFrame.vibration.atlas` input, 3.3 LED state machine driving WP2's per-link LED uniform, 3.4 gripper stages and boot-ritual pose sequence (timing driven by WP6's phase), 3.5 camera rules as asserts, FOV 58° and the unchanged eye/target, section 6 camera columns (recoil, kick-away, trauma 0.15 + 0.20·m taken, FOV, stagger dip, KO slow-mo window), the streamlining windows (buffer, coyote guard, magnetism, aim-brake, whip carry), match-1 assists (reach depth tracking τ 150 ms, auto-grip on Core contact) flagged in `human.shaping`, haptics table with the 75 ms merge window, range cue moved into the reticle (`ReticleState`), whine trigger in the input handler, STABLE as a pause-menu toggle.
**Acceptance:** motion-to-photon ≤ 36 ms with no regression and arm onset ≤ 45 ms on a 240 fps phone recording; ghost never coincides with the arm and never passes through the opponent; reticle ring fills in the sweet band; max roll ≤ 3°, FOV punch ≤ 6°, trauma ≤ 0.35 per `?debug=feel`; with the reticle on the opponent's gripper its mount and both LED lines sit inside the centre 60 % of width; eyes-shut test: dealt vs taken told apart 9/10 by camera + rumble alone on a gamepad; `human.command` in a recorded episode contains no tremor spectrum above 5 Hz at idle.

### WP4 CHARACTER: the opponent (section 4)
**Owns:** `src/game/policy/opponent/*` (all ten files; `jig.ts` deleted after folding), `src/game/policy/in-process-driver.ts`, `src/game/policy/policy-worker.ts`, `tests/opponent-behavior.test.mjs`, `tests/opponent-determinism.test.mjs`, `tests/opponent-humanness.test.mjs`, `tests/opponent-opening.test.mjs`, `tests/dda.test.mjs`, `tests/flaws.test.mjs`, `tests/heavy-guess.test.mjs`.
**Does (in this order):** balance the tier table (`tiers.ts`, `dda.ts`) until the 12-seed test is green; then 4.1 layered motion language (affect posture, breathing, gaze, commanded flinch on the first decision tick), 4.2 tells with per-primitive minimums, 4.3 animation groups gated by tier, 4.4 target-shaping temperament, 4.5 menace gauge, memory read from `ResetContext.opponentMemory` only, decision→show events; opening grace 3 s; LLL tier rule, SPARRING tier and first-session cap in `dda.ts`; BACKLASH's `sparring` mode (parked in reach, held SLAM tell ≤ 3 s on cue, 0 damage dealt / taken, re-approach, beckon instead of POKE) driven by the tutorial script's cues; CORNER v1 k-NN driver in the Worker.
**Acceptance (harness, then GPU):** life metric: Σ|Δq|/dt over six joints never < 0.02 rad/s for > 400 ms in idle; every strike in a replay has a gaze-on-target event 150–400 ms earlier (except POKE) and a tell above the per-primitive minimum (SLAM ≥ 300 ms); **commanded recoil within two decision ticks of every contact above threshold**; < 10 % of primitive boundaries fully settle; action-jerk bound holds with all layers on; 12-seed balance test green before and after the behaviours land; a match replayed with the same `opponentMemory` is bit-exact and with a different one is not; on the GPU the opponent's LED and whine visibly lead a SLAM and the `OPEN` tag appears on every whiff from match 2.

### WP5 FEEL: hits, VFX, hype (section 6)
**Owns:** `src/game/combat/tuning.ts`, `src/game/combat/combat-rules.ts`, `src/game/combat/damage.ts`, `src/game/combat/heat.ts`, `src/game/combat/abilities.ts`, `src/game/combat/servo-states.ts`, `src/game/combat/core-objective.ts`, `src/game/feedback/feedback-system.ts`, `src/game/feedback/hype.ts`, `src/game/render/trails.ts`, `src/game/render/vfx/*` **except** `haze.ts` and `stage-cues.ts` (i.e. `arcs.ts`, `bursts.ts`, `chips.ts`, `confetti.ts`, `core-beam.ts`, `decals.ts`, `derez.ts`, `lock-pulse.ts`, `prize-burst.ts`, `rerender-scan.ts`, `ripples.ts`, `smears.ts`, `sparks.ts`, `vfx-system.ts`), `tests/hitstop-table.test.mjs`, `tests/hitstop-budget.test.mjs`, `tests/vfx-pools.test.mjs`, `tests/derez-timeline.test.mjs`, `tests/crowd-hype.test.mjs`, `tests/combat-damage.test.mjs`, `tests/combat-defense.test.mjs`, `tests/combat-heat.test.mjs`, `tests/combat-abilities.test.mjs`, `tests/servo-states.test.mjs`, `tests/core-objective.test.mjs`, `tests/core-steal-countdown.test.mjs`.
**Does:** `hitstopMsFor = clamp(50 + 125·m, 50, 150)` with crit +20; sparring damage rules (0 dealt / 0 taken in match-1 round 1, ×0.6 in the SPARRING tier) in `damage.ts`; match-1 round-2/3 tiebreak (first strike, then damage) and the no-Sudden-Death flag in `combat-rules.ts`; `FeedbackFrame` per 11.9 (vibration per seat including the victim's contact-frame flinch and the pilot's tremor, impact frame, lens smear, LED flare, deck flash, hit light); every VFX row of section 6 (sparks that land and stay, scuff decal atlas, chips, arcs, clash ring, deflect chevrons, cube edge glints, Core countdown face, de-rez, confetti on match win only, dock rings only while live, `OPEN` / `WHIP` / `PUNISH` event tags gated by `showKit`); hype inputs and `lean` from section 7's crowd model; overtime rule (steal inside last 5 s, 10 s cap); every pool exposes `prewarmDraw()`; whiff recovery (τ×0.8, +10 heat), deflect refund, WHIP +10 %.
**Acceptance:** `hitstop-table` is continuous (50 at 0, 100 at 0.4, 150 at 0.8, never a jump > 2 ms between adjacent m); a hit at m = 0.8 shows sparks that remain on the deck 10 s later, a scuff, the victim vibrating on the contact frame and through the freeze, the deck edge flash, and a number popping 1.4→1; crit shows two inverted frames; dock ring invisible during a fight with no Core in play; WP1's program log stays flat when any VFX fires for the first time; hype trace crosses 50 twice in an average ARCADE match; a sparring-round contact changes no Integrity.

### WP6 SHOW FLOW: the first 60 seconds, the loop and the demo (sections 2, 8, 12.2)
**Owns:** `src/game/match/match-director.ts`, `src/game/match/match-config.ts`, `src/game/match/presets.ts`, `src/game/match/replay-moments.ts`, `src/game/match/tutorial-script.ts`, `src/game/ui/screens/*` (all sixteen files; `cockpit-choice.tsx`'s pre-fight path deleted), `src/game/ui/meta/profile.ts`, `src/game/ui/meta/superlatives.ts`, `src/game/ui/hud/match-intro.tsx`, `src/game/ui/hud/replay-overlay.tsx`, `src/game/ui/hud/best-score-strip.tsx`, `src/game/game-root.tsx`, `src/game/client-entry.tsx`, `src/game/game-handle.ts`, `scripts/demo-capture.mjs` (new), `tests/match-director.test.mjs`, `tests/replay-moments.test.mjs`, `tests/tutorial-script.test.mjs`, `tests/presets.test.mjs`, `tests/profile.test.mjs`, `tests/superlatives.test.mjs`.
**Does:** boot order (arena shell first, `LOADING %` CTA, attract from one canned episode with the four-beat camera plan, arms fading in when the bake lands, click = fight with the ≤ 1.5 s compile hold, no lobby, no cockpit prompt); intro 4.0 s / rematch 2.4 s with the entrance gesture, boot ritual phase, count-in at eighth notes, one FIGHT slam; **match 1 = best-of-3 vs BACKLASH** with round 1 driven by `tutorial-script.ts` (step caps 12 s / 3 wind-ups / 20 s, passive nudge, skipped-skill → goal, 4.0 s lock-in, no siren), rounds 2–3 at 30 s with the tiebreak, the round-2 intro as the same arm standing up; `showKit` gate table from section 2; round card 3 s; verdict 8.2 with the loss-cause table, button gating, the once-ever STABLE line, the goal-as-hint re-arm; consent strip placement and timing on the match-2 verdict (copy and storage from WP8); SYSTEMS CHECK drill phase after match 2 (stock physics preset, task string, `SYSTEMS NOMINAL`); Bout Card via `COPY BOUT` only; auto-clip from match 3 (`captureStream` during `match_replay`, Safari MP4, Web Share); challenge-file import on REGISTER ENTRANT (share scope only); medal stamps from match 2; daily seed; streamer fields; one-tap label UI per 9; GG-tap window with the `TAP · LMB` caption; opponent memory store in `profile.ts` passed through `ResetContext`; green room and title restyled to the show; **demo capture** (12.2): `scripts/demo-capture.mjs` replays a chosen `episode.tl` through the cockpit and orbit cameras at 1280 × 720 / 60 fps with `captureStream`, muted, and emits the cut list on the music grid.
**Acceptance:** tab open → first strike contact ≤ 15 s on a mid laptop; round 1 of a fresh profile is won by ~44 s, 60 s worst case with only mouse contact, BACKLASH dealing and taking 0 damage; a fresh profile never sees Sudden Death, a siren, `OPEN`, heat or abilities in match 1; verdict readable in ≤ 6 s with REMATCH focused and 3.4 s to control, match 1–2 verdicts show one button; a loss screen always shows a named gap and a goal; `COPY BOUT` yields the 2-line card and nothing writes the clipboard otherwise; `SAVE CLIP` produces a 2–4 MB WebM of the replay with the wordmark burned in; a `.tl` dropped on REGISTER ENTRANT fights the recorded arm under the callsign; rematch intro shows the loser's sulk and the memory caption; the drill appears exactly once after match 2 and completes ≥ 70 % in playtests; demo v0 exists this week (12.2).

### WP7 BROADCAST: HUD, captions, hosts (sections 5.7, 7 hosts, 8.1)
**Owns:** `src/game/ui/hud/*` **except** `match-intro.tsx`, `replay-overlay.tsx`, `best-score-strip.tsx` (i.e. `banner-queue.ts`, `banners.tsx`, `captions.tsx`, `combo-bracket.tsx`, `core-marker.tsx`, `damage-edges.tsx`, `damage-numbers.tsx`, `debug-overlay.tsx`, `event-feed.tsx`, `format.ts`, `hold-skip-bar.tsx`, `hud-extra.css`, `hud-runtime.ts`, `hud.tsx`, `kit-panel.tsx`, `player-strip.tsx`, `policy-chip.tsx`, `stats-overlay.tsx`, `ticker.tsx`, `tote-board.tsx`, `turbo-plate.tsx`), `src/game/ui/kit/*`, `src/game/ui/touch/*`, `src/game/ui/broadcast-ui.tsx`, `src/game/announcer/*`, `src/game/brand/*`, `src/app/globals.css`, `src/app/mobile.css`, `src/app/layout.tsx`, `src/app/fonts.ts`, `STYLES.md`, `tests/hud-format.test.mjs`, `tests/banner-queue.test.mjs`, `tests/damage-number-merge.test.mjs`, `tests/styles-tokens.test.mjs`, `tests/copy-labels.test.mjs`, `tests/touch-layout.test.mjs`, `tests/announcer.test.mjs`, `tests/host-lines.test.mjs`, `tests/brand-marks.test.mjs`, `tests/ip-guard.test.mjs`.
**Does:** the in-match HUD reduced to the six elements (crosshair with the range ring from `ReticleState` and the receipt in the same node, opponent plate with the `SPARRING` tag / no-bar state, own bar mounted hidden and sliding in on first damage, Core marker, one caption with mouse glyphs, wordmark bottom-left); the per-element `showKit` gate table rendered; motion tokens 5.7; callout slams for FIRST BLOOD / CRIT / DEFLECT / STREAK / STEAL / KO / OPEN / WHIP / PUNISH; damage numbers, bar chunk with red ghost drain, word-band receipts and the volt PB delta; captions with prosody data; host scheduler on **caption units** (cadence, silence budget, variety, callbacks, narrative threads, momentum lines, crowd-meter lines, VALE coaching-only in matches 1–3 and telemetry-only numbers after, chaos class, name rule); sponsor reaction frames on the jumbotron bug only; result slab by cause; `SHORTED OUT` stamp; consent strip and one-tap label markup (behaviour from WP6, storage from WP8); IP guard cleaned of the twist names.
**Acceptance:** during a fight no HUD element other than the six is visible in match 1 and the own bar is hidden until the first damage taken; zero React commits per frame in-match; no in-match motion over 240 ms and nothing over the opponent's silhouette; a 3-minute match logs 14–26 caption units, no repeat within 20, ≥ 45 % of fight time with no caption visible, name ≤ 2×, never two units from the same host in a row; the first minute of a fresh profile logs ≤ 12 text events (+ coaching fallbacks); every KO caption starts ≥ 650 ms after the confirm; every loss verdict copy names the gap; every VALE number in a recorded match matches a telemetry value.

### WP8 SOUND AND DATA (sections 7, 9, 11.9)
**Owns:** `src/game/audio/*` (all ten files), `src/game/harness/recorder.ts`, `src/game/harness/episode-format.ts`, `src/game/harness/stats.ts`, `src/game/harness/provenance.ts`, `src/game/harness/episode-store.ts`, `src/game/harness/idb.ts`, `src/game/contracts.ts` (additive only; Phase 0 first; other packages read it), `src/game/core/settings.ts`, `src/game/core/event-bus.ts`, `tools/export/to_lerobot.py`, `tools/export/mixdown.mjs` (new), `tests/audio-graph.test.mjs`, `tests/synth-recipes.test.mjs`, `tests/music-score.test.mjs`, `tests/recorder.test.mjs`, `tests/episode-format.test.mjs`, `tests/stats.test.mjs`, `tests/settings.test.mjs`, `tests/event-bus.test.mjs`, `tests/storage-eviction.test.mjs`, `tests/provenance.test.mjs`.
**Does:** Phase 0 contracts; zero audio before t₀ with the click clack + murmur on resume; servo life for both arms from the first relay click with the opponent's whine on commanded velocity; the impact object with impulse scaling, reward offsets and audio-clock scheduling; near-KO state and KO release timing; ducks `heavy_hit`, `near_ko`, `steal`, `windup`, `last_3s`; priority mix; crowd model (mood, energy, anticipation, chant, hush, bored clap); music exchange gate, momentum stabs, count-in at eighth notes, final-round subtraction, sudden-death riser, victory/defeat tags; dock siren and steal alarm (match 2+); gripper and boot sounds; Web Speech prosody mapping behind the toggle; **offline match mixdown from an episode** (`tools/export/mixdown.mjs`: music scheduler, hosts, crowd and SFX on the episode's wall clock through `OfflineAudioContext`, for the demo and the LUFS tests). Data: episode `/4` (session block with the non-fingerprinting device block and `inputMappingSha`, consent with `decisionMs` / `inputMethod`, `opponentMemory`, raw input, command-before-life, shaping, active, gaze hint, dda.k, task strings, physics, segments for drills and duels, quality tier + version, one-tap label storage with `opponentBuild`); consent and share settings, generated callsign with the reject list, RESET gated on DELETE ack, pilot history; metrics ring; upload queue in IndexedDB; 200 MB local cap with the toast; the exporter delta of 9 (all eight items).
**Acceptance (offline renders + harness):** all targets in the last paragraph of section 7; nothing in the audio graph starts before the first user gesture; a recorded match re-simulates BIT-EXACT with the new columns present and the same `opponentMemory`; `meta.session.consent` present and correct in every new episode and absent of any exact device number; quality tier and version computed at match end; `to_lerobot.py --min-tier B` refuses ARCADE without `--lane opponent`, exports a drill with its task string, +1 reward on `task_success`, and `--decimate 2` yields exactly 25 fps; a full 3-round episode renders through the mixdown to a WAV whose LUFS matches the live target; on the GPU, eyes-shut test: hit / miss / blocked told apart 9/10 by sound alone.

### 11.9 Shared contracts (Phase 0; WP8 lands them in `src/game/contracts.ts`, everyone else reads)

```ts
/** Render structure. WP1 sets it on the arms; WP2 on the LED line and cubes; WP5 on the hit light. */
export const REFLECTION_LAYER = 5;
export interface LodGeometries { lod0: BufferGeometry; lod1: BufferGeometry }  // per (link, slot), from robot-assets (WP1)

/** Per-render-frame feel state, written by WP5 feedback-system, read by WP1 robot-view/post-stack and WP3 juice. */
export interface FeedbackFrame {
  vibration: { atlas: number; blaze: number };   // mm of render-only link vibration remaining (0..1.5): victim flinch, pilot tremor + heat
  impactFrame: number;                            // 0..1, GradeEffect uImpact, 2 frames then 0.5
  lensSmear: number;                              // 0..1, screen-space smear opacity, τ 6 s
  ledFlare: { atlas: LinkId | null; blaze: LinkId | null };  // link flashing white, 250 ms
  deckFlash: { seat: Seat | null; ms: number };   // edge strip flood
  hitLight: { on: boolean; seat: Seat; ms: number }; // PointLight intensity pulse (light stays mounted)
  hypeLean: number;                               // -1..1 from hype.ts, drives crowd tint above 80
}

/** Pilot LED state machine (WP3) → per-link LED uniform (WP2 robot-materials). */
export type LedState = "off" | "boot" | "lowered" | "ready" | "commit" | "guard" | "grip" | "hot" | "stagger" | "shorted";
export interface LedFrame { state: LedState; intensity: number; colour: [number, number, number]; perLink: Float32Array /* 8 × (r,g,b,i) */ }

/** Opponent affect, published at 10 Hz by WP4 mind.ts through the policy status channel; read by WP8 audio and WP7 hosts. */
export interface OpponentAffect { arousal: number; valence: number; stance: number; composure: number; menace: number }

/** Opponent memory: main thread (WP6 profile.ts) owns it, passes it in ResetContext; recorder stamps it; WP4 reads ctx only; HARNESS passes {}. */
export interface OpponentMemory { bestMove: string | null; hurtSide: -1 | 0 | 1; timeToFirstAttackS: number | null; feintsWorked: number; grudge: number }

/** New show events on the bus (WP4 emits the first six, WP5 the rest). Captions, audio and VFX subscribe. No twist event. */
export type ShowEvent =
  | { kind: "tell"; seat: Seat; primitive: "poke" | "jab" | "hook" | "slam" | "grab" | "feint"; ms: number }
  | { kind: "flinch"; seat: Seat; m: number }
  | { kind: "taunt" | "celebrate" | "dejected" | "curious" | "fear"; seat: Seat; variant: number }
  | { kind: "backstage"; seat: Seat; ms: number }
  | { kind: "open"; seat: Seat; ms: number }       // whiff recovery window
  | { kind: "whip" | "punish" | "late_guard"; seat: Seat }
  | { kind: "near_ko"; seat: Seat; u: number }
  | { kind: "steal_contact"; owner: Seat }
  | { kind: "cube_off_deck"; count: number }
  | { kind: "tutorial_step"; step: "hit" | "guard" | "grab" | "dock" | "hold"; done: boolean; capped: boolean };

/** Reticle range state, WP3 → WP7 crosshair. */
export interface ReticleState { fill: number /* 0..1 sweet band */; inRange: boolean; magnetism: number }

/** Every VFX pool (WP5) and set piece (WP2) exposes this so WP1 prewarm can draw it once. */
export interface Prewarmable { prewarmDraw(): void }

/** Recorded sim mutations, additive. Drills vary objects, servos and friction only through these so every episode re-simulates. */
export type SimMutation = /* existing */ | { kind: "geom_friction"; step: number; geom: string; friction: [number, number, number] }
  | { kind: "object_variant"; step: number; core: 0 | 1 | 2; cubes: 0 | 1 | 2 };

/** Episode /4 additions (WP8). Other packages never write these. No exact device numbers: this block must not fingerprint. */
export interface SessionMeta {
  pilotId: string; callsign: string;
  consent: { version: string; grantedAt: string | null; scope: "local" | "share"; decisionMs: number | null; inputMethod: "pointer" | "keyboard" | null };
  device: { input: "mouse" | "gamepad" | "touch"; pointerLock: boolean; viewportBucket: "≤720p" | "1080p" | "1440p" | ">1440p"; dpr: number /* to 0.5 */; fpsP50: number /* to 5 */; fpsP95: number; gpuTier: "apple" | "integrated" | "discrete" | "unknown"; mouseSensitivity: number; invertY: boolean; gamepadDeadzone: number };
  build: { gitSha: string; appVersion: string; form: "web" | "pwa" | "electron" | "capacitor"; inputMappingSha: string };
  sessionIndex: number; matchIndexInSession: number; skillPrior: 0 | 1 | 2 | 3 | 4 | null;
}
export interface QualityMeta { clean: boolean; tier: "A" | "B" | "C" | "D"; version: number; reasons: string[] }
```

Phase names added to `MATCH_PHASES` in Phase 0 and keyed on by everyone: `attract`, `boot_ritual` (1800 / 600 ms), `entrance` (1500 ms), `count_in` (870 ms, inside the ritual), `round_summary` (3000 ms), `verdict`, `systems_check`. `hitstopMsFor` stays the single pure function in `tuning.ts` and both `sim-driver` (WP1) and `juice` (WP3) call it.

---

## 12. Real-GPU review checklist and the demo

### 12.1 Review checklist (M1/M2 Air, Chrome, 1280 × 720, DPR 1.25, muted, close the tab after; one pass per package, then one full pass)

1. `?debug=feel` after a 3-round ARCADE match with at least one KO, deflect, steal, tier change: programs N = M outside the safe phase of the tier change and again before the next `fight`; 0 frames > 25 ms after FIGHT; p95 ≤ 16.7 ms; draws ≤ 90; triangles ≤ 0.45 M; max roll ≤ 3°, FOV ≤ 6°, trauma ≤ 0.35.
2. `?debug=greycard`: 0.34 ± 0.03 with `predictDisplayValue` agreeing. Screenshot mid-fight → greyscale thumbnail: opponent > pilot arm > deck > bowl. Histogram: ≥ 5 % pixels ≤ 0.03, ≥ 0.5 % ≥ 0.95, bloom < 5 %.
3. Rest-pose frame (READY, reticle on the opponent's gripper): continuous magenta rim on the opponent that blooms, none on the bowl; opponent's mount and both LED lines inside the centre 60 % of width, the LED lines converging on the mount; crowd ≤ 18 % of height and not pink/blue; one ribbon, static; boards dim and still; no deck hazard; no reach arcs; dock ring invisible; own forearm solid; both arms unfogged; nothing between the eye and the opponent.
4. 10 s idle recording: both arms breathing, opponent gaze tracking, weight shifts, five background layers moving, nothing fast.
5. Move the mouse once: view turns the same frame, ghost ring moves, whine starts, LED lights, arm follows and overshoots. Slow-mo phone check: onset ≤ 45 ms.
6. Land a heavy: freeze visible, sound on the frame, victim shivers on the contact frame, sparks stay, number pops, deck edge flashes, crowd `ohh`, one caption unit. Take a heavy: the view kicks away from the side hit and you can say which side.
7. Hit a guard: the view is shoved back 0.5°, stall growl, `BLOCKED`. Block one: zero shake.
8. Bait a SLAM: LED and whine lead by ≥ 250 ms; whiff it: `OPEN` tag; punish: `PUNISH` (match 2+).
9. Dock the Core: siren (match 2+); let it be stolen: alarm within 100 ms, red ring, red edge, `STEAL IN PROGRESS`; last 3 s: drums out, stomps, hosts silent.
10. KO: slow-mo, white flash, impact frames, de-rez, cone on the winner, slump with the falling whine, confirm then roar then ROOK at +650 ms; loser's arm silent after.
11. Fresh profile (**only after item 1 passes**): silent until the click; tab open → first hit ≤ 15 s; round 1 won by ~44 s with the ≤ 12 text events of section 2 and no others; the round-2 intro is the same arm standing up; verdict ≤ 6 s with one button; rematch in 3.4 s with the loser's sulk and the memory caption; after match 2: consent strip inert for 1.5 s, then the SYSTEMS CHECK drill once.
12. Eyes-shut test with one person: hit / miss / blocked / dealt / taken from sound and rumble, 9/10.
13. Five-person recognition of flinch, taunt, celebration, dejection clips ≥ 60 %.
14. PROVING GROUND and HARNESS episodes re-simulate BIT-EXACT against a pre-pass recording; an ARCADE episode with a non-empty `opponentMemory` re-simulates BIT-EXACT against itself.

### 12.2 The 60-second demo video

**Rendered from one episode, never from a live take.** The whole cut comes from a single recorded `episode.tl` replayed through the cockpit and orbit cameras by `scripts/demo-capture.mjs` (replay driver, `captureStream`, 1280 × 720, 60 fps, muted), with the audio rendered from the same episode by `tools/export/mixdown.mjs` (`OfflineAudioContext`) and muxed with ffmpeg. Nothing plays out loud; the capture is a clean 60 fps; every cut lands on the music grid (104 BPM, a bar is 2.31 s) because the replay clock is the music clock. **The take is chosen by POTG score** over recorded ARCADE matches (highest KO weight, a steal, a cube off the deck), not by luck. Precondition: 12.1 item 1 on the real GPU; a demo with the hitch in it is not a demo.

**Two cuts, in order:**

- **Demo v0, this week, from today's build** (WP6): shots 2, 4, 6, 9, 10 below in that order (intro orbit, first hit, dock, KO, KO replay), ≈ 25 s, from the best existing recorded episode, muted capture muxed with a sound bed rendered from a fixed recipe list (the `audio-graph` test path). It is the owner's video now, and the spec for what every package must make better.
- **Demo v1, after the pass:** the full list below with the mixdown.

Every shot is either the cockpit replay or a phase the game already renders from the orbit camera. Captions on. Wordmark bottom-left throughout.

| # | t | Shot | Source | What must be on screen | Audio |
|---|---|---|---|---|---|
| 1 | 0:00–0:02.3 | **Cold open on the KO** (shot 9's last bar): slow-mo 0.3×, white flash, impact frames, de-rez, the confirm at 0:00.3. One bar. | cockpit replay | the opponent going down, nothing else | confirm, coin tail, the roar starting |
| 2 | 0:02.3–0:04.6 | Hard cut to black. Six relay clicks as six LEDs light base→gripper in the dark; the white flash frame as the arm slams to LOWERED. One bar. | boot ritual, cockpit | only LEDs, then the flash | clicks, chirps, capacitor rise; no music |
| 3 | 0:04.6–0:06 | Lights slam on. Wide orbit for six frames' worth of bowl, lacquer deck reflecting two arms, one magenta rim, one cobalt, then cut in. | intro, orbit | opponent centre, brightest thing; crowd dim; beams behind | first stab, count-in kicks |
| 4 | 0:06–0:09.2 | **Your first flick lands, on screen by 0:06.** | cockpit replay | 50 ms freeze, sparks, `HARD 1.9 m/s`, deck flash, shiver + eye contact after | `tok` + sub, crowd `ohh`, `FIRST BLOOD` slam |
| 5 | 0:09.2–0:13.8 | The opponent (OVERSHOOT) breathing, looking at your gripper, weight shift, a beckon taunt; its whine leads a feint. | cockpit replay | gaze tracks your hand; LED breath | servo life on both arms |
| 6 | 0:13.8–0:18.5 | Its SLAM tell: elbow up, LED saturating, whine rising; you block; zero shake; stall growl; its `OPEN` window and your punish. | cockpit replay | tell ≥ 250 ms readable, `BLOCKED 2.4 N`, `OPEN`, `PUNISH` | stall growl, thock, punish crit `tink` at +40 ms |
| 7 | 0:18.5–0:25.4 | Core drops in the volt column; three-stage grab; carry; dock; siren. | cockpit replay | grab LED tint, lock click, ring fills, Core face digits | rollover tick, click, thump, clunk, siren, tick 1 Hz |
| 8 | 0:25.4–0:32.3 | Its steal at 2 s left: red ring, red edge, alarm; you pry it back with 0.8 s; overtime; `LOCKED`. | cockpit replay | STEAL IN PROGRESS, stomps, hosts silent then ROOK losing it | alarm, drums out, relief exhale, cheer |
| 9 | 0:32.3–0:41.6 | Round 2, near-KO: mix goes underwater, its brownout flicker, your heavy hook, KO (the full version of shot 1). | cockpit replay | slow-mo, white flash, impact frames, de-rez, cone on your arm, its slump | near_ko lowpass, confirm, coin tail, roar at +1.2 s, ROOK at +650 ms |
| 10 | 0:41.6–0:46.2 | KO instant replay from the orbit camera with the captions on top; a cube leaves the deck. | earned replay | the Core flying, cube off the table, VALE's line read from telemetry (e.g. "Eighty grams, one point one metres a second") | replay duck, crowd gasp |
| 11 | 0:46.2–0:50.8 | Round card and verdict: three superlatives count up, `NEW PB`, the Bout Card as plain text, `SHARE`. | verdict | `TORQUE LIMIT #0412 PILOT 2–0 OVERSHOOT` | victory tag |
| 12 | 0:50.8–0:55.4 | REMATCH: 2.4 s intro, the loser's sulk entrance and the memory caption, lights slam, `FIGHT`. | intro | `IT REMEMBERS THE LEFT HOOK` | stab |
| 13 | 0:55.4–1:00 | Cut to black on the stab. `CLICK TO FIGHT` and the URL. | title | one line: "Real physics. Real robot arms. In your browser." | silence |

The hero moment is shot 9 into shot 10, and it is also shot 1; if only 8 seconds can be shown, show 1 → 2 → 4. Every polish task is checked against "does this make shots 1, 4, 6, 9 and 10 better?"

---

## Critique resolution log (one line per issue; C = changed as proposed, A = adapted, R = rejected with reason)

**Emotion**
1. C First match / JIG: JIG deleted; match 1 = best-of-3 vs BACKLASH Rookie with round 1 as its `sparring` mode; sections 2, 4.3, 4.5, 8, WP4, WP6, precedence table.
2. C Audio before t₀: hard rule, zero audio; click clack −12 dB + murmur −18 dB on the same frame; servo bed under the first relay click; −38 dB row deleted (2, 7).
3. C Twists cut, `twist` ShowEvent removed, hours to the rematch intro and memory captions (8.4, 6 last row, 4.5, 11.9).
4. C Demo: cold open on the KO for one bar, black + relay clicks for one bar, first hit on screen by 0:06; rendered from one `episode.tl` chosen by POTG (12.2).
5. C Sponsor boards static ≤ 0.08, never animate in a live round; reaction frames on the jumbotron bug 1.2 s and the between-round card, plus the dasher panel swap from the feasibility fix (5.2).
6. A Ritual captions: went further than "PAN/LIFT at 300 ms": no captions in the ritual at all (clarity critical), `HIT IT` + LMB glyph and `GUARD · HOLD RMB` at the moment of use; GRIP at the match-2 Core drop, REACH on first out-of-range, Q/E never (2).
7. C Cockpit choice deleted; STANDARD default; STABLE in the pause menu; the once-ever 8-word line under the match-1 verdict (2 gate table, 8.2, WP6).
8. C Caption unit defined; 14–26 units per 3-minute match; ≥ 45 % no caption; no two units from the same host in a row (7, WP7).
9. C Ghost hue → amber `#FFB020` at 1.0; orange = HOT only; colour legend added under 3.3.
10. A Verdict: REMATCH only for matches 1–2, NEW OPPONENT + SHARE from match 3, goal line is the hint; consent as a strip on the match-2 verdict, never a screen, Enter never touches it, but with the data critic's freely-given rules (1.5 s inert, no Enter, decisionMs) (8.2, 9).
11. C Composition scoped to composed frames; live-round rule = 5.1 + centre-60 % rule; rest-pose test in 12.1 item 3 (5.5).
12. C Hit stop `clamp(50 + 125·m, 50, 150)`, crit +20, guarded unchanged, split kept for channels only; precedence row now cites `tuning.ts 200·m²`, cap 150 (precedence, 6, WP5).
13. C GG tap = held gripper + `TAP · LMB`; Bout Card via `COPY BOUT` only, no auto-copy, no toast (3.4, 8.3).
14. C VALE's cube line read from telemetry (mass and tip speed); rule in 7: every VALE number is telemetry (7, 12.2 shot 10).
15. C Dataset line gated on ≥ 100 pilots shared and a repeat visit; in the gate table (2, 9).
16. C Intro reveal reworded as key 0.3 / hemi 0 / one cone + pool; no light added or removed (2, WP2).

**Feasibility**
17. C Phase 0 added; robot-view.tsx, arena-canvas.tsx, range-arcs.tsx to WP1; stage-deck.tsx to WP2; dither band constant stays in WP2's robot-materials.ts; `REFLECTION_LAYER`, `LodGeometries`, phases and `OpponentMemory` in contracts; one-line-edit handoff rule (11).
18. C 10.2 step 1 rewritten around post-stack.tsx (blendFunction recompiles, composer key remount); acceptance restated as N = M except in the safe phase of a tier apply (10.1, 10.2, WP1).
19. C Flinch split: render vibration on the contact frame (WP5), commanded recoil within two decision ticks (WP4); feeling 2 reworded (1, 4.1, WP4 acceptance).
20. A Exposure: kept key 3.2 / 48°, exposure 0.70, `environmentIrradianceEstimate` 0.10, `greycard.target` 0.34, `predictDisplayValue` as the unit test (5.3, WP1).
21. A Fog near 2.7 / far 7 in render units (chose the fog-distance option over `fog: false` so one number changes) (5.2).
22. C Eye stays (−0.10, 0.16, 0.36) / target (0.52, −0.03, 0.15) in sim metres, FOV 58° vertical, "no lateral offset" dropped (5.5, WP3).
23. C Near plane 0.02, dither band 0.08 → 0.02 kept as the near-fade (3.1, 5.2, WP1/WP2).
24. C Latency target ≤ 36 ms, no regression; effort to whine onset / ghost / arm onset; desynchronized only off-macOS behind a setting (10.1, 10.2 step 8, WP3).
25. C Reflection every frame; every-other-frame moved into the cut order after N8AO off (5.4, 10.2).
26. C Opponent memory on the main thread via `ResetContext.opponentMemory`, stamped by the recorder, HARNESS empty; bit-exact test added (4.5, 11.9, WP4/WP8, 12.1 #14).
27. R Two chained matches (JIG then BACKLASH): rejected in favour of one best-of-3 vs BACKLASH with a sparring round, which needs no driver swap, no new phase semantics and keeps one relationship (issue 1); the concern (driver swap mid-match) is resolved because there is no swap.
28. A Sponsor frames: boards stay at ±90° static and dim; frames on the jumbotron bug and the dasher panel swap; zero new geometry (5.2).
29. C Tremor and heat render-only via `FeedbackFrame.vibration`; breath and idle breaks command-side; `human.command` recorded before the life layer (3, 3.2, 9, WP3 acceptance).
30. C Demo v0 this week from today's build (shots 2, 4, 6, 9, 10) inside WP6; offline match mixdown added to WP8 as `tools/export/mixdown.mjs` (12.2, WP6, WP8).
31. C Mesh bake `scripts/bake-meshes.mjs` in WP1; attract without arms until it lands; `LOADING %` CTA (2, 10.2 step 3, WP1).
32. A Hit-stop cliff: resolved by the single continuous formula of issue 12 rather than a separate heavy formula (6).
33. C Trauma taken 0.15 + 0.20·m (6, WP3).
34. C Anisotropy / iridescence as boot-time variants with cache keys, prewarmed; rim gain 4.0 so the rim blooms (5.4, 5.2, WP2).
35. C Clip-to-world as a half-space clamp from the last contact event (3.1).
36. C 5.2 "already done" rows listed; baseline re-measured before WP1; crowd 380 / 3 tiers corrected (5.2, 10.1).
37. C Six HUD elements, receipt part of the crosshair node, in both 2 and WP7.
38. C Worker note in 10.2 step 3: load-time Worker fine, no-workers rule is physics / policy / OffscreenCanvas.
39. C WP4 order: balance first, then behaviours gated by tier (taunt cooldown 16 s Rookie / 8 s Champion, no hesitation at Champion) (4.3, WP4).

**Clarity**
40. C GUARD as a held SLAM tell ≤ 3.0 s with `GUARD · HOLD RMB` + glyph; unguarded strike m ≈ 0.1, 0 damage, repeats at 1.5 s; hard rule now "deals no damage in round 1" (2, 4.2).
41. C Step caps 12 s / 3 wind-ups / 20 s, VALE line, skipped skill → goal; WP6 acceptance "60 s worst case with only mouse contact" (2, 8.2, WP6).
42. C Ritual captions removed; two things taught at the moment of use; control map on the pause plate (2).
43. A Match-1 structure: not an unscored exhibition (no new phase semantics) but round 1 of a real best-of-3 that can only end by the player's lock, tote shows 1–0; medal ladder counts from match 2 (BRONZE for the match-1 win); result slab defined (2, 8.2, 8.3, WP6).
44. A Consent placement: match-2 verdict as a non-blocking strip with REMATCH focused and Enter = REMATCH; auto-copy removed entirely rather than deferred (8.2, 9).
45. C `LOADING %` CTA until wasm + bake + prewarm; a click during a ≤ 1.5 s compile holds the ritual on the amber blink (2).
46. A Cockpit overlay deleted; chose the once-ever verdict line over the in-fight `TOO SHAKY? PRESS 2` caption to protect the text budget (2, 8.2).
47. C Passive nudge at +5 s with VALE's line; BACKLASH takes 0 damage in round 1, plate `SPARRING` with no bar, KO impossible (2).
48. C Receipts with word bands for the first 10, `BLOCKED` alone until match 3, volt PB delta once a PB exists (2, 6, 8.1).
49. C Round-1 lock-in 4.0 s, `HOLD IT · 4`, curiosity sniff at 2 s, no siren in match 1, siren named by VALE in match 2 (2, 6, gate table).
50. C `GRAB IT` then `BRING IT HOME`, ring visible from the drop, assist defined (reach τ 150 ms, Core within ±0.02 m / ±0.3 rad) (2).
51. A Round-2 intro: with one opponent there is no swap; staged as the same arm powering down from sparring and re-lighting with its bar, VALE "Sparring's over. It hits back now. Guard when it winds up." (2).
52. C Round 2 of match 1 shows only bar chunk, `−31`, damage edge; no OPEN/WHIP/PUNISH until match 2; no POKE probes in match 1; `GUARD` once more (2, 4.5, 6).
53. C Match-1 rounds 2–3 are 30 s, no Sudden Death, tiebreak first strike then damage, turtle coaching at 6 s (2, WP5, WP6).
54. A Verdict gating by `matchesPlayed` as proposed except WITH A HINT is folded into the goal line; person question on the verdict from match 3 (8.2, 9).
55. C Per-element `showKit` gate table written into 2; WP6 and WP7 build from it.
56. R Twist gating: moot, twists are cut (issue 3).
57. C SPARRING sub-Rookie tier for the LLL guard (8.4, WP4).
58. C First-minute text budget ≤ 12 events, listed; PILOT ONLINE, READY, joint captions and the first-hit host reaction deleted; caption unit resolves the 7 contradiction (2, 7).
59. C 3.1 ghost thresholds apply from match 1; the tutorial full-ghost branch is deleted (2, 3.1, WP3).
60. C Audio: all at t₀, 40 ms clack at −12 dB as confirmation, silent attract (2, 7, WP8).
61. C READY dropped; three kicks at eighth notes in the last 0.87 s of the ritual, one FIGHT slam; `count_in` 870 ms inside the ritual (2, 7, 11.9).
62. C `NEW PB` and the PB ghost suppressed until one completed match (2, 8.1, 8.2, gate table).
63. C Attract cut as four cockpit/orbit beats from one canned episode (2).
64. C Result slab by cause: SHORTED OUT / OUT-LOCKED / OUT-POINTED (8.2, WP7).
65. C VALE coaching-only in matches 1–3, numbers from match 4, in 7 and the gate table.
66. A GG tap caption: `TAP · LMB` after ROOK's line, first three matches (LMB instead of G, issue 13) (3.4).
67. C Dataset line gated (issue 15).
68. C Precondition line in the precedence block, 2 and 12.1 item 11: no study or demo until programs N = M.
69. C Own bar mounted hidden, slides in on the first damage taken (2, 6, WP7).

**Data**
70. C Two lanes split honestly: CORNER from duels (ARCADE fine, `--lane opponent`), robot dataset from drills; separate counters; CORNER v2 trains the drill demonstrator only; order rewritten (9).
71. A SYSTEMS CHECK drill in the flow at `matchesPlayed === 2` rather than 1: the first rematch is the highest-pull moment and stays instant; targets drills ≥ 1 per first session and completion ≥ 70 % added to 8.5 (9, WP6).
72. C Exporter delta written into 9 and WP8 (eight items incl. `--lane opponent`, `--max-shaped-frac`, `--decimate 2`).
73. C Quality tier per drill with a success term; WATTS per completed drill (20/10/3/0, 30 per day), duels flat 2; thresholds frozen and versioned (9).
74. C Generated callsign with the published-name line and reject list; consent sentence about trained opponents and published versions; RESET gated on DELETE ack with pilot history; challenge files carry `scope` (8.3, 9).
75. C Build archive keyed by `provenance.commit`; DIVERGED quarantined with reason; divergence rate < 2 % on the dashboard (9).
76. R Twist mutations: moot, twists are cut (issue 3); the `geom_friction` mutation is kept for drill variation (9, 11.9).
77. C Honest dataset role on the card; `object_variant` + `servo_profile` ±10 % + `geom_friction` ±20 %; 96 conditions × ~17 (9, 11.9).
78. A Freely-given consent: no default, no Enter/Space activation, 1.5 s inert, `decisionMs` / `inputMethod` recorded, < 800 ms stored as local and re-asked at match 5; implemented as the non-blocking strip rather than its own phase so REMATCH keeps its 3.4 s (9, 8.5, 11.9).
79. C `mouseSensitivity`, `invertY`, `gamepadDeadzone`, `inputMappingSha` in `SessionMeta` (9, 11.9).
80. C Device block de-fingerprinted: `gpuTier`, viewport buckets, dpr to 0.5, fps to 5; exact numbers only in the local metrics ring (9, 11.9).
81. C Person question once per match on the verdict, intent per round, `{skipped, shownMs}` and `opponentBuild` stored (9).
82. C Drill segments approach…recover; duel set kept for duels (9).
83. C `episodes_human` capped at 200 MB for local, toast at 150 MB with EXPORT (9, WP8).
84. C `--decimate 2`, 25 fps primary dataset with 50 fps as a second repo, card says which (9, WP8).
