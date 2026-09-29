# Why THE FINALS feels alive, and what TORQUE LIMIT does instead

Track: "emotion" research, 2026-09-24. Companion to `../finals-feel.md` (combat feedback, event
catalog, line bank) and `../finals-visual.md` (look). This file does not repeat those. It answers
one question: **why does THE FINALS read as a living show full of people, while our build reads
as a physics demo with a HUD?** Then, for every principle, what we build instead, with numbers
for a first-person 6-joint arm duel.

Tags: **[S]** sourced (URL given), **[I]** inference or design decision of ours. Where a source
could not be reached or verified, it says so. No THE FINALS names, lines, logos, fonts or
assets are to be used; the "protected" column at the end lists them.

---

## 0. TL;DR (the ten things that matter)

1. **The frame does the emotional work.** THE FINALS is a televised show first and a shooter
   second: holographic crowd, two hosts, sponsors, showrunners who interfere. Once the player
   believes "this is being watched", every feedback element becomes *the show reacting to me*,
   which is the definition of feeling seen. We are missing the frame, not the effects.
2. **Someone must react to everything the player does, within ~300 ms, in a voice that is not
   the HUD.** Crowd, hosts, lights, sponsor boards. THE FINALS' crowd is literally a hype meter
   fed by gameplay metrics. Ours is silent.
3. **The hosts punctuate turning points; they do not narrate.** Hype voice plus data voice,
   character callbacks, jokes at each other's expense. Reviewers still call it repetitive: line
   variety and cooldowns are the whole job.
4. **Tension is a siren plus a red pulsing bar plus a clock everyone can see.** The cashout
   alarm on a steal attempt is the single most-imitated sound in the game. Our Core has no alarm.
5. **"Appeal and brutality":** it is more satisfying to break something pristine and colourful.
   Our deck must start pristine and end scarred; the arms must look expensive so a dent means
   something.
6. **Nothing should be still.** Their world moves without the player: crowd, lights, events at
   the midpoint of a round, opponents who are always doing something. Our idle is a freeze-frame.
7. **Ceremonies bracket the match:** a flamboyant intro drop, a tournament intro screen where
   your contestant emotes, MVP recognition that ignores who won, counting score animations.
   Our match starts with a fade and ends with a table.
8. **The "one more" pull is a short match plus a comeback that is possible until the last
   second.** Losing a cashout is "infuriating"; stealing it back is "euphoric". Design the loss
   to hurt and the comeback to be reachable.
9. **What got people interested was one clip:** a building coming down on someone. Then a
   beta before launch (7.5 M players), then a surprise release on the biggest stage (3.6 M
   viewers). We need our one clip: a robot arm flicked so hard the opponent's Core flies.
10. **Their failures are our checklist:** repetitive TTS commentary, jarring voice effects, a
    crowd players say was forgotten after season 1, emotes nobody sees mid-fight.

---

## 1. The master principle: the show is a mirror

**[S]** THE FINALS presents matches "as live spectacles in front of holographic crowds" with
"an announcer who often reacts to exciting moments in a larger-than-life manner"; two in-game
commentators give diegetic updates on team status and objectives.
https://en.wikipedia.org/wiki/The_Finals

**[S]** Creative director Gustav Tilleby chose the virtual game show because it lets them mix
anything ("a ballerina and a soldier or a cowboy" can fight) and because of two pillars,
**appeal and brutality**: arenas are "inviting and pristine" and players "tear [them] apart".
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design

**[S]** The official self-description: contestants compete for "Fans and fortune" in a globally
televised event financed by sponsors who control "the theme, style, and branding" of each
show. https://id.embark.games/the-finals/support/faq/113-this-is-the-finals

**[I] Why this is the emotional engine.** A human feels emotion in a game when *something
outside themselves responds to what they did*. A damage number is information. A crowd gasp,
a host's "oh no", a sponsor board flashing your name, a rival who flinches: those are
witnesses. THE FINALS surrounds the player with witnesses. Our build has physics (truthful
but mute) and a HUD (informative but not a witness). The owner's "it doesn't have emotion" is
the absence of witnesses.

**What we do instead:** treat every system below as a witness with a reaction budget. Rule:
**any player action of consequence gets at least two non-HUD reactions within 300 ms** (one
from the world: lights, crowd, boards; one from a character: host, opponent, own arm). The
existing event bus (`finals-feel.md` 4.1) is the wiring; the missing part is the witnesses.

---

## 2. Principles, each with "what we do instead"

### P1. The reveal cadence: contestants are introduced, not spawned

**[S]** "Players storm into the map in a flamboyant intro sequence and are instantly met with a
gorgeous map that's surrounded by grandstands in the sky."
https://www.ggrecon.com/reviews/the-finals-review/
**[S]** There is a "tournament intro screen" where contestants appear (a patch fixed contestants
"appear[ing] invisible on the tournament intro screen"); emotes are used for "team
introductions before matches".
https://mp1st.com/title-updates-and-patches/the-finals-update-9-4-patch-1-000-122 ·
https://steamcommunity.com/app/2073850/discussions/0/4041481833171111420/

