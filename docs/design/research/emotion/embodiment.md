# First-person embodiment: making the pilot's arm feel like YOUR arm

Track: first-person embodiment, for the emotion pass on TORQUE LIMIT (branch `fps-duel`).
Companion to `../fps-feel.md` (latency budget, juice springs, camera rig). This file does not repeat that; it says what the *body* must do so the player stops seeing "a robot arm on a table" and starts feeling "me, in a machine, in a fight". Everything applies to a 6-joint SO-101 (pan, lift, elbow, wrist_flex, wrist_roll, gripper) seen from a camera bolted above its own shoulder.

## 0. TL;DR

1. Embodiment has three measurable parts: **ownership** (this body is mine), **agency** (I move it), **self-location** (I am where it is) (Kilteni, Groten, Slater 2012). We are strong on agency, weak on ownership, and neutral on self-location. Ownership is the one that produces emotion.
2. Ownership dies at **~190 ms** of visual delay between your action and the body's motion; agency survives to ~490 ms. Our servo lag is 75-250 ms. **Therefore the ghost is not a UI aid, it is your hand**: it moves at 0 ms and the physical arm is your muscle chasing it. Design the ghost like Half-Life: Alyx designs hands ("show where the hands should be"), not like a debug overlay.
3. Nothing should be still. A real servo arm holds position with a visible micro-dither; idle animation research says 15-20 breaths/min with 1-2 cm of travel is the floor of "alive". Put the breath in the **command** (sub-millimetre at the tip, so the hitbox does not change) and in the **LEDs**, never in the camera.
4. Give the arm **states with a face**: one LED colour per state, borrowed from real cobot conventions (yellow blink = booting, white steady = ready, blue = accepting command/guard, red flicker = fault/brownout). One colour, one meaning, same as SCOPE.md.
5. The gripper is the hand. Make open/close a **three-stage act with three sounds** (target glow, lock click, contact thud) like Alyx's gravity gloves; a grab that feels intended is the single strongest ownership cue we can ship.
6. **Power-on ritual** at every match intro: 1.8 s the first time, 0.6 s after. The six joints self-test in order with a servo tick each (a six-note chord), the LED goes yellow-blink to white, the camera lifts from 12 degrees down to level like eyes opening. Titanfall's embark and MechWarrior's startup callouts exist because the ritual is what makes the machine *yours*.
7. Damage is worn on the body, not on the HUD: paint chips at the strike zone, a flickering LED, a whine that drops in pitch, a smear on the lens. Metroid Prime's visor rule: the world leaves marks on *you*.
8. Haptics: the same event stream that drives audio drives rumble (Astro's Playroom). Short pulses 10-20 ms for confirmations, 60-140 ms for received hits, never over 250 ms (reads as an unrelated event).
9. The camera **never** bobs, never smooths aim, never moves on your own swing, never flinches on your own hit, never exceeds 3 degrees roll or 6 degrees FOV change, never cuts to third person mid-round, and never interpolates on a different clock than the arm.
10. Ownership is also a data-quality lever: demonstrations from a player who feels the arm is theirs are cleaner and longer. Measure it with the 5-item pESQ after a match and with leash-stretch and idle-break telemetry.

---

## 1. What embodiment is, with numbers

**The three components.** Kilteni, Groten and Slater define the Sense of Embodiment as self-location, agency and body ownership, and note it is strengthened by a first-person avatar that is co-located with the user and maps their self-generated movements ([Kilteni et al. 2012, Presence](https://direct.mit.edu/pvar/article/21/4/373/18838/The-Sense-of-Embodiment-in-Virtual-Reality)). A validated short questionnaire (pESQ) reduces this to 5 items and finds that *any* avatar representation significantly raises ownership over none, and that tracking more of the body raises self-location and agency ([Frontiers in VR 2021](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.647896/full)). Translation for us: the fact that a physical arm exists in view is already worth something; what we have not done is give the player anything to *own*.

**Timing thresholds.**
- Visuotactile: the rubber-hand illusion survives visual delays under ~300 ms and collapses at 600 ms ([Shimada et al. 2009, PLOS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0006185); [Bekrater-Bodmann et al. 2014, PLOS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0087013)).
- Visuomotor (the one that matters for a controlled arm): with a data-glove-driven virtual hand, delays of 90-590 ms were tested; **ownership vanished beyond ~190 ms**, agency persisted weakly to 290-490 ms, both gone at 590 ms ([Ismail & Shimada 2016, PLOS One](https://journals.plos.org/plosone/article?id=10.1371%2Fpone.0159619)).
- Head motion-to-photon: ~20 ms is the accepted comfort budget ([Behavior Research Methods 2022](https://link.springer.com/article/10.3758/s13428-022-01983-5)). Commercial hand tracking sits at 21-42 ms at motion onset and users perceive raw jitter as "unreal" even at low latency; smooth latency and jittery latency are perceived differently.

**Spatial thresholds.** Visual-proprioceptive offsets of up to ~10 cm still sustain the illusion; rotating the artificial hand 90 or 180 degrees away from the real one abolishes it ([Frontiers 2015, mirror illusion](https://www.frontiersin.org/articles/129847); [Scientific Reports 2018](https://www.nature.com/articles/s41598-018-20551-6)). The arm's *orientation relative to your viewpoint* must match a plausible "my arm" pose: shoulder below and behind the eye, reaching forward and away. Our camera already sits above the shoulder; keep it there, never off to the side.

**Appearance.** Realism is not the goal. Valve's Tristan Reidford on Alyx's hands: the target was hands "so natural you don't really think about them anymore"; Kerry Davis notes that in VR your brain "wants to fall back to actions you've known since you were a toddler", and that abstraction (auto-turned doors, auto-caught objects) beats simulation for feeling in control ([UploadVR](https://www.uploadvr.com/importance-believable-vr-hands-presence/)). Over time the interface matches expectations so well that "players actually believe they've done the actions themselves when really the game is assisting them" ([Transform Interactive](https://transforminteractive.com/what-half-life-alyx-taught-us/)). That sentence is the design brief for grab assist and the dock magnet.

**What this means for our architecture.** The command/ghost split (GAME_DESIGN P2) is already the correct topology: the ghost answers at 0 ms (agency and ownership), the physical arm answers at servo speed (weight and skill). The failure is presentation, not architecture. Today the ghost is drawn as a faint hologram only when blocked; the thing you own is hidden most of the time, and the thing you see most of the time lags you by up to 250 ms, which is past the ownership cliff. Section 8.7 fixes this.

## 2. What FPS viewmodels do (and which parts transfer)

The standard procedural stack, from a public breakdown of Project Killhouse ([Dev_Unallocated](https://www.devunallocated.com/projects/project-killhouse/procedural-weapon-animations-condensed)):

| Layer | What it is | Numbers / rules | Transfer to a robot arm? |
|---|---|---|---|
| Sway | Weapon lags look input | rotation rate faster than view = light; slower = heavy; yaw > pitch > roll | **No** on the arm (it is physics and a hitbox, `fps-feel.md` 4.7). Yes on the *ghost* as a 1-frame visual lead, and on the camera as filtered roll from real `qacc` |
| Bob | Tied to locomotion | stepped frequencies per gait, never linear with speed | No (base does not walk) |
| Idle breathing | Sine offset masked by velocity | `activation = 1 - clamp(v / v_threshold)` | **Yes**, into command dither and LED pulse (8.2) |
| Jitter | 2-3 sines at different frequencies | scaled by stamina/state | **Yes**, tied to heat and strain (8.2) |
| Idle breaks / action breaks | Random pose breaks; a break after an action (reload done, landed) | additive, reusable | **Yes**: jaw flex-check, wrist settle after a strike (8.2) |
| Impulses | Spring recoil, start/stop, landing | scale with velocity; damp on sustained fire | Yes, on gripper close and on clash (8.4) |
| Stances | Lowered / ready / ADS | each is a readable state with a movement-speed trade | **Yes** (8.3) |

"Leading with the barrel": trained characters point where they look, which reads as responsive and in control; reverse it only to convey weight or loss of control. Our version: **the ghost leads, the arm follows**, and a stagger is precisely the moment the arm stops following.

Stances as a state language, from Star Citizen's design notes ([RSI](https://robertsspaceindustries.com/en/comm-link/engineering/14653-Design-Notes-FPS-Stances-Breathing)): Lowered (fast, cannot fire, no reticle), Ready (raised, limited sway), ADS (slowest, most precise). Their breathing model: at full stamina a breath has 1 s pauses at top and bottom with 2 s transitions, the optimal firing window being the pause; at no stamina the pauses shrink to 0.2-0.3 s and the cycle to 1 s. That is a **heat model expressed as breathing**, and we can steal it whole for the tremor (8.2).

Idle animation craft ([AnimSchool](https://blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/); [MoCap Online](https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide)): relaxed breathing is 15-20 bpm with 1-2 cm of travel, "barely perceptible, but perceptible"; motion is driven from the base and overlaps up the chain; perfectly symmetric idles look dead; add macro variations every 3-6 loops; blend fidgets so the body is never fully still. Destiny's David Helsby: the arms, weapon and camera are "the most persistent motions in the game" seen from the player's view ([GDC Vault](https://gdcvault.com/play/1022298/The-Art-of-First-Person)). In our frame, the persistent motions are the wrist, the jaws and the LEDs. They are currently static.

## 3. VR hands: presence through assisted intent

- **Three-stage grab** (Alyx gravity gloves): select (object glows), lock (trigger; selection cannot change now), pull (a wrist flick). "Each of these stages has distinct sounds", and the lock stage exists so "the player and the game are on the same page" before the action ([Road to VR](https://roadtovr.com/these-details-make-half-life-alyx-unlike-any-other-vr-game-inside-xr-design/)). The sound design behind it: a hand loop, an object rollover, a motion beam, a closure ping and a launch, synthesised from servos, typewriters and clocks; only a few grab sounds but thousands of velocity-layered impact variants; extra body foley was added because players only see hands ([A Sound Effect](https://www.asoundeffect.com/half-life-alyx-vr-sound/)).
- **The hands you show are the hands you mean.** "Knowing when to show where the players' real hands are, and when to show where their hands should be" is the VR design problem. Ours is identical: the ghost is where your hands should be; the arm is where they are.
- **A body with mass.** Boneworks gives the player 82 kg and derives jump force and object pushing from it; the body cannot pass through the world, so the world pushes back on *you* ([Game Developer](https://www.gamedeveloper.com/design/how-classical-game-mechanics-and-physics-converge-in-vr-hit-i-boneworks-i-); [Road to VR](https://roadtovr.com/boneworks-reveal-stress-level-zero-physics-based-interactions-embodiment/)). We already have this in MuJoCo. The missing piece is that when the arm is blocked, the player's *command* passes through the opponent, which is the one thing a body must never do (8.7).

## 4. Cockpit games: the machine as an extension of the body

- **Titanfall 2** frames the pilot-Titan bond as a neural link and spends animation on the *embark*: every entry into the Titan is a bespoke transition, the campaign finale has its own ([Titanfall wiki](https://titanfall.fandom.com/wiki/BT-7274); [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Titanfall2)). Cockpit instrumentation is modelled on jet and tank cockpits ([Titan wiki](https://titanfall.fandom.com/wiki/Titan)). The lesson is not lore: the *transition into the body* is a ritual, and the body has instruments that are part of it, not a HUD over it.
- **MechWarrior** opens every drop with the startup callouts (reactor, sensors, weapons, "all systems nominal"); community mods exist purely to make startup, overheating and warnings more diegetic: smoke off the dashboard when hot, red cockpit lights instead of UI warnings ([Nexus: Immersive Overheat and Power-Up Warnings](https://www.nexusmods.com/mechwarrior5mercenaries/mods/700); [Nexus: NOMINAL](https://www.nexusmods.com/mechwarrior5mercenaries/mods/3?tab=docs)). Players *pay* for the ritual.
- **Armored Core VI**: thrust on take-off, a thud and skid on landing, and weight that changes boost speed, recovery and stability, so the build changes how the body handles ([Destructoid](https://www.destructoid.com/armored-core-6-fires-of-rubicon-impressions-demo-sgf-2023/); [Fextralife](https://fextralife.com/armored-core-6-interview-talks-complexity-assembly-and-choice/)). Our equivalent is already real: servo torque limits, leash, heat. We need the *thud and skid*: the settle after every strike must be audible and visible (8.2 action breaks).
- **Metroid Prime**: the HUD is inside the helmet; visor edges frame the screen, steam and water bead on the glass, and rapid close-range fire flickers Samus's reflection onto the inside of the visor at the muzzle-flash rate ([Wikitroid](https://metroid.fandom.com/wiki/Heads-Up_Display); [Space Ape UI breakdown](https://medium.com/the-space-ape-games-experience/ui-breakdown-metroid-prime-c22cdfbce0bc)). Rule: **the world leaves marks on you**. Our camera is a lens on the arm; sparks, dust and a smear on that lens after a heavy clash are the cheapest ownership cue in the game.

## 5. Mirror's Edge and Dying Light: the first-person body

- DICE's Owen O'Brien / Tom Farrer line: first person was chosen for *connection*, "being in an action movie, instead of playing it"; the player forms *more* connection controlling Faith first-person than watching her; she is glimpsed only in reflections and shadows ([Game Developer](https://www.gamedeveloper.com/game-platforms/dice-s-channon-i-mirror-s-edge-i-first-person-view-about-character-connection)). Animator Tobias Dahl: "animate what you perceive and not exactly how things move in real life, i.e. what your eyes do, not your head and body"; head-mounted cameras were tried and abandoned; the camera is "one of the most important tools" for telling the player what the body is doing and also the easiest way to make them sick ([AWN](https://www.awn.com/vfxworld/mirrors-edge-leap-faith); [GDC Vault](https://gdcvault.com/play/1387/Creating-First-Person-Movement-for)).
- Techland: only "two arms, and sometimes his feet" are visible, and the limbs had to be perfected to avoid the "floating camera" feeling; motion sickness was attacked through HUD size and placement, motion blur, and animation speed; and a sub-perceptual input delay was tuned so jumps triggered when the player *looked* at the far edge rather than the near one ([MCV/Develop](https://mcvuk.com/development-news/the-vaulting-dead-implementing-first-person-parkour-in-dying-light/)).

For us: the body is one arm and a gripper. Reflections are free (the art bible already specifies a mirror deck): **the player should see their own arm in the deck** and, at the KO, in a dark jumbotron. That is the Faith-in-a-window trick.

## 6. Haptics

- Team Asobi built Astro's Playroom so players could tell sand, water and ice apart "without looking at the screen"; footsteps, impacts and rumbles are converted from the same signals as audio "which simplifies development work while ensuring consistency" ([Engadget](https://www.engadget.com/astros-playroom-nicolas-doucet-team-asobi-interview-143025371.html); [Son-Video](https://blog.son-video.com/en/2024/05/dualsense-understanding-haptic-feedback-and-adaptive-triggers-on-the-ps5-controller/)).
- Pulse lengths: a key-click should be 10-20 ms (the actuator rings 20-50 ms after); over 75 ms reads as two clicks; over 250 ms reads as an unrelated event; "sharp short pulse = confirmed, long strong rumble = damage" ([EasySMX overview](https://www.easysmx.com/blogs/easysmx-controllers/controller-vibration-rumble-haptic-feedback)). Browser: `GamepadHapticActuator.playEffect("dual-rumble")` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator)); trigger rumble is an extension not widely shipped.
- No haptic device on mouse and keyboard. The substitutes are the audio transient and the *lens* (a 1-frame flash and a 2-3 px screen-space jolt), which is why 8.9 keeps audio and camera-kick on the same event frame as rumble.

## 7. Robots as characters (without lore)

- **Fewer features, more feeling.** Anki hired Pixar's Carlos Baena for Cozmo; he cut the eyes down to two shapes, "you don't need a lot of features to have characters portray emotion", and the team built a library of hundreds of animations that an emotion engine picks from ([Fast Company](https://www.fastcompany.com/3061276/meet-cozmo-the-pixar-inspired-ai-powered-robot-that-feels); [TechCrunch](https://techcrunch.com/2016/06/27/cozmo/)). Disney's BDX droids do the same with a 4-DoF head and RL-trained gaits so an animator's intent survives on real hardware ([Disney Research](https://la.disneyresearch.com/bdx-droids/); [The Robot Report](https://www.therobotreport.com/rbr50-spotlight-disney-research-develops-new-approach-robotic-characters/)). Our arm has *one* expressive feature it can afford: the gripper jaw, plus the LEDs. That is enough; Cozmo proves it.
- **Legibility.** Dragan and Srinivasa distinguish *predictable* motion (matches what you expect given a goal) from *legible* motion (reveals the goal early, by diverging early and exaggerating toward it) and show observers identify the goal sooner from legible motion ([Dragan, Lee, Srinivasa, HRI 2013](https://publications.ri.cmu.edu/storage/publications/pub_files/2013/3/legiilitypredictabilityIEEE.pdf); [Generating Legible Motion, RSS 2013](https://cs.brown.edu/courses/csci2951-k/papers/dragan13a.pdf)). Used two ways: the *opponent's* command-driven LEDs (already in `fps-feel.md` 4.8) are its legibility; and the *ghost* is your own legibility to yourself. A ghost that diverges cleanly from the arm is legible intent; a ghost that sits on top of the arm is clutter.
- **Status-light conventions from real cobots.** Franka Emika: blinking yellow while initialising, steady yellow initialised, white = ready/movement mode, blue = accepting commanded motion, white flash when control switches on ([Franka Getting Started guide](https://download.franka.de/documents/110030_Getting%20Started%20Guide_1.1_EN.pdf); [ut-ims-robotics wiki](https://github.com/ut-ims-robotics/tutorials/wiki/Franka-Emika-Panda-beginner-guide)). Borrow the grammar, not the colours (ours are fixed by SCOPE 1.3).
- **Animation principles on hardware** ([Nutty-based Robot Animation](https://arxiv.org/pdf/1904.02898); [Disney's 12 principles](https://www.creativebloq.com/advice/understand-the-12-principles-of-animation)): anticipation, follow-through, secondary action and slow-in/slow-out. `fps-feel.md` bans *authored* anticipation on the physical arm because the physics already has a windup; that is correct. Follow-through and secondary action are not banned, and the physical arm already produces them (overshoot, settle, jaw wobble) if the render does not hide them. Make sure the render never smooths them away.

---

## 8. Design: the pilot's arm as a character you inhabit

Constraints carried over: the physical arm is never animated, never swayed, and is the hitbox (`fps-feel.md` 4.7). Nothing in the aim path is filtered (6.5). The AI never sees the ghost. Everything below is either command-side (sub-millimetre, affects nothing the opponent could exploit), LED/material-side, audio-side, or camera-side inside the existing spring/trauma model.

### 8.1 The ownership contract (what the three components map to)

| Component | Carrier | Budget | Current state |
|---|---|---|---|
| Agency | Ghost + reticle | 0 frames (same rendered frame as the mouse) | Met (reticle-vs-ghost pixel error is 0 in `?debug=feel`) |
| Ownership | The thing that answers you within 190 ms and *looks like a hand* | ghost always visible as a hand-shape, arm first motion <= 45 ms | **Not met**: ghost hidden below leash stretch 0.35; the visible body lags past the cliff |
| Self-location | Camera anchored to the shoulder, arm entering the frame from below-right like a real forearm, own reflection in the deck | eye 0.30 up, 0.22 back (render units), no lateral offset | Half met: anchor is right, no reflection, no lens |

The reframe that fixes ownership: **the ghost is the hand you are moving; the painted arm is the muscle that carries it.** Present them as one body at two speeds, not a body and an overlay.

### 8.2 Breathing idle and micro-adjustments (life without changing the hitbox)

All idle motion goes into the *command* (`pilot.ghost.joints` before the leash) at amplitudes the PD servo turns into sub-millimetre tip motion, so the physical hitbox is unchanged for any practical purpose. At 0.25 m reach, 0.15 degrees of wrist_flex is 0.65 mm at the tip.

| Signal | Joint(s) | Amplitude | Frequency | Gate |
|---|---|---|---|---|
| Breath | wrist_flex, gripper | wrist ±0.15 deg, jaw ±1.5 deg | 0.28 Hz (17 bpm), jaw lags wrist by 0.35 s (overlap up the chain) | `1 - clamp01(|cmd velocity| / 0.6 rad/s)` so it vanishes the instant you move |
| Hold tremor | wrist_roll, wrist_flex | 0.04 deg base, up to 0.25 deg at heat 100% | sum of 3 sines: 7, 11, 13 Hz | always while any servo error > 0.02 rad (extends `fps-feel.md` "servo hum") |
| Macro variation | all of the above | ±20% amplitude, ±8% frequency | re-rolled every 3-6 breath cycles | none |
| LED breath | all link LEDs | 0.75 -> 1.0 of state colour | same 0.28 Hz, phase-locked to the jaw | dims to steady in READY within strike range (stillness = tension) |

**Idle breaks** (`fps-feel.md` says stillness makes the standoff tense: keep that inside strike range, break it outside):
- Fire only when no input for > 2.5 s **and** the opponent tip is > 1.3 x strike range away **and** no Core is in play within 0.4 m.
- Interval 6-14 s, uniform. Pick one: *jaw check* (open +20 deg over 180 ms, hold 120 ms, close 250 ms with a 6% overshoot and a click), *roll settle* (wrist_roll ±8 deg over 600 ms with a servo purr), *knuckle* (wrist_flex -5 deg, +5 deg, 0 over 400 ms). Never move pan or lift: the body's *aim* must not move by itself, only its hand.
- **Action breaks** (the AC6 "thud and skid"): 250 ms after any strike or clash resolves, a *settle* on wrist_flex: +2.5 deg then 0 with a critically damped return over 220 ms, plus a 90 ms servo whine tail dropping a minor third. Physics already gives most of this; the command-side settle guarantees the reader sees a follow-through even when the servo nailed the target.

Heat becomes breathing (Star Citizen model): at heat < 40% the breath has 1 s pauses at the ends; at heat > 80% the pauses go to 0.2 s and the cycle shortens to 1.1 s, the tremor goes to max and the jaw breath doubles. The player *feels* overheated before the HUD says it.

### 8.3 The ready stance and the state language

One colour per state on the link LEDs (the emissive accents the art bible already asks for), on the gripper LED, and echoed by the strain strip in the lower frame. The camera does not change per state.

| State | Pose (command-side, applied on transition, 200 ms slam-in with 240 ms overshoot per SCOPE motion tokens) | LED | Sound |
|---|---|---|---|
| OFF (attract, loading) | folded: lift -60 deg, elbow +100 deg, jaw closed | dark, one 0.5 Hz amber blip on the base | none |
| BOOT (intro ritual, 8.5) | self-test sweep | amber blink 3 Hz -> steady amber | six servo ticks |
| LOWERED (round intro, post-round) | the SO-101 rest pose, jaw half open | team colour at 0.4, breathing | idle purr |
| READY (neutral, no input) | guard-neutral: lift +15 deg, elbow -20 deg, jaw 30% open | team colour steady 1.0, breathing outside range, steady inside | breath only |
| COMMIT (jab/charge/heavy) | the strike | team colour -> white flare 60 ms at release, then 300 ms cooldown ramp | existing strike synthesis |
| GUARD (RMB) | guard pose | cyan (`#3DE0FF`, block/deflect token) | filtered hold hum |
| GRIP (Space held with contact) | jaw closed on target | volt yellow on the gripper LED only, pulsing at clamp force | 8.4 |
| HOT (heat > 80%) | READY with 8.2 tremor | team colour cross-faded to signal orange, 2 Hz pulse | whine +1 semitone per 10% |
| STAGGER / BURST | the brownout slump (GAME_DESIGN 8.3) | red flicker 12 Hz for 400 ms, then 0.2 dim | brownout sag + relay clack |
| SHORTED OUT (KO) | slump | all LEDs to 0 over 150 ms, one last amber blip at +900 ms | existing de-rez |

Why this works: it is the Lowered/Ready/ADS grammar from shooters and the yellow/white/blue grammar from real cobots, both of which players read without a tutorial.

### 8.4 The gripper: a three-stage act

The jaw is the only expressive feature on the body, so it gets the Alyx treatment.

1. **Target** (grab assist finds a grabbable within 0.06 m of the ghost tip): the gripper LED tints toward the target's colour (volt for the Core, opponent team colour for a limb), the jaws open a further +8 deg over 80 ms, a soft "rollover" tick (2 kHz, 12 ms).
2. **Lock** (Space pressed): a 40 ms pre-close twitch of the moving jaw, a mechanical click (8 ms transient), the leash line snaps to the target for 120 ms. From here the target cannot change until release, exactly like Alyx's lock stage: it is what makes a grab feel *intended*.
3. **Contact** (contact reported by physics): a sub thump + mid body, jaw settles with one 8% overshoot over 120 ms, gripper LED goes volt steady, rumble 60 ms strong 0.5. While holding: LED pulse rate 1-4 Hz with clamp force, a faint strain creak above 70% of max clamp.
4. **Release**: jaws spring open with a single overshoot, a pneumatic-style "chuff" (filtered noise, 90 ms), LED back to state colour.

A failed grab (lock but no contact within 250 ms) must read as *your* miss: a two-note descending tick and the jaws close on nothing with a hollow clack. Never silently fail.

### 8.5 The power-on ritual

Runs at match intro, after the host intro and before ROUND 1. First time in a session 1.8 s; subsequent rounds and rematches 0.6 s (same beats, compressed). Skippable never: it is the embark.

| t (ms) | Beat |
|---|---|
| 0 | Camera at -12 deg pitch (looking at the deck), lens vignette 0.6, arm OFF pose, LEDs dark |
| 0-300 | Base LED amber blink at 3 Hz; a capacitor rise (sine sweep 80 -> 220 Hz, 250 ms) |
| 300-1100 | Self-test: pan, lift, elbow, wrist_flex, wrist_roll, gripper in order, each ±6 deg (jaw: open 25 deg, close) over 110 ms with a 25 ms gap, one servo tick each at rising pitch (a six-note ratchet chord). Each joint's LED lights as it passes its test |
| 1100-1400 | Arm slams from OFF to LOWERED (200 ms + overshoot), all LEDs snap to team colour with a white flash frame, camera pitch eases from -12 to 0 over 400 ms (eyes opening), vignette to 0 |
| 1400-1800 | `PILOT ONLINE` stamp (Anton, slant, 240 ms slam-in), DR. VALE caption with the real numbers ("six axes nominal, 2.9 N·m"), reticle fades in |

The first-minute confusion problem is partly solved here for free: each joint's self-test is captioned with its control the first time (PAN: mouse X; LIFT: mouse Y; REACH: W/S; ROLL: Q/E; GRIP: Space). The ritual is the control map.

### 8.6 Damage states (worn on the body, not the HUD)

Cosmetic only, cumulative across rounds until rematch, driven by the existing event stream and `robot-decals.ts`:

- **Paint chips** at the strike contact point per received hit (decal, 4-14 mm, count capped at 24 per link, oldest recycled). Heavy hits add a scorch ring.
- **LED faults**: below 40% round health one random link LED flickers (random 30-90 ms dropouts, 0.5 Hz). Below 20%, two, and the strain strip stutters.
- **Whine detune**: servo whine pitch drops 1 semitone per 20% health lost; a stagger adds a 200 ms wow.
- **Lens**: after any heavy clash or received heavy hit, 1-3 dust specks and a smear streak on the camera plane (a screen-space sprite at 12% opacity that clears over 6 s); a received crit leaves a hairline crack for the rest of the round (Metroid rule). This is the strongest single "you are inside this" cue and costs one quad.
- **Cable**: below 20%, a loose cable decal on the upper_arm swings (a 2-bone pendulum driven by the real `qacc`) with a tick when it slaps the housing.
- Nothing here changes physics or servo gains (the harness must stay honest); it is all render and audio.

### 8.7 The ghost as intent, not clutter

Current behaviour: ghost (wrist, gripper, moving_jaw) fades in between leash stretch 0.35 and 0.6, leash line above 0.6. The stated reason for hiding it (a second hand sitting on the real one read as clipping) is real. The fix is to make the ghost *never coincide* and *never pass through*:

1. **Always draw the hand, never the copy.** Below stretch 0.15, draw only a 3 mm ring at the ghost tip (the reticle's world-space twin) plus the gripper jaw *outline* when it differs from the physical jaw by > 4 deg. Above 0.15, fade the wrist/gripper/jaw hologram in over 0.15-0.35 (earlier than today's 0.35-0.6). The hand you own is visible whenever it is meaningfully somewhere else.
2. **Clip to the world.** When the physical arm is blocked (contact with the opponent or the deck) and the command is inside them, project the ghost tip to the contact surface plus 8 mm along the contact normal, and draw the leash from there. The command still goes through unchanged (physics needs it); only the *picture* of your intent stops at the body it is pushing on, and it flushes white where it presses. Boneworks rule: your body does not pass through things. Cost: one contact normal per frame, already in the contact list.
3. **Stretch has a colour and a sound.** Ghost edge hue: cobalt at 0 -> white at 0.6 -> signal orange at 1.0 (over-commit). At the 0.6 crossing, a single 10 ms tick; at 1.0 a low buzz. The player learns "orange = I have out-run my own servos" without a tutorial, and that is the skill of the game.
4. **The leash is a rubber band, not a dashed line.** Render as a tapered ribbon whose width is proportional to stretch, with 3 evenly spaced beads that travel from the arm toward the ghost at the servo's closing speed. It shows *effort*, which is what the arm is doing.
5. **Windup pulls the hand back, the aim stays.** Already designed (GAME_DESIGN 3.1.2); keep the reticle un-wound and show the ghost retracting: this is the legible early divergence from Dragan, done honestly.
6. Ghost opacity setting stays; `0` collapses to the tip ring only, never to nothing (agency must never go dark).

### 8.8 What the camera must never do

The camera is the head, and heads are where sickness and disownership start (DICE, Techland). Additions to `fps-feel.md` 6.5:

1. Never bob, never breathe, never idle. All life goes into the arm and LEDs, not the eye.
2. Never smooth or filter aim; never add acceleration or "weight" to the look.
3. Never move on your **own** swing; never flinch on your own landed hit. Kick, trauma and FOV punch are for what you *receive* and for clashes only.
4. Never exceed ±3 deg roll, ±1.5 deg pitch sway, 6 deg FOV punch; never stack trauma above 0.35 without a KO.
5. Never leave the shoulder anchor: no lateral offset, no cinematic pull-back during the round, no auto-look at the Core or the opponent.
6. Never interpolate on a different clock than the arm (use the same alpha as the bodies; a 5 ms stair-step reads as the arm not being attached to you).
7. Never let the own upper_arm clip the near plane; never let the arm leave the bottom of the frame entirely at rest (a first-person body must have a limb in frame: Techland's "two arms and sometimes feet").
8. Never add motion blur to the view; never drop below 60 fps for an effect.
9. Never cut to third person or broadcast during a live round. Broadcast angles are for intros, KO replays and post-match only; the round is lived from inside.
10. On stagger: a 0.6 deg pitch dip and a 120 ms brightness sag, not a lurch. On KO: the one allowed slow motion and slump.

### 8.9 Haptics and their audio/visual twins (one event, three channels, same frame)

| Event | Rumble (dual-rumble, ms / strong / weak) | Audio | Lens / camera |
|---|---|---|---|
| Ghost stretch crosses 0.6 | 12 / 0.15 / 0.3 | 10 ms tick | none |
| Gripper lock | 16 / 0.3 / 0.5 | click | none |
| Gripper contact | 60 / 0.5 / 0.4 | thump | none |
| Own strike lands | none (no flinch) | existing hit synthesis | none |
| Clash / deflect | 80 / 0.6 / 0.6 | clang | kick 1.2 deg, flash 1 frame |
| Received hit (m = magnitude) | 60 + 80m / 0.5 + 0.5m / 0.3 + 0.4m (already in `haptics.ts`) | received hit | trauma += m, lens speck if heavy |
| Stagger | 140 / 1.0 / 0.2 then 200 ms silence | brownout | pitch dip + sag |
| Boot self-test | 6 x 14 / 0.2 / 0.4 spaced 135 ms | six ticks | none |

Rules: fire on the event frame, before hit stop; never stack two pulses inside 75 ms (merge them: max magnitude, sum duration capped at 140 ms); never exceed 250 ms except the KO.

### 8.10 Why this also gets better data

Agency and ownership are the difference between a player *operating* an arm and *being* one. The harness records the command stream; a player who feels the arm as theirs commits, holds, and recovers instead of flailing, which is exactly the demonstration quality the owner wants. Instrument it:

- After a match, optionally show the 5-item pESQ (7-point scale; items in section 1) as three quick taps behind the bragging stats. Store with the episode.
- Telemetry per match: leash-stretch histogram (ownership proxy: a bimodal 0/1.0 histogram means the player is fighting the servo, not using it), idle-break count (how often the game had to fill silence), grab lock-to-contact success rate, rematch rate.
- A/B the ritual length and the ghost threshold against rematch rate. These are the two cheapest knobs with the largest expected effect.

## 9. Parameter sheet (defaults to ship, all in one settings object)

```ts
export const EMBODIMENT = {
  breath: { hz: 0.28, wristDeg: 0.15, jawDeg: 1.5, jawLagS: 0.35, gateRadS: 0.6, macroEvery: [3, 6] },
  tremor: { baseDeg: 0.04, hotDeg: 0.25, hz: [7, 11, 13] },
  idleBreak: { afterIdleS: 2.5, intervalS: [6, 14], minRangeMul: 1.3 },
  settle: { delayMs: 250, wristDeg: 2.5, returnMs: 220 },
  ghost: { ringBelow: 0.15, fadeIn: [0.15, 0.35], tickAt: 0.6, hue: ["#2A6BFF", "#FFFFFF", "#FF4A1C"], clipOffsetM: 0.008 },
  boot: { firstMs: 1800, laterMs: 600, jointDeg: 6, jawDeg: 25, stepMs: 110, gapMs: 25, camPitchFrom: -12 },
  gripper: { targetOpenDeg: 8, lockTwitchMs: 40, settleOvershoot: 0.08, settleMs: 120, failWindowMs: 250 },
  damage: { chipMmRange: [4, 14], chipCap: 24, ledFlickerBelow: 0.4, lensSmearS: 6 },
  camera: { rollMaxDeg: 3, pitchSwayMaxDeg: 1.5, fovPunchMaxDeg: 6, traumaCap: 0.35, staggerDipDeg: 0.6 },
  rumble: { mergeWindowMs: 75, maxMs: 250 },
} as const;
```

## 10. Where it lands in the repo

- Command-side idle, tremor, settle and boot pose: `src/game/input/pilot-controller.ts` (before the leash step; flagged so the harness can zero it for policy runs, since a recorded human demo *should* include the breath but a policy verify should not).
- Ghost ring/fade/clip/hue/beads: `src/game/render/ghost-arm.tsx` (thresholds `GHOST_SHOW_STRETCH` -> `[0.15, 0.35]`; add tip ring and contact-normal clipping).
- LED states and breath: `src/game/render/robot-materials.ts` (`uCharge`/rim uniforms already exist; add a per-link `uLed` colour + intensity uniform driven from a small state machine in `src/game/core/`).
- Lens quad, cable pendulum, chips: `src/game/render/robot-decals.ts`, `src/game/render/post-stack.tsx`.
- Boot ritual sequencing and captions: the match-intro flow plus `hud-runtime.ts`.
- Haptics table: `src/game/input/haptics.ts` (add merge window and the new events).
- Camera rules: enforce as asserts in `src/game/render/camera-director.tsx` (`?debug=feel` shows max roll/FOV/trauma reached per round).

## Sources

- Kilteni, Groten, Slater, "The Sense of Embodiment in Virtual Reality", Presence 2012: https://direct.mit.edu/pvar/article/21/4/373/18838/The-Sense-of-Embodiment-in-Virtual-Reality
- pESQ, Frontiers in Virtual Reality 2021: https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.647896/full
- Ismail & Shimada, "Robot Hand Illusion under Delayed Visual Feedback", PLOS One 2016: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0159619
- Shimada et al., "Rubber Hand Illusion under Delayed Visual Feedback", PLOS One 2009: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0006185
- Bekrater-Bodmann et al., synchrony and temporal order, PLOS One 2014: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0087013
- Mirror illusion / proprioceptive drift, Frontiers 2015: https://www.frontiersin.org/articles/129847
- Judging the artificial hand position, Scientific Reports 2018: https://www.nature.com/articles/s41598-018-20551-6
- Motion-to-photon measurement, Behavior Research Methods 2022: https://link.springer.com/article/10.3758/s13428-022-01983-5
- UploadVR, VR hands and presence: https://www.uploadvr.com/importance-believable-vr-hands-presence/
- Transform Interactive, what Alyx taught us: https://transforminteractive.com/what-half-life-alyx-taught-us/
- Road to VR, Alyx design details (three-stage grab): https://roadtovr.com/these-details-make-half-life-alyx-unlike-any-other-vr-game-inside-xr-design/
- A Sound Effect, Alyx sound design: https://www.asoundeffect.com/half-life-alyx-vr-sound/
- Game Developer, Boneworks physics: https://www.gamedeveloper.com/design/how-classical-game-mechanics-and-physics-converge-in-vr-hit-i-boneworks-i-
- Road to VR, Boneworks reveal: https://roadtovr.com/boneworks-reveal-stress-level-zero-physics-based-interactions-embodiment/
- Dev_Unallocated, procedural weapon animation: https://www.devunallocated.com/projects/project-killhouse/procedural-weapon-animations-condensed
- RSI, FPS stances and breathing: https://robertsspaceindustries.com/en/comm-link/engineering/14653-Design-Notes-FPS-Stances-Breathing
- GDC Vault, The Art of First Person Animation for Destiny: https://gdcvault.com/play/1022298/The-Art-of-First-Person
- AnimSchool, idle animations: https://blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/
- MoCap Online, idle animation guide: https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide
- Game Developer, DICE on Mirror's Edge first person: https://www.gamedeveloper.com/game-platforms/dice-s-channon-i-mirror-s-edge-i-first-person-view-about-character-connection
- AWN, Mirror's Edge animation: https://www.awn.com/vfxworld/mirrors-edge-leap-faith
- GDC Vault, Creating First Person Movement for Mirror's Edge: https://gdcvault.com/play/1387/Creating-First-Person-Movement-for
- MCV/Develop, Dying Light first-person parkour: https://mcvuk.com/development-news/the-vaulting-dead-implementing-first-person-parkour-in-dying-light/
- Titanfall wiki, BT-7274 and Titan: https://titanfall.fandom.com/wiki/BT-7274 , https://titanfall.fandom.com/wiki/Titan
- Nexus Mods, MechWarrior 5 immersive warnings / startup: https://www.nexusmods.com/mechwarrior5mercenaries/mods/700 , https://www.nexusmods.com/mechwarrior5mercenaries/mods/3?tab=docs
- Destructoid, Armored Core VI preview: https://www.destructoid.com/armored-core-6-fires-of-rubicon-impressions-demo-sgf-2023/
- Fextralife, Armored Core VI interview: https://fextralife.com/armored-core-6-interview-talks-complexity-assembly-and-choice/
- Wikitroid, Metroid Prime HUD: https://metroid.fandom.com/wiki/Heads-Up_Display
- Space Ape, Metroid Prime UI breakdown: https://medium.com/the-space-ape-games-experience/ui-breakdown-metroid-prime-c22cdfbce0bc
- Engadget, Team Asobi on DualSense: https://www.engadget.com/astros-playroom-nicolas-doucet-team-asobi-interview-143025371.html
- Son-Video, DualSense haptics: https://blog.son-video.com/en/2024/05/dualsense-understanding-haptic-feedback-and-adaptive-triggers-on-the-ps5-controller/
- EasySMX, rumble and pulse timing: https://www.easysmx.com/blogs/easysmx-controllers/controller-vibration-rumble-haptic-feedback
- MDN, GamepadHapticActuator: https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator
- Fast Company, Cozmo: https://www.fastcompany.com/3061276/meet-cozmo-the-pixar-inspired-ai-powered-robot-that-feels
- TechCrunch, Cozmo: https://techcrunch.com/2016/06/27/cozmo/
- Disney Research, BDX droids: https://la.disneyresearch.com/bdx-droids/
- The Robot Report, Disney robotic characters: https://www.therobotreport.com/rbr50-spotlight-disney-research-develops-new-approach-robotic-characters/
- Dragan, Lee, Srinivasa, Legibility and Predictability of Robot Motion, HRI 2013: https://publications.ri.cmu.edu/storage/publications/pub_files/2013/3/legiilitypredictabilityIEEE.pdf
- Dragan & Srinivasa, Generating Legible Motion, RSS 2013: https://cs.brown.edu/courses/csci2951-k/papers/dragan13a.pdf
- Franka Emika Getting Started (status lights): https://download.franka.de/documents/110030_Getting%20Started%20Guide_1.1_EN.pdf
- ut-ims-robotics, Franka Panda beginner guide: https://github.com/ut-ims-robotics/tutorials/wiki/Franka-Emika-Panda-beginner-guide
- Nutty-based Robot Animation, arXiv 1904.02898: https://arxiv.org/pdf/1904.02898
- Creative Bloq, 12 principles of animation: https://www.creativebloq.com/advice/understand-the-12-principles-of-animation
