#!/usr/bin/env python3
"""TORQUE LIMIT local policy bridge, protocol ``torquelimit.bridge/2`` (GAME_DESIGN 5.7).

A reference server you subclass to put your own robot policy in the ring::

    from torquelimit_bridge import Policy, serve

    class MyPolicy(Policy):
        name = "act_so101_v3"
        def reset(self, seat, seed, context):
            torch.manual_seed(seed)                   # determinism: the app sends a per-seat, per-round seed
        def act(self, seat, obs):
            return {"action": model(obs.state[:6])}  # 6 absolute joint targets in radians

    serve(MyPolicy(), port=8765)

Run the stock guard policy with one command::

    python tools/bridge/torquelimit_bridge.py --port 8765

WebSocket (``ws://127.0.0.1:8765``) and the HTTP fallback (``POST /v1/{hello,reset,warmup,act}``) are served on the
same port by one standard-library asyncio server, so there is nothing to install. Loopback only unless ``--host``
says otherwise. Python 3.9+.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import math
import random
import struct
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

PROTOCOL = "torquelimit.bridge/2"
OBS_SCHEMA = "torquelimit.obs/3"
DEFAULT_PORT = 8765
JOINT_NAMES = ("shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper")
JOINT_LIMITS = (
    (-1.91986, 1.91986), (-1.7453293, 1.7453293), (-1.69, 1.69),
    (-1.658063, 1.658063), (-2.7438473, 2.7438473), (-0.174533, 1.7453292),
)
BLOCKS = {"state": 12, "self_ext": 32, "opponent_state": 28, "game": 16, "environment_state": 81, "contacts": 20}
INTENT_NAMES = ("guard", "charge", "grip", "overdrive", "ability", "burst")
#: Home guard pose (rad): arm tucked in front of the camera mount, gripper open.
GUARD_POSE = (0.0, -0.62, 1.08, -0.48, 0.0, 1.15)
#: Origins the browser may call the HTTP fallback from.
DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
MAX_MESSAGE_BYTES = 16 * 1024 * 1024
INFO_CAP_BYTES = 4096
_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class BridgeProtocolError(Exception):
    """A message the bridge cannot accept. ``fatal`` errors end the session."""

    def __init__(self, message: str, fatal: bool = False) -> None:
        super().__init__(message)
        self.fatal = fatal


# ───────────────────────── observations ─────────────────────────


class Observation:
    """One ``act`` request: the six float32 blocks of torquelimit.obs/3 plus timing and optional images.

    Block layouts are in docs/HARNESS.md and public/schemas/torquelimit.obs-3.json. Handy views:
    ``obs.q`` (6 joint positions), ``obs.qd``, ``obs.ee_pos`` (ego metres), ``obs.opponent_ee_pos``.
    """

    __slots__ = ("seat", "tick", "t", "warmup", "blocks", "dict", "images")

    def __init__(self, msg: Dict[str, Any], images: Optional[Dict[str, Tuple[int, int, bytes]]] = None) -> None:
        self.seat: Optional[str] = msg.get("seat")
        self.tick: int = int(msg.get("tick", 0))
        self.t: float = float(msg.get("t", 0.0))
        self.warmup: bool = bool(msg.get("warmup", False))
        self.blocks: Dict[str, List[float]] = {}
        for name, size in BLOCKS.items():
            values = msg.get(name)
            if not isinstance(values, list) or len(values) != size:
                raise BridgeProtocolError(f"act.{name} must be {size} numbers")
            self.blocks[name] = [float(v) for v in values]
        self.dict: Optional[Dict[str, Any]] = msg.get("obs") if isinstance(msg.get("obs"), dict) else None
        self.images = images or {}

    @property
    def state(self) -> List[float]:
        return self.blocks["state"]

    @property
    def q(self) -> List[float]:
        return self.blocks["state"][0:6]

    @property
    def qd(self) -> List[float]:
        return self.blocks["state"][6:12]

    @property
    def ee_pos(self) -> List[float]:
        return self.blocks["self_ext"][0:3]

    @property
    def ee_vel(self) -> List[float]:
        return self.blocks["self_ext"][7:10]

    @property
    def last_action(self) -> List[float]:
        return self.blocks["self_ext"][25:31]

    @property
    def opponent_ee_pos(self) -> List[float]:
        return self.blocks["opponent_state"][12:15]

    @property
    def opponent_ee_vel(self) -> List[float]:
        return self.blocks["opponent_state"][19:22]

    @property
    def is_fight(self) -> bool:
        return self.blocks["game"][3] > 0.5

    def as_numpy(self) -> Dict[str, Any]:
        """Blocks as float32 numpy arrays (numpy must be installed)."""
        import numpy as np  # local import: the server itself needs only the standard library

        return {k: np.asarray(v, dtype=np.float32) for k, v in self.blocks.items()}


# ───────────────────────── policy interface ─────────────────────────


class Policy:
    """Subclass and override :meth:`act` (and :meth:`reset` if the policy keeps state).

    ``act`` returns either 6 joint targets (list/tuple/array, radians) or a dict with any of
    ``action`` (6 targets), ``intents`` ({"guard": bool, ...}), ``chunk`` (list of 6-vectors at ``chunk_hz``),
    ``chunk_hz``, ``chunk_start_t``, ``intent_chunk`` (INTENT_BITS per chunk step), and ``info`` (JSON, 4 KB max).
    Targets are clamped by the app to the joint limits; a clamp beyond 1e-5 rad counts as a violation.
    """

    name = "guard_pose"
    version: Optional[str] = None
    claimed_sha256: Optional[str] = None
    provenance: Dict[str, Any] = {}
    obs_format = "flat"          # "flat" or "dict" (dict adds the structured observation under msg["obs"])
    supports_chunks = False
    max_chunk = 1
    chunk_hz = 50

    def reset(self, seat: str, seed: int, context: Dict[str, Any]) -> None:
        """Called before every round for every seat this server plays. Seed your RNGs here:
        ``torch.manual_seed(seed)`` and ``torch.use_deterministic_algorithms(True)`` for bit-exact verification."""

    def act(self, seat: str, obs: Observation) -> Any:
        return list(GUARD_POSE)


# ───────────────────────── protocol session ─────────────────────────


def _finite_vector(values: Any, width: int, what: str) -> List[float]:
    try:
        seq = list(values.tolist() if hasattr(values, "tolist") else values)
    except TypeError as exc:
        raise BridgeProtocolError(f"{what} must be a sequence of {width} numbers") from exc
    if len(seq) != width:
        raise BridgeProtocolError(f"{what} must have {width} numbers, got {len(seq)}")
    out = []
    for v in seq:
        f = float(v)
        if not math.isfinite(f):
            raise BridgeProtocolError(f"{what} contains a non-finite number")
        out.append(f)
    return out


def encode_action(msg_id: int, result: Any, supports_chunks: bool) -> Dict[str, Any]:
    """Validates a policy's return value and builds the ``action`` reply."""
    reply: Dict[str, Any] = {"type": "action", "id": msg_id}
    if not isinstance(result, dict):
        reply["action"] = _finite_vector(result, 6, "action")
        return reply
    if "action" in result and result["action"] is not None:
        reply["action"] = _finite_vector(result["action"], 6, "action")
    if result.get("chunk") is not None:
        if not supports_chunks:
            raise BridgeProtocolError("policy returned a chunk but supports_chunks is False")
        chunk = [_finite_vector(row, 6, f"chunk[{i}]") for i, row in enumerate(result["chunk"])]
        if not chunk:
            raise BridgeProtocolError("chunk is empty")
        reply["chunk"] = chunk
        if result.get("chunk_hz") is not None:
            reply["chunk_hz"] = float(result["chunk_hz"])
        if result.get("chunk_start_t") is not None:
            reply["chunk_start_t"] = float(result["chunk_start_t"])
        if result.get("intent_chunk") is not None:
            bits = [int(b) for b in result["intent_chunk"]]
            if len(bits) != len(chunk):
                raise BridgeProtocolError("intent_chunk must match the chunk length")
            reply["intent_chunk"] = bits
    if "action" not in reply and "chunk" not in reply:
        raise BridgeProtocolError("policy returned neither action nor chunk")
    if result.get("intents"):
        reply["intents"] = {k: bool(v) for k, v in dict(result["intents"]).items() if k in INTENT_NAMES}
    if result.get("info") is not None:
        text = json.dumps(result["info"], allow_nan=False, default=str)
        reply["info"] = json.loads(text) if len(text) <= INFO_CAP_BYTES else {"truncated": True, "bytes": len(text)}
    return reply


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    try:
        import numpy as np

        np.random.seed(seed & 0xFFFFFFFF)
    except ImportError:
        pass
    # With PyTorch, add in your Policy.reset:
    #   torch.manual_seed(seed)
    #   torch.use_deterministic_algorithms(True)


