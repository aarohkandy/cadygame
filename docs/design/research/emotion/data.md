# Play as data collection: the TORQUE LIMIT data product

Track: emotion / "play as data". Written 2026-09-24 against branch `fps-duel`. Companion docs:
`hooks.md` (retention loop; its section 4 hands off to this file), `expressive-ai.md` (the opponent's body
language; section 6 here feeds it labels), `../ai-opponent.md`, `../../GAME_DESIGN.md` section 5,
`../../SCOPE.md` section 2.

The business goal is not the game. The game is the front door for two datasets: **human demonstrations
on an SO-101 plant** (for policy training) and **human-vs-AI matches** (for evaluating and training the
opponent). This file says what one match must record, which design choices raise the value of what is
recorded, how contributing is made to feel good, and how the bytes get from a browser to a LeRobot
dataset on a hub.

Tags: **[S]** sourced (URL in section 10). **[Code]** read from the repo today. **[P]** proposal.

---

## 0. TL;DR

1. **[Code]** We already record more than any crowdsourced game dataset in the literature: per-tick
   observation/action for both seats, the human's *pre-shaping* command, per-step ctrl, every event, and
   checkpoints that make the match **bit-exact re-simulable**. That last property is the whole product:
   MineRL's packet-level recording let them re-render every trajectory with new cameras and lighting
   **[S]**; ours does the same, so **camera images cost nothing at play time and can be rendered later
   on homebase at any resolution, from any camera, with any lighting.** Do not render images live.
2. **The fun physics is not the robot's physics.** Arcade runs 2x torque, strike hulls and servo states;
   `to_lerobot.py` refuses it without `--allow-arcade` **[Code]**. Every match still yields opponent-eval
   data and human *intent* (task-space command) data, but **SO-101 policy data must come from stock
   physics**: Proving Ground duels and, above all, 20-second drills run under Demo physics.
3. **Drills are the dataset; duels are the reason to do drills.** The 5.11 tasks (`dock_core`, `stack`,
   `keep_away`) are exactly the pick-place-under-disturbance data that trains an arm. Frame them as
   a 60 s **SYSTEMS CHECK** before the first match of a session (and as the daily), scored on the quality
   metrics we already compute, so players optimise the same thing the training pipeline wants.
4. **Diversity beats count.** Scaling-law work found generalisation follows a power law in the number of
   environments and objects, and plateaus at ~50 demos per environment-object pair; 32 pairs x 50 demos
   (~1600) gave ~90% success on novel scenes **[S]**. Translate: seeded start poses, Core and cube
   positions, opponent personality and tier, and (offline) lighting and camera pose are our "environments".
   Target **~1600 clean drill demos per task** = ~9 h of play across a few hundred players.
5. **Quality must be visible and rewarded, not filtered silently.** Atari Grand Challenge got its best
   policies from the **top 5%** of contributors **[S]**; robomimic found a single proficient operator beats
   a multi-human mix **[S]**; RoboCrowd found leaderboard users gave **more and higher-quality** demos
   **[S]**. We compute jerk, chatter, table hits, near-limit dwell, LDLJ and reaction latency already
   **[Code]**. Show them as a **CLEAN RUN** stamp and rank on it.
6. **Standardise behaviour where you want a policy, vary it where you want coverage.** Scaling-law and
   LeRobot guidance both say to keep grasp behaviour consistent across collectors early **[S]**. Drills
   teach one canonical sequence via JIG; duels are the free-play half (play data covers ~4x the
   interaction space of task demos for the same time **[S]**).
7. **Failure and retry are data, not garbage.** Play-data policies learned retry-till-success from
   unsegmented play **[S]**; HIL/DAgger recovery + correction segments are what fixes a policy's real
   failure modes **[S]**. Never drop a lost round; label it. Re-open TAKE OVER later as intervention
   recording.
8. **The contribution loop is "your data trained the thing you fight".** Weekly (later nightly) train a
   **CORNER** policy on homebase from uploaded stock-physics demos; ship it as an opponent with a visible
   build stamp: *CORNER v12, 1,204 demos from 87 pilots, 9 of them yours*. Foldit credits players as
   co-authors **[S]**; MineRL paid in in-game currency proportional to reward **[S]**. Ours: a public
   contributor roll under callsigns, and WATTS credit weighted by quality seconds.
9. **Consent is one screen, plain language, withdrawable in one tap, and version-stamped in the
   episode** (GDPR art. 7 **[S]**). Nothing identifying is ever stored: no email, no IP in the episode, a
   random resettable pilot id, callsign optional. Export and delete are buttons on the Replays screen.
