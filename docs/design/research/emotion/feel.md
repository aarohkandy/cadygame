# Game feel fundamentals, and a FEEL SPEC for a torque-limited robot arm in first person

Track: emotion / feel. Written 2026-09-24 against branch `fps-duel`.
Siblings: `../fps-feel.md` (frame loop, camera rig, post stack, latency budget), `../combat-design.md` (measured physics, control model), `../finals-feel.md` (event catalog, broadcast), `GAME_DESIGN.md` §8 (event table, hit stop formula).
This document does not replace those. It explains **why** the build feels dead, names the fundamentals it is failing, and turns them into a spec with numbers. Where it changes a number that already exists in `GAME_DESIGN.md` §8, §7 of this doc says so explicitly.

---

## 0. TL;DR

1. **The owner is describing a game with no "feel" in Swink's sense.** Game feel is "real-time control of virtual objects in a simulated space, with interactions emphasized by polish." We have the simulated space. We have almost no polish, and the real-time control is diluted by ~70 ms of render smoothing and a beat between `setInterval` and rAF (`fps-feel.md` §3). All three must be present; Swink's own demo shows any two without the third reads as nothing.
2. **Three things decide whether a hit feels like anything**: hit stop, sound coherence, camera control. A 2022 study that ranked 40 Steam action games by player-reported "impact feel" and audited them against a 19-feature juice framework found those three separate the top games from the bottom, and "the lack of even one of the three… will weaken the performance of impact feel and make it undesirable." Our current hit stop formula (`133·m²`) gives **21 ms at m = 0.4**: about one frame. That is below perception. Light hits must freeze for **50 ms (3 frames)** minimum.
3. **Servo lag is not the problem; invisible servo lag is.** A 1 rad pan takes 160 ms to reach halfway and 245 ms to reach 90 % (`fps-feel.md` §2). That is a Mordhau-length windup we get for free. It becomes mush only when nothing tells the player the command was received. The fix is a *zero-latency command channel* (camera, ghost, whine, LED, haptic tick, all within one frame) layered on an *honest mass channel* (the arm). The player must feel the arm *straining toward* the ghost, never *ignoring* the mouse.
4. **First five seconds:** camera turns the same frame; the ghost moves the same frame; the servo whine starts within 5 ms; the arm visibly begins to move within 45 ms; the arm overshoots and settles like something with mass; the opponent's arm flinches or tracks you within 200 ms; and something is already inside reach to hit. If any of these is missing the player concludes "this is a physics demo."
5. **Every hit, on every channel, in a strict order of importance:** (1) hit stop, (2) sound on the event frame, (3) the victim's arm physically thrown (already physics) plus a render-only vibration, (4) camera kick *away from the contact point*, (5) flash and sparks, (6) HUD ticks and numbers, (7) rumble. Light and heavy differ in every channel by magnitude *and* by kind (a heavy hit adds a channel; it does not just make the light one bigger).
6. **A whiff must cost something and look like something.** The physics already overshoots 0.09–0.18 rad after a full-speed stop with 465–565 ms to settle; make that overshoot visible and audible (whoosh pitched by tip speed, whine falling, a 0.6° camera roll into the swing), tag the opponent's whiff so the human sees the punish window, and charge the whiffer heat and 250 ms of reduced torque (already specced) so the "recovery" phase exists.
7. **A block must feel like a wall, not a pillow.** On guard contact the attacker's servo stalls at its torque limit with zero velocity: that is a distinct physical state, and it needs its own sound (a strained, low stall growl, not the impact "thock"), a taut leash line, a 33–50 ms freeze on the onset only, and zero camera shake for the defender. The attacker's camera gets a 0.5° push *back*, as if the mouse hit a wall.
8. **Streamline like Celeste: fudge every window in the player's favor.** Buffer discrete inputs 100 ms (150 ms across a freeze), accept a guard pressed up to 80 ms *after* the contact onset as a late guard, keep the strike tag if the button lands within 100 ms before contact, and give the reticle 3° of magnetism toward the opponent's gripper. Thorson's rule: the player should feel that the game "wants you to succeed."
9. **Anticipation, attack, recovery for both arms.** The opponent's heavy needs ≥ 250 ms of readable tell (GDKeys' rule: player reaction time ≈ 250 ms, plus the time to raise a guard, plus a difficulty buffer). Physics gives ~200 ms of visible windup on a charged retract; the servo LED and whine lead visible motion by ~30 ms; that is enough only if the tell is bright and loud. Sakurai's and Colantonio's teams both report having to *redo* work because tells were too subtle. Ours currently are invisible.
10. **The toy test is the acceptance test.** Ship a "feel bench" scene: your arm, a bell, a stack of cubes, a strike pad with a force readout, no opponent, no HUD, muted host. A new player must want to keep hitting things for 60 s with no goal. Swink calls this the "Magic Garden"; if the arm is not fun there, no amount of arena will save it.

---

## 1. Fundamentals (research)

### 1.1 Swink: what game feel is made of

Swink's definition, from chapter 1 of *Game Feel*: "real-time control of virtual objects in a simulated space, with interactions emphasized by polish." The three parts:

