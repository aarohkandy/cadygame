# TORQUE LIMIT harness

TORQUE LIMIT is a game and a verification harness for SO-101 robot policies. Every match can be recorded,
exported, re-simulated bit for bit, scored with the same statistics, and turned into a LeRobot dataset. This page
is the reference for policy authors and for anyone reading an episode file.

Contents: [Entrants](#entrants) · [Presets](#presets) · [Seats and timing](#seats-and-timing) ·
[Observation](#observation-torquelimitobs3) · [Local bridge](#local-bridge) · [Recording](#recording) ·
[Replay and verify](#replay-and-verify) · [Statistics and the verdict](#statistics-and-the-verdict) ·
[Smoke suite and CLI](#smoke-suite-and-cli) · [Calibration](#calibration) · [LeRobot export](#lerobot-export) ·
[Storage](#storage) · [Limits](#limits)

## Entrants

A policy enters as one of:

| Kind | What you provide | Runs in |
|---|---|---|
| Module | a single `.js`/`.mjs` exporting `act(obs)` and optionally `reset(ctx)`, `policyName`, `provenance` | a module Worker in the browser; in-process in Node |
| Trajectory | `.json` `{ "fps": 1–240, "frames": [[6 rad], ...] }`, at most 100,000 frames, linearly interpolated | sampler |
| Bridge | a local Python process speaking `torquelimit.bridge/2` | WebSocket (HTTP fallback) |
| Built-in | OVERSHOOT, BACKLASH, DEADBAND, JIG at Rookie, Contender, Pro, Champion | the same runner as a module |

`act` returns six absolute joint targets in radians, or `{ targets, intents, chunk, chunkHz, chunkStartT,
intentChunk, debug, info }`. `public/policies/example-policy.js` is a complete example.

**Register Entrant** (Entrants screen) runs: FILE PARSED, EXPORTS act(), RESET OK, COLD ACT (the first act, timed
alone), 200 FIXTURE ACTS with p99, ACTIONS FINITE, WITHIN LIMITS, DETERMINISTIC (a warning when not). A registered
file is kept across reloads under an id derived from its kind and SHA-256; registering the same file again updates
its name and keeps its registration date.

**CHECK POLICY DETERMINISM** (the Lab) feeds the policy the same 200 observations twice from the same seed and
compares every returned number exactly. The observations come from a real stock-physics sweep of both arms, so they
cross reach, extension, and contact. Modules get `Math.random`, `Date.now`, and `performance.now` replaced by
seeded, sim-time versions; bridges receive the seed in `reset` and must seed themselves.

## Presets

| | ARCADE | PROVING GROUND | HARNESS |
|---|---|---|---|
| Physics | `arcade` (strike hulls, loadouts, servo states) | stock `arena.xml` | stock `arena.xml` |
| Timestep, control | 2.5 ms, 50 Hz (8 steps) | 5 ms, 50 Hz (4 steps) | 5 ms at 50 Hz; 1/600 s at 30 or 60 Hz |
| Scoring | full | physical: raw × zone × tool | physical |
| Human seat | yes | yes (leash, guard blend, assists; no macros) | no |
| Hit stop, dilation, comebacks | on | off | off |
| Report stamp | ARCADE PHYSICS · NOT VERIFICATION | CLEARED FOR BROADCAST or POLICY FAULT | CLEARED FOR BROADCAST or POLICY FAULT |

A policy is verified only in PROVING GROUND and HARNESS. ARCADE doubles torque and adds game states, so a
stock-trained policy is out of distribution there by design.

## Seats and timing

- Seats are `atlas` (left mount, world x = −0.32) and `blaze` (right, x = +0.32, rotated π). A human is always
  `atlas`.
- The control tick is 50 Hz. A policy decides every `decimation` ticks (default 2, so 25 Hz). With
  `actionDelayTicks` d (default 1), a reply applies at the first tick at least d after the request and after it
  arrived.
- **Live** (a human is seated): the sim never waits. No reply within 500 ms of wall time is `timeout`; three in a
  row disconnect the seat. A new decision tick before the reply holds the last action and logs `late`.
- **Eval** (no human): lockstep. The sim waits for every reply; over 500 ms is logged `slow` and changes nothing;
  30 s with no reply ends the episode as `policy_hang`.
- **Fair delay:** when a human faces a module, trajectory, or bridge, that policy's observations come from 120 ms
  in the past (Lab: 0–200 ms). Built-in opponents model their own perception lag instead.
- **Chunks** apply by sim time. `until_next_decision` (default) discards the rest at the next decision;
  `full_chunk` suppresses requests until consumed; `n_steps` runs k ticks. `temporalEnsembleM` blends every chunk
  covering a tick with weights `exp(−m·i)`.
- **Warm-up:** 8 unrecorded acts within 60 s before the first real act.
- **Seeds:** each seat gets `substream(matchSeed, "seat", seat, round)`; physics jitter uses
  `substream(matchSeed, "physicsInit", round)`. Both are in the episode meta under `seedStreams`.

## Observation `torquelimit.obs/3`

Each seat observes from its own base: origin at its mount on the table plane, +x toward the opponent base, +z up.
Blaze's frame is a 180° rotation about z, so one policy plays either seat. Quaternions are wxyz with w ≥ 0.
The machine-readable schema, with every index, unit, and description, is `public/schemas/torquelimit.obs-3.json`
(its SHA-256 is sent as `obs_schema_hash`).

| Block | Size | Contents |
|---|---|---|
| `state` | 12 | `q` (6, rad), `qd` (6, rad/s); LeRobot `observation.state` / `observation.velocity` |
| `self_ext` | 32 | EE pos (3, ego m), EE quat (4), EE linvel (3), wrist pos (3), τ (6, N·m), ctrl (6, rad), last applied action (6), gripper opening (1, 0–1) |
| `opponent_state` | 28 | opponent q (6), qd (6), EE pos (3), EE quat (4), EE linvel (3), elbow pos (3), wrist pos (3) |
| `game` | 16 | integrity fractions, phase time left, fight flag, sudden death, rounds-won difference, Core lock-in (signed fraction, full / 8, live), touching, and Arcade-only heat, public charge, servo states, guard |
| `environment_state` | 81 | 9 cubes × (pos 3, quat 4, parked, held by: +1 self / −1 opponent / 0) |
| `contacts` | 20 | 4 newest contact events since the last observation × (kind, attacker, zone, normal speed, age) |

The opponent's command, ghost arm, and assists are never observable.

## Local bridge

`tools/bridge/torquelimit_bridge.py` is a standard-library server; `tools/bridge/example_policy_server.py` is a
working policy on top of it. See `tools/bridge/README.md` for running, writing your own, and the rules. The
protocol, in order: `hello` → `hello_ok` (name, version, claimed SHA-256, provenance, chunk support); per round and
seat `reset` (seed, full reset context) → `reset_ok`; `warmup` followed by 8 acts flagged `warmup`; per decision
`act` (the six blocks as arrays, plus `obs` when the server asked for `dict`) → `action` with the same `id`;
`ping`/`pong`; `error` (optionally `fatal`); `bye`.

## Recording

Every match is recorded (the attract loop is not). An episode is one JSON document,
`torquelimit.episode/4` (`/3` still imports), file extension `.tlep.json`:

```jsonc
{
  "format": "torquelimit.episode/4",
  "meta": { /* seeds, preset, timing, seats, tuning table + SHA-256, servo params hash, tolerances, provenance, result,
              /4: session (non-fingerprinting device block, consent), opponentMemory, rounds (task, segments, outcome), quality (tier, version) */ },
  "columns": { "timestamp": { "dtype": "f64", "length": 6750, "b64": "..." }, "...": {} },
  // /4 columns per pilot seat: human.raw.<seat> f32[8], human.active.<seat> u8, human.gaze_hint.<seat> f32[2]; dda.k.<seat> f32 for every seat
  "shapes": { "observation.state.atlas": [12], "timestamp": [] },
  "steps": { "ctrl": { "steps": {}, "values": {}, "width": 12 }, "intents": { "steps": {}, "values": {}, "width": 2 },
             "mutations": [ /* reset (with SimState), place_cube, servo_profile, timestep, offline */ ],
             "checkpoints": [ { "step": 0, "state": {}, "checksum": 0 } ] },
  "sparse": { "sim.segments": [ /* one entry per engine reset */ ] },
  "events": [ /* every GameEvent with its physics step */ ]
}
```

Every typed array is `{ dtype, length, b64 }`: the exact little-endian bytes, base64. float64 stays float64 and
float32 stays float32, NaN payloads and −0 included. Plain-number fields that JSON cannot hold (NaN, ±Infinity, −0)
are written as `{ "$num": "NaN" }`. Nothing is rounded.

**Rows.** Row *i* is control tick *i* of the match. Observations are sampled after the last physics step of tick
*i* − 1 and before any ctrl write of tick *i*. `action.<seat>` is the target in effect over [tᵢ, tᵢ₊₁); for human
and proxy seats (ctrl changes every step) it is the ctrl at the tick's first step, and the full per-step ctrl is in
`steps.ctrl`.

| Column | dtype | Notes |
|---|---|---|
| `timestamp`, `frame_index`, `episode_index`, `index` | f64, u32, u32, u32 | `timestamp` is sim time within the round |
| `round`, `phase`, `discontinuity` | u8 | phase = index in `MATCH_PHASES`; discontinuity bits 1 reset, 2 cube teleport, 4 servo profile |
| `observation.<block>.<seat>` | f32[n] | every block, both seats |
| `observation.delivered.<block>.<seat>` | f32[n] | only for a seat with a fair delay: what the policy actually received |
| `action.<seat>` | f64[6] | applied target |
| `intents.<seat>` | u8 | guard 1, charge 2, grip 4, overdrive 8, ability 16, burst 32, as accepted by rules |
| `action_raw.<seat>` | f64[6] | policy seats: the returned target, on the row it arrived; NaN elsewhere |
| `policy.request_frame_index.<seat>` | i32 | on arrival rows: the row whose observation was sent; −1 elsewhere |
| `policy.obs_frame_index.<seat>` | i32 | every row: source row of the observation behind the action in effect; −1 when holding |
| `policy.chunk_id.<seat>`, `policy.chunk_index.<seat>` | i32, i16 | executed chunk and entry; −1 when none |
| `policy.status.<seat>` | u8 | ok 0, held 1, late 2, timeout 3, clamped 4, error 5, slow 6 |
| `policy.compute_ms.<seat>` | f32 | on arrival rows; NaN elsewhere |
| `human.command.<seat>`, `human.shaping.<seat>` | f32[6], u8 | human and proxy seats: pre-shaping command (ψ, θ, r, φ, ρ, g) and shaping bits (leash 1, guard blend 2, jab macro 4, charge windup 8, grab assist 16, dock magnet 32, aim assist 64) |
| `human.display_latency_ms` | f32 | input sample to presented frame; NaN in Node |

**Per-step streams** are what re-simulation consumes: `steps.ctrl` (step, 12 ctrl values) written whenever any
ctrl changes, `steps.intents` (step, atlas bits, blaze bits) on change, `mutations` with their step, and a checkpoint
(full `SimState` plus FNV-1a checksum of qpos ∥ qvel ∥ ctrl) every 50 control ticks. Engines may number steps from
zero every round, so `sparse["sim.segments"]` records, for each engine reset, where that round starts in every
stream (`firstTick`, `ctrlIndex`, `intentsIndex`, `checkpointIndex`, `mutationIndex`) and how many steps it ran.
An event's row is `segment.firstTick + floor((event.step − segment.resetStep) / stepsPerControlTick)`, taking the
segment of the round most recently announced by a `phase` event.

**Alignment.** To pair what a policy saw with what it did: for every row *i* with `policy.request_frame_index` r ≥ 0,
the policy was handed `observation.delivered.*[r]` (or `observation.*[r]` when no delivered column exists) and
returned `action_raw[i]`. In eval timing r can equal i (the reply arrives within the tick).

## Replay and verify

**Replays** (Replays screen, replay viewer): scrub, 0.25× to 4×, frame step (`,` `.`), event markers, broadcast and
cockpit cameras, target ghost (the recorded ctrl), and the brain panel (a policy's `debug` output). Poses are exact:
the viewer re-simulates the episode through the verify path a few milliseconds per frame and caches the state at
every control tick; until a tick is ready it shows the nearest earlier exact state.

**VERIFY** re-simulates on a fresh engine and rules: restore each round's recorded reset state; then for every
physics step apply that step's Core placements, servo profile changes from the regenerated rules, the recorded ctrl
and intents; step; run the rules. It compares the joints against the recorded observation at every control tick,
the full checksum at every checkpoint, the regenerated Core placements and servo mutations against the recorded
ones, and every regenerated rules event against the recorded event, in order. The result is **REPLAY VERIFIED ·
BIT-EXACT** or **DIVERGED AT t = 12.34 s (frame 617)** with the first mismatch. Human episodes verify too (their
ctrl is recorded per step); the badge verifies physics and rules, not the human. An episode recorded with a
different model file or MuJoCo version is refused rather than reported as diverged.

## Statistics and the verdict

Statistics are a pure function of the episode (`src/game/harness/stats.ts`): damage, deflects, and heat come from
recorded events, never from the current tuning. Tolerances are stored in each episode's meta.

| Metric | Definition |
|---|---|
| Physical damage | Σ `physicalDamage` of strikes and grazes |
| Strikes, grazes, crits, approach speed | event counts; median and p90 of attacker `vN` over strikes |
| Attack attempts | attacker EE speed toward the nearest point of the victim's guard volume (capsule camera mount → shoulder, r 0.06 m) > 0.35 m/s for ≥ 40 ms, debounced 150 ms |
| Accuracy | strikes / attempts |
| Physical block rate | attempts received with no strike on the defender within 400 ms / attempts received |
| Reaction latency | first tick within 800 ms where the defender's EE velocity changes by > 0.25 m/s in a direction that increases the predicted minimum distance (0.3 s horizon) between the attacker's EE ray and the defender's guard volume. Raw and net of structural latency (decision period + action delay + fair delay; display latency for humans). Anticipation: raw < structural + 100 ms |
| Core | lock-in seconds held (from the game block), steals, late steals (≤ 2.0 s left), locks |
| Reliability | late, timeout, error, clamped fractions of decision ticks; 1 − their sum |
| Violations | returned targets beyond a joint limit by more than 1e-5 rad, per joint; max overshoot |
| Near-limit dwell, torque saturation | fraction of live ticks with any joint within 0.03 rad of a limit; with any \|τ\| ≥ 0.98 × 2.94 N·m |
| Action jerk, chatter | on the applied action resampled to 20 ms (per-tick mean of per-step ctrl for humans): RMS third difference / h³; sign changes of Δa over 0.01 rad per joint per second |
| LDLJ | log dimensionless jerk of the EE velocity over each attack, averaged |
| Energy | Σ\|τⱼ·qdⱼ\|·dt over live ticks |
| Arcade block | scored damage, guarded chips, deflects and hard deflects, late guards, whiffs and whiff punishes (strike within 1 s), mean heat, cutouts, staggers, bursts, heavy attempts and successes, built-in heavy parry attempts and successes |

NaN (null in JSON) means no sample, or a quantity this recording does not carry.

**CLEARED FOR BROADCAST** (stock presets, per policy seat) when all hold: 0 errors; 0 timeouts in a live match or
0 hangs in an eval match; late fraction under 2%; 0 limit violations; fewer than 5 table hits over 3 N; the
determinism check, if run, did not diverge. Otherwise **POLICY FAULT: <first failing reason>**, e.g. `3 ERRORS`,
`LATE 2.4%`, `5 TABLE HITS`, `REPLAY DIVERGED`. ARCADE episodes always carry **ARCADE PHYSICS · NOT VERIFICATION**.

**Aggregates:** the seed is the unit. A seed's score is its mean result over its matches; the win rate is the mean
over seeds with a 95% bootstrap interval over seeds (10,000 seeded resamples), written like
`63% (54–71) · 50 SEEDS`.

## Smoke suite and CLI

`smoke-v1`: seeds 1–3 × Contender × both seats, HARNESS, eval, best of 3, DDA off. Seed 1 faces OVERSHOOT,
seed 2 BACKLASH, seed 3 DEADBAND.

```bash
npm run eval -- --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke
node scripts/eval.mjs --suite smoke-v1 --policy builtin:deadband:pro --seat blaze --seeds 1-3
node scripts/eval.mjs --suite smoke-v1 --policy ws://127.0.0.1:8765 --out .eval/bridge
```

The output directory gets one `.tlep.json` per match, `torquelimit-index.json`, and `results.json` (win rate with
interval, per-opponent breakdown, failure rates, per-match stamps, provenance hashes, gates). Gates: every match
completes, no policy hangs, no policy errors, and the first episode re-simulates bit-exact (`--no-verify` skips it).
Exit 0 when every gate passes, 1 when a gate fails or a match cannot run, 2 on bad arguments.

## Calibration

`tools/bridge/calibration.py` maps simulation radians to LeRobot SO-101 units using joint ranges. Defaults come
from `so101.xml`. Arm joints: `range_m100_100` = 100 · (q − mid) / half-range; `degrees` = q · 180/π. Gripper:
100 · (q − lo) / (hi − lo).

| Pose | Units | shoulder_pan | shoulder_lift | elbow_flex | wrist_flex | wrist_roll | gripper |
|---|---|---|---|---|---|---|---|
| MJCF zero `[0, 0, 0, 0, 0, 0]` | range_m100_100 | 0 | 0 | 0 | 0 | 0 | 9.0909 |
| Guard `[0, −0.62, 1.08, −0.48, 0, 1.15]` rad | range_m100_100 | 0 | −35.5234 | 63.9053 | −28.9494 | 0 | 68.9910 |
| Guard | degrees | 0 | −35.5234 | 61.8794 | −27.5020 | 0 | 68.9910 |

A real arm's calibrated range is not the model's. To use yours: in LeRobot, read each joint's present position in
degrees at both mechanical ends, convert to radians, write `{"shoulder_pan": [lo, hi], ...}` to a JSON file, and pass
it as `--calibration` to the exporter or load it with `Calibration.from_json`.

## LeRobot export

```bash
python tools/export/to_lerobot.py .eval/smoke --seat blaze --out ./ds --dry-run      # numpy only: validates every frame
python tools/export/to_lerobot.py episode.tlep.json --seat blaze --out ./ds --repo-id you/torquelimit-duels
```

- One LeRobot episode per round, fight and sudden-death rows only; timestamps start at 0 and step by 1/fps.
- Features: `observation.state` (6) and `action` (6) in `--units` (default `range_m100_100`), `next.done`,
  `next.reward` (change in damage dealt − taken while the frame's action is in effect, / 100, and ±1 on the last
  frame for the round's winner and loser), `phase`, `discontinuity`, the task string (`duel vs BACKLASH Contender ·
  harness`). `--with-velocity` adds `observation.velocity`; `--with-game` adds `observation.opponent_state`,
  `observation.game`, `observation.environment_state`.
- `--align decision` (default for policy seats) pairs each returned action with the observation the policy received,
  at the seat's decision rate. `--align applied` pairs every tick with the applied action at 50 Hz, the only choice
  for human seats. Errored replies are skipped. The exporter never resamples; mixing episodes with different physics,
  timestep, control rate, or servo parameters is refused.
- ARCADE episodes are refused without `--allow-arcade`.
- `meta/info.json` gains a `torquelimit` block: physics mode, preset, timestep, control rate, servo parameter hash,
  tuning hash, input shaping, fair delay, units, alignment, MuJoCo version, obs schema hash, source episode ids.

The real writer needs `lerobot==0.4.0` (pinned in `tools/export/requirements.txt`), which pulls in torch. Build and
load the dataset on the homebase server (set up the `homebase` SSH alias from the server runbook first):

```bash
rsync -a .eval/smoke/ homebase:~/work/torquelimit/episodes/
rsync -a tools/ homebase:~/work/torquelimit/tools/
ssh homebase 'mkdir -p ~/work ~/logs && cd ~/work/torquelimit && python3 -m venv .venv \
  && .venv/bin/pip install -r tools/export/requirements.txt \
  && .venv/bin/python tools/export/to_lerobot.py episodes --seat blaze --out ./ds \
  && .venv/bin/python -c "from lerobot.datasets.lerobot_dataset import LeRobotDataset as D; d = D(\"torquelimit/duels\", root=\"./ds\"); print(d.num_episodes, d.num_frames, d[0][\"observation.state\"])"'
```

Local checks that need no lerobot or torch:

```bash
python -m pip install numpy websockets pytest
python -m pytest tools/bridge tools/export
```

## Storage

In the browser, episodes live in IndexedDB `torquelimit`. Episodes with a human or proxy seat are never evicted.
Other episodes share a 1 GB cap: a save that would pass it names how many of the oldest unpinned episodes it would
remove (**WILL EVICT N**) and does nothing until you confirm. Pinned episodes are never evicted. **EXPORT** writes
the `.tlep.json` file; importing one checks the format string, every dtype, and every length, and names the field
that is wrong. Registered entrants are stored alongside and survive reloads.

## Limits

- **File size.** Every per-tick block for both seats is stored as base64 of its bytes. A three-round, 45 s-per-round
  ARCADE match with a human seat measures about 25 MB of JSON (bot-vs-bot HARNESS smoke matches: 7–11 MB). The
  in-browser copy is the binary structured clone, roughly three quarters of that.
- **Not recorded:** optics impulse on the camera mount and self-collision onsets are not in the recording, so those
  statistics are null. Episodes can carry them as sparse columns `physics.optics_impulse.<seat>` and
  `physics.self_contacts.<seat>`, which the statistics read when present.
- **Verify coverage.** Rules gating is rebuilt from the recorded phase events. The two rules switches that no phase
  event marks (live-timing sudden death going live after its intro, and the pointer-lock protection hold) verify
  exactly only when the match recorded them in the sparse column `rules.control` (`{ step, round, live }` or
  `{ step, round, protected: { seat, on } }`).