10. **Upload path:** `.tlep.json` (gzip, ~12 MB per 3-round match, ~1 MB per drill) POSTed to a small
    receiver; homebase pulls, **re-simulates bit-exact as the anti-tamper and anti-corruption gate**
    (already implemented **[Code]**), scores quality, converts with `to_lerobot.py`, and pushes a LeRobot
    v3 dataset to the Hub. The verifier is the spam filter; nobody hand-labels.

---

## 1. What is recorded today (audit)

`src/game/harness/recorder.ts`, `episode-format.ts`, `contracts.ts` (`EpisodeMeta`, `Episode`),
`episode-store.ts`, `stats.ts`, `determinism.ts`, `tools/export/to_lerobot.py`. Format `torquelimit.episode/3`,
one JSON document, every typed column as exact little-endian bytes in base64.

| Recorded per control tick (50 Hz) | Notes |
|---|---|
| `observation.{state,self_ext,opponent_state,game,environment_state,contacts}.{atlas,blaze}` | the full obs/3 blocks, both seats |
| `observation.delivered.*` | what a delayed policy actually saw (only with fair delay) |
| `action.{seat}` f64[6], `action_raw.{seat}` | applied and returned targets |
| `intents.{seat}` u8, `policy.status/compute_ms/chunk_*` | |
| `human.command.{seat}` f32[6] = (psi, theta, r, phi, rho, g) | **the human's intent before shaping**: the only real "what did the pilot mean" signal |
| `human.shaping.{seat}` u8 bitfield | leash, guard blend, jab macro, charge, grab assist, dock magnet, aim assist |
| `human.display_latency_ms` | input to presented frame |
| per-step `sim.ctrl`, `sim.intents` (RLE), `sim.mutations`, `sim.checkpoints` every 50 ticks | makes physics re-sim bit-exact, including human seats |
| `events[]` | strike, graze, deflect, clash, whiff, ko, lock, steal, dda, loss_streak, joint_limit_violation, table_hit, ... (50+ kinds) |
| `meta` | seed streams, preset, physics mode, timing, fair delay, seat drivers/personality/tier, input shaping, rules, full tuning + sha, servo params hash, tolerances, provenance (MuJoCo version, model sha, so101 sha, commit, user agent, contracts, obs schema hash), result |

Storage: IndexedDB `episodes_human` (never evicted) and `episodes` (1 GB cap). Export: File System Access
API bundle, then `to_lerobot.py --seat --align --units` produces one LeRobot episode per round with
`observation.state`, `action`, `next.reward`, `next.done`, `task` string, and a `torquelimit` block in
`meta/info.json`. `determinism.ts` verifies an episode by re-simulation and reports BIT-EXACT or DIVERGED.

**What is missing for a data product** (each fixed in section 4):

- No session/player identity at all, not even an anonymous one; no consent record; no input device
  (mouse vs gamepad vs touch), viewport, or frame-rate record.
- No raw input (mouse dx/dy, buttons, stick axes). `human.command` is post-input-mapping.
- No task/round labels beyond `preset` and the opponent name; drills produce `task` events but no
  natural-language `task` string in meta.
- No human-supplied labels (what were you trying to do, did the opponent feel human).
- No quality score attached to the episode; stats exist but are computed in the Replays screen only.
- No idle/AFK segmentation.
- No images (cut by SCOPE 2.2, correctly; section 4.3 says how to get them for free).
- No upload path, no server, no dataset licence text.

---

## 2. What makes a demonstration valuable (the field, with numbers)

### 2.1 Diversity over count

- **Data scaling laws (Lin et al. 2024) [S]:** policy generalisation follows a power law in the number of
  environments (exponent about -0.27 to -0.30) and objects (-0.42 to -0.43); once demos per
  environment-object pair reach the threshold, more demos do little. Recipe: **32 pairs x 50 demos =
  ~1600 demos per task, "one afternoon of four collectors", ~90% success in unseen scenes.** About 90% of
  raw demos survived their validity filter; they explicitly **standardised behaviour patterns and completion
  times across collectors** to avoid multimodal data.
- **DROID [S]:** 76k trajectories, 350 h, 564 scenes, 86 tasks, 50 collectors, 13 institutions, 1,417
  calibrated camera viewpoints; the claim is that scene and viewpoint diversity is what produced robustness.
