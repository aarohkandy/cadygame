"""LeRobot exporter checks that need only numpy (BUILD_PLAN D12). The real LeRobotDataset load runs on homebase."""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import to_lerobot as tl  # noqa: E402

CONTROL_HZ = 50
TIMESTEP = 0.005
SPT = 4
FIGHT = tl.MATCH_PHASES.index("fight")
KO = tl.MATCH_PHASES.index("ko")
INTRO = tl.MATCH_PHASES.index("round_intro")


def enc(arr, dtype):
    a = np.ascontiguousarray(arr, dtype=np.dtype(tl.DTYPES[dtype]))
    return {"dtype": dtype, "length": int(a.size), "b64": base64.b64encode(a.tobytes()).decode()}


def build_episode(physics="harness", preset="harness", blaze_driver="module", rounds=((1, 60, "blaze"), (2, 40, "atlas"))):
    """Two rounds: 5 intro rows, N fight rows, 5 KO rows each. Blaze decides every 2 ticks with delay 1."""
    rows = []
    segments = []
    events = []
    for rnd, fight_rows, winner in rounds:
        first = len(rows)
        segments.append({"frame_index": first, "value": {"round": rnd, "seed": rnd, "resetStep": 0, "firstTick": first,
                         "ctrlIndex": 0, "intentsIndex": 0, "checkpointIndex": 0, "mutationIndex": 0, "steps": 0, "lastStep": -1}})
        events.append({"type": "phase", "t": 0, "step": 0, "phase": "round_intro", "round": rnd, "finalRound": False})
        local = 0
        for phase, n in ((INTRO, 5), (FIGHT, fight_rows), (KO, 5)):
            for _ in range(n):
                rows.append((rnd, phase, local))
                local += 1
        # A strike by blaze on atlas in the middle of the fight, and one by atlas.
        mid = 5 + fight_rows // 2
        events.append({"type": "strike", "t": mid / CONTROL_HZ, "step": mid * SPT + 1, "attacker": "blaze", "victim": "atlas",
                       "damage": 31, "physicalDamage": 12.5, "tier": "strike"})
        events.append({"type": "strike", "t": (mid + 3) / CONTROL_HZ, "step": (mid + 3) * SPT, "attacker": "atlas", "victim": "blaze",
                       "damage": 20, "physicalDamage": 5.0, "tier": "strike"})
    n = len(rows)
    cols = {}
    shapes = {}

    def put(name, arr, dtype, shape=()):
        cols[name] = enc(arr, dtype)
        shapes[name] = list(shape)

    put("timestamp", [r[2] / CONTROL_HZ for r in rows], "f64")
    put("frame_index", list(range(n)), "u32")
    put("round", [r[0] for r in rows], "u8")
    put("phase", [r[1] for r in rows], "u8")
    put("discontinuity", [1 if r[2] == 0 else 0 for r in rows], "u8")
    for seat in ("atlas", "blaze"):
        state = np.zeros((n, 12), dtype=np.float32)
        state[:, 1] = np.linspace(-0.6, 0.4, n)          # a recognizable joint signal: shoulder_lift ramp
        state[:, 7] = 0.5
        put(f"observation.state.{seat}", state, "f32", (12,))
        put(f"observation.self_ext.{seat}", np.zeros((n, 32)), "f32", (32,))
        put(f"observation.opponent_state.{seat}", np.full((n, 28), 0.25), "f32", (28,))
        put(f"observation.game.{seat}", np.zeros((n, 16)), "f32", (16,))
        put(f"observation.environment_state.{seat}", np.zeros((n, 81)), "f32", (81,))
        put(f"observation.contacts.{seat}", np.zeros((n, 20)), "f32", (20,))
        action = np.tile(np.array([0.1, -0.5, 0.9, -0.3, 0.0, 1.0]), (n, 1))
        action[:, 0] = np.arange(n) * 0.001
        put(f"action.{seat}", action, "f64", (6,))
        put(f"intents.{seat}", np.zeros(n), "u8")
    raw = np.full((n, 6), np.nan)
    req = np.full(n, -1)
    for i in range(1, n, 2):                               # decision at i-1, arrival at i (delay 1)
        req[i] = i - 1
        raw[i] = [0.2, -0.4, 0.8, -0.2, 0.0, 1.1]
        raw[i, 1] = -0.6 + i * 0.001
    raw[7] = np.nan                                         # an errored reply
    put("action_raw.blaze", raw, "f64", (6,))
    put("policy.request_frame_index.blaze", req, "i32")
    put("policy.obs_frame_index.blaze", np.maximum(req, -1), "i32")
    put("policy.status.blaze", np.zeros(n), "u8")
    put("policy.compute_ms.blaze", np.where(req >= 0, 1.5, np.nan), "f32")
    seats = {
        "atlas": {"driver": "builtin", "name": "BACKLASH", "tier": "contender", "personality": "backlash", "loadout": "anvil",
                  "decisionHz": 25, "policySha256": None, "claimedSha256": None, "provenance": None, "policyDeterministic": "unchecked",
                  "chunkExecute": "until_next_decision", "temporalEnsembleM": None, "inputDevice": None},
        "blaze": {"driver": blaze_driver, "name": "my_policy.mjs", "loadout": "pivot", "decisionHz": 25, "policySha256": "ab" * 32,
                  "claimedSha256": None, "provenance": None, "policyDeterministic": True, "chunkExecute": "until_next_decision",
                  "temporalEnsembleM": None, "inputDevice": "keyboard_mouse" if blaze_driver == "human" else None},
    }
    meta = {
        "format": tl.EPISODE_FORMAT, "episodeId": "2026-09-16T12:00:00.000Z-beef", "created": "2026-09-16T12:00:00.000Z",
        "controlHz": CONTROL_HZ, "timestep": TIMESTEP, "seed": 1, "seedStreams": {}, "preset": preset, "physics": physics,
        "scoring": "full" if physics == "arcade" else "physical", "timing": "eval", "actionDelayTicks": 1, "fairDelayMs": 0,
        "strictLimits": False, "seats": seats, "inputShaping": {"atlas": None, "blaze": None}, "rules": {"roundLengthS": 45, "bestOf": 3},
        "tuning": None, "tuningSha256": "t" * 64, "servoParamsHash": "s" * 64, "tolerances": {},
        "provenance": {"mujoco": "3.12.0", "modelFile": "arena.xml", "modelSha256": "", "so101Sha256": "", "harnessCommit": "dev",
                       "userAgent": "test", "contracts": "3.0.0", "obsSchemaHash": "sha256:x"},
        "result": {"winner": "blaze", "roundsWon": {"atlas": 1, "blaze": 1}, "forfeit": None, "determinism": "unchecked", "error": None,
                   "rounds": [{"round": r, "winner": w, "reason": "ko", "tEnd": 1.0} for r, _n, w in rounds]},
    }
    empty = {"dtype": "u32", "length": 0, "b64": ""}
    return {
        "format": tl.EPISODE_FORMAT, "meta": meta, "columns": cols, "shapes": shapes,
        "steps": {"ctrl": {"steps": empty, "values": {"dtype": "f64", "length": 0, "b64": ""}, "width": 12},
                  "intents": {"steps": empty, "values": {"dtype": "u8", "length": 0, "b64": ""}, "width": 2},
                  "mutations": [], "checkpoints": []},
        "sparse": {"sim.segments": segments}, "events": events,
    }