class BridgeSession:
    """Protocol state for one browser connection. Transport-free: feed decoded messages, send the replies."""

    def __init__(self, policy: Policy, expected_schema_hash: Optional[str] = None) -> None:
        self.policy = policy
        self.expected_schema_hash = expected_schema_hash
        self.hello: Optional[Dict[str, Any]] = None
        self.seats: List[str] = []
        self.session_id: Optional[str] = None
        self.images: Dict[int, Dict[str, Tuple[int, int, bytes]]] = {}
        self.stats = {"acts": 0, "warmup_acts": 0, "resets": 0, "errors": 0}

    # Binary frame: [u32 act_id][u8 camera][u16 w][u16 h][RGB bytes], little-endian.
    CAMERAS = ("wrist", "overhead", "front")

    def handle_binary(self, data: bytes) -> None:
        if len(data) < 9:
            raise BridgeProtocolError("image frame too short")
        act_id, cam, w, h = struct.unpack_from("<IBHH", data, 0)
        if cam >= len(self.CAMERAS) or len(data) - 9 != w * h * 3:
            raise BridgeProtocolError("image frame header does not match its payload")
        self.images.setdefault(act_id, {})[self.CAMERAS[cam]] = (w, h, bytes(data[9:]))

    def handle(self, msg: Any) -> List[Dict[str, Any]]:
        """Returns the replies for one message (possibly none). Protocol errors become ``error`` replies."""
        msg_id = msg.get("id") if isinstance(msg, dict) else None
        try:
            if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
                raise BridgeProtocolError("messages are JSON objects with a type")
            kind = msg["type"]
            if kind == "hello":
                return [self._hello(msg)]
            if kind == "ping":
                return [{"type": "pong", "id": msg_id}]
            if kind in ("pong", "bye"):
                return []
            if self.hello is None:
                raise BridgeProtocolError(f"{kind} before hello", fatal=True)
            if kind == "reset":
                return [self._reset(msg)]
            if kind == "warmup":
                return []     # the acts that follow carry "warmup": true
            if kind == "act":
                return [self._act(msg)]
            raise BridgeProtocolError(f"unknown message type {kind}")
        except BridgeProtocolError as exc:
            self.stats["errors"] += 1
            return [{"type": "error", "id": msg_id, "message": str(exc), "fatal": exc.fatal}]
        except Exception as exc:  # the policy raised: report it, keep serving
            self.stats["errors"] += 1
            return [{"type": "error", "id": msg_id, "message": f"{type(exc).__name__}: {exc}", "fatal": False}]

    def _hello(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        if msg.get("protocol") != PROTOCOL:
            raise BridgeProtocolError(f"protocol {msg.get('protocol')} is not {PROTOCOL}", fatal=True)
        if msg.get("observation_schema") not in (None, OBS_SCHEMA):
            raise BridgeProtocolError(f"observation schema {msg.get('observation_schema')} is not {OBS_SCHEMA}", fatal=True)
        claimed = msg.get("obs_schema_hash")
        if self.expected_schema_hash and claimed != self.expected_schema_hash:
            raise BridgeProtocolError(f"obs_schema_hash {claimed} does not match {self.expected_schema_hash}", fatal=True)
        limits = msg.get("joint_limits")
        if limits is not None and (
            len(limits) != len(JOINT_LIMITS)
            or any(abs(float(a) - b) > 1e-6 for got, want in zip(limits, JOINT_LIMITS) for a, b in zip(got, want))
        ):
            raise BridgeProtocolError("joint_limits differ from the SO-101 limits this server was written for", fatal=True)
        self.hello = msg
        self.seats = list(msg.get("seats") or [])
        self.session_id = msg.get("session_id")
        p = self.policy
        return {
            "type": "hello_ok", "id": msg.get("id"),
            "policy": {"name": p.name, "version": p.version, "claimed_sha256": p.claimed_sha256, "provenance": dict(p.provenance)},
            "obs_format": "dict" if p.obs_format == "dict" else "flat",
            "supports_chunks": bool(p.supports_chunks), "max_chunk": int(p.max_chunk), "chunk_hz": float(p.chunk_hz),
        }

    def _reset(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        seat = msg.get("seat")
        seed = msg.get("seed")
        if not isinstance(seed, int):
            raise BridgeProtocolError("reset.seed must be an integer")
        _seed_everything(seed)
        self.policy.reset(seat, seed, msg.get("context") or {})
        self.images.clear()
        self.stats["resets"] += 1
        return {"type": "reset_ok", "id": msg.get("id")}

    def _act(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        msg_id = msg.get("id")
        if not isinstance(msg_id, int):
            raise BridgeProtocolError("act.id must be an integer")
        obs = Observation(msg, self.images.pop(msg_id, None))
        result = self.policy.act(obs.seat or "", obs)
        if obs.warmup:
            self.stats["warmup_acts"] += 1
        else:
            self.stats["acts"] += 1
        return encode_action(msg_id, result, self.policy.supports_chunks)


# ───────────────────────── transport: one port, WebSocket + HTTP ─────────────────────────


def websocket_accept(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + _WS_GUID).encode("ascii")).digest()).decode("ascii")


def encode_frame(opcode: int, payload: bytes, mask: Optional[bytes] = None) -> bytes:
    """One final WebSocket frame. Servers send unmasked frames; pass ``mask`` to build a client frame (tests)."""
    head = bytearray([0x80 | opcode])
    n = len(payload)
    mask_bit = 0x80 if mask else 0
    if n < 126:
        head.append(mask_bit | n)
    elif n < 1 << 16:
        head.append(mask_bit | 126)
        head += struct.pack(">H", n)
    else:
        head.append(mask_bit | 127)
        head += struct.pack(">Q", n)
    if mask:
        head += mask
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return bytes(head) + payload


async def read_frame(reader: asyncio.StreamReader) -> Tuple[bool, int, bytes]:
    """(fin, opcode, unmasked payload)."""
    b0, b1 = await reader.readexactly(2)
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    n = b1 & 0x7F
    if n == 126:
        (n,) = struct.unpack(">H", await reader.readexactly(2))
    elif n == 127:
        (n,) = struct.unpack(">Q", await reader.readexactly(8))
    if n > MAX_MESSAGE_BYTES:
        raise BridgeProtocolError("frame too large", fatal=True)
    mask = await reader.readexactly(4) if b1 & 0x80 else None
    data = await reader.readexactly(n)
    if mask:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data)) if n < 4096 else _unmask_fast(data, mask)
    return fin, opcode, data


