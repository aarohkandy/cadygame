# Combat feel and match flow: lessons from THE FINALS, rebuilt for a 1v1 robot-arm duel

Research track: how THE FINALS (Embark Studios, 2023) feels from moment to moment, why it keeps
people coming back, and how to turn that into a first-person SO-101 duel lasting 60 to 120 seconds
in this repo.

> **Inspiration, not infringement.** This doc borrows *principles* only. We never use their game's
> name, logos, sponsor names, characters, commentator names or lines, audio, textures or fonts.
> Every name, line and sound proposed below is original. Fonts come from Google Fonts.

Status legend used below:
- **[Sourced]**: a fact about THE FINALS, with a URL.
- **[Inference]**: my reading of *why* it works. Not stated by Embark.
- **[Spec]**: a recommendation for our game. All numbers are starting values to tune against telemetry.

---

## 0. TL;DR

1. **The game show frame is the product.** THE FINALS isn't a military shooter with commentary
   bolted on. It's a TV show that happens to be a shooter: commentators, a crowd that reacts to
   play, flashy intros, sponsors, fans. We should build a robot combat *broadcast* too, not a
   physics sandbox with a HUD.
2. **Pretty things are more fun to break.** Embark's art pillar is "appeal and brutality": clean,
   colorful arenas get wrecked. Our robots and table should start out spotless, then pick up
   scuffs, sparks, knocked-over cubes and a flickering "integrity" state as the fight goes on.
3. **The elimination sound is designed like a slot machine.** It has its own slot in the rhythm,
   covers both bass and treble so it cuts through the mids, and uses bell and cash-register tones.
   We copy the *recipe* with a synthesized servo "clack" plus a bell, not their sound.
4. **Steals create the peaks.** Being able to snatch an objective at the last second is the moment
   reviewers call the best in the game. Our duel needs one contested objective (the **Core**)
   whose countdown carries over when it's stolen.
5. **Our announcer is a queue, not a soundboard.** A fixed priority order, cooldowns, a rule
   against repeating lines, and only a few lines per round. Too little commentary is dull, but
   hearing the same line twice is the thing players complain about most.
6. **Hit feedback must come from physics.** Every hitmarker, damage number, camera kick and
   time slowdown is driven by the MuJoCo contact event (`DuelCollision.force`, contact-point
   speed, link hit). No canned hits.
7. **The fair "harness" ruleset must be a first-class mode.** All comeback boosts and time
   dilation can be switched off, so a user's policy is scored under symmetric, deterministic rules.

---

## 1. What THE FINALS actually does (research)

### 1.1 Identity: a virtual combat game show

- **[Sourced]** The setting is a fictional VR combat game show in the year 2100. Contestants fight
  for fame, money and sponsor favor. Classes differ mainly in HP (Light 150, Medium 250,
  Heavy 350). Almost all of the environment can be destroyed.
  https://en.wikipedia.org/wiki/The_Finals ·
  https://www.mmorpg.com/previews/the-finals-the-final-preview-2000129720
- **[Sourced]** Creative director Gustav Tilleby says the "virtual game show" idea was picked
  because it lets the team mix themes and styles freely. The style pillars are **appeal and
  brutality**: breaking something pristine and colorful feels better than breaking something
  already worn.
  https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design
- **[Sourced]** Embark lists The Running Man, Smash TV, American Gladiators, The Hunger Games and
  Squid Game as influences. The game deliberately chose to be "colorful, loud and a wee bit
  chaotic" over a military look.
  https://mp1st.com/news/the-finals-interview-embark-talks-balancing-destruction-and-more ·
  https://www.digitaltrends.com/gaming/the-finals-preview-destruction-will-make-developers-panic/
- **[Sourced]** Their balance philosophy is to make everything "as fun as possible and as
  impactful as possible". They treat mechanics players can't anticipate as a problem for
  readability, not as depth.
  https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design
- **[Sourced]** Reviewers describe a flamboyant intro sequence that drops players into the map,
  holographic onlookers, grandstands in the sky, cheering crowds and live commentary.
  https://gamingtrend.com/reviews/the-finals-review-the-ultimate-fps-gameshow/ ·
  https://www.ggrecon.com/reviews/the-finals-review/ ·
  https://www.videogamer.com/reviews/the-finals-review/

**[Inference] for us:** The frame explains everything else. Once "this is a broadcast" is
established, a hitmarker isn't HUD clutter. It's the show's graphics package. Announcer lines,
replays and the MVP screen are simply what TV does. Our equivalent: **a robot combat league
broadcast from a clean, bright test lab**, with a studio crowd and two original commentators.

### 1.2 Audio: the elimination sound recipe

From Embark's audio team (audio director Andreas Almström) on the Meet the Makers podcast,
summarized on the wiki. https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio

- **[Sourced] Timing.** The kill sound is placed apart from gunshots and grenades so it can peak
  without colliding with them. It has a catchy rhythmic figure (a short syncopated
  "ba-dum-bum-bum" pattern) that grabs attention.
- **[Sourced] Frequencies.** It spans both the bass and the treble, so it pokes through a mix
  where combat and voices sit in the mids.
- **[Sourced] Association.** It uses sounds tied to excitement: slot machines, pinball, cash
  registers. The core bell was recorded from a real reception bell. The team describes the
  reaction as "Pavlovian".
- **[Sourced]** The Battlefield 1 kill sound was the explicit template. Players loved it, so the
  team rebuilt that feeling in a new context.
  https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
- **[Sourced]** Threats can be read by ear. Each grenade type has its own throw and bounce sound
  (sharp pops, hollow metal, can-like rattles).
- **[Sourced]** The crowd is a **dynamic system tied to gameplay metrics**. Cashouts,
  destruction and eliminations set off cheers or groans.
- **[Sourced]** In-game music aims to be uplifting and exciting. Trailer music is edgier and
  distorted. (Composer: Sailor & I.)
- **[Sourced]** Combat audio was recorded in an abandoned Stockholm factory.
  https://mp1st.com/news/the-finals-making-the-finals-dev-diary-e01-explores-sound-design

### 1.3 The commentators

- **[Sourced]** Two commentators call key match events: eliminations, cashout steals,
  overtime, final rounds and so on. One is a hype-driven former contestant. The other is
  analytical and stats-minded, and sounds more polished and corporate.
  https://www.thefinals.wiki/wiki/Scotty_and_June ·
  https://the-finals.fandom.com/wiki/June