- **Open X-Embodiment [S]:** pooling 22 embodiments / 1M+ trajectories gave +50% over per-dataset
  training in the small-data regime. Our SO-101 data is directly co-trainable with the existing SO-100/101
  community datasets on the Hub if it is in LeRobot v3 with standard feature names.
- **Play data (Lynch et al. 2019) [S]:** unsegmented, unlabelled teleop "play" covered ~4x the interaction
  space of task demos per hour, and play-trained policies learned retry-till-success. The duel *is* play
  data; do not try to segment it into tasks at record time, label it in hindsight.
- **Interactive Language [S]:** 2,700 h from 10 operators, then 64 crowd annotators did **hindsight
  relabelling** (mark start/end of a coherent behaviour, describe it); annotation was the bottleneck (18% of
  raw data labelled at train time). Lesson: any label the game can attach *at play time from game state*
  (phase, Core state, who held what, event stream) is worth more than a label added later.

### 2.2 Quality: who is demonstrating matters more than how many

- **robomimic (Mandlekar et al. 2021) [S]:** 200 demos from one proficient operator beat 300 from six
  mixed operators on every task; history-dependent policies (BC-RNN) beat Markov BC on human data because
  humans are non-Markovian; **dropping the wrist camera cost 10 to 45%**; validation loss does not predict
  success, so **policy selection needs rollouts** (our Lab suites are exactly that).
- **Atari Grand Challenge [S]:** 45 h / 9.7M frames / 2,367 scored episodes crowdsourced through a
  browser emulator with progress bars against the top human and DQN. Training on the **top 5% of
  contributors** beat training on everything. Episodes with zero score were discarded.
- **MineRL [S]:** 500+ h, 1,002 sessions, 60M state-action pairs. Recorded **packet-level** so every
  trajectory can be re-simulated and re-rendered with altered lighting and camera; tracked **no-ops and
  deaths** as quality metrics; "expert" defined by completion time matching 5+ year players.
- **VPT (OpenAI) [S]:** contractors at $20/h via Upwork, ~4,500 h collected (~$90k), **1,962 h used**;
  20 Hz, 640x360 video plus a JSONL of timestamped keypresses and mouse deltas, uploaded in 5-minute
  chunks. An IDM trained on ~100 h already plateaued, and labelled data was "two orders of magnitude"
  more valuable per hour for the IDM than for BC. Lesson for us: **raw input plus rendered frames is the
  cheapest, most reusable label**; a few hundred hours of clean data is a real asset.

### 2.3 Crowdsourced teleop specifically

- **RoboTurk [S]:** phone-as-6DoF-controller through a browser was statistically as fast as VR
  controllers; 2,200 demos / 137 h in 20 h of platform time; poor networks did not ruin demos.
- **COBALT (2026) [S]:** 7,500+ demos / 50+ h in 5 days across 9 countries with phones, 20 Hz,
  sub-100 ms; **a structured user-training curriculum significantly improved quality**, and real-time
  metrics auto-filtered bad demos.
- **RoboCrowd (2024) [S]:** a robot in a cafe for 2 weeks; 231 users, 817 episodes. Only 54% of time was
  on the preset tasks, 36% was free play, 10% tutorial. Three incentive levers with measured effects:
  material reward (users spent 2x the time on the candy they preferred), intrinsic challenge (4.2x the
  time on the harder bag task at equal reward), and **social comparison: leaderboard visitors gave
  significantly more demos (p<0.001) of higher quality (p<0.05)**. Crowd data as pre-training gave up
  to +20% after expert fine-tuning. They scored every transition 0 (play) to 3 (clean).
- **LeRobot recording guidance [S]:** at least 50 episodes, 10 per object location, cameras fixed,
  consistent grasping, "you should be able to do the task yourself from the camera images alone", add
  variation only after the basic policy works, 30 fps, two views preferred, feature names
  `observation.images.<location>` not device names, task strings 25 to 50 characters, and the recorder
  reports achieved cadence because a 25 Hz session that claims 30 makes the recorded motion faster than
  reality. **HIL/DAgger [S]:** record policy segments and human intervention segments in one continuous
  episode; interventions are split into *recovery* (back to a good state) and *correction*.

### 2.4 Why people contribute

- **Games with a purpose [S]:** people play for entertainment; the computation is a side effect. The
  game has to be good on its own or the data stops.
- **Foldit [S]:** 57,000 players credited in the 2010 Nature paper; a 15-year-old protease structure
  solved in ~10 days; leaderboards for individuals *and groups*, shared "recipes", and players listed as
  paper co-authors and on PDB depositions. Credit is a currency.
