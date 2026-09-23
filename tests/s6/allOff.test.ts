import { describe, it, expect } from "vitest";
import {
  convertText,
  CONTENT_OPTION_KEYS,
  type ConversionOptions,
} from "../../src/index.js";
import { zeroStats } from "../../src/core/options.js";
import { decode, loose, run, utf8, zip } from "./helpers.js";

// S6-04 ALL_OFF_IDENTITY and S6-02 RESIDUAL_SCAN_FOR_TXT_OUTPUT.
const ALL_OFF = Object.freeze(
  Object.fromEntries(CONTENT_OPTION_KEYS.map((k) => [k, false])),
) as ConversionOptions;
// Child/format/level preferences must not change content while parents are OFF.
const CHILDREN_ON: ConversionOptions = {
  preserveIndentNotes: true,
  approximateJiage: true,
  preserveAlignNotes: true,
  approximateSpreadBreaks: true,
  preservePageBreakNotes: true,
  approximateOtherUnderlineStyles: true,
  approximateLeftUnderline: true,
  underlineOutputFormat: "html",
  boutenChar: "●",
  headingLevels: { large: 1, medium: 1, small: 6 },
};
const whole =
  "※［＃U+984C］\n著者\n\n-----\n説明\n-----\n青空［＃「青空」に傍点］［＃「青空」は大見出し］\n" +
  "強調［＃「強調」は太字］\n［＃傍線］下線［＃傍線終わり］\n［＃３字下げ］字下げ本文\n" +
  "［＃地から３字上げ］署名\n［＃改ページ］\n\n［＃改ページ］\n［＃改丁］\n［＃不明］\n" +
  "底本：資料\n入力：人\n青空文庫作成ファイル：\n";
const inputs = {
  empty: "",
  crlfCr: "一\r\n二\r三\n",
  trailingLf: "末尾\n",
  bomChar: "\uFEFF本文※［＃U+0041］",
  existingFrontmatter: "---\ntitle: ※［＃U+0041］\nauthor: 人\n---\n本文",
  brokenFrontmatter: "---\ntitle: [\n---\n本文",
  invalidNotes: "［＃「存在しない」は太字］［＃［＃］［＃",
  emoji: "😀👨‍👩‍👧🇯🇵",
  pua: "\uE000\u{F0000}※［＃U+E000］",
  loneSurrogate: "\uD800a\uDC00",
  code: "```\n※［＃U+0041］\n```\n`［＃「a」は太字］`",
  wholeDocument: whole,
  headerOnly: "題\n著者\n\n本文",
};

describe("13 content fields false: pure string identity", () => {
  it("CONTENT_OPTION_KEYS lists the 9 stage toggles and 4 document fields", () => {
    expect([...CONTENT_OPTION_KEYS].sort()).toEqual(
      [
        "convertGaiji",
        "convertTcy",
        "convertMarkdownEmphasis",
        "convertUnderline",
        "convertBouten",
        "convertHeadings",
        "convertNyozeIndent",
        "convertNyozeAlignEnd",
        "convertNyozePageBreak",
        "removeAozoraFooter",
        "removeAnnotationBlocks",
        "addFrontmatter",
        "addHeaderToBody",
      ].sort(),
    );
  });
  for (const [id, input] of Object.entries(inputs))
    it(`identity: ${id}`, () => {
      for (const options of [ALL_OFF, { ...ALL_OFF, ...CHILDREN_ON }]) {
        const r = convertText(input, options);
        expect(r.text).toBe(input);
        expect(r.stats).toEqual({
          ...zeroStats(),
          remainingNotes: r.remainingNotes.length,
        });
        expect(r.processingEvents).toEqual([]);
        expect(r.outputEncoding).toBe("utf-8");
      }
    });
  it("residual scan still runs and is not emptied (line = output line)", () => {
    const r = convertText(whole, ALL_OFF);
    expect(r.remainingNotes.map((n) => n.line)).toEqual([
      1, 7, 7, 8, 9, 9, 10, 11, 12, 14, 15, 16,
    ]);
    expect(r.remainingNotes[0]).toEqual({ line: 1, text: "※［＃U+984C］" });
    expect(r.remainingNotes.at(-1)).toEqual({ line: 16, text: "［＃不明］" });
    expect(
      r.diagnostics.filter((d) => d.code === "REMAINING_AOZORA_NOTES"),
    ).toEqual([
      {
        code: "REMAINING_AOZORA_NOTES",
        severity: "warning",
        stage: "residual",
        details: { count: 12 },
      },
    ]);
  });
  it("naming metadata stays a read-only computation", () => {
    const r = convertText(inputs.headerOnly, ALL_OFF);
    expect(r.text).toBe(inputs.headerOnly);
    expect(r.namingMetadata).toMatchObject({
      ok: true,
      metadata: { title: "題", author: "著者" },
    });
  });
});

