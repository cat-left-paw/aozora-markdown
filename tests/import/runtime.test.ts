import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  prepareImport,
  DEFAULT_IMPORT_LIMITS,
  resolveLimits,
  type ImportInput,
  type ImportLimits,
  type ImportOptions,
} from "../../src/import/index.js";
import {
  basicFilename,
  unicodeFilename,
  crc32,
} from "../../src/import/filenameDecoding.js";
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);
const loose = (id = "loose", name = "x.txt", text = "OK"): ImportInput => ({
  id,
  name,
  kind: name.toLowerCase().endsWith(".md") ? "md" : "txt",
  bytes: bytes(text),
});
const zip = (name = "normal.zip", id = name): ImportInput => ({
  id,
  name,
  kind: "zip",
  bytes: new Uint8Array(readFileSync("tests/fixtures/zip/" + name)),
});
const plain: ImportOptions = {
  conversion: {
    addFrontmatter: false,
    removeAnnotationBlocks: false,
    removeAozoraFooter: false,
  },
};
const run = (input: ImportInput, options: ImportOptions = plain) =>
  prepareImport([input], options);
describe("S2-01 byte/core connection", () => {
  it.each(["txt", "md"])(
    "unchanged explicitly selected %s is an artifact",
    async (kind) => {
      const r = await run(loose("id", "x_converted." + kind));
      expect(r.status).toBe("completed");
      expect(r.artifacts[0].conversion.text).toBe("OK");
      expect(r.metrics.conversions).toBe(1);
      expect(r.artifacts[0].relativePath).toBe(
        kind === "md" ? "x_converted_converted.md" : "x_converted.md",
      );
    },
  );
  it.each([
    ["utf-8", [0xef, 0xbb, 0xbf, 0xe9, 0xa1, 0x8c], true],
    ["cp932", [0x91, 0xe8], false],
    ["shift_jis", [0x91, 0xe8], false],
  ] as const)("strict %s decoding", async (encoding, b, bom) => {
    const r = await run(
      { ...loose(), bytes: new Uint8Array(b) },
      { ...plain, encoding },
    );
    expect(r.artifacts[0].conversion.text).toBe("題");
    expect(r.artifacts[0].decoded).toEqual({ encoding, bom });
    expect([...r.artifacts[0].bytes]).toEqual([...bytes("題")]);
  });
  it("strict decoding and BOM conflict never rescue lossily", async () => {
    for (const [b, encoding] of [
      [[0x81], "auto"],
      [[0xef, 0xbb, 0xbf, 65], "cp932"],
    ] as const) {
      const r = await run(
        { ...loose(), bytes: new Uint8Array(b) },
        { ...plain, encoding },
      );
      expect(r.status).toBe("failed");
      expect(r.artifacts).toEqual([]);
    }
  });
  // aozora-ts-v3 S2-01-rename-and-gating: renameToMd -> outputExtension.
  it.each([undefined, "md", "txt"] as const)(
    "outputExtension default/explicit %s",
    async (outputExtension) => {
      const r = await run(loose(), { ...plain, outputExtension });
      expect(r.contract).toBe("aozora-import-v2");
      expect(r.artifacts[0].format).toBe(outputExtension ?? "md");
      expect(r.artifacts[0].relativePath).toBe(
        outputExtension === "txt" ? "x_converted.txt" : "x.md",
      );
      expect(r.artifacts[0].conversion).not.toHaveProperty("isMarkdownOutput");
    },
  );
  it("TXT output converts like MD; normalized newlines, nonmutation, and once-per-body core call", async () => {
    const input = loose("id", "x.txt", "青［＃「青」は大見出し］\r\n");
    const before = input.bytes.slice();
    const options: ImportOptions = Object.freeze({
      ...plain,
      outputExtension: "txt",
      conversion: Object.freeze({ ...plain.conversion }),
    });
    const r = await run(input, options);
    expect(r.artifacts[0].conversion.text).toBe("## 青\n");
    expect(r.artifacts[0].conversion.text).not.toContain("\r");
    expect(input.bytes).toEqual(before);
    expect(input.bytes.byteLength).toBe(before.length);
    expect(r.metrics.conversions).toBe(1);
  });
  it("kind mismatch is a unit failure; duplicate ID is batch error", async () => {
    expect(
      (await prepareImport([{ ...loose(), kind: "md" }, loose("other")], plain))
        .status,
    ).toBe("partial");
    expect((await prepareImport([loose(), loose()], plain)).artifacts).toEqual(
      [],
    );
    expect((await run({ ...loose(), id: "" })).diagnostics[0].reason).toBe(
      "invalid-or-duplicate-id",
    );
  });
});
describe("S2-02/03 real independent ZIPs", () => {
  it("reads duplicates individually; never expands ignored payloads", async () => {
    const r = await run(zip());
    expect(r.diagnostics).toEqual([]);
    expect(r.status).toBe("completed");
    expect(r.artifacts.map((a) => a.conversion.text)).toEqual([
      "FIRST",
      "SECOND",
      "｜青《﹅》",
      "OTHER",
    ]);
    expect(r.artifacts.map((a) => a.relativePath)).toEqual([
      "normal/same.md",
      "normal/same_converted.md",
      "normal/a/book.md",
      "normal/b/book.md",
    ]);
    expect(r.metrics).toMatchObject({
      zipEntries: 7,
      payloadReads: 4,
      conversions: 4,
      readersOpened: 1,
      readersClosed: 1,
      payloadStreamsClosed: 4,
      payloadStreamsAborted: 0,
    });
    expect(
      r.outcomes.filter(
        (o) => o.entryIndex !== undefined && o.status === "ignored",
      ),
    ).toHaveLength(3);
    expect(r.artifacts.slice(0, 2).map((a) => a.fileId)).toEqual([
      '["normal.zip",0]',
      '["normal.zip",1]',
    ]);
  });
  it.each(["empty", "ignored"])(
    "%s archives have explicit no-output outcomes",
    async (name) => {
      const r = await run(zip(name + ".zip"));
      expect(r.status).toBe("completed");
      expect(r.artifacts).toEqual([]);
      expect(r.outcomes[0].status).toBe(name);
      expect(r.metrics.payloadReads).toBe(0);
    },
  );
  it.each([
    ["cp437", "café.txt"],
    ["utf8-unflagged", "├⌐.txt"],
    ["utf8", "題.TXT"],
    ["unicode-valid", "題.txt"],
  ])("filename %s", async (name, expected) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("completed");
    expect(r.outcomes[1].zipName?.adoptedName).toBe(expected);
    expect(r.outcomes[1].zipName?.rawBytes).toBeInstanceOf(Uint8Array);
  });
  it.each(["unicode-bad-crc", "unicode-bad-version", "unicode-bad-utf8"])(
    "invalid extra %s falls back with reason",
    async (name) => {
      const r = await run(zip(name + ".zip"));
      expect(r.status).toBe("completed");
      expect(r.outcomes[1].zipName?.adoptedName).toBe("base.txt");
      expect(r.diagnostics[0].code).toBe("ZIP_UNICODE_PATH_IGNORED");
    },
  );
  it.each([
    "dotdot",
    "backdot",
    "drive",
    "unc",
    "absolute",
    "nul",
    "c0",
    "unsafe-ignored",
    "unsafe-directory",
    "unsafe-nested",
    "symlink",
    "unicode-decoded-unsafe",
    "unicode-raw-unsafe",
    "utf8-invalid",
    "unknown-flag",
  ])("reject %s before any payload", async (name) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.payloadReads).toBe(0);
    expect(r.metrics.readersOpened).toBe(r.metrics.readersClosed);
  });
  it.each([
    "unicode-local-unsafe",
    "unicode-local-mismatch",
    "payload-central",
    "descriptor-bad",
    "zip64-unsafe",
    "encrypted",
    "unsupported",
    "split",
    "bad-crc",
    "bad-deflate",
    "header-name",
    "header-method",
    "header-zero",
    "header-flag",
    "offset",
    "overlap",
    "truncated",
    "appended",
    "prepended",
    "forged-small",
    "forged-large",
  ])("reject integrity/feature %s", async (name) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.metrics.readersOpened).toBe(r.metrics.readersClosed);
  });
  it.each([
    ...Array.from({ length: 5 }, (_, index) => `prefix-rebased-${index + 1}`),
    ...Array.from(
      { length: 5 },
      (_, index) => `prefix-unadjusted-${index + 1}`,
    ),
    ...Array.from({ length: 5 }, (_, index) => `empty-prefix-${index + 1}`),
  ])("reject %s as prepended data before payload", async (name) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.payloadReads).toBe(0);
    expect(r.diagnostics[0]).toMatchObject({
      code: "ZIP_HEADER_MISMATCH",
      stage: "structure",
      reason: "prepended-data",
    });
  });
  it.each(["eocd-disk-entries-0", "eocd-disk-entries-2"])(
    "reject %s count mismatch before payload",
    async (name) => {
      const r = await run(zip(name + ".zip"));
      expect(r.status).toBe("failed");
      expect(r.artifacts).toEqual([]);
      expect(r.metrics.payloadReads).toBe(0);
      expect(r.diagnostics[0]).toMatchObject({
        code: "ZIP_HEADER_MISMATCH",
        stage: "structure",
        reason: "end-record-entry-count",
      });
    },
  );
  it("rejects a ZIP64 count sentinel without its end records", async () => {
    const r = await run(zip("eocd-disk-entries-sentinel.zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.payloadReads).toBe(0);
    expect(r.diagnostics[0]).toMatchObject({
      code: "ZIP_HEADER_MISMATCH",
      stage: "structure",
      reason: "zip64-locator-missing",
    });
  });
  it.each(
    ["size", "offset", "both"].flatMap((mode) =>
      [0, 2].map((count) => `zip64-disk-${count}-${mode}`),
    ),
  )("rejects non-sentinel ZIP64 count mismatch %s", async (name) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.payloadReads).toBe(0);
    expect(r.diagnostics[0]).toMatchObject({
      code: "ZIP_HEADER_MISMATCH",
      stage: "structure",
      reason: "end-record-entry-count",
    });
  });
  it("keeps real EOCD ambiguity rejected before payload", async () => {
    const r = await run(zip("comment-real-ambiguity.zip"));
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.payloadReads).toBe(0);
  });
  it("discards a ZIP64 count mismatch while a loose input survives", async () => {
    const r = await prepareImport(
      [zip("zip64-disk-0-size.zip"), loose()],
      plain,
    );
    expect(r.status).toBe("partial");
    expect(r.artifacts.map((artifact) => artifact.source.inputId)).toEqual([
      "loose",
    ]);
    expect(r.metrics.payloadReads).toBe(0);
  });
  it("discards a malformed-count archive while a loose input survives", async () => {
    const r = await prepareImport(
      [zip("eocd-disk-entries-0.zip"), loose()],
      plain,
    );
    expect(r.status).toBe("partial");
    expect(r.artifacts.map((artifact) => artifact.source.inputId)).toEqual([
      "loose",
    ]);
    expect(r.metrics.payloadReads).toBe(0);
  });
  it.each(["atomic-crc", "atomic-decode"])(
    "archive staging discards all %s; other unit survives",
    async (name) => {
      const r = await prepareImport([zip(name + ".zip"), loose()], {
        ...plain,
        encoding: "utf-8",
      });
      expect(r.status).toBe("partial");
      expect(r.artifacts.map((a) => a.source.inputId)).toEqual(["loose"]);
      expect(r.metrics.conversions).toBe(2);
      expect(
        r.outcomes.some((o) => o.entryIndex === 0 && o.status === "discarded"),
      ).toBe(true);
    },
  );
  it("normalizes mixed separators and preserves percent literals", async () => {
    const r = await run(zip("mixed-separators.zip"));
    expect(r.artifacts[0].relativePath).toBe("mixed-separators/a/b/c.md");
  });
});
describe("S2-04 finite budgets and lifetime", () => {
  for (const key of Object.keys(
    DEFAULT_IMPORT_LIMITS,
  ) as (keyof ImportLimits)[])
    it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
      `${key} rejects %s`,
      (number) => expect(() => resolveLimits({ [key]: number })).toThrow(),
    );
  it("undefined retains finite defaults", () =>
    expect(resolveLimits({ textBytes: undefined })).toEqual(
      DEFAULT_IMPORT_LIMITS,
    ));
  it.each([
    "sources",
    "inputBytes",
    "totalInputBytes",
    "textBytes",
    "outputBytes",
  ] as const)("%s exact boundary and one under", async (key) => {
    const exact = key === "sources" ? 1 : 2;
    const good = await run(loose(), { ...plain, limits: { [key]: exact } });
    expect(good.status).toBe("completed");
    const bad =
      key === "sources"
        ? await prepareImport([loose(), loose("two")], {
            ...plain,
            limits: { sources: 1 },
          })
        : await run(loose(), { ...plain, limits: { [key]: 1 } });
    expect(bad.status).toBe("failed");
    expect(bad.artifacts).toEqual([]);
  });
  it.each(["archiveEntries", "totalEntries"] as const)(
    "%s counts empty entries",
    async (key) => {
      expect(
        (await run(zip("many-empty.zip"), { ...plain, limits: { [key]: 10 } }))
          .status,
      ).toBe("completed");
      const bad = await run(zip("many-empty.zip"), {
        ...plain,
        limits: { [key]: 9 },
      });
      expect(bad.status).toBe("failed");
      expect(bad.metrics.payloadReads).toBe(0);
    },
  );
  it.each(["filenameBytes", "declaredBytes", "expandedBytes"] as const)(
    "%s boundary",
    async (key) => {
      const limit = key === "filenameBytes" ? 8 : 2;
      expect(
        (await run(zip("cp437.zip"), { ...plain, limits: { [key]: limit } }))
          .status,
      ).toBe("completed");
      expect(
        (
          await run(zip("cp437.zip"), {
            ...plain,
            limits: { [key]: limit - 1 },
          })
        ).status,
      ).toBe("failed");
    },
  );
  it("ignored declarations count, ignored payload does not", async () => {
    const r = await run(zip("ignored.zip"), {
      ...plain,
      limits: { declaredBytes: 1 },
    });
    expect(r.status).toBe("failed");
    expect(r.metrics.declaredBytes).toBe(2);
    expect(r.metrics.expandedBytes).toBe(0);
  });
  it("rejects chunk before retaining and wipes previous units on batch budget", async () => {
    const r = await prepareImport([loose(), zip("chunk.zip")], {
      ...plain,
      limits: { expandedBytes: 32 },
    });
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.expandedBytes).toBeGreaterThan(32);
    expect(r.metrics.retainedExpandedBytes).toBe(0);
    expect(r.metrics.rejectedChunks).toBe(1);
    expect(r.metrics.readersClosed).toBe(1);
  });
  it("failed archive consumption is never refunded", async () => {
    const r = await prepareImport(
      [zip("atomic-decode.zip"), zip("cp437.zip")],
      { ...plain, encoding: "utf-8", limits: { expandedBytes: 7 } },
    );
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.expandedBytes).toBe(8);
    expect(r.metrics.conversions).toBe(1);
  });
  it("declared text cap prevents payload reading", async () => {
    const r = await run(zip("chunk.zip"), {
      ...plain,
      limits: { textBytes: 262143 },
    });
    expect(r.status).toBe("failed");
    expect(r.metrics.payloadReads).toBe(0);
  });
  it("direct cancellation during chunk closes archive and discards batch", async () => {
    const control = new AbortController();
    const r = await prepareImport([loose(), zip("chunk.zip")], plain, {
      signal: control.signal,
      onProgress: (p) => {
        if (p.stage === "reading") control.abort();
      },
    });
    expect(r.status).toBe("cancelled");
    expect(r.artifacts).toEqual([]);
    expect(r.metrics.readersClosed).toBe(1);
  });
  it("pre-aborted call starts no reader", async () => {
    const r = await prepareImport([zip()], plain, {
      signal: AbortSignal.abort(),
    });
    expect(r.status).toBe("cancelled");
    expect(r.metrics.readersOpened).toBe(0);
  });
});
describe("S2-05 common output namespace", () => {
  it("loose+ZIP collide in author folder once", async () => {
    const r = await prepareImport(
      [loose("id", "base.txt"), zip("unicode-bad-crc.zip")],
      { ...plain, organizeByAuthor: true },
    );
    expect(r.artifacts.map((a) => a.relativePath)).toEqual([
      "unknown_author/base.md",
      "unknown_author/base_converted.md",
    ]);
  });
  it("same stem archives keep grouped prefixes", async () => {
    const a = zip("normal.zip", "one"),
      b = zip("normal.zip", "two");
    const r = await prepareImport([a, b], plain);
    expect(r.artifacts.map((a) => a.relativePath)).toEqual([
      "normal/same.md",
      "normal/same_converted.md",
      "normal/a/book.md",
      "normal/b/book.md",
      "normal_converted/same.md",
      "normal_converted/same_converted.md",
      "normal_converted/a/book.md",
      "normal_converted/b/book.md",
    ]);
  });
  it("all selected basenames reserved, including later inputs", async () => {
    const r = await prepareImport(
      [loose("one", "x.txt"), loose("two", "x.md")],
      plain,
    );
    expect(r.artifacts.map((a) => a.relativePath)).toEqual([
      "x_converted.md",
      "x_converted2.md",
    ]);
  });
  it("uses accepted metadata for author names; invalid FM falls back", async () => {
    const r = await run(
      loose("id", "orig.md", "---\ntitle: 題\nauthor: 著者\n---\n本文"),
      { ...plain, organizeByAuthor: true },
    );
    expect(r.artifacts[0].relativePath).toBe("著者/題.md");
    const bad = await run(loose("id", "orig.md", "---\ntitle: [\n---\n本文"), {
      ...plain,
      organizeByAuthor: true,
    });
    expect(bad.artifacts[0].relativePath).toBe("unknown_author/orig.md");
    expect(bad.artifacts[0].conversion.diagnostics.length).toBeGreaterThan(0);
  });
  it("sanitization, NFC and case collisions remain unique", async () => {
    const r = await run(zip("collision.zip"));
    expect(r.status).toBe("completed");
    const names = r.artifacts.map((a) =>
      a.relativePath.normalize("NFC").toLowerCase(),
    );
    expect(new Set(names).size).toBe(7);
  });
});
it("CP437 is total and Unicode CRC is independently standard", () => {
  expect(basicFilename(new Uint8Array([0, 0x82, 0xff]), false)).toBe(
    "\0é\u00a0",
  );
  expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  expect(unicodeFilename(bytes("x"), new Uint8Array([1]), "x").warning).toBe(
    "malformed-extra-field",
  );
});

