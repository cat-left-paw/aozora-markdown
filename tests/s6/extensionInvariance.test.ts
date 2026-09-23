import { describe, it, expect } from "vitest";
import { convertText } from "../../src/index.js";
import { importFiles } from "../../src/adapters/browser/index.js";
import { planZipEntries } from "../../src/policies/index.js";
import { reduceJobStats, initialJobStats } from "../../src/policies/index.js";
import { FakeWorker, decode, loose, run, zip } from "./helpers.js";

// S6-01 / S6-02: OUTPUT_EXTENSION_DECOUPLED, NAMING_BY_OUTPUT_EXTENSION,
// FRONTMATTER_FOR_TXT_OUTPUT.
const text =
  "題\n著者\n\n［＃５字下げ］第一夜［＃「第一夜」は中見出し］\n" +
  "※［＃U+0041］青［＃「青」は太字］、空［＃「空」に傍点］\n" +
  "［＃改ページ］\n`［＃「例」は太字］`\n［＃未知の注記］\n";
// Header lines and their blank separator become frontmatter (pipeline-v2
// default-header: "題\n著者\n\n" -> "---\ntitle: 題\nauthor: 著者\n---\n").
const expectedText =
  "---\ntitle: 題\nauthor: 著者\n---\n" +
  "### 　　　　　第一夜\n" +
  "A**青**、｜空《﹅》\n" +
  "［＃改ページ］\n`［＃「例」は太字］`\n［＃未知の注記］\n";

describe("same body and core fields for TXT/MD input x loose/ZIP x MD/TXT output", () => {
  const combos = (["txt", "md"] as const).flatMap((input) =>
    (["loose", "zip"] as const).flatMap((container) =>
      (["md", "txt"] as const).map((ext) => ({ input, container, ext })),
    ),
  );
  it.each(combos)(
    "$input in $container -> .$ext",
    async ({ input, container, ext }) => {
      const source =
        container === "loose"
          ? loose(`work.${input}`, text)
          : zip("book.zip", [[`dir/work.${input}`, text]]);
      const r = await run([source], { outputExtension: ext });
      expect(r.status).toBe("completed");
      expect(r.artifacts).toHaveLength(1);
      const [a] = r.artifacts;
      expect(a.conversion).toEqual(convertText(text));
      expect(a.conversion.text).toBe(expectedText);
      expect(decode(a.bytes)).toBe(expectedText);
      expect(a.format).toBe(ext);
      // Loose inputs reserve their own name; the ZIP name is book.zip only.
      expect(a.relativePath).toBe(
        container === "zip"
          ? `book/dir/work.${ext}`
          : input === ext
            ? `work_converted.${ext}`
            : `work.${ext}`,
      );
    },
  );
  it("all eight artifacts share bytes, stats, diagnostics, notes, metadata and events", async () => {
    const all = [];
    for (const { input, container, ext } of combos) {
      const source =
        container === "loose"
          ? loose(`work.${input}`, text)
          : zip("book.zip", [[`dir/work.${input}`, text]]);
      all.push((await run([source], { outputExtension: ext })).artifacts[0]);
    }
    for (const a of all) {
      expect([...a.bytes]).toEqual([...all[0].bytes]);
      expect(a.conversion).toEqual(all[0].conversion);
    }
    const core = all[0].conversion;
    expect(core.stats).toMatchObject({
      gaiji: { converted: 1 },
      emphasis: { bold: 1 },
      bouten: { converted: 1 },
      headings: { converted: 1 },
      remainingNotes: 2,
    });
    expect(core.remainingNotes).toEqual([
      { line: 7, text: "［＃改ページ］" },
      { line: 9, text: "［＃未知の注記］" },
    ]);
    expect(core.namingMetadata).toMatchObject({
      ok: true,
      metadata: { title: "題", author: "著者" },
    });
  });
});

