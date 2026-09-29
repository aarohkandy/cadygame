#!/usr/bin/env python3
"""Export TORQUE LIMIT episodes (``.tlep.json``, torquelimit.episode/3 or /4) to a LeRobot dataset (GAME_DESIGN 5.8,
EMOTION_BIBLE 9).

    python tools/export/to_lerobot.py episode.tlep.json --seat blaze --out ./ds

* One LeRobot episode per round, fight and sudden-death rows only. Timestamps restart at 0 for every exported
  episode and step by exactly 1/fps.
* ``observation.state`` = joint positions (6) in ``--units``; ``action`` (6, same units); ``next.done``;
  ``next.reward`` = change in (damage dealt − damage taken) / 100 per frame, plus ±1 on the round's last frame;
  ``phase`` and ``discontinuity``; ``task`` such as ``"duel vs BACKLASH Contender · harness"``.
  ``--with-velocity`` adds ``observation.velocity``; ``--with-game`` adds ``observation.opponent_state``,
  ``observation.game`` and ``observation.environment_state``.
* ``--align decision`` (default for policy seats): each returned action (``action_raw``) is paired with the
  observation the policy actually received (the delivered observation of its ``policy.request_frame_index`` row);
  fps is the seat's decision rate. ``--align applied`` pairs every control-tick observation with the applied action
  at ``controlHz`` (the only alignment for human and proxy seats, whose ctrl is written every step).
* Arcade episodes are refused unless ``--allow-arcade``: Arcade physics are not the robot's. ``--lane opponent``
  is the other dataset: it allows arcade and writes ``matches.parquet`` (per-tick duel rows for the CORNER
  opponents) instead of a LeRobot dataset.
* Episode /4 (EMOTION_BIBLE 9): ``task`` comes from ``meta.rounds[i].task`` (a drill's ``dock the core from pose 3
  zone B``), falling back to the generated duel string; ``--min-tier A|B|C`` keeps episodes whose
  ``meta.quality.tier`` is at least that; ``human.shaping`` int64[1] and ``human.command`` f32[6] are exported for
  pilot seats, ``human.raw`` f32[8] behind ``--with-human``; a drill round's reward is +1 on its ``task_success``
  row and 0 elsewhere with ``next.done`` at success or timeout; ``--max-shaped-frac F`` drops a round (never a
  tick) whose shaped-tick fraction is above F; ``--robot-type`` defaults to ``so101_follower``; ``--decimate N``
  keeps every Nth frame (``--decimate 2`` turns 50 Hz into exactly 25 fps).
* ``meta/info.json`` gains a ``torquelimit`` block: physics mode, preset, timestep, servo parameter hash, input
  shaping, fair delay, quality version, and the source episode ids.

The real ``LeRobotDataset`` writer needs ``lerobot`` (tools/export/requirements.txt); run it on a machine with the
disk for torch (docs/HARNESS.md gives the homebase command). ``--dry-run`` validates everything with numpy only.
"""

from __future__ import annotations

import argparse
import base64
import glob
import inspect
import json
import math
import os
import sys
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
from calibration import JOINT_NAMES, UNITS, Calibration  # noqa: E402

EPISODE_FORMAT = "torquelimit.episode/4"
EPISODE_FORMATS_READABLE = ("torquelimit.episode/3", EPISODE_FORMAT)
#: MATCH_PHASES order from src/game/contracts.ts (the phase column stores the index).
MATCH_PHASES = (
    "boot", "title", "green_room", "match_intro", "rematch_intro", "round_intro", "fight",
    "ko", "lock", "time_up", "sudden_death", "round_replay", "round_summary",
    "match_replay", "outro", "post_match", "paused", "replay_viewer", "lab_run",
    "attract", "boot_ritual", "entrance", "count_in", "verdict", "systems_check",
)
TIER_RANK = {"A": 3, "B": 2, "C": 1, "D": 0}
DEFAULT_ROBOT_TYPE = "so101_follower"
LIVE_PHASES = (MATCH_PHASES.index("fight"), MATCH_PHASES.index("sudden_death"))
DTYPES = {"f64": "<f8", "f32": "<f4", "u32": "<u4", "i32": "<i4", "i16": "<i2", "u8": "u1"}
PILOT_DRIVERS = ("human", "proxy")


class ExportError(Exception):
    pass


# ───────────────────────── reading episodes ─────────────────────────


