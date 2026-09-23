// CP437 mapping generated from CPython 3.12.8 bytes.decode("cp437").
// Filename decoding is independent of the Aozora body encoding selection.
import { ImportFailure } from "./limits.js";
import { CP437 } from "./cp437.generated.js";
export function basicFilename(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8) return Array.from(bytes, (b) => CP437[b]).join("");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ImportFailure(
      "ZIP_FILENAME_ENCODING",
      "metadata",
      "unit",
      "invalid-utf8-filename",
    );
  }
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function unicodeFilename(
  raw: Uint8Array,
  extra: Uint8Array,
  basic: string,
): { name: string; warning?: string } {
  let offset = 0,
    name = basic,
    seen = false;
  while (offset < extra.length) {
    if (offset + 4 > extra.length)
      return { name: basic, warning: "malformed-extra-field" };
    const view = new DataView(
      extra.buffer,
      extra.byteOffset + offset,
      extra.length - offset,
    );
    const type = view.getUint16(0, true),
      length = view.getUint16(2, true);
    offset += 4;
    if (offset + length > extra.length)
      return { name: basic, warning: "malformed-extra-field" };
    if (type === 0x7075) {
      if (seen) return { name: basic, warning: "duplicate-unicode-path" };
      seen = true;
      if (length < 5 || extra[offset] !== 1)
        return { name: basic, warning: "unicode-path-version" };
      if (view.getUint32(5, true) !== crc32(raw))
        return { name: basic, warning: "unicode-path-crc" };
      try {
        name = basicFilename(extra.subarray(offset + 5, offset + length), true);
      } catch {
        return { name: basic, warning: "unicode-path-utf8" };
      }
    }
    offset += length;
  }
  return { name };
}