- **[Sourced]** The voices come from TTS built on contracted voice actors, mixed with recorded
  lines. Embark says this lets it write reactive lines quickly and iterate as modes change. It
  drew public criticism.
  https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals ·
  https://en.wikipedia.org/wiki/The_Finals
- **[Sourced]** Reviewers praise the atmosphere but call the commentary **repetitive**.
  https://www.ggrecon.com/reviews/the-finals-review/ (review roundup; see also
  https://www.videogamer.com/reviews/the-finals-review/)

**[Inference]:** The two-voice format works because a hype voice and a data voice can hand the
same event back and forth ("THAT'S A STEAL!" then "...with four seconds on the clock"). The
data voice turns raw numbers into drama. That suits a physics game well: we have exact impact
forces, speeds and reaction times to quote.

### 1.4 Match flow, objectives and steals

- **[Sourced] Cashout.** Teams open a vault, carry the cash box to a station and deposit it. A
  countdown starts (2:10 in qualifying rounds, 2:00 in the final), with up to 1 minute of
  overtime to finish an incomplete cashout. Opponents steal by holding interact for 7 s
  (qualifying) or 6 s (final). The team holding the station when the timer ends gets the money.
  Rewards: vault open $1,000, steal $1,000, elimination $500. A team wipe means a 25 to 27 s
  respawn. A solo death means 30 s, cut to 15 s if your team owns an active cashout.
  https://www.thefinals.wiki/wiki/Cashout
- **[Sourced] Double Jeopardy.** Put a second cash box into an active station and you lose 50%
  of your cash if you fail to hold it. This is a deliberate high-risk, high-reward call.
  https://www.thefinals.wiki/wiki/Cashout
- **[Sourced] Steals keep countdown progress** in Quick Cash, and a last-second steal is
  described as one of the most satisfying moments in the game. Reviewers also call a
  near-impossible comeback "euphoric".
  https://www.ggrecon.com/reviews/the-finals-review/ ·
  https://www.videogamer.com/reviews/the-finals-review/
- **[Sourced] Head2Head** is 3v3, single round, first to $50,000, with two cashout stations and
  shorter respawns.
  https://www.thefinals.wiki/wiki/Head2Head
- **[Sourced] Terminal Attack** (removed in Season 8) was 5v5, one life, no healing, rounds of
  plant and defuse with a 7 s interact and a 1 min decrypt.
  https://www.thefinals.wiki/wiki/Terminal_Attack
- **[Sourced] Elimination spectacle.** An eliminated contestant bursts into a spray of coins
  and turns into a small statue. Teammates can carry the statue and revive it with a 4 s hold,
  or the player spends a respawn coin.
  https://www.thefinals.wiki/wiki/Revive_Statue

**[Inference] why steals work:** A shared, carried-over countdown means one moment of skill
flips everything the other side invested. The losing side is never out of the game until the
timer hits zero, and the leading side can never relax. That tension curve is the "just one more
match" engine.

### 1.5 Post-match and progression hooks

- **[Sourced]** From Season 10: an MVP screen with 1st, 2nd and 3rd place (1st in the center)
  that *ignores which team won*; a "Best Score" screen between rounds covering combat, support
  and objective; and a personal stats screen before the scoreboard. MVP gives no extra rewards.
  https://id.embark.games/the-finals/support/faq/216-mvp-screen ·
  https://www.reachthefinals.com/patchnotes/10-00
- **[Sourced] Sponsors and fans.** Actions earn "fans": elimination 20, assist 15, revive 20,
  vault 20, starting a cashout 30, completing one 50, stealing one 30. Placement pays 125, 75 or
  25. Fans level a 20-tier sponsor cosmetic track, with slow early levels (300 to 1,500 fans)
  and 3,000 per level mid-track.
  https://www.thefinals.wiki/wiki/Sponsorships
- **[Sourced]** Emotes and poses are cosmetics, unlocked through career progression, the store
  or the battle pass, and shown during and after matches.
  https://the-finals.fandom.com/wiki/Emotes

**[Inference]:** Recognition that ignores the win (MVP even on the losing team) keeps losers
engaged. A fan economy that pays for *objective* play (a steal is worth more than a kill)
steers behavior toward the dramatic moments.

### 1.6 General game-feel references (not THE FINALS, but where the numbers come from)

- Jan Willem Nijman (Vlambeer), *The Art of Screenshake*, 2013: hit stop ("sleep") on impacts,
  screen shake, camera kick, overdone feedback.
  https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/
- Squirrel Eiserloh, *Math for Game Programmers: Juicing Your Cameras With Math*, GDC 2016:
  the **trauma** model (shake = trauma², trauma decays linearly, noise-based offsets rather than
  random jitter).
  https://www.gdcvault.com/play/1023557/Math-for-Game-Programmers-Juicing

### 1.7 Gaps (not verified, so no claims made)

I found no reliable source for THE FINALS' exact hitmarker shapes and colors, how often
commentators speak, how long its screen shake lasts, or the order of its intro and outro
cameras. The specs below are designed from first principles and are **not** copies of their
values.

---

## 2. Translation: principles we adopt

| # | THE FINALS principle | Our robot duel version |
|---|---|---|
| P1 | Game show frame | "**CIRCUIT**" (working title), a robot combat league shot live from a white test lab with a studio crowd. |
| P2 | Appeal × brutality | Clean, glossy arms and a bright table. Damage adds scuffs, soot and sparks, knocked cubes scatter everywhere, and a KO cuts power so the arm slumps under real gravity. |
| P3 | Kill sound recipe (timing, full range, reward association) | Synthesized **KO stinger**: sub thump, servo ratchet figure, then a bell and coin shimmer, played in a ducked gap in the mix. |
| P4 | Dynamic crowd tied to metrics | A crowd "hype" value (0..1) driven by strike force, near-KOs, steals and the clock. |
| P5 | Two-voice commentary | **Rook** (hype, ex-pilot) and **Dr. Vale** (the stats lead). Original characters with a queued line system. |
| P6 | Stealable objective with carried-over progress | The **Core**: deposit it in your dock to start a lock-in countdown; the opponent can knock it loose and take the countdown. |
| P7 | High-risk double down | **Overclock**: bank a second Core for a round win, but fail and you lose a point. |
| P8 | Elimination spectacle | Power-cut limp, a spray of bright chips and bolts, a hologram "offline" tag. |
| P9 | MVP ignores the result | A "Best of Match" card with physical superlatives, shown to the loser too. |
| P10 | Fans pay for objective play | "Fans" XP that pays more for steals and deflects than for chip damage. |

