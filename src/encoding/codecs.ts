import type * as cp932 from "./cp932.generated.js";
export function legacy(bytes: Uint8Array, codec: typeof cp932): string | null {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const single = codec.single[bytes[i]];
    if (single !== null) {
      parts.push(single);
      continue;
    }
    if (i + 1 === bytes.length) return null;
    const pair = codec.pairs[bytes[i] * 256 + bytes[++i]];
    if (pair === undefined) return null;
    parts.push(pair);
  }
  return parts.join("");
}
/** Strict UTF-8 implemented explicitly so core/encoding don't require DOM typings or Node APIs. */
export function utf8(bytes: Uint8Array): string | null {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i++];
    if (a < 0x80) {
      parts.push(String.fromCharCode(a));
      continue;
    }
    const size =
      a >= 0xc2 && a <= 0xdf
        ? 2
        : a >= 0xe0 && a <= 0xef
          ? 3
          : a >= 0xf0 && a <= 0xf4
            ? 4
            : 0;
    if (!size || i + size - 1 > bytes.length) return null;
    let cp = a & ((1 << (7 - size)) - 1);
    for (let j = 1; j < size; j++) {
      const b = bytes[i++];
      if ((b & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (b & 0x3f);
    }
    if (
      cp < (size === 2 ? 0x80 : size === 3 ? 0x800 : 0x10000) ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    )
      return null;
    parts.push(String.fromCodePoint(cp));
  }
  return parts.join("");
}
