import { PREVIEW_LIMITS } from "./protocol.js";

export interface SourceWindow {
  text: string;
  shownBytes: number;
  totalBytes: number;
  truncated: boolean;
}
/**
 * Leading window of the artifact bytes for the text tab. The cut moves back
 * over UTF-8 continuation bytes, so no code point (including supplementary
 * characters) is split. The bytes are only viewed, never copied or modified.
 */
export function sourceWindow(
  bytes: Uint8Array,
  limit: number = PREVIEW_LIMITS.sourceWindowBytes,
): SourceWindow {
  let end = bytes.byteLength;
  if (end > limit) {
    end = limit;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  }
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    bytes.subarray(0, end),
  );
  return {
    text,
    shownBytes: end,
    totalBytes: bytes.byteLength,
    truncated: end < bytes.byteLength,
  };
}
