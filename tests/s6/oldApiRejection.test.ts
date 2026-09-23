import { describe, it, expect, vi } from "vitest";
import { convertText, ConversionOptionsError } from "../../src/index.js";
import { IMPORT_CONTRACT, type ImportOptions } from "../../src/import/index.js";
import { importFiles } from "../../src/adapters/browser/index.js";
import { FakeWorker, loose, run, storedZip, utf8, zip } from "./helpers.js";

// S6-01 SCHEMA_V3_API: removed fields are rejected, never silently remapped.
describe("core: removed fields throw a migration TypeError", () => {
  it.each(["md", "txt", "", null, 0, false])("sourceFormat %j", (value) => {
    let error: unknown;
    try {
      convertText("青［＃「青」は太字］", { sourceFormat: value } as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(ConversionOptionsError);
    expect(error).toMatchObject({ field: "sourceFormat", removed: true });
    expect(String(error)).toMatch(/sourceFormat was removed in aozora-ts-v3/);
  });
  it.each([true, false, "md"])(
    "renameToMd %j points to outputExtension",
    (value) => {
      expect(() => convertText("x", { renameToMd: value } as never)).toThrow(
        /renameToMd was removed in aozora-ts-v3: choose the file extension with ImportOptions\.outputExtension/,
      );
      expect(() => convertText("x", { renameToMd: value } as never)).toThrow(
        expect.objectContaining({ field: "renameToMd", removed: true }),
      );
    },
  );
  it("explicit undefined of a removed field is accepted; the result has no isMarkdownOutput", () => {
    const r = convertText("青［＃「青」は太字］", {
      sourceFormat: undefined,
      renameToMd: undefined,
    } as never);
    expect(r.text).toBe("**青**");
    expect(r).not.toHaveProperty("isMarkdownOutput");
    expect(Object.keys(r).sort()).toEqual(
      [
        "text",
        "outputEncoding",
        "stats",
        "remainingNotes",
        "diagnostics",
        "processingEvents",
        "namingMetadata",
      ].sort(),
    );
  });
  it.each([null, "md", 1, [], true])(
    "options %j is not an options object",
    (value) => {
      expect(() => convertText("x", value as never)).toThrow(
        expect.objectContaining({ field: "", removed: false }),
      );
    },
  );
  it("omitted and {} are the defaults", () => {
    expect(convertText("章［＃「章」は大見出し］")).toEqual(
      convertText("章［＃「章」は大見出し］", {}),
    );
  });
});

describe("import: INVALID_OPTION before any payload read or conversion", () => {
  const cases: [string, unknown, string][] = [
    [
      "sourceFormat",
      { conversion: { sourceFormat: "txt" } },
      "conversion.sourceFormat",
    ],
    [
      "renameToMd",
      { conversion: { renameToMd: false } },
      "conversion.renameToMd",
    ],
    [
      "headingLevels",
      { conversion: { headingLevels: { small: 9 } } },
      "conversion.headingLevels.small",
    ],
    ["conversion null", { conversion: null }, "conversion"],
    ["extension html", { outputExtension: "html" }, "outputExtension"],
    ["extension MD", { outputExtension: "MD" }, "outputExtension"],
    ["extension .md", { outputExtension: ".md" }, "outputExtension"],
    ["extension null", { outputExtension: null }, "outputExtension"],
    ["options null", null, "options"],
  ];
  it.each(cases)("%s", async (_, options, reason) => {
    const r = await run(
      [loose("a.txt", "x"), zip("z.zip", [["b.txt", "y"]])],
      options as ImportOptions,
    );
    expect(r.contract).toBe("aozora-import-v2");
    expect(r.status).toBe("failed");
    expect(r.artifacts).toEqual([]);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "INVALID_OPTION",
        stage: "input",
        reason,
      }),
    ]);
    expect(r.metrics).toMatchObject({
      conversions: 0,
      compressedBytesRead: 0,
      zipEntries: 0,
    });
  });
  it("option errors win over invalid input payloads (validated first)", async () => {
    const r = await run(
      [{ id: "x", name: "x.txt", kind: "txt", bytes: null as never }],
      {
        outputExtension: "doc" as never,
      },
    );
    expect(r.diagnostics[0]).toMatchObject({
      code: "INVALID_OPTION",
      reason: "outputExtension",
    });
  });
  it("undefined outputExtension is md", async () => {
    const r = await run([loose("a.txt", "x")], { outputExtension: undefined });
    expect(r.artifacts[0].format).toBe("md");
  });
});

const ctx = (w: FakeWorker, factory = vi.fn(() => w.asWorker())) => ({
  requestId: "r",
  attemptId: "a",
  workerFactory: factory,
});
const text = () => ({ id: "t", file: new File(["青［＃未対応］"], "t.txt") });