def run_export(doc, **kw):
    ep = tl.Episode(json.loads(json.dumps(doc), object_hook=tl._exact_numbers), "fixture")
    writers = []

    def make(fps, features):
        w = tl.ValidatingWriter(fps, features)
        writers.append(w)
        return w

    opts = tl.ExportOptions(kw.pop("seat", "blaze"), **kw)
    result = tl.export([ep], opts, make)
    return result, writers[0], ep


class ExportTest(unittest.TestCase):
    def test_match_phases_mirror_the_contracts(self):
        with open(os.path.join(ROOT, "src/game/contracts.ts"), encoding="utf-8") as fh:
            src = fh.read()
        block = src[src.index("export const MATCH_PHASES"):src.index("] as const;", src.index("export const MATCH_PHASES"))]
        self.assertEqual(tuple(re.findall(r'"([a-z_]+)"', block)), tl.MATCH_PHASES)

    def test_one_episode_per_round_with_decision_alignment(self):
        result, w, _ep = run_export(build_episode())
        self.assertEqual(result["episodes"], 2)
        self.assertEqual(result["align"], "decision")
        self.assertEqual(result["fps"], 25.0)
        self.assertTrue(w.finalized)
        for frames in w.episodes:
            ts = [float(f["timestamp"]) for f in frames]
            self.assertEqual(ts[0], 0.0)
            self.assertTrue(all(b > a for a, b in zip(ts, ts[1:])), "timestamps are monotonic")
            self.assertEqual(frames[-1]["next.done"].tolist(), [True])
            self.assertFalse(any(f["next.done"][0] for f in frames[:-1]))
            for f in frames:
                self.assertEqual(f["observation.state"].shape, (6,))
                self.assertEqual(f["action"].shape, (6,))
                self.assertEqual(int(f["phase"][0]), FIGHT)
        self.assertEqual(w.tasks, ["duel vs BACKLASH Contender · harness"] * 2)

    def test_decision_pairs_action_with_its_request_row(self):
        doc = build_episode()
        _result, w, ep = run_export(doc, units="rad")
        first = w.episodes[0][0]
        # First fight row is 5; the first arrival inside the fight is row 5 (odd), requested at row 4.
        state = ep.col("observation.state.blaze")
        np.testing.assert_allclose(first["observation.state"], state[4, :6], rtol=0, atol=0)
        np.testing.assert_allclose(first["action"], ep.col("action_raw.blaze")[5].astype(np.float32))
        all_actions = np.array([f["action"] for f in w.episodes[0]])
        self.assertTrue(np.all(np.isfinite(all_actions)), "errored arrivals are skipped")

    def test_applied_alignment_and_units(self):
        _result, w, ep = run_export(build_episode(), align="applied", units="range_m100_100", with_velocity=True, with_game=True)
        self.assertEqual(len(w.episodes[0]), 60)
        self.assertEqual(len(w.episodes[1]), 40)
        frame = w.episodes[0][0]
        lift = ep.col("observation.state.blaze")[5, 1]
        self.assertAlmostEqual(float(frame["observation.state"][1]), 100.0 * lift / 1.7453293, places=3)
        self.assertAlmostEqual(float(frame["observation.velocity"][1]), 0.5 * 100.0 / 1.7453293, places=3)
        self.assertEqual(frame["observation.environment_state"].shape, (81,))

    def test_reward_counts_damage_while_the_action_is_in_effect(self):
        _result, w, _ep = run_export(build_episode(), align="applied")
        rewards = np.array([float(f["next.reward"][0]) for f in w.episodes[0]])
        # Round 1: blaze dealt 12.5 (physical), took 5.0; blaze won (+1 terminal).
        self.assertAlmostEqual(rewards[:-1].sum(), (12.5 - 5.0) / 100.0, places=6)
        self.assertAlmostEqual(rewards[-1], 1.0, places=6)
        rewards2 = np.array([float(f["next.reward"][0]) for f in w.episodes[1]])
        self.assertAlmostEqual(rewards2[-1], -1.0, places=6)

    def test_refuses_arcade_unless_allowed(self):
        doc = build_episode(physics="arcade", preset="arcade")
        with self.assertRaises(tl.ExportError) as ctx:
            run_export(doc)
        self.assertIn("--allow-arcade", str(ctx.exception))
        result, _w, _ep = run_export(build_episode(physics="arcade", preset="arcade"), allow_arcade=True)
        self.assertEqual(result["episodes"], 2)

    def test_human_seats_need_applied_alignment(self):
        doc = build_episode(blaze_driver="human")
        with self.assertRaises(tl.ExportError):
            run_export(doc, align="decision")
        result, _w, _ep = run_export(build_episode(blaze_driver="human"))
        self.assertEqual(result["align"], "applied")

    def test_rejects_damaged_files(self):
        doc = build_episode()
        doc["format"] = "torquelimit.episode/2"
        with self.assertRaises(tl.ExportError):
            tl.Episode(doc)
        doc = build_episode()
        doc["columns"]["round"]["dtype"] = "f16"
        with self.assertRaises(tl.ExportError):
            tl.Episode(doc)
        doc = build_episode()
        doc["columns"]["round"]["length"] += 1
        with self.assertRaises(tl.ExportError):
            tl.Episode(doc)

    def test_cli_dry_run_and_info_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ep.tlep.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(build_episode(), fh)
            self.assertEqual(tl.main([path, "--seat", "blaze", "--out", os.path.join(tmp, "ds"), "--dry-run"]), 0)
            self.assertEqual(tl.main([tmp, "--seat", "blaze", "--out", os.path.join(tmp, "ds"), "--dry-run", "--align", "applied"]), 0)
            # info.json merge: a dataset root that already has meta/info.json gains the torquelimit block.
            os.makedirs(os.path.join(tmp, "ds", "meta"))
            with open(os.path.join(tmp, "ds", "meta", "info.json"), "w", encoding="utf-8") as fh:
                json.dump({"fps": 25}, fh)
            ep = tl.Episode.load(path)
            tl.export([ep], tl.ExportOptions("blaze"), lambda fps, f: tl.ValidatingWriter(fps, f), os.path.join(tmp, "ds"))
            with open(os.path.join(tmp, "ds", "meta", "info.json"), encoding="utf-8") as fh:
                info = json.load(fh)
            self.assertEqual(info["fps"], 25)
            self.assertEqual(info["torquelimit"]["physics_mode"], "harness")
            self.assertEqual(info["torquelimit"]["source_episode_ids"], ["2026-09-16T12:00:00.000Z-beef"])

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_reads_an_episode_written_by_the_game(self):
        """Cross-language: the TypeScript recorder and codec write a real episode, Python exports it."""
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "game.tlep.json")
            code = GAME_EPISODE_SCRIPT.replace("__OUT__", json.dumps(out)).replace("__ROOT__", ROOT)
            proc = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, capture_output=True, text=True, timeout=120)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            ep = tl.Episode.load(out)
            writer = []
            result = tl.export([ep], tl.ExportOptions("atlas", units="rad"), lambda fps, f: writer.append(tl.ValidatingWriter(fps, f)) or writer[-1])
            self.assertEqual(result["episodes"], len(ep.meta["result"]["rounds"]))
            self.assertGreater(result["frames"], 0)


