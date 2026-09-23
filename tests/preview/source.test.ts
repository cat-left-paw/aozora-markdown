import { describe, expect, it } from "vitest";
import { sourceWindow } from "../../web/preview/source.js";
import { PREVIEW_LIMITS } from "../../web/preview/protocol.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("S8-04 source window", () => {
  it("shows the whole text when within 128 KiB", () => {
    expect(PREVIEW_LIMITS.sourceWindowBytes).toBe(131072);
    const bytes = enc("---\ntitle: 題\n---\n<script>alert(1)</script>\r\n");
    expect(sourceWindow(bytes)).toEqual({
      text: "---\ntitle: 題\n---\n<script>alert(1)</script>\r\n",
      shownBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      truncated: false,
    });
    expect(sourceWindow(new Uint8Array())).toEqual({
      text: "",
      shownBytes: 0,
      totalBytes: 0,
      truncated: false,
    });
  });
  it("cuts at a UTF-8 boundary for 1-, 2-, 3- and 4-byte characters", () => {
    for (const ch of ["a", "é", "あ", "𠮷"]) {
      const size = enc(ch).byteLength;
      const bytes = enc(ch.repeat(Math.ceil(131073 / size) + 1));
      const w = sourceWindow(bytes);
      expect(w.truncated).toBe(true);
      expect(w.totalBytes).toBe(bytes.byteLength);
      expect(w.shownBytes % size).toBe(0);
      expect(w.shownBytes).toBeLessThanOrEqual(131072);
      expect(w.shownBytes).toBeGreaterThan(131072 - size);
      expect(w.text).not.toContain("\uFFFD");
      expect(w.text).toBe(ch.repeat(w.shownBytes / size));
    }
  });
  it("exact limit is not truncated; limit + 1 is", () => {
    expect(sourceWindow(enc("a".repeat(131072))).truncated).toBe(false);
    expect(sourceWindow(enc("a".repeat(131073)))).toMatchObject({
      truncated: true,
      shownBytes: 131072,
    });
  });
  it("never modifies the artifact bytes", () => {
    const bytes = enc("あ".repeat(50000));
    const before = bytes.slice();
    sourceWindow(bytes);
    expect(bytes).toEqual(before);
  });
});
