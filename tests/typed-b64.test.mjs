import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TypedDecodeError, base64Decode, base64DecodeTable, base64Encode, base64EncodeTable, bytesEqual, decodeTyped, decodeTypedAs,
  dtypeOf, encodeTyped,
} from "../src/game/harness/typed-b64.ts";

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

describe("typed-b64", () => {
  test("every dtype round-trips bit for bit, including NaN payloads, -0, and subnormals", () => {
    const f64 = new Float64Array([0, -0, 1 / 3, Number.MIN_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN, 5e-324]);
    const nanView = new DataView(f64.buffer);
    nanView.setBigUint64(7 * 8, 0x7ff8_dead_beef_0001n, true);   // a NaN with a payload
    const f32 = new Float32Array([Math.fround(0.1), -0, NaN, 3.4e38, 1.4e-45]);
    const cases = [f64, f32, new Uint32Array([0, 1, 0xffffffff]), new Int32Array([-1, 2 ** 31 - 1, -(2 ** 31)]),
      new Int16Array([-32768, 32767, -1]), new Uint8Array([0, 127, 255])];
    for (const arr of cases) {
      const enc = encodeTyped(arr);
      assert.equal(enc.dtype, dtypeOf(arr));
      assert.equal(enc.length, arr.length);
      const back = decodeTyped(JSON.parse(JSON.stringify(enc)));
      assert.ok(bytesEqual(arr, back), enc.dtype);
      assert.deepEqual(bytesOf(back), bytesOf(arr));
    }
  });

  test("encodes a view without leaking bytes outside it", () => {
    const whole = new Float64Array([1, 2, 3, 4]);
    const view = whole.subarray(1, 3);
    const back = decodeTyped(encodeTyped(view));
    assert.deepEqual(Array.from(back), [2, 3]);
    assert.equal(back.byteOffset, 0);
  });

  test("the table codec matches the native codec for every tail length", () => {
    for (let n = 0; n < 70; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 73 + n) & 0xff);
      const text = base64EncodeTable(b);
      assert.equal(text, Buffer.from(b).toString("base64"));
      assert.equal(base64Encode(b), text);
      assert.deepEqual(base64DecodeTable(text), b);
      assert.deepEqual(base64Decode(text), b);
    }
  });

  test("rejects an unknown dtype, a length mismatch, and damaged base64 with typed errors", () => {
    const good = encodeTyped(new Float32Array([1, 2]));
    const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof TypedDecodeError); return e.code; } return "no error"; };
    assert.equal(code(() => decodeTyped({ ...good, dtype: "f16" })), "unknown_dtype");
    assert.equal(code(() => decodeTyped({ ...good, length: 3 })), "length_mismatch");
    assert.equal(code(() => decodeTyped({ ...good, b64: `${good.b64.slice(0, -2)}!=` })), "bad_base64");
    assert.equal(code(() => base64DecodeTable("ab=c")), "bad_base64");
    assert.equal(code(() => base64DecodeTable("abc")), "bad_base64");
    assert.equal(code(() => decodeTyped(null)), "bad_shape");
    assert.equal(code(() => decodeTypedAs(good, "f64")), "bad_shape");
  });

  test("a 12 MB column encodes and decodes quickly", () => {
    const big = new Float64Array(1_500_000).map((_, i) => Math.sin(i));
    const t0 = performance.now();
    const enc = encodeTyped(big);
    const back = decodeTyped(enc);
    const ms = performance.now() - t0;
    assert.ok(bytesEqual(big, back));
    assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  });
});
