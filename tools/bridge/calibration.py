#!/usr/bin/env python3
"""Joint units between TORQUE LIMIT (simulation radians) and LeRobot SO-101 datasets and robots (GAME_DESIGN 5.7).

TORQUE LIMIT observes and commands joints in radians, zero at the MJCF zero pose of ``so101.xml``. LeRobot's
SO-101 driver reports and accepts normalized units:

* ``range_m100_100`` (LeRobot's default for the arm): ``100 * (q - mid_j) / half_range_j``, so each joint's range
  maps to [-100, 100];
* ``degrees`` (``use_degrees=True``): ``q * 180 / pi`` for arm joints;
* the gripper is always ``range_0_100``: ``100 * (q - lo) / (hi - lo)``;
* ``rad``: no conversion.

The default ranges are the joint ranges of ``so101.xml``. A real arm's calibrated range differs from the model's,
so measure yours (docs/HARNESS.md, "Calibration") and load it with :meth:`Calibration.from_json` before you
train on simulated data or run a simulated policy on hardware.
"""

from __future__ import annotations

import json
import math
from typing import Dict, List, Sequence, Tuple

JOINT_NAMES: Tuple[str, ...] = ("shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper")
#: Joint ranges (rad) from public/models/robotstudio_so101/so101.xml.
SO101_RANGES: Dict[str, Tuple[float, float]] = {
    "shoulder_pan": (-1.91986, 1.91986),
    "shoulder_lift": (-1.7453293, 1.7453293),
    "elbow_flex": (-1.69, 1.69),
    "wrist_flex": (-1.658063, 1.658063),
    "wrist_roll": (-2.7438473, 2.7438473),
    "gripper": (-0.174533, 1.7453292),
}
UNITS = ("rad", "degrees", "range_m100_100")


class Calibration:
    """Per-joint ranges used for the unit conversions. Immutable once built."""

    def __init__(self, ranges: Dict[str, Tuple[float, float]] = None) -> None:
        merged = dict(SO101_RANGES)
        if ranges:
            for name, (lo, hi) in ranges.items():
                if name not in merged:
                    raise ValueError(f"unknown joint {name}")
                if not (math.isfinite(lo) and math.isfinite(hi) and hi > lo):
                    raise ValueError(f"{name}: range must be finite with hi > lo")
                merged[name] = (float(lo), float(hi))
        self._ranges = merged

    @classmethod
    def from_json(cls, path: str) -> "Calibration":
        """Loads ``{"shoulder_pan": [lo_rad, hi_rad], ...}``; joints left out keep the so101.xml range."""
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return cls({k: (float(v[0]), float(v[1])) for k, v in data.items()})

    def range(self, joint: str) -> Tuple[float, float]:
        return self._ranges[joint]

    def _check_units(self, units: str) -> None:
        if units not in UNITS:
            raise ValueError(f"units must be one of {', '.join(UNITS)}, got {units}")

    def sim_to_lerobot(self, q: Sequence[float], units: str = "range_m100_100") -> List[float]:
        """6 joint positions or targets in simulation radians to LeRobot units."""
        self._check_units(units)
        if len(q) != 6:
            raise ValueError("expected 6 joint values")
        out: List[float] = []
        for name, value in zip(JOINT_NAMES, q):
            value = float(value)
            lo, hi = self._ranges[name]
            if units == "rad":
                out.append(value)
            elif name == "gripper":
                out.append(100.0 * (value - lo) / (hi - lo))
            elif units == "degrees":
                out.append(math.degrees(value))
            else:
                mid, half = (lo + hi) / 2.0, (hi - lo) / 2.0
                out.append(100.0 * (value - mid) / half)
        return out

    def lerobot_to_sim(self, v: Sequence[float], units: str = "range_m100_100") -> List[float]:
        """Inverse of :meth:`sim_to_lerobot`."""
        self._check_units(units)
        if len(v) != 6:
            raise ValueError("expected 6 joint values")
        out: List[float] = []
        for name, value in zip(JOINT_NAMES, v):
            value = float(value)
            lo, hi = self._ranges[name]
            if units == "rad":
                out.append(value)
            elif name == "gripper":
                out.append(lo + value / 100.0 * (hi - lo))
            elif units == "degrees":
                out.append(math.radians(value))
            else:
                mid, half = (lo + hi) / 2.0, (hi - lo) / 2.0
                out.append(mid + value / 100.0 * half)
        return out


DEFAULT = Calibration()


def sim_to_lerobot(q: Sequence[float], units: str = "range_m100_100") -> List[float]:
    return DEFAULT.sim_to_lerobot(q, units)


def lerobot_to_sim(v: Sequence[float], units: str = "range_m100_100") -> List[float]:
    return DEFAULT.lerobot_to_sim(v, units)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Convert 6 SO-101 joint values between simulation radians and LeRobot units.")
    parser.add_argument("values", nargs=6, type=float)
    parser.add_argument("--units", choices=UNITS, default="range_m100_100")
    parser.add_argument("--to-sim", action="store_true", help="input is in LeRobot units; print radians")
    parser.add_argument("--calibration", help="JSON of measured joint ranges in radians")
    args = parser.parse_args()
    cal = Calibration.from_json(args.calibration) if args.calibration else DEFAULT
    result = cal.lerobot_to_sim(args.values, args.units) if args.to_sim else cal.sim_to_lerobot(args.values, args.units)
    print(" ".join(f"{x:.6f}" for x in result))