def _exact_numbers(obj: Dict[str, Any]) -> Any:
    """The episode JSON tags NaN, ±Infinity, and -0 in plain-number fields as {"$num": "..."}."""
    if len(obj) == 1 and "$num" in obj:
        return {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf, "-0": -0.0}.get(obj["$num"], obj)
    return obj


def decode_typed(enc: Dict[str, Any], path: str) -> np.ndarray:
    dtype = enc.get("dtype")
    if dtype not in DTYPES:
        raise ExportError(f"{path}: unknown dtype {dtype!r}")
    raw = base64.b64decode(enc.get("b64", ""), validate=True)
    arr = np.frombuffer(raw, dtype=np.dtype(DTYPES[dtype]))
    if arr.shape[0] != enc.get("length"):
        raise ExportError(f"{path}: length {enc.get('length')} does not match the payload ({arr.shape[0]})")
    return arr


class Episode:
    """A decoded episode: meta, columns reshaped to (rows, *shape), events, sparse data."""

    def __init__(self, doc: Dict[str, Any], source: str = "") -> None:
        if doc.get("format") not in EPISODE_FORMATS_READABLE:
            raise ExportError(f"{source or 'episode'}: expected {EPISODE_FORMAT}, found {doc.get('format')!r}")
        self.source = source
        self.meta: Dict[str, Any] = doc["meta"]
        shapes = doc.get("shapes", {})
        self.columns: Dict[str, np.ndarray] = {}
        rows = None
        for name, enc in doc["columns"].items():
            arr = decode_typed(enc, f"columns.{name}")
            shape = tuple(shapes.get(name, []))
            width = int(np.prod(shape)) if shape else 1
            if arr.shape[0] % width:
                raise ExportError(f"columns.{name}: {arr.shape[0]} values do not fit shape {shape}")
            self.columns[name] = arr.reshape((-1,) + shape) if shape else arr
        rows = len(self.columns["frame_index"])
        for name, arr in self.columns.items():
            if arr.shape[0] != rows:
                raise ExportError(f"columns.{name}: {arr.shape[0]} rows, expected {rows}")
        self.rows = rows
        self.events: List[Dict[str, Any]] = doc.get("events", [])
        self.sparse: Dict[str, List[Dict[str, Any]]] = doc.get("sparse", {})

    @classmethod
    def load(cls, path: str) -> "Episode":
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh, object_hook=_exact_numbers)
        return cls(doc, path)

    def col(self, name: str) -> Optional[np.ndarray]:
        return self.columns.get(name)

    def round_meta(self, rnd: int) -> Optional[Dict[str, Any]]:
        """meta.rounds entry for a round (episode /4), None on a /3 document."""
        for r in self.meta.get("rounds") or []:
            if r.get("round") == rnd:
                return r
        return None

    def quality_tier(self) -> Optional[str]:
        q = self.meta.get("quality")
        return q.get("tier") if isinstance(q, dict) else None

    def event_rows(self) -> np.ndarray:
        """Row of every event: rounds tracked through phase events, steps offset by each round's reset step."""
        hz = self.meta["controlHz"]
        spt = max(1, round(1.0 / (self.meta["timestep"] * hz)))
        segments = [e["value"] for e in self.sparse.get("sim.segments", [])]
        out = np.zeros(len(self.events), dtype=np.int64)
        seg = segments[0] if segments else None
        current_round = seg["round"] if seg else 1
        for i, e in enumerate(self.events):
            if e.get("type") == "phase" and e.get("round", 0) > current_round:
                current_round = e["round"]
                seg = next((s for s in segments if s["round"] == current_round), seg)
            if seg is None:
                out[i] = min(self.rows - 1, e["step"] // spt)
            else:
                out[i] = min(self.rows - 1, max(0, seg["firstTick"] + (e["step"] - seg["resetStep"]) // spt))
        return out


# ───────────────────────── frames ─────────────────────────


def _names(prefix: str, n: int) -> List[str]:
    return [f"{prefix}_{i}" for i in range(n)]


def features_for(opts: "ExportOptions", pilot: bool = False) -> Dict[str, Dict[str, Any]]:
    joint_names = list(JOINT_NAMES)
    f: Dict[str, Dict[str, Any]] = {
        "observation.state": {"dtype": "float32", "shape": (6,), "names": joint_names},
        "action": {"dtype": "float32", "shape": (6,), "names": joint_names},
        "next.done": {"dtype": "bool", "shape": (1,), "names": None},
        "next.reward": {"dtype": "float32", "shape": (1,), "names": None},
        "phase": {"dtype": "int64", "shape": (1,), "names": None},
        "discontinuity": {"dtype": "int64", "shape": (1,), "names": None},
    }
    if opts.with_velocity:
        f["observation.velocity"] = {"dtype": "float32", "shape": (6,), "names": joint_names}
    if opts.with_game:
        f["observation.opponent_state"] = {"dtype": "float32", "shape": (28,), "names": _names("opponent_state", 28)}
        f["observation.game"] = {"dtype": "float32", "shape": (16,), "names": _names("game", 16)}
        f["observation.environment_state"] = {"dtype": "float32", "shape": (81,), "names": _names("environment_state", 81)}
    if pilot:
        # EMOTION_BIBLE 9 (3): the pilot's own command before any life layer, and the per-tick shaping flags.
        f["human.shaping"] = {"dtype": "int64", "shape": (1,), "names": None}
        f["human.command"] = {"dtype": "float32", "shape": (6,), "names": joint_names}
        if opts.with_human:
            f["human.raw"] = {"dtype": "float32", "shape": (8,), "names": ["mouse_dx", "mouse_dy", "buttons", "keys", "lx", "ly", "rx", "ry"]}
    return f


class ExportOptions:
    def __init__(self, seat: str, units: str = "range_m100_100", align: Optional[str] = None, with_velocity: bool = False,
                 with_game: bool = False, allow_arcade: bool = False, calibration: Optional[Calibration] = None,
                 with_human: bool = False, min_tier: Optional[str] = None, max_shaped_frac: Optional[float] = None,
                 lane: str = "robot", decimate: int = 1, robot_type: str = DEFAULT_ROBOT_TYPE, human_features: bool = False) -> None:
        if seat not in ("atlas", "blaze"):
            raise ExportError("--seat must be atlas or blaze")
        if units not in UNITS:
            raise ExportError(f"--units must be one of {', '.join(UNITS)}")
        if align not in (None, "decision", "applied"):
            raise ExportError("--align must be decision or applied")
        if min_tier not in (None, "A", "B", "C"):
            raise ExportError("--min-tier must be A, B or C")
        if lane not in ("robot", "opponent"):
            raise ExportError("--lane must be robot or opponent")
        if not isinstance(decimate, int) or decimate < 1:
            raise ExportError("--decimate must be a positive integer")
        if max_shaped_frac is not None and not (0.0 <= max_shaped_frac <= 1.0):
            raise ExportError("--max-shaped-frac must be between 0 and 1")
        self.seat = seat
        self.units = units
        self.align = align
        self.with_velocity = with_velocity
        self.with_game = with_game
        self.allow_arcade = allow_arcade
        self.calibration = calibration or Calibration()
        self.with_human = with_human
        self.min_tier = min_tier
        self.max_shaped_frac = max_shaped_frac
        self.lane = lane
        self.decimate = decimate
        self.robot_type = robot_type
        #: set by export(): the pilot seat's human.* columns exist in every episode (a /3 document has none)
        self.human_features = human_features

    def clone(self, align: Optional[str]) -> "ExportOptions":
        return ExportOptions(self.seat, self.units, align, self.with_velocity, self.with_game, self.allow_arcade, self.calibration,
                             self.with_human, self.min_tier, self.max_shaped_frac, self.lane, self.decimate, self.robot_type, self.human_features)


def _velocity_units(cal: Calibration, qd: np.ndarray, units: str) -> np.ndarray:
    """Joint velocities in the unit per second matching the position units."""
    out = np.array(qd, dtype=np.float64)
    if units == "rad":
        return out
    for j, name in enumerate(JOINT_NAMES):
        lo, hi = cal.range(name)
        if name == "gripper":
            out[..., j] *= 100.0 / (hi - lo)
        elif units == "degrees":
            out[..., j] *= 180.0 / math.pi
        else:
            out[..., j] *= 100.0 / ((hi - lo) / 2.0)
    return out


def _convert(cal: Calibration, values: np.ndarray, units: str) -> np.ndarray:
    return np.array([cal.sim_to_lerobot(v, units) for v in values], dtype=np.float32).reshape(len(values), 6)


def task_string(ep: Episode, seat: str, rnd: Optional[int] = None) -> str:
    """The round's task string: ``meta.rounds[i].task`` on a /4 episode, else the generated duel string."""
    if rnd is not None:
        rm = ep.round_meta(rnd)
        if rm and isinstance(rm.get("task"), str) and rm["task"]:
            return rm["task"]
    other = "blaze" if seat == "atlas" else "atlas"
    opp = ep.meta["seats"][other]
    name = opp.get("name") or other.upper()
    tier = opp.get("tier")
    label = f"{name} {tier.capitalize()}" if tier else name
    return f"duel vs {label} · {ep.meta['preset']}"


def round_frames(ep: Episode, opts: ExportOptions) -> Iterable[Tuple[int, List[Dict[str, Any]], float]]:
    """Yields (round, frames, fps) for each round with live rows."""
    meta = ep.meta
    seat = opts.seat
    driver = meta["seats"][seat]["driver"]
    pilot = driver in PILOT_DRIVERS
    align = opts.align or ("applied" if pilot else "decision")
    if align == "decision" and (pilot or ep.col(f"action_raw.{seat}") is None):
        raise ExportError(f"{seat} is a {driver} seat: returned actions do not exist, use --align applied")

    phase = ep.col("phase")
    round_col = ep.col("round")
    disc = ep.col("discontinuity")
    live = np.isin(phase, LIVE_PHASES)
    scoring = meta.get("scoring", "physical")
    dmg_key = "damage" if scoring == "full" else "physicalDamage"
    event_rows = ep.event_rows()
    dealt = np.zeros(ep.rows)
    taken = np.zeros(ep.rows)
    for e, row in zip(ep.events, event_rows):
        if e.get("type") == "strike":
            if e.get("attacker") == seat:
                dealt[row] += float(e.get(dmg_key, 0.0))
            if e.get("victim") == seat:
                taken[row] += float(e.get(dmg_key, 0.0))
    winners = {r["round"]: r["winner"] for r in meta["result"]["rounds"]}
    # Drill rounds (9): +1 on the task_success row, 0 elsewhere; the episode ends there (or at the timeout).
    success_row: Dict[int, int] = {}
    for e, row in zip(ep.events, event_rows):
        if e.get("type") == "task_success" and e.get("seat") == seat:
            rnd_of = int(round_col[row]) if row < ep.rows else -1
            success_row.setdefault(rnd_of, int(row))
    shaping_col = ep.col(f"human.shaping.{seat}")
    command_col = ep.col(f"human.command.{seat}")
    raw_col = ep.col(f"human.raw.{seat}")
    human = opts.human_features and shaping_col is not None and command_col is not None
    if human and opts.with_human and raw_col is None:
        raise ExportError("--with-human needs the human.raw column (episode /4)")

    def obs_block(block: str, rows: np.ndarray, delivered: bool) -> np.ndarray:
        if delivered and ep.col(f"observation.delivered.{block}.{seat}") is not None:
            return ep.col(f"observation.delivered.{block}.{seat}")[rows]
        return ep.col(f"observation.{block}.{seat}")[rows]

    for rnd in sorted(set(int(r) for r in round_col[live])):
        rows = np.nonzero(live & (round_col == rnd))[0]
        rm = ep.round_meta(rnd)
        drill = bool(rm and rm.get("outcome") is not None)
        if drill and rnd in success_row:
            rows = rows[rows <= success_row[rnd]]                       # next.done at success: nothing after it
        if human and opts.max_shaped_frac is not None and len(rows):
            shaped = float(np.count_nonzero(shaping_col[rows])) / len(rows)
            if shaped > opts.max_shaped_frac:
                continue                                              # drop the round, never the tick (9, item 5)
        if align == "decision":
            req = ep.col(f"policy.request_frame_index.{seat}")[rows]
            raw_all = ep.col(f"action_raw.{seat}")[rows]
            # Arrival rows with a usable action (an errored reply carries NaN and never reached ctrl).
            arrival = rows[(req >= 0) & np.all(np.isfinite(raw_all), axis=1)]
            obs_rows = ep.col(f"policy.request_frame_index.{seat}")[arrival].astype(np.int64)
            action = ep.col(f"action_raw.{seat}")[arrival]
            fps = float(meta["seats"][seat]["decisionHz"])
            delivered = True
            frame_rows = arrival
        else:
            obs_rows = rows
            action = ep.col(f"action.{seat}")[rows]
            fps = float(meta["controlHz"])
            delivered = False
            frame_rows = rows
        if opts.decimate > 1:
            obs_rows = obs_rows[::opts.decimate]
            action = action[::opts.decimate]
            frame_rows = frame_rows[::opts.decimate]
            fps = fps / opts.decimate
            if abs(fps - round(fps)) > 1e-9:
                raise ExportError(f"--decimate {opts.decimate} does not divide {fps * opts.decimate:g} fps exactly")
        n = len(frame_rows)
        if n == 0:
            continue
        state = obs_block("state", obs_rows, delivered)
        q = _convert(opts.calibration, state[:, 0:6].astype(np.float64), opts.units)
        a = _convert(opts.calibration, action.astype(np.float64), opts.units)
        vel = _velocity_units(opts.calibration, state[:, 6:12], opts.units).astype(np.float32) if opts.with_velocity else None
        # next.reward: damage change while this frame's action is in effect ([row_i, row_i+1)), terminal ±1.
        cum = np.concatenate([[0.0], np.cumsum(dealt - taken)])      # cum[k] = sum over rows < k
        starts = frame_rows
        ends = np.concatenate([frame_rows[1:], [rows[-1] + 1]])
        if drill:
            reward = np.zeros(n)
            if rnd in success_row:
                reward[-1] = 1.0                                      # the task_success row is the last exported frame
        else:
            reward = (cum[ends] - cum[starts]) / 100.0
            reward[-1] += 1.0 if winners.get(rnd) == seat else -1.0 if rnd in winners else 0.0
        frames = []
        for i in range(n):
            fr: Dict[str, Any] = {
                "observation.state": q[i],
                "action": a[i],
                "next.done": np.array([i == n - 1], dtype=bool),
                "next.reward": np.array([reward[i]], dtype=np.float32),
                "phase": np.array([int(phase[frame_rows[i]])], dtype=np.int64),
                "discontinuity": np.array([int(disc[frame_rows[i]])], dtype=np.int64),
                "timestamp": np.float32(i / fps),
            }
            if vel is not None:
                fr["observation.velocity"] = vel[i]
            if opts.with_game:
                fr["observation.opponent_state"] = obs_block("opponent_state", obs_rows[i:i + 1], delivered)[0].astype(np.float32)
                fr["observation.game"] = obs_block("game", obs_rows[i:i + 1], delivered)[0].astype(np.float32)
                fr["observation.environment_state"] = obs_block("environment_state", obs_rows[i:i + 1], delivered)[0].astype(np.float32)
            if human:
                r = frame_rows[i]
                fr["human.shaping"] = np.array([int(shaping_col[r])], dtype=np.int64)
                cmd = command_col[r].astype(np.float32)
                fr["human.command"] = np.where(np.isfinite(cmd), cmd, 0.0).astype(np.float32)
                if opts.with_human:
                    raw = raw_col[r].astype(np.float32)
                    fr["human.raw"] = np.where(np.isfinite(raw), raw, 0.0).astype(np.float32)
            frames.append(fr)
        yield rnd, frames, fps


# ───────────────────────── writers ─────────────────────────


class DatasetWriter:
    """What the exporter needs from a dataset. ``LeRobotWriter`` wraps ``LeRobotDataset``; tests use a fake."""

    def add_frame(self, frame: Dict[str, Any], task: str) -> None:
        raise NotImplementedError

    def save_episode(self) -> None:
        raise NotImplementedError

    def finalize(self) -> None:
        raise NotImplementedError


class LeRobotWriter(DatasetWriter):
    """Adapter over ``lerobot.datasets.lerobot_dataset.LeRobotDataset`` that works across its add_frame signatures."""

    def __init__(self, repo_id: str, root: str, fps: float, features: Dict[str, Dict[str, Any]], robot_type: str = DEFAULT_ROBOT_TYPE) -> None:
        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset  # lerobot >= 0.3
        except ImportError:
            try:
                from lerobot.common.datasets.lerobot_dataset import LeRobotDataset  # older layout
            except ImportError as exc:
                raise ExportError("lerobot is not installed here; use --dry-run, or run on homebase (docs/HARNESS.md)") from exc
        self.dataset = LeRobotDataset.create(repo_id=repo_id, fps=int(round(fps)), root=root, robot_type=robot_type,
                                             features=features, use_videos=False)
        params = inspect.signature(self.dataset.add_frame).parameters
        self._task_kw = "task" in params
        self._timestamp_kw = "timestamp" in params

    def add_frame(self, frame: Dict[str, Any], task: str) -> None:
        frame = dict(frame)
        kwargs: Dict[str, Any] = {}
        if self._timestamp_kw:
            kwargs["timestamp"] = float(frame.pop("timestamp"))
        if self._task_kw:
            kwargs["task"] = task
        else:
            frame["task"] = task
        self.dataset.add_frame(frame, **kwargs)

    def save_episode(self) -> None:
        self.dataset.save_episode()

    def finalize(self) -> None:
        if hasattr(self.dataset, "finalize"):
            self.dataset.finalize()


class ValidatingWriter(DatasetWriter):
    """numpy-only writer for --dry-run and tests: checks every frame against the features and timestamps."""

    def __init__(self, fps: float, features: Dict[str, Dict[str, Any]]) -> None:
        self.fps = fps
        self.features = features
        self.episodes: List[List[Dict[str, Any]]] = []
        self.tasks: List[str] = []
        self._current: List[Dict[str, Any]] = []
        self._task: Optional[str] = None
        self.finalized = False

    def add_frame(self, frame: Dict[str, Any], task: str) -> None:
        for name, spec in self.features.items():
            if name not in frame:
                raise ExportError(f"frame is missing {name}")
            value = np.asarray(frame[name])
            if tuple(value.shape) != tuple(spec["shape"]):
                raise ExportError(f"{name}: shape {value.shape} is not {spec['shape']}")
            if spec["dtype"] != "bool" and not np.all(np.isfinite(value.astype(np.float64))):
                raise ExportError(f"{name}: non-finite value")
        extra = set(frame) - set(self.features) - {"timestamp"}
        if extra:
            raise ExportError(f"frame has undeclared features {sorted(extra)}")
        ts = float(frame["timestamp"])
        expected = len(self._current) / self.fps
        if abs(ts - expected) > 1e-4:
            raise ExportError(f"timestamp {ts} is not frame {len(self._current)} / fps")
        if self._task is not None and task != self._task:
            raise ExportError("task changed inside an episode")
        self._task = task
        self._current.append(frame)

    def save_episode(self) -> None:
        if not self._current:
            raise ExportError("save_episode with no frames")
        if not bool(np.asarray(self._current[-1]["next.done"])[0]):
            raise ExportError("the last frame of an episode must have next.done")
        self.episodes.append(self._current)
        self.tasks.append(self._task or "")
        self._current = []
        self._task = None

    def finalize(self) -> None:
        if self._current:
            raise ExportError("finalize with an unsaved episode")
        self.finalized = True


# ───────────────────────── export ─────────────────────────


def torquelimit_info(episodes: Sequence[Episode], opts: ExportOptions, align: str) -> Dict[str, Any]:
    first = episodes[0].meta
    quality = first.get("quality") if isinstance(first.get("quality"), dict) else {}
    return {
        "format": "torquelimit.lerobot-export/2",
        "robot_type": opts.robot_type, "lane": opts.lane, "decimate": opts.decimate, "min_tier": opts.min_tier,
        "max_shaped_frac": opts.max_shaped_frac, "quality_version": quality.get("version"),
        "consent_version": (first.get("session") or {}).get("consent", {}).get("version"),
        "physics_mode": first["physics"], "preset": first["preset"], "timestep": first["timestep"],
        "control_hz": first["controlHz"], "servo_params_hash": first.get("servoParamsHash", ""),
        "tuning_sha256": first.get("tuningSha256", ""), "input_shaping": first.get("inputShaping", {}).get(opts.seat),
        "fair_delay_ms": first.get("fairDelayMs", 0), "seat": opts.seat, "units": opts.units, "align": align,
        "mujoco": first.get("provenance", {}).get("mujoco"), "obs_schema_hash": first.get("provenance", {}).get("obsSchemaHash"),
        "source_episode_ids": [e.meta["episodeId"] for e in episodes],
    }


def filter_by_tier(episodes: Sequence[Episode], min_tier: Optional[str]) -> List[Episode]:
    """``--min-tier``: keep episodes whose meta.quality.tier ranks at least min_tier; an unscored episode ranks as D."""
    if min_tier is None:
        return list(episodes)
    want = TIER_RANK[min_tier]
    return [ep for ep in episodes if TIER_RANK.get(ep.quality_tier() or "D", 0) >= want]


def check_exportable(episodes: Sequence[Episode], opts: ExportOptions) -> str:
    if not episodes:
        raise ExportError("no episodes to export")
    for ep in episodes:
        if ep.meta["physics"] == "arcade" and not opts.allow_arcade and opts.lane != "opponent":
            raise ExportError(f"{ep.source or ep.meta['episodeId']} is an ARCADE episode (not the robot's physics); "
                              "pass --lane opponent for the CORNER dataset, or --allow-arcade to export it anyway")
    keys = {(ep.meta["physics"], ep.meta["timestep"], ep.meta["controlHz"], ep.meta.get("servoParamsHash", "")) for ep in episodes}
    if len(keys) > 1:
        raise ExportError("episodes mix physics mode, timestep, control rate, or servo parameters; export them separately")
    pilot = episodes[0].meta["seats"][opts.seat]["driver"] in PILOT_DRIVERS
    return opts.align or ("applied" if pilot else "decision")


def export(episodes: Sequence[Episode], opts: ExportOptions, make_writer, out_dir: Optional[str] = None) -> Dict[str, Any]:
    """Writes every round of every episode. ``make_writer(fps, features)`` builds the writer once."""
    kept = filter_by_tier(episodes, opts.min_tier)
    if not kept:
        raise ExportError(f"no episode reaches quality tier {opts.min_tier}")
    align = check_exportable(kept, opts)
    pilot = kept[0].meta["seats"][opts.seat]["driver"] in PILOT_DRIVERS
    opts.human_features = pilot and all(ep.col(f"human.shaping.{opts.seat}") is not None and ep.col(f"human.command.{opts.seat}") is not None for ep in kept)
    features = features_for(opts, opts.human_features)
    writer: Optional[DatasetWriter] = None
    fps_seen: Optional[float] = None
    exported = 0
    frames_total = 0
    for ep in kept:
        for rnd, frames, fps in round_frames(ep, opts.clone(align)):
            task = task_string(ep, opts.seat, rnd)
            if fps_seen is None:
                fps_seen = fps
                writer = make_writer(fps, features)
            elif abs(fps - fps_seen) > 1e-9:
                raise ExportError(f"{ep.source}: fps {fps} differs from {fps_seen}; the exporter never resamples")
            for fr in frames:
                writer.add_frame(fr, task)
            writer.save_episode()
            exported += 1
            frames_total += len(frames)
    if writer is None:
        raise ExportError("no fight or sudden-death rows to export")
    writer.finalize()
    info = torquelimit_info(kept, opts, align)
    if out_dir:
        info_path = os.path.join(out_dir, "meta", "info.json")
        if os.path.exists(info_path):
            with open(info_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            data["torquelimit"] = info
            with open(info_path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=4)
    return {"episodes": exported, "frames": frames_total, "fps": fps_seen, "align": align, "torquelimit": info}


# ───────────────────────── the opponent lane (9, item 7) ─────────────────────────

MATCH_COLUMNS = ("episode_id", "round", "seat", "frame", "timestamp", "phase", "state", "opponent_state", "game", "action", "intents", "dda_k",
                 "personality", "tier", "preset", "quality_tier")


def match_rows(ep: Episode, seat: str, decimate: int = 1) -> List[Dict[str, Any]]:
    """Per-tick duel rows for the CORNER k-NN / ACT opponents: the obs the seat saw and the ctrl it applied."""
    phase = ep.col("phase")
    live = np.isin(phase, LIVE_PHASES)
    rows = np.nonzero(live)[0][::decimate]
    state = ep.col(f"observation.state.{seat}")
    opp = ep.col(f"observation.opponent_state.{seat}")
    game = ep.col(f"observation.game.{seat}")
    action = ep.col(f"action.{seat}")
    intents = ep.col(f"intents.{seat}")
    dda = ep.col(f"dda.k.{seat}")
    ts = ep.col("timestamp")
    round_col = ep.col("round")
    if state is None or action is None:
        raise ExportError(f"{ep.source}: seat {seat} has no observation/action columns")
    sm = ep.meta["seats"][seat]
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "episode_id": ep.meta["episodeId"], "round": int(round_col[r]), "seat": seat, "frame": int(r), "timestamp": float(ts[r]),
            "phase": int(phase[r]), "state": state[r].astype(np.float32).tolist(),
            "opponent_state": opp[r].astype(np.float32).tolist() if opp is not None else None,
            "game": game[r].astype(np.float32).tolist() if game is not None else None,
            "action": action[r].astype(np.float32).tolist(), "intents": int(intents[r]) if intents is not None else 0,
            "dda_k": float(dda[r]) if dda is not None and np.isfinite(dda[r]) else None,
            "personality": sm.get("personality"), "tier": sm.get("tier"), "preset": ep.meta["preset"], "quality_tier": ep.quality_tier(),
        })
    return out


def export_matches(episodes: Sequence[Episode], opts: ExportOptions, out_dir: Optional[str]) -> Dict[str, Any]:
    """``--lane opponent``: matches.parquet (pyarrow) of every live tick of every episode, arcade included."""
    kept = filter_by_tier(episodes, opts.min_tier)
    if not kept:
        raise ExportError(f"no episode reaches quality tier {opts.min_tier}")
    rows: List[Dict[str, Any]] = []
    for ep in kept:
        rows.extend(match_rows(ep, opts.seat, opts.decimate))
    if not rows:
        raise ExportError("no fight or sudden-death rows to export")
    path = None
    if out_dir:
        try:
            import pyarrow as pa  # type: ignore
            import pyarrow.parquet as pq  # type: ignore
        except ImportError as exc:
            raise ExportError("--lane opponent writes matches.parquet and needs pyarrow (pip install pyarrow); use --dry-run to validate") from exc
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, "matches.parquet")
        table = pa.Table.from_pylist(rows)
        pq.write_table(table, path)
    return {"lane": "opponent", "episodes": len(kept), "frames": len(rows), "fps": kept[0].meta["controlHz"] / opts.decimate,
            "align": "applied", "path": path, "torquelimit": torquelimit_info(kept, opts, "applied")}


def expand_inputs(paths: Sequence[str]) -> List[str]:
    out: List[str] = []
    for p in paths:
        if os.path.isdir(p):
            out.extend(sorted(glob.glob(os.path.join(p, "*.tlep.json"))))
        else:
            out.append(p)
    return out


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Export TORQUE LIMIT .tlep.json episodes to a LeRobot dataset.")
    parser.add_argument("episodes", nargs="+", help=".tlep.json files or directories of them")
    parser.add_argument("--seat", required=True, choices=("atlas", "blaze"))
    parser.add_argument("--out", required=True, help="dataset root directory")
    parser.add_argument("--repo-id", default="torquelimit/duels")
    parser.add_argument("--units", choices=UNITS, default="range_m100_100")
    parser.add_argument("--align", choices=("decision", "applied"), default=None)
    parser.add_argument("--with-velocity", action="store_true")
    parser.add_argument("--with-game", action="store_true")
    parser.add_argument("--allow-arcade", action="store_true")
    parser.add_argument("--lane", choices=("robot", "opponent"), default="robot",
                        help="robot (default): a LeRobot dataset under stock physics; opponent: matches.parquet for CORNER, arcade allowed")
    parser.add_argument("--with-human", action="store_true", help="add human.raw f32[8] (pilot seats, episode /4)")
    parser.add_argument("--min-tier", choices=("A", "B", "C"), default=None, help="keep episodes at or above this meta.quality.tier")
    parser.add_argument("--max-shaped-frac", type=float, default=None, help="drop rounds whose shaped-tick fraction exceeds this (e.g. 0.05)")
    parser.add_argument("--robot-type", default=DEFAULT_ROBOT_TYPE, help="LeRobot robot_type on the card (default so101_follower)")
    parser.add_argument("--decimate", type=int, default=1, help="keep every Nth frame (2 turns 50 Hz into exactly 25 fps)")
    parser.add_argument("--calibration", help="JSON of the real arm's joint ranges in radians (tools/bridge/calibration.py)")
    parser.add_argument("--dry-run", action="store_true", help="validate frames with numpy only, write nothing")
    args = parser.parse_args(argv)
    try:
        cal = Calibration.from_json(args.calibration) if args.calibration else None
        opts = ExportOptions(args.seat, args.units, args.align, args.with_velocity, args.with_game, args.allow_arcade, cal,
                             args.with_human, args.min_tier, args.max_shaped_frac, args.lane, args.decimate, args.robot_type)
        episodes = [Episode.load(p) for p in expand_inputs(args.episodes)]
        if opts.lane == "opponent":
            result = export_matches(episodes, opts, None if args.dry_run else args.out)
        elif args.dry_run:
            result = export(episodes, opts, lambda fps, features: ValidatingWriter(fps, features))
        else:
            result = export(episodes, opts, lambda fps, features: LeRobotWriter(args.repo_id, args.out, fps, features, args.robot_type), args.out)
    except ExportError as exc:
        print(f"to_lerobot: {exc}", file=sys.stderr)
        return 2
    verb = "validated" if args.dry_run else f"wrote to {args.out}"
    print(f"to_lerobot: {verb}: {result['episodes']} episodes, {result['frames']} frames at {result['fps']:g} fps ({result['align']} alignment)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