**[I]** The intro is where the player is told "you are a contestant, they are your opponent, the
crowd is here". It is short and loud, and it repeats every match so it becomes a ritual.

**What we do instead (6 s, skippable after 1.5 s, all in-engine):**
- 0.0 s: house lights out, crowd murmur bed at −18 dB, a single spotlight on the opponent's
  arm which performs its **entrance gesture** (a 1.2 s pose from its personality: OVERSHOOT
  slams the gripper on the deck twice; BACKLASH folds up and waits; DEADBAND waves). Host caption:
  entrant name, record vs you (local W-L), one-line scouting note from DR. VALE with a real
  number from its policy ("averages 1.9 m/s on the jab").
- 2.0 s: spotlight swings to our arm; the camera is already in the cockpit, so our reveal is our
  own arm waking: servos zero one joint at a time (0.15 s each, 6 joints, a rising tick
  sequence), LEDs flicker to cobalt, name plate PILOT slams in.
- 3.6 s: both LED edge strips ignite, the jumbotron shows the VS card, crowd swell to −8 dB,
  ROOK caption ("Live from the benchtop!"-style, ours).
- 5.0 s: "READY" stamp; 5.6 s: "FIGHT" with the lights slamming to full and the first music
  stab. The Core drops at 6.0 s.
- Ritual constraint: identical timing every match; only the words and the opponent gesture vary.

### P2. Two hosts who punctuate, not narrate

**[S]** The hosts comment on team standings and momentum shifts, wipes, eliminations, game show
events, final-round developments and overtime. One is an enthusiastic former contestant; the
other is data-driven ("known for her love of data and her meticulous use of spreadsheets").
Their humour comes from character callbacks (one teases the other's caffeine habit and his bad
predictions). "Neither produces full play-by-play; instead, they punctuate key turning points."
https://www.thefinals.wiki/wiki/Scotty_and_June
**[S]** The voices are TTS trained on contracted actors mixed with recorded lines; Embark says
this lets in-universe commentators respond dynamically to the match, with lines producible "in
a matter of hours rather than months".
https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals ·
https://www.pcgamer.com/the-finals-uses-ai-text-to-speech-because-it-can-produce-lines-in-just-a-matter-of-hours-rather-than-months-baffles-actual-voice-actors/
**[S]** An experimental line that used player names "played far too often and only mentioned
a single name" and had to be fixed so players would not "hear the same voiceline over and
over again". https://www.sportskeeda.com/esports/the-finals-patch-notes-5-2-0-arena-xp-boost-audio-fixes
**[S]** Player complaints: distortion and DJ-style reverse effects on the announcer voices are
"jarring" and the voices sound "plain" compared with trailers.
https://steamcommunity.com/app/2073850/discussions/0/4691154443773717629/
**[S]** Reviewers: commentary "does wonders for making each match feel intense and important"
but becomes repetitive; it "tiptoes between comic relief and being obnoxious".
https://www.ggrecon.com/reviews/the-finals-review/ · https://www.videogamer.com/reviews/the-finals-review/

**[I]** What the hosts really do is **turn the match into a story with a narrator who has
opinions**. The hype voice supplies stakes; the data voice supplies proof; the banter supplies
personality; the callbacks supply continuity between matches. Repetition kills it because a
repeated line reveals that nobody is actually watching.

**What we do instead (captions always on; voices optional and never distorted):**
- **Cadence.** At most one caption every 6 s, hard silence of 3 s after any caption, and a
  priority queue (KO 100, steal 90, lock 85, crit 70, deflect 60, streak 50, momentum 40,
  colour 10). Colour lines only fire after 8 s of no event. Target: 25 to 40 captions in a
  3-minute match, never two in a row from the same host.
- **Two jobs, two voices.** ROOK reacts (interjections, one clause, exclamation). DR. VALE
  proves (every VALE line quotes a live number from physics: impact speed m/s, peak force N,
  reaction time ms, joint temperature, time left). Alternate by rule: a ROOK line on an event
  is followed by a VALE line with the number within 2 s if the queue is free.
- **Variety budget.** Minimum 12 variants per event class, templated with slots (opponent name,
  number, round, score), and a **no-repeat window of 20 lines**. Track lines used per profile
  across matches so a returning player hears new ones first.