it.each([
  "descriptor",
  "zip64",
  "zip64-end-record",
  "zip64-size-sentinel",
  "zip64-offset-sentinel",
  "zip64-both-sentinel",
  "comment-plain",
  "comment-signature-only",
  "comment-unreachable-0-0",
  "comment-unreachable-3-0",
  "comment-unreachable-0-7",
])("valid %s entry structures", async (name) => {
  const r = await run(zip(name + ".zip"));
  expect(r.status).toBe("completed");
  expect(r.artifacts[0].conversion.text).toBe("OK");
});
it.each(["prefix-rebased-0", "eocd-disk-entries-1"])(
  "valid ZIP structure boundary %s",
  async (name) => {
    const r = await run(zip(name + ".zip"));
    expect(r.status).toBe("completed");
    expect(r.artifacts[0].conversion.text).toBe("OK");
  },
);
it("percent encoded path is literal, and default raw filename cap is finite", async () => {
  expect((await run(zip("percent.zip"))).artifacts[0].relativePath).toBe(
    "percent/%2e%2e/book.md",
  );
  expect((await run(zip("long-name.zip"))).diagnostics[0].reason).toBe(
    "filenameBytes",
  );
});

it("S2-02 reports the failed entry and rejects CD overlap before payload", async () => {
  const r = await run(zip("payload-central.zip"));
  expect(r.diagnostics[0]).toMatchObject({
    code: "ZIP_HEADER_MISMATCH",
    stage: "structure",
    entryIndex: 0,
    reason: "payload-overlaps-central-directory",
  });
  expect(r.metrics.payloadReads).toBe(0);
  const atomic = await run(zip("atomic-decode.zip"), {
    ...plain,
    encoding: "utf-8",
  });
  expect(atomic.outcomes.find((o) => o.entryIndex === 1)?.status).toBe(
    "failed",
  );
  expect(atomic.diagnostics[0]).toMatchObject({
    code: "DECODE_FAILED",
    stage: "decode",
    entryIndex: 1,
  });
});
it("S2-04 declarations and entry totals span multiple archives, including a failed one", async () => {
  for (const [key, limit] of [
    ["declaredBytes", 7],
    ["totalEntries", 2],
  ] as const) {
    const r = await prepareImport(
      [zip("atomic-decode.zip"), zip("cp437.zip")],
      { ...plain, encoding: "utf-8", limits: { [key]: limit } },
    );
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.diagnostics.at(-1)?.reason).toBe(key);
  }
});
it("S2-04 output budget measures UTF8 and never refunds a failed archive", async () => {
  expect(
    (
      await run(loose("id", "x.txt", "題"), {
        ...plain,
        limits: { outputBytes: 3 },
      })
    ).status,
  ).toBe("completed");
  expect(
    (
      await run(loose("id", "x.txt", "題"), {
        ...plain,
        limits: { outputBytes: 2 },
      })
    ).status,
  ).toBe("failed");
  const r = await prepareImport([zip("atomic-decode.zip"), loose()], {
    ...plain,
    encoding: "utf-8",
    limits: { outputBytes: 6 },
  });
  expect(r.status).toBe("failed");
  expect(r.artifacts).toEqual([]);
  expect(r.metrics.outputBytes).toBe(7);
});
it("archive input byte boundary and failure are checked before reader construction", async () => {
  const input = zip("normal.zip");
  expect(
    (await run(input, { ...plain, limits: { inputBytes: input.bytes.length } }))
      .status,
  ).toBe("completed");
  const bad = await run(input, {
    ...plain,
    limits: { inputBytes: input.bytes.length - 1 },
  });
  expect(bad.status).toBe("failed");
  expect(bad.metrics.readersOpened).toBe(0);
});

