# Hooks: interest, onboarding and one-more-round for TORQUE LIMIT

Track: what gets people to TRY a game and PLAY AGAIN, without lore. Output: an engagement loop
in which every match produces something worth sharing and every loss suggests a next attempt.

Written 2026-09-24 against branch `fps-duel`. Companion docs: `finals-feel.md` (feedback events,
replay, post-match layout), `finals-visual.md` (look), `fps-feel.md`, `ai-opponent.md`.
`SCOPE.md` cut league, medals, daily, drills and rival; section 6 says which of those this track
asks to reopen in their cheapest form and why, so the owner can decide.

Tags: **[Sourced]** = a cited claim. **[Inference]** = our translation to a 6-joint arm duel.

---

## 0. TL;DR

1. **The first 10 seconds decide conversion.** Poki's line is "can the player start having fun
   within ten seconds?"; Stickman Hook went from 50% to 72% conversion-to-play by cutting load
   from 29.5 s to 3.7 s. Our boot must put a moving, lit arena on screen before `mujoco.wasm`
   finishes, and the first click must already be a swing.
2. **Teach by hitting, not by reading.** Portal, Half-Life 2 and Celeste all open with a
   risk-free interaction, then one new idea per room, no text. Our tutorial spec (7.3.9) is
   already right in shape; it is wrong in placement (it is a separate screen, not the first
   match) and in tempo (five stamped steps before anything is at stake).
3. **Short-session games live on competence feedback.** SDT/PENS work (Ryan, Rigby, Przybylski)
   finds need satisfaction during play predicts wanting to play more; the strongest lever for a
   90-second match is *immediate, legible competence feedback*: the hit that visibly landed, the
   number that beat your last number.
