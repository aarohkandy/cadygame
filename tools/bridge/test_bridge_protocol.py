"""torquelimit.bridge/2 reference server: protocol session, WebSocket and HTTP transports, example policy.

Runs with the standard library. When the ``websockets`` package is installed, one more test checks
interoperability with a third-party client.
"""

import asyncio
import json
import math
import os
import struct
import sys
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torquelimit_bridge as tb  # noqa: E402
from example_policy_server import CounterPuncher  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def hello(**extra):
    msg = {
        "type": "hello", "id": 1, "protocol": tb.PROTOCOL, "observation_schema": tb.OBS_SCHEMA,
        "obs_schema_hash": "sha256:test", "session_id": "s-1", "seats": ["blaze"], "control_hz": 50, "decision_hz": 25,
        "joint_names": list(tb.JOINT_NAMES), "joint_limits": [list(l) for l in tb.JOINT_LIMITS], "units": "rad",
        "formats": ["dict", "flat"],
    }
    msg.update(extra)
    return msg


def act(msg_id, tick=0, t=0.0, fight=True, warmup=False, **blocks):
    body = {"type": "act", "id": msg_id, "seat": "blaze", "tick": tick, "t": t, "warmup": warmup}
    for name, size in tb.BLOCKS.items():
        body[name] = [0.0] * size
    if fight:
        body["game"][3] = 1.0
    body.update(blocks)
    return body


class SessionTest(unittest.TestCase):
    def test_handshake_reset_act(self):
        s = tb.BridgeSession(tb.Policy())
        (ok,) = s.handle(hello())
        self.assertEqual(ok["type"], "hello_ok")
        self.assertEqual(ok["id"], 1)
        self.assertEqual(ok["policy"]["name"], "guard_pose")
        self.assertEqual(ok["obs_format"], "flat")
        self.assertEqual(s.handle({"type": "reset", "id": 2, "seat": "blaze", "seed": 7, "context": {}}), [{"type": "reset_ok", "id": 2}])
        self.assertEqual(s.handle({"type": "warmup", "id": 3, "seat": "blaze", "count": 8}), [])
        (reply,) = s.handle(act(4))
        self.assertEqual(reply, {"type": "action", "id": 4, "action": list(tb.GUARD_POSE)})
        self.assertEqual(s.handle({"type": "ping", "id": 5}), [{"type": "pong", "id": 5}])

    def test_act_before_hello_is_fatal(self):
        (err,) = tb.BridgeSession(tb.Policy()).handle(act(1))
        self.assertEqual(err["type"], "error")
        self.assertTrue(err["fatal"])

    def test_rejects_wrong_protocol_and_schema_hash(self):
        (err,) = tb.BridgeSession(tb.Policy()).handle(hello(protocol="torquelimit.bridge/1"))
        self.assertTrue(err["fatal"])
        (err,) = tb.BridgeSession(tb.Policy(), expected_schema_hash="sha256:other").handle(hello())
        self.assertTrue(err["fatal"])
        self.assertIn("obs_schema_hash", err["message"])

    def test_malformed_act_and_policy_errors_are_not_fatal(self):
        class Broken(tb.Policy):
            def act(self, seat, obs):
                if obs.tick == 1:
                    return [0.0, math.nan, 0, 0, 0, 0]
                if obs.tick == 2:
                    raise RuntimeError("CUDA OOM")
                return [0.0] * 5

        s = tb.BridgeSession(Broken())
        s.handle(hello())
        bad_block = act(10)
        bad_block["state"] = [0.0] * 11
        for msg in (bad_block, act(11, tick=1), act(12, tick=2), act(13, tick=3)):
            (err,) = s.handle(msg)
            self.assertEqual(err["type"], "error", err)
            self.assertFalse(err["fatal"])
            self.assertEqual(err["id"], msg["id"])
        self.assertIn("CUDA OOM", s.handle(act(14, tick=2))[0]["message"])
        self.assertEqual(s.stats["errors"], 5)

    def test_chunk_and_intents_encoding(self):
        reply = tb.encode_action(9, {"chunk": [[0.1] * 6, [0.2] * 6], "chunk_hz": 50, "chunk_start_t": 1.5,
                                     "intent_chunk": [1, 0], "intents": {"guard": 1, "bogus": True}, "info": {"k": 1}}, True)
        self.assertEqual(reply["chunk"], [[0.1] * 6, [0.2] * 6])
        self.assertEqual(reply["intent_chunk"], [1, 0])
        self.assertEqual(reply["intents"], {"guard": True})
        self.assertEqual(reply["info"], {"k": 1})
        with self.assertRaises(tb.BridgeProtocolError):
            tb.encode_action(9, {"chunk": [[0.1] * 6]}, False)
        big = tb.encode_action(9, {"action": [0] * 6, "info": {"blob": "x" * 5000}}, False)
        self.assertEqual(big["info"]["truncated"], True)

    def test_image_frames_attach_to_their_act(self):
        seen = {}

        class Watcher(tb.Policy):
            def act(self, seat, obs):
                seen.update(obs.images)
                return list(tb.GUARD_POSE)

        s = tb.BridgeSession(Watcher())
        s.handle(hello())
        s.handle_binary(struct.pack("<IBHH", 21, 1, 2, 1) + bytes(6))
        s.handle(act(21))
        self.assertEqual(seen["overhead"][0:2], (2, 1))
        with self.assertRaises(tb.BridgeProtocolError):
            s.handle_binary(struct.pack("<IBHH", 22, 0, 4, 4) + bytes(3))

    def test_seed_makes_resets_reproducible(self):
        a, b = tb.BridgeSession(CounterPuncher()), tb.BridgeSession(CounterPuncher())
        outputs = []
        for s in (a, b):
            s.handle(hello())
            s.handle({"type": "reset", "id": 2, "seat": "blaze", "seed": 314159, "context": {}})
            run = []
            for i in range(60):
                opp = [0.0] * 28
                opp[25], opp[26], opp[27] = 0.25, 0.02 * math.sin(i), 0.15
                run.append(s.handle(act(100 + i, tick=i, t=i / 50, opponent_state=opp))[0])
            outputs.append(run)
        self.assertEqual(outputs[0], outputs[1])
        self.assertTrue(any("chunk" in r for r in outputs[0]), "the example policy should throw at least one jab")