describe("adapter bytes under all-OFF: strict decode, BOM removal, LF, UTF-8", () => {
  const bytesOf = async (
    bytes: Uint8Array,
    name = "w.txt",
    encoding?: "cp932",
  ) =>
    (
      await run([{ id: name, name, kind: "txt", bytes }], {
        conversion: ALL_OFF,
        ...(encoding ? { encoding } : {}),
      })
    ).artifacts[0];
  it("UTF-8 BOM and CRLF/CR: bytes differ from the input, text is LF UTF-8", async () => {
    const input = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("一\r\n二\r三\n")]);
    const a = await bytesOf(input);
    expect(a.decoded).toEqual({ encoding: "utf-8", bom: true });
    expect(decode(a.bytes)).toBe("一\n二\n三\n");
    expect([...a.bytes]).toEqual([...utf8("一\n二\n三\n")]);
    expect([...a.bytes]).not.toEqual([...input]);
  });
  it("cp932 input becomes UTF-8 bytes with notes untouched", async () => {
    // "題［＃" in cp932: 題=91E8, ［=8165, ＃=8194
    const a = await bytesOf(
      new Uint8Array([0x91, 0xe8, 0x81, 0x6d, 0x81, 0x94]),
      "c.txt",
      "cp932",
    );
    expect(decode(a.bytes)).toBe("題［＃");
    expect(a.conversion.remainingNotes).toEqual([]);
  });
  it("pure identity after the adapter's LF normalization", async () => {
    for (const [id, input] of Object.entries(inputs)) {
      if (id === "loneSurrogate" || id === "bomChar") continue;
      const a = await bytesOf(utf8(input), id + ".txt");
      expect(decode(a.bytes), id).toBe(input.replace(/\r\n?/g, "\n"));
    }
  });
  it.each(["md", "txt"] as const)(
    "naming, author folder, collisions and ignored ZIP entries are kept (.%s)",
    async (outputExtension) => {
      const r = await run(
        [
          loose("a.txt", inputs.headerOnly),
          zip("z.zip", [
            ["in/a.txt", inputs.headerOnly],
            ["in/image.png", "\x89PNG"],
          ]),
        ],
        { outputExtension, organizeByAuthor: true, conversion: ALL_OFF },
      );
      expect(r.status).toBe("completed");
      expect(r.artifacts.map((a) => [a.relativePath, decode(a.bytes)])).toEqual(
        [
          [`著者/題.${outputExtension}`, inputs.headerOnly],
          [`著者/題_converted.${outputExtension}`, inputs.headerOnly],
        ],
      );
      expect(r.outcomes.some((o) => o.status === "ignored")).toBe(true);
    },
  );
  it("unsafe ZIP is still rejected under all-OFF", async () => {
    const r = await run([zip("bad.zip", [["../x.txt", "x"]])], {
      conversion: ALL_OFF,
    });
    expect(r.artifacts).toEqual([]);
    expect(r.status).toBe("failed");
  });
});