it("payload stream closes on success and aborts on quota/cancel/error", async () => {
  const success = await run(zip("normal.zip"));
  expect(success.metrics.payloadStreamsClosed).toBe(4);
  expect(success.metrics.payloadStreamsAborted).toBe(0);
  for (const [name, limits] of [
    ["bad-crc.zip", {}],
    ["chunk.zip", { expandedBytes: 32 }],
  ] as const) {
    const r = await run(zip(name), { ...plain, limits });
    expect(r.metrics.payloadStreamsAborted).toBe(1);
    expect(r.metrics.payloadStreamsClosed).toBe(0);
  }
});
it("ZIP bytes and options remain owned by the caller and repeat deterministically", async () => {
  const input = zip("normal.zip");
  const original = input.bytes.slice();
  const options = Object.freeze({
    ...plain,
    conversion: Object.freeze({ ...plain.conversion }),
  });
  const first = await run(input, options),
    second = await run(input, options);
  expect(second).toEqual(first);
  expect(input.bytes).toEqual(original);
  expect(input.bytes.byteLength).toBe(original.byteLength);
});
it("loose selected basename reserves a ZIP wrapper directory in the same namespace", async () => {
  const archive = { ...zip("cp437.zip"), name: "book.md.zip" };
  const r = await prepareImport([archive, loose("loose", "book.md")], plain);
  expect(r.artifacts.map((a) => a.relativePath)).toEqual([
    "book.md_converted/café.md",
    "book_converted.md",
  ]);
});