---

## 3. Core mechanics these events depend on

These need the gameplay track to agree. Listed here because every feedback event triggers off them.

### 3.1 Integrity (health) from physics

- Each robot has **Integrity 100**. No HP bar floating over the opponent. Their state shows up
  in the world (sparks, flicker) and on a small broadcast-style scorebug.
- Only `kind === "strike"` contacts deal damage, and only to the robot that is **not**
  `attacker`. Current classifier: `force ≥ 0.65`, max contact-point speed ≥ 0.08 m/s,
  speed advantage ≥ 0.05 m/s (`src/lib/mujoco-engine.ts`).
- **[Spec] damage formula** (evaluated once per contact event, i.e. per `eventId`, using the peak
  within the event):
  ```
  e      = peakForce * attackerContactSpeed          // "hit energy", N·m/s
  raw    = 6 + 34 * smoothstep(E_LO, E_HI, e)         // 6..40
  mult   = zoneMult(link) * (counter ? 1.25 : 1)
  damage = round(min(raw * mult, 45))
  ```
  Calibrate `E_LO` and `E_HI` to the 20th and 95th percentile strike `e` from logged play, so a
  typical clean strike does about 15 and a perfect full-swing one does 35 to 40. **Aim for 3 to
  6 clean strikes per KO.** Our rounds are about 35 s, so time-to-kill has to be short.
- **Zones** (from `atlasLink` / `blazeLink`):

  | Zone | Links | Mult | Cue name |
  |---|---|---|---|
  | **Optics / head** ("crit") | gripper, moving jaw, wrist roll | ×1.5 | `CRIT` |
  | Forearm | wrist flex, lower arm | ×1.0 | normal |
  | Core | upper arm, shoulder | ×0.8 | normal |
  | Base | base, pan | ×0.5 | `ARMOR` (grey) |

  The gripper is where a camera would sit and where the "face" of an SO-101 reads, which makes
  it the natural headshot zone.
- **Counter** = a strike landed within 400 ms of the opponent's own strike attempt (a big
  end-effector speed spike) that did not connect.
- **Deflect** (parry) = a `block` contact where the defender's contact-point speed is higher than
  the attacker's while the attacker's end-effector speed is ≥ the strike threshold. It deals no
  damage and gives the attacker **Stagger**: 350 ms in which their Core pickup is disabled, plus
  a strong audiovisual cue. The skill expression is timing, not stats.
- **Physics integrity rule:** damage **never changes the MuJoCo model** in Harness mode.
  Arcade mode may *optionally* scale actuator `forcerange` down to 85% below 25 Integrity
  ("servo fatigue"). That stays off by default because it snowballs.

### 3.2 The Core (stealable objective)

- At **T−25 s** in each round, one glowing Core cube spawns at table center. (Reuse one of the
  9 cubes: a tinted emissive material plus a higher density so a hit sends it flying.)
- Each robot has a **Dock**, a floor pad on its own side. If the Core rests in your Dock
  (≥ 250 ms, speed < 0.05 m/s), a **Lock-in countdown of 8.0 s** starts, shown as a ring around
  the dock.
- If the Core leaves the Dock, the countdown **pauses and keeps its progress**. If the Core lands
  in the *opponent's* Dock, the opponent takes over the remaining time. **That's a Steal.**
- Lock-in reaching 0 = **Cash-in**, which wins the round outright.
- A KO wins the round immediately, even during a lock-in.

### 3.3 Match structure

| Phase | Duration | Notes |
|---|---|---|
| Intro | 6 s (skippable after 1.5 s) | See §6. Only before round 1. |
| Round start ("3-2-1-FIGHT") | 2.4 s | Arms held by position control, inputs buffered. |
| Round | 40 s max | Core spawns at T−25. |
| Round end | 2.5 s | Replay of the round-deciding moment (§5.6). |
| Between rounds | 3 s | Best Score card (§7.2), arms reset to home pose. |
| Sudden Death | up to 20 s | See below. |
| Outro | 8 s + post-match screen | §7. |

- **Best of 3** (first to 2 rounds). Typical match is 2 rounds × ~30 s plus transitions, about
  75 s. A full 3-round match with sudden death is about 150 s at worst. Typical 60 to 120 s.
- **Round timeout:** higher Integrity wins. If within 5 points, go to **Sudden Death**.
- **Sudden Death:** Integrity carries over. The table lights go red and the Core spawns
  **immediately** in the center with a **4 s** lock-in. The first strike of ≥ 20 raw damage,
  or a cash-in, wins. After 20 s with no result, the higher total strike energy for the round
  wins (no draws).
- **Round 3 = "Final Round"**: music changes and the Core spawns at T−30.

### 3.4 Comeback mechanics (Arcade only; all off in Harness)

| Mechanic | Trigger | Effect | Why |
|---|---|---|---|
| **Underdog Dock** | Down 0–1 in rounds | Your lock-in is 6.0 s (vs 8.0) | A trailing player has a faster route back, but still has to beat the opponent. |
| **Second Wind** | Integrity ≤ 20 for the first time in a round | +12 Integrity over 2 s, a sting, a "still standing" line. Once per match. | Creates "clutch" stories and ends losses that feel like a slow bleed. |
| **Overclock** (risk) | Put the Core into your Dock while you already won a cash-in this match | Lock-in 10 s. Success wins the **match**. A steal gives the opponent a round. | High-risk double down in the style of Double Jeopardy, with original rules. |
| **Steal bonus** | Any steal | The stealer's lock-in progress is shown as "+ bonus" and gets **1.0 s** off. | A steal should always feel like a payoff. |

No rubber-banding on damage. A comeback has to come from something the player *did*.

### 3.5 Harness mode (verifying policies)

- Symmetric rules, no Underdog, no Second Wind, **no time dilation**, fixed seeds for Core spawn
  jitter and cube layout, and a fixed physics dt. The policy is called on sim-time ticks, never
  wall-clock ticks.
- All visual juice (shake, flashes, numbers) is still allowed, since it's render-only. Sim
  slowdown is **not**.
- Match results are exported as JSON with the seed and a per-tick `qpos`/`ctrl` log, so a result
  can be replayed and audited.

---

## 4. Feedback system architecture

### 4.1 One event bus, many responders

```
MuJoCo step ──► ContactEvent (eventId, kind, attacker, force, speed, links, pos)
                     │
                     ▼
               CombatResolver ──► GameEvent {type, actor, target, magnitude 0..1, zone, pos, t}
                     │
     ┌───────────┬───┴──────┬────────────┬────────────┬───────────┐
     ▼           ▼          ▼            ▼            ▼           ▼
  HUD FX     Camera FX   World FX     SFX mixer   Announcer    Stats/Telemetry
 (markers,   (trauma,    (sparks,     (layers,    (priority    (post-match,
  numbers)    kick,FOV)   decals)      ducking)    queue)       fans)
```

- `magnitude` = normalized hit energy (`smoothstep(E_LO, E_HI, e)`). **Every responder scales
  from this one number**, so a light tap and a haymaker read differently on every channel at once.
- Deduplicate on `eventId`. The engine already increments it per new cross-contact. Fire the
  hit on the **frame of peak force** within the event, or 1 frame after onset for strikes, so
  feedback lands within 16 ms. Response latency matters more than polish.

### 4.2 Hit stop / time dilation

The sim can't freeze without breaking the policy harness, so:
- **Arcade:** scale the sim `timeScale` (sim steps per render frame) to **0.15 for 45–90 ms of
  wall time** (magnitude lerp), then ease back to 1.0 over 80 ms. Both arms slow equally, so it's
  fair. Human input is still sampled and applied on resume.
- **Harness:** render-only hit stop. Freeze *interpolation* of the victim's rendered pose for
  1–2 frames. The sim keeps running.

### 4.3 Camera (first person)

The camera is mounted on the player's arm (wrist or "head" cam) with a stabilized option. Uses
the Eiserloh trauma model:
- `trauma ∈ [0,1]`. Shake offset = `maxOffset * trauma² * noise(t*freq)`. Rotation is
  `maxAngle * trauma² * noise`. Trauma decays at **1.6/s**.
- `maxAngle` = 2.2° yaw/pitch, 1.2° roll. `maxOffset` = 6 mm. `freq` = 22 Hz. Keep it small:
  in first person, shake reads as nausea long before it reads as hype.
- **Directional kick:** on taking a hit, rotate the camera *away* from the contact normal by
  `1.5° + 3° * magnitude`. Recover with a critically damped spring (ω = 18 rad/s). Kick is more
  readable than shake, because it tells you which side you were hit from.
- **FOV punch:** +3° on landing a strike, then back over 180 ms. −4° (zoom in) during the KO
  slowdown.
- Accessibility: a "Camera motion" slider (0–100%) scales all of the above, and 0% turns off
  kick and FOV.

---

## 5. Feedback event catalog

Timing notation: `t0` is the trigger frame. Durations are wall-clock. "Mag" is `magnitude` 0..1.
SFX are **synthesized in `src/lib/arena-audio.mjs`** (Web Audio). No samples ripped from anything.

### 5.1 Combat events

| Event | Exact trigger | Visual (HUD + world) | Audio | Camera | Duration |
|---|---|---|---|---|---|
| **Hit (dealt)** | `strike`, attacker = player, damage > 0, zone ≠ Base | Hitmarker: 4 short diagonal ticks around the crosshair, white, scale 1.0→1.25→1.0, **grows with mag** (tick length 8→16 px). Damage number (§5.4). Sparks at `pos`: 8 + 40·mag particles, orange-white, life 250 ms. | "Tok" transient (1.8 kHz click + 120 Hz body), pitch +0–3 semitones by mag. Delay **0 ms**. | FOV +3° punch; hit stop per §4.2 | Marker 180 ms, sparks 250 ms |
| **Crit (dealt)** | Hit with zone = Optics | Marker ticks turn **signal yellow (#FFD400)** with a thin ring flash (radius 28 px, 120 ms). Number in yellow, 1.3× size, with a "CRIT" suffix. Small lens flash on the opponent's gripper. | Hit sound plus a **high "tink"** (3.2 kHz sine, 90 ms decay) offset **+40 ms**. The offset is what makes it read as a separate reward. | Same, hit stop +30 ms | Marker 260 ms |
| **Armor hit (dealt)** | Hit, zone = Base | Grey ticks, reduced opacity, number in grey | Dull "thud", no tink | None | 150 ms |
| **Counter (dealt)** | Hit flagged counter | Marker plus a "COUNTER" tag bar under the crosshair (condensed italic caps, slides in from left, 400 ms) | Hit sound plus a reversed whoosh into it | Hit stop +20 ms | 600 ms |
| **Hit taken** | `strike`, attacker = opponent | Directional damage arc on the screen edge toward the contact (red-orange #FF4D2E, alpha 0.2 + 0.5·mag). Brief chromatic aberration (0.6·mag px, 120 ms). Crack decal on the camera lens only when damage ≥ 30. | Low metallic crunch (filtered noise burst + 70 Hz) and a servo "yelp" (fast pitch drop) | Directional kick (§4.3), trauma += 0.25 + 0.45·mag | Arc 450 ms, lens crack 2 s fade |
| **Block** | `block` contact, no deflect | Small white impact ring at `pos` in world space. No HUD marker, which keeps the HUD meaningful. | Existing scrape/contact layers. Short "clang" if force > 1.2 | trauma += 0.08 | 150 ms |
| **Deflect** (dealt) | Deflect per §3.1 | **Cyan (#29E0FF)** chevron burst around crosshair, "DEFLECT" tag. Opponent arm gets a cyan rim flash. World slows to 0.3 for 120 ms (Arcade). | Bright two-note **rising** "ting-ting" (a perfect fifth), crowd "ohh" swell | Tiny inward zoom −2° FOV, no shake | 500 ms |
| **Deflected** (taken) | Opponent deflects you | Desaturate 30% for 350 ms (Stagger duration), "STAGGERED" tag | Descending two notes | Kick back 2.5° | 350 ms |
| **Combo** | ≥ 3 hits dealt with ≤ 1.2 s between each and no hit taken | Combo counter by the crosshair ("×3", "×4"...) that grows 8% each hit. Resets with a quick shrink-fade. | Hit tick pitch climbs a scale per combo step (C–D–E–G–A) | None beyond hits | Counter persists 1.2 s after last |
| **Low integrity (self)** | Integrity ≤ 25 | Vignette pulse (red, 0.9 Hz), intermittent sparks from your own shoulder in view | Heartbeat-like servo stutter loop at −18 dB, music low-pass 1.2 kHz | None | Until healed or KO |
| **Opponent critical** | Opponent Integrity ≤ 25 | Opponent arm emits smoke puffs and flickering LED. Scorebug bar blinks. | Crowd murmur rises | None | Until KO |
| **First Blood** | First damage in the match | "FIRST STRIKE" tag top-center | Announcer (§6) | None | 1.2 s |

### 5.2 KO ("Offline") sequence

| t (ms) | What happens |
|---|---|
| 0 | Lethal hit lands. Arcade: sim `timeScale` → **0.1**. Harness: render-only freeze. Crosshair marker becomes a **big X** (red-orange, 48 px) with a white core flash. |
| 0 | **KO stinger, part 1:** sub thump (45 Hz sine, 180 ms), heavy crunch. All other SFX ducked −9 dB, music ducked −12 dB. |
| 60 | Victim's actuators get **power cut** (`ctrl` gain → 0, i.e. set actuator kp to 0 in Arcade, or send limp targets in Harness). The arm **falls under real gravity**. This is our statue moment, and it's pure physics. |
| 60 | Burst of 60–120 small bright "chips" (yellow, cyan, white quads + bolts) from the hit point, with real physics-lite ballistic motion and bounces on the table. Our original take on the coin burst. |
| 150 | **KO stinger, part 2:** syncopated servo ratchet figure (3 clicks + 1 hold) → a **bell** (FM synth, inharmonic partials, 1.8 s tail) + coin shimmer (high noise sparkle). Bass and treble, mids left empty. |
| 150 | "OFFLINE" hologram tag above the victim's base (condensed italic caps, glitch-in 120 ms) |
| 300 | Crowd: roar peak. Announcer: KO line (P1). |
| 600 | `timeScale` eases back to 1.0 over 300 ms. |
| 900 | Camera starts a gentle 6° pull-back and lift (first person → over the shoulder). |
| 1500 | Round-end banner "ROUND TO YOU" / "ROUND TO {OPPONENT}" slams in (scale 1.4 → 1.0, 160 ms, overshoot). |
| 2500 | Hand off to Round Replay (§5.6). |

### 5.3 Objective events (Core)

| Event | Trigger | Visual | Audio | Camera | Duration |
|---|---|---|---|---|---|
| **Core incoming** | T−28 (3 s before spawn) | Table center ring lights up, 3 pulses | Rising synth riser (3 s), crowd anticipates | None | 3 s |
| **Core drop** | T−25 spawn | Core drops from a small ceiling port with a light beam. The HUD waypoint diamond appears. | Heavy "ka-chunk" landing | trauma += 0.1 | 800 ms |
| **Lock-in started** | Core settled in a Dock | Dock ring fills clockwise in the owner's color. Scorebug shows a countdown. World light beam in the owner's color. | Ticking pulse (1 Hz, faster at < 3 s: 2 Hz then 4 Hz) | None | Until end |
| **Contest** | Opponent end-effector within 8 cm of the Core while it's in your Dock | Ring edge flashes white, "CONTESTED" tag | Tick gets a dissonant second tone | None | While true |
| **Steal** | Core settles in the opponent's Dock after lock-in progress > 0 | Full-width **color wipe** across the scorebug from the old owner's color to the new one (220 ms). "STOLEN" tag centered, big. The dock ring flips color *keeping its fill*. | **Steal sting:** a cash-register-style "cha-" (noise burst + two high square blips) then the new owner's tone. Crowd **eruption** (it's the biggest crowd moment short of the match win). | trauma += 0.2 for the stealer (celebration shake) | 900 ms |
| **Last-second steal** | Steal with ≤ 2.0 s remaining | Same, plus 250 ms slowdown (Arcade), the "STOLEN" tag gets a gold outline, and it's added to the replay queue as top priority | Announcer P1 line | Same | 1.2 s |
| **Cash-in** | Lock-in reaches 0 | Dock erupts a column of light. Core shatters into chips. Banner "CASHED IN". | Bell stinger (like KO part 2 but major key, 2 bells) plus crowd roar | trauma 0.3 | 2.5 s → round end |
| **Overclock armed** | Overclock condition met | Dock ring goes **magenta**, "OVERCLOCK: MATCH POINT" banner | Low alarm pulse under the tick | None | Until resolved |

### 5.4 Damage numbers

- Spawn at the contact point in world space, projected to screen. Offset +16 px up plus a
  random ±10 px horizontal so a flurry stays readable.
- Font: **Barlow Condensed ExtraBold Italic** (Google Fonts, OFL). Size 22 px + 14·mag.
  Normal is white with a 2 px dark outline. Crits are yellow ×1.3 and Armor grey ×0.85.
- Motion: pop scale 0.6 → 1.15 → 1.0 over 120 ms, rise 24 px over 600 ms, fade from 400–700 ms.
- **Stacking:** hits within 500 ms on the same target *merge* into one number that ticks up
  (roll-up counter) instead of spawning a new one. That reads as more deliberate and less spammy.
- Setting: numbers On / Merged only / Off.

### 5.5 Round and match transitions

| Event | Visual | Audio | Duration |
|---|---|---|---|
| **Round start** | "ROUND 1" slab (full-width band, slightly skewed), then "3·2·1" big digits, then "FIGHT" in the accent color with a chromatic split | Three drum hits on beats (120 BPM), then a snare roll → crash on FIGHT. Music drops in on the downbeat. | 2.4 s |
| **Final Round** | Band text "FINAL ROUND" in gold, lights dim to spotlights | Music switches to the higher-intensity stem, crowd chant loop | 2.8 s |
| **30 s / 10 s left** | Scorebug timer turns amber (30), red and pulsing (10) | Soft tick at 10 s, louder per second at 5 s | continuous |
| **Sudden Death** | Table edge lights red, "SUDDEN DEATH" slab with a glitch | Music cuts to percussion only, heartbeat sub | 2.4 s intro |
| **Match point** | Pip on the scorebug glows | Announcer line | 1 s |

### 5.6 Replay (our kill cam)

- **Recording:** a ring buffer of the full sim state (`qpos`, `qvel`, `ctrl`, cube poses) at 60 Hz
  over the last **6 s**. That's about 2×6 joints + 9×7 cube pose + ctrl ≈ 90 floats per frame
  × 360 frames ≈ 32k floats. Negligible.
- **Playback:** set sim state per frame (no re-simulation needed), render from a **third-person
  orbit camera** that starts at 45° off the victim's side and orbits 30° over the clip.
- **Clip selection:** a priority-ranked "moment" (KO > last-second steal > cash-in > deflect
  that led to the round-deciding hit). Clip window: `t_event − 2.5 s` to `t_event + 0.8 s`.
- **Speed curve:** 1.0× until 400 ms before the event, ease to **0.25×** through the event, then
  0.6× after.
- **Overlay:** thin "REPLAY" tag top-left, a strike speed readout (e.g. "1.42 m/s · 3.1 N")
  that ticks up at the impact frame. That's the data commentator's moment.
- Skippable (any key). Auto-skip in Harness batch mode.
- Round replay 2.5 s. **Match replay** (the match-winning moment) 3.5 s, before the victory screen.

### 5.7 Frequency caps (don't overdo the juice)

- At most **one** full-screen banner at a time. Banners queue with a 250 ms gap and anything
  older than 1.5 s is dropped.
- Tags under the crosshair: at most **two** stacked, newest on top.
- Trauma is capped at 1.0. Taking hits while in hit stop doesn't restart the hit stop.
- Crowd reactions use a 700 ms refractory period per reaction type.

---

## 6. Broadcast: announcer, crowd, music

### 6.1 Cast (original)

- **ROOK**: hype play-by-play. Former arm-pilot, talks in clipped bursts, loves hardware. Pitch: loud, warm, a bit rough.
- **DR. VALE**: color commentary. Robotics researcher turned analyst. Quotes numbers (newtons,
  m/s, milliseconds), dry wit, is sometimes openly impressed.
- The arena show is called **CIRCUIT** (working title). The house league is the **Open Servo League**.
  Replace any name if it collides with an existing trademark after a search. None of these come
  from THE FINALS.

### 6.2 Voice production (local, free)

- **Recommended:** pre-render lines offline with **Piper TTS** (open source, runs locally) into
  small Opus/OGG files under `public/audio/vo/`. Check *each voice model's* license before
  shipping. Fallback: the Web Speech API (`speechSynthesis`) at runtime. Quality varies by OS.
- **Templated numbers:** only prerender the number words the data voice needs (common stats
  rounded: "one point four meters per second"). Or keep numeric lines on screen as text plus a
  generic spoken intro ("Look at that number.").
- Post-process in the mixer: a light "broadcast" chain (high-pass 150 Hz, presence +3 dB at 3 kHz,
  compression 4:1). Duck music −8 dB and crowd −5 dB while speaking (attack 40 ms, release 300 ms).

### 6.3 Line scheduler

```
priority P1 (interrupt):  KO, match win, last-second steal, cash-in, overclock result
priority P2 (queue):      steal, deflect, crit ≥ 30 dmg, second wind, round start/final round, sudden death
priority P3 (filler):     first strike, combo ≥ 4, core drop, low integrity, stalemate (no contact 6 s), stat callout
```

- **Global cooldown:** 3.5 s after any line finishes. P1 ignores it and **cuts** the current line
  with a 60 ms fade.
- **Staleness:** a queued line is dropped if not played within 1.2 s (P2) or 0.8 s (P3). Old
  commentary is worse than none.
- **Budget:** at most **6 lines per round**, P3 at most 2 per round. At normal intensity that's
  roughly one line every 6–8 s.
- **No repeats:** each event has 6–12 variants. Shuffle-bag without replacement. Never repeat a
  variant within the **last 20 lines spoken** (persisted in `localStorage`, so it carries across
  matches). This is the fix for "repetitive".
- **Two-voice handoff:** 30% of P2 events play a follow-up from the *other* voice 250 ms after
  the first finishes, but only if nothing else is queued.
- **Context flags** pick sub-pools: `playerIsWinning`, `isFinalRound`, `margin`, `timeLeft`,
  `opponentName`, `policyIsUserModel`.
- **Settings:** Commentary Full / Big moments only (P1 + P2) / Off. Separate volume slider.

### 6.4 Original line bank (examples)

All written for this project. Use `{opp}` for the opponent's display name and `{you}` for the player tag.

**Round start**
- ROOK: "Servos warm, table's clean. Let's make a mess."
- ROOK: "Two arms, one table, zero chill."
- VALE: "Both units calibrated. Both units about to regret it."
- ROOK (final round): "This is it. Last round, everything on the table. Literally."

**First strike**
- ROOK: "And the first real hit goes to {you}!"
- VALE: "First contact above strike threshold. We have a fight."

**Crit (optics hit)**
- ROOK: "Right in the optics!"
- ROOK: "Clean on the gripper. That one rattled something loose."
- VALE: "Direct hit on the sensor head. Calibration is having a bad day."

**Big hit (damage ≥ 30)**
- ROOK: "OH, that is a full-swing shoulder shot!"
- VALE: "That's {speed} meters per second at contact. Textbook."
- ROOK: "You could hear that one in the parking lot."

**Deflect**
- ROOK: "Turned away! Read it like a manual!"
- VALE: "Deflected with about {ms} milliseconds to spare. That's not luck."
- ROOK: "Nope! Not today, not on that angle."

**Combo ≥ 4**
- ROOK: "They're just teeing off now!"
- VALE: "Four unanswered strikes. {opp} needs a new plan, ideally before the next one."

**Stalemate (no arm contact for 6 s)**
- VALE: "Lots of hovering. The crowd paid for contact."
- ROOK: "Somebody commit! Anybody!"

**Core drop**
- ROOK: "Core's coming down, center table!"
- VALE: "Core is live. Eight seconds in a dock ends this round."

**Lock-in started**
- ROOK: "{you} docks it! Clock is running!"
- VALE: "Lock-in started. {opp} has eight seconds to do something drastic."

**Steal**
- ROOK: "STOLEN! Clean out of the dock!"
- ROOK: "Oh, they took it AND the clock!"
- VALE: "Ownership transferred. Progress retained. Ouch."

**Last-second steal (≤ 2 s)**
- ROOK: "WITH ONE SECOND LEFT! Are you KIDDING me!"
- VALE: "One point four seconds remaining. I'm going to be replaying that one all week."

**Cash-in**
- ROOK: "Locked in! That round is BANKED!"
- VALE: "Core secured. Integrity didn't matter. Position did."

**Second Wind**
- ROOK: "Still standing! Barely, but standing!"
- VALE: "Emergency reserve engaged. One of those per match. Spend it well."

**Overclock armed / result**
- ROOK: "They're overclocking! Match point on the line!"
- ROOK (success): "Overclock holds! GAME! OVER!"
- VALE (fail): "Overclock fails. That's how you hand over a round."

**Low integrity (player)**
- VALE: "{you} is running on fumes, under twenty-five percent."
- ROOK: "Sparks from the shoulder. That's never a good sign."

**KO**
- ROOK: "LIGHTS OUT! {opp} goes limp!"
- ROOK: "Offline! Power's cut, and so is the round!"
- VALE: "Integrity zero. The actuators have filed for early retirement."
- ROOK: "Down it goes! Gravity takes the rest!"

**Sudden death**
- ROOK: "Sudden death! Next clean hit takes it all!"
- VALE: "Tied up after forty seconds. Four-second lock-in. One mistake decides this."

**Match win (player)**
- ROOK: "{you} takes the match! Put it in the highlight reel!"
- VALE: "Final verdict: better timing, better angles, better result."

**Match loss (player)**
- ROOK: "{opp} takes it. Rematch energy is VERY high right now."
- VALE: "Close on the numbers. Closer than the scoreboard says."

**User model is the opponent** (`policyIsUserModel`)
- VALE: "Tonight's opponent was trained by one of you. Let's find out how well."
- ROOK (model wins): "The model takes it! Somebody's training run paid off!"
- VALE (model loses): "Policy defeated. I'd check the reward function."

### 6.5 Crowd system

- **Hype** h ∈ [0,1], a leaky integrator: `h += impulse; h -= 0.12 * dt` (idle decay), floor at
  0.15 during a round.
- Impulses: hit 0.04 + 0.1·mag, crit +0.12, deflect +0.15, steal +0.35, last-second steal +0.6,
  KO +0.7, cash-in +0.5, sudden death start set h = max(h, 0.6), stalemate 6 s −0.1.
- **Audio layers** (synthesized or procedurally built crowd beds; no recorded crowd from any
  game): murmur bed (always), cheer bed (gain = h²), reaction one-shots ("ohh", roar, groan)
  triggered by impulses ≥ 0.3. Groan when the *local player* suffers a steal or KO (so the crowd
  plays for the home side).
- **Visual:** holographic silhouettes on the backdrop scale their bob amplitude and density with h.
  Stage lights' flicker intensity = h.
- **Music:** 3 intensity stems crossfaded by h (low < 0.35 < mid < 0.7 < high). Final round
  forces a minimum of mid. Music ducks per §6.2 and for the KO sequence.

---

## 7. Intro, outro and post-match

### 7.1 Match intro (6 s, skip after 1.5 s)

| t | Beat |
|---|---|
| 0.0 | Black → hard cut to wide shot of the lab, spotlights sweep. Low riser. |
| 0.8 | Opponent side: arm powers on joint by joint (a quick servo sequence from base to gripper, each joint twitching into its home pose with LED ticks). Nameplate slams in: `{opp}` + policy tag (e.g. "SCRIPTED · BLAZE" or "USER MODEL · policy.json v3") + record (W–L). |
| 2.6 | Opponent **intro pose**: a short keyframed joint trajectory (1.2 s) played through the real PD controller, so it's physically real (e.g. gripper "snap snap", wrist roll flourish). |
| 3.2 | Whip-pan to the player side. Same power-on sequence, player nameplate + equipped title. |
| 4.8 | Player's selected pose plays; camera flies *into* the first-person mount. |
| 6.0 | "ROUND 1" slab. |

Poses are **cosmetic joint trajectories**, which makes them cheap to author, unlockable, and
safe (clamped to joint limits, low speed).

### 7.2 Between-round "Best Score" card (3 s)

Three tiles, each showing a winner avatar and a number, for *that round*:
- **HARDEST HIT**: peak damage (plus force in N)
- **FASTEST STRIKE**: contact-point speed (m/s)
- **OBJECTIVE**: Core time held (s) or steals

### 7.3 Outro (8 s)

| t | Beat |
|---|---|
| 0.0 | Match replay (3.5 s, §5.6) |
| 3.5 | Cut to the winner's side: winner arm plays its **victory emote** (physical trajectory). Loser arm stays limp or does a "defeat" slump. Confetti chips fall on the table (they collide with cubes, which is a nice touch). |
| 4.0 | "VICTORY" / "DEFEAT" wordmark. Winner's nameplate grows, the loser's shrinks and greys. |
| 5.5 | Crowd peak, final announcer line. |
| 8.0 | Post-match screen slides up. |

### 7.4 Post-match screen

Layout: a left column with the result, score pips and the **Best of Match** card; the right side
has tabs Stats / Timeline / Model report. Primary button **REMATCH** gets focus by default
(Enter/Space), secondary is "Swap opponent". **The rematch button has to be under the cursor or
the Enter key.** Friction here is where the "one more match" pull dies.

**Best of Match superlatives** (pick the 3 most extreme versus the player's history, so they feel personal):

| Stat | Definition | Why it's bragworthy |
|---|---|---|
| Hardest hit | max `damage` (and peak force N) | Classic highlight |
| Fastest strike | max attacker contact-point speed at a strike, m/s | Real physical number, feels "true" |
| Quickest reflex | min time from opponent strike start (EE speed spike) to your deflect/block contact, ms | Skill proof |
| Deflects | count | Defensive mastery |
| Crit rate | optics hits / hits | Precision |
| Longest combo | max consecutive hits | Aggression |
| Steals / Clutch steals | steals, and steals with ≤ 2 s | The TV moment |
| Clutch round | won a round while ≤ 15 Integrity | Story |
| Time to first strike | s from FIGHT to first damage | Aggression |
| Damage dealt / taken | totals | Baseline |
| Energy efficiency | damage dealt per joule of actuator work | Unique to robots. Nerd flex. |
| Cubes launched | cubes displaced > 10 cm by your arm | Chaos stat (the brutality pillar) |

- **Personal best** badges ("NEW PB") when a stat beats the local record in `localStorage`.
- **Timeline tab:** a horizontal match strip with integrity lines for both robots, event icons
  (hit, crit, deflect, steal, KO), and a click to jump into a replay of that moment (if still in
  the buffer, else just the stat).
- **Model report tab** (for policy verification): policy name/hash, seed, avg inference ms, action
  jerk (rad/s³ RMS), % ticks at torque limit, joint-limit hits, contact count, a win/loss vs
  baseline scripted opponents, and **Export run (JSON)**. This is where "fun game" meets
  "verification harness".

### 7.5 Progression and cosmetics hooks (local-only, no services)

- **Fans** (XP), stored in `localStorage`, with objective play paid most, mirroring the
  principle rather than the numbers: KO 40, round win 30, steal 35, clutch steal 60, deflect 10,
  cash-in 40, crit 5, match win 80, match played 20 (loss still pays).
- **Tracks:** 3 original "workshop" tracks of 15 levels each (e.g. *Chrome & Chalk*, *Hazard Tape*,
  *Neon Lab*). Each level unlocks one of: arm paint/decal set, gripper-tip shape (visual only),
  intro pose, victory emote, nameplate frame, title ("Deflect Artist", "Core Thief"), KO chip color.
- **Early levels fast** (level 1–3 in the first 2–3 matches), slower after. The first session
  should hit an unlock within ~5 minutes.
- **Daily challenge** (seeded by date, local): e.g. "Win a round by cash-in", "Land 3 crits in one
  match", "Deflect a strike faster than 150 ms". Pays bonus fans. Cheap and it gives a reason to
  come back tomorrow.
- **Gauntlet ladder:** a sequence of opponents (scripted bots with names and personalities, then the
  user's uploaded models) with a visible bracket. Beating a rung unlocks the next. The bracket
  view uses the broadcast styling.
- Cosmetics must **never** change collision geometry, mass or actuators.

---

## 8. Why it's addictive, and the rules we derive from that

1. **Variable, escalating reward cues** (the bell/register association, crowd hype). Rule: every
   reward sound has a distinct pitch and timbre per tier (hit < crit < deflect < steal < KO),
   so players learn the ladder by ear.
2. **Nobody's out until the buzzer** (steals keep progress). Rule: the Core always spawns before
   the end of a round, and no round can be decided before T−25 except by KO.
3. **Short loop, low cost to retry.** Rule: match ≤ 2 min, REMATCH is one keypress, and
   rematch-to-FIGHT takes ≤ 4 s (skip the intro on rematch, show the nameplates only).
4. **Recognition for losers** (MVP ignores the result). Rule: the post-match screen always leads
   with the player's best superlative, even in defeat.
5. **Stories, not stats.** Rule: every match yields one replayed "moment" and one commentator line
   about a real number from *that* match.
6. **Readable chaos** (sounds that tell you what's happening). Rule: every threat has its own audio
   signature. Opponent windup (large EE acceleration toward you) plays a short rising servo whine
   ~150 ms before contact is possible. That gives humans a fair read on AI strikes and makes
   Deflect learnable.

---

## 9. Implementation notes for this repo

- **Events:** extend `PhysicsSnapshot.collision` consumers with a `CombatResolver` in
  `src/lib/` (pure `.mjs`, unit-testable like `arena-audio.mjs`) that emits `GameEvent`s. Tests:
  damage formula, zone mapping, deflect detection, steal state machine, announcer scheduler
  (cooldowns, staleness, no repeats).
- **Audio:** add synth voices to `ArenaAudio`: `hitTick(mag)`, `critTink()`, `deflectTing()`,
  `stealSting()`, `koStinger(stage)`, `bell()`, a crowd bed with a `setHype(h)` bus, and a
  voice-over bus with ducking via `DynamicsCompressor` sidechain emulation (gain automation).
- **Time dilation:** implement as sim-steps-per-frame scaling in the engine loop, gated by
  `mode !== "harness"`.
- **HUD:** DOM/CSS overlay (Tailwind) above the R3F canvas for markers, numbers and banners.
  Use CSS transforms only (GPU composited). World-space FX (sparks, chips, decals) go in R3F with
  instanced meshes, with a fixed pool of 256 particles.
- **Replay:** a ring buffer in the engine wrapper, and a `setState(frame)` path that writes
  `qpos`/`qvel` and calls `mj_forward` without stepping.
- **Fonts (Google Fonts, OFL):** *Barlow Condensed* (numbers, tags, banners), *Inter* or
  *Manrope* (body/UI). Heavy condensed italic caps with skewed slabs get the broadcast-package
  look without borrowing anyone's type.
- **Telemetry for tuning:** log every strike's `e`, damage, zone, and each round's length and
  winner cause (KO / cash-in / timeout / sudden death). Tuning targets: median round 25–35 s,
  KO:cash-in ratio about 60:40, sudden death in < 15% of matches, steals in ≥ 30% of rounds that
  reach a lock-in.

---

## 10. Source list

- The Finals (Wikipedia): https://en.wikipedia.org/wiki/The_Finals
- Meet the Makers: Direction and Design: https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design
- Meet the Makers: Audio: https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
- Making The Finals dev diary E01 (sound): https://mp1st.com/news/the-finals-making-the-finals-dev-diary-e01-explores-sound-design
- Embark on TTS commentators (Game Developer): https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals
- Commentators overview: https://www.thefinals.wiki/wiki/Scotty_and_June · https://the-finals.fandom.com/wiki/June
- Cashout rules: https://www.thefinals.wiki/wiki/Cashout
- Head2Head rules: https://www.thefinals.wiki/wiki/Head2Head
- Terminal Attack rules: https://www.thefinals.wiki/wiki/Terminal_Attack
- Revive statue / elimination: https://www.thefinals.wiki/wiki/Revive_Statue
- MVP screen: https://id.embark.games/the-finals/support/faq/216-mvp-screen
- Season 10 patch notes (match recap, Best Score): https://www.reachthefinals.com/patchnotes/10-00
- Sponsorship / fans progression: https://www.thefinals.wiki/wiki/Sponsorships
- Emotes: https://the-finals.fandom.com/wiki/Emotes
- Embark interview (influences, destruction): https://mp1st.com/news/the-finals-interview-embark-talks-balancing-destruction-and-more
- Digital Trends preview: https://www.digitaltrends.com/gaming/the-finals-preview-destruction-will-make-developers-panic/
- MMORPG.com preview: https://www.mmorpg.com/previews/the-finals-the-final-preview-2000129720
- Reviews: https://www.ggrecon.com/reviews/the-finals-review/ · https://www.videogamer.com/reviews/the-finals-review/ · https://gamingtrend.com/reviews/the-finals-review-the-ultimate-fps-gameshow/
- Vlambeer, The Art of Screenshake (summary): https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/
- Eiserloh, Juicing Your Cameras With Math (GDC 2016): https://www.gdcvault.com/play/1023557/Math-for-Game-Programmers-Juicing
