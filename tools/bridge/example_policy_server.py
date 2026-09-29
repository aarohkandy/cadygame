#!/usr/bin/env python3
"""Example bridge policy: a patient counter-puncher that guards, reads the opponent, and throws timed jabs.

    python tools/bridge/example_policy_server.py --port 8765

Then in the Lab pick BRIDGE for a seat, keep ``ws://127.0.0.1:8765``, and press RUN MATCH (or FIGHT IT).

What it shows, in about a hundred lines you can replace with a model:

* reading the flat torquelimit.obs/3 blocks (own joints, own and opponent end effector, game phase);
* guarding by pulling the wrist in front of the camera mount when the opponent's hand closes in fast;
* aiming ``shoulder_pan`` at the opponent's wrist and returning a 12-step action **chunk** for each jab;
* seeding its own randomness from ``reset`` so re-simulation verifies bit-exact.
"""

from __future__ import annotations

import math
import random
from typing import Any, Dict, List

from torquelimit_bridge import GUARD_POSE, JOINT_LIMITS, Observation, Policy, cli_args, serve

CONTROL_HZ = 50
#: Guard: pan follows the opponent a little, wrist raised in front of the camera mount.
GUARD = list(GUARD_POSE)
#: Fully thrown jab relative to the guard (lift forward, elbow open, wrist level).
JAB_DELTA = [0.0, 0.78, -0.92, 0.36, 0.0, 0.0]
JAB_STEPS = 12                  # 240 ms at 50 Hz: 5 out, 2 hold, 5 back
THREAT_RANGE_M = 0.30
THREAT_SPEED_MPS = 0.45
STRIKE_RANGE_M = 0.42


def _clamp_joints(targets: List[float]) -> List[float]:
    return [min(hi, max(lo, v)) for v, (lo, hi) in zip(targets, JOINT_LIMITS)]


def _dist(a: List[float], b: List[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


class CounterPuncher(Policy):
    name = "example_counter_puncher"
    version = "3.0"
    provenance = {"kind": "scripted", "source": "tools/bridge/example_policy_server.py"}
    supports_chunks = True
    max_chunk = JAB_STEPS
    chunk_hz = CONTROL_HZ

    def __init__(self) -> None:
        self.rng: Dict[str, random.Random] = {}
        self.cooldown_until: Dict[str, float] = {}

    def reset(self, seat: str, seed: int, context: Dict[str, Any]) -> None:
        self.rng[seat] = random.Random(seed)
        self.cooldown_until[seat] = 0.0

    def _aim(self, obs: Observation) -> float:
        # Ego frame: +x toward the opponent base. Aim the pan at the opponent's wrist (opponent_state[25:28]).
        wx, wy = obs.blocks["opponent_state"][25], obs.blocks["opponent_state"][26]
        return max(-0.8, min(0.8, math.atan2(wy, max(0.05, wx))))

    def act(self, seat: str, obs: Observation) -> Any:
        rng = self.rng.setdefault(seat, random.Random(0))
        pan = self._aim(obs)
        guard = _clamp_joints([pan * 0.6] + GUARD[1:])
        if not obs.is_fight:
            return {"action": guard, "info": {"state": "wait"}}

        ee = obs.ee_pos
        opp_ee = obs.opponent_ee_pos
        opp_vel = obs.opponent_ee_vel
        closing = _dist(opp_ee, ee) < THREAT_RANGE_M and math.sqrt(sum(v * v for v in opp_vel)) > THREAT_SPEED_MPS
        if closing:
            return {"action": guard, "intents": {"guard": True}, "info": {"state": "guard"}}

        opp_wrist = obs.blocks["opponent_state"][25:28]
        in_range = _dist(ee, opp_wrist) < STRIKE_RANGE_M
        if in_range and obs.t >= self.cooldown_until.get(seat, 0.0):
            self.cooldown_until[seat] = obs.t + 0.55 + rng.random() * 0.45
            out, hold = 5, 2
            profile = [(i + 1) / out for i in range(out)] + [1.0] * hold + [1 - (i + 1) / out for i in range(out)]
            chunk = [_clamp_joints([pan + JAB_DELTA[0] * s] + [g + d * s for g, d in zip(GUARD[1:], JAB_DELTA[1:])]) for s in profile]
            return {"action": chunk[0], "chunk": chunk, "chunk_hz": CONTROL_HZ, "chunk_start_t": obs.t, "info": {"state": "jab"}}

        return {"action": guard, "info": {"state": "stalk"}}


def main() -> None:
    args = cli_args("TORQUE LIMIT bridge/2 example policy: guard, read, jab.")
    from torquelimit_bridge import DEFAULT_ALLOWED_ORIGINS

    serve(CounterPuncher(), args.host, args.port, allowed_origins=DEFAULT_ALLOWED_ORIGINS + tuple(args.allow_origin),
          expected_schema_hash=args.schema_hash)


if __name__ == "__main__":
    main()
