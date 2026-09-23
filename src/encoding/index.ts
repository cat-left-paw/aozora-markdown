import * as cp932 from "./cp932.generated.js";
import * as shiftJis from "./shiftJis.generated.js";
import { legacy, utf8 } from "./codecs.js";
export type Encoding = "utf-8" | "cp932" | "shift_jis";
export interface DecodeOptions {
  encoding?: Encoding | "auto";
}
export type DecodeResult =
  | { ok: true; text: string; encoding: Encoding; bom: boolean }
  | {
      ok: false;
      code: "DECODE_FAILED" | "UNSUPPORTED_ENCODING" | "ENCODING_BOM_CONFLICT";
    };
export function decodeTextBytes(
  bytes: Uint8Array,
  options: DecodeOptions = {},
): DecodeResult {
  const enc = options.encoding ?? "auto";
  if (!["auto", "utf-8", "cp932", "shift_jis"].includes(enc))
    return { ok: false, code: "UNSUPPORTED_ENCODING" };
  const prefix = (...values: number[]) =>
    values.every((x, i) => bytes[i] === x);
  if (
    prefix(0, 0, 0xfe, 0xff) ||
    prefix(0xff, 0xfe, 0, 0) ||
    prefix(0xfe, 0xff) ||
    prefix(0xff, 0xfe)
  )
    return { ok: false, code: "UNSUPPORTED_ENCODING" };
  const bom = prefix(0xef, 0xbb, 0xbf);
  if (bom && enc !== "auto" && enc !== "utf-8")
    return { ok: false, code: "ENCODING_BOM_CONFLICT" };
  const data = bom ? bytes.subarray(3) : bytes;
  const candidates: Encoding[] = bom
    ? ["utf-8"]
    : enc === "auto"
      ? ["utf-8", "cp932", "shift_jis"]
      : [enc];
  for (const encoding of candidates) {
    const text =
      encoding === "utf-8"
        ? utf8(data)
        : legacy(data, encoding === "cp932" ? cp932 : shiftJis);
    if (text !== null)
      return { ok: true, text: text.replace(/\r\n?/gu, "\n"), encoding, bom };
  }
  return { ok: false, code: "DECODE_FAILED" };
}
