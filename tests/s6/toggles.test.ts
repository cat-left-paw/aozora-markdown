import { describe, it, expect } from "vitest";
import {
  convertText,
  CONTENT_OPTION_KEYS,
  DEFAULT_OPTIONS,
  type ConversionOptions,
} from "../../src/index.js";
import { normalizeOptions, zeroStats } from "../../src/core/options.js";
import { decode, loose, run } from "./helpers.js";

// S6-03 OPTIONAL_GAIJI_BOUTEN_HEADINGS, S6-02 COMMON_PROTECTION_FOR_TEXT_INPUT.
const bare = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;

describe("new toggles: default true, undefined = default, explicit false = off", () => {
  const cases = [
    {
      key: "convertGaiji",
      input: "※［＃U+0041］本",
      on: "A本",
      stage: "gaiji",
      note: "※［＃U+0041］",
    },
    {
      key: "convertBouten",
      input: "空［＃「空」に傍点］",
      on: "｜空《﹅》",
      stage: "bouten",
      note: "［＃「空」に傍点］",
    },
    {
      key: "convertHeadings",
      input: "章［＃「章」は大見出し］",
      on: "## 章",
      stage: "headings",
      note: "［＃「章」は大見出し］",
    },
  ] as const;
  for (const c of cases) {
    it(`${c.key}: omitted / undefined / true / false`, () => {
      expect(DEFAULT_OPTIONS[c.key]).toBe(true);
      const omitted = convertText(c.input, bare);
      expect(omitted.text).toBe(c.on);
      expect(convertText(c.input, { ...bare, [c.key]: undefined })).toEqual(
        omitted,
      );
      expect(convertText(c.input, { ...bare, [c.key]: true })).toEqual(omitted);
      const off = convertText(c.input, { ...bare, [c.key]: false });
      expect(off.text).toBe(c.input);
      expect(off.stats[c.stage]).toEqual(zeroStats()[c.stage]);
      expect(off.processingEvents).toEqual([]);
      // The residual scan reports the note the OFF stage left in place.
      expect(off.remainingNotes).toEqual([{ line: 1, text: c.note }]);
      expect(off.stats.remainingNotes).toBe(1);
      expect(off.diagnostics).toEqual([
        {
          code: "REMAINING_AOZORA_NOTES",
          severity: "warning",
          stage: "residual",
          details: { count: 1 },
        },
      ]);
    });
  }
  it("bouten OFF keeps the chosen mark; headings OFF still validates and keeps levels", () => {
    const n = normalizeOptions({ convertBouten: false, boutenChar: "●" });
    expect(n.boutenChar).toBe("●");
    expect(
      convertText("空［＃「空」に傍点］", { ...n, convertBouten: true }).text,
    ).toBe("｜空《●》");
    const h = normalizeOptions({
      convertHeadings: false,
      headingLevels: { large: 1 },
    });
    expect(h.headingLevels).toEqual({ large: 1, medium: 3, small: 4 });
    expect(() =>
      convertText("x", {
        convertHeadings: false,
        headingLevels: { large: 0 as never },
      }),
    ).toThrow("headingLevels.large");
  });
});

// One line per stage so that each toggle has an independent effect.
const stageLines = {
  convertGaiji: ["※［＃U+0041］", "A"],
  convertTcy: ["12［＃「12」は縦中横］", "｟12｠"],
  convertMarkdownEmphasis: ["強［＃「強」は太字］", "**強**"],
  convertUnderline: ["［＃傍線］下［＃傍線終わり］", "||下||"],
  convertBouten: ["空［＃「空」に傍点］", "｜空《﹅》"],
  convertHeadings: ["章［＃「章」は中見出し］", "### 章"],
  convertNyozeIndent: [
    "［＃ここから２字下げ］\n字\n［＃ここで字下げ終わり］",
    ":::indent-2\n字\n:::",
  ],
  convertNyozeAlignEnd: ["［＃地付き］署", ":::align-end\n署\n:::"],
  convertNyozePageBreak: ["［＃改ページ］", ":::page-break\n:::"],
} as const;
const stageOf = {
  convertGaiji: "gaiji",
  convertTcy: "tcy",
  convertMarkdownEmphasis: "emphasis",
  convertUnderline: "underline",
  convertBouten: "bouten",
  convertHeadings: "headings",
  convertNyozeIndent: "indent",
  convertNyozeAlignEnd: "align",
  convertNyozePageBreak: "pageBreak",
} as const;
const stageKeys = Object.keys(stageLines) as (keyof typeof stageLines)[];
const stageDoc = stageKeys.map((k) => stageLines[k][0]).join("\n");
const allStages = {
  ...bare,
  ...Object.fromEntries(stageKeys.map((k) => [k, true])),
} as ConversionOptions;