- **Duolingo [S]:** a 7-day streak makes course completion 3.6x more likely; two streak freezes instead of
  one raised DAU +0.38%; milestone animations raised day-7 return +1.7%. Slack beats rigidity.
- **Consent (GDPR art. 7) [S]:** consent must be demonstrable, presented distinguishably in plain language,
  freely given, and **as easy to withdraw as to give**. Zooniverse and MineRL both put informed consent on
  one web page before any recording; MineRL's was IRB-approved.
- Motion-capture and EEG game datasets (LaFAN1: 5 subjects, 30 fps, 4.6 h, BVH, CC BY-NC-ND **[S]**)
  are small, lab-collected, and licence-restricted; the GAMEEMO EEG page could not be fetched. The point
  for us: those datasets are valuable *because* they are precisely timestamped and synchronised with the
  stimulus. Our sim time is the clock for everything, so we get that for free; keep `timestamp` = sim time.

---

## 3. The central tension: fun physics versus robot physics

Arcade (the game people will play) runs `arena-arcade.xml` with strike hulls, 2x torque cap, servo
states, guard blend, jab and charge macros, dock magnet and aim assist, hit-stop that freezes the sim
clock. A policy trained on Arcade ctrl is out of distribution on a real SO-101, which is why
`to_lerobot.py` refuses Arcade by default and every Arcade model report carries the sticker **[Code]**.

What each preset's human data is good for:

| Preset | Physics | Human shaping | Good for |
|---|---|---|---|
| ARCADE | arcade | all | opponent eval and training (game AI, DDA, personality tuning); human *intent* trajectories (`human.command`); reaction-time and strategy statistics; attract clips |
| PROVING GROUND | stock | pose-only leash, guard blend, assists (recorded) | honest human-vs-model; SO-101 data with assists flagged per tick, usable after masking shaped ticks |
| DEMO / HARNESS tasks | stock | none (assists recorded if toggled) | **the SO-101 training set** |

**[P] Resolution: two lanes, one game.**

1. **Drill lane (SYSTEMS CHECK):** the 5.11 tasks under stock physics, 20 s each, no shaping, before the
   first match of a session and as the daily. This is where policy data comes from. It looks like the
   show (same arena, hosts, HUD), it just does not lie about the plant.
2. **Duel lane:** Arcade for feel; every match still records everything. Duels feed the opponent, the
   balance suites, and the intent dataset. Proving Ground is offered when a user model is seated and as
   a "STOCK NIGHT" variant later.

Do not try to make Arcade honest. Do make Proving Ground *feel* better by moving the juice that does not
touch the sim (render-side hit flash, sound, camera shake, captions) to full strength there; GAME_DESIGN
4.10 already allows sound, sparks, markers and shake at x0.5, and none of them change ctrl.

---

## 4. The data product: what a single match must record

Extend `torquelimit.episode/3` -> `/4`. Everything below is additive; the re-sim verifier is untouched.

### 4.1 Session block in `meta.session` **[P]**

```
session: {
  pilotId: string,          // random UUID v4, generated once, stored in localStorage, RESET button in settings
  callsign: string | null,  // optional, <= 12 chars, filtered; shown on the contributor roll
  consent: { version: "2026-09-24-a", grantedAt: ISO, scope: "local" | "share" },
  device: { input: "mouse" | "gamepad" | "touch", pointerLock: boolean, viewport: [w, h], dpr: number,
            fpsP50: number, fpsP95: number, gpu: string | null },  // WEBGL_debug_renderer_info if allowed
  build: { gitSha, appVersion, form: "web" | "pwa" | "electron" | "capacitor" },
  sessionIndex: number,     // nth session of this pilot
  matchIndexInSession: number,
  skillPrior: 0..4 | null   // one tap on first launch: "never played a shooter" .. "competitive"
}
```

No IP, no email, no user agent string beyond what provenance already stores (keep it; it is not identifying
on its own). `pilotId` is the *only* join key across episodes and is resettable by the player.

### 4.2 New per-tick columns **[P]**