- **Callbacks make it human.** State the hosts carry: who predicted what at the intro ("VALE
  called OVERSHOOT by two"), last match's result, the player's best stat so far, the running
  gag (ROOK's bet with VALE, VALE's obsession with a clean spreadsheet). Pay a callback within
  the same match at least once (e.g. after the prediction fails: "So much for the spreadsheet").
- **Momentum lines.** Detect three states from the last 20 s of events: player surging (2+ hits
  landed, 0 taken), player folding (0 landed, 2+ taken), stalemate (no contact 10 s). Each has
  its own line pool; stalemate lines needle the player to act ("Somebody touch somebody").
- **The name rule.** The player's chosen name is used at most twice a match, and only at
  intro and at the decisive moment.
- **Voice, if enabled:** dry, near-field, no reverse effects, no radio crush by default; the
  complaint above is that processing made the voices worse.

### P3. The crowd is a hype meter you can hear

**[S]** The crowd "is tied to gameplay and tracks different interactions the team performs,
stacking up a hype amount that the crowd responds to" (starting a cashout, destroying
something, eliminating opponents); "if you're doing really good, the crowd will be super hyped
and cheer. But if you get eliminated and such, the crowd will become disappointed."
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
**[S]** Players wish the studio "leaned more into the game show aspect. It feels like they've
forgotten about it after season 1", and ask for crowd reactions that scale with performance.
https://steamcommunity.com/app/2073850/discussions/0/797842245107634489/

**[I]** The crowd is the cheapest witness there is: one scalar, one filtered noise bed, a few
one-shots. Its emotional power is that it is *partial*: it wants something to happen and it
wants the underdog to come back. The failure mode is a crowd that is only wallpaper.

**What we do instead (one scalar `hype` in [0, 100], plus a `lean` in [−1, +1]):**
- Inputs per event: hit +6, crit +14, deflect +8, clash +10, Core pickup +8, dock +18, steal
  +22, KO +40, whiff −2, 6 s with no contact −1/s. Decay 3/s toward 15 (the "restless" floor).
- `lean` tracks who the crowd is rooting for: drifts toward the underdog by score difference
  (−0.15 per point behind) so the player hears support when losing, and boos (light, comic)
  when they turtle with a lead for more than 8 s.
- Audio: bed is band-passed noise (300 to 3 kHz) with amplitude = 0.2 + 0.6·hype/100 and a
  1 Hz to 4 Hz amplitude wobble that speeds up with hype; one-shots: gasp (sharp inhale, 250 ms)
  on any hit above 60% strength or on a Core drop; cheer swell (700 ms attack) on dock and
  crit; groan (400 ms, falling pitch) on a whiff or when the player takes a crit; a **rhythmic
  clap** locked to the music tempo when hype > 70; stomps in the last 10 s of a countdown.
- Visual: the holo crowd's shimmer amplitude and the LED ribbon scroll speed are driven by
  `hype`; above 80 the stands strobe in the leaning team's colour.
- Hosts read the meter: a crowd line fires when hype crosses 50 upward ("They're on their feet")
  or drops below 20 for 10 s ("This crowd paid for a fight").

### P4. Sponsors make it a world someone else lives in

**[S]** Sponsors are fictional corporations (ten of them) with "distinct personalities and
philosophies", "fine print" agreements written as satire (one insures everything, one
prioritises power above all, one promises protection "even from yourself"); they "adorn the
arenas and broadcasts", and contestants earn fans from them (elimination 20, assist 15, revive
20, objective actions more). https://www.thefinals.wiki/wiki/Sponsorships
**[S]** All sponsors sit under a conglomerate that shapes the "theme, style, and branding" of
each show. https://id.embark.games/the-finals/support/faq/113-this-is-the-finals
**[S]** The style was chosen to be "colorful, loud and a wee bit chaotic" rather than military,
with a game show premise that "didn't take itself too seriously".
https://mp1st.com/news/embark-on-the-finals-interview-how-this-contestant-became-a-finalist

**[I]** Sponsors are the joke that makes the world feel inhabited: someone is making money off
this fight. They also give the boards something to say when nothing is happening.

**What we do instead (two brands, both original, already named in SCOPE.md):**
- **OHMSTEAD** and **PULPO POP** each get a voice: a 6-line rotating "ad break" copy set for the
  LED boards and the jumbotron (OHMSTEAD deadpan corporate: "Keeping you grounded"; PULPO POP
  eight-arm puns), shown only during dead air (no event for 5 s) and between rounds.
- **Sponsored stats.** Every between-round card is "presented by" one sponsor with a stat
  chosen to fit it: OHMSTEAD sponsors peak force and heat; PULPO POP sponsors grips and steals.
- **Sponsor reactions.** A brand board reacts to a matching event within 200 ms: a crit flips
  the OHMSTEAD board to a hazard-stripe "OVERCURRENT" frame for 1.5 s; a steal flips PULPO POP
  to a tentacle "SNATCHED" frame. Two textures each, swapped by uniform.