4. **Loss streaks are where players leave.** EOMM (EA, WWW'17) measured churn after the last
   three outcomes: LLL and WWL at ~5%, mixed patterns at ~2.6%. Our DDA loss-streak rule should
   guarantee that the *third* consecutive loss cannot be a blowout, and the post-loss screen
   must never show a bare "DEFEAT".
5. **Near misses drive retries, but only when the player can see what was near.** Clark 2009:
   near misses recruit win circuitry and raise the urge to continue. In a skill game this only
   works if the margin is legible: "Core lock 6.8 / 8.0 s" and "Integrity 4 left" are the
   near-miss displays; "DEFEAT" is not.
6. **Every match must mint a shareable artifact with zero effort.** Wordle's viral engine was a
   spoiler-free emoji grid pasted as text, no link. Ours: a 3-line **Bout Card** (text, copies
   to clipboard) plus an auto-cut 6-second WebM of the deciding moment from the replay buffer.
7. **The rematch button is the retention system.** Rocket League's 5-minute matches, Fall Guys'
   3–5 minute shows and Trackmania's 1.5 s restart all trade on the same thing: cost of the
   next attempt near zero. We already have REMATCH-to-control at 3.4 s. Make the post-match
   screen a *proposal* ("run it back with a hint", "30-second drill", "swap to DEADBAND"), not a
   scoreboard.
8. **Ghosts and seeds beat leaderboards for a game without servers.** Trackmania medals +
   ghosts + "drivers near you", Spelunky's one-attempt daily seed, Forza's Drivatar (an AI that
   wears a real person's name) are all reproducible locally with what we have: bit-exact
   recorded matches and a policy interface. Recorded humans become opponents. That is also the
   dataset.
9. **Discovery is metric-gated.** Poki/CrazyGames rank on playtime and conversion; itch.io is
   exploration-driven and feeds them (PolyTrack went itch → CrazyGames trending). Launch on
   itch with a web build, thumbnail-first, outside jam weeks, then port to the portals.
10. **Instrument five numbers from day one:** conversion-to-play, time-to-first-hit,
    matches-per-first-session, rematch rate, share rate. Targets in section 5.

---

## 1. Diagnosis: the owner's verdict in hook terms

| Verdict | Hook that is failing | Section |
|---|---|---|
| "unoptimized" | load-to-fun exceeds 10 s; conversion dies before the first swing | 2.1 |
| "plain, unlit grey prototype" | fails the screenshot test; nothing to share, nothing to stop a scroll | 2.7 |
| "nothing moves unless the player moves" | no attract mode, no ambient competence cue, no opponent presence | 2.1, 2.3 |
| "opponent feels like a script" | no relatedness target; no rival, no name that means anything | 2.9 |
| "hits do not feel like anything" | competence feedback missing; the feel track owns the fix, this track owns *why it matters for retries* | 2.3, 2.5 |
| "first minute is confusing" | tutorial is a gated screen, not the first fight; five concepts before stakes | 2.2 |
| "no reason to play again" | post-match is a scoreboard with no proposal, no artifact, no ladder | 2.6, 2.8, 2.10 |

---

## 2. Research

### 2.1 The first 60 seconds: immediate control, immediate spectacle, one goal

- **[Sourced]** Poki: "Can the player start having fun within ten seconds? Players arrive
  fast, decide fast, and leave fast." Players leave if loading exceeds 10 s. Stickman Hook:
  40 MB / 29.5 s median load = 50% conversion-to-play; 6 MB / 3.7 s = 72%. Keep the total under
  ~30 MB and load the core loop first so play starts before all assets arrive.
  https://developers.poki.com/guide/requirements-quality ·
  https://poki.com/blog/what-makes-high-quality-browser-game ·
  https://defold.com/2026/06/02/Best-practices-when-building-for-the-web/
- **[Sourced]** Poki quality guidance: long intros, heavy tutorials, complex menus and slow
  unlocks hurt conversion; "continuous interaction, replayability, and strong visual clarity"
  help. Bright, saturated 2D/3D outperforms muted palettes. Drive Mad's first levels "are
  specifically designed to tell the player how the gameplay loop works". Jump Only sells
  satisfaction with "a light trail and debris left behind at each jump".
  https://poki.com/blog/what-makes-high-quality-browser-game
- **[Sourced]** Poki: the first three minutes are critical; players who fail inside them do not
  give the game a second chance. https://www.game-developers.org/22-tips-to-increase-player-retention-in-games-the-definitive-guide
- **[Sourced]** Arcade attract mode is "simultaneously pedagogic and economic ... pseudo-tutorial
  and pseudo-advertisement", built to cut through a noisy room.
  https://rhombical.medium.com/on-desynchronization-96ef8328e9e8 ·
  https://tvtropes.org/pmwiki/pmwiki.php/Main/AttractMode
- **[Sourced]** Griesemer (Halo): "30 seconds of fun that happened over and over"; a 3-second
  loop inside a 30-second loop inside a 3-minute loop, with context changing so no 30 s repeats.
  https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- **[Sourced]** Mobile benchmarks: D1 averages 27% (hypercasual 38–40%); FTUE completion under
  70% loses the funnel; strong FTUE completion doubles D1; median first sessions 5–6 min, top
  quartile 8–9 min. https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies ·
  https://blog.playio.co/mobile-game-onboarding-retention

**[Inference] for TORQUE LIMIT**

- Our loops map cleanly: **3 s** = one exchange (flick, block, counter). **30 s** = one round
  (median 25–35 s per GAME_DESIGN 2.2). **3 min** = a best-of-3 plus rematch. The 3-second
  loop has to be fun on its own before anything else matters; that is the feel track's job, but
  the hook track's job is to make sure the player gets *into* that loop within 10 s of the tab
  opening and *understands* it within one exchange.
- **Boot order matters more than boot time.** Show the lit arena, the idle opponent arm
  breathing, and the show HUD *while* `mujoco.wasm` compiles. Fake nothing about physics; do
  animate the scene (lights sweep, jumbotron cycles, opponent servo-twitches from a canned
  trajectory) so the page is alive at t = 1 s. Target: first pixel of arena ≤ 1.5 s, click-to-
  swing ≤ 6 s on a mid laptop, hard cap 10 s.
- **The title screen is an attract match** (already in GAME_DESIGN 2.2: OVERSHOOT Pro vs
  BACKLASH Pro). Keep it, but cut it to what an arcade would show: 12–20 s of the *best* moments
  (a KO, a last-second steal) from a canned recorded match, replayed bit-exact, with the
  broadcast camera, captions on, and a pulsing "CLICK TO FIGHT". The recorded-match replayer we
  already have makes this free. This is the pseudo-tutorial: the viewer sees a flick land, a
  guard hold, a Core dock, before touching anything.
- **One goal on screen at all times.** In the first match the HUD carries exactly one
  imperative in the show font: "HIT IT", then "DOCK THE CORE", then "HOLD 8 s". Everything else
  (heat, abilities, deflect windows) is hidden until the second match (GAME_DESIGN's `showKit`
  onboarding gates already exist; use them harder).

### 2.2 Onboarding by doing: Portal, Half-Life 2, Celeste

- **[Sourced]** Portal's prologue teaches with on-screen prompts, "no danger at first and
  absolutely no possibility of failure"; Portal 2 onboards progressively rather than with a
  mandatory tutorial scene. https://gdevelop.io/blog/improve-game-tutorials ·
  https://medium.com/@mhkt/portal-2-taught-me-everything-i-know-about-onboarding-4e5abf0310c1
- **[Sourced]** Half-Life 2 replaced a tutorial with progressive onboarding inside the level.
  https://gdevelop.io/blog/improve-game-tutorials
- **[Sourced]** Celeste: no tooltips; the first interaction is a risk-free jump, then a small
  hole, then graduated danger; each room is a tiny self-contained story; failure is cheap
  (instant respawn, single-screen rooms). Thorson's GDC grammar: introduce a movement idea,
  compose difficulty, guide attention, author recovery.
  https://www.pleaseinsertcd.com/lepcismagna/celeste/ ·
  https://www.gdcvault.com/play/1024307/Level-Design-Workshop-Designing-Celeste ·
  https://www.linkedin.com/pulse/3-tips-from-gdc-2017-level-design-workshop-designing-sepehr-pajouhesh
- **[Sourced]** General: introduce one mechanic at a time with spaced repetition; front-loading
  concepts fails. https://gdevelop.io/blog/improve-game-tutorials
- **[Sourced]** Street Fighter 6 defaults new players to Modern controls (six buttons reduced to
  three), which "attracted a lot more new players"; the trade-off is ceiling, accepted.
  https://www.redbull.com/gb-en/street-fighter-6-modern-vs-classic-controls ·
  https://www.dexerto.com/street-fighter/how-to-use-modern-controls-street-fighter-6-2157503/

**[Inference] for TORQUE LIMIT**

- **The first match is the tutorial.** Delete the separate `tutorial` screen and the
  CALIBRATED stamp flow as a *gate*. Keep the JIG behaviours and the OPS captions, but run them
  inside a real best-of-1 that starts the moment the player clicks the arena. Sequence, using
  existing JIG behaviours:
  1. t = 0–8 s: JIG `parked_in_reach`, caption "HIT IT". No failure possible; the range cue is
     lit; the ghost arm is fully visible. Completes on the first strike contact (any speed).
  2. t = 8–20 s: JIG `sparring` at half cadence. Caption "GUARD" appears only when JIG winds up
     (the wind-up is the prompt; Celeste's "small hole"). Completes on the first block.
  3. t = 20–45 s: Core drops within reach, JIG `idle`. Caption "DOCK THE CORE". Grab assist
     and dock magnet at maximum. Completes on lock. Round 1 ends on the lock with a real
     LOCKED slam and crowd. **The player wins round 1 of their first match at ~40 s.**
  4. Round 2: JIG becomes BACKLASH Rookie (slow, readable). Normal rules. The player may lose.
     That loss is the first real lesson, and it lands *after* a win, which is the Portal order.
- **Never more than one new noun per round.** Heat, deflect windows, abilities, pry: not in
  match 1. Match 2 adds deflect (caption on the first parry-able wind-up). Match 3 adds heat.
  The `showKit` gates keyed on `matchesPlayed` do this; the drills (SCOPE-cut) are not needed
  for it.
- **Modern-controls default.** Mouse flick + LMB + RMB + W/S is already SF6-Modern in spirit.
  Make sure the first match needs only mouse and LMB (reach and grip are assisted), and that a
  gamepad's first match needs only stick and two triggers.
- **Failure has to be cheap in the first minute.** No Integrity loss in step 1–3 of the first
  match (JIG never strikes), and the first real loss goes to the post-loss proposal in 2.10.

### 2.3 Self-determination theory in a 90-second match

- **[Sourced]** Ryan, Rigby & Przybylski (2006), four studies: game preferences and continued
  play were predicted by in-game satisfaction of competence, autonomy and relatedness; the PENS
  measure came from this work. https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf ·
  https://selfdeterminationtheory.org/player-experience-of-needs-satisfaction-pens/
- **[Sourced]** Przybylski, Rigby & Ryan (2010): competence needs optimal challenge *and*
  immediate, positive feedback; autonomy needs meaningful choice; presence and need satisfaction
  predict sustained engagement; short sessions with adaptive difficulty still satisfy needs.
  https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf

**[Inference] for TORQUE LIMIT**

- **Competence, per 3-second loop:** every landed hit must return a number the player can
  compare to the last one (IMPACT tag with m/s, already specced). Every block must say
  "BLOCKED" with the newtons absorbed. The player must be able to *feel themselves improving
  inside one match*; the between-round Best Score strip (HARDEST HIT / FASTEST STRIKE) is the
  30-second competence receipt. Add a "vs your best" tick on it.
- **Autonomy, per match:** one real choice before ENGAGE, made in 2 s: loadout (Whip / Anvil /
  Pivot), shown as three physical arms, not a menu. Then in-round choice is genuine: fight for
  KO or race for the Core. Both routes must be viable for a new player or the choice is fake.
- **Relatedness, without multiplayer:** the hosts (ROOK, DR. VALE) talking *about you* by
  callsign; opponents with names and records that remember you ("BACKLASH 3–1 vs you"); and the
  strongest lever available, recorded humans as opponents (2.9).

### 2.4 Flow channel and difficulty ramps

- **[Sourced]** Chen (2006): flow sits between anxiety (too hard) and boredom (too easy); the
  flow zone is wider or narrower per player, so one curve cannot fit everyone; "Active DDA"
  embeds the difficulty choice in the core mechanic so the player adjusts without leaving play.
  https://www.jenovachen.com/flowingames/Flow_in_games_final.pdf ·
  https://gamedev.net/tutorials/_/business/interviews/notes-on-gamedev-jenova-chen-r3061/
- **[Sourced]** EOMM (Chen et al., WWW'17, EA data): churn = no play for 8 h. Risk after the
  last three outcomes: LLL and WWL ~4.9–5.1%; DLW, LLW, LDW, DDD ~2.6–2.7%. Repeated losses
  roughly double churn versus "safer" states.
  https://web.cs.ucla.edu/~yzsun/papers/WWW17Chen_EOMM · https://arxiv.org/pdf/1702.06820
- **[Sourced]** Fall Guys' retention collapse (peak 172k Steam concurrent → ~15k by December;
  13-day median retention on PlayStation) is attributed to instant-death tension for new
  players, no social layer, and "few metagame mechanics that set up long-term goals".
  https://departmentofplay.net/rise-fall-guys-how-to-save-a-hit/

**[Inference] for TORQUE LIMIT**

- **Active DDA already exists in the mechanics; name it.** Loadout (Anvil is slower and
  sturdier), reach distance, and "fight vs dock" are Chen-style embedded difficulty choices. The
  invisible DDA in GAME_DESIGN 5.5 (per-tier targets, loss-streak rule) is the passive layer.
  Keep both; the hook-specific rule is below.
- **The LLL rule.** After two consecutive match losses to the same opponent, the third match
  must be *close* by construction: opponent tier −1, Underdog Dock on from round 1, and the
  host calls it ("Rookie's been watching tape"). A blowout on the third loss is the single most
  likely churn event we can prevent. After LLW, restore the tier silently.
- **Losing must hand the player a smaller, winnable goal.** Fall Guys lost players because a
  loss was just a loss. Our loss screen (2.10) proposes a 30-second goal the player can meet on
  the next try ("land one hook ≥ 0.8 m/s", "hold the Core 4 s").

### 2.5 Near-miss and variable reward

- **[Sourced]** Clark et al. (2009, *Neuron*): near misses recruit win-related striatal
  circuitry and increase motivation to continue, while being rated as unpleasant. Reid (1986)
  and Parke & Griffiths (2004): the effect is stronger when the next attempt is immediate.
  https://www.psychologyofgames.com/2016/09/the-near-miss-effect-and-game-rewards/ ·
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5638081/
- **[Sourced]** Caveat from the same source: the lab evidence is from chance games; in skill
  games a near miss also raises self-efficacy ("I nearly had it, and I know why"), so the
  transfer is plausible but not proven.
- **[Sourced]** Variable-ratio schedules produce the most persistent behaviour and are the
  loot-box mechanism; rare loot triggers larger arousal and urge to open more. They are also
  the ethically contested part of the medium. https://pmc.ncbi.nlm.nih.gov/articles/PMC7882574/ ·
  https://medium.com/design-bootcamp/product-design-and-psychology-the-mechanism-of-skinner-box-techniques-in-video-game-design-5b7315e2d7b4

**[Inference] for TORQUE LIMIT**

- **Design near misses that are true.** No fake margins. But *surface* the real ones: a lost
  round by time shows "INTEGRITY 41 vs 46" in Chivo Mono; a lost lock shows "6.8 / 8.0 s"; a
  KO the player nearly avoided shows "blocked 3 of 4". The rule: every loss screen shows one
  number whose gap to a win is small and named.
- **The physics is our variable-ratio schedule, honestly.** Contact outcomes vary because the
  sim varies (seeded jitter, cube scatter). A hook that sends a cube into the hosts' desk is a
  rare, unscripted, high-arousal event; log "cubes launched" and celebrate ≥ 3 with a caption.
  No loot, no currency, no timers. The chaos stat is the loot.
- **Immediate next attempt** is required for the near-miss pull to work (Parke & Griffiths):
  3.4 s rematch-to-control is fine; a loss screen the player has to read for 8 s is not.

### 2.6 Bragging rights, stat cards, play of the game

- **[Sourced]** Overwatch's Play of the Game: 5 s intro + 12 s of gameplay = 17 s, chosen by
  scoring damage, eliminations, healing and shot difficulty (target speed and distance); the
  hard problem is "to have a computer figure out what is cool"; environmental kills rank high.
  https://overwatch.fandom.com/wiki/Play_of_the_Game ·
  https://www.gamedeveloper.com/design/designing-and-improving-i-overwatch-i-s-play-of-the-game-highlights ·
  https://dotesports.com/overwatch/news/how-does-overwatch-decide-play-of-the-game
- **[Sourced]** Rocket League: MVP is the top scorer on the winning team, +50 points, with a
  podium celebration; post-match shows goals, assists, saves, shots, score.
  https://rocketleague.fandom.com/wiki/Points
- **[Sourced]** THE FINALS: MVP screen ignores which team won; "Best Score" between rounds;
  personal stats before the scoreboard (see `finals-feel.md` 1.5).

**[Inference] for TORQUE LIMIT**

- We already spec a Best-of-Match superlative card with 12 physical stats (`finals-feel.md`
  7.4). The hook change is **selection and framing**: pick the three superlatives *most extreme
  versus the player's own history*, and always include one the loser earned. A loser who sees
  "FASTEST STRIKE 1.62 m/s — NEW PB" has a reason to run it back; a loser who sees "DEFEAT
  0–2" does not.
- **Our POTG is cheap and honest:** the earned-replay selector (KO > last-second steal > lock >
  deciding deflect) already ranks moments. Add the Overwatch "difficulty" weight: contact-point
  speed × (1 + opponent guard-up at impact) × (1 + 0.5 if within 2 s of round end). The
  highest-scored moment becomes the match's clip (2.7).
- **Physics numbers are bragging rights that look true.** "1.42 m/s · 3.1 N · 94 ms reflex"
  reads as a fact about the player, not a game score. Keep them in Chivo Mono everywhere a
  stat is shown; this is the nerd-flex layer that also markets the sim.

### 2.7 Shareable moments: "did you see that", clips, and the Wordle grid

- **[Sourced]** Wordle's spread ran on a spoiler-free emoji grid (invented by a player, then
  built in as a share button) that pasted as text with no link; each grid "tells a story" in
  30 squares. https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html ·
  https://x.com/powerlanguish/status/1471493886031773707
- **[Sourced]** Game Launch Guide's three tests: screenshot test (random frame stops a scroll),
  clip test (five 15-second clips from 30 minutes of play), story test (players say "you won't
  believe what happened"). Viral games share strong visual identity, inherently shareable
  moments, and a concept understood in five seconds. High-arousal emotion (awe, humour) drives
  sharing. https://gamelaunchguide.com/blog/make-indie-game-go-viral-psychology/
- **[Sourced]** On TikTok, bugs, physics glitches and unscripted moments outperform staged
  content; "the clip where something unscripted and funny happens will likely beat the one you
  staged for a month". https://presskit.gg/field-guides/tiktok-indie-game-marketing
- **[Sourced]** Fall Guys hit 1.5 M players in 24 h and 708k Twitch concurrent viewers on the
  back of a TV-show format and comedic, visible failure. https://departmentofplay.net/rise-fall-guys-how-to-save-a-hit/
- **[Sourced]** QWOP: a flailing first attempt "took five seconds and produced genuine
  laughter"; Foddy: frustration "is richer and more interesting than people have given it credit
  for". https://dinogame.gg/blog/history-of-bennett-foddy/ ·
  https://www.killscreen.com/bennett-foddy-baby-steps-interview/
- **[Sourced]** Browser capture is feasible: `canvas.captureStream(fps)` → `MediaRecorder`
  (`video/webm;codecs=vp9` in Chrome, `video/mp4` in Safari) → Blob → download or Web Share.
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream ·
  https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API ·
  https://webrtc.github.io/samples/src/content/capture/canvas-record/

**[Inference] for TORQUE LIMIT**

- **The Bout Card (text, zero effort, no link).** On every post-match, one button `COPY BOUT`
  (also auto-copied on Enter over REMATCH the first time, with a toast). Format, designed to
  survive as plain text in Discord, iMessage, X and Slack:

  ```
  TORQUE LIMIT #0412  PILOT 2–1 BACKLASH
  🟦🟦⬛   1.62 m/s hook · 94 ms reflex · 3 cubes launched
  ```

  Rules: bout number is the daily-seed number (2.8) so it works like "Wordle 180"; the pips
  are rounds (🟦 win, 🟥 loss, ⬛ not played); three stats, the player's best three vs history;
  no URL by default (Wardle's reason: link previews felt spammy). A second line `torquelimit…`
  appears only if the user turns on "include link" in settings.
- **The auto-clip.** We keep a 6 s sim-state ring buffer for replays. Extend it: during the
  earned `match_replay` phase (3.5 s, already rendered from the orbit camera), also record the
  canvas via `captureStream(30)` + `MediaRecorder` into a Blob, ~2–4 MB WebM. Offer `SAVE CLIP`
  and, on mobile Chrome/Safari, `navigator.share({files})`. Overlay the show wordmark and the
  bout number bottom-left so the clip is the ad. Cost: one file, no server. Ponytail note: no
  rolling live recording; only record the replay phase we already render.
- **Design for the funny failure, not just the highlight.** The physics already makes arms
  flail, cubes fly and servos brown out. Make the *loser's* KO slump and any "cube into the
  hosts' desk" event eligible for the match clip (the fail clip is the TikTok clip). Add one
  caption class the hosts use only for chaos: ROOK "THAT'S GOING ON THE SHOW".
- **Screenshot test.** Any random frame must carry: team-colour rim light on two arms, one
  bright volt-yellow Core, the show wordmark, a caption bar. The night-show art bible in
  `duel-primetime.js` is the direct fix; this track only adds: the wordmark and bout number are
  part of the frame, always, so every screenshot is attributed.

### 2.8 Daily challenge, ghosts, medals

- **[Sourced]** Spelunky Daily: one attempt, same seed for everyone, so scores compare
  directly; communities form around beating friends; permadeath plus daily reset makes it
  natural streaming content; the author reached the final level five times after adopting it
  versus never before. https://www.gamedeveloper.com/design/the-understated-genius-of-the-i-spelunky-i-daily-challenge
- **[Sourced]** Trackmania: four medal tiers per track (bronze/silver/gold/author) so every
  skill level has a target; ghosts show how close you are and *how* to improve; after author,
  "drivers near you" then region/country rank; restarts take ~1.5–3 s.
  https://tparkergames.substack.com/p/trackmania-and-the-one-more-run-feeling
- **[Sourced]** Super Meat Boy / Celeste: near-instant respawn removes the punishment for
  dying, so players take risks and learn faster. https://gamevoyages.com/why-is-super-meat-boy-so-difficult/

**[Inference] for TORQUE LIMIT** (SCOPE cut "daily" and "medals"; the versions below are the
minimum that captures the effect, all local, no services)

- **Daily seed as bout number, not a mode.** Every day, `matchSeed = hash(date)` for the
  default quick match against the day's opponent (rotates OVERSHOOT/BACKLASH/DEADBAND, tier by
  the player's record). No separate screen. The Bout Card carries `#0412`. Two people who both
  played today fought the same scatter and the same AI seed; their cards are comparable. That is
  Spelunky's whole trick, for the cost of one hash.
- **Medals as physical thresholds, per opponent, three tiers.** Not cosmetics, not XP:
  BRONZE = beat them; SILVER = beat them 2–0; GOLD = beat them 2–0 with a lock or a clutch
  steal. Shown as three stamps on the opponent's entrant card. The next tier is always visible
  and one match away. This replaces the 20-tier sponsor track that SCOPE cut.
- **Ghost of your best self.** The harness records every match bit-exact. The replay viewer can
  already draw a seat's `sim.ctrl` as a ghost (GAME_DESIGN 3.x). Hook use: in the between-round
  Best Score strip, show your PB strike as a 0.8 s ghost swing beside your current one. Cheaper
  than Trackmania's ghost and it teaches the same thing: *this* is what faster looks like.

### 2.9 Leaderboards vs rivals

- **[Sourced]** Global leaderboards motivate only players who can see themselves near the top;
  friend or segmented boards shrink the pool so winning is attainable; losing to a stranger is
  abstract, losing to someone you know drives action; macro + micro boards give more success
  opportunities. https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/ ·
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8097522/ ·
  https://trophy.so/blog/leaderboards-feature-gamification-examples
- **[Sourced]** Forza Drivatar: an AI "shadow copy of your driving style" wearing a friend's
  name; Drivatars are only really aggressive if they are on your friend list, "so you can
  psychologically project on a friend's behavior and not feel rage as a result of a random bot".
  Later Forzas train the AI independently and just dress it in the friend's name and livery,
  and the effect largely survives. https://www.gamedeveloper.com/design/how-forza-s-drivatar-actually-works ·
  https://gamermatters.com/ai-drivatars-in-new-forza-motorsport-wont-learn-how-to-drive-like-your-friends-so-they-can-drive-better/

**[Inference] for TORQUE LIMIT**

- **No global leaderboard at launch.** We have no server, and a global board of a 90-second
  physics game is noise anyway. The comparison that works is the Bout Card pasted into a group
  chat (micro leaderboard, self-assembled).
- **Recorded humans are the rival system.** A finished match exports a versioned JSON episode
  (SCOPE 2.2). A "replay" policy source already drives a seat from a recorded `sim.ctrl`
  column. Therefore: `CHALLENGE A FRIEND` = export your episode as a `.tl` file; the friend
  drops it on REGISTER ENTRANT and fights *your arm*, with your callsign on the nameplate. It is
  Drivatar without the model: a literal replay of the human, which is honest, and, because
  the friend's inputs differ, the replayed arm will miss and whiff in ways that read as a person.
  Later, the same file trains a policy that plays like you (the ai-opponent track). Every
  challenge file shared is a labelled human demonstration collected: **the social feature is the
  dataset.**
- **Name the bots as people you know.** Records per opponent ("BACKLASH 3–1 vs you") on the
  entrant card, plus one line of host memory at match intro ("Last time this one caught you
  reaching"). Relatedness from the machine's side costs one localStorage record and one caption.

### 2.10 The rematch button, session length, post-match psychology

- **[Sourced]** Rocket League matches are 5 minutes; reviewers describe its "just-one-more-game
  pull" as magnetic; end-of-match has a short grace period that ends early when everyone hits
  ready. https://en.wikipedia.org/wiki/Rocket_League ·
  https://www.gamesradar.com/games/sports/rematch-review/
- **[Sourced]** Fall Guys shows never exceed 3–5 rounds, "easy to jump back into another match
  within seconds"; short gratification offsets long droughts between wins; Mediatonic later
  shortened shows further "letting players play more games in less time".
  https://www.fallguys.com/news/fall-forever-update · https://www.denofgeek.com/games/fall-guys-review/
- **[Sourced]** Trackmania: ~1.5–3 s from crash to driving; friction between attempts is the
  variable, and "constantly give you new goals ... and some hints to reach them".
  https://tparkergames.substack.com/p/trackmania-and-the-one-more-run-feeling

**[Inference] for TORQUE LIMIT**

- Our numbers are already good (87 s standard match, 70 s Fast, 3.4 s rematch-to-control,
  REMATCH focused by default). The missing part is *what the button proposes*. A scoreboard is
  a full stop; a proposal is a comma. See section 3.4.
- **Session shape target:** first session 5–8 minutes = 4–5 matches. That needs: match 1 win
  (tutorial), match 2 close loss or win, match 3 a new opponent or a new noun (deflect),
  match 4 the LLL guard if needed, match 5 a Bout Card copied. Measure it (section 5).

### 2.11 Launch and discovery for a web game

- **[Sourced]** Poki and CrazyGames are "very metric-driven": playtime and conversion decide
  visibility; itch.io is exploration-driven and less metric-gated; polished HTML5 games
  (PolyTrack, Drive Mad) started on itch and were picked up by the portals.
  https://hology.app/blog/web-gaming-1 · https://indiegamebusiness.com/web-gaming-for-indie-developers/
- **[Sourced]** itch front-page tactics (Luden.io): tags matter and are iterated; banner and
  thumbnail first, game visuals adjusted to match the marketing image; a web build is mandatory
  ("not having a web build means losing a lot of potential players"); avoid launching during
  Ludum Dare; ask friends to click the banner early to move from Most Recent to New & Popular.
  https://80.lv/articles/how-this-indie-dev-kept-their-game-on-the-front-page-of-itch-for-an-entire-month
- **[Sourced]** itch ranking is most sensitive in the first week; tag accurately; streamer
  pickup is the usual viral path; add features streamers can share, e.g. letting chat name
  things. https://itch.io/t/58793/indie-dev-story-postmortem
- **[Sourced]** Streamer-mode patterns: chat votes on modifiers, names or controls a
  character; some games do it via chat commands with no OAuth.
  https://www.streamscheme.com/games-with-twitch-integration/ ·
  https://www.setupgamers.com/twitch-integration-games/
- **[Sourced]** Poki hard requirements if we submit: 16:9 scaling, mobile + desktop, localStorage
  in try/catch, no external requests, all assets bundled, skippable intros, visual tutorials,
  Esc/Space pause, `gameplayStart()` on first input. https://developers.poki.com/guide/requirements-quality

**[Inference] for TORQUE LIMIT**

- Launch order: itch.io web build (static export exists) → Reddit r/WebGames and r/robotics
  with the auto-clip as the post → CrazyGames/Poki submission once playtime data looks good.
  Thumbnail = a frame from the night-show bible with two lit arms and the Core.
- **Streamer bait, zero backend:** a `NAME THE CHALLENGER` text field on the entrant card
  (nameplate + host captions use it) and a `CHAT SEED` field (any word → match seed) so a
  streamer can say "chat, give me a word". No Twitch API.
- The **Lab / Register Entrant** flow is itself a hook for the robotics audience: "drop your
  policy, fight it in first person" is a five-second concept. Lead the r/robotics post with
  that, lead the r/WebGames post with the KO clip.

---

## 3. THE ENGAGEMENT LOOP

```
        ┌──────────────── ATTRACT (0 s) ──────────────────┐
        │ lit arena, arms moving, 15 s of best moments    │
        │ replayed bit-exact, CLICK TO FIGHT               │
        └───────────────────┬─────────────────────────────┘
                            ▼ click = swing (≤ 6 s from tab open)
        ┌──────────── FIRST MATCH = TUTORIAL ─────────────┐
        │ HIT IT (8 s) → GUARD (12 s) → DOCK (25 s)       │
        │ round 1 won at ~40 s; round 2 vs BACKLASH Rookie │
        └───────────────────┬─────────────────────────────┘
                            ▼
   ┌───────────────── MATCH (≈ 70–90 s) ───────────────────┐
   │ 3 s loop: flick / guard / counter, every contact       │
   │ returns a number (m/s, N, ms)                          │
   │ 30 s loop: round; Best Score strip vs your PB ghost    │
   └───────────────────┬────────────────────────────────────┘
                       ▼ earned replay (POTG-scored) → auto-clip
   ┌───────────────── VERDICT (≤ 6 s to read) ─────────────┐
   │ WIN: 3 superlatives (≥1 NEW PB) + next medal tier      │
   │ LOSS: one legible near-miss number + one 30 s goal     │
   │ both: Bout Card auto-copied, SAVE CLIP, CHALLENGE FRIEND│
   └───────────────────┬────────────────────────────────────┘
                       ▼ REMATCH (default, 3.4 s to control)
        proposals: RUN IT BACK · WITH A HINT · NEW OPPONENT · SEND CHALLENGE
                       ▼
             LLL guard · daily seed · medal ladder · friend files
                       └──────────► next match (or next day: new #bout)
```

### 3.1 Attract and boot (what the tab shows before the player does anything)

| t | What | Why |
|---|---|---|
| 0.0–1.5 s | Arena shell (lights, deck, HUD frame, wordmark) from a tiny first bundle; wasm compiles behind it | Poki: fun in 10 s; first pixel is the promise |
| 1.5 s | Attract replay: canned recorded match, best 15 s (a KO, a steal), broadcast camera, captions on | Arcade attract mode = ad + tutorial |
| any input | Pointer lock, straight into the first match; no lobby on first launch | Poki: menus kill conversion |
| repeat visits | Title shows the day's bout number, your record vs today's opponent, CLICK TO FIGHT | Spelunky: the daily is the front door |

The first-launch STANDARD/STABLE cockpit question stays, but as a one-key overlay during the
attract replay (press 1 or 2), not a screen.

### 3.2 First match (details in 2.2)

Win round 1 by ~40 s with no possible failure; real round 2 against BACKLASH Rookie. Only mouse
+ LMB required. One imperative caption at a time. Full ghost arm on. Hosts talk *to* the player
by callsign (default callsign "PILOT", editable later).

### 3.3 Inside the match: competence receipts

- Every contact prints a number under the crosshair (speed or force); every block prints
  BLOCKED + N. (Feel track owns the VFX; this track owns that a number appears.)
- Between rounds: Best Score strip with a `vs PB` delta and a 0.8 s ghost of the PB swing.
- Round 2 of any match where the player lost round 1: Underdog Dock on, host line names it.

### 3.4 Verdict screen (replaces "post-match scoreboard")

Read time ≤ 6 s; REMATCH focused; Enter within the first 1.5 s also copies the Bout Card once
(toast: "BOUT COPIED"). Layout, left to right:

1. **Result slab** (VICTORY / SHORTED OUT), round pips, bout number.
2. **Three superlatives** ranked vs the player's history; at least one is the player's, even on
   a loss; NEW PB stamps.
3. **Loss only: the gap.** One number, named: "LOCK 6.8 / 8.0 s", "INTEGRITY 4 LEFT",
   "2 UNGUARDED HOOKS". Under it, one goal for the next match, generated from the loss cause
   (table below).
4. **Win only: the next tier.** "SILVER: beat BACKLASH 2–0" with the stamp outline.
5. **Buttons:** `REMATCH` (default) · `WITH A HINT` (rematch + the goal caption stays on the HUD)
   · `NEW OPPONENT` · `SAVE CLIP` · `COPY BOUT` · `CHALLENGE A FRIEND` (export episode).

Loss cause → next goal (each is one round-scale target, always achievable at the current tier):

| Loss cause (from event log) | Goal caption | Hint on the HUD if chosen |
|---|---|---|
| ≥ 2 unguarded strikes taken | "BLOCK 3 STRIKES" | guard prompt on opponent wind-up |
| lost by lock | "PRY ONCE" / "DOCK FIRST" | Core highlight when unowned |
| KO with < 3 strikes landed | "LAND 3 HITS" | range cue always lit |
| lost by time, margin ≤ 5 | "ONE MORE HIT" | nothing, it's already close |
| lost with 0 hooks ≥ 0.8 m/s | "ONE HARD HOOK" | IMPACT tag shows target speed |

### 3.5 The artifacts (every match mints these, no server)

| Artifact | Cost | Where it goes |
|---|---|---|
| Bout Card (3-line text) | string formatting | clipboard → chats, Reddit, X |
| Auto-clip (3.5 s WebM/MP4 of the earned replay, wordmark + bout number burned in) | captureStream during a phase we already render | download / Web Share → TikTok, Discord |
| Challenge file (versioned JSON episode) | export exists | friend's REGISTER ENTRANT → they fight your arm |
| Episode saved locally | exists | the dataset (human demonstrations) |

### 3.6 Reasons to come back tomorrow (all local)

- New bout number, new seed, rotated opponent; the card says "#0413" so a group chat notices.
- Medal ladder per opponent (3 tiers × 3 opponents = 9 stamps, then user models).
- Any challenge file a friend sent you.
- PB table on the entrant card ("your fastest hook vs BACKLASH: 1.62 m/s").

### 3.7 Guards against churn

- LLL rule (2.4): third consecutive loss is tier −1 with Underdog Dock, host names it.
- First-session rule: no opponent above Rookie until `matchesPlayed ≥ 3` or a 2–0 win.
- Never show a loss screen without a gap number and a goal.
- Never make the player read more than one caption at a time.

---

## 4. What this means for data collection

The business goal is human demonstrations and matches. Every element above increases the
count without asking for anything:

- Every match is recorded already; the loop just raises matches per session (target 4–5) and
  sessions per week (daily seed, medals, challenges).
- Challenge files are *labelled* demonstrations (callsign, loadout, opponent, outcome) that
  players distribute themselves.
- The Bout Card is the consent-friendly ask: a small "Episodes saved locally · share to help
  train the arm" line under `CHALLENGE A FRIEND`, opt-in upload later when there is a server.
- The Lab audience (r/robotics) arrives with policies to test; each Proving Ground match is a
  human-vs-policy episode with a model report attached.

---

## 5. Metrics and targets (instrument before the spectacle pass ships)

| Metric | Definition | Target | Source of target |
|---|---|---|---|
| Conversion to play | first input / tab opens | ≥ 70% | Poki: 72% at 3.7 s load |
| Time to first hit | tab open → first strike contact | ≤ 15 s median | Poki 10 s + one flick |
| First-match completion | reached the verdict screen of match 1 | ≥ 80% | FTUE ≥ 70% doubles D1 |
| Matches per first session | | ≥ 4 | 5–8 min session, 70–90 s matches |
| Rematch rate | REMATCH or WITH A HINT / verdict screens | ≥ 60% | Rocket League-class pull |
| Share rate | COPY BOUT + SAVE CLIP / matches | ≥ 10% | Wordle-style, no ask |
| LLL rate | verdicts shown after 3 straight losses | trending to 0 | EOMM 5% churn state |
| D1 return | same browser, next day | ≥ 30% | mobile avg 27%, hypercasual 38–40% |

All local: a `torquelimit.metrics.v1` ring in localStorage plus an opt-in "send stats" toggle
later. For the first playtests, read them from the console.

---

## 6. Build order (cheapest, highest leverage first)

1. **Verdict screen rewrite** (3.4): superlatives ranked with one guaranteed for the loser,
   gap number, next-goal table, proposal buttons. UI only; the stats exist.
2. **Bout Card + auto-copy** (3.5): string formatting, one toast.
3. **First match = tutorial** (3.2): re-sequence existing JIG behaviours and OPS captions inside
   a real match; delete the tutorial screen gate.
4. **Attract replay from a canned recorded match** (3.1): the replayer exists; record one
   good match and ship the file.
5. **Daily seed as bout number + medal stamps** (3.6): one hash, nine booleans in the profile.
   *Reopens SCOPE's "daily" and "medals" in their smallest form; the owner should confirm.*
6. **LLL guard** (3.7): one rule in the DDA.
7. **Auto-clip** (3.5): `captureStream` + `MediaRecorder` during `match_replay`, Safari MP4
   fallback, Web Share on mobile.
8. **Challenge file** (2.9): export already exists; add the import path to REGISTER ENTRANT
   with the callsign on the nameplate. *Reopens SCOPE's "rival" in its smallest form.*
9. **Streamer fields** (2.11): NAME THE CHALLENGER and CHAT SEED text inputs.
10. Launch on itch with a web build; Reddit posts led by the clip; portals after playtime data.

Everything above is local, needs no service, and adds no dependency.

---

## 7. Sources

- Poki requirements: https://developers.poki.com/guide/requirements-quality
- Poki, what makes a high-quality browser game: https://poki.com/blog/what-makes-high-quality-browser-game
- Defold, best practices for the web (Poki numbers): https://defold.com/2026/06/02/Best-practices-when-building-for-the-web/
- Indie Game Business, web gaming truths: https://indiegamebusiness.com/web-gaming-for-indie-developers/
- Hology, web gaming platforms: https://hology.app/blog/web-gaming-1
- 80.lv, itch front page for a month: https://80.lv/articles/how-this-indie-dev-kept-their-game-on-the-front-page-of-itch-for-an-entire-month
- itch.io postmortem thread: https://itch.io/t/58793/indie-dev-story-postmortem
- Attract mode: https://rhombical.medium.com/on-desynchronization-96ef8328e9e8 · https://tvtropes.org/pmwiki/pmwiki.php/Main/AttractMode
- Griesemer, Half-Minute Halo: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- Portal 2 onboarding: https://medium.com/@mhkt/portal-2-taught-me-everything-i-know-about-onboarding-4e5abf0310c1
- GDevelop, why tutorials fail: https://gdevelop.io/blog/improve-game-tutorials
- Celeste tutorialization: https://www.pleaseinsertcd.com/lepcismagna/celeste/
- Designing Celeste (GDC): https://www.gdcvault.com/play/1024307/Level-Design-Workshop-Designing-Celeste
- SF6 Modern controls: https://www.redbull.com/gb-en/street-fighter-6-modern-vs-classic-controls
- Ryan, Rigby, Przybylski 2006: https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf
- Przybylski, Rigby, Ryan 2010: https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf
- PENS: https://selfdeterminationtheory.org/player-experience-of-needs-satisfaction-pens/
- Chen, Flow in Games: https://www.jenovachen.com/flowingames/Flow_in_games_final.pdf
- EOMM (WWW'17): https://web.cs.ucla.edu/~yzsun/papers/WWW17Chen_EOMM · https://arxiv.org/pdf/1702.06820
- Near-miss effect and game rewards: https://www.psychologyofgames.com/2016/09/the-near-miss-effect-and-game-rewards/
- Counterfactual near-misses: https://pmc.ncbi.nlm.nih.gov/articles/PMC5638081/
- Rare loot rewards and arousal: https://pmc.ncbi.nlm.nih.gov/articles/PMC7882574/
- Overwatch POTG: https://overwatch.fandom.com/wiki/Play_of_the_Game · https://www.gamedeveloper.com/design/designing-and-improving-i-overwatch-i-s-play-of-the-game-highlights · https://dotesports.com/overwatch/news/how-does-overwatch-decide-play-of-the-game
- Rocket League points/MVP: https://rocketleague.fandom.com/wiki/Points · https://en.wikipedia.org/wiki/Rocket_League
- Rematch review (one-more-game pull): https://www.gamesradar.com/games/sports/rematch-review/
- Wordle share grid: https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html · https://x.com/powerlanguish/status/1471493886031773707
- Viral psychology and the three tests: https://gamelaunchguide.com/blog/make-indie-game-go-viral-psychology/
- TikTok for indie devs: https://presskit.gg/field-guides/tiktok-indie-game-marketing
- Fall Guys rise and fall: https://departmentofplay.net/rise-fall-guys-how-to-save-a-hit/ · https://www.fallguys.com/news/fall-forever-update · https://www.denofgeek.com/games/fall-guys-review/
- Foddy / QWOP: https://dinogame.gg/blog/history-of-bennett-foddy/ · https://www.killscreen.com/bennett-foddy-baby-steps-interview/
- Canvas capture: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream · https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API · https://webrtc.github.io/samples/src/content/capture/canvas-record/
- Spelunky Daily: https://www.gamedeveloper.com/design/the-understated-genius-of-the-i-spelunky-i-daily-challenge
- Trackmania one more run: https://tparkergames.substack.com/p/trackmania-and-the-one-more-run-feeling
- Super Meat Boy respawn: https://gamevoyages.com/why-is-super-meat-boy-so-difficult/
- Leaderboards: https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/ · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8097522/ · https://trophy.so/blog/leaderboards-feature-gamification-examples
- Forza Drivatar: https://www.gamedeveloper.com/design/how-forza-s-drivatar-actually-works · https://gamermatters.com/ai-drivatars-in-new-forza-motorsport-wont-learn-how-to-drive-like-your-friends-so-they-can-drive-better/
- Streamer integration patterns: https://www.streamscheme.com/games-with-twitch-integration/ · https://www.setupgamers.com/twitch-integration-games/
- Mobile retention benchmarks: https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies · https://blog.playio.co/mobile-game-onboarding-retention
- Retention guide (first three minutes): https://www.game-developers.org/22-tips-to-increase-player-retention-in-games-the-definitive-guide