def _unmask_fast(data: bytes, mask: bytes) -> bytes:
    n = len(data)
    key = int.from_bytes((mask * (n // 4 + 1))[:n], "little")
    return (int.from_bytes(data, "little") ^ key).to_bytes(n, "little")


class BridgeServer:
    """asyncio server: WebSocket upgrade on any path, ``POST /v1/<type>`` for the HTTP fallback, ``GET /`` status."""

    def __init__(self, policy: Policy, host: str = "127.0.0.1", port: int = DEFAULT_PORT,
                 allowed_origins: Sequence[str] = DEFAULT_ALLOWED_ORIGINS, expected_schema_hash: Optional[str] = None,
                 log: Any = None) -> None:
        self.policy = policy
        self.host = host
        self.port = port
        self.allowed_origins = tuple(allowed_origins)
        self.expected_schema_hash = expected_schema_hash
        self.http_session = BridgeSession(policy, expected_schema_hash)
        self.server: Optional[asyncio.AbstractServer] = None
        self.log = log if log is not None else (lambda line: print(line, file=sys.stderr, flush=True))
        self._policy_lock = asyncio.Lock()

    async def start(self) -> "BridgeServer":
        self.server = await asyncio.start_server(self._client, self.host, self.port)
        sock = self.server.sockets[0] if self.server.sockets else None
        if sock is not None:
            self.port = sock.getsockname()[1]
        return self

    async def close(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def _handle(self, session: BridgeSession, msg: Any) -> List[Dict[str, Any]]:
        # Policies are usually not thread-safe: one act at a time, off the event loop so pings keep flowing.
        async with self._policy_lock:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, session.handle, msg)

    async def _client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = (await reader.readline()).decode("latin-1").strip()
            if not request_line:
                return
            method, target, _version = (request_line.split(" ") + ["", ""])[:3]
            headers: Dict[str, str] = {}
            while True:
                line = (await reader.readline()).decode("latin-1")
                if line in ("\r\n", "\n", ""):
                    break
                name, _, value = line.partition(":")
                headers[name.strip().lower()] = value.strip()
            if headers.get("upgrade", "").lower() == "websocket":
                await self._websocket(reader, writer, headers)
            else:
                await self._http(reader, writer, method, target, headers)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    def _cors(self, headers: Dict[str, str]) -> List[Tuple[str, str]]:
        origin = headers.get("origin")
        if origin and origin in self.allowed_origins:
            return [("Access-Control-Allow-Origin", origin), ("Vary", "Origin"),
                    ("Access-Control-Allow-Methods", "POST, GET, OPTIONS"), ("Access-Control-Allow-Headers", "content-type"),
                    ("Access-Control-Allow-Private-Network", "true")]
        return []

    async def _http(self, reader, writer, method: str, target: str, headers: Dict[str, str]) -> None:
        cors = self._cors(headers)

        async def respond(status: str, body: bytes, content_type: str = "application/json") -> None:
            lines = [f"HTTP/1.1 {status}", f"Content-Type: {content_type}", f"Content-Length: {len(body)}", "Connection: close"]
            lines += [f"{k}: {v}" for k, v in cors]
            writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body)
            await writer.drain()

        if method == "OPTIONS":
            await respond("204 No Content", b"")
            return
        if method == "GET" and target in ("/", "/health"):
            text = f"TORQUE LIMIT {PROTOCOL} · policy {self.policy.name} · acts {self.http_session.stats['acts']}\n"
            await respond("200 OK", text.encode("utf-8"), "text/plain; charset=utf-8")
            return
        if method != "POST" or not target.startswith("/v1/"):
            await respond("404 Not Found", b'{"type":"error","message":"not found","fatal":false}')
            return
        length = int(headers.get("content-length", "0") or "0")
        if length > MAX_MESSAGE_BYTES:
            await respond("413 Payload Too Large", b'{"type":"error","message":"body too large","fatal":true}')
            return
        body = await reader.readexactly(length) if length else b""
        try:
            msg = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            await respond("400 Bad Request", b'{"type":"error","message":"body is not JSON","fatal":false}')
            return
        kind = target[len("/v1/"):].strip("/")
        if isinstance(msg, dict):
            msg.setdefault("type", kind)
        replies = await self._handle(self.http_session, msg)
        if kind == "warmup" and not replies:
            replies = [{"type": "warmup_ok", "id": msg.get("id") if isinstance(msg, dict) else None}]
        reply = replies[0] if replies else {"type": "ok"}
        await respond("200 OK", json.dumps(reply, allow_nan=False).encode("utf-8"))

    async def _websocket(self, reader, writer, headers: Dict[str, str]) -> None:
        key = headers.get("sec-websocket-key")
        if not key or headers.get("sec-websocket-version") != "13":
            writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
            return
        writer.write((
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {websocket_accept(key)}\r\n\r\n"
        ).encode("latin-1"))
        await writer.drain()
        session = BridgeSession(self.policy, self.expected_schema_hash)
        peer = writer.get_extra_info("peername")
        self.log(f"bridge: connection from {peer[0] if peer else '?'}")
        parts: List[bytes] = []
        part_opcode = 0

        async def send_json(obj: Dict[str, Any]) -> None:
            writer.write(encode_frame(0x1, json.dumps(obj, allow_nan=False).encode("utf-8")))
            await writer.drain()

        while True:
            fin, opcode, data = await read_frame(reader)
            if opcode == 0x8:                                   # close
                writer.write(encode_frame(0x8, data[:2]))
                await writer.drain()
                break
            if opcode == 0x9:                                   # ping
                writer.write(encode_frame(0xA, data))
                await writer.drain()
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x1, 0x2):
                parts, part_opcode = [data], opcode
            elif opcode == 0x0:
                parts.append(data)
            if not fin:
                continue
            payload = b"".join(parts)
            parts = []
            if part_opcode == 0x2:
                try:
                    session.handle_binary(payload)
                except BridgeProtocolError as exc:
                    await send_json({"type": "error", "id": None, "message": str(exc), "fatal": False})
                continue
            try:
                msg = json.loads(payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                await send_json({"type": "error", "id": None, "message": "frame is not JSON", "fatal": False})
                continue
            if isinstance(msg, dict) and msg.get("type") == "bye":
                break
            replies = await self._handle(session, msg)
            for reply in replies:
                await send_json(reply)
                if reply.get("type") == "hello_ok":
                    self.log(f"bridge: hello from session {session.session_id} seats {','.join(session.seats) or '?'}")
                if reply.get("type") == "error" and reply.get("fatal"):
                    writer.write(encode_frame(0x8, struct.pack(">H", 1008)))
                    await writer.drain()
                    return
        s = session.stats
        self.log(f"bridge: session {session.session_id} closed · {s['acts']} acts · {s['resets']} resets · {s['errors']} errors")


async def run_server(policy: Policy, host: str = "127.0.0.1", port: int = DEFAULT_PORT, **kw: Any) -> None:
    server = await BridgeServer(policy, host, port, **kw).start()
    server.log(f"TORQUE LIMIT {PROTOCOL} · policy {policy.name} · ws://{host}:{server.port} (HTTP fallback on the same port)")
    if host not in ("127.0.0.1", "localhost", "::1"):
        server.log("bridge: listening beyond loopback; turn on ALLOW LAN in the Lab to connect")
    assert server.server is not None
    async with server.server:
        await server.server.serve_forever()


def serve(policy: Policy, host: str = "127.0.0.1", port: int = DEFAULT_PORT, **kw: Any) -> None:
    """Blocking entry point for your own scripts."""
    try:
        asyncio.run(run_server(policy, host, port, **kw))
    except KeyboardInterrupt:
        pass


def cli_args(description: str, argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1; LAN needs ALLOW LAN in the Lab)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port for WebSocket and HTTP (default {DEFAULT_PORT})")
    parser.add_argument("--allow-origin", action="append", default=[], help="extra browser origin allowed to use the HTTP fallback")
    parser.add_argument("--schema-hash", default=None, help="reject apps whose obs_schema_hash differs (sha256:...)")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = cli_args("TORQUE LIMIT bridge/2 reference server (guard pose policy).", argv)
    serve(Policy(), args.host, args.port, allowed_origins=DEFAULT_ALLOWED_ORIGINS + tuple(args.allow_origin),
          expected_schema_hash=args.schema_hash)


if __name__ == "__main__":
    main()
