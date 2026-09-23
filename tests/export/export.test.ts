import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import {
  prepareExport,
  DEFAULT_EXPORT_LIMITS,
  type ExportArtifact,
  type ExportLimits,
  type ExportOptions,
} from "../../src/export/index.js";
import { writeExportZip } from "../../src/export/zipWriter.js";
import { emptyExportMetrics } from "../../src/export/limits.js";
const a = (
  relativePath = "題.md",
  bytes: Uint8Array = new Uint8Array([239, 187, 191, 0, 13, 10, 255]),
  fileId = relativePath,
): ExportArtifact => ({
  fileId,
  relativePath,
  format: relativePath.endsWith(".txt") ? "txt" : "md",
  bytes,
});
async function failure(
  items: ExportArtifact[],
  options: ExportOptions,
  code: string,
) {
  const r = await prepareExport(items, options);
  expect(r.status).toBe("failed");
  expect(r.diagnostics[0].code).toBe(code);
  expect(r).not.toHaveProperty("bytes");
  expect(r.metrics.readyFiles).toBe(0);
  expect(r.metrics.retainedBytes).toBe(0);
  return r;
}
afterEach(() => vi.restoreAllMocks());
describe("S3-01 selection and ownership", () => {
  it.each(["md", "txt"] as const)(
    "opaque %s bytes, basename, manifest, nonsharing",
    async (format) => {
      const buffer = new Uint8Array([99, 0, 239, 187, 191, 13, 10, 255, 98]);
      const input = {
        ...a("著者/題." + format, buffer.subarray(1, 8)),
        format,
      };
      const r = await prepareExport([input], { mode: "single" });
      expect(r.status).toBe("ready");
      if (r.status !== "ready") return;
      expect([...r.bytes]).toEqual([0, 239, 187, 191, 13, 10, 255]);
      expect(r.filename).toBe("題." + format);
      expect(r.mime).toBe(
        format === "md"
          ? "text/markdown;charset=utf-8"
          : "text/plain;charset=utf-8",
      );
      expect(r.manifest).toEqual([
        {
          fileId: input.fileId,
          relativePath: input.relativePath,
          format,
          byteLength: 7,
        },
      ]);
      r.bytes.fill(0);
      expect([...buffer]).toEqual([99, 0, 239, 187, 191, 13, 10, 255, 98]);
    },
  );
  it("empty file differs from no files", async () => {
    expect(
      (await prepareExport([a("空.md", new Uint8Array())], { mode: "single" }))
        .status,
    ).toBe("ready");
    await failure([], { mode: "single" }, "NO_ARTIFACTS");
    await failure([], { mode: "zip" }, "NO_ARTIFACTS");
    await failure([a(), a("b.md")], { mode: "single" }, "SINGLE_FILE_COUNT");
  });
  it("rejects duplicate/empty IDs and Shared/detached/wrong bytes before writer", async () => {
    for (const id of ["", " "])
      await failure(
        [a("a.md", new Uint8Array(), id)],
        { mode: "zip" },
        "INVALID_FILE_ID",
      );
    await failure(
      [a(), a("b.md", new Uint8Array(), "題.md")],
      { mode: "zip" },
      "DUPLICATE_FILE_ID",
    );
    await failure(
      [a("a.md", new Uint8Array(new SharedArrayBuffer(1)))],
      { mode: "zip" },
      "INVALID_BYTES",
    );
    const detached = new Uint8Array([1]);
    structuredClone(detached, { transfer: [detached.buffer] });
    await failure([a("a.md", detached)], { mode: "zip" }, "INVALID_BYTES");
    await failure(
      [a("a.md", [] as unknown as Uint8Array)],
      { mode: "zip" },
      "INVALID_BYTES",
    );
  });
});
describe("S3-02 preflight names", () => {
  it.each([
    "/a.md",
    "C:/a.md",
    "\\\\host\\a.md",
    "a\\b.md",
    "a//b.md",
    "./a.md",
    "a/../b.md",
    "a.md/",
    "a\0.md",
    "a\x1f.md",
    "a\x7f.md",
    "a\x9f.md",
    "con.md",
    "LPT¹.md",
    " /a.md",
    "a./b.md",
    "a /b.md",
    "a?/b.md",
    "a.MD",
    "a.txt",
    "x\ud800.md",
    "x\udc00.md",
    "a".repeat(98) + ".md",
    "あ".repeat(80) + ".md",
  ])("rejects %j", async (path) => {
    const writer = vi.spyOn(ZipWriter.prototype, "add");
    const r = await prepareExport(
      [a("good.md"), { ...a(path), format: "md" }],
      { mode: "zip" },
    );
    expect(r.status).toBe("failed");
    expect(writer).not.toHaveBeenCalled();
    expect(r.metrics.writersStarted).toBe(0);
  });
  it.each([
    ["a.md", "A.md"],
    ["é.md", "e\u0301.md"],
    ["a.md", "a.md/b.txt"],
    ["A.md/b.txt", "a.md"],
    ["a.md", "a.md"],
  ])("collision %j", async (first, second) => {
    await failure(
      [first, second].map((p, i) => a(p, new Uint8Array(), String(i))),
      { mode: "zip" },
      "PATH_COLLISION",
    );
  });
  it("retains normal paths, order, decomposed names, percent literals and suffixes", async () => {
    const paths = [
      "著者/題😀_converted2.md",
      "別著者/題😀_converted2.md",
      "e\u0301.md",
      "%2e%2e.md",
      "folder/a.md",
      "folder/b.txt",
    ];
    const r = await prepareExport(
      paths.map((p) => a(p)),
      { mode: "zip" },
    );
    expect(r.status).toBe("ready");
    expect(r.manifest.map((e) => e.relativePath)).toEqual(paths);
  });
  it.each([
    "../a.zip",
    "a.ZIP",
    "con.zip",
    "a/.zip",
    "a.zip ",
    "a\ud800.zip",
    "あ".repeat(79) + ".zip",
    "a".repeat(97) + ".zip",
    null,
    42,
  ])("rejects archive name %j", async (archiveName) => {
    await failure(
      [a()],
      { mode: "zip", archiveName: archiveName as string },
      "INVALID_ARCHIVE_NAME",
    );
  });
  it("accepts exact basename limits", async () => {
    for (const p of ["a".repeat(97) + ".md", "あ".repeat(79) + ".md"])
      expect(
        (
          await prepareExport([a(p)], {
            mode: "zip",
            archiveName: "a".repeat(96) + ".zip",
          })
        ).status,
      ).toBe("ready");
  });
});
describe("S3-04 limits and actual stream accounting", () => {
  it("rejects missing/invalid mode and malformed limits; zip-only archive option", async () => {
    for (const mode of [undefined, "auto", null])
      await failure(
        [a()],
        { mode } as unknown as ExportOptions,
        "INVALID_MODE",
      );
    for (const limits of [null, [], "1"])
      await failure(
        [a()],
        { mode: "zip", limits } as unknown as ExportOptions,
        "INVALID_LIMIT",
      );
    await failure(
      [a()],
      { mode: "single", archiveName: "a.zip" } as unknown as ExportOptions,
      "INVALID_ARCHIVE_NAME",
    );
  });
  for (const key of Object.keys(
    DEFAULT_EXPORT_LIMITS,
  ) as (keyof ExportLimits)[]) {
    it.each([
      0,
      -1,
      NaN,
      Infinity,
      1.5,
      "10",
      null,
      Number.MAX_SAFE_INTEGER + 1,
    ])(`${key} rejects %j`, async (value) => {
      await failure(
        [a()],
        { mode: "zip", limits: { [key]: value } as Partial<ExportLimits> },
        "INVALID_LIMIT",
      );
    });
    it(`${key} undefined retains default`, async () => {
      expect(
        (
          await prepareExport([a()], {
            mode: "single",
            limits: { [key]: undefined },
          })
        ).status,
      ).toBe("ready");
    });
  }
  it.each([
    ["maxFiles", 65535],
    ["maxPathBytes", 65536],
    ["maxInputBytes", 0xffffffff],
    ["maxFileBytes", 0xffffffff],
    ["maxOutputBytes", 0xffffffff],
  ])("classic hard ceiling %s", async (k, n) => {
    await failure([a()], { mode: "zip", limits: { [k]: n } }, "INVALID_LIMIT");
  });
  it("each selection budget boundary", async () => {
    const input = a("a.md", new Uint8Array([1, 2]));
    const limits = {
      maxFiles: 1,
      maxFileBytes: 2,
      maxInputBytes: 2,
      maxPathBytes: 4,
      maxOutputBytes: 2,
    };
    expect(
      (await prepareExport([input], { mode: "single", limits })).status,
    ).toBe("ready");
    for (const [key, value, code] of [
      ["maxFileBytes", 1, "FILE_BYTES_LIMIT"],
      ["maxInputBytes", 1, "INPUT_BYTES_LIMIT"],
      ["maxPathBytes", 3, "PATH_LIMIT"],
      ["maxOutputBytes", 1, "OUTPUT_BYTES_LIMIT"],
    ] as const)
      await failure(
        [input],
        { mode: "single", limits: { ...limits, [key]: value } },
        code,
      );
    await failure(
      [input, a("b.md")],
      { mode: "zip", limits: { maxFiles: 1 } },
      "FILE_COUNT_LIMIT",
    );
    await failure(
      [input, a("b.md", new Uint8Array([3]))],
      { mode: "zip", limits: { maxInputBytes: 2 } },
      "INPUT_BYTES_LIMIT",
    );
  });
  it("header/central/EOCD overflow never retains offending chunk", async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      a(
        "folder/" + String(i).padStart(2, "0") + "あ".repeat(70) + ".md",
        new Uint8Array(),
      ),
    );
    const full = await prepareExport(items, { mode: "zip" });
    expect(full.status).toBe("ready");
    if (full.status !== "ready") return;
    expect(
      (
        await prepareExport(items, {
          mode: "zip",
          limits: { maxOutputBytes: full.bytes.length },
        })
      ).status,
    ).toBe("ready");
    for (const maxOutputBytes of [1, 1000, full.bytes.length - 1]) {
      const r = await failure(
        items,
        { mode: "zip", limits: { maxOutputBytes } },
        "OUTPUT_BYTES_LIMIT",
      );
      expect(r.metrics.outputBytes).toBeGreaterThan(maxOutputBytes);
      expect(r.metrics.peakRetainedBytes).toBeLessThanOrEqual(maxOutputBytes);
      expect(r.metrics.writersAborted).toBe(1);
      expect(r.metrics.writersClosed).toBe(0);
      expect(r.metrics.processedBytes).toBe(0);
    }
  });
});
describe("S3-05 cooperative abort and failures", () => {
  it("shared source library import configuration keeps STORE bytes deterministic", async () => {
    const items = [a("a.md", new Uint8Array(70000))];
    const before = await prepareExport(items, { mode: "zip" });
    const { prepareImport } = await import("../../src/import/index.js");
    const imported = await prepareImport(
      [
        {
          id: "plain",
          name: "plain.txt",
          kind: "txt",
          bytes: new TextEncoder().encode("本文"),
        },
      ],
      { conversion: { addFrontmatter: false } },
    );
    expect(imported.status).toBe("completed");
    const after = await prepareExport(items, { mode: "zip" });
    expect(before.status).toBe("ready");
    expect(after.status).toBe("ready");
    if (before.status === "ready" && after.status === "ready")
      expect(after.bytes).toEqual(before.bytes);
  });
  it.each(["validate", "copy", "package", "close"] as const)(
    "cancel at %s, retry same input",
    async (stage) => {
      const controller = new AbortController(),
        input = a("a.md", new Uint8Array(150000));
      let reached = false;
      const r = await prepareExport(
        [input],
        { mode: stage === "copy" ? "single" : "zip" },
        {
          signal: controller.signal,
          onProgress: (p) => {
            if (p.stage === stage) {
              reached = true;
              controller.abort();
            }
          },
        },
      );
      expect(reached).toBe(true);
      expect(r.status).toBe("cancelled");
      expect(r).not.toHaveProperty("bytes");
      expect(r.metrics.readyFiles).toBe(0);
      expect(r.metrics.retainedBytes).toBe(0);
      expect(input.bytes.length).toBe(150000);
      expect((await prepareExport([input], { mode: "zip" })).status).toBe(
        "ready",
      );
    },
  );
  it("abort after first actual read and before invocation", async () => {
    const controller = new AbortController();
    const r = await prepareExport(
      [a("a.md", new Uint8Array(200000))],
      { mode: "zip" },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.metrics.processedBytes) controller.abort();
        },
      },
    );
    expect(r.status).toBe("cancelled");
    expect(r.metrics.processedBytes).toBe(65536);
    expect(r.metrics.writersAborted).toBe(1);
    expect(
      (
        await prepareExport(
          [a()],
          { mode: "zip" },
          { signal: controller.signal },
        )
      ).metrics.writersStarted,
    ).toBe(0);
  });
  it.each(["validate", "copy", "package", "close"] as const)(
    "callback failure %s cleaned",
    async (stage) => {
      const r = await prepareExport(
        [a()],
        { mode: stage === "copy" ? "single" : "zip" },
        {
          onProgress: (p) => {
            if (p.stage === stage) throw Error("private body");
          },
        },
      );
      expect(r.status).toBe("failed");
      expect(r.diagnostics[0].code).toBe("PROGRESS_FAILED");
      expect(JSON.stringify(r)).not.toContain("private body");
      expect(r).not.toHaveProperty("bytes");
    },
  );
  it.each(["add", "close"] as const)(
    "writer %s exception aborts sink",
    async (method) => {
      vi.spyOn(ZipWriter.prototype, method).mockRejectedValueOnce(
        Error("fault"),
      );
      const r = await failure([a()], { mode: "zip" }, "EXPORT_FAILED");
      expect(r.metrics.writersAborted).toBe(1);
      expect((await prepareExport([a()], { mode: "zip" })).status).toBe(
        "ready",
      );
    },
  );
  it("stream failure and stream lock release", async () => {
    let sink: WritableStream<Uint8Array> | undefined;
    const Native = WritableStream;
    vi.stubGlobal(
      "WritableStream",
      class extends Native<Uint8Array> {
        constructor() {
          super({
            write() {
              throw Error("sink-fault");
            },
          });
          sink = this;
        }
      },
    );
    try {
      const m = emptyExportMetrics();
      await expect(
        writeExportZip([a()], DEFAULT_EXPORT_LIMITS, {}, m),
      ).rejects.toThrow("sink-fault");
      expect(m.writersAborted).toBe(1);
      expect(sink?.locked).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("parallel job budget independent", async () => {
    const [good, bad] = await Promise.all([
      prepareExport([a()], { mode: "zip" }),
      prepareExport([a()], { mode: "zip", limits: { maxOutputBytes: 1 } }),
    ]);
    expect(good.status).toBe("ready");
    expect(bad.status).toBe("failed");
  });
  it("cooperative cancellation inside the central directory write aborts close", async () => {
    const abort = new AbortController(),
      Native = WritableStream;
    let reached = false,
      sink: WritableStream<Uint8Array> | undefined;
    vi.stubGlobal(
      "WritableStream",
      class extends Native<Uint8Array> {
        constructor(underlying: UnderlyingSink<Uint8Array> = {}) {
          super({
            ...underlying,
            write(chunk, controller) {
              if (
                chunk[0] === 0x50 &&
                chunk[1] === 0x4b &&
                chunk[2] === 1 &&
                chunk[3] === 2
              ) {
                reached = true;
                abort.abort();
              }
              return underlying.write?.(chunk, controller);
            },
          });
          sink = this;
        }
      },
    );
    try {
      const r = await prepareExport(
        [a()],
        { mode: "zip" },
        { signal: abort.signal },
      );
      expect(reached).toBe(true);
      expect(r.status).toBe("cancelled");
      expect(r.metrics.entriesAdded).toBe(1);
      expect(r.metrics.writersAborted).toBe(1);
      expect(r.metrics.retainedBytes).toBe(0);
      expect(sink?.locked).toBe(false);
      expect(r).not.toHaveProperty("bytes");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