- **Fine print as loading-screen copy:** one satirical clause per load ("PULPO POP is not liable
  for gripper adhesion"). Fifteen lines, no repeats within a session.
- **Fans, local only:** a per-profile fan counter fed by the same event weights as the crowd
  meter, shown on the post-match card as "+340 fans (steal 120, crit 90, ...)". No unlocks needed
  for it to feel like recognition.

### P5. Sirens, red bars and a clock everyone can see

**[S]** When a Cashout Station is being stolen "a loud alarm sounds to alert nearby contestants",
the HUD progress bar "begins pulsating red", and the in-world indicator "will also pulse red for
the team that currently owns the cashout". Countdowns are 2:00 (2:10 in some rounds), steals
take 6 to 7 s, and up to a minute of overtime is added if the round would otherwise end.
https://www.thefinals.wiki/wiki/Cashout_Station
**[S]** The cashout alarm is widely clipped and re-shared as a sound on its own (TikTok "cashout
alarm" pages, ringtone sites). https://www.tiktok.com/discover/the-finals-cashout-alarm
**[S]** Reviewers single out "the final moments of a match when everyone is scrambling for the
cashout" as where the music and tension peak, and "sneakily blown through the ceiling to steal
the Cash Out at the last moment" as the water-cooler moment.
https://gamingtrend.com/reviews/the-finals-review-the-ultimate-fps-gameshow/ ·
https://www.ggrecon.com/reviews/the-finals-review/

**[I]** The alarm works because it is *diegetic panic*: the world itself is screaming that
something you own is being taken, and everyone in the arena hears the same sound. A countdown
you can steal is a fuse; the alarm is the hiss.

**What we do instead (the Core already has dock, lock and steal-inherits-countdown):**
- **Dock siren.** On dock, a two-tone siren (E5/B4 alternating at 3 Hz, band-limited, −12 dB,
  through the PA filter) runs for the whole countdown. It is the sound of "someone is winning".
- **Steal alarm.** When the opponent's gripper contacts the docked Core, the siren switches to a
  faster, harsher pattern (5 Hz, added square component), the countdown ring on the HUD pulses
  red at 2 Hz, the deck LED strip on the owner's side flashes red, and the jumbotron shows
  STEAL IN PROGRESS. All within 100 ms of contact. A steal that fails snaps back to the calm
  siren with a "relief" crowd exhale.
- **Last ten seconds.** Tick every second at rising pitch, crowd stomps in time, the hype floor
  is raised to 60, the music bed drops to the kick only. At 3 s the hosts go silent (silence is
  the loudest cue).
- **Overtime rule:** if a steal starts inside the last 5 s, the round cannot end until the steal
  resolves (a 10 s cap). This is our version of their overtime, and it guarantees the last-second
  swing exists.
- **The clock is in the world.** Countdown digits on the jumbotron and on the Core's own face,
  not only on the HUD, so the opponent's arm can be seen reaching for a number.

### P6. Destruction as payoff: appeal and brutality, chain reactions

**[S]** "It's more satisfying to break something that is pristine and colorful than it is to
break something that is already worn and broken down."
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design
**[S]** Destruction is server-authoritative so "every player experiences the same impact to the
world at the same time". https://gamesbeat.com/embark-studios-unveils-the-finals-team-based-shooter-game/
**[S]** The newer destruction system stresses knock-on effects: "making these crash down can
cause real damage and totally reshape the environment".
https://80.lv/articles/the-finals-new-destruction-system-brings-realism-and-simply-epic-vibes
**[S]** The clip economy is built on it: "unexpected destruction can create chain reactions and
moments that weren't scripted", building collapses are what clip tools auto-detect.
https://eklipse.gg/use-case/the-finals-highlights/

**[I]** We do not have buildings. We have two expensive-looking machines, a lacquered deck, a
Core and clutter. The principle transfers as **state that accumulates and is visible**: the
match should leave marks, and a big hit should knock more than one thing over.

**What we do instead:**
- **Pristine start.** The deck is glossy and clean at 0:00 (the art bible's lacquer). Every hit
  above 40% strength stamps a scuff decal at the contact point (decal atlas, 64 slots, oldest
  recycled); crits chip paint on the struck link (per-link `damage` uniform that mixes a
  scratched-metal layer, 0 to 1 over the match). By round 3 both arms look fought.
- **Chain reactions on the deck.** Clutter cubes are real bodies; a heavy hit that sends the
  opponent's arm into them scatters them, and any cube that leaves the deck triggers a crowd
  gasp and a VALE line ("That's a 0.8 kg cube off the table"). The Core knocked loose is the
  centrepiece "collapse": slow-motion 0.3 s at 0.35× when it leaves a gripper from a hit.
- **Same truth for both.** Physics already runs once and replays bit-exact; the harness is our
  "server-side". Use it: every replay of the deciding moment must show the same debris.
- **A destruction ledger** on the post-match card: scuffs, chips, cubes off table, Core drops.
  Cheap, and it makes the brutality countable.

### P7. Player expressiveness: identity beats emotes

**[S]** Customization aims at "an emotional bond between the player and their avatar"; "you get
to be who you want to be when you enter our virtual arena".
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Character_and_Concept_Art
**[S]** Emotes, gestures, sounds, voice options and sprays exist; an emote wheel holds up to 8.
https://the-finals.fandom.com/wiki/Emotes · https://www.thefinals.wiki/wiki/Customization
**[S]** But in play: "for a game with very little downtime ... emotes seem like too much of a
hard stop"; the emote-after-kill achievement sits at about 0.4% completion; the places they are
actually seen are the team intro and post-victory taunting.
https://steamcommunity.com/app/2073850/discussions/0/4041481833171111420/

**[I]** In a fast game, expressiveness that requires a button nobody presses is dead weight.
Expressiveness that is *automatic* (idle behaviour, reactions, the intro and outro pose) is what
players actually see. For a robot arm this is a gift: an arm has no face, so all its personality
is motion.

**What we do instead:**
- **Idle life on both arms, always.** Servo hold-jitter (±0.15° at 8 to 12 Hz on the wrist and
  gripper, seeded per arm), a slow 0.2 Hz "breathing" drift on the shoulder of ±0.4°, gripper
  micro-open/close every 3 to 7 s, and an LED heartbeat at 1.2 Hz that speeds with heat. The
  player's own arm does this too, visible in the cockpit; it is the single cheapest fix for
  "nothing moves unless I move".
- **Reactions, not emotes.** The opponent arm has 4 involuntary tells driven by state: a
  0.25 s flinch-back on taking a hit, a 0.4 s "shake it off" wrist roll after a stagger, a
  double gripper snap when its hype line fires (taunt), and a 1 s droop when 20+ points behind.
  The player's arm gets the flinch and the shake too (felt through the cockpit camera).
- **One deliberate gesture key** (G): a 0.8 s pose from the loadout (bow, flex, spin, point).
  Usable only when out of contact range; the hosts and crowd react to it (a taunt raises hype
  +5 and, if the player then takes a hit within 3 s, ROOK punishes it). Also used automatically
  at the intro and at the victory pose, which is where THE FINALS' emotes actually get seen.
- **"GG" moment.** After the final KO, both arms return to neutral and the winner's arm offers a
  gripper tap; if the player presses G within 2 s, the loser's arm taps back and VALE notes the
  sportsmanship. Nobody is forced; it is a tiny consent ritual that reads as human.
- **Identity in 30 seconds.** Name, team colour within the cobalt family (5 tints), a decal, a
  gesture. That is the whole customisation; it is enough for the intro card to feel like yours.

### P8. Ceremonies: recognition that survives losing

**[S]** From season 10 there is an MVP screen with 1st, 2nd and 3rd "that ignores which team
won", a between-round Best Score screen, and a personal stats screen before the scoreboard.
https://id.embark.games/the-finals/support/faq/216-mvp-screen (cited in `../finals-feel.md` 1.5)
**[S]** A counting animation was added to the end-of-round score breakdown "for clearer
post-match updates". https://mp1st.com/title-updates-and-patches/the-finals-update-9-4-patch-1-000-122
**[S]** The winning team of a tournament receives "World Tour Win Points" and progression
rewards; victory is by cash target or by highest total at time.
https://www.thefinals.wiki/wiki/Cashout

**[I]** A ceremony is time set aside for the world to look at the player. Losing players stay
if the ceremony still has something for them.

**What we do instead (outro 8 s, post-match card, rematch key):**
- **KO ceremony**: slow motion (0.3×, 700 ms), white flash, de-rez burst (the art bible), then
  the lights drop to a single spot on the winner's arm doing its gesture while the loser's arm
  slumps (brownout). Confetti only on a match win, not a round win, so it stays special.
- **Best-moment replay** (already in scope): 4 s, from the jumbotron's angle, with the hosts'
  captions replayed on top. This is our "clip", and it must be exportable as a PNG strip or
  short WebM later (data goal: shareable moments recruit players).
- **Recognition even in loss.** The post-match card always leads with the player's best stat
  of the match in gold ("FASTEST FLICK 2.4 m/s") before the result, and one host line about it.
  Numbers count up over 600 ms with ticks.
- **Rival memory.** Local W-L per opponent shown as a rivalry strip ("BACKLASH leads 3-2");
  the intro card references it next time. This is the smallest possible "season".
- **One key rematch**, with the opponent's intro gesture changed if it lost (a sulk) or won
  (a swagger), so the rematch already feels like a continuation.

### P9. The "one more" pull: short, and never over until it's over

**[S]** Matches run about 15 minutes, "short enough to warrant that golden 'just one more
match' thought". https://www.ggrecon.com/reviews/the-finals-review/
**[S]** Losing a cashout "can feel infuriating" but "pulling off a near-impossible comeback is
downright euphoric"; "every moment feels like a setpiece of your own making".
https://www.videogamer.com/reviews/the-finals-review/
**[S]** Random game show events "occur in the second half of a match".
https://www.dexerto.com/gaming/all-random-events-in-the-finals-2466843/

**[I]** The pull is a loop of *stakes that can flip*, *a defeat you can name*, and *a next match
that is one press away*. Our matches are already short; what is missing is the flip and the
name.

**What we do instead:**
- Match length target **2.5 to 4 minutes** (best of 3, rounds 60 to 90 s). Post-match to next
  intro in under 3 s on rematch.
- **The comeback is always reachable:** steal inherits the countdown (in scope), plus the
  underdog rule from `../finals-feel.md` 3.4 in ARCADE only. Verify with the harness: in 1,000
  seeded matches, the side behind after round 1 must win at least 30% (tune until it does).
- **Name the defeat.** Every loss ends with one line that names the cause from the event log
  ("You lost the Core with 4 s left", "Three crits taken while overheated"). A nameable loss is
  a reason to try again; an unexplained loss is a reason to quit.
- **Midpoint twist (our game show event).** At 50% of round time in ARCADE, the showrunners
  may call one 20 s event, announced by a jumbotron card, a siren blip and a ROOK line: DOUBLE
  TORQUE (strike damage ×1.5), SLICK DECK (friction 0.5), HOT CORE (dock timer ×0.6), LIGHTS
  OUT (only LEDs and spots, 8 s). One per round at most, never in HARNESS or PROVING GROUND.

### P10. Sound design philosophy: the show has a sound

**[S]** Elimination sound: separated in time from gunfire, spanning bass and treble to cut
through mids, built from excitement associations (slot machines, pinball, cash registers, a real
reception bell), and modelled on Battlefield 1's kill sound; the reaction is described as
"Pavlovian". Threats are identifiable by ear (each grenade sounds different). Music in-game is
uplifting; trailers are distorted through a Boss HM-2. The audio director describes the target
as "dynamic bursts of absolute chaos" with casino and arcade energy.
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
**[S]** Combat sounds were recorded in an abandoned Stockholm factory.
https://mp1st.com/news/the-finals-making-the-finals-dev-diary-e01-explores-sound-design
**[S]** The animators avoid heavy client prediction and instead use audio, VFX and animation
together to mask latency and sell responsiveness ("kinetic affordance": you can predict what a
dropped football does, so movement must match physical intuition).
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Movement
**[S]** "The music slaps ... especially in the final moments of a match"; "everything has a
clear audio signature".
https://gamingtrend.com/reviews/the-finals-review-the-ultimate-fps-gameshow/

**[I]** The audio philosophy is: every important thing has its own timbre, the best thing that
can happen has a sound you crave, and the response to input is instant even when the state is
not. This maps directly onto a PD-servo arm where the commanded pose leads the physical pose:
**the sound must answer the command, the visuals answer the physics.**

**What we do instead (all WebAudio, per SCOPE.md 3):**
- **Command-side sounds.** Servo whine starts on the *commanded* velocity (0 ms), not the
  measured one; the gripper click fires on key-down. This is the latency mask in the Movement
  episode, ported.
- **Physics-side sounds.** Impacts are layered (sub 60 to 90 Hz thump, mid 300 to 800 Hz body,
  high 3 to 6 kHz tick), pitch randomised ±8%, with a 40 to 80 ms gap of ducking before the KO
  confirm so it "peaks alone".
- **A KO sound you crave.** Ours per SCOPE.md: sub thump, servo ratchet, bell, rhythmic gap.
  Add the association rule: a coin cascade tail (12 short metallic pings, random 2 to 5 kHz over
  400 ms) since cash is our prize too. Test it the way they did: it must be recognisable in a
  mix at −6 dB against crowd and music.
- **Every threat by ear.** The opponent's charge wind-up has a rising whine (1 s, 200 to
  900 Hz) audible before the swing; a jab has a short click; a grab attempt has a pneumatic
  hiss. Players should be able to guard with eyes closed.
- **Music that knows the score.** Bed of percussion + bass + stabs in three intensities driven
  by hype (0 to 40 / 40 to 75 / 75+), plus the countdown arrangement (kick only, last 10 s) and
  the final-round arrangement (add a lead). Uplifting in-match; the distorted version is for
  the title screen attract loop only.

### P11. Getting people interested: one clip, then a beta, then a stage

**[S]** The interest started with destruction clips: "I almost don't believe the destructibility
in this FPS is real" (PC Gamer), "the best destruction physics I have ever seen" (GamesRadar).
https://www.pcgamer.com/i-almost-dont-believe-the-destructibility-in-this-fps-is-real/ ·
https://www.gamesradar.com/the-finals-preview-hands-on-march-2023/
**[S]** Closed beta March 2023, then an open beta with 7.5 M players over 10 days, then a
surprise release during The Game Awards 2023 (3.6 M peak viewers), 10 M players in 15 days.
https://www.dexerto.com/gaming/the-finals-stuns-at-the-game-awards-2023-with-stealth-launch-of-full-game-2421371/ ·
https://streamscharts.com/news/the-finals-first-week-numbers ·
https://www.gamesradar.com/hot-new-fps-the-finals-hits-10-million-players-in-just-15-days/
**[S]** Twitch: first-week peak 63 K viewers, 2.3 K channels; Shroud, Summit1g, LIRIK, xQc among
the top; the game was the most wish-listed on Steam before launch.
https://streamscharts.com/news/the-finals-first-week-numbers
**[S]** Executive producers used betas "to validate our choices by listening to the player
feedback", collecting data on movement, gunplay, modes and onboarding.
https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Rob_and_Jonny

**[I]** The recipe: a single mechanic that is *visibly* new in a 10-second clip, a community
that has already played it before the "launch", and a moment of surprise. Our visibly new thing
is real physics on real robot arms: a strike that actually deflects, a Core that actually
flies. Nobody has seen a first-person robot-arm fight. The clip should make people ask "is
that real physics?"

**What we do instead (business goal: interest, then demonstrations and matches):**
- **The hero clip**, 8 s, made in-engine from the replay system: cockpit view, a charged flick,
  slow-motion contact, the opponent's Core sailing off the deck, crowd surge, KO stamp. Every
  polish task should be checked against "does this make the hero clip better?"
- **Play in the browser with no install** is our shadow drop: link, 10 s load, intro at 0:15.
  The first minute must teach by doing (P12 below), because a clip viewer gives us one minute.
- **Attract mode on the title screen** (already in scope): AI vs AI with full show, muted until
  interaction. It is the trailer, running live.
- **Share = data.** The post-match "share moment" export doubles as a demonstration export;
  every shared clip carries a match id so the match record can be pulled from the local store
  into the dataset when the player opts in.
- **Beta before launch:** ship to 10 people, watch them for the first 60 s each, log
  where they stop moving. That is our closed beta.

### P12. The first minute (their onboarding gap is our biggest risk)

**[S]** Onboarding was a stated beta focus (see P11). Reviewers still describe the commentary as
the thing that helps "map awareness during intense moments".
https://www.videogamer.com/reviews/the-finals-review/

**[I]** Our owner's "the first minute is confusing" is the show's fault as much as the
tutorial's: a show explains itself continuously. The hosts are the tutorial.

**What we do instead:** in a profile's first three matches, VALE's data lines are replaced by
**coaching lines tied to the exact state** ("Hold RMB, the guard is up when the ring is blue";
"Reach in with W, you are 12 cm short"), fired by the same event bus, max one per 8 s, and the
opponent's opening grace (already planned) is 3 s. Match 1 is a single 60 s round against JIG
with the full show, so the player sees a KO ceremony inside the first 90 s.

---

## 3. A three-minute match with the witnesses turned on (where each principle fires)

| Clock | What happens | Witnesses (principle) |
|---|---|---|
| 0:00 | Lights out, opponent entrance gesture, intro card | P1, P2 (intro line with prediction), P3 (murmur) |
| 0:06 | FIGHT, lights slam on, Core drops | P1, P10 (stab), P3 (swell) |
| 0:06+ | Both arms idle-alive; opponent probes | P7 (idle life), P10 (whine on command) |
| 0:14 | First contact, a jab lands | P6 (scuff), P3 (+6, gasp if hard), P2 ROOK "first blood" then VALE "1.6 m/s" |
| 0:30 | Player docks the Core | P5 (siren), P3 (+18), P4 (PULPO board), P2 |
| 0:41 | Opponent steal contact | P5 (alarm, red pulse, STEAL card), P3 (groan), P7 (opponent taunt snap) |
| 0:45 | Steal succeeds, countdown inherited | P2 callback ("VALE said this would happen"), P9 stakes flip |
| 0:52 | Midpoint twist: SLICK DECK | P9 (jumbotron, siren blip, ROOK) |
| 1:05 | Player crit while opponent overheated | P6 (paint chip), P10 (peaking impact), P3 (+14, clap), P4 (OHMSTEAD OVERCURRENT) |
| 1:20 | Last ten seconds of the countdown | P5 (ticks, stomps, hosts silent) |
| 1:28 | Player steals with 2 s left, overtime cap | P5 (relief exhale), P3 (+22, strobe), P2 ROOK loses it |
| 1:40 | KO | P8 (slow-mo, flash, de-rez, spot, gesture), P10 (KO sound with coin tail) |
| 1:44 | Between-round card, sponsored stat, counting numbers | P8, P4 |
| ... | Round 2 with the loser's sulk gesture at intro | P8 rival memory |
| 3:10 | Match end, GG tap, best-stat-first card, "one key" rematch | P7, P8, P9 |

Reaction budget check for the sample: 27 host captions, 0 repeats, every event with two
non-HUD witnesses.

---

## 4. Their failures, our checklist

| THE FINALS problem (sourced above) | Our guard |
|---|---|
| Commentary repetitive, TTS sounds "plain" | 12+ variants per event, 20-line no-repeat window, captions first, no processed voices |
| Voice effects "jarring" | No reverse/DJ/radio effects on hosts by default |
| Crowd "forgotten after season 1" | Crowd is a first-class system with its own test: hype trace per match must cross 50 at least twice in an average ARCADE match |
| Emotes nobody sees | Expressiveness is automatic (idle, reactions, intro/outro); one gesture key only |
| Name lines overplayed | Player name at most twice a match |
| Game show events disabled in ranked | Twists in ARCADE only; HARNESS and PROVING GROUND byte-identical |

---

## 5. Borrowable vs protected

| Borrowable (principles, genre conventions) | Protected (do not use) |
|---|---|
| Televised virtual show framing, holographic crowd, two-host format (hype + analyst), sponsor satire, showrunner twists mid-match, cashout-style countdown with alarm and steal-inherits-timer, pristine-then-broken arenas, MVP-regardless-of-winner, counting score animations, intro reveal ritual, victory pose, "one more" short matches | The name THE FINALS and Embark marks; host names Scotty and June and any of their lines or catchphrases; sponsor names (VOLPE, HOLTOW, OSPUZE, DISSUN, VAIIYA, CNS, TRENTILA, ALFA ACTA, ISEUL-T, ENGIMO) and MultiCo; the terms Cashout / Cash Box / Cashout Station / "Dynamism Shooter"; arena names (Monaco, Kyoto, Bernal, Skyway Stadium, Fortune Stadium); event names (Meteor Shower, Low Gravity, Orbital Lasers, Alien Invasion, Retro Invasion '82, The Dead Go Boom, Mega Damage); the coin-burst-to-statue elimination as an asset; the Saira font family; any audio, logo, texture, screenshot or HUD trace; the actual alarm sound |

Our substitutes are already named in SCOPE.md 1.2 (TORQUE LIMIT, ROOK, DR. VALE, OHMSTEAD,
PULPO POP, BIT, the Core, dock/lock/steal, SHORTED OUT) plus the twist names above (DOUBLE
TORQUE, SLICK DECK, HOT CORE, LIGHTS OUT).

---

## 6. Gaps (not verified)

Could not fetch: the season 4 patch notes (stadium arena details), the official Emotes wiki
page (404), the esports.gg Shroud article (403), the Digital Trends preview (empty fetch). No
reliable source was found for how mid-match events are announced on screen or for the exact
order of THE FINALS' intro and winner screens; the intro and outro timings in this file are our
design, not theirs. No developer talk was found that gives their crowd meter's numbers; ours are
starting values to tune in playtests.

## 7. Sources

- https://en.wikipedia.org/wiki/The_Finals
- https://id.embark.games/the-finals/support/faq/113-this-is-the-finals
- https://id.embark.games/the-finals/support/faq/62-game-show-events-1771944862
- https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design
- https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Audio
- https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Movement
- https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Character_and_Concept_Art
- https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Rob_and_Jonny
- https://www.thefinals.wiki/wiki/Scotty_and_June
- https://www.thefinals.wiki/wiki/Cashout_Station
- https://www.thefinals.wiki/wiki/Cashout
- https://www.thefinals.wiki/wiki/Sponsorships
- https://www.thefinals.wiki/wiki/Game_Show_Events
- https://www.thefinals.wiki/wiki/Customization
- https://the-finals.fandom.com/wiki/Emotes
- https://www.ggrecon.com/reviews/the-finals-review/
- https://www.videogamer.com/reviews/the-finals-review/
- https://gamingtrend.com/reviews/the-finals-review-the-ultimate-fps-gameshow/
- https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals
- https://www.pcgamer.com/the-finals-uses-ai-text-to-speech-because-it-can-produce-lines-in-just-a-matter-of-hours-rather-than-months-baffles-actual-voice-actors/
- https://mp1st.com/news/the-finals-making-the-finals-dev-diary-e01-explores-sound-design
- https://mp1st.com/news/embark-on-the-finals-interview-how-this-contestant-became-a-finalist
- https://mp1st.com/title-updates-and-patches/the-finals-update-9-4-patch-1-000-122
- https://www.sportskeeda.com/esports/the-finals-patch-notes-5-2-0-arena-xp-boost-audio-fixes
- https://steamcommunity.com/app/2073850/discussions/0/797842245107634489/
- https://steamcommunity.com/app/2073850/discussions/0/4691154443773717629/
- https://steamcommunity.com/app/2073850/discussions/0/4041481833171111420/
- https://gamesbeat.com/embark-studios-unveils-the-finals-team-based-shooter-game/
- https://80.lv/articles/the-finals-new-destruction-system-brings-realism-and-simply-epic-vibes
- https://eklipse.gg/use-case/the-finals-highlights/
- https://www.pcgamer.com/i-almost-dont-believe-the-destructibility-in-this-fps-is-real/
- https://www.gamesradar.com/the-finals-preview-hands-on-march-2023/
- https://www.gamesradar.com/hot-new-fps-the-finals-hits-10-million-players-in-just-15-days/
- https://www.dexerto.com/gaming/the-finals-stuns-at-the-game-awards-2023-with-stealth-launch-of-full-game-2421371/
- https://streamscharts.com/news/the-finals-first-week-numbers
- https://www.dexerto.com/gaming/all-random-events-in-the-finals-2466843/
- https://www.tiktok.com/discover/the-finals-cashout-alarm