| Column | Type | Why |
|---|---|---|
| `human.raw.{seat}` | f32[8]: mouse dx, dy (px), buttons bitfield, keys bitfield, stick lx, ly, rx, ry | VPT's lesson: raw input is the reusable label. Lets us re-derive `command` under a future input mapping and train an inverse-dynamics model from renders. 32 bytes/tick, 216 KB per 3-round match. |
| `human.active.{seat}` | u8 | 1 when any raw input changed in the last 500 ms; AFK segmentation and MineRL-style no-op metric |
| `human.gaze_hint.{seat}` | f32[2] | cockpit yaw/pitch; where the pilot was looking (first-person camera is the only "gaze" we have) |
| `dda.k` | f32 | already in policy debug; promote to a column so difficulty is a training feature |

`human.command` stays: it is the task-space intent (aim direction, reach, roll, grip), the cleanest
"what the human meant" signal any dataset here has.

### 4.3 Images: render later, never live **[P]**

SCOPE cut live policy cameras. Keep that. Because every episode re-simulates bit-exactly, **`qpos` per
control tick is enough to render any camera afterwards**. On homebase, `python -m mujoco` loads the same
`arena.xml`/`so101.xml` (sha in provenance) and `mujoco.Renderer` renders `atlas_wrist_cam`, an
overhead at 0.9 m fovy 50, and the front broadcast camera at 224x224 or 480x640 from the recorded state,
at decision rate, into MP4 per camera, exactly the layout LeRobot v3 wants (`videos/observation.images.wrist`).
This gives three things the live path never could: any resolution, **lighting and camera-pose
randomisation per episode** (our version of DROID's 1,417 viewpoints), and a re-render when the art changes.
Cost at play time: zero. The robomimic result (wrist camera worth 10 to 45%) says the wrist view is the one
to render first.

### 4.4 Labels attached from game state at record time **[P]**

- `meta.rounds[i].task`: a 25 to 50 character string per round, generated, e.g.
  `"dock the core vs BACKLASH pro"`, `"stack cube_0 on cube_2"`, `"keep the core from JIG"`.
- `meta.rounds[i].outcome`, `reason`, `durationS`, `coreLockedBy`, `stealCount` (from events).
- Segments derived from events and `game` block: `carry` (self holds Core), `contest` (both gripping),
  `guard`, `attack` (attack_onset .. contact/whiff), `idle`. Written to `sparse.segments` as
  `{frame_index, kind, end_frame}` so hindsight relabelling is free.

### 4.5 Labels from the human, one tap each, never mandatory **[P]**

After each round, on the existing round-summary screen, under the stats: **one** question, rotating:

- "What were you going for?" -> RUSH / BAIT / TURTLE / CORE / MESSING AROUND (5 stickers; 1 tap).
- "Did OVERSHOOT feel like a person?" -> 1 to 5 hearts. This single label is the training signal for
  `expressive-ai.md` and the only honest measure of the emotion verdict.
- "Rate your own run" -> CLEAN / SLOPPY (compared against the computed CLEAN RUN, calibrates self-report).

Store in `sparse.labels`. Skip is always allowed; the question disappears after 2 s of no input.

### 4.6 Quality score computed at match end, stored in `meta.quality` **[P]**

All from `stats.ts` metrics that exist **[Code]**: action jerk (rad/s^3 on 20 ms series), chatter,
near-limit dwell, torque saturation, table hits > 3 N, self-collisions, LDLJ per attack, reaction latency
median, accuracy, plus new: `activeFrac` (from `human.active`), `fpsP95`, `displayLatencyP50`.

```
clean = tableHits == 0 && selfCollisions == 0 && nearLimitDwell < 0.05 && chatter < 2/s
        && activeFrac > 0.85 && fpsP95 >= 45 && displayLatencyP50 < 60 ms
tier  = clean ? (ldljMean > -8 && jerk < p50_of_reference ? "A" : "B") : (activeFrac > 0.5 ? "C" : "D")
```

Thresholds are placeholders to be set from the first 200 episodes; the point is that the *same* numbers
are shown to the player (section 6) and used by the exporter (`--min-tier B`). RoboCrowd's 0 to 3 scale
and the Atari top-5% result both say tiering is worth more than any single filter.

### 4.7 Size and cadence

A 3-round Arcade match is <= 12 MB `.tlep` by the size gate; the JSON form with base64 is ~1.35x that
before gzip and about the same after. A 20 s drill at 50 Hz is ~1,000 rows: ~0.6 MB gzipped. Sim time
is the timestamp everywhere; the recorder never resamples, and `to_lerobot.py` refuses to resample
silently **[Code]**, which matches LeRobot's cadence warning **[S]**.

---

## 5. Design choices that raise data value

### 5.1 SYSTEMS CHECK: drills as the front door of every session **[P]**

60 seconds, three 20 s drills, stock physics, no shaping, scored:

| Drill | Setup (seeded) | Score shown | What it trains |
|---|---|---|---|
| DOCK | Core at a seeded reachable spot; JIG idle | time to dock, CLEAN stamp | reach, grasp, carry, place |
| STACK | cube_0 and cube_2 seeded | time to stable stack | precision place, release |
| KEEP AWAY | pilot holds Core; JIG sweeps | seconds untouched | grasp under disturbance, evasive re-planning |

Variation per run: start pose of the arm (one of 8 seeded rest poses, recorded as the `reset` mutation),
Core and cube positions in a 20 x 20 cm seeded grid, JIG sweep pattern. That is our
environment-object grid: **8 poses x 4 object zones = 32 conditions x 50 demos = 1,600 per drill**, the
scaling-law recipe **[S]**. The hosts call it: ROOK hypes the timer, DR. VALE reads the LDLJ and the
peak speed. It doubles as the tutorial (SCOPE cut drills as a retention feature; this is drills as
onboarding plus dataset, which is a different justification and one minute of screen time).

Consistency rule (from LeRobot and the scaling-law paper **[S]**): JIG demonstrates the canonical DOCK
motion once (approach from above, close, lift 3 cm, translate, lower, open, retract). Players who copy it
get CLEAN faster. Diversity comes from the seeds, not from technique, until the first CORNER policy works.

### 5.2 The Core race is manipulation under adversarial disturbance

Every duel round already forces reach, grasp, carry, dock and steal under an opponent's interference.
Segment labels (4.4) turn those into `carry`/`contest` episodes for free. Keep the Core race central; a
pure strike game would produce far less manipulation data.

### 5.3 Record-a-demo mode with a reason: TRAIN YOUR CORNER **[P]**

The Lab's DEMO preset exists on paper (SCOPE says optional). Give it a reason: **your demos become an
opponent**. Cheapest implementation first: the `replay` driver already plays a recorded `sim.ctrl`
**[Code]**; the second cheapest is a nearest-neighbour policy over the pilot's own drill demos (obs ->
closest recorded state -> its next action chunk), which runs in the Worker without training. Then the real
one: a weekly ACT fine-tune on homebase (CPU is enough for ACT on 6-DoF low-dim data at this scale;
image policies wait for a GPU quota). The player fights "PILOT-<callsign> CORNER v3" and sees it do the
thing they taught it. That is the "your data trained this" moment, and it is honest.