describe("naming follows only the output extension", () => {
  it.each(["md", "txt"] as const)(
    "same basename with different input extensions merges into .%s with suffixes",
    async (ext) => {
      const r = await run(
        [
          loose("x.txt", "一"),
          loose("x.md", "二"),
          zip("z.zip", [
            ["a/x.txt", "三"],
            ["a/x.md", "四"],
          ]),
        ],
        { outputExtension: ext, conversion: { addFrontmatter: false } },
      );
      expect(r.artifacts.map((a) => [a.relativePath, decode(a.bytes)])).toEqual(
        [
          [`x_converted.${ext}`, "一"],
          [`x_converted2.${ext}`, "二"],
          [`z/a/x.${ext}`, "三"],
          [`z/a/x_converted.${ext}`, "四"],
        ],
      );
      expect(new Set(r.artifacts.map((a) => a.relativePath)).size).toBe(4);
    },
  );
  it.each(["md", "txt"] as const)(
    "author folder for loose and ZIP -> .%s",
    async (ext) => {
      const r = await run(
        [
          loose("a.txt", "題\n著者\n\n本文"),
          zip("b.zip", [["in/b.md", "題\n著者\n\n本文"]]),
        ],
        { outputExtension: ext, organizeByAuthor: true },
      );
      expect(r.artifacts.map((a) => a.relativePath)).toEqual([
        `著者/題.${ext}`,
        `著者/題_converted.${ext}`,
      ]);
      expect(r.artifacts[0].conversion).toEqual(r.artifacts[1].conversion);
    },
  );
  it("frontmatter is added to TXT output from the toggle alone", async () => {
    for (const ext of ["md", "txt"] as const) {
      const on = await run([loose("w.txt", "題\n著者\n\n本文")], {
        outputExtension: ext,
      });
      expect(decode(on.artifacts[0].bytes)).toBe(
        "---\ntitle: 題\nauthor: 著者\n---\n本文",
      );
      const off = await run([loose("w.txt", "題\n著者\n\n本文")], {
        outputExtension: ext,
        conversion: { addFrontmatter: false },
      });
      expect(decode(off.artifacts[0].bytes)).toBe("題\n著者\n\n本文");
    }
  });
  it("planZipEntries: MD entries can be written as TXT; renameToMd/invalid are TypeError", () => {
    const archive = {
      archiveId: "a",
      stem: "arc",
      entries: ["d/one.md", "d/one.txt"].map(
        (rawName, centralDirectoryIndex) => ({
          archiveId: "a",
          centralDirectoryIndex,
          rawName,
        }),
      ),
    };
    const plan = planZipEntries([archive], { outputExtension: "txt" });
    expect(plan.ok && plan.entries.map((e) => e.relativePath)).toEqual([
      "arc/d/one.txt",
      "arc/d/one_converted.txt",
    ]);
    const md = planZipEntries([archive]);
    expect(md.ok && md.entries.map((e) => e.relativePath)).toEqual([
      "arc/d/one.md",
      "arc/d/one_converted.md",
    ]);
    expect(() =>
      planZipEntries([archive], { renameToMd: true } as never),
    ).toThrow(/renameToMd was removed/);
    expect(() =>
      planZipEntries([archive], { outputExtension: "MD" } as never),
    ).toThrow(TypeError);
  });
});

describe("browser adapter: MIME from the extension, all Blobs before commit", () => {
  it.each([
    ["md", "text/markdown;charset=utf-8"],
    ["txt", "text/plain;charset=utf-8"],
  ] as const)(".%s -> %s", async (ext, mime) => {
    const w = FakeWorker.real();
    const r = await importFiles(
      [
        { id: "a", file: new File([text], "a.md") },
        { id: "b", file: new File([text], "b.txt") },
      ],
      { outputExtension: ext },
      { requestId: "r", attemptId: "1", workerFactory: () => w.asWorker() },
    );
    expect(r.result.status).toBe("completed");
    expect(
      r.artifacts.map((a) => [a.relativePath, a.format, a.blob.type]),
    ).toEqual([
      [ext === "md" ? "a_converted.md" : "a.txt", ext, mime],
      [ext === "txt" ? "b_converted.txt" : "b.md", ext, mime],
    ]);
    for (const a of r.artifacts) expect(await a.blob.text()).toBe(expectedText);
    // Residual notes of TXT output reach JobStats after commit only.
    expect(r.stats).toMatchObject({
      artifactFiles: 2,
      filesConverted: 2,
      filesWithRemainingNotes: 2,
      remainingNotes: 4,
    });
  });
  it("TXT JobStats count residual notes like MD", async () => {
    for (const ext of ["md", "txt"] as const) {
      const r = await run([loose("w.txt", "［＃未知］")], {
        outputExtension: ext,
      });
      const job = reduceJobStats(initialJobStats(), {
        type: "WriteCommitted",
        fileId: r.artifacts[0].fileId,
        attemptId: "1",
        delivery: "browser-artifact",
        result: r.artifacts[0].conversion,
      });
      expect([job.filesWithRemainingNotes, job.remainingNotes]).toEqual([1, 1]);
    }
  });
});
