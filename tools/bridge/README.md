# TORQUE LIMIT local bridge (`torquelimit.bridge/2`)

Put a policy running in Python (PyTorch, LeRobot, anything) into a TORQUE LIMIT seat.

**Before anything else, check the calibration against your real arm.** Simulation joints are radians at the
`so101.xml` zero pose; a LeRobot SO-101 reports calibrated units. Measure your arm's joint ranges and load them
with `calibration.Calibration.from_json` (see `docs/HARNESS.md`, *Calibration*). A policy trained on real data
with the wrong ranges will look broken in the ring, and a simulated policy will look broken on the bench.

## Run it

Python 3.9 or newer. The server itself uses only the standard library.

```bash
python tools/bridge/example_policy_server.py --port 8765     # guards, reads, throws chunked jabs
python tools/bridge/torquelimit_bridge.py --port 8765         # holds the guard pose (the smallest valid policy)
```

Then open the game over **http://localhost:3000** (an https page cannot open `ws://`), go to THE LAB, choose
**BRIDGE** for a seat, keep `ws://127.0.0.1:8765`, and press **RUN MATCH** (or **FIGHT IT** with a human seat).
From the command line:

```bash
node scripts/eval.mjs --suite smoke-v1 --policy ws://127.0.0.1:8765 --out .eval/bridge
```

The WebSocket and the HTTP fallback (`POST /v1/{hello,reset,warmup,act}`) share one port. Only
`http://localhost:3000` and `http://127.0.0.1:3000` may call the HTTP fallback from a browser; add others with
`--allow-origin`. The server binds loopback; `--host 0.0.0.0` exposes it on your network, which the Lab only
connects to with **ALLOW LAN** on.

## Write your own

```python
import torch
from torquelimit_bridge import Policy, cli_args, serve

class MyPolicy(Policy):
    name = "act_so101_v3"
    version = "2026-09-10"
    provenance = {"checkpoint": "outputs/train/act_so101/checkpoints/last", "framework": "lerobot"}
    supports_chunks = True
    max_chunk = 50
    chunk_hz = 50

    def __init__(self):
        self.model = load_model()                       # your code

    def reset(self, seat, seed, context):
        torch.manual_seed(seed)                         # per seat, per round: required for BIT-EXACT verify
        torch.use_deterministic_algorithms(True)

    def act(self, seat, obs):
        state = torch.tensor(obs.state[:6])             # joint positions, radians
        chunk = self.model(state).tolist()              # 50 x 6 absolute joint targets
        return {"chunk": chunk, "chunk_hz": 50, "chunk_start_t": obs.t, "info": {"entropy": 0.12}}

if __name__ == "__main__":
    args = cli_args("my policy")
    serve(MyPolicy(), args.host, args.port)
```

`act` returns 6 joint targets in radians, or a dict with `action`, `intents` (`{"guard": true}`), `chunk`,
`chunk_hz`, `chunk_start_t`, `intent_chunk`, and `info` (JSON, 4 KB at most). `obs` gives the six float32 blocks of
`torquelimit.obs/3` as lists (`obs.blocks["game"]`, …) with helpers `obs.q`, `obs.qd`, `obs.ee_pos`,
`obs.opponent_ee_pos`, `obs.is_fight`, and `obs.as_numpy()`. Block layouts: `public/schemas/torquelimit.obs-3.json`.

## Rules the app enforces

- One reply per `act`, with the same `id`. A reply for an older request is dropped and logged `late`.
- Live matches (a human is seated): 500 ms per act, then `timeout`; three in a row disconnect the seat.
  Eval matches wait as long as the policy needs, up to a 30 s hard abort (`policy_hang`).
- Warm-up: 8 acts flagged `"warmup": true` inside a 60 s budget before the first real act. They are not recorded.
- Targets are clamped to the joint limits; a clamp beyond 1e-5 rad is a violation and fails CLEARED FOR BROADCAST.
- Non-finite numbers are an error. The gripper channel is `targets[5]`; `intents.grip` is ignored for policies.
- `claimed_sha256` is stored as claimed. The app never presents it as verified.

## Test

```bash
python -m pip install numpy websockets pytest
python -m pytest tools/bridge tools/export
```