class _ClientSocket:
    """Minimal RFC 6455 client (masked frames) for exercising the server."""

    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer

    @classmethod
    async def connect(cls, port):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        key = "dGhlIHNhbXBsZSBub25jZQ=="
        writer.write((f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        await writer.drain()
        status = await reader.readline()
        assert b"101" in status, status
        headers = b""
        while not headers.endswith(b"\r\n\r\n"):
            headers += await reader.read(1)
        assert tb.websocket_accept(key).encode() in headers
        return cls(reader, writer)

    async def send(self, obj, split=False):
        data = json.dumps(obj).encode()
        mask = b"\x01\x02\x03\x04"
        if split:
            half = len(data) // 2
            first = bytearray(tb.encode_frame(0x1, data[:half], mask))
            first[0] &= 0x7F                                   # not final
            self.writer.write(bytes(first) + tb.encode_frame(0x0, data[half:], mask))
        else:
            self.writer.write(tb.encode_frame(0x1, data, mask))
        await self.writer.drain()

    async def recv(self):
        fin, opcode, data = await tb.read_frame(self.reader)
        assert fin
        return opcode, data

    async def recv_json(self):
        opcode, data = await self.recv()
        assert opcode == 0x1, opcode
        return json.loads(data)


class TransportTest(unittest.TestCase):
    def run_async(self, coro):
        return asyncio.run(coro)

    def test_websocket_session_with_fragmented_frames_and_ping(self):
        async def scenario():
            server = await tb.BridgeServer(CounterPuncher(), port=0, log=lambda _l: None).start()
            try:
                ws = await _ClientSocket.connect(server.port)
                await ws.send(hello())
                self.assertEqual((await ws.recv_json())["type"], "hello_ok")
                await ws.send({"type": "reset", "id": 2, "seat": "blaze", "seed": 1, "context": {}})
                self.assertEqual((await ws.recv_json())["type"], "reset_ok")
                big = act(3)
                await ws.send(big, split=True)
                reply = await ws.recv_json()
                self.assertEqual((reply["type"], reply["id"]), ("action", 3))
                ws.writer.write(tb.encode_frame(0x9, b"hi", b"\x00\x00\x00\x00"))
                await ws.writer.drain()
                self.assertEqual(await ws.recv(), (0xA, b"hi"))
                for i in range(200):
                    await ws.send(act(10 + i, tick=i, t=i / 50))
                    self.assertEqual((await ws.recv_json())["id"], 10 + i)
                ws.writer.write(tb.encode_frame(0x8, struct.pack(">H", 1000), b"\x09\x09\x09\x09"))
                await ws.writer.drain()
                opcode, _ = await ws.recv()
                self.assertEqual(opcode, 0x8)
                ws.writer.close()
            finally:
                await server.close()

        self.run_async(scenario())

    def test_http_fallback_and_cors(self):
        async def scenario():
            server = await tb.BridgeServer(tb.Policy(), port=0, log=lambda _l: None).start()
            loop = asyncio.get_running_loop()

            def post(kind, body, origin="http://localhost:3000"):
                req = urllib.request.Request(f"http://127.0.0.1:{server.port}/v1/{kind}", data=json.dumps(body).encode(),
                                             headers={"content-type": "application/json", "Origin": origin}, method="POST")
                with urllib.request.urlopen(req, timeout=5) as res:
                    return dict(res.headers), json.loads(res.read())

            try:
                headers, ok = await loop.run_in_executor(None, post, "hello", hello())
                self.assertEqual(ok["type"], "hello_ok")
                self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:3000")
                _, reset = await loop.run_in_executor(None, post, "reset", {"id": 2, "seat": "blaze", "seed": 3, "context": {}})
                self.assertEqual(reset["type"], "reset_ok")
                _, warm = await loop.run_in_executor(None, post, "warmup", {"id": 3, "seat": "blaze", "count": 8})
                self.assertEqual(warm["type"], "warmup_ok")
                _, action = await loop.run_in_executor(None, post, "act", act(4))
                self.assertEqual(action["action"], list(tb.GUARD_POSE))
                headers, _ = await loop.run_in_executor(None, post, "act", act(5), "http://evil.example")
                self.assertNotIn("Access-Control-Allow-Origin", headers)
            finally:
                await server.close()

        self.run_async(scenario())

    @unittest.skipUnless(__import__("importlib").util.find_spec("websockets"), "websockets is not installed")
    def test_interoperates_with_websockets_client(self):
        import websockets

        async def scenario():
            server = await tb.BridgeServer(tb.Policy(), port=0, log=lambda _l: None).start()
            try:
                async with websockets.connect(f"ws://127.0.0.1:{server.port}") as ws:
                    await ws.send(json.dumps(hello()))
                    self.assertEqual(json.loads(await ws.recv())["type"], "hello_ok")
                    await ws.send(json.dumps({"type": "reset", "id": 2, "seat": "blaze", "seed": 9, "context": {}}))
                    self.assertEqual(json.loads(await ws.recv())["type"], "reset_ok")
                    for i in range(50):
                        await ws.send(json.dumps(act(10 + i, tick=i)))
                        self.assertEqual(json.loads(await ws.recv())["id"], 10 + i)
            finally:
                await server.close()

        self.run_async(scenario())


class ContractTest(unittest.TestCase):
    def test_constants_match_the_game_contracts(self):
        with open(os.path.join(ROOT, "src/game/contracts.ts"), encoding="utf-8") as fh:
            contracts = fh.read()
        for name, size in tb.BLOCKS.items():
            self.assertRegex(contracts, rf"\b{name}: {size}\b")
        limits = contracts[contracts.index("JOINT_LIMITS"):contracts.index("VIOLATION_TOLERANCE_RAD")]
        for lo, hi in tb.JOINT_LIMITS:
            self.assertIn(f"[{lo}, {hi}]", limits)
        self.assertIn(f'"{tb.OBS_SCHEMA}"', contracts)


if __name__ == "__main__":
    unittest.main()
