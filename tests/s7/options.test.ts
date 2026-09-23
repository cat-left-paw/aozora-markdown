import { describe, expect, it } from "vitest";
import {
  CONTENT_OPTION_KEYS,
  convertText,
  DEFAULT_OPTIONS,
  type ConversionOptions,
} from "../../src/index.js";
import { normalizeOptions, zeroStats } from "../../src/core/options.js";
import { prepareImport } from "../../src/import/index.js";
import { initialJobStats, reduceJobStats } from "../../src/policies/index.js";
import { explain } from "../../web/diagnostics.js";
import { decode, loose, run, zip } from "../s6/helpers.js";
import { quiet } from "./helpers.js";

const sample = "12［＃「12」は縦中横］\n青［＃「青」は太字］\n";
const onText = "｟12｠\n**青**\n";

describe("S7-03 convertTcy, stats and explanations", () => {
  it("defaults to on; undefined matches the default; false leaves the note", () => {
    expect(DEFAULT_OPTIONS.convertTcy).toBe(true);
    expect(normalizeOptions(undefined).convertTcy).toBe(true);
    expect(normalizeOptions({}).convertTcy).toBe(true);
    expect(normalizeOptions({ convertTcy: undefined }).convertTcy).toBe(true);
    expect(normalizeOptions({ convertTcy: false }).convertTcy).toBe(false);
    const omitted = convertText(sample, quiet);
    expect(omitted.text).toBe(onText);
    expect(convertText(sample, { ...quiet, convertTcy: undefined })).toEqual(
      omitted,
    );
    expect(convertText(sample, { ...quiet, convertTcy: true })).toEqual(
      omitted,
    );
    const off = convertText(sample, { ...quiet, convertTcy: false });
    expect(off.text).toBe("12［＃「12」は縦中横］\n**青**\n");
    expect(off.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    expect(off.processingEvents.some((e) => e.stage === "tcy")).toBe(false);
    expect(off.remainingNotes).toEqual([
      { line: 1, text: "［＃「12」は縦中横］" },
    ]);
    expect(off.stats.emphasis.bold).toBe(1);
  });

  it("counts each postfix note once and does not add that count to residual or job errors", async () => {
    const input =
      "A［＃「A」は縦中横］\nABCDE［＃「ABCDE」は縦中横］\n［＃縦中横］\n";
    const r = convertText(input, quiet);
    expect(r.text).toBe("｟A｠\nABCDE［＃「ABCDE」は縦中横］\n［＃縦中横］\n");
    expect(r.stats.tcy).toEqual({ converted: 1, unconverted: 1 });
    expect(r.stats.remainingNotes).toBe(2);
    expect(r.processingEvents).toEqual([
      { stage: "tcy", action: "converted", count: 1 },
      { stage: "tcy", action: "unconverted", count: 1 },
    ]);
    const imported = await prepareImport([loose("a.txt", input)], {
      outputExtension: "txt",
      conversion: quiet,
    });
    expect(imported.status).toBe("completed");
    const artifact = imported.artifacts[0]!;
    const job = reduceJobStats(initialJobStats(), {
      type: "WriteCommitted",
      fileId: artifact.fileId,
      attemptId: "1",
      delivery: "browser-artifact",
      result: artifact.conversion,
    });
    expect(job.errors).toBe(0);
    expect(job.filesConverted).toBe(1);
    expect(job.remainingNotes).toBe(artifact.conversion.remainingNotes.length);
    expect(job.remainingNotes).toBe(2);
    expect(artifact.conversion.stats.tcy.unconverted).toBe(1);
    expect(job.remainingNotes).not.toBe(
      artifact.conversion.stats.tcy.unconverted +
        artifact.conversion.stats.remainingNotes,
    );
  });

  it("explains known TCY reasons in Japanese and keeps the unknown-code fallback", () => {
    expect(explain("TCY_NOT_CONVERTED", { reason: "empty" })).toContain("空");
    expect(explain("TCY_NOT_CONVERTED", { reason: "invalid-body" })).toContain(
      "1〜4",
    );
    expect(
      explain("TCY_NOT_CONVERTED", { reason: "target-mismatch" }),
    ).toContain("一致");
    expect(explain("TCY_NOT_CONVERTED", { reason: "ruby-context" })).toContain(
      "ルビ",
    );
    expect(explain("TCY_NOT_CONVERTED", { reason: "existing-tcy" })).toContain(
      "重ねて",
    );
    expect(explain("TCY_NOT_CONVERTED", { reason: "future-reason" })).toContain(
      "縦中横",
    );
    expect(explain("TCY_NOT_CONVERTED")).toContain("縦中横");
    expect(
      explain("BOUTEN_NOT_CONVERTED", { reason: "tcy-overlap" }),
    ).toContain("分解");
    expect(explain("UNDERLINE_NOT_CONVERTED")).toContain("傍線");
    expect(explain("NOT_A_REAL_CODE")).toContain("識別コード");
  });

  it("all-off includes convertTcy and still scans the note", () => {
    const off = Object.fromEntries(
      CONTENT_OPTION_KEYS.map((k) => [k, false]),
    ) as ConversionOptions;
    expect(CONTENT_OPTION_KEYS).toContain("convertTcy");
    const input = "12［＃「12」は縦中横］\n青［＃「青」は太字］";
    const r = convertText(input, off);
    expect(r.text).toBe(input);
    expect(r.stats).toEqual({
      ...zeroStats(),
      remainingNotes: 2,
    });
    expect(r.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    expect(r.processingEvents).toEqual([]);
  });

  it("md and txt downloads carry the same body, stats and diagnostics", async () => {
    const input = "12［＃「12」は縦中横］\nⅣ［＃「Ⅳ」は縦中横］\n";
    const expected = "｟12｠\nⅣ［＃「Ⅳ」は縦中横］\n";
    const md = await run([loose("作品.txt", input)], {
      outputExtension: "md",
      conversion: quiet,
    });
    const txt = await run([loose("作品.txt", input)], {
      outputExtension: "txt",
      conversion: quiet,
    });
    expect(decode(md.artifacts[0].bytes)).toBe(expected);
    expect(decode(txt.artifacts[0].bytes)).toBe(expected);
    expect(md.artifacts[0].conversion.stats).toEqual(
      txt.artifacts[0].conversion.stats,
    );
    expect(md.artifacts[0].conversion.diagnostics).toEqual(
      txt.artifacts[0].conversion.diagnostics,
    );
    expect(md.artifacts[0].conversion.stats.tcy).toEqual({
      converted: 1,
      unconverted: 1,
    });
    const zipped = await run([zip("束.zip", [["章.txt", input]])], {
      outputExtension: "txt",
      conversion: { ...quiet, convertTcy: false },
    });
    expect(decode(zipped.artifacts[0].bytes)).toBe(input);
    expect(zipped.artifacts[0].conversion.stats.tcy).toEqual({
      converted: 0,
      unconverted: 0,
    });
    expect(zipped.artifacts[0].relativePath.endsWith(".txt")).toBe(true);
  });
});