### 5.4 Loss and retry stay in

Never discard a lost round or a failed drill. Play data's value is in retries **[S]**; the segments
carry `outcome`. The exporter's default keeps them with `next.reward` and `task` as now.

### 5.5 Re-open TAKE OVER as intervention recording (later) **[P]**

SCOPE cut TAKE OVER. The HIL/DAgger doc **[S]** describes exactly what it should become: watch your
CORNER fight, press a key when it is about to fail, take control (recovery, then correction), give control
back, all in one episode with `human.intervening` flags. This is the highest-value data per second any
robot lab collects, and the harness's fast-forward replay of a policy (GAME_DESIGN 5.9.3) is the hard
part already designed. Build it after the CORNER exists.

### 5.6 Opponent data from duels

Every Arcade match is a labelled human-vs-AI sample: personality, tier, DDA k trace, the pilot's rating
(4.5), and the outcome. This is the training set for the invisible DDA (per-tier targets in 5.5) and for
the expressive-AI tuning. Store `dda.k` per tick and the `dda` events; export a second, tiny dataset
(`matches.parquet`: one row per round) alongside the LeRobot one.

---

## 6. The contribution loop

### 6.1 The ask (one screen, first launch, after the first match, not before)

> **HELP TRAIN THE ARM.** Every match is recorded on your device as robot data (joint angles, your
> inputs, what happened). Share it and it trains the CORNER opponents everyone fights, and goes into a
> public robot dataset under your callsign. We never store your name, email, or IP. Change your mind
> any time in Settings: SHARE OFF and DELETE MY DATA.
> [ SHARE MY MATCHES ]   [ KEEP LOCAL ]

Both buttons are the same size. `scope: "share"` is written into every episode recorded after that.
Withdrawal sends a delete request keyed by `pilotId`; the server deletes raw episodes and drops the pilot
from the next dataset build (published dataset versions are immutable, which the consent text says).

### 6.2 What the player sees back