GAME_EPISODE_SCRIPT = """
import { writeFile } from "node:fs/promises";
const root = "__ROOT__";
const { defineHeadlessMatchRunner } = await import(`${root}/src/game/loop/headless-runner.ts`);
const { buildMatchConfig } = await import(`${root}/src/game/match/match-config.ts`);
const F = await import(`${root}/src/game/testing/fakes.ts`);
const { createRecorder } = await import(`${root}/src/game/harness/recorder.ts`);
const { encodeEpisodeText } = await import(`${root}/src/game/harness/episode-format.ts`);
const runner = defineHeadlessMatchRunner({ createChunkExecutor: F.createFakeChunkExecutor, createDelayLine: F.createFakeDelayLine, hitstopMsFor: F.fakeHitstopMsFor })({
  createEngine: async ({ mode }) => F.createFakeEngine({ mode }),
  createRules: () => F.createFakeRules(),
  kinematics: F.createFakeKinematics(), observations: F.createFakeObservationBuilder(),
  createSeatDriver: async (spec, seat) => F.createFakeSeatDriver(seat, { kind: spec.kind, act: (obs, tick) => ({ targets: [Math.sin(tick / 9), -0.5, 0.9, -0.2, 0, 1] }) }),
  createPilot: null, createProxyBot: null, createRecorder,
});
const cfg = buildMatchConfig({ preset: "harness", context: "suite", seed: 5, bestOf: 1, now: new Date("2026-09-16T12:00:00Z"),
  seats: { atlas: { driver: { kind: "module", fileName: "p.mjs", source: "", sha256: "e" } }, blaze: { driver: { kind: "builtin", personality: "deadband", tier: "pro", dda: false } } } });
const ep = await runner.run(cfg);
await writeFile(__OUT__, encodeEpisodeText(ep));
"""


if __name__ == "__main__":
    unittest.main()