it("bounded compressed feed prevents a quota failure from reading the whole compressed payload", async () => {
  const r = await run(zip("cancel.zip"), {
    ...plain,
    limits: { expandedBytes: 32 },
  });
  const compressedSize = r.outcomes[1].zipName!.compressedBytes;
  expect(r.status).toBe("failed");
  expect(r.metrics.rejectedChunks).toBe(1);
  expect(r.metrics.retainedExpandedBytes).toBe(0);
  expect(r.metrics.compressedBytesRead).toBeLessThan(compressedSize);
  expect(r.metrics.payloadStreamsAborted).toBe(1);
  expect(r.metrics.readersClosed).toBe(1);
});
it("forged small declared size cannot bypass the per-body chunk quota", async () => {
  const r = await run(zip("forged-small.zip"), {
    ...plain,
    limits: { textBytes: 32 },
  });
  expect(r.status).toBe("failed");
  expect(r.diagnostics[0].reason).toBe("textBytes");
  expect(r.metrics.expandedBytes).toBeGreaterThan(32);
  expect(r.metrics.retainedExpandedBytes).toBe(0);
  expect(r.metrics.rejectedChunks).toBe(1);
  expect(r.metrics.payloadStreamsAborted).toBe(1);
});

it("invalid Unicode extra cannot silently reclassify a regular file as a directory", async () => {
  const r = await run(zip("unicode-bad-directory.zip"));
  expect(r.status).toBe("completed");
  expect(r.artifacts).toHaveLength(1);
  expect(r.artifacts[0].relativePath).toBe("unicode-bad-directory/base.md");
  expect(r.diagnostics[0].reason).toBe("unicode-path-utf8");
});
it("Unicode Path only in the central directory is valid", async () => {
  const r = await run(zip("unicode-central-only.zip"));
  expect(r.status).toBe("completed");
  expect(r.artifacts[0].relativePath).toBe("unicode-central-only/題.md");
});
it("an unsafe reached entry still consumes its declared byte budget", async () => {
  const unsafe = await run(zip("unsafe-ignored.zip"));
  expect(unsafe.metrics.declaredBytes).toBe(4);
  expect(unsafe.metrics.payloadReads).toBe(0);
  const r = await prepareImport(
    [loose(), zip("unsafe-ignored.zip"), zip("cp437.zip")],
    { ...plain, limits: { declaredBytes: 5 } },
  );
  expect(r.status).toBe("failed");
  expect(r.artifacts).toEqual([]);
  expect(r.metrics.declaredBytes).toBe(6);
});