- **Title screen:** `DATASET: 4,812 demos from 391 pilots · CORNER v12 trained 3 days ago`.
- **Post-match:** the CLEAN RUN stamp (or SLOPPY with the one reason: "3 table hits"), `+140 WATTS`,
  and the line `9 of CORNER v12's demos are yours`.
- **WATTS** = quality-weighted seconds: tier A 2.0/s, B 1.0/s, C 0.3/s, D 0. Not spendable; it is the rank
  on the CONTRIBUTORS board (callsigns), which is the social-comparison lever RoboCrowd measured **[S]**.
  Rank on WATTS, not wins: it rewards clean drills over beating a bot.
- **CORNER stamp:** every opponent that was trained on shared data shows `TRAINED ON 1,204 DEMOS`.
  When the player beats a CORNER, ROOK says it was trained on their own data; DR. VALE says how many.
- **Contributor roll:** a page listing callsigns with demo counts, and a `CITATION.cff` on the dataset
  naming the roll. Foldit's co-authorship is the model **[S]**; at our scale it is a roll, not a byline.
- **Streak:** the daily SYSTEMS CHECK. 7 days -> a foil sticker on the Bout Card. Two freezes per week,
  automatic **[S]**. No streak on duels; the streak is the drill, because the drill is the data.

### 6.3 Metrics to watch (the business dashboard on homebase)

demos/day by tier, WATTS/day, share opt-in rate (target > 40%; RoboCrowd got 200+ volunteers with candy),
drill completion rate, drills per session, D1/D7 return, CORNER win rate vs humans by version (the only
number that proves the loop closed).

---

## 7. Export and upload path

### 7.1 Local (exists) **[Code]**

Replays screen -> EXPORT HUMAN DEMOS -> directory of `.tlep.json` -> `python tools/export/to_lerobot.py
*.tlep.json --seat atlas --align applied --units range_m100_100 --out ./ds` -> LeRobot v3 dataset.
Add `--min-tier`, `--task-filter drill:*`, and a `--render-cameras wrist,overhead` flag that calls the
MuJoCo renderer of 4.3.

### 7.2 Upload **[P]**

- **When:** at the end of the post-match screen, in the background, with a small progress arc on the
  Bout Card; never blocks rematch. `sendBeacon` and `fetch keepalive` cap at 64 KB, so use a normal
  `fetch` and, when the tab closes first, a queue in IndexedDB drained on the next visit (a service
  worker Background Sync where available; the PWA has a service worker already).
- **What:** `gzip(.tlep.json)` with `Content-Type: application/json`, `Content-Encoding: gzip`, plus
  headers `X-TL-Pilot`, `X-TL-Consent`, `X-TL-Episode`. Cap 16 MB per request; reject otherwise.
- **Where:** homebase cannot receive from the public internet (the public IP is firewalled to the home
  address, and opening a port needs explicit confirmation). Use an object store with a tiny receiver in
  front: a Cloudflare Worker + R2 bucket (free tier covers early volumes) that writes
  `raw/<date>/<pilotId>/<episodeId>.json.gz` and answers `202` with the id. Homebase pulls the bucket
  hourly over its own outbound connection. No secrets in the client; the Worker rate-limits per pilotId
  (30/h) and checks magic + size.
- **Ingest on homebase (tmux `tl-ingest`, `~/work/torque-limit-data/`):**
  1. `episodeFromJson` validation (typed columns, lengths) -> reject to `quarantine/`.
  2. **Re-simulate and verify** with the headless runner: DIVERGED means corrupted, tampered, or a build
     mismatch; keep only BIT-EXACT. This is the whole anti-garbage layer and it exists.
  3. `stats.ts` -> quality tier (4.6); write `quality.parquet`.
  4. Weekly: `to_lerobot.py` over tier A/B stock-physics episodes -> `torquelimit/so101-drills-v<N>` and
     `torquelimit/so101-duels-v<N>` on the Hub, CC BY 4.0, `robot_type: so101`, features named
     `observation.state`, `action`, `observation.images.wrist|overhead|front`, tasks from 4.4; plus
     `matches.parquet` for the opponent data. Run `finalize()` before push **[S]**.
  5. Train CORNER on the drill dataset; ship the checkpoint into `public/policies/corner-v<N>.js`
     (or as a bridge policy for the Lab) with the demo count and pilot count in its metadata.
- **Retention:** raw uploads kept 90 days then deleted; published datasets are immutable; a delete
  request removes the pilot's raw files immediately and from the next build. Locally, after a `202` ack,
  keep the most recent 20 human episodes and let the rest be evicted (today `episodes_human` is never
  evicted, which will fill phones).