describe("browser client: validated before File read and Worker start", () => {
  it.each([
    [{ outputExtension: "pdf" }, "outputExtension"],
    [{ conversion: { sourceFormat: "md" } }, "conversion.sourceFormat"],
  ])("%j", async (options, reason) => {
    const input = text();
    const read = vi.spyOn(input.file, "arrayBuffer");
    const w = new FakeWorker(),
      factory = vi.fn(() => w.asWorker());
    const r = await importFiles(
      [input],
      options as ImportOptions,
      ctx(w, factory),
    );
    expect(r.result.contract).toBe(IMPORT_CONTRACT);
    expect(r.result.status).toBe("failed");
    expect(r.result.diagnostics.at(-1)).toMatchObject({
      code: "INVALID_OPTION",
      reason,
    });
    expect(read).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(r.stats.filesConverted).toBe(0);
  });
});

describe("browser client: Worker contract v2 only; recovery and commit-only stats", () => {
  it("aozora-import-v1 Worker result is INVALID_WORKER_RESULT; the next job succeeds", async () => {
    const old = FakeWorker.real((m) => ({
      ...m,
      result: { ...m.result, contract: "aozora-import-v1" },
    }));
    const r = await importFiles([text()], {}, ctx(old));
    expect(r.result.contract).toBe("aozora-import-v2");
    expect(r.result.diagnostics.at(-1)).toMatchObject({
      code: "INVALID_WORKER_RESULT",
      reason: "invalid-result-contract",
    });
    expect(r.artifacts).toEqual([]);
    expect(r.stats).toMatchObject({
      filesConverted: 0,
      artifactFiles: 0,
      remainingNotes: 0,
    });
    expect(old.terminated).toBe(1);
    const next = await importFiles(
      [text()],
      { outputExtension: "txt" },
      ctx(FakeWorker.real()),
    );
    expect(next.result.status).toBe("completed");
    expect(next.artifacts[0]).toMatchObject({
      format: "txt",
      relativePath: "t_converted.txt",
    });
    expect(next.stats).toMatchObject({ artifactFiles: 1, remainingNotes: 1 });
  });
  it("artifact format differing from the requested extension is rejected", async () => {
    const w = FakeWorker.real((m) => ({
      ...m,
      result: {
        ...m.result,
        artifacts: m.result.artifacts.map((a) => ({ ...a, format: "md" })),
      },
    }));
    const r = await importFiles([text()], { outputExtension: "txt" }, ctx(w));
    expect(r.result.diagnostics.at(-1)?.code).toBe("INVALID_WORKER_RESULT");
    expect(r.artifacts).toEqual([]);
  });
  it("cancel and failure results carry the v2 contract", async () => {
    const abort = new AbortController();
    const w = new FakeWorker();
    w.respond = () => abort.abort();
    const cancelled = await importFiles(
      [text()],
      { outputExtension: "txt" },
      {
        ...ctx(w),
        signal: abort.signal,
      },
    );
    expect(cancelled.result).toMatchObject({
      contract: "aozora-import-v2",
      status: "cancelled",
    });
    const failing = new FakeWorker();
    failing.respond = () =>
      failing.send({ type: "failure", requestId: "r" } as never);
    const failed = await importFiles([text()], {}, ctx(failing));
    expect(failed.result).toMatchObject({
      contract: "aozora-import-v2",
      status: "failed",
    });
  });
  it("partial batch with TXT output: only prepared artifacts, all Blobs before commit", async () => {
    let blobs = 0;
    const r = await importFiles(
      [
        text(),
        {
          id: "bad",
          file: new File([storedZip([["../x.txt", utf8("x")]])], "bad.zip"),
        },
      ],
      { outputExtension: "txt" },
      {
        ...ctx(FakeWorker.real()),
        createBlob: (b, mime) => {
          blobs++;
          return new Blob([b], { type: mime });
        },
      },
    );
    expect(r.result.status).toBe("partial");
    expect(blobs).toBe(1);
    expect(r.artifacts.map((a) => [a.format, a.blob.type])).toEqual([
      ["txt", "text/plain;charset=utf-8"],
    ]);
    expect(r.stats).toMatchObject({
      artifactFiles: 1,
      errors: 1,
      remainingNotes: 1,
    });
  });
  it("Blob failure on the second TXT artifact commits nothing", async () => {
    let count = 0;
    const r = await importFiles(
      [text(), { ...text(), id: "two" }],
      { outputExtension: "txt" },
      {
        ...ctx(FakeWorker.real()),
        createBlob: (b) => {
          if (++count === 2) throw Error("construction");
          return new Blob([b]);
        },
      },
    );
    expect(r.artifacts).toEqual([]);
    expect(r.stats).toMatchObject({
      filesConverted: 0,
      artifactFiles: 0,
      remainingNotes: 0,
    });
  });
});