describe("single stage OFF changes only that stage", () => {
  const on = convertText(stageDoc, allStages);
  it("all stages ON converts every line (hand-derived)", () => {
    expect(on.text).toBe(stageKeys.map((k) => stageLines[k][1]).join("\n"));
    expect(on.remainingNotes).toEqual([]);
  });
  for (const key of stageKeys)
    it(`${key}=false`, () => {
      const off = convertText(stageDoc, { ...allStages, [key]: false });
      expect(off.text).toBe(
        stageKeys.map((k) => stageLines[k][k === key ? 0 : 1]).join("\n"),
      );
      const stage = stageOf[key];
      expect(off.stats[stage]).toEqual(zeroStats()[stage]);
      for (const other of Object.values(stageOf))
        if (other !== stage) expect(off.stats[other]).toEqual(on.stats[other]);
      expect(off.processingEvents.some((e) => e.stage === stage)).toBe(false);
      expect(off.remainingNotes.length).toBeGreaterThan(0);
    });
});

describe("combinations of the 13 content fields", () => {
  const doc =
    "題\n著者\n\n-----\n説明［＃「説明」は太字］\n-----\n" +
    stageDoc +
    "\n\n底本：資料\n入力：人\n青空文庫作成ファイル：\n";
  const keys = [...CONTENT_OPTION_KEYS];
  it("13 fields, 8192 combinations: OFF stages have zero stats, notes point at final lines, all-OFF identity", () => {
    expect(keys).toHaveLength(13);
    // addHeaderToBody only restores a header below an existing frontmatter.
    const headerOnly = 1 << keys.indexOf("addHeaderToBody");
    let identities = 0;
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const options = Object.fromEntries(
        keys.map((k, i) => [k, Boolean(mask & (1 << i))]),
      ) as ConversionOptions;
      const r = convertText(doc, { ...allStages, ...options });
      for (const [k, stage] of Object.entries(stageOf))
        if (!options[k as keyof ConversionOptions])
          expect(r.stats[stage]).toEqual(zeroStats()[stage]);
      if (!options.removeAozoraFooter)
        expect(r.stats.footerRemoved).toBe(false);
      const lines = r.text.split("\n");
      for (const n of r.remainingNotes)
        expect(lines[n.line - 1]).toContain(n.text);
      expect(r.stats.remainingNotes).toBe(r.remainingNotes.length);
      expect(
        r.diagnostics.filter((d) => d.code === "REMAINING_AOZORA_NOTES"),
      ).toHaveLength(r.remainingNotes.length ? 1 : 0);
      if (mask === 0 || mask === headerOnly) {
        expect(r.text).toBe(doc);
        identities++;
      } else expect(r.text).not.toBe(doc);
    }
    expect(identities).toBe(2);
  });
  it("each of the 13 fields alone changes the text", () => {
    const off = Object.fromEntries(keys.map((k) => [k, false]));
    const withFrontmatter = "---\ntitle: 題\nauthor: 著者\n---\n本文";
    for (const key of keys) {
      const options = { ...allStages, ...off, [key]: true };
      const input = key === "addHeaderToBody" ? withFrontmatter : doc;
      expect(convertText(input, options).text, key).not.toBe(input);
    }
    expect(
      convertText(withFrontmatter, {
        ...allStages,
        ...off,
        addHeaderToBody: true,
      }).text,
    ).toBe("---\ntitle: 題\nauthor: 著者\n---\n題\n著者\n\n本文");
  });
});

describe("common Markdown-aware protection for every input", () => {
  const protectedInputs = [
    "```\n※［＃U+0041］青［＃「青」は太字］\n```",
    "`※［＃U+0041］` と `［＃「章」は大見出し］`",
    "---\ntitle: ※［＃U+0041］\nauthor: 人\n---\n本文",
    "~~~\n空［＃「空」に傍点］\n~~~",
  ];
  it.each(protectedInputs)("unchanged: %j", async (input) => {
    expect(convertText(input).text).toBe(input);
    for (const name of ["p.txt", "p.md"])
      for (const outputExtension of ["md", "txt"] as const) {
        const r = await run([loose(name, input)], { outputExtension });
        expect(decode(r.artifacts[0].bytes)).toBe(input);
      }
  });
  it("text around protected spans converts; fenced notes are not residual", () => {
    const r = convertText(
      "青［＃「青」は太字］\n```\n［＃未知］\n```\n※［＃U+0041］",
      bare,
    );
    expect(r.text).toBe("**青**\n```\n［＃未知］\n```\nA");
    expect(r.remainingNotes).toEqual([]);
  });
  it("intentional preserve is excluded only for the preserved occurrence; parent OFF counts notes", () => {
    const input = "［＃２字下げ］青\n［＃不明］";
    const kept = convertText(input, {
      ...bare,
      convertNyozeIndent: true,
      preserveIndentNotes: true,
    });
    // "［＃２字下げ］\n:::indent-2\n青\n:::" as in pipeline-v2 whole-document.
    expect(kept.text).toBe("［＃２字下げ］\n:::indent-2\n青\n:::\n［＃不明］");
    expect(kept.remainingNotes).toEqual([{ line: 5, text: "［＃不明］" }]);
    const off = convertText(input, {
      ...bare,
      convertNyozeIndent: false,
      preserveIndentNotes: true,
    });
    expect(off.text).toBe(input);
    expect(off.remainingNotes).toEqual([
      { line: 1, text: "［＃２字下げ］" },
      { line: 2, text: "［＃不明］" },
    ]);
  });
});
