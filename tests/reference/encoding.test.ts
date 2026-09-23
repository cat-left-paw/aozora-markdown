import { it, expect, describe } from "vitest";
import { decodeTextBytes } from "../../src/encoding/index.js";
import { legacy, utf8 } from "../../src/encoding/codecs.js";
import * as cp from "../../src/encoding/cp932.generated.js";
import * as sj from "../../src/encoding/shiftJis.generated.js";
import cpOracle from "../fixtures/cp932-exhaustive.json";
import sjOracle from "../fixtures/shift_jis-exhaustive.json";
import fixtures from "../../design/fixtures/encoding-fixtures.json";
import side from "../../design/improvement-fixtures.json";
for (const c of fixtures)
  it("intentional-deviation encoding:" + c.id, () =>
    expect(decodeTextBytes(Uint8Array.from(Buffer.from(c.hex, "hex")))).toEqual(
      side.cases.find((s) => s.caseKey === "encoding:" + c.id)!.expected,
    ),
  );
for (const [name, codec, oracle] of [
  ["cp932", cp, cpOracle],
  ["shift_jis", sj, sjOracle],
] as const)
  describe(`R01 strict codec ${name}`, () => {
    it("all 256 single byte results including invalid lead EOF", () => {
      for (let a = 0; a < 256; a++)
        expect(legacy(new Uint8Array([a]), codec), String(a)).toBe(
          oracle.single[a],
        );
    });
    it("all 65,536 two byte results including invalid trails", () => {
      for (let a = 0; a < 256; a++)
        for (let b = 0; b < 256; b++)
          expect(legacy(new Uint8Array([a, b]), codec), `${a},${b}`).toBe(
            oracle.pairs[a * 256 + b],
          );
    });
  });
it("R01 explicit codec ambiguity and wave dash remain distinct", () => {
  const b = Uint8Array.from([0xe3, 0x81, 0x82, 0xe3, 0x81, 0x84]);
  expect(decodeTextBytes(b, { encoding: "cp932" })).toEqual({
    ok: true,
    text: "縺ゅ＞",
    encoding: "cp932",
    bom: false,
  });
  expect(
    decodeTextBytes(new Uint8Array([0x81, 0x60]), { encoding: "shift_jis" }),
  ).toEqual({ ok: true, text: "〜", encoding: "shift_jis", bom: false });
  expect(
    decodeTextBytes(new Uint8Array([0x81, 0x60]), { encoding: "cp932" }),
  ).toEqual({ ok: true, text: "～", encoding: "cp932", bom: false });
});
for (const a of [
  [0xc0, 0xaf],
  [0xed, 0xa0, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xe2, 0x82],
  [0x80],
  [0xf5, 0x80, 0x80, 0x80],
])
  it(`R01 UTF8 invalid ${a}`, () => {
    expect(utf8(new Uint8Array(a))).toBeNull();
    expect(decodeTextBytes(new Uint8Array(a), { encoding: "utf-8" })).toEqual({
      ok: false,
      code: "DECODE_FAILED",
    });
    expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...a]))).toEqual({
      ok: false,
      code: "DECODE_FAILED",
    });
  });
for (const a of [
  [0xff, 0xfe],
  [0xfe, 0xff],
  [0xff, 0xfe, 0, 0],
  [0, 0, 0xfe, 0xff],
])
  it(`R01 unsupported BOM ${a}`, () =>
    expect(decodeTextBytes(new Uint8Array(a))).toEqual({
      ok: false,
      code: "UNSUPPORTED_ENCODING",
    }));
it("R01 BOM conflict and successful newline normalization", () => {
  expect(
    decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, 65]), {
      encoding: "cp932",
    }),
  ).toEqual({ ok: false, code: "ENCODING_BOM_CONFLICT" });
  for (const encoding of ["utf-8", "cp932", "shift_jis"] as const)
    expect(
      decodeTextBytes(new Uint8Array([65, 13, 10, 66, 13, 67]), { encoding }),
    ).toEqual({ ok: true, text: "A\nB\nC", encoding, bom: false });
});