### 7.3 Licence and the promise

Dataset licence CC BY 4.0 with the contributor roll as attribution. The consent text says exactly this.
Model weights trained on it: same. Nothing in an episode identifies a person; the `userAgent` string in
provenance is stripped to browser family and major version at ingest.

---

## 8. Build order (cheapest first, each step ships value alone)

1. `meta.session` + consent flag + `human.raw` + `human.active` + `dda.k` columns; quality tier at match
   end using `stats.ts`; CLEAN RUN stamp on the round summary. (`recorder.ts`, `contracts.ts`,
   `stats.ts`, round-summary screen.) Half a day.
2. SYSTEMS CHECK: wire the three 5.11 tasks as a 60 s pre-match flow under Demo physics with seeded
   grids and the JIG canonical demo; `task` strings per round; segment labels from events. One to two
   days; the task rules and suite configs exist.
3. One-tap labels on the round summary (4.5). Hours.
4. Upload: Worker + R2, client queue, ingest script on homebase with verify + stats + `to_lerobot.py`.
   One to two days. Publish dataset v1 as soon as 100 tier-A drills exist.
5. CORNER v1 = nearest-neighbour over shared drill demos in the policy Worker; CORNER stamp and title
   counter. One day. Then ACT on homebase (CPU) for v2.
6. Offline MuJoCo camera renderer for the export (4.3). One day, Python only.
7. Streak + contributor roll + WATTS board. One day.
8. TAKE OVER as intervention recording (5.5). Later, after CORNER v2.

---

## 9. What this does for the owner's verdict

None of this is lore. The player sees: a one-minute warm-up that scores how *cleanly* they move, a stamp
that says CLEAN, an opponent that visibly gets better because of them, a number on the title screen that
goes up, and a roll with their callsign on it. That is the "being seen" that `finals-alive.md` calls the
frame doing the emotional work, applied to the dataset instead of the crowd. And every one of those
elements raises the value of what is recorded.

---

## 10. Sources

- LeRobotDataset v3: https://huggingface.co/docs/lerobot/main/en/lerobot-dataset-v3
- LeRobot recording tips, cadence, HIL: https://huggingface.co/docs/lerobot/main/en/il_robots ·
  https://huggingface.co/docs/lerobot/main/en/hil_data_collection
- LeRobot "what makes a good dataset": https://huggingface.co/blog/lerobot-datasets
- Data Scaling Laws in Imitation Learning for Robotic Manipulation (Lin et al. 2024):
  https://arxiv.org/abs/2410.18647 · https://arxiv.org/html/2410.18647v1
- What Matters in Learning from Offline Human Demonstrations (robomimic, Mandlekar et al. 2021):
  https://robomimic.github.io/study/ · https://arxiv.org/abs/2108.03298
- DROID: https://droid-dataset.github.io/
- Open X-Embodiment: https://robotics-transformer-x.github.io/
- Learning Latent Plans from Play (Lynch et al. 2019): https://arxiv.org/abs/1903.01973
- Interactive Language (Lynch et al. 2022): https://arxiv.org/abs/2210.06407
- RoboTurk (Mandlekar et al. 2018): https://arxiv.org/abs/1811.02790
- RoboCrowd (2024): https://arxiv.org/abs/2411.01915
- COBALT (2026): https://arxiv.org/abs/2605.19138
- Atari Grand Challenge (Kurin et al. 2017): https://arxiv.org/abs/1705.10998
- MineRL (Guss et al. 2019): https://arxiv.org/abs/1907.13440
- VPT (Baker et al. 2022): https://arxiv.org/abs/2206.11795 · https://openai.com/index/vpt/ (403 at fetch time)
- Foldit: https://en.wikipedia.org/wiki/Foldit (Nature 2010 paper paywalled at fetch time)
- Games with a purpose: https://en.wikipedia.org/wiki/Human-based_computation_game
- Duolingo streak: https://blog.duolingo.com/how-duolingo-streak-builds-habit/
- GDPR Article 7: https://gdpr-info.eu/art-7-gdpr/
- LaFAN1 mocap dataset: https://github.com/ubisoft/ubisoft-laforge-animation-dataset
- Galaxy Zoo motivations (Raddick et al. 2009): https://arxiv.org/abs/0909.2925 (abstract only; full text not fetched)
- Not fetched: GAMEEMO EEG dataset page (Kaggle returned no content); Zooniverse privacy page (empty).