- **Real-time control.** Continuous, immediate response to continuous input; "like driving a car" rather than "like a conversation." The widely quoted threshold is a correction cycle (see feedback → decide → act → game responds) under **~100 ms**, the point below which the computer's half of the loop is not perceived as lag ([Wikipedia summary of Swink](https://en.wikipedia.org/wiki/Game_feel), [Liz England's review](https://lizengland.com/blog/review-game-feel-by-steve-swink/)).
- **Simulated space.** Physical interaction with a world that pushes back: collisions, mass, momentum. Swink: without it, "there is no feel."
- **Polish.** Effects that "artificially enhance interaction without changing the underlying simulation": sound, particles, camera shake, squash and stretch. Swink's key line for us: "for players, simulation and polish are indistinguishable. Feel can be just as strongly influenced by polish effects as by [simulation]."

His chapter-1 demo lets you toggle each of the three off. His verdicts: raw simulation without polish still has feel ("raw game feel"), but it is "less appealing"; control plus polish without simulation "is difficult to create a sensation of physicality"; polish alone (Civilization, Bejeweled) gives objects "a weight, presence" but no control. ([Chapter 1 PDF](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf))

Swink also names **five experiences** of game feel, which are a useful checklist for the owner's word "emotion":

1. the aesthetic sensation of control ("a toy… the delightful sense of puppetry")
2. the pleasure of learning, practicing and mastering a skill ("it was OK to suck because it was fun just to noodle around and bump into things")
3. extension of the senses (he spends pages on **proprioception**: a good avatar gives you "a sense of the position, size and weight" of something you cannot actually feel)
4. extension of identity
5. interaction with a unique physical reality

Point 3 is our whole game: a real servo arm has proprioception (current draw, position error, temperature) that a human at a mouse does not. **Every sensory channel we add is a prosthetic proprioceptive sense.** The servo whine *is* muscle strain. The LED *is* effort. The rumble *is* the load.

Swink's practical method, from his Game Developer articles: list the sensory cues "in order of importance to the physical impression," build a test environment first ("the Magic Garden of game feel"), and make basic interaction pleasurable before adding goals ([Principles of Virtual Sensation](https://www.gamedeveloper.com/design/principles-of-virtual-sensation), [The Secret Ingredient](https://www.gamedeveloper.com/game-platforms/feature-game-feel---the-secret-ingredient-)). He also warns that spacing matters as much as motion: "tight spacing creates clumsy, oppressive sensation; wide spacing becomes trivialized and boring." For us that is the 0.64 m base separation versus a 0.44 m reach (`combat-design.md` §1.3): the fight only happens "between the hands," which is correct spacing for a duel but means **the opponent's hand must start inside reach** or the first seconds are empty air.

### 1.2 Pichlmair and Johansen: tuning, juicing, streamlining

Their survey of 200+ sources splits game feel design into three intents ([arXiv 2011.09201](https://arxiv.org/abs/2011.09201)):

| Intent | What it does | Ours today |
|---|---|---|
| **Tuning** (physicality) | cohesion and predictability of the object's motion | Good. Honest MuJoCo servos, measured step responses. |
| **Juicing** (amplification) | "communicating the importance of game events," empowerment and clarity | Specced in `GAME_DESIGN.md` §8, mostly unbuilt. |
| **Streamlining** (support) | "act on the intention of the player, supporting the execution of actions" | Grab assist exists; almost nothing else. |

The build is heavy on tuning and empty on the other two. That is exactly what "unlit grey prototype, hits do not feel like anything, confusing first minute" describes.

### 1.3 The impact-feel study: three features that decide it

Zhang et al. ranked 40 top-selling Steam action games by NLP over player comments about impact feel, then audited the top 8 and bottom 8 against 19 juice features ([arXiv 2208.06155](https://arxiv.org/abs/2208.06155)). Findings, quoted:

- **Hit stop.** "Almost all games apply hit stop… except Sacred Citadel and Draw Slasher, which rank 39th and 40th… The boundary between missing and hitting, quick attack and heavy attack is indistinct. Without hit stop, the impact feedback system cannot communicate enough information for players to feel the impact."
- **Sound coherence.** "Time delay between visual and audio feedback can lead to a sense of unnaturalness, which essentially ruins the immersive experience."
- **Camera control.** In the low-ranked beat 'em ups "the camera just simply moves following the character. The loss of dedicated camera control dulls the combat experience."

Their 19 features are a checklist worth keeping: attack effect (weapon trail), after-hit effect, camera effect, hit stop, slow motion, on-hit effect, camera control, colour flashing, background "breathing," animation switching (hit reaction), weapon sound, character sound, sound coherence, slight-vs-heavy differentiation, UI feedback, plus coherence of gameplay and feedback systems.

### 1.4 Hit stop: the numbers

| Source | Value | Note |
|---|---|---|
| Final Fight (1989) | 6 frames (100 ms) universal | [Sicienski](https://shane-sicienski.com/blog/blog-post-title-one-55pmn) |
| The Punisher (1993) | attacker 6–10 f, **victim 8–11 f** | asymmetric: the victim freezes longer, so the attacker "regains control" first and combos flow ([same](https://shane-sicienski.com/blog/blog-post-title-one-55pmn)) |
| Street Fighter V | 8 / 12 / 15 f for light / medium / heavy (133 / 200 / 250 ms) | [de Heras](https://www.jasondeheras.com/gamedesign/2021/4/23/how-do-3rd-person-melee-combat-games-communicate-game-and-hit-feel) |
| Smash Melee | ⌊d/3 + 3⌋ frames; a 15 % move ≈ 8 f (133 ms) | [SmashWiki](https://www.ssbwiki.com/Hitlag) |
| Smash Ultimate | ⌊d·0.65 + 6⌋… ; 15 % ≈ 15 f (250 ms) | same; multipliers above 1× are clamped on shield |
| Smash, on perfect shield | attacker freezes, **defender gets none** | same. A perfect block is a wall that does not flinch. |
| Sakurai on hitstop | damage → longer freeze, with a **hard cap**; both parties freeze; **the characters vibrate** during the freeze, attacker "slightly," and the vibration decays | [Famitsu column](https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/) |
| Wagar | SF2's freeze is ~10 frames and is what makes cancels possible: "gives the eyes a few frames to register and confirm it happened" | [CritPoints](https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/) |
| Monster Hunter Wilds beta | shipped with reduced hitstop, veterans demanded it back, the director confirmed it was re-tuned before launch | [PC Gamer](https://www.pcgamer.com/games/rpg/monster-hunter-wilds-game-director-says-the-betas-missing-hitstop-has-already-been-tweaked-thanks-to-very-positive-feedback-from-hitstop-hungry-veteran-hunters/) |
| Vlambeer "sleep" | pause the whole game for a moment on impact; a reimplementation of the talk uses 20 ms | [talk notes](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/), [ShotgunTom](https://github.com/mingrui/ShotgunTom) |

The pattern: **fighting games run 100–250 ms**; arcade shooters run 20–60 ms; nobody who ships good feel runs a *strike* freeze under ~3 frames. Our `133·m²` gives 21 ms at m = 0.4 and 48 ms at m = 0.6. That is why hits "do not feel like anything." See §7.

### 1.5 Vlambeer and "Juice it or lose it": the catalogue

Nijman's *Art of Screenshake* adds ~30 changes to a bland shooter, in this order ([notes](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/)): basic animation and sound → lower enemy HP → higher rate of fire → more enemies → bigger bullets → muzzle flash → faster bullets → less accuracy → impact effects → hit animation → enemy knockback → **permanence** → camera lerp → **camera position** (lead toward where the player is looking) → screen shake → player knockback → **sleep** → gun delay → gun kickback → strafing → shells → more bass → super machine gun → random explosions → faster/more enemies → camera kick → bigger explosions → smoke → **meaning** → death animation.

Translate each to an arm duel:

| Vlambeer | Arm duel equivalent |
|---|---|
| lower enemy HP / higher rate of fire | more *events per minute*: the opponent's hand starts in reach; jab is a 160 ms tap |
| bigger, faster bullets | the gripper smear ribbon (`fps-feel.md` §4.6) and strike speed readout |
| muzzle flash | the LED on the striking link flares white on release |
| impact effects, hit animation | sparks plus the victim's arm actually being thrown (physics), plus render vibration |
| enemy knockback | already physics; amplify the *read* of it with a spark trail and a stagger tag |
| permanence | scuffs, scorch decals, cubes stay where they fall, a dented link LED that stays cracked for the round |
| camera lerp / position | the aim leads the physical pan (`fps-feel.md` §3.1); Nuclear Throne places the camera halfway between the player and the mouse ([Splint](https://stevensplint.com/nuclear-throne-style-camera-system/)); ours leads by up to ±35° |
| screen shake, sleep, kick | §4 below |
| gun delay / kickback | the servo's own windup and the 0.8° recoil pitch on a dealt strike |
| more bass | the sub layer on every hit; the deck LED strip flash as visual bass |
| meaning | a hit changes the score, the crowd, the host, the music. A hit nobody reacts to is a physics event, not a game event |

Jonasson and Purho's *Juice it or lose it* makes the same point with a Breakout clone: tweens, scaling, squash, particles, trails, screen shake, sound, until "the same game feels alive" ([GDC Vault](https://www.gdcvault.com/play/1016487/Juice-It-or-Lose)). The lesson for us is not the list; it is the demonstration that **the same simulation** goes from "bad Scratch game" to "alive" with nothing but polish.

### 1.6 Celeste and Hades: streamlining

Thorson's Celeste thread ([thread](https://threadreaderapp.com/thread/1238338574220546049.html)): coyote time (jump for a few frames after leaving a ledge), jump buffering (press early, jump on the landing frame), half gravity at the jump apex while holding jump, corner correction (the game "wiggles you" around a corner you clipped), lift momentum stored "for a few frames," wall jump from 2 px away, super wall jump from 5 px. "All are centered around widening timing/positioning windows, so that everything is fudged a tiny bit in the player's favor… it wants you to succeed."

Hades: Supergiant repeatedly shipped input-buffering improvements in patches ([patch notes](https://www.supergiantgames.com/blog/hades-superstar-update-patch-notes/)); the general technique holds a pressed action in a queue and fires it the first frame the character is free ([overview](https://salivity.github.io/game-development/article/input-buffering-for-better-combat-responsiveness)). Players notice when this goes missing: Hades II's visible dash delay is a recurring complaint ([Steam thread](https://steamcommunity.com/app/1145350/discussions/0/4357872738330930573/)).

Street Fighter 6 buffers normals up to 4 frames early, dashes and reversals up to 7 (`fps-feel.md` §1.6). The rule across all of them: **the game resolves intent, not the exact frame of the press.**

### 1.7 Anticipation, attack, recovery

- GDKeys' formula: **anticipation time = player reaction time (~250 ms, 15 frames at 60) + the time the player's counter takes to trigger + a difficulty buffer.** Hollow Knight's Hornet: dash 15 f anticipation / 10 f attack / 10 f recovery; throw 20 / 35 / 10; lasso 20 / 30 / ~1 s. Anticipations must be "drastically different" from each other because "subtleties disappear during combat," and the attack phase itself should be near-instant with "constant speed" ([GDKeys](https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/)).
- Rivals of Aether workshop guide: the anticipation pose needs "a distinct silhouette," and "the stronger the attack, the more obvious the pose has to be." A "powerful attack deserves a powerful windup" ([Rivals lib](https://www.rivalslib.com/workshop_guide/art/anticipation_action_recovery.html)).
- Colantonio on Dark Messiah (GDC 2007): they "had to redo a fair amount of work" to emphasize enemy anticipation because players had no reaction time; players also "expected highly responsive controls" even in slow, tactical melee ([transcript](https://archive.org/stream/GDC2007Colantonio/GDC2007-Colantonio_djvu.txt)).
- Hugo Martin on Doom Eternal: enemy tells were sped up but kept "still a strong tell, because we need that"; "it's important that things react when they should react, with the speed they need to react" ([Q&A](https://www.gamedeveloper.com/design/q-a-evolving-the-combat-design-of-id-software-s-i-doom-eternal-i-)). Doom's loop is a resource loop: health from glory kills, ammo from the chainsaw, armor from the flame belch, so the player is always pushed *toward* the enemy ([Shacknews](https://www.shacknews.com/article/116635/hell-razer-the-making-of-doom-eternal?page=4)).
- Monster Hunter's "commitment actions" (non-cancellable attacks) are what make the weapons feel heavy and are also the teaching mechanism: "learning a weapon's animation and mastering your timing is a vital part" ([Kotaku](https://kotaku.com/monster-hunters-animations-make-you-a-better-player-1822776242)). Our servo *is* a commitment action. The charge release commits ~250 ms of swing you cannot take back past the feint window.

### 1.8 Latency: what people notice

- First-person, precise tasks: keep motion-to-photon **≤ 100 ms**; players notice from ~85 ms (Claypool, via `fps-feel.md` §1.6).
- Jörg et al. / UPenn: an average **150 ms** of added delay "significantly reduced the player's perceived ease of control, their performance, and their satisfaction"; 50 and 100 ms jitter were noticed by some, **150 ms jitter by every participant** ([Player Perception of Delays and Jitter](https://dl.acm.org/doi/pdf/10.1145/2628257.2628263)).
- Below ~50 ms button-to-visual is generally imperceptible ([latency survey](https://arxiv.org/pdf/2208.11774)).

The consequence for a servo arm: the *arm* legitimately takes 160–250 ms, which is in the "everyone notices, satisfaction drops" band **if the arm is the only response.** Something else must respond in < 50 ms. That is the whole argument of §5.

### 1.9 The toy test

Swink: "it was OK to suck because it was fun just to noodle around and bump into things." The test: strip the goal, the opponent, the HUD and the host. Is moving the arm and hitting things fun for a minute? Games that pass: Mario 64's Bob-omb Battlefield ("thoughtless joy"), Rocket League (Psyonix tuned ball touches with an extra, non-Newtonian impulse on the ball purely for feel: [smish.dev](https://www.smish.dev/rocket_league/ball_simulation_3/)), Getting Over It (the hammer is an IK rig with a slight delay where "acceleration of the hammer… can translate to hurling yourself with more force": the lag is the skill), Surgeon Simulator (Bossa: the awkward controls "put everyone on an equal playing field" and "with failure not being embarrassing but funny… people wouldn't turn down having a go": [Game Developer](https://www.gamedeveloper.com/business/the-blissfully-awkward-controls-of-i-surgeon-simulator-2013-i-)).

The last two matter for us. **A servo arm chasing a ghost is a Getting-Over-It hammer with a Surgeon-Simulator hand.** That is a proven toy, if the lag is legible and the failures are funny rather than confusing.

---

## 2. Diagnosis: which fundamental each complaint is failing

| Owner's words | Fundamental | Specific cause | Fix section |
|---|---|---|---|
| "plain, unlit, grey" | polish (visual) | no juice pass ran; `duel-primetime` art bible unrun | art track; §4 for hit-driven light |
| "nothing moves unless the player moves" | simulated space feels dead; no "background breathing" (study feature B4.1) | opponent idles at a fixed pose; no servo hunting; no environment motion | §6 |
| "the opponent feels like a script" | anticipation/attack/recovery unreadable; no reaction to being hit | AI has no tells that reach the screen; hit reactions are physics only, no amplification | §4, §6 |
| "hits do not feel like anything" | hit stop below perception; sound not on the event frame; no camera control | `133·m²`; `setInterval` beat; render lerp; no kick | §4, §7 |
| "the arms have no life" | extension of the senses; proprioception absent | no whine tied to error, no LED, no ghost by default, no overshoot read | §5, §6 |
| "the first minute is confusing" | streamlining; spacing | nothing in reach; no instant confirmation that input was received; no forgiveness | §3, §8 |
| "no reason to play again" | meaning (Vlambeer's last step); mastery loop | hits change nothing visible; no skill curve on display | §9, and the engagement track |

---

## 3. FEEL SPEC A: the first five seconds of moving the mouse

Everything here is measured from the first `pointermove` after pointer lock. "Frame" = 16.7 ms at 60 Hz.

| t | What the player must perceive | Channel | Number |
|---|---|---|---|
| 0–1 frame | the view turns with the hand, no smoothing | camera | aim yaw from mouse X in the same render frame; **zero** filtering; sensitivity default 0.0015 rad/count (`combat-design.md` §9.5) |
| 0–1 frame | "the machine heard me" | ghost + tether | ghost arm jumps to the command the same frame; a thin team-colour tether from gripper to ghost gripper, width ∝ error |
| ≤ 5 ms | the motor starts to strain | audio | servo whine onset. Pitch = 180 Hz + 900 Hz · min(1, Σ|ctrl − qpos| / 1 rad); gain rises over 20 ms. This is the proprioceptive channel and must never be late |
| ≤ 1 frame | the motor lights up | LED emissive | per-joint LED intensity = clamp(|ctrl_j − qpos_j| / 0.5 rad); flare white at torque saturation |
| ≤ 1 frame | a tick in the hand | haptics (gamepad) | 12 ms weak 0.15 on every command-direction reversal; on mouse, nothing (no channel) |
| 30–45 ms | the arm has visibly begun to move | arm | onset is fast even though travel is slow (`fps-feel.md` §3.2). Requires the fixed-step loop and no render lerp |
| 160 ms | the arm is halfway there, and the camera leaned into it | camera secondary | roll = clamp(−0.012 · pan accel, ±3°) low-passed at 12 Hz (`fps-feel.md` §4.7) |
| 245 ms | the arm arrives and **overshoots** | arm | 0.09 rad stock, 0.18 rad at 2×: measured, free. Must be visible: the smear ribbon draws through the overshoot |
| 250–500 ms | the arm settles like a thing with mass | arm + audio | whine falls to idle; LED dims; a soft "clack" of the servo seating (render-side, triggered when error crosses 0.02 rad downward) |
| ≤ 200 ms after your first big motion | the opponent noticed | opponent | its wrist camera link turns toward your gripper (eye contact); its LEDs brighten; a small posture shift. See §6 |
| ≤ 3 s | you hit something | spacing | the opponent's gripper starts **inside** your reach at round start (both hands forward, ~0.10 m apart); the Core is within a 0.3 rad pan |

Hard rule: **no input path may have smoothing, acceleration or rate limits on the command.** The servo is the smoothing. This is Swink's real-time control; everything downstream is simulated space.

Failure modes to test for: if the whine is late (> 20 ms) the arm reads as "ignoring me"; if the ghost is hidden the arm reads as "laggy"; if the render lerp is present the arm reads as "underwater"; if the opponent does not react the room reads as "empty."

---

## 4. FEEL SPEC B: a light hit and a heavy hit on every channel

Definitions. `m ∈ [0,1]` is the existing normalized impact magnitude (`impactIntensity`, `finals-feel.md` §4.1). **Light** = strike with m < 0.4 (roughly tip speed under ~1.0 m/s; a wrist jab, a lazy flick). **Heavy** = m ≥ 0.4 (a full pan flick at stock reaches m ≈ 0.85; anything charged). **Crit** = heavy on the camera mount or a clean-hit zone. "Dealt" and "taken" are from the local human's seat.

Order of importance (Swink's list, sorted for a strike): hit stop → sound → victim thrown + vibration → camera kick → flash and sparks → HUD → rumble. If frame budget forces cuts, cut from the bottom.

### 4.1 Timeline of a heavy hit dealt (m = 0.8), wall-clock

```
t (ms)   0        17       50       83      133     200      300      450     600
sim      ▌FREEZE (sim clock stopped) ─────────────▐ resume
audio    ▌sub thump + crack + servo tick (event frame, never waits)
                                    ▌"tink" crit layer at +40 (crit only)
victim   ▌render vibration 1.5 mm @ 30 Hz, decaying to 0 over the freeze
         ▐ then physics throws the arm (already simulated; sim resumes here)
camera   ▌recoil pitch −0.8° spring (ω 22)      settles ~250 ms
         ▌FOV −2.5°·(0.5+m) spring (ω 18)
         ▌trauma += 0.10 + 0.15·m  (24 Hz, roll-biased)   → 0 by ~400 ms
world    ▌impact flash HDR ×6 (bloom)   ▌sparks 6+30·m, live 300–600 ms, land and stay
         ▌victim link LED flares white → decays 250 ms      ▌deck edge strip flash (team colour, 120 ms)
HUD      ▌hit ticks (crosshair)         ▌damage number pop 1.4→1 in 80 ms, holds 700, fades
         ▌opponent bar: chunk detaches, red ghost segment drains over 900 ms (Tekken-style)
haptic   ▌dual-rumble 50+70·m ms, strong 0.15, weak 0.25+0.4·m
crowd    ▌lean +0.04+0.1·m; audio swell 200 ms later (crowd is late, on purpose: it reacts to what it saw)
host                                                       ▌caption ≥ 300 ms later, if P2 qualifies
```

### 4.2 Channel table

| Channel | Light dealt (m < 0.4) | Heavy dealt (m ≥ 0.4) | Light taken | Heavy taken |
|---|---|---|---|---|
| **Hit stop** (sim clock) | **50 ms** (3 f) | **67 + 83·m** ms (m 0.5 → 108, m 1 → 150 cap) | 50 ms | same formula; victim's *render* vibration lasts the full freeze, attacker's ghost unfreezes at 60 % of it (Punisher asymmetry: the hitter gets control back first) |
| **Time dilation** | none | crit only: 0.5× for 120 ms after the freeze, ease back over 200 ms | none | stagger trigger: 0.35× → 1.0 over 350 ms (existing) |
| **Victim body** | render vibration A = 0.8 mm @ 30 Hz | A = 1.5 mm @ 30 Hz along the contact normal, decaying `(1 − t/T)`; attacker A/3 (Sakurai) | your own upper-arm housing (lower frame) vibrates 0.5 mm | 1.5 mm plus the camera is *on* the shoulder so the vibration is felt in the view: 0.3° pitch jitter for the freeze |
| **Camera kick** | none | recoil −0.8° pitch (into the hit), ω = 22 | none | kick **away from the contact point**: 1.5° + 3°·m, axis = cross(forward, contactDir), ω = 22. The direction is information: you learn where you were hit |
| **Camera shake (trauma)** | none | +0.10 + 0.15·m, 24 Hz, roll-biased (dealt hits feel "sharp") | none | +0.25 + 0.35·m, 18 Hz, pitch/yaw ≤ 1.5°, roll ≤ 2.5° (taken hits feel "heavy") |
| **FOV** | none | −2.5°·(0.5 + m) punch-in, ω = 18 | none | +3°·m (the world lurches away) |
| **Viewmodel (your arm)** | it is physics and is never faked. The *ghost* holds still through the freeze | same, plus the striking link's LED flares white for 250 ms and the smear ribbon is forced visible 250 ms | your arm is physically thrown; nothing to add | the tether snaps taut (your ghost is now far from your arm); whine spikes as the servo fights back to the command |
| **World VFX** | 6–18 sparks, 1 small flash | 18–36 sparks + hit light (point light, team colour, 120 ms) + deck edge flash 120 ms + crowd lean | sparks at contact, in your lower frame | sparks toward the camera; damage edge in attacker colour 0.30·m, τ 250 ms, from the side you were hit |
| **Sound** (event frame, WebAudio scheduled at `ctx.currentTime`, never after the freeze) | `tok`: mid transient + servo tick; pitch +3·m st; −6 dB vs heavy | `tok` + `crack` + **sub thump** 45–60 Hz 80 ms; crit adds `tink` at +40 ms (delayed ring reads as "resonance") | `crunch_light` | `crunch` + sub + a 200 ms low-pass dip on the music bed (ducking is a channel) |
| **UI** | hit ticks 150 ms; damage number small | ticks + number pop 1.4→1 in 80 ms; bar chunk with delayed drain; `IMPACT 2.7 m/s` tag | your bar chunks; silhouette pip flashes | your bar chunks; `−31` in attacker colour under your plate; HUD frame shakes 2 px for 120 ms |
| **Haptics** | 50 ms, strong 0.15, weak 0.25 | 50 + 70·m ms, strong 0.15, weak 0.25 + 0.4·m | 60 ms, strong 0.4, weak 0.3 | 60 + 80·m ms, strong 0.4 + 0.5·m, weak 0.3 + 0.4·m |
| **Crowd / host** | crowd hype +0.04 | +0.04 + 0.1·m; audio swell ~200 ms later | groan | groan; host P2 if dmg ≥ 30 |

Two rules that make light and heavy *feel* different rather than merely *look* different:

1. **A heavy hit adds channels; it does not scale the light one.** Light = freeze + sound + sparks + ticks. Heavy = all of that plus camera, sub, flash, deck strip, crowd, bar chunk. Keep light hits *clean* so heavy hits have somewhere to go (this is also `GAME_DESIGN.md` §8.1's channel budget: 3 for light, 5 for heavy).
2. **Frequency, not just amplitude.** Dealt shake at 24 Hz reads as metallic and sharp; taken shake at 18 Hz reads as a slam. Dealt sub is short (80 ms); taken sub is longer (140 ms). The player should be able to tell dealt from taken with eyes shut.

### 4.3 Hit stop implementation notes

- Freeze on the impact step itself (break out of the substep loop), so the frozen frame shows the contact, not the frame after (`GAME_DESIGN.md` §8.1 already says this).
- Merge: `remaining = max(remaining, new)`. Cap 150 ms. Rolling budget 120 ms per 600 ms.
- What keeps running during the freeze: camera springs and trauma decay (so the kick lands *on* the freeze), the flash envelope, the vibration, UI, audio. What stops: sim, ghost, reticle, particles' physics, the AI worker.
- Vibration is render-only. The sim never sees it. Policy replays stay bit-exact.
- **Perceptual floor: 50 ms.** Two frames or fewer is not perceived as a freeze; it is perceived as a stutter. Three frames is the smallest "the game stopped to look at that" beat.

---

## 5. FEEL SPEC C: servo lag as an asset

### 5.1 The two-channel model

```
                     ┌── COMMAND channel (≤ 1 frame) ──────────────────────┐
mouse ──► aim yaw ──►│ camera turn · ghost pose · tether · whine · LED · tick│──► "it heard me"
                     └──────────────────────────────────────────────────────┘
                     ┌── MASS channel (30–250 ms, honest physics) ─────────┐
              ctrl ─►│ PD servo at τmax · link inertia · overshoot · settle │──► "it has weight"
                     └──────────────────────────────────────────────────────┘
```

Swink's real-time control lives entirely in the command channel. Simulated space lives in the mass channel. Neither may leak into the other: no smoothing on the command, no faking on the mass. Players tolerate a slow *body* (Monster Hunter, Dark Souls, Mordhau) as long as the *intent* registers instantly. They do not tolerate a slow *cursor*.

### 5.2 Make the lag legible (this is what turns mush into weight)

| Signal | Drives | Why it works |
|---|---|---|
| **Whine pitch** = f(tracking error) | audio | error is known one physics step before motion. The sound *leads* the arm. The brain attributes the delay to effort, not to lag. This is Swink's proprioception: strain you can hear |
| **Whine timbre** = f(saturation) | audio | at torque limit add a 2nd-harmonic growl and a 50 Hz flutter. A saturated servo sounds *different* from a moving one. Stall (error high, velocity ~0) gets its own sound (§7, block) |
| **LED per link** = error | emissive | the visual copy of the whine; reads at a glance which joint is working |
| **Tether** ghost ↔ arm | line VFX | length = how far behind the arm is. Width thins as it catches up. Snaps to nothing on arrival with the seat "clack". The leash (0.6 rad) is drawn as the tether going taut and *dragging the ghost*, so the player learns the limit by seeing it |
| **Overshoot + settle** | physics, made visible by the smear ribbon | the 0.09–0.18 rad follow-through is the "whip." Show it. Score hits during follow-through as a distinct **WHIP** tag with +10 % damage: the lag becomes a technique |
| **Camera secondary lean** | camera | 0.6–3° roll from pan acceleration; the cockpit leans into the swing like a body would |
| **Heat as fatigue** | HUD strip on your own upper arm | sustained saturation raises heat; the whine gets rougher as heat climbs. Lag now has a *story*: the machine is tired |

### 5.3 Make the lag skillful

- **Lead the target.** The ghost can be up to 0.6 rad ahead. A good player flicks *past* the opponent's hand so the arm is at full speed on arrival. The HUD reach pip (`combat-design.md` §9.3) shows the 60–85 % sweet band.
- **Feint = reverse the command before contact.** The whine rises and falls; the opponent hears it. Feint window closes 50 ms before contact (Mordhau's number).
- **Charge = pre-load the lag.** The retract (0.45 rad away, 0.06 m back) is anticipation the physics then pays out as a longer, faster swing. Charge glow is public; the retract is a silhouette the opponent can read.
- **Catch the overshoot.** After a whiff the arm is past the target. A skilled player reverses into the overshoot so the return swing is already at speed (a "backswing"). Reward it: contacts within 300 ms of a direction reversal keep the previous speed's tag.
- **Torque tiers widen the skill gap.** At stock, a lazy 150 ms drag is still a strike (ν ≈ 0.8); at 2× a lazy drag is a graze (ν ≈ 0.41) (`combat-design.md` §9.5). Arcade uses 2× for exactly this reason.

### 5.4 Never let it become mush (hard rules)

1. Command path: zero smoothing, zero acceleration, zero rate limit, consumed as the latest value every fixed step.
2. Render path: bodies from MuJoCo `xpos/xquat` with fixed-step interpolation only (≤ 5 ms), **no** exponential lerp.
3. Leash 0.6 rad so the arm is never more than ~250 ms behind the command.
4. Whine and LED must fire within one fixed step of the command change.
5. Arm onset must be visible within 45 ms; if the render loop cannot show it, the loop is the bug.
6. The ghost is on by default in ARCADE and the tutorial. Ranked can hide it once the player has 10 matches.

---

## 6. FEEL SPEC D: nothing moves unless the player moves (fixing the dead room)

The impact-feel study lists "background breathing" as a juice feature; Vlambeer's "camera position" and "permanence" are both about the world having a life of its own. Three layers, cheapest first:

### 6.1 Your own arm is never perfectly still
Real servos hunt. Render-only dither on every link: 0.3 mm at 7 Hz gradient noise while any joint's error > 0.02 rad, 0.1 mm otherwise. The whine idles at −30 dB with a slow 0.3 Hz wobble. The LEDs breathe at 0.5 Hz between 30 % and 45 %.

### 6.2 The opponent is always doing something
Ordered by how much life it buys per line of code:

| Behaviour | Trigger | Motion | Tell |
|---|---|---|---|
| **Eye contact** | always | wrist camera link yaws toward the player's gripper, low-passed at 2 Hz, ±0.3 rad | the head turns with you. Cheapest, biggest effect |
| **Servo hunting** | idle | ±0.01 rad at 1–2 Hz on pan and lift, from the AI's command (so it is honest) | the arm is alive |
| **Posture shifts** | every 1.5–3 s idle | re-seat elbow/lift by 0.05 rad over 300 ms | it is thinking |
| **Flinch** | the player's tip speed > 1.2 m/s within 0.25 m | guard raise 0.1 rad over 120 ms, then relax | it saw that |
| **Feint** | personality-driven | a 0.15 rad jab command reversed at 80 ms | whine rises and falls; LED blips |
| **Hit reaction amplification** | when struck | physics throws it; add LED flicker 12 Hz for 400 ms and the whine dropping an octave for 200 ms (servo "brownout") | it hurt |
| **Taunt** | after landing a heavy, 15 % chance | wrist roll ±0.6 rad twice | personality |

All of these are *commands* through the same policy interface, so Harness mode remains honest. They are also all tells: a live opponent is a readable opponent.

### 6.3 The room reacts
Deck edge strips flash team colour on every hit (120 ms), pulse with the music bed, and run a chase toward the Core when it drops. Spot cones sweep on a 6 s loop and snap to the striker for 300 ms on a heavy. Crowd holograms lean (hype-driven, `GAME_DESIGN.md` §8.7). Haze drifts. None of this needs the player.

---

## 7. FEEL SPEC E: whiff and block

### 7.1 A whiff must feel like a whiff

A whiff is an attack that was meant to land and did not. The physics already provides the recovery: 0.09–0.18 rad overshoot, 465–565 ms to settle, and (for a charged release) 250 ms of τ×0.8 plus +10 heat (`combat-design.md` §9.4). What is missing is the *read*.

| Channel | Your whiff | Opponent's whiff |
|---|---|---|
| Sound | **whoosh** pitched by tip speed (band-passed noise, centre 400 Hz + 600 Hz·v/3 m/s, 120 ms, Doppler-ish falling tail); whine *falls* as the servo brakes; no impact layer at all | same whoosh, spatialized; crowd "ooh" if the swing passed within 0.08 m of you |
| Camera | 0.6° roll *into* the swing direction, then a 0.4° "stumble" dip over 200 ms as the arm hits the leash | nothing |
| Arm | overshoot forced visible via the smear ribbon; tether taut for the settle; LED goes amber for the reduced-torque 250 ms | its arm overshoots and hangs; its LEDs go amber; **`OPEN`** tag over its gripper for the recovery window (300 ms) |
| HUD | charge ring snaps empty once; heat +10 visibly | opponent plate flashes `WHIFF` in grey, 300 ms |
| Haptic | a soft 30 ms weak 0.2 "air" pulse | none |
| Host | nothing (whiffs are frequent) | P3 "Nobody home." only if the player then lands a hit within 400 ms: `PUNISH` tag |

The purpose of the opponent-side read is the fighting-game loop: whiff → punish. If the human cannot see the opponent's recovery, there is no reason to wait, bait, or read.

### 7.2 A block must feel like a wall

Physics: a strike into a held guard drives the attacker's servo into stall (error high, velocity ~0, torque pinned at 2.94 N·m). The defender's servo is also pinned. That is a distinct state and the whole feel is built on making it *audible* and *visible*.

| Channel | Attacker (you hit their guard) | Defender (you blocked) |
|---|---|---|
| Hit stop | 33 + 17·m ms on the contact **onset** only; never while grinding | same freeze (Smash: multipliers > 1 are clamped on shield, and a *perfect* block gives the defender no freeze at all: use that for **deflect**) |
| Sound | `thock` (dull, no ring, −3 dB vs a hit) then **stall growl**: 60 Hz + 2nd harmonic, gated by (error > 0.3 rad AND |q̇| < 0.3 rad/s), rising over 150 ms while held. This is the sound of "wall" | `thock` + a cyan guard "ripple" tone; the growl of *your* servo holding |
| Camera | **0.5° push back along the contact normal**, ω = 22, no shake: your view is shoved as if the mouse hit something | **zero shake, zero kick.** A wall does not move. (This is the single most important line in this section) |
| Arm | the tether goes taut instantly and *stays* taut; ghost drags; LED flares to saturation white and holds; smear ribbon cuts off dead at the contact | guard ripple decal on your gripper; LED steady cyan |
| HUD | `BLOCKED` tag 400 ms; damage number small and grey | guard meter chip; `GUARD` tag |
| Haptic | 40 ms strong 0.5 (a thud), then a 0.2 weak buzz while stalled | 40 ms strong 0.3 |
| Crowd | none | murmur +2 dB |

**Deflect** (a guard raised into the strike within the parry window) is the opposite of a wall: bright `ting`, cyan chevron burst, FOV −2° over 120 ms, attacker stunned, no freeze for the defender (Smash perfect-shield rule), 90 ms freeze for the attacker, crowd "ohh," host P2. Deflect is the "Witch Time" beat: the one moment the defender's channel outshines the attacker's.

### 7.3 Clash
Two strikes meeting: 40 ms freeze, ring flash at the contact, both LEDs white, both cameras 1.5° kick along the normal, `clash` ring sound, hype +0.06. Rare, so it can be loud.

---

## 8. FEEL SPEC F: streamlining (Celeste rules for a servo arm)

| Celeste | Ours | Number |
|---|---|---|
| Jump buffering | **Strike buffering:** a jab/charge press within 100 ms *before* the arm makes contact still tags the contact as that strike | 100 ms; 150 ms if a freeze intervenes |
| Coyote time | **Coyote guard:** guard pressed up to 80 ms *after* the opponent's contact onset counts as `late_guard` (reduced damage, existing event) | 80 ms; full guard needs the button down ≥ 1 step before onset |
| Corner correction | **Reticle magnetism:** aim yaw target eases ≤ 3° toward the opponent's gripper when within 12° and the mouse is slow (< 200 counts/s) | 3°, ease τ 120 ms; off in HARNESS |
| Half gravity at apex | **Aim-brake:** when the mouse stops for ≥ 40 ms and the ghost is within 0.15 rad of the arm, hold the command (do not let the arm's overshoot drag the ghost) so a *precise* placement lands where you pointed; swings still overshoot | 40 ms, 0.15 rad |
| Wall jump from 2 px away | **Grab assist** (exists): jaws close on a cube within 8 mm of the pads | keep |
| Lift momentum stored | **Whip carry:** a reversal within 300 ms keeps the prior speed tag | 300 ms |
| Stamina refund | **Deflect refund:** a successful deflect refunds 15 heat | 15 |

Rule: every one of these is off in HARNESS and visible in the Lab report, so the policy verification stays honest. In ARCADE they are on and silent: Thorson's fudges are never announced.

---

## 9. FEEL SPEC G: anticipation / attack / recovery, both seats

| Phase | Player arm (what you feel) | Opponent arm (what you must be able to read) | Minimum tell length |
|---|---|---|---|
| **Anticipation** | charge retract (0.45 rad away, 0.06 m back), whine rising, charge ring filling, LEDs brightening; the camera leans 0.6° back | same, seen from the front: the silhouette changes (arm draws back), LEDs brighten, whine rises, charge glow is public | jab: the ~30 ms LED/whine lead is the only tell (jabs are meant to be fast; they do light damage). **Heavy: ≥ 250 ms** visible retract before the swing (GDKeys). If the AI's retract is shorter, the AI is cheating |
| **Attack** | release: command snaps, τ×(1+0.5c) for 250 ms, smear ribbon, LED white | smear ribbon on its arm; whine at max; a 300 ms window in which a guard or deflect resolves | attack phase should be near-constant speed: it is (servo at terminal ω) |
| **Recovery** | overshoot, settle, τ×0.8 for 250 ms after a whiff, amber LED | `OPEN` tag, amber LED, hanging overshoot | ≥ 300 ms after a whiff; ≥ 150 ms after a blocked heavy |

Opponent tells must be **drastically different** per attack (GDKeys): jab = a short LED blip and a high whine chirp; heavy = retract + glow + low rising whine; grab = jaws opening wide (visible) + a ratchet sound. Never let two attacks share a tell.

---

## 10. FEEL SPEC H: the toy test and the feel bench

### 10.1 The bench (Swink's "Magic Garden")
A scene with: your arm (ARCADE torque), a brass bell on a post at 60 % reach, a stack of five cubes, a strike pad that shows contact speed and force in Chivo Mono, and a limp opponent arm that can be toggled to "guard" or "hunt." No HUD, no host, no music, crowd off. Every juice parameter is a slider on the right (hit stop floor and slope, trauma gains, kick degrees, FOV, whine curve, LED gain, vibration amplitude, buffer windows). A "record input" button saves the mouse stream; "replay" plays it back through the sim so two tunings can be compared on identical input. This is also how the harness later A/B tests feel changes without a human.

### 10.2 Pass criteria
1. **Sixty seconds unprompted.** A new player given only "click to grab the mouse" keeps hitting things for 60 s without being told to. Log session length in bench mode.
2. **Eyes-shut test.** With the screen covered, a player can say "I hit it" vs "I missed" vs "it was blocked" from sound and rumble alone, 9 of 10 times.
3. **Weight test.** Ask "does the arm feel heavy or light?" The answer must be "heavy but it does what I say." "Laggy" or "floaty" fails.
4. **Dealt vs taken.** Player can tell, eyes shut, whether they hit or were hit.
5. **Latency.** Camera motion-to-photon ≤ 35 ms; whine onset ≤ 5 ms after the command; visible arm onset ≤ 45 ms (measure with a high-speed phone camera on the laptop at 240 fps).
6. **Rings and clacks.** The bell rings with pitch by strike speed; the cubes scatter and stay scattered (permanence). If the cubes reset themselves, the bench fails the permanence test.

---

## 11. Changes to numbers that already exist

| Where | Existing | Change to | Why |
|---|---|---|---|
| `GAME_DESIGN.md` §8.1 hit stop | `round(133·m²)` for m ≥ 0.15 → 21 ms at m 0.4 | **light (m < 0.4): 50 ms flat; heavy: 67 + 83·m, cap 150** | sub-3-frame freezes are not perceived as freezes; the study's #1 feature is being starved |
| §8.1 guarded strike | `50·m²` | 33 + 17·m on onset only | same floor logic; a block onset needs ≥ 2 frames to read |
| §8.1 attacker vs victim | symmetric | attacker's ghost unfreezes at 60 % of the freeze; victim vibration runs the full freeze | Punisher asymmetry: hitter regains initiative |
| §8.2 shake max | yaw/pitch 1.2°, roll 2.0° | keep 1.2°/2.0° for ARCADE default; the 1.5°/2.5° in `fps-feel.md` is the ceiling at 100 % camera motion | consistency between the two docs |
| §8.1 haptics | as listed | add a 12 ms weak 0.15 tick on command reversal (gamepad) and a 40 ms strong 0.5 block thud | the command channel needs a tactile member |
| `combat-design.md` §9.4 whiff | +10 heat, τ×0.8 for 250 ms, `whiff` −6 dB | keep, and add the whoosh, camera roll/dip, amber LED, and the opponent-side `OPEN` tag | recovery has to be *seen* to be punished |
| §9.3 reach follow-through | jab targets r_contact + 0.05 | keep; add the WHIP tag for hits during the 300 ms after a reversal | turns overshoot into technique |
| Rolling hit stop budget | 120 ms / 600 ms | keep, but the 50 ms floor takes priority over the budget for the first hit in any 600 ms window | a starved first hit is worse than a slightly over-budget exchange |

---

## 12. Build order (smallest steps that change how it feels, in order)

1. The loop: fixed step, no render lerp, bodies from `xpos` (`fps-feel.md` §6). Nothing else matters until the command channel is under one frame.
2. Whine from tracking error, LED from tracking error, ghost on by default, tether line. (§5.2)
3. Hit stop with the 50 ms floor and the heavy formula, victim vibration. (§4.3)
4. Sound on the event frame: sub + mid + tick, three layers, randomized. (§4.2)
5. Camera kick away from contact, FOV punch, trauma. (§4.2)
6. Opponent eye contact, servo hunting, flinch. (§6.2)
7. Block stall growl, taut tether, defender zero-shake. (§7.2)
8. Whiff whoosh, overshoot ribbon, `OPEN` tag. (§7.1)
9. Buffers and coyote guard. (§8)
10. The feel bench, and the eyes-shut test with a real person. (§10)

Steps 1–5 are the difference between "Scratch game" and "a hit feels like something." Steps 6–8 are the difference between "a script" and "an opponent."

---

## Sources

- Swink, *Game Feel*, chapter 1 (PDF): http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Swink, "Principles of Virtual Sensation": https://www.gamedeveloper.com/design/principles-of-virtual-sensation
- Swink, "Game Feel: The Secret Ingredient": https://www.gamedeveloper.com/game-platforms/feature-game-feel---the-secret-ingredient-
- Game feel (100 ms correction cycle summary): https://en.wikipedia.org/wiki/Game_feel ; https://lizengland.com/blog/review-game-feel-by-steve-swink/
- Pichlmair & Johansen, "Designing Game Feel: A Survey": https://arxiv.org/abs/2011.09201
- Zhang et al., "What Features Influence Impact Feel? A Study of Impact Feedback in Action Games": https://arxiv.org/abs/2208.06155
- Nijman, *The Art of Screenshake* (notes): https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/ ; talk: https://www.youtube.com/watch?v=AJdEqssNZ-U ; reimplementation with sleep 20 ms: https://github.com/mingrui/ShotgunTom ; experiments: https://www.bluetengu.com/2014/12/12/art-of-screenshake-experiments/
- Jonasson & Purho, *Juice It or Lose It*: https://www.gdcvault.com/play/1016487/Juice-It-or-Lose
- Nuclear Throne camera (midpoint to mouse): https://stevensplint.com/nuclear-throne-style-camera-system/
- SmashWiki, Hitlag (formulas, shield rules, perfect shield): https://www.ssbwiki.com/Hitlag
- Sakurai, "Thinking About Hitstop" (Famitsu, translated): https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
- Wagar, "Hitstop/Hitfreeze/Hitlag…": https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/
- Sicienski, "Hitstop in Capcom Beat 'Em Ups": https://shane-sicienski.com/blog/blog-post-title-one-55pmn
- de Heras, "How do 3rd person melee combat games communicate GAME and HIT feel?": https://www.jasondeheras.com/gamedesign/2021/4/23/how-do-3rd-person-melee-combat-games-communicate-game-and-hit-feel
- PC Gamer on Monster Hunter Wilds hitstop: https://www.pcgamer.com/games/rpg/monster-hunter-wilds-game-director-says-the-betas-missing-hitstop-has-already-been-tweaked-thanks-to-very-positive-feedback-from-hitstop-hungry-veteran-hunters/
- Thorson, Celeste game-feel thread: https://threadreaderapp.com/thread/1238338574220546049.html
- Hades patch notes (input buffering): https://www.supergiantgames.com/blog/hades-superstar-update-patch-notes/ ; input buffering overview: https://salivity.github.io/game-development/article/input-buffering-for-better-combat-responsiveness ; Hades II dash delay thread: https://steamcommunity.com/app/1145350/discussions/0/4357872738330930573/
- GDKeys, "Anatomy of an Attack": https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/
- Rivals Workshop, "Anticipation, Action, Recovery": https://www.rivalslib.com/workshop_guide/art/anticipation_action_recovery.html
- Colantonio, GDC 2007 "The Challenges of Designing First-Person Melee Combat": https://archive.org/stream/GDC2007Colantonio/GDC2007-Colantonio_djvu.txt
- ACE Team, "5 tips for first-person face-punching": https://www.gamedeveloper.com/design/5-tips-for-first-person-face-punching
- Hugo Martin Q&A on Doom Eternal: https://www.gamedeveloper.com/design/q-a-evolving-the-combat-design-of-id-software-s-i-doom-eternal-i- ; resource loop: https://www.shacknews.com/article/116635/hell-razer-the-making-of-doom-eternal?page=4
- Kotaku, "Monster Hunter's Animations Make You A Better Player": https://kotaku.com/monster-hunters-animations-make-you-a-better-player-1822776242
- Jörg et al., "Player Perception of Delays and Jitter in Character Responsiveness": https://dl.acm.org/doi/pdf/10.1145/2628257.2628263
- Latency survey (esports rendering): https://arxiv.org/pdf/2208.11774
- Rocket League ball impulse: https://www.smish.dev/rocket_league/ball_simulation_3/
- Bossa on Surgeon Simulator controls: https://www.gamedeveloper.com/business/the-blissfully-awkward-controls-of-i-surgeon-simulator-2013-i-
- Wagar on Getting Over It: https://critpoints.net/2020/12/13/getting-over-it-with-bennet-foddy-review/
- MDN, `GamepadHapticActuator.playEffect` (dual-rumble params, ms, 0–1): https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator/playEffect
- Eiserloh, "Juicing Your Cameras With Math" (trauma², rotation-only in 3D): https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt
