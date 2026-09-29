# Sound and music as emotion

> Research track for the "it has no emotion" verdict. Scope: how audio carries feeling and impact, and how
> to synthesize all of it in WebAudio with no audio files. Every claim tagged **[Sourced]** has a URL;
> everything tagged **[Proposal]** is ours and is written so it can be built and tested against
> `OfflineAudioContext` renders. Nothing here uses THE FINALS' sounds, names or lines (SCOPE 1).

## 0. TL;DR

1. **Emotion in game audio is contrast, not volume.** Every big moment in the references (BF1 kill, THE FINALS
   elimination, Hades boss, DOOM glory) is preceded by a hole and followed by a continuation. Our code has the
   hole *after* the KO (the `ko` duck) but nothing *before* it and nothing in the room afterwards. The fix is a
   **near-KO state** that thins the mix 1.5 to 3 s before a likely KO, and a **crowd continuation** that
   takes over after the confirm.
2. **The arms are silent between inputs, so they read as dead.** A robot arm holding position is not silent:
   it hums, ticks, and corrects. Add an always-on **servo life layer** (PWM buzz + hold-jitter ticks +
   a strain growl when torque-saturated) driven by joint velocity and PD error, for both arms. Cost: 6 to
   10 voices, all cheap.
3. **Hits must scale and vary or they are a click.** One recipe, three layers (transient / body / sub), with
   body frequency and sub gain mapped to contact impulse, and pitch randomised ±3 to ±5 % per hit. Add a
   fourth, rare layer (the **"ping"** tier: a sharp rising high tone) only for hits above a damage threshold, so
   the ear learns the hierarchy in the first minute.
4. **Schedule hits on the audio clock, not the frame.** Physics knows the contact step; the audio onset must be
   placed at `ctx.currentTime + (contactSimTime − simNow) + baseLatency`, never in the next rAF. A 100 ms
   lookahead with a 25 ms tick is the standard pattern and we already use it for music; use it for SFX too.
5. **The kill confirm recipe is already right; its surroundings are wrong.** Embark's three rules (own time slot,
   sub + treble with empty mids, association with reward machines) are implemented in `kill-confirm.ts`. What
   is missing is the KO *approach* (music low-pass + drum drop + crowd hush) and the *release* (crowd roar
   swelling in over 0.4 to 0.8 s, host line 300 ms after the bell, not before).
6. **Music: keep 104 BPM, add two things.** (a) Drums gate on "in exchange" (both arms within strike range),
   off otherwise, the Hades rule; (b) a Final Round / Sudden Death arrangement that is *fewer* notes and more
   drums, not more notes. Transitions stay bar-quantised. Stingers land on the next 8th, never mid-beat.
7. **Announcer = a ramp, then a release.** Sports announcers climb pitch, rate and loudness over 2 to 4 phrases
   and hit ~400 Hz at the climax, then slow down and stretch vowels on the payoff. Captions can carry this with
   size, weight, letter-spacing and reveal speed; Web Speech API carries it with `pitch` and `rate`. Lines are
   assembled from chunks (event + subject + colour), 10 to 20 variants for common events, one narrative
   thread per round.
8. **Crowd is a state machine with decay, plus anticipation.** Nine states in the reference design (idle,
   excited 1 to 3, upset 1 to 3, panicked 1 to 2) with 3 to 10 s decay presets. The single most human thing a
   crowd does is *rise before* the moment: the murmur climbs during a charge windup and when lock-in < 3 s,
   and holds breath on a near-KO. All of it is filtered noise, formant vowels and Poisson clicks.
9. **Mix by priority, not by bus gain.** Frostbite's HDR audio idea: one loudness window, the loudest sound
   sets it, quieter sounds below the window are culled. A WebAudio-lite version: every one-shot declares a
   priority; when a priority ≥ 8 sound plays, buses below it duck by a fixed dB with 20 ms attack.
10. **The arc of a round has seven beats** (pre-round, first contact, momentum, Core drama, near-KO, KO,
    post-match). Section 10 gives each one a music state, crowd state, host role, duck, and SFX rule with
    numbers. Building the arc is the work; individual sounds are mostly done.

## 1. Where the code is now

Existing (`src/game/audio/`): a bus graph (sfx, lead, ui, voice, music, crowd → master → compressor → ceiling),
five duck shapes (`speech`, `ko`, `lock`, `match_end`, `replay`), a 104 BPM D Dorian score with six gain layers
crossfaded on bar boundaries, a 100 ms / 25 ms lookahead scheduler, a hype model, a crowd with murmur, cheer,
applause and three shouts (ohh, roar, groan), a kill confirm with sub / ratchet / bell / gap / answer, and
`rollSfxParams` for per-hit randomisation. That is a solid instrument. It is not yet a performance.

What it lacks, as heard:

| Symptom the owner named | Audio cause |
|---|---|
| "nothing moves unless the player moves" | No idle layer for either arm. Silence between inputs reads as off. |
| "the opponent feels like a script" | The AI's motion is silent until contact. Its intent has no sound (no windup whine, no hold jitter). |
| "hits do not feel like anything" | Hits are not scaled by impulse, not placed on the audio clock, and nothing in the room answers them. |
| "the first minute is confusing" | No audio hierarchy: a jab and a crit sound like variations of one thing. No ramp into the round. |
| "no reason to play again" | No arc: the KO is the only shaped moment. No near-KO tension, no comeback sound, no post-match tag. |

## 2. Why sound is the emotion channel (three laws)

- **Law 1: Contrast.** The perceived size of a sound is its distance from what came before it. Frostbite's
  HDR audio spans "the quietest sound noticeable to the pain threshold, some 130 dB" by *culling* what is below
  a moving loudness window rather than compressing; "make loud sounds sound loud" is the stated goal.
  **[Sourced]** https://www.slideshare.net/slideshow/adaptive-mixing-in-frostbite/3128152 . Rocket League
  adopted the same scheme to make the goal, siren and crowd win the moment. **[Sourced]**
  https://www.rocketleague.com/en/news/under-the-hood--an-inside-look-at-hdr-audio-coming-to-rocket-league .
  Silence is the strongest contrast: "moments of intense anticipation are never filled with pure silence;
  instead a person is hypersensitive to every sound." **[Sourced]**
  https://www.wayline.io/blog/power-of-silence-game-audio .
- **Law 2: Timing.** The kill sound in THE FINALS is "separat[ed] in time" from gunshots and grenades so it has
  "room to grow and peak." **[Sourced]** https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio . In our
  case the analogue is: the confirm never overlaps the hit transient that caused it, and the host never talks
  over the bell.
- **Law 3: Association.** Reward sounds borrow from things people already find rewarding. Embark used "slot
  machines, pinball, cash registers" and an actual reception bell; the Battlefield 1 kill sound was the explicit
  template. **[Sourced]** same wiki page. Audio feedback is a reinforcement loop: an action followed by a
  pleasing sound strengthens the behaviour. **[Sourced]**
  https://speequalgames.com/the-human-psychology-behind-game-auido-feedback/ . For a robot arm show, the
  reward vocabulary is bells, coin shimmer, relay clacks, and a crowd that reacts *to you*.

Two second-order rules that follow: (a) **rarity preserves meaning**: Smash's "ping" only plays on the most
powerful hits, and when Brawl replaced some pings with realistic sounds "the remaining pings [became] even more
notable." **[Sourced]** https://www.ssbwiki.com/Ping . (b) **scaling is honesty**: NetherRealm makes "the size
and shape of the impacts correspond well to the amount of damage a character takes, as well as the visual
reaction." **[Sourced]** https://www.asoundeffect.com/mortal-kombat-1-game-audio/ .

## 3. Impact: the hit as an object

### 3.1 Layer model [Sourced, then Proposal]

Industry practice is three to four layers per impact: transient (crack), body (weight), tail (room), with one
layer owning the sub and the others high-passed so they do not fight. **[Sourced]**
https://sfxengine.com/blog/impact-sound-effect , https://morphic.com/resources/how-to/how-to-layer-sound-effects .
Per-play pitch and volume randomisation is standard because identical real impacts never sound identical.
**[Sourced]** https://dl.acm.org/doi/fullHtml/10.1145/3616195.3616221 ,
https://krotos.studio/blog/sound-effects-for-games .

Our impact object, per contact event (proposal; all synth, all one graph):

| Layer | Node recipe | Parameter ↔ physics | Range |
|---|---|---|---|
| **Transient** | 2 to 4 ms white-noise burst → highpass 2.5 to 5 kHz → gain env (attack 0.5 ms, decay 6 to 12 ms) | Highpass cutoff falls with mass: gripper tip 4.5 kHz, forearm link 3.2 kHz, table 2.4 kHz | gain 0.3 to 0.9 |
| **Body** | Triangle or sine, `f0` exp-glides down 35 to 50 % over 40 to 90 ms; lowpass 1.2 to 2.5 kHz | `f0` = 180 to 420 Hz for metal-on-metal, 90 to 160 Hz for the table; **decay** grows with impulse: 60 ms (raw < 8) to 220 ms (raw ≥ 25) | gain 0.5 to 1.0 |
| **Sub** | Sine 70 → 38 Hz over 60 to 120 ms (the dev.to kick shape: 150 → 48 Hz in 50 ms, 450 ms decay, scaled down) **[Sourced]** https://dev.to/sendotltd/sample-free-drum-synthesis-in-web-audio-building-kick-snare-and-hi-hat-from-oscillators-in-60-2c0k | Sub gain = `clamp((raw − 6) / 24, 0, 1)`; below raw 6 there is **no** sub, so jabs read light | gain 0 to 0.8 |
| **Ring (tail)** | FM bell, carrier 600 to 1400 Hz, ratio 2.76 to 3.5 (inharmonic), index 0.6 to 1.4, decay 120 to 600 ms | Only for metal contact. Decay ∝ impulse. Damped (decay ÷ 3) if the struck link is still in contact 30 ms later (a held press, not a strike) | gain 0.1 to 0.35 |
| **Servo shock** | 3 relay clicks at 0, 18, 33 ms, each a 3 ms noise burst through a bandpass 900 to 1800 Hz | Plays on the *struck* arm; louder when that arm was torque-saturated at contact (it "lost the argument") | gain 0.1 to 0.3 |

Randomise per hit: body `f0` ±4 % (±0.7 st), transient highpass ±10 %, all gains ±1.5 dB, sub glide time
±15 %. Never randomise the sub's *end* frequency (38 Hz) or the timing offsets: the ear reads consistency there
as "the same object", and variety elsewhere as "alive".

### 3.2 Hierarchy the ear can learn in one minute [Proposal]

MK1 keys its impact families by category (face = squish, body = crunch, blade = sharp). **[Sourced]**
https://www.asoundeffect.com/mortal-kombat-1-game-audio/ . Ours are keyed by *outcome*, because outcome is what
the new player needs to learn:

| Outcome | Extra on top of the impact object | Timing offset |
|---|---|---|
| Jab (raw < 8) | Nothing. Transient + small body. | 0 |
| Solid (8 to 20) | Sub on, body decay longer. | 0 |
| Heavy (≥ 20) | Ring tail on, servo shock on the victim. | 0 |
| Crit (Optics zone) | **"Tink"**: 3.2 kHz sine, 90 ms decay (already specified in finals-feel 5.1) | **+40 ms** after the impact |
| **Ping tier** (raw ≥ 28 or a counter with raw ≥ 16) | A rising sine 1.8 → 3.6 kHz over 70 ms, then a 400 ms bell tail; the Smash rule, reserved | **+30 ms** |
| Block | Transient only, body replaced by a short damped ring (decay 40 ms), plus a 160 Hz "thud" at gain 0.3 | 0 |
| Deflect / clash | Two rings, one per arm, detuned by 30 to 60 cents, 250 ms; a small noise "shhk" swept 6 → 2 kHz | 0 |
| Late guard | The block sound with a 2-note upward ticks pair (C6, E6, 40 ms apart) 80 ms later: "you got some back" | +80 ms |
| Hit **received** | Same object, but: body lowpassed to 900 Hz, sub +2 dB, and a 120 ms **camera-side** low rumble (noise 40 to 120 Hz) | 0 |

The offsets are the point. THE FINALS separates the kill sound in time; we separate the *reward* layer in time
from the *impact* layer on every hit above jab, so the ear parses "hit, then reward" as two things.

### 3.3 Put it on the audio clock [Sourced + Proposal]

WebAudio timing pattern: a timer wakes every 25 ms and schedules everything due in the next 100 ms against
`AudioContext.currentTime`; `setTimeout`/rAF alone jitter with layout and GC. **[Sourced]**
https://web.dev/articles/audio-scheduling . Physics is deterministic per step, so a contact at sim step `k`
maps to a wall time; schedule the transient at `ctx.currentTime + max(0, tContact − tNow) + ctx.baseLatency`.
If that lands in the past (a frame hitch), play immediately but *skip the transient layer* (a late crack reads
worse than a late thud). Log onset error; the `onsetLog` already exists in `feedback-audio.ts`. Target: median
onset error < 8 ms, 95th percentile < 20 ms.

## 4. The kill confirm, and the hole around it

### 4.1 The recipe is done

Embark's three rules (timing slot, bass + treble with empty mids, reward association; BF1 as the template)
**[Sourced]** https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio . Battlefield itself accents
headshots with bass-drum hits (two for a Scout headshot) and uses a ringing tone on kills. **[Sourced]**
https://battlefield.fandom.com/wiki/Hit_marker . `kill-confirm.ts` has sub thump → ratchet → bell → gap →
answer, mixed to −0.5 dB into a ducked hole. Keep it.

### 4.2 What is missing: the approach [Proposal]

The confirm is a payoff. A payoff without a setup is a noise. Add a **near-KO state** that arms when either
seat's Integrity ≤ 20 (or ≤ 1 reference hook, 30 ± 3), and whose intensity `u ∈ [0,1]` = `1 − integrity/20`:

| Element | Change while near-KO | Ramp |
|---|---|---|
| Music | Drums layer gain × (1 − 0.7u); `musicTone` lowpass from 12 kHz down to 1.2 kHz at u = 1; bass layer stays | one bar |
| Crowd | Murmur → "held breath": cheer bed −10 dB, murmur brightness up, a slow 0.25 Hz swell of ±3 dB | 1.5 s |
| Victim arm (if it is you) | Heartbeat-like servo stutter loop (finals-feel 5.1) at −18 dB, 0.9 Hz; the vignette pulse is its visual twin | 0.5 s |
| Victim arm (if it is the AI) | Its servo life layer gets a **brownout flicker**: PWM buzz drops out for 30 to 60 ms at random 0.6 to 1.4 s intervals, each with a relay click | immediate |
| SFX | Nothing ducked yet. Hits still hit. | |

This is the "calm before the storm" that reference audio directors describe; silence "used sparingly, reserved
for moments of peak tension." **[Sourced]** https://www.wayline.io/blog/strategic-silence-game-immersion . It
also fixes the "no reason to play again" symptom indirectly: the last 20 Integrity points now *sound* like a
different game, on both sides of the table.

### 4.3 The release [Proposal]

After the confirm's answer bell (t + 470 ms), the room must take over or the moment dies in air:

- t + 0.40 s: crowd `roar` swells in over 0.6 s (not a stab), peaks at t + 1.2 s, holds 2.5 s, decays over 4 s.
- t + 0.65 s: host line (ROOK) starts. Never earlier: the bell owns 235 to 650 ms.
- t + 1.35 s: `ko` duck releases (already 1200 ms hold + 400 ms release; aligned).
- t + 1.8 s: music re-enters on the next bar boundary with the **victory tag** (2 bars) or, on a player loss, a
  **defeat tag** (drums out, bass only, one descending stab).

## 5. Silence, ducking, and priority

### 5.1 Ducks we have and ducks we need

Current: `speech` (music −8, crowd −5), `ko` (music −12, sfx −6, crowd −4, hold 1.2 s), `lock` (music −8,
crowd −2, hold 0.9 s), `match_end`, `replay`. Add:

| Duck | Amounts | Attack / release / hold | Trigger |
|---|---|---|---|
| `heavy_hit` | music −4, crowd −2 | 15 ms / 250 ms / 120 ms | any hit with raw ≥ 20 (sidechain-by-event, the Trackspacer idea: duck the bed under the impact so the impact stays "beefy and punchy on top of a loud and dense soundscape") **[Sourced]** https://tombennettaudio.com/blog/2021/4/3/doom-eternal-archville-glory-kill-sound-re-design |
| `near_ko` | see 4.2 | 1 bar | Integrity ≤ 20 |
| `steal` | music −6, crowd −3, sfx −2 | 20 ms / 300 ms / 500 ms | Core pried from a dock |
| `windup` | crowd −3 | 200 ms / 400 ms / until release | a charge held ≥ 250 ms (either arm); the room leans in |
| `last_3s` | music −5 (drums layer only) | one beat / one beat | lock-in < 3 s: strip the bed so the tick and the crowd own it |

Rule: **no two hold-type ducks stack deeper than −14 dB on music**; take the max, not the sum.

### 5.2 HDR-lite [Proposal, from Sourced principle]

Frostbite's HDR sets priority by loudness and culls sounds under the window; "priority is set according to
loudness, loudness is a good approximation for importance especially in FPS." **[Sourced]**
https://www.slideshare.net/slideshow/adaptive-mixing-in-frostbite/3128152 . WebAudio has no per-voice
metering worth the CPU, so use declared priorities:

```
priority 10  kill confirm, lock stinger
priority  9  ping-tier hit, steal
priority  8  heavy hit, crit tink, host line start
priority  6  solid hit, block, deflect
priority  4  jab, servo shock, lock tick
priority  2  servo life, crowd bed, music
priority  1  UI
```

When a voice of priority `p ≥ 8` starts, every bus whose contents are ≤ `p − 4` ducks by −(p − 4) dB with a
20 ms attack and 200 ms release; voices ≤ `p − 6` that would start within the next 80 ms are dropped
(`MAX_VOICES` 24 stays as the hard cap). The effect: jabs vanish under a confirm, servo life vanishes under a
heavy hit, and the loud things get their window.

## 6. Arms with life: the servo layer

The design already asks for "servo whine tied to joint velocity" (SCOPE 3). What is missing is *rest* sound
and *intent* sound. "Machines read as machines because their movements stop rather than fade, so a servo that
finishes on a click ... will sound built, while a general electronic tone will sound like a synthesiser."
**[Sourced]** https://morphic.com/resources/sounds/robot-sound-effects . Hobby servos are PWM-driven at a
20 ms period (50 Hz) **[Sourced]** https://arxiv.org/pdf/2303.09645 , which is exactly the buzz you hear from a
held SO-101.

### 6.1 Per-arm servo life (always on, both arms) [Proposal]

| Sub-layer | Recipe | Driven by | Level |
|---|---|---|---|
| **Hold buzz** | Sawtooth 50 Hz (PWM rate) × AM by a square at 50 Hz with duty 8 to 12 %, → bandpass 1.2 kHz Q 2, → lowpass 3 kHz | Always on when powered. Gain rises with |PD error|: at 0 error −38 dB, at torque saturation −26 dB (the servo is *working* to hold) | −38 to −26 dB |
| **Hold jitter** | Random 2 ms clicks (noise → bandpass 1.5 to 2.5 kHz), Poisson rate 0.5 to 3 /s | Rate ∝ |PD error| and gravity load; near zero when the arm is slack. This is the "twitch" that reads as alive. | −30 dB |
| **Whine** | Sine `f = 600 + 2400·v/vmax` Hz plus 2nd harmonic at −9 dB, → highpass 400 Hz | `v` = max joint speed. Attack 15 ms, release 80 ms. Pitch follows velocity *within* a swing, so a flick chirps and a charge sings | −30 to −14 dB |
| **Gear chatter** | Noise bursts 1.5 ms at rate `40 + 360·v/vmax` /s through bandpass 2.8 kHz Q 4 | velocity; adds grain so the whine is not a synth | −34 to −22 dB |
| **Strain growl** | Sine 55 Hz AM by 11 Hz (depth 0.6) → lowpass 200 Hz | Torque-saturated *and* velocity < 0.15 vmax (pushing and not moving: a clash, a press, a pin) | −28 to −18 dB |
| **Stop click** | 4 ms click (noise → bandpass 1.1 kHz) + 25 ms damped body 220 Hz | fires when a joint's |v| crosses from > 0.2 vmax to < 0.05 vmax within 60 ms (a servo brake, not a fade) | −20 dB, ±2 dB |
| **Heat** | Whine 2nd harmonic rises to −3 dB and a 4 kHz hiss fades in | H ≥ 70 (GAME_DESIGN 4.5): "a recorded rising whine" becomes synthesized | up to −24 dB |

Opponent arm: same graph, panned by its position in the FPS view (constant-power pan from world azimuth),
−4 dB relative to yours, and its **whine leads its motion by the servo lag**: drive the opponent's whine from
its *commanded* velocity (ctrl delta) rather than its physical velocity. That 40 to 80 ms lead is the AI's
"tell", and it is honest: the servo really does start whining before the link moves. This is the single
cheapest cure for "the opponent feels like a script": you hear it *decide*.

### 6.2 Power-on and brownout [Proposal]

- **Power-on (match intro, 800 ms mark):** per joint, base to gripper, 120 ms apart: a relay click, a 90 ms
  whine chirp 400 → 1400 Hz, then the hold buzz fades in for that joint. Six joints = 720 ms of a machine
  waking up. Player arm first, then opponent, 400 ms later.
- **KO brownout:** t + 0: heavy contact object (3.1) at full; t + 150: relay clicks per joint at 40 ms gaps
  (already `KO_RELAY_START_MS`/`KO_RELAY_GAP_MS`); each click kills that joint's hold buzz; t + 400 to 1400: a
  falling whine 900 → 120 Hz as the arm slumps under real gravity, tracked to actual joint velocity so it
  matches the physics; a final stop click when the slump settles. Then that arm is *silent* for the rest of the
  round, which is the loudest thing on the table.

## 7. Music that follows the fight

### 7.1 What the references do [Sourced]

- **DOOM (2016):** five intensity states (ambient, light, medium, heavy, boss) built from stems at 120 to
  140 BPM in fixed keys so they "stitch" in real time; the engine reads enemy proximity, player aggression,
  weapon and damage taken. **[Sourced]** https://ensigame.com/articles/gaming/secrets-of-dooms-music-mick-gordons-adaptive-soundtrack-and-its-impact-on-gameplay-2
  (the GDC talk itself: https://www.gdcvault.com/play/1024068/-DOOM-Behind-the ; the "40 % increase in
  emotional response" figure on that page is not attributed and we do not rely on it).
- **Hades:** three stem groups (drums, bass, everything else); drums switch on when enemies are present and
  off when the last one dies; a boss advances the piece to its "rocking section" with all stems on; sections
  advance on markers "at the start of every measure"; stems are semi-randomised per chamber for variety.
  **[Sourced]** https://gameplay.co/hades-game-music-sound-design-darren-korb-supergiant-games/ ,
  https://www.lacedrecords.com/blogs/blog/how-rock-band-influenced-hades-soundtrack . Korb's three purposes for
  SFX: immersion, input feedback, and "Pavlovian delight".
- **Tekken 8:** separate arrangements for Round 1 and Final Round per stage; players notice and like it.
  **[Sourced]** https://www.resetera.com/threads/the-tekken-8-soundtrack-is-fire.746233/ .
- **THE FINALS:** in-match music is "uplifting, exciting, not hard or sad"; the aggression lives in trailers.
  **[Sourced]** https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio .

### 7.2 Rules for ours [Proposal]

Keep 104 BPM D Dorian and the six layers. Change how they are driven:

| Rule | Detail |
|---|---|
| **Drums gate on the exchange, not on time** | `in_exchange` = gripper-to-gripper distance < 1.6 × strike range for ≥ 300 ms, held 1.5 s after it ends. Drums (the `mid` layer's kit) fade in over one bar when true, out over two bars when false. Between exchanges the bass and a clav pad carry it. This is the Hades rule and it makes the music *comment* on distance. |
| **Hype drives `high`, not `mid`** | `high` gain = smoothstep(hype, 0.35, 0.85). Hype already exists. |
| **Final Round arrangement = subtraction** | Drop the clav lead, add a second bass an octave down, kick on every beat, hats at 16ths, pitch the whole bed up 1 semitone (105 to 107 BPM feel without changing the grid). "More drums, fewer notes" reads as *pressure*. |
| **Sudden Death** | Bass only + a 2-bar repeating riser (noise sweep 200 Hz → 6 kHz, 4 s) + a kick on 1 and 3. The crowd carries the rest. |
| **Near-KO** | Drums × (1 − 0.7u), lowpass down to 1.2 kHz (4.2). The bed goes underwater. |
| **Stingers land on the grid** | Every stinger starts at the next 8th note (≤ 144 ms wait at 104 BPM) *unless* priority 10, which plays immediately and the bed resyncs at the next bar. The kill confirm is not a stinger; it plays in the hole. |
| **Momentum stab** | On a 3-hit streak without reply, a one-bar clav stab figure on the `high` layer, up a fourth. On the reply that breaks the streak, the same figure down a fourth. Two ideas, mirrored, so the ear learns "the music takes sides". |
| **Round-start count-in** | 3, 2, 1: three muted kicks on beats, the bed enters on FIGHT with the full `low` + `mid`. The count is the first thing that teaches tempo. |
| **Victory / defeat tags** | 2 bars each, entering on a bar boundary after the KO release (4.3). Defeat is *not* sad: bass only, drums out, one descending stab, then the lobby bed. A sad defeat cue punishes a rematch. |

## 8. The hosts: cadence and narrative

### 8.1 What announcers actually do [Sourced]

- **The ramp.** Announcers start lower and slower and raise pitch, pace and loudness phrase by phrase to the
  climax, where male voices reach about 400 Hz against a 100 to 150 Hz baseline; on the payoff they slow down
  and stretch vowels ("it's iiiin"). Syntax drops subjects and "is", and inverts action before actor ("a foul on
  Wemby"). **[Sourced]** https://www.sciencefriday.com/segments/sports-announcer-talk-linguistics/ .
- **Two roles.** Play-by-play describes; colour analyses afterwards and needs "considerably more artificial
  intelligence." Write 10 to 20 variants for frequent events; keep lines 5 to 10 s, never over ~20; never repeat
  a line in one game; escalate on cumulative events (one interception vs "a string of them"). **[Sourced]**
  https://www.gamedeveloper.com/audio/the-designer-s-notebook-how-to-write-sports-commentary .
- **Modular assembly.** Lines are chunks (event + player name with excited vs neutral inflection + colour
  reaction) recombined per event. **[Sourced]**
  https://www.tumblr.com/askagamedev/611046145884651520/in-sports-games-how-do-the-programmers-code-the .
  Madden holds 100k+ lines ranked 1 to 1000 by importance to pick which one plays on a trigger. **[Sourced]**
  https://thebutlercollegian.com/2018/12/creating-the-commentary-a-look-inside-maddens-broadcast-booth/ .
- **TTS is fine for hosts** if the lines are good; Embark uses TTS for commentators and studio recordings for
  player vocalisations. **[Sourced]**
  https://www.gamedeveloper.com/business/embark-studios-i-the-finals-i-uses-text-to-speech-ai-for-in-game-voices .

### 8.2 Our line scheduler, extended [Proposal]

finals-feel 6.3 already has a priority queue with cooldowns. Add three things:

1. **Prosody as data.** Every line carries `{ramp: 0..3, release: bool}`. Captions render ramp as font weight
   (500 → 900), size (1.0× → 1.35×), letter-spacing (0 → 0.04 em) and reveal speed (28 → 60 chars/s); release
   lines get a stretched final word (`letter-spacing 0.12em`, 300 ms hold). Web Speech API (behind the toggle)
   maps ramp to `pitch` 1.0 → 1.6 and `rate` 1.0 → 1.35, and release lines to `rate` 0.85 with the final word
   elongated by a trailing vowel. The radio/PA filter (bandpass 300 Hz to 3.4 kHz, light drive) stays.
2. **One thread per round.** At round start pick a narrative thread from what the state affords, in priority
   order: `comeback` (down a round), `revenge` (lost last round to a steal), `first_blood` (round 1), `clock`
   (any). The thread unlocks 4 to 6 lines that reference *this* round's earlier events ("that's the third time
   the Core's changed hands"). This is Adams' escalation rule applied: the colour host counts.
3. **Silence budget.** The hosts are silent for ≥ 45 % of fight time. ROOK speaks only on priority ≥ 8 events
   and the ramp; VALE speaks in gaps ≥ 2.5 s with no priority ≥ 6 event pending, quoting one real number per
   line (m/s, N, ms) from telemetry. A host that never stops talking is the fastest way to make a show feel fake.

Cadence targets: ROOK's line on a KO starts at +650 ms (4.3) and is a release line. ROOK's ramp is allowed to
*precede* a moment only when the game can predict it: lock-in < 3 s ("three... two...") and a charge held ≥
400 ms while the opponent is staggered. Those are the only two pre-announced moments; everything else is
reaction, which is what keeps the hosts honest.

## 9. The crowd

### 9.1 References [Sourced]

- A shipped responsive-crowd design used nine states (Idle, Excited 1 to 3, Upset 1 to 3, Panicked 1 to 2),
  three layers (ambient bed, swells/chants, reactive stingers), RTPC 0 to 1 per emotion, and decay presets of
  3 to 5 s (level 1), 5 to 7 s (level 2), 7 to 10 s (level 3). **[Sourced]**
  https://daracrawford.com/audio-blog/behind-the-scenes-creating-responsive-crowds-in-game-environments .
- FIFA's crowd reads *context*, not just ball position: "an odd man attacking rush versus just a simple back
  pass." **[Sourced]** https://blog.soundparticles.com/how-paul-boechler-created-live-stadium-crowds-from-fifa-recordings .
  EA supplied 1,300 assets / 13 hours of it to real broadcasters during empty-stadium matches. **[Sourced]**
  https://www.gamesradar.com/fifa-20-crowd-noise-to-be-used-for-real-premier-league-games-heres-how-itll-work/ .
- THE FINALS' crowd is tied to team events: starting a cash-out, destroying something, "super hyped ... or
  disappointed." **[Sourced]** https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio .
- Counter-example: Undisputed's crowd was called "droning" and "unreactive" and it cost the game its sense of
  occasion. **[Sourced]** https://www.theaureview.com/games/undisputed-review/ .

### 9.2 Our crowd model [Proposal]

State: `mood ∈ [−1, 1]` (for the player), `energy ∈ [0, 1]`, `anticipation ∈ [0, 1]`. All three decay: energy
with τ = 4 s, mood with τ = 12 s toward 0, anticipation with τ = 0.6 s.

| Input | Effect |
|---|---|
| Hit dealt / received (raw r) | energy += r/60; mood ± r/80 |
| Streak of 3 | energy += 0.25; a `chant` starts (2 bars of formant "oh-oh" on beats 2 and 4) |
| Core docked by you / by AI | mood ± 0.3, energy += 0.2 |
| Lock-in < 3 s | anticipation → 1 (the murmur climbs a minor third and brightens) |
| Charge held ≥ 250 ms | anticipation += 0.5 (the room leans in; `windup` duck) |
| Near-KO | held breath: cheer bed −10 dB, anticipation 0.8, no shouts |
| KO | roar (4.3) or, on a player KO, a groan then a rising "come on" chant if it was round 1 or 2 |
| Near miss (strike passes within 3 cm, no contact) | `ohh` shout, −10 dB, once per 1.5 s |
| Steal | `roar` if you stole, `groan` + 0.5 s hush if the AI did |
| Idle 6 s with no hit | energy → 0.1 quickly; a single slow clap from one "person" every 2 to 4 s (the crowd is bored *at* you) |

Bed levels come from `energy` and `mood` (existing `crowdBedLevels(h, ...)`); anticipation modulates
brightness (the murmur's bandpass centre 800 → 1400 Hz) and a slow tremolo (0.25 Hz, ±3 dB).

### 9.3 Synthesis recipes [Proposal]

- **Murmur bed:** 3 independent pink-noise sources → bandpass 600 to 1200 Hz (Q 0.8) → each amplitude-modulated
  by its own slow random walk (0.2 to 0.6 Hz, depth 0.3) → sum. Density is the count of walks; 3 reads as a
  small crowd, 6 as a hall. Level −22 dB.
- **Shouts (ohh / roar / groan):** 8 to 14 "voices", each a sawtooth 110 to 260 Hz (random per voice) with
  vibrato 4 to 7 Hz depth 15 cents → two formant bandpasses (ohh: F1 500, F2 900; roar/"ah": F1 700, F2 1200;
  groan/"oh-uh": F1 450 → 550, F2 1000 → 800 over the shout) → shared envelope. Onsets staggered 0 to 120 ms
  per voice (a crowd is never in sync), pitch glides ±2 st over the shout (up for roar, down for groan).
  Level −4 to −12 dB. `renderCrowdShout` already has the vowel tables; add the stagger and glide.
- **Applause:** Poisson clicks (2 ms noise → bandpass 2 to 4 kHz) at density 20 to 60 /s across 2 channels
  with random pan; density is the envelope (rises over 0.3 s, holds, decays over 3 s). Exists (`fillApplause`).
- **Chant:** 6 voices of the "ohh" formant set, gated on beats 2 and 4 of the current bar, 2 bars, pitch a
  perfect fifth apart in two groups so it is a chord and not a note.
- **Hush:** not silence. Keep the murmur at −30 dB, kill applause and shouts, and add one 1.2 kHz "someone's
  cough" click every 3 to 5 s at −34 dB. That one click is what makes it read as a held breath instead of a mute.

## 10. The emotion arc of a round

The unit of emotion is the *round*, ~45 s of fight plus framing. Each beat below lists what changes; if a beat
changes nothing in three of the five columns, it is not a beat.

| Beat | Trigger | Music | Crowd | Hosts | SFX / servo | Ducks |
|---|---|---|---|---|---|---|
| **A. Pre-round** (round_intro, ~2.6 s) | phase start | `between_rounds` bed → count-in: three muted kicks on 3, 2, 1 | energy 0.3, anticipation ramps 0 → 0.7 over the count | ROOK ramp 1 line ("round two, and the pilot's down one") then silence for the count | Power-on chirps at match intro only; per-round: one relay click per arm as they return to home pose | none |
| **B. FIGHT** | fight start | `low` + `mid` in on the downbeat | applause 1.5 s then settles | none for the first 4 s (let the player hear the arms) | Servo life on for both arms; the opponent's whine leads its motion by servo lag | none |
| **C. First contact** | first strike of the round | drums gate on (`in_exchange`) | first `ohh` at −10 dB regardless of who hit | VALE, 1.5 s later, quotes the number ("2.1 metres a second, that's a jab") | Full impact object; if the *player* dealt it, the reward offset layer is unmistakable (crit tink or ping tier if earned) | `heavy_hit` if raw ≥ 20 |
| **D. Momentum** | 3-hit streak either way; or a streak broken | momentum stab up a fourth / down a fourth on the `high` layer | chant (2 bars) if the player's streak; a groan-then-murmur dip if the AI's | ROOK ramp 2 on the player's streak; VALE on the AI's ("that's three unanswered") | Victim's strain growl and hold-jitter rate rise with damage taken (PD error), so a beaten arm *sounds* beaten | none |
| **E. Core drama** | Core drops / dock / pry / steal | drop: one-bar riser then `high` layer on; dock: lock tick starts (1 Hz → 2 Hz < 3 s → 4 Hz < 1 s, exists); last 3 s: `last_3s` duck strips the drums | dock: mood swing; < 3 s: anticipation → 1, murmur climbs a minor third; steal: roar or groan + hush | ROOK counts the last three seconds *only* when the player owns the lock; on a steal, one release line ("STOLEN. With a second to go.") | Dock: magnet "clunk" (body 140 Hz, 90 ms) + a rising 2-note (C5, G5); pry: a 250 ms strain growl on both arms then a ratchet "release" click; steal inherits the owner's tick pitch, then re-pitches down a fourth | `lock`, `steal`, `last_3s` |
| **F. Near-KO** | either Integrity ≤ 20 | drums × (1 − 0.7u), lowpass to 1.2 kHz | held breath (hush recipe) | hosts silent except one VALE line at the threshold ("one clean hook ends this") | Victim arm: brownout flicker (AI) or heartbeat stutter (you); winner arm: whine 2nd harmonic up (it is *hunting*) | `near_ko` |
| **G. KO** | Integrity 0 | bed out; tag after release | roar swell from +0.4 s (or groan on a player KO) | ROOK release line from +0.65 s | Confirm at 0 (sub → ratchet → bell → gap → answer); victim brownout from +150 ms; slump whine tracked to physics; final stop click | `ko` |
| **H. Post-match** | outro / post_match | victory tag 2 bars → lobby bed; defeat: bass-only tag → lobby bed | victory: applause 4 s + one late whistle; defeat: murmur only, then a 2-bar "come on" chant that invites the rematch | VALE gives one real stat from the match ("your fastest hook: 3.4 m/s"); ROOK one line that names the deciding moment ("that steal at 0.8 s decided it") | Winner's emote through real servos gets the full servo layer at +3 dB; the loser is silent | `match_end` |

Between-round `round_summary` (3 s): the bed thins to bass + pad, the crowd murmurs, and *nothing else*. The
rest is where a round's emotion gets stored.

## 11. Mix targets and a test plan

- **Loudness:** master compressor ceiling −0.5 dB stays. Targets over a full round rendered offline: integrated
  −16 LUFS ± 2 for Arcade, crest factor ≥ 12 dB (if it is lower, the ducks are not working). Measure with a
  K-weighted RMS approximation in the test; exact LUFS is not needed.
- **Hierarchy check:** render five one-shots in isolation (jab, solid, heavy, crit, ping) and assert peak
  levels are monotonic and the spectral centroid of the *reward* offset layers (tink, ping) is > 2 kHz while the
  body centroid is < 1 kHz. New players learn the hierarchy from that separation.
- **Onset check:** with the harness replaying a recorded match, assert every strike's audio onset (from
  `onsetLog`) is within 20 ms of the contact step's wall time, 95th percentile.
- **Silence check:** across a rendered round, the hosts' voice bus must be silent ≥ 45 % of fight time, and the
  drums layer gain must be < 0.3 for ≥ 20 % of fight time (the exchange gate is doing its job).
- **Servo life check:** with both arms idle for 5 s, the sfx bus RMS must be > −45 dBFS and < −30 dBFS
  (alive, not loud), and the opponent's whine must start ≥ 30 ms before its first joint moves in the replay.
- **Arc check:** in a round that ends in KO, the `near_ko` lowpass must be active for ≥ 1.5 s before the
  confirm, the crowd shout bus must be silent in the 300 ms before the confirm, and the roar must peak between
  +1.0 and +1.4 s after it.

All of this renders through `OfflineAudioContext` in the existing `tests/audio-graph.test.mjs` style; none of it
needs a speaker.

## 12. Build order (cheapest emotion first)

1. Servo life for both arms + opponent whine lead (section 6). One file, biggest change in "aliveness".
2. Impact object with impulse scaling, reward offsets, audio-clock scheduling (section 3).
3. Near-KO state and KO release (sections 4.2, 4.3) plus the `heavy_hit`, `steal`, `last_3s` ducks.
4. Crowd anticipation and hush (section 9.2), reusing the existing shout and applause renderers.
5. Music exchange gate, momentum stabs, count-in, final-round subtraction (section 7.2).
6. Host prosody data + one narrative thread per round (section 8.2).

## Sources

- THE FINALS wiki, Meet the Makers: Audio. https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
- MP1st, Making THE FINALS dev diary E01 (sound). https://mp1st.com/news/the-finals-making-the-finals-dev-diary-e01-explores-sound-design
- Game Developer, THE FINALS uses TTS for in-game voices. https://www.gamedeveloper.com/business/embark-studios-i-the-finals-i-uses-text-to-speech-ai-for-in-game-voices
- Battlefield wiki, Hit marker. https://battlefield.fandom.com/wiki/Hit_marker
- DICE, HDR Audio: adaptive mixing in Frostbite. https://www.slideshare.net/slideshow/adaptive-mixing-in-frostbite/3128152
- Psyonix, HDR audio in Rocket League. https://www.rocketleague.com/en/news/under-the-hood--an-inside-look-at-hdr-audio-coming-to-rocket-league
- GDC Vault, DOOM: Behind the Music (Mick Gordon). https://www.gdcvault.com/play/1024068/-DOOM-Behind-the
- Ensigame, DOOM adaptive soundtrack. https://ensigame.com/articles/gaming/secrets-of-dooms-music-mick-gordons-adaptive-soundtrack-and-its-impact-on-gameplay-2
- Gameplay.co, The Sound of Hades (Darren Korb). https://gameplay.co/hades-game-music-sound-design-darren-korb-supergiant-games/
- Laced Records, How Rock Band influenced Hades' soundtrack. https://www.lacedrecords.com/blogs/blog/how-rock-band-influenced-hades-soundtrack
- JSMG, Interview with Darren Korb. https://online.ucpress.edu/jsmg/article/6/1/8/205397/Interview-with-Darren-Korb
- ResetEra, Tekken 8 round-1 / final-round themes. https://www.resetera.com/threads/the-tekken-8-soundtrack-is-fire.746233/
- A Sound Effect, Mortal Kombat 1 game audio. https://www.asoundeffect.com/mortal-kombat-1-game-audio/
- SmashWiki, Ping. https://www.ssbwiki.com/Ping
- SFX Engine, impact sound effect guide. https://sfxengine.com/blog/impact-sound-effect
- Morphic, how to layer sound effects. https://morphic.com/resources/how-to/how-to-layer-sound-effects
- Morphic, robot sound effects (machines stop rather than fade). https://morphic.com/resources/sounds/robot-sound-effects
- ACM, neural synthesis of impact SFX (randomisation stage). https://dl.acm.org/doi/fullHtml/10.1145/3616195.3616221
- Krotos, sound effects for games (pitch variation vs fatigue). https://krotos.studio/blog/sound-effects-for-games
- Tom Bennett Audio, DOOM Eternal Archvile glory kill redesign (ducking under impacts). https://tombennettaudio.com/blog/2021/4/3/doom-eternal-archville-glory-kill-sound-re-design
- Wayline, The power of silence. https://www.wayline.io/blog/power-of-silence-game-audio
- Wayline, Strategic silence. https://www.wayline.io/blog/strategic-silence-game-immersion
- Game Audio Insights, Silence and space. https://gameaudioinsights.com/2025/04/26/silence-and-space-in-video-game-audio/
- Speequal, psychology of game audio feedback. https://speequalgames.com/the-human-psychology-behind-game-auido-feedback/
- Science Friday, why sports announcers talk like that. https://www.sciencefriday.com/segments/sports-announcer-talk-linguistics/
- Ernest Adams, How to write sports commentary. https://www.gamedeveloper.com/audio/the-designer-s-notebook-how-to-write-sports-commentary
- Ask a Game Dev, commentary lines. https://www.tumblr.com/askagamedev/611046145884651520/in-sports-games-how-do-the-programmers-code-the
- Butler Collegian, inside Madden's broadcast booth. https://thebutlercollegian.com/2018/12/creating-the-commentary-a-look-inside-maddens-broadcast-booth/
- Dara Crawford, responsive crowd audio. https://daracrawford.com/audio-blog/behind-the-scenes-creating-responsive-crowds-in-game-environments
- Sound Particles, Paul Boechler and FIFA crowds. https://blog.soundparticles.com/how-paul-boechler-created-live-stadium-crowds-from-fifa-recordings
- GamesRadar, FIFA 20 crowd noise in real broadcasts. https://www.gamesradar.com/fifa-20-crowd-noise-to-be-used-for-real-premier-league-games-heres-how-itll-work/
- The AU Review, Undisputed (crowd criticism). https://www.theaureview.com/games/undisputed-review/
- web.dev, A tale of two clocks. https://web.dev/articles/audio-scheduling
- dev.to, sample-free drum synthesis in Web Audio. https://dev.to/sendotltd/sample-free-drum-synthesis-in-web-audio-building-kick-snare-and-hi-hat-from-oscillators-in-60-2c0k
- Sonoport, synthesising sounds with Web Audio. https://sonoport.github.io/synthesising-sounds-webaudio.html
- Synth Basics, FM ratios for bells. https://synthbasics.com/learn/fm-synthesis
- RobSonic, FM synthesis. https://robsonic.org/demystifying-fm-synthesis-rich-tones-from-simple-operators/
- arXiv, servo PWM (20 ms period). https://arxiv.org/pdf/2303.09645
- Game Developer, Overwatch "play by sound" (GDC 2016). https://www.gamedeveloper.com/audio/video-how-i-overwatch-i-was-designed-so-people-could-play-by-sound-
